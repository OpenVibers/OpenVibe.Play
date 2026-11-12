# AGENTS.md — OpenVibe.Play

## Project Overview

OpenVibe.Play is the network's game services: achievements, leaderboards and cloud saves for every OpenVibe game. A
game registers its **title** with its own OpenVibe token, posts what its players did, and anyone reads its boards. The
rules of each game stay in the game; Play keeps the record and answers it.

- **Domain:** `play.openvibe.network` · **Port:** 5040 · **Service id:** `play` · **Env prefix:** `PLAY`
- **Runtime:** Node 22, Express 4, PostgreSQL 18 through `openvibe-sdk/db` (PGlite in development/tests), Valkey for
  shared limits when configured.
- **Read first:** [README.md](README.md), [STATUS.json](STATUS.json), [.env.example](.env.example).

**Network context:** accounts and sign-in are OpenVibe.Network (service/app tokens with audience `openvibe.play`, the
JWKS, `play.*` capability grants, and person sign-in for "your achievements"). Items are OpenVibe.Inventory's and
OpenCoins are the wallet's — Play does not grant either. Account export/deletion arrives from OpenVibe.Events at
`/internal/events`. Game rules, rounds, anti-cheat and the player pages live in OpenVibe.Games; Play is the record and
the API.

## Commands

```bash
npm ci                         # install (contracts/sdk/shared pinned by tag)
npm run dev                    # http://localhost:5040, embedded PGlite in data/pglite
npm start                      # node server/index.js
npm test                       # every test/*.test.js on PGlite with a mock Network, no network
npm run test:pg                # the same through PostgreSQL + PgBouncer
npm test -- play-api           # only test files whose name contains the word
node --check <file.js>         # syntax check (no linter configured)
```

No build step and no public pages: Play's own CSS is [public/css/](public/css/), but the player-facing pages were
moved to OpenVibe.Games. The old addresses (`/`, `/t/:title`, `/me`, `/docs`, `/updates`) answer 301 there through
[server/http/moved.js](server/http/moved.js).

## Architecture at a Glance

- **Entry:** [server/index.js](server/index.js) — listener, telemetry retention and the two account subscriptions;
  graceful stop in `createLifecycle()`.
- **App factory:** [server/app.js](server/app.js) — helmet/CSP, SSO, `/auth`, `/internal/events`, `/shared` + static,
  `/api/v1`, the moved-page redirects, discovery, 404/error handler. Tests call `createApp({ store, fetchImpl, ... })`.
- **Config:** [server/config.js](server/config.js) — `load(env)` is pure; production `/etc/openvibe/play.env`.
- **Store:** [server/play/store.js](server/play/store.js) — titles, achievements, boards, scores, unlocks, guest
  adoption, sandbox restrictions, cloud saves. Account data:
  [server/play/account-data.js](server/play/account-data.js).
- **HTTP:** [server/http/api.js](server/http/api.js) (`/api/v1`), [server/http/principal.js](server/http/principal.js)
  (service/app/person, title ownership, capabilities), [server/http/moved.js](server/http/moved.js),
  [server/http/discovery.js](server/http/discovery.js) (robots/llms; sitemap and llms-full redirect to Games),
  [server/http/router.js](server/http/router.js) (async router), [server/http/caller-limits.js](server/http/caller-limits.js).
- **Auth:** [server/auth/sso.js](server/auth/sso.js), [server/auth/keys.js](server/auth/keys.js).
- **Rendering:** [server/render/](server/render/) (`html.js`, `layout.js`, `markdown.js`) only for the error/redirect
  surfaces and discovery; there is no site.
- **Database:** [server/db.js](server/db.js) and [migrations/](migrations/): `play_titles`, `play_achievements`,
  `play_boards`, `play_unlocks`, `play_scores`, `play_saves`, `play_subject_merges`, `account_data_events`,
  `telemetry_samples`.
- **Deploy:** [deploy/systemd/openvibe-play.service](deploy/systemd/openvibe-play.service) (`/etc/openvibe/play.env`,
  `/opt/play.openvibe.network`) and [deploy/nginx/play.openvibe.network.conf](deploy/nginx/play.openvibe.network.conf)
  on the openvibe.network wildcard certificate. `sudo ovhost deploy play`; database `ov_play`; migrations run at boot.

## Ownership and Boundaries

Play owns titles, their achievement definitions, boards, scores, unlocks, guest→person adoption and cloud saves per
player, plus request telemetry and account-export/deletion receipts. It does **not** own a game's rules, rounds or
anti-cheat (the game decides what counts and posts the result), accounts or names (Network), wearable rewards
(Inventory), OpenCoins (Network wallet), event delivery (Events), or the host/database/Valkey (Host). A title belongs
to the principal that registered it: another principal's write is refused exactly as if the title did not exist.

