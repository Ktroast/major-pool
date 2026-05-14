# Codebase Audit — The Major Pool

> **Status: HISTORICAL.** Every item in this audit was completed in May 2026 —
> see `PROGRESS.md` for the commit-by-commit shipping log. This document is
> preserved as the original baseline review; do not treat its priorities or
> "open" items as current. For the current backlog, see `PLAN_AUTH.md`
> (active migration) and `PROGRESS.md` (Open / upcoming section).

_Produced by Claude Code, May 2026. Do not make code changes until Kee reviews this._

---

## 1. Architecture Summary

The handoff doc is accurate. A few corrections and additions:

**Cache TTL is 2 minutes, not 5.** `CACHE_MS = 2 * 60 * 1000` in the proxy (line 14). The 5-minute figure in the handoff doc matches the *client* poll interval (`POLL_INTERVAL_MS = 5 * 60 * 1000`, index.html line 570). These are intentionally different (cache is tighter so fresh data is available sooner after a manual pull), but the handoff note is misleading.

**`fetchEspnSchedule` is a dead stub.** It returns `[]` unconditionally and is called at boot, but the result goes into `espnTournaments`, which is never read by any render function. The dropdown for picking a specific tournament from a schedule was removed at some point; the stub and the variable are leftover artifacts.

**The proxy's `?raw=1` param is undocumented in the code.** The proxy's file header mentions `?debug=1` but not `?raw=1`. The param works (it dumps the first competitor object), it's just not in the header comment.

**WD inference runs in two places: proxy and client.** The proxy has `inferredWd` logic (if tournament is in/post and a player has zero rounds and no status string, treat as WD). The client's `pullLiveScores` has a separate path: if `findBestMatch` returns nothing during an in-progress tournament, it directly sets `g.status = 'wd'`. These are complementary but independent — the proxy inference handles players with partial ESPN data; the client inference handles players ESPN dropped entirely. Good defense-in-depth.

**`espn_event_id` in the pool record serves double duty.** It's used for both 8-digit date keys and 9+-digit ESPN event IDs, with the disambiguation happening in `fetchEspnLeaderboard` (client) and `candidateUrls` (proxy). The UI label says "Tournament (optional)" which undersells the importance of this field for non-current-week events.

**Overall structure size:** 2009 lines total. Roughly: CSS 329 lines, HTML structure 220 lines, JavaScript 1460 lines. The JS is well-organized into ~25 named sections with clear `// ===` headers.

---

## 2. Code Organization Assessment

The file is large but not chaotic — the section headers make navigation workable. Here's an honest breakdown of the natural seams and the realistic refactor options.

### Option A: Extract CSS (lowest risk, ~30 min)

The `<style>` block is 329 lines of pure stylesheet with no JavaScript coupling. Moving it to `style.css` and referencing it with `<link rel="stylesheet">` reduces `index.html` to ~1680 lines and requires zero logic changes. Netlify serves static files from the same directory — no build step needed.

**Tradeoff:** The app loses the "single file you can email someone" property, but you're already past that with the Netlify Function dependency. This is the best first refactor.

### Option B: Extract scoring engine (medium effort, high test value)

The scoring functions are the highest-value code to isolate: `effectiveRounds`, `effectiveStatus`, `effectiveRoundsMeta`, `rawTotal`, `cutPenalty`, `golferScore`, `entryBest4`, and the fuzzy matching cluster (`normalizeName`, `lastName`, `levenshtein`, `findBestMatch`).

**Problem:** They're not pure today. `golferByRank` reads the global `pool.golfers`. `cutPenalty` iterates `pool.golfers`. `effectiveRounds` reads `pool.score_overrides`. Making them testable requires threading `pool` as a parameter, which is a 10-15 line change per function — not hard, but it touches the scoring engine's API.

