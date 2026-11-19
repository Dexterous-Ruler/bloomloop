// Self-tests (Phase 6, decision H10's exam mode: "a self-test builder").
//
// A student picks topics and Bloom levels, how many questions (at most
// MAX_EXAM_QUESTIONS, 30) and, if they like, a time limit. The server picks the
// questions and FIXES THE LIST when the self-test starts (it is kept on the run,
// 0028): approved questions practice could serve (no poll, no draft, no
// uploaded image, no question a class still running holds (services/hubClosed.js,
// Batch 9's E1), no drawing, which the hub has nobody to mark (E4)), mixed
// across the topics chosen (one from each topic in turn,
// questions the student has not met in the hub first, then in an order seeded
// by the self-test), and shuffled so no topic always comes first.
//
// WHILE IT IS OPEN: no hints and no feedback. An answer is marked and kept at
// once (a hub attempt, mode 'exam', carrying the self-test's id: never
// discarded, never shown), and the reply says only that it was saved. The
// student may change an answer: each change is another attempt, and the last
// one before the end counts. Nothing a student reads shows a mark in the
// meantime: the hub's estimates, error log and reviews count a self-test's
// answers only once it has ended (services/hubHeld.js).
//
// IT ENDS when the student hands it in, or when its time limit has passed (with
// EXAM_GRACE_SECONDS for answers already on their way); the server notices the
// time-out on the next request about it and writes the end then, at the
// deadline plus the grace. A time-out hands in what was answered. An answer that
// arrives after the end is kept, marked late, and not counted.
//
// WHO STILL READS IT. The student's own, and only what they still reach: a
// question whose topic is no longer on their classes in the hub (they left the
// roster, the chapter was taken off the class, the topic retired) is not shown
// while the self-test is open, and an unanswered one is not shown in the
// result either. What they answered is shown from their own attempt's snapshot.
//
// THEN: per question, the question as it was shown, the answer given, right or
// wrong, the right answer, the approved explanation (H14) and the approved
// feedback on a wrong option chosen (H13, services/hubHintHook.js), except for a
// question being asked in a room right now (services/hubClosed.js), whose
// answer and explanation wait until the room has moved on; a written answer
// carries its provisional machine mark, labelled as one; an unanswered question,
// or one taken out of the bank since, is labelled as not marked, and keeps its
// key and explanation back (they come only after an attempt, so handing in an
// empty self-test cannot be a way to read the bank's answers). And a personal
// summary by topic and by level, with the counts behind every figure. Never
// compared with anyone: a self-test is the student's own, counted nowhere
// official (no room, attainment figure or marks register reads it).

import { LEVELS, LABEL as LEVEL_LABEL } from '../bloom.js';
import { awaitsReview, forStudent, score } from '../questionTypes.js';
import { labelHtml, phoneRich } from './richText.js';
import { explanationForStudent } from './hubExplanations.js';
import { languageChoice } from './hubLanguages.js';
import {
  MAX_TOPICS_PER_SET, NO_QUESTION, PROVISIONAL_NOTE, cleanAttemptId, hubSeed, onceServable, recordAttempt, studentScope, topicEntries,
} from './hubPractice.js';
import { itemKeyOf } from './hubElo.js';
import { feedbackAfter } from './hubHintHook.js';
import { EXAM_GRACE_SECONDS, finalAnswers, runEnd } from './hubHeld.js';
import { NO_HINTS, RUN_NOT_FOUND, cleanRunId, hashOf, questionsWord, shownQuestions } from './hubRuns.js';
import { ROOM_HELD_NOTE, roomLiveQuestions } from './hubClosed.js';
import { isRoomsOnly } from './bankShare.js';

/** A question its professor has kept for rooms only since the self-test began (Batch 8, 0035). */
export const KEPT_FOR_ROOMS = 'Your professor now keeps this question for class, so the hub does not show it or its answer here.';

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();

export const MAX_EXAM_QUESTIONS = 30;
export const DEFAULT_EXAM_QUESTIONS = 10;
export const MAX_TIME_LIMIT_MINUTES = 180;

export const NONE_MATCH = 'None of your professor\'s approved questions match those topics and levels yet. Choose other levels or topics.';
export const EXAM_NOTE = 'A self-test counts in no class mark, attainment figure or register, and nobody is compared with you. '
  + 'Once it is handed in, its answers count in your own progress in the hub, which your professor can see.';
