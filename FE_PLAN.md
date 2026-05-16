# FE_PLAN.md — Scoreboard redesign migration plan

## What this is

A plan to bring the hybrid scoreboard design and the new UI behaviors
from `test/pga-championship-live.html` into the production
single-page app at `index.html`.

Origin branch: `test-direction-3-cards-hybrid`. The branch adds exactly
one file vs `main` (the standalone test page); `index.html` is
unmodified so far. This document describes how to fold the design back
in without disturbing the production data path, scoring engine, or
auth/lock invariants.

## Inventory of what's in the test branch

### The standalone page

`test/pga-championship-live.html` (~1,200 lines): a self-contained
HTML file with inline CSS + JS. Pulls live ESPN data through the same
proxy production uses, but uses its own placeholder entries when no
`?pin=` is supplied. It is NOT wired into the production routing or
the production scoring engine — it's a design + UX prototype.

### Visual design — "Editorial + Cards" hybrid

- Typography: Playfair Display (italic display), Barlow Condensed
  (numbers, headings, KPI band), Barlow (body).
- Palette tokens (CSS variables, in the test page's `<style>`):
  `--ink #0F1B33`, `--ink-muted #475569`, `--ink-faint #94A3B8`,
  `--paper #FAF7F2`, `--paper-alt #F2EDE4`, `--paper-card #FFFFFF`,
  `--hairline #E5DED1`, `--amber #D97706`, `--red #B91C1C`.
- Layout sections, top-to-bottom:
  1. Masthead — wordmark + nav (Scores / Entries / Setup).
  2. Tournament hero — status pill + live-dot, big italic serif
     headline, course subtitle, refresh button.
  3. KPI strip — Round · Cut Penalty · Entries · Live picks · Format.
  4. Editor's note (informational, can show pool-lock / placeholder
     state).
  5. The Leaders — three feature cards for top 3. Card 1 inverted
     dark-navy fill; cards 2 and 3 paper-card. Each card has rank,
     team total, team name + editorial deck line, 5-pick roster, and
     a "Best 4 counted · tier X dropped" footer.
  6. Sticky filter — section heading + search input.
  7. The Field — desktop dense 12-col grid (`#lbDesktop`); mobile
     compact card stack (`#lbMobile`). Both share data, swap by media
     query at 900px.

### New UI behaviors (added in this session)

Each item below is implemented in `test/pga-championship-live.html`
and will need a counterpart in `index.html`.

- **Tier display 1–5** (internal model keeps A–E so scoring and
  storage are unchanged; only the rendered chip text and the prose
  labels read "1 / 2 / 3 / 4 / 5" and "Tier 2 dropped"). Helper:
  `tierLabel(letter)`.
- **Round-by-round detail panel** — each entry row (desktop and
  mobile) expands inline to reveal:
  - A 6-column mini table: Pick · R1 · R2 · R3 · R4 · Sum.
  - Round cells show `fmtToPar(relative)` or `—` for missing data.
  - Round cells whose round is in progress render score + amber
    `THRU N` (`roundCellHtml` reads `{relative, inProgress,
    holesPlayed}` from `pickRoundsDetailed`).
  - Per-pick status line under the name: `Thru R2`, `R2 in progress
    · thru 11`, `Missed cut`, `Withdrew`, `Player not found`, or
    `Has not started` (`pickStatusHtml(p)`).
  - The dropped pick is opacity-dimmed and strike-through.
  - Best-4-of-5 rollup math: `(−1) + (−2) + E + (−4) = −7` plus a
    big total on the right.
