/* Shared mock data for the three scoreboard redesign concepts.
   Matches the real major-pool data shape: entrants pick 5 golfers,
   scored best-4-of-5 relative to par. Golfers have rounds (4 nullable
   numbers), an effective status (active/mc/wd), and may have a `live`
   object when mid-round. */

window.MOCK = (() => {
  const PAR = 72;

  // 30 golfers, scoreboard-ranked. Rounds are to-par deltas per round (null = not played).
  // A handful are mid-Round-4 (`live: { thru, current }`) and a few are MC/WD.
  const GOLFERS = {
    1:  { rank: 1,  name: 'Scottie Scheffler', status: 'active', rounds: [-3,-4,-3,-2], live: null },
    2:  { rank: 2,  name: 'Rory McIlroy',      status: 'active', rounds: [-4,-3,-2,-1], live: null },
    3:  { rank: 3,  name: 'Xander Schauffele', status: 'active', rounds: [-2,-3,-1,-2], live: null },
    4:  { rank: 4,  name: 'Jon Rahm',          status: 'active', rounds: [-1,-1, 0,-2], live: null },
    5:  { rank: 5,  name: 'Viktor Hovland',    status: 'active', rounds: [-3,+1,-1, 0], live: null },
    6:  { rank: 6,  name: 'Collin Morikawa',   status: 'active', rounds: [-2,-1,-1,-1], live: null },
    7:  { rank: 7,  name: 'Patrick Cantlay',   status: 'mc',     rounds: [+2,+1, null, null], live: null },
    8:  { rank: 8,  name: 'Justin Thomas',     status: 'active', rounds: [-1,-2, 0,-1], live: null },
    9:  { rank: 9,  name: 'Jordan Spieth',     status: 'wd',     rounds: [-1, null, null, null], live: null },
    10: { rank: 10, name: 'Hideki Matsuyama',  status: 'active', rounds: [ 0,-1,-2,-1], live: null },
    11: { rank: 11, name: 'Sahith Theegala',   status: 'active', rounds: [-1, 0,-1, 0], live: null },
    12: { rank: 12, name: 'Tony Finau',        status: 'active', rounds: [+1,-2, 0,-1], live: null },
    13: { rank: 13, name: 'Max Homa',          status: 'active', rounds: [ 0,+1,-1, null], live: { thru: 9,  current: -2 } },
    14: { rank: 14, name: 'Tom Kim',           status: 'active', rounds: [-2, 0,-1, null], live: { thru: 12, current: -1 } },
    15: { rank: 15, name: 'Wyndham Clark',     status: 'active', rounds: [+1,+2,-1, 0], live: null },
    16: { rank: 16, name: 'Sam Burns',         status: 'active', rounds: [-1,-1,-2, 0], live: null },
    17: { rank: 17, name: 'Brian Harman',      status: 'active', rounds: [-2,-1,+1,-1], live: null },
    18: { rank: 18, name: 'Will Zalatoris',    status: 'mc',     rounds: [+3,+2, null, null], live: null },
    19: { rank: 19, name: 'Cameron Young',     status: 'active', rounds: [ 0,-2,-1,-1], live: null },
    20: { rank: 20, name: 'Russell Henley',    status: 'active', rounds: [-1,-3, 0,-1], live: null },
    21: { rank: 21, name: 'Sungjae Im',        status: 'active', rounds: [ 0,+1,-2,-1], live: null },
    22: { rank: 22, name: 'Tommy Fleetwood',   status: 'active', rounds: [-2,-1,-1, 0], live: null },
    23: { rank: 23, name: 'Shane Lowry',       status: 'active', rounds: [-1, 0,-2,+1], live: null },
    24: { rank: 24, name: 'Corey Conners',     status: 'active', rounds: [+1,-1, 0,-2], live: null },
    25: { rank: 25, name: 'Adam Scott',        status: 'mc',     rounds: [+2,+3, null, null], live: null },
    26: { rank: 26, name: 'Matt Fitzpatrick',  status: 'active', rounds: [+1, 0,-1,-2], live: null },
    27: { rank: 27, name: 'Tyrrell Hatton',    status: 'active', rounds: [-1,+1, 0,-1], live: null },
    28: { rank: 28, name: 'Akshay Bhatia',     status: 'active', rounds: [ 0,-1,+1, null], live: { thru: 14, current: 0 } },
    29: { rank: 29, name: 'Min Woo Lee',       status: 'active', rounds: [-1, 0,+2, 0], live: null },
    30: { rank: 30, name: 'Keegan Bradley',    status: 'active', rounds: [+2, 0,+1,-1], live: null },
  };

  // 25 pool entrants. Each picks 5 golfer ranks.
  const ENTRIES = [
    { id: 'e1',  name: 'Keenan Troast',     tiebreaker: -18, picks: [ 1,  6, 16, 22, 14] },
    { id: 'e2',  name: 'Mike Donnelly',     tiebreaker: -15, picks: [ 2,  8, 10, 17, 23] },
    { id: 'e3',  name: 'Sarah Chen',        tiebreaker: -19, picks: [ 3, 19, 20, 11, 26] },
    { id: 'e4',  name: 'Tom Bradley',       tiebreaker: -16, picks: [ 1,  4, 12, 24, 27] },
    { id: 'e5',  name: 'Alex Rivera',       tiebreaker: -14, picks: [ 2,  5, 16, 28, 13] },
    { id: 'e6',  name: 'Pat Murphy',        tiebreaker: -17, picks: [ 3,  6, 17, 21,  7] },
    { id: 'e7',  name: 'Liz Park',          tiebreaker: -13, picks: [ 4, 11, 22, 26, 30] },
    { id: 'e8',  name: 'Dave Cohen',        tiebreaker: -20, picks: [ 1,  8, 14, 20, 18] },
    { id: 'e9',  name: 'Brian Walsh',       tiebreaker: -15, picks: [ 5, 10, 19, 23, 29] },
    { id: 'e10', name: 'Emily Ross',        tiebreaker: -16, picks: [ 2, 12, 16, 17,  9] },
    { id: 'e11', name: 'Sam Becker',        tiebreaker: -14, picks: [ 3,  6, 11, 22, 27] },
    { id: 'e12', name: 'Tyler Vance',       tiebreaker: -18, picks: [ 4,  7, 13, 16, 23] },
    { id: 'e13', name: 'Olivia Reed',       tiebreaker: -17, picks: [ 1,  8, 15, 20, 28] },
    { id: 'e14', name: 'Chris Webb',        tiebreaker: -15, picks: [ 2,  6, 19, 22, 13] },
    { id: 'e15', name: 'Jenny Hartz',       tiebreaker: -16, picks: [ 5, 10, 17, 26, 30] },
    { id: 'e16', name: 'Ben Talbot',        tiebreaker: -14, picks: [ 3,  9, 14, 21, 24] },
    { id: 'e17', name: 'Mark Knox',         tiebreaker: -19, picks: [ 1, 11, 18, 22, 27] },
    { id: 'e18', name: 'Stephanie Yu',      tiebreaker: -15, picks: [ 4,  6, 16, 23, 29] },
    { id: 'e19', name: 'Greg Atkins',       tiebreaker: -13, picks: [ 2,  7, 13, 20, 25] },
    { id: 'e20', name: 'Holly Burch',       tiebreaker: -16, picks: [ 5,  8, 17, 22, 28] },
    { id: 'e21', name: 'Eric Frank',        tiebreaker: -18, picks: [ 3, 12, 19, 24, 30] },
    { id: 'e22', name: 'Nick Vega',         tiebreaker: -14, picks: [ 1,  6, 14, 21, 26] },
    { id: 'e23', name: 'Maddie Reyes',      tiebreaker: -17, picks: [ 2, 10, 16, 17, 27] },
    { id: 'e24', name: 'Ryan Voss',         tiebreaker: -15, picks: [ 4, 11, 19, 22, 29] },
    { id: 'e25', name: 'Drew Halverson',    tiebreaker: -16, picks: [ 1,  8, 18, 23, 30] },
  ];

  function pickSum(g) {
    return g.rounds.reduce((a, b) => a + (b ?? 0), 0);
  }
  function pickRoundsPlayed(g) {
    return g.rounds.filter(r => r !== null && r !== undefined).length;
  }
  function pickLabel(g) {
    if (g.status === 'mc') return 'MC';
    if (g.status === 'wd') return 'WD';
    return null;
  }

  function entryStats(entry) {
    const picks = entry.picks.map(r => ({ ...GOLFERS[r] }));
    const withSum = picks.map(p => ({ ...p, sum: pickSum(p), played: pickRoundsPlayed(p) }));
    const sortedBySum = [...withSum].sort((a, b) => a.sum - b.sum);
    const dropped = sortedBySum[sortedBySum.length - 1];
    const droppedRank = dropped.rank;
    const kept = sortedBySum.slice(0, 4);
    const toPar = kept.reduce((acc, p) => acc + p.sum, 0);
    const minPlayed = Math.min(...kept.map(p => p.played));
    const livePicks = withSum.filter(p => p.live);
    const liveHolesLeft = livePicks.reduce((a, p) => a + (18 - p.live.thru), 0);
    const picksMarked = withSum.map(p => ({ ...p, isDropped: p.rank === droppedRank }));
    return {
      entry, picks: picksMarked, toPar, droppedRank,
      roundsScored: minPlayed,
      livePicks: livePicks.length,
      liveHolesLeft,
    };
  }

  function standings() {
    const rows = ENTRIES.map(entryStats).sort((a, b) => a.toPar - b.toPar);
    // Compute display positions with ties
    let pos = 0, lastScore = null;
    rows.forEach((r, i) => {
      if (r.toPar !== lastScore) { pos = i + 1; lastScore = r.toPar; }
      const tied = rows.filter(x => x.toPar === r.toPar).length > 1;
      r.posDisplay = (tied ? 'T' : '') + pos;
      r.rawPos = pos;
    });
    return rows;
  }

  // Cut penalty: avg of MC/WD golfers' to-par * 4 (simplified for mock)
  function cutPenalty() {
    const cuts = Object.values(GOLFERS).filter(g => g.status === 'mc' || g.status === 'wd');
    if (cuts.length === 0) return null;
    const avg = cuts.reduce((a, g) => a + pickSum(g), 0) / cuts.length;
    return Math.round(avg * 4);
  }

  function fmtToPar(n) {
    if (n === null || n === undefined) return '—';
    if (n === 0) return 'E';
    return n < 0 ? '−' + Math.abs(n) : '+' + n;
  }

  return { PAR, GOLFERS, ENTRIES, entryStats, standings, cutPenalty, pickSum, pickLabel, fmtToPar };
})();
