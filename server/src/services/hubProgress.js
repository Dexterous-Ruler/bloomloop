// What the Learning Hub reports about practice (Phase 6, decisions H6, H7, H8,
// H16's personal-progress reads, and H17's staff reads).
//
// FOR THE STUDENT, their own data only:
//   studentProgress  every topic they can practise with its state, N and a
//                    sentence (services/hubElo.js) and its review (hubReview.js)
//   dueList          the topics due for review now, and those coming up
//   errorLogFor      their error log (services/hubErrors.js): the question as
//                    they saw it, their response, what was right and the
//                    approved explanation, the topic's confirmed prerequisites.
//                    What was right, and why, is kept back (keyHeld, with a
//                    sentence) on an entry whose question a room is asking now
//                    (services/hubClosed.js), and on a "From class" entry whose
//                    question a room may still ask but practice cannot serve
//                    them (it shows an uploaded image, say): there the error
//                    log must not become the list of room keys that
//                    services/evidence.js keeps out of a student's answer
//                    history. Wherever practice could serve the question, its
//                    answer is one practice shows after a try anyway (H7, H14),
//                    and the entry shows it.
//   consistencyFor   their weeks: days practised and days rested, no streaks
// Nothing compares them with another student: no rank, no class average, no
// band name (decision (a)).
//
// FOR STAFF (the class's owner, the department's HOD, read-only), per class:
//   classProgress          per topic, how many students are in each state; per
//                          student, in ROLL ORDER and never by score, each
//                          topic's state with N and open errors, and activity
//   studentProgressForStaff  one roster student: topic states with N, activity
//                          counts and their error log, open entries per topic
// A roster row is tied to a student account by the rule the hub's access uses
// (the account reports to the class's owner and carries the roster's roll
// number); a roll number no account carries, or two accounts carry, shows no
// hub data and says why.
//
// Everything is worked out per request from the stored evidence, as attainment
// is, and nothing is written.

import { LABEL as LEVEL_LABEL } from '../bloom.js';
import { forStudent, score } from '../questionTypes.js';
import { ownerOf } from '../ownership.js';
import { rollKey } from './accounts.js';
import { allAnswers, shownQuestion } from './evidence.js';
import { labelHtml, phoneRich } from './richText.js';
import { prerequisiteChain } from './hubGraph.js';
import { STATES, STATE_LABEL } from './hubElo.js';
import {
  CONSISTENCY_NOTE, RATING_RULE, REVIEW_SET_SIZE, UPCOMING_DAYS, indiaDay, weeklyConsistency,
} from './hubReview.js';
import { FROM_LABEL, buildErrorLog, entrySentence, openByTopic } from './hubErrors.js';
import { explanationForStudent } from './hubExplanations.js';
import {
  ATTEMPT_MODES, hubSeed, scopeOfChapters, stateFrom, studentScope, topicModels, topicRef,
} from './hubPractice.js';
import { countedAttempts } from './hubHeld.js';
import { ROOM_HELD_NOTE, roomLiveQuestions } from './hubClosed.js';

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** Why a "From class" entry shows no answer: a room may ask it again, and the hub does not offer it for practice. */
export const CLASS_KEY_NOTE = 'What was right is not shown for this class question: it can still be asked in class, '
  + 'and it is not one you can practise in the hub.';

export const STUDENT_NOTICE = 'Your professor can see your progress in the hub: the topics you practise and how you are doing on them.';
export const BASIS_NOTE = 'Each estimate rests on your answers in the hub. Your answers in class rooms do not change it; '
  + 'the ones you got wrong show in your error log, marked "From class".';
export const STAFF_ORDER_NOTE = 'Students are listed in roll order. Nothing here ranks them.';

const zeroCounts = () => Object.fromEntries(STATES.map((s) => [s, 0]));

/* --------------------------------------------------------------- student -- */

/** Every topic the student can practise, with its state (H6) and its review (H8). */
export async function studentProgress(repo, account, { now = new Date(), scope = null } = {}) {
  const s = scope ?? await studentScope(repo, account);
  const entries = [...s.topics.values()];
  const models = await topicModels(repo, entries);
  const counts = zeroCounts();
  const topics = entries.map((entry) => {
    const state = stateFrom(models.get(lower(entry.topic._id)), account.id, { now });
    counts[state.state] += 1;
    return { ...topicRef(entry), classIds: entry.classIds, practiceQuestions: entry.questions.length, state };
  });
  return { notice: STUDENT_NOTICE, basis: BASIS_NOTE, states: STATE_LABEL, counts, topics };
}

