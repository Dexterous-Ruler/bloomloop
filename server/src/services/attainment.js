// Phase 4 - course-outcome and Bloom attainment, and the marks register.
//
// A professor runs rooms for a class; every answer is already stored (0008),
// every answer can be traced to its course outcomes (resolveAnswer in
// services/outcomes.js), and the roster says who the class is (0016). This
// module turns that into what a college reports, without anyone compiling quiz
// results by hand:
//
//   per student x outcome   marks obtained and possible, by evidence type, the
//                           share counted, and a state: attained, not attained,
//                           or not enough evidence
//   per outcome             how many students were counted, how many attained,
//                           the share, and the class's attainment level
//   per Bloom level         the same, level by level (and decision 6's three
//                           level bands), over every counted answer at that level
//   the marks register      per student and room, marks obtained of possible, by
//                           evidence type, with the attendance mark
//
// THE FORMULA IS DATA. Colleges compute attainment by their own rules, so no
// rule is written in here as "the" one. A class's formula (configFrom below) is
// a threshold, a minimum number of answers, a list of class levels, which
// evidence counts, which attempts count, and optional room weights; it is
// validated here, stored per class with a version (0020), and every report
// returns the exact formula it used and a methodology paragraph generated from
// it. The examples shipped are data in attainmentPresets.js.
//
// EVIDENCE TYPES (evidenceTypeOf), read from how the live loop and the review
// route write an answer row (sockets/index.js, routes/review.js):
//   digital         review_status 'auto': an objective answer marked by the
//                   server from the stored key
//   aiProvisional   review_status 'provisional': a written answer whose mark came
//                   from the keyword marker (the rubric's words matched in the
//                   answer), and that no professor has reviewed. A provisional
//                   MACHINE mark: no model marks answers, so it is not AI,
//                   whatever the stored key says. The key keeps its name, since
//                   saved formulas use it
//   humanReviewed   review_status 'confirmed' or 'overridden': a professor
//                   confirmed or changed the mark (answer_reviews, 0010)
//   revote          round 2 of a class question (Phase 5, 0023): the re-vote
//                   after the class discussed it. Shown under its own label and
//                   NEVER counted, whatever a formula says: it follows the
//                   discussion, so it is not the student's own work. A class
//                   question's round 1 is an ordinary digital answer
//   ungraded        a poll: no mark at all. Counted as a number, nowhere else
// Teacher records (observations, wheel picks, tallies, activities) are never a
// mark here (decision 3's safe default): they are summarised in their own,
// labelled section and never move a figure.
//
// QUESTION SOURCES (questionSourceOf), a second split of the same answers, by
// who wrote the question rather than who marked the answer, from the
// question_source each answer row keeps (0008): AI-generated ('llm'),
// professor-written ('teacher', since 0022 and the owner's 19 Nov 2026
// decision) and the offline template's ('fallback', which is also how a
// professor's own question was stored before then). It moves no mark; it says
// what a figure's counted marks rest on.
//
// WHOSE ANSWERS (rollResolver). A room's answers carry the roll number typed
// into the phone; its attendance marks carry the roster row and, since 0021,
// the roll number each mark was made under. So an answer is its room's mark's
// student's when the mark carries the roll number it was given under, whatever
// the roster holds now, and is otherwise matched to the roster as it stands.
//
// Arithmetic is exact: scores and weights have at most three decimals, so marks
// are kept as integers (BigInt, in thousandths of thousandths of thousandths)
// and a share is compared with its threshold without floating point, so 6 of 10
// is exactly 60%.
//
// Staff-only, all of it. Students are listed in roll-number order and never
// ranked or numbered by score; states describe evidence, never the student.

import { LEVELS, LABEL } from '../bloom.js';
import { isRecordId } from '../ids.js';
import { allAnswers, answerItem } from './evidence.js';
import { byRoll, studentView } from './roster.js';
import { ACTIVITY_KINDS, OBSERVATION_KINDS, currentObservation, roomDay, slotKey } from './records.js';
import { PICK_STATUSES } from './wheel.js';
import { LEVEL_BANDS } from './classAnalytics.js';
import {
  VIA, chapterMap, inOrder, linkViews, outcomeIndex, overrideQuestions, readOutcomeMap, resolveAnswer, topicKey,
} from './outcomes.js';
import { ANSWERED_AGAIN_DETAIL, OVER_CAP_DETAIL, keptNotCounted } from './offline.js';
import { DEFAULT_PRESET, PRESETS, presetById } from './attainmentPresets.js';
import { PRACTISED_NOTE } from './bankShare.js';
import { awaitingMark } from './drawings.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export const ATTAINMENT_PRIVACY = 'Attainment, marks and every report here are for staff only: never sent to a student\'s phone '
  + 'or the projector, or to any route a student can reach. Students are listed in roll-number order, never ranked by score.';

/* ------------------------------------------------------- evidence types -- */

export const EVIDENCE_TYPES = Object.freeze([
  Object.freeze({
    id: 'digital',
    label: 'Digital answers',
    description: 'Objective answers given on a phone and marked by the server from the stored answer key.',
  }),
  Object.freeze({
    id: 'aiProvisional',
    label: 'Provisional machine marks',
    description: 'Written answers marked by the keyword marker, which matches the rubric\'s words in the answer: a '
      + 'provisional machine mark, not AI and not a professor\'s judgement, until a professor reviews it.',
  }),
  Object.freeze({
    id: 'humanReviewed',
    label: 'Reviewed by a professor',
    description: 'Written answers whose mark a professor confirmed or changed in the review queue.',
  }),
  Object.freeze({
    id: 'revote',
    label: 'Re-votes after discussion',
    description: 'The second vote on a question the professor put to the whole class, given after the class discussed it. '
      + 'Shown, and never counted towards a mark by any formula: it follows the discussion, so it is not the student\'s own '
      + 'work. The first vote on such a question is a digital answer.',
  }),
]);
const TYPE_IDS = EVIDENCE_TYPES.map((t) => t.id);
/** The types a formula may count. A re-vote after discussion is never one of them. */
const COUNTABLE_IDS = Object.freeze(['digital', 'aiProvisional', 'humanReviewed']);

/** Which kind of evidence an answer row is. The rule every figure here is split by. */
export function evidenceTypeOf(answer) {
  if (answer?.ungraded) return 'ungraded';
  // A class question's round 2 (0023). Its round 1 reads as any other answer.
  if (answer?.classQuestionId && Number(answer.round) === 2) return 'revote';
  const status = answer?.reviewStatus;
  if (status === 'confirmed' || status === 'overridden') return 'humanReviewed';
  if (status === 'provisional') return 'aiProvisional';
  // 'auto', and a row written before review_status existed (its default).
  return 'digital';
}

export const QUESTION_SOURCES = Object.freeze([
  Object.freeze({
    id: 'aiGenerated',
    label: 'AI-generated questions',
    description: 'Questions the language model wrote from the professor\'s own material (question_source "llm"). A professor '
      + 'approved each before any room served it. This says where the question came from, not how the answer was marked.',
  }),
  Object.freeze({
    id: 'professorWritten',
    label: 'Professor-written questions',
    description: 'Questions a professor wrote in the question bank (question_source "teacher", since 19 Nov 2026).',
  }),
  Object.freeze({
    id: 'offlineTemplate',
    label: 'Offline-template questions (and professor-written ones from before 19 Nov 2026)',
    description: 'Questions no model wrote (question_source "fallback"): the offline template\'s, and a professor\'s own '
      + 'written before 19 Nov 2026, which were stored the same way. An answer row cannot tell those two apart, so they '
      + 'were not relabelled.',
  }),
]);
const SOURCE_IDS = QUESTION_SOURCES.map((s) => s.id);

/** Who wrote the question an answer row answers: the second split every figure carries. */
export function questionSourceOf(answer) {
  const source = answer?.questionSource;
  if (source === 'teacher') return 'professorWritten';
  if (source === 'fallback') return 'offlineTemplate';
  // 'llm', and a row with none (the column's default is 'llm').
  return 'aiGenerated';
}

/** The three states, as words a report prints. They describe evidence, never the student. */
export const STATES = Object.freeze([
  Object.freeze({ id: 'attained', label: 'Attained' }),
  Object.freeze({ id: 'not-attained', label: 'Not attained' }),
  Object.freeze({ id: 'not-enough-evidence', label: 'Not enough evidence' }),
]);
const stateLabel = (id) => STATES.find((s) => s.id === id)?.label ?? id;

export const STUDENT_STATUSES = Object.freeze([
  Object.freeze({ id: 'active', label: 'On the roster' }),
  Object.freeze({ id: 'removed', label: 'Removed from the roster' }),
  Object.freeze({ id: 'not-on-roster', label: 'Not on the roster' }),
]);
const statusLabel = (id) => STUDENT_STATUSES.find((s) => s.id === id)?.label ?? id;

/* -------------------------------------------------------------- formula -- */

export const CONFIG_KEYS = Object.freeze(['studentThreshold', 'minAnswers', 'levels', 'evidence', 'attempts', 'roomWeights']);
export const ATTEMPTS = Object.freeze(['final', 'best']);
export const LIMITS = Object.freeze({ minAnswers: 100, levels: 10, level: 10, roomWeights: 100, roomWeight: 100 });

/** What each field of a formula means, sent with it so a screen can say so. */
export const CONFIG_FIELDS = Object.freeze({
  studentThreshold: 'A share from 0 to 1 (0.6 for 60%): a student attains an outcome when their marks on its questions '
    + 'reach this share of the marks possible. Above 0, at most 3 decimal places.',
  minAnswers: `A whole number from 1 to ${LIMITS.minAnswers}: below this many counted answers on an outcome, a student is `
    + '"not enough evidence", never "not attained".',
  levels: `1 to ${LIMITS.levels} class levels, [{ level, minShare }]: the class reaches a level when at least minShare of `
    + 'the students counted attained the outcome; level 0 below the first. Levels are whole numbers from 1, and both '
    + 'they and their shares strictly increase.',
  evidence: 'Which evidence counts towards a mark: { digital, aiProvisional, humanReviewed }, each true or false, one '
    + 'at least true; aiProvisional only with humanReviewed, since a review replaces the machine\'s mark. aiProvisional is '
    + 'the keyword marker\'s provisional machine mark, not AI; the key keeps its stored name. Teacher records never count '
    + '(decision 3), and neither does a re-vote after a class discussion, which every report shows under its own label.',
  attempts: '"final": every final attempt counts (an attempt followed by a retry does not). "best": only a student\'s '
    + 'best attempt at each question counts, across attempts and rooms; a professor-reviewed attempt always beats a '
    + 'provisional machine mark at the same question, whatever the two scores and whichever room each came from; a '
    + 'written answer\'s attempt followed by a retry never counts, since only a final attempt can be reviewed.',
  roomWeights: `Up to ${LIMITS.roomWeights} rooms of the class, [{ roomId or code, weight }], weight above 0 and at most `
    + `${LIMITS.roomWeight}: how much that room's answers count beside the rest. Rooms not listed count 1.`,
});

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const threeDecimals = (n) => Math.abs(n * 1000 - Math.round(n * 1000)) < 1e-6;
const round3 = (n) => Math.round(n * 1000) / 1000;
const idKey = (id) => String(id ?? '').trim().toLowerCase();

