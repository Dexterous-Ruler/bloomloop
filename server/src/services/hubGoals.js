// A student's goals and their hub home (Phase 6, decisions H16 and H17).
//
// GOALS. A goal is the student's own: an exam date they set and the topics it
// covers (at most MAX_GOAL_TOPICS, each a live topic of a class they are on),
// with an optional title. Its progress is their topic states (services/hubElo.js)
// counted over those topics, with the N behind each and the days left. Nothing
// compares them with anyone; goals are shown to the student only (staff see the
// practice itself, H17, not the student's plans).
//
// THE HUB HOME, own past only:
//   - a mastery map: each class, its units in the professor's order, each
//     chapter's topics with the student's state, N and a sentence; chapters in
//     no unit under "Other chapters";
//   - the reviews due now, and those coming up (services/hubReview.js);
//   - each goal's progress;
//   - the refresher paths from their Get Ready checks (services/hubGetReady.js);
//   - their weeks: days practised and rested, no streak (services/hubReview.js);
//   - their right answers of those asked at each Bloom level, now and a month
//     ago, from the hub and their signed-in room answers (hubProgress.js
//     levelFigures);
//   - the sentence that their professor can see their progress (H17).
// Never a class average, a rank, coins or a streak, and no band name.
//
// FOR STAFF (H17), studentsByState: per topic of a class, the students in each
// state, in roll order, with the N behind each; never a ranking.

import { STATES, STATE_LABEL } from './hubElo.js';
import { REVIEW_SET_SIZE, RATING_RULE, UPCOMING_DAYS, indiaDay } from './hubReview.js';
import { labelHtml } from './richText.js';
import { studentClasses, notFound } from './hubAccess.js';
import { OTHER_CHAPTERS, classHead } from './hubViews.js';
import { stateFrom, studentScope, topicModels, topicRef } from './hubPractice.js';
import { BASIS_NOTE, LEVELS_BASIS, LEVELS_NOTE, STUDENT_NOTICE, bloomLevelsFor, classScope, consistencyFor } from './hubProgress.js';
import { activePaths } from './hubGetReady.js';
import { isRecordId } from '../ids.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();

export const MAX_GOALS = 10;
export const MAX_GOAL_TOPICS = 60;
export const MAX_GOAL_TITLE = 80;
export const GOAL_NOT_FOUND = 'That goal was not found.';
export const GOALS_NOTE = 'Only you see your goals.';

/** How many weeks the home shows. */
export const HOME_WEEKS = 4;

/* ---------------------------------------------------------------- inputs -- */

function titleFrom(raw) {
  if (raw === undefined || raw === null) return '';
  if (typeof raw !== 'string') throw fail('A goal\'s title is text.', 400);
  const title = raw.replace(/\s+/g, ' ').trim();
  if (title.length > MAX_GOAL_TITLE) throw fail(`A goal's title can be at most ${MAX_GOAL_TITLE} characters.`, 400);
  return title;
}

/** A calendar day, YYYY-MM-DD, that exists; not before today (India's day). */
export function examDateFrom(raw, today) {
  const day = String(raw ?? '').trim();
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== day) {
    throw fail('Give the exam date as a day, such as 2026-12-14.', 400);
  }
  if (day < today) throw fail('The exam date cannot be in the past.', 400);
  return day;
}

/** The goal's topics: 1 to MAX_GOAL_TOPICS live topics of the student's classes, each once, or the topic's one 404. */
function topicIdsFrom(raw, scope) {
  const ids = [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(',')).map((x) => lower(x)).filter(Boolean))];
  if (!ids.length) throw fail('Choose the topics your exam covers.', 400);
  if (ids.length > MAX_GOAL_TOPICS) throw fail(`A goal covers at most ${MAX_GOAL_TOPICS} topics.`, 400);
  return ids.map((id) => {
    const entry = isRecordId(id) ? scope.topics.get(id) : null;
    if (!entry) throw notFound('topic');
    return String(entry.topic._id);
  });
}

/** The student's own goal, or the one 404. */
async function ownGoal(repo, account, rawId) {
  const id = String(rawId ?? '').trim();
  const goal = isRecordId(id) ? await repo.getHubGoal(id) : null;
  if (!goal || String(goal.accountId) !== String(account.id)) throw fail(GOAL_NOT_FOUND, 404);
  return goal;
}

/* ---------------------------------------------------------------- writes -- */

export async function addGoal(repo, account, body = {}, { now = new Date() } = {}) {
  const today = indiaDay(now.toISOString());
  const held = await repo.listHubGoals(String(account.id));
  if (held.length >= MAX_GOALS) throw fail(`You can keep at most ${MAX_GOALS} goals. Remove one you no longer need first.`, 409);
  const scope = await studentScope(repo, account);
  return repo.addHubGoal({
    accountId: String(account.id),
    title: titleFrom(body.title),
    examDate: examDateFrom(body.examDate, today),
    topicIds: topicIdsFrom(body.topicIds, scope),
  });
}

export async function changeGoal(repo, account, rawId, body = {}, { now = new Date() } = {}) {
  const goal = await ownGoal(repo, account, rawId);
  const patch = {};
  if (body.title !== undefined) patch.title = titleFrom(body.title);
  // An unchanged date may be in the past (the exam happened); a new one may not.
  if (body.examDate !== undefined && String(body.examDate).trim() !== goal.examDate) {
    patch.examDate = examDateFrom(body.examDate, indiaDay(now.toISOString()));
  }
  if (body.topicIds !== undefined) patch.topicIds = topicIdsFrom(body.topicIds, await studentScope(repo, account));
  if (!Object.keys(patch).length && body.examDate === undefined) throw fail('Send the title, exam date or topics to change.', 400);
  return Object.keys(patch).length ? repo.updateHubGoal(goal._id, patch) : goal;
}

export async function removeGoal(repo, account, rawId) {
  const goal = await ownGoal(repo, account, rawId);
  return repo.deleteHubGoal(goal._id);
}

/* ----------------------------------------------------------------- reads -- */

/** A topic's state as the home and a goal show it. */
const stateView = (s) => ({
  state: s.state, label: s.label, answers: s.answers, provisional: s.provisional, outOf10: s.outOf10, sentence: s.sentence,
});

const reviewView = (r) => ({ due: r.due, dueAt: r.dueAt, when: r.when });

/** Days from one India day to another. */
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

/** What comes first for a goal: due reviews, then topics not sure yet, in progress, not started. */
const FOCUS_ORDER = ['needs-review', 'not-sure', 'in-progress', 'not-started'];

/**
 * One goal with its progress. Pure. `states`: topic id (lower case) ->
 * { entry, state } for the student's topics now.
 */
export function goalProgress(goal, states, today) {
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  const topics = goal.topicIds.map((id) => {
    const held = states.get(lower(id));
    if (!held) return { id: String(id), unavailable: true, sentence: 'This topic is no longer on your classes in the hub.' };
    counts[held.state.state] += 1;
    return { ...topicRef(held.entry), state: stateView(held.state), review: reviewView(held.state.review) };
  });
  const live = topics.filter((t) => !t.unavailable);
  const daysLeft = daysBetween(today, goal.examDate);
  let when;
  if (daysLeft < 0) when = 'The exam date has passed.';
  else if (daysLeft === 0) when = 'The exam is today.';
  else if (daysLeft === 1) when = 'The exam is tomorrow.';
  else when = `${daysLeft} days to go.`;
  const parts = [`${counts.mastered} of ${live.length} topic${live.length === 1 ? '' : 's'} mastered`];
  if (counts['needs-review']) parts.push(`${counts['needs-review']} due for review`);
  if (counts['not-started']) parts.push(`${counts['not-started']} not started`);
  const focus = FOCUS_ORDER.flatMap((s) => live.filter((t) => t.state.state === s)).slice(0, 3)
    .map((t) => ({ id: t.id, name: t.name, nameHtml: t.nameHtml, state: t.state.state, label: t.state.label }));
  return {
    id: String(goal._id),
    title: goal.title ?? '',
    titleHtml: labelHtml(goal.title ?? ''),
    examDate: goal.examDate,
    daysLeft,
    past: daysLeft < 0,
    counts,
    topics,
    focus,
    sentence: `${parts.join(', ')}. ${when}`,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  };
}

/** The student's topics with their states: topic id (lower case) -> { entry, state }. */
async function topicStates(repo, account, entries, now) {
  const models = await topicModels(repo, entries, { now });
  return new Map(entries.map((entry) => [lower(entry.topic._id), { entry, state: stateFrom(models.get(lower(entry.topic._id)), account.id, { now }) }]));
}

/** Goals soonest first, past ones last. */
const goalOrder = (a, b) => (Number(a.past) - Number(b.past)) || (a.past ? b.examDate.localeCompare(a.examDate) : a.examDate.localeCompare(b.examDate));

/** The student's goals with their progress. */
export async function goalsFor(repo, account, { now = new Date(), states = null } = {}) {
  const today = indiaDay(now.toISOString());
  const goals = await repo.listHubGoals(String(account.id));
  const held = states ?? await topicStates(repo, account, [...(await studentScope(repo, account)).topics.values()], now);
  return { goals: goals.map((g) => goalProgress(g, held, today)).sort(goalOrder), note: GOALS_NOTE, max: MAX_GOALS };
}

