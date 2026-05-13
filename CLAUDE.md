# CLAUDE.md — The Major Pool

## What this is

Golf major pool app. Single-file frontend (`index.html`), Netlify Function ESPN proxy (`netlify/functions/golf-leaderboard.js`), Supabase backend. No build step, no bundler — `git push` deploys.

## Key docs

- `AUDIT.md` — canonical backlog and architecture notes
- `PROGRESS.md` — what's been completed, what's still open
- `README.md` — setup, scoring rules, schema, proxy params

## Running tests

```bash
node --test tests/normalize.test.js   # ESPN proxy parsing
node --test tests/scoring.test.js     # Scoring engine
node --test tests/matching.test.js    # Fuzzy name matching
```

No `npm install` needed — uses Node's built-in `node:test`. Scoring/matching tests load functions directly from `index.html` via `tests/helpers/load-scoring.js`.

## Architecture notes worth remembering

**Scoring functions take `pool` as a parameter.** `golferScore`, `entryBest4`, `cutPenalty`, etc. all receive `pool` explicitly — they don't read the global. This is what makes them testable. Don't regress this.

**WD inference runs in two independent places.** The proxy (`golf-leaderboard.js`) infers WD for players with partial ESPN data. The client (`pullLiveScores`) infers WD for players ESPN dropped entirely. This is intentional defense-in-depth — don't consolidate it.

**`espn_event_id` serves double duty.** 8-digit value = YYYYMMDD date key. 9+ digit value = ESPN event ID. Disambiguation happens in `fetchEspnLeaderboard` (client) and `candidateUrls` (proxy).

**`score_overrides` shape:** `{ "<rank_str>": { status?: "active"|"wd"|"mc", rounds?: [r1|null, r2|null, r3|null, r4|null] } }`. Keys are `String(rank)`. Overrides always win over ESPN data. Set via the Scores tab.

**Cache TTL is 2 minutes** (proxy), not 5. The client polls every 5 minutes. These are intentionally different.

**Anonymous Supabase auth (phases 1a + 1b — complete):**
- Every visitor gets an anonymous Supabase user on boot via `signInAnonymously()` — `currentUser` and `getCurrentUserId()` are the accessors. `onAuthStateChange()` keeps `currentUser` current.
- `user_pools` tracks (user_id, pool_id, role) with PK on the pair; `recordPoolVisit()` upserts on each pool load and create. Failures are console.error'd, never surfaced.
- The upsert omits `joined_at` from the payload so on-conflict updates leave it frozen — matters for phase 5 settled-pool math.
- **Role stickiness invariant (phase 1b bug fix):** `recordPoolVisit` only writes `role` to the payload when called with `'commissioner'`. Player-context calls omit `role` entirely — on insert the DB default (`'player'`) applies; on conflict-update the existing role is preserved. This means commissioner status can never be silently demoted by a visit. `loadPool` also reads the `user_pools` row to compute `isCommissioner`, so once a row is marked commissioner in the DB it stays commissioner even after localStorage keys are cleared by migration.
- RLS on `user_pools` enforces `auth.uid() = user_id` for all operations.

**Hub (phase 1b):**
- `/` is now the hub for users with 1+ pools in `user_pools`; it shows all their pools sorted by `last_visited DESC`. Empty hub (0 rows) falls through to the existing landing controls — no separate empty-hub UX.
- Hub is rendered by `showHub()`: queries `user_pools` joined to `pools`, renders `.hub-row` elements, each clickable to navigate `window.location.href = /pin/{pin}`.
- `boot()` routing at `/`: queries `user_pools` (limit 1); if rows > 0 → `showHub()`; if 0 rows → tries `localStorage.lastPin` (iOS PWA fallback, see below) → else landing.
- `lastPin` fallback in `boot()` fires only for users at `/` with 0 `user_pools` rows — i.e. iOS PWA users with old home-screen icons not yet reflected in the DB. The fallback loads the last pool directly. Once `migrateLegacyLocalStorage()` runs, this path is effectively dead for returning users.
- `migrateLegacyLocalStorage()` runs in `boot()` after auth, before routing. Iterates `major_pool_commish_keys_v1`, verifies each key against `pools.commissioner_key`, upserts a commissioner row via `recordPoolVisit()`. Also migrates `lastPin` as a player row. Clears commish keys only if all upserts succeeded (preserves them for retry on network error). **Does not clear `lastPin`** — still needed for iOS PWA path-strip fallback.

