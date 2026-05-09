# The Major Pool — Project Hand-off

Welcome. This is a working golf pool web app deployed at https://putalittledrawonit.netlify.app. It was built iteratively over two tournaments (2026 Masters, then expanded for the Zurich Classic and Cadillac Championship). The owner (Kee) is now moving from chat-based development to Claude Code for ongoing work.

Your first job is **not** to add features. It's to read the codebase, understand the architecture, and produce a written audit. Once Kee reviews the audit, we'll plan next steps together.

---

## Architecture at a glance

**Single-file HTML + Netlify Function + Supabase.** No build step, no framework.

- `index.html` — the entire app: HTML, CSS, vanilla JS in one file (~2000 lines). Tabs: Leaderboard, Entries, My Picks, Scores, Setup, House Rules.
- `netlify/functions/golf-leaderboard.js` — server-side proxy that fetches from ESPN's public golf scoreboard API, normalizes the response shape, and serves it to the client. This is where most of the hard-won bug fixes live.
- `netlify.toml` — build config (just function routing).
- Supabase backend stores `pools`, `entries`, and a `score_overrides` JSON column for manual commissioner edits.
- Multi-user state is keyed by a 6-char PIN that's part of the URL (`?pin=ABC123`).

## Why ESPN, and what's painful about it

ESPN's `site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard` endpoint is undocumented but free. We use it because the alternatives are paid (DataGolf, SportsDataIO) or require reverse-engineering (PGA Tour GraphQL).

The ESPN integration has been the source of nearly every bug. Critical things you must know before touching the proxy:

1. **For team events (e.g. Zurich Classic)**, competitor names live on `c.team.name` / `c.team.displayName`, NOT on `c.athlete`. The competitor has `type: "team"` for these.

2. **For individual events**, names are on `c.athlete.displayName`.

3. **Round scores live in `c.linescores[]`**, where each entry has `period` (1-4 for the round number), `value` (raw strokes), `displayValue` (to-par string like "-8" / "E" / "+2"), and a nested `linescores[]` array of per-hole entries.

4. **`displayValue` is the authoritative to-par.** `value` for an in-progress round is the LIVE accumulated stroke count and will distort totals if treated as a completed-round score. Always prefer `displayValue` parsing.

5. **In-progress rounds are detected by `c.status.type.state === "in"`** combined with `c.status.period`. The matching `linescore` entry's nested `linescores` array length = holes played so far.

6. **Withdrawn players are OMITTED from ESPN's response entirely.** They don't appear with a "WD" status — they're just gone from the competitor list. The client has to detect "we expected this player but ESPN didn't return them" and infer WD from that.

7. **Round scores must be indexed by `period`, not by array position.** ESPN sometimes returns linescores in non-sequential order or with gaps. Index-by-position causes R2 partial scores to clobber R1 final scores. Bug fixed but easy to regress.

8. **The proxy returns a round-indexed object** like `{ 1: {relative:-8}, 2: {relative:-3, inProgress:true, holesPlayed:9} }`. The client unpacks it into the right slots. In-progress rounds get tagged with `inProgress` and `holesPlayed` metadata.

There's a `?raw=1` query param on the proxy that dumps the first competitor's full ESPN payload — INVALUABLE for debugging future shape surprises.

## Pool scoring rules (don't break these)

- **5 picks per entrant**, one per OWGR-tier (1-10, 11-20, 21-30, 31-40, 41+).
- **Best 4 of 5 lowest stroke totals wins**.
- **Tiebreaker**: predicted winning to-par score, closest wins.
- **Cut penalty rule (CRITICAL)**: An entrant only takes the cut penalty if they're FORCED to count an MC/WD pick to reach 4. If they have 4+ active picks who completed all rounds, the MC/WD pick is dropped at no cost. The penalty is `max(active stroke totals) + 10`. This was a recurring bug: previous code logic kept including WD cut penalties in best-4 because they had a "low per-round equivalent" score that beat real players on sort.
- **Per-pick scoring is per-round-equivalent**. A pick with 3 rounds (one missing) is sorted by stroke-total / 3, not raw total, so it isn't unfairly penalized vs a 4-round pick.
- **Manual overrides** in `pool.score_overrides` always win. Both `effectiveRounds()` and `effectiveStatus()` check overrides first.
- **In-progress rounds NOW count toward running totals** (recent change). Previously they were dropped. The leaderboard becomes a live running total during tournament play.

