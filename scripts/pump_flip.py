#!/usr/bin/env python3
"""pump_flip - $1 -> $20 attempt: momentum scanner + strategy for pump.fun coins.

HONEST LIMITS (read this first):
- pump.fun memecoins are extreme risk. Most go to zero. A 20x is a lottery ticket,
  not a plan. Only ever risk what you are happy to lose ($1 qualifies).
- This bot is a SCANNER + STRATEGY ENGINE. It cannot itself place trades:
  pump.fun embedded-wallet trades must be signed in the browser (Privy signs
  in-browser; there is no headless signing path). When it finds a signal it
  prints the coin + reason; the trade is then executed in the pump.fun UI
  (by the owner, or by the agent driving the browser session).

STRATEGY (momentum snipe with hard risk rules):
1. Poll Explore->New every 60s, two passes per coin to measure market-cap velocity.
2. SIGNAL when a coin <10 min old shows fast mcap growth (>1.5x in ~2 min) with
   momentum still rising - early buyers stacking, not a dead launch.
3. Risk rules if traded: put in ~$0.90 (keep $0.10 as dust floor), take profit
   at +80% (sell 60%), move stop to entry, take the rest at +200% or momentum
   fade; hard stop-loss at -35% (on a $1 position that is -35 cents, the pain
   is capped); never buy a coin whose dev is banned or already rugged.
"""
import json, time, urllib.request, sys

API = "https://frontend-api-v3.pump.fun"
MIN_AGE_S, MAX_AGE_S = 30, 600
GROWTH_SIGNAL = 1.5          # mcap growth between passes
POLL_S = 60
BASELINE_USD = 1.0

def get(path):
    r = urllib.request.Request(API + path, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(r, timeout=20) as resp:
        return json.loads(resp.read().decode())

def scan():
    coins = get("/coins?offset=0&limit=50&sort=created_timestamp&order=DESC")
    now_ms = time.time() * 1000
    return {c["mint"]: c for c in coins
            if MAX_AGE_S * 1000 > now_ms - (c.get("created_timestamp") or 0) > MIN_AGE_S * 1000}

def run():
    seen = {}
    print(f"[flip] watching new coins (baseline ${BASELINE_USD:.2f}, signal: mcap x{GROWTH_SIGNAL} in ~{POLL_S}s)")
    while True:
        try:
            cur = scan()
            for mint, c in cur.items():
                mcap = c.get("market_cap") or 0
                prev = seen.get(mint)
                if prev and mcap and prev["mcap"] and mcap / prev["mcap"] >= GROWTH_SIGNAL and mcap > prev["mcap"]:
                    growth = mcap / prev["mcap"]
                    print(f"[SIGNAL] {c.get('symbol')} ({mint[:8]}...) mcap ${mcap:,.0f} x{growth:.2f} in {POLL_S}s - dev {c.get('username')} - {c.get('name')}")
                    print("         -> if trading: ~$0.90 in, TP +80% (sell 60%), stop -35%")
                seen[mint] = {"mcap": mcap, "t": time.time(), "symbol": c.get("symbol")}
            # forget stale entries
            seen = {k: v for k, v in seen.items() if time.time() - v["t"] < 900}
        except Exception as e:
            print(f"[err] {e}")
        time.sleep(POLL_S)

if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
