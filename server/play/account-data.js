'use strict';

/**
 * Account export and deletion → Play (ADR-033; openvibe-sdk/account-data). A person's rows are the ones whose player is
 * their subject (usr_…); a guest's rows are nobody's account until a title adopts them.
 *
 *   export     the achievements they unlocked and the scores they posted, in every title
 *   deletion   both are deleted: their unlocks stop counting and their scores leave every leaderboard
 *
 * Nothing exported is a secret.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const TABLES = [
    { table: 'play_unlocks', subject: 'player', file: 'achievements.json', columns: ['title_id', 'achievement_id', 'unlocked_at'], order: 'unlocked_at' },
    { table: 'play_scores', subject: 'player', file: 'scores.json', columns: ['title_id', 'board_id', 'ref', 'player_name', 'score', 'at'], order: 'at' },
];

function create({ db, log = console } = {}) {
    return createAccountData({ db, service: 'play', tables: TABLES, log });
}

module.exports = { create, TABLES, TOPICS };
