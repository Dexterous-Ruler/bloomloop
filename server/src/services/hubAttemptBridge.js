// Where a lesson step's answer goes: the hub's own attempt store, the one the
// practice loop writes (hub_attempts, 0026; repo.addHubAttempt and
// repo.listHubAttempts).
//
// Decision H5 keeps every hub attempt in the hub's OWN append-only store, with a
// client attempt id as its idempotency key, the language shown, the mode
// (practice | exam | getready | review | lesson), hints used and time taken. A
// lesson's retrieval question records its attempt through the two functions
// below and nothing else. Because it lands in the same rows as practice, a
// lesson's answer counts in the student's mastery, error log and reviews like
// any other hub attempt, and never in a room, attainment or the register.
//
// Tests may disconnect the store (connectAttemptStore(null)) or put their own in
// its place. While none is connected an answer is REFUSED with a 503 rather than
// taken and kept in memory: a response accepted and then lost on a restart would
// be a response discarded (rule: never discard a response), while one refused
// stays on the student's device to send again. Reads find nothing, and say so.
//
// The attempt a lesson step hands over (every field set by the server):
//   accountId      the signed-in student
//   attemptId      the client's attempt id: the idempotency key
//   mode           'lesson'
//   lessonId, lessonVersion, topicId, topic (its name), classId, contentId
//   questionId, kind, bloom, questionSource
//   questionSnapshot   the question as it stood (snapshotOf in sockets/index.js)
//   response       as sent, in shown positions
//   correct, score, ungraded, detail   from score() on the server
//   language, translationId    the language shown (attemptLanguage in services/hubLanguages.js)
//   hintsUsed      the hints opened on the question for this attempt (hintsUsedOn, services/hubHintHook.js)
//   timeMs         as the device measured it, or null; stored, never trusted for counting
//   answeredAt     the server's time
//
// hub_attempts has no column for the lesson, its version or the translation
// shown, so the practice store keeps the mode and the language and not those.
//
// What record() returns: { attempt, duplicate }, the stored row. A second attempt
// with the same (accountId, attemptId) is the first one back, unchanged, with
// duplicate true. What list() takes: { accountId?, contentId?, questionIds?, mode? }.

import { isUngraded } from '../questionTypes.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export const NOT_CONNECTED = 'Answers inside a lesson cannot be saved on this server yet, so this one was not taken. '
  + 'It is still on your device to send again.';

const sameId = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** The device's time taken, if it is one hub_attempts keeps (0 to a day); null otherwise. */
const timeTaken = (v) => (Number.isInteger(v) && v >= 0 && v <= 86400000 ? v : null);

/** The practice loop's store (services/hubPractice.js writes the same rows). */
export const PRACTICE_STORE = Object.freeze({
  async record(repo, a) {
    const kind = a.kind ?? 'mcq';
    // hub_attempts refuses a poll: it assesses nothing. A lesson never lists one
    // (retrievalPool), so this is a question changed in the bank since.
    if (isUngraded(kind)) throw fail('This question is a poll now, so there is nothing to mark. Your answer was not taken.', 409);
    return repo.addHubAttempt({
      accountId: String(a.accountId),
      clientAttemptId: a.attemptId,
      classId: a.classId ?? null,
      contentId: a.contentId ?? null,
      topicId: a.topicId ?? null,
      topic: a.topic ?? '',
      questionId: a.questionId ?? null,
      bloom: a.bloom,
      kind,
      questionSnapshot: a.questionSnapshot ?? {},
      questionSource: a.questionSource ?? 'llm',
      response: a.response ?? null,
      correct: a.correct === true,
      score: Math.round(Math.max(0, Math.min(1, Number(a.score) || 0)) * 1000) / 1000,
      detail: a.detail ?? '',
      // A written answer is marked by matching rubric words: a first reading, as in practice.
      reviewStatus: kind === 'open' ? 'provisional' : 'auto',
      mode: a.mode ?? 'lesson',
      language: a.language ?? 'en',
      hintsUsed: a.hintsUsed ?? 0,
      timeTakenMs: timeTaken(a.timeMs),
      // Batch 8 (0036): kept without proof the lesson served the question; counted nowhere.
      ...(a.unproven ? { unproven: true } : {}),
      ...(a.answeredAt ? { createdAt: a.answeredAt } : {}),
    });
  },
  async list(repo, { accountId, contentId, questionIds, mode } = {}) {
    // The store reads by question, so a chapter is read through its questions.
    let ids = Array.isArray(questionIds) ? questionIds.map(String) : null;
    if (contentId !== undefined) {
      const own = (await repo.listQuestions(contentId, { includeDiscarded: true })).map((q) => String(q._id));
      ids = ids ? ids.filter((id) => own.some((o) => sameId(o, id))) : own;
    }
    const rows = await repo.listHubAttempts({ ...(accountId ? { accountId: String(accountId) } : {}), ...(ids ? { questionIds: ids } : {}) });
    return mode ? rows.filter((a) => a.mode === mode) : rows;
  },
});

let store = PRACTICE_STORE;

/** Point the bridge at an attempt store: { record(repo, attempt), list(repo, filter) }, or null for none. */
export function connectAttemptStore(impl) {
  store = impl && typeof impl.record === 'function' && typeof impl.list === 'function' ? impl : null;
}

/** Is an attempt store connected, so a lesson's questions can be answered? */
export const attemptStoreConnected = () => Boolean(store);

/** Record one hub attempt. 503, taking nothing, while no store is connected. */
export async function recordHubAttempt(repo, attempt) {
  if (!store) throw fail(NOT_CONNECTED, 503);
  return store.record(repo, attempt);
}

/** Hub attempts matching `filter`; none while no store is connected. */
export async function listHubAttempts(repo, filter = {}) {
  if (!store) return [];
  return store.list(repo, filter);
}