/** The topics due for review now (most overdue first) and those due within UPCOMING_DAYS. */
export async function dueList(repo, account, { now = new Date() } = {}) {
  const { topics } = await studentProgress(repo, account, { now });
  const horizon = now.getTime() + UPCOMING_DAYS * 86400000;
  const view = (t) => ({ id: t.id, name: t.name, nameHtml: t.nameHtml, chapter: t.chapter, state: t.state.state, label: t.state.label,
    answers: t.state.answers, review: t.state.review, practiceQuestions: t.practiceQuestions });
  const byDue = (a, b) => Date.parse(a.review.dueAt) - Date.parse(b.review.dueAt);
  const due = topics.filter((t) => t.state.review.due).map(view).sort(byDue);
  const upcoming = topics.filter((t) => !t.state.review.due && t.state.review.dueAt && Date.parse(t.state.review.dueAt) <= horizon)
    .map(view).sort(byDue);
  return {
    due,
    upcoming,
    setSize: REVIEW_SET_SIZE,
    rule: RATING_RULE,
    ...(due.length ? {} : { empty: 'Nothing is due for review now.' }),
  };
}

/** The student's weeks: days practised and days rested (H8, H16). Own data only. */
export async function consistencyFor(repo, account, { now = new Date(), weeks = 8 } = {}) {
  const since = new Date(now.getTime() - (Math.max(1, weeks) + 1) * 7 * 86400000).toISOString();
  const attempts = await repo.listHubAttempts({ accountId: String(account.id), since });
  return { weeks: weeklyConsistency(attempts, { now, weeks }), note: CONSISTENCY_NOTE };
}

/* ------------------------------------------------------------- error log -- */

/**
 * A student's verified room answers mapped to live topic records of the scope:
 * final, marked, not a class vote, and in a chapter the scope holds.
 */
function roomAnswersInScope(rows, scope) {
  const out = [];
  for (const a of rows) {
    if (a.accountVerified !== true || a.final === false || a.ungraded === true || a.classQuestionId || typeof a.correct !== 'boolean') continue;
    const chapter = scope.chapters.get(lower(a.contentId));
    const record = chapter?.match(a.topic);
    if (!record || record.retiredAt || !scope.topics.has(lower(record._id))) continue;
    out.push({ ...a, topicId: String(record._id) });
  }
  return out;
}

/** Each topic's confirmed prerequisites, nearest first, live ones only, read once per professor. */
function prerequisiteReader(repo) {
  const links = new Map();
  const done = new Map();
  return async (entry) => {
    const key = lower(entry.topic._id);
    if (done.has(key)) return done.get(key);
    const owner = String(ownerOf(entry.content) ?? '');
    if (!links.has(owner)) links.set(owner, await repo.listTopicLinks({ ownerId: ownerOf(entry.content) }));
    const chain = prerequisiteChain(entry.topic._id, links.get(owner));
    const records = new Map((await repo.listChapterTopicsByIds(chain.map((c) => c.topicId))).map((t) => [String(t._id), t]));
    const out = chain
      .map((c) => ({ c, t: records.get(c.topicId) }))
      .filter(({ t }) => t && !t.retiredAt)
      .map(({ c, t }) => ({ id: String(t._id), name: t.name, nameHtml: labelHtml(t.name), depth: c.depth }));
    done.set(key, out);
    return out;
  };
}

/** One entry as a screen shows it, the question rebuilt as the student saw it. */
async function entryView(entry, { scope, prerequisites, audience }) {
  const row = entry.latest;
  const snap = row.questionSnapshot && typeof row.questionSnapshot === 'object' ? row.questionSnapshot : {};
  const item = entry.item;
  const kind = row.kind ?? snap.kind ?? 'mcq';
  // The seed the question was shown with: the hub's, or the room's (its roll number).
  const seed = entry.from === 'practice' ? hubSeed(row.accountId, item) : `${row.rollNo ?? ''}:${item}`;
  let question;
  let solution = null;
  try {
    if (entry.from === 'practice') {
      const { _id, ...shown } = forStudent({ ...snap, _id: item, kind }, seed);
      question = shown;
    } else {
      question = shownQuestion(row);
    }
    solution = score({ ...snap, _id: item, kind }, row.response, seed).solution ?? null;
  } catch {
    question = { text: String(snap.text ?? ''), kind };
  }
  const topicEntry = scope.topics.get(lower(entry.topicId));
  const view = {
    id: entry.id,
    status: entry.status,
    from: entry.from,
    fromLabel: FROM_LABEL[entry.from],
    topic: topicEntry ? topicRef(topicEntry) : null,
    level: entry.bloom,
    levelLabel: LEVEL_LABEL[entry.bloom] ?? entry.bloom,
    times: entry.times,
    firstAt: entry.firstAt,
    lastAt: entry.lastAt,
    clearedAt: entry.clearedAt,
    clearedBy: entry.clearedBy,
    question: { ...question, rich: await phoneRich(question) },
    response: row.response ?? null,
    solution,
    ...(entry.provisional ? { provisional: true } : {}),
    prerequisites: topicEntry ? await prerequisites(topicEntry) : [],
    sentence: entrySentence(entry, { levelName: (b) => LEVEL_LABEL[b] ?? b, audience }),
  };
  if (audience === 'staff') view.questionId = item || null;
  return view;
}

