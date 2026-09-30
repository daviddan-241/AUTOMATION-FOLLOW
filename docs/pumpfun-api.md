# pump.fun internal API — verified recipe

Everything here was verified with live HTTP calls on 2026-09-30. Base API:
`https://frontend-api-v3.pump.fun` (public, no Cloudflare issues with plain curl + a normal
User-Agent).

## Authentication model (the most important thing)

- **Reads** (coins, profiles, follower counts): public, no auth.
- **Writes** (bio, follow, like, profile updates): authenticated by the **`auth_token` httpOnly
  cookie**, a pump.fun-signed HS256 JWT with ~14-day expiry. No `Authorization` header is used by
  the website at all. Sending `Authorization: Bearer <privy token>` to write endpoints returns 401.
- Send `Cookie: auth_token=<jwt>; pump_device_id=device-<uuid>` plus a normal browser User-Agent,
  `Origin: https://pump.fun`, `Referer: https://pump.fun/`.
- Re-minting the cookie requires the wallet-signature login (`POST /auth/login/token`) or a fresh
  browser login — see `docs/auth-flow.md`.

## Traps (verified the hard way)

- `GET /users/me` is NOT an auth check: it is a public lookup of the user literally named "me".
  A 200 from it proves nothing. To identify the logged-in account, use the profile address or
  `GET /auth/my-profile` with the auth_token cookie.
- The Privy access token (from `POST /auth.privy.io/api/v1/passwordless/authenticate`) works for
  Privy API calls only. pump.fun write endpoints reject it (401).
- `POST /users/register` does not accept a `privy-token` cookie from curl — 401. The cookie is
  minted inside the browser login flow.

## Privy email auth (for the login flow)

- Privy app id used by pump.fun: `cm1p2gzot03fzqty5xzgjgthq`
- `POST https://auth.privy.io/api/v1/passwordless/init` — headers: `privy-app-id`,
  `privy-client: react-auth:2.9.0`, `Content-Type: application/json`, `Origin: https://pump.fun`;
  body `{"email": "<owner email>"}` → `{"success": true}`
- The 6-digit code arrives from `no-reply@privy.io`, subject "Your login code for pumpfun",
  in the owner's Gmail.
- `POST https://auth.privy.io/api/v1/passwordless/authenticate` — same headers, body
  `{"email": "...", "code": "123456"}` → `{token, identity_token, refresh_token: "deprecated", user}`
- `token` is the Privy access token (JWT, aud = the Privy app id, ~1h expiry). `identity_token`
  is the Privy id token (~15 min). Email-code login does NOT issue a usable refresh token.

## Endpoints

### New coins (Explore → New)
`GET /coins?offset=0&limit=50&sort=created_timestamp&order=DESC`
Public. Fields: `mint`, `creator` (Solana address), `username`, `name`, `symbol`,
`created_timestamp`, `market_cap`.

### Dev profile
`GET /users/{solana_address_or_user_id}` — public. Fields: `userId` (UUID), `username`, `bio`,
`followers`, `following`, `is_pump_user`, `address`, profile image, `canonical_svm_wallet`,
`canonical_evm_wallet` (present for Pump/Privy embedded-wallet accounts; null for external
wallets — verify against a few live profiles before trusting).

### Follower count
`GET /following/followers/count/{user_id}` — public. (The `followers` field on the profile is
usually equivalent; verify per case.)

### Update bio
`POST /users/bio` — body `{"bio": "..."}` (max 250), auth_token cookie. Verified working 2026-09-30.

### Update profile (username/bio/image)
`POST /users` — body `{username?, profileImage?, bio?}` (username max 15), auth_token cookie.

### Follow / unfollow
`POST /following/v2/{user_id}` — auth_token cookie. Unfollow: `DELETE /following/{user_id}`.

### Like / unlike a callout
`POST /callout/{callout_id}/like` — auth_token cookie. Reply likes: `POST /callout/replies/{reply_id}/like`.
Unlike: `DELETE /callout/{callout_id}/like`.

### List a dev's callouts
`GET /callout/list/{solana_address_or_user_id}` — auth_token cookie. Returns
`{callouts: [{calloutId, userId, coinMint, thesis, likes, hasLiked, createdAt, ...}], nextPageToken}`.
Verified live.

### List who you follow
`GET /following/v3/following/{my_user_id}` — auth_token cookie. Returns array (empty when you
follow nobody). Verified live.

### Batch profile lookup (efficient scanning)
`POST /users/batch` — body `{"addresses": ["<base58>", ...]}` (max 100), cookie not required.
Returns profile arrays with `userId`, `followers`, `bio`, etc.

### Wallet type (embedded vs external) — NOT exposed
There is no reliable API field distinguishing Pump-embedded (email) wallets from external
(Phantom/Solflare) wallets for third-party users: every profile has `canonical_evm_wallet` and
`canonical_svm_wallet` regardless of login method. `scripts/pump_cycle.py` uses an on-chain
freshness heuristic (`is_probable_pump_native`); replace it if a true discriminator is found.

### Session profile check
`GET /auth/my-profile` with the auth_token cookie returns the current session's profile. Use this
as the real auth check.

## Auth login endpoints (reference)

From pump.fun's own frontend bundle (route docs): `POST /auth/login` (superseded),
`POST /auth/login/token` (returns session JWT as bearer), `POST /auth/login/session` (sets the
auth_token cookie), `POST /auth/switch-wallet`, `POST /auth/logout`, `GET /auth/my-profile`.
Login body schema: `{signature (max 88), timestamp, address (max 44), transaction?,
authType?: "privy"|"non_custodial", deviceId?, evmAddress?, evmSignature?, solSignature?}` — the
signature must come from the account's wallet (Privy embedded wallet signs inside the browser;
there is no app-secret-free server path), which is why re-minting uses the browser login flow.
