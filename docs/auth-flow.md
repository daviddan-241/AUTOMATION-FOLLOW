# Login + self-heal flow (how to get / refresh the auth_token cookie)

The automation's write access lives in one httpOnly cookie: `auth_token` on domain `.pump.fun`,
~14-day expiry. Everything else (Privy tokens, browser sessions) is only a means to mint it.

## Fresh login (also the self-heal path)

1. Ask the owner in chat for the pump.fun login email (the owner calls this "request emails here").
2. In the agent's browser (Base44: Browserbase), open https://pump.fun, click "Continue" on the
   welcome screen, then "Sign in".
3. The Privy modal shows a form: enter the email, click continue. Privy emails a 6-digit code to
   the owner's Gmail from `no-reply@privy.io` (subject: "Your login code for pumpfun").
4. Fetch the code via the Gmail API (Gmail connector token, `users/me/messages?q=is:unread
   from:no-reply@privy.io`, read latest, regex `(?<![0-9])(\d{6})(?![0-9])`).
5. Type the code into the 6 boxes. Wait for the login to complete (balance modal / profile loads).
6. Via CDP (`Network.getCookies` for `https://pump.fun`), extract at minimum:
   - `auth_token` (the session JWT — THE credential)
   - `pump_device_id` (device id, ~2y expiry, regenerable)
   Store them securely in the agent platform (secrets / encrypted storage), never in this repo.
7. Sanity check: `GET /auth/my-profile` with `Cookie: auth_token=...` must return the profile.

## What expires when

| Credential | Life | Notes |
|---|---|---|
| `auth_token` cookie | ~14 days | what write endpoints actually check |
| Privy access token | ~1h | only needed during browser login |
| Privy id token | ~15 min | idempotence/UX only |
| Email-code login refresh token | none | response says "deprecated" |
| Browserbase context | session-scoped | re-login needed if it expires |

## Self-healing design

- The cycle function uses the stored `auth_token`; on 401 it reports `session_ok: false` in its
  cycle log instead of crashing.
- A daily health workflow reads the last cycle log; when `session_ok` is false (or the log is
  stale), the agent runs the fresh-login flow above and updates the stored cookie.
- Expect a re-login roughly every two weeks per account. Each re-login consumes one agent turn
  plus a couple of Gmail API reads — the cycle itself runs as a backend function without agent
  turns.

## Email switching

The whole stack keys off the config's `email` field plus the stored cookie for that email:
1. Get the new email from the owner in chat.
2. Run the fresh-login flow with that email (it creates/opens that email's Pump account).
3. Store the new `auth_token` under the new email's config entry.
The cycle, filters and history all follow the config entry, so multiple emails can rotate.

## Anti-abuse rules (owner's "make it all real")

- Only real actions on the real account. No fake likes, no fake follows, no bought engagement.
- Respect the pacing caps (~15 follows / ~40 likes per cycle) so the account looks human.
- Filter rules live in the repo README — do not relax them without the owner's say-so.
