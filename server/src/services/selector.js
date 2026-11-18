// F3 - adaptive selection. Given a hydrated profile and the active bank, pick
// the next item. Pure and synchronous: the live loop makes no LLM calls and no
// database calls to decide what to serve [report NFR: "the live loop shall make
// no LLM calls; all generation happens before class"].

import { LEVELS, LABEL, levelIndex } from '../bloom.js';
import { eligibleLevels, isSlowLearner } from './mastery.js';

/**
 * Questions the student has not already been served in this session.
 * `history` is the authority - a reconnecting student must not be re-served
 * items they already answered before the drop.
 */
function unseen(questions, profile) {
  const done = new Set(profile.history.map((h) => String(h.questionId)));
  return questions.filter((q) => !done.has(String(q._id ?? q.id)));
}

/**
 * Order of preference when the ideal level is exhausted.
 * Down the ladder first: giving a struggling student something too easy is a
 * far cheaper mistake than giving them something too hard, which is exactly the
 * failure mode this project exists to remove.
 */
function fallbackOrder(preferred) {
  const i = levelIndex(preferred);
  const down = LEVELS.slice(0, i).reverse();
  const up = LEVELS.slice(i + 1);
  return [preferred, ...down, ...up];
}

/**
 * @returns {{question: object, level: string, reason: string}|null}
 *          null means the bank is exhausted for this student.
 */
export function selectNext(profile, questions, { rng = Math.random } = {}) {
  const active = questions.filter((q) => (q.status ?? 'active') === 'active');
  const pool = unseen(active, profile);
  if (pool.length === 0) return null;

  const slow = isSlowLearner(profile);
  const allowed = eligibleLevels(profile);

  // Aim at the working level, then widen within the allowed set, then - only if
  // the allowed set is completely dry - anywhere in the bank, so a student is
  // never left staring at a blank screen mid-demo.
  const preferred = allowed.includes(profile.workingLevel)
    ? profile.workingLevel
    : allowed[allowed.length - 1];

  // Inside the band the working level pins to Understand, so preferring it
  // alone served Understand items exclusively until they ran out - a student in
  // the below-40% band never actually saw an easy question. The mandate is
  // "easy questions AND understanding-type questions", so alternate the two and
  // open on Remember: the student this product exists for needs a win first.
  const tiers = slow
    ? [
        {
          levels: profile.history.length % 2 === 0 ? ['remember', 'understand'] : ['understand', 'remember'],
          strict: true,
        },
      ]
    : [
        { levels: [preferred], strict: true },
        { levels: allowed, strict: true },
        { levels: fallbackOrder(preferred), strict: false },
      ];

  for (const tier of tiers) {
    for (const level of tier.levels) {
      // A slow learner is never served above Understand, even in the last-resort
      // tier. This ceiling is the feature, not a nicety.
      if (slow && !['remember', 'understand'].includes(level)) continue;

      const candidates = pool.filter((q) => q.bloom === level);
      if (candidates.length === 0) continue;

      const question = candidates[Math.floor(rng() * candidates.length)];
      return { question, level, reason: explain(profile, level, slow, tier.strict) };
    }
  }

  return null;
}

// Four of the six level names start with a vowel, and this sentence is shown
// under every question on every phone and in the teacher grid's row tooltip.
const article = (label) => (/^[AEIOU]/i.test(label) ? 'an' : 'a');

function explain(profile, level, slow, onTarget) {
  const item = `${article(LABEL[level])} ${LABEL[level]} item`;
  if (slow) {
    return `Below-40% band: serving ${item} (easy / understanding-type only).`;
  }
  if (onTarget && level === profile.workingLevel) {
    return `Working level is ${LABEL[profile.workingLevel]}: serving ${item}.`;
  }
  return `Working level is ${LABEL[profile.workingLevel]}, but no unseen items remain there - serving ${item} instead.`;
}

/**
 * A room's question set (sessions.question_ids, 0015): the ids of the only
 * questions it may serve, or null for its whole active bank, which is what every
 * room opened before sets existed, and every room opened without one, serves.
 * Lower case, because a uuid may be typed either way and Postgres prints it lower.
 */
export function roomQuestionIds(session) {
  const ids = session?.questionIds;
  return Array.isArray(ids) ? ids.map((id) => String(id).toLowerCase()) : null;
}

/** May this room serve the question with this id? Only asks the set; the caller checks status. */
export function inRoomSet(session, questionId) {
  const set = roomQuestionIds(session);
  return !set || set.includes(String(questionId ?? '').toLowerCase());
}

/**
 * What a room may serve: active questions, and of those only its set's when it
 * has one. Every serving path reads the bank through this, the live loop's bank
 * cache and the image rule (services/media.js) alike, so selectNext() is only
 * ever handed questions the room may serve, and a question the professor left
 * out of the set never reaches a phone however it is asked for.
 */
export function servableFor(session, questions) {
  return (questions ?? []).filter((q) => (q.status ?? 'active') === 'active' && inRoomSet(session, q._id));
}

/**
 * Serve a whole set at once (used by the seed script and the load test).
 * Selection is sequential so each pick respects the items already handed out.
 */
export function selectSet(profile, questions, count) {
  const served = [];
  let shadow = { ...profile, history: profile.history.slice() };
  for (let i = 0; i < count; i += 1) {
    const pick = selectNext(shadow, questions);
    if (!pick) break;
    served.push(pick);
    shadow.history = [
      ...shadow.history,
      { questionId: String(pick.question._id ?? pick.question.id), bloom: pick.question.bloom, correct: false, at: null },
    ];
  }
  return served;
}
