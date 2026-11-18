// Analytics. Three questions, three shapes, one authorization rule.
//
//   HOD        "how is each of my professors doing?"      -> per professor
//   professor  "how is each of my students doing?"        -> per student
//   student    "where am I strongest, and where am I not?" -> themselves
//
// dashboard.js answers "what is happening"; this answers "who, and how well,
// over time". They are deliberately separate: a dashboard is read on the way to
// somewhere else and has to be fast, and this walks every session a subject ever
// sat to build a trend line.
//
// Nothing here decides who may look. Callers pass a viewer that a route guard
// vetted, the subject list comes from scopeFor()/listBelow(), and asking for a
// subject outside that list returns the same 404 as one that does not exist -
// so the endpoint cannot be used to discover which ids are real.

import { LEVELS } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import { scopeFor } from '../auth.js';
import { listBelow, getAccount } from './accounts.js';
import { hydrate, overallAccuracy, isSlowLearner, totals, MIN_EVIDENCE } from './mastery.js';
import {
  allAnswers, topicReport, listStudentAnswers, pageFrom, levelFrom, rollKey,
} from './evidence.js';

const deny = (message, status) => Object.assign(new Error(message), { status });

/** A level cell is only worth reporting on once it has some evidence behind it. */
const CONFIDENT = MIN_EVIDENCE;

const emptyLevels = () =>
  LEVELS.reduce((acc, level) => ({ ...acc, [level]: { seen: 0, correct: 0 } }), {});

function fold(into, profile) {
  for (const level of LEVELS) {
    const cell = profile.levels?.[level];
    if (!cell) continue;
    into[level].seen += cell.seen ?? 0;
    into[level].correct += cell.correct ?? 0;
  }
  return into;
}

const accuracyOf = (c) => (c.seen ? c.correct / c.seen : null);

const levelReport = (tally) =>
  LEVELS.map((level) => ({
    level,
    seen: tally[level].seen,
    correct: tally[level].correct,
    accuracy: accuracyOf(tally[level]),
  }));

/**
 * Best and weakest level, ignoring anything too thin to mean anything.
 *
 * "You are best at Create" off a single lucky answer is worse than saying
 * nothing: it is the sentence a student will repeat to themselves all term.
 */
function extremes(report) {
  const solid = report.filter((r) => r.seen >= CONFIDENT && r.accuracy !== null);
  if (!solid.length) return { best: null, weakest: null, confident: false };
  const sorted = [...solid].sort((a, b) => b.accuracy - a.accuracy);
  return {
    best: sorted[0],
    weakest: sorted[sorted.length - 1],
    // One level with evidence is not a comparison; say so rather than naming
    // the same level as both the strongest and the weakest.
    confident: solid.length >= 2,
  };
}

/** Sessions this viewer may read, newest first. */
async function sessionsFor(ownerIds, { includeUnowned = false } = {}) {
  const mine = new Set(ownerIds.map(String));
  const all = await getRepo().listSessions();
  return all.filter((s) => {
    const owner = s.ownerId ?? s.owner_id ?? null;
    return owner == null ? includeUnowned : mine.has(String(owner));
  });
}

/** Per-topic accuracy, mined from the answer history rather than stored. */
function topicBreakdown(rows) {
  const byTopic = new Map();
  for (const { topic, correct, ungraded } of rows) {
    const key = String(topic ?? '').trim();
    // A poll's entry is in the history so it is not served twice. It carries no
    // mark, and counted here it would read as a wrong answer on that topic.
    if (!key || ungraded) continue;
    const cell = byTopic.get(key) ?? { topic: key, seen: 0, correct: 0 };
    cell.seen += 1;
    if (correct) cell.correct += 1;
    byTopic.set(key, cell);
  }
  return [...byTopic.values()]
    .map((c) => ({ ...c, accuracy: c.seen ? c.correct / c.seen : null }))
    .sort((a, b) => b.seen - a.seen);
}

/* ------------------------------------------------------------ the subjects */

/**
 * Who this viewer may run analytics on, and what each is called.
 * The list IS the authorization: nothing outside it is reachable.
 */
export async function subjectsFor(viewer) {
  if (viewer?.role === 'hod') {
    const below = await listBelow(viewer.id);
    return below
      .filter((a) => a.role === 'professor')
      .map((a) => ({ id: a.id, kind: 'professor', name: a.fullName, code: a.code, active: a.active }));
  }

  if (viewer?.role === 'professor') {
    const below = viewer.id ? await listBelow(viewer.id) : [];
    return below
      .filter((a) => a.role === 'student')
      .map((a) => ({
        id: a.id, kind: 'student', name: a.fullName, code: a.code,
        rollNo: a.rollNo ?? null, active: a.active,
      }));
  }

  // A student is their own and only subject.
  if (viewer?.role === 'student') {
    return [{ id: viewer.id, kind: 'student', name: viewer.fullName, code: viewer.code, rollNo: viewer.rollNo ?? null, active: true }];
  }

  // The shared-key path has no hierarchy behind it, so it has no subjects.
  return [];
}

