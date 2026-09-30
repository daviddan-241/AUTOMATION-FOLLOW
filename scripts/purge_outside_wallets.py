import json, time, urllib.request

AUTH = [c['value'] for c in json.load(open('/tmp/pump_cookies.json')) if c['name']=='auth_token'][0]
API = "https://frontend-api-v3.pump.fun"
H = {"User-Agent": "Mozilla/5.0", "Accept": "application/json",
     "Origin": "https://pump.fun", "Referer": "https://pump.fun/", "Cookie": f"auth_token={AUTH}"}

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

myid = "bf789f49-2103-45ff-a70d-24f25513ba15"
_, following = api("GET", f"/following/v3/following/{myid}?limit=100")
fol = following if isinstance(following, list) else []
unfollowed = []
for f in fol:
    uid = f.get("userId")
    if not uid: continue
    st, d = api("GET", f"/users/{uid}")
    if st != 200: time.sleep(1.5); continue
    if d.get("is_pump_user") is False:
        st2, _ = api("DELETE", f"/following/{uid}")
        print(f"[UNFOLLOW] {d['username']} -> {st2}", flush=True)
        unfollowed.append(d["username"])
        time.sleep(2.5)
    time.sleep(0.5)
_, me = api("GET", "/auth/my-profile")
print(f"[done] unfollowed {len(unfollowed)} more; following now {me.get('following')}", flush=True)