Without a bundler/modules, extracted files would just add `<script src="scoring.js">` tags and rely on global scope, which is a lateral move. The real win from extracting scoring is testability, which requires the parameter change anyway. This is probably the right second refactor — after CSS, before anything else.

### Option C: Extract Netlify function logic (separate concern)

`golf-leaderboard.js` is already its own file and in good shape. The only extraction worth considering is splitting `extractRoundScores` and `normalize` into a `normalize.js` module shared between the function and potential Node tests. Requires `require()` changes but is contained entirely in `netlify/functions/`.

### What I'd recommend

1. CSS to `style.css` — now, zero risk
2. Thread `pool` into scoring functions + write tests — before adding any roadmap features
3. Leave the rest; the section-header navigation is sufficient for a single-person project

Splitting the 1460-line JS further (into render.js, handlers.js, etc.) would hurt navigability more than it helps — you'd lose the single-file `Ctrl+F` workflow without gaining module benefits.

---

## 3. Test Coverage

No tests exist. Here's the minimal set that would catch the bugs you've actually hit, using Node's built-in `node:test` runner (no dependencies, no build step, works today).

### File layout

```
tests/
  scoring.test.js      — entryBest4, effectiveRounds, cutPenalty
  matching.test.js     — findBestMatch, normalizeName
  normalize.test.js    — extractRoundScores, normalize (proxy)
```

### Scoring tests (`scoring.test.js`)

These are the highest-value tests. Each maps to a past bug or a rule that's easy to accidentally break:

```
entryBest4:
  ✓ 5 active picks → best 4, fifth dropped, no penalty
  ✓ 4 active + 1 WD → best 4 from actives, WD dropped free
  ✓ 3 active + 2 WD → best 3 actives + cheapest WD, penalty applied
  ✓ 0 active + 5 WD → total = null (not enough real scores)
  ✓ per-round-equivalent sort: pick with 3 rounds and low average beats pick with 4 rounds and higher average (anti-regression for the mid-tournament fairness rule)
  ✓ WD penalty is max(active 4-round totals) + 10, not a constant
  ✓ if penalty picks have a "low per-round equivalent" they don't bubble up past actives (the bug that was hitting in WD cases)

effectiveRounds:
  ✓ raw strokes ≥ 40 are converted to relative (n - par)
  ✓ values < 40 are left as relative
  ✓ score_overrides.rounds override g.rounds when present
  ✓ null/undefined/''/NaN rounds → null
```

### Matching tests (`matching.test.js`)

```
findBestMatch:
  ✓ exact match returns immediately
  ✓ Sam Stevens → Samuel Stevens (contained substring + last name hit)
  ✓ Cam Davis → Cameron Davis
  ✓ "Dumont De Chassart / Chatfield" → "Adrien Dumont de Chassart & Davis Chatfield" (team format)
  ✓ hyphenated last names (Neergaard-Petersen)
  ✓ no candidates → null
  ✓ accented characters stripped (José → Jose matching)
```

### Proxy tests (`normalize.test.js`)

These run against the actual `golf-leaderboard.js` using `require()`:

```
extractRoundScores:
  ✓ indexed by period, not array position (R2's data doesn't clobber R1)
  ✓ linescores in non-sequential order (period=[2,1,3])
  ✓ in-progress round: tagged with inProgress:true + holesPlayed
  ✓ displayValue "E" → {relative: 0}
  ✓ displayValue "-8" → {relative: -8}
  ✓ displayValue "+2" → {relative: 2}
  ✓ displayValue "−8" (unicode minus) → {relative: -8}
  ✓ entry with no value and no displayValue → skipped (not included)
  ✓ completed-round metadata cleared when round advances

normalize:
  ✓ team event shape (c.type === "team") → name from c.team.displayName
  ✓ individual event shape → name from c.athlete.displayName
  ✓ isWd from "withdrawn" status string
  ✓ isCut from "missed cut" status string
  ✓ inferredWd: tournament in-progress, player has zero rounds → status: 'wd'
  ✓ inferredWd NOT triggered in pre-tournament state
  ✓ players with no name are filtered out
```

