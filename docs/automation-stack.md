# Deployed automation stack (Base44)

Everything below is LIVE and verified (2026-09-30).

## What runs on its own
- **Backend function `pumpGrowthCycle`** (see `backend/pumpGrowthCycle.ts`): reads the active
  GrowthConfig entity, verifies the session via /auth/my-profile, detects new follow-backs
  (compares /following/followers/{user_id} against known_followers), scans Explore->New,
  filters devs (followers under limit, real username, not banned, fresh pump-native wallet,
  real callout activity), follows and likes with 2-3.5s pacing and 429 backoffs, and writes
  a CycleLog record each run.
- **Workflow `pump-growth-cycle`** (cron `0 */2 * * *`, America/New_York): calls the function
  every 2 hours. Only if there are new follow-backs OR the session died does an agent step
  wake and WhatsApp-notify the owner. Quiet runs cost just the function call.
- **Self-healing**: when the auth_token cookie expires (~monthly), the cycle logs
  session_ok=false, the workflow's agent step tells the owner on WhatsApp, and the re-login
  flow in docs/auth-flow.md mints a fresh cookie (update the GrowthConfig record).

## Entities
- **GrowthConfig** (one active record): email, pump_username, user_id, wallet_address,
  auth_token (session cookie), pump_device_id, max_follows_per_cycle, max_likes_per_cycle,
  follower_limit, known_followers, active, notes.
- **CycleLog** (one per run): cycle_time, coins_scanned, devs_followed[], likes_made,
  new_follow_backs[], errors[], session_ok.

## Email-switch runbook (exact steps)
1. Get the new email from the owner in chat (never stored in this repo).
2. Run the browser login flow (docs/auth-flow.md) with that email; extract the new
   auth_token + pump_device_id cookies via CDP.
3. Update the active GrowthConfig record: email, auth_token, pump_device_id, user_id,
   wallet_address, pump_username (and reset known_followers to [] so follow-back alerts
   re-baseline). Everything else (workflows, function, CycleLog) needs no changes.

## Rate-limit lessons (verified the hard way)
- /callout/list/{id} 429-storms if hit back-to-back; pace 2.5-3.5s between calls, and after
  a storm it stays blocked ~30+ min.
- /users/batch returns HTTP 201 on success (not 200).
- /following/v3/following/{uid} returns ~20 items by default; pass ?limit=100.

## First live batch (all real, verified via read APIs)
- 67 real follows (every dev under 30 followers, fresh pump-native wallets), 12+ callout
  likes, first follow-back: Rodjioso (detected by the cycle function within minutes).