export const OPEN_NOTE = 'Your answers are saved as you go. You see what was right, and why, once you hand it in'
  + ' (or its time runs out, which hands in what you answered).';

/* ------------------------------------------------------------------ pure -- */

/**
 * The self-test's questions (the header's rule). Pure.
 *
 * `pools`: [{ entry, questions }] per topic, in the order chosen; `met`: ids
 * (lower case) of questions the student has answered in the hub before.
 *
 * @returns {{ q, entry }[]}
 */
export function pickExamQuestions(pools = [], { count = DEFAULT_EXAM_QUESTIONS, seed = '', met = new Set() } = {}) {
  const order = (a, b) => (Number(met.has(lower(a._id))) - Number(met.has(lower(b._id))))
    || (hashOf(`${seed}:${lower(a._id)}`) - hashOf(`${seed}:${lower(b._id)}`));
  const queues = pools.map((p) => [...p.questions].sort(order).map((q) => ({ q, entry: p.entry })));
  const out = [];
  const seen = new Set();
  while (out.length < count && queues.some((x) => x.length)) {
    for (const queue of queues) {
      if (out.length >= count) break;
      while (queue.length) {
        const c = queue.shift();
        if (seen.has(lower(c.q._id))) continue;
        seen.add(lower(c.q._id));
        out.push(c);
        break;
      }
    }
  }
  // One from each topic in turn keeps the topics balanced; the seeded shuffle
  // mixes them, so the first topic chosen is not always asked first.
  return out.sort((a, b) => hashOf(`${seed}:order:${lower(a.q._id)}`) - hashOf(`${seed}:order:${lower(b.q._id)}`));
}

const tally = () => ({ questions: 0, answered: 0, right: 0, provisional: 0, unmarked: 0 });

/** A group's counts in a sentence: right of how many, what was not answered, what is provisional. */
export function tallySentence(t) {
  const parts = [`${t.right} of ${questionsWord(t.questions)} right`];
  const blank = t.questions - t.answered;
  if (blank) parts.push(`${blank} not answered`);
  if (t.provisional) parts.push(`${t.provisional} written answer${t.provisional === 1 ? '' : 's'} with a provisional machine mark`);
  return `${parts.join('; ')}.`;
}

/**
 * The personal summary: overall, by topic (in the order chosen) and by level
 * (Remember to Create, the levels asked only). Pure.
 *
 * `items`: [{ topicId, topicName, bloom, answered, correct, mark: 'auto'|'provisional'|'unmarked' }]
 */
export function summarise(items = [], topicOrder = []) {
  const overall = tally();
  const byTopic = new Map(topicOrder.map((t) => [lower(t.id), { topic: t, ...tally() }]));
  const byLevel = new Map();
  for (const it of items) {
    const tk = lower(it.topicId);
    if (!byTopic.has(tk)) byTopic.set(tk, { topic: { id: it.topicId, name: it.topicName }, ...tally() });
    if (!byLevel.has(it.bloom)) byLevel.set(it.bloom, tally());
    for (const t of [overall, byTopic.get(tk), byLevel.get(it.bloom)]) {
      t.questions += 1;
      if (it.answered) {
        t.answered += 1;
        if (it.correct) t.right += 1;
        if (it.mark === 'provisional') t.provisional += 1;
      } else {
        t.unmarked += 1;
      }
    }
  }
  return {
    overall: { ...overall, sentence: tallySentence(overall) },
    byTopic: [...byTopic.values()].filter((t) => t.questions).map((t) => ({ ...t, sentence: tallySentence(t) })),
    byLevel: LEVELS.filter((l) => byLevel.has(l)).map((l) => ({
      level: l, label: LEVEL_LABEL[l] ?? l, ...byLevel.get(l), sentence: tallySentence(byLevel.get(l)),
    })),
  };
}

/* ---------------------------------------------------------------- inputs -- */

