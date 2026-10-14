'use strict';
/**
 * ADR-033: Play's part of an account export and of an account deletion, through the signed loopback route
 * POST /internal/events with a stand-in Network. Alice's unlocks and scores are exported; her deletion removes them (her
 * scores leave every board), leaves Bob's and a guest's rows alone, and confirms once.
 */
const assert = require('assert');
const http = require('http');
const { createNetworkSender } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { boot, check, done } = require('./helpers/boot');

const SECRET = `whsec_${'fixture'.repeat(6)}`;

async function startNetworkStub() {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_play', token_type: 'Bearer', expires_in: 300 });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') });
            return json(201, {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
    const stub = await startNetworkStub();
    const t = await boot({ env: { PLAY_EVENTS_SECRET: SECRET }, accountSend: createNetworkSender({ networkInternalUrl: stub.url, clientId: 'play', clientSecret: 'play-secret' }) });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const GUEST = 'guest:zz9plural9alpha';
    const db = t.ctx.s.db;
    const count = async (sql, args) => Number(await db.value(sql, args));
    const deliver = async (event, { secret = SECRET, headers = {} } = {}) => {
        const body = JSON.stringify({ event, seq: 1 });
        const res = await fetch(`${t.base}/internal/events`, { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, secret), ...headers } });
        return { status: res.status, json: await res.json().catch(() => null) };
    };
    const ev = (id, type, payload) => ({ event_id: id, event_type: type, source: 'network', version: 1, timestamp: new Date().toISOString(), payload });
    const play = t.ctx.play;

    try {
        await check('alice, bob and a guest play a title', async () => {
            await play.define('service:games', 'salvage-rush', { name: 'Salvage Rush', achievements: [{ id: 'first-haul', name: 'First Haul' }], boards: [{ id: 'best', name: 'Best round', kind: 'best' }] });
            await play.recordScores('service:games', 'salvage-rush', { board: 'best', ref: 'r1', entries: [
                { player: alice.subject, name: 'Alice', score: 400 }, { player: bob.subject, name: 'Bob', score: 300 }, { player: GUEST, name: 'Guest', score: 200 },
            ] });
            for (const p of [alice.subject, bob.subject, GUEST]) await play.unlock('service:games', 'salvage-rush', { player: p, achievements: ['first-haul'] });
        });

        await check('the export carries her unlocks and scores, and nothing of anyone else\'s', async () => {
            const r = await deliver(ev('evt_01JZ0000000000000000000E01', 'network.account.export_requested', { export_id: 'exp_01JZ0000000000000000000EX1', subject: alice.subject }));
            assert.deepStrictEqual([r.status, r.json && r.json.outcome], [200, 'exported'], JSON.stringify(r.json));
            const part = stub.calls.find((c) => c.url === '/internal/account-exports/exp_01JZ0000000000000000000EX1/parts');
            assert.strictEqual(part.auth, 'Bearer tok_play');
            assert.deepStrictEqual(part.body.files.map((f) => f.name).sort(), ['achievements.json', 'scores.json']);
            assert.strictEqual(Number(part.body.files.find((f) => f.name === 'scores.json').content[0].score), 400);
            assert.ok(!JSON.stringify(part.body).includes(bob.subject) && !JSON.stringify(part.body).includes(GUEST));
        });

        await check('the deletion removes her rows (she leaves the board) and confirms once', async () => {
            const event = ev('evt_01JZ0000000000000000000D01', 'network.account.deleted', { deletion_id: 'del_01JZ0000000000000000000DE1', subject: alice.subject });
            const r = await deliver(event);
            assert.deepStrictEqual([r.status, r.json && r.json.outcome], [200, 'erased'], JSON.stringify(r.json));
            assert.strictEqual(await count('SELECT count(*) FROM play_unlocks WHERE player = $1', [alice.subject]), 0);
            assert.strictEqual(await count('SELECT count(*) FROM play_scores WHERE player = $1', [alice.subject]), 0);
            assert.strictEqual(await count('SELECT count(*) FROM play_scores WHERE player = ANY($1)', [[bob.subject, GUEST]]), 2, 'bob and the guest keep theirs');
            const board = await play.board('salvage-rush', 'best');
            assert.deepStrictEqual(board.entries.map((e) => e.name), ['Bob', 'Guest']);
            const conf = stub.calls.filter((c) => c.url === '/internal/account-deletions/del_01JZ0000000000000000000DE1/confirmations');
            assert.strictEqual(conf.length, 1);
            assert.deepStrictEqual([conf[0].body.erased.play_unlocks, conf[0].body.erased.play_scores], [1, 1]);
            assert.strictEqual((await deliver(event)).json.outcome, 'unchanged');
        });

        await check('a merge folds bob into carol in every title, once; a payload that is not one is ignored', async () => {
            const carol = 'usr_01JZ0000000000000000000CA1';
            await play.recordScores('service:games', 'salvage-rush', { board: 'best', ref: 'r2', entries: [
                { player: bob.subject, name: 'Bob', score: 350 }, { player: carol, name: 'Carol', score: 500 },
            ] });
            await play.unlock('service:games', 'salvage-rush', { player: carol, achievements: ['first-haul'] });
            const event = ev('evt_01JZ0000000000000000000M01', 'network.subject.merged', { merge_id: 'mrg_01JZ0000000000000000000MG1', from: bob.subject, into: carol });
            const r = await deliver(event);
            assert.deepStrictEqual([r.status, r.json && r.json.outcome], [200, 'merged'], JSON.stringify(r.json));
            assert.strictEqual(await count('SELECT count(*) FROM play_scores WHERE player = $1', [bob.subject]), 0);
            assert.strictEqual(await count('SELECT count(*) FROM play_unlocks WHERE player = $1', [bob.subject]), 0);
            assert.strictEqual(await count('SELECT count(*) FROM play_unlocks WHERE player = $1', [carol]), 1, 'one unlock of first-haul: the two accounts\' are one');
            assert.deepStrictEqual((await t.ctx.s.db.many('SELECT ref, score FROM play_scores WHERE player = $1 ORDER BY ref', [carol])).map((x) => [x.ref, Number(x.score)]),
                [['r1', 300], ['r2', 500]], 'bob\'s round 1 is carol\'s now; in round 2 both played and carol\'s own score stays');
            assert.strictEqual((await deliver(event)).json.outcome, 'unchanged');
            const bad = ev('evt_01JZ0000000000000000000M02', 'network.subject.merged', { merge_id: 'mrg_01JZ0000000000000000000MG2', from: carol, into: carol });
            assert.strictEqual((await deliver(bad)).json.outcome, 'ignored:payload');
        });

        await check('the route refuses a bad signature and a request that came through a proxy', async () => {
            const event = ev('evt_01JZ0000000000000000000E02', 'network.account.export_requested', { export_id: 'exp_01JZ0000000000000000000EX2', subject: alice.subject });
            assert.strictEqual((await deliver(event, { secret: `whsec_${'mismatch'.repeat(5)}` })).status, 401);
            assert.strictEqual((await deliver(event, { headers: { 'X-Forwarded-For': '203.0.113.9' } })).status, 403);
        });
    } finally {
        await t.close();
        await stub.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
