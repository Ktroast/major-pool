# Progress — The Major Pool

Work completed post-audit (AUDIT.md, May 2026).

---

## Quick wins (AUDIT.md §6) — all done

| # | Item | Commit |
|---|------|--------|
| 1 | Remove dead code (`fetchEspnSchedule`, `espnTournaments`) | c2a5aec |
| 2 | Move `toRelative` to UTILS section | ebbca50 |
| 3 | Add `?raw=1` to proxy header comment | 0aee1a1 |
| 4 | Fix WD override bypass (inference no longer stomps commissioner overrides) | 3c1fadb |
| 5 | Correct cache TTL in handoff doc (2 min, not 5) | f703cca |
| 6 | Extract CSS to `style.css` | ec57dea |
| 7 | Write proxy test file (`tests/normalize.test.js`, 16 tests) | bcc8713 |

---

## Refactor work (AUDIT.md §2–3) — done

| Item | Commit |
|------|--------|
| Thread `pool` into scoring functions (makes them testable) | 721ad11 |
| Add scoring tests (`tests/scoring.test.js`) | 721ad11 |
| Add matching tests (`tests/matching.test.js`) | 721ad11 |
| Document test suite in README + update project structure | c85a14b, a0e56e3 |

---

## Documentation (AUDIT.md §5) — done

| Item | Commit |
|------|--------|
| Add README (setup, scoring rules, schema, proxy params) | dbd1040 |
| Add `supabase/schema.sql` (pools and entries table definitions) | d969de0 |

---

## Remaining items from audit — all done

| Item | Commit |
|------|--------|
| Retire `onclick` strings in `renderEntriesList` (DOM + addEventListener) | 1e3064d |
| Extract `roundsToStrokes` helper (eliminate `par + b` duplication) | 69ed0a6 |
| Add worked example to per-round-equivalent sort comment in `entryBest4` | 8624a90 |

---

## Auth migration — phase 1a (anonymous auth foundation)

Merged on branch `phase-1a-anon-auth`. Applies the invisible half of phase 1 — session bootstrap and membership writes with no UI changes. Smoke tests passed May 11, 2026.

| Item | Commit |
|------|--------|
| Add `user_pools` table + RLS policy to `supabase/schema.sql` | c53d73f |
| Bootstrap anonymous Supabase session in `boot()` | 6d4d8ff |
| Add `recordPoolVisit()`; wire into `loadPool` and `createPool` | b3da8e3 |
| Update CLAUDE.md + PLAN_AUTH.md for phase 1a completion | 77655a3 |

Manual steps required before smoke testing:
- Apply `user_pools` CREATE TABLE and RLS policy SQL via Supabase dashboard (see `supabase/schema.sql`).

Acceptance criteria — all passed:
- [x] Visiting `/` or `/pin/ABC123` — no visible change.
- [x] `await sb.auth.getSession()` in devtools returns an anonymous session.
- [x] Loading a pool creates/updates a `user_pools` row; reload bumps `last_visited`, `joined_at` unchanged.
- [x] Creating a pool creates a `user_pools` row with `role='commissioner'`.
- [x] Different browser/device → different `user_id` row.
- [x] Supabase anonymous-auth toggle confirmed ON (already done per spike notes).

---

## Auth migration — phase 1b (hub UI + localStorage migration)

Merged on branch `phase-1b-hub`. Adds the visible half of phase 1 — the multi-pool hub at `/`, legacy state migration, and routing changes. Acceptance testing passed May 12, 2026.

| Item | Commit |
|------|--------|
| Add view-hub panel skeleton + CSS | 16501f4 |
| Wire hub query + render hub rows | 4bd0005 |
| Route / to hub when user has pools | 0534305 |
| Migrate legacy localStorage state to user_pools | 8b3be1e |
| Docs: phase 1b complete | 20636f5 |
| **Bugfix:** `recordPoolVisit` role-preserving; `isCommissioner` trusts `user_pools` row | 331d192 |
| **Bugfix docs:** role-stickiness invariant in CLAUDE.md | f76867e |

Bug reproduced and fixed before merge: the phase 1b migration clears `major_pool_commish_keys_v1` after success. This caused `recordPoolVisit(p, 'player')` to overwrite commissioner rows on every subsequent pool visit once localStorage was cleared. Fix: (a) omit `role` from the upsert payload on player calls so on-conflict updates only bump `last_visited`; (b) read the `user_pools` row in `loadPool` before computing `isCommissioner` so the DB value is a durable fallback once localStorage keys are gone. One demoted row in the preview environment was manually repaired via the Supabase dashboard — no production impact since phase 1b hadn't merged yet.

Acceptance criteria — all passed:
- [x] Fresh install → landing; create pool → `/pin/{pin}`; back to `/` → hub with commissioner badge
- [x] Hub row click navigates to `/pin/{pin}` and `last_visited` updates
- [x] Multiple pools appear sorted most-recent first
- [x] Legacy migration: `major_pool_commish_keys_v1` set → hub shows commissioner row, key cleared
- [x] Legacy migration: only `lastPin` set → hub shows player row, `lastPin` preserved
- [x] Empty hub (0 rows) → landing controls shown, not empty hub
- [x] `/pin/{pin}` direct link still works for users with no hub history
- [x] iOS PWA: `/` with `lastPin` set but 0 `user_pools` rows → loads last pool (legacy fallback)
- [x] RLS: `sb.from('user_pools').select('*').neq('user_id', getCurrentUserId())` returns 0 rows

