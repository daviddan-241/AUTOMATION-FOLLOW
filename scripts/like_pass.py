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

def pace(a=2.6, b=3.6): time.sleep(random.uniform(a, b))

st, me = api("GET", "/auth/my-profile")
if st != 200: print("SESSION DEAD"); raise SystemExit
myid = me["userId"]
_, following = api("GET", f"/following/v3/following/{myid}")
fol = following if isinstance(following, list) else []
print(f"[start] liking callouts of {len(fol)} followed devs", flush=True)

liked, skipped, errors = [], 0, []
for f in fol:
    uid = f.get("userId") or f.get("uuid")
    uname = f.get("username", "?")
    if not uid: continue
    pace()
    st, cl = api("GET", f"/callout/list/{uid}")
    if st == 429:
        print(f"[rate-limited] resting 45s", flush=True); time.sleep(45)
        st, cl = api("GET", f"/callout/list/{uid}")
    if st != 200:
        errors.append(f"{uname}:{st}"); continue
    targets = [k for k in (cl.get("callouts") or []) if not k.get("hasLiked")][:2]
    if not targets: skipped += 1; continue
    for k in targets:
        st, _ = api("POST", f"/callout/{k['calloutId']}/like", {})
        if st == 429: time.sleep(45); st, _ = api("POST", f"/callout/{k['calloutId']}/like", {})
        if st in (200, 201):
            liked.append(uname); print(f"[like] {uname}", flush=True)
        else:
            errors.append(f"like {uname}:{st}")
        pace()

print("[done] " + json.dumps({"likes": len(liked), "no_callouts": skipped, "errors": errors[:10]}), flush=True)
