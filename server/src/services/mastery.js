// F3 - the mastery model. This is the feature the mentor called "no one has
// done this part before" [transcript 0:00-0:19], so the rules live in one pure,
// unit-tested module with no I/O and no framework in sight.
//
// The design constraint from the report (section 2.2): "a teacher should be
// able to ask why a student got the set they got and receive an answer in one
// sentence". Every function that changes a level also returns that sentence.

import {
  LEVELS,
  FLOOR,
  emptyLevels,
  normaliseLevels,
  levelIndex,
  shiftLevel,
  LABEL,
} from '../bloom.js';
// Only the predicate, and only to answer one question: is there anything here to
// be right about? A poll is not a question a student can retry or redeem.
import { countsTowardMastery } from '../questionTypes.js';

/** No history -> start at Understand, not Remember. [completion.md F3] */
export const COLD_START_LEVEL = 'understand';

/** Rolling window over the most recent answers at the current level. */
export const WINDOW = 5;

/** >= 70% over the window promotes one level. */
export const PROMOTE_AT = 0.7;

/** < 40% over the window demotes one level. */
export const DEMOTE_AT = 0.4;

/**
 * Answers needed *at a level* before that level's accuracy may move the student.
 * Without this, one lucky answer promotes a whole level and a student reaches
 * Create in five questions - which is both pedagogically indefensible and the
 * first thing anyone watching the demo would poke at. It also matters for the
 * slow-learner branch: it holds a struggling student at Understand for their
 * first few answers, by which point the below-40% band has engaged and the
 * ceiling takes over, so they are never served an Apply item in the gap.
 */
export const MIN_LEVEL_EVIDENCE = 3;

/**
 * Top of the mentor's own "below 30 to 40" band. A student whose overall
 * accuracy sits under this is the slow learner the project exists for, and is
 * served easy + understanding-type items only.
 */
export const SLOW_LEARNER_BAND = 0.4;

/** Don't label anyone a slow learner off one unlucky question. */
export const MIN_EVIDENCE = 3;

/* ===================================================================== F7 ==
   PER-ROOM SETTINGS - a layer ABOVE the constants written above, never a
   replacement for them.

   Everything from here down is chosen by the teacher when they open a room.
   Nothing in it may move PROMOTE_AT, DEMOTE_AT, WINDOW or MIN_LEVEL_EVIDENCE:
   those are the tuned ladder and they are the same in every room, so "why did
   this student get this set" has one answer across the whole department. What a
   teacher gets to choose is what happens AROUND an answer - how many goes a
   student gets at it, whether an old failure keeps counting once they have shown
   they can do it, and what bar this class calls mastered.

   The competitor's version of this screen (Assign -> Accuracy mode) offers the
   same three controls and explains none of them, which is affordable there
   because its accuracy figure is a mark out of ten. Ours decides which KIND of
   thinking a student is asked for next, so a setting that quietly changes the
   figure changes the questions - and a teacher who cannot explain that to the
   student in front of them has been handed a worse tool, not a better one.
   Hence: every rule here is written down in words the teacher is shown, and
   every one of them is off by default.
   ========================================================================= */

/**
 * The accuracy a student must reach AT A LEVEL for this class to call that level
 * mastered. Not the promotion bar - promotion is PROMOTE_AT over the rolling
 * window and is untouched by this. Mastery is the teacher's own standard, the
 * one they would sign their name under: "I am satisfied this student can
 * Analyse". A student can be working at Analyse (the ladder put them there) and
 * not have mastered it (the goal is not met yet), and those two facts being
 * separate is the point.
 */
export const MASTERY_GOALS = [0.8, 0.9, 1.0];
export const DEFAULT_MASTERY_GOAL = 0.8;

/**
 * Extra goes at a question the student got wrong, before the answer counts.
 *
 * Capped at two, and the cap is not arbitrary. Every retry shrinks the answer
 * space, and past a point "answering" becomes "enumerating" - see retriesFor(),
 * which refuses the retries that would hand the answer over outright.
 */
export const MAX_REATTEMPTS = 2;

/**
 * Kinds where one submission eliminates one WHOLE answer, so a retry is worth
 * exactly one option of the guess.
 *
 * On everything else an attempt rules out one combination out of many (a match
 * with four pairs has twenty-four orderings; an open response has no list at
 * all), so a retry is a chance to think again rather than a chance to tick the
 * next box along. Those kinds get whatever the teacher set.
 */
const CLOSED_CHOICE_KINDS = ['mcq', 'truefalse'];

/**
 * How many retries this particular question may actually offer.
 *
 * The rule, in one line: a retry must never leave a single option standing.
 *
 * On a true/false that means none at all - one wrong answer IS the answer, and
 * a room with reattempts on would otherwise turn every true/false in the bank
 * into a free mark and every level tally built out of them into fiction. On a
 * four-option mcq it means at most two, which is the cap anyway. The same
 * arithmetic gives both numbers, so nothing here is a special case bolted on
 * for one kind.
 *
 * A poll gets none because there is nothing to be wrong about; countsTowardMastery
 * is the one source for that, so a kind added to UNGRADED_KINDS is un-retryable
 * the same day it is un-gradeable.
 */
export function retriesFor(question, reattempts) {
  const asked = Math.max(0, Math.min(MAX_REATTEMPTS, Math.trunc(Number(reattempts)) || 0));
  if (!countsTowardMastery(question)) return 0;
  const kind = question?.kind ?? 'mcq';
  if (!CLOSED_CHOICE_KINDS.includes(kind)) return asked;
  // truefalse carries no options array - the two are the kind itself.
  const options = kind === 'truefalse' ? 2 : (Array.isArray(question?.options) ? question.options.length : 0);
  return Math.max(0, Math.min(asked, options - 2));
}

/**
 * REDEMPTION, in the words a teacher may repeat to a student verbatim.
 *
 * Exported as a string rather than written into a screen for the same reason
 * integrity.js exports HONESTY: every surface that acts on this rule shows the
 * same sentence, and none of them can quietly drop half of it. A silent score
 * adjustment a teacher cannot explain is worse than no feature.
 */
export const REDEMPTION_RULE = [
  'Get a question right first time at some level, and the earliest question you got wrong',
  'at that same level is set aside: it stops counting towards your accuracy. One is set',
  'aside per question you get right, oldest first, and nothing is deleted - your teacher',
  'still sees every answer you gave and which ones were set aside.',
].join(' ');

/**
 * Why FIRST TIME, and why one-for-one - the two constraints that stop this being
 * a slow leak of free marks.
 *
 * First time: an answer that needed a retry is weaker evidence than one that did
 * not, and letting it redeem would multiply the two settings together - two
 * retries plus redemption would mean a student could guess their way to a right
 * answer and have it erase a real failure. So the two features never compound:
 * a retried answer still counts, it simply cannot pay off a debt.
 *
 * One-for-one, oldest first: redemption can only ever spend a present success
 * against a past failure, and each success spends itself. So it can lift a
 * student who has genuinely turned a corner and it can never lift one who has
 * not - their recent misses are still there, uncancelled, because there are no
 * successes left over to cancel them with.
 *
 * A redeemed answer is WITHDRAWN, not converted: it leaves the denominator, it
 * does not join the numerator. Setting an attempt aside is honest; crediting a
 * student with a right answer they never gave is not.
 */
export const REDEEMS_ONLY_FIRST_TRY = true;

/** The three settings, defaulted and clamped. One reader, so no caller can drift. */
export function sessionSettings(session = {}) {
  const goal = Number(session?.masteryGoal);
  const tries = Math.trunc(Number(session?.reattempts));
  return {
    masteryGoal: MASTERY_GOALS.includes(goal) ? goal : DEFAULT_MASTERY_GOAL,
    reattempts: Number.isFinite(tries) && tries >= 0 && tries <= MAX_REATTEMPTS ? tries : 0,
    // Strictly true, so a string, a 1 or an absent column is off. Off is the
    // side to be wrong on: redemption can only ever raise an accuracy figure.
    redemption: session?.redemption === true,
  };
}

export function emptyProfile({ sessionId, rollNo, name = '', accountId = null }) {
  return {
    sessionId,
    rollNo: String(rollNo).trim(),
    name,
    // The student account this roll number belongs to on the room owner's
    // roster, when there is one. Null for a guest roll number.
    accountId,
    levels: emptyLevels(),
    workingLevel: COLD_START_LEVEL,
    history: [],
    reason: 'No history yet - starting at Understand.',
    // The question this student is currently on. Held server-side so a closed
    // tab comes back to the SAME item rather than a fresh one.
    served: null,
    // Append-only record of what was observable during the session. Signals, not
    // proof - see services/integrity.js for why that distinction is load-bearing.
    integrity: [],
  };
}

/** Coerce anything (DB doc, seed fixture, socket payload) into a full profile. */
export function hydrate(raw = {}) {
  return {
    sessionId: raw.sessionId ?? null,
    rollNo: String(raw.rollNo ?? '').trim(),
    name: raw.name ?? '',
    levels: normaliseLevels(raw.levels),
    workingLevel: LEVELS.includes(raw.workingLevel) ? raw.workingLevel : COLD_START_LEVEL,
    history: Array.isArray(raw.history) ? raw.history.slice() : [],
    reason: raw.reason ?? '',
    served: normaliseServed(raw.served),
    integrity: Array.isArray(raw.integrity) ? raw.integrity.slice() : [],
    accountId: raw.accountId ?? null,
  };
}

/**
 * The pin, with its retry counter forced into shape.
 *
 * `tries` used to be decoration; it now decides whether an answer counts, so a
 * null from a column that did not exist last week, a string from a hand-edited
 * row or a NaN must all read as "no attempts spent" rather than propagating into
 * the arithmetic that hands out the last go.
 */
function normaliseServed(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tries = Math.trunc(Number(raw.tries));
  return {
    questionId: String(raw.questionId ?? ''),
    at: raw.at ?? null,
    reason: raw.reason ?? '',
    tries: Number.isFinite(tries) && tries > 0 ? tries : 0,
    // A fingerprint of the last answer submitted against this pin, never the
    // answer itself - see answerPrint().
    last: typeof raw.last === 'string' && raw.last ? raw.last : '',
  };
}

export function totals(profile) {
  let seen = 0;
  let correct = 0;
  for (const l of LEVELS) {
    seen += profile.levels[l].seen;
    correct += profile.levels[l].correct;
  }
  return { seen, correct };
}

/** Overall accuracy across every level. Returns null when there is no evidence. */
export function overallAccuracy(profile) {
  const { seen, correct } = totals(profile);
  return seen === 0 ? null : correct / seen;
}

/**
 * How many answers at each level redemption has set aside.
 *
 * Derived from `history` and never stored as a counter of its own. The marks are
 * on the entries themselves - a redeemed answer carries `redeemedBy`, naming the
 * answer that redeemed it - so the tally and the evidence for it cannot disagree,
 * and a teacher asking "which one?" gets a question id rather than a number.
 */
export function withdrawnByLevel(profile) {
  const out = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const h of profile.history ?? []) {
    if (h?.redeemedBy && LEVELS.includes(h.bloom)) out[h.bloom] += 1;
  }
  return out;
}

/**
 * The level tallies as they COUNT - raw, minus whatever redemption withdrew.
 *
 * With redemption off, or on and nothing yet redeemed, this is `levels`
 * unchanged, which is why turning the setting off is genuinely a no-op rather
 * than a different code path that happens to agree.
 *
 * Only `seen` moves. A withdrawn answer is always a wrong one, so `correct` is
 * untouched - that is the whole arithmetic of "it stops dragging the average".
 */
export function countedLevels(profile) {
  const gone = withdrawnByLevel(profile);
  return Object.fromEntries(LEVELS.map((level) => {
    const { seen, correct } = profile.levels[level];
    // Clamped rather than trusted: `levels` and `history` are written together
    // by applyAnswer, but a seeded fixture or a half-written row can disagree,
    // and a negative denominator would produce an accuracy over 100%.
    return [level, { seen: Math.max(correct, seen - gone[level]), correct }];
  }));
}

export function countedTotals(profile) {
  const counted = countedLevels(profile);
  let seen = 0;
  let correct = 0;
  for (const l of LEVELS) {
    seen += counted[l].seen;
    correct += counted[l].correct;
  }
  return { seen, correct };
}

/**
 * Overall accuracy after redemption. This is the figure the below-40% band
 * reads, and that is the entire behavioural effect of the redemption setting:
 * a student who struggled early and has since demonstrated the level stops being
 * held under the Understand ceiling by answers they have already made good.
 *
 * It can only ever move upwards, because redemption only ever removes wrong
 * answers. No student can be pushed INTO the band by a setting their teacher
 * turned on.
 */
export function countedAccuracy(profile) {
  const { seen, correct } = countedTotals(profile);
  return seen === 0 ? null : correct / seen;
}

/**
 * The below-30-40% band. Deliberately requires MIN_EVIDENCE attempts so a
 * student is not branded on their first wrong answer.
 *
 * Reads the counted figure, not the raw one. With redemption off the two are the
 * same number by construction, so the band's behaviour is unchanged in every
 * room that did not ask for this.
 */
export function isSlowLearner(profile) {
  const { seen } = countedTotals(profile);
  if (seen < MIN_EVIDENCE) return false;
  return countedAccuracy(profile) < SLOW_LEARNER_BAND;
}

/**
 * Rolling accuracy over the last `window` answers *at that level*.
 * Returns null when the student has not answered enough at that level yet -
 * an unproven level must not trigger a promotion or a demotion.
 */
export function rollingAccuracy(profile, level, window = WINDOW) {
  // `ungraded` entries are in the history so the selector knows the student has
  // already had that item, and are excluded here because they are not evidence
  // of anything - a poll scores correct for every well-formed answer. Left in,
  // three polls in a row would be a promotion earned by tapping anything.
  const atLevel = profile.history.filter((h) => h.bloom === level && !h.ungraded);
  if (atLevel.length === 0) return null;
  const recent = atLevel.slice(-window);
  const correct = recent.filter((h) => h.correct).length;
  return { accuracy: correct / recent.length, n: recent.length };
}

/**
 * Which levels this student may be served right now.
 * The slow-learner branch is the whole point of the project: easy +
 * understanding-type items only, never anything above Understand.
 */
export function eligibleLevels(profile) {
  if (isSlowLearner(profile)) return ['remember', 'understand'];
  const i = levelIndex(profile.workingLevel);
  // The working level, with one rung below it as a cushion so a student who
  // just got promoted still meets some consolidating items.
  return LEVELS.slice(Math.max(0, i - 1), i + 1);
}

/**
 * Decide the working level from the profile as it now stands.
 * Pure: returns the new level plus the one-sentence explanation.
 */
export function recomputeWorkingLevel(profile) {
  const { seen } = totals(profile);

  if (seen === 0) {
    return {
      workingLevel: COLD_START_LEVEL,
      reason: 'No history yet - starting at Understand.',
      changed: profile.workingLevel !== COLD_START_LEVEL,
    };
  }

  if (isSlowLearner(profile)) {
    const pct = Math.round(overallAccuracy(profile) * 100);
    // Held at Understand, and eligibleLevels() keeps the pool to Remember +
    // Understand, so the ceiling is real and not just cosmetic.
    return {
      workingLevel: 'understand',
      reason: `Overall ${pct}% is inside the below-40% band - serving Remember and Understand items only.`,
      changed: profile.workingLevel !== 'understand',
    };
  }

  const current = profile.workingLevel;
  const rolling = rollingAccuracy(profile, current);

  if (!rolling) {
    return {
      workingLevel: current,
      reason: `No answers yet at ${LABEL[current]} - holding level.`,
      changed: false,
    };
  }

  if (rolling.n < MIN_LEVEL_EVIDENCE) {
    return {
      workingLevel: current,
      reason: `Only ${rolling.n} answer${rolling.n === 1 ? '' : 's'} at ${LABEL[current]} so far - need ${MIN_LEVEL_EVIDENCE} before moving level.`,
      changed: false,
    };
  }

  const pct = Math.round(rolling.accuracy * 100);

  if (rolling.accuracy >= PROMOTE_AT) {
    const next = shiftLevel(current, +1);
    if (next === current) {
      return {
        workingLevel: current,
        reason: `${pct}% at ${LABEL[current]} over the last ${rolling.n} - already at the top of the ladder.`,
        changed: false,
      };
    }
    return {
      workingLevel: next,
      reason: `${pct}% at ${LABEL[current]} over the last ${rolling.n} - promoted to ${LABEL[next]}.`,
      changed: true,
    };
  }

  if (rolling.accuracy < DEMOTE_AT) {
    const next = shiftLevel(current, -1);
    if (next === current) {
      return {
        workingLevel: FLOOR,
        reason: `${pct}% at ${LABEL[current]} over the last ${rolling.n} - already at the floor, holding at Remember.`,
        changed: false,
      };
    }
    return {
      workingLevel: next,
      reason: `${pct}% at ${LABEL[current]} over the last ${rolling.n} - demoted to ${LABEL[next]}.`,
      changed: true,
    };
  }

  return {
    workingLevel: current,
    reason: `${pct}% at ${LABEL[current]} over the last ${rolling.n} - holding at ${LABEL[current]}.`,
    changed: false,
  };
}

/**
 * Score one answer into the profile. Pure - returns a new profile, never
 * mutates the one passed in.
 *
 * `bloom` is carried on each history entry (a small addition to the schema in
 * completion.md section 5) so per-level rolling accuracy is computable from the
 * profile alone, with no join back to the question bank on the hot path.
 */
export function applyAnswer(
  profile,
  {
    questionId, bloom, correct, score = null, at = null, tries = 1, redemption = false,
    topic = '', kind = 'mcq', answerId = '',
  },
) {
  const next = hydrate(profile);

  if (!LEVELS.includes(bloom)) {
    throw new Error(`applyAnswer: unknown bloom level "${bloom}"`);
  }

  next.levels[bloom] = {
    seen: next.levels[bloom].seen + 1,
    correct: next.levels[bloom].correct + (correct ? 1 : 0),
  };

  // ONE entry per question however many attempts it took. The retries happened
  // before this call - the socket loop only reaches applyAnswer once the answer
  // is final - so a retried question is a single `seen` at its level and a
  // single row in the rolling window, exactly like every other.
  const spent = Math.trunc(Number(tries));
  const attempts = Number.isFinite(spent) && spent > 1 ? spent : 1;

  // `score` is the 0..1 credit a partial-credit kind earned. The model itself
  // stays boolean - the threshold that turns credit into "demonstrated" lives in
  // questionTypes - but the raw figure is kept so a teacher can see that a
  // student got three of four pairs rather than simply "wrong".
  const entry = {
    questionId: String(questionId),
    bloom,
    // Carried on the entry so topic analytics and the evidence trail do not
    // need a join back to a question that may since have been edited.
    topic: String(topic ?? ''),
    kind: String(kind ?? 'mcq'),
    ...(answerId ? { answerId: String(answerId) } : {}),
    correct: Boolean(correct),
    ...(score === null ? {} : { score: Math.round(score * 100) / 100 }),
    // Written only when it is true. "Right on the third go" is different
    // evidence from "right", and a teacher reading the trail is owed the
    // difference - but a room with reattempts off must produce exactly the
    // history it produced before this setting existed.
    ...(attempts > 1 ? { tries: attempts } : {}),
    at: at ?? new Date().toISOString(),
  };
  next.history = [...next.history, entry];

  // Redemption. REDEMPTION_RULE above is the sentence this implements, and the
  // two must be read together - the rule is the specification and this is only
  // its arithmetic.
  let redeemed = null;
  if (redemption && entry.correct && attempts === 1) {
    // Oldest first, and only one. `redeemedBy` is what makes a debt spent, so a
    // second correct answer finds the next one along rather than the same one.
    // `ungraded` is excluded explicitly: those entries carry no `correct` at
    // all, so `!h.correct` is true of every one of them, and without this a
    // student's redemption would be spent silently on a poll - paying off a
    // failure that never happened and leaving the real one still counting.
    const i = next.history.findIndex(
      (h) => h.bloom === bloom && !h.ungraded && !h.correct && !h.redeemedBy,
    );
    if (i >= 0) {
      const paid = { ...next.history[i], redeemedBy: entry.questionId };
      next.history = next.history.map((h, k) => (k === i ? paid : h));
      // Named on both ends: the failure knows what redeemed it and the success
      // knows what it paid for, so the pairing survives being read from either.
      next.history[next.history.length - 1] = { ...entry, redeems: paid.questionId };
      redeemed = {
        questionId: paid.questionId,
        bloom,
        by: entry.questionId,
        reason:
          `Right first time at ${LABEL[bloom]}, so the earliest ${LABEL[bloom]} question ` +
          'answered wrong is set aside and stops counting towards the average.',
      };
    }
  }

  const decision = recomputeWorkingLevel(next);
  next.workingLevel = decision.workingLevel;
  next.reason = decision.reason;

  return { profile: next, decision, redeemed };
}

