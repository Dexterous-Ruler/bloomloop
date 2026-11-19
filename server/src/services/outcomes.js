// Phase 4 - course outcomes (COs), and which evidence belongs to which.
//
// A course outcome is what a college says a student who passes a course can do
// ("CO2: Analyse the behaviour of TCP under congestion"). Attainment is reported
// per outcome, so every answer has to be traceable to the outcomes it is
// evidence for. This module holds the outcomes' own rules and THE resolution of
// an answer to its outcomes (resolveAnswer), which the coverage below and the
// attainment report both use, so the two can never count differently.
//
// Outcomes belong to a class (a course and a section): attainment is reported
// per class, and two sections of one course copy their outcomes, they do not
// share them (routes/outcomes.js). Ownership follows the class.
//
// How an answer reaches an outcome, in order:
//   1. its question's override in this class, if there is one: mapped straight
//      to some outcomes, or excluded from every outcome
//   2. its topic, in its chapter, through the outcome-to-topic mapping: the
//      question's topic while the question still exists, then the topic frozen
//      on the answer when it was given
//   3. otherwise unmapped, and counted as unmapped: never dropped
//
// Topics are text. A chapter's list (contents.topics), each question
// (questions.topic) and each answer (answers.topic, frozen at answer time) carry
// their own copy, and nothing ties them together when one is renamed: renaming a
// topic in the chapter's list leaves its questions and answers under the old
// name. So the mapping is made on the text the evidence carries, any of the
// three may be mapped, and a renamed topic's evidence shows up as unmapped under
// its old name rather than disappearing (docs/PRODUCT_DECISIONS.md).
//
// Teacher records (observations and the rest) are never mapped to an outcome and
// never counted here (decision 3's safe default): this is digital answers only.
// Everything here is staff-only.

import { LEVELS } from '../bloom.js';
import { isRecordId } from '../ids.js';
import { holdsContact } from './roster.js';
import { allAnswers } from './evidence.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Far over the 4 to 6 a course usually has; a guard, not a target. */
export const MAX_OUTCOMES = 50;
export const MAX_CODE = 16;
export const MAX_STATEMENT = 300;
export const MAX_TOPICS_PER_OUTCOME = 100;
/** As long as a topic may be anywhere else (MAX_TOPIC_CHARS in services/extract.js and routes/bank.js). */
export const MAX_TOPIC = 160;
export const MAX_WEIGHT = 100;

/** "CO1", "CO 1", "CS301.2": letters, digits, space and . _ - /, upper case, at most 16 characters. */
export const CODE_SHAPE = /^[A-Z0-9][A-Z0-9 ._\-/]{0,15}$/;

export const OUTCOMES_PRIVACY = 'Course outcomes, their coverage and attainment are for staff only: never shown on a phone '
  + 'or the projector, and never sent to a student-facing route.';

/** Why an answer reached the outcomes it did (resolveAnswer's `via`). */
export const VIA = Object.freeze({
  question: 'question',
  topic: 'topic',
  excluded: 'excluded',
  unmapped: 'unmapped',
});

/** What every count in the coverage means, sent with it so a screen can say so. */
export const COVERAGE_DEFINITIONS = Object.freeze({
  answers: 'Final, graded answers given in rooms opened for this class: polls, and attempts followed by a retry, are left out. '
    + 'An answer that belongs to two outcomes is counted under each, and once in the class totals.',
  questions: 'Approved questions (the ones a room may serve) of the chapters involved; drafts and discarded questions are left out.',
  resolution: 'An answer belongs to the outcomes its question is mapped to directly (a per-question override), if it has one; '
    + 'otherwise to the outcomes its topic is mapped to, in its chapter. A question excluded by an override belongs to none. '
    + 'Whatever reaches no outcome is counted as unmapped, never dropped.',
  topics: 'Topics are matched within their chapter, ignoring case and runs of spaces. While a question still exists its topic '
    + 'is used; then the topic the answer was given under, which is kept as it was when answered.',
  renamedTopics: 'Renaming a topic in a chapter\'s list does not rename it on questions and answers already written. Their '
    + 'evidence stays under the old name (inChapter: false) and shows as unmapped until that name is mapped too.',
  weights: 'A topic\'s weight (1 unless set) says how much its evidence counts towards the outcome beside the outcome\'s '
    + 'other topics, for the attainment report to apply. Coverage counts answers and questions unweighted. A question '
    + 'mapped directly counts with weight 1.',
  archived: 'An archived outcome keeps its mappings, so evidence still reaches it and every report still names it.',
  evidence: 'Digital answers only. Teacher observations and other teacher records are never mapped to an outcome or '
    + 'counted here (decision 3).',
});

