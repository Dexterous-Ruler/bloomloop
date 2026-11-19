// The Learning Hub's practice loop (Phase 6, decisions H2, H5, H6, H10, H14).
//
// Over REST, for a signed-in student account; it shares nothing with a room's
// socket loop, moves no room ladder and writes nothing a room, attainment or
// the marks register reads (H5). Two calls:
//
//   nextQuestion   one APPROVED question on the topic(s) asked for, from the
//                  chapters placed on classes the student is on (the access
//                  rule, services/hubAccess.js), never one closed to them now
//                  (services/hubClosed.js: being asked in a room, on an open
//                  self-test, or asked by an open Get Ready check). Sent through forStudent(), the
//                  one function that decides what a student may see, with the
//                  formulas and code rendered (`rich`, H15) and who wrote it in
//                  a student's words: never a key, rubric or explanation. Polls
//                  are left out (they assess nothing), and so are questions
//                  showing an uploaded image, which a student's hub cannot load
//                  yet (the image rule serves an upload only through a running
//                  room, services/media.js). Chosen by the topic's Elo ratings
//                  (services/hubElo.js): a question the student has not met,
//                  whose estimated chance of a right answer is nearest
//                  TARGET_RIGHT; once every question has been met, the one
//                  answered wrong last, then the one met longest ago. Stateless:
//                  the shuffle is seeded by the student and the question
//                  (hubSeed), so the server recomputes it when the answer comes.
//
//                  Batch 9: a drawing question (E4) is served like any other;
//                  its attempt carries the picture itself, { image, text? }
//                  (a data URL or base64 of a PNG or WebP picture, capped as a
//                  room's), which is kept as the student's own drawing and
//                  stored on the attempt as { mediaId, text }. The hub has nobody
//                  to mark it, so it carries no mark and counts nowhere. A
//                  written answer over its word limit (E3) is refused before
//                  anything is stored.
//
//   recordAttempt  marks the answer on the server from the stored question
//                  (score() in questionTypes.js; a client's own verdict is never
//                  read) and stores it, append-only, in hub_attempts (0026). In
//                  practice and review sets an answer to a closed question is
//                  refused (409) before anything is stored: its feedback would
//                  show what the room, the self-test or the check keeps back. The
//                  client's attempt id is the idempotency key: a resend is
//                  answered from the stored row and never makes a second one. A
//                  written answer's mark is a provisional machine mark and says
//                  so (H10). feedbackFor() then builds what the student is told:
//                  right or wrong, the right answer, the approved explanation
//                  (H14), and the topic's state after it. None of that exists
//                  before an attempt does.
//
// Hints plug in at services/hubHintHook.js: the payload's `hints`, the
// attempt's hints used and the feedback on a wrong option chosen come only
// from there.

import { isRecordId } from '../ids.js';
import { levelIndex } from '../bloom.js';
import {
  FIGURES_NOT_READY, NOT_A_DRAWING, awaitsReview, drawingTextProblem, forStudent, readyToMark, responseProblem, score,
} from '../questionTypes.js';
import { HUB_DRAWING_NOTE, keepHubDrawing } from './drawings.js';
import { snapshotOf } from '../sockets/index.js';
import { needsApproval } from './edits.js';
import { phoneProvenance } from './honesty.js';
import { labelHtml, phoneRich } from './richText.js';
import { notFound, studentReach } from './hubAccess.js';
import { inTopicOrder, topicMatcher } from './hubTopics.js';
import {
  START_SKILL, attemptOrder, itemKeyOf, pRight, replayTopic, seedFor, topicState, typicalDifficulty,
} from './hubElo.js';
import { REVIEW_SET_SIZE, dueWords, reviewState } from './hubReview.js';
import { feedbackAfter, hintsOffered } from './hubHintHook.js';
import { explanationForStudent } from './hubExplanations.js';
import {
  attemptLanguage, languageChoice, localiseQuestion, servableTranslations, shownLanguage,
} from './hubLanguages.js';
import { countedAttempts } from './hubHeld.js';
import { closedError, closedQuestions } from './hubClosed.js';
import { isRoomsOnly } from './bankShare.js';
import { UNPROVEN_NOTE, checkServeToken, serveToken } from './serveTokens.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Every mode a hub attempt may carry (H5). */
export const ATTEMPT_MODES = Object.freeze(['practice', 'exam', 'getready', 'review', 'lesson']);
/** The modes this loop serves itself; the others belong to their own builders and call recordAttempt(). */
export const PRACTICE_MODES = Object.freeze(['practice', 'review']);

