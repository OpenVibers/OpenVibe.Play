'use strict';

/**
 * OpenVibe.Play's store: titles, their achievements and leaderboards, and what players did (migrations/0001_initial.sql).
 *
 *   define(owner, titleId, doc)            register or update a title the caller manages; definitions missing from doc
 *                                          are retired, never deleted (the unlocks and scores stay)
 *   recordScores(owner, titleId, post)     { board, ref, entries: [{ player, name, score }], at? } → { recorded }
 *   unlock(owner, titleId, post)           { player, achievements: [id…], at? } → { unlocked: [newly unlocked ids] }
 *   adopt(owner, titleId, guest, person)   move a guest's unlocks and scores to the person who signed in
 *   putSave / getSave / listSaves / deleteSave (owner, titleId, player, slot…)   a player's cloud save slots in a title
 *   mySaves(person) / deleteMySave(person, titleId, slot)                        a person's own slots, every title
 *   mergeSubject({ mergeId, from, into })  network.subject.merged: the folded account's rows, in every title, become the
 *                                          survivor's (once per merge)
 *   board(titleId, boardId, { period, page })  ranked entries: name and score, never a player id
 *   title(id) / titles()                   the public definitions, with how many players unlocked each achievement
 *   playerAchievements(player, { titleId })    a player's unlocks across titles (or in one)
 *
 * Every write names the title it is for, and only the principal that registered a title writes to it: another
 * principal is told the title does not exist. A player is a person (usr_…) or a guest the title names (guest:<opaque>).
 */
const PLAYER_RE = /^(usr_[0-9A-HJKMNP-TV-Z]{26}|guest:[A-Za-z0-9_-]{8,128})$/;
const SLOT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_SLOTS = 8;
const MAX_SAVE_BYTES = 65536;
const TITLE_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const DEF_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PER_PAGE = 25;
const MAX_ENTRIES = 100;
const MAX_DEFS = 200;
const EARLIEST = Date.UTC(2020, 0, 1);

class PlayError extends Error {
    constructor(status, code, detail) { super(detail || code); this.status = status; this.code = code; this.detail = detail; }
}
const fail = (status, code, detail) => { throw new PlayError(status, code, detail); };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Monday 00:00 UTC of the week `now` is in. */
function weekStart(now) {
    const d = new Date(now);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
}