function onlyKeys(obj, allowed, what) {
  const extra = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (extra.length) throw fail(`${what} takes ${allowed.join(', ')} only; it does not take ${extra.join(', ')}.`, 400);
}

function shareFrom(raw, field, { aboveZero = false } = {}) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 1 || (aboveZero && raw === 0) || !threeDecimals(raw)) {
    throw fail(`${field} must be a share from ${aboveZero ? 'above 0' : '0'} to 1 with at most 3 decimal places `
      + '(0.6 for 60%).', 400);
  }
  return round3(raw);
}

/**
 * A whole formula, checked, in its one canonical shape (key order fixed, so two
 * equal formulas are equal as JSON). Every field is required.
 *
 * `rooms`, when given, are the class's rooms: roomWeights may then name a room
 * by its code or id, and each must be one of them. Left out (a stored formula,
 * a preset, or a save that does not send roomWeights), each entry must already
 * be { roomId, weight }, and a room deleted since is simply not found.
 */
export function validateConfig(raw, { rooms = null } = {}) {
  if (!isObject(raw)) throw fail('config must be an object: { studentThreshold, minAnswers, levels, evidence, attempts, roomWeights }.', 400);
  onlyKeys(raw, CONFIG_KEYS, 'config');
  const missing = CONFIG_KEYS.filter((k) => raw[k] === undefined);
  if (missing.length) throw fail(`config is missing ${missing.join(', ')}.`, 400);

  const studentThreshold = shareFrom(raw.studentThreshold, 'studentThreshold', { aboveZero: true });

  if (!Number.isInteger(raw.minAnswers) || raw.minAnswers < 1 || raw.minAnswers > LIMITS.minAnswers) {
    throw fail(`minAnswers must be a whole number from 1 to ${LIMITS.minAnswers}.`, 400);
  }

  if (!Array.isArray(raw.levels) || !raw.levels.length || raw.levels.length > LIMITS.levels) {
    throw fail(`levels must be a list of 1 to ${LIMITS.levels} { level, minShare }.`, 400);
  }
  const levels = raw.levels.map((l, i) => {
    if (!isObject(l)) throw fail(`levels[${i}] must be { level, minShare }.`, 400);
    onlyKeys(l, ['level', 'minShare'], `levels[${i}]`);
    if (!Number.isInteger(l.level) || l.level < 1 || l.level > LIMITS.level) {
      throw fail(`levels[${i}].level must be a whole number from 1 to ${LIMITS.level}; level 0 is "below the first".`, 400);
    }
    return { level: l.level, minShare: shareFrom(l.minShare, `levels[${i}].minShare`) };
  });
  levels.forEach((l, i) => {
    if (i && (l.level <= levels[i - 1].level || l.minShare <= levels[i - 1].minShare)) {
      throw fail(`levels must strictly increase: levels[${i}] (level ${l.level} at ${l.minShare}) does not come above `
        + `levels[${i - 1}] (level ${levels[i - 1].level} at ${levels[i - 1].minShare}) in both level and minShare.`, 400);
    }
  });

  if (!isObject(raw.evidence)) throw fail('evidence must be { digital, aiProvisional, humanReviewed }, each true or false.', 400);
  const strayEvidence = Object.keys(raw.evidence).filter((k) => !COUNTABLE_IDS.includes(k));
  if (strayEvidence.length) {
    throw fail(`evidence takes ${COUNTABLE_IDS.join(', ')} only, not ${strayEvidence.join(', ')}. Teacher observations and other `
      + 'teacher records never count towards a mark (decision 3); every report lists them beside the marks.'
      + `${strayEvidence.includes('revote') ? ' A re-vote after a class discussion is never counted either: every report shows '
        + 'it under its own label.' : ''}`, 400);
  }
  const evidence = {};
  for (const t of COUNTABLE_IDS) {
    if (typeof raw.evidence[t] !== 'boolean') throw fail(`evidence.${t} must be true or false.`, 400);
    evidence[t] = raw.evidence[t];
  }
  if (!COUNTABLE_IDS.some((t) => evidence[t])) throw fail('evidence must count at least one type, or nothing could be marked.', 400);

  if (!ATTEMPTS.includes(raw.attempts)) throw fail(`attempts must be ${ATTEMPTS.map((a) => `"${a}"`).join(' or ')}.`, 400);

  if (!Array.isArray(raw.roomWeights) || raw.roomWeights.length > LIMITS.roomWeights) {
    throw fail(`roomWeights must be a list of at most ${LIMITS.roomWeights} { roomId or code, weight }; [] counts every room once.`, 400);
  }
  const byCode = rooms ? new Map(rooms.map((r) => [String(r.code).toUpperCase(), r])) : null;
  const byId = rooms ? new Map(rooms.map((r) => [idKey(r._id), r])) : null;
  const seen = new Set();
  const roomWeights = raw.roomWeights.map((w, i) => {
    if (!isObject(w)) throw fail(`roomWeights[${i}] must be { roomId or code, weight }.`, 400);
    onlyKeys(w, rooms ? ['roomId', 'code', 'weight'] : ['roomId', 'weight'], `roomWeights[${i}]`);
    let roomId;
    if (rooms) {
      if ((w.roomId === undefined) === (w.code === undefined)) throw fail(`roomWeights[${i}] names its room by roomId or by code, one of the two.`, 400);
      const room = w.code !== undefined ? byCode.get(String(w.code).trim().toUpperCase()) : byId.get(idKey(w.roomId));
      if (!room) throw fail(`roomWeights[${i}] is not a room of this class.`, 400);
      roomId = idKey(room._id);
    } else {
      roomId = idKey(w.roomId);
      if (!isRecordId(roomId)) throw fail(`roomWeights[${i}].roomId is not a valid id.`, 400);
    }
    if (typeof w.weight !== 'number' || !Number.isFinite(w.weight) || w.weight <= 0 || w.weight > LIMITS.roomWeight || !threeDecimals(w.weight)) {
      throw fail(`roomWeights[${i}].weight must be a number above 0 and at most ${LIMITS.roomWeight}, with at most 3 decimal places.`, 400);
    }
    if (seen.has(roomId)) throw fail(`roomWeights names one room twice (roomWeights[${i}]).`, 400);
    seen.add(roomId);
    return { roomId, weight: round3(w.weight) };
  });

  return { studentThreshold, minAnswers: raw.minAnswers, levels, evidence, attempts: raw.attempts, roomWeights };
}

/**
 * A save's body, { preset?, config? }, into the formula to store. `preset`
 * starts from that example; `config` changes the fields it names (evidence key
 * by key) of the preset, or else of `current`, the formula in force. The result
 * is checked whole. `rooms` are the class's rooms, for roomWeights sent now.
 */
export function configFrom(body, { current, rooms = [] } = {}) {
  const b = isObject(body) ? body : {};
  onlyKeys(b, ['preset', 'config'], 'The body');
  if (b.preset === undefined && b.config === undefined) {
    throw fail('Send { "preset": "<id>" } to start from an example formula, { "config": { ... } } to change fields of the one '
      + 'in force, or both.', 400);
  }
  let base = current;
  if (b.preset !== undefined) {
    const preset = presetById(b.preset);
    if (!preset) throw fail(`preset must be one of ${PRESETS.map((p) => p.id).join(', ')}.`, 400);
    base = preset.config;
  }
  const given = b.config === undefined ? {} : b.config;
  if (!isObject(given)) throw fail('config must be an object naming the fields to change.', 400);
  onlyKeys(given, CONFIG_KEYS, 'config');
  if (given.evidence !== undefined && !isObject(given.evidence)) {
    throw fail('evidence must be { digital, aiProvisional, humanReviewed }, each true or false.', 400);
  }
  const merged = {
    ...base,
    ...given,
    evidence: given.evidence === undefined ? base.evidence : { ...base.evidence, ...given.evidence },
  };
  const config = validateConfig(JSON.parse(JSON.stringify(merged)), { rooms: given.roomWeights !== undefined ? rooms : null });
  // A professor's review replaces the machine's mark on that answer, so a
  // formula counting unreviewed written marks but not reviewed ones would have
  // every review take an answer out of the count. Refused here, on a save, and
  // not in validateConfig: a formula already stored that way still reads (and
  // its methodology says what it does), so it never locks a class out of its
  // reports or out of saving a better one.
  if (config.evidence.aiProvisional && !config.evidence.humanReviewed) {
    throw fail('evidence.aiProvisional needs evidence.humanReviewed too: a professor\'s review replaces the machine\'s mark, so '
      + 'counting unreviewed written marks but not reviewed ones means every review would take an answer out of the count.', 400);
  }
  return config;
}

export const sameConfig = (a, b) => JSON.stringify(validateConfig(a)) === JSON.stringify(validateConfig(b));

/** The example a formula is exactly equal to, or null. */
export function matchingPreset(config) {
  const p = PRESETS.find((x) => sameConfig(x.config, config));
  return p ? { id: p.id, name: p.name } : null;
}

/**
 * The formula in force for a class, from its latest saved version (or null for
 * none, when the default example applies), with where it came from.
 */
export function formulaOf(stored) {
  if (!stored) {
    const p = presetById(DEFAULT_PRESET);
    return { source: 'example', version: 0, savedAt: null, savedBy: null, preset: { id: p.id, name: p.name }, config: validateConfig(p.config) };
  }
  let config;
  try {
    config = validateConfig(stored.config);
  } catch (err) {
    // Saved through the route, so this means a hand edit in the database.
    throw fail(`The attainment formula saved for this class (version ${stored.version}) cannot be read: ${err.message} `
      + 'Save the formula again.', 500);
  }
  return {
    source: 'saved',
    version: Number(stored.version),
    savedAt: stored.createdAt ?? null,
    savedBy: stored.createdBy ?? null,
    preset: matchingPreset(config),
    config,
  };
}

/**
 * The formula as a report prints it: its room weights with the rooms' codes.
 * `rooms` are ALL the class's rooms the caller may read, so a weighted room a
 * report's ?rooms= or dates leave out is still named, never taken for a deleted
 * one; `counted`, when given, are the rooms the report counts, and each weight
 * then says whether its room is among them (`inReport`).
 */
export function formulaView(formula, rooms = [], { counted = null } = {}) {
  const byId = new Map(rooms.map((r) => [idKey(r._id), r]));
  const inReport = counted ? new Set(counted.map((r) => idKey(r._id))) : null;
  return {
    ...formula,
    roomWeights: formula.config.roomWeights.map((w) => ({
      roomId: w.roomId, code: byId.get(w.roomId)?.code ?? null, weight: w.weight, found: byId.has(w.roomId),
      ...(inReport ? { inReport: inReport.has(w.roomId) } : {}),
    })),
  };
}

