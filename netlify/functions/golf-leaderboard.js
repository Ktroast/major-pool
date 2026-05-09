// netlify/functions/golf-leaderboard.js
//
// Proxies ESPN's (undocumented) golf leaderboard API from a server, so the
// browser app doesn't have to deal with CORS, user-agent blocks, or ESPN
// changing which URL shape actually works.
//
// Call from the app as: /.netlify/functions/golf-leaderboard
// Optional query params:
//   ?date=YYYYMMDD   — fetch a specific tournament week (Thursday of that tourney)
//   ?debug=1         — include tried-URLs + raw response meta for troubleshooting
//   ?raw=1           — dump the first competitor's ESPN payload verbatim (shape debugging)

// In-memory cache (survives warm invocations, resets on cold start)
let cache = { key: null, data: null, at: 0 };
const CACHE_MS = 2 * 60 * 1000; // 2 minutes

// All the URL shapes we know about, tried in order.
// Documented hobby-project patterns plus ESPN's own internal web app patterns.
function candidateUrls(dateKey, eventId) {
  const base = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga';
  const webBase = 'https://site.web.api.espn.com/apis/site/v2/sports/golf/pga';
  const urls = [];
  // Tournament-specific URLs take priority — these are the most reliable way to hit
  // a particular event (critical for team events like the Zurich Classic, which
  // the generic scoreboard may not surface in a useful shape).
  if (eventId) {
    urls.push(`${base}/leaderboard?event=${eventId}`);
    urls.push(`${base}/scoreboard?event=${eventId}`);
    urls.push(`${webBase}/leaderboard?event=${eventId}`);
    urls.push(`${webBase}/scoreboard?event=${eventId}`);
  }
  if (dateKey) {
    urls.push(`${base}/scoreboard?dates=${dateKey}`);
    urls.push(`${base}/leaderboard?dates=${dateKey}`);
  }
  urls.push(`${base}/scoreboard`);
  urls.push(`${base}/leaderboard`);
  urls.push(`${webBase}/scoreboard`);
  urls.push(`${webBase}/leaderboard`);
  return urls;
}

