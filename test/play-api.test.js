'use strict';
// OpenVibe.Play's API: a game registers its title with its own token, posts scores and unlocks (idempotent), adopts a
// guest who signed in, and anyone reads the boards — names and scores, never a player id. Only the principal that
// registered a title writes to it.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const P1 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ0';
const P2 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ1';
const G1 = 'guest:a1b2c3d4e5f6';
const DAY = 86_400_000;

(async () => {
    let clock = Date.UTC(2026, 9, 14, 12);   // a Wednesday
    const t = await boot({ now: () => clock });
    try {
        const games = { bearer: t.network.serviceToken('games', ['play.title.manage', 'play.result.write', 'play.player.read']) };
        const other = { bearer: t.network.serviceToken('quest', ['play.title.manage', 'play.result.write', 'play.player.read']) };
        const define = (body, auth = games) => t.get('/api/v1/titles/salvage-rush', { ...auth, method: 'PUT', json: body });
        const DOC = {
            name: 'Salvage Rush', url: 'https://openvibe.games/play?game=salvage-rush', summary: '90-second scrap rounds.',
            achievements: [
                { id: 'first-haul', name: 'First Haul', description: 'Finish a round with scrap.' },
                { id: 'big-haul', name: 'Big Haul', description: 'Score 500 in one round.' },
                { id: 'secret-one', name: 'Ghost', description: 'Nobody knows.', hidden: true },
            ],
            boards: [{ id: 'best', name: 'Best round', kind: 'best' }, { id: 'hauls', name: 'Total haul', kind: 'sum' }],
        };

        await check('a game registers its title with its own token; nobody else may write to it', async () => {
            const anon = await t.get('/api/v1/titles/salvage-rush', { method: 'PUT', json: DOC });
            assert.strictEqual(anon.status, 401);
            const person = await t.get('/api/v1/titles/salvage-rush', { bearer: t.network.userToken(t.network.addUser('ada')), method: 'PUT', json: DOC });
            assert.strictEqual(person.status, 403, 'a person never manages a title');
            const noCap = await define(DOC, { bearer: t.network.serviceToken('games', ['play.player.read']) });
            assert.strictEqual(noCap.status, 403);
            const created = await define(DOC);
            assert.strictEqual(created.status, 201, created.text);
            assert.deepStrictEqual(created.json().title.boards.map((b) => [b.id, b.kind]), [['best', 'best'], ['hauls', 'sum']]);
            assert.strictEqual((await define(DOC)).status, 200, 'the same document again changes nothing');
            const taken = await define(DOC, other);
            assert.deepStrictEqual([taken.status, taken.json().code], [409, 'play.title_taken']);
            const scores = await t.get('/api/v1/titles/salvage-rush/scores', { ...other, json: { board: 'best', ref: 'r', entries: [{ player: P1, name: 'x', score: 1 }] } });
            assert.deepStrictEqual([scores.status, scores.json().code], [404, 'play.unknown_title'], 'another principal is told the title does not exist');
        });

        await check('scores and unlocks are idempotent; bad players, boards and achievements are refused', async () => {
            const post = (body) => t.get('/api/v1/titles/salvage-rush/scores', { ...games, json: body });
            const r1 = await post({ board: 'best', ref: 'round-1', entries: [{ player: P1, name: 'Ada', score: 300 }, { player: G1, name: 'Guest 7', score: 450 }] });
            assert.deepStrictEqual(r1.json(), { recorded: 2, repeated: 0 });
            assert.deepStrictEqual((await post({ board: 'best', ref: 'round-1', entries: [{ player: P1, name: 'Ada', score: 9999 }] })).json(), { recorded: 0, repeated: 1 }, 'a repeated round changes nothing');
            for (const [body, code] of [
                [{ board: 'nope', ref: 'x', entries: [{ player: P1, name: 'a', score: 1 }] }, 'play.unknown_board'],
                [{ board: 'best', ref: 'x', entries: [{ player: 'bob', name: 'a', score: 1 }] }, 'play.bad_player'],
                [{ board: 'best', ref: 'x', entries: [{ player: P1, name: 'a', score: -1 }] }, 'play.bad_scores'],
                [{ board: 'best', entries: [{ player: P1, name: 'a', score: 1 }] }, 'play.bad_scores'],
                [{ board: 'best', ref: 'x', at: clock + DAY, entries: [{ player: P1, name: 'a', score: 1 }] }, 'play.bad_time'],
            ]) assert.strictEqual((await post(body)).json().code, code, JSON.stringify(body));
            const unlock = (body) => t.get('/api/v1/titles/salvage-rush/unlocks', { ...games, json: body });
            assert.deepStrictEqual((await unlock({ player: P1, achievements: ['first-haul'] })).json(), { unlocked: ['first-haul'] });
            assert.deepStrictEqual((await unlock({ player: P1, achievements: ['first-haul', 'big-haul'] })).json(), { unlocked: ['big-haul'] }, 'only the new ones');
            assert.strictEqual((await unlock({ player: P1, achievements: ['made-up'] })).json().code, 'play.unknown_achievement');
            assert.deepStrictEqual((await unlock({ player: G1, achievements: ['first-haul'] })).json(), { unlocked: ['first-haul'] });
        });

        await check('a best board ranks each player\'s best, a sum board their total; this week starts on Monday', async () => {
            const post = (body) => t.get('/api/v1/titles/salvage-rush/scores', { ...games, json: body });
            clock += 60_000;   // round 2 comes a minute after round 1
            await post({ board: 'best', ref: 'round-2', entries: [{ player: P1, name: 'Ada L.', score: 500 }, { player: P2, name: 'Bo', score: 450 }] });
            await post({ board: 'best', ref: 'old-round', at: clock - 5 * DAY, entries: [{ player: P2, name: 'Bo', score: 900 }] });
            await post({ board: 'hauls', ref: 'x-1', entries: [{ player: P1, name: 'Ada L.', score: 20 }, { player: P2, name: 'Bo', score: 25 }] });
            await post({ board: 'hauls', ref: 'x-2', entries: [{ player: P1, name: 'Ada L.', score: 10 }] });
            const all = (await t.get('/api/v1/titles/salvage-rush/boards/best?period=all')).json();
            assert.deepStrictEqual(all.entries, [
                { rank: 1, name: 'Bo', score: 900, signed_in: true },
                { rank: 2, name: 'Ada L.', score: 500, signed_in: true },
                { rank: 3, name: 'Guest 7', score: 450, signed_in: false },
            ], 'best per player, the newest name, a guest shown as one, no player ids');
            assert.ok(!JSON.stringify(all).includes('usr_') && !JSON.stringify(all).includes('guest:'), 'never a player id');
            const week = (await t.get('/api/v1/titles/salvage-rush/boards/best?period=week')).json();
            assert.deepStrictEqual(week.entries.map((e) => [e.name, e.score]), [['Ada L.', 500], ['Guest 7', 450], ['Bo', 450]], 'last Friday\'s 900 is not this week; the guest reached 450 a round before Bo');
            assert.strictEqual(week.since, '2026-10-12T00:00:00.000Z');
            const sums = (await t.get('/api/v1/titles/salvage-rush/boards/hauls')).json();
            assert.deepStrictEqual(sums.entries.map((e) => [e.name, e.score]), [['Ada L.', 30], ['Bo', 25]]);
            assert.strictEqual((await t.get('/api/v1/titles/salvage-rush/boards/best?period=year')).status, 400);
            assert.strictEqual((await t.get('/api/v1/titles/salvage-rush/boards/nope')).status, 404);
        });

        await check('a guest who signs in brings their scores and unlocks; the earlier unlock wins', async () => {
            const P3 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ2';
            await t.get('/api/v1/titles/salvage-rush/unlocks', { ...games, json: { player: P3, achievements: ['first-haul'] } });
            const adopt = await t.get(`/api/v1/titles/salvage-rush/players/${encodeURIComponent(G1)}/adopt`, { ...games, json: { person: P3 } });
            assert.deepStrictEqual(adopt.json(), { unlocks: 1, scores: 1 });
            const board = (await t.get('/api/v1/titles/salvage-rush/boards/best')).json();
            assert.deepStrictEqual(board.entries.find((e) => e.name === 'Guest 7'), { rank: 3, name: 'Guest 7', score: 450, signed_in: true }, 'the guest\'s score is the person\'s now');
            const read = (await t.get(`/api/v1/titles/salvage-rush/players/${P3}/achievements`, games)).json();
            assert.deepStrictEqual(read.achievements.map((a) => a.id), ['first-haul']);
            assert.strictEqual((await t.get(`/api/v1/titles/salvage-rush/players/${P3}/achievements`, other)).status, 404, 'only the title\'s own principal reads its players');
            const bad = await t.get(`/api/v1/titles/salvage-rush/players/${P3}/adopt`, { ...games, json: { person: P1 } });
            assert.strictEqual(bad.json().code, 'play.bad_player', 'only a guest is adopted');
        });

        await check('the public title: achievements with how many players have each; a secret one stays secret', async () => {
            const r = await t.get('/api/v1/titles/salvage-rush', { headers: { origin: 'https://example.org' } });
            assert.strictEqual(r.headers.get('access-control-allow-origin'), '*', 'public reads answer any site');
            const title = r.json().title;
            assert.deepStrictEqual(title.achievements.map((a) => [a.id, a.unlocked_by]), [['first-haul', 2], ['big-haul', 1], ['secret-one', 0]]);
            assert.deepStrictEqual(title.achievements[2], { id: 'secret-one', hidden: true, unlocked_by: 0, name: 'A secret achievement', description: '' });
            assert.strictEqual(title.players, 2);
            assert.deepStrictEqual((await t.get('/api/v1/titles')).json().titles.map((x) => x.id), ['salvage-rush']);
        });

        await check('a definition left out is retired, its unlocks kept; a board never changes kind', async () => {
            const lessDoc = { ...DOC, achievements: DOC.achievements.filter((a) => a.id !== 'big-haul') };
            assert.strictEqual((await define(lessDoc)).status, 200);
            const ids = (await t.get('/api/v1/titles/salvage-rush')).json().title.achievements.map((a) => a.id);
            assert.deepStrictEqual(ids, ['first-haul', 'secret-one']);
            const flip = await define({ ...DOC, boards: [{ id: 'best', name: 'Best round', kind: 'sum' }] });
            assert.deepStrictEqual([flip.status, flip.json().code], [409, 'play.board_kind_fixed']);
            assert.strictEqual((await define(DOC)).status, 200, 'and back');
            assert.deepStrictEqual((await t.get(`/api/v1/titles/salvage-rush/players/${P1}/achievements`, games)).json().achievements.map((a) => a.id).sort(), ['big-haul', 'first-haul'], 'unlocks survived the retirement');
        });

        await check('a person reads their own achievements with their token', async () => {
            const ada = t.network.addUser('ada-me');
            const me = await t.get('/api/v1/me/achievements', { bearer: t.network.userToken(ada) });
            assert.strictEqual(me.status, 200);
            assert.ok(Array.isArray(me.json().titles));
            assert.strictEqual((await t.get('/api/v1/me/achievements')).status, 401);
        });

        await check('the pages: home, a title, a board with its tabs, the docs, and llms.txt name the game', async () => {
            const home = await t.get('/');
            assert.strictEqual(home.status, 200);
            assert.match(home.text, /Salvage Rush/);
            const title = await t.get('/t/salvage-rush');
            assert.match(title.text, /<h1>Salvage Rush<\/h1>/);
            assert.match(title.text, /A secret achievement/);
            assert.doesNotMatch(title.text, /Nobody knows/, 'a secret achievement\'s text never shows');
            const board = await t.get('/t/salvage-rush/b/best?period=week');
            assert.match(board.text, /aria-current="page">This week</);
            assert.doesNotMatch(board.text, /usr_|guest:/);
            assert.strictEqual((await t.get('/t/nope')).status, 404);
            assert.strictEqual((await t.get('/t/salvage-rush/b/nope')).status, 404);
            assert.match((await t.get('/docs')).text, /POST \/titles\/:title\/scores/);
            assert.match((await t.get('/llms.txt')).text, /Salvage Rush: achievements and leaderboards/);
            assert.match((await t.get('/sitemap.xml')).text, /\/t\/salvage-rush\/b\/best\?period=week/);
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