/* --------------------------------------------------------------- topics -- */

/** A topic as stored and shown: trimmed and single-spaced, as every topic writer leaves it. */
export const cleanTopic = (topic) => String(topic ?? '').replace(/\s+/g, ' ').trim();

/**
 * Two topics are one when this is equal: single-spaced, trimmed, lower case. The
 * rule the chapter's own topic list de-duplicates by (tidyTopics in
 * routes/content.js), so a mapping never splits what a chapter calls one topic.
 */
export const topicKey = (topic) => cleanTopic(topic).toLowerCase();

const idKey = (id) => String(id ?? '').trim().toLowerCase();
/** A topic in its chapter: the same name in two chapters is two topics. */
const slotOf = (contentId, topic) => `${idKey(contentId)}\u0000${topicKey(topic)}`;

/* ------------------------------------------------------------ the input -- */

/**
 * An outcome's own fields off a request body, or an honest 400. `partial` is an
 * edit: only what was sent, and at least one field.
 *
 *   code         required; trimmed, single-spaced, upper case; CODE_SHAPE
 *   statement    required; at most MAX_STATEMENT characters; no email address
 *                or phone number (holdsContact), as for every free text a
 *                class keeps
 *   targetLevel  optional: one of the six levels, British spelling, or null
 */
export function outcomeFields(body = {}, { partial = false } = {}) {
  const out = {};
  const b = body && typeof body === 'object' ? body : {};
  if (b.code !== undefined || !partial) {
    if (typeof b.code !== 'string' || !b.code.trim()) throw fail('code is required: a short label such as "CO1".', 400);
    const code = b.code.replace(/\s+/g, ' ').trim().toUpperCase();
    if (!CODE_SHAPE.test(code)) {
      throw fail(`code must be a short label such as "CO1": letters, digits, spaces and . _ - / only, starting with a letter `
        + `or digit, at most ${MAX_CODE} characters.`, 400);
    }
    out.code = code;
  }
  if (b.statement !== undefined || !partial) {
    if (typeof b.statement !== 'string' || !b.statement.trim()) {
      throw fail('statement is required: what a student who attains this outcome can do.', 400);
    }
    const statement = b.statement.replace(/\s+/g, ' ').trim();
    if (statement.length > MAX_STATEMENT) throw fail(`statement is longer than ${MAX_STATEMENT} characters.`, 400);
    if (holdsContact(statement)) throw fail('statement holds an email address or a phone number; a course outcome keeps neither.', 400);
    out.statement = statement;
  }
  if (b.targetLevel !== undefined) {
    const raw = b.targetLevel === null ? '' : b.targetLevel;
    if (typeof raw !== 'string') throw fail(`targetLevel must be one of ${LEVELS.join(', ')}, or null for none.`, 400);
    const level = raw.trim().toLowerCase();
    if (level && !LEVELS.includes(level)) throw fail(`targetLevel must be one of ${LEVELS.join(', ')}, or null for none.`, 400);
    out.targetLevel = level || null;
  } else if (!partial) {
    out.targetLevel = null;
  }
  if (partial && !Object.keys(out).length) throw fail('Send code, statement or targetLevel to change.', 400);
  return out;
}

/**
 * An outcome's topics off a request body: [{ contentId, topic, weight? }], the
 * whole set (a PUT replaces it; [] maps none). Shape only: whether the caller
 * may read each chapter, and whether the topic is one of it, is the route's
 * check. A weight is a number above 0 and at most MAX_WEIGHT, kept to three
 * decimals (numeric(6,3)); 1 when left out.
 */
export function topicLinksFrom(raw) {
  if (!Array.isArray(raw)) throw fail('topics must be a list of { contentId, topic, weight? }; send [] to map none.', 400);
  if (raw.length > MAX_TOPICS_PER_OUTCOME) {
    throw fail(`topics lists ${raw.length} topics; ${MAX_TOPICS_PER_OUTCOME} is the most one outcome may map.`, 400);
  }
  const seen = new Map();
  return raw.map((t, i) => {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw fail(`topics[${i}] must be { contentId, topic, weight? }.`, 400);
    const contentId = idKey(t.contentId);
    if (!isRecordId(contentId)) throw fail(`topics[${i}].contentId is not a valid id.`, 400);
    const topic = typeof t.topic === 'string' ? cleanTopic(t.topic) : '';
    if (!topic) throw fail(`topics[${i}].topic is required: a topic of that chapter.`, 400);
    if (topic.length > MAX_TOPIC) throw fail(`topics[${i}].topic is longer than ${MAX_TOPIC} characters.`, 400);
    let weight = 1;
    if (t.weight !== undefined && t.weight !== null) {
      weight = typeof t.weight === 'number' && Number.isFinite(t.weight) ? Math.round(t.weight * 1000) / 1000 : NaN;
      if (!(weight > 0) || weight > MAX_WEIGHT) {
        throw fail(`topics[${i}].weight must be a number above 0 and at most ${MAX_WEIGHT}; leave it out for 1.`, 400);
      }
    }
    const slot = slotOf(contentId, topic);
    if (seen.has(slot)) throw fail(`topics[${seen.get(slot)}] and topics[${i}] name the same topic of one chapter.`, 400);
    seen.set(slot, i);
    return { contentId, topic, weight };
  });
}

/**
 * A per-question override off a request body: { outcomeIds: [...] } maps the
 * question to exactly those outcomes, in place of its topic's; { exclude: true }
 * keeps it out of every outcome. One or the other. Undoing an override is a
 * DELETE, so the question follows its topic again.
 */
export function overrideFrom(body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const both = 'Send { "outcomeIds": [...] } to map this question to those outcomes instead of its topic\'s, '
    + 'or { "exclude": true } to keep it out of every outcome.';
  if ((b.exclude !== undefined) === (b.outcomeIds !== undefined)) throw fail(both, 400);
  if (b.exclude !== undefined) {
    if (b.exclude !== true) throw fail('exclude may only be true. To let the question follow its topic again, DELETE its override.', 400);
    return { excluded: true, outcomeIds: [] };
  }
  if (!Array.isArray(b.outcomeIds) || !b.outcomeIds.length) {
    throw fail('outcomeIds must name at least one outcome. To keep the question out of every outcome, send { "exclude": true }.', 400);
  }
  if (b.outcomeIds.length > MAX_OUTCOMES) throw fail(`outcomeIds lists more than ${MAX_OUTCOMES} outcomes.`, 400);
  const ids = [];
  b.outcomeIds.forEach((raw, i) => {
    const id = idKey(raw);
    if (!isRecordId(id)) throw fail(`outcomeIds[${i}] is not a valid id.`, 400);
    if (!ids.includes(id)) ids.push(id);
  });
  return { excluded: false, outcomeIds: ids };
}

/* ----------------------------------------------------------- resolution -- */

/**
 * The lookups resolveAnswer reads, built once per report from the class's
 * outcomes, their topic mappings, its overrides and the questions at hand
 * (any chapter; deleted questions are simply absent).
 */
export function outcomeIndex({ outcomes = [], links = [], overrides = [], questions = [] } = {}) {
  const position = new Map(outcomes.map((o) => [String(o._id), Number(o.position) || 0]));
  const byTopic = new Map();
  for (const l of links) {
    const slot = slotOf(l.contentId, l.topic);
    if (!byTopic.has(slot)) byTopic.set(slot, []);
    byTopic.get(slot).push({ id: String(l.outcomeId), weight: Number(l.weight) || 1 });
  }
  // The order an answer's outcomes are listed in: the class's order.
  for (const list of byTopic.values()) list.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return {
    outcomes: new Map(outcomes.map((o) => [String(o._id), o])),
    byTopic,
    overrides: new Map(overrides.map((o) => [idKey(o.questionId), o])),
    questions: new Map(questions.map((q) => [idKey(q._id), q])),
  };
}

/**
 * THE resolution of one answer row to its course outcomes, and why. Pure: the
 * attainment report and the coverage below both call it, with an index built by
 * outcomeIndex, so a report and its coverage can never count an answer
 * differently.
 *
 * Which question: `questionId`, or, once the question has been deleted (the
 * column then goes null, 0008), the id kept in the answer's snapshot, so an
 * override still applies to answers given to a question that is gone.
 *
 * Which chapter: the one frozen on the answer (`contentId`), else the question's.
 *
 * @returns {{ via: 'question'|'topic'|'excluded'|'unmapped',
 *             outcomes: { id: string, weight: number }[],
 *             questionId: string|null, contentId: string|null,
 *             topic: string, topicFrom: 'question'|'answer'|null }}
 *   via        question: an override maps the question straight to `outcomes`
 *              (weight 1 each); topic: its topic's mapping did (each with the
 *              mapping's weight); excluded: an override keeps it out of every
 *              outcome; unmapped: nothing reaches an outcome
 *   topic      the topic it reached its outcomes through, or for an unmapped
 *              answer the topic it carries, so a report can say what to map
 *   topicFrom  whose copy of the topic that was: the question as it is now, or
 *              the answer as it was given
 */
