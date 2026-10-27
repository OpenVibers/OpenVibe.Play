# OpenVibe.Play

**Achievements, leaderboards and cloud saves for every OpenVibe game.** https://play.openvibe.network

OpenVibe.Play is the network's game services (OpenVibe.Games [ADR-0007](https://github.com/OpenVibers/OpenVibe.Games/blob/main/docs/adr/0007-rewrite-the-moddable-base.md)
decision 10). A game registers its **title** with its own OpenVibe token, posts what its players did, and anyone reads
its boards. The rules of each game stay in the game; Play keeps the record and answers it.

- **Titles** belong to the principal that registered them (a game's service or app token). Only that principal writes to
  a title; to anyone else it does not exist.
- **Your own game, from the sandbox** (ADR-014 opt-in): any developer makes a project on openvibe.services and a sandbox
  app with Play's three capabilities (in Network's default sandbox allowance). A sandbox app registers up to 3 titles
  whose ids start with `sandbox-`, with guest players only (nothing adopted, no person's record touched), never listed,
  counted or indexed: readable at their id, marked `sandbox: true`, and deleted by their app (`DELETE /titles/:title`;
  a production title is never deleted). A production app (staff turn production on for the
  project) registers the real name; it never takes a `sandbox-` id.
- **Achievements**, including hidden ones whose name shows only once unlocked. A definition left out of an update is
  retired, never deleted: what players earned stays.
- **Leaderboards** of two kinds: `best` ranks each player's best score, `sum` the total of theirs. Each reads this week
  (from Monday 00:00 UTC) or all time, 25 a page. A tie goes to whoever got there first.
- **Players** are people (`usr_…`) or guests a game names (`guest:<opaque>`). When a guest signs in, the game adopts
  them and their unlocks and scores become the person's. When two OpenVibe accounts are merged (`network.subject.merged`),
  the folded account's unlocks and scores become the survivor's in every title.
- **Cloud saves** (`migrations/0004_saves.sql`): a player's progress follows them to any device. Up to 8 slots per
  player per title, each any JSON value of at most 64 KB, versioned: a write names the version it read and a stale one
  is refused (409 `play.save_conflict`). The title's own token writes (`play.result.write`) and reads
  (`play.player.read`); a person lists and deletes their own at `/me/saves` and sees them on /me. A guest's slots move
  to the person on adoption and a folded account's on a merge (the newer save wins a clash); they are in the account
  export and erased with the account.
- **Idempotent writes.** A round's scores carry a `ref`; posting it again changes nothing. An unlock answers only the
  achievements that were new.
- **Personal data.** Only people's rows are: they are in the person's account export and erased with their account
  (ADR-033). A board shows a name and a score, never a player id.

Every page is server-rendered and readable without JavaScript: the home (every game and this week's leaders), a title,
a board, your achievements and the API docs.

## Purpose

One record of what players did in OpenVibe games, shared by every game and read anywhere. A game keeps its own rules and
reports their results; Play stores the achievements unlocked and the scores posted, ranks them, and serves them to the
game, to the player's account page and to any page that wants a board.

## Owns

- Titles, their achievement definitions and their boards (`play_titles`, `play_achievements`, `play_boards`).
- Unlocks, scores and cloud saves per player (`play_unlocks`, `play_scores`, `play_saves`), guest adoption, and the merges applied
  (`play_subject_merges`).
- The public pages at play.openvibe.network and the `/api/v1` read and write API.
- Request telemetry (`telemetry_samples`, `0003_telemetry.sql`): each HTTP request aggregated by route template, method, status class,
  never by raw URL; `/shared`, static assets, health, readiness and `/metrics` are not counted. `server/app.js` builds the collector,
  `server/index.js` flushes per key one `http.request` sample plus the active-requests, p95 latency and event-loop-lag gauges each
  minute and on stop (openvibe-sdk 0.46, `platform.telemetry-sample@1`), and rows older than 14 days are deleted daily.

## Does not own

- A game's rules, rounds or anti-cheat: the game decides what counts and posts the result. Games' local tables stay in
  OpenVibe.Games, which posts to Play.
- People's accounts, names shown elsewhere, or sign-in: OpenVibe.Network. Rewards worn across the network (items) are
  OpenVibe.Inventory's; OpenCoins are the Network wallet's.

## Depends on

- **OpenVibe.Network:** service and app tokens (audience `openvibe.play`), the JWKS that verifies them, grants for the
  `play.*` capabilities, and person sign-in for "your achievements".
- **OpenVibe.Events:** the account subscriptions (export, deletion, `network.subject.merged`), created at boot when
  `EVENTS_URL`, `PLAY_EVENTS_SECRET` and the client secret are set.
- **PostgreSQL** (`ov_play`; embedded PGlite in development and tests), Valkey for per-caller limits when configured.

## Capabilities

| Capability | Lets a caller |
|---|---|
| `play.title.manage` | register or update its own title (name, url, summary, achievements, boards) |
| `play.result.write` | post scores and unlocks to its own title, and adopt a guest as a person |
| `play.player.read` | read a player's unlocks in its own title |

A title belongs to the principal that registered it; another principal's write is refused as if the title did not
exist. Reads of titles and boards are public.

## Acceptance

Tested in `test/` (`npm test`, every file in its own process on PGlite; `npm run test:pg` on PostgreSQL):
`play-api.test.js` (titles, owner-only writes, idempotent scores, best and sum boards with the Monday week, guest
adoption, secret achievements, retired definitions, a person's own achievements, the pages), `account-data.test.js`
(export, erasure and account merges), the auth, limits, discovery, layout, open-redirect, nginx and security tests, and
the home page's size budget.

## Security

- Writes need a Network token with the capability, for audience `openvibe.play`; a principal writes only its own titles.
- Every write is idempotent (`ref` for scores, set semantics for unlocks) and limited per calling principal
  (`http/caller-limits.js`), sign-in routes per address.
- Boards show a name and a score, never a player id; guests are opaque ids chosen by the game.
- Report vulnerabilities as [SECURITY.md](SECURITY.md) says.

## Deploy

`sudo ovhost deploy play` on the host: unit `openvibe-play.service` on 127.0.0.1:5040, env `/etc/openvibe/play.env`,
database `ov_play`, nginx vhost `deploy/nginx/play.openvibe.network.conf` on the openvibe.network wildcard certificate.
Migrations run at boot.

## API (`/api/v1`, problem+json errors)

| Route | Who | What |
|---|---|---|
| `GET /titles`, `GET /titles/:title` | anyone (CORS) | the games, their achievements (with how many players have each) and boards |
| `GET /titles/:title/boards/:board?period=week\|all&page=` | anyone (CORS) | a board: `rank`, `name`, `score`, `signed_in` |
| `GET /people/:subject/achievements` | anyone (CORS) | a person's unlocks in every game, `{ subject, total, titles }`: their profile on OpenVibe.Network and any site's showcase (only people, never a guest) |
| `GET /me/achievements` | a person | their unlocks in every game |
| `PUT /titles/:title` | `play.title.manage` | register or update a title: name, url, summary, achievements, boards |
| `POST /titles/:title/scores` | `play.result.write` | `{ board, ref, entries: [{ player, name, score }] }`, up to 100 |
| `POST /titles/:title/unlocks` | `play.result.write` | `{ player, achievements: [id] }` → the new ones |
| `POST /titles/:title/players/:guest/adopt` | `play.result.write` | `{ person: "usr_…" }`: a guest signed in |
| `GET /titles/:title/players/:player/achievements` | `play.player.read` | a player's unlocks in your title |

Tokens are Network service or app tokens for audience `openvibe.play`; the contracts are `play.*` in
[openvibe-contracts](https://github.com/OpenVibers/OpenVibe.Contracts) (0.172.1).

## Run

```sh
npm install
npm run dev        # http://localhost:5040, embedded PGlite in data/pglite
npm test           # every test on PGlite; npm run test:pg on PostgreSQL
```

Configuration is environment only (`.env.example`, names only). Production: unit `openvibe-play.service` on
127.0.0.1:5040, database `ov_play`, nginx vhost `deploy/nginx/play.openvibe.network.conf` on the openvibe.network
wildcard certificate, deployed with `sudo ovhost deploy play`.

## Layout

```
server/play/store.js         titles, achievements, boards, scores, unlocks, adoption
server/play/account-data.js  account export and deletion (ADR-033)
server/play/subject-merge.js account merges (ADR-029)
server/http/api.js           /api/v1
server/http/pages.js         the pages; discovery.js robots.txt, sitemap.xml, llms.txt
migrations/                  the schema (0001 the store, 0002 the merges applied)
```

## License

AGPL-3.0. Part of the [OpenVibe network](https://openvibe.network).

<!-- versions:start -->
- openvibe-contracts: v0.214.0
- openvibe-sdk: v0.65.0
- openvibe-shared: v4.15.1
<!-- versions:end -->
