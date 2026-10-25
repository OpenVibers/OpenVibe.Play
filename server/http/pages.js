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
const { PlayError, PLAYER_RE, MAX_SLOTS, MAX_SAVE_BYTES, MAX_SANDBOX_TITLES, isSandbox, PER_PAGE } = require('../play/store');

const SITE_NAME = 'OpenVibe.Play';
const num = (n) => Number(n).toLocaleString('en-US');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

/** The home's questions: shown on the page and given to search engines as FAQPage data (the same text). */
const HOME_FAQ = [
    { q: 'Do players need an account?', a: 'No. A guest plays at once and appears on the boards as a guest. When they sign in with OpenVibe, the game moves their guest achievements and scores to their account.' },
    { q: 'What does a leaderboard show?', a: "Rank, name and score, never a player id. Each board keeps a player's best score or their total, this week (from Monday, UTC) and all time, and anyone can read it as public JSON." },
    { q: 'How do cloud saves avoid overwriting each other?', a: `A player has up to ${MAX_SLOTS} save slots per game, ${MAX_SAVE_BYTES / 1024} KB each. Every write names the version it read; if another device saved in between, the write is refused with play.save_conflict, so the game can merge instead of losing progress.` },
    { q: 'What happens when a game changes its achievements?', a: 'An achievement or board the game stops listing is retired, never deleted: what players earned stays on their profile.' },
    { q: 'How does a game use Play?', a: "Its server calls Play's API (or the openvibe-sdk/play client) with an OpenVibe token granted Play's capabilities. The app that registers a title is its only writer; posting the same round twice changes nothing." },
    { q: 'Can I add my own game?', a: `Yes. Make a project on openvibe.services with a sandbox app holding Play's three capabilities: it registers up to ${MAX_SANDBOX_TITLES} sandbox- titles (unlisted, guest players) to try everything. Once staff turn production on for the project, its production app takes the real name.` },
    { q: 'Where do I see my own achievements?', a: 'Sign in and open Your achievements: every game, every unlock and when it happened.' },
];
function homeFaqJsonLd() {
    return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: HOME_FAQ.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

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
        // Real figures only: hidden achievements count toward unlocks but are never named on the home.
        const shown = titles.flatMap((t) => t.achievements.filter((a) => !a.hidden).map((a) => ({ ...a, game: t })));
        const unlocks = titles.reduce((n, t) => n + t.achievements.reduce((m, a) => m + (Number(a.unlocked_by) || 0), 0), 0);
        const achievementCount = titles.reduce((n, t) => n + t.achievements.length, 0);
        const popular = shown.filter((a) => a.unlocked_by > 0).sort((x, y) => y.unlocked_by - x.unlocked_by || x.name.localeCompare(y.name)).slice(0, 6);
        const stats = [];
        if (titles.length) stats.push([plural(titles.length, 'game', 'games'), 'use Play today']);
        if (achievementCount) stats.push([plural(achievementCount, 'achievement', 'achievements'), 'to earn across them']);
        if (unlocks) stats.push([plural(unlocks, 'unlock', 'unlocks'), 'earned by players so far']);
        stats.push([`${MAX_SLOTS} save slots`, `per player per game, ${MAX_SAVE_BYTES / 1024} KB each`]);
        const hero = showcase.hero({
            eyebrow: `${SITE_NAME} · part of OpenVibe Services`,
            title: 'Achievements, leaderboards',
            accent: 'and cloud saves for every game.',
            lede: 'The game services behind OpenVibe games: achievements players keep, weekly and all-time leaderboards, and saves that follow them from device to device. Guests play at once; their progress moves to their OpenVibe account when they sign in.',
            actions: me
                ? [{ label: 'Your achievements', href: '/me', primary: true }, { label: 'Read the API', href: '/docs' }, { label: 'Play on OpenVibe.Games', href: 'https://openvibe.games/' }]
                : [{ label: 'Play on OpenVibe.Games', href: 'https://openvibe.games/', primary: true }, { label: 'Read the API', href: '/docs' }, { label: 'Sign in to see yours', href: '/auth/login?next=%2Fme' }],
            note: 'Boards show a name and a score, never a player id.',
            html: `<dl class="pl-stats">${stats.map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`).join('')}</dl>`,
        });
        page(req, res, {
            index: true, cache: me ? null : PUBLIC_CACHE,
            description: 'Game services for OpenVibe games: achievements, weekly and all-time leaderboards and cloud saves, with guests welcome and an SDK for developers.',
            jsonLd: [...homeJsonLd(config), homeFaqJsonLd()],
            styles: [showcase.STYLESHEET],
            body: html`${raw(hero)}
<section class="pl-titles" aria-labelledby="pl-titles-h"><h2 id="pl-titles-h">Games on Play</h2>
${titles.length ? html`<div class="pl-grid">${titles.map((t) => html`<article class="pl-card">
<h3><a href="/t/${t.id}">${t.name}</a></h3>
${t.summary ? html`<p class="pl-muted">${t.summary}</p>` : ''}
<p class="pl-meta">${plural(t.achievements.length, 'achievement', 'achievements')} · ${plural(t.players, 'player', 'players')} with one${t.url ? html` · <a href="${t.url}">Play</a>` : ''}</p>
${leaders.has(t.id) ? html`<h4>This week: ${leaders.get(t.id).name}</h4>${boardTable({ ...leaders.get(t.id), entries: leaders.get(t.id).entries.slice(0, 5) }, { compact: true })}<p><a href="/t/${t.id}/b/${leaders.get(t.id).board}?period=week">The whole board</a></p>` : ''}
</article>`)}</div>` : html`<p class="pl-empty">No game has joined yet.</p>`}
</section>
${popular.length ? html`<section class="pl-popular" aria-labelledby="pl-popular-h"><h2 id="pl-popular-h">Most earned</h2><p class="pl-muted">The achievements the most players have unlocked.</p>
<ul class="pl-ach">${popular.map((a) => html`<li><span class="pl-ach-name">${a.name}</span>${a.description ? html`<span class="pl-ach-desc">${a.description}</span>` : ''}<span class="pl-ach-meta"><a href="/t/${a.game.id}">${a.game.name}</a> · ${plural(a.unlocked_by, 'player', 'players')}${a.game.players ? ` · ${pct(a.unlocked_by, a.game.players)}` : ''}</span></li>`)}</ul></section>` : ''}
${raw(showcase.features({
                title: 'What a game gets',
                lede: 'Four services, one OpenVibe account for every player, and nothing to host yourself.',
                items: [
                    { title: 'Achievements', text: 'Define them once; unlocks are idempotent, secret ones show only as "A secret achievement", and retired ones stay on every profile.' },
                    { title: 'Leaderboards', text: `Best score or total, this week and all time, ${PER_PAGE} to a page, readable by any site as public JSON.` },
                    { title: 'Cloud saves', text: `${MAX_SLOTS} slots per player per game, ${MAX_SAVE_BYTES / 1024} KB each, with a version check so two devices never overwrite each other.`, href: '/docs' },
                    { title: 'Guests and accounts', text: 'Guests play at once; when they sign in, their unlocks and scores move to their account, and merged OpenVibe accounts keep both histories.' },
                ],
            }))}
${raw(showcase.steps({
                title: 'How a game uses Play',
                items: [
                    { title: 'Register the title', text: 'A game\'s server registers its title with its own OpenVibe token: its achievements and its boards. Yours starts in the sandbox.', href: '/docs#sandbox' },
                    { title: 'Post what happened', text: 'Scores for each round and the achievements a player unlocked, each idempotent, so a retry never counts twice.' },
                    { title: 'Read the boards anywhere', text: 'Boards are public JSON for any page: a best score or a total, this week or all time.' },
                    { title: 'Guests count', text: 'A guest plays at once; when they sign in, the game moves their progress to their account.', href: '/docs' },
                ],
            }))}
${raw(showcase.code({
                id: 'sdk',
                title: 'From your game server',
                lede: 'The openvibe-sdk/play client, with a token for your app, or plain HTTPS: boards and titles need no token at all.',
                samples: [
                    {
                        label: 'Node (openvibe-sdk)', lang: 'js',
                        code: `const { createClient } = require('openvibe-sdk/core');
const { createPlayClient } = require('openvibe-sdk/play');

const play = createPlayClient(createClient({ tokenProvider: tokens }));   // your app's OpenVibe tokens
await play.titles.define('gem-run', {
    name: 'Gem Run', achievements: [{ id: 'first-gem', name: 'First Gem' }],
    boards: [{ id: 'high-score', name: 'High score', kind: 'best' }],
});
await play.scores.post('gem-run', { board: 'high-score', ref: 'round-42', entries: [{ player: 'usr_…', name: 'kim', score: 1200 }] });
await play.achievements.unlock('gem-run', { player: 'usr_…', achievements: ['first-gem'] });   // → the new ones
await play.saves.put('gem-run', 'usr_…', 'main', { data: { level: 3 }, version: 0 });`,
                    },
                    {
                        label: 'Any language (HTTPS)', lang: 'bash',
                        code: `# A public board: rank, name and score, this week
curl -s 'https://play.openvibe.network/api/v1/titles/scraplandia/boards/haul?period=week'`,
                    },
                ],
            }))}
${raw(showcase.limits({
                title: 'Limits',
                lede: 'What one game and one player get today.',
                columns: ['Today'],
                rows: [
                    { label: 'Save slots per player, per game', values: [String(MAX_SLOTS)] },
                    { label: 'Size of one save', values: [`${MAX_SAVE_BYTES / 1024} KB`] },
                    { label: 'Scores in one post', values: ['100'] },
                    { label: 'Board entries per page', values: [String(PER_PAGE)] },
                    { label: 'Requests per caller', values: [`${num(config.limits.minute)} a minute, ${num(config.limits.hour)} an hour`] },
                ],
            }))}
<section class="pl-faq" aria-labelledby="pl-faq-h"><h2 id="pl-faq-h">Questions</h2>${HOME_FAQ.map((f) => html`<details><summary>${f.q}</summary><p>${f.a}</p></details>`)}</section>`,
        });
    });

    // ── A title ──────────────────────────────────────────────
    r.get('/t/:title', async (req, res) => {
        const t = await play.title(req.params.title);
        if (!t) return notFound(req, res, 'No game here.');
        const boards = [];
        for (const b of t.boards) boards.push(await play.board(t.id, b.id, { period: 'week' }));
        page(req, res, {
            index: !t.sandbox, cache: PUBLIC_CACHE, title: `${t.name}: achievements and leaderboards`,
            description: `${t.name} on OpenVibe.Play: ${plural(t.achievements.length, 'achievement', 'achievements')} and ${plural(t.boards.length, 'leaderboard', 'leaderboards')}, this week and all time.`,
            body: html`<p class="pl-crumbs"><a href="/">Games</a> /</p>
<h1>${t.name}</h1>
${t.sandbox ? html`<p class="pl-muted">Sandbox: a developer is trying Play with this game. It is not listed anywhere, and its players are guests.</p>` : ''}
${t.summary ? html`<p class="pl-lede">${t.summary}</p>` : ''}
${t.url ? html`<p><a class="pl-button" href="${t.url}">Play ${t.name}</a></p>` : ''}
${boards.length ? html`<section aria-labelledby="pl-boards-h"><h2 id="pl-boards-h">Leaderboards this week</h2>${boards.map((b) => html`<h3>${b.name}</h3>${boardTable({ ...b, entries: b.entries.slice(0, 10) })}<p><a href="/t/${t.id}/b/${b.board}?period=week">This week</a> · <a href="/t/${t.id}/b/${b.board}">All time</a></p>`)}</section>` : ''}
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
        // All time is the board's plain address and this week is ?period=week: two pages, each its own canonical (the
        // week board named the all-time one while the sitemap listed both).
        const link = (o) => {
            const q = [(o.period || period) === 'week' ? 'period=week' : null, (o.page || 1) > 1 ? `page=${o.page}` : null].filter(Boolean);
            return `/t/${b.title}/b/${b.board}${q.length ? `?${q.join('&')}` : ''}`;
        };
        page(req, res, {
            canonicalPath: link({ page: pageNo }),
            index: !isSandbox(b.title), cache: PUBLIC_CACHE, title: `${b.name}, ${period === 'week' ? 'this week' : 'all time'} · ${b.title_name}`,
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
        const [titles, saves] = await Promise.all([play.playerAchievements(me), play.mySaves(me)]);
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        page(req, res, {
            title: 'Your achievements',
            body: html`<h1>Your achievements</h1>
${titles.length ? titles.map((t) => html`<section><h2><a href="/t/${t.title}">${t.name}</a></h2><p class="pl-muted">${plural(t.achievements.length, 'achievement', 'achievements')}</p>${achievementList(t.achievements)}</section>`)
        : html`<p class="pl-empty">Nothing yet. <a href="https://openvibe.games/">Play a game</a> signed in, and what you unlock shows here.</p>`}
${saves.length ? html`<section><h2>Your saves</h2><p class="pl-muted">What games keep for you in the cloud, so your progress follows you to any device.</p><ul>${saves.map((x) => html`<li><a href="/t/${x.title}">${x.title_name}</a>: <code>${x.slot}</code> <span class="pl-muted">· ${Math.max(1, Math.round(x.size / 1024))} KB · saved ${x.updated_at.slice(0, 10)}</span></li>`)}</ul></section>` : ''}`,
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
<li><code>GET /people/:subject/achievements</code>: anyone, from any site: a person's unlocks in every game (what their profile shows).</li>
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
<h2>Cloud saves</h2>
<p>A player's progress follows them to any device: up to 8 slots per player in your game, each any JSON value of at most 64 KB. Slots move with a guest who signs in (the newer save wins a clash) and with an account merge.</p>
<ul>
<li><code>PUT /titles/:title/players/:player/saves/:slot</code> (<code>play.result.write</code>): <code>{ data, version }</code>. <code>version</code> is the version you read (0 for a new slot): if the slot moved on since, the write is refused with <code>409 play.save_conflict</code>, so two devices never overwrite each other silently. Leave it out to overwrite.</li>
<li><code>GET /titles/:title/players/:player/saves/:slot</code> (<code>play.player.read</code>): <code>{ slot, version, data, created_at, updated_at }</code>; <code>GET …/saves</code> lists the slots without their data; <code>DELETE …/saves/:slot</code> (<code>play.result.write</code>).</li>
<li><code>GET /me/saves</code> and <code>DELETE /me/saves/:title/:slot</code>: with a person's own Network token, their slots in every game.</li>
</ul>
<p>A <code>player</code> is a person's OpenVibe subject (<code>usr_…</code>) or a guest your game names, <code>guest:</code> followed by 8 to 128 letters, digits, <code>_</code> or <code>-</code>. Only people's rows are personal data: they are in the person's account export and erased with their account.</p>
<h2 id="sandbox">Your own game: start in the sandbox</h2>
<ol>
<li>Sign in on <a href="https://openvibe.services/projects">OpenVibe Services</a> and make a project (new projects are sandbox-only).</li>
<li>Add a sandbox app and ask for <code>play.title.manage</code>, <code>play.result.write</code> and <code>play.player.read</code>: a sandbox app gets them without waiting for anyone.</li>
<li>Get a token for audience <code>openvibe.play</code> (client credentials) and <code>PUT /titles/sandbox-your-game</code>.</li>
</ol>
<p>A sandbox app registers up to ${String(MAX_SANDBOX_TITLES)} titles, each id starting with <code>sandbox-</code>, and deletes one with everything in it by <code>DELETE /titles/:title</code> (<code>play.title.manage</code>; a production title is never deleted) (anything else answers <code>400 play.sandbox_title</code>). Their players are guests only (<code>400 play.sandbox_guests_only</code> for a person), nothing is adopted, and they are never listed, counted or indexed: their pages and JSON answer at their id, marked <code>sandbox: true</code>, so you can check your boards. When your game is ready, staff turn production on for your project; its production app registers the real name and real players' progress counts on their profiles.</p>`,
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
