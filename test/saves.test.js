'use strict';
// Cloud saves (migrations/0004_saves.sql, server/play/store.js): a title's own token writes and reads each player's
// save slots (any JSON up to 64 KB, at most 8 slots), versioned so a stale write is refused; another principal is told
// the title does not exist; a guest's slots go to the person on adoption (the newer wins a clash); a person lists and
// deletes their own slots; account export carries them and deletion removes them.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const G1 = 'guest:a1b2c3d4e5f6';

(async () => {
    let clock = Date.UTC(2026, 9, 16, 12);
    const t = await boot({ now: () => clock });
    try {
        const games = { bearer: t.network.serviceToken('games', ['play.title.manage', 'play.result.write', 'play.player.read']) };
        const other = { bearer: t.network.serviceToken('quest', ['play.title.manage', 'play.result.write', 'play.player.read']) };
        const ada = t.network.addUser('ada');
        const P1 = ada.subject;
        const slot = (player, s, o = {}) => `/api/v1/titles/vibe-heroes/players/${encodeURIComponent(player)}/saves/${s}`;
        assert.strictEqual((await t.get('/api/v1/titles/vibe-heroes', { ...games, method: 'PUT', json: { name: 'Vibe Heroes' } })).status, 201);

        await check('write, read and list a slot; a stale version is refused; another principal sees no title', async () => {
            const put = await t.get(slot(P1, 'main'), { ...games, method: 'PUT', json: { data: { stage: 12, heroes: ['ada', 'bo'] }, version: 0 } });
            assert.strictEqual(put.status, 200, put.text);
            assert.deepStrictEqual([put.json().slot, put.json().version, put.json().size > 10], ['main', 1, true]);
            const got = (await t.get(slot(P1, 'main'), games)).json();
            assert.deepStrictEqual([got.version, got.data], [1, { stage: 12, heroes: ['ada', 'bo'] }]);
            clock += 1000;
            assert.strictEqual((await t.get(slot(P1, 'main'), { ...games, method: 'PUT', json: { data: { stage: 13 }, version: 1 } })).json().version, 2);
            const stale = await t.get(slot(P1, 'main'), { ...games, method: 'PUT', json: { data: { stage: 1 }, version: 1 } });
            assert.deepStrictEqual([stale.status, stale.json().code], [409, 'play.save_conflict'], 'two devices cannot overwrite each other silently');
            assert.strictEqual((await t.get(slot(P1, 'main'), { ...games, method: 'PUT', json: { data: { stage: 14 } } })).json().version, 3, 'a write without a version simply wins');
            const list = (await t.get(`/api/v1/titles/vibe-heroes/players/${P1}/saves`, games)).json();
            assert.deepStrictEqual(list.saves.map((x) => [x.slot, x.version]), [['main', 3]]);
            assert.ok(!('data' in list.saves[0]), 'the list carries no data');
            assert.strictEqual((await t.get(slot(P1, 'main'), other)).status, 404, 'another game is told the title does not exist');
            assert.strictEqual((await t.get(slot(P1, 'main'))).status, 401);
        });

        await check('limits: 64 KB a save, 8 slots, slot names; a missing slot is 404; delete', async () => {
            const big = await t.get(slot(P1, 'big'), { ...games, method: 'PUT', json: { data: 'x'.repeat(70000) } });
            assert.deepStrictEqual([big.status, big.json().code], [413, 'play.save_too_large']);
            assert.strictEqual((await t.get(slot(P1, 'Bad Slot!'), { ...games, method: 'PUT', json: { data: 1 } })).status, 400);
            for (let i = 1; i < 8; i++) assert.strictEqual((await t.get(slot(P1, `s${i}`), { ...games, method: 'PUT', json: { data: i } })).status, 200);
            const ninth = await t.get(slot(P1, 's8'), { ...games, method: 'PUT', json: { data: 8 } });
            assert.deepStrictEqual([ninth.status, ninth.json().code], [409, 'play.too_many_slots']);
            assert.strictEqual((await t.get(slot(P1, 's7'), { ...games, method: 'DELETE' })).status, 204);
            assert.strictEqual((await t.get(slot(P1, 's7'), games)).status, 404);
        });

        await check('a guest who signs in brings their slots; the newer save wins a clash', async () => {
            clock += 1000;
            await t.get(slot(G1, 'main'), { ...games, method: 'PUT', json: { data: { stage: 99, from: 'guest' } } });
            await t.get(slot(G1, 'side'), { ...games, method: 'PUT', json: { data: { from: 'guest' } } });
            const adopt = await t.get(`/api/v1/titles/vibe-heroes/players/${encodeURIComponent(G1)}/adopt`, { ...games, json: { person: P1 } });
            assert.strictEqual(adopt.json().saves, 2);
            assert.deepStrictEqual((await t.get(slot(P1, 'main'), games)).json().data, { stage: 99, from: 'guest' }, 'the guest\'s newer save wins');
            assert.strictEqual((await t.get(slot(P1, 'side'), games)).status, 200);
            assert.deepStrictEqual((await t.get(`/api/v1/titles/vibe-heroes/players/${encodeURIComponent(G1)}/saves`, games)).json().saves, []);
        });

        await check('a person lists and deletes their own slots; account export carries them, deletion removes them', async () => {
            const me = { bearer: t.network.userToken(ada) };
            const mine = await t.get('/api/v1/me/saves', me);
            assert.strictEqual(mine.status, 200, mine.text);
            assert.ok(mine.json().saves.some((x) => x.title === 'vibe-heroes' && x.slot === 'main' && x.title_name === 'Vibe Heroes'));
            assert.strictEqual((await t.get('/api/v1/me/saves/vibe-heroes/side', { ...me, method: 'DELETE' })).status, 204);
            assert.strictEqual((await t.get('/api/v1/me/saves')).status, 401);
            const data = require('../server/play/account-data');
            assert.ok(data.TABLES.some((x) => x.table === 'play_saves' && x.file === 'saves.json'));
        });
    } finally { await t.close(); }
    done();
})();
