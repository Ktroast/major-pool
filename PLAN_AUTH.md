# PLAN_AUTH.md — Anonymous Auth, Hub, and Lifetime Winnings

Migration plan for moving The Major Pool from localStorage-only state to anonymous-first Supabase Auth, building the multi-pool hub, and unlocking season-long winnings tracking. Each phase ships independently and preserves the current frictionless join-by-PIN UX.

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## Why

Today, pool state lives in localStorage (`lastPin`, `major_pool_commish_keys_v1`, `major_pool_last_name`). This breaks across devices, makes commissioner access fragile, and prevents any cross-pool features (lifetime standings, friend leagues, head-to-head). The fix is identity — but the current PIN-and-go UX is genuinely good, so we add identity *lazily*: every visitor gets an anonymous Supabase user on first load, plays pools exactly as today, and optionally "claims" their account with a magic-link email when they want cross-device sync or lifetime tracking.

End state:
- One home screen icon, opens to a hub showing all pools you've joined
- Pools and entries are linked to users (anonymous or claimed)
- Claimed users get cross-device sync and persistent commissioner access
- Leagues group pools across a season; lifetime winnings accumulate on a per-league leaderboard

---

## Product decisions (locked)

**League scoring = winnings accumulation.** Each pool has a buy-in (already in `pools.fee`). Each pool pays out a configured prize structure (already `prize1` / `prize2`). League leaderboard sums per-user winnings across all pools in the league. No points table, no cumulative to-par.

**Late joiners are fine by default.** Pools are independent. Players opt into each pool individually — bigger majors might have more entrants and bigger buy-ins, smaller weeks have fewer. The league leaderboard just reflects whoever played whichever pools.

**Shared-device handling: out of scope.** No user switcher in the UI. Document as a known limitation. The casual answer is "use your own phone."

---

## Open product decisions (defer until phase 5)

- [ ] League invite mechanism — invite code only, or also direct invite by email?
- [ ] What happens to a pool's winnings if it's not part of any league — orphaned, or visible on a "ungrouped" standings page?
- [ ] Can a single pool belong to multiple leagues? (Probably no — keep it simple.)
- [ ] Manual winnings adjustment by the league commissioner (for side bets, comps, corrections)?

---

## Pre-flight spike (before phase 1)

Verify Supabase's anonymous-auth and identity-linking behavior end-to-end before committing to the migration. A surprise here would invalidate the whole plan.

- [x] Confirm `supabase.auth.signInAnonymously()` works on the current Supabase project (may need to enable in dashboard)
- [x] Verify anonymous session persists in localStorage across page reloads
- [x] Test `supabase.auth.updateUser({ email })` on an anonymous user — confirm the confirmation flow upgrades the user in place (same `user.id`) rather than creating a new user. NOTE: `linkIdentity` is OAuth-only in Supabase JS v2; `updateUser({ email })` is the correct API for adding email to an anonymous user.
- [x] Test the edge case: anonymous user on device A, claims via email, then visits on device B (already has its own anonymous session) and signs in with the same email — confirm Supabase merges or at least lets us detect and reconcile
- [x] Document findings in this file under "Spike notes" before phase 1 starts

### Spike notes

**Spike run: May 11, 2026. Verdict: GO — migration plan stands.**

All three load-bearing scenarios confirmed working against the live Supabase project:

- **Scenario 1 (session persistence):** `supabase.auth.signInAnonymously()` creates a session that survives page reload. Same `user.id` after multiple reloads and tab close/reopen.

- **Scenario 2 (claim preserves user.id):** Anonymous → claimed upgrade via `supabase.auth.updateUser({ email })` preserves `user.id` through the full confirmation flow. Before claim: `is_anonymous: true`, `email: (none)`, `identities: []`. After clicking the confirmation email link: same `user.id`, `is_anonymous: false`, email populated, `email_confirmed_at` set, `identities: [email]`. This is the critical finding — the migration plan's assumption that user IDs are stable across claim is verified, so no user-record merging is needed when `user_pools` and `entries.user_id` reference the original anonymous ID.

- **Scenario 3 (cross-device sign-in):** `signInWithOtp({ email })` on a second device, using the same email used to claim on device 1, signs the user in to the same `user.id`. Cross-device pool history recovery works as designed.

**API correction:** PLAN_AUTH.md originally referenced `linkIdentity({ provider: 'email' })` for the claim step. That method is OAuth-only in Supabase JS v2 (Google, GitHub, etc.). The correct API for adding email to an anonymous user is `supabase.auth.updateUser({ email })`, which triggers Supabase's email confirmation flow. Phase 3 plan updated accordingly.