- **Expand-row interaction model**:
  - Row trigger is `role="button"` + `tabindex="0"` with
    `aria-expanded` / `aria-controls`.
  - Collapsed panel uses `inert` + `aria-hidden`, so focus and AT
    skip it.
  - One row open at a time. Opening row B auto-closes A.
  - Animation uses CSS `grid-template-rows: 0fr ↔ 1fr` so content
    auto-sizes; respects `prefers-reduced-motion`.
  - Keyboard: Enter/Space toggles, ArrowUp/Down moves focus to
    sibling row, Home/End jump, Escape closes the open panel.
  - State (`expandedId`) is preserved across re-renders; the filter
    re-render reapplies the open state if the row is still visible,
    else clears it.
- **Round column** in the desktop grid (renamed from "Thru" to
  "Round"):
  - If any pick on the team has a round in progress, the cell
    renders `R{N} live` in amber with a live-dot, and the row gets
    the amber left-border `is-live` treatment.
  - Otherwise: `Thru R{N}` only when every one of the 5 picks has
    completed round N (`minAllPlayed`, computed across all picks
    rather than the counted 4).
  - `—` when any pick has no usable round data.
- **Leader cards (top 3) include per-pick status**, with palette
  overrides on the inverted card so amber stays amber and red shifts
  to a light-red on the navy fill.

### What is NOT in the test branch (and shouldn't be in this work)

- Score overrides (`pools.score_overrides`). The test page reads raw
  ESPN; production must layer overrides on top.
- Realtime subscription to `entries` / `pools` UPDATE events.
- Anonymous Supabase auth, hub routing, account claiming.
- Path-based routing (`/pin/{pin}`).
- Schema or proxy changes.

The test page's masthead nav reads "Scores · Entries · Setup" but
those are flat anchors that don't switch views — they're visual
placeholders. The production app has a real six-tab switcher,
commissioner-only views, a pin banner, a locked-state banner, and a
tab-count badge on Entries. All of those need a home in the new
design and are covered in the section below.

## Production tab inventory (real shape of the app)

Pulled from `index.html`:

| Tab | data-tab | Visible to | Purpose |
|---|---|---|---|
| Leaderboard | `leaderboard` | everyone | The standings view. **This is what the test page is a redesign of.** |
| Entries | `entries` | everyone | List of all entries with a count badge (`#tab-entries-count`). Write access depends on `pool.locked_at` + role. |
| My Picks | `picks` | everyone | The current user's own entries (anonymous or claimed). |
| Scores | `scores` | commissioner only (`.commish-visible`) | Per-golfer override entry — rounds + MC/WD status. Writes `pool.score_overrides`. |
| Setup | `setup` | commissioner only | Golfer pool config, tournament `espn_event_id`, lock/unlock toggle. |
| House Rules | `rules` | everyone | Static rules content. |

Other prod-only chrome on the pool page:

- `#pin-banner` (line 162) — sticky banner above the tabs showing
  the 6-character pool PIN and a share URL of the form
  `https://putalittledrawonit.netlify.app/pin/{PIN}`. Rendered by
  `renderPinBanner()` (line 1027).
- `.commissioner-only` / `.commish-visible` toggle — `setView()`
  flips `hidden` on these elements based on `isCommissioner`. The
  Scores and Setup tabs, plus a few inline action buttons, are
  gated this way.
- Locked-state banner — when `pool.locked_at` is non-null, a line
  reading `Locked {timestamp} — entries closed` appears (line 1536)
  and the pick form is replaced with a read-only notice
  (line 1387). The lock toggle itself lives on the Setup tab
  (line 2158-2175).

## Tab-by-tab plan

The Leaderboard tab is the main target. Other tabs get smaller,
targeted treatments so the visual language stays consistent without
expanding the scope dangerously.

### Leaderboard tab — full redesign

Owned by Phases 1–8 of the migration. This is where the hero, KPI
strip, leader cards, sticky filter, expand panel, and Round-column
logic land.

### Entries tab — visual refresh only, no structural change

- Restyle the entries list to use `.row-card` (mobile) /
  `.lb-row-wrap` (desktop) so the typography matches the
  Leaderboard.
- Each entry row shows: entry name, picks (1–5 with tier chips),
  tiebreaker, an Edit button when permissions allow.