/**
 * For a student's own error log: why an entry keeps what was right back, or
 * null when it may show it (the header's rule). Reads the rooms on the entries'
 * chapters once, and a "From class" entry's question as it stands now.
 */
async function keyHeldReader(repo, scope, entries) {
  const chapters = [...new Set(entries.map((e) => String(e.latest?.contentId ?? '')).filter(Boolean))];
  const live = entries.length ? await roomLiveQuestions(repo, chapters) : new Set();
  const practisable = new Set([...scope.topics.values()].flatMap((t) => t.questions.map((q) => lower(q._id))));
  const asked = new Map();
  return async (entry) => {
    const item = lower(entry.item);
    if (live.has(item)) return ROOM_HELD_NOTE;
    if (entry.from !== 'class' || practisable.has(item)) return null;
    if (!asked.has(item)) asked.set(item, await repo.getQuestion(entry.item).catch(() => null));
    // Gone from the bank, or retired: no room serves it again, so its answer is the student's to see.
    const q = asked.get(item);
    return q && (q.status ?? 'active') === 'active' ? CLASS_KEY_NOTE : null;
  };
}

/**
 * The error log of one student over a scope, newest first, with counts.
 * `hubAttempts` and `roomRows` are the student's own; both are narrowed to the
 * scope here.
 */
async function errorLogOver(repo, { scope, hubAttempts, roomRows, audience = 'student', status = null, topicId = null }) {
  const entries = buildErrorLog({
    hubAttempts: hubAttempts.filter((a) => scope.topics.has(lower(a.topicId))),
    roomAnswers: roomAnswersInScope(roomRows, scope),
  });
  const open = openByTopic(entries);
  const wanted = entries
    .filter((e) => (!status || e.status === status) && (!topicId || lower(e.topicId) === lower(topicId)))
    .reverse();
  const prerequisites = prerequisiteReader(repo);
  const keyHeld = audience === 'student' ? await keyHeldReader(repo, scope, wanted) : async () => null;
  const explained = new Map();
  const views = [];
  for (const e of wanted) {
    const view = await entryView(e, { scope, prerequisites, audience });
    const held = await keyHeld(e);
    if (held) {
      view.solution = null;
      view.explanation = null;
      view.keyHeld = held;
      views.push(view);
      continue;
    }
    if (!explained.has(e.item)) {
      explained.set(e.item, await explanationForStudent(repo, e.item).catch((err) => {
        console.error('[hub] an explanation could not be read:', err.message);
        return null;
      }));
    }
    view.explanation = explained.get(e.item);
    views.push(view);
  }
  return {
    entries: views,
    counts: { open: entries.filter((e) => e.status === 'open').length, cleared: entries.filter((e) => e.status === 'cleared').length },
    openByTopic: Object.fromEntries([...open].map(([k, n]) => [k, n])),
    rule: 'An entry clears when a different question on the same topic, at its level or above, is answered right.',
  };
}

/** A student's verified room answers (decision 7): final, not class votes. */
const verifiedRoomAnswers = (repo, accountId) => allAnswers(repo, {
  student: { accountId: String(accountId), verifiedOnly: true }, final: true, classVotes: false,
});

/** The student's own error log (H7). `status`: 'open' | 'cleared' | null for both; `topicId` narrows it. */
export async function errorLogFor(repo, account, { status = null, topicId = null } = {}) {
  const scope = await studentScope(repo, account);
  const [hubAttempts, roomRows] = await Promise.all([
    // A self-test's answers only once it has ended (services/hubHeld.js).
    repo.listHubAttempts({ accountId: String(account.id) }).then((rows) => countedAttempts(repo, rows)),
    verifiedRoomAnswers(repo, account.id),
  ]);
  return errorLogOver(repo, { scope, hubAttempts, roomRows, audience: 'student', status, topicId });
}