/* ---------------------------------------------------------- methodology -- */

const pct = (x) => `${Number((x * 100).toFixed(1))}%`;
const listed = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TYPE_PHRASE = {
  digital: 'digital answers marked automatically',
  humanReviewed: 'written answers a professor has reviewed',
  aiProvisional: 'written answers given only a provisional machine mark (a keyword match against the rubric, not AI) and '
    + 'not yet reviewed',
};

const SOURCES_SENTENCE = 'Every figure also splits its counted marks by who wrote the question: AI-generated (by the '
  + 'language model from the professor\'s material, approved by a professor before use), professor-written, or the offline '
  + 'template (a professor\'s own questions written before 19 November 2026 were stored the same way as the template\'s and '
  + 'are counted with them). This is where a question came from, not how its answer was marked, and it changes no mark.';

// Phase 5: class questions and the confidence tap, said in every report.
const CLASS_SENTENCE = 'A question the professor put to the whole class counts its first vote as a digital answer, except '
  + 'from a student who had already answered that question on their own in the same room and was shown its answer then, '
  + 'whose own answer counts instead; its re-vote after the class discussed it is shown under its own label and never '
  + 'counted. How sure a student said they were never changes a mark.';

const ROOMS_SENTENCE = 'Only rooms opened for this class are counted: a room opened without choosing this class is not in '
  + 'this report, whoever answered in it.';

const ROLLS_SENTENCE = 'A room\'s answers are its students\' by that room\'s attendance marks: an answer given under the '
  + 'roll number a student\'s mark there was made under is theirs, so correcting a roll number on the roster keeps their '
  + 'earlier answers theirs; any other answer is matched to the roster by its roll number as it stands now.';
// The order the methodology names them in: the longest phrase last, so a list
// of all three still reads as one.
const PHRASE_ORDER = ['digital', 'humanReviewed', 'aiProvisional'];

/**
 * What a review does to a mark, in a formula's words. A save may no longer
 * count unreviewed marks without reviewed ones (configFrom), but a formula
 * stored that way earlier still reads, and must not claim the opposite of what
 * it does.
 */
function reviewClause(config) {
  if (config.evidence.aiProvisional && !config.evidence.humanReviewed) {
    return '(a professor\'s review replaces the machine\'s mark, and this formula does not count reviewed marks, so an '
      + 'answer leaves the count once it is reviewed)';
  }
  return '(a professor\'s review replaces the machine\'s mark)';
}

/**
 * The day a formula was saved, in India's time, as every other day in a report
 * is (roomDay's rule): a formula saved at 01:30 in India is that day's, not the
 * day before's, as its UTC date would say.
 */
export function savedDay(savedAt) {
  return Number.isFinite(Date.parse(savedAt ?? '')) ? roomDay({ startedAt: savedAt }) : String(savedAt ?? '').slice(0, 10);
}

function formulaSentence(formula) {
  // A preset read on its own (GET /api/attainment/presets), not a class's formula.
  if (formula.source === 'preset') {
    return `Formula: "${formula.preset.name}", which ships with BloomLoop as an example to start from, not as an `
      + 'institutional standard.';
  }
  if (formula.source === 'example') {
    return `No formula has been saved for this class, so this report uses "${formula.preset.name}", which ships with `
      + 'BloomLoop as an example to start from, not as an institutional standard.';
  }
  const when = formula.savedAt ? `, saved ${savedDay(formula.savedAt)}` : '';
  if (formula.preset) {
    return `Formula: version ${formula.version} of this class's formula${when}, the same as the example "${formula.preset.name}" `
      + '(an example, not an institutional standard).';
  }
  return `Formula: version ${formula.version} of this class's own formula${when}.`;
}

/**
 * One room weight of formulaView in words: the room's code and weight, and
 * whether the room is outside this report. "Deleted" only for a room the class
 * no longer has.
 */
export function roomWeightText(w) {
  if (!w.found) return `a room since deleted x ${w.weight}`;
  return `${w.code} x ${w.weight}${w.inReport === false ? ' (a room not in this report)' : ''}`;
}

function roomsSentence(view) {
  if (!view.roomWeights.length) return 'Every room counts the same.';
  return `Rooms are weighted: ${listed(view.roomWeights.map(roomWeightText))}; every other room x 1.`;
}

function levelsSentence(config) {
  const parts = [...config.levels].reverse().map((l) => `level ${l.level} from ${pct(l.minShare)}`);
  const lowest = config.levels[0].minShare;
  if (lowest > 0) parts.push(`level 0 below ${pct(lowest)}`);
  return `The class's attainment level for an outcome comes from the share of the students counted who attained it: ${listed(parts)}.`;
}

/**
 * The methodology paragraph every attainment report and the formula itself
 * carry, written from the formula, so what a report says it did is what it did.
 * `rooms` are all the class's rooms the caller may read, which name the room
 * weights by code; `counted`, the rooms a report counts, when it is a report.
 */
export function methodologyText(formula, { rooms = [], counted: inReport = null, window = {} } = {}) {
  const c = formula.config;
  const counted = PHRASE_ORDER.filter((t) => c.evidence[t]);
  const left = PHRASE_ORDER.filter((t) => !c.evidence[t]);
  const attempts = c.attempts === 'best'
    ? 'counting only their best attempt at each question, across attempts and rooms (an attempt a professor reviewed '
      + 'always counts ahead of a provisional machine mark at the same question, whatever the two scores and whichever room '
      + 'each came from, since a professor\'s review replaces the machine\'s mark; a written answer\'s attempt followed by a '
      + 'retry is left out, since only a final attempt can be reviewed)'
    : 'counting final attempts only (an attempt followed by a retry is left out, and a question answered in two rooms '
      + 'counts in both)';
  return [
    formulaSentence(formula),
    `A student attains a course outcome when they score at least ${pct(c.studentThreshold)} of the marks on the questions `
      + `mapped to it, ${attempts}, from ${listed(counted.map((t) => TYPE_PHRASE[t]))}.`,
    ...(left.length ? [`${cap(listed(left.map((t) => TYPE_PHRASE[t])))} are shown but not counted.`] : []),
    `Students with fewer than ${plural(c.minAnswers, 'such answer')} on an outcome are shown as not enough evidence, never `
      + 'as not attained.',
    `Each answer is worth one mark, scored from 0 to 1 as it was marked ${reviewClause(c)} `
      + 'and weighted by its topic\'s weight in the outcome; a question mapped to an outcome directly weighs 1.',
    roomsSentence(formulaView(formula, rooms, { counted: inReport })),
    levelsSentence(c),
    'The students counted are those on the class roster now; removed students and roll numbers not on the roster are '
      + 'listed apart and not counted.',
    ROLLS_SENTENCE,
    SOURCES_SENTENCE,
    'Bloom attainment applies the same rules to each Bloom level in place of each outcome, over every counted answer at that '
      + 'level whether or not it is mapped to an outcome (topic weights do not apply; room weights do).',
    'Because each student is served different questions, a student\'s share is of the marks on the questions they were '
      + 'actually given.',
    'Polls are not marked and are counted only as a number. Teacher observations, wheel picks and hand tallies are reported '
      + 'in their own section and never enter a mark or move a level.',
    CLASS_SENTENCE,
    ROOMS_SENTENCE,
    'Rooms deleted from the live views are not counted; their evidence is kept in room archives.',
    ...[importedRoomsSentence(inReport ?? [], window)].filter(Boolean),
    'This is direct attainment from class evidence only. A college\'s final attainment may combine it with examinations or '
      + 'surveys by its own formula; this report does not.',
  ].join(' ');
}

/** The register's own paragraph: no thresholds, outcomes or room weights apply there. */
export function registerMethodologyText(formula, { counted: inReport = [], window = {} } = {}) {
  const c = formula.config;
  const counted = PHRASE_ORDER.filter((t) => c.evidence[t]);
  const left = PHRASE_ORDER.filter((t) => !c.evidence[t]);
  return [
    formulaSentence(formula),
    'Each cell is the marks a student obtained of the marks possible in one room: every question answered is one mark, '
      + `scored from 0 to 1 as it was marked ${reviewClause(c)}, `
      + `${c.attempts === 'best' ? 'counting only the best attempt at each question in that room (an attempt a professor '
        + 'reviewed always counts ahead of a provisional machine mark, whatever the two scores; a written answer\'s attempt '
        + 'followed by a retry is left out, since only a final attempt can be reviewed)' : 'counting final attempts only (an attempt followed by a retry is left out)'}.`,
    `Counted: ${listed(counted.map((t) => TYPE_PHRASE[t]))}.`,
    ...(left.length ? [`${cap(listed(left.map((t) => TYPE_PHRASE[t])))} are shown apart and not counted.`] : []),
    'Polls are counted only as a number.',
    CLASS_SENTENCE,
    'A student who answered nothing in a room has no marks there, not a zero: the attendance mark says whether they were '
      + 'present.',
    ROLLS_SENTENCE,
    ROOMS_SENTENCE,
    ...[importedRoomsSentence(inReport, window)].filter(Boolean),
    'Course outcomes, thresholds and room weights do not apply here; the attainment report applies them. Teacher records '
      + 'are not marks and are not in this register.',
  ].join(' ');
}

/* ------------------------------------------------------- exact numbers -- */

// One mark is 10^9 units: a score (thousandths) times a topic weight
// (thousandths) times a room weight (thousandths).
const UNIT = 1000n;
const MARK = 1000000000;
const milli = (x) => BigInt(Math.round(Number(x) * 1000));

/** The mark in force, 0 to 1: the score, else 1 or 0 from `correct`. */
export function scoreOf(answer) {
  const s = answer?.score;
  const n = s === null || s === undefined || s === '' ? NaN : Number(s);
  const v = Number.isFinite(n) ? n : (answer?.correct === true ? 1 : 0);
  return Math.min(1, Math.max(0, v));
}

const emptyMarks = () => ({ answers: 0, obtained: 0n, possible: 0n });
const typeMarks = () => Object.fromEntries(TYPE_IDS.map((t) => [t, emptyMarks()]));
/** Marks by evidence type, polls as a count, and the same marks again by question source and type. */
const emptyBreakdown = () => ({ ...typeMarks(), ungraded: 0, sources: Object.fromEntries(SOURCE_IDS.map((s) => [s, typeMarks()])) });

function addMarks(m, scoreMilli, weightUnits) {
  m.answers += 1;
  m.obtained += scoreMilli * weightUnits;
  m.possible += UNIT * weightUnits;
}

/** One graded answer into a breakdown: under its evidence type, and under its question's source. */
function addAnswer(b, a, scoreMilli, weightUnits) {
  const type = evidenceTypeOf(a);
  addMarks(b[type], scoreMilli, weightUnits);
  addMarks(b.sources[questionSourceOf(a)][type], scoreMilli, weightUnits);
}

const addInto = (to, from) => {
  to.answers += from.answers;
  to.obtained += from.obtained;
  to.possible += from.possible;
};

