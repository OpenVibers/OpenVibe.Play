'use strict';

/**
 * The Play pages moved into OpenVibe.Games (2026-11): achievements and leaderboards are Games pages now, and the
 * Play API for game makers is openvibe.games/developers. Every old page answers 301 to its counterpart there; the
 * API at /api/v1 stays exactly where it is, because every game calls it.
 *
 *   /                          → openvibe.games/achievements
 *   /achievements, /me         → openvibe.games/achievements
 *   /leaderboards              → openvibe.games/leaderboards
 *   /developers, /docs         → openvibe.games/developers
 *   /updates                   → openvibe.games/updates
 *   /t/:title                  → that game on openvibe.games (or the leaderboards for an unknown title)
 *   /t/:title/b/:board         → openvibe.games/leaderboards?game=…&board=… (its period kept)
 */
const express = require('express');

const GAMES = 'https://openvibe.games';
/** The games Games plays, by Play title id. A title without a page of its own lands on the leaderboards. */
const GAME_PAGES = {
    scraplandia: `${GAMES}/play`,
    'salvage-rush': `${GAMES}/play?game=salvage-rush`,
    'vibe-heroes': `${GAMES}/play/vibe-heroes`,
};

function createMovedRoutes() {
    const r = express.Router();
    const go = (target) => (_req, res) => res.redirect(301, target);

    r.get('/', go(`${GAMES}/achievements`));
    r.get('/achievements', go(`${GAMES}/achievements`));
    r.get('/me', go(`${GAMES}/achievements`));
    r.get('/leaderboards', go(`${GAMES}/leaderboards`));
    r.get('/developers', go(`${GAMES}/developers`));
    r.get('/docs', go(`${GAMES}/developers`));
    r.get('/updates', go(`${GAMES}/updates`));

    r.get('/t/:title', (req, res) => {
        const title = String(req.params.title || '').toLowerCase();
        res.redirect(301, GAME_PAGES[title] || `${GAMES}/leaderboards?game=${encodeURIComponent(title)}`);
    });
    r.get('/t/:title/b/:board', (req, res) => {
        const title = String(req.params.title || '').toLowerCase();
        const query = new URLSearchParams({ game: title, board: String(req.params.board || '') });
        if (req.query.period === 'week') query.set('period', 'week');
        res.redirect(301, `${GAMES}/leaderboards?${query}`);
    });
    return r;
}

module.exports = { createMovedRoutes, GAME_PAGES, GAMES };