/**
 * The chance of a right answer a practice question is chosen near: hard enough
 * to be worth answering, easy enough to keep going. Decision 2's promotion line.
 */
export const TARGET_RIGHT = 0.7;
/** The most topics one practice set mixes. */
export const MAX_TOPICS_PER_SET = 20;
/** The longest response stored, as JSON text: a written answer of several pages fits. */
export const MAX_RESPONSE_CHARS = 20000;

export const NO_QUESTION = 'That question was not found.';
export const STUDENT_ONLY = 'Practice is for a student account. Staff see their students\' progress through the class.';
export const NO_QUESTIONS_YET = 'Your professor has not approved any practice questions for this topic yet.';
export const ALL_CLOSED = 'Every question you could practise here is closed for now: part of a class that is still running, on a self-test you have '
  + 'not handed in, or the one your Get Ready check is asking. Come back once that is done.';
export const PROVISIONAL_NOTE = 'This written answer was marked by matching its words against your professor\'s points. '
  + 'It is a provisional machine mark, not your professor\'s.';
/** A practice drawing's stored detail (Batch 9): the hub never marks one. */
export const HUB_DRAWING_DETAIL = 'not marked: a drawing';
/** A picture sent with an answer to a question that is not answered by drawing. */
export const NOT_A_DRAWING_HERE = 'This question is not answered with a drawing. Send your answer without the picture.';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** A client's attempt id, if it is a plausible one; '' otherwise. */
export function cleanAttemptId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** The shuffle seed of a hub question for one student: stable, so a reload shows the same board. */
export const hubSeed = (accountId, questionId) => `hub:${accountId}:${questionId}`;

/**
 * May practice serve this question now? Approved, not a poll, no uploaded image,
 * and not kept for rooms only (Batch 8, services/bankShare.js): every hub
 * builder (practice, reviews, self-tests, Get Ready) reads its questions here.
 */
export const practisable = (q) => (q?.status ?? 'active') === 'active' && (q?.kind ?? 'mcq') !== 'poll'
  && q?.stimulus?.kind !== 'image' && !isRoomsOnly(q);

/**
 * Was this question ever approved? Approved now, or retired after it was
 * approved (a regenerated or discarded question a student was already looking
 * at). Never a draft or a rejected draft, which no student was ever shown.
 */
export const wasApproved = (q) => Boolean(q) && ((q.status ?? 'active') === 'active' || (q.status === 'discarded' && !needsApproval(q)));

/**
 * May an answer to this question be stored? Anything practice could have
 * served: a question once approved (wasApproved), not a poll, no uploaded image.
 * A question kept for rooms only is included: practice may have served it
 * before the switch, and its answer is kept (never discarded); what the hub no
 * longer does is serve it, show its key or explain it (feedbackFor).
 */
export const onceServable = (q) => wasApproved(q) && (q.kind ?? 'mcq') !== 'poll' && q.stimulus?.kind !== 'image';

/* ---------------------------------------------------------------- scope -- */

/**
 * The live topic records of these chapters, in the order given, each with its
 * questions (matched by name within the chapter, services/hubTopics.js).
 * `chapterList`: [{ contentId, classIds, unit? }]. A chapter that is gone is
 * left out.
 *
 * @returns {Promise<{ topics: Map<string, { topic, content, classIds: string[], unit, questions: object[], all: object[] }>,
 *   chapters: Map<string, { content, match: (topic: string) => object|null, classIds: string[] }> }>}
 *   keyed by id in lower case; `questions` are practisable now, `all` every
 *   question of the topic (discarded included); `match` finds a topic string's
 *   record in the chapter (retired ones included).
 */
