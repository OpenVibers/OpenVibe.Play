'use strict';
// The Markdown twins of openvibe.play's public pages (openvibe-shared/agent-layer), rendered by the same page
// builders the routes use (createPageRoutes().publicViews + render/layout.js's renderPage), so a twin cannot
// drift from its page: the home, every production game and its boards, the developer guide and the update log.
// A sandbox title's pages are not listed, not indexed and not advertised, so they have no twin.
const { renderPage } = require('./render/layout');

function createAgentPages(ctx, publicViews) {
    // A view that is not marked public (a sandbox title's) has no twin.
    const twin = (page, path) => (page && page.agent === true ? { html: renderPage({ ...page, viewer: { kind: 'anonymous' }, config: ctx.config, path }) } : null);

    async function renderPublicPage(path, { query } = {}) {
        if (path === '/') return twin(await publicViews.home({ signed: false }), path);
        if (path === '/docs') return twin(publicViews.docs(), path);
        if (path === '/updates') return twin(publicViews.updates(), path);
        let m = /^\/t\/([^/]+)$/.exec(path);
        if (m) return twin(await publicViews.title(decodeURIComponent(m[1])), path);
        m = /^\/t\/([^/]+)\/b\/([^/]+)$/.exec(path);
        if (m) {
            const period = query && query.get('period') === 'week' ? 'week' : 'all';
            const pageNo = Math.max(1, Math.min(10_000, parseInt(query && query.get('page'), 10) || 1));
            return twin(await publicViews.board(decodeURIComponent(m[1]), decodeURIComponent(m[2]), { period, page: pageNo }), path);
        }
        return null;
    }

    return { renderPublicPage };
}

module.exports = { createAgentPages };