function levelsFrom(raw) {
  if (raw === undefined || raw === null) return [...LEVELS];
  const list = Array.isArray(raw) ? raw : String(raw).split(',');
  const levels = [...new Set(list.map((l) => lower(l)).filter(Boolean))];
  if (!levels.length || levels.some((l) => !LEVELS.includes(l))) {
    throw fail(`Choose one or more levels: ${LEVELS.join(', ')}.`, 400);
  }
  return LEVELS.filter((l) => levels.includes(l));
}

function countFrom(raw) {
  if (raw === undefined || raw === null) return DEFAULT_EXAM_QUESTIONS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_EXAM_QUESTIONS) throw fail(`A self-test has 1 to ${MAX_EXAM_QUESTIONS} questions.`, 400);
  return n;
}

function limitFrom(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TIME_LIMIT_MINUTES) {
    throw fail(`A time limit is 1 to ${MAX_TIME_LIMIT_MINUTES} minutes, or none.`, 400);
  }
  return n;
}

/* ---------------------------------------------------------------- writes -- */

/**
 * Start a self-test (or return the stored one for a resent client run id).
 *
 * @param {object} body { clientRunId, topicIds, levels?, count?, timeLimitMinutes? }
 * @returns {Promise<{ run, duplicate: boolean }>}
 */
export async function startExam(repo, account, body = {}, { now = new Date() } = {}) {
  const clientRunId = cleanRunId(body.clientRunId);
  if (!clientRunId) throw fail('Each self-test needs its own id: 8 to 64 letters, digits, - or _.', 400);
  const held = await repo.getHubRunByKey(String(account.id), clientRunId);
  if (held) {
    if (held.kind !== 'exam') throw fail('That id belongs to a Get Ready check. Start the self-test with a new id.', 409);
    return { run: held, duplicate: true };
  }
  const levels = levelsFrom(body.levels);
  const count = countFrom(body.count);
  const limit = limitFrom(body.timeLimitMinutes);
  const raw = body.topicIds ?? body.topicId;
  if (raw === undefined || raw === null || (Array.isArray(raw) && !raw.length) || String(raw).trim() === '') {
    throw fail('Choose the topics for your self-test.', 400);
  }
  if ((Array.isArray(raw) ? raw : String(raw).split(',')).length > MAX_TOPICS_PER_SET) {
    throw fail(`A self-test mixes at most ${MAX_TOPICS_PER_SET} topics.`, 400);
  }
  const scope = await studentScope(repo, account);
  const entries = topicEntries(scope, raw);
  const mine = await repo.listHubAttempts({ accountId: String(account.id), topicIds: entries.map((e) => String(e.topic._id)) });
  // Batch 9: closed while a class still running holds it (E1), and a drawing has
  // no mark the hub can give (E4); a self-test built now leaves both out.
  const inClass = await roomLiveQuestions(repo, entries.map((e) => String(e.content._id)));
  const picked = pickExamQuestions(
    entries.map((entry) => ({
      entry,
      questions: entry.questions.filter((q) => levels.includes(q.bloom) && !awaitsReview(q) && !inClass.has(lower(q._id))),
    })),
    { count, seed: `${account.id}:${clientRunId}`, met: new Set(mine.map((a) => lower(itemKeyOf(a)))) },
  );
  if (!picked.length) throw fail(NONE_MATCH, 400);
  const startedAt = now.toISOString();
  return repo.addHubRun({
    accountId: String(account.id),
    clientRunId,
    kind: 'exam',
    spec: {
      topics: entries.map((e) => ({ id: String(e.topic._id), name: e.topic.name })),
      levels,
      asked: count,
      questions: picked.map(({ q, entry }) => ({ questionId: String(q._id), topicId: String(entry.topic._id) })),
    },
    timeLimitSeconds: limit ? limit * 60 : null,
    startedAt,
    deadlineAt: limit ? new Date(now.getTime() + limit * 60000).toISOString() : null,
  });
}

/** A self-test whose time is up gets its end written now (at the deadline plus the grace). */
export async function settleExam(repo, run, now = new Date()) {
  if (run.endedAt) return run;
  const end = runEnd(run, now);
  if (!end) return run;
  return (await repo.endHubRun(run._id, { endedAt: end, endReason: 'timed-out' })) ?? run;
}

/**
 * Keep one answer in a self-test: marked and stored at once, and never shown
 * until the end. An answer after the end is stored too, as late.
 *
 * @returns {Promise<{ attempt, duplicate: boolean, late: boolean, run }>}
 */
