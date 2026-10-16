-- phase: expand
-- Cloud saves (server/play/store.js putSave…): a title keeps each player's save slots here, the Steamworks-style
-- "your progress follows you" service. A slot holds one JSON document of at most 64 KB, versioned so two devices
-- cannot silently overwrite each other (a write names the version it read). A guest's slots move to the person on
-- adoption, and a folded account's to the survivor on a merge (the newer slot wins a clash).
CREATE TABLE play_saves (
    title_id   text COLLATE "C" NOT NULL REFERENCES play_titles (id) ON DELETE CASCADE,
    player     text COLLATE "C" NOT NULL,
    slot       text COLLATE "C" NOT NULL CHECK (slot ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
    data       jsonb NOT NULL,
    size       integer NOT NULL CHECK (size BETWEEN 1 AND 65536),
    version    integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    PRIMARY KEY (title_id, player, slot)
);
CREATE INDEX play_saves_player ON play_saves (player, updated_at DESC);
