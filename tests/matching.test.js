'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, findBestMatch } = require('./helpers/load-scoring.js');

// ---- helpers ----

function cands(...names) {
  return names.map(name => ({ name }));
}

// ---- normalizeName ----

test('normalizeName — strips accents', () => {
  assert.strictEqual(normalizeName('José Ramírez'), 'jose ramirez');
});

test('normalizeName — removes jr/sr/ii/iii suffixes', () => {
  assert.strictEqual(normalizeName('Billy Horschel Jr.'), 'billy horschel');
});

test('normalizeName — hyphen treated as space', () => {
  assert.strictEqual(normalizeName('Rasmus Neergaard-Petersen'), 'rasmus neergaard petersen');
});

// ---- findBestMatch ----

test('findBestMatch — exact match returns immediately (score 1000)', () => {
  const result = findBestMatch('Scottie Scheffler', cands('Scottie Scheffler', 'Rory McIlroy'));
  assert.strictEqual(result?.candidate?.name, 'Scottie Scheffler');
});

test('findBestMatch — Sam Stevens → Samuel Stevens (last name hit + low levenshtein)', () => {
  const result = findBestMatch('Sam Stevens', cands('Samuel Stevens', 'Tiger Woods'));
  assert.strictEqual(result?.candidate?.name, 'Samuel Stevens');
});

test('findBestMatch — Cam Davis → Cameron Davis', () => {
  const result = findBestMatch('Cam Davis', cands('Cameron Davis', 'Jon Rahm'));
  assert.strictEqual(result?.candidate?.name, 'Cameron Davis');
});

test('findBestMatch — team format: pool "A / B" matches ESPN "A & B"', () => {
  const result = findBestMatch(
    'Dumont De Chassart / Chatfield',
    cands('Adrien Dumont de Chassart & Davis Chatfield', 'Rory McIlroy & Shane Lowry')
  );
  assert.strictEqual(result?.candidate?.name, 'Adrien Dumont de Chassart & Davis Chatfield');
});

test('findBestMatch — hyphenated last names (Neergaard-Petersen) match exactly after normalization', () => {
  const result = findBestMatch(
    'Rasmus Neergaard-Petersen',
    cands('Rasmus Neergaard-Petersen', 'Rory McIlroy')
  );
  assert.strictEqual(result?.candidate?.name, 'Rasmus Neergaard-Petersen');
});

test('findBestMatch — no candidates → null', () => {
  const result = findBestMatch('Scottie Scheffler', []);
  assert.strictEqual(result, null);
});

test('findBestMatch — accented characters stripped (José → Jose matching)', () => {
  const result = findBestMatch('José Ramírez', cands('Jose Ramirez', 'Tiger Woods'));
  assert.strictEqual(result?.candidate?.name, 'Jose Ramirez');
});