export async function answerExam(repo, account, run, body = {}, { now = new Date() } = {}) {
  // The route asked ownRun() already; this keeps any other caller from filing an answer under someone else's.
  if (String(run?.accountId) !== String(account?.id) || run?.kind !== 'exam') throw fail(RUN_NOT_FOUND.exam, 404);
  const attemptId = cleanAttemptId(body.attemptId);
  if (!attemptId) throw fail('Each attempt needs its own id: 8 to 64 letters, digits, - or _.', 400);
  const settled = await settleExam(repo, run, now);
  const lateAt = (a) => Boolean(settled.endedAt) && Date.parse(a.createdAt) > Date.parse(settled.endedAt);
  const held = await repo.getHubAttemptByKey(String(account.id), attemptId);
  if (held) {
    if (String(held.runId ?? '') !== String(run._id)) throw fail('That attempt id was used for another answer. Send this one with a new id.', 409);
    return { attempt: held, duplicate: true, late: lateAt(held), run: settled };
  }
  const listed = (settled.spec?.questions ?? []).find((x) => lower(x.questionId) === lower(body.questionId));
  if (!listed) throw fail(NO_QUESTION, 404);
  const { attempt, duplicate } = await recordAttempt(repo, account, {
    attemptId,
    questionId: listed.questionId,
    topicId: listed.topicId,
    response: body.response,
    mode: 'exam',
    timeTakenMs: body.timeTakenMs,
    shown: body.shown,
  }, { now, hintsUsed: 0, runId: run._id });
  return { attempt, duplicate, late: lateAt(attempt), run: settled };
}

/** Hand a self-test in. One already ended (handed in, or timed out) is left as it is. */
export async function submitExam(repo, run, { now = new Date() } = {}) {
  const settled = await settleExam(repo, run, now);
  if (settled.endedAt) return settled;
  return (await repo.endHubRun(run._id, { endedAt: now.toISOString(), endReason: 'submitted' })) ?? settled;
}

/* ----------------------------------------------------------------- reads -- */

const head = (run, now) => ({
  id: String(run._id),
  clientRunId: run.clientRunId,
  startedAt: run.startedAt,
  timeLimitMinutes: run.timeLimitSeconds ? run.timeLimitSeconds / 60 : null,
  deadlineAt: run.deadlineAt ?? null,
  secondsLeft: run.deadlineAt && !run.endedAt ? Math.max(0, Math.ceil((Date.parse(run.deadlineAt) - now.getTime()) / 1000)) : null,
  endedAt: run.endedAt ?? null,
  endReason: run.endReason ?? null,
  status: run.endedAt ? 'ended' : 'open',
  topics: (run.spec?.topics ?? []).map((t) => ({ id: t.id, name: t.name, nameHtml: labelHtml(t.name) })),
  levels: run.spec?.levels ?? [],
  total: (run.spec?.questions ?? []).length,
  ...((run.spec?.questions ?? []).length < (run.spec?.asked ?? 0)
    ? { shortNote: `You asked for ${run.spec.asked}; only ${questionsWord(run.spec.questions.length)} matched, so the self-test has those.` }
    : {}),
});

/**
 * The questions of the list as they stand in the bank now, by id (lower case); a
 * question gone or no longer answerable is missing. One kept for rooms only is
 * listed (its answer is kept and handed in), and the views below neither ask
 * it nor show its key.
 */
async function listedQuestions(repo, run) {
  const out = new Map();
  for (const x of run.spec?.questions ?? []) {
    const q = await repo.getQuestion(x.questionId).catch(() => null);
    if (onceServable(q)) out.set(lower(x.questionId), q);
  }
  return out;
}

const END_SENTENCE = {
  submitted: 'You handed this self-test in.',
  'timed-out': 'The time ran out, so what you had answered was handed in.',
};

/** The latest answer per question so far (an open self-test: no mark in it). */
function latestAnswers(attempts = []) {
  const out = new Map();
  for (const a of attempts) out.set(lower(itemKeyOf(a)), a);
  return out;
}

export const OUT_OF_REACH = 'This question\'s chapter is no longer on your classes in the hub, so it is not asked.';