## Live UI features (recently added)

- "X holes left today" indicator on entry rows, with a pulsing red dot.
- "thru N" tags on in-progress picks in the picks list.
- Gold-accented round cells with "thru N" subscripts in the expanded round detail.
- Compact mobile name abbreviation ("S. Scheffler" at <481px).
- Manual entry overrides are still available via the Scores tab. Setting status to "WD" via the dropdown also clears any spurious round data.

## Development gotchas

- **There's no build step.** Don't add Webpack, Vite, etc. unless the owner explicitly asks. The single-file HTML is intentional for simplicity and Netlify deploy ease.
- **Score values can be either raw strokes OR to-par.** The client's `toRelative()` helper uses a heuristic: values ≥ 40 are raw strokes (subtract par), < 40 are already relative. Plus tagged `{relative: N}` objects from the proxy bypass that conversion. Don't break this.
- **The proxy has a 2-minute in-memory cache** to avoid hammering ESPN (the client polls every 5 minutes — these are intentionally different). Cache keys include the event ID and date. If you change the response shape, bump the cache to avoid serving stale shapes mid-deploy.
- **Pool data syncs are merge-based**, not replace-based. A fresh sync that's missing a round should NOT erase a previously-known round value. The merge logic preserves the previous value when fresh is null. This protects against in-progress filtering wiping completed-round data.
- **Name matching uses a Levenshtein + last-name + team-format-aware scorer** in `findBestMatch()`. Common edge cases handled: "Sam Stevens" → "Samuel Stevens", "Cam Davis" → "Cameron Davis", "Dumont De Chassart/Chatfield" → "Adrien Dumont de Chassart & Davis Chatfield", typos in user-uploaded field lists, hyphenated last names (Neergaard-Petersen). Don't break this.

## Your first task: produce an audit

Read the code thoroughly and produce a markdown audit covering:

1. **Architecture summary** — confirm or correct the description above. Note anything I got wrong or that's evolved.
2. **Code organization assessment** — `index.html` is ~2000 lines. Is it time to split? Where would natural seams fall (CSS into a separate file, scoring logic into its own JS, etc.)? What's the lowest-risk refactor that improves maintainability without breaking the single-file deploy story?
3. **Test coverage** — there are no tests today. What's the smallest set of tests that would catch the bugs we kept hitting? Focus on the scoring engine and ESPN normalizer — those have been the bug magnets. Suggest a testing approach (probably Node's built-in test runner since there's no toolchain).
4. **Code smells / risks** — anything that looks fragile, duplicated, or hard to reason about. Especially in the ESPN proxy and the merge logic.
5. **Documentation gaps** — places where a future Claude Code session (or a human) would benefit from comments or a `README.md` / `ARCHITECTURE.md` file.
6. **Quick wins** — tiny improvements (under an hour each) that would make development easier going forward.

DO NOT make any code changes during the audit phase. Just produce the markdown report. Once Kee has reviewed it, we'll discuss what to tackle first.

## Roadmap context (for later, not now)

After the audit, here are the prioritized features Kee is interested in. Don't start any of these until cleanup is done:

1. **Auto-refresh the leaderboard** every ~90s during tournament hours, with a Setup toggle to disable.
2. **Notifications** — leaderboard movement alerts via email or webhook (Slack/Discord). Engagement boost for group-chat play.
3. **Historical pool tracker** — lifetime standings across tournaments (winnings, head-to-head, best finishes). New Supabase table.
4. **AI-powered pick recommendations** in the app itself — call Anthropic's API at pick time with current odds + course fit + recent form. Pattern already exists in Kee's `xi-simulator` repo.
5. **Confidence-weighted pick variant** — rank picks 1-5 by confidence, weight totals accordingly.
6. **Live shot-by-shot feed** — detect birdie/eagle events between ESPN syncs, scroll a feed during tournament play.
7. **Pool admin tools** — lock picks at deadline, kick entrants, transfer ownership.

## Working preferences

Kee is technical (works with electrical/construction/heavy equipment, runs Arch Linux + Hyprland) and self-sufficient. Communicate plainly without excessive hedging. When you're not sure about something, say so directly. When you find a bug or have a strong opinion, share it. He values honesty about limitations more than reassurance.

OK — start by reading the codebase and producing the audit.