---

## Auth migration — phase 3 (account claiming via magic link)

Merged on branch `phase-3-claim-flow`. Adds the sign-in / claim flow — anonymous users can attach an email to their account to make their pool history portable across devices. Phase 2 (entry linking) intentionally skipped; phase 3 prioritised because phase 1b made cross-device pain immediately visible. Acceptance testing passed May 12, 2026.

| Item | Commit |
|------|--------|
| Sign-in modal + auth callback handling | 17cb2b1 |
| Hub header sign-in link + profile chip | 2b4cef2 |
| Empty-hub recovery caption | b17e3b6 |
| CSS for hub auth UI | 3d0e96f |
| Docs: phase 3 complete (PLAN_AUTH.md boxes) | 61cc180 |
| UX: promote sign-in to primary action on empty hub | 85789fc |
| UX: unify modal under single intent (silent OTP fallback) | ba66100 |
| Fix: syntax error in handleSignIn (curly quotes) | 7cb6030 |

Manual steps required before production:
- Supabase dashboard → Authentication → Email Templates → customize "Confirm Email Change" template to read "Confirm your email" (first-time claimers see "Change Email" subject otherwise — misleading but functional).

Acceptance criteria — all passed:
- [x] Anonymous user with pools sees Sign in link in hub header
- [x] Anonymous user with no pools sees recovery caption on landing ("Already played? Sign in...")
- [x] Claim happy path: email entered → confirmation email → link clicked → redirect → toast shows → profile chip appears → `user.id` unchanged
- [x] Post-claim: hub shows same pools; commissioner status preserved (user.id stable → user_pools rows intact)
- [x] Cross-device recovery: new anonymous session → sign in → OTP link → hub shows claimed account's pools
- [x] Sign out → fresh anonymous session → hub empty
- [x] Email collision: `updateUser` silently falls back to OTP (no user-visible branching); claimed identity's history recovered on redirect

---

## Auth migration — phase 3.1a (post-submit email prompt)

Merged on branch `phase-3.1a-post-submit-prompt`. Adds a post-submit modal nudging anonymous users to attach an email after saving an entry. Entry is always saved first — the modal is non-blocking. Acceptance testing passed May 13, 2026.

| Item | Commit |
|------|--------|
| Extract `sendSignInLink`; add `showPostSubmitClaimModal` + hook into entry save | 2a7bf84 |
| Docs: phase 3.1a boxes ticked; PROGRESS.md + CLAUDE.md updated | 0c36600 |

Acceptance criteria — all passed:
- [x] Anonymous user creates new entry → modal appears
- [x] Anonymous user edits existing entry → modal appears
- [x] "Not now" → modal closes, no localStorage written; re-prompts on next submit
- [x] "Save my entry" with valid email → confirmation screen shown, email sent
- [x] Clicking confirmation link → `onAuthStateChange` fires `USER_UPDATED`, toast shows, user no longer anonymous, subsequent submits don't trigger the prompt
- [x] Sign-in modal already open when a submit happens → no modal stacking
- [x] Existing sign-in flow from hub header unchanged (regression check)

---

## Auth migration — phase 3.2 (commissioner pool locking)

Merged on branch `phase-3.2-pool-locking`. Adds the `pools.locked_at` column, RLS-gated INSERT/UPDATE on `entries`, and a commissioner-only Lock/Unlock toggle in the Setup tab. Non-commissioners see a banner instead of the pick form on locked pools, and the per-entry Edit button is hidden — entries remain readable. Acceptance testing passed May 13, 2026.

| Item | Commit |
|------|--------|
| `pools.locked_at` + lock-aware entries RLS in `supabase/schema.sql` | b5f4330 |
| Lock/Unlock toggle, confirmation modal, lock-aware rendering, `upsertEntry` guard | 140d258 |
| Manual test plan + docs (PLAN_AUTH.md / PROGRESS.md / CLAUDE.md) | _this commit_ |

Manual steps required before smoke testing:
- Run the SQL block from `supabase/schema.sql` (the new `ALTER TABLE pools ADD COLUMN locked_at` plus the four entries policies) in the Supabase dashboard SQL editor. Idempotent — the policy DROPs are guarded with `IF EXISTS`.

Acceptance criteria — all passed (see `tests/manual/phase-3.2.md` for the full walkthrough):
- [x] Commissioner can lock/unlock from Setup tab; `locked_at` stored and displayed
- [x] Non-commissioner entry form hidden and banner shown on locked pool
- [x] Commissioner can still submit/edit entries on a locked pool
- [x] RLS rejects a direct `entries.insert` from a non-commissioner anonymous session when pool is locked
- [x] Mid-edit lock surfaces a clean toast, not a raw RLS rejection
- [x] Re-lock / re-unlock cycles cleanly with no stale UI

---

## Open / upcoming

- **Auth phases 2, 3.1b, 4, 5** — entry linking, orphan name-match claim, commissioner migration, leagues (see PLAN_AUTH.md)
- **Auth UX follow-ups** — magic-link previewer warning, email template customization, orphan recovery runbook (see PLAN_AUTH.md "Auth UX follow-ups" section)
- **Season-long scoring** — multi-week / multi-major cumulative leaderboard. Entries persist across events; scores accumulate over the season. Schema and UI TBD.
- **Golfball mascot** — a golfball character who drinks and smokes. Vibes TBD.