/* ------------------------------------------------------------------ staff -- */

/** A class's placed chapters in its order: units by position, each unit's chapters by position, then "Other chapters". */
export async function classScope(repo, cls) {
  const [units, placed] = await Promise.all([repo.listClassUnits(cls._id), repo.listClassChapters(cls._id)]);
  const byPlace = (a, b) => (a.position - b.position) || String(a.createdAt ?? a.addedAt ?? '').localeCompare(String(b.createdAt ?? b.addedAt ?? ''));
  const ordered = [...units].sort(byPlace);
  const unitIds = new Set(ordered.map((u) => lower(u._id)));
  const list = [];
  for (const u of ordered) {
    for (const p of placed.filter((x) => lower(x.unitId) === lower(u._id)).sort(byPlace)) {
      list.push({ contentId: p.contentId, classIds: [String(cls._id)], unit: { id: String(u._id), name: u.name, nameHtml: labelHtml(u.name) } });
    }
  }
  for (const p of placed.filter((x) => !x.unitId || !unitIds.has(lower(x.unitId))).sort(byPlace)) {
    list.push({ contentId: p.contentId, classIds: [String(cls._id)], unit: null });
  }
  return scopeOfChapters(repo, list);
}

/**
 * The class's roster (not removed, in roll order), each row tied to its
 * student account by the access rule's terms, or to none with a reason.
 * `listStudents(ownerId)` lists the accounts below the class's owner
 * (listBelow in services/accounts.js).
 */
export async function rosterAccounts(repo, cls, { listStudents }) {
  const roster = (await repo.listClassStudents(cls._id)).filter((s) => !s.removedAt);
  const accounts = cls.ownerId ? await listStudents(cls.ownerId) : [];
  const byRoll = new Map();
  for (const a of accounts) {
    if (a?.role !== 'student' || a.active === false || String(a.reportsTo ?? '') !== String(cls.ownerId)) continue;
    const k = rollKey(a.rollNo);
    if (!k) continue;
    if (!byRoll.has(k)) byRoll.set(k, []);
    byRoll.get(k).push(a);
  }
  return roster.map((s) => {
    const matches = byRoll.get(rollKey(s.rollNo)) ?? [];
    return {
      roster: s,
      account: matches.length === 1 ? matches[0] : null,
      ...(matches.length === 1 ? {} : {
        note: matches.length ? 'Two student accounts carry this roll number, so neither is shown here. Correct one of them.'
          : 'No student account carries this roll number yet, so there is no hub practice to show.',
      }),
    };
  });
}

const DAY = 86400000;

/** Activity counts from a student's attempts (H17): no score, just how much and when. */
export function activityOf(attempts = [], now = new Date()) {
  const t = now.getTime();
  const within = (days) => attempts.filter((a) => t - Date.parse(a.createdAt) <= days * DAY && Date.parse(a.createdAt) <= t);
  const week = within(7);
  const byMode = Object.fromEntries(ATTEMPT_MODES.map((m) => [m, attempts.filter((a) => a.mode === m).length]));
  const days = new Set(week.map((a) => indiaDay(a.createdAt)));
  return {
    total: attempts.length,
    last7Days: week.length,
    last30Days: within(30).length,
    daysActiveLast7: days.size,
    byMode,
    // The tutor (H13): hints opened before answering, as each attempt recorded them. How much help, never a mark.
    hintsUsed: attempts.reduce((n, a) => n + (Number(a.hintsUsed) || 0), 0),
    attemptsWithHints: attempts.filter((a) => (Number(a.hintsUsed) || 0) > 0).length,
    lastAt: attempts.length ? attempts[attempts.length - 1].createdAt : null,
  };
}

/** Verified room answers of these accounts in rooms on these chapters, by account. */
async function classRoomAnswers(repo, scope, accountIds) {
  const wanted = new Set(accountIds.map(String));
  const out = new Map();
  if (!wanted.size) return out;
  const sessionIds = [];
  for (const ch of scope.chapters.values()) {
    for (const s of await repo.listSessionsForContent(ch.content._id)) sessionIds.push(String(s._id));
  }
  if (!sessionIds.length) return out;
  for (const a of await allAnswers(repo, { sessionIds, final: true, classVotes: false })) {
    if (a.accountVerified !== true || !wanted.has(String(a.accountId ?? ''))) continue;
    if (!out.has(String(a.accountId))) out.set(String(a.accountId), []);
    out.get(String(a.accountId)).push(a);
  }
  return out;
}

