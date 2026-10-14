# OpenVibe.Play

**Achievements and leaderboards for every OpenVibe game.** https://play.openvibe.network

OpenVibe.Play is the network's game services (OpenVibe.Games [ADR-0007](https://github.com/OpenVibers/OpenVibe.Games/blob/main/docs/adr/0007-rewrite-the-moddable-base.md)
decision 10). A game registers its **title** with its own OpenVibe token, posts what its players did, and anyone reads
its boards. The rules of each game stay in the game; Play keeps the record and answers it.

- **Titles** belong to the principal that registered them (a game's service or app token). Only that principal writes to
  a title; to anyone else it does not exist.
- **Achievements**, including hidden ones whose name shows only once unlocked. A definition left out of an update is
  retired, never deleted: what players earned stays.
- **Leaderboards** of two kinds: `best` ranks each player's best score, `sum` the total of theirs. Each reads this week
  (from Monday 00:00 UTC) or all time, 25 a page. A tie goes to whoever got there first.
- **Players** are people (`usr_…`) or guests a game names (`guest:<opaque>`). When a guest signs in, the game adopts
  them and their unlocks and scores become the person's.
- **Idempotent writes.** A round's scores carry a `ref`; posting it again changes nothing. An unlock answers only the
  achievements that were new.
- **Personal data.** Only people's rows are: they are in the person's account export and erased with their account
  (ADR-033). A board shows a name and a score, never a player id.

Every page is server-rendered and readable without JavaScript: the home (every game and this week's leaders), a title,
a board, your achievements and the API docs.

## API (`/api/v1`, problem+json errors)

| Route | Who | What |
|---|---|---|
| `GET /titles`, `GET /titles/:title` | anyone (CORS) | the games, their achievements (with how many players have each) and boards |
| `GET /titles/:title/boards/:board?period=week\|all&page=` | anyone (CORS) | a board: `rank`, `name`, `score`, `signed_in` |
| `GET /me/achievements` | a person | their unlocks in every game |
| `PUT /titles/:title` | `play.title.manage` | register or update a title: name, url, summary, achievements, boards |
| `POST /titles/:title/scores` | `play.result.write` | `{ board, ref, entries: [{ player, name, score }] }`, up to 100 |
| `POST /titles/:title/unlocks` | `play.result.write` | `{ player, achievements: [id] }` → the new ones |
| `POST /titles/:title/players/:guest/adopt` | `play.result.write` | `{ person: "usr_…" }`: a guest signed in |
| `GET /titles/:title/players/:player/achievements` | `play.player.read` | a player's unlocks in your title |

Tokens are Network service or app tokens for audience `openvibe.play`; the contracts are `play.*` in
[openvibe-contracts](https://github.com/OpenVibers/OpenVibe.Contracts) (0.172.0).

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
server/http/api.js           /api/v1
server/http/pages.js         the pages; discovery.js robots.txt, sitemap.xml, llms.txt
migrations/0001_initial.sql  the schema
```

## License

AGPL-3.0. Part of the [OpenVibe network](https://openvibe.network).
