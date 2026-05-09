'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  effectiveRounds,
  cutPenalty,
  entryBest4,
} = require('./helpers/load-scoring.js');

// ---- helpers ----

function makePool(golfers, overrides = {}, par = 72) {
  return { golfers, score_overrides: overrides, par };
}
function makeGolfer(rank, rounds, status = 'active') {
  return { rank, name: `Golfer${rank}`, rounds: rounds ?? [null, null, null, null], status };
}
function makeEntry(picks) {
  return { picks };
}

// Total strokes for a golfer with given relative rounds at par 72:
// e.g. [-3,-2,-1,-4] → (72-3)+(72-2)+(72-1)+(72-4) = 278
function strokeTotal(...rels) {
  return rels.reduce((sum, r) => sum + (72 + r), 0);
}

// ---- effectiveRounds ----

test('effectiveRounds — raw strokes ≥ 40 are converted to relative (n - par)', () => {
  const g = makeGolfer(1, [70, 71, 72, 73]);
  const pool = makePool([g]);
  assert.deepEqual(effectiveRounds(g, pool), [-2, -1, 0, 1]);
});

test('effectiveRounds — values < 40 are left as relative', () => {
  const g = makeGolfer(1, [-2, -1, 0, 1]);
  const pool = makePool([g]);
  assert.deepEqual(effectiveRounds(g, pool), [-2, -1, 0, 1]);
});

test('effectiveRounds — score_overrides.rounds override g.rounds when present', () => {
  const g = makeGolfer(1, [0, 0, 0, 0]);
  const pool = makePool([g], { '1': { rounds: [-5, -4, -3, -2] } });
  assert.deepEqual(effectiveRounds(g, pool), [-5, -4, -3, -2]);
});

test('effectiveRounds — null/undefined/empty-string/NaN rounds → null', () => {
  const g = { rank: 1, name: 'X', rounds: [null, undefined, '', NaN], status: 'active' };
  const pool = makePool([g]);
  assert.deepEqual(effectiveRounds(g, pool), [null, null, null, null]);
});

// ---- entryBest4 ----

test('entryBest4 — 5 active picks → best 4, fifth dropped, no penalty', () => {
  // Totals: 278, 280, 284, 288, 292
  const golfers = [
    makeGolfer(1, [-3, -2, -1, -4]),
    makeGolfer(2, [-2, -2, -2, -2]),
    makeGolfer(3, [-1, -1, -1, -1]),
    makeGolfer(4, [0, 0, 0, 0]),
    makeGolfer(5, [1, 1, 1, 1]),     // worst — dropped
  ];
  const pool = makePool(golfers);
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  assert.strictEqual(result.total, strokeTotal(-3,-2,-1,-4) + strokeTotal(-2,-2,-2,-2) +
                                   strokeTotal(-1,-1,-1,-1) + strokeTotal(0,0,0,0));
  assert.strictEqual(result.dropped?.rank, 5);
  const g5 = result.details.find(d => d.rank === 5);
  assert.ok(g5.isDropped, 'rank-5 pick should be flagged isDropped');
});

test('entryBest4 — 4 active + 1 WD → best 4 actives, WD dropped at no cost', () => {
  const golfers = [
    makeGolfer(1, [-3, -2, -1, -4]),
    makeGolfer(2, [-2, -2, -2, -2]),
    makeGolfer(3, [-1, -1, -1, -1]),
    makeGolfer(4, [0, 0, 0, 0]),
    makeGolfer(5, [null, null, null, null], 'wd'),
  ];
  const pool = makePool(golfers);
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  // 4 actives fill best-4; WD dropped without adding its penalty to the total
  const expected = strokeTotal(-3,-2,-1,-4) + strokeTotal(-2,-2,-2,-2) +
                   strokeTotal(-1,-1,-1,-1) + strokeTotal(0,0,0,0);
  assert.strictEqual(result.total, expected);
  const g5 = result.details.find(d => d.rank === 5);
  assert.ok(g5.isDropped, 'WD pick should be flagged isDropped');
});

