// pumpFlipWatch - watches pump.fun new-coin momentum for the $1 flip attempt.
// Profit-tier plan (owner 2026-09-30): grow ~$1.6 to $10, then stake $3 of profit
// on higher-stakes trades; if the $3 stake dies, stop for good (keep the bank).
// v3 (pro filters, 2026-09-30): research-backed entry checks - dev holding %,
// top-10 holder concentration, RugCheck score, social metadata, USD mcap zone.
// Partial-exit ladder: TP1 +80% sell half, TP2 +160% sell half of rest,
// moonbag trails 25% below peak. Hard SL -35%. Kill switch: Controls entity.
// Trades themselves are executed by the superagent in the browser (embedded
// wallet signing) - this function never trades.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const API = "https://frontend-api-v3.pump.fun";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIN_FUEL_SOL = 0.004;      // need at least this to attempt a buy
const GROWTH_SIGNAL = 2.0;      // usd mcap x2.0 since last snapshot (~30 min)
const MAX_AGE_MIN = 60;         // only coins younger than this are buyable
const MIN_MCAP_USD = 12000;     // skip dust (pro zone: momentum sweet spot)
const MAX_MCAP_USD = 120000;    // skip near-graduation froth / migrated froth
const MAX_SIGNALS_CHECKED = 3;  // pro-check at most this many signals deep
const GROW_TARGET_USD = 10;     // grow to $10...
const STAKE_USD = 3;            // ...then stake $3 of profit at higher stakes
const DUST_SOL = 0.001;         // always leave this much SOL untraded

// pro thresholds (research/meme-trading-research.md)
const DEV_HOLD_MAX = 0.05;      // dev holding >= 5% of supply = disqualify
const TOP10_MAX = 0.30;         // top-10 (non-curve) concentration >= 30% = disqualify
const TP1 = 1.8;                // +80%: sell 50%
const TP2 = 2.6;                // +160%: sell half of the rest (75% total)
const TRAIL = 0.75;             // moonbag exits 25% below peak
const SL = 0.65;                // -35% hard stop (pre-TP1)

const RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
  "https://api.mainnet-beta.solana.com",
];

async function rpc(method: string, params: any[]): Promise<any> {
  for (const url of RPCS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data: any = await resp.json();
      if (data?.result !== undefined) return data.result;
    } catch (_) { /* next rpc */ }
  }
  return null;
}

async function api(method: string, path: string) {
  const resp = await fetch(API + path, {
    method,
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
  });
  const text = await resp.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) {}
  return { status: resp.status, json };
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

async function balance(addr: string): Promise<{ sol: number; rpc: string }> {
  for (const rpc of RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }),
      });
      const data: any = await resp.json();
      const v = data?.result?.value;
      if (typeof v === "number" && v >= 0) return { sol: v / 1e9, rpc };
    } catch (_) { /* next rpc */ }
  }
  return { sol: -1, rpc: "none" };
}

// ---- professional entry checks ----

async function devHoldingPct(creator: string, mint: string, totalSupplyRaw: number): Promise<number> {
  const res = await rpc("getTokenAccountsByOwner", [creator, { mint }, { encoding: "jsonParsed" }]);
  if (!res?.value) return -1;
  let sum = 0;
  for (const acc of res.value) {
    const info = acc?.account?.data?.parsed?.info;
    const amt = Number(info?.tokenAmount?.amount || 0);
    sum += amt;
  }
  return totalSupplyRaw > 0 ? sum / totalSupplyRaw : -1;
}

async function top10Concentration(mint: string, totalSupplyRaw: number): Promise<number> {
  const res = await rpc("getTokenLargestAccounts", [mint]);
  if (!res?.value) return -1;
  const accts = res.value.map((a: any) => Number(a.amount || 0));
  // exclude bonding-curve-scale accounts (they hold most supply pre-graduation)
  const curve = accts.filter((a: number) => a > totalSupplyRaw * 0.4);
  const circulating = totalSupplyRaw - curve.reduce((x: number, y: number) => x + y, 0);
  if (circulating <= 0) return -1;
  const top = accts.filter((a: number) => a <= totalSupplyRaw * 0.4).slice(0, 10);
  return top.reduce((x: number, y: number) => x + y, 0) / circulating;
}

async function rugcheckDanger(mint: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const resp = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!resp.ok) return "unknown";
    const d: any = await resp.json();
    const level = d?.score_level || d?.score?.level || "unknown";
    return level;
  } catch (_) { return "unknown"; }
}

