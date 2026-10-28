-- phase: expand
-- A time board ranks a player's fastest run: the lowest score in whole milliseconds (at most 24 hours), ascending.
-- Only the kind CHECK widens; scores, refs and the rest of the schema stay as they are. PostgreSQL named 0001's
-- inline CHECK on play_boards.kind play_boards_kind_check.
ALTER TABLE play_boards DROP CONSTRAINT IF EXISTS play_boards_kind_check;
ALTER TABLE play_boards ADD CONSTRAINT play_boards_kind_check CHECK (kind IN ('best', 'sum', 'time'));