export function resolveAnswer(answer, index) {
  const snap = answer?.questionSnapshot && typeof answer.questionSnapshot === 'object' ? answer.questionSnapshot : {};
  const rawId = answer?.questionId ?? snap.id ?? null;
  const questionId = rawId ? idKey(rawId) : null;
  const question = questionId ? index.questions.get(questionId) ?? null : null;
  const chapter = answer?.contentId ?? question?.contentId ?? null;
  const contentId = chapter ? String(chapter) : null;
  const base = { questionId, contentId };

  const override = questionId ? index.overrides.get(questionId) : null;
  if (override?.excluded) return { ...base, via: VIA.excluded, outcomes: [], topic: '', topicFrom: null };
  if (override) {
    return { ...base, via: VIA.question, outcomes: override.outcomeIds.map((id) => ({ id: String(id), weight: 1 })), topic: '', topicFrom: null };
  }

  // The question's topic while it exists (a question's topic is not editable
  // today, so the two agree; if that changes, the bank's current topic wins),
  // then the answer's own, frozen when it was given.
  const tried = question ? [['question', question.topic], ['answer', answer?.topic]] : [['answer', answer?.topic]];
  for (const [from, topic] of tried) {
    if (!topicKey(topic)) continue;
    const hit = index.byTopic.get(slotOf(contentId, topic));
    if (hit?.length) return { ...base, via: VIA.topic, outcomes: hit.map((h) => ({ ...h })), topic: cleanTopic(topic), topicFrom: from };
  }
  const own = cleanTopic(answer?.topic) ? ['answer', answer.topic] : ['question', question?.topic];
  return { ...base, via: VIA.unmapped, outcomes: [], topic: cleanTopic(own[1]), topicFrom: cleanTopic(own[1]) ? own[0] : null };
}

/** A question resolved as an answer to it would be: its own id, chapter and topic. */
const resolveQuestion = (q, index) => resolveAnswer({ questionId: q._id, contentId: q.contentId, topic: q.topic }, index);

/** What counts as evidence of attainment: a final attempt that was marked (not a poll). */
export const countsAsEvidence = (a) => a?.final !== false && !a?.ungraded;

/* ---------------------------------------------------------------- views -- */

/** Active outcomes in the class's order, then archived ones, in theirs. */
export function inOrder(outcomes = []) {
  const by = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0)
    || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  return [...outcomes.filter((o) => !o.archivedAt).sort(by), ...outcomes.filter((o) => o.archivedAt).sort(by)];
}

/** One outcome's topics as a screen gets them, chapter by chapter. `chapters`: contentId (lower case) -> { title, topics }. */
export function linkViews(outcomeId, links = [], chapters = new Map()) {
  return links
    .filter((l) => String(l.outcomeId) === String(outcomeId))
    .map((l) => {
      const ch = chapters.get(idKey(l.contentId));
      return {
        contentId: String(l.contentId),
        chapter: ch?.title ?? null,
        topic: l.topic,
        weight: Number(l.weight) || 1,
        inChapter: Boolean(ch?.keys?.has(topicKey(l.topic))),
      };
    })
    .sort((a, b) => String(a.chapter ?? '').localeCompare(String(b.chapter ?? '')) || a.topic.localeCompare(b.topic));
}

/** One outcome as a screen gets it. Field by field: nothing else stored is sent. */
export function outcomeView(o, links = [], chapters = new Map()) {
  return {
    id: String(o._id),
    code: o.code,
    statement: o.statement,
    targetLevel: o.targetLevel ?? null,
    position: Number(o.position) || 0,
    archived: Boolean(o.archivedAt),
    archivedAt: o.archivedAt ?? null,
    createdAt: o.createdAt ?? null,
    updatedAt: o.updatedAt ?? null,
    topics: linkViews(o._id, links, chapters),
  };
}

/** A per-question override with the question it names, or `question: null` once that question is deleted. */
export function overrideView(ov, question, outcomes = [], chapters = new Map()) {
  const byId = new Map(outcomes.map((o) => [String(o._id), o]));
  return {
    questionId: String(ov.questionId),
    excluded: ov.excluded === true,
    outcomes: (ov.outcomeIds ?? []).map((id) => {
      const o = byId.get(String(id));
      return { id: String(id), code: o?.code ?? null, archived: Boolean(o?.archivedAt) };
    }),
    question: question ? {
      text: String(question.text ?? '').slice(0, 200),
      topic: question.topic ?? '',
      level: question.bloom ?? null,
      kind: question.kind ?? 'mcq',
      status: question.status ?? null,
      contentId: String(question.contentId),
      chapter: chapters.get(idKey(question.contentId))?.title ?? null,
    } : null,
    ...(question ? {} : { note: 'The question has been deleted. The override still applies to the answers given to it.' }),
    updatedAt: ov.updatedAt ?? null,
  };
}

/** contentId (lower case) -> { title, keys }: the chapter's title and its topic list's keys. */
export function chapterMap(contents = []) {
  return new Map(contents.filter(Boolean).map((c) => [idKey(c._id), {
    title: c.title ?? '',
    keys: new Set((c.topics ?? []).map(topicKey)),
  }]));
}

/* ------------------------------------------------------------- coverage -- */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * How much evidence each outcome has, and what reaches none. Pure.
 *
 *   outcomes   every outcome (archived after, marked), with each mapped topic's
 *              approved questions and answers, what is mapped to it directly,
 *              its totals and the students they come from, and `evidence`:
 *              'answers', 'questions' (approved questions, no answer yet) or
 *              'none', with a sentence saying so
 *   answers    the class's counted answers: mapped, excluded, unmapped. Every
 *              counted answer is in exactly one of the three, so they add up
 *   unmapped   what reaches no outcome, by chapter and topic, most answers first
 *   excluded   questions and answers kept out by an override
 *
 * `answers` are answer rows (any; only final graded ones are counted),
 * `questions` the questions of every chapter involved (any status; approved ones
 * are counted), `chapters` from chapterMap.
 */
export function outcomeCoverage({
  outcomes = [], links = [], overrides = [], questions = [], answers = [], chapters = new Map(),
} = {}) {
  const index = outcomeIndex({ outcomes, links, overrides, questions });
  const acc = new Map(outcomes.map((o) => [String(o._id), {
    topics: new Map(linkViews(o._id, links, chapters).map((t) => [slotOf(t.contentId, t.topic), { ...t, questions: 0, answers: 0 }])),
    direct: { questions: 0, answers: 0 },
    questions: 0,
    answers: 0,
    students: new Set(),
  }]));
  const unmapped = new Map();
  const excluded = { questions: 0, answers: 0 };
  const totals = { counted: 0, mapped: 0, excluded: 0, unmapped: 0 };

  const tally = (r, field, rollNo) => {
    if (r.via === VIA.excluded) { excluded[field] += 1; return 'excluded'; }
    if (!r.outcomes.length) {
      const slot = slotOf(r.contentId, r.topic);
      if (!unmapped.has(slot)) {
        const ch = chapters.get(idKey(r.contentId));
        unmapped.set(slot, {
          contentId: r.contentId, chapter: ch?.title ?? null, topic: r.topic,
          inChapter: Boolean(r.topic && ch?.keys?.has(topicKey(r.topic))), questions: 0, answers: 0,
        });
      }
      unmapped.get(slot)[field] += 1;
      return 'unmapped';
    }
    for (const { id } of r.outcomes) {
      const a = acc.get(id);
      if (!a) continue;
      a[field] += 1;
      if (rollNo) a.students.add(String(rollNo));
      if (r.via === VIA.question) a.direct[field] += 1;
      else a.topics.get(slotOf(r.contentId, r.topic))[field] += 1;
    }
    return 'mapped';
  };

  for (const q of questions) if (q.status === 'active') tally(resolveQuestion(q, index), 'questions');
  for (const a of answers) {
    if (!countsAsEvidence(a)) continue;
    totals.counted += 1;
    totals[tally(resolveAnswer(a, index), 'answers', a.rollNo)] += 1;
  }

  const rows = inOrder(outcomes).map((o) => {
    const a = acc.get(String(o._id));
    const topics = [...a.topics.values()];
    const evidence = a.answers ? 'answers' : a.questions ? 'questions' : 'none';
    let summary;
    if (evidence === 'answers') summary = `${plural(a.answers, 'answer')} from ${plural(a.students.size, 'student')}.`;
    else if (evidence === 'questions') summary = `No answers yet: ${plural(a.questions, 'approved question')} mapped to it.`;
    else if (!topics.length && !a.direct.questions) summary = 'No evidence: no topic or question is mapped to it yet.';
    else summary = 'No evidence yet: what is mapped to it has no approved question and no answer.';
    return {
      ...outcomeView(o, links, chapters),
      topics,
      direct: a.direct,
      questions: a.questions,
      answers: a.answers,
      students: a.students.size,
      evidence,
      summary,
    };
  });

  return {
    outcomes: rows,
    answers: totals,
    unmapped: [...unmapped.values()].sort((x, y) => y.answers - x.answers || y.questions - x.questions
      || String(x.chapter ?? '').localeCompare(String(y.chapter ?? '')) || x.topic.localeCompare(y.topic)),
    excluded,
  };
}

