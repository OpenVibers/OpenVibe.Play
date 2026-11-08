'use strict';

/**
 * Crawl artifacts for play.openvibe.network. The service's pages moved into OpenVibe.Games (2026-11), so Play is
 * an API host now: robots.txt points crawlers at Games' sitemap, sitemap.xml redirects there, and llms.txt names
 * the Games pages a person (or a model) wants while keeping the API's own machine-readable reads.
 *
 *   /robots.txt      public; sitemap is Games', /auth and /api stay out
 *   /sitemap.xml     301 → https://openvibe.games/sitemap.xml
 *   /llms.txt        public; the moved pages on Games and the API that stays here
 *   /llms-full.txt   301 → https://openvibe.games/llms-full.txt
 *
 * Nothing here reads the database: the API's own reads are the source of truth and are linked, not copied.
 */
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Play';
const DESCRIPTION = 'The game services API behind OpenVibe games: achievements, leaderboards and cloud saves.';
const GAMES_SITE = 'https://openvibe.games';
const SITE = 'https://play.openvibe.network';
const DISALLOW = ['/auth/', '/api/'];

function createDiscoveryRoutes() {
    const r = asyncRouter();
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# play.openvibe.network: the player pages live on openvibe.games; this host serves the games API.\n'
            + seo.robotsTxt({ sitemaps: [`${GAMES_SITE}/sitemap.xml`], disallow: DISALLOW }));
    });

    // The pages are Games' now. A crawler that still asks Play's sitemap is sent to the one that lists them.
    r.get('/sitemap.xml', (_req, res) => res.redirect(301, `${GAMES_SITE}/sitemap.xml`));
    r.get('/llms-full.txt', (_req, res) => res.redirect(301, `${GAMES_SITE}/llms-full.txt`));

    r.get('/llms.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: 'The game services API behind OpenVibe games: achievements, leaderboards and cloud saves. The player pages are part of OpenVibe.Games.',
            details: 'Play keeps each game\'s title, achievements, boards and cloud saves and answers them as JSON. '
                + 'The pages that show them are on openvibe.games: achievements, leaderboards and the API guide for game makers. '
                + 'The API itself stays at play.openvibe.network/api/v1 because every game calls it.',
            sections: [
                { title: 'Page now on OpenVibe.Games', links: [
                    { title: 'Achievements', url: `${GAMES_SITE}/achievements`, note: 'yours when signed in, every game\'s when signed out' },
                    { title: 'Leaderboards', url: `${GAMES_SITE}/leaderboards`, note: 'each game, this week and all time' },
                    { title: 'The Play API for game makers', url: `${GAMES_SITE}/developers`, note: 'register a title, post scores and unlocks, keep cloud saves' },
                ] },
                { title: 'API (still on this host)', links: [
                    { title: 'GET /api/v1/titles', url: `${SITE}/api/v1/titles`, note: 'every game, its achievements and boards (JSON, public)' },
                    { title: 'GET /api/v1/titles/:title/boards/:board?period=week|all', url: `${SITE}/api/v1/titles`, note: 'a board: rank, name, score, never a player id' },
                    { title: 'GET /api/v1/people/:subject/achievements', url: `${SITE}/api/v1/people`, note: 'a person\'s unlocks in every game' },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'Sitemap (OpenVibe.Games)', url: `${GAMES_SITE}/sitemap.xml` },
                    { title: 'Full text for language models (OpenVibe.Games)', url: `${GAMES_SITE}/llms-full.txt` },
                    { title: 'Release metadata (JSON)', url: `${SITE}/release.json` },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Games', url: `${GAMES_SITE}/`, note: 'play the games' },
                    { title: 'OpenVibe.Play README', url: 'https://github.com/OpenVibers/OpenVibe.Play#readme', note: 'the service and its API' },
                ] },
            ],
        }));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, DESCRIPTION, SITE_NAME, GAMES_SITE };
