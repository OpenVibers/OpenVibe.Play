'use strict';
// migrations/0005_time_boards.sql widens the kind CHECK on a database that already has best and sum boards; the
// existing boards and their rows stay, and 'time' becomes a valid kind.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDb } = require('openvibe-sdk/db');
const { MIGRATIONS } = require('../server/db');
const { check, done } = require('./helpers/boot');

(async () => {
    const priorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-time-migration-'));
    let db;
    try {
        for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && Number(n.slice(0, 4)) < 5)) {
            fs.copyFileSync(path.join(MIGRATIONS, f), path.join(priorDir, f));
        }
        db = createDb({ pglite: true, service: 'play-time-migration' });
        await db.migrate({ dir: priorDir });
        await db.exec("INSERT INTO play_titles (id, owner, name, created_at, updated_at) VALUES ('surf-ride', 'service:games', 'Surf Ride', 1, 1)");
        await db.exec("INSERT INTO play_boards (title_id, id, name, kind) VALUES ('surf-ride', 'best', 'Best score', 'best'), ('surf-ride', 'sum', 'Total haul', 'sum')");

        await check('the time-board migration applies over existing best and sum boards', async () => {
            const migrated = await db.migrate({ dir: MIGRATIONS });
            assert.deepStrictEqual(migrated.applied.map((m) => m.id), ['0005']);
            assert.deepStrictEqual((await db.many('SELECT id, kind FROM play_boards ORDER BY id')).map((b) => [b.id, b.kind]),
                [['best', 'best'], ['sum', 'sum']]);
            await db.exec("INSERT INTO play_boards (title_id, id, name, kind) VALUES ('surf-ride', 'time', 'Fastest run', 'time')");
            assert.deepStrictEqual((await db.many('SELECT id, kind FROM play_boards ORDER BY id')).map((b) => [b.id, b.kind]),
                [['best', 'best'], ['sum', 'sum'], ['time', 'time']]);
            await assert.rejects(() => db.exec("INSERT INTO play_boards (title_id, id, name, kind) VALUES ('surf-ride', 'bad', 'Bad', 'fastest')"),
                /play_boards_kind_check/);
        });
    } finally {
        if (db) await db.close().catch(() => {});
        fs.rmSync(priorDir, { recursive: true, force: true });
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
