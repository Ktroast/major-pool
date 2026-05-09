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

## What's still open (from PROGRESS.md)

- `onclick` strings in rendered HTML (`renderEntriesList`) — safe but worth retiring
- `par + b` duplicated in `rawTotal` and `entryBest4` — could extract `relativeToStrokes`
- Per-round-equivalent sort in `entryBest4` needs a worked example in its comment
