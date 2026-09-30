// pumpFlipWatch - watches pump.fun new-coin momentum for the $1 flip attempt.
// Snapshots newest coins, detects fast movers vs the last snapshot, tracks the
// holding, and tells the workflow when to BUY, SELL, or check the price.
// Trades themselves are executed by the superagent in the browser (embedded
// wallet signing) - this function never trades.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

const API = "https://frontend-api-v3.pump.fun";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MIN_FUEL_SOL = 0.004;   // need at least this to attempt a buy
const GROWTH_SIGNAL = 2.0;    // mcap x2.0 since last snapshot (~30 min)
const MAX_AGE_MIN = 60;       // only coins younger than this are buyable
const MIN_MCAP = 8000;         // skip dust coins
const TP_RATIO = 1.8;          // take profit at +80%
const SL_RATIO = 0.65;         // stop loss at -35%
// profit-tier plan (owner, 2026-09-30): grow to $10, then stake $3 of profit
// on higher-stakes trades; if the $3 stake dies, stop for good (keep the bank).
const GROW_TARGET_USD = 10;
const STAKE_USD = 3;
const DUST_SOL = 0.001;

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

const RPCS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-rpc.publicnode.com",
  "https://solana.drpc.org",
];

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
    } catch (_) { /* try next rpc */ }
  }
  return { sol: -1, rpc: "none" };
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  try {
    const cfgRaw: any = await base44.asServiceRole.entities.GrowthConfig.list({} as any);
    const cfgAll: any[] = Array.isArray(cfgRaw) ? cfgRaw : (cfgRaw?.data || []);
    const cfg = cfgAll.find((c: any) => c.active === true) || cfgAll[0];

    const stRaw: any = await base44.asServiceRole.entities.FlipState.list({} as any);
    const stAll: any[] = Array.isArray(stRaw) ? stRaw : (stRaw?.data || []);
    let st = stAll[0];

    let prev: any[] = [];
    let holding: any = null;
    let mode = "grow";
    let banked = 0;
    if (st) {
      try {
        const rawPrev = JSON.parse(st.snapshot_json || "[]");
        prev = rawPrev.map((s: string) => {
          const [mint, mc] = String(s).split("|");
          return { mint, mcap: Number(mc) || 0 };
        });
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
            cur.push({ mint: c.mint, symbol: c.symbol, mcap: c.market_cap || 0, created: c.created_timestamp || 0 });
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
    const prevMap = new Map(prev.map((p: any) => [p.mint, p]));

    // momentum signals
    for (const c of cur) {
      const p = prevMap.get(c.mint);
      if (!p || !p.mcap || !c.mcap || c.mcap < MIN_MCAP) continue;
      const ageMin = (now - c.created) / 60000;
      if (ageMin > MAX_AGE_MIN) continue;
      const growth = c.mcap / p.mcap;
      if (growth >= GROWTH_SIGNAL) {
        result.signals.push({ mint: c.mint, symbol: c.symbol, mcap: c.mcap, growth: Math.round(growth * 100) / 100, age_min: Math.round(ageMin) });
      }
    }
    result.signals.sort((a: any, b: any) => b.growth - a.growth);

    if (holding && holding.status === "holding") {
      // check held coin against current snapshot
      const hc = cur.find((c: any) => c.mint === holding.mint);
      if (hc && hc.mcap) {
        const ratio = hc.mcap / (holding.entry_mcap || hc.mcap);
        result.holding = { ...holding, current_mcap: hc.mcap, profit_ratio: Math.round(ratio * 100) / 100 };
        if (ratio >= TP_RATIO) { result.action = "sell"; result.reason = `take profit: x${ratio.toFixed(2)} vs entry`; }
        else if (ratio <= SL_RATIO) { result.action = "sell"; result.reason = `stop loss: x${ratio.toFixed(2)} vs entry`; }
      } else {
        result.holding = holding;
        result.action = "manage"; // price unknown - agent checks the coin page in browser
        result.reason = "held coin not in newest 200 - check price in browser";
      }
    } else if (mode === "stopped") {
      result.reason = "stopped after stake loss - bank is safe, no more trades";
    } else if (result.signals.length && bal >= MIN_FUEL_SOL) {
      const buyAmount = mode === "stake" ? Math.max(0, bal - banked - DUST_SOL) : Math.max(0, bal - DUST_SOL);
      if (buyAmount < 0.003) {
        result.reason = `signal found but buyable amount too small (${buyAmount.toFixed(4)} SOL)`;
      } else {
        result.action = "buy";
        result.buy_amount_sol = Math.round(buyAmount * 1e6) / 1e6;
        result.reason = `${mode} mode: top signal ${result.signals[0].symbol} x${result.signals[0].growth} in ${result.signals[0].age_min}min, buying ${result.buy_amount_sol} SOL of ${bal.toFixed(4)}`;
      }
    } else if (result.signals.length && bal < MIN_FUEL_SOL) {
      result.reason = `signal found but balance too low (${bal} SOL) - owner needs to deposit`;
      result.action = "low_fuel_signal";
    }

    // persist snapshot (compact: young, meaningful coins only, to fit the entity field)
    const snapList = cur
      .filter((c: any) => c.mcap >= 3000 && now - c.created < 120 * 60000)
      .slice(0, 150)
      .map((c: any) => `${c.mint}|${c.mcap}`);
    const snapJson = JSON.stringify(snapList);
    if (st) {
      await base44.asServiceRole.entities.FlipState.update(st.id, { snapshot_json: snapJson, last_run: new Date().toISOString(), mode, banked_sol: banked });
    } else {
      await base44.asServiceRole.entities.FlipState.create({ snapshot_json: snapJson, last_run: new Date().toISOString(), holding_json: "null", mode, banked_sol: banked, notes: "pump flip watcher state" });
    }

    return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ action: "error", error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