async function tryFetch(url) {
  const res = await fetch(url, {
    headers: {
      // Pose as a real browser; ESPN's API sometimes 403s bare server UAs
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.espn.com/',
      'Origin': 'https://www.espn.com',
    },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON, probably HTML error page */ }
  return { url, status: res.status, ok: res.ok, json, bodyPreview: text.slice(0, 200) };
}

// Extract a display name from an ESPN competitor, handling both individual
// and team event shapes.
//   Individual events: name is on c.athlete.displayName
//   Team events (Zurich): name is on c.team.name or c.team.displayName
function extractCompetitorName(c) {
  if (!c || typeof c !== 'object') return '';

  // TEAM EVENT SHAPE (Zurich-style) — name lives on the team object
  if (c.type === 'team' || c.team) {
    const t = c.team;
    if (t && typeof t === 'object') {
      return t.displayName || t.name || t.shortDisplayName || '';
    }
  }

  // INDIVIDUAL EVENT SHAPE — name on athlete/player
  const athlete = c.athlete || c.player;
  if (athlete && typeof athlete === 'object') {
    const single = athlete.displayName || athlete.fullName || athlete.name;
    if (single) return single;
  }

  // LAST RESORT — any roster array we can cobble names from
  const roster = c.athletes || c.roster || athlete?.athletes;
  if (Array.isArray(roster) && roster.length > 0) {
    const names = roster
      .map(a => a?.displayName || a?.fullName || a?.name
                 || (a?.athlete && (a.athlete.displayName || a.athlete.fullName || a.athlete.name))
                 || '')
      .filter(Boolean);
    if (names.length > 0) return names.join(' / ');
  }

  return c.displayName || c.name || c.shortDisplayName || '';
}

// Extract per-round scores from ESPN's linescores, INDEXED BY ROUND NUMBER.
// Returns { 1: {relative:-8}, 2: {relative:-3, inProgress:true, holesPlayed:9} }
// In-progress rounds are INCLUDED so the leaderboard can show live running totals.
// The `inProgress` and `holesPlayed` tags let the client distinguish completed
// rounds from partial ones for display ("9 holes left" indicators).
function extractRoundScores(c) {
  const ls = c?.linescores;
  if (!Array.isArray(ls) || ls.length === 0) return {};

  const currentPeriod = c?.status?.period;
  const currentState = (c?.status?.type?.state || '').toLowerCase();
  const inProgressPeriod = currentState === 'in' ? currentPeriod : null;

  const out = {};
  ls.forEach((entry, idx) => {
    if (entry === null || entry === undefined) return;
    if (typeof entry === 'number') {
      out[idx + 1] = entry;
      return;
    }

    const period = (typeof entry.period === 'number') ? entry.period : (idx + 1);
    const isInProgress = inProgressPeriod !== null && period === inProgressPeriod;

    // For in-progress rounds, count holes played from the nested per-hole linescores.
    let holesPlayed = null;
    if (isInProgress && Array.isArray(entry.linescores)) {
      holesPlayed = entry.linescores.filter(h =>
        h && (typeof h.value === 'number' || (typeof h.displayValue === 'string' && h.displayValue !== ''))
      ).length;
    }

    // Skip entries that have no usable score data (a "started but no holes yet" shell)
    const hasValue = typeof entry.value === 'number';
    const hasDisplay = typeof entry.displayValue === 'string' && entry.displayValue !== '';
    if (!hasValue && !hasDisplay) {
      // It's a placeholder (period marker only) — not actually scored yet
      return;
    }

    // Build the round's score object
    let scoreObj;
    const dv = entry.displayValue;
    if (typeof dv === 'string') {
      const trimmed = dv.trim();
      if (trimmed === 'E' || trimmed === 'e') {
        scoreObj = { relative: 0 };
      } else if (/^[-−+]/.test(trimmed)) {
        const n = Number(trimmed.replace(/−/g, '-'));
        if (!isNaN(n)) scoreObj = { relative: n };
      } else {
        const plain = Number(trimmed);
        if (!isNaN(plain)) scoreObj = plain;
      }
    }
    if (scoreObj === undefined && typeof entry.value === 'number') {
      scoreObj = entry.value;
    }
    if (scoreObj === undefined) return;

    // Tag in-progress rounds with metadata
    if (isInProgress) {
      // Convert numbers to objects so we can attach metadata
      const obj = (typeof scoreObj === 'object') ? scoreObj : { relative: null, raw: scoreObj };
      obj.inProgress = true;
      if (holesPlayed !== null) obj.holesPlayed = holesPlayed;
      out[period] = obj;
    } else {
      out[period] = scoreObj;
    }
  });

  return out;
}

// Normalize a raw ESPN response into the shape the app expects.
function normalize(raw) {
  if (!raw) return { tournament: null, players: [], reason: 'no-body' };
  const events = raw.events || (raw.leaderboard ? raw.leaderboard.events : null) || [];
  if (!events.length) return { tournament: null, players: [], reason: 'no-events' };
  const ev = events[0];
  const comp = (ev.competitions || [])[0];
  const competitors = comp?.competitors || ev.competitors || [];
  const tournament = {
    id: ev.id,
    name: ev.name || ev.shortName,
    status: ev.status?.type?.state,
    statusDetail: ev.status?.type?.description || ev.status?.type?.name,
  };
  if (!competitors.length) return { tournament, players: [], reason: 'no-competitors' };

  const tournamentState = ev.status?.type?.state; // "pre", "in", "post"
  const players = competitors.map(c => {
    const name = extractCompetitorName(c);
    const rounds = extractRoundScores(c);
    // Status detection. ESPN reports player status in several places with several
    // different strings: "withdrawn", "WD", "did not start", "cut", "missed cut",
    // "MC", and sometimes nothing meaningful. We check multiple fields and look
    // at the strings broadly.
    const desc = (c.status?.type?.description || '').toLowerCase();
    const name_  = (c.status?.type?.name || '').toLowerCase();
    const detail = (c.status?.type?.detail || '').toLowerCase();
    const short  = (c.status?.type?.shortDetail || '').toLowerCase();
    const all = `${desc} ${name_} ${detail} ${short}`.toLowerCase();
    const isWd = /\b(wd|withdrawn|withdraw|did\s*not\s*start|dns|disqualified|dq)\b/i.test(all);
    const isCut = !isWd && /\b(cut|mc|missed)\b/i.test(all);
    // INFERENCE: if the tournament is in-progress and a player has zero rounds
    // recorded but no obvious status string, they probably WD'd. (Legitimate
    // "hasn't teed off yet" players will still have status "pre" and we keep
    // them active to populate later.)
    const inferredWd = (tournamentState === 'in' || tournamentState === 'post')
                       && Object.keys(rounds || {}).length === 0
                       && !isWd && !isCut;
    return {
      name,
      rounds,
      status: (isWd || inferredWd) ? 'wd' : isCut ? 'mc' : 'active',
      espnStatus: (desc || name_ || detail || short || (inferredWd ? 'inferred-wd' : '')),
    };
  }).filter(p => p.name);

  return { tournament, players, reason: players.length === 0 ? 'no-names' : undefined };
}

exports.extractRoundScores = extractRoundScores;
exports.normalize = normalize;

exports.handler = async function(event) {
  const qs = event.queryStringParameters || {};
  const dateKey = (qs.date || '').trim() || null;
  const eventId = (qs.event || '').trim() || null;
  const debug = qs.debug === '1';
  const raw = qs.raw === '1'; // dump first competitor object verbatim for shape inspection

  // CORS headers so your deployed app can call this even on a different domain
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  // Serve from cache if fresh and same key
  const cacheKey = `${eventId || ''}|${dateKey || ''}` || '__current__';
  if (cache.key === cacheKey && cache.data && (Date.now() - cache.at) < CACHE_MS) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ ...cache.data, cached: true, cacheAgeMs: Date.now() - cache.at }),
    };
  }

  const attempts = [];
  let bestPartial = null; // remember a response that had a tournament but no scores yet
  let rawCompetitor = null; // first competitor seen, for shape debugging
  for (const url of candidateUrls(dateKey, eventId)) {
    try {
      const r = await tryFetch(url);
      attempts.push({ url: r.url, status: r.status, hadJson: !!r.json, bodyPreview: debug ? r.bodyPreview : undefined });
      if (!r.ok || !r.json) continue;

      // Capture first competitor for raw debugging before normalization
      if (raw && !rawCompetitor) {
        try {
          const events = r.json.events || (r.json.leaderboard ? r.json.leaderboard.events : null) || [];
          const c0 = events[0]?.competitions?.[0]?.competitors?.[0];
          if (c0) rawCompetitor = c0;
        } catch (_) {}
      }

      const normalized = normalize(r.json);
      if (!normalized) continue;

      // If we got players, this is a full success
      if (normalized.players && normalized.players.length > 0) {
        const payload = {
          ok: true,
          ...normalized,
          fetchedAt: new Date().toISOString(),
          sourceUrl: r.url,
          debug: debug ? { attempts } : undefined,
          rawCompetitor: raw ? rawCompetitor : undefined,
        };
        cache = { key: cacheKey, data: payload, at: Date.now() };
        return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(payload) };
      }

      // Players empty but tournament resolved — stash as a fallback
      if (normalized.tournament && !bestPartial) {
        bestPartial = { normalized, url: r.url };
      }
    } catch (e) {
      attempts.push({ url, error: e.message });
    }
  }

  // If no endpoint returned players but at least one resolved a tournament,
  // return 200 with empty players + the tournament info + a `reason` so the app
  // can display "tournament is pre-start / awaiting first scores" instead of failing.
  if (bestPartial) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        ok: true,
        tournament: bestPartial.normalized.tournament,
        players: [],
        reason: bestPartial.normalized.reason || 'no-scores-yet',
        fetchedAt: new Date().toISOString(),
        sourceUrl: bestPartial.url,
        debug: debug ? { attempts } : undefined,
        rawCompetitor: raw ? rawCompetitor : undefined,
      }),
    };
  }

  return {
    statusCode: 502,
    headers: corsHeaders,
    body: JSON.stringify({
      ok: false,
      error: 'No ESPN endpoint returned a usable leaderboard',
      attempts: debug ? attempts : attempts.map(a => ({ url: a.url, status: a.status, hadJson: a.hadJson })),
      fetchedAt: new Date().toISOString(),
    }),
  };
};
