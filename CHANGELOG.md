# Changelog

All notable changes to OpenVibe.Play.

## 0.2.0 — 2026-10-14

- **Account merges (ADR-029).** Play subscribes to `network.subject.merged`: the folded account's unlocks (the earliest
  time wins) and scores (a round both accounts posted keeps the survivor's) become the survivor's in every title, once
  per merge (`play_subject_merges`, migration 0002). Before it, a merged person showed as two players on the boards.

## 0.1.0 — 2026-10-14

- First release (OpenVibe.Games ADR-0007 decision 10, contracts 0.172.0): titles registered by their own principal,
  achievements (hidden ones too), best and sum leaderboards this week and all time, idempotent score and unlock posts,
  guest adoption, public reads with CORS, server-rendered pages, and account export and deletion (ADR-033).
