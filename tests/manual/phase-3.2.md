# Manual test plan — phase 3.2 (commissioner pool locking)

Walk through each scenario on the Netlify preview before merging the branch.
The deploy must include both the schema migration (run in Supabase dashboard
SQL editor — see `supabase/schema.sql`) and the latest branch HEAD.

**Prep**
- Apply the SQL from `supabase/schema.sql` for `pools.locked_at` and the new
  entries RLS policies.
- Open two browser sessions on the preview URL: one **commissioner**
  (creator of the pool), one **non-commissioner** (incognito or different
  browser). Both should be on the same pool via its `/pin/{PIN}` URL.

---

## 1. Lock from commissioner side
- [ ] Commissioner creates a pool and submits at least one entry.
- [ ] In Setup tab, click **Lock Pool** → confirmation modal shows the
      explanatory copy.
- [ ] Confirm → modal closes, status line reads `Locked <date> <time> —
      entries closed`, toast `Pool locked.` appears.

## 2. Lock blocks non-commissioner writes via RLS
- [ ] In the non-commissioner browser console, run (substitute the real
      pool UUID — visible in any `entries` row's `pool_id`, or via the
      Supabase dashboard):
      ```js
      sb.from('entries').insert({
        pool_id: '<pool-uuid>',
        name: 'rls-test',
        picks: [1,2,3,4,5],
        tiebreaker: -10
      }).then(r => console.log('write result:', r));
      ```
- [ ] Result has an `error` (RLS violation: code `42501` or message
      mentioning `row-level security policy`). **If the insert succeeds,
      the policy is broken — stop and fix before merging.**

## 3. Lock blocks non-commissioner writes via client guard
- [ ] Non-commissioner opens **My Picks** tab.
- [ ] Pick form is hidden; the `banner-info` "This pool is locked…" banner
      is visible in its place.
- [ ] If somehow the form is reachable (e.g. the lock arrived mid-edit via
      realtime), hitting Save fires the `Pool is locked. Contact the
      commissioner.` toast and no Supabase call is made.

## 4. Lock hides Edit on entries list for non-commissioners
- [ ] Non-commissioner opens **Entries** tab.
- [ ] All entries are visible (read-only) including their own — no Edit
      button on any row.

## 5. Commissioner still has full access while locked
- [ ] Commissioner edits an entry → save succeeds, list updates.
- [ ] Commissioner deletes an entry → succeeds.
- [ ] Commissioner submits a new entry → succeeds (lock doesn't gate the
      commissioner's own writes).

## 6. Unlock restores access
- [ ] Commissioner clicks **Unlock Pool** → confirmation → confirm →
      status line clears, toast `Pool unlocked.`
- [ ] Non-commissioner refreshes (or waits for realtime) → pick form is
      back, Edit buttons return on their own entry.

## 7. Re-lock works
- [ ] Lock → Unlock → Lock again. State transitions cleanly each time;
      no stale UI from previous toggles.

## 8. Realtime propagation (best effort)
- [ ] Non-commissioner has the pool open in a tab.
- [ ] Commissioner locks the pool from another tab.
- [ ] Within ~5 seconds, the non-commissioner view reflects the lock —
      pick form swaps to the banner, Edit buttons disappear — without a
      hard reload.

`subscribeToChanges` already listens for `UPDATE` on `pools` and
`renderAll`'s on payload, so `locked_at` should propagate automatically.
If for any reason it doesn't, refresh-to-see is acceptable for the PGA
weekend deadline — note it here and follow up post-tournament.