function createPlay({ s }) {
    const { db } = s;

    async function ownTitle(owner, titleId) {
        if (!TITLE_RE.test(String(titleId || ''))) fail(404, 'play.unknown_title', 'no such title');
        const t = await db.maybe('SELECT * FROM play_titles WHERE id = $1', [titleId]);
        if (!t || t.owner !== owner) fail(404, 'play.unknown_title', 'no such title of yours');
        return t;
    }
    const when = (at) => {
        if (at === undefined || at === null) return s.now();
        if (!Number.isSafeInteger(at) || at < EARLIEST || at > s.now() + 60_000) fail(400, 'play.bad_time', 'at is epoch milliseconds, not in the future');
        return at;
    };
    const player = (p) => {
        if (!PLAYER_RE.test(String(p || ''))) fail(400, 'play.bad_player', 'player is a person (usr_…) or guest:<opaque> (8 to 128 of A-Z a-z 0-9 _ -)');
        return p;
    };

    function defsOf(list, what, extra) {
        if (list === undefined) return null;
        if (!Array.isArray(list) || list.length > MAX_DEFS) fail(400, 'play.bad_definitions', `${what} is a list of at most ${MAX_DEFS}`);
        const seen = new Set();
        return list.map((d, i) => {
            const id = String((d && d.id) || '');
            if (!DEF_RE.test(id) || seen.has(id)) fail(400, 'play.bad_definitions', `${what}[${i}].id must be a unique lowercase id`);
            seen.add(id);
            const name = str(d.name, 80);
            if (!name) fail(400, 'play.bad_definitions', `${what}[${i}] needs a name`);
            return { id, name, position: i, ...extra(d, i) };
        });
    }

    async function define(owner, titleId, doc = {}) {
        if (!TITLE_RE.test(String(titleId || ''))) fail(400, 'play.bad_title', 'a title id is 2 to 40 of a-z, 0-9 and -');
        const name = str(doc.name, 80);
        if (!name) fail(400, 'play.bad_title', 'a title needs a name');
        const url = doc.url == null || doc.url === '' ? null : String(doc.url);
        if (url !== null && !/^https:\/\/[^\s]{3,300}$/.test(url)) fail(400, 'play.bad_title', 'url is an https address');
        const achievements = defsOf(doc.achievements, 'achievements', (d) => ({ description: str(d.description, 300), hidden: d.hidden === true }));
        const boards = defsOf(doc.boards, 'boards', (d, i) => {
            if (!['best', 'sum'].includes(d.kind)) fail(400, 'play.bad_definitions', `boards[${i}].kind is best or sum`);
            return { kind: d.kind };
        });
        const now = s.now();
        return await s.tx(async () => {
            const cur = await db.maybe('SELECT * FROM play_titles WHERE id = $1 FOR UPDATE', [titleId]);
            if (cur && cur.owner !== owner) fail(409, 'play.title_taken', 'another principal manages this title');
            if (cur) await db.exec('UPDATE play_titles SET name = $2, url = $3, summary = $4, updated_at = $5 WHERE id = $1', [titleId, name, url, str(doc.summary, 300), now]);
            else await db.exec('INSERT INTO play_titles (id, owner, name, url, summary, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)', [titleId, owner, name, url, str(doc.summary, 300), now]);
            if (achievements) {
                for (const a of achievements) {
                    await db.exec(`INSERT INTO play_achievements (title_id, id, name, description, position, hidden, retired) VALUES ($1, $2, $3, $4, $5, $6, false)
                        ON CONFLICT (title_id, id) DO UPDATE SET name = excluded.name, description = excluded.description, position = excluded.position, hidden = excluded.hidden, retired = false`,
                    [titleId, a.id, a.name, a.description, a.position, a.hidden]);
                }
                await db.exec('UPDATE play_achievements SET retired = true WHERE title_id = $1 AND NOT (id = ANY($2::text[]))', [titleId, achievements.map((a) => a.id)]);
            }
            if (boards) {
                for (const b of boards) {
                    await db.exec(`INSERT INTO play_boards (title_id, id, name, kind, position, retired) VALUES ($1, $2, $3, $4, $5, false)
                        ON CONFLICT (title_id, id) DO UPDATE SET name = excluded.name, position = excluded.position, retired = false`,
                    [titleId, b.id, b.name, b.kind, b.position]);
                    const kind = await db.value('SELECT kind FROM play_boards WHERE title_id = $1 AND id = $2', [titleId, b.id]);
                    if (kind !== b.kind) fail(409, 'play.board_kind_fixed', `board ${b.id} is a ${kind} board: its kind never changes (its scores would mean something else)`);
                }
                await db.exec('UPDATE play_boards SET retired = true WHERE title_id = $1 AND NOT (id = ANY($2::text[]))', [titleId, boards.map((b) => b.id)]);
            }
            return { title: await title(titleId), created: !cur };
        });
    }

    async function recordScores(owner, titleId, post = {}) {
        await ownTitle(owner, titleId);
        const board = await db.maybe('SELECT * FROM play_boards WHERE title_id = $1 AND id = $2', [titleId, String(post.board || '')]);
        if (!board || board.retired) fail(404, 'play.unknown_board', 'no such board in this title');
        const ref = str(post.ref, 128);
        if (!ref) fail(400, 'play.bad_scores', 'ref names the round or run the scores come from (it makes a repeat change nothing)');
        const entries = post.entries;
        if (!Array.isArray(entries) || !entries.length || entries.length > MAX_ENTRIES) fail(400, 'play.bad_scores', `entries is a list of 1 to ${MAX_ENTRIES}`);
        const at = when(post.at);
        const rows = entries.map((e, i) => {
            const score = e && e.score;
            if (!Number.isSafeInteger(score) || score < 0) fail(400, 'play.bad_scores', `entries[${i}].score is a whole number, 0 or more`);
            const name = str(e.name, 40);
            if (!name) fail(400, 'play.bad_scores', `entries[${i}].name is the name to show`);
            return [player(e.player), name, score];
        });
        let recorded = 0;
        await s.tx(async () => {
            for (const [p, name, score] of rows) {
                recorded += await db.exec(`INSERT INTO play_scores (title_id, board_id, ref, player, player_name, score, at) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (title_id, board_id, ref, player) DO NOTHING`, [titleId, board.id, ref, p, name, score, at]);
            }
        });
        return { recorded, repeated: rows.length - recorded };
    }

    async function unlock(owner, titleId, post = {}) {
        await ownTitle(owner, titleId);
        const p = player(post.player);
        const ids = post.achievements;
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_DEFS || !ids.every((x) => DEF_RE.test(String(x)))) fail(400, 'play.bad_unlock', 'achievements is a list of achievement ids');
        const known = new Set((await db.many('SELECT id FROM play_achievements WHERE title_id = $1 AND NOT retired', [titleId])).map((r) => r.id));
        const unknown = ids.filter((x) => !known.has(x));
        if (unknown.length) fail(404, 'play.unknown_achievement', `not achievements of this title: ${unknown.slice(0, 5).join(', ')}`);
        const at = when(post.at);
        const unlocked = [];
        await s.tx(async () => {
            for (const id of [...new Set(ids)]) {
                const n = await db.exec(`INSERT INTO play_unlocks (title_id, achievement_id, player, unlocked_at) VALUES ($1, $2, $3, $4)
                    ON CONFLICT (title_id, achievement_id, player) DO NOTHING`, [titleId, id, p, at]);
                if (n) unlocked.push(id);
            }
        });
        return { unlocked };
    }

    /** A guest signed in: their unlocks and scores in this title become the person's (the earliest unlock wins). */
    async function adopt(owner, titleId, guest, person) {
        await ownTitle(owner, titleId);
        if (!/^guest:/.test(player(guest))) fail(400, 'play.bad_player', 'only a guest is adopted');
        if (!/^usr_/.test(player(person))) fail(400, 'play.bad_player', 'a guest is adopted by a person (usr_…)');
        return await s.tx(() => moveRows(titleId, guest, person));
    }

    /** One player's unlocks (the earliest time wins) and scores (a round both posted keeps the survivor's) become
     *  another's: in one title, or in every title when titleId is null. Runs inside the caller's transaction. */
    async function moveRows(titleId, from, into) {
        const all = titleId === null;
        const move = all ? [from, into] : [from, into, titleId];
        const drop = all ? [from] : [from, titleId];
        const unlocks = await db.exec(`INSERT INTO play_unlocks (title_id, achievement_id, player, unlocked_at)
            SELECT title_id, achievement_id, $2, unlocked_at FROM play_unlocks WHERE player = $1${all ? '' : ' AND title_id = $3'}
            ON CONFLICT (title_id, achievement_id, player) DO UPDATE SET unlocked_at = LEAST(play_unlocks.unlocked_at, excluded.unlocked_at)`, move);
        await db.exec(`DELETE FROM play_unlocks WHERE player = $1${all ? '' : ' AND title_id = $2'}`, drop);
        const scores = await db.exec(`INSERT INTO play_scores (title_id, board_id, ref, player, player_name, score, at)
            SELECT title_id, board_id, ref, $2, player_name, score, at FROM play_scores WHERE player = $1${all ? '' : ' AND title_id = $3'}
            ON CONFLICT (title_id, board_id, ref, player) DO NOTHING`, move);
        await db.exec(`DELETE FROM play_scores WHERE player = $1${all ? '' : ' AND title_id = $2'}`, drop);
        // Save slots: the newer of a clashing pair wins (its version moves past both).
        const saves = await db.exec(`INSERT INTO play_saves (title_id, player, slot, data, size, version, created_at, updated_at)
            SELECT title_id, $2, slot, data, size, version, created_at, updated_at FROM play_saves WHERE player = $1${all ? '' : ' AND title_id = $3'}
            ON CONFLICT (title_id, player, slot) DO UPDATE SET
                data = CASE WHEN excluded.updated_at > play_saves.updated_at THEN excluded.data ELSE play_saves.data END,
                size = CASE WHEN excluded.updated_at > play_saves.updated_at THEN excluded.size ELSE play_saves.size END,
                version = GREATEST(play_saves.version, excluded.version) + 1,
                updated_at = GREATEST(play_saves.updated_at, excluded.updated_at)`, move);
        await db.exec(`DELETE FROM play_saves WHERE player = $1${all ? '' : ' AND title_id = $2'}`, drop);
        return { unlocks, scores, saves };
    }

    async function mergeSubject({ mergeId, from, into }) {
        return await s.tx(async () => {
            if (await db.maybe('SELECT 1 FROM play_subject_merges WHERE merge_id = $1', [mergeId])) return { already: true, unlocks: 0, scores: 0 };
            const moved = await moveRows(null, from, into);
            await db.exec('INSERT INTO play_subject_merges (merge_id, from_subject, into_subject, unlocks, scores, merged_at) VALUES ($1, $2, $3, $4, $5, $6)',
                [mergeId, from, into, moved.unlocks, moved.scores, s.now()]);
            return { already: false, ...moved };
        });
    }

    async function board(titleId, boardId, { period = 'all', page = 1 } = {}) {
        const b = await db.maybe(`SELECT b.*, t.name AS title_name FROM play_boards b JOIN play_titles t ON t.id = b.title_id
            WHERE b.title_id = $1 AND b.id = $2`, [String(titleId || ''), String(boardId || '')]);
        if (!b) fail(404, 'play.unknown_board', 'no such board');
        if (!['all', 'week'].includes(period)) fail(400, 'play.bad_query', 'period is all or week');
        if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) fail(400, 'play.bad_query', 'page is 1 or more');
        const since = period === 'week' ? weekStart(s.now()) : 0;
        // A player's best score (best) or the sum of theirs (sum) in the period. A tie goes to whoever got there
        // first: the earliest post of a best score, the earlier last post of a sum. The name shown is the newest one.
        const ranked = b.kind === 'sum'
            ? 'SELECT player, SUM(score)::bigint AS score, MAX(at) AS reached FROM s GROUP BY player'
            : 'SELECT player, MAX(score)::bigint AS score, NULL::bigint AS reached FROM s GROUP BY player';
        const rows = await db.many(`WITH s AS (SELECT player, player_name, score, at, seq FROM play_scores WHERE title_id = $1 AND board_id = $2 AND at >= $3),
                r0 AS (${ranked}),
                r AS (SELECT r0.player, r0.score,
                        COALESCE(r0.reached, (SELECT MIN(at) FROM s WHERE s.player = r0.player AND s.score = r0.score)) AS reached FROM r0)
            SELECT r.player, r.score, r.reached, (SELECT player_name FROM s WHERE s.player = r.player ORDER BY at DESC, seq DESC LIMIT 1) AS name,
                COUNT(*) OVER () AS total
            FROM r ORDER BY r.score DESC, r.reached ASC, r.player ASC LIMIT $4 OFFSET $5`, [b.title_id, b.id, since, PER_PAGE, (page - 1) * PER_PAGE]);
        const total = rows.length ? Number(rows[0].total) : 0;
        return {
            title: b.title_id, title_name: b.title_name, board: b.id, name: b.name, kind: b.kind, period, page,
            pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, ...(period === 'week' ? { since: new Date(since).toISOString() } : {}),
            entries: rows.map((r, i) => ({ rank: (page - 1) * PER_PAGE + i + 1, name: r.name, score: Number(r.score), signed_in: r.player.startsWith('usr_') })),
        };
    }

    async function title(id) {
        const t = await db.maybe('SELECT id, name, url, summary, created_at, updated_at FROM play_titles WHERE id = $1', [String(id || '')]);
        if (!t) return null;
        const players = Number(await db.value('SELECT COUNT(DISTINCT player) FROM play_unlocks WHERE title_id = $1', [t.id]));
        const achievements = await db.many(`SELECT a.id, a.name, a.description, a.hidden, COUNT(u.player)::int AS unlocked_by
            FROM play_achievements a LEFT JOIN play_unlocks u ON u.title_id = a.title_id AND u.achievement_id = a.id
            WHERE a.title_id = $1 AND NOT a.retired GROUP BY a.title_id, a.id ORDER BY a.position, a.id`, [t.id]);
        const boards = await db.many('SELECT id, name, kind FROM play_boards WHERE title_id = $1 AND NOT retired ORDER BY position, id', [t.id]);
        return {
            id: t.id, name: t.name, url: t.url, summary: t.summary, players,
            achievements: achievements.map((a) => (a.hidden
                ? { id: a.id, hidden: true, unlocked_by: a.unlocked_by, name: 'A secret achievement', description: '' }
                : { id: a.id, name: a.name, description: a.description, unlocked_by: a.unlocked_by })),
            boards,
            created_at: new Date(Number(t.created_at)).toISOString(), updated_at: new Date(Number(t.updated_at)).toISOString(),
        };
    }

    async function titles() {
        const ids = (await db.many('SELECT id FROM play_titles ORDER BY created_at, id')).map((r) => r.id);
        const out = [];
        for (const id of ids) out.push(await title(id));
        return out;
    }

    async function playerAchievements(p, { titleId = null } = {}) {
        const rows = await db.many(`SELECT u.title_id, t.name AS title_name, a.id, a.name, a.description, u.unlocked_at
            FROM play_unlocks u JOIN play_achievements a ON a.title_id = u.title_id AND a.id = u.achievement_id
            JOIN play_titles t ON t.id = u.title_id
            WHERE u.player = $1 AND ($2::text IS NULL OR u.title_id = $2) ORDER BY u.unlocked_at DESC`, [player(p), titleId]);
        const by = new Map();
        for (const r of rows) {
            if (!by.has(r.title_id)) by.set(r.title_id, { title: r.title_id, name: r.title_name, achievements: [] });
            by.get(r.title_id).achievements.push({ id: r.id, name: r.name, description: r.description, unlocked_at: new Date(Number(r.unlocked_at)).toISOString() });
        }
        return [...by.values()];
    }

    // ── cloud saves ──
    const slotOf = (v) => { if (!SLOT_RE.test(String(v || ''))) fail(400, 'play.bad_slot', 'a slot is 1 to 32 of a-z 0-9 _ - (starting with a letter or digit)'); return String(v); };
    const saveView = (r, withData) => ({ slot: r.slot, version: Number(r.version), size: Number(r.size), created_at: new Date(Number(r.created_at)).toISOString(), updated_at: new Date(Number(r.updated_at)).toISOString(), ...(withData ? { data: r.data } : {}) });

    /** Writes a slot. `version` (optional) is the version the writer read: a stale one is refused (409), a new slot takes 0. */
    async function putSave(owner, titleId, playerId, slot, { data, version } = {}) {
        await ownTitle(owner, titleId);
        player(playerId); slotOf(slot);
        if (data === undefined) fail(400, 'play.bad_save', 'data is the save, any JSON value');
        const json = JSON.stringify(data);
        const size = Buffer.byteLength(json, 'utf8');
        if (size > MAX_SAVE_BYTES) fail(413, 'play.save_too_large', `a save is at most ${MAX_SAVE_BYTES} bytes of JSON (this one is ${size})`);
        if (version !== undefined && version !== null && (!Number.isSafeInteger(version) || version < 0)) fail(400, 'play.bad_version', 'version is the version you read (0 for a new slot)');
        return await s.tx(async () => {
            const cur = await db.maybe('SELECT * FROM play_saves WHERE title_id = $1 AND player = $2 AND slot = $3 FOR UPDATE', [titleId, playerId, slot]);
            if (version !== undefined && version !== null && Number(cur ? cur.version : 0) !== version) {
                fail(409, 'play.save_conflict', `the slot is at version ${cur ? cur.version : 0}, not ${version}: read it again and merge`);
            }
            if (!cur) {
                const n = Number((await db.maybe('SELECT COUNT(*)::int AS n FROM play_saves WHERE title_id = $1 AND player = $2', [titleId, playerId])).n);
                if (n >= MAX_SLOTS) fail(409, 'play.too_many_slots', `a player has at most ${MAX_SLOTS} slots in a title`);
                const now = s.now();
                await db.exec('INSERT INTO play_saves (title_id, player, slot, data, size, version, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, 1, $6, $6)', [titleId, playerId, slot, json, size, now]);
            } else {
                await db.exec('UPDATE play_saves SET data = $4::jsonb, size = $5, version = version + 1, updated_at = $6 WHERE title_id = $1 AND player = $2 AND slot = $3', [titleId, playerId, slot, json, size, s.now()]);
            }
            return saveView(await db.one('SELECT * FROM play_saves WHERE title_id = $1 AND player = $2 AND slot = $3', [titleId, playerId, slot]), false);
        });
    }
    async function getSave(owner, titleId, playerId, slot) {
        await ownTitle(owner, titleId);
        const r = await db.maybe('SELECT * FROM play_saves WHERE title_id = $1 AND player = $2 AND slot = $3', [titleId, player(playerId), slotOf(slot)]);
        if (!r) fail(404, 'play.no_save', 'no save in that slot');
        return saveView(r, true);
    }
    async function listSaves(owner, titleId, playerId) {
        await ownTitle(owner, titleId);
        return (await db.many('SELECT * FROM play_saves WHERE title_id = $1 AND player = $2 ORDER BY slot', [titleId, player(playerId)])).map((r) => saveView(r, false));
    }
    async function deleteSave(owner, titleId, playerId, slot) {
        await ownTitle(owner, titleId);
        return (await db.exec('DELETE FROM play_saves WHERE title_id = $1 AND player = $2 AND slot = $3', [titleId, player(playerId), slotOf(slot)])) > 0;
    }
    /** A person's own slots in every title (without the data), newest first. */
    async function mySaves(person) {
        return (await db.many(`SELECT v.*, t.name AS title_name FROM play_saves v JOIN play_titles t ON t.id = v.title_id
            WHERE v.player = $1 ORDER BY v.updated_at DESC LIMIT 200`, [player(person)])).map((r) => ({ title: r.title_id, title_name: r.title_name, ...saveView(r, false) }));
    }
    async function deleteMySave(person, titleId, slot) {
        if (!TITLE_RE.test(String(titleId || ''))) fail(404, 'play.unknown_title', 'no such title');
        return (await db.exec('DELETE FROM play_saves WHERE title_id = $1 AND player = $2 AND slot = $3', [titleId, player(person), slotOf(slot)])) > 0;
    }

    return { define, recordScores, unlock, adopt, mergeSubject, board, title, titles, playerAchievements, ownTitle,
        putSave, getSave, listSaves, deleteSave, mySaves, deleteMySave };
}

module.exports = { createPlay, PlayError, PLAYER_RE, TITLE_RE, SLOT_RE, MAX_SLOTS, MAX_SAVE_BYTES, weekStart, PER_PAGE };