## Auth and Capabilities

| Capability | Lets a caller |
|---|---|
| `play.title.manage` | register or update its own title (name, url, summary, achievements, boards), delete a sandbox title |
| `play.result.write` | post scores/unlocks and cloud saves to its own title, adopt a guest as a person |
| `play.player.read` | read a player's unlocks/saves in its own title |

Tokens are Network service or app tokens for audience `openvibe.play`; person routes accept the person's token or this
site's session. Public title/board/profile reads answer every origin (CORS) and require no token; writes never.

- **Sandbox apps** (ADR-014): a developer's sandbox app registers up to 3 titles with ids starting `sandbox-`, guest
  players only, never listed/counted/indexed, readable at their id with `sandbox: true`, and deletable by their app.
  A production app registers the real name and never takes a `sandbox-` id; a production title is never deleted.
- Guest adoption (`POST /titles/:title/players/:guest/adopt`) links a guest's record to a `usr_…`; it must be
  idempotent and audited as that title's principal.
- Errors are RFC 9457 problem+json. Keep the "not yours = not found" rule: never leak another principal's title.

## API (`/api/v1`)

Anyone (CORS): `GET /titles`, `GET /titles/:title`, `GET /titles/:title/boards/:board?period=week|all&page=`,
`GET /people/:subject/achievements`. A person: `GET /me/achievements`, `GET /me/saves`,
`DELETE /me/saves/:title/:slot`. A title's principal: `PUT /titles/:title`, `DELETE /titles/:title` (sandbox only),
`POST /titles/:title/scores` (up to 100 entries; a `time` board's score is whole ms 0–86400000),
`POST /titles/:title/unlocks`, `POST /titles/:title/players/:guest/adopt`,
`GET|PUT|DELETE /titles/:title/players/:player/saves[/:slot]` (a stale `version` is 409; list omits the data),
`GET /titles/:title/players/:player/achievements` (`play.player.read`). Machine endpoints `/api/health`, `/api/ready`,
`/release.json`, `/metrics` are loopback only.

## Conventions

- CommonJS, 4-space indent, single quotes, semicolons; no linter/formatter. Async handlers through
  [server/http/router.js](server/http/router.js).
- New schema = a new `migrations/NNNN_name.sql`; never edit one that has run. Keep `play_` prefixes.
- Public reads are CORS-open and credential-free; a presented token must still hold the route's capability.
- IDs are stable strings from the caller (`title`, board, achievement id, guest/player id); never derive authority
  from a name. A hidden achievement's name is returned only after unlock.
- Phone first and no Font Awesome apply to any page that still renders here (error/redirect/discovery only); the
  player pages are Games' responsibility now.
- "Calm reduces, only Off removes": a board `period` or a hidden definition reduces; only an explicit delete removes
  (and a production title has no delete).
- Never log tokens, a player's record or a save's data.

## Key Pitfalls

- **Moved pages:** Play renders no site; `/`, `/t/:title`, `/me`, `/docs`, `/updates` must 301 to the matching
  OpenVibe.Games page. Adding a page here would fork the product — add it to Games instead.
- **Sandbox containment:** sandbox titles are invisible to listings, profiles, counts and Search, cannot adopt a
  person's record, and cannot use a real prefix. [test/sandbox.test.js](test/sandbox.test.js) guards it.
- **Time boards:** a time board's unit is `ms`, scores are whole milliseconds in 0…86 400 000; do not accept a float,
  seconds or a negative. [test/time-boards.test.js](test/time-boards.test.js) and the time migration guard it.
- **Cloud saves:** a write with a stale version is 409; the list endpoint never returns `data`; a save belongs to the
  title's principal for its own players and to the person for `/me/saves`. `cloud saves` are not achievements.
- **Guest adoption** must merge only that title's guest record, never another title's, and must be repeatable.
- **Account export/deletion** is loopback-only, signature-verified and idempotent; a redelivery changes nothing.
- **Drill/readiness:** the DB is the required readiness check; Network JWKS, OAuth client and Valkey are optional and
  reported per check on `/api/ready`.

## Testing

`npm test` runs each file in its own process on temp PGlite with a mock Network: API, sandbox, saves, time boards and
their migration, moved pages, caller limits, auth/JWKS, discovery, secret-leak/session/redirect, service kit and
telemetry. `npm run test:pg` for the PostgreSQL path. Run the narrowest file first, then the suite; always
`node --check` changed files.

## Documentation

- [README.md](README.md) — purpose, ownership, capabilities, acceptance, security, deploy, API, layout.
- [STATUS.json](STATUS.json) — stage, deployed flag, features and not-yet list.
- [.env.example](.env.example) — variable names only.
- [CHANGELOG.md](CHANGELOG.md), [SECURITY.md](SECURITY.md).
