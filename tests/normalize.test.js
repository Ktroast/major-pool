'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractRoundScores, normalize } = require('../netlify/functions/golf-leaderboard.js');

// ---- helpers ----

function makeRaw(state, competitors) {
  return {
    events: [{
      id: 'evt-test',
      name: 'Test Open',
      status: { type: { state, description: state } },
      competitions: [{ competitors }],
    }]
  };
}

function player(name, lsEntries, statusDescription) {
  return {
    athlete: { displayName: name },
    linescores: lsEntries || [],
    status: { type: { description: statusDescription || '' } },
  };
}

// ---- extractRoundScores ----

test('extractRoundScores — indexed by period, not array position', () => {
  const c = {
    linescores: [
      { period: 2, displayValue: '-3' },
      { period: 1, displayValue: '-5' },
    ]
  };
  const r = extractRoundScores(c);
  assert.deepEqual(r[1], { relative: -5 });
  assert.deepEqual(r[2], { relative: -3 });
});

test('extractRoundScores — non-sequential periods [2,1,3]', () => {
  const c = {
    linescores: [
      { period: 2, displayValue: '-3' },
      { period: 1, displayValue: '-5' },
      { period: 3, displayValue: 'E'  },
    ]
  };
  const r = extractRoundScores(c);
  assert.deepEqual(r[1], { relative: -5 });
  assert.deepEqual(r[2], { relative: -3 });
  assert.deepEqual(r[3], { relative: 0  });
});

test('extractRoundScores — in-progress round has inProgress:true and holesPlayed', () => {
  const holes = Array(9).fill(null).map(() => ({ displayValue: '-1' }));
  const c = {
    status: { period: 2, type: { state: 'in' } },
    linescores: [
      { period: 1, displayValue: '-5' },
      { period: 2, displayValue: '-2', linescores: holes },
    ]
  };
  const r = extractRoundScores(c);
  assert.strictEqual(r[2].inProgress, true);
  assert.strictEqual(r[2].holesPlayed, 9);
  assert.strictEqual(r[1].inProgress, undefined);
});

test('extractRoundScores — displayValue "E" → {relative: 0}', () => {
  const c = { linescores: [{ period: 1, displayValue: 'E' }] };
  assert.deepEqual(extractRoundScores(c)[1], { relative: 0 });
});

test('extractRoundScores — displayValue "-8" → {relative: -8}', () => {
  const c = { linescores: [{ period: 1, displayValue: '-8' }] };
  assert.deepEqual(extractRoundScores(c)[1], { relative: -8 });
});

test('extractRoundScores — displayValue "+2" → {relative: 2}', () => {
  const c = { linescores: [{ period: 1, displayValue: '+2' }] };
  assert.deepEqual(extractRoundScores(c)[1], { relative: 2 });
});

test('extractRoundScores — unicode minus −8 → {relative: -8}', () => {
  const c = { linescores: [{ period: 1, displayValue: '−8' }] };
  assert.deepEqual(extractRoundScores(c)[1], { relative: -8 });
});

test('extractRoundScores — entry with no value and no displayValue is skipped', () => {
  const c = {
    linescores: [
      { period: 1, displayValue: '-5' },
      { period: 2 },
    ]
  };
  const r = extractRoundScores(c);
  assert.ok(1 in r, 'round 1 present');
  assert.ok(!(2 in r), 'round 2 absent');
});

test('extractRoundScores — completed rounds not tagged in-progress when period advances', () => {
  const c = {
    status: { period: 3, type: { state: 'in' } },
    linescores: [
      { period: 1, displayValue: '-5' },
      { period: 2, displayValue: '-3' },
      { period: 3, displayValue: '-1', linescores: [] },
    ]
  };
  const r = extractRoundScores(c);
  assert.strictEqual(r[1].inProgress, undefined, 'round 1 not in-progress');
  assert.strictEqual(r[2].inProgress, undefined, 'round 2 not in-progress');
  assert.strictEqual(r[3].inProgress, true,      'round 3 in-progress');
});

// ---- normalize ----

test('normalize — team event: name from c.team.displayName', () => {
  const comp = {
    type: 'team',
    team: { displayName: 'Dumont De Chassart / Chatfield' },
    linescores: [{ period: 1, displayValue: '-5' }],
  };
  const result = normalize(makeRaw('in', [comp]));
  assert.strictEqual(result.players[0].name, 'Dumont De Chassart / Chatfield');
});

test('normalize — individual event: name from c.athlete.displayName', () => {
  const result = normalize(makeRaw('in', [
    player('Scottie Scheffler', [{ period: 1, displayValue: '-8' }]),
  ]));
  assert.strictEqual(result.players[0].name, 'Scottie Scheffler');
});

test('normalize — isWd from "withdrawn" status string', () => {
  const result = normalize(makeRaw('in', [
    player('Injured Player', [{ period: 1, displayValue: '-2' }], 'Withdrawn'),
  ]));
  assert.strictEqual(result.players[0].status, 'wd');
});

test('normalize — isCut from "missed cut" status string', () => {
  const result = normalize(makeRaw('post', [
    player('Cut Player', [{ period: 1, displayValue: '+2' }, { period: 2, displayValue: '+3' }], 'Missed Cut'),
  ]));
  assert.strictEqual(result.players[0].status, 'mc');
});

test('normalize — inferredWd when tournament in-progress and player has zero rounds', () => {
  const result = normalize(makeRaw('in', [player('Ghost Player', [])]));
  assert.strictEqual(result.players[0].status, 'wd');
});

test('normalize — inferredWd NOT triggered in pre-tournament state', () => {
  const result = normalize(makeRaw('pre', [player('Future Player', [])]));
  assert.strictEqual(result.players[0].status, 'active');
});

test('normalize — players with no name are filtered out', () => {
  const result = normalize(makeRaw('in', [
    player('', [{ period: 1, displayValue: '-3' }]),
    player('Valid Player', [{ period: 1, displayValue: '-3' }]),
  ]));
  assert.strictEqual(result.players.length, 1);
  assert.strictEqual(result.players[0].name, 'Valid Player');
});
