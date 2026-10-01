// pumpGrowthCycle - runs one pump.fun growth cycle using the active GrowthConfig.
// Auth: pump.fun `auth_token` cookie stored in GrowthConfig (see docs/auth-flow.md).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const API = "https://frontend-api-v3.pump.fun";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(2000 + Math.random() * 1200);

async function api(cfg: any, method: string, path: string, body?: any) {
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json",
    "Origin": "https://pump.fun",
    "Referer": "https://pump.fun/",
    "Cookie": `auth_token=${cfg.auth_token}; pump_device_id=${cfg.pump_device_id}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    const resp = await fetch(API + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let json: any = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}
    return { status: resp.status, json };
  } catch (e: any) {
    return { status: 0, json: { error: String(e) } };
  }
}

async function walletFresh(addr: string): Promise<boolean> {
  // pump-native proxy: wallet is empty/young on-chain (embedded Pump wallet), not an old pro wallet
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const resp = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [addr, { limit: 1000 }] }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data: any = await resp.json();
    const sigs = data.result || [];
    if (sigs.length >= 1000) return false; // too much history = not a fresh pump-native wallet
    if (!sigs.length) return true;
    const oldest = (sigs[sigs.length - 1].blockTime || 0) * 1000;
    return Date.now() - oldest < 90 * 24 * 3600 * 1000;
  } catch (_) {
    return true; // don't drop candidates on RPC errors
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const log: any = {
    cycle_time: new Date().toISOString(),
    coins_scanned: 0,
    devs_followed: [],
    likes_made: 0,
    new_follow_backs: [],
    errors: [],
    session_ok: true,
  };

  try {
    // kill switch (web dashboard off switch)
    const ctlRaw: any = await base44.asServiceRole.entities.Controls.list({} as any);
    const ctlAll: any[] = Array.isArray(ctlRaw) ? ctlRaw : (ctlRaw?.data || []);
    const ctl = ctlAll[0];
    if (ctl && (ctl.automation_enabled === false || ctl.growth_enabled === false)) {
      log.errors.push("growth paused via dashboard off switch - skipping cycle");
      await base44.asServiceRole.entities.CycleLog.create(log);
      return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
    }

    const raw: any = await base44.asServiceRole.entities.GrowthConfig.list({} as any);
    const all: any[] = Array.isArray(raw) ? raw : (raw?.data || raw?.items || raw?.results || []);
    const cfg = all.find((c: any) => c.active === true) || all[0];
    if (!cfg) throw new Error("no active GrowthConfig (list shape: " + JSON.stringify(raw).slice(0, 300) + ")");

    // 1. session check
    const me = await api(cfg, "GET", "/auth/my-profile");
    if (me.status !== 200) {
      log.session_ok = false;
      log.errors.push(`session check: ${me.status}`);
      await base44.asServiceRole.entities.CycleLog.create(log);
      return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
    }

    // 2. follow-back detection (cheap read)
    const fol = await api(cfg, "GET", `/following/followers/${cfg.user_id}`);
    const followers = Array.isArray(fol.json) ? fol.json : [];
    const known: string[] = Array.isArray(cfg.known_followers) ? cfg.known_followers : [];
    const followerNames = followers.map((f: any) => f.username || f.address || f.userId).filter(Boolean);
    log.new_follow_backs = followerNames.filter((n: string) => !known.includes(n));
    if (followerNames.length && JSON.stringify(followerNames) !== JSON.stringify(known)) {
      await base44.asServiceRole.entities.GrowthConfig.update(cfg.id, { known_followers: followerNames });
    }

    // 3. discover new coins
    const coins: any[] = [];
    for (let off = 0; off < 400; off += 50) {
      const coinsResp = await api(cfg, "GET", `/coins?offset=${off}&limit=50&sort=created_timestamp&order=DESC`);
      if (coinsResp.status !== 200) break;
      const page = Array.isArray(coinsResp.json) ? coinsResp.json : [];
      coins.push(...page);
      if (page.length < 50) break;
      await sleep(300);
    }
    log.coins_scanned = coins.length;

    const creators: string[] = [];
    const seen = new Set<string>();
    for (const c of coins) {
      const cr = c.creator;
      if (cr && !seen.has(cr)) { seen.add(cr); creators.push(cr); }
    }

    // who I already follow
    const already = new Set<string>();
    for (let pg = 0; pg < 6; pg++) {
      const mf = await api(cfg, "GET", `/following/v3/following/${cfg.user_id}?limit=100&offset=${pg * 100}`);
      if (mf.status !== 200) break;
      const arr = Array.isArray(mf.json) ? mf.json : [];
      for (const f of arr) if (f.userId) already.add(f.userId);
      if (arr.length < 100) break;
      await sleep(400);
    }

    // 4. batch profiles + filters
    const cands: any[] = [];
    for (let i = 0; i < creators.length; i += 50) {
      const b = await api(cfg, "POST", "/users/batch", { addresses: creators.slice(i, i + 50) });
      if (b.status === 200 || b.status === 201) {
        for (const p of Array.isArray(b.json) ? b.json : []) {
          const uid = p.userId, u = p.username || "";
          if (!uid || already.has(uid) || p.is_banned) continue;
          if (p.is_pump_user !== true) continue; // embedded Pump wallets only - never outside wallets
          if (!u || u.startsWith("user-")) continue;
          if ((p.followers || 0) >= (cfg.follower_limit ?? 30)) continue;
          cands.push(p);
        }
      }
      await sleep(500);
    }

    // 5. engage: follow + like their callouts
    const maxF = cfg.max_follows_per_cycle ?? 12;
    const maxL = cfg.max_likes_per_cycle ?? 15;
    const deadline = Date.now() + 200000; // hard stop: always leave time to log + audit
    for (const p of cands) {
      if (log.devs_followed.length >= maxF || log.likes_made >= maxL) break;
      if (Date.now() > deadline) { log.errors.push("engage deadline reached - finishing cycle"); break; }
      const uid = p.userId;
      const cl = await api(cfg, "GET", `/callout/list/${uid}`);
      if (cl.status === 429) { await sleep(45000); continue; }
      if (cl.status !== 200) { log.errors.push(`callouts ${p.username}: ${cl.status}`); continue; }
      const real = (cl.json.callouts || []).filter((k: any) => (k.thesis || "").trim());
      if (!real.length) continue;
      if (!(await walletFresh(p.address))) continue; // RPC only for devs we will actually follow
      const f = await api(cfg, "POST", `/following/v2/${uid}`, {});
      if (f.status === 401) { log.session_ok = false; log.errors.push("session expired mid-cycle"); break; }
      if (f.status === 429) { await sleep(45000); continue; }
      if (f.status !== 200 && f.status !== 201) { log.errors.push(`follow ${p.username}: ${f.status}`); continue; }
      log.devs_followed.push({ username: p.username, userId: uid, followers: p.followers });
      await pace();
      for (const k of real.slice(0, 2)) {
        if (log.likes_made >= maxL) break;
        if (k.hasLiked) continue;
        const l = await api(cfg, "POST", `/callout/${k.calloutId}/like`, {});
        if (l.status === 200 || l.status === 201) log.likes_made++;
        else if (l.status === 429) { await sleep(45000); }
        await pace();
      }
    }

    // 6. persist log immediately after the follow phase (audit updates it after)
    let logId: any = undefined;
    try {
      const created: any = await base44.asServiceRole.entities.CycleLog.create(log);
      logId = created?.id || created?._id || undefined;
    } catch (_) {}

    // 5b. audit (batched): unfollow outside wallets fast (DELETE /following/{uid})
    const auditFol: any[] = [];
    for (let pg = 0; pg < 6; pg++) {
      const al = await api(cfg, "GET", `/following/v3/following/${cfg.user_id}?limit=100&offset=${pg * 100}`);
      if (al.status !== 200) break;
      const arr = Array.isArray(al.json) ? al.json : [];
      auditFol.push(...arr);
      if (arr.length < 100) break;
      await sleep(400);
    }
    const audMap = new Map<string, string>(); // address -> userId
    for (const f of auditFol) if (f.userId && f.address) audMap.set(f.address, f.userId);
    const audAddrs = Array.from(audMap.keys());
    for (let i = 0; i < audAddrs.length; i += 50) {
      const b = await api(cfg, "POST", "/users/batch", { addresses: audAddrs.slice(i, i + 50) });
      if (b.status !== 429 && b.status !== 200 && b.status !== 201) { await sleep(2000); continue; }
      if (b.status === 429) { await sleep(45000); continue; }
      for (const p of Array.isArray(b.json) ? b.json : []) {
        if (p.is_pump_user === false && p.userId) {
          const unf = await api(cfg, "DELETE", `/following/${p.userId}`);
          if (unf.status === 200 || unf.status === 201) {
            log.errors.push(`unfollowed outside wallet: ${p.username || p.userId}`);
            await pace();
          }
        }
      }
      await sleep(600);
    }
    log.audited = auditFol.length;

    if (logId) { try { await base44.asServiceRole.entities.CycleLog.update(logId, log); } catch (_) {} }
    return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    log.errors.push(String(e));
    log.session_ok = false;
    try { await base44.asServiceRole.entities.CycleLog.create(log); } catch (_) {}
    return new Response(JSON.stringify(log), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
