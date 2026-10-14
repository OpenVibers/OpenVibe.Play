-- phase: expand
-- network.subject.merged (ADR-029): two Network accounts became one, and every unlock and score of the folded account
-- moved to the survivor. One row per merge, so a redelivery changes nothing.
CREATE TABLE play_subject_merges (
    merge_id text COLLATE "C" PRIMARY KEY,
    from_subject text COLLATE "C" NOT NULL,
    into_subject text COLLATE "C" NOT NULL,
    unlocks integer NOT NULL,
    scores integer NOT NULL,
    merged_at bigint NOT NULL
);
