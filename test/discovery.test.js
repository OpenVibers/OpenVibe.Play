'use strict';
// Crawl artifacts (server/http/discovery.js): robots.txt keeps crawlers off sign-in, the API and /me; the sitemap lists
// the public pages, each game and both periods of each board; llms.txt maps them with the read API; llms-full.txt
// spells out the visible achievements and never a secret one.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        const games = { bearer: t.network.serviceToken('games', ['play.title.manage']) };
        const put = await t.get('/api/v1/titles/scraplandia', { ...games, method: 'PUT', json: {
            name: 'Scraplandia', url: 'https://openvibe.games/play', summary: 'Scrappy multiplayer survival-building.',
            achievements: [{ id: 'first-haul', name: 'First Haul', description: 'Extract a valuable.' }, { id: 'hidden-one', name: 'Ghost', description: 'Shh.', hidden: true }],
            boards: [{ id: 'haul', name: 'Haul', kind: 'sum' }],
        } });
        assert.strictEqual(put.status, 201, put.text);

        await check('robots.txt keeps crawlers off sign-in, the API and /me, and names the sitemap', async () => {
            const r = await t.get('/robots.txt');
            assert.strictEqual(r.status, 200);
            for (const p of ['/auth/', '/api/', '/me']) assert.ok(r.text.includes(`Disallow: ${p}`), p);
            assert.match(r.text, /Sitemap: https:\/\/play\.openvibe\.network\/sitemap\.xml/);
        });

        await check('the sitemap lists the pages, the game and both periods of its board', async () => {
            const r = await t.get('/sitemap.xml');
            assert.match(r.headers.get('content-type'), /xml/);
            for (const loc of ['/', '/docs', '/updates', '/t/scraplandia', '/t/scraplandia/b/haul?period=week', '/t/scraplandia/b/haul']) {
                assert.ok(r.text.includes(`<loc>https://play.openvibe.network${loc.replace('&', '&amp;')}</loc>`), loc);
            }
        });

        await check('llms.txt maps the game, its board and the read API', async () => {
            const r = await t.get('/llms.txt');
            assert.match(r.text, /^# OpenVibe\.Play/m);
            assert.match(r.text, /Scraplandia: achievements and leaderboards/);
            assert.match(r.text, /\/api\/v1\/titles\/scraplandia\/boards\/haul\?period=all/);
        });

        await check('llms-full.txt spells out the visible achievements, never a secret one', async () => {
            const r = await t.get('/llms-full.txt');
            assert.match(r.text, /First Haul/);
            assert.doesNotMatch(r.text, /Ghost|Shh/);
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
