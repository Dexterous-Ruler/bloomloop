// Phase 1 - reading the evidence back.
//
// Every attempt a student makes is one row in `answers` (0008), written once and
// never overwritten (sockets/index.js). This module turns those rows into what a
// screen may show. Nothing in it writes.
//
// Three things live here because more than one route needs each of them, and
// two copies of any of them would drift:
//   items    one answer as a professor sees it (answerItem) and as the student
//            who gave it sees it (redactForStudent). The student's copy is
//            built field by field, never by deleting from the professor's.
//   topics   per topic x per level accuracy, mined from the answers, with the
//            profile history standing in for attempts older than the store.
//   paging   one reading of ?limit=&offset=, so every list refuses the same way.
//
// Who may ask is not decided here. Callers pass rooms that a route has already
// vetted: ownership.js for a room, the subject list in services/analytics.js
// for a student.

import { LEVELS } from '../bloom.js';
import { forStudent, toOriginalResponse } from '../questionTypes.js';
import { awaitingMark } from './drawings.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_OFFSET = 100000;

/**
 * PostgREST returns at most its max-rows setting (1000 by default) per request,
 * whatever `limit` asks for, so anything that needs every row reads in pages of
 * this size and stops at the first short page.
 */
const READ_PAGE = 1000;

/* ------------------------------------------------------------- the query -- */

function whole(raw, fallback, name, min, max) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw fail(`${name} must be a whole number from ${min}${Number.isFinite(max) ? ` to ${max}` : ' up'}.`, 400);
  }
  return n;
}

/** ?limit=&offset= off the query string, or an honest 400. The same bounds as the review queue. */
export function pageFrom(query = {}) {
  return {
    limit: whole(query.limit, DEFAULT_LIMIT, 'limit', 1, MAX_LIMIT),
    // Bounded: a huge offset is a range PostgREST refuses with a 500, and no
    // screen pages 100,000 rows deep. Past this, narrow with a filter instead.
    offset: whole(query.offset, 0, 'offset', 0, MAX_OFFSET),
  };
}

/**
 * A Bloom level off the query string, or an honest 400. Spelled the British way,
 * as the store spells it: a filter for 'analyze' would match nothing, silently.
 */
export function levelFrom(raw) {
  const level = String(raw ?? '').trim().toLowerCase();
  if (!level) return '';
  if (!LEVELS.includes(level)) throw fail(`level must be one of ${LEVELS.join(', ')}.`, 400);
  return level;
}

/**
 * A roll number the way the live room stores it (normaliseRoll in
 * sockets/index.js): trimmed, single-spaced, upper case. An account's roll number
 * is typed by a person, so it is compared in this form or not at all.
 */
export const rollKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/* ----------------------------------------------------------------- items -- */

/**
 * The question as the student saw it, rebuilt from the stored snapshot by
 * forStudent() - the function, and the seed, the live loop used to send it.
 *
 * Two things follow from reusing it. The answer key cannot leak: forStudent() is
 * the one place that decides what a phone may see, it builds its output field by
 * field for every kind, and roundtrip.mjs holds it to that. And the response
 * lines up: match, order, rank, categorise and dropdown answers are SHOWN
 * positions, which only mean something beside the order they were shown in.
 *
 * One limit, stated rather than hidden: the fewer-choices support
 * (accommodations.js) shortens an mcq or multi list for one student. Answers
 * stored since Phase 2's item statistics keep which options were left
 * (`shownOptions` on the snapshot, written by the live loop), but this function
 * does not read it yet. For a student who had the support, the list here is the
 * full one, and their response is a position in the shorter list they actually
 * saw; services/itemStats.js does read it, so the option counts are right.
 *
 * A snapshot too broken to rebuild (an old or hand-edited row) comes back as its
 * text alone rather than failing the whole page it is on.
 */
