-- phase: expand
-- OpenVibe.Play (OpenVibe.Games ADR-0007 decision 10): the platform's game services. A title is one game, managed by
-- the principal that registered it. Play keeps what the title says players did — achievements unlocked and scores
-- posted to its leaderboards — and answers the boards; the rules of each game stay in the game.
--
-- A player is a person's subject (usr_…) or a title-scoped guest the title names (guest:<opaque>); a guest's rows move
-- to the person when the title adopts the guest. Only people's rows are personal data (account export and erasure).

CREATE TABLE play_titles (
    id         text COLLATE "C" PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
    owner      text COLLATE "C" NOT NULL,                       -- the principal that manages it: service:games
    name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    url        text CHECK (url IS NULL OR url ~ '^https://'),   -- where it is played
    summary    text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL
);

CREATE TABLE play_achievements (
    title_id    text COLLATE "C" NOT NULL REFERENCES play_titles (id) ON DELETE CASCADE,
    id          text COLLATE "C" NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
    position    integer NOT NULL DEFAULT 0,
    hidden      boolean NOT NULL DEFAULT false,                 -- a secret one: its name shows only once unlocked
    retired     boolean NOT NULL DEFAULT false,                 -- no longer in the title's definitions; unlocks stay
    PRIMARY KEY (title_id, id)
);

CREATE TABLE play_boards (
    title_id text COLLATE "C" NOT NULL REFERENCES play_titles (id) ON DELETE CASCADE,
    id       text COLLATE "C" NOT NULL CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    name     text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    kind     text COLLATE "C" NOT NULL CHECK (kind IN ('best', 'sum')),   -- a player's best score, or the sum of theirs
    position integer NOT NULL DEFAULT 0,
    retired  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (title_id, id)
);

CREATE TABLE play_unlocks (
    title_id       text COLLATE "C" NOT NULL,
    achievement_id text COLLATE "C" NOT NULL,
    player         text COLLATE "C" NOT NULL,
    unlocked_at    bigint NOT NULL,
    PRIMARY KEY (title_id, achievement_id, player),
    FOREIGN KEY (title_id, achievement_id) REFERENCES play_achievements (title_id, id) ON DELETE CASCADE
);
CREATE INDEX play_unlocks_player ON play_unlocks (player, unlocked_at DESC);

-- One row per (round or run the title names, player): a repeated post changes nothing.
CREATE TABLE play_scores (
    title_id    text COLLATE "C" NOT NULL,
    board_id    text COLLATE "C" NOT NULL,
    ref         text COLLATE "C" NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 128),
    player      text COLLATE "C" NOT NULL,
    player_name text NOT NULL CHECK (char_length(player_name) BETWEEN 1 AND 40),
    score       bigint NOT NULL CHECK (score >= 0),
    at          bigint NOT NULL,
    seq         bigint GENERATED ALWAYS AS IDENTITY,          -- post order: the newest name of two posts at one time
    PRIMARY KEY (title_id, board_id, ref, player),
    FOREIGN KEY (title_id, board_id) REFERENCES play_boards (title_id, id) ON DELETE CASCADE
);
CREATE INDEX play_scores_board ON play_scores (title_id, board_id, at);
CREATE INDEX play_scores_player ON play_scores (player);

-- openvibe-sdk/account-data receipts (ADR-033): a redelivered export or deletion changes nothing.
CREATE TABLE IF NOT EXISTS account_data_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    subject TEXT NOT NULL,
    outcome JSONB,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);