**Email delivery notes:**
- Supabase's confirmation emails sometimes land in junk/spam — flag this in the sign-in UI copy in phase 3.
- The confirmation email uses "Confirm Email Change" / "Change Email" copy, which is misleading for first-time claimers ("I'm not changing anything!") but functionally correct. Worth customizing the email template in the Supabase dashboard before phase 3 ships.
- iCloud/HEY mail wraps links through `www-mail.icloud-sandbox.com` which can interfere with the redirect chain. The link still works if you copy-paste the URL directly. Not a blocker, just a UX wrinkle some users will hit.

**Supabase dashboard config that's now locked in:**
- Authentication → Sign In / Providers → "Allow anonymous sign-ins" = ON
- Authentication → URL Configuration → Site URL = `https://putalittledrawonit.netlify.app`
- Authentication → URL Configuration → Redirect URLs include `https://spike-auth--putalittledrawonit.netlify.app/**` (spike, can remove after migration) and `http://localhost:8080/**` (local dev)
- "Allow manual linking" = OFF (not needed for `updateUser` flow; only required for OAuth identity linking)
- "Confirm email" = ON (kept on for production safety; means claim flow requires a confirmation click)

**Scenarios not tested (and why):**
- Scenario 4 (abandoned anonymous user unrecoverable) — already accepted as policy in PLAN_AUTH.md risk section. No need to verify; it's an inherent property of how Supabase handles anonymous-without-email sessions.
- Scenario 5 (auth state event observation) — saw `SIGNED_IN` and `existing-session` events fire in the log during scenarios 1–3. Sufficient for phase 1 to wire up `onAuthStateChange()` correctly.

---

## Phase 1: Anonymous auth foundation + hub

> Split into **1a** (invisible foundation, complete) and **1b** (visible hub, complete). All Phase 1 items shipped.

Goal: every visitor has a Supabase user (anonymous unless claimed); the home screen icon opens to a hub of their pools.

**Schema changes**

- [x] Create `user_pools` table:
  ```sql
  CREATE TABLE user_pools (
      user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
      pool_id      uuid        REFERENCES pools(id)       ON DELETE CASCADE,
      role         text        NOT NULL DEFAULT 'player',   -- 'player' | 'commissioner'
      joined_at    timestamptz DEFAULT now(),
      last_visited timestamptz DEFAULT now(),
      PRIMARY KEY (user_id, pool_id)
  );
  ```
- [x] Add RLS policy: a user can read/write their own `user_pools` rows only
- [x] Update `supabase/schema.sql` with the new table

**Client changes (`index.html`)**

