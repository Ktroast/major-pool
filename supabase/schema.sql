-- supabase/schema.sql
--
-- Defines the tables used by The Major Pool.
-- This file is documentation — the live schema lives in Supabase and was
-- never created from a migration. If you ever need to recreate it, run this
-- against a fresh Supabase project (SQL editor or psql).
--
-- Ground truth: the insert/select calls in the SUPABASE OPERATIONS section
-- of index.html (~line 536).
--
-- APPLYING CHANGES
-- There is no migration tooling. To apply schema changes:
--   1. Open the Supabase dashboard → SQL editor.
--   2. Paste and run the relevant CREATE TABLE / ALTER TABLE / policy SQL.
--   3. Update this file to match what's now live.

-- ---------------------------------------------------------------------------
-- pools
-- ---------------------------------------------------------------------------
-- One row per pool. Created via createPool(); updated via updatePool().
-- The PIN is the public share key; commissioner_key is the admin secret.

CREATE TABLE pools (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pin              text        UNIQUE,
    name             text,
    par              integer     DEFAULT 72,
    fee              integer     DEFAULT 0,
    prize1           integer     DEFAULT 0,
    prize2           integer     DEFAULT 0,
    commissioner_key text,
    golfers          jsonb       DEFAULT '[]',
    score_overrides  jsonb       DEFAULT '{}',
    espn_event_id    text,
    updated_at       timestamptz,
    locked_at        timestamptz                                  -- phase 3.2: non-null = entries closed
);

-- locked_at (added phase 3.2 — commissioner pool locking)
--   NULL              -> pool is open; anyone with the PIN may create/edit entries
--   timestamptz value -> pool is locked; only the pool's commissioner may write entries
-- Toggled by the commissioner from the Setup tab. RLS enforcement on entries
-- below; client-side guard in upsertEntry() is a UX nicety, not a security boundary.
--
-- Apply to existing Supabase project:
--   ALTER TABLE pools ADD COLUMN locked_at timestamptz;
-- (No backfill needed — existing pools default to NULL = unlocked.)

-- golfers shape (array):
--   [{name, rank, rounds: [r1|null, r2|null, r3|null, r4|null],
--     roundsMeta: [...], status, unmatched}]
--
-- score_overrides shape (object):
--   { "<rank_str>": { status?: "active"|"wd"|"mc", rounds?: [r1|null, ...] } }
--   Keys are String(rank). Values override ESPN-sourced data.

-- ---------------------------------------------------------------------------
-- entries
-- ---------------------------------------------------------------------------
-- One row per entrant. Created/updated via upsertEntry(); ordered by
-- created_at in fetchEntries().

CREATE TABLE entries (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id     uuid        REFERENCES pools(id),
    name        text,
    picks       jsonb,
    tiebreaker  integer,
    created_at  timestamptz DEFAULT now()
);

-- picks shape (array, one rank per tier):
--   [rank1, rank2, rank3, rank4, rank5]
--   Each value is the OWGR rank of the selected golfer (integer).
--   Tiers: 1–10, 11–20, 21–30, 31–40, 41+.

