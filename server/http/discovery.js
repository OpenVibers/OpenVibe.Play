'use strict';

/**
 * Crawl artifacts for play.openvibe.network, built with openvibe-shared/seo: robots.txt, sitemap.xml, llms.txt and
 * llms-full.txt, and the home page's JSON-LD. The public pages are for search engines and AI crawlers; sign-in and
 * the API are not (the boards' public JSON is linked from llms.txt for agents that read it).
 *
 * The titles are read through ctx.play: the sitemap lists each game's page and each of its boards (this week and all
 * time); llms.txt maps them with the read API; llms-full.txt spells out every achievement.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Play';
const DESCRIPTION = 'OpenVibe.Play: achievements and leaderboards for every OpenVibe game.';
const DISALLOW = ['/auth/', '/api/', '/me'];

const PAGE_TEXT = {
    '/': ['OpenVibe.Play home', 'Every OpenVibe game with its achievements and this week\'s leaders.'],
    '/docs': ['The Play API', 'How a game registers its achievements and leaderboards, posts scores and unlocks, and reads its boards.'],
    '/updates': ['What shipped on OpenVibe.Play', 'This site\'s update log, from the network changelog feed.'],
};

function dayOf(ts) {
    const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

const publicPages = () => [
    { path: '/', changefreq: 'hourly', priority: 1.0 },
    { path: '/docs', changefreq: 'monthly', priority: 0.6 },
    { path: '/updates', changefreq: 'daily', priority: 0.4 },
];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function createDiscoveryRoutes(ctx) {
    const { config, play } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });
    const boardPath = (t, b, period) => `/t/${t}/b/${b}?period=${period}`;

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# play.openvibe.network: the public pages are for search and AI crawlers; sign-in and the API are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', async (_req, res) => {
        const titles = await play.titles();
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'Each OpenVibe game registers its achievements and leaderboards here with its own token and posts what its '
                + 'players did; the boards are public. A player is a person with an OpenVibe account or a guest of the game. '
                + 'Every page is server-rendered and readable without JavaScript.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Play', url: abs('/'), note: 'every game and this week\'s leaders' },
                    { title: 'The Play API', url: abs('/docs') },
                    { title: 'What shipped on OpenVibe.Play', url: abs('/updates') },
                ] },
                ...titles.map((t) => ({ title: t.name, links: [
                    { title: `${t.name}: achievements and leaderboards`, url: abs(`/t/${t.id}`), note: `${plural(t.achievements.length, 'achievement', 'achievements')}` },
                    ...t.boards.map((b) => ({ title: `${b.name}, this week`, url: abs(boardPath(t.id, b.id, 'week')) })),
                    ...t.boards.map((b) => ({ title: `${b.name} (JSON)`, url: abs(`/api/v1/titles/${t.id}/boards/${b.id}?period=all`) })),
                ] })),
                { title: 'API', links: [
                    { title: 'GET /api/v1/titles', url: abs('/api/v1/titles'), note: 'every game, its achievements and boards' },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Full text for language models', url: abs('/llms-full.txt') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Games', url: 'https://openvibe.games', note: 'play the games' },
                    { title: 'OpenVibe.Network', url: 'https://openvibe.network', note: 'accounts, apps and grants' },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        const titles = await play.titles();
        const pages = publicPages().map((e) => ({ url: e.path, title: PAGE_TEXT[e.path][0], text: PAGE_TEXT[e.path][1] }));
        const sections = titles.map((t) => ({
            title: t.name,
            pages: [
                { title: `${t.name}: achievements and leaderboards`, url: `/t/${t.id}`, text: t.summary || `${plural(t.achievements.length, 'achievement', 'achievements')}` },
                ...t.achievements.filter((a) => !a.hidden).map((a) => ({ title: a.name, url: `/t/${t.id}`, text: a.description || 'An achievement' })),
                ...t.boards.map((b) => ({ title: b.name, url: boardPath(t.id, b.id, 'all'), text: b.kind === 'sum' ? 'Each player\'s total' : 'Each player\'s best score' })),
            ],
        }));
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME, summary: 'Every public page of OpenVibe.Play, one line each.', base: site, maxBytes: 64 * 1024,
            sections: [{ title: 'Pages', pages }, ...sections],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        const titles = await play.titles();
        const entries = [
            ...publicPages(),
            ...titles.flatMap((t) => [
                { path: `/t/${t.id}`, changefreq: 'daily', priority: 0.8 },
                ...t.boards.flatMap((b) => [{ path: boardPath(t.id, b.id, 'week'), changefreq: 'hourly', priority: 0.6 }, { path: boardPath(t.id, b.id, 'all'), changefreq: 'daily', priority: 0.5 }]),
            ]),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(entries.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority }))));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME };
