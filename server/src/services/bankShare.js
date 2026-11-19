// One question bank shared by rooms and the Learning Hub (Batch 8, decided under
// the owner's delegation after the Phase 6 review).
//
// A professor's approved questions serve both a room and the hub. Three rules
// keep the two from spoiling each other:
//
//   rooms only   a question the owner marks "rooms only" (questions.rooms_only,
//                0035; off by default) is never served, shown or explained by
//                the hub: not in practice, a lesson, a self-test, a Get Ready
//                check or the error log. Rooms are unaffected.
//   practised    a room avoids serving a signed-in student (a verified profile,
//                decision 7) a question they already practised in the hub,
//                when another servable question of the same level exists
//                (selectNext's `avoid`, services/selector.js). Their answer to
//                one they had practised still counts as it always did; staff
//                screens note it (the student card, the student's attainment).
//   served       practice and a lesson take an answer only with the token the
//                hub signed when it served the question (services/serveTokens.js).
//
// Only a verified answer is noted: an unverified one was typed under a roll
// number, which proves nothing about who practised what (decision 7).

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Is this question kept for rooms only? */
export const isRoomsOnly = (q) => q?.roomsOnly === true;

/** What staff are told about the switch, on and off. */
export const ROOMS_ONLY_SENTENCE = Object.freeze({
  on: 'Kept for rooms: the Learning Hub never offers this question in practice, lessons, self-tests, Get Ready or the error log.',
  off: 'Shared: rooms and the Learning Hub both use this question.',
});

/** The note on a room answer to a question the student had already practised in the hub. */
export const PRACTISED_NOTE = 'The student had practised this question in the Learning Hub before answering it here. '
  + 'It counts as usual; it may say less about what they knew.';

/**
 * The questions one account has answered in the hub, ids in lower case. Empty
 * when the account has none, or the store keeps no hub attempts: a room must
 * never stop serving over it.
 */
export async function practisedQuestionIds(repo, accountId) {
  if (!accountId || typeof repo?.listHubAttempts !== 'function') return new Set();
  try {
    const rows = await repo.listHubAttempts({ accountId: String(accountId) });
    return new Set(rows.map((a) => lower(a.questionId ?? a.questionSnapshot?.id)).filter(Boolean));
  } catch (err) {
    console.error('[rooms] the student\'s hub practice could not be read; the room serves as before:', err.message);
    return new Set();
  }
}

/**
 * Which of these room answers were given by a signed-in student to a question
 * they had practised in the hub before answering it. Pure.
 *
 * @param answers   room answer rows ({ _id, accountId, accountVerified, questionId, answeredAt })
 * @param attempts  hub attempts of those accounts ({ accountId, questionId, createdAt })
 * @returns {Map<string, string>} answer id -> the time of the first hub attempt before it
 */
export function practisedBefore(answers = [], attempts = []) {
  const first = new Map();
  for (const a of attempts) {
    const key = `${lower(a.accountId)}|${lower(a.questionId ?? a.questionSnapshot?.id)}`;
    const at = Date.parse(a.createdAt);
    if (!Number.isFinite(at)) continue;
    if (!first.has(key) || at < first.get(key)) first.set(key, at);
  }
  const out = new Map();
  for (const a of answers) {
    if (a.accountVerified !== true || !a.accountId) continue;
    const at = first.get(`${lower(a.accountId)}|${lower(a.questionId)}`);
    const answered = Date.parse(a.answeredAt ?? a.createdAt);
    if (at !== undefined && Number.isFinite(answered) && at < answered) out.set(String(a._id), new Date(at).toISOString());
  }
  return out;
}

/** practisedBefore() with the hub attempts read from the store; an empty map when they cannot be. */
export async function practisedAnswers(repo, answers = []) {
  const accounts = [...new Set(answers.filter((a) => a.accountVerified === true && a.accountId).map((a) => String(a.accountId)))];
  if (!accounts.length || typeof repo?.listHubAttempts !== 'function') return new Map();
  try {
    const questionIds = [...new Set(answers.map((a) => String(a.questionId ?? '')).filter(Boolean))];
    const attempts = await repo.listHubAttempts({ accountIds: accounts, questionIds });
    return practisedBefore(answers, attempts);
  } catch (err) {
    console.error('[rooms] hub practice could not be read for the practised notes:', err.message);
    return new Map();
  }
}