/**
 * Record an item that asked something without assessing anything - today that is
 * `poll`, and questionTypes.countsTowardMastery() is the only thing that decides.
 *
 * It has to be recorded SOMEWHERE, and that is the part a bare
 * `if (countsTowardMastery(q)) applyAnswer(...)` misses: the selector's `unseen`
 * filter reads `history`, so an item that produced no entry is an item the
 * student is served again on their very next question, and again after that.
 * The student who answered the poll would spend the rest of the room answering
 * the same poll.
 *
 * So the entry is written, marked, and read by nothing that reasons about
 * ability: `levels` is untouched, so it reaches neither the overall accuracy nor
 * the below-40% band, and rollingAccuracy() skips it, so it reaches neither
 * promotion nor demotion. The working level is not even recomputed - nothing
 * happened that could have changed it.
 */
export function recordUngraded(profile, { questionId, bloom, at = null, topic = '', kind = 'poll', answerId = '' }) {
  const next = hydrate(profile);
  if (!LEVELS.includes(bloom)) {
    throw new Error(`recordUngraded: unknown bloom level "${bloom}"`);
  }
  next.history = [
    ...next.history,
    {
      questionId: String(questionId),
      // Carried because the entry has to look like the others to everything that
      // walks the list. On an ungraded item the tag is POSITIONAL - where in the
      // lesson it sat - and `ungraded` beside it is what says so.
      bloom,
      topic: String(topic ?? ''),
      kind: String(kind ?? 'poll'),
      ...(answerId ? { answerId: String(answerId) } : {}),
      ungraded: true,
      at: at ?? new Date().toISOString(),
    },
  ];
  return { profile: next };
}

/* ---------------------------------------------------------------- reviews --

   A professor's review of a written answer, applied after the fact. The answer
   row keeps the machine's mark and gets the professor's beside it (see
   routes/review.js); this is the other half, which makes the student's profile
   agree with the professor. */

/** What a reviewed history entry is marked with. */
export const REVIEW_MARKS = ['confirmed', 'overridden'];

/**
 * Redo redemption's pairings at one level, from the history as it now stands.
 *
 * applyAnswer() pays each first-try right answer against the earliest unpaid
 * wrong one before it at the same level. Walking the history in order with that
 * same rule gives back every pairing applyAnswer made, exactly, so long as no
 * mark has changed (tested). After a review flips a mark it gives the pairing
 * the room's rule would have made had the reviewed mark been the mark all along,
 * and that is the only pairing that keeps countedLevels() honest: every answer
 * set aside is still a wrong one, and no wrong answer is paying for anything.
 */
function repairRedemption(history, level) {
  const out = history.map((h) => {
    if (h?.bloom !== level || !('redeemedBy' in h || 'redeems' in h)) return h;
    const { redeemedBy, redeems, ...rest } = h;
    return rest;
  });
  for (let k = 0; k < out.length; k += 1) {
    const h = out[k];
    // The same three conditions applyAnswer() checks: right, first time, graded.
    if (h?.bloom !== level || h.ungraded || !h.correct || (Number(h.tries) || 1) > 1) continue;
    const j = out.findIndex((w, i) => i < k && w?.bloom === level && !w.ungraded && !w.correct && !w.redeemedBy);
    if (j < 0) continue;
    out[j] = { ...out[j], redeemedBy: h.questionId };
    out[k] = { ...h, redeems: out[j].questionId };
  }
  return out;
}

/**
 * Apply a professor's review of one answer to the profile. Pure - returns a new
 * profile, never mutates the one passed in.
 *
 * The history entry for that answer is found by `answerId` (the answer's
 * idempotency key, which every final answer's entry carries). It takes the
 * reviewed `correct` and `score` and is marked `review`, and the level's
 * `correct` tally moves by the difference - `seen` never moves, the answer was
 * given either way. Everything else a screen shows is derived from those two
 * (totals, the below-40% band, the mastery goal, the CSV, analytics, topic
 * accuracy), so all of it reads the human decision without a code path of its
 * own.
 *
 * Deliberately NOT changed: the working level and its reason. The ladder's
 * decisions were made, shown to the student and acted on; rewinding them would
 * pull a student back off a level mid-class with nothing on their screen to say
 * why. The corrected entry sits in the rolling window from now on, so the next
 * decision the ladder makes reads the human mark.
 *
 * In a room running redemption a flipped mark can leave a pairing wrong - an
 * answer set aside that is now right, or a right answer paying off a debt when
 * it is now wrong itself. That level's pairings are redone by the room's own
 * rule (repairRedemption above).
 *
 * Idempotent: the change is measured against the entry as it stands, not against
 * the answer row, so the same review applied twice moves nothing the second
 * time, and a review whose profile write failed can simply be applied again.
 *
 * @returns {{ profile: object, found: boolean, changed: boolean }}
 *   found is false when no entry carries this answerId - the profile is then
 *   returned unchanged.
 */
export function applyReview(profile, { answerId, correct, score = null, review, redemption = false }) {
  if (!REVIEW_MARKS.includes(review)) {
    throw new Error(`applyReview: unknown review mark "${review}"`);
  }
  const next = hydrate(profile);
  const key = String(answerId ?? '');
  const i = key ? next.history.findIndex((h) => String(h?.answerId ?? '') === key) : -1;
  if (i < 0) return { profile: next, found: false, changed: false };

  const entry = next.history[i];
  // A poll has no mark to review. Nothing to change, and nothing to count.
  if (entry.ungraded || !LEVELS.includes(entry.bloom)) return { profile: next, found: true, changed: false };

  const was = Boolean(entry.correct);
  const now = Boolean(correct);
  const updated = {
    ...entry,
    correct: now,
    // Rounded the way applyAnswer() rounds it, so a reviewed entry and an
    // unreviewed one hold the same precision.
    ...(score === null || score === undefined ? {} : { score: Math.round(Number(score) * 100) / 100 }),
    review,
  };
  if (was === now && updated.score === entry.score && updated.review === entry.review) {
    return { profile: next, found: true, changed: false };
  }

  next.history = next.history.map((h, k) => (k === i ? updated : h));
  if (was !== now) {
    const { seen, correct: right } = next.levels[entry.bloom];
    // Clamped like countedLevels(): a seeded fixture or a half-written row can
    // disagree with its history, and a tally below zero or above `seen` would
    // put an accuracy outside 0..100% on a screen.
    next.levels[entry.bloom] = { seen, correct: Math.max(0, Math.min(seen, right + (now ? 1 : -1))) };
    if (redemption) next.history = repairRedemption(next.history, entry.bloom);
  }
  return { profile: next, found: true, changed: true };
}

/* ------------------------------------------------------- the mastery goal --

   Separate from the ladder on purpose. recomputeWorkingLevel() answers "what
   should this student be asked next"; the goal answers "would this teacher sign
   off that this student has this level". A student can be working two rungs
   above a level they have not mastered, because the ladder moves on recent form
   over a five-answer window and the goal is a standard over everything counted.
   Neither reads the other, and neither should. */