**Account claiming (phase 3):**
- Anonymous vs claimed state is determined by `currentUser.is_anonymous`. Claimed users have `is_anonymous: false` and `currentUser.email` set.
- **Unified sign-in flow** (`handleSignIn`): the user always sees one intent — "Sign in to find your pools." Internally: if the anonymous user already has `user_pools` rows, `updateUser({ email })` is tried first so those rows survive the claim (`user.id` is preserved through the transition, verified in the May 11 spike). On any error it silently falls through to `signInWithOtp({ email })`. Users with no pools, or already-claimed users, go straight to OTP. The branching is invisible to the user.
- **Do NOT use `linkIdentity`** — it is OAuth-only in Supabase JS v2. `updateUser({ email })` is the correct API for adding email to an anonymous user.
- **Orphaned-anonymous-data policy**: when a user signs in on a new device with an email already claimed elsewhere, `updateUser` fails and the silent OTP fallback sends a magic link for the claimed account. After clicking it, the current device's anonymous session data is discarded and the claimed account's history is recovered. This is intentional per PLAN_AUTH.md.
- **Role stickiness through claim**: because `user.id` is preserved across the anonymous-to-claimed transition, every `user_pools` row the user held as anonymous remains theirs after claiming — including commissioner rows. The phase 1b role-stickiness invariant requires no special handling here.
- **`onAuthStateChange` toast logic**: fires on `USER_UPDATED` (claim confirmation redirect) or `SIGNED_IN` (OTP magic-link redirect) when `!currentUser.is_anonymous`. Excludes `INITIAL_SESSION` so returning claimed users don't see the toast on every page load.
- **Email template (production Supabase config)**: Authentication → Email Templates → "Change Email Address" in the Supabase dashboard. The default copy says "Change Email" which is misleading for first-time claimers (they're not changing anything — they're saving their anonymous session). The customized subject "Save your pools to this email" and matching body copy are load-bearing for the UX — don't let them revert to the Supabase default.
- **Sign-out**: `supabase.auth.signOut()` + `window.location.reload()`. On reload a fresh anonymous session starts; previous claimed history is recoverable only by signing back in with the same email.
- **Post-submit claim prompt (phase 3.1a)**: anonymous users are nudged to attach an email via `showPostSubmitClaimModal()` after every successful entry save. The entry is already persisted — the modal is non-blocking. Reuses `sendSignInLink(email)`, extracted from `handleSignIn` as the shared updateUser/OTP-fallback core. Prompt skipped if the user is already claimed or any modal is already open.

**URL routing is path-based: `/pin/{pin}`.** Shareable links look like `https://putalittledrawonit.netlify.app/pin/ABC123`. The old `?pin=ABC123` query-string format is deprecated — boot() detects it and redirects to the path form so old links still work. Netlify serves `/pin/*` via a 200 rewrite to `index.html`. A `lastPin` key in localStorage provides a fallback for iOS home screen launches (Safari can strip the path on PWA launch from the home screen). Users with the old `?pin=` home screen icon should re-add it once with the new `/pin/{pin}` URL to get reliable path-based launch.

## Migration notes (2026-05-10)

Switched from `/?pin=ABC123` query-string routing to `/pin/ABC123` path-based routing to fix an iOS "Add to Home Screen" bug where Safari drops the query string on PWA launch.

Changes made:
- `getPinFromUrl()` — reads from pathname first, falls back to `?pin=` query string, then `localStorage.lastPin`
- `setPinInUrl(pin)` — navigates to `/pin/{pin}` path and writes `lastPin` to localStorage on success
- `renderPinBanner()` — share URL is now `origin/pin/{pin}` (no query string)
- `boot()` — detects `?pin=` in the URL and does a `history.replaceState` redirect before resolving
- `netlify.toml` — `/pin/*` → `index.html` 200 rewrite
- `manifest.json` `start_url` is `/` (unchanged; fine for a generic install)

Friends with old `?pin=` bookmarks are auto-redirected client-side. Home screen icons bookmarked before this change will still work via the localStorage fallback, but friends should re-add the icon using the new `/pin/{pin}` URL for the most reliable experience.

## What's still open (from PROGRESS.md)

- Auth migration phases 2, 4, 5 — see PLAN_AUTH.md (phase 3 is complete; phase 2 was intentionally skipped)
