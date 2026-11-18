// Phase 3 - what each role sees when they sign in.
//
// One function per role, because the three dashboards are three different
// questions and pretending they are one query with a filter is how you end up
// showing an HOD a professor's working screen.
//
//   HOD        "how is my department doing, and who is doing it"
//   professor  "what have I built, and how did my classes go"
//   student    "how am I doing, over time, in my own words"
//
// Everything here is built on the repo interface and the accounts service, so it
// works identically against Supabase, Mongo and the in-memory store. That costs
// a few extra round trips on a big department; a college department is tens of
// sessions, not millions, and store-agnostic is worth more than the milliseconds.
//
// Nothing in this file makes an authorization decision. Callers pass a viewer
// that a route guard has already vetted, and the scope they get back is derived
// from ownership.js / auth.js - the same two files every other route trusts.

import { LEVELS } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import { scopeFor } from '../auth.js';
import { listBelow, getAccount, rollKey } from './accounts.js';
import { hydrate, overallAccuracy, isSlowLearner, totals } from './mastery.js';

/** Empty per-level tallies, in taxonomy order. */
const emptyBloom = () =>
  LEVELS.reduce((acc, level) => ({ ...acc, [level]: { seen: 0, correct: 0 } }), {});

/** Fold one student's levels into a running department- or class-wide tally. */
function foldLevels(into, profile) {
  for (const level of LEVELS) {
    const cell = profile.levels?.[level];
    if (!cell) continue;
    into[level].seen += cell.seen ?? 0;
    into[level].correct += cell.correct ?? 0;
  }
  return into;
}

const accuracyOf = (cell) => (cell.seen ? cell.correct / cell.seen : null);

/** Per-level accuracy as a plain object, ready for a bar chart. */
const bloomReport = (tally) =>
  LEVELS.map((level) => ({
    level,
    seen: tally[level].seen,
    correct: tally[level].correct,
    accuracy: accuracyOf(tally[level]),
  }));

/**
 * Sessions, profiles and the numbers that fall out of them, for one set of
 * owner ids. Read once and reused by both teacher-facing dashboards.
 */
async function harvest(ownerIds, { includeUnowned = false, limit = 200 } = {}) {
  const repo = getRepo();
  const mine = new Set(ownerIds.map(String));

  const all = await repo.listSessions();
  const sessions = all
    .filter((s) => {
      const owner = s.ownerId ?? s.owner_id ?? null;
      return owner == null ? includeUnowned : mine.has(String(owner));
    })
    .slice(0, limit);

  const bloom = emptyBloom();
  const rows = [];
  // Each student's most recent seat across these rooms, keyed by account id
  // (when the room profile is linked to one) and by roll number: where they are
  // on the ladder now, and when they last did anything.
  const latest = new Map();
  const remember = (key, seat) => {
    if (!key) return;
    const held = latest.get(key);
    if (!held || String(seat.lastSeenAt ?? '') > String(held.lastSeenAt ?? '')) latest.set(key, seat);
  };
  let students = 0;
  let banded = 0;
  let answered = 0;
  let accuracySum = 0;
  let accuracyN = 0;

  for (const session of sessions) {
    const raw = await repo.listProfiles(session._id);
    const profiles = raw.map(hydrate);

    let sessionAcc = 0;
    let sessionN = 0;
    let sessionBanded = 0;
    for (const profile of profiles) {
      foldLevels(bloom, profile);
      const { seen } = totals(profile);
      answered += seen;
      const acc = overallAccuracy(profile);
      if (acc !== null) {
        accuracySum += acc;
        accuracyN += 1;
        sessionAcc += acc;
        sessionN += 1;
      }
      if (isSlowLearner(profile)) {
        banded += 1;
        sessionBanded += 1;
      }
      // Last seen is their last answer; a student who joined and answered
      // nothing was last seen when the room opened.
      const history = profile.history ?? [];
      const seat = {
        workingLevel: profile.workingLevel ?? null,
        lastSeenAt: history.length ? history[history.length - 1].at ?? null : session.startedAt ?? null,
      };
      const owner = String(session.ownerId ?? session.owner_id ?? '');
      if (profile.accountId) remember(`acct:${profile.accountId}`, seat);
      remember(`roll:${owner}:${rollKey(profile.rollNo)}`, seat);
    }
    students += profiles.length;

    rows.push({
      code: session.code,
      title: session.title ?? '',
      status: session.status,
      ownerId: session.ownerId ?? session.owner_id ?? null,
      startedAt: session.startedAt ?? session.started_at ?? null,
      closedAt: session.closedAt ?? session.closed_at ?? null,
      joined: profiles.length,
      banded: sessionBanded,
      accuracy: sessionN ? sessionAcc / sessionN : null,
    });
  }

  return {
    sessions: rows,
    bloom,
    latest,
    totals: {
      sessions: rows.length,
      students,
      banded,
      answered,
      // The mean of each student's accuracy, not of every answer: a student who
      // answered forty questions should not outvote one who answered four.
      accuracy: accuracyN ? accuracySum / accuracyN : null,
    },
  };
}

