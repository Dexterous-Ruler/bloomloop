// The error log, built automatically (Phase 6, decision H7). Pure: no store.
//
// SOURCES. A student's wrong hub attempts, and their own VERIFIED room answers
// (sent by a phone signed in as them, decision 7, 0022), final and marked: a
// wrong attempt followed by a retry in a room never counted, a poll assesses
// nothing, and a class question's vote is left out as it is from every other
// read of a student's own work. Room entries are marked "from class". The
// caller maps each room answer to a topic record of a chapter on the student's
// classes; one that maps to none is left out (the hub shows only what the
// professor placed).
//
// ENTRIES. One per question while it is open: the same question wrong again
// before the entry clears adds to it (`times`, the latest response) rather than
// filling the log with copies; once cleared, a new wrong answer opens a new one.
//
// CLEARING. An open entry is cleared by a later RIGHT answer, in the hub or in
// class, on the same topic, at the entry's Bloom level or above, to a
// DIFFERENT question. A different one, because answering the same question
// right after its answer was shown measures memory of that answer more than
// the topic. A provisional machine mark (a written answer) clears it as it
// counts in a room, and the entry says so.
//
// What was right is shown only on an entry, which exists only after the
// attempt; the caller builds that view (services/hubProgress.js).

import { levelIndex } from '../bloom.js';
import { attemptOrder, itemKeyOf } from './hubElo.js';

export const ERROR_STATUSES = Object.freeze(['open', 'cleared']);

export const FROM_LABEL = Object.freeze({
  practice: 'From your practice',
  class: 'From class',
});

/** A hub attempt or a mapped room answer as one event in the log's time line. */
function eventsOf({ hubAttempts = [], roomAnswers = [] }) {
  const hub = hubAttempts
    .filter((a) => a.topicId && typeof a.correct === 'boolean')
    .map((a) => ({
      from: 'practice', id: `practice:${a._id}`, row: a, topicId: String(a.topicId), item: itemKeyOf(a), bloom: a.bloom,
      correct: a.correct, provisional: a.reviewStatus === 'provisional', createdAt: a.createdAt, _id: String(a._id),
    }));
  const room = roomAnswers
    .filter((a) => a.topicId && a.final !== false && a.ungraded !== true && !a.classQuestionId && typeof a.correct === 'boolean')
    .map((a) => ({
      from: 'class', id: `class:${a._id}`, row: a, topicId: String(a.topicId), item: String(a.questionId ?? a.questionSnapshot?.id ?? ''),
      bloom: a.bloom, correct: a.correct, provisional: a.reviewStatus === 'provisional', createdAt: a.answeredAt, _id: String(a._id),
    }));
  return [...hub, ...room].sort(attemptOrder);
}

/**
 * Every entry, oldest first.
 *
 * @returns {{ id, status: 'open'|'cleared', from, topicId, item, bloom, times, firstAt, lastAt, latest,
 *   provisional, clearedAt, clearedBy: { from, bloom, at, provisional }|null }[]}
 *   `latest` is the newest wrong attempt or answer row behind the entry (its
 *   response, its snapshot); `item` the question's id.
 */
export function buildErrorLog({ hubAttempts = [], roomAnswers = [] } = {}) {
  const entries = [];
  const open = new Map(); // `${topicId}\u0000${item}` -> entry
  for (const e of eventsOf({ hubAttempts, roomAnswers })) {
    if (e.correct === false) {
      const key = `${e.topicId}\u0000${e.item}`;
      const held = open.get(key);
      if (held) {
        held.times += 1;
        held.lastAt = e.createdAt;
        held.latest = e.row;
        held.from = e.from;
        held.provisional = e.provisional;
        continue;
      }
      const entry = {
        id: e.id, status: 'open', from: e.from, topicId: e.topicId, item: e.item, bloom: e.bloom, times: 1,
        firstAt: e.createdAt, lastAt: e.createdAt, latest: e.row, provisional: e.provisional, clearedAt: null, clearedBy: null,
      };
      entries.push(entry);
      open.set(key, entry);
      continue;
    }
    for (const [key, entry] of open) {
      if (entry.topicId !== e.topicId || entry.item === e.item) continue;
      if (levelIndex(e.bloom) < levelIndex(entry.bloom)) continue;
      entry.status = 'cleared';
      entry.clearedAt = e.createdAt;
      entry.clearedBy = { from: e.from, bloom: e.bloom, at: e.createdAt, provisional: e.provisional };
      open.delete(key);
    }
  }
  return entries;
}

/** Open entries per topic id. */
export function openByTopic(entries = []) {
  const out = new Map();
  for (const e of entries) if (e.status === 'open') out.set(e.topicId, (out.get(e.topicId) ?? 0) + 1);
  return out;
}

/**
 * The sentence an entry carries: where it came from, and whether and how it
 * cleared. `audience` 'student' speaks to the student; 'staff' about them.
 */
export function entrySentence(entry, { levelName = (b) => b, audience = 'student' } = {}) {
  const you = audience === 'student';
  const level = levelName(entry.bloom);
  const where = entry.from === 'class' ? 'in class' : 'in practice';
  const again = entry.times > 1 ? ` (${entry.times} times)` : '';
  if (entry.status === 'cleared') {
    const by = entry.clearedBy?.from === 'class' ? 'in class' : 'in practice';
    const mark = entry.clearedBy?.provisional ? ', on a written answer\'s provisional machine mark' : '';
    return `Answered wrong ${where}${again}; cleared when ${you ? 'you' : 'they'} got another ${levelName(entry.clearedBy?.bloom)} `
      + `question on this topic right ${by}${mark}.`;
  }
  return `Answered wrong ${where}${again}. It clears when ${you ? 'you get' : 'they get'} another question on this topic right at ${level} or above.`;
}
