// THE HINT HOOK (Phase 6, decision H13). The tutor's hints plug in here
// (services/hubTutor.js); the practice loop (services/hubPractice.js,
// routes/hubPractice.js) and a lesson's questions (services/hubLessons.js,
// routes/hubLessons.js) call only these three functions:
//
//   hintsOffered   what the "next question" payload says about hints for this
//                  question: how many this student can open on it (at most 3:
//                  feedback on the option they chose last time, or a nudge, then
//                  a strategy and a worked step that stops short of the answer),
//                  and a sentence. Which comes first uses their recent attempts
//                  on the question and topic, the wrong option they chose and
//                  their topic state, all of which the caller passes in or the
//                  tutor reads (planHints).
//   hintsUsedOn    how many hints the student opened on this question since
//                  their previous answer to it, under any attempt id
//                  (hub_hint_views, 0029), recorded on the attempt
//                  (hub_attempts.hints_used, 0 to 3). In a self-test or Get Ready
//                  it is always 0 (H10: no hints; H9).
//   feedbackAfter  after an attempt, the approved feedback on the wrong option(s)
//                  it chose.
//
// None of them may return the answer, the key or the explanation before an
// attempt: a hint is shown before it, and those only after it (H13, H14). None
// of them ever stops an answer being kept: when the tutor's tables cannot be
// read (a database without 0029), hints are simply not offered, the attempt
// records the hints it can count (0) and the log says why.

import { HINT_MODES, NO_HINTS_HERE, hintsOfferedFor, hintsUsedFor, optionFeedbackAfter } from './hubTutor.js';

/**
 * Hints for one question as the next-question payload carries them: { available, note }; none, with
 * the reason's sentence, when the question is closed to the student now (services/hubClosed.js).
 * `closed`: the caller's set of closed questions, when it has read one.
 */
export async function hintsOffered(repo, {
  account = null, question = null, topicId = null, mode = 'practice', state = null, closed = null,
} = {}) {
  if (!HINT_MODES.includes(mode)) return { available: 0, note: NO_HINTS_HERE(mode) };
  try {
    return await hintsOfferedFor(repo, { account, question, topicId, mode, state, closed });
  } catch (err) {
    console.error('[hub] hints could not be read; none are offered:', err.message);
    return { available: 0, note: 'Hints could not be loaded just now.' };
  }
}

/** Hints the student opened on this question since their previous answer to it. 0 in a self-test or Get Ready. */
export async function hintsUsedOn(repo, { account = null, questionId = null, attemptId = null, mode = 'practice' } = {}) {
  if (!HINT_MODES.includes(mode)) return 0;
  try {
    return await hintsUsedFor(repo, { account, questionId, attemptId, mode });
  } catch (err) {
    // Never a reason to refuse the answer: it is kept, with the hints that could be counted.
    console.error('[hub] the hints opened could not be counted; the attempt records 0:', err.message);
    return 0;
  }
}

/** After an attempt: the approved feedback on the wrong option(s) it chose, in the student's language. [] when none. */
export async function feedbackAfter(repo, { account = null, attempt = null } = {}) {
  try {
    return await optionFeedbackAfter(repo, { account, attempt });
  } catch (err) {
    console.error('[hub] feedback on the option chosen could not be read:', err.message);
    return [];
  }
}