function sumBreakdowns(list) {
  const out = emptyBreakdown();
  for (const b of list) {
    if (!b) continue;
    for (const t of TYPE_IDS) {
      addInto(out[t], b[t]);
      for (const s of SOURCE_IDS) addInto(out.sources[s][t], b.sources[s][t]);
    }
    out.ungraded += b.ungraded;
  }
  return out;
}

/** The marks the formula counts: the evidence types it switches on, summed. */
function countedOf(b, config) {
  const out = emptyMarks();
  for (const t of TYPE_IDS) {
    if (!config.evidence[t]) continue;
    out.answers += b[t].answers;
    out.obtained += b[t].obtained;
    out.possible += b[t].possible;
  }
  return out;
}

// For display only; no state or level is decided from these (stateOf and
// classLevelOf compare the exact integers). A share is cut to 4 decimals and
// obtained marks to 3, both rounded DOWN, and possible marks rounded UP, so a
// printed figure never reads higher than it is: rounded to the nearest, a
// share of 59.996% printed as 60% beside "Not attained" under a 60% threshold.
const THOUSANDTH = BigInt(MARK / 1000);
const marksDown = (units) => Number(units / THOUSANDTH) / 1000;
const marksUp = (units) => Number((units + THOUSANDTH - 1n) / THOUSANDTH) / 1000;
const shareDown = (part, whole) => Number((BigInt(part) * 10000n) / BigInt(whole)) / 10000;
const shareNumber = (m) => (m.possible > 0n ? shareDown(m.obtained, m.possible) : null);
const marksView = (m) => ({ answers: m.answers, obtained: marksDown(m.obtained), possible: marksUp(m.possible) });

/**
 * A figure's evidence: marks and answers per type, whether the formula counts
 * it, and polls as a number; then `questionSources`, the counted marks again by
 * who wrote the question (all three add up to the counted types), each with how
 * many of its answers are of a type the formula does not count.
 */
function breakdownView(b, config) {
  const out = {};
  // `=== true`: a re-vote has no key in a formula, and is never counted.
  for (const t of TYPE_IDS) out[t] = { ...marksView(b[t]), counted: config.evidence[t] === true };
  out.ungraded = { answers: b.ungraded, counted: false };
  out.questionSources = Object.fromEntries(SOURCE_IDS.map((s) => [s, {
    ...marksView(countedOf(b.sources[s], config)),
    notCounted: TYPE_IDS.filter((t) => !config.evidence[t]).reduce((n, t) => n + b.sources[s][t].answers, 0),
  }]));
  return out;
}

/** The state of one student on one outcome or level, from their counted marks: exact, never rounded. */
export function stateOf(counted, config) {
  if (counted.answers < config.minAnswers || counted.possible <= 0n) return 'not-enough-evidence';
  return counted.obtained * UNIT >= milli(config.studentThreshold) * counted.possible ? 'attained' : 'not-attained';
}

/** The class's level from attained of counted students: the highest level whose share is reached, 0 below the first. */
export function classLevelOf(attained, counted, levels) {
  if (!counted) return null;
  let reached = 0;
  for (const l of levels) if (BigInt(attained) * UNIT >= milli(l.minShare) * BigInt(counted)) reached = l.level;
  return reached;
}

/* ------------------------------------------------------ which attempts -- */

/** A written answer: one the keyword marker or a professor marked, which the review queue can hold. */
const isWritten = (a) => evidenceTypeOf(a) === 'aiProvisional' || evidenceTypeOf(a) === 'humanReviewed';

/** A question's identity on an answer: its id, or the id its snapshot kept once the question was deleted. */
const questionKeyOf = (a) => idKey(a?.questionId ?? a?.questionSnapshot?.id) || `answer:${a?._id}`;
const later = (a, b) => String(a.answeredAt ?? '').localeCompare(String(b.answeredAt ?? '')) || String(a._id).localeCompare(String(b._id));

/**
 * The answer rows a report counts, by the formula's attempts rule. Polls (final
 * ones) are kept, to be counted as a number.
 *
 *   final   every final attempt; an attempt followed by a retry is set aside. A
 *           second final row for one student, question and room (possible only
 *           after a failed profile write) replaces the first, as item statistics
 *           read it
 *   best    for each student and question (and room, with `perRoom`), the one
 *           attempt with the highest mark among the types the formula counts, or
 *           among all when none of its attempts is of a counted type; a tie goes
 *           to a final attempt, then the later one. A professor-REVIEWED attempt
 *           always beats a provisional machine mark at the same question,
 *           whatever the two scores and whichever room each came from (the
 *           owner's decision of 19 Nov 2026): when the group holds a reviewed
 *           attempt, provisional ones are not candidates, since a professor's
 *           review replaces the machine's mark. A WRITTEN answer's attempt
 *           followed by a retry is set aside here too: the review queue holds
 *           final attempts only (routes/review.js refuses the rest, "it never
 *           counted"), so such a mark can never be checked, and counting it let
 *           an unreviewable provisional 0.5 beat the professor's 0.1 on the
 *           final attempt. An objective attempt is marked from the key, so a
 *           retried one still counts under best
 *
 * A class question's votes (Phase 5): a vote a phone changed, or one that came
 * after its round closed, was never the vote in force, and is set aside under
 * either rule. A re-vote after discussion (round 2) is kept apart, one per
 * student, question and room, the latest: it is shown under its own type and
 * never counted, so it never displaces, or competes with, an answer that is.
 * A first-round vote from a student who had already given a final answer of
 * their own to that question in the same room is set aside too (`knewKey`):
 * that answer's result showed them the key, and a question leaves the room's
 * bank once asked, so their own answer always came first. Their own answer is
 * the one that counts, under either rule.
 *
 * An answer the live loop kept and did not count (Phase 7: one that reached the
 * server after its room closed, not served to that phone before the close or
 * past the grace window, one past the room's cap on questions per student, or
 * a second answer to a question already marked; keptNotCounted in
 * services/offline.js) is set aside under either rule: it is
 * kept as a record, never as evidence.
 *
 * @returns {{ chosen: object[], chosenIds: Set<string>, setAside: number, knewKey: Set<string> }}
 */