export async function scopeOfChapters(repo, chapterList = []) {
  const topics = new Map();
  const chapters = new Map();
  for (const ch of chapterList) {
    const content = await repo.getContent(ch.contentId).catch(() => null);
    if (!content || chapters.has(lower(content._id))) continue;
    const [records, questions] = await Promise.all([
      repo.listChapterTopics(content._id),
      repo.listQuestions(content._id, { includeDiscarded: true }),
    ]);
    const match = topicMatcher(records);
    chapters.set(lower(content._id), { content, match, classIds: ch.classIds ?? [] });
    for (const r of inTopicOrder(records)) {
      if (!r.retiredAt) {
        topics.set(lower(r._id), { topic: r, content, classIds: ch.classIds ?? [], unit: ch.unit ?? null, questions: [], all: [] });
      }
    }
    for (const q of questions) {
      const entry = topics.get(lower(match(q.topic)?._id));
      if (!entry) continue;
      entry.all.push(q);
      if (practisable(q)) entry.questions.push(q);
    }
  }
  return { topics, chapters };
}

/**
 * Everything a student may practise: each live topic record of every chapter
 * placed on their classes (the access rule, services/hubAccess.js).
 *
 * @returns {Promise<{ classes: object[], topics: Map, chapters: Map }>} as scopeOfChapters
 */
export async function studentScope(repo, account) {
  const { classes, placements } = await studentReach(repo, account);
  const chapters = new Map();
  for (const cls of classes) {
    for (const p of placements.get(String(cls._id)) ?? []) {
      const key = lower(p.contentId);
      if (!chapters.has(key)) chapters.set(key, { contentId: p.contentId, classIds: [] });
      chapters.get(key).classIds.push(String(cls._id));
    }
  }
  return { classes, ...(await scopeOfChapters(repo, [...chapters.values()])) };
}

/** The topic ids a request names ("a,b" or a list), each a live topic of the scope, or the topic's 404. */
export function topicEntries(scope, raw) {
  const ids = [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(','))
    .map((x) => lower(x)).filter(Boolean))];
  if (!ids.length) throw fail('Choose a topic to practise.', 400);
  if (ids.length > MAX_TOPICS_PER_SET) throw fail(`A practice set mixes at most ${MAX_TOPICS_PER_SET} topics.`, 400);
  return ids.map((id) => {
    const entry = isRecordId(id) ? scope.topics.get(id) : null;
    if (!entry) throw notFound('topic');
    return entry;
  });
}

/* --------------------------------------------------------------- models -- */

/**
 * Each topic's ratings from every hub attempt on it, by every student
 * (services/hubElo.js), with the typical question's difficulty. A self-test's
 * answers count only once it has ended (services/hubHeld.js).
 *
 * @returns {Promise<Map<string, { entry, attempts, replay, difficulty: (q) => number, typical: number }>>}
 */
export async function topicModels(repo, entries, { now = new Date() } = {}) {
  const ids = entries.map((e) => String(e.topic._id));
  const rows = ids.length ? await countedAttempts(repo, await repo.listHubAttempts({ topicIds: ids }), now) : [];
  const byTopic = new Map();
  for (const a of rows) {
    const key = lower(a.topicId);
    if (!byTopic.has(key)) byTopic.set(key, []);
    byTopic.get(key).push(a);
  }
  const out = new Map();
  for (const entry of entries) {
    const attempts = byTopic.get(lower(entry.topic._id)) ?? [];
    const replay = replayTopic(attempts);
    const difficulty = (q) => replay.items.get(String(q._id))?.difficulty ?? seedFor(q.bloom);
    out.set(lower(entry.topic._id), { entry, attempts, replay, difficulty, typical: typicalDifficulty(entry.questions.map(difficulty)) });
  }
  return out;
}

/** A review's due state as a screen shows it. */
export function reviewView(review, now = new Date()) {
  return {
    dueAt: review.dueAt,
    due: review.due,
    when: review.dueAt ? dueWords(review.dueAt, now) : '',
    sessions: review.sessions,
    lastRating: review.lastRating,
  };
}

/**
 * One student's state on one topic, from its model (H6, H8). `reachable` is
 * the most answers its estimate can rest on with the questions approved now:
 * those already counted, and one more for each practisable question the
 * student has not answered yet (an estimate counts a question once,
 * services/hubElo.js), so the state never promises what the bank cannot give.
 */
