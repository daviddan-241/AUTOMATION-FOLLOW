#!/usr/bin/env python3
"""pump.fun growth cycle - follows devs of new coins and likes their callouts.

Auth: the pump.fun `auth_token` cookie (see docs/auth-flow.md). Config: config.json
(copy config.example.json). All engagement is REAL: real follows, real likes, paced
to look human. Filters: devs with under `follower_limit` followers, real activity
(at least `min_real_activity` callouts with text), non-default profile.

Wallet-type note: pump.fun's API does not expose wallet type (Pump-embedded vs
external like Phantom) for third parties. Proxies used (see is_probable_pump_native):
fresh on-chain footprint + social-layer activity. If a verified discriminator is
found, update docs/pumpfun-api.md and this function.
"""
import json, random, sys, time, urllib.request

API = "https://frontend-api-v3.pump.fun"
CFG = json.load(open("config.json"))


def req(method, path, body=None, auth=True):
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
               "Origin": "https://pump.fun", "Referer": "https://pump.fun/"}
    if auth:
        headers["Cookie"] = f"auth_token={CFG['auth_token']}; pump_device_id={CFG['pump_device_id']}"
    if body is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def sleep_paced():
    lo, hi = CFG["request_delay_seconds"]
    time.sleep(random.uniform(lo, hi))


def main():
    log = {"cycle_time": int(time.time()), "coins_scanned": 0, "devs_followed": [],
           "likes_made": 0, "errors": [], "session_ok": True}

    status, me = req("GET", "/auth/my-profile")
    if status != 200:
        log["session_ok"] = False
        log["errors"].append(f"auth check failed: {status}")
        print(json.dumps(log)); sys.exit(2)
    my_uid = me["userId"]

    _, following = req("GET", f"/following/v3/following/{my_uid}")
    already = {f.get("userId") or f.get("user_uuid") or f.get("id")
               for f in (following if isinstance(following, list) else following.get("following", []))}

    _, coins = req("GET", "/coins?offset=0&limit=%d&sort=created_timestamp&order=DESC"
                   % CFG["max_coins_scanned"], auth=False)
    log["coins_scanned"] = len(coins)

    seen = set()
    for c in coins:
        if len(log["devs_followed"]) >= CFG["max_follows_per_cycle"] or \
           log["likes_made"] >= CFG["max_likes_per_cycle"]:
            break
        creator = c.get("creator")
        if not creator or creator in seen:
            continue
        seen.add(creator)

        _, prof = req("GET", f"/users/{creator}", auth=False)
        uid = prof.get("userId")
        if not uid or uid in already or prof.get("is_banned"):
            continue
        if prof.get("followers", 0) >= CFG["follower_limit"]:
            continue
        username = prof.get("username") or ""
        if not username or username.startswith("user-"):  # never completed profile
            continue

        _, cl = req("GET", f"/callout/list/{uid}")
        callouts = cl.get("callouts", [])
        real = [k for k in callouts if (k.get("thesis") or "").strip()]
        if len(real) < CFG["min_real_activity"]:
            continue  # no real activity -> not a real dev
        if not is_probable_pump_native(creator, prof):
            continue  # outside/external wallet heuristics

        st, _ = req("POST", f"/following/v2/{uid}", body={})
        if st == 429:
            time.sleep(CFG["backoff_on_429_seconds"]); continue
        if st == 401:
            log["session_ok"] = False
            log["errors"].append("session expired mid-cycle"); break
        if st in (200, 201):
            log["devs_followed"].append({"username": username, "userId": uid,
                                          "followers": prof.get("followers")})
            already.add(uid)
            sleep_paced()
        else:
            log["errors"].append(f"follow {username}: {st}")

        for k in real[:3]:
            if log["likes_made"] >= CFG["max_likes_per_cycle"]:
                break
            if k.get("hasLiked"):
                continue
            st, _ = req("POST", f"/callout/{k['calloutId']}/like", body={})
            if st == 429:
                time.sleep(CFG["backoff_on_429_seconds"]); continue
            if st == 401:
                log["session_ok"] = False; break
            if st in (200, 201):
                log["likes_made"] += 1
            else:
                log["errors"].append(f"like {k['calloutId']}: {st}")
            sleep_paced()

    print(json.dumps(log))
    return 0 if log["session_ok"] else 2


def is_probable_pump_native(address, prof):
    """Best-effort 'Pump-embedded wallet only' proxy. The API does not expose wallet
    type for other users. pump-native email users are usually very new on-chain with
    social activity; long-standing external traders have deep on-chain history.
    Returns True when the wallet's on-chain history starts within ~90 days."""
    try:
        r = urllib.request.Request(
            "https://api.mainnet-beta.solana.com",
            data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": "getSignaturesForAddress",
                             "params": [address, {"limit": 1000}]}).encode(),
            headers={"Content-Type": "application/json"})
        sigs = json.loads(urllib.request.urlopen(r, timeout=15).read()).get("result") or []
        if not sigs:
            return True  # never touched chain directly = typical fresh embedded wallet
        oldest = sigs[-1].get("blockTime") or 0
        return (time.time() - oldest) < 90 * 86400
    except Exception:
        return True  # don't drop candidates on RPC errors


if __name__ == "__main__":
    sys.exit(main())