/* ---------------------------------------------------------------- reads -- */

/** A class's outcomes, their topic mappings and its question overrides, as stored. */
export async function readOutcomeMap(repo, classId) {
  const [outcomes, links, overrides] = await Promise.all([
    repo.listOutcomes(classId),
    repo.listOutcomeTopics(classId),
    repo.listQuestionOverrides(classId),
  ]);
  return { outcomes, links, overrides };
}

/** The questions an override names, by id; null for one that has been deleted. */
export async function overrideQuestions(repo, overrides = []) {
  return Promise.all(overrides.map((ov) => (isRecordId(ov.questionId) ? repo.getQuestion(ov.questionId) : null)));
}

const uniqueIds = (ids) => [...new Map(ids.filter(Boolean).map((id) => [idKey(id), String(id)])).values()];

/**
 * The coverage report for a class (outcomeCoverage), read from the store.
 * `rooms` are the class's rooms the caller may read (a route has vetted them);
 * their final answers are the evidence. Chapters involved: every chapter a
 * mapping names, every room's chapter and every overridden question's chapter.
 */
export async function classCoverage(repo, cls, rooms = []) {
  const map = await readOutcomeMap(repo, cls._id);
  const named = await overrideQuestions(repo, map.overrides);
  const chapterIds = uniqueIds([
    ...map.links.map((l) => l.contentId),
    ...rooms.map((r) => r.contentId),
    ...named.filter(Boolean).map((q) => q.contentId),
  ]);
  const sessionIds = rooms.map((r) => String(r._id));
  const [contents, banks, answers] = await Promise.all([
    Promise.all(chapterIds.map((id) => repo.getContent(id))),
    Promise.all(chapterIds.map((id) => repo.listQuestions(id, { includeDiscarded: true }))),
    sessionIds.length ? allAnswers(repo, { sessionIds, final: true }) : [],
  ]);
  // Every answer written since the evidence store carries its chapter; one that
  // somehow does not is its room's.
  const roomChapter = new Map(rooms.map((r) => [String(r._id), r.contentId]));
  const rows = answers.map((a) => (a.contentId ? a : { ...a, contentId: roomChapter.get(String(a.sessionId)) ?? null }));
  const chapters = chapterMap(contents);
  const report = outcomeCoverage({ ...map, questions: banks.flat(), answers: rows, chapters });
  return {
    class: { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' },
    rooms: { counted: rooms.length, codes: rooms.map((r) => r.code) },
    ...report,
    definitions: COVERAGE_DEFINITIONS,
    privacy: OUTCOMES_PRIVACY,
  };
}

/**
 * Every topic the evidence of one chapter carries, by key, with its spelling:
 * the chapter's own list, then its questions' (any status), then the topics
 * frozen on answers given in `rooms` on that chapter. What a mapping may name.
 */
export async function knownTopics(repo, content, rooms = []) {
  const id = idKey(content._id);
  const sessionIds = rooms.filter((r) => idKey(r.contentId) === id).map((r) => String(r._id));
  const [bank, answers] = await Promise.all([
    repo.listQuestions(content._id, { includeDiscarded: true }),
    sessionIds.length ? allAnswers(repo, { sessionIds }) : [],
  ]);
  const known = new Map();
  const add = (topic) => {
    const key = topicKey(topic);
    if (key && !known.has(key)) known.set(key, cleanTopic(topic));
  };
  (content.topics ?? []).forEach(add);
  bank.forEach((q) => add(q.topic));
  answers.forEach((a) => add(a.topic));
  return known;
}