-- RLS for entries (added phase 3.2 — commissioner pool locking)
-- ------------------------------------------------------------------
-- The lock check is enforced server-side: writes are blocked when the
-- parent pool's locked_at is non-null, except for the pool's commissioner
-- (identified by a row in user_pools with role='commissioner').
--
-- These policies replace any prior INSERT/UPDATE policies on entries.
-- SELECT and DELETE remain unrestricted (anyone with the PIN can read;
-- the commissioner's delete-entry button is the only DELETE caller).
-- The policies only cover INSERT and UPDATE — those are the actions
-- the lock prevents.
--
-- Pre-existing permissive policies are dropped explicitly because Postgres
-- RLS combines policies with OR semantics — leaving a `USING (true)` policy
-- in place would silently bypass the lock-aware policies below. Production
-- shipped initially with the lock visibly enabled in the UI but writes still
-- accepted server-side; the cleanup drops were added to schema.sql after the
-- fact so any environment re-applying this file ends up in the same four-
-- policy state (entries_read_all, entries_delete_all,
-- entries_insert_when_unlocked_or_commissioner,
-- entries_update_when_unlocked_or_commissioner).
--
-- Apply to Supabase dashboard (SQL editor):
--
--   -- Drop legacy / orphan policies first so the policy set is clean before
--   -- RLS is enabled. Names below cover the policies that existed in our
--   -- production database pre-3.2 plus an orphan from a 3.2-development
--   -- iteration; harmless on environments where they don't exist.
--   DROP POLICY IF EXISTS "entries_insert"      ON entries;
--   DROP POLICY IF EXISTS "entries_update"      ON entries;
--   DROP POLICY IF EXISTS "entries_public_read" ON entries;
--   DROP POLICY IF EXISTS "entries_delete"      ON entries;
--   DROP POLICY IF EXISTS "entries_write_when_unlocked_or_commissioner" ON entries;
--
--   ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
--
--   -- If permissive read/delete policies don't already exist, create them
--   -- so enabling RLS doesn't break existing flows:
--   DROP POLICY IF EXISTS "entries_read_all"   ON entries;
--   DROP POLICY IF EXISTS "entries_delete_all" ON entries;
--   CREATE POLICY "entries_read_all"   ON entries FOR SELECT USING (true);
--   CREATE POLICY "entries_delete_all" ON entries FOR DELETE USING (true);
--
--   -- The lock-aware INSERT / UPDATE policies:
--   DROP POLICY IF EXISTS "entries_insert_when_unlocked_or_commissioner" ON entries;
--   DROP POLICY IF EXISTS "entries_update_when_unlocked_or_commissioner" ON entries;
--
--   CREATE POLICY "entries_insert_when_unlocked_or_commissioner"
--     ON entries FOR INSERT
--     WITH CHECK (
--       EXISTS (
--         SELECT 1 FROM pools p
--         WHERE p.id = entries.pool_id
--           AND (
--             p.locked_at IS NULL
--             OR EXISTS (
--               SELECT 1 FROM user_pools up
--               WHERE up.pool_id = p.id
--                 AND up.user_id = auth.uid()
--                 AND up.role = 'commissioner'
--             )
--           )
--       )
--     );
--
--   CREATE POLICY "entries_update_when_unlocked_or_commissioner"
--     ON entries FOR UPDATE
--     USING (
--       EXISTS (
--         SELECT 1 FROM pools p
--         WHERE p.id = entries.pool_id
--           AND (
--             p.locked_at IS NULL
--             OR EXISTS (
--               SELECT 1 FROM user_pools up
--               WHERE up.pool_id = p.id
--                 AND up.user_id = auth.uid()
--                 AND up.role = 'commissioner'
--             )
--           )
--       )
--     );
--
-- Verification (run from a non-commissioner anonymous browser session, after
-- locking the pool from another session):
--
--   await sb.from('entries').insert({
--     pool_id: '<pool-uuid>', name: 'rls-test', picks: [1,2,3,4,5], tiebreaker: -10
--   }).then(r => console.log('write result:', r));
--
-- Expect: { error: { code: '42501' or 'new row violates row-level security policy' } }.
-- A successful insert means the policy isn't applied — fix before shipping.

-- ---------------------------------------------------------------------------
-- user_pools  (added phase 1a — anonymous auth foundation)
-- ---------------------------------------------------------------------------
-- Tracks which Supabase users have visited / created which pools.
-- Every visitor gets an anonymous Supabase user on first load (see boot() in
-- index.html). loadPool() upserts a row here on each successful pool load;
-- createPool() writes a row with role='commissioner' for new pools.
--
-- Apply to Supabase dashboard (SQL editor):

CREATE TABLE user_pools (
    user_id      uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
    pool_id      uuid        REFERENCES pools(id)       ON DELETE CASCADE,
    role         text        NOT NULL DEFAULT 'player',  -- 'player' | 'commissioner'
    joined_at    timestamptz DEFAULT now(),
    last_visited timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, pool_id)
);

-- RLS policy (run these after creating the table):
--
--   ALTER TABLE user_pools ENABLE ROW LEVEL SECURITY;
--
--   CREATE POLICY "users manage own rows"
--     ON user_pools
--     FOR ALL
--     USING  (auth.uid() = user_id)
--     WITH CHECK (auth.uid() = user_id);
--
-- This lets each user SELECT/INSERT/UPDATE/DELETE only their own rows.
-- No service-role bypass is needed — all writes originate from the client
-- after signInAnonymously() has established a session.