export function shownQuestion(answer) {
  const snap = answer?.questionSnapshot && typeof answer.questionSnapshot === 'object' ? answer.questionSnapshot : {};
  const questionId = String(snap.id || answer?.questionId || '');
  const kind = answer?.kind ?? snap.kind ?? 'mcq';
  try {
    const { _id, ...shown } = forStudent({ ...snap, _id: questionId, kind }, `${answer?.rollNo ?? ''}:${questionId}`);
    return shown;
  } catch {
    return { text: String(snap.text ?? ''), bloom: answer?.bloom ?? null, topic: answer?.topic ?? '', kind };
  }
}

const roomOf = (room) => ({ code: room?.code ?? null, title: room?.title ?? '', startedAt: room?.startedAt ?? null });

/**
 * One answer as the student who gave it may see it. THE redaction: every
 * student-facing read of an answer goes through this function.
 *
 * Built field by field from the stored row, never by deleting fields from the
 * professor's copy. A field added to the row later is then absent here until
 * somebody adds it on purpose, which is the direction to fail in.
 *
 * In: what they were asked, as they saw it; what they sent; whether it counted
 * as right and the score in force; the review status and the professor's note.
 * Out, for every kind: the answer key, rubric and any model answer (all in the
 * snapshot, which never leaves), the solution, and the machine's own reading -
 * `auto_*`, and `detail`, which is that same reading in words and on a written
 * answer a professor overrode would contradict the mark in force.
 *
 * That rule is for this read: stored answers, any time later, across rooms. The
 * live phone is told more, once, about the question it has just finished: its
 * solution (for a written answer, the rubric points, which the phone shows as
 * what a full answer makes) and the machine's detail while that mark is in force
 * (server:result in sockets/index.js). Keeping keys out of the history stops it
 * becoming a list of every key a student has met, ready for the next room that
 * serves the same bank.
 */
export function redactForStudent(answer, room) {
  return {
    answerId: String(answer?._id ?? ''),
    room: roomOf(room),
    topic: answer?.topic ?? '',
    level: answer?.bloom ?? null,
    kind: answer?.kind ?? 'mcq',
    question: shownQuestion(answer),
    response: answer?.response ?? null,
    // Null on a poll: it assesses nothing, and the row stores no mark for it.
    correct: answer?.correct ?? null,
    score: answer?.score ?? null,
    ungraded: answer?.ungraded === true,
    review: {
      status: answer?.reviewStatus ?? 'auto',
      note: answer?.reviewNote ?? '',
      reviewedAt: answer?.reviewedAt ?? null,
    },
    attempt: answer?.attempt ?? 1,
    final: answer?.final !== false,
    answeredAt: answer?.answeredAt ?? null,
  };
}

/**
 * One answer in full, for a professor or HOD who may read its room: the
 * student's view, plus who gave it, the snapshot exactly as stored (answer key,
 * rubric and all), and the machine's first reading beside the mark in force.
 */
export function answerItem(answer, room, { name = '' } = {}) {
  const view = redactForStudent(answer, room);
  return {
    ...view,
    student: { rollNo: answer?.rollNo ?? '', name, accountId: answer?.accountId ?? null },
    // The idempotency key the row was stored under (Batch 8): the phone's own
    // answerId, or one the server made, so a console can tie an item a phone's
    // outbox sent to the row it became. Staff only.
    answerKey: answer?.answerKey ?? null,
    questionId: answer?.questionId ?? null,
    snapshot: answer?.questionSnapshot ?? {},
    detail: answer?.detail ?? '',
    auto: {
      correct: answer?.autoCorrect ?? null,
      score: answer?.autoScore ?? null,
      detail: answer?.autoDetail ?? '',
    },
    review: { ...view.review, reviewedBy: answer?.reviewedBy ?? null },
    servedAt: answer?.servedAt ?? null,
    questionSource: answer?.questionSource ?? 'llm',
    // The language the answer was given in (0008; 'en' on every row today), so
    // a screen can say when it was not the question's own (Phase 5).
    language: answer?.language ?? 'en',
    // A vote in a class question (Phase 5): which one, and which round (2 is
    // the re-vote after discussion); null for every other answer. The
    // confidence tap is not here: staff see it as counts, never per answer.
    classQuestion: answer?.classQuestionId ? { id: String(answer.classQuestionId), round: Number(answer.round) || null } : null,
    // Batch 8: a tap or label answer in the parts' own names. The phone sent
    // tokens that only that student's copy of the figure can read.
    ...(PART_KINDS.includes(answer?.kind) ? { parts: partsAnswered(answer) } : {}),
  };
}