function socialOk(c: any): boolean {
  return !!(c.twitter || c.telegram || c.website);
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    // ---- kill switch ----
    const ctlRaw: any = await base44.asServiceRole.entities.Controls.list({} as any);
    const ctl = (Array.isArray(ctlRaw) ? ctlRaw : (ctlRaw?.data || []))[0];
    if (ctl && (ctl.automation_enabled === false || ctl.flip_enabled === false)) {
      return new Response(JSON.stringify({ action: "paused", reason: "flip paused via off switch" }), { headers: { "Content-Type": "application/json" } });
    }

    const cfgRaw: any = await base44.asServiceRole.entities.GrowthConfig.list({} as any);
    const cfg = (Array.isArray(cfgRaw) ? cfgRaw : (cfgRaw?.data || [])).find((c: any) => c.active === true);

    const stRaw: any = await base44.asServiceRole.entities.FlipState.list({} as any);
    const st = (Array.isArray(stRaw) ? stRaw : (stRaw?.data || []))[0];

    let prev = new Map<string, number>();
    let holding: any = null;
    let mode = "grow";
    let banked = 0;
    if (st) {
      try {
        for (const s of JSON.parse(st.snapshot_json || "[]")) {
          // v2 format: "2|mint|usd" (v1 quote-unit entries are ignored, baseline rebuilds)
          const parts = String(s).split("|");
          if (parts.length === 3 && parts[0] === "2") prev.set(parts[1], Number(parts[2]) || 0);
        }
      } catch (_) {}
      try { holding = JSON.parse(st.holding_json || "null"); } catch (_) {}
      mode = st.mode || "grow";
      banked = st.banked_sol || 0;
    }

    // fresh snapshot of newest 200 coins
    const cur: any[] = [];
    const seen = new Set<string>();
    for (let off = 0; off < 200; off += 50) {
      const r = await api("GET", `/coins?offset=${off}&limit=50&sort=created_timestamp&order=DESC`);
      if (r.status === 200 && Array.isArray(r.json)) {
        for (const c of r.json) {
          if (c.mint && !seen.has(c.mint)) {
            seen.add(c.mint);
            cur.push({
              mint: c.mint, symbol: c.symbol, creator: c.creator,
              usd: c.usd_market_cap || c.market_cap_usd || 0,
              created: c.created_timestamp || 0,
              total_supply: Number(c.total_supply || 0),
              real_sol_reserves: Number(c.real_sol_reserves || 0),
              complete: c.complete === true,
              twitter: c.twitter || "", telegram: c.telegram || "", website: c.website || "",
            });
          }
        }
      }
      await sleep(700);
    }

    const result: any = {
      action: "none",
      signals: [],
      holding: null,
      balance_sol: -1,
      reason: "",
      coins_snapshot: cur.length,
    };

    const balRes = await balance(cfg.wallet_address);
    const bal = balRes.sol;
    result.balance_sol = bal;
    result.rpc_used = balRes.rpc;
    const price = await solPrice();
    result.sol_price = price;
    result.usd_value = Math.round(bal * price * 100) / 100;
    result.mode = mode;
    result.banked_sol = banked;

    // profit-tier transitions
    if (mode === "grow" && result.usd_value >= GROW_TARGET_USD) {
      mode = "stake";
      banked = Math.max(0, bal - STAKE_USD / price);
      result.mode_switch = `reached $${result.usd_value} - banking ${banked.toFixed(4)} SOL, staking $${STAKE_USD}`;
    }
    if (mode === "stake" && bal <= banked + 0.0005) {
      mode = "stopped";
      result.mode_switch = `stake died - stopped trading, keeping ${banked.toFixed(4)} SOL (~$${(banked * price).toFixed(2)}) banked`;
    }
    result.mode = mode;
    result.banked_sol = banked;

    const now = Date.now();
    const prevMap = prev;

    // raw momentum signals (usd mcap growth vs last snapshot)
    for (const c of cur) {
      const p = prevMap.get(c.mint);
      if (!p || !p || !c.usd || c.usd < MIN_MCAP_USD || c.usd > MAX_MCAP_USD) continue;
      const ageMin = (now - c.created) / 60000;
      if (ageMin > MAX_AGE_MIN) continue;
      const growth = c.usd / p;
      if (growth >= GROWTH_SIGNAL) {
        result.signals.push({ mint: c.mint, symbol: c.symbol, usd_mcap: Math.round(c.usd), growth: Math.round(growth * 100) / 100, age_min: Math.round(ageMin) });
      }
    }
    result.signals.sort((a: any, b: any) => b.growth - a.growth);

    // ---- position management (partial-exit ladder) ----
    if (holding && holding.status === "holding") {
      const hc = cur.find((c: any) => c.mint === holding.mint);
      const peak = Math.max(holding.peak_mcap || 0, hc?.usd || 0);
      holding.peak_mcap = peak;
      if (hc && hc.usd) {
        const entry = holding.entry_mcap || hc.usd;
        const ratio = hc.usd / entry;
        const curUsd = Math.round(hc.usd);
        const sold = holding.fraction_sold || 0;
        result.holding = { ...holding, current_usd_mcap: curUsd, profit_ratio: Math.round(ratio * 100) / 100 };

        if (sold >= 0.75) {
          // moonbag: trail 25% below peak
          if (peak > 0 && hc.usd <= peak * TRAIL) { result.action = "sell"; result.reason = `moonbag trailing stop: $${curUsd} vs peak $${Math.round(peak)}`; }
        } else if (sold >= 0.5) {
          if (ratio >= TP2) { result.action = "sell_partial"; result.sell_fraction = 0.5; result.reason = `TP2 x${ratio.toFixed(2)}: sell half of the rest (75% total out)`; }
          else if (peak > 0 && hc.usd <= peak * TRAIL) { result.action = "sell"; result.reason = `trailing stop: $${curUsd} vs peak $${Math.round(peak)}`; }
        } else {
          if (ratio >= TP1) { result.action = "sell_partial"; result.sell_fraction = 0.5; result.reason = `TP1 x${ratio.toFixed(2)}: sell half, recover the cost basis`; }
          else if (ratio <= SL) { result.action = "sell"; result.reason = `hard stop loss: x${ratio.toFixed(2)} (-${Math.round((1 - ratio) * 100)}%)`; }
        }
      } else {
        result.holding = holding;
        result.action = "manage";
        result.reason = "held coin not in newest 200 - check price in browser";
      }
    } else if (mode === "stopped") {
      result.reason = "stopped after stake loss - bank is safe, no more trades";
    } else if (result.signals.length && bal >= MIN_FUEL_SOL) {
      // ---- professional entry checks on top signals ----
      const checked: any[] = [];
      let picked: any = null;
      for (const s of result.signals.slice(0, MAX_SIGNALS_CHECKED)) {
        const c = cur.find((x: any) => x.mint === s.mint);
        if (!c) continue;
        const checks: any = { symbol: c.symbol, mint: c.mint };

        // 1. social metadata present
        checks.social = socialOk(c);
        // 2. dev holding < 5% of supply
        checks.dev_hold_pct = Math.round((await devHoldingPct(c.creator, c.mint, c.total_supply)) * 1000) / 10;
        checks.dev_ok = checks.dev_hold_pct >= 0 && checks.dev_hold_pct < DEV_HOLD_MAX * 100;
        // 3. top-10 holder concentration < 30% of circulating
        checks.top10_pct = Math.round((await top10Concentration(c.mint, c.total_supply)) * 1000) / 10;
        checks.top10_ok = checks.top10_pct >= 0 && checks.top10_pct < TOP10_MAX * 100;
        // 4. rugcheck not flagged dangerous
        checks.rugcheck = await rugcheckDanger(c.mint);
        checks.rug_ok = checks.rugcheck !== "danger";
        // 5. bonding curve progress (informational zone check)
        checks.curve_pct = Math.round((c.real_sol_reserves / 85) * 1000) / 10;

        checks.pass = checks.social && checks.dev_ok && checks.top10_ok && checks.rug_ok;
        checked.push(checks);
        await sleep(400);
        if (checks.pass) { picked = { signal: s, checks }; break; }
      }
      result.entry_checks = checked;

      if (picked) {
        const buyAmount = mode === "stake" ? Math.max(0, bal - banked - DUST_SOL) : Math.max(0, bal - DUST_SOL);
        if (buyAmount < 0.003) {
          result.reason = `signal passed pro checks but buyable amount too small (${buyAmount.toFixed(4)} SOL)`;
        } else {
          result.action = "buy";
          result.buy_amount_sol = Math.round(buyAmount * 1e6) / 1e6;
          result.buy_mint = picked.signal.mint;
          result.buy_symbol = picked.signal.symbol;
          result.reason = `${mode} mode: ${picked.signal.symbol} x${picked.signal.growth} in ${picked.signal.age_min}min, $${picked.signal.usd_mcap} mcap, dev ${picked.checks.dev_hold_pct}%, top10 ${picked.checks.top10_pct}%, rugcheck ${picked.checks.rugcheck} - buying ${result.buy_amount_sol} SOL`;
        }
      } else {
        result.reason = `${result.signals.length} momentum signal(s) but none passed pro entry checks` + (checked.length ? `: ${checked.map((k: any) => `${k.symbol}(social=${k.social},dev=${k.dev_hold_pct}%,top10=${k.top10_pct}%,rug=${k.rugcheck})`).join("; ")}` : "");
      }
    } else if (result.signals.length && bal < MIN_FUEL_SOL) {
      result.reason = `signal found but balance too low (${bal} SOL) - owner needs to deposit`;
      result.action = "low_fuel_signal";
    } else if (!result.signals.length) {
      result.reason = `no momentum signal: nothing doubled since last scan (${cur.length} coins tracked)`;
    }

    // persist snapshot (v2 usd format, young coins only)
    const snapList = cur
      .filter((c: any) => c.usd >= 3000 && now - c.created < 120 * 60000)
      .slice(0, 150)
      .map((c: any) => `2|${c.mint}|${c.usd}`);
    const snapJson = JSON.stringify(snapList);
    const holdingJson = holding ? JSON.stringify(holding) : "null";
    if (st) {
      await base44.asServiceRole.entities.FlipState.update(st.id, { snapshot_json: snapJson, last_run: new Date().toISOString(), mode, banked_sol: banked, holding_json: holdingJson });
    } else {
      await base44.asServiceRole.entities.FlipState.create({ snapshot_json: snapJson, last_run: new Date().toISOString(), holding_json: holdingJson, mode, banked_sol: banked, notes: "pump flip watcher state v3" });
    }

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ action: "error", error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