export function stateFrom(model, accountId, { now = new Date(), audience = 'student' } = {}) {
  const who = String(accountId);
  const s = model.replay.students.get(who);
  const own = model.attempts.filter((a) => String(a.accountId) === who);
  const met = new Set(own.filter((a) => typeof a.correct === 'boolean').map((a) => lower(itemKeyOf(a))));
  // A drawing (Batch 9) never gives an estimate an answer: the hub does not mark it.
  const reachable = (s?.answers ?? 0) + (model.entry?.questions ?? []).filter((q) => !met.has(lower(q._id)) && !awaitsReview(q)).length;
  const review = reviewState(own, now);
  return {
    ...topicState({
      answers: s?.answers ?? 0, attempts: s?.attempts ?? 0, skill: s?.skill ?? START_SKILL, typical: model.typical, reviewDue: review.due, reachable,
    }, { audience }),
    review: reviewView(review, now),
  };
}

export const topicRef = (entry) => ({
  id: String(entry.topic._id),
  name: entry.topic.name,
  nameHtml: labelHtml(entry.topic.name),
  chapter: { id: String(entry.content._id), title: entry.content.title ?? '', titleHtml: labelHtml(entry.content.title ?? '') },
});

/* ------------------------------------------------------------- choosing -- */

/** FNV-1a: a stable tie-break, so two equal candidates are not always taken in the same order. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Which candidate comes next (the header's rule). Pure.
 *
 * `candidates`: [{ q, entry }]; `skillOf(c)` the student's skill on its topic;
 * `difficultyOf(c)` its question's difficulty; `mine` the student's attempts on
 * these topics; `seed` varies the tie-break.
 *
 * @returns {{ q, entry, fresh: boolean, lastRight: boolean|null }|null}
 */
export function chooseNext(candidates = [], { skillOf, difficultyOf, mine = [], seed = '' } = {}) {
  if (!candidates.length) return null;
  const ordered = [...mine].sort(attemptOrder);
  const tried = new Map();
  for (const a of ordered) tried.set(itemKeyOf(a), { lastAt: a.createdAt, lastRight: a.correct });
  const lastKey = ordered.length ? itemKeyOf(ordered[ordered.length - 1]) : null;
  // Not the question just answered, unless it is the only one.
  const pool = candidates.length > 1 ? candidates.filter((c) => String(c.q._id) !== lastKey) : candidates;
  const closeness = (c) => Math.round(Math.abs(pRight(skillOf(c), difficultyOf(c)) - TARGET_RIGHT) * 1e9);
  const tie = (c) => hash(`${seed}:${c.q._id}`);
  const fresh = pool.filter((c) => !tried.has(String(c.q._id)));
  if (fresh.length) {
    fresh.sort((a, b) => (closeness(a) - closeness(b)) || (levelIndex(a.q.bloom) - levelIndex(b.q.bloom)) || (tie(a) - tie(b)));
    return { ...fresh[0], fresh: true, lastRight: null };
  }
  const met = (c) => tried.get(String(c.q._id));
  const again = [...pool].sort((a, b) => (Number(met(a).lastRight) - Number(met(b).lastRight))
    || attemptOrder({ createdAt: met(a).lastAt }, { createdAt: met(b).lastAt })
    || (closeness(a) - closeness(b)) || (tie(a) - tie(b)));
  return { ...again[0], fresh: false, lastRight: met(again[0]).lastRight };
}

const answersWord = (n) => `${n} answer${n === 1 ? '' : 's'}`;

/** Why this question, in a student's words. */
export function whySentence(pick, answers) {
  if (pick.fresh && !answers) return 'You have not practised this topic yet, so this question starts near its middle.';
  if (pick.fresh) return `Chosen to be about the right challenge for you now, from your ${answersWord(answers)} on this topic.`;
  if (pick.lastRight === false) return 'You have met every question here. You answered this one wrong last time, so it comes back first.';
  return 'You have met every question here. This is the one you saw longest ago.';
}

/**
 * The next question for a student on the topic(s) asked for.
 *
 * @returns {Promise<object>} `{ question: null, message }` when the topics have no approved question yet.
 */
