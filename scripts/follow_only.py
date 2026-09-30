import json, random, time, urllib.request

CFG = json.load(open('/tmp/AUTOMATION-FOLLOW/config.json'))
API = "https://frontend-api-v3.pump.fun"
H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
     "Origin": "https://pump.fun", "Referer": "https://pump.fun/",
     "Cookie": f"auth_token={CFG['auth_token']}; pump_device_id={CFG['pump_device_id']}"}

def api(method, path, body=None):
    h = dict(H); data = None
    if body is not None:
        h["Content-Type"] = "application/json"; data = json.dumps(body).encode()
    r = urllib.request.Request(API + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=25) as resp:
            return resp.status, json.loads(resp.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode() or "{}")
        except Exception: return e.code, {}

def rpc_fresh(addr):
    try:
        r = urllib.request.Request("https://api.mainnet-beta.solana.com",
            data=json.dumps({"jsonrpc":"2.0","id":1,"method":"getSignaturesForAddress",
                             "params":[addr,{"limit":1000}]}).encode(),
            headers={"Content-Type":"application/json"})
        sigs = json.loads(urllib.request.urlopen(r, timeout=6).read()).get("result") or []
        if not sigs: return True
        return (time.time() - (sigs[-1].get("blockTime") or 0)) < 90*86400
    except Exception:
        return True

MAXF = 60
st, me = api("GET", "/auth/my-profile")
if st != 200: print("SESSION DEAD"); raise SystemExit
myid = me["userId"]
_, following = api("GET", f"/following/v3/following/{myid}")
already = {f.get("userId") for f in (following if isinstance(following, list) else [])}
print(f"[start] already following {len(already)}", flush=True)

creators, seen = [], set()
for off in range(0, 400, 50):
    st, c = api("GET", f"/coins?offset={off}&limit=50&sort=created_timestamp&order=DESC")
    if st == 200 and isinstance(c, list):
        for x in c:
            cr = x.get("creator")
            if cr and cr not in seen: seen.add(cr); creators.append(cr)
    time.sleep(0.4)
print(f"[scan] {len(creators)} unique creators", flush=True)

cands = []
for i in range(0, len(creators), 50):
    st, profs = api("POST", "/users/batch", {"addresses": creators[i:i+50]})
    if st in (200, 201):
        for p in profs:
            uid = p.get("userId"); u = p.get("username") or ""
            if not uid or uid in already or p.get("is_banned"): continue
            if not u or u.startswith("user-"): continue
            if p.get("followers", 0) >= 30: continue
            cands.append(p)
    time.sleep(0.5)
print(f"[cands] {len(cands)} candidates", flush=True)

random.shuffle(cands)
follows, errors = [], []
for p in cands:
    if len(follows) >= MAXF: break
    uid, uname, addr = p["userId"], p["username"], p["address"]
    if not rpc_fresh(addr): continue
    st, _ = api("POST", f"/following/v2/{uid}", {})
    if st == 429:
        time.sleep(60); st, _ = api("POST", f"/following/v2/{uid}", {})
    if st == 401: print("SESSION EXPIRED", flush=True); break
    if st not in (200, 201):
        errors.append(f"{uname}:{st}"); continue
    follows.append({"username": uname, "followers": p.get("followers")})
    print(f"[follow] {uname} ({p.get('followers')}f)", flush=True)
    time.sleep(random.uniform(3, 4.5))

print("[done] " + json.dumps({"follows": follows, "count": len(follows), "errors": errors}), flush=True)
