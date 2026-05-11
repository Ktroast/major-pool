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

## Open / upcoming

- **Auth phase 1b** — hub UI, routing, localStorage migration (see PLAN_AUTH.md Phase 1)
- **Auth phases 2–5** — entry linking, magic-link claiming, commissioner migration, leagues (see PLAN_AUTH.md)
- **Season-long scoring** — multi-week / multi-major cumulative leaderboard. Entries persist across events; scores accumulate over the season. Schema and UI TBD.
- **Golfball mascot** — a golfball character who drinks and smokes. Vibes TBD.