/** Contents owned by these ids, with their bank size. */
async function ownedContents(ownerIds, { includeUnowned = false } = {}) {
  const repo = getRepo();
  const mine = new Set(ownerIds.map(String));
  const all = await repo.listContents();
  const rows = all.filter((c) => {
    const owner = c.ownerId ?? c.owner_id ?? null;
    return owner == null ? includeUnowned : mine.has(String(owner));
  });

  return Promise.all(
    rows.map(async (c) => ({
      id: c._id,
      title: c.title,
      kind: c.kind,
      topics: Array.isArray(c.topics) ? c.topics.length : 0,
      // Approved questions only, the ones a room can serve; `drafts` are
      // generated ones still waiting for approval.
      questions: await repo.countQuestions(c._id),
      drafts: await repo.countQuestions(c._id, { status: 'draft' }),
      ownerId: c.ownerId ?? c.owner_id ?? null,
      createdAt: c.createdAt ?? c.created_at ?? null,
    })),
  );
}

/* ---------------------------------------------------------------- HOD --- */

/**
 * The department view: every professor beneath this HOD, what they have built,
 * and how their classes went. Read-only by construction - the HOD's scope
 * grants reads across the department and writes on nothing (ownership.js).
 */
export async function hodDashboard(viewer) {
  const below = await listBelow(viewer.id);
  const professors = below.filter((a) => a.role === 'professor');
  const students = below.filter((a) => a.role === 'student');

  const scope = await scopeFor(viewer);
  const [harvested, contents] = await Promise.all([
    harvest(scope.ownerIds),
    ownedContents(scope.ownerIds),
  ]);

  const byProfessor = new Map(professors.map((p) => [String(p.id), {
    id: p.id,
    code: p.code,
    fullName: p.fullName,
    email: p.email,
    active: p.active,
    students: 0,
    contents: 0,
    questions: 0,
    sessions: 0,
    lastSessionAt: null,
    accuracy: null,
  }]));

  for (const s of students) {
    const row = byProfessor.get(String(s.reportsTo));
    if (row) row.students += 1;
  }
  for (const c of contents) {
    const row = byProfessor.get(String(c.ownerId));
    if (!row) continue;
    row.contents += 1;
    row.questions += c.questions;
  }
  for (const s of harvested.sessions) {
    const row = byProfessor.get(String(s.ownerId));
    if (!row) continue;
    row.sessions += 1;
    if (!row.lastSessionAt || (s.startedAt && s.startedAt > row.lastSessionAt)) {
      row.lastSessionAt = s.startedAt;
    }
    if (s.accuracy !== null) {
      row.accuracy = row.accuracy === null ? s.accuracy : (row.accuracy + s.accuracy) / 2;
    }
  }

  return {
    role: 'hod',
    department: viewer.department ?? '',
    counts: {
      professors: professors.length,
      students: students.length,
      contents: contents.length,
      questions: contents.reduce((n, c) => n + c.questions, 0),
      sessions: harvested.totals.sessions,
      answered: harvested.totals.answered,
      banded: harvested.totals.banded,
      accuracy: harvested.totals.accuracy,
    },
    professors: [...byProfessor.values()].sort((a, b) => b.sessions - a.sessions),
    bloom: bloomReport(harvested.bloom),
    // Newest first, and short: this is a dashboard, not an audit log.
    recentSessions: harvested.sessions.slice(0, 12),
  };
}

/* ---------------------------------------------------- professor / teacher */

export async function professorDashboard(viewer) {
  const scope = await scopeFor(viewer);
  const [harvested, contents, below] = await Promise.all([
    harvest(scope.ownerIds, { includeUnowned: scope.includeUnowned }),
    ownedContents(scope.ownerIds, { includeUnowned: scope.includeUnowned }),
    viewer.id ? listBelow(viewer.id) : Promise.resolve([]),
  ]);

  const roster = below.filter((a) => a.role === 'student');
  const sessionsByContent = new Map();
  for (const s of harvested.sessions) {
    sessionsByContent.set(s.title, (sessionsByContent.get(s.title) ?? 0) + 1);
  }

  return {
    role: 'professor',
    department: viewer.department ?? '',
    counts: {
      students: roster.length,
      contents: contents.length,
      questions: contents.reduce((n, c) => n + c.questions, 0),
      sessions: harvested.totals.sessions,
      // Seats filled across every session run, not distinct people: a student
      // who took four sessions is four data points on the Bloom chart.
      attendances: harvested.totals.students,
      answered: harvested.totals.answered,
      banded: harvested.totals.banded,
      accuracy: harvested.totals.accuracy,
    },
    contents: contents
      .map((c) => ({ ...c, sessions: sessionsByContent.get(c.title) ?? 0 }))
      .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))),
    // currentLevel and lastSeenAt come from the student's most recent seat in
    // this professor's rooms: by linked account first, else by roll number.
    // Null for a student who has not sat one yet.
    roster: roster.map((s) => {
      const seat = harvested.latest.get(`acct:${s.id}`)
        ?? (s.rollNo ? harvested.latest.get(`roll:${viewer.id}:${rollKey(s.rollNo)}`) : undefined);
      return {
        id: s.id, code: s.code, fullName: s.fullName, rollNo: s.rollNo, active: s.active,
        currentLevel: seat?.workingLevel ?? null,
        lastSeenAt: seat?.lastSeenAt ?? null,
      };
    }),
    bloom: bloomReport(harvested.bloom),
    recentSessions: harvested.sessions.slice(0, 12),
  };
}

/* ------------------------------------------------------------- student --- */

/**
 * The student's own history, and nothing else.
 *
 * The join is on roll number, because a live session identifies a student by the
 * number they typed on their phone - there are no accounts in the room. That
 * makes the roll number the one thing linking a signed-in student to their own
 * results, so an account without one gets an honest empty state rather than
 * somebody else's marks.
 */
export async function studentDashboard(viewer) {
  const account = (await getAccount(viewer.id)) ?? viewer;
  const rollNo = String(account.rollNo ?? '').trim();

  const base = {
    role: 'student',
    department: account.department ?? '',
    rollNo,
    professor: null,
    counts: { sessions: 0, answered: 0, correct: 0, accuracy: null },
    workingLevel: null,
    banded: false,
    bloom: bloomReport(emptyBloom()),
    sessions: [],
  };

  if (!rollNo) {
    base.reason =
      'Your account has no roll number on it yet, so BloomLoop cannot match you to the sessions ' +
      'you sat. Ask your professor to add it to your account.';
    return base;
  }

  const professor = account.reportsTo ? await getAccount(account.reportsTo) : null;
  if (professor) {
    base.professor = { code: professor.code, fullName: professor.fullName };
  }

  // Only the sessions the student's own professor ran. A student must never be
  // able to enumerate another class's rooms by sitting on this endpoint.
  const repo = getRepo();
  const all = await repo.listSessions();
  const theirs = all.filter((s) => {
    const owner = s.ownerId ?? s.owner_id ?? null;
    return owner != null && account.reportsTo && String(owner) === String(account.reportsTo);
  });

  const tally = emptyBloom();
  let answered = 0;
  let correct = 0;
  let accSum = 0;
  let accN = 0;
  let latest = null;

  for (const session of theirs) {
    const raw = await repo.getProfile(session._id, rollNo);
    if (!raw) continue;
    const profile = hydrate(raw);
    foldLevels(tally, profile);

    const t = totals(profile);
    answered += t.seen;
    correct += t.correct;
    const acc = overallAccuracy(profile);
    if (acc !== null) { accSum += acc; accN += 1; }

    const startedAt = session.startedAt ?? session.started_at ?? null;
    if (!latest || (startedAt && startedAt > latest.startedAt)) {
      latest = { startedAt, workingLevel: profile.workingLevel, banded: isSlowLearner(profile) };
    }

    base.sessions.push({
      code: session.code,
      title: session.title ?? '',
      status: session.status,
      startedAt,
      answered: t.seen,
      correct: t.correct,
      accuracy: acc,
      workingLevel: profile.workingLevel,
      banded: isSlowLearner(profile),
      // The per-question trail, so the student can see the run of answers that
      // moved them rather than only the verdict.
      history: (profile.history ?? []).slice(-40),
    });
  }

  base.sessions.sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')));
  base.counts = {
    sessions: base.sessions.length,
    answered,
    correct,
    accuracy: accN ? accSum / accN : null,
  };
  base.workingLevel = latest?.workingLevel ?? null;
  base.banded = Boolean(latest?.banded);
  base.bloom = bloomReport(tally);
  return base;
}

/** Route entry point: the right dashboard for whoever is asking. */
export function dashboardFor(viewer) {
  if (viewer?.role === 'hod') return hodDashboard(viewer);
  if (viewer?.role === 'student') return studentDashboard(viewer);
  return professorDashboard(viewer);
}
