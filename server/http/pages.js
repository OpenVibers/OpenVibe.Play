'use strict';

/**
 * OpenVibe.Play's pages, server-rendered and usable without JavaScript:
 *
 *   /                          the titles, each with its newest achievements and this week's leaders
 *   /t/:title                  one title: every achievement (how many players have it) and its boards
 *   /t/:title/b/:board         one leaderboard, this week or all time, 25 a page
 *   /me                        a signed-in person's achievements across titles
 *   /docs                      the API for a game's developer
 *   /updates                   the update log
 *
 * A board shows a name and a score, never a player id.
 */
const ovServe = require('openvibe-shared/serve');
const frame = require('openvibe-shared/frame');
const showcase = require('openvibe-shared/showcase');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { html, raw } = require('../render/html');
const { send } = require('../render/layout');
const { PlayError, PLAYER_RE } = require('../play/store');

const SITE_NAME = 'OpenVibe.Play';
const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function boardTable(b, { compact = false } = {}) {
    if (!b.entries.length) return html`<p class="pl-empty">${b.period === 'week' ? 'Nobody has scored this week yet.' : 'Nobody has scored yet.'}</p>`;
    return html`<table class="pl-board${compact ? ' pl-board-compact' : ''}"><caption class="pl-sr">${b.name}, ${b.period === 'week' ? 'this week' : 'all time'}</caption>
<thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col" class="pl-n">${b.kind === 'sum' ? 'Total' : 'Best'}</th></tr></thead>
<tbody>${b.entries.map((e) => html`<tr><td class="pl-rank">${String(e.rank)}</td><td>${e.name}${e.signed_in ? '' : raw(' <span class="pl-guest" title="Playing as a guest">guest</span>')}</td><td class="pl-n">${num(e.score)}</td></tr>`)}</tbody></table>`;
}

function achievementList(list, { players = 0 } = {}) {
    if (!list.length) return html`<p class="pl-empty">No achievements yet.</p>`;
    return html`<ul class="pl-ach">${list.map((a) => html`<li class="${a.hidden ? 'pl-ach-hidden' : ''}"><span class="pl-ach-name">${a.name}</span>${a.description ? html`<span class="pl-ach-desc">${a.description}</span>` : ''}${a.unlocked_by !== undefined ? html`<span class="pl-ach-meta">${plural(a.unlocked_by, 'player', 'players')}${players ? ` · ${pct(a.unlocked_by, players)}` : ''}</span>` : ''}${a.unlocked_at ? html`<span class="pl-ach-meta">Unlocked ${a.unlocked_at.slice(0, 10)}</span>` : ''}</li>`)}</ul>`;
}