/* --------------------------------------------------------- one professor -- */

async function professorAnalytics(subject, viewer) {
  const repo = getRepo();
  const sessions = await sessionsFor([subject.id]);

  const tally = emptyLevels();
  const timeline = [];
  const students = new Map();
  const history = [];

  for (const session of sessions) {
    const profiles = (await repo.listProfiles(session._id)).map(hydrate);
    let accSum = 0;
    let accN = 0;
    let banded = 0;

    for (const profile of profiles) {
      fold(tally, profile);
      const acc = overallAccuracy(profile);
      if (acc !== null) { accSum += acc; accN += 1; }
      if (isSlowLearner(profile)) banded += 1;
      history.push(...(profile.history ?? []));

      const seat = students.get(profile.rollNo) ?? {
        rollNo: profile.rollNo, name: profile.name ?? '', sessions: 0, answered: 0, correct: 0,
      };
      const t = totals(profile);
      seat.sessions += 1;
      seat.answered += t.seen;
      seat.correct += t.correct;
      seat.lastLevel = profile.workingLevel;
      students.set(profile.rollNo, seat);
    }

    timeline.push({
      code: session.code,
      title: session.title ?? '',
      status: session.status,
      startedAt: session.startedAt ?? null,
      joined: profiles.length,
      banded,
      accuracy: accN ? accSum / accN : null,
    });
  }

  timeline.sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));
  const report = levelReport(tally);

  return {
    kind: 'professor',
    subject: { id: subject.id, name: subject.name, code: subject.code, active: subject.active },
    counts: {
      sessions: sessions.length,
      students: students.size,
      answered: [...students.values()].reduce((n, s) => n + s.answered, 0),
      accuracy: (() => {
        const t = [...students.values()];
        const withData = t.filter((s) => s.answered > 0);
        return withData.length
          ? withData.reduce((n, s) => n + s.correct / s.answered, 0) / withData.length
          : null;
      })(),
    },
    bloom: report,
    ...extremes(report),
    topics: topicBreakdown(history).slice(0, 12),
    timeline,
    students: [...students.values()]
      .map((s) => ({ ...s, accuracy: s.answered ? s.correct / s.answered : null }))
      .sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1)),
  };
}

/* ------------------------------------------------------------ one student -- */

/**
 * The rooms a student's results may be read from, and who the student is in them.
 *
 * Only rooms run by whoever this student reports to. A student must never be
 * able to reach another class's sessions by sitting on these endpoints, and an
 * HOD reading a professor's student gets the same scoped view. Shared by the
 * analytics and the answer list, so the two can never cover different rooms.
 */
async function studentScope(subject, viewer) {
  const account = subject.id ? await getAccount(subject.id) : null;
  const ownerId = account?.reportsTo ?? viewer?.id ?? null;
  return {
    rooms: ownerId ? await sessionsFor([ownerId]) : [],
    student: { accountId: subject.id ?? null, rollNo: rollKey(subject.rollNo) || null },
  };
}

async function studentAnalytics(subject, viewer) {
  const repo = getRepo();
  const shownRoll = String(subject.rollNo ?? '').trim();
  // Compared the way the room stored it. An account's roll number is typed by a
  // person; the room's was normalised on join, so '21cs 01' must find '21CS 01'.
  const rollNo = rollKey(subject.rollNo);

  const base = {
    kind: 'student',
    subject: { id: subject.id, name: subject.name, code: subject.code, rollNo: shownRoll || null },
    counts: { sessions: 0, answered: 0, correct: 0, accuracy: null },
    bloom: levelReport(emptyLevels()),
    best: null, weakest: null, confident: false,
    topics: [],
    // Per topic x per level, from the answers store, saying which source it used.
    topicLevels: topicReport(),
    timeline: [],
  };

  if (!rollNo) {
    base.reason =
      'No roll number on this account, and a live session identifies a student by the number ' +
      'they type on their phone - so there is nothing to match their results against yet.';
    return base;
  }

  const { rooms: sessions, student } = await studentScope(subject, viewer);

  const tally = emptyLevels();
  const profiles = [];

  for (const session of sessions) {
    const raw = await repo.getProfile(session._id, rollNo);
    if (!raw) continue;
    const profile = hydrate(raw);
    fold(tally, profile);
    profiles.push(profile);

    const t = totals(profile);
    base.timeline.push({
      code: session.code,
      title: session.title ?? '',
      startedAt: session.startedAt ?? null,
      answered: t.seen,
      correct: t.correct,
      accuracy: t.seen ? t.correct / t.seen : null,
      workingLevel: profile.workingLevel,
      banded: isSlowLearner(profile),
    });
    base.counts.answered += t.seen;
    base.counts.correct += t.correct;
  }

  base.timeline.sort((a, b) => String(a.startedAt ?? '').localeCompare(String(b.startedAt ?? '')));
  base.counts.sessions = base.timeline.length;
  const withData = base.timeline.filter((s) => s.accuracy !== null);
  base.counts.accuracy = withData.length
    ? withData.reduce((n, s) => n + s.accuracy, 0) / withData.length
    : null;

  const report = levelReport(tally);
  base.bloom = report;
  Object.assign(base, extremes(report));

  // Topics are mined from the evidence store: final, graded answers in these
  // rooms, matched by account or roll number, with the profile history standing
  // in for attempts older than the store (services/evidence.js).
  const answers = sessions.length
    ? await allAnswers(repo, { sessionIds: sessions.map((s) => String(s._id)), student, final: true })
    : [];
  base.topicLevels = topicReport({ answers, profiles });
  // The original list keeps its shape, and is read off the same rows so the two
  // can never disagree.
  base.topics = base.topicLevels.topics
    .slice(0, 12)
    .map(({ topic, seen, correct, accuracy }) => ({ topic, seen, correct, accuracy }));
  base.currentLevel = base.timeline.length ? base.timeline[base.timeline.length - 1].workingLevel : null;
  return base;
}