test('entryBest4 — 3 active + 2 WD → best 3 actives + cheapest WD, penalty applied', () => {
  // G1-G3 active, totals 278/280/284. G4+G5 WD.
  // cutPenalty = max(278,280,284) + 10 = 294
  const golfers = [
    makeGolfer(1, [-3, -2, -1, -4]),
    makeGolfer(2, [-2, -2, -2, -2]),
    makeGolfer(3, [-1, -1, -1, -1]),
    makeGolfer(4, [null, null, null, null], 'wd'),
    makeGolfer(5, [null, null, null, null], 'wd'),
  ];
  const pool = makePool(golfers);
  const cp = 294; // max active total (284) + 10
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  assert.strictEqual(result.total,
    strokeTotal(-3,-2,-1,-4) + strokeTotal(-2,-2,-2,-2) + strokeTotal(-1,-1,-1,-1) + cp);
  const wdDetails = result.details.filter(d => d.status === 'wd');
  assert.strictEqual(wdDetails.filter(d => !d.isDropped).length, 1, 'one WD counted');
  assert.strictEqual(wdDetails.filter(d => d.isDropped).length, 1, 'one WD dropped');
});

test('entryBest4 — 0 active + 5 WD → total = null (not enough real scores)', () => {
  const golfers = Array.from({ length: 5 }, (_, i) =>
    makeGolfer(i + 1, [null, null, null, null], 'wd')
  );
  const pool = makePool(golfers);
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  assert.strictEqual(result.total, null);
});

test('entryBest4 — per-round-equivalent sort: 2-round low-average beats 4-round higher-average', () => {
  // G1: 2 rounds [-3,-2] → score=139, per-rd=69.5
  // G2: 4 rounds [-3,-2,+1,+1] → score=285, per-rd=71.25
  // G1 should rank higher (lower per-rd) and stay in best-4; G5 (worst) dropped
  const golfers = [
    { rank: 1, name: 'A', rounds: [-3, -2, null, null], status: 'active' },
    { rank: 2, name: 'B', rounds: [-3, -2, 1, 1],       status: 'active' },
    makeGolfer(3, [-1, -1, -1, -1]),
    makeGolfer(4, [0, 0, 0, 0]),
    makeGolfer(5, [1, 1, 1, 1]),
  ];
  const pool = makePool(golfers);
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  const g1 = result.details.find(d => d.rank === 1);
  const g5 = result.details.find(d => d.rank === 5);
  assert.ok(!g1.isDropped, 'G1 (lower per-round avg) should be in best 4');
  assert.ok(g5.isDropped,  'G5 (worst per-round avg) should be dropped');
});

test('entryBest4 — WD penalty is max(active 4-round totals) + 10, not a constant', () => {
  // Active totals: 278, 280, 284, 288. Max = 288. Penalty should be 298.
  const golfers = [
    makeGolfer(1, [-3, -2, -1, -4]),
    makeGolfer(2, [-2, -2, -2, -2]),
    makeGolfer(3, [-1, -1, -1, -1]),
    makeGolfer(4, [0, 0, 0, 0]),
    makeGolfer(5, [null, null, null, null], 'wd'),
  ];
  const pool = makePool(golfers);
  assert.strictEqual(cutPenalty(72, pool), strokeTotal(0, 0, 0, 0) + 10); // 288 + 10 = 298
});

test('entryBest4 — WD picks never displace active picks via per-round-equivalent', () => {
  // 4 actives available, so WD must be dropped regardless of score magnitude.
  // (Regression: isPenalty=true keeps WD in a separate bucket from sortedActive.)
  const golfers = [
    makeGolfer(1, [2, 2, 2, 2]),
    makeGolfer(2, [1, 1, 1, 1]),
    makeGolfer(3, [0, 0, 0, 0]),
    makeGolfer(4, [-1, -1, -1, -1]),
    makeGolfer(5, [null, null, null, null], 'wd'),
  ];
  const pool = makePool(golfers);
  const result = entryBest4(makeEntry([1, 2, 3, 4, 5]), 72, pool);
  const expected = strokeTotal(-1,-1,-1,-1) + strokeTotal(0,0,0,0) +
                   strokeTotal(1,1,1,1)     + strokeTotal(2,2,2,2);
  assert.strictEqual(result.total, expected);
  const g5 = result.details.find(d => d.rank === 5);
  assert.ok(g5.isDropped, 'WD should be dropped when 4 actives are available');
});
