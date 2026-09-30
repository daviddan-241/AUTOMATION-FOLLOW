// pumpDashboard - public web panel for the pump automation: live status + off switches.
// GET  ?t=<dashboard_token>  -> HTML dashboard (status of growth, flip, wallet)
// POST {token, action}      -> toggle switches: all_on, all_off, growth_on, growth_off, flip_on, flip_off
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

const esc = (s: any) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const url = new URL(req.url);
  const qToken = url.searchParams.get("t") || "";

  // read state
  const ctlRaw: any = await base44.asServiceRole.entities.Controls.list({} as any);
  const ctl = (Array.isArray(ctlRaw) ? ctlRaw : (ctlRaw?.data || []))[0];
  const cfgRaw: any = await base44.asServiceRole.entities.GrowthConfig.list({} as any);
  const cfg = (Array.isArray(cfgRaw) ? cfgRaw : (cfgRaw?.data || [])).find((c: any) => c.active === true);
  const logRaw: any = await base44.asServiceRole.entities.CycleLog.list({} as any);
  const logs = Array.isArray(logRaw) ? logRaw : (logRaw?.data || []);
  const last = logs.slice().sort((a: any, b: any) => String(b.cycle_time || "").localeCompare(String(a.cycle_time || "")))[0];
  const fsRaw: any = await base44.asServiceRole.entities.FlipState.list({} as any);
  const fs = (Array.isArray(fsRaw) ? fsRaw : (fsRaw?.data || []))[0];

  const token = ctl?.dashboard_token;
  let holding: any = null;
  try { holding = fs ? JSON.parse(fs.holding_json || "null") : null; } catch (_) {}

  // POST: toggle actions
  if (req.method === "POST") {
    if (!token || qToken !== token) return new Response(JSON.stringify({ ok: false, error: "bad token" }), { status: 403, headers: { "Content-Type": "application/json" } });
    let body: any = {};
    try { body = await req.json(); } catch (_) {}
    const action = String(body.action || "");
    const patch: any = {};
    if (action === "all_on") { patch.automation_enabled = true; patch.growth_enabled = true; patch.flip_enabled = true; }
    else if (action === "all_off") { patch.automation_enabled = false; patch.growth_enabled = false; patch.flip_enabled = false; }
    else if (action === "growth_on") { patch.growth_enabled = true; }
    else if (action === "growth_off") { patch.growth_enabled = false; }
    else if (action === "flip_on") { patch.flip_enabled = true; }
    else if (action === "flip_off") { patch.flip_enabled = false; }
    else return new Response(JSON.stringify({ ok: false, error: "unknown action" }), { status: 400, headers: { "Content-Type": "application/json" } });

    await base44.asServiceRole.entities.Controls.update(ctl.id, patch);
    return new Response(JSON.stringify({ ok: true, action }), { headers: { "Content-Type": "application/json" } });
  }

  // GET: require token for the panel
  if (!token || qToken !== token) {
    return new Response("<h1>403</h1><p>Invalid or missing token. Open the dashboard with your personal link (?t=...).</p>", { status: 403, headers: { "Content-Type": "text/html" } });
  }

  const bal = cfg ? await balance(cfg.wallet_address) : -1;
  const price = await solPrice();
  const usd = bal >= 0 ? (bal * price) : -1;
  const mode = fs?.mode || "grow";
  const banked = fs?.banked_sol || 0;

  const ago = (iso: string) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
  };

  const followBacks = ((last?.new_follow_backs as string[]) || []).map(esc).join(", ") || "none";
  const errors = ((last?.errors as string[]) || []).map(esc).join(" | ") || "none";
  const devs = (last?.devs_followed as any[]) || [];

  const btn = (label: string, action: string, danger: boolean) =>
    `<button class="btn ${danger ? "danger" : ""}" onclick="doAction('${action}')">${esc(label)}</button>`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pump Automation Panel</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #0b0e14; color: #e6e8ee; padding: 24px; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #8b93a7; font-size: 13px; margin-bottom: 20px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 14px; max-width: 900px; }
  .card { background: #141925; border: 1px solid #232b3d; border-radius: 12px; padding: 16px; }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .06em; color: #8b93a7; margin-bottom: 10px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 14px; }
  .row .v { font-weight: 600; text-align: right; }
  .on { color: #34d399; } .off { color: #f87171; }
  .btn { background: #1e4d3b; color: #b8f5d4; border: none; border-radius: 8px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 8px; }
  .btn.danger { background: #4d1e24; color: #ffd7dc; }
  .btn:hover { filter: brightness(1.15); }
  .small { font-size: 12px; color: #8b93a7; margin-top: 12px; line-height: 1.5; }
  code { background: #1c2333; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style></head>
<body>
<h1>Pump Automation Panel</h1>
<div class="sub">@${esc(cfg?.pump_username || "?")} - live status and off switches for the growth + flip automation</div>
<div class="grid">
  <div class="card">
    <h2>Off Switches</h2>
    <div class="row"><span>Everything (master)</span><span class="v ${ctl?.automation_enabled !== false ? "on" : "off"}">${ctl?.automation_enabled !== false ? "RUNNING" : "STOPPED"}</span></div>
    <div class="row"><span>Growth (1h follow cycle)</span><span class="v ${ctl?.growth_enabled !== false ? "on" : "off"}">${ctl?.growth_enabled !== false ? "RUNNING" : "STOPPED"}</span></div>
    <div class="row"><span>Flip trading (30m watch)</span><span class="v ${ctl?.flip_enabled !== false ? "on" : "off"}">${ctl?.flip_enabled !== false ? "RUNNING" : "STOPPED"}</span></div>
    ${btn("STOP EVERYTHING", "all_off", true)}
    ${btn("Start everything", "all_on", false)}
    ${btn("Stop growth only", "growth_off", true)}
    ${btn("Start growth only", "growth_on", false)}
    ${btn("Stop flip trading only", "flip_off", true)}
    ${btn("Start flip trading only", "flip_on", false)}
  </div>
  <div class="card">
    <h2>Wallet &amp; Flip</h2>
    <div class="row"><span>SOL balance</span><span class="v">${bal >= 0 ? bal.toFixed(5) + " SOL" : "?"}</span></div>
    <div class="row"><span>USD value</span><span class="v">$${usd >= 0 ? usd.toFixed(2) : "?"}</span></div>
    <div class="row"><span>Mode</span><span class="v ${mode === "stopped" ? "off" : "on"}">${esc(mode)}</span></div>
    <div class="row"><span>Banked (untouchable)</span><span class="v">${banked.toFixed(5)} SOL</span></div>
    <div class="row"><span>Position</span><span class="v">${holding && holding.status === "holding" ? esc(holding.symbol || holding.mint?.slice(0, 6)) : "none"}</span></div>
    <div class="row"><span>Last flip scan</span><span class="v">${esc(ago(fs?.last_run))}</span></div>
    <div class="small">Plan: grow to $10, then stake $3 of profit; if the stake dies, trading stops and the bank is kept.</div>
  </div>
  <div class="card">
    <h2>Last Growth Cycle</h2>
    <div class="row"><span>Ran</span><span class="v">${esc(ago(last?.cycle_time))}</span></div>
    <div class="row"><span>Coins scanned</span><span class="v">${esc(last?.coins_scanned ?? "-")}</span></div>
    <div class="row"><span>Devs followed</span><span class="v">${devs.map((d: any) => esc(d.username)).join(", ") || "0"}</span></div>
    <div class="row"><span>Likes made</span><span class="v">${esc(last?.likes_made ?? "-")}</span></div>
    <div class="row"><span>New follow-backs</span><span class="v">${followBacks}</span></div>
    <div class="row"><span>Session</span><span class="v ${last?.session_ok ? "on" : "off"}">${last?.session_ok ? "OK" : "EXPIRED"}</span></div>
    <div class="small">Errors: ${errors}</div>
  </div>
</div>
<div class="small">Kill switches take effect on the next scheduled run (within 1h for growth, 30 min for flip).<br>
All engagement and trades are real. This panel never exposes wallet keys or session cookies.</div>
<script>
async function doAction(action) {
  const params = new URLSearchParams(window.location.search);
  const r = await fetch(window.location.pathname + "?t=" + encodeURIComponent(params.get("t") || ""), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: params.get("t") || "", action }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.ok) location.reload(); else alert(j.error || "failed");
}
</script>
</body></html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