/* ------------------------------------------------------------ entry points */

/** The list a viewer picks from, plus enough per-subject numbers to rank them. */
export async function analyticsOverview(viewer) {
  const subjects = await subjectsFor(viewer);

  // A student never picks; their own analysis IS the overview.
  if (viewer?.role === 'student') {
    return { role: 'student', subjects, detail: await studentAnalytics(subjects[0] ?? {}, viewer) };
  }

  const rows = await Promise.all(
    subjects.map(async (s) => {
      const detail = s.kind === 'professor'
        ? await professorAnalytics(s, viewer)
        : await studentAnalytics(s, viewer);
      return {
        ...s,
        counts: detail.counts,
        best: detail.best?.level ?? null,
        weakest: detail.weakest?.level ?? null,
        confident: detail.confident,
      };
    }),
  );

  return { role: viewer?.role ?? 'professor', subjects: rows };
}

/**
 * One subject in full.
 * Throws 404 for a subject outside the viewer's scope - the same answer as one
 * that does not exist, so this cannot be used to enumerate ids.
 */
export async function analyticsFor(viewer, subjectId) {
  const subjects = await subjectsFor(viewer);
  const subject = subjects.find((s) => String(s.id) === String(subjectId));
  if (!subject) throw deny('No such person, or not one you can see.', 404);

  return subject.kind === 'professor'
    ? professorAnalytics(subject, viewer)
    : studentAnalytics(subject, viewer);
}

/**
 * One student's actual answers across the rooms analytics reads them in, newest
 * first, one page: the question as they saw it, what they wrote or picked, the
 * mark in force and any review.
 *
 * The subject list is the authorization, exactly as in analyticsFor: a professor
 * reaches their own students, a student reaches themself, and anyone else is the
 * same 404 as an id that does not exist. An HOD's list holds professors, not
 * students, so an HOD reaches no student here.
 *
 * A student gets every answer redacted (evidence.js redactForStudent): their
 * response, the mark and the review, never the key, the rubric or the machine's
 * own reading. And only the answers linked to their account: an unlinked row
 * under their roll number may have been typed by anyone (listStudentAnswers). A
 * professor gets the full snapshot, matched by account or unlinked roll number.
 */
export async function answersFor(viewer, subjectId, query = {}) {
  const subjects = await subjectsFor(viewer);
  const subject = subjects.find((s) => String(s.id) === String(subjectId));
  if (!subject) throw deny('No such person, or not one you can see.', 404);
  // Visible, so a 400 tells the caller nothing they could not already see.
  if (subject.kind !== 'student') throw deny('Answers are listed per student. Open one of this professor\'s students.', 400);

  const { limit, offset } = pageFrom(query);
  const level = levelFrom(query.level);
  const topic = String(query.topic ?? '').trim();
  const code = String(query.code ?? '').trim().toUpperCase();
  const view = viewer?.role === 'student' ? 'student' : 'teacher';

  const { rooms, student } = await studentScope(subject, viewer);
  const { items, hasMore } = await listStudentAnswers(getRepo(), {
    rooms, student, topic, level, code, limit, offset, view,
  });

  return {
    subject: { id: subject.id, name: subject.name, code: subject.code, rollNo: subject.rollNo ?? null },
    view,
    filters: { topic: topic || null, level: level || null, code: code || null },
    items,
    limit,
    offset,
    hasMore,
  };
}
