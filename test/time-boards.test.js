'use strict';
// OpenVibe.Play's time boards: a score is whole milliseconds, a player's entry is their fastest run, and the board
// ranks it ascending. best and sum keep their MAX/DESC and SUM/DESC behaviour, and every board says its unit.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const P1 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ0';
const P2 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ1';
const P3 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ2';
const DAY = 86_400_000;

(async () => {
    let clock = Date.UTC(2026, 9, 14, 12);   // a Wednesday
    const t = await boot({ now: () => clock });
    try {
        const games = { bearer: t.network.serviceToken('surf', ['play.title.manage', 'play.result.write', 'play.player.read']) };
        const define = (body) => t.get('/api/v1/titles/surf-ride', { ...games, method: 'PUT', json: body });
        const post = (body) => t.get('/api/v1/titles/surf-ride/scores', { ...games, json: body });
        const board = async (id, period = 'all') => (await t.get(`/api/v1/titles/surf-ride/boards/${id}?period=${period}`)).json();
        const DOC = {
            name: 'Surf Ride', url: 'https://openvibe.games/play?game=surf-ride', summary: 'Browser surf runs.',
            boards: [
                { id: 'best', name: 'Best score', kind: 'best' },
                { id: 'haul', name: 'Total haul', kind: 'sum' },
                { id: 'time', name: 'Fastest run', kind: 'time' },
            ],
        };

        await check('a game defines a time board; its public answers say milliseconds, the others points', async () => {
            const created = await define(DOC);
            assert.strictEqual(created.status, 201, created.text);
            assert.deepStrictEqual(created.json().title.boards.map((b) => [b.id, b.kind, b.unit]),
                [['best', 'best', 'points'], ['haul', 'sum', 'points'], ['time', 'time', 'ms']]);
            assert.deepStrictEqual([(await board('time')).kind, (await board('time')).unit], ['time', 'ms']);
            assert.strictEqual((await board('best')).unit, 'points');
            assert.strictEqual((await board('haul')).unit, 'points');
            const bad = await define({ ...DOC, boards: [...DOC.boards, { id: 'bad', name: 'Bad', kind: 'lowest' }] });
            assert.deepStrictEqual([bad.status, bad.json().code], [400, 'play.bad_definitions']);
        });

        await check('a time board keeps each player\'s lowest score and ranks fastest first', async () => {
            clock += 60_000;
            await post({ board: 'time', ref: 'run-1', entries: [{ player: P1, name: 'Ada', score: 61_234 }] });
            clock += 60_000;
            await post({ board: 'time', ref: 'run-2', entries: [{ player: P1, name: 'Ada L.', score: 59_870 }] });
            clock += 60_000;
            await post({ board: 'time', ref: 'run-3', entries: [{ player: P1, name: 'Ada L.', score: 60_001 }, { player: P2, name: 'Bo', score: 59_000 }] });
            assert.deepStrictEqual((await board('time')).entries, [
                { rank: 1, name: 'Bo', score: 59_000, signed_in: true },
                { rank: 2, name: 'Ada L.', score: 59_870, signed_in: true },
            ], 'P1 keeps 59 870, not the later 60 001; the board is ascending');
        });

        await check('a time tie goes to the earlier submission', async () => {
            clock += 60_000;
            // One post has one `at`: the order here is the submission order. P1 and P2 have smaller player ids than P3,
            // so a player-id tie-break would rank them first; the earliest row must win instead.
            await post({ board: 'time', ref: 'tie', entries: [
                { player: P3, name: 'Cy', score: 55_000 },
                { player: P2, name: 'Bo', score: 55_000 },
                { player: P1, name: 'Ada L.', score: 55_000 },
            ] });
            assert.deepStrictEqual((await board('time')).entries.map((e) => [e.name, e.score]),
                [['Cy', 55_000], ['Bo', 55_000], ['Ada L.', 55_000]]);
        });

        await check('a repeated round changes nothing, even with a faster time', async () => {
            const repeated = await post({ board: 'time', ref: 'run-2', entries: [{ player: P1, name: 'Ada', score: 1 }] });
            assert.deepStrictEqual(repeated.json(), { recorded: 0, repeated: 1 });
            assert.strictEqual((await board('time')).entries.find((e) => e.name === 'Ada L.').score, 55_000);
        });

        await check('a time score is whole milliseconds from 0 to 24 hours', async () => {
            for (const score of [-1, 1.5, DAY + 1, Number.MAX_SAFE_INTEGER + 1]) {
                const refused = await post({ board: 'time', ref: `bad-${String(score)}`, entries: [{ player: P1, name: 'Ada', score }] });
                assert.strictEqual(refused.status, 400, `score ${score}`);
                assert.strictEqual(refused.json().code, 'play.bad_scores');
                assert.match(refused.headers.get('content-type'), /application\/problem\+json/);
            }
            assert.deepStrictEqual((await post({ board: 'time', ref: 'max', entries: [{ player: P2, name: 'Bo', score: DAY }] })).json(), { recorded: 1, repeated: 0 });
            assert.deepStrictEqual((await post({ board: 'time', ref: 'zero', entries: [{ player: P2, name: 'Bo', score: 0 }] })).json(), { recorded: 1, repeated: 0 });
            assert.strictEqual((await board('time')).entries[0].score, 0, 'the maximum is inclusive and zero is a time');
        });

        await check('a time board still reads this week or all time', async () => {
            await post({ board: 'time', ref: 'old-run', at: clock - 8 * DAY, entries: [{ player: P1, name: 'Ada', score: 1_000 }] });
            assert.strictEqual((await board('time')).entries[0].score, 0, 'all time keeps the lowest, including an old run');
            assert.deepStrictEqual((await board('time', 'week')).entries.map((e) => [e.name, e.score]),
                [['Bo', 0], ['Cy', 55_000], ['Ada L.', 55_000]], 'the old run is not this week');
        });

        await check('best and sum boards are unchanged', async () => {
            clock += 60_000;
            await post({ board: 'best', ref: 'b-1', entries: [{ player: P1, name: 'Ada', score: 300 }, { player: P2, name: 'Bo', score: 450 }] });
            clock += 60_000;
            await post({ board: 'best', ref: 'b-2', entries: [{ player: P1, name: 'Ada L.', score: 500 }, { player: P2, name: 'Bo', score: 100 }] });
            await post({ board: 'haul', ref: 'h-1', entries: [{ player: P1, name: 'Ada L.', score: 20 }, { player: P2, name: 'Bo', score: 25 }] });
            await post({ board: 'haul', ref: 'h-2', entries: [{ player: P1, name: 'Ada L.', score: 10 }] });
            assert.deepStrictEqual((await board('best')).entries.map((e) => [e.name, e.score]), [['Ada L.', 500], ['Bo', 450]]);
            assert.deepStrictEqual((await board('haul')).entries.map((e) => [e.name, e.score]), [['Ada L.', 30], ['Bo', 25]]);
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
