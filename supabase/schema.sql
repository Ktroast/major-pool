-- supabase/schema.sql
--
-- Defines the two tables used by The Major Pool.
-- This file is documentation — the live schema lives in Supabase and was
-- never created from a migration. If you ever need to recreate it, run this
-- against a fresh Supabase project (SQL editor or psql).
--
-- Ground truth: the insert/select calls in the SUPABASE OPERATIONS section
-- of index.html (~line 536).

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
    updated_at       timestamptz
);

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
