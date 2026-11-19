// Which hub attempts the hub's marks and estimates may count yet (Phase 6,
// decision H10: a self-test gives no feedback until it is handed in).
//
// Mastery (services/hubElo.js), the error log (hubErrors.js) and spaced review
// (hubReview.js) are worked out from hub attempts on every request. A self-test
// answer stored as it is given would show in them at once: the topic's estimate
// moving, an entry opening in the error log with the right answer beside it. So
// every read that marks or estimates passes its attempts through
// countedAttempts() first:
//
//   - an answer in a self-test that is still open is held back;
//   - once the self-test has ended (handed in, or its time is up), the answer
//     each question ended with counts, from the moment it was given;
//   - an answer the student changed before handing in, and one that reached
//     the server after the end, are kept (never discarded) and never counted.
//
// An exam-mode attempt that belongs to no self-test (one a caller wrote through
// recordAttempt() itself) is counted as it always was. Get Ready answers are
// never held back: a Get Ready check shows each answer's feedback as it goes.
// Reads that only count activity (days practised, answers given) are not
// narrowed by this: they say nothing about right or wrong.
//
// A self-test with a time limit ends when its deadline has passed, plus
// EXAM_GRACE_SECONDS for answers already on their way (a phone on a slow
// network sends an answer a moment before the limit and it lands a moment
// after). The server's clock decides, never the device's.
//
// Hints and answers are held back the same way: a question on a self-test that
// is still open is closed to practice, lessons and the tutor until it ends
// (openSelfTestQuestions, read by services/hubClosed.js).

import { attemptOrder, itemKeyOf } from './hubElo.js';

/** How long after a self-test's time limit an answer still counts: it was sent in time and arrived late. */
export const EXAM_GRACE_SECONDS = 30;

const timeOf = (iso) => Date.parse(iso ?? '');

/**
 * When a run stops counting answers, as an ISO time: its stored end; for a timed
 * self-test whose deadline (plus the grace) has passed, that moment; null while
 * it is open.
 */
export function runEnd(run, now = new Date()) {
  if (!run) return null;
  if (run.endedAt) return run.endedAt;
  if (run.deadlineAt) {
    const cut = timeOf(run.deadlineAt) + EXAM_GRACE_SECONDS * 1000;
    if (now.getTime() >= cut) return new Date(cut).toISOString();
  }
  return null;
}

/**
 * A self-test's counted answers: per question, the last answer the server had
 * before the end. Empty while it is open. Pure.
 *
 * @returns {Map<string, object>} question id -> the attempt that counts
 */
export function finalAnswers(run, attempts = [], now = new Date()) {
  const end = runEnd(run, now);
  const out = new Map();
  if (!end) return out;
  const cut = timeOf(end);
  for (const a of [...attempts].sort(attemptOrder)) {
    if (String(a.runId ?? '') !== String(run._id)) continue;
    if (timeOf(a.createdAt) > cut) continue;
    out.set(itemKeyOf(a), a);
  }
  return out;
}

/**
 * The attempts the hub's marks and estimates may count now (the header's
 * rule). Pure: `runs` are the self-tests the exam attempts name.
 */
export function countable(attempts = [], runs = [], now = new Date()) {
  const byId = new Map(runs.map((r) => [String(r._id), r]));
  const kept = new Map(); // run id -> the ids of its counted attempts
  const counts = (a) => {
    if (a.mode !== 'exam' || !a.runId) return true;
    const run = byId.get(String(a.runId));
    // A run that cannot be read: its answers are counted as if it had none.
    if (!run) return true;
    const key = String(run._id);
    if (!kept.has(key)) {
      const own = attempts.filter((x) => String(x.runId ?? '') === key);
      kept.set(key, new Set([...finalAnswers(run, own, now).values()].map((x) => String(x._id))));
    }
    return kept.get(key).has(String(a._id));
  };
  return attempts.filter(counts);
}

/**
 * countable() over a store: reads the self-tests the attempts name (only when
 * some exam attempt names one, so practice alone reads nothing more).
 */
export async function countedAttempts(repo, attempts = [], now = new Date()) {
  const runIds = [...new Set(attempts.filter((a) => a.mode === 'exam' && a.runId).map((a) => String(a.runId)))];
  if (!runIds.length) return attempts;
  return countable(attempts, await repo.listHubRuns({ ids: runIds }), now);
}

/**
 * The questions on a student's self-tests that are still open, by id in lower
 * case. They are closed (services/hubClosed.js) until the self-test ends:
 * practice does not serve them or take an answer to them, a lesson takes no
 * answer to them and the tutor opens no hint on them, or practice or a lesson
 * would be a way round "no hints and no feedback until submit" (H10). When the self-tests
 * cannot be read (a database without 0028, where none can have started), none
 * is taken as open, so the hints the tutor's own tables hold still work; the
 * log says why.
 */
export async function openSelfTestQuestions(repo, accountId, now = new Date()) {
  const runs = await repo.listHubRuns({ accountId: String(accountId), kind: 'exam' }).catch((err) => {
    console.error('[hub] self-tests could not be read, so none is taken as open:', err.message);
    return [];
  });
  return new Set(runs.filter((r) => !runEnd(r, now))
    .flatMap((r) => (r.spec?.questions ?? []).map((x) => String(x.questionId ?? '').trim().toLowerCase())));
}
