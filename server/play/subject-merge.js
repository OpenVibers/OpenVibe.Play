'use strict';

/**
 * network.subject.merged → Play (ADR-029). Two Network accounts became one: `from` is now an alias of `into`. Every
 * unlock and score of `from`, in every title, becomes `into`'s (store.mergeSubject: the earliest unlock time wins, and
 * a round both accounts posted keeps the survivor's score), once per merge_id. Delivered to POST /internal/events with
 * the account topics (openvibe-sdk/account-data's consumer hands it here as an event of another topic).
 */
const TOPIC = 'network.subject.merged';
const SUBJECT_RE = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const MERGE_RE = /^mrg_[0-9A-HJKMNP-TV-Z]{26}$/;

/** One envelope → 'merged' | 'unchanged' | 'ignored:<why>'. */
async function apply(ev, { play, log = console }) {
    if (!ev || ev.event_type !== TOPIC) return 'ignored:type';
    if (ev.source !== 'network') return 'ignored:source';
    const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
    const mergeId = String(p.merge_id || ''), from = String(p.from || ''), into = String(p.into || '');
    if (!MERGE_RE.test(mergeId) || !SUBJECT_RE.test(from) || !SUBJECT_RE.test(into) || from === into) return 'ignored:payload';
    const r = await play.mergeSubject({ mergeId, from, into });
    if (r.already) return 'unchanged';
    log.log(`[Merge] ${mergeId}: ${r.unlocks} unlock(s) and ${r.scores} score(s) now the survivor's`);
    return 'merged';
}

module.exports = { apply, TOPIC };