- Tab count badge (`#tab-entries-count`) stays. Restyle as a small
  pill using `--ink-faint` background.
- Pick form (when adding/editing) inherits the new input styling
  defined in Phase 1.
- No expand-panel here — the picks are already shown inline and
  there's no round-by-round detail to surface on the Entries tab.

### My Picks tab — visual refresh only

- Same restyling as Entries. Renders only the rows belonging to the
  current `auth.uid()`.
- Show the same locked-state messaging that Entries shows when the
  pool is locked and the user isn't commissioner.

### Scores tab (commissioner) — visual refresh, keep all controls

- The override entry UI (per-golfer rounds, MC/WD toggle) keeps its
  existing form behavior — it writes `pool.score_overrides`, and
  that contract must not change.
- Restyle the override grid using the new tokens: hairline
  borders, paper-alt backgrounds, condensed numerics. The per-round
  inputs become `<input type="text">` with the new input styling
  from Phase 1.
- A small "Overridden" footnote treatment is defined here for use
  in the expand panel (Phase 7), so the visual treatment is
  consistent in both places.

### Setup tab (commissioner) — visual refresh, keep all controls

- Golfer table, ESPN event ID, lock toggle keep their existing
  behavior.
- Lock toggle becomes a single full-width button styled like the
  Refresh button: amber when unlocked ("Lock entries"), navy when
  locked ("Unlock entries"). The confirmation modal copy stays the
  same.
- Locked-state banner moves UP to be displayed below the pin banner
  on every tab (not just Setup), so the lock status is always
  visible. This is a UX upgrade enabled by the redesign.

### House Rules tab — minor copy/typography pass only

- Re-typeset using the new font stack. No content changes.

### Pin banner — restyle, keep functionality

- Replace the current pin banner styling with a thin strip
  immediately under the masthead reading
  `POOL · {PIN}` plus a "Copy link" affordance.
- Should remain sticky as it is now, sitting above the tab switcher.
- `renderPinBanner()` keeps its current responsibilities (read
  `pool.pin`, compute share URL, render). The HTML it generates is
  what changes.

### Tab switcher itself

- Move the tab nav into the masthead area so it visually pairs
  with the wordmark. On mobile, collapse to a horizontally
  scrollable strip with active-tab underline.
- `showTab(name)` (line 1579) keeps its current behavior. The
  `commish-visible` toggle in `setView()` (line 1559) keeps working
  because the new tabs preserve those class names.

## Production integration touchpoints

`index.html` already has:

- `cutPenalty(par, pool)` — line 584.
- `golferScore(g, par, pool)` — line 590.
- `entryBest4(entry, par, pool)` — line 596.

These three functions are the production scoring engine. They take
`pool` as a parameter (per CLAUDE.md) and apply `score_overrides`
and cut-penalty rules that the test page does NOT apply. The new
render code must read its sums and per-pick state from these,
not re-derive scoring.

The test page's own `pickSum` / `entryStats` exist because the test
page has no `pool` and no overrides. Treat them as design-time
scaffolding, not as production helpers.

### Production data shape vs test data shape

The new render functions need a per-row payload that looks roughly
like the test page's `row` object:

```
row = {
  entry: { id, name, tiebreaker },
  picks: [{
    tier: 'A'..'E',
    name,
    sum,            // to-par sum, with cut penalty applied per prod rules
    rawSum,
    status: 'active' | 'mc' | 'wd' | 'unknown',
    live,           // { thru, round } | null
    played,         // count of rounds with usable to-par
    rounds: [       // index 0 = R1, ... 3 = R4
      { relative, inProgress, holesPlayed }, ...
    ],
    isDropped,
  }, ×5],
  droppedTier,
  total,
  livePicks,
  liveRound,        // round number of any in-progress pick, else null
  minPlayed,        // min played across the 4 counted picks
  minAllPlayed,     // min played across all 5
  posDisplay,       // T-prefixed rank string
}
```

