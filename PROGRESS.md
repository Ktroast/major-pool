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

## Remaining items from audit

These were noted in the audit but not yet addressed:

- **`onclick` strings in rendered HTML** (§4) — `renderEntriesList` builds HTML with `onclick="editEntry('${e.id}')"`. Safe with UUIDs but worth retiring when render functions are next touched.
- **`toRelative` / `relativeToStrokes` duplication** (§4) — `rawTotal` and `entryBest4` both inline `par + b`. Could extract a helper if par ever changes meaning.
- **Per-round-equivalent sort comment** (§5) — the why in `entryBest4` is half-explained; a worked example would help future readers auditing the fairness rule.