/** An open self-test as its student sees it: the questions they still reach, with no mark, and what they have answered. */
async function openView(repo, account, run, attempts, now, scope) {
  const reach = (x) => scope.topics.has(lower(x.topicId));
  const questions = await listedQuestions(repo, { ...run, spec: { ...run.spec, questions: (run.spec?.questions ?? []).filter(reach) } });
  const shown = await shownQuestions(repo, account, [...questions.values()].filter((q) => !isRoomsOnly(q)));
  const latest = latestAnswers(attempts);
  const names = new Map((run.spec?.topics ?? []).map((t) => [lower(t.id), t.name]));
  const items = (run.spec?.questions ?? []).map((x, i) => {
    const key = lower(x.questionId);
    const a = latest.get(key);
    const base = { position: i + 1, questionId: x.questionId, topic: { id: x.topicId, name: names.get(lower(x.topicId)) ?? '' } };
    if (!reach(x)) return { ...base, removed: true, sentence: OUT_OF_REACH };
    if (!questions.has(key)) {
      return { ...base, removed: true, sentence: 'Your professor took this question out of the bank after your self-test began, so it is not asked.' };
    }
    if (isRoomsOnly(questions.get(key))) return { ...base, removed: true, sentence: KEPT_FOR_ROOMS };
    return {
      ...base,
      ...shown.get(key),
      answered: Boolean(a),
      // The student's own answer back, so a reload keeps their board; never a mark.
      response: a ? a.response ?? null : null,
      answeredAt: a ? a.createdAt : null,
    };
  });
  return {
    exam: head(run, now),
    questions: items,
    answered: items.filter((x) => x.answered).length,
    hints: NO_HINTS.exam,
    note: OPEN_NOTE,
  };
}

const MARK_LABEL = {
  auto: 'Marked by the computer from your professor\'s answer.',
  provisional: PROVISIONAL_NOTE,
};

export const UNANSWERED = 'Not answered, so not marked. Its answer is shown once you have tried it, in practice or in another self-test.';