/** The kinds a phone answers in per-student tokens (questionTypes.js). */
const PART_KINDS = ['hotspot', 'label'];

/**
 * A tap or label answer as a professor reads it: the parts tapped, by name, or
 * each part with the label put on it. Rebuilt from the snapshot and the seed
 * the live loop used, as shownQuestion() is; null when the snapshot is too
 * broken to rebuild.
 */
function partsAnswered(answer) {
  const snap = answer?.questionSnapshot && typeof answer.questionSnapshot === 'object' ? answer.questionSnapshot : {};
  const questionId = String(snap.id || answer?.questionId || '');
  const q = { ...snap, _id: questionId, kind: answer.kind };
  try {
    const got = toOriginalResponse(q, answer.response, `${answer?.rollNo ?? ''}:${questionId}`);
    if (answer.kind === 'hotspot') return { tapped: got };
    const labels = [...q.placements.map((p) => p.label), ...(Array.isArray(q.distractors) ? q.distractors : [])];
    return { placed: q.placements.map((p, i) => ({ part: p.target, label: got[i] === null ? null : labels[got[i]] })) };
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- topics -- */

/**
 * The graded evidence behind a topic report: one row per answer that counted.
 *
 * Answer rows are the source. Only final attempts count (a wrong attempt that
 * was followed by a retry never did), and polls are left out (they assess
 * nothing). A history entry with no `answerId` was written before the evidence
 * store existed and has no row, so it is counted from the profile instead; a
 * room run entirely before the store therefore comes wholly from its history.
 * Every entry written since carries the `answerId` of a row - the live loop
 * writes the row first - so nothing is counted twice.
 */
export function gradedEvidence({ answers = [], profiles = [] } = {}) {
  const rows = [];
  const counted = { answers: 0, history: 0 };
  for (const a of answers) {
    if (a?.final === false || a?.ungraded || !LEVELS.includes(a?.bloom)) continue;
    // A drawing still waiting for its professor (Batch 9) is neither right nor wrong yet.
    if (awaitingMark(a)) continue;
    rows.push({ topic: a.topic, level: a.bloom, correct: a.correct === true, rollNo: a.rollNo });
    counted.answers += 1;
  }
  for (const p of profiles) {
    for (const h of Array.isArray(p?.history) ? p.history : []) {
      if (!h || h.answerId || h.ungraded || !LEVELS.includes(h.bloom)) continue;
      rows.push({ topic: h.topic, level: h.bloom, correct: h.correct === true, rollNo: p.rollNo });
      counted.history += 1;
    }
  }
  return { rows, counted };
}

const rate = (c) => (c.seen ? c.correct / c.seen : null);

/**
 * Per topic, per level: seen, correct, accuracy, and how many students it covers.
 *
 * Every topic carries all six levels, in ladder order, so a screen can draw the
 * grid without guessing which cells are missing. An answer with no topic is not
 * a topic; it is counted in `untagged` so the totals can still be reconciled.
 */
export function topicLevels(rows = []) {
  const byTopic = new Map();
  let untagged = 0;
  for (const r of rows) {
    const topic = String(r.topic ?? '').trim();
    if (!topic) {
      untagged += 1;
      continue;
    }
    let t = byTopic.get(topic);
    if (!t) {
      t = {
        topic, seen: 0, correct: 0, students: new Set(),
        levels: Object.fromEntries(LEVELS.map((level) => [level, { seen: 0, correct: 0 }])),
      };
      byTopic.set(topic, t);
    }
    t.seen += 1;
    t.levels[r.level].seen += 1;
    if (r.correct) {
      t.correct += 1;
      t.levels[r.level].correct += 1;
    }
    if (r.rollNo) t.students.add(String(r.rollNo));
  }
  const topics = [...byTopic.values()]
    .map((t) => ({
      topic: t.topic,
      seen: t.seen,
      correct: t.correct,
      accuracy: rate(t),
      students: t.students.size,
      levels: LEVELS.map((level) => ({ level, ...t.levels[level], accuracy: rate(t.levels[level]) })),
    }))
    .sort((a, b) => b.seen - a.seen || a.topic.localeCompare(b.topic));
  return { topics, untagged };
}

/**
 * The topic report, saying where its numbers came from: 'answers', 'history'
 * (rooms older than the evidence store), 'mixed', or 'none' - and how many of
 * each, so a reader can tell a thin report from an empty one.
 */
export function topicReport({ answers = [], profiles = [] } = {}) {
  const { rows, counted } = gradedEvidence({ answers, profiles });
  const { topics, untagged } = topicLevels(rows);
  let source = 'none';
  if (counted.answers && counted.history) source = 'mixed';
  else if (counted.answers) source = 'answers';
  else if (counted.history) source = 'history';
  return {
    source,
    counted,
    students: new Set(rows.filter((r) => r.rollNo).map((r) => String(r.rollNo))).size,
    untagged,
    topics,
  };
}

/* ------------------------------------------------- a student's own view -- */

/**
 * A room profile as the student it is linked to may read it (decision 7, the
 * residual closed under the owner's delegation, 19 Nov 2026): only the history
 * entries that record answers a phone signed in as them sent, and the level
 * tallies counted from those entries alone.
 *
 * A sign-in links the profile, but the profile is the ROOM's record of a roll
 * number: a guest who typed it before she signed in, or a classmate typing it
 * on another phone afterwards, answered into the same history and tallies. Read
 * whole, her dashboard showed their answers as hers. `keys` are the answer keys
 * of her verified rows in this room (`accountVerified`); an entry records the
 * row whose key it carries (`answerId`).
 *
 * `whole` is true when every entry is hers: the profile comes back unchanged,
 * working level and all. Otherwise its working level is not hers to read (it was
 * set by the other answers too), and a redemption pairing with an entry that is
 * not hers is left off the entry that names it.
 *
 * @returns {{ profile: object, whole: boolean }}
 */
export function verifiedView(profile, keys = new Set()) {
  const history = Array.isArray(profile?.history) ? profile.history : [];
  const kept = history.filter((h) => h?.answerId && keys.has(String(h.answerId)));
  if (kept.length === history.length) return { profile, whole: true };
  const ids = new Set(kept.map((h) => String(h.questionId)));
  const levels = Object.fromEntries(LEVELS.map((level) => [level, { seen: 0, correct: 0 }]));
  const own = kept.map(({ redeems, redeemedBy, ...h }) => {
    if (!h.ungraded && LEVELS.includes(h.bloom)) {
      levels[h.bloom].seen += 1;
      if (h.correct) levels[h.bloom].correct += 1;
    }
    return {
      ...h,
      ...(redeems !== undefined && ids.has(String(redeems)) ? { redeems } : {}),
      ...(redeemedBy !== undefined && ids.has(String(redeemedBy)) ? { redeemedBy } : {}),
    };
  });
  return { profile: { ...profile, history: own, levels, workingLevel: null }, whole: false };
}

/**
 * The keys of a student's own verified answers in these rooms, per room: what
 * verifiedView reads. Final rows only (a history entry records the final
 * attempt), class votes left out (no vote is in a history).
 *
 * @returns {Promise<Map<string, Set<string>>>} room id -> answer keys
 */
export async function verifiedKeys(repo, { sessionIds = [], accountId }) {
  const out = new Map(sessionIds.map((id) => [String(id), new Set()]));
  if (!sessionIds.length || !accountId) return out;
  const rows = await allAnswers(repo, {
    sessionIds: sessionIds.map(String), student: { accountId, verifiedOnly: true }, final: true, classVotes: false,
  });
  for (const a of rows) out.get(String(a.sessionId))?.add(String(a.answerKey));
  return out;
}

/* ----------------------------------------------------------------- reads -- */

/** Every answer a filter matches, oldest first. Paged at READ_PAGE; see there. */
export async function allAnswers(repo, filter) {
  const out = [];
  for (let offset = 0; ; offset += READ_PAGE) {
    const rows = await repo.listAnswers({ ...filter, order: 'asc', limit: READ_PAGE, offset });
    out.push(...rows);
    if (rows.length < READ_PAGE) return out;
  }
}

/**
 * The topic report for one room the caller has already been allowed to read.
 * Per topic and level, of the students' own questions: a class question's votes
 * (Phase 5) are not evidence at a level, and are left out.
 */
export async function roomTopics(repo, session) {
  const [answers, profiles] = await Promise.all([
    allAnswers(repo, { sessionId: session._id, final: true, classVotes: false }),
    repo.listProfiles(session._id),
  ]);
  return topicReport({ answers, profiles });
}

/**
 * One student's answers across a set of rooms, newest first, one page.
 *
 * `rooms` must already be the rooms this student may be read in, and `student`
 * is { accountId, rollNo }. `code` narrows to one of `rooms`; a code outside
 * them matches nothing, exactly like a code that does not exist.
 *
 * Which rows are this student's depends on who is reading:
 *   teacher  by the account, or by the roll number when the row is linked to no
 *            account (listAnswers in the repos). One query, so a row that
 *            matches both ways is still one row. A professor reads every answer
 *            in their own rooms anyway; this only gathers them.
 *   student  by the account ONLY, and only rows a phone signed in as that
 *            account sent (`accountVerified`, decision 7, 0022). A roll number
 *            is typed on a phone with no sign-in, so a row under it, linked by
 *            it or not, may be anybody's: a guest, a mistyped classmate, a
 *            classmate typing it on purpose, or a second account whose roll
 *            number is the same one in different case. Handing those written
 *            answers to whoever holds the roll number is handing them to the
 *            wrong person. Rows linked before 0022 were linked by a typed roll
 *            number, so none of them is verified.
 *
 * `view` is 'student' unless the caller says otherwise: the redacted copy, and
 * the narrow match, are the ones to fall back to.
 *
 * A student's own read leaves out their class question votes (Phase 5): a
 * vote's mark would tell a class question's key before the professor reveals
 * it, and a vote is not their own work at a level. A teacher's read keeps them,
 * each labelled with its class question and round (answerItem).
 */
export async function listStudentAnswers(repo, {
  rooms = [], student, topic = '', level = '', code = '', limit = DEFAULT_LIMIT, offset = 0, view = 'student',
} = {}) {
  const scoped = code ? rooms.filter((r) => r.code === code) : rooms;
  const whose = view === 'teacher' ? student : (student?.accountId ? { accountId: student.accountId, verifiedOnly: true } : null);
  if (!scoped.length || !whose) return { items: [], hasMore: false };
  // One row more than asked for says whether there is a next page without a count.
  const rows = await repo.listAnswers({
    sessionIds: scoped.map((r) => String(r._id)),
    student: whose,
    ...(topic ? { topic } : {}),
    ...(level ? { bloom: level } : {}),
    ...(view === 'teacher' ? {} : { classVotes: false }),
    order: 'desc',
    limit: limit + 1,
    offset,
  });
  const byId = new Map(scoped.map((r) => [String(r._id), r]));
  const build = view === 'teacher' ? (a, r) => answerItem(a, r) : redactForStudent;
  return {
    items: rows.slice(0, limit).map((a) => build(a, byId.get(String(a.sessionId)))),
    hasMore: rows.length > limit,
  };
}
