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

**URL routing is path-based: `/pool/{pin}`.** Shareable links look like `https://putalittledrawonit.netlify.app/pool/ABC123`. The old `?pin=ABC123` query-string format is deprecated — boot() detects it and redirects to the path form so old links still work. Netlify serves `/pool/*` via a 200 rewrite to `index.html`. A `lastPin` key in localStorage provides a fallback for iOS home screen launches (Safari can strip the path on PWA launch from the home screen). Users with the old `?pin=` home screen icon should re-add it once with the new `/pool/{pin}` URL to get reliable path-based launch.

## Migration notes (2026-05-10)

Switched from `/?pin=ABC123` query-string routing to `/pool/ABC123` path-based routing to fix an iOS "Add to Home Screen" bug where Safari drops the query string on PWA launch.

Changes made:
- `getPinFromUrl()` — reads from pathname first, falls back to `?pin=` query string, then `localStorage.lastPin`
- `setPinInUrl(pin)` — navigates to `/pool/{pin}` path and writes `lastPin` to localStorage on success
- `renderPinBanner()` — share URL is now `origin/pool/{pin}` (no query string)
- `boot()` — detects `?pin=` in the URL and does a `history.replaceState` redirect before resolving
- `netlify.toml` — `/pool/*` → `index.html` 200 rewrite
- `manifest.json` `start_url` is `/` (unchanged; fine for a generic install)

Friends with old `?pin=` bookmarks are auto-redirected client-side. Home screen icons bookmarked before this change will still work via the localStorage fallback, but friends should re-add the icon using the new `/pool/{pin}` URL for the most reliable experience.

## What's still open (from PROGRESS.md)

- `onclick` strings in rendered HTML (`renderEntriesList`) — safe but worth retiring
- `par + b` duplicated in `rawTotal` and `entryBest4` — could extract `relativeToStrokes`
- Per-round-equivalent sort in `entryBest4` needs a worked example in its comment