- [x] On boot, before any pool loading, call `supabase.auth.signInAnonymously()` if no session exists
- [x] Store `currentUser` in app state; expose via a small helper (`getCurrentUserId()`)
- [x] When a pool is successfully loaded via `loadPool(pin)`, upsert a `user_pools` row with `last_visited = now()`
- [x] Build `renderHub()` — reads `user_pools` joined to `pools`, displays as a list sorted by `last_visited DESC`. Each row shows pool name, PIN, role badge (commissioner only), and last-visited timestamp. Entry count and standing deferred to phase 2.
- [x] New view: `view-hub` panel between landing and pool views
- [x] Hub empty state: show the existing landing controls (start new pool, enter PIN) — empty hub === current landing UX
- [x] "Add a pool" affordance on a non-empty hub (paste PIN input, same as landing's join form)

**Routing changes**

- [x] `/` → if user has 1+ pools in `user_pools`, show hub; if 0, show landing controls
- [x] Remove the `localStorage.lastPin` auto-redirect from `boot()` — the hub replaces it
- [x] `/pin/{pin}` → unchanged, loads that pool directly (and writes to `user_pools` on success)
- [x] `manifest.json` `start_url` → already `/`; no change needed

**Backward compat**

- [x] Migrate existing `localStorage.lastPin` and `localStorage.major_pool_commish_keys_v1` into the new model on first load:
  - For each pool ID in the commish keys map, fetch the pool, write a `user_pools` row with `role: 'commissioner'` for the current user
  - For `lastPin`, fetch the pool, write a `user_pools` row with `role: 'player'`
- [x] After migration, clear the legacy localStorage keys (commish keys cleared after all upserts succeed; `lastPin` intentionally NOT cleared — iOS PWA fallback)
- [x] Keep `getCommishKey()` / `setCommishKey()` working through phase 1 as a fallback (used by phase 4)

**Acceptance criteria**

- Fresh install: visitor lands on `/`, sees the landing controls (start/join). Joins a pool. Comes back to `/`, sees the hub with that pool.
- Existing user with `lastPin`: on first load post-deploy, the legacy pin is migrated into `user_pools`; subsequent visits to `/` show the hub.
- Pool URL `/pin/ABC123` still works for everyone, even users with no hub history.
- The home screen icon (capturing `/`) is now a stable entry point — no more re-bookmarking when a new pool starts.

---

## Phase 2: Entry → user linking

Goal: entries are linked to user accounts, so we can do cross-pool aggregation later.

**Schema changes**

- [ ] Add `user_id uuid REFERENCES auth.users(id)` column to `entries` (nullable for existing rows)
- [ ] Add RLS: an entry can be read by anyone with the pool's PIN (current behavior); can be written only by its `user_id` owner or the pool's commissioner
- [ ] Update `supabase/schema.sql`

**Client changes**

- [ ] `upsertEntry()` writes `user_id = getCurrentUserId()` on insert
- [ ] When loading a pool, surface "my entry" if any entry in the pool has `user_id === currentUserId`
- [ ] Edit/delete permissions: keep the current `getLastName()` name-matching logic as a fallback (for legacy entries), but prefer `user_id` matching when available

**Backfill UI: "Claim this entry"**

Existing entries have no `user_id`. Without backfill, they're orphaned from lifetime standings.

- [ ] On the Entries tab, for each entry with no `user_id`, show a "This is me" button next to entries matching `getLastName()`
- [ ] Clicking writes `entries.user_id = currentUserId` (after confirming via modal)
- [ ] Once claimed, the button disappears for everyone
- [ ] Commissioner can also reassign any entry to any user (for cleanup of misclaimed entries) — defer this to a small admin tool if it becomes a real problem

**Acceptance criteria**

- New entries created post-deploy are linked to the creating user
- Existing entries can be claimed by users via the Entries tab
- A user can find "their" entry across multiple pools by user_id lookup (sets up phase 5)

---

## Phase 3: Account claiming via magic link

Goal: users can upgrade their anonymous account to a real one with an email, unlocking cross-device sync.

**Client changes**

- [x] Add a "Sign in" link to the hub header (visible only to anonymous users)
- [x] Sign-in modal: email input → calls `supabase.auth.updateUser({ email })` on anonymous users (NOT `linkIdentity` — that's OAuth-only) or `signInWithOtp` on returning visitors. The `updateUser` path sends a confirmation email; clicking the link preserves `user.id` and flips `is_anonymous` to false.
- [x] Magic link redirects back to `/` and shows a "signed in as foo@bar.com" indicator
- [x] Empty-hub CTA: "Played before? Sign in to find your pools across devices." — shown when user is anonymous on landing
- [x] Cross-device flow: visiting `/` on a new device with no anonymous session → landing page → "Sign in" → magic link → hub populated from `user_pools` for the now-claimed user
- [x] Sign-out button in a small profile menu in the hub header

**Edge cases to handle**

- [x] User claims account on device A, then visits on device B (which has its own unclaimed anonymous session). Signing in with the same email: B's anonymous data is discarded, A's history is recovered. `updateUser` error triggers an OTP fallback offer in the modal.
- [x] User signs out and then signs back in anonymously — they get a fresh anonymous user, not their previous one. Document this; no recovery without claiming.

**Acceptance criteria**

- Anonymous user can claim their account with email + magic link in one round trip
- Same email signing in from a different device sees their full pool history
- Empty hub on a new device prominently offers the sign-in path
- Sign-out works without breaking the in-progress pool experience

---

## Phase 3.1: Orphan prevention

Goal: prevent anonymous-user entries from becoming permanently unrecoverable; add a post-submit nudge toward email claiming and a name-match claim path for existing entries.

**Context**

Phase 2 links new entries to `user_id`. But those IDs belong to anonymous users who may never claim an account — clearing browser data severs the link permanently. This phase adds two recovery paths: a timely prompt after entry submission (3.1a) and a retroactive name-match claim via a server-side RPC (3.1b).

**Schema changes**

- [ ] New `claim_entry(entry_id uuid)` function, `SECURITY DEFINER`, added to `supabase/schema.sql`. Runs as the service role so it can read `auth.users.is_anonymous` — RLS prevents clients from reading other users' rows directly.

**Client changes (3.1a — post-submit prompt)**

> Merged on branch `phase-3.1a-post-submit-prompt`. Acceptance testing passed May 13, 2026.

- [x] After a successful entry upsert, check `currentUser.is_anonymous`. If true, show a "Save your entry across devices" modal with an email input
- [x] Modal calls `sendSignInLink(email)` — extracted core shared with `handleSignIn`; same `updateUser`/OTP-fallback flow as phase 3's hub sign-in. Confirmation link preserves `user.id`, flips `is_anonymous` to false.
- [x] Dismiss closes the modal; no persistent suppression — re-prompts on every entry save while anonymous
- [x] Already-claimed users never see this modal; modal skipped if any modal is already open

**Client changes (3.1b — name-match claim)**

- [ ] In the Entries tab, for entries where `user_id` is null or belongs to an anonymous user, show a "This is me" button next to entries matching `getLastName()`
- [ ] Clicking opens a confirmation modal; on confirm, calls the `claim_entry` RPC
- [ ] Handle all three RPC outcomes:
  - `claimed` — update the entry row in local state; hide the button
  - `requires-signin` — show: "This pick belongs to [f***@bar.com]. Sign in as that account to claim it."
  - `error` — show a generic error message

**RPC behavior (`claim_entry`)**

- [ ] Entry's `user_id` is null → write `user_id = auth.uid()`, return `{ outcome: 'claimed' }`
- [ ] Entry's `user_id` belongs to an anonymous user → same write, return `{ outcome: 'claimed' }`
- [ ] Entry's `user_id` belongs to a claimed (non-anonymous) user → return `{ outcome: 'requires-signin', masked_email: 'f***@bar.com' }`
- [ ] Entry not found → return `{ outcome: 'error' }`

**Acceptance criteria**

- [x] Anonymous user submits an entry → post-submit modal appears; "Not now" dismisses with no persistent state; re-prompts on next submit; claimed users never see it
- [x] Claiming via the modal sends a link; after confirmation, `is_anonymous` is false and subsequent submits don't trigger the prompt
- [ ] "This is me" button appears only for unclaimed/anonymous-owned entries matching the user's stored last name (3.1b)
- [ ] `claim_entry` returns all three outcomes correctly; client handles each without error (3.1b)
- [ ] `claim_entry` is `SECURITY DEFINER` and readable only via RPC — no direct `auth.users` exposure to clients (3.1b)

---

## Phase 3.2: Commissioner pool locking

Goal: commissioners can lock a pool to prevent new entries and edits after the pick deadline, enforced both in the client and at the database layer.

**Schema changes**

- [ ] Add `locked_at timestamptz` to `pools` (nullable; null = unlocked)
- [ ] RLS policy on `entries`: block INSERT and UPDATE when `(SELECT locked_at FROM pools WHERE id = pool_id) IS NOT NULL`, unless the calling user is the pool's commissioner (`commissioner_user_id = auth.uid()` — from phase 4, or fall back to `commissioner_key` check)
- [ ] Update `supabase/schema.sql`

**Client changes**

- [ ] `isLocked` helper: `pool.locked_at !== null`
- [ ] Setup tab: "Lock pool" toggle (commissioner only). Locking writes `locked_at = now()`; unlocking sets `locked_at = null`. Show the lock timestamp when locked ("Locked on May 9 at 12:30 PM")
- [ ] Entry submit form: hidden for non-commissioners when `isLocked`. Show a "Picks are locked" banner in its place
- [ ] Entry edit: same gate — edit form hidden for non-commissioners on locked pools
- [ ] Commissioner can still submit and edit entries on a locked pool (for corrections)

**Edge cases**

- [ ] Pool locked while a non-commissioner has the entry form open: their submit is rejected by RLS. Client should surface the RLS error as "This pool has been locked — your picks could not be saved."
- [ ] Lock/unlock is reversible by the commissioner at any time; no confirmation modal needed

**Acceptance criteria**

- [ ] Commissioner can lock and unlock a pool from the Setup tab; `locked_at` is stored and displayed
- [ ] Non-commissioner entry form hidden and banner shown on a locked pool
- [ ] Commissioner entry form still works on a locked pool
- [ ] RLS blocks a direct `INSERT` to `entries` for a non-commissioner when pool is locked (verify via devtools or curl)
- [ ] Mid-edit lock: non-commissioner submit returns a clear "pool locked" error

---

## Phase 4: Commissioner migration

Goal: commissioner role lives on the user, not on localStorage. Existing commish keys become a fallback / migration path.

**Schema changes**

- [ ] Add `commissioner_user_id uuid REFERENCES auth.users(id)` column to `pools` (nullable)
- [ ] Update `supabase/schema.sql`

**Client changes**

- [ ] When loading a pool, if `pool.commissioner_user_id IS NULL` AND the current user has a valid localStorage commish key for this pool, write `pool.commissioner_user_id = currentUserId` (one-time migration)
- [ ] `isCommissioner` check: `currentUserId === pool.commissioner_user_id` OR (legacy fallback) localStorage key matches `pool.commissioner_key`
- [ ] On pool creation, set `commissioner_user_id = currentUserId` from the start
- [ ] Commissioner key is still generated and stored as a backup recovery mechanism, but is no longer the primary auth path

**Acceptance criteria**

- New pools created post-phase-4 have `commissioner_user_id` set
- Existing pools with a localStorage key get migrated on first load by their commissioner
- A commissioner who claims their account never loses commish access, even if they clear browser data
- Commissioner key still works as a recovery path (e.g. "I lost my account access, here's my key")

---

## Phase 5: Leagues + lifetime winnings

Goal: pools can be grouped into leagues; each league has a lifetime winnings leaderboard across all its pools.

**Schema changes**

- [ ] New `leagues` table:
  ```sql
  CREATE TABLE leagues (
      id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name                 text NOT NULL,
      invite_code          text UNIQUE,
      commissioner_user_id uuid REFERENCES auth.users(id),
      created_at           timestamptz DEFAULT now()
  );
  ```
- [ ] New `league_members` table:
  ```sql
  CREATE TABLE league_members (
      league_id uuid REFERENCES leagues(id) ON DELETE CASCADE,
      user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
      joined_at timestamptz DEFAULT now(),
      PRIMARY KEY (league_id, user_id)
  );
  ```
- [ ] Add `league_id uuid REFERENCES leagues(id)` to `pools` (nullable — ungrouped pools are allowed)
- [ ] RLS on leagues: members can read; commissioner can write

**Winnings model**

Pools already have `fee`, `prize1`, `prize2`. Winnings derive from pool results:

- 1st place in a pool wins `prize1` (or pot - prize2 if dynamic)
- 2nd place wins `prize2`
- Everyone else wins 0
- A user's lifetime winnings in a league = sum of winnings across all pools in that league where they had an entry

Need a way to mark a pool as "settled" so winnings count (otherwise mid-tournament leaders distort the leaderboard).

- [ ] Add `pools.settled_at timestamptz` — set when the commissioner marks the pool final
- [ ] A "Settle this pool" button on the leaderboard (commissioner only) once all rounds are complete
- [ ] Winnings calculation runs against settled pools only

**Client changes**

- [ ] New "Leagues" section in the hub for users who are members of any league
- [ ] League view: list of pools in the league + lifetime winnings leaderboard
- [ ] Create league flow: name + auto-generated invite code, current user becomes commissioner
- [ ] Join league flow: paste invite code, become a member
- [ ] Attach pool to league: in pool Setup tab, optional dropdown of leagues the commissioner is in
- [ ] Pool setup at creation time: option to start it inside a league directly

**Acceptance criteria**

- A user can create a league, share the invite code, and friends join
- Pools can be attached to a league at creation or after the fact (commissioner-only)
- Settling a pool updates the league standings
- League standings page shows: rank, name, total winnings, # of pools played, # of pool wins
- Unsettled pools don't contaminate the standings

---

## Out of scope (explicit non-goals)

- Multi-user switcher on a shared device
- Cleanup of orphaned anonymous users
- Email/password auth (magic link only)
- OAuth providers (Google, Apple, etc.) — revisit if friction is high
- Push notifications for sign-in events
- Admin moderation tools (kick, ban, etc.)

---

## Migration risks and mitigations

**Risk: Supabase anonymous auth has unexpected limits or quirks.**
Mitigation: pre-flight spike before phase 1. If blockers found, fall back to client-generated UUID stored in localStorage + a custom `users` table. Less elegant but functional.

**Risk: Existing users' commish access breaks during the phase 4 cutover.**
Mitigation: keep the localStorage commish key check as a permanent fallback. Migration happens silently on next load.

**Risk: Entry claiming creates duplicate or wrong-user entries.**
Mitigation: confirmation modal before claiming; commissioner can reassign if needed.

**Risk: Cross-device account merging is messier than expected.**
Mitigation: accept "newer device wins, older anonymous data discarded" as the policy. Document it. The user's claimed history is the source of truth.

**Risk: Users hate the hub and want their per-pool icons back.**
Mitigation: this is a UX bet. If it goes badly, the rollback is to ship a per-pool "Add to Home Screen" prompt that captures `/pin/{pin}` and degrade gracefully. Don't ship that until needed.
