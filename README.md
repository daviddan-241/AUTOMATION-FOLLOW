# AUTOMATION-FOLLOW — pump.fun growth automation (agent handoff)

This repo contains everything needed for a Superagent (or any agent with browser + bash + email
access) to run and maintain the pump.fun growth automation.

**What the automation does:** logged into pump.fun with an owner-provided email, it repeatedly
discovers brand-new coins, follows their devs (only REAL accounts with under 30 followers and
Pump-embedded wallets — no Phantom/external wallets), and likes the devs' callouts so they notice
the account and follow back. All engagement is real — no fake accounts, no dry runs.

## How a new agent should operate this

1. **Request the email in chat.** Ask the owner: "Which email is logged into pump.fun?" The owner
   gives the email in the conversation. Never store it in this repo.
2. **Get a valid `auth_token` cookie** for that email (see `docs/auth-flow.md`). The fastest path:
   open https://pump.fun in the browser, sign in with the email (Privy sends a 6-digit code to the
   owner's Gmail — fetch it via the Gmail API and enter it), then extract the `auth_token`
   httpOnly cookie via CDP (`Network.getCookies`). It lasts ~14 days.
3. **Run a cycle:** `python3 scripts/pump_cycle.py` with config (see `config.example.json`).
   The cycle: fetch new coins → look up each dev → filter → follow → like their callouts.
4. **Keep it alive on a schedule** (Base44: scheduled workflow calling a deployed backend function
   that runs the cycle; a daily health workflow re-logins when the cookie dies).
5. **Verify with read APIs** that follows and likes actually landed. Never report success without
   API proof.

## Repo layout

- `docs/pumpfun-api.md` — verified API recipe: every endpoint, header, payload, and the traps.
- `docs/auth-flow.md` — the login / self-heal flow and cookie model.
- `scripts/pump_cycle.py` — the engagement cycle (cookie-auth, config-driven).
- `config.example.json` — copy to `config.json`, fill in per owner instructions.

## Filters (owner's rules — do not relax without asking)

- Devs of coins from Explore → New (newest first).
- Follower count under 30.
- Pump-embedded wallet only (email-created "Pump wallet"); skip Phantom/Solflare/external wallets.
- Real accounts only: must have actual activity (callouts/posts), skip bot-looking accounts.
- Never follow the same dev twice (check the following list first).
- Pacing: max ~15 follows and ~40 likes per cycle, 2-5s between actions, back off 60s on 429.

## Status (as of 2026-09-30)

- API fully mapped and verified live. Account logged in, bio updated (real).
- First live cycle + scheduled deployment being finished in the Base44 goal `pump-growth`.
- Update this section when things change.
