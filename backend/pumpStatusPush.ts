// pumpStatusPush - builds the live status snapshot and pushes it to the GitHub repo
// so the public dashboard (GitHub Pages) always shows fresh, real data.
// Reads: Controls, GrowthConfig, CycleLog, FlipState, wallet balance, SOL price.
// Writes: docs/status.json in daviddan-241/AUTOMATION-FOLLOW (public dashboard page reads it).
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

async function balance(addr: string): Promise<number> {
  for (const rpc of RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
      });
      const data: any = await resp.json();
      const v = data?.result?.value;
      if (typeof v === "number" && v >= 0) return v / 1e9;
    } catch (_) { /* next */ }
  }
  return -1;
}

async function solPrice(): Promise<number> {
  try {
    const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
    });
    const d: any = await resp.json();
    return d?.solana?.usd || 160;
  } catch (_) { return 160; }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const out: any = { generated_at: new Date().toISOString(), ok: true };

  try {
    const list = async (e: string) => {
      const r: any = await (base44.asServiceRole as any).entities[e].list({} as any);
      return Array.isArray(r) ? r : (r?.data || []);
    };

    const [ctlAll, cfgAll, logs, fss] = await Promise.all([
      list("Controls"), list("GrowthConfig"), list("CycleLog"), list("FlipState"),
    ]);
    const ctl = ctlAll[0] || {};
    const cfg = cfgAll.find((c: any) => c.active === true) || cfgAll[0] || {};
    const last = logs.slice().sort((a: any, b: any) => String(b.cycle_time || "").localeCompare(String(a.cycle_time || "")))[0] || {};
    const fs = fss[0] || {};

    let holding: any = null;
    try { holding = JSON.parse(fs.holding_json || "null"); } catch (_) {}

    const bal = await balance(cfg.wallet_address || "");
    const price = await solPrice();

    out.controls = {
      automation_enabled: ctl.automation_enabled !== false,
      growth_enabled: ctl.growth_enabled !== false,
      flip_enabled: ctl.flip_enabled !== false,
    };
    out.account = { username: cfg.pump_username || "", followers_known: (cfg.known_followers || []).length };
    out.wallet = {
      address: cfg.wallet_address || "",
      sol: bal,
      usd: Math.round(bal * price * 100) / 100,
      sol_price: price,
    };
    out.flip = {
      mode: fs.mode || "grow",
      banked_sol: fs.banked_sol || 0,
      holding: holding && holding.status === "holding" ? {
        symbol: holding.symbol || "", mint: holding.mint || "",
        entry_mcap: holding.entry_mcap || 0, bought_at: holding.bought_at || "",
      } : null,
      last_scan: fs.last_run || "",
    };
    out.last_cycle = {
      time: last.cycle_time || "",
      coins_scanned: last.coins_scanned ?? 0,
      devs_followed: (last.devs_followed || []).map((d: any) => d.username),
      likes_made: last.likes_made ?? 0,
      new_follow_backs: last.new_follow_backs || [],
      session_ok: last.session_ok !== false,
      errors: (last.errors || []).slice(0, 10),
    };

    // push to GitHub
    const token = (globalThis as any).Deno?.env?.get?.("GITHUB_TOKEN") ||
      (globalThis as any).process?.env?.GITHUB_TOKEN || "";
    if (!token) {
      out.pushed = false;
      out.push_error = "GITHUB_TOKEN not available to function";
    } else {
      const api = "https://api.github.com/repos/daviddan-241/AUTOMATION-FOLLOW/contents/docs/status.json";
      const content = btoa(unescape(encodeURIComponent(JSON.stringify(out, null, 2))));
      let sha = "";
      try {
        const cur = await fetch(api, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "pump-automation" } });
        if (cur.ok) sha = (await cur.json()).sha || "";
      } catch (_) { /* new file */ }
      const put = await fetch(api, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "pump-automation" },
        body: JSON.stringify({
          message: `status refresh ${out.generated_at}`,
          content,
          sha: sha || undefined,
        }),
      });
      out.pushed = put.ok;
      if (!put.ok) out.push_error = `github ${put.status}`;
    }
    return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    out.ok = false;
    out.error = String(e);
    return new Response(JSON.stringify(out), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
