'use strict';

/**
 * /api/v1 — OpenVibe.Play's API (capabilities: openvibe-contracts manifests/capabilities/play.*).
 *
 *   GET  /ping                                            public             liveness
 *   GET  /titles                                          public             every title, with its achievements and boards
 *   GET  /titles/:title                                   public             one title
 *   GET  /titles/:title/boards/:board?period=&page=       public             a leaderboard: rank, name, score (never a player id)
 *   GET  /people/:subject/achievements                    public             a person's unlocks across every title (their profile:
 *                                                                              OpenVibe.Network's /@name and any site's showcase)
 *   GET  /me/achievements                                 a person           their own unlocks across titles
 *   PUT  /titles/:title                                   play.title.manage  register or update a title the caller manages
 *   POST /titles/:title/scores                            play.result.write  post a round's scores to a board (idempotent by ref)
 *   POST /titles/:title/unlocks                           play.result.write  unlock achievements for a player (idempotent)
 *   POST /titles/:title/players/:guest/adopt              play.result.write  a guest signed in: their rows become the person's
 *   GET  /titles/:title/players/:player/achievements      play.player.read   a player's unlocks in a title the caller manages
 *   GET  /titles/:title/players/:player/saves             play.player.read   a player's cloud save slots (without the data)
 *   GET  /titles/:title/players/:player/saves/:slot       play.player.read   one slot: { slot, version, data, … }
 *   PUT  /titles/:title/players/:player/saves/:slot       play.result.write  write it ({ data, version? }: a stale version is 409)
 *   DELETE /titles/:title/players/:player/saves/:slot     play.result.write  delete it
 *   GET  /me/saves, DELETE /me/saves/:title/:slot         a person           their own slots in every title; delete one
 *
 * Writes come from the principal that registered the title (a game's service token); another one is told the title
 * does not exist. Public reads answer every origin without credentials. A refusal is RFC 9457 problem+json.
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { PlayError } = require('../play/store');

function createApi(ctx) {
    const { config, principal, limits, play } = ctx;
    const r = asyncRouter();

    r.use(express.json({ limit: '160kb' }));   // a save is at most 64 KB of JSON (store.js MAX_SAVE_BYTES), with room for the envelope
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    const wrap = (fn) => async (req, res) => {
        try { return await fn(req, res); } catch (err) {
            if (err instanceof PlayError) return http.sendProblem(res, err.status, err.code, { detail: err.detail, ctx: req.ov });
            throw err;
        }
    };
    /** Writes and title-scoped reads are a principal's (a game's service or app token), never a person's. */
    const titleOwner = (req, res, next) => {
        if (req.principal.kind === 'app') return next();
        return http.sendProblem(res, 403, 'play.title_principal_required', { detail: 'A title is managed with its game\'s own Network token (a service or app), not a person\'s.', ctx: req.ov });
    };
    const reads = limits.reads('play.read');

    r.get('/ping', reads, (_req, res) => res.json({ ok: true, service: config.service }));

    // ── Public reads ──────────────────────────────────────
    r.get('/titles', reads, wrap(async (_req, res) => res.json({ titles: await play.titles() })));
    r.get('/titles/:title', reads, wrap(async (req, res) => {
        const t = await play.title(req.params.title);
        return t ? res.json({ title: t }) : http.sendProblem(res, 404, 'play.unknown_title', { detail: 'no such title', ctx: req.ov });
    }));
    r.get('/titles/:title/boards/:board', reads, wrap(async (req, res) => {
        const page = req.query.page === undefined ? 1 : Number(req.query.page);
        return res.json(await play.board(req.params.title, req.params.board, { period: String(req.query.period || 'all'), page }));
    }));

    // A person's unlocks, for their public profile (Steam-style: what you earned shows wherever you are). Only people
    // (usr_…): a guest's rows are a game's own until it adopts them. 404 for no unlocks, the same as for no such person.
    r.get('/people/:subject/achievements', reads, wrap(async (req, res) => {
        const subject = String(req.params.subject || '');
        if (!/^usr_[0-9A-HJKMNP-TV-Z]{26}$/.test(subject)) return http.sendProblem(res, 404, 'play.unknown_person', { detail: 'no such person', ctx: req.ov });
        const titles = await play.playerAchievements(subject);
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ subject, total: titles.reduce((n, t) => n + t.achievements.length, 0), titles });
    }));

    // ── A person's own ────────────────────────────────────
    r.get('/me/achievements', reads, wrap(async (req, res) => {
        if (req.principal.kind !== 'user') return http.sendProblem(res, 401, 'token.required', { detail: 'Sign in at play.openvibe.network, or send your Network token.', ctx: req.ov });
        return res.json({ titles: await play.playerAchievements(req.principal.requester.slice(5)) });
    }));

    const signedIn = (req, res) => {
        if (req.principal.kind === 'user') return true;
        http.sendProblem(res, 401, 'token.required', { detail: 'Sign in at play.openvibe.network, or send your Network token.', ctx: req.ov });
        return false;
    };
    r.get('/me/saves', reads, wrap(async (req, res) => {
        if (!signedIn(req, res)) return undefined;
        return res.json({ saves: await play.mySaves(req.principal.requester.slice(5)) });
    }));
    r.delete('/me/saves/:title/:slot', limits.budget('play.write'), wrap(async (req, res) => {
        if (!signedIn(req, res)) return undefined;
        const gone = await play.deleteMySave(req.principal.requester.slice(5), req.params.title, req.params.slot);
        return gone ? res.status(204).end() : http.sendProblem(res, 404, 'play.no_save', { detail: 'no save in that slot', ctx: req.ov });
    }));

    // ── A title's own principal ───────────────────────────
    r.put('/titles/:title', principal.requireCapability('play.title.manage'), titleOwner, limits.budget('play.define'), wrap(async (req, res) => {
        const out = await play.define(req.principal.requester, req.params.title, req.body || {});
        return res.status(out.created ? 201 : 200).json(out);
    }));
    r.post('/titles/:title/scores', principal.requireCapability('play.result.write'), titleOwner, limits.budget('play.write'), wrap(async (req, res) => {
        res.json(await play.recordScores(req.principal.requester, req.params.title, req.body || {}));
    }));
    r.post('/titles/:title/unlocks', principal.requireCapability('play.result.write'), titleOwner, limits.budget('play.write'), wrap(async (req, res) => {
        res.json(await play.unlock(req.principal.requester, req.params.title, req.body || {}));
    }));
    r.post('/titles/:title/players/:guest/adopt', principal.requireCapability('play.result.write'), titleOwner, limits.budget('play.write'), wrap(async (req, res) => {
        res.json(await play.adopt(req.principal.requester, req.params.title, req.params.guest, String((req.body || {}).person || '')));
    }));
    r.get('/titles/:title/players/:player/achievements', principal.requireCapability('play.player.read'), titleOwner, reads, wrap(async (req, res) => {
        await play.ownTitle(req.principal.requester, req.params.title);
        const [t] = await play.playerAchievements(req.params.player, { titleId: req.params.title });
        res.json({ title: req.params.title, player: req.params.player, achievements: t ? t.achievements : [] });
    }));

    // ── Cloud saves (a title's own principal, for one player) ──
    const savesOf = (req) => [req.principal.requester, req.params.title, req.params.player];
    r.get('/titles/:title/players/:player/saves', principal.requireCapability('play.player.read'), titleOwner, reads, wrap(async (req, res) => {
        res.json({ title: req.params.title, player: req.params.player, saves: await play.listSaves(...savesOf(req)) });
    }));
    r.get('/titles/:title/players/:player/saves/:slot', principal.requireCapability('play.player.read'), titleOwner, reads, wrap(async (req, res) => {
        res.json(await play.getSave(...savesOf(req), req.params.slot));
    }));
    r.put('/titles/:title/players/:player/saves/:slot', principal.requireCapability('play.result.write'), titleOwner, limits.budget('play.write'), wrap(async (req, res) => {
        const b = req.body || {};
        res.json(await play.putSave(...savesOf(req), req.params.slot, { data: b.data, version: b.version }));
    }));
    r.delete('/titles/:title/players/:player/saves/:slot', principal.requireCapability('play.result.write'), titleOwner, limits.budget('play.write'), wrap(async (req, res) => {
        const gone = await play.deleteSave(...savesOf(req), req.params.slot);
        return gone ? res.status(204).end() : http.sendProblem(res, 404, 'play.no_save', { detail: 'no save in that slot', ctx: req.ov });
    }));

    return r;
}

module.exports = { createApi };
