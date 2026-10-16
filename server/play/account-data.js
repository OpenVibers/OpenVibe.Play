'use strict';

/**
 * Account export and deletion → Play (ADR-033; openvibe-sdk/account-data). A person's rows are the ones whose player is
 * their subject (usr_…); a guest's rows are nobody's account until a title adopts them.
 *
 *   export     the achievements they unlocked, the scores they posted and their cloud saves, in every title
 *   deletion   all three are deleted: their unlocks stop counting, their scores leave every leaderboard, their saves go
 *
 * Nothing exported is a secret.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'play_unlocks', subject: 'player', file: 'achievements.json', columns: ['title_id', 'achievement_id', 'unlocked_at'], order: 'unlocked_at' },
    { table: 'play_scores', subject: 'player', file: 'scores.json', columns: ['title_id', 'board_id', 'ref', 'player_name', 'score', 'at'], order: 'at' },
    { table: 'play_saves', subject: 'player', file: 'saves.json', columns: ['title_id', 'slot', 'data', 'version', 'created_at', 'updated_at'], order: 'updated_at' },
];

function create({ db, log = console } = {}) {
    return createAccountData({ db, service: 'play', tables: TABLES, log });
}

module.exports = { create, TABLES, TOPICS };
