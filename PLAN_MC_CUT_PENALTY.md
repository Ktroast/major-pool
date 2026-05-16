# Cut-penalty bug — fix & test plan

Written after the 2026 PGA Championship Friday cut, when Keenan's and Egg
Greg's entries (each with 2 MC picks) showed inflated totals because no
cut penalty was being applied. Workaround for the weekend: commissioner
manually set rounds via `score_overrides` to total +10 for the four MC
golfers. This file is the proper fix to do after the tournament wraps.

## The bug, in one paragraph

At the moment the cut happens, MC golfers have `status: 'active'`,
rounds like `[r1, r2, 0, null]` (R3 contains a `0` placeholder, R4 is
null), and they are picked by 1+ entries. Three things conspire:

1. **Status not flipped to MC.** ESPN hadn't propagated cut status to
   `c.status.type.description` yet (or did so on a player-by-player
   delay), so the proxy left them as `active`.
2. **`R3: 0` placeholder.** The proxy stored `0` for R3 on cut players,
   making them look like they played a third even-par round. The pick
   gets included in `entryBest4` as an active scorer with 3 rounds at
   `r1 + r2 + 0`, not as a penalty.
3. **`cutPenalty()` requires roundsComplete.** Even if we hand-flip the
   status to `'mc'`, `cutPenalty()` only computes the penalty when at
   least one active golfer has all 4 rounds done. Mid-tournament that
   set is empty, so the penalty is `null` and the entry total goes to
   `null` / NaN.

Net effect: the two MC picks are scored as 3-round actives at modestly
above-par totals instead of being penalized.

## Where the relevant code lives

- `index.html` lines ~540–671 — scoring engine: `roundsComplete`,
  `effectiveStatus`, `cutPenalty`, `golferScore`, `entryBest4`.
- `index.html` ~1701–1800 — `pullLiveScores`: matches ESPN players to
  pool golfers, persists rounds + status. Has the in-tournament WD
  inference for unmatched players.
- `index.html` ~2095–2140 — Scores tab convenience buttons:
  `mark-all-complete` (mark `has12 && missing34` as MC) and
  `mark-no-plays-wd` (mark `!playedAny` as WD).
- `netlify/functions/golf-leaderboard.js` ~170–218 — `normalize()`:
  status detection from ESPN strings + the `inferredWd` rule.
- `netlify/functions/golf-leaderboard.js` `extractRoundScores` — where
  the suspect `R3: 0` originates.
- `tests/scoring.test.js`, `tests/normalize.test.js`,
  `tests/matching.test.js` — node:test suites.

## Fix plan — step by step

### Step 1 — Reproduce in a test first
Before any code change, write a failing scoring test that mirrors what
happened on Friday. **Don't touch product code until this test is red.**

```
// tests/scoring.test.js
test('3 active + 2 MC picks → cut penalty applies to one MC pick', () => {
  const pool = {
    par: 70,
    golfers: [
      // 3 actives, all 4 rounds done
      { rank: 1, name: 'A', status: 'active', rounds: [-2, -1, -1, 0] },
      { rank: 2, name: 'B', status: 'active', rounds: [-1, -1,  0, 1] },
      { rank: 3, name: 'C', status: 'active', rounds: [ 0,  0,  1, 1] },
      // 2 MC, only R1+R2 played
      { rank: 4, name: 'D', status: 'mc',     rounds: [ 2,  4, null, null] },
      { rank: 5, name: 'E', status: 'mc',     rounds: [ 4,  2, null, null] },
    ],
    score_overrides: {},
  };
  const entry = { picks: [1, 2, 3, 4, 5] };
  const { total } = entryBest4(entry, pool.par, pool);
  // expected: 3 active totals (relative) + cutPenalty (= max active total + 10)
  // max active raw = par*4 + 2 = 282 → penalty 292 → relative +12
  // active totals: -4, -1, 2  → sum -3
  // total = -3 + 12 = +9
  assert.equal(total, 9);
});
```

Also add the inverse: same setup but `status: 'active'` with `rounds:
[r1, r2, 0, null]`. Document current behavior. Defer the "should
entryBest4 defensively treat this as MC?" decision until after a
conversation — answer probably depends on whether step 3 below
eliminates the `R3: 0` placeholder.

### Step 2 — Loosen `cutPenalty()` to work mid-tournament

Today (`index.html` ~584):

```
function cutPenalty(par, pool) {
  const made = pool.golfers.filter(g => effectiveStatus(g, pool) === 'active' && roundsComplete(g, pool));
  if (made.length === 0) return null;
  const max = Math.max(...made.map(g => rawTotal(g, par, pool)));
  return max + 10;
}
```

Replace `roundsComplete` with "has at least one round played" AND
extrapolate the raw total to a 4-round equivalent. Sketch:

```
function cutPenalty(par, pool) {
  const made = pool.golfers
    .filter(g => effectiveStatus(g, pool) === 'active')
    .map(g => {
      const rs = effectiveRounds(g, pool).filter(r => r !== null && r !== '' && !isNaN(Number(r))).map(Number);
      if (rs.length === 0) return null;
      const avg = rs.reduce((a, b) => a + b, 0) / rs.length;  // relative-to-par per round
      return par * 4 + avg * 4;                                // projected 4-round raw total
    })
    .filter(t => t !== null);
  if (made.length === 0) return null;
  return Math.max(...made) + 10;
}
```

Test: with the step-1 fixture, `cutPenalty` should return a number (not
null) once at least one active has any round logged.

Note: this is the mid-tournament estimator. At end of tournament, every
active has 4 real rounds, so the projection collapses back to the
current behavior — no change to final standings.

### Step 3 — Stop persisting `R3: 0` placeholders

In `netlify/functions/golf-leaderboard.js`, audit `extractRoundScores`
and trace where the `0` for an unstarted R3 comes from. Two likely
sources:

- ESPN's `linescores` array contains a `value: 0` (or `displayValue:
  "E"`) entry for the next period before the player tees off. Filter
  those by `period > currentPeriod && state !== 'in' && state !=
  'post'`.
- A `linescores[i].value` is the literal stroke total *so far*, which
  may be 0 if the player hasn't started the round. Only accept the
  value when the linescore has a `state === 'post'` (round finished)
  or `state === 'in'` (in progress — keep the `{inProgress: true}`
  metadata path we already have).

Add unit tests in `tests/normalize.test.js` with a fixture that has a
finished R1, R2, and an unstarted R3 (state=`pre`, value=0). Assert R3
is omitted, not `0`.

This fix alone is probably enough to make Friday-night scoring correct,
because `entryBest4` already treats a 2-round active as a 2-round
active and the cut penalty (once Step 2 lands) will dominate.

### Step 4 — Tournament-mismatch guard in the proxy

While debugging this I noticed the proxy will fall back to the *current
week's* event when an event-specific URL returns no data. Today this
affects only old/historical events (Zurich, weeks ago), but it's a
quiet correctness footgun.

In `netlify/functions/golf-leaderboard.js`:

```
// After normalize(), before returning:
if (eventId && tournament?.id && String(tournament.id) !== String(eventId)) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify({
    tournament: null, players: [], reason: 'event-not-found',
  })};
}
```

Mirror that in `pullLiveScores` — if `tournament.id !== pool.espn_event_id`,
log + bail, don't overwrite golfer status/rounds.

Test: hit the proxy with a fake event id like `99999999` and assert
`reason === 'event-not-found'` and `players.length === 0`.

### Step 5 — Add a "Mark MC after cut" convenience button

The Scores tab has `mark-all-complete` (marks picked golfers with R1+R2
but missing R3/R4 as MC). It currently misses cut golfers when R3 is
the `0` placeholder. After Step 3 that bug is gone — but make sure the
condition still catches the post-cut case explicitly:

```
const has12 = r1 != null && r1 !== '' && r2 != null && r2 !== '';
const missing34 = (r3 == null || r3 === '') || (r4 == null || r4 === '');
```

Once `R3: 0` placeholders are gone, this will Just Work. Add a test
fixture that runs `mark-all-complete`'s predicate on a freshly-cut
golfer and asserts they get marked MC.

Optional: a separate explicit button "Force MC on all picks not in
top-N" so the commissioner can resolve the cut without waiting for
ESPN to catch up.

### Step 6 — Document & revert the weekend workaround

After steps 1–3 land and the tests pass, in this pool's `score_overrides`
clear out the four manual `rounds: [...]` entries that were set to
total +10. The system should now compute the right total on its own. As
a smoke test before deleting the overrides, run `pullLiveScores` and
confirm Keenan & Greg show totals that match the manual +10 result
(within a stroke or two of the projection).

## Test commands

```
node --test tests/scoring.test.js
node --test tests/normalize.test.js
node --test tests/matching.test.js
```

No `npm install` needed — uses Node's built-in `node:test`. Tests load
scoring functions directly from `index.html` via
`tests/helpers/load-scoring.js`.

## Out of scope (for now)

- Adding a per-entry penalty field. Discussed and rejected: it would
  create a second source of truth that can disagree with per-golfer
  status, and the autofill case still needs MC detection. See chat
  transcript from 2026-05-16.
- Auto-locking the pool at cut time. Not on the table; commissioner
  controls lock manually (phase 3.2).

## Acceptance criteria

- All four `tests/*.test.js` suites green.
- New scoring test: 3 active + 2 MC → entry total = sum(3 active) +
  (max active total + 10). Passes.
- New normalize test: ESPN payload with unstarted R3 yields no R3
  value in the persisted rounds. Passes.
- Manual: at the next major's cut, do nothing as commissioner. After
  the next `pullLiveScores` poll, entries with 2 MC picks should show
  a "+10" cut penalty applied automatically.