The Round column and the expand panel both depend on `liveRound`,
`minAllPlayed`, and per-pick `rounds[]` + `live` + `played`. None
of these are produced by the prod helpers today, so a new adapter
function will need to build them on top of the prod scoring output.

## Phased plan

Each phase is a single reviewable change. Land them in order — every
phase ends with the production page still rendering correctly.

### Phase 1 — Design tokens and fonts

- Add the Google Fonts `<link>` for Playfair Display, Barlow,
  Barlow Condensed.
- Add the `:root` CSS variables (palette tokens above) to the prod
  stylesheet.
- Add the utility classes that the design relies on but Tailwind
  doesn't already give us: `.font-display`, `.font-editorial`,
  `.tabular`, `.hairline`, `.ink-muted`, `.ink-faint`, `.big-num`.
- Add chip / score / dropped / pick-flag / pick-status / round-live
  CSS exactly as in the test page (no behavior yet — just styles
  ready to be applied).

**Acceptance**: no visual change in prod (classes are dormant).
Snapshot diff should be empty until later phases attach them.

### Phase 2 — Helper functions (pure, no DOM)

Port these from the test page into `index.html`:

- `fmtToPar`, `scoreClass`, `tierLabel`, `normName`.
- `roundRelative(r)`, `roundInProgress(r)`, `roundHolesPlayed(r)` —
  these tolerate the proxy's two round shapes (bare number or
  object) and are required reading for the new render code.
- `pickRoundsDetailed(player)` — returns the 4-element
  `[{relative, inProgress, holesPlayed}, ...]` array used by the
  panel.
- `pickStatusHtml(p)`, `entryRoundHtml(row)`, `roundCellHtml(detail)`,
  `expandPanelHtml(row, panelId)`, `rowIdAttr(row)`.

Leave the existing scoring functions (`cutPenalty`, `golferScore`,
`entryBest4`) alone.

**Acceptance**: helpers exist and unit-test (where applicable);
nothing yet calls them.

### Phase 3 — `buildScoreboardRows(entries, players, pool)` adapter

A new function that takes the production scoring outputs and
produces the row shape documented above. Should:

- Call `entryBest4(entry, par, pool)` to get the team total and
  picks-with-sums that respect overrides + cut penalty.
- For each pick, look up the resolved ESPN player to populate
  `rounds`, `live`, `played`, `status`.
- Compute `droppedTier` by sorting picks the same way the prod
  scoring engine does — verify it matches `entryBest4`'s logic.
- Compute `liveRound`, `minAllPlayed`, `livePicks`.

**Acceptance**: feeding real Supabase entries through this adapter
produces rows whose `total` matches `entryBest4`'s output to the
unit. Add a test alongside `tests/scoring.test.js`.

### Phase 4 — New Leaderboard-tab markup

Replace the current `panel-leaderboard` HTML in `index.html` with
the new sections (hero, KPI strip, editor's note, leader cards,
sticky filter, mobile + desktop field containers).

Restyle but do not restructure: the masthead wordmark, the pin
banner (`renderPinBanner`), the tab switcher (`#pool-tabs`),
the locked-state banner. `showTab(name)` (line 1579) and the
`commish-visible` toggle in `setView()` (line 1559) must keep
working — the new tab markup preserves the same class names and
data-tab attributes.

The other tab panels (`panel-entries`, `panel-picks`,
`panel-scores`, `panel-setup`, `panel-rules`) are touched only
enough to absorb the new typography variables (Phase 1 already
made the tokens available — applying them here is non-functional).

**Acceptance**: page still loads; the Leaderboard tab shows the new
shell even with empty data; switching to other tabs still works
and they look subtly refreshed (font stack) but unchanged in
behavior; commissioner-only tabs still hide for non-commish users.

### Phase 5 — Wire render functions to live data