/** One class's mastery map: units in order, each chapter's topics with the student's state. */
function classMap(cls, scope, states) {
  const units = new Map();
  const other = new Map();
  for (const entry of scope.topics.values()) {
    const held = states.get(lower(entry.topic._id));
    if (!held) continue;
    let chapters = other;
    if (entry.unit) {
      if (!units.has(entry.unit.id)) units.set(entry.unit.id, { unit: entry.unit, chapters: new Map() });
      chapters = units.get(entry.unit.id).chapters;
    }
    const key = lower(entry.content._id);
    if (!chapters.has(key)) {
      chapters.set(key, { id: String(entry.content._id), title: entry.content.title ?? '', titleHtml: labelHtml(entry.content.title ?? ''), topics: [] });
    }
    chapters.get(key).topics.push({
      id: String(entry.topic._id),
      name: entry.topic.name,
      nameHtml: labelHtml(entry.topic.name),
      practiceQuestions: entry.questions.length,
      state: stateView(held.state),
      review: reviewView(held.state.review),
    });
  }
  return {
    class: classHead(cls),
    units: [...units.values()].map((u) => ({ ...u.unit, chapters: [...u.chapters.values()] })),
    otherChapters: { label: OTHER_CHAPTERS, chapters: [...other.values()] },
  };
}

/** Due now (most overdue first) and coming up within UPCOMING_DAYS, from the states already worked out. */
function dueFrom(states, now) {
  const horizon = now.getTime() + UPCOMING_DAYS * 86400000;
  const view = ({ entry, state }) => ({ ...topicRef(entry), state: state.state, label: state.label, answers: state.answers, review: reviewView(state.review) });
  const byDue = (a, b) => Date.parse(a.review.dueAt) - Date.parse(b.review.dueAt);
  const all = [...states.values()];
  return {
    due: all.filter((x) => x.state.review.due).map(view).sort(byDue),
    upcoming: all.filter((x) => !x.state.review.due && x.state.review.dueAt && Date.parse(x.state.review.dueAt) <= horizon).map(view).sort(byDue),
    setSize: REVIEW_SET_SIZE,
    rule: RATING_RULE,
  };
}

/**
 * A class's practice regrouped for staff: per topic, the students in each
 * state, in roll order (the order classProgress in services/hubProgress.js
 * lists them in), each with the N their state rests on. Pure.
 */
export function studentsByState(progress) {
  const withAccount = progress.students.filter((s) => s.accountId);
  return {
    topics: progress.topics.map((t) => ({
      ...t,
      students: Object.fromEntries(STATES.map((state) => [state, withAccount
        .filter((s) => s.topics[t.id]?.state === state)
        .map((s) => ({
          rosterId: s.rosterId, rollNo: s.rollNo, name: s.name, answers: s.topics[t.id].answers, provisional: s.topics[t.id].provisional,
        }))])),
    })),
    // Roster rows no account carries (or two do): in roll order, with the reason.
    noAccount: progress.students.filter((s) => !s.accountId).map((s) => ({ rosterId: s.rosterId, rollNo: s.rollNo, name: s.name, note: s.note })),
    states: STATE_LABEL,
    notes: progress.notes,
  };
}

/** A part of the home that could not be read is left out with a sentence, and the rest still shows. */
async function part(label, read, fallback) {
  try {
    return await read();
  } catch (err) {
    if (err.status && err.status < 500) throw err;
    console.error(`[hub] the home's ${label} could not be read:`, err.message);
    return { ...fallback, unavailable: `Your ${label} could not be read just now.` };
  }
}

/** The student's hub home (the header's list). */
export async function hubHome(repo, account, { now = new Date() } = {}) {
  const classes = await studentClasses(repo, account);
  const scopes = [];
  for (const cls of classes) scopes.push({ cls, scope: await classScope(repo, cls) });
  const entries = new Map();
  for (const { scope } of scopes) for (const [k, e] of scope.topics) if (!entries.has(k)) entries.set(k, e);
  const states = await topicStates(repo, account, [...entries.values()], now);
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));
  for (const { state } of states.values()) counts[state.state] += 1;
  return {
    notice: STUDENT_NOTICE,
    basis: BASIS_NOTE,
    states: STATE_LABEL,
    counts,
    classes: scopes.map(({ cls, scope }) => classMap(cls, scope, states)),
    reviews: dueFrom(states, now),
    goals: await part('goals', () => goalsFor(repo, account, { now, states }), { goals: [], note: GOALS_NOTE, max: MAX_GOALS }),
    paths: await part('refresher paths', async () => ({ paths: await activePaths(repo, account) }), { paths: [] }),
    weeks: await consistencyFor(repo, account, { now, weeks: HOME_WEEKS }),
    bloomLevels: await part('Bloom levels', () => bloomLevelsFor(repo, account, { now }), { levels: [], basis: LEVELS_BASIS, note: LEVELS_NOTE }),
    ...(classes.length ? {} : { empty: 'None of your classes is on the hub yet. Your professor adds you to a class by your roll number.' }),
  };
}