/**
 * Per-level mastery against this room's goal, with the sentence that explains it.
 *
 * MIN_LEVEL_EVIDENCE is reused rather than given a bar of its own: it is already
 * the project's answer to "how little evidence is too little to say anything
 * about a level", and having two different answers to that question is how a
 * grid ends up claiming mastery off one lucky answer.
 */
export function masteryReport(profile, { goal = DEFAULT_MASTERY_GOAL } = {}) {
  const counted = countedLevels(profile);
  const gone = withdrawnByLevel(profile);
  const bar = Math.round(goal * 100);

  return LEVELS.map((level) => {
    const { seen, correct } = counted[level];
    const accuracy = seen === 0 ? null : correct / seen;
    const enough = seen >= MIN_LEVEL_EVIDENCE;
    const mastered = enough && accuracy >= goal;
    const pct = accuracy === null ? null : Math.round(accuracy * 100);

    let reason;
    if (seen === 0) reason = `No ${LABEL[level]} questions answered yet.`;
    else if (!enough) {
      reason = `${seen} of the ${MIN_LEVEL_EVIDENCE} answers needed before ${LABEL[level]} can be called mastered.`;
    } else if (mastered) reason = `${pct}% of ${seen} at ${LABEL[level]} - at or above this room's ${bar}% goal.`;
    else reason = `${pct}% of ${seen} at ${LABEL[level]} - under this room's ${bar}% goal.`;

    return {
      level,
      label: LABEL[level],
      seen,
      correct,
      accuracy,
      // Only ever non-zero in a room running redemption, and shown wherever the
      // accuracy is, because a figure that quietly stopped counting four answers
      // is a figure nobody can check.
      withdrawn: gone[level],
      mastered,
      reason,
    };
  });
}

/** Just the level names, for the grid. */
export const masteredLevels = (profile, goal = DEFAULT_MASTERY_GOAL) =>
  masteryReport(profile, { goal }).filter((r) => r.mastered).map((r) => r.level);

/* --------------------------------------------------------- reattempt state --

   The retry counter lives on the pin (`profile.served`) and nowhere else, which
   is the only place it can live: the pin already IS the record of "what is this
   student looking at right now", it is already written before the phone can
   answer, and it is already cleared the moment the answer counts. A counter kept
   anywhere else would need clearing in all the same places and would eventually
   not be. */

/** Attempts already spent on the question this student is pinned to. */
export const triesSpent = (profile, questionId) =>
  String(profile?.served?.questionId ?? '') === String(questionId)
    ? (profile.served.tries ?? 0)
    : 0;

/**
 * A fingerprint of one submitted answer.
 *
 * The same answer arriving twice is one attempt, not two. That is not a nicety:
 * the phone holds its submission until a result comes back for it and re-sends
 * on reconnect, so a result lost to hall wifi would otherwise cost a student a
 * retry they never chose to spend. The existing double-tap guard says the same
 * thing about a scored answer ("answer a submission it has already scored with
 * the score it recorded"); this is that guard for the attempts before the last.
 *
 * A hash, not the answer. This is written to a column that exists to compare two
 * submissions, and an answer stored somewhere nothing needs to read it is an
 * answer waiting to leak out of a query somebody writes later.
 */
export function answerPrint(response) {
  const s = JSON.stringify(response ?? null);
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Per-level accuracy vector, for the dashboard and the CSV export.
 *
 * `seen`, `correct` and `accuracy` are the RAW record - every answer the student
 * gave, including any redemption set aside - because an export is the archive
 * and an archive that has already had rows removed from it cannot be checked.
 * What redemption did is reported beside it, never instead of it.
 */
export function levelReport(profile) {
  const counted = countedLevels(profile);
  const gone = withdrawnByLevel(profile);
  return LEVELS.map((level) => {
    const { seen, correct } = profile.levels[level];
    return {
      level,
      label: LABEL[level],
      seen,
      correct,
      accuracy: seen === 0 ? null : correct / seen,
      withdrawn: gone[level],
      // The same figures after redemption. Identical to the three above in every
      // room that did not turn it on.
      counted: {
        ...counted[level],
        accuracy: counted[level].seen === 0 ? null : counted[level].correct / counted[level].seen,
      },
    };
  });
}