export async function nextQuestion(repo, account, { topicIds, mode = 'practice', now = new Date() } = {}) {
  if (!PRACTICE_MODES.includes(mode)) throw fail('Practice serves practice and review sets.', 400);
  const scope = await studentScope(repo, account);
  const entries = topicEntries(scope, topicIds);
  const all = entries.flatMap((entry) => entry.questions.map((q) => ({ q, entry })));
  const topics = entries.map(topicRef);
  if (!all.length) return { mode, question: null, topics, message: NO_QUESTIONS_YET };
  const closed = await closedQuestions(repo, account, { contentIds: entries.map((e) => String(e.content._id)), scope, now });
  const candidates = all.filter((c) => !closed.has(lower(c.q._id)));
  if (!candidates.length) return { mode, question: null, topics, message: ALL_CLOSED };
  const models = await topicModels(repo, entries);
  const who = String(account.id);
  const modelOf = (c) => models.get(lower(c.entry.topic._id));
  const mine = [...models.values()].flatMap((m) => m.attempts.filter((a) => String(a.accountId) === who));
  const pick = chooseNext(candidates, {
    skillOf: (c) => modelOf(c).replay.students.get(who)?.skill ?? START_SKILL,
    difficultyOf: (c) => modelOf(c).difficulty(c.q),
    mine,
    seed: `${who}:${mine.length}`,
  });
  const model = modelOf(pick);
  const state = stateFrom(model, who, { now });
  // The student's language (H12): an approved, current translation, or English
  // with a plain note. The attempt echoes what was shown, and records it.
  const wanted = await languageChoice(repo, account);
  const translation = (await servableTranslations(repo, { kind: 'question', items: [pick.q], language: wanted }))
    .get(lower(pick.q._id)) ?? null;
  const lang = shownLanguage({ kind: 'question', wanted, translation });
  const shown = localiseQuestion(pick.q, forStudent(pick.q, hubSeed(who, pick.q._id)), translation);
  return {
    mode,
    language: lang.language,
    translationId: lang.translationId,
    languageNote: lang.note,
    question: { ...shown, provenance: phoneProvenance(pick.q), rich: await phoneRich(shown) },
    // Batch 8: the proof that practice served this question to this student,
    // sent back with the answer (services/serveTokens.js).
    serveToken: serveToken({ accountId: who, questionId: pick.q._id, mode, now }),
    topic: topicRef(pick.entry),
    topics,
    why: whySentence(pick, state.answers),
    hints: await hintsOffered(repo, { account, question: pick.q, topicId: String(pick.entry.topic._id), mode, state, closed }),
    ...(mode === 'review' ? { setSize: REVIEW_SET_SIZE } : {}),
  };
}

/* ------------------------------------------------------------ recording -- */

const round3 = (x) => Math.round(Math.max(0, Math.min(1, Number(x) || 0)) * 1000) / 1000;

/** The device's time taken, if it is a plausible one; null otherwise. Never trusted for marking. */
const timeTaken = (v) => (Number.isInteger(v) && v >= 0 && v <= 86400000 ? v : null);

/**
 * Mark and store one attempt (H5). Any mode in ATTEMPT_MODES: the practice
 * route sends practice and review, and the self-test, Get Ready and lesson
 * builders call this with theirs.
 *
 * @param {object} body  { attemptId, questionId, topicId, response, mode, timeTakenMs, shown? }
 *                       `shown`: { language, translationId } as the next question said
 * @param {object} opts  { now, hintsUsed, language, runId } - hints and language are the server's to say;
 *                       without `language`, the one shown (attemptLanguage, services/hubLanguages.js);
 *                       `runId` the Get Ready check or self-test the answer was given in (0028)
 * @returns {Promise<{ attempt, duplicate: boolean, entry: object|null }>}
 */