/** An ended self-test: per question feedback and the personal summary. */
async function resultView(repo, account, run, attempts, now, scope) {
  const finals = new Map([...finalAnswers(run, attempts, now)].map(([k, a]) => [lower(k), a]));
  const late = attempts.filter((a) => Date.parse(a.createdAt) > Date.parse(run.endedAt)).length;
  const questions = await listedQuestions(repo, run);
  const wanted = await languageChoice(repo, account);
  const names = new Map((run.spec?.topics ?? []).map((t) => [lower(t.id), t.name]));
  // A question a class still running holds keeps its answer back here too (services/hubClosed.js).
  const live = await roomLiveQuestions(repo, [...new Set([...questions.values()].map((q) => String(q.contentId ?? ''))
    .concat(attempts.map((a) => String(a.contentId ?? ''))).filter(Boolean))]);
  const items = [];
  for (const [i, x] of (run.spec?.questions ?? []).entries()) {
    const key = lower(x.questionId);
    const a = finals.get(key) ?? null;
    // Unanswered and no longer reached: not read from the bank (the header's rule).
    const q = a || scope.topics.has(lower(x.topicId)) ? questions.get(key) ?? null : null;
    const outOfReach = !a && !scope.topics.has(lower(x.topicId));
    const held = Boolean(a) && live.has(key);
    // Kept for rooms only since: the answer stays handed in and marked, but the
    // question, its key and its explanation are not shown.
    const forRooms = isRoomsOnly(questions.get(key));
    const seed = hubSeed(account.id, x.questionId);
    // As it was shown: the attempt's own snapshot when there is one, else the bank's question now.
    const source = a?.questionSnapshot && typeof a.questionSnapshot === 'object' && Object.keys(a.questionSnapshot).length
      ? { ...a.questionSnapshot, _id: x.questionId, kind: a.kind ?? a.questionSnapshot.kind ?? 'mcq' }
      : q;
    let question = null;
    let solution = null;
    if (source && !forRooms) {
      try {
        const { _id, ...shown } = forStudent(source, seed);
        question = { ...shown, rich: await phoneRich(shown) };
        // The right answer only for a question answered: one left blank keeps
        // its key until the student has tried it (in practice or another
        // self-test), or handing in an empty self-test would show every key.
        if (a && !held) solution = score(source, a.response, seed).solution ?? null;
      } catch {
        question = { text: String(source.text ?? ''), kind: source.kind ?? 'mcq' };
      }
    }
    const mark = !a ? 'unmarked' : a.reviewStatus === 'provisional' ? 'provisional' : 'auto';
    let explanation = null;
    if (a && !held && !forRooms) {
      explanation = await explanationForStudent(repo, x.questionId, wanted).catch((err) => {
        console.error('[hub] an explanation could not be read:', err.message);
        return null;
      });
    }
    items.push({
      position: i + 1,
      questionId: x.questionId,
      topicId: x.topicId,
      topic: { id: x.topicId, name: names.get(lower(x.topicId)) ?? '', nameHtml: labelHtml(names.get(lower(x.topicId)) ?? '') },
      bloom: source?.bloom ?? a?.bloom ?? null,
      levelLabel: LEVEL_LABEL[source?.bloom ?? a?.bloom] ?? null,
      question,
      answered: Boolean(a),
      response: a ? a.response ?? null : null,
      correct: a ? a.correct === true : null,
      score: a ? a.score : null,
      detail: a ? a.detail ?? '' : '',
      mark,
      markLabel: a ? MARK_LABEL[mark] : outOfReach
        ? 'Not answered, and its chapter is no longer on your classes in the hub, so it is not shown or marked.'
        : (source ? UNANSWERED : 'Not answered, and your professor took this question out of the bank since, so it cannot be shown or marked.'),
      solution,
      explanation,
      // The professor's approved feedback on the wrong option(s) chosen (H13), as
      // practice gives it after an answer: here only once the self-test has ended.
      optionFeedback: a && !held && !forRooms ? await feedbackAfter(repo, { account, attempt: a }) : [],
      ...(held ? { held: true, heldNote: ROOM_HELD_NOTE } : {}),
      ...(forRooms ? { keptForRooms: true, keptForRoomsNote: KEPT_FOR_ROOMS } : {}),
    });
  }
  const summary = summarise(items.map((it) => ({ ...it, topicName: it.topic.name, bloom: it.bloom ?? 'unknown' })), run.spec?.topics ?? []);
  return {
    exam: head(run, now),
    ended: END_SENTENCE[run.endReason] ?? '',
    questions: items,
    summary,
    ...(late ? { lateNote: `${late} answer${late === 1 ? '' : 's'} reached the server after the end, so ${late === 1 ? 'it was' : 'they were'} kept but not counted.` } : {}),
    note: EXAM_NOTE,
  };
}

/** A self-test as its student sees it now: open (no marks) or ended (the result). Settles a time-out first. */
export async function examView(repo, account, run, { now = new Date() } = {}) {
  const settled = await settleExam(repo, run, now);
  const [attempts, scope] = await Promise.all([repo.listHubAttempts({ runIds: [String(settled._id)] }), studentScope(repo, account)]);
  return settled.endedAt ? resultView(repo, account, settled, attempts, now, scope) : openView(repo, account, settled, attempts, now, scope);
}

/** The student's self-tests, newest first: counts only, and right answers only once one has ended. */
export async function listExams(repo, account, { now = new Date() } = {}) {
  const runs = (await repo.listHubRuns({ accountId: String(account.id), kind: 'exam' })).reverse();
  const attempts = runs.length ? await repo.listHubAttempts({ runIds: runs.map((r) => String(r._id)) }) : [];
  const out = [];
  for (const raw of runs) {
    const run = await settleExam(repo, raw, now);
    const own = attempts.filter((a) => String(a.runId) === String(run._id));
    const total = (run.spec?.questions ?? []).length;
    if (!run.endedAt) {
      out.push({ ...head(run, now), answered: latestAnswers(own).size });
      continue;
    }
    const finals = [...finalAnswers(run, own, now).values()];
    out.push({
      ...head(run, now),
      answered: finals.length,
      right: finals.filter((a) => a.correct === true).length,
      sentence: `${finals.filter((a) => a.correct === true).length} of ${questionsWord(total)} right.`,
    });
  }
  return { exams: out, limits: { maxQuestions: MAX_EXAM_QUESTIONS, maxMinutes: MAX_TIME_LIMIT_MINUTES, graceSeconds: EXAM_GRACE_SECONDS } };
}
