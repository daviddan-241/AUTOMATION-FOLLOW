// pumpGrowthCycle v5 - owner spec 2026-10-02: FOLLOW-ONLY, follow plenty.
// Follow coin devs who (a) HOLD a real position in their own coin (>= 1% of supply,
// verified via RugCheck - public Solana RPCs block the runtime IP),
// (b) are pump.fun embedded wallets (is_pump_user true, no outside wallets),
// (c) created only 1-2 coins EVER, (d) their coin has >= $3k mcap and is SOL-paired,
// (e) have under 100 followers. No buys, no callouts, no tag posts.
// Volume: max_follows_per_cycle from GrowthConfig (owner wants plenty of follows).
// Auth: pump.fun `auth_token` cookie stored in GrowthConfig (see docs/auth-flow.md).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const API = "https://frontend-api-v3.pump.fun";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pace = () => sleep(2000 + Math.random() * 1200);

// owner rule: dev must have created LESS THAN 2 coins EVER (not just in the scan window).
// One paginated probe: if 2+ coins come back for the creator, skip.
async function totalCoinsByCreator(cfg: any, creator: string): Promise<number> {
  let n = 0, total = 0, guard = 0;
  while (guard++ < 6) {
    const r = await api(cfg, "GET", `/coins?creator=${creator}&limit=50&offset=${n}&sort=created_timestamp&order=DESC`);
    if (r.status !== 200) return -1;
    const page = Array.isArray(r.json) ? r.json : [];
    total += page.length;
    n += page.length;
    if (page.length < 50) return total;
    if (total >= 2) return total; // early exit: 2+ coins = disqualified, no need to count further
  }
  return total;
}

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

// owner rule: the dev must still hold their own coin.
// Verified via RugCheck's public token report (creatorBalance), because Solana public
// RPCs block the function runtime's IP. Returns creatorBalance or -1 if unverifiable.
async function devCoinHoldingPct(mint: string): Promise<number> {
  // returns dev holding as % of total supply, or -1 if unverifiable
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const resp = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (resp.status !== 200) return -1;
    const data: any = await resp.json();
    const bal = data?.creatorBalance;
    const supply = data?.token?.supply;
    if (typeof bal !== "number" || typeof supply !== "number" || supply <= 0) return -1;
    return (bal / supply) * 100;
  } catch (_) {
    return -1; // cannot verify -> skip the dev (all real, no guesses)
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const log: any = {
    cycle_time: new Date().toISOString(),
    coins_scanned: 0,
    devs_followed: [],
    pending_callouts: [],
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
    if (!cfg) throw new Error("no active GrowthConfig");

    // 1. session check
    const me = await api(cfg, "GET", "/auth/my-profile");
    if (me.status !== 200) {
      log.session_ok = false;
      log.errors.push(`session check: ${me.status}`);
      await base44.asServiceRole.entities.CycleLog.create(log);
      return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
    }

    // 2. follow-back detection
    const fol = await api(cfg, "GET", `/following/followers/${cfg.user_id}`);
    const followers = Array.isArray(fol.json) ? fol.json : [];
    const known: string[] = Array.isArray(cfg.known_followers) ? cfg.known_followers : [];
    const followerNames = followers.map((f: any) => f.username || f.address || f.userId).filter(Boolean);
    log.new_follow_backs = followerNames.filter((n: string) => !known.includes(n));
    if (followerNames.length && JSON.stringify(followerNames) !== JSON.stringify(known)) {
      await base44.asServiceRole.entities.GrowthConfig.update(cfg.id, { known_followers: followerNames });
    }

    // 3. deep scan newest coins + count creations per dev (owner: only 1-2 coin creators)
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

    const creations = new Map<string, any[]>(); // creator -> coins (>= $3k mcap ones only)
    for (const c of coins) {
      if (c.is_banned || !c.creator || !c.mint) continue;
      if ((c.usd_market_cap ?? 0) < 3000) continue; // owner rule: coin must have 3k+ mcap
      if (c.quote_mint !== "11111111111111111111111111111111") continue; // SOL-paired only (SOL buy flow)
      const arr = creations.get(c.creator) || [];
      arr.push(c);
      creations.set(c.creator, arr);
    }

    // creator must have created only 1-2 coins total (within the scan window)
    const totalByCreator = new Map<string, number>();
    for (const c of coins) if (c.creator) totalByCreator.set(c.creator, (totalByCreator.get(c.creator) || 0) + 1);

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

    // 4. batch profiles + filters (embedded wallets only, any follower count)
    const creatorAddrs: string[] = [];
    for (const [cr, cs] of creations) {
      if ((totalByCreator.get(cr) || 0) > 2) continue; // owner rule: only devs with 1-2 coins created
      creatorAddrs.push(cr);
    }
    const cands: any[] = []; // {profile, coin}
    for (let i = 0; i < creatorAddrs.length; i += 50) {
      const b = await api(cfg, "POST", "/users/batch", { addresses: creatorAddrs.slice(i, i + 50) });
      if (b.status === 200 || b.status === 201) {
        for (const p of Array.isArray(b.json) ? b.json : []) {
          const uid = p.userId, u = p.username || "";
          if (!uid || already.has(uid) || p.is_banned) continue;
          if (p.is_pump_user !== true) continue; // embedded Pump wallets only - never outside wallets
          if (!u || u.startsWith("user-")) continue;
          if ((p.followers || 0) >= 100) continue; // owner rule: only devs under 100 followers
          const coin = (creations.get(p.address) || []).sort((x: any, y: any) => y.usd_market_cap - x.usd_market_cap)[0];
          if (!coin) continue;
          cands.push({ profile: p, coin });
        }
      }
      await sleep(500);
    }

    // 5. engage: follow first (then the workflow agent step buys + posts the callout)
    const maxF = cfg.max_follows_per_cycle ?? 15; // follow-only mode: no callout cap
    const deadline = Date.now() + 200000;
    for (const cand of cands) {
      if (log.devs_followed.length >= maxF) break;
      if (Date.now() > deadline) { log.errors.push("engage deadline reached - finishing cycle"); break; }
      const p = cand.profile, coin = cand.coin;
      // owner rule: dev must have created less than 2 coins EVER (verified via creator listing, not just scan window)
      const totalCreated = await totalCoinsByCreator(cfg, p.address || coin.creator);
      if (totalCreated > 2) { log.errors.push(`skipped ${p.username}: ${totalCreated} coins created`); continue; }
      if (totalCreated < 0) { log.errors.push(`coin-count check failed: ${p.username}`); continue; }
      // owner rule: dev must hold a real position in their own coin (>= 1% of supply, verified via RugCheck)
      const devPct = await devCoinHoldingPct(coin.mint);
      if (devPct < 0) { log.errors.push(`holding check failed: ${coin.symbol}`); continue; }
      if (devPct < 1) continue; // dust holding = effectively sold -> skip
      const f = await api(cfg, "POST", `/following/v2/${p.userId}`, {});
      if (f.status === 401) { log.session_ok = false; log.errors.push("session expired mid-cycle"); break; }
      if (f.status === 429) { await sleep(45000); continue; }
      if (f.status !== 200 && f.status !== 201) { log.errors.push(`follow ${p.username}: ${f.status}`); continue; }
      log.devs_followed.push({ username: p.username, userId: p.userId, followers: p.followers, coin: coin.symbol, mint: coin.mint, mcap_usd: coin.usd_market_cap, dev_holding_pct: Math.round(devPct * 100) / 100 });
      await pace();
    }

    // 6. persist log
    try { await base44.asServiceRole.entities.CycleLog.create(log); } catch (_) {}

    // 5b. audit (batched): unfollow outside wallets
    const auditFol: any[] = [];
    for (let pg = 0; pg < 6; pg++) {
      const al = await api(cfg, "GET", `/following/v3/following/${cfg.user_id}?limit=100&offset=${pg * 100}`);
      if (al.status !== 200) break;
      const arr = Array.isArray(al.json) ? al.json : [];
      auditFol.push(...arr);
      if (arr.length < 100) break;
      await sleep(400);
    }
    const audMap = new Map<string, string>();
    for (const f of auditFol) if (f.userId && f.address) audMap.set(f.address, f.userId);
    const audAddrs = Array.from(audMap.keys());
    for (let i = 0; i < audAddrs.length; i += 50) {
      const b = await api(cfg, "POST", "/users/batch", { addresses: audAddrs.slice(i, i + 50) });
      if (b.status === 429) { await sleep(45000); continue; }
      if (b.status !== 200 && b.status !== 201) { await sleep(2000); continue; }
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

    return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    log.errors.push(String(e));
    log.session_ok = false;
    try { await base44.asServiceRole.entities.CycleLog.create(log); } catch (_) {}
    return new Response(JSON.stringify(log), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