export async function recordAttempt(repo, account, body = {}, {
  now = new Date(), hintsUsed = 0, language = null, runId = null, requireServed = false,
} = {}) {
  const attemptId = cleanAttemptId(body.attemptId);
  if (!attemptId) throw fail('Each attempt needs its own id: 8 to 64 letters, digits, - or _.', 400);
  const mode = body.mode ?? 'practice';
  if (!ATTEMPT_MODES.includes(mode)) throw fail(`An attempt's mode is one of ${ATTEMPT_MODES.join(', ')}.`, 400);
  const who = String(account.id);
  // A resend is answered from the stored row, before anything else is read, so
  // an answer already kept is never refused later for any reason.
  const held = await repo.getHubAttemptByKey(who, attemptId);
  if (held) return { attempt: held, duplicate: true, entry: null };
  // Batch 8: practice counts an answer only to a question it served to this
  // student, proved by the token its reply carried (services/serveTokens.js).
  // Without that proof it is kept as unproven: counted nowhere, told no mark.
  const unproven = requireServed && !checkServeToken(body.serveToken, { accountId: who, questionId: body.questionId, mode }).ok;

  // A drawing's picture (Batch 9) travels inside the answer, and is measured
  // by the drawing's own cap (services/drawings.js), not the answer's length.
  const sent = body.response;
  const image = sent && typeof sent === 'object' && !Array.isArray(sent) && 'image' in sent ? sent.image : undefined;
  const rest = image === undefined ? sent : Object.fromEntries(Object.entries(sent).filter(([k]) => k !== 'image'));
  let responseText;
  try {
    responseText = JSON.stringify(rest ?? null);
  } catch {
    throw fail('The answer could not be read.', 400);
  }
  if (responseText.length > MAX_RESPONSE_CHARS) throw fail(`An answer can be at most ${MAX_RESPONSE_CHARS} characters.`, 400);

  const scope = await studentScope(repo, account);
  const [entry] = topicEntries(scope, [body.topicId]);
  const qid = lower(body.questionId);
  const q = isRecordId(qid) ? entry.all.find((x) => lower(x._id) === qid) : null;
  if (!onceServable(q)) throw fail(NO_QUESTION, 404);
  // Practice and review show the answer at once: never on a question closed to
  // this student now. Refused before anything is stored; the device keeps it.
  if (PRACTICE_MODES.includes(mode)) {
    const why = (await closedQuestions(repo, account, { contentIds: [String(entry.content._id)], scope, now })).get(qid);
    if (why) throw closedError(why);
  }

  // A tap or label answer on a diagram or molecule needs the drawing engines to
  // be marked; until they are up it is not taken, and the device sends it again.
  if (!(await readyToMark(q))) throw fail(FIGURES_NOT_READY, 503);
  const kind = q.kind ?? 'mcq';
  // Batch 9: what the kind cannot take is refused before anything is stored. A
  // drawing's words are checked before its picture is kept, then the picture
  // is kept under this attempt's id and the attempt names it.
  let response = rest ?? null;
  if (awaitsReview(q)) {
    if (image === undefined || image === null) throw fail(NOT_A_DRAWING, 400);
    for (const k of Object.keys(rest ?? {})) if (k !== 'text') throw fail(NOT_A_DRAWING, 400);
    const why = drawingTextProblem(q, rest?.text);
    if (why) throw fail(why, 400);
    const { media } = await keepHubDrawing(repo, {
      accountId: who, contentId: String(entry.content._id), questionId: String(q._id), answerKey: attemptId, image,
    });
    const text = typeof rest?.text === 'string' && rest.text.trim() ? rest.text : null;
    response = { mediaId: String(media._id), ...(text ? { text } : {}) };
  } else {
    if (image !== undefined) throw fail(NOT_A_DRAWING_HERE, 400);
    const why = responseProblem(q, response);
    if (why) throw fail(why, 400);
  }
  // Marked here, from the stored question, with the seed it was shown with. A
  // drawing is not marked at all (score() says so, with no verdict).
  const graded = score(q, response, hubSeed(who, q._id), null);
  const unmarked = awaitsReview(q);
  // The language it was shown in: the screen's echo, believed only when it can have been true (H12).
  const shownIn = language ?? (await attemptLanguage(repo, {
    item: q, claim: body.shown ?? null, wanted: await languageChoice(repo, account),
  })).language;
  const { attempt, duplicate } = await repo.addHubAttempt({
    accountId: who,
    clientAttemptId: attemptId,
    classId: entry.classIds[0] ?? null,
    contentId: String(entry.content._id),
    topicId: String(entry.topic._id),
    topic: entry.topic.name,
    questionId: String(q._id),
    bloom: q.bloom,
    kind,
    questionSnapshot: snapshotOf(q),
    questionSource: q.source ?? 'llm',
    response,
    // A drawing (Batch 9) carries no mark: the hub has nobody to give one.
    correct: unmarked ? null : graded.correct === true,
    score: unmarked ? null : round3(graded.score),
    detail: unmarked ? HUB_DRAWING_DETAIL : graded.detail ?? '',
    // A written answer is marked by matching rubric words: a first reading,
    // not a verdict, as in a room.
    reviewStatus: kind === 'open' ? 'provisional' : 'auto',
    mode,
    language: shownIn,
    hintsUsed: Math.max(0, Math.min(3, Number(hintsUsed) || 0)),
    timeTakenMs: timeTaken(body.timeTakenMs),
    ...(runId ? { runId: String(runId) } : {}),
    ...(unproven ? { unproven: true } : {}),
    createdAt: now.toISOString(),
  });
  return { attempt, duplicate, entry };
}

