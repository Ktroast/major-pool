'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Extract the matching + scoring functions from index.html between their section
// markers and evaluate them in a sandbox. After the pool-parameter threading,
// these functions are self-contained and have no globals — perfect for unit tests.
const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

const startMark = '// NAME NORMALIZATION & FUZZY MATCHING';
const endMark   = '// SUPABASE OPERATIONS';
const startIdx = html.indexOf(startMark);
const endIdx   = html.indexOf(endMark);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('Could not locate scoring section markers in index.html');
}
// Walk back from startIdx to include the === header line above the section name
const prevNewline = html.lastIndexOf('\n', startIdx - 2);
const code = html.slice(prevNewline + 1, endIdx);

const ctx = vm.createContext({});
vm.runInContext(code, ctx);

module.exports = {
  normalizeName:      ctx.normalizeName,
  lastName:           ctx.lastName,
  levenshtein:        ctx.levenshtein,
  findBestMatch:      ctx.findBestMatch,
  golferByRank:       ctx.golferByRank,
  roundsComplete:     ctx.roundsComplete,
  effectiveRounds:    ctx.effectiveRounds,
  effectiveStatus:    ctx.effectiveStatus,
  effectiveRoundsMeta:ctx.effectiveRoundsMeta,
  rawTotal:           ctx.rawTotal,
  cutPenalty:         ctx.cutPenalty,
  golferScore:        ctx.golferScore,
  entryBest4:         ctx.entryBest4,
};