### Running them

No `package.json` changes needed:

```bash
node --test tests/scoring.test.js
node --test tests/normalize.test.js
```

The scoring tests need the scoring functions extracted with `pool` as a parameter (see §2). The proxy tests can run today against `netlify/functions/golf-leaderboard.js` with no changes.

---

## 4. Code Smells / Risks

### Risk: WD infer path ignores manual overrides (medium)

In `pullLiveScores` (line 1601-1616), when a player isn't found in ESPN's response during an in-progress tournament:

```js
g.status = 'wd';
g.rounds = [null, null, null, null];
```

This writes to the raw golfer object in `pool.golfers`. `score_overrides` live separately and take precedence in rendering (the `effectiveX` functions check overrides first), so the override data isn't lost. But the underlying `g.status` and `g.rounds` are permanently overwritten. If the commissioner had manually set a player to "active" (to override an ESPN glitch), a subsequent sync restores `g.status = 'wd'` on the raw object. The override keeps working until the commissioner removes it — at which point the underlying WD surfaces again unexpectedly. This is the correct behavior 95% of the time, but when ESPN is wrong, it creates a trap.

**Mitigation:** Before writing WD on an unmatched player, check if `pool.score_overrides[String(g.rank)]?.status` is explicitly set; if so, skip the WD inference. ~3 lines.

### Risk: `renderAll()` on every scorecard input change (low-medium)

`renderScorecard` attaches `change` event listeners that call `saveOverrides → updatePool → renderAll`. `renderAll` re-renders every section including the leaderboard, which calls `entryBest4` for every entry. For 10 entries × 5 picks this is fine. At 30 entries with complex scoring it'd be sluggish. Not urgent, but if you ever see scorecard lag, this is why.

### Smell: `toRelative` is scoped inside `pullLiveScores` (line 1579)

It's a core conversion function used only once, but conceptually it belongs in UTILS next to `fmtToPar`. If you ever want to test it or use it elsewhere, you'll have to move it. Move it now while it's trivial.

### Smell: `onclick` strings in rendered HTML (line 1303-1304)

`renderEntriesList` builds HTML with `onclick="editEntry('${e.id}')"`. This requires `editEntry` and `deleteEntry` to be on `window` (line 1894-1905), which they are. It works. But it means event handlers are invisible to "find all references" tooling, and XSS correctness depends on UUIDs not containing `'`. Supabase UUIDs don't — so it's safe — but it's a pattern worth retiring when you refactor render functions.

### Smell: Duplicated "relative-to-strokes" formula

`rawTotal` converts relative scores to strokes with `par + b`. `entryBest4` does the same inline: `par + b`. The formula is simple, but if `par` ever weren't per-round (a 4-day total par, say), both would need updating. Consider extracting a `relativeToStrokes(score, par)` helper.

### Smell: Dead code

`fetchEspnSchedule()` returns `[]`. `espnTournaments` is set but never read. `fetchEspnSchedule` is called in `boot()`. These can all go.

### Smell: `?raw=1` undocumented in proxy header

The proxy's file header comment mentions `?debug=1` but not `?raw=1`. The raw dump is invaluable for debugging ESPN shape surprises and should be in the header.

---

## 5. Documentation Gaps

### No README

The biggest gap. Any new collaborator (or Kee returning after 3 months) has nowhere to start. A single `README.md` covering:
- What the app is and where it's deployed
- How to add a new tournament (Setup tab → ESPN event ID)
- How to run the proxy locally (`netlify dev`)
- Supabase table schema (see below)
- The `?debug=1` and `?raw=1` proxy params

### Supabase schema is inferred, not documented

The table shapes from reading the code:

```
pools
  id              uuid PK
  pin             text (6-char, alphanumeric)
  name            text
  par             int (per round, default 72)
  fee             int ($)
  prize1          int ($)
  prize2          int ($)
  commissioner_key text (random uid+uid)
  golfers         jsonb  -- [{name, rank, rounds: [r1|null, ...], roundsMeta: [...], status, unmatched}]
  score_overrides  jsonb  -- {[rank_str]: {status?, rounds?: [r1|null, ...]}}
  espn_event_id   text (ESPN event ID or YYYYMMDD, nullable)
  updated_at      timestamp

entries
  id              uuid PK
  pool_id         uuid FK → pools.id
  name            text
  picks           jsonb  -- [rank1, rank2, rank3, rank4, rank5] (one per tier)
  tiebreaker      int (predicted winning to-par)
  created_at      timestamp
```

No migration files exist. If you ever need to recreate the schema, you're reading the code to figure it out. A `supabase/schema.sql` would be cheap insurance.

### `score_overrides` shape isn't written down anywhere

The override object shape is inferred from `effectiveRounds`/`effectiveStatus`. The key is `String(rank)`. The value can have `.status` (string) and/or `.rounds` (array). This is the one data structure most likely to confuse someone — worth a comment near `effectiveRounds`.

### Per-round-equivalent sort rationale

`entryBest4` uses `score / roundsScored` to sort. The why is half-explained in a comment. A worked example would make it easier to audit for correctness: e.g., Pick A has -3/-2 (2 rounds, avg -2.5), Pick B has -3/-2/+1/+1 (4 rounds, total -3, avg -0.75) — A sorts better even though B has a lower total, because A is performing better per round played.

---

## 6. Quick Wins

All of these are under 30 minutes each, zero regression risk:

**1. Remove dead code** (~5 min)
Delete `fetchEspnSchedule`, `espnTournaments`, and the `fetchEspnSchedule().then(...)` block in `boot()`. These are pure noise.

**2. Move `toRelative` to UTILS section** (~5 min)
Cut the function definition from inside `pullLiveScores` and paste it into the UTILS section. No logic change, makes it findable and future-testable.

**3. Add `?raw=1` to proxy header comment** (~2 min)
Add a line to `golf-leaderboard.js`'s header:
```
//   ?raw=1          — dump the first competitor's ESPN payload verbatim (shape debugging)
```

**4. Fix WD override bypass** (~10 min)
In the unmatched-player path of `pullLiveScores`, check `pool.score_overrides[String(g.rank)]?.status` before writing WD. If the commissioner has already set a status, skip the WD inference on the raw golfer object. This closes the override-stomp race condition.

**5. Correct the cache time in the handoff doc** (~2 min)
`CLAUDE_CODE_HANDOFF.md` says "5-minute in-memory cache." Change to "2-minute in-memory cache (client polls every 5 minutes)."

**6. Extract CSS to `style.css`** (~15 min)
Move the `<style>` block to `style.css` and add `<link rel="stylesheet" href="style.css">`. Reduces `index.html` by 329 lines. No logic change, no build step, no routing change needed — Netlify serves the file automatically.

**7. Write the proxy test file** (~45 min)
The proxy functions are already in a `require()`-able CommonJS module. A `tests/normalize.test.js` using `node:test` and `node:assert` can test `extractRoundScores` and `normalize` without any code changes to the proxy. This is the highest-value test because the proxy is where the ESPN quirks live.

---

## Summary Table

| Area | Status | Priority |
|------|--------|----------|
| Architecture | Accurate, 2 minor corrections | Low |
| CSS extraction | Ready to do, zero risk | Medium |
| Scoring engine extraction | Requires param threading | High (needed before tests) |
| Test coverage | Zero today | High |
| WD override bypass bug | Latent, real | Medium |
| `toRelative` scoping | Smell, no user impact | Low |
| Dead code | `fetchEspnSchedule` + `espnTournaments` | Low |
| README + schema docs | Missing entirely | Medium |
| Override format comment | Missing | Low |