/**
 * What the student is told about an attempt that exists: right or wrong, the
 * right answer (in the positions they were shown), the machine's detail, the
 * approved explanation, and the topic's state now. `entry` is the topic's scope
 * entry when the caller has it; without one (a resend) it is looked up, and a
 * topic the student no longer reaches is simply left out.
 */
export async function feedbackFor(repo, account, attempt, { now = new Date(), entry = null, duplicate = false } = {}) {
  const qid = itemKeyOf(attempt);
  const head = {
    id: String(attempt._id),
    attemptId: attempt.clientAttemptId,
    mode: attempt.mode,
    createdAt: attempt.createdAt,
    language: attempt.language ?? 'en',
    hintsUsed: attempt.hintsUsed ?? 0,
  };
  // Batch 8: an answer kept without proof the hub served its question
  // (services/serveTokens.js) is told it is saved, and nothing else: its mark,
  // key, explanation or option feedback would let a student read the key of any
  // question one id at a time. The same on every resend.
  if (attempt.unproven) {
    return {
      attempt: head, duplicate, counted: false, unproven: true, note: UNPROVEN_NOTE,
      correct: null, score: null, detail: '', solution: null, explanation: null, optionFeedback: [], topic: null,
    };
  }
  // A question kept for rooms only since it was served: the answer is kept and
  // marked, but the hub neither shows its key nor explains it (Batch 8, 0035).
  const current = await repo.getQuestion(qid).catch(() => null);
  const roomsOnly = isRoomsOnly(current);
  const snap = attempt.questionSnapshot && typeof attempt.questionSnapshot === 'object' ? attempt.questionSnapshot : {};
  let solution = null;
  try {
    if (!roomsOnly) solution = score({ ...snap, _id: qid, kind: attempt.kind ?? snap.kind ?? 'mcq' }, attempt.response, hubSeed(attempt.accountId, qid)).solution ?? null;
  } catch {
    solution = null;
  }
  let explanation = null;
  try {
    if (!roomsOnly) explanation = await explanationForStudent(repo, qid, await languageChoice(repo, account));
  } catch (err) {
    // Without 0026's explanations table the answer is still marked and kept.
    console.error('[hub] an explanation could not be read:', err.message);
  }
  let topic = null;
  try {
    const found = entry ?? (await studentScope(repo, account)).topics.get(lower(attempt.topicId)) ?? null;
    if (found) {
      const model = (await topicModels(repo, [found])).get(lower(found.topic._id));
      topic = { ...topicRef(found), state: stateFrom(model, account.id, { now }) };
    }
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const provisional = attempt.reviewStatus === 'provisional';
  // A drawing (Batch 9): kept, not marked, and said so.
  const drawing = attempt.kind === 'drawing' ? { notMarked: true, note: HUB_DRAWING_NOTE } : {};
  // HINT HOOK (H13): the professor's approved feedback on the wrong option(s) chosen, after the attempt only.
  const optionFeedback = roomsOnly ? [] : await feedbackAfter(repo, { account, attempt });
  return {
    attempt: head,
    duplicate,
    correct: attempt.correct,
    score: attempt.score,
    detail: attempt.detail ?? '',
    ...(provisional ? { provisional: true, provisionalNote: PROVISIONAL_NOTE } : {}),
    ...drawing,
    solution,
    explanation,
    optionFeedback,
    topic,
  };
}
