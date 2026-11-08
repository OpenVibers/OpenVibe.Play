'use strict';
/**
 * The Play pages moved into OpenVibe.Games: every old page address answers 301 to its counterpart there,
 * and the API at /api/v1 does not move. The crawl files follow: Play's robots.txt names Games' sitemap,
 * its sitemap and llms-full.txt redirect to Games', and its llms.txt says where the pages are and that the
 * API stays on this host.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');

const GAMES = 'https://openvibe.games';

(async () => {
    const t = await boot();
    try {
        await check('every page address answers 301 to its OpenVibe.Games counterpart', async () => {
            const cases = [
                ['/', `${GAMES}/achievements`],
                ['/achievements', `${GAMES}/achievements`],
                ['/me', `${GAMES}/achievements`],
                ['/leaderboards', `${GAMES}/leaderboards`],
                ['/developers', `${GAMES}/developers`],
                ['/docs', `${GAMES}/developers`],
                ['/updates', `${GAMES}/updates`],
                ['/t/scraplandia', `${GAMES}/play`],
                ['/t/salvage-rush', `${GAMES}/play?game=salvage-rush`],
                ['/t/vibe-heroes', `${GAMES}/play/vibe-heroes`],
            ];
            for (const [from, to] of cases) {
                const r = await t.get(from);
                assert.strictEqual(r.status, 301, `${from}: ${r.status}`);
                assert.strictEqual(r.headers.get('location'), to, from);
            }
            const unknown = await t.get('/t/sandbox-gem-run');
            assert.strictEqual(unknown.status, 301);
            assert.strictEqual(unknown.headers.get('location'), `${GAMES}/leaderboards?game=sandbox-gem-run`);
        });

        await check('a board page keeps its game, board and period on the Games leaderboards', async () => {
            const r = await t.get('/t/salvage-rush/b/best?period=week');
            assert.strictEqual(r.status, 301);
            const loc = new URL(r.headers.get('location'));
            assert.strictEqual(`${loc.origin}${loc.pathname}`, `${GAMES}/leaderboards`);
            assert.deepStrictEqual(Object.fromEntries(loc.searchParams), {
                game: 'salvage-rush',
                board: 'best',
                period: 'week',
            });
        });

        await check('the API stays exactly where it is, under /api/v1', async () => {
            const ping = await t.get('/api/v1/ping');
            assert.strictEqual(ping.status, 200);
            assert.strictEqual(ping.json().ok, true);
            const titles = await t.get('/api/v1/titles');
            assert.strictEqual(titles.status, 200);
            assert.ok(Array.isArray(titles.json().titles));
        });

        await check('robots.txt names Games\' sitemap and keeps sign-in and the API out', async () => {
            const r = await t.get('/robots.txt');
            assert.strictEqual(r.status, 200);
            assert.match(r.text, /Sitemap: https:\/\/openvibe\.games\/sitemap\.xml/);
            assert.ok(r.text.includes('Disallow: /auth/'));
            assert.ok(r.text.includes('Disallow: /api/'));
        });

        await check('sitemap.xml and llms-full.txt redirect to Games; llms.txt points at the moved pages and the API', async () => {
            for (const [path, target] of [
                ['/sitemap.xml', `${GAMES}/sitemap.xml`],
                ['/llms-full.txt', `${GAMES}/llms-full.txt`],
            ]) {
                const r = await t.get(path);
                assert.strictEqual(r.status, 301, path);
                assert.strictEqual(r.headers.get('location'), target, path);
            }
            const llms = await t.get('/llms.txt');
            assert.strictEqual(llms.status, 200);
            assert.match(llms.text, /^# OpenVibe\.Play/m);
            for (const page of ['/achievements', '/leaderboards', '/developers']) {
                assert.ok(llms.text.includes(`${GAMES}${page}`), page);
            }
            assert.ok(llms.text.includes('https://play.openvibe.network/api/v1/titles'));
        });

        await check('an unknown page is a plain 404, not the old home page', async () => {
            const r = await t.get('/nope');
            assert.strictEqual(r.status, 404);
            assert.ok(!r.text.includes('Achievements, leaderboards'));
            assert.match(r.text, /openvibe\.games/);
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
