# The Major Pool

A golf major pool app for tracking picks and live scores during PGA major tournaments. Participants submit 5 picks (one per OWGR tier) before the tournament; scores are pulled from ESPN and updated live.

**Live app:** https://putalittledrawonit.netlify.app

---

## How it works

Each entrant picks 5 golfers — one per OWGR rank tier (1–10, 11–20, 21–30, 31–40, 41+) — before the tournament begins. During the event, scores are fetched from ESPN every 5 minutes and merged into the pool. Each entry's score is the sum of its **best 4 of 5** golfers' cumulative round totals (relative to par).

**Scoring rules:**
- Best 4 of 5 picks count toward the entry total
- WD/MC picks are dropped free — unless needed to reach 4, in which case a penalty applies: `max(active stroke totals) + 10`
- Tiebreaker: predicted winning to-par score submitted before the tournament; closest wins
- The commissioner can manually override any golfer's score or status from the **Scores tab**

Pools are accessed by a 6-character PIN in the URL: `https://putalittledrawonit.netlify.app?pin=ABC123`

---

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML/CSS/JS — single file (`index.html`, ~2000 lines) |
| Backend | Netlify Function (`golf-leaderboard.js`) — ESPN proxy |
| Database | Supabase (Postgres, accessed via the REST API) |
| Hosting | Netlify |

No build step. No bundler. No framework. Deploying is a `git push`.

---

## Running locally

**View the UI** — any static server works:
```bash
python -m http.server 8080
# open http://localhost:8080
```

**Run the Netlify function locally** (needed to test live score fetching):
```bash
npm install -g netlify-cli
netlify dev
# Function available at http://localhost:8888/.netlify/functions/golf-leaderboard
```

Supabase credentials and the ESPN proxy URL are embedded in `index.html` — no `.env` file is needed for local dev.

---

## Running tests

Three test suites use Node's built-in test runner (no dependencies):

```bash
node --test tests/normalize.test.js   # ESPN proxy parsing (extractRoundScores, normalize)
node --test tests/scoring.test.js     # Scoring engine (entryBest4, effectiveRounds, cutPenalty)
node --test tests/matching.test.js    # Fuzzy name matching (findBestMatch, normalizeName)
```

The scoring and matching tests extract functions directly from `index.html` via Node's `vm` module (`tests/helpers/load-scoring.js`), so they always run against the live source.

---

## Adding a tournament

1. Open the pool as commissioner (URL must include the commissioner key)
2. Go to the **Setup tab**
3. Enter the ESPN event ID in the **"Tournament (optional)"** field and save

**Finding the right value for that field:**

| Value | When to use |
|-------|-------------|
| *(leave empty)* | Current week — the proxy auto-detects from ESPN's live schedule |
| `YYYYMMDD` (8 digits, e.g. `20250410`) | A specific week by date |
| `401580329` (9+ digits) | A specific ESPN event ID — most reliable for non-standard events like the Zurich Classic team format |

The ESPN event ID appears in URLs like `espn.com/golf/leaderboard/_/eventId/401580329`.

---

## Proxy debug params

The function at `/.netlify/functions/golf-leaderboard` accepts these query params:

| Param | Effect |
|-------|--------|
| `?debug=1` | Include the list of URLs tried and raw ESPN response metadata in the JSON |
| `?raw=1` | Dump the first competitor's full ESPN payload — useful when ESPN changes their data shape |

Example: `https://putalittledrawonit.netlify.app/.netlify/functions/golf-leaderboard?raw=1`

The proxy caches responses for 2 minutes in memory. Cache resets on cold start.

---

## Database schema

Hosted on Supabase. No migration files exist — this is the schema as inferred from the code.

### `pools`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `pin` | text | 6-char alphanumeric; used in the share URL |
| `name` | text | Pool display name |
| `par` | int | Per-round par, default 72 |
| `fee` | int | Entry fee ($) |
| `prize1` | int | First place prize ($) |
| `prize2` | int | Second place prize ($) |
| `commissioner_key` | text | Random string; grants admin access |
| `golfers` | jsonb | `[{name, rank, rounds, roundsMeta, status, unmatched}]` |
| `score_overrides` | jsonb | Commissioner edits — see below |
| `espn_event_id` | text | ESPN event ID or YYYYMMDD date key (nullable) |
| `updated_at` | timestamp | |

### `entries`

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `pool_id` | uuid FK | → `pools.id` |
| `name` | text | Entrant display name |
| `picks` | jsonb | `[rank1, rank2, rank3, rank4, rank5]` — one pick per tier |
| `tiebreaker` | int | Predicted winning to-par score |
| `created_at` | timestamp | |

### `score_overrides` shape

Keys are `String(rank)` (e.g. `"7"`). Values can have:
- `.status` — override golfer status: `"active"`, `"wd"`, or `"mc"`
- `.rounds` — override round array: `[r1|null, r2|null, r3|null, r4|null]` (relative to par)

Overrides always win over ESPN-sourced data. Set them on the **Scores tab**.

---

## Project structure

```
major-pool/
├── index.html                          # Entire frontend — HTML + CSS + JS
├── style.css                           # Extracted stylesheet
├── netlify/
│   └── functions/
│       └── golf-leaderboard.js         # ESPN proxy (CommonJS Netlify Function)
├── tests/
│   ├── normalize.test.js               # Proxy unit tests (node:test, no dependencies)
│   ├── scoring.test.js                 # Scoring engine unit tests
│   ├── matching.test.js                # Fuzzy name matching unit tests
│   └── helpers/
│       └── load-scoring.js             # Extracts scoring fns from index.html for tests
├── netlify.toml                        # Netlify build + functions config
├── AUDIT.md                            # Code audit with refactor recommendations
└── CLAUDE_CODE_HANDOFF.md              # Architecture notes and feature roadmap
```