Add the rendering counterparts from the test page:

- `featuredCardHtml(row, idx)`.
- `mobileRowHtml(row)`.
- `desktopRowHtml(row)`.
- `renderHeader(rows, tournament, cutPenaltyVal)`,
  `renderFeatured()`, `renderField(filter)`.

Replace the old leaderboard render. The data source is the adapter
from Phase 3, not the placeholder generator (which is test-only).

**Acceptance**: prod leaderboard renders with the new visuals;
totals match what the current prod page shows for the same
tournament/pool snapshot.

### Phase 6 — Expand-row state machinery

Bring over `expandedId` state, `applyExpandState()`,
`toggleExpand()`, `focusSiblingTrigger()`, `attachRowHandlers()`.
Wire delegated click+keydown handlers to `#lbMobile` and
`#lbDesktop`. Reapply state at the end of `renderField()` so the
filter input + realtime updates don't drop the open panel.

**Acceptance**: clicking a row expands it; only one open at a time;
Enter/Space toggle, Up/Down navigate, Escape closes. Lighthouse
accessibility audit clean.

### Phase 7 — Score overrides + lock-state in the panel

The expand panel as it stands in the test page reads ESPN-only
data. In production:

- Per-round overrides come from `score_overrides`. The panel's
  R1–R4 cells need to render override values when present, with a
  visual hint that the round was overridden (footnote? dotted
  underline? to be decided in this phase, not earlier).
- If the pool is locked (`pools.locked_at != null`) the panel must
  not surface Edit affordances on individual picks (currently
  there's only the read view, so this is preventative — applies
  later if we add a pick-level edit shortcut from the panel).

**Acceptance**: panel matches the Scores-tab override values for an
entry whose pool has any non-empty `score_overrides`.

### Phase 8 — Realtime + refresh

The existing realtime subscription (`subscribeToChanges()`) and
the 5-minute live-score poll both need to call into the new
`renderField()` (state-preserving) rather than the old render. No
new subscriptions needed.

**Acceptance**: updating an entry in one tab causes the other tab's
panel to update without losing the open row.

### Phase 9 — Tier label flip across all tabs

- Sweep `tierLabel` through every place a tier letter is shown to
  a user: Leaderboard rows + expand panel (already done via the
  helpers in Phase 2), Entries tab roster display, My Picks roster
  display, Scores override grid headers, Setup golfer roster.
- Update static copy: "Tier A dropped", "(A·B·C·D·E)", column
  headers, in-form hints, House Rules content if it references
  tiers.
- A–E remains the internal identifier in `score_overrides`, in
  the picks payload, and in the scoring engine. Nothing changes
  in the database or the proxy.

**Acceptance**: no user-facing "A/B/C/D/E" tier label remains;
internal references in the DB and `entryBest4` are untouched;
existing tests still pass.

### Phase 10 — Pin banner and locked-state banner restyle

- New `renderPinBanner()` markup: a thin strip below the masthead,
  reading `POOL · {PIN}` with a Copy-link affordance. Same sticky
  behavior, same share-URL format (`/pin/{PIN}`).
- Promote the locked-state banner so it renders on every tab (not
  just Setup), immediately below the pin banner. This way the user
  always knows whether the pool is open or closed.
- Lock toggle on Setup becomes a wide button styled like the
  Refresh button — amber for "Lock entries", navy for "Unlock
  entries". Confirmation modal copy unchanged.

**Acceptance**: pin banner visible and copyable on every tab;
locked state visible from every tab; lock toggle still requires
the existing two-click confirmation flow.

### Phase 11 — Other tabs visual refresh

The lightest pass — apply the new design tokens to the inner HTML
of `panel-entries`, `panel-picks`, `panel-scores`, `panel-setup`,
`panel-rules` without changing their behavior. Specifically:

- Restyle entry rows as `.row-card` / `.lb-row-wrap` so they match
  the Leaderboard typography. No expand panel here — the picks
  are already shown inline.
- Restyle inputs (golfer-name picker, override numerics, etc.) per
  the input rules added in Phase 1.
- Re-pad the override grid on the Scores tab with hairline borders
  and paper-alt backgrounds.

This phase is the largest in line count but the smallest in risk —
no logic changes, only swap class names and tweak padding.

**Acceptance**: no behavior change on these tabs; all existing
buttons (Save entry, Add golfer, Save scores, Lock, etc.) still
fire the same handlers and produce the same writes; the visual
language matches Leaderboard.

## Risks and open questions

- **Tier ordering for the dropped pick**. The test page sorts picks
  by `sum` ascending and drops the worst. `entryBest4` does the
  same thing, but its sort comparator includes cut-penalty handling
  and overrides. The adapter must use the same ranking the prod
  engine produces, not recompute it. Mismatch here means the panel
  would strike through the wrong row.
- **`liveRound` when multiple picks are in different in-progress
  rounds**. Realistically all live picks are in the same round
  (golfers tee off in waves but the round number is shared). The
  test code takes the first live pick's round. Confirm this matches
  what ESPN actually returns mid-Saturday.
- **`played` count vs MC/WD**. `pickRoundsPlayed` counts rounds
  with usable to-par. MC/WD picks freeze at `played = 2` (or
  wherever they exited). The Round column's "Thru R{N}" requirement
  ("everyone completed N") is intentionally strict — this means an
  MC pick prevents the team from ever advancing past "Thru R2".
  That's the design as discussed in this session; flagging it here
  so it doesn't get rediscovered as a bug.
- **Sticky filter bar over the leader cards**. The filter section
  is `position: sticky; top: 0;` and sits below the leader cards
  in source order. On long scrolls it sticks; on the Scores tab
  switch, the cards push it out of view. Verify against the prod
  tab-switcher which may have its own sticky header.
- **Mobile viewport detection**. The breakpoint is 900px. The
  existing prod app may already render at narrower widths with a
  different layout — pick one. Recommendation: adopt the test
  page's 900px boundary uniformly.
- **Tailwind CDN**. The test page uses
  `<script src="https://cdn.tailwindcss.com">`. Production already
  uses Tailwind, so this is moot — but confirm the prod Tailwind
  config emits the utility classes the new markup uses
  (`grid-cols-12`, `space-y-2`, `font-medium`, etc.). If prod
  uses a stripped JIT config, some classes may be missing.

## Out of scope (do not bundle into this work)

- Auth migration phases (PLAN_AUTH.md).
- Hub routing changes, anonymous-to-claimed flows, account claiming
  modal copy — these stay as PLAN_AUTH.md has them.
- Schema or RLS changes.
- Proxy or `golf-leaderboard.js` changes.
- Any change to scoring rules, best-4-of-5 logic, cut-penalty math,
  or the `score_overrides` storage shape.
- Adding new tabs or new commissioner capabilities. The plan covers
  visual + behavioral refresh of existing surfaces only.

## File touch summary

- `index.html` — the entire migration lives here. No new files.
  Phases touch, in order: `<head>` (Phase 1 tokens), top-of-script
  helpers (Phase 2), scoring adapter (Phase 3), `panel-leaderboard`
  HTML (Phase 4), render functions (Phase 5), event handlers and
  state (Phase 6), override path inside the panel (Phase 7),
  realtime/refresh entry points (Phase 8), tier-label callsites
  across all tabs (Phase 9), `renderPinBanner` and the locked-state
  banner (Phase 10), the inner HTML of every other tab (Phase 11).
- `test/pga-championship-live.html` — keep as the design reference
  while phases land; can be deleted after Phase 11 if nothing else
  pins it.
- `tests/scoring.test.js` — extended (not replaced) in Phase 3 to
  cover `buildScoreboardRows`. No other test files touched.