const staffTopicRef = (entry) => ({ ...topicRef(entry), unit: entry.unit ?? null });

/**
 * The class's practice at a glance (H17): per topic, students per state; per
 * student, in roll order, each topic's state with N and open errors.
 */
export async function classProgress(repo, cls, { listStudents, now = new Date() } = {}) {
  const scope = await classScope(repo, cls);
  const entries = [...scope.topics.values()];
  const models = await topicModels(repo, entries);
  const people = await rosterAccounts(repo, cls, { listStudents });
  const accountIds = people.filter((p) => p.account).map((p) => String(p.account.id));
  const roomByAccount = await classRoomAnswers(repo, scope, accountIds);
  const allAttempts = [...models.values()].flatMap((m) => m.attempts);
  const topicCounts = new Map(entries.map((e) => [lower(e.topic._id), { counts: zeroCounts(), openErrors: 0 }]));

  const students = [];
  for (const p of people) {
    const base = { rosterId: String(p.roster._id), rollNo: p.roster.rollNo, name: p.roster.name ?? '' };
    if (!p.account) {
      students.push({ ...base, accountId: null, note: p.note, topics: {}, activity: null });
      continue;
    }
    const who = String(p.account.id);
    const mine = allAttempts.filter((a) => String(a.accountId) === who);
    const log = buildErrorLog({ hubAttempts: mine, roomAnswers: roomAnswersInScope(roomByAccount.get(who) ?? [], scope) });
    const open = openByTopic(log);
    const topics = {};
    for (const entry of entries) {
      const key = lower(entry.topic._id);
      const st = stateFrom(models.get(key), who, { now, audience: 'staff' });
      const openErrors = open.get(String(entry.topic._id)) ?? 0;
      topics[String(entry.topic._id)] = {
        state: st.state, label: st.label, answers: st.answers, provisional: st.provisional, pRight: st.pRight, openErrors,
      };
      topicCounts.get(key).counts[st.state] += 1;
      topicCounts.get(key).openErrors += openErrors;
    }
    students.push({ ...base, accountId: who, topics, activity: activityOf(mine.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)), now) });
  }
  return {
    topics: entries.map((e) => ({ ...staffTopicRef(e), practiceQuestions: e.questions.length, ...topicCounts.get(lower(e.topic._id)) })),
    students,
    states: STATE_LABEL,
    notes: {
      order: STAFF_ORDER_NOTE,
      basis: 'Each state rests on the student\'s answers in the hub (N is how many). Answers in rooms are not counted in it; '
        + 'wrong ones show in the student\'s error log, marked "From class".',
      students: 'A student appears here once their account reports to the class\'s professor and the roster holds their roll number.',
    },
  };
}

/**
 * One roster student's practice (H17): topic states with N, activity counts,
 * and their error log with open entries per topic.
 */
export async function studentProgressForStaff(repo, cls, rosterRow, { listStudents, now = new Date() } = {}) {
  const people = await rosterAccounts(repo, cls, { listStudents });
  const person = people.find((p) => String(p.roster._id) === String(rosterRow._id))
    ?? { roster: rosterRow, account: null, note: 'This student has been removed from the roster.' };
  const student = { rosterId: String(rosterRow._id), rollNo: rosterRow.rollNo, name: rosterRow.name ?? '', accountId: person.account ? String(person.account.id) : null };
  if (!person.account) return { student, note: person.note, topics: [], activity: null, errors: null };
  const who = String(person.account.id);
  const scope = await classScope(repo, cls);
  const entries = [...scope.topics.values()];
  const models = await topicModels(repo, entries);
  const mine = [...models.values()].flatMap((m) => m.attempts.filter((a) => String(a.accountId) === who))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const roomRows = (await classRoomAnswers(repo, scope, [who])).get(who) ?? [];
  const errors = await errorLogOver(repo, { scope, hubAttempts: mine, roomRows, audience: 'staff' });
  return {
    student,
    topics: entries.map((e) => ({
      ...staffTopicRef(e),
      state: stateFrom(models.get(lower(e.topic._id)), who, { now, audience: 'staff' }),
      openErrors: errors.openByTopic[String(e.topic._id)] ?? 0,
    })),
    activity: activityOf(mine, now),
    errors,
    states: STATE_LABEL,
  };
}
