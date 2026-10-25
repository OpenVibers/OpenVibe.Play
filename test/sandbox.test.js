'use strict';
// Any developer tries Play from a sandbox app (ADR-014 opt-in): its titles' ids start with sandbox-, it has at most
// three, their players are guests only and never adopted, and they are never listed, counted or indexed (readable by
// their id, marked sandbox). A production app never takes a sandbox- id.
const assert = require('assert');
const crypto = require('crypto');
const { serviceAuth } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');

const PROJECT = 'prj_01JABCDEFGHJKMNPQRSTVWXYZ0';
const P1 = 'usr_01JABCDEFGHJKMNPQRSTVWXYZ0';
const G1 = 'guest:a1b2c3d4e5f6';
const CAPS = ['play.title.manage', 'play.result.write', 'play.player.read'];

(async () => {
    const t = await boot();
    try {
        const app = (id, env) => {
            const now = Math.floor(Date.now() / 1000);
            return { bearer: serviceAuth.signServiceToken({ iss: t.network.url, sub: `app:${id}`, actor_type: 'app', aud: ['openvibe.play'], cap: CAPS, ns: [PROJECT], project_id: PROJECT, env, iat: now, exp: now + 300, jti: `tok_${crypto.randomBytes(8).toString('hex')}` }, t.network.privatePem) };
        };
        const sandbox = app('app_01JABCDEFGHJKMNPQRSTVWXYZ0', 'sandbox');
        const production = app('app_01JABCDEFGHJKMNPQRSTVWXYZ1', 'production');
        const DOC = { name: 'Gem Run', achievements: [{ id: 'first-gem', name: 'First Gem' }], boards: [{ id: 'best', name: 'Best', kind: 'best' }] };
        const put = (id, auth, body = DOC) => t.get(`/api/v1/titles/${id}`, { ...auth, method: 'PUT', json: body });
        const code = async (p) => { const r = await p; return [r.status, r.json().code]; };

        await check('a sandbox app registers sandbox- titles only, at most three; a production app never one', async () => {
            assert.deepStrictEqual(await code(put('gem-run', sandbox)), [400, 'play.sandbox_title']);
            const made = await put('sandbox-gem-run', sandbox);
            assert.strictEqual(made.status, 201, made.text);
            assert.strictEqual(made.json().title.sandbox, true);
            assert.deepStrictEqual(await code(put('sandbox-other', production)), [400, 'play.sandbox_title']);
            assert.strictEqual((await put('gem-run', production)).status, 201, 'a production app takes the real name');
            assert.strictEqual((await put('sandbox-two', sandbox)).status, 201);
            assert.strictEqual((await put('sandbox-three', sandbox)).status, 201);
            assert.deepStrictEqual(await code(put('sandbox-four', sandbox)), [409, 'play.sandbox_limit']);
            assert.strictEqual((await put('sandbox-gem-run', sandbox, { ...DOC, summary: 'Updated.' })).status, 200, 'updating one is not a new one');
        });

        await check('a sandbox title\'s players are guests only, and none is adopted', async () => {
            const post = (path, json) => t.get(`/api/v1/titles/sandbox-gem-run/${path}`, { ...sandbox, json });
            assert.deepStrictEqual(await code(post('scores', { board: 'best', ref: 'r1', entries: [{ player: P1, name: 'Ada', score: 5 }] })), [400, 'play.sandbox_guests_only']);
            assert.deepStrictEqual((await post('scores', { board: 'best', ref: 'r1', entries: [{ player: G1, name: 'Tester', score: 5 }] })).json(), { recorded: 1, repeated: 0 });
            assert.deepStrictEqual(await code(post('unlocks', { player: P1, achievements: ['first-gem'] })), [400, 'play.sandbox_guests_only']);
            assert.deepStrictEqual((await post('unlocks', { player: G1, achievements: ['first-gem'] })).json(), { unlocked: ['first-gem'] });
            assert.deepStrictEqual(await code(post(`players/${G1}/adopt`, { person: P1 })), [400, 'play.sandbox_guests_only']);
            const save = (player) => t.get(`/api/v1/titles/sandbox-gem-run/players/${player}/saves/main`, { ...sandbox, method: 'PUT', json: { data: { level: 1 } } });
            assert.deepStrictEqual(await code(save(P1)), [400, 'play.sandbox_guests_only']);
            assert.strictEqual((await save(G1)).status, 200);
        });

        await check('a sandbox title is never listed or indexed, and answers at its id', async () => {
            const listed = (await t.get('/api/v1/titles')).json().titles.map((x) => x.id);
            assert.ok(listed.includes('gem-run') && !listed.some((id) => id.startsWith('sandbox-')), listed.join(','));
            assert.strictEqual((await t.get('/api/v1/titles/sandbox-gem-run')).json().title.sandbox, true);
            const pageOf = await t.get('/t/sandbox-gem-run');
            assert.strictEqual(pageOf.status, 200);
            assert.match(pageOf.text, /<meta name="robots" content="noindex/);
            assert.match(pageOf.text, /Sandbox: a developer is trying Play/);
            assert.match((await t.get('/t/sandbox-gem-run/b/best')).text, /<meta name="robots" content="noindex/);
            assert.match((await t.get('/t/gem-run')).text, /<meta name="robots" content="index/);
            assert.ok(!(await t.get('/')).text.includes('sandbox-gem-run'), 'not on the home');
            assert.ok(!(await t.get('/sitemap.xml')).text.includes('sandbox-'), 'not in the sitemap');
        });

        await check('a sandbox title is deleted by its app with everything in it; a production title never', async () => {
            const del = (id, auth) => t.get(`/api/v1/titles/${id}`, { ...auth, method: 'DELETE' });
            assert.deepStrictEqual(await code(del('gem-run', production)), [409, 'play.title_kept']);
            assert.deepStrictEqual(await code(del('sandbox-gem-run', production)), [404, 'play.unknown_title'], 'another app is told it does not exist');
            assert.strictEqual((await del('sandbox-gem-run', sandbox)).status, 204);
            assert.strictEqual((await t.get('/api/v1/titles/sandbox-gem-run')).status, 404);
            assert.strictEqual((await t.get('/t/sandbox-gem-run/b/best')).status, 404, 'its boards went with it');
            assert.strictEqual((await put('sandbox-four', sandbox)).status, 201, 'the room it took is free again');
        });

        await check('the docs and the home say how to start', async () => {
            const docs = await t.get('/docs');
            assert.match(docs.text, /<h2 id="sandbox">Your own game: start in the sandbox<\/h2>/);
            assert.match(docs.text, /https:\/\/openvibe\.services\/projects/);
            assert.match((await t.get('/')).text, /Can I add my own game\?/);
        });
    } finally { await t.close(); }
    done();
})();