function createPageRoutes(ctx) {
    const { config, play } = ctx;
    const r = asyncRouter();
    const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 120 });
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => (req.viewer && req.viewer.kind === 'user' && PLAYER_RE.test(String(req.viewer.subject || '')) && String(req.viewer.subject).startsWith('usr_') ? req.viewer.subject : null);
    const notFound = (req, res, what) => page(req, res, { title: 'Not found', body: html`<h1>Not found</h1><p>${what} <a href="/">See every game</a>.</p>` }, 404);

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const titles = await play.titles();
        const me = signedIn(req);
        const leaders = new Map();
        for (const t of titles) {
            if (t.boards.length) leaders.set(t.id, await play.board(t.id, t.boards[0].id, { period: 'week' }));
        }
        const hero = showcase.hero({
            eyebrow: `${SITE_NAME} · part of OpenVibe`,
            title: 'Achievements and leaderboards',
            accent: 'for every OpenVibe game.',
            lede: 'The scores you post and the achievements you unlock in OpenVibe games, in one place: this week\'s leaders, the all-time boards, and what you have earned with your OpenVibe account.',
            actions: me
                ? [{ label: 'Your achievements', href: '/me', primary: true }, { label: 'Play on OpenVibe.Games', href: 'https://openvibe.games/' }]
                : [{ label: 'Play on OpenVibe.Games', href: 'https://openvibe.games/', primary: true }, { label: 'Sign in to see yours', href: '/auth/login?next=%2Fme' }],
            note: 'Guests appear on the boards too; sign in and a game moves your guest progress to your account.',
        });
        page(req, res, {
            index: true, cache: me ? null : PUBLIC_CACHE,
            jsonLd: homeJsonLd(config),
            styles: [showcase.STYLESHEET],
            body: html`${raw(hero)}
<section class="pl-titles" aria-labelledby="pl-titles-h"><h2 id="pl-titles-h">Games</h2>
${titles.length ? html`<div class="pl-grid">${titles.map((t) => html`<article class="pl-card">
<h3><a href="/t/${t.id}">${t.name}</a></h3>
${t.summary ? html`<p class="pl-muted">${t.summary}</p>` : ''}
<p class="pl-meta">${plural(t.achievements.length, 'achievement', 'achievements')} · ${plural(t.players, 'player', 'players')} with one${t.url ? html` · <a href="${t.url}">Play</a>` : ''}</p>
${leaders.has(t.id) ? html`<h4>This week: ${leaders.get(t.id).name}</h4>${boardTable({ ...leaders.get(t.id), entries: leaders.get(t.id).entries.slice(0, 5) }, { compact: true })}<p><a href="/t/${t.id}/b/${leaders.get(t.id).board}?period=week">The whole board</a></p>` : ''}
</article>`)}</div>` : html`<p class="pl-empty">No game has joined yet.</p>`}
</section>
${raw(showcase.steps({
                title: 'How a game uses Play',
                items: [
                    { title: 'Register the title', text: 'A game\'s server registers its title with its own OpenVibe token: its achievements and its boards.' },
                    { title: 'Post what happened', text: 'Scores for each round and the achievements a player unlocked, each idempotent, so a retry never counts twice.' },
                    { title: 'Read the boards anywhere', text: 'Boards are public JSON for any page: a best score or a total, this week or all time.' },
                    { title: 'Guests count', text: 'A guest plays at once; when they sign in, the game moves their progress to their account.', href: '/docs' },
                ],
            }))}`,
        });
    });

    // ── A title ──────────────────────────────────────────────
    r.get('/t/:title', async (req, res) => {
        const t = await play.title(req.params.title);
        if (!t) return notFound(req, res, 'No game here.');
        const boards = [];
        for (const b of t.boards) boards.push(await play.board(t.id, b.id, { period: 'week' }));
        page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: `${t.name}: achievements and leaderboards`,
            description: `${t.name} on OpenVibe.Play: ${plural(t.achievements.length, 'achievement', 'achievements')} and ${plural(t.boards.length, 'leaderboard', 'leaderboards')}, this week and all time.`,
            body: html`<p class="pl-crumbs"><a href="/">Games</a> /</p>
<h1>${t.name}</h1>
${t.summary ? html`<p class="pl-lede">${t.summary}</p>` : ''}
${t.url ? html`<p><a class="pl-button" href="${t.url}">Play ${t.name}</a></p>` : ''}
${boards.length ? html`<section aria-labelledby="pl-boards-h"><h2 id="pl-boards-h">Leaderboards this week</h2>${boards.map((b) => html`<h3>${b.name}</h3>${boardTable({ ...b, entries: b.entries.slice(0, 10) })}<p><a href="/t/${t.id}/b/${b.board}?period=week">This week</a> · <a href="/t/${t.id}/b/${b.board}?period=all">All time</a></p>`)}</section>` : ''}
<section aria-labelledby="pl-ach-h"><h2 id="pl-ach-h">Achievements</h2><p class="pl-muted">${plural(t.players, 'player has', 'players have')} unlocked at least one.</p>${achievementList(t.achievements, { players: t.players })}</section>`,
        });
    });

    // ── A board ──────────────────────────────────────────────
    r.get('/t/:title/b/:board', async (req, res) => {
        const period = req.query.period === 'week' ? 'week' : 'all';
        const pageNo = Math.max(1, Math.min(10_000, parseInt(req.query.page, 10) || 1));
        let b;
        try { b = await play.board(req.params.title, req.params.board, { period, page: pageNo }); } catch (err) {
            if (err instanceof PlayError) return notFound(req, res, 'No board here.');
            throw err;
        }
        const link = (o) => `/t/${b.title}/b/${b.board}?period=${o.period || period}${(o.page || 1) > 1 ? `&page=${o.page}` : ''}`;
        page(req, res, {
            index: true, cache: PUBLIC_CACHE, title: `${b.name}, ${period === 'week' ? 'this week' : 'all time'} · ${b.title_name}`,
            description: `The ${b.name} leaderboard of ${b.title_name}, ${period === 'week' ? 'this week' : 'all time'}: ${b.kind === 'sum' ? 'each player\'s total' : 'each player\'s best score'}.`,
            body: html`<p class="pl-crumbs"><a href="/">Games</a> / <a href="/t/${b.title}">${b.title_name}</a> /</p>
<h1>${b.name}</h1>
<p class="pl-muted">${b.kind === 'sum' ? 'Each player\'s total' : 'Each player\'s best score'}${period === 'week' ? `, since Monday ${String(b.since || '').slice(0, 10)} (UTC)` : ', all time'}. ${plural(b.total, 'player', 'players')}.</p>
<nav class="pl-tabs" aria-label="Period">${period === 'week' ? html`<span aria-current="page">This week</span>` : html`<a href="${link({ period: 'week' })}">This week</a>`}${period === 'all' ? html`<span aria-current="page">All time</span>` : html`<a href="${link({ period: 'all' })}">All time</a>`}</nav>
${boardTable(b)}
${b.pages > 1 ? html`<nav class="pl-pages" aria-label="Pages">${pageNo > 1 ? html`<a href="${link({ page: pageNo - 1 })}" rel="prev">Previous</a>` : ''}<span>Page ${String(pageNo)} of ${String(b.pages)}</span>${pageNo < b.pages ? html`<a href="${link({ page: pageNo + 1 })}" rel="next">Next</a>` : ''}</nav>` : ''}`,
        });
    });

    // ── Yours ────────────────────────────────────────────────
    r.get('/me', async (req, res) => {
        const me = signedIn(req);
        if (!me) {
            return page(req, res, { title: 'Your achievements', body: html`<h1>Your achievements</h1><p>Sign in with your OpenVibe account to see what you have unlocked in every game.</p><p><a class="pl-button" href="/auth/login?next=%2Fme">Sign in with OpenVibe</a></p>` });
        }
        const titles = await play.playerAchievements(me);
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        page(req, res, {
            title: 'Your achievements',
            body: html`<h1>Your achievements</h1>
${titles.length ? titles.map((t) => html`<section><h2><a href="/t/${t.title}">${t.name}</a></h2><p class="pl-muted">${plural(t.achievements.length, 'achievement', 'achievements')}</p>${achievementList(t.achievements)}</section>`)
        : html`<p class="pl-empty">Nothing yet. <a href="https://openvibe.games/">Play a game</a> signed in, and what you unlock shows here.</p>`}`,
        });
    });

    // ── For developers ───────────────────────────────────────
    r.get('/docs', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE, title: 'The Play API',
        description: 'Register a game\'s achievements and leaderboards, post scores and unlocks, and read the boards: the OpenVibe.Play API.',
        body: html`<h1>The Play API</h1>
<p class="pl-lede">A game registers its title with its own OpenVibe token, posts what its players did, and reads its boards. Base address: <code>https://play.openvibe.network/api/v1</code>. Errors are RFC 9457 problem+json with a stable <code>code</code>.</p>
<h2>Reading (anyone, any site)</h2>
<ul>
<li><code>GET /titles</code>: every game, with its achievements (how many players have each) and its boards.</li>
<li><code>GET /titles/:title</code>: one game.</li>
<li><code>GET /titles/:title/boards/:board?period=week|all&amp;page=1</code>: 25 entries a page: <code>rank</code>, <code>name</code>, <code>score</code>, and whether the player was signed in. Never a player id.</li>
<li><code>GET /me/achievements</code>: with a person's Network token, their own unlocks in every game.</li>
</ul>
<h2>Writing (the game's own token)</h2>
<p>A game's server uses a Network service or app token for audience <code>openvibe.play</code>. Only the principal that registered a title writes to it; to anyone else the title does not exist.</p>
<ul>
<li><code>PUT /titles/:title</code> (<code>play.title.manage</code>): <code>{ name, url, summary, achievements: [{ id, name, description, hidden }], boards: [{ id, name, kind: "best" | "sum" }] }</code>. A definition left out is retired, never deleted: what players earned stays. A board's kind never changes.</li>
<li><code>POST /titles/:title/scores</code> (<code>play.result.write</code>): <code>{ board, ref, entries: [{ player, name, score }] }</code>, up to 100 entries. <code>ref</code> names the round or run; posting it again changes nothing.</li>
<li><code>POST /titles/:title/unlocks</code> (<code>play.result.write</code>): <code>{ player, achievements: [id] }</code>; answers the ones that were new.</li>
<li><code>POST /titles/:title/players/:guest/adopt</code> (<code>play.result.write</code>): <code>{ person: "usr_…" }</code> when a guest signs in: their unlocks and scores become the person's.</li>
<li><code>GET /titles/:title/players/:player/achievements</code> (<code>play.player.read</code>): a player's unlocks in your game.</li>
</ul>
<p>A <code>player</code> is a person's OpenVibe subject (<code>usr_…</code>) or a guest your game names, <code>guest:</code> followed by 8 to 128 letters, digits, <code>_</code> or <code>-</code>. Only people's rows are personal data: they are in the person's account export and erased with their account.</p>`,
    }));

    r.get('/updates', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE,
        title: `What shipped on ${SITE_NAME}`,
        body: raw(frame.updatesBody({ service: 'play', siteName: SITE_NAME }) + `<script src="${ovServe.url('shipped.js')}" defer></script>`),
    }));

    // ── Discovery: robots.txt, sitemap.xml, llms.txt, llms-full.txt ──
    r.use(createDiscoveryRoutes(ctx));
    return r;
}

module.exports = { createPageRoutes };