export function chooseAnswers(answers = [], config, { perRoom = false } = {}) {
  // A drawing still waiting for its professor's mark (Batch 9) has no mark to
  // count, under any formula: it is set aside, and counts once reviewed.
  const groups = new Map();
  const polls = new Map();
  const revotes = new Map();
  const ownFinal = new Set();
  for (const a of answers) {
    if (!a.classQuestionId && a.final !== false && !a.ungraded) {
      ownFinal.add(`${a.sessionId}\u0000${a.rollNo}\u0000${questionKeyOf(a)}`);
    }
  }
  const knewKey = new Set();
  for (const a of answers) {
    const roll = String(a.rollNo);
    const room = String(a.sessionId);
    if (a.classQuestionId && a.final === false) continue;
    if (keptNotCounted(a)) continue;
    if (awaitingMark(a)) continue;
    if (evidenceTypeOf(a) === 'revote') {
      const k = `${room}\u0000${roll}\u0000${questionKeyOf(a)}`;
      if (!revotes.has(k) || later(a, revotes.get(k)) > 0) revotes.set(k, a);
      continue;
    }
    if (a.classQuestionId && !a.ungraded && ownFinal.has(`${room}\u0000${roll}\u0000${questionKeyOf(a)}`)) {
      knewKey.add(String(a._id));
      continue;
    }
    if (a.ungraded) {
      if (a.final === false) continue;
      const k = `${room}\u0000${roll}\u0000${questionKeyOf(a)}`;
      if (!polls.has(k) || later(a, polls.get(k)) > 0) polls.set(k, a);
      continue;
    }
    if (config.attempts === 'final') {
      if (a.final === false) continue;
      const k = `${room}\u0000${roll}\u0000${questionKeyOf(a)}`;
      if (!groups.has(k) || later(a, groups.get(k)) > 0) groups.set(k, a);
      continue;
    }
    if (a.final === false && isWritten(a)) continue;
    const k = `${perRoom ? room : ''}\u0000${roll}\u0000${questionKeyOf(a)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const better = (a, b) => (scoreOf(a) - scoreOf(b)) || ((a.final !== false ? 1 : 0) - (b.final !== false ? 1 : 0)) || later(a, b);
  const chosen = [...polls.values(), ...revotes.values()];
  for (const g of groups.values()) {
    if (!Array.isArray(g)) { chosen.push(g); continue; }
    const counted = g.filter((a) => config.evidence[evidenceTypeOf(a)]);
    const candidates = counted.length ? counted : g;
    const reviewed = candidates.some((a) => evidenceTypeOf(a) === 'humanReviewed');
    const pool = reviewed ? candidates.filter((a) => evidenceTypeOf(a) !== 'aiProvisional') : candidates;
    chosen.push(pool.reduce((best, a) => (better(a, best) > 0 ? a : best)));
  }
  chosen.sort(later);
  return { chosen, chosenIds: new Set(chosen.map((a) => String(a._id))), setAside: answers.length - chosen.length, knewKey };
}

/* --------------------------------------------------------- who is in it -- */

/**
 * The students a report lists, each labelled, in this order: the roster now
 * (roll order), then removed students with evidence (roll order), then roll
 * numbers no roster row holds (roll order). Never ordered by any mark.
 * `rolls`: roll numbers with evidence in the rooms; `typedNames`: what a phone
 * typed for a roll number not on the roster.
 */
export function studentsOf(roster = [], rolls = new Set(), typedNames = new Map()) {
  const sorted = [...roster].sort(byRoll);
  const held = new Set(sorted.map((s) => s.rollNo));
  const row = (s, status) => ({
    studentId: String(s._id), rollNo: s.rollNo, name: s.name, status, statusLabel: statusLabel(status),
    ...(status === 'removed' ? { removedAt: s.removedAt } : {}),
  });
  return [
    ...sorted.filter((s) => !s.removedAt).map((s) => row(s, 'active')),
    ...sorted.filter((s) => s.removedAt && rolls.has(s.rollNo)).map((s) => row(s, 'removed')),
    ...[...rolls].filter((r) => !held.has(r)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((rollNo) => ({
      studentId: null, rollNo, name: typedNames.get(rollNo) ?? '', status: 'not-on-roster', statusLabel: statusLabel('not-on-roster'),
    })),
  ];
}

/**
 * Whose answers they are, room by room (0021). `attendance` maps a room id to
 * its marks, each with the roster row it names and the roll number it was made
 * under. An answer given in a room under the roll number one of that room's
 * marks carries is that mark's student's, filed under their roll number on the
 * roster now: correcting a roll number keeps a student's earlier answers
 * theirs. Any other roll number, and every answer in a room whose marks carry
 * none (made before 0021), is matched to the roster as it stands now. Nothing
 * is guessed: a roll number two marks of one room carry is tied to neither.
 *
 * @returns {(roomId: string, rollNo: string) => string} the roll number to file it under
 */
export function rollResolver(roster = [], attendance = new Map()) {
  const byId = new Map(roster.map((s) => [String(s._id), s]));
  const tied = new Map(); // room id -> roll number on the mark -> roster row, or null when two marks carry it
  for (const [roomId, marks] of attendance) {
    const room = new Map();
    for (const m of marks ?? []) {
      const s = byId.get(String(m.classStudentId));
      if (!s || !m.rollNo) continue;
      const roll = String(m.rollNo);
      room.set(roll, room.has(roll) && room.get(roll) !== s ? null : s);
    }
    tied.set(idKey(roomId), room);
  }
  return (roomId, rollNo) => tied.get(idKey(roomId))?.get(String(rollNo))?.rollNo ?? String(rollNo);
}

/**
 * Answer rows with each one's roll number resolved (rollResolver). A row whose
 * roll number changed keeps the one it was given under as `givenAs`.
 */
function resolveRolls(answers, resolve) {
  return answers.map((a) => {
    const roll = resolve(a.sessionId, a.rollNo);
    return roll === String(a.rollNo) ? a : { ...a, rollNo: roll, givenAs: String(a.rollNo) };
  });
}

/**
 * A note for every roll number listed off the roster: its answers are apart and
 * uncounted, in which rooms, and, when a room's attendance mark was made under
 * it for a roster student (whose roll number has changed since), who that is.
 * Answers under it are theirs only in a room whose mark carries it; the rest
 * stay apart, since nothing else says whose they are. `answers` are resolved.
 */
function rollNotes(students, { roster = [], attendance = new Map(), rooms = [], answers = [] }) {
  const off = students.filter((s) => s.status === 'not-on-roster');
  if (!off.length) return [];
  const byId = new Map(roster.map((s) => [String(s._id), s]));
  const code = new Map(rooms.map((r) => [idKey(r._id), r.code]));
  const tiedTo = new Map(); // roll -> student id -> { student, rooms }
  for (const [roomId, marks] of attendance) {
    for (const m of marks ?? []) {
      const s = byId.get(String(m.classStudentId));
      if (!s || !m.rollNo || String(m.rollNo) === s.rollNo) continue;
      const roll = String(m.rollNo);
      if (!tiedTo.has(roll)) tiedTo.set(roll, new Map());
      const ties = tiedTo.get(roll);
      if (!ties.has(String(s._id))) ties.set(String(s._id), { student: s, rooms: [] });
      ties.get(String(s._id)).rooms.push(code.get(idKey(roomId)) ?? String(roomId));
    }
  }
  const leftIn = new Map(); // roll -> the codes of the rooms its answers are in
  for (const a of answers) {
    const roll = String(a.rollNo);
    if (!leftIn.has(roll)) leftIn.set(roll, new Set());
    leftIn.get(roll).add(code.get(idKey(a.sessionId)) ?? String(a.sessionId));
  }
  return off.map((s) => {
    const where = [...(leftIn.get(s.rollNo) ?? [])];
    const ties = [...(tiedTo.get(s.rollNo)?.values() ?? [])];
    const head = `${s.rollNo} is not on the class roster, so its answers${where.length ? ` in ${listed(where)}` : ''} are listed `
      + 'apart and counted in no class figure.';
    const tie = ties.length ? ` The attendance mark${ties.length === 1 && ties[0].rooms.length === 1 ? '' : 's'} in `
      + `${listed(ties.map((t) => `${listed(t.rooms)} ${t.rooms.length === 1 ? 'was' : 'were'} made under it for ${t.student.name} `
        + `(now ${t.student.rollNo}${t.student.removedAt ? ', removed from the roster' : ''})`))}; answers under it are theirs `
      + 'only in a room whose mark carries it.' : '';
    return {
      rollNo: s.rollNo,
      rooms: where,
      tiedTo: ties.map((t) => ({ studentId: String(t.student._id), rollNo: t.student.rollNo, name: t.student.name, rooms: t.rooms })),
      note: `${head}${tie}`,
    };
  });
}

/* --------------------------------------------------------- computation -- */

/**
 * The marks behind every figure, before any view: per student and outcome, and
 * per student and Bloom level, by evidence type; how every chosen answer was
 * resolved; and the class's answer totals. Pure.
 */
function tally({ rooms = [], answers = [], outcomes = [], links = [], overrides = [], questions = [], chapters = new Map(), config }) {
  const roomWeight = new Map(rooms.map((r) => [idKey(r._id), UNIT]));
  for (const w of config.roomWeights) if (roomWeight.has(w.roomId)) roomWeight.set(w.roomId, milli(w.weight));
  const index = outcomeIndex({ outcomes, links, overrides, questions });
  const known = new Set(outcomes.map((o) => String(o._id)));
  const { chosen, chosenIds, setAside, knewKey } = chooseAnswers(answers, config);

  const byOutcome = new Map(); // roll -> outcome id -> breakdown
  const byLevel = new Map(); // roll -> level -> breakdown
  const resolved = new Map(); // answer id -> resolution
  const cell = (map, roll, key) => {
    if (!map.has(roll)) map.set(roll, new Map());
    const m = map.get(roll);
    if (!m.has(key)) m.set(key, emptyBreakdown());
    return m.get(key);
  };
  const totals = {
    rows: answers.length, setAside, chosen: chosen.length, ungraded: 0, graded: 0,
    byType: Object.fromEntries(TYPE_IDS.map((t) => [t, 0])), mapped: 0, excluded: 0, unmapped: 0,
    bySource: Object.fromEntries(SOURCE_IDS.map((s) => [s, 0])),
  };
  const unmapped = new Map();

  for (const a of chosen) {
    const type = evidenceTypeOf(a);
    const res = resolveAnswer(a, index);
    resolved.set(String(a._id), res);
    const roll = String(a.rollNo);
    const level = LEVELS.includes(a.bloom) ? a.bloom : null;
    const reaches = res.outcomes.filter((o) => known.has(o.id));
    if (type === 'ungraded') {
      totals.ungraded += 1;
      for (const o of reaches) cell(byOutcome, roll, o.id).ungraded += 1;
      if (level) cell(byLevel, roll, level).ungraded += 1;
      continue;
    }
    totals.graded += 1;
    totals.byType[type] += 1;
    totals.bySource[questionSourceOf(a)] += 1;
    if (res.via === VIA.excluded) totals.excluded += 1;
    else if (!reaches.length) {
      totals.unmapped += 1;
      const slot = `${idKey(res.contentId)}\u0000${topicKey(res.topic)}`;
      if (!unmapped.has(slot)) {
        const ch = chapters.get(idKey(res.contentId));
        unmapped.set(slot, {
          contentId: res.contentId, chapter: ch?.title ?? null, topic: res.topic,
          inChapter: Boolean(res.topic && ch?.keys?.has(topicKey(res.topic))), answers: 0,
        });
      }
      unmapped.get(slot).answers += 1;
    } else totals.mapped += 1;

    const s = milli(scoreOf(a));
    const rw = roomWeight.get(idKey(a.sessionId)) ?? UNIT;
    for (const o of reaches) addAnswer(cell(byOutcome, roll, o.id), a, s, milli(o.weight) * rw);
    if (level) addAnswer(cell(byLevel, roll, level), a, s, UNIT * rw);
  }
  return {
    chosen, chosenIds, knewKey, resolved, byOutcome, byLevel, totals,
    unmapped: [...unmapped.values()].sort((x, y) => y.answers - x.answers
      || String(x.chapter ?? '').localeCompare(String(y.chapter ?? '')) || String(x.topic).localeCompare(String(y.topic))),
  };
}

/** One student on one outcome or Bloom group: their marks by type, what counted, and the state. */
function studentCell(b, config) {
  const breakdown = b ?? emptyBreakdown();
  const counted = countedOf(breakdown, config);
  const state = stateOf(counted, config);
  return {
    state,
    stateLabel: stateLabel(state),
    answers: counted.answers,
    obtained: marksDown(counted.obtained),
    possible: marksUp(counted.possible),
    share: shareNumber(counted),
    marks: breakdownView(breakdown, config),
  };
}

/** A student's marks over a group of Bloom levels (one level, or a level band). */
const bloomCell = (map, roll, levels) => sumBreakdowns(levels.map((l) => map.get(roll)?.get(l)));

/**
 * One class figure (an outcome or a Bloom group) over the students: the roster's
 * counts by state, the share attained and the level, the evidence the share
 * rests on, and the evidence outside it.
 *
 * `marks` are the answers of the students counted (attained or not attained)
 * and nobody else's: a roster student with too few counted answers is not in
 * the share, so their answers do not support it, and counting them in made a
 * figure look better supported than it was. Theirs are in
 * `outside.notEnoughEvidence`, with a breakdown, since one more answer or one
 * review can bring such a student into the share.
 */
function classFigure(students, cellOf, config) {
  const active = students.filter((s) => s.status === 'active');
  const cells = active.map((s) => cellOf(s.rollNo) ?? emptyBreakdown());
  const states = cells.map((b) => stateOf(countedOf(b, config), config));
  const attained = states.filter((x) => x === 'attained').length;
  const notAttained = states.filter((x) => x === 'not-attained').length;
  const counted = attained + notAttained;
  const outside = (status) => {
    const list = students.filter((s) => s.status === status).map((s) => countedOf(cellOf(s.rollNo) ?? emptyBreakdown(), config));
    return { students: list.filter((m) => m.answers > 0).length, answers: list.reduce((n, m) => n + m.answers, 0) };
  };
  const short = cells.filter((_, i) => states[i] === 'not-enough-evidence');
  const shortCounted = short.map((b) => countedOf(b, config));
  return {
    students: {
      roster: active.length,
      counted,
      attained,
      notAttained,
      notEnoughEvidence: active.length - counted,
      withNoAnswers: cells.filter((b) => !countedOf(b, config).answers).length,
    },
    share: counted ? shareDown(attained, counted) : null,
    attainmentLevel: classLevelOf(attained, counted, config.levels),
    marks: breakdownView(sumBreakdowns(cells.filter((_, i) => states[i] !== 'not-enough-evidence')), config),
    outside: {
      notEnoughEvidence: {
        students: shortCounted.filter((m) => m.answers > 0).length,
        answers: shortCounted.reduce((n, m) => n + m.answers, 0),
        marks: breakdownView(sumBreakdowns(short), config),
      },
      removed: outside('removed'),
      notOnRoster: outside('not-on-roster'),
    },
  };
}

const TYPE_SHORT = { digital: 'digital', aiProvisional: 'provisional written', humanReviewed: 'reviewed written', revote: 're-vote' };

/** "Rests on 42 counted answers from the 20 students counted: 30 digital and 12 reviewed written." */
function restsOn(marks, students) {
  const on = TYPE_IDS.filter((t) => marks[t].counted && marks[t].answers);
  const n = on.reduce((s, t) => s + marks[t].answers, 0);
  return `Rests on ${plural(n, 'counted answer')} from the ${plural(students, 'student')} counted`
    + `${on.length ? `: ${listed(on.map((t) => `${marks[t].answers} ${TYPE_SHORT[t]}`))}` : ''}.`;
}

/** "5 provisional written answers are shown but not counted.", over the given breakdowns, or ''. */
function shownNotCounted(list) {
  const off = TYPE_IDS.filter((t) => !list[0][t].counted && list.some((m) => m[t].answers));
  if (!off.length) return '';
  const m = off.reduce((s, t) => s + list.reduce((n, b) => n + b[t].answers, 0), 0);
  return ` ${plural(m, `${listed(off.map((t) => TYPE_SHORT[t]))} answer`)} ${m === 1 ? 'is' : 'are'} shown but not counted.`;
}

function figureSummary(name, f, config) {
  const s = f.students;
  const ne = f.outside.notEnoughEvidence;
  let head;
  // The share as it is shown everywhere (4 decimals, rounded down), so 2 of 3
  // reads 66.66% and never 66.7% beside a level that needs 66.7%.
  if (s.counted) head = `${s.attained} of ${plural(s.counted, 'student')} counted attained ${name} (${Math.round(f.share * 10000) / 100}%): level ${f.attainmentLevel}.`;
  else if (!s.roster) head = `The class roster is empty, so ${name} has no class level: add the students (a CSV file imports them).`;
  else head = `No student on the roster has ${plural(config.minAnswers, 'counted answer')} on ${name} yet, so it has no class level.`;
  const short = s.notEnoughEvidence && s.counted ? ` ${s.notEnoughEvidence} on the roster ${s.notEnoughEvidence === 1 ? 'has' : 'have'} `
    + `not enough evidence (fewer than ${config.minAnswers} counted answers).` : '';
  const rests = s.counted || !s.roster ? ` ${restsOn(f.marks, s.counted)}` : '';
  const apart = ne.answers ? ` Outside the share: ${plural(ne.answers, 'counted answer')} from ${plural(ne.students, 'student')} `
    + 'with not enough evidence.' : '';
  return `${head}${short}${rests}${apart}${shownNotCounted([f.marks, ne.marks])}`;
}

const roomView = (r, config) => {
  const w = config.roomWeights.find((x) => x.roomId === idKey(r._id));
  return {
    roomId: String(r._id), code: r.code, title: r.title ?? '', day: roomDay(r), startedAt: r.startedAt ?? null,
    status: r.status, weight: w ? w.weight : 1,
    // A room imported from a file laptop mode saved (Phase 7): said on the
    // room, so no report presents it as one this server ran.
    ...(r.importedFrom ? { importedFrom: r.importedFrom } : {}),
  };
};

/**
 * What a report says about rooms imported from files laptop mode saved
 * (Phase 7), or null when it counts none and left none out. The file was
 * checked for its shape, not for being unchanged since the laptop saved it, so
 * the report says so wherever it is read or printed (its methodology), and
 * names the rooms. `window.imported` 'leave-out' is the report asked to leave
 * them out.
 */
export function importedRoomsSentence(counted = [], window = {}) {
  if (window.imported === 'leave-out') {
    return 'Rooms imported from files saved by laptop mode are left out of this report.';
  }
  const codes = counted.filter((r) => r.importedFrom).map((r) => r.code);
  if (!codes.length) return null;
  return `${codes.length === 1 ? `One room counted here (${codes[0]}) was` : `${codes.length} rooms counted here (${listed(codes)}) were`} `
    + 'imported from a file saved by laptop mode. BloomLoop checked that each such file is a room it can read, not that it '
    + 'is unchanged since the laptop saved it; a report can leave these rooms out.';
}

/* ------------------------------------------------------ teacher records -- */

const recordKey = (classStudentId, rollNo) => (classStudentId ? `s:${classStudentId}` : `r:${rollNo}`);

/**
 * The teacher records of the rooms counted, summarised beside the marks and
 * never inside one: observations in force per student and day, by kind; wheel
 * picks by how the student responded; questions asked aloud with their hands;
 * activities by kind. `byStudent` maps `s:<roster id>` or `r:<roll>` to that
 * student's observation and pick counts.
 */
export function recordsSummary({ observations = [], picks = [], tallies = [], activities = [] } = {}) {
  const obsKinds = OBSERVATION_KINDS.map((k) => k.id);
  const pickIds = ['pending', ...PICK_STATUSES.map((s) => s.id)];
  const zero = (ids) => Object.fromEntries(ids.map((id) => [id, 0]));
  const byStudent = new Map();
  const student = (key) => {
    if (!byStudent.has(key)) byStudent.set(key, { observations: zero(obsKinds), picks: zero(pickIds) });
    return byStudent.get(key);
  };

  // One mark per student per day: the latest event of that day, if it set one.
  const days = new Map();
  for (const e of observations) {
    const k = `${slotKey(e)}\u0000${e.day}`;
    if (!days.has(k)) days.set(k, []);
    days.get(k).push(e);
  }
  const obsCounts = zero(obsKinds);
  for (const events of days.values()) {
    const current = currentObservation(events);
    if (!current || !obsKinds.includes(current.kind)) continue;
    obsCounts[current.kind] += 1;
    student(recordKey(current.classStudentId, current.rollNo)).observations[current.kind] += 1;
  }
  const pickCounts = zero(pickIds);
  for (const p of picks) {
    const status = pickIds.includes(p.status) ? p.status : 'pending';
    pickCounts[status] += 1;
    student(recordKey(p.classStudentId, p.rollNo)).picks[status] += 1;
  }
  const hands = tallies.reduce((n, t) => n + (Array.isArray(t.counts) ? t.counts.reduce((a, c) => a + (Number(c) || 0), 0) : 0), 0);
  const actCounts = zero(ACTIVITY_KINDS.map((k) => k.id));
  for (const a of activities) if (a.kind in actCounts) actCounts[a.kind] += 1;
  return {
    label: 'Teacher records: reported beside the marks, never part of one',
    observations: { kinds: OBSERVATION_KINDS, counts: obsCounts, studentDays: Object.values(obsCounts).reduce((a, b) => a + b, 0) },
    picks: {
      statuses: [{ id: 'pending', label: 'Pending' }, ...PICK_STATUSES], counts: pickCounts, total: picks.length,
      answeredAloud: pickCounts.answered,
    },
    tallies: { questions: tallies.length, hands },
    activities: { kinds: ACTIVITY_KINDS, counts: actCounts, total: activities.length },
    note: 'Counted from the rooms in this report. They never enter a mark, a share, a state or a level (decision 3), and '
      + 'the professor\'s observations are private to staff.',
    byStudent,
    // A student with no record: zeros, so a screen never meets a missing count.
    none: { observations: zero(obsKinds), picks: zero(pickIds) },
  };
}

/* --------------------------------------------------------- the reports -- */

const DEFINITIONS = Object.freeze({
  evidenceTypes: 'Every figure is split by evidence type (digital, aiProvisional, humanReviewed, revote), each with its answers '
    + 'and marks and whether the formula counts it; polls (ungraded) are a count only. aiProvisional is a provisional '
    + 'machine mark: the keyword marker\'s match of the rubric\'s words, not AI, until a professor reviews it (the key keeps '
    + 'its stored name). revote is a class question\'s second vote, after the class discussed it: shown, never counted.',
  questionSources: 'marks.questionSources splits the same counted marks by who wrote the question: aiGenerated (the '
    + 'language model, from the professor\'s material, approved before use; question_source "llm"), professorWritten '
    + '("teacher", a question a professor wrote in the bank since 19 Nov 2026) and offlineTemplate ("fallback": the offline '
    + 'template, and a professor\'s own questions written before then, which were stored the same way and cannot be told '
    + 'apart with certainty). The three add up to the counted types; notCounted is each one\'s answers of a type the '
    + 'formula does not count. It moves no mark.',
  marks: 'One answer is one mark, scored 0 to 1 as marked, times its topic\'s weight in the outcome (1 for a question mapped '
    + 'directly) and its room\'s weight. For display, obtained is rounded down and possible up to 3 decimals, and every '
    + 'share down to 4, so a printed figure never reads higher than it is; states and levels are decided exactly.',
  states: 'attained: the counted share reaches studentThreshold, from at least minAnswers counted answers; not-attained: '
    + 'it does not; not-enough-evidence: fewer than minAnswers counted answers.',
  classFigure: 'counted: students on the roster now who are attained or not attained; share: attained / counted; '
    + 'attainmentLevel: the formula\'s levels applied to that share (null with nobody counted). Removed students and roll '
    + 'numbers not on the roster are in `outside`, never counted.',
  mapping: 'An outcome\'s topics: the chapter topics mapped to it now, with their weights (inChapter: whether the chapter '
    + 'still lists the topic); directQuestions: how many questions an override maps straight to it.',
  answers: 'rows: every attempt stored in the rooms counted; setAside: attempts the attempts rule leaves out; graded: the '
    + 'answers chosen, split by type and into mapped, excluded (an override keeps the question out of every outcome) and '
    + 'unmapped (no outcome is mapped to its topic), which add up to graded; ungraded: polls.',
  bloom: 'The same rules per Bloom level (levels) and per decision 6\'s three level bands (bands), over every counted answer '
    + 'at that level, mapped to an outcome or not.',
  rooms: 'The rooms opened for this class that the caller may read, opened from `from` to `to` (India\'s days) and among '
    + '`rooms` when given; oldest first. Only rooms opened for this class are counted: a room opened without choosing it is '
    + 'not, whoever answered in it. Deleted rooms are not counted.',
  order: 'Students in roll-number order: the roster, then removed students with evidence, then roll numbers not on the roster.',
  rolls: 'A room\'s answers are filed under the roster student whose attendance mark in that room was made under the roll '
    + 'number they were given under (0021), so a corrected roll number keeps them; otherwise under the roll number as the '
    + 'roster holds it now. rollNotes (and `note` on each row off the roster) says, for every roll number not on the '
    + 'roster, that its answers are apart and uncounted, and which roster student any room\'s mark was made under it for.',
});

const classSummary = (cls) => ({ id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' });

/** A typed name per roll number off the roster, from the rooms' profiles (the latest room's wins). */
function typedNames(profiles = new Map(), rooms = []) {
  const out = new Map();
  for (const r of rooms) for (const p of profiles.get(String(r._id)) ?? []) if (p.name) out.set(String(p.rollNo), String(p.name));
  return out;
}

/**
 * The class's attainment report. Pure: everything is passed in.
 *   rooms      the rooms counted (roomsWindow), oldest first
 *   classRooms all the class's rooms the caller may read (rooms when left out),
 *              so a weighted room the window leaves out is named as such
 *   answers    every answer row of those rooms, all attempts
 *   roster     the class's roster, removed students included
 *   outcomes, links, overrides   readOutcomeMap; questions: the chapters' banks
 *   chapters   chapterMap, for naming what is unmapped
 *   records    { observations, picks, tallies, activities } of those rooms
 *   profiles   Map room id -> profiles, for names typed off the roster
 *   attendance Map room id -> attendance marks, whose roll numbers say whose
 *              each room's answers are (rollResolver)
 */
export function classAttainment({
  cls, rooms = [], classRooms = rooms, window = {}, formula, answers: given = [], roster = [], outcomes = [], links = [],
  overrides = [], questions = [], chapters = new Map(), records = {}, profiles = new Map(), attendance = new Map(),
}) {
  const config = formula.config;
  const answers = resolveRolls(given, rollResolver(roster, attendance));
  const t = tally({ rooms, answers, outcomes, links, overrides, questions, chapters, config });
  const rolls = new Set(t.chosen.map((a) => String(a.rollNo)));
  const students = studentsOf(roster, rolls, typedNames(profiles, rooms));
  const notes = rollNotes(students, { roster, attendance, rooms, answers });
  const ordered = inOrder(outcomes);
  const recs = recordsSummary(records);

  const outcomeRows = ordered.map((o) => {
    const id = String(o._id);
    const f = classFigure(students, (roll) => t.byOutcome.get(roll)?.get(id), config);
    return {
      id, code: o.code, statement: o.statement, targetLevel: o.targetLevel ?? null, archived: Boolean(o.archivedAt),
      // What it is mapped to, so an exported or printed sheet says what each
      // outcome's figure was measured on.
      topics: linkViews(o._id, links, chapters),
      directQuestions: overrides.filter((ov) => !ov.excluded && (ov.outcomeIds ?? []).map(String).includes(id)).length,
      ...f, summary: figureSummary(o.code, f, config),
    };
  });
  const bloomFigure = (levelsOf) => classFigure(students, (roll) => bloomCell(t.byLevel, roll, levelsOf), config);
  const levels = LEVELS.map((level) => {
    const f = bloomFigure([level]);
    return { level, label: LABEL[level], ...f, summary: figureSummary(LABEL[level], f, config) };
  });
  const bands = LEVEL_BANDS.map((b) => {
    const f = bloomFigure(b.levels);
    return { id: b.id, label: b.label, levels: b.levels, ...f, summary: figureSummary(b.label, f, config) };
  });

  const studentRows = students.map((s) => {
    const rec = recs.byStudent.get(s.studentId ? `s:${s.studentId}` : `r:${s.rollNo}`) ?? recs.byStudent.get(`r:${s.rollNo}`);
    return {
      ...s,
      ...(s.status === 'not-on-roster' ? { note: notes.find((x) => x.rollNo === s.rollNo)?.note ?? '' } : {}),
      outcomes: ordered.map((o) => ({ id: String(o._id), code: o.code, ...studentCell(t.byOutcome.get(s.rollNo)?.get(String(o._id)), config) })),
      bloom: {
        levels: LEVELS.map((l) => ({ level: l, label: LABEL[l], ...studentCell(t.byLevel.get(s.rollNo)?.get(l), config) })),
        bands: LEVEL_BANDS.map((b) => ({ id: b.id, label: b.label, ...studentCell(bloomCell(t.byLevel, s.rollNo, b.levels), config) })),
      },
      records: rec ?? recs.none,
    };
  });
  const { byStudent, none, ...teacherRecords } = recs;

  return {
    class: classSummary(cls),
    window: { from: window.from ?? null, to: window.to ?? null, rooms: window.rooms ?? null, ...(window.imported ? { imported: window.imported } : {}) },
    rooms: rooms.map((r) => roomView(r, config)),
    formula: formulaView(formula, classRooms, { counted: rooms }),
    methodology: methodologyText(formula, { rooms: classRooms, counted: rooms, window }),
    evidenceTypes: EVIDENCE_TYPES,
    states: STATES,
    answers: t.totals,
    unmapped: t.unmapped,
    outcomes: outcomeRows,
    bloom: { levels, bands },
    students: studentRows,
    rollNotes: notes,
    questionSources: QUESTION_SOURCES,
    teacherRecords,
    definitions: DEFINITIONS,
    privacy: ATTAINMENT_PRIVACY,
  };
}

/** Why an answer did or did not count, in words, for the student report. */
function answerNote(a, { chosen, type, config, res, known, knewKey = new Set() }) {
  if (!chosen) {
    if (knewKey.has(String(a._id))) {
      return 'Not counted: a class question vote from a student who had already answered this question on their own in '
        + 'this room, and was shown its answer then. Their own answer counts instead.';
    }
    if (a.classQuestionId && a.final === false) {
      return 'Not counted: a class question vote that was changed afterwards, or that came after its round closed.';
    }
    if (awaitingMark(a)) {
      return 'Not counted yet: a drawing, which the machine never marks. It counts once a professor has marked it in the review queue.';
    }
    if (keptNotCounted(a)) {
      if (a.detail === ANSWERED_AGAIN_DETAIL) {
        return 'Not counted: the student had already been marked on this question when this answer arrived.';
      }
      return a.detail === OVER_CAP_DETAIL
        ? 'Not counted: it arrived after the student had answered as many questions as the room asks each student.'
        : 'Not counted: it reached the server after the room closed, and either the question had not been given to '
          + 'this student before the close or it came after the time allowed for answers saved on a phone.';
    }
    if (a.final === false && config.attempts === 'final') return 'Not counted: an attempt followed by a retry.';
    if (a.final === false && isWritten(a)) {
      return 'Not counted: a written attempt followed by a retry. Only a final attempt can be reviewed by a professor, so '
        + 'only final written attempts count.';
    }
    if (config.attempts === 'best' && type === 'aiProvisional') {
      return 'Not counted: another attempt at the same question counts instead, either a better one or one a professor '
        + 'reviewed, which always counts ahead of a provisional machine mark.';
    }
    if (config.attempts === 'best') return 'Not counted: a better attempt at the same question counts instead.';
    return 'Not counted: a later final answer to the same question in this room replaced it.';
  }
  if (type === 'ungraded') return 'A poll: not marked, counted only as a number.';
  if (type === 'revote') return 'Shown, not counted: a re-vote after the class discussed the question is never counted.';
  const reaches = res.outcomes.filter((o) => known.has(o.id));
  const where = res.via === VIA.excluded ? ' An override keeps its question out of every course outcome.'
    : reaches.length ? '' : ` No course outcome is mapped to its topic${res.topic ? ` ("${res.topic}")` : ''}.`;
  if (!config.evidence[type]) return `Shown, not counted: the formula does not count ${EVIDENCE_TYPES.find((x) => x.id === type).label.toLowerCase()}.${where}`;
  return `Counted.${where}`;
}

/**
 * One student's attainment, with every answer behind it. `student` is a roster
 * row of the class (active or removed). Pure, like classAttainment; the answers
 * are the teacher's view (answerItem), each with its evidence type, whether it
 * counted and why, and the outcomes it reached.
 */
export function studentAttainment({
  cls, student, rooms = [], classRooms = rooms, window = {}, formula, answers = [], roster = [student], outcomes = [], links = [],
  overrides = [], questions = [], chapters = new Map(), records = {}, attendance = new Map(), practised = new Map(),
}) {
  const config = formula.config;
  // Theirs by each room's attendance marks, as in the class report (rollResolver).
  const mine = resolveRolls(answers, rollResolver(roster, attendance)).filter((a) => String(a.rollNo) === student.rollNo);
  const t = tally({ rooms, answers: mine, outcomes, links, overrides, questions, chapters, config });
  const ordered = inOrder(outcomes);
  const known = new Set(outcomes.map((o) => String(o._id)));
  const code = new Map(outcomes.map((o) => [String(o._id), o.code]));
  const roomOf = new Map(rooms.map((r) => [idKey(r._id), r]));
  const index = outcomeIndex({ outcomes, links, overrides, questions });

  const status = student.removedAt ? 'removed' : 'active';
  const own = (list) => list.filter((r) => (r.classStudentId ? String(r.classStudentId) === String(student._id) : r.rollNo === student.rollNo));
  const obs = own(records.observations ?? []);
  const days = new Map();
  for (const e of obs) {
    if (!days.has(e.day)) days.set(e.day, []);
    days.get(e.day).push(e);
  }
  const observationDays = [...days.keys()].sort().map((day) => {
    const current = currentObservation(days.get(day));
    return current ? { day, kind: current.kind, label: OBSERVATION_KINDS.find((k) => k.id === current.kind)?.label ?? current.kind, note: current.note ?? '' } : null;
  }).filter(Boolean);
  const picks = own(records.picks ?? []).map((p) => ({
    room: roomOf.get(idKey(p.sessionId))?.code ?? null, round: p.round, ask: p.ask ?? null, status: p.status ?? 'pending',
    pickedAt: p.pickedAt ?? null,
  }));
  const recs = recordsSummary({ observations: obs, picks: own(records.picks ?? []) });

  return {
    class: classSummary(cls),
    student: { ...studentView(student), status, statusLabel: statusLabel(status) },
    window: { from: window.from ?? null, to: window.to ?? null, rooms: window.rooms ?? null, ...(window.imported ? { imported: window.imported } : {}) },
    rooms: rooms.map((r) => roomView(r, config)),
    formula: formulaView(formula, classRooms, { counted: rooms }),
    methodology: methodologyText(formula, { rooms: classRooms, counted: rooms, window }),
    evidenceTypes: EVIDENCE_TYPES,
    questionSources: QUESTION_SOURCES,
    states: STATES,
    outcomes: ordered.map((o) => ({
      id: String(o._id), code: o.code, statement: o.statement, archived: Boolean(o.archivedAt),
      ...studentCell(t.byOutcome.get(student.rollNo)?.get(String(o._id)), config),
    })),
    bloom: {
      levels: LEVELS.map((l) => ({ level: l, label: LABEL[l], ...studentCell(t.byLevel.get(student.rollNo)?.get(l), config) })),
      bands: LEVEL_BANDS.map((b) => ({ id: b.id, label: b.label, ...studentCell(bloomCell(t.byLevel, student.rollNo, b.levels), config) })),
    },
    answers: mine.map((a) => {
      const chosen = t.chosenIds.has(String(a._id));
      const type = evidenceTypeOf(a);
      const res = t.resolved.get(String(a._id)) ?? resolveAnswer(a, index);
      return {
        ...answerItem(a, roomOf.get(idKey(a.sessionId)), { name: student.name }),
        ...(a.givenAs ? { givenAs: a.givenAs } : {}),
        evidenceType: type,
        questionSourceType: questionSourceOf(a),
        chosen,
        counts: chosen && type !== 'ungraded' && config.evidence[type] === true,
        note: answerNote(a, { chosen, type, config, res, known, knewKey: t.knewKey }) + (a.givenAs ? ` Given under roll number ${a.givenAs}, `
          + 'which this room\'s attendance mark for the student was made under.' : ''),
        via: res.via,
        outcomes: res.outcomes.filter((o) => known.has(o.id)).map((o) => ({ id: o.id, code: code.get(o.id), weight: o.weight })),
        // Batch 8: an answer to a question the student had practised in the hub
        // first. It counts as usual; the note says so (services/bankShare.js).
        ...(practised.has(String(a._id)) ? { practisedInHub: true, practisedNote: PRACTISED_NOTE } : {}),
      };
    }),
    answerCounts: t.totals,
    teacherRecords: {
      label: 'Teacher records: reported beside the marks, never part of one',
      observations: { counts: recs.observations.counts, days: observationDays },
      picks: { counts: recs.picks.counts, list: picks },
      note: recs.note,
    },
    definitions: DEFINITIONS,
    privacy: ATTAINMENT_PRIVACY,
  };
}

/**
 * The marks register: per student (roll order) and room (date order), the
 * marks obtained of possible, by evidence type, with the room's attendance mark,
 * and a total. Pure. `attendance` and `profiles` map a room id to its marks and
 * its phones. The attempts rule applies within each room; outcomes, thresholds
 * and room weights do not.
 */
export function marksRegister({
  cls, rooms = [], classRooms = rooms, window = {}, formula, answers = [], roster = [], attendance = new Map(), profiles = new Map(),
}) {
  const config = formula.config;
  // Whose answers and phones they are, by each room's attendance marks (rollResolver).
  const resolve = rollResolver(roster, attendance);
  const resolved = resolveRolls(answers, resolve);
  const { chosen, setAside } = chooseAnswers(resolved, config, { perRoom: true });
  const cells = new Map(); // roll -> room id -> breakdown
  const cell = (roll, room) => {
    if (!cells.has(roll)) cells.set(roll, new Map());
    if (!cells.get(roll).has(room)) cells.get(roll).set(room, emptyBreakdown());
    return cells.get(roll).get(room);
  };
  for (const a of chosen) {
    const b = cell(String(a.rollNo), idKey(a.sessionId));
    if (evidenceTypeOf(a) === 'ungraded') b.ungraded += 1;
    else addAnswer(b, a, milli(scoreOf(a)), UNIT * UNIT);
  }

  // Who is in the register: anyone with an answer, a mark or a phone in a room.
  const joined = new Map(rooms.map((r) => [idKey(r._id), new Set((profiles.get(String(r._id)) ?? []).map((p) => resolve(r._id, p.rollNo)))]));
  const marks = new Map(rooms.map((r) => [idKey(r._id), new Map((attendance.get(String(r._id)) ?? []).map((m) => [String(m.classStudentId), m]))]));
  const rolls = new Set([...cells.keys(), ...[...joined.values()].flatMap((s) => [...s])]);
  const marked = new Set([...marks.values()].flatMap((m) => [...m.keys()]));
  for (const s of roster) if (s.removedAt && marked.has(String(s._id))) rolls.add(s.rollNo);
  const students = studentsOf(roster, rolls, typedNames(profiles, rooms));
  const notes = rollNotes(students, { roster, attendance, rooms, answers: resolved });

  const rows = students.map((s) => {
    const presence = { present: 0, late: 0, absent: 0, unmarked: 0 };
    const perRoom = rooms.map((r) => cells.get(s.rollNo)?.get(idKey(r._id)) ?? emptyBreakdown());
    const totals = sumBreakdowns(perRoom);
    const roomCells = rooms.map((r, i) => {
      const rid = idKey(r._id);
      const b = perRoom[i];
      const m = s.studentId ? marks.get(rid)?.get(s.studentId) : null;
      const status = s.studentId ? (m?.status ?? 'unmarked') : null;
      if (status) presence[status] += 1;
      const counted = countedOf(b, config);
      return {
        code: r.code,
        attendance: status,
        joined: joined.get(rid)?.has(s.rollNo) ?? false,
        answered: TYPE_IDS.some((ty) => b[ty].answers) || b.ungraded > 0,
        counted: { ...marksView(counted), share: shareNumber(counted) },
        marks: breakdownView(b, config),
      };
    });
    const counted = countedOf(totals, config);
    return {
      ...s,
      ...(s.status === 'not-on-roster' ? { note: notes.find((x) => x.rollNo === s.rollNo)?.note ?? '' } : {}),
      rooms: roomCells,
      total: {
        counted: { ...marksView(counted), share: shareNumber(counted) },
        marks: breakdownView(totals, config),
        attendance: s.studentId ? presence : null,
      },
    };
  });

  return {
    class: classSummary(cls),
    window: { from: window.from ?? null, to: window.to ?? null, rooms: window.rooms ?? null, ...(window.imported ? { imported: window.imported } : {}) },
    rooms: rooms.map((r) => roomView(r, config)),
    formula: formulaView(formula, classRooms, { counted: rooms }),
    methodology: registerMethodologyText(formula, { counted: rooms, window }),
    evidenceTypes: EVIDENCE_TYPES,
    answers: { rows: answers.length, setAside, chosen: chosen.length },
    students: rows,
    rollNotes: notes,
    questionSources: QUESTION_SOURCES,
    definitions: {
      cell: 'counted: the marks the formula counts, obtained of possible, and their share; marks: every evidence type, '
        + 'counted or not, and polls as a number. One question is one mark. answered: whether the student gave any answer '
        + 'in that room; attendance: present, late, absent or unmarked for a roster student, null off the roster; joined: '
        + 'a phone joined with that roll number.',
      absent: 'No marks is not a zero: a student who answered nothing in a room has 0 of 0 there, and the attendance mark '
        + 'says why.',
      order: DEFINITIONS.order,
      rooms: DEFINITIONS.rooms,
      rolls: DEFINITIONS.rolls,
      questionSources: DEFINITIONS.questionSources,
    },
    privacy: ATTAINMENT_PRIVACY,
  };
}

/* ---------------------------------------------------------------- reads -- */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dayFrom(raw, field) {
  if (raw === undefined || raw === '') return null;
  const s = String(raw).trim();
  const t = Date.parse(`${s}T00:00:00Z`);
  // Round-tripped, so 2026-02-30 (which Date rolls into March) is refused too.
  const ok = DAY.test(s) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
  if (!ok) throw fail(`${field} must be a date as YYYY-MM-DD.`, 400);
  return s;
}

/**
 * The rooms a report counts, from ?from=&to=&rooms= over the class's rooms the
 * caller may read: opened on or after `from` and on or before `to` (the room's
 * day in India's time, roomDay), and only the codes in `rooms` when it is sent.
 * Oldest first. A code that is not one of the class's rooms is a 400.
 *
 * `imported=leave-out` (Phase 7) leaves out every room imported from a file
 * laptop mode saved (a room carrying `importedFrom`): such a file is checked
 * for its shape, not for being unchanged, so a report may be wanted without
 * them. `imported=count`, or nothing, counts them like any room, and the
 * report names them (importedRoomsSentence).
 */
export function roomsWindow(query = {}, rooms = []) {
  const from = dayFrom(query.from, 'from');
  const to = dayFrom(query.to, 'to');
  if (from && to && from > to) throw fail('from must not be after to.', 400);
  const imported = query.imported === undefined || query.imported === '' ? 'count' : String(query.imported);
  if (imported !== 'count' && imported !== 'leave-out') throw fail('imported must be count or leave-out.', 400);
  let codes = null;
  if (query.rooms !== undefined && query.rooms !== '') {
    const raw = Array.isArray(query.rooms) ? query.rooms.join(',') : String(query.rooms);
    const list = [...new Set(raw.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (!list.length) throw fail('rooms must be a comma-separated list of room codes.', 400);
    if (list.length > 200) throw fail('rooms names more than 200 rooms.', 400);
    const held = new Set(rooms.map((r) => String(r.code).toUpperCase()));
    const missing = list.filter((c) => !held.has(c));
    if (missing.length) {
      throw fail(`rooms: ${missing.join(', ')} ${missing.length === 1 ? 'is not a room' : 'are not rooms'} of this class.`, 400);
    }
    codes = list;
  }
  const wanted = codes ? new Set(codes) : null;
  const chosen = rooms
    .filter((r) => (!wanted || wanted.has(String(r.code).toUpperCase())) && (!from || roomDay(r) >= from) && (!to || roomDay(r) <= to)
      && !(imported === 'leave-out' && r.importedFrom))
    .sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')) || String(a.code).localeCompare(String(b.code)));
  return { rooms: chosen, window: { from, to, rooms: codes, ...(imported === 'leave-out' ? { imported } : {}) } };
}

const uniqueIds = (ids) => [...new Map(ids.filter(Boolean).map((id) => [idKey(id), String(id)])).values()];

/**
 * Everything a report reads, for the rooms it counts: the outcome map, the
 * chapters' questions and titles, every answer row (all attempts), the roster,
 * the profiles, the attendance marks (which say whose each room's answers are,
 * rollResolver), and, as asked, the teacher records.
 */
export async function readAttainmentInputs(repo, cls, rooms = [], { records = false } = {}) {
  const map = await readOutcomeMap(repo, cls._id);
  const named = await overrideQuestions(repo, map.overrides);
  const chapterIds = uniqueIds([
    ...map.links.map((l) => l.contentId),
    ...rooms.map((r) => r.contentId),
    ...named.filter(Boolean).map((q) => q.contentId),
  ]);
  const sessionIds = rooms.map((r) => String(r._id));
  const inRooms = new Set(sessionIds.map(idKey));
  const [contents, banks, answers, roster, profileLists] = await Promise.all([
    Promise.all(chapterIds.map((id) => repo.getContent(id))),
    Promise.all(chapterIds.map((id) => repo.listQuestions(id, { includeDiscarded: true }))),
    sessionIds.length ? allAnswers(repo, { sessionIds }) : [],
    repo.listClassStudents(cls._id),
    Promise.all(sessionIds.map((id) => repo.listProfiles(id))),
  ]);
  // Every answer written since the evidence store carries its chapter; one that
  // somehow does not is its room's.
  const roomChapter = new Map(rooms.map((r) => [idKey(r._id), r.contentId]));
  const rows = answers.map((a) => (a.contentId ? a : { ...a, contentId: roomChapter.get(idKey(a.sessionId)) ?? null }));
  const out = {
    ...map,
    questions: banks.flat(),
    chapters: chapterMap(contents),
    answers: rows,
    roster,
    profiles: new Map(sessionIds.map((id, i) => [id, profileLists[i]])),
  };
  if (records) {
    const [observations, picks, tallies, activities] = await Promise.all([
      sessionIds.length ? repo.listObservations({ classId: cls._id }) : [],
      Promise.all(sessionIds.map((id) => repo.listWheelPicks(id))),
      Promise.all(sessionIds.map((id) => repo.listTallies(id))),
      Promise.all(sessionIds.map((id) => repo.listActivities(id))),
    ]);
    out.records = {
      observations: observations.filter((o) => inRooms.has(idKey(o.sessionId))),
      picks: picks.flat(),
      tallies: tallies.flat(),
      activities: activities.flat(),
    };
  }
  const marks = await Promise.all(sessionIds.map((id) => repo.listAttendance(id)));
  out.attendance = new Map(sessionIds.map((id, i) => [id, marks[i]]));
  return out;
}
