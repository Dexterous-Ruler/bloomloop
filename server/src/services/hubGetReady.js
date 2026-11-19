// Get Ready and the refresher path (Phase 6, decision H9).
//
// THE CHECK. A student chooses a target topic. The check covers the target's
// confirmed prerequisites (services/hubGraph.js), nearest first, as they stood
// when it started (kept on the run, 0028), and asks at most
// MAX_CHECK_QUESTIONS (12) questions over them.
//
// THE STOPPING RULE, per prerequisite, over the right-or-wrong of its first
// answers in the check, each to a different question (decide()):
//   two right out of two     Ready          stop asking about it
//   two wrong out of two     Needs review   stop asking about it
//   one of each              a third question decides: two of three right is
//                            Ready, otherwise Needs review
// So a prerequisite takes two or three questions (MAX_PER_PREREQUISITE), the
// check moves on as soon as the evidence suffices, and it stops once every
// prerequisite is decided or its 12 questions are used.
//   - A prerequisite the student had already Mastered in practice when the check
//     started (services/hubElo.js: at least 5 answers, about 8 in 10 or better
//     on its typical question, and not due for review) is Ready on that
//     evidence, with its N, and is not asked about.
//   - Not sure yet, with its counts, when the check cannot decide: its 12
//     questions ran out first (or before it was reached); the professor has
//     approved too few questions on it to decide; or it is in material that is
//     on none of the student's classes (an earlier semester's chapter, H3).
// Each answer is a hub attempt (mode 'getready', carrying the check's id), marked
// on the server by the practice loop's recordAttempt(), with its feedback after
// it as in practice: right or wrong, the right answer, the approved explanation.
// No hints (H10). The check's state is worked out from its answers on every
// read (checkState), as mastery is, and only its end is written.
//
// ONCE ENDED, A CHECK STAYS AS IT ENDED. Its end is written when it is complete
// (settle). After that it takes no answer, and its state is read with
// `ended`: a prerequisite it had not decided is Not sure yet whatever has
// changed since (the professor approving questions on it, a chapter placed on
// a class), so a complete check never reopens and its refresher path stays.
//
// WHICH QUESTION. On the prerequisite being checked: a question the student
// has never answered in the hub first, then any other, never one already asked
// in this check, and never one closed (services/hubClosed.js: being asked in a
// room now, or on one of the student's open self-tests, whose answer the check's
// feedback would show); ties in an order seeded by the check (hashOf), so a
// reload shows the same question. When every question left is closed, the check
// waits and says why.
//
// THE REFRESHER PATH, once the check is complete: the prerequisites that need
// review in dependency order (each after every one of them it needs: hubGraph's
// dependencyOrder over the professor's confirmed links), each saying why it is
// on the path in the student's own counts, ending at the target. Progress is the
// practice loop: a step is done when the student's answers on it since the
// check meet the check's own rule on their latest answers (the last two right,
// or two of the last three). Each question counts once per round (stepAnswers):
// an answer to a question met again counts only once every question on the
// topic has been answered since it last counted, so a key just shown is not
// taken as evidence, and a topic with few questions can still be finished.

import { ownerOf } from '../ownership.js';
import { NO_QUESTION, cleanAttemptId, recordAttempt, stateFrom, studentScope, topicModels } from './hubPractice.js';
import { attemptOrder, itemKeyOf } from './hubElo.js';
import { dependencyOrder, prerequisiteChain } from './hubGraph.js';
import { countedAttempts } from './hubHeld.js';
import { notFound } from './hubAccess.js';
import { labelHtml } from './richText.js';
import { NO_HINTS, RUN_NOT_FOUND, answersWord, cleanRunId, hashOf, questionsWord, shownQuestions } from './hubRuns.js';
import { closedError, closedToCheck } from './hubClosed.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();

export const MAX_CHECK_QUESTIONS = 12;
export const MAX_PER_PREREQUISITE = 3;

export const OUTCOMES = Object.freeze(['ready', 'needs-review', 'not-sure']);
export const OUTCOME_LABEL = Object.freeze({ ready: 'Ready', 'needs-review': 'Needs review', 'not-sure': 'Not sure yet' });

/** The stopping rule in words, for the screens (the header's rule). */
export const STOPPING_RULE = `The check asks at most ${MAX_CHECK_QUESTIONS} questions, about the topics this one needs first, nearest first. `
  + 'Two right answers in a row on a topic make it Ready and two wrong make it Needs review; after one of each, a third '
  + 'question decides (two of three right is Ready). A topic you have already mastered in practice is Ready without '
  + 'asking. A topic the check could not decide is Not sure yet.';

export const STEP_RULE = 'A step is done when your answers on it since the check are two right in a row, or two right of your last three. '
  + 'A question you answer again counts once you have answered every other question on the topic since.';
const STAFF_STEP_RULE = 'A step is done when their answers on it since the check are two right in a row, or two right of their last three. '
  + 'A question answered again counts once every other question on the topic has been answered since.';

export const COMPLETE = 'This Get Ready check is complete. Start a new one to check again.';
export const CHECK_WAITS = 'The questions left on this topic are closed for now: being asked in class, or on a self-test you have not '
  + 'handed in. The check carries on once one of them opens again.';

/* ------------------------------------------------------------------ pure -- */

/**
 * The stopping rule for one prerequisite: 'ready', 'needs-review', or null while
 * undecided. `results`: right (true) or wrong, first answers in order.
 */
export function decide(results = []) {
  const [a, b, c] = results;
  if (results.length >= 2 && a && b) return 'ready';
  if (results.length >= 2 && !a && !b) return 'needs-review';
  if (results.length >= 3) return [a, b, c].filter(Boolean).length >= 2 ? 'ready' : 'needs-review';
  return null;
}

/** Is a refresher step done (the check's rule on the latest answers)? */
export function stepDone(results = []) {
  const n = results.length;
  if (n >= 2 && results[n - 1] && results[n - 2]) return true;
  return n >= 3 && results.slice(-3).filter(Boolean).length >= 2;
}

/** Each topic's first answer per question, in order: topic id (lower case) -> [{ item, correct }]. */
function firstAnswers(attempts = []) {
  const out = new Map();
  const seen = new Set();
  for (const a of [...attempts].sort(attemptOrder)) {
    const item = lower(itemKeyOf(a));
    if (!item || seen.has(item) || typeof a.correct !== 'boolean') continue;
    seen.add(item);
    const t = lower(a.topicId);
    if (!out.has(t)) out.set(t, []);
    out.get(t).push({ item, correct: a.correct });
  }
  return { byTopic: out, asked: seen };
}

/**
 * A refresher step's counted answers since the check, in order, per topic (the
 * header's rule). A question counts once per round; a round ends once every
 * question the topic has now (`pools`: topic id (lower case) -> its practisable
 * question ids, lower case) has been counted in it. A question answered again
 * within a round is kept in the store and not counted. Pure.
 *
 * @returns {Map<string, { item, correct }[]>} topic id (lower case) -> its counted answers
 */
export function stepAnswers(attempts = [], pools = new Map()) {
  const out = new Map();
  const rounds = new Map();
  for (const a of [...attempts].sort(attemptOrder)) {
    const item = lower(itemKeyOf(a));
    if (!item || typeof a.correct !== 'boolean') continue;
    const t = lower(a.topicId);
    let round = rounds.get(t) ?? new Set();
    if (round.has(item)) {
      const pool = pools.get(t) ?? [];
      if (!pool.length || !pool.every((q) => round.has(q))) continue;
      round = new Set();
    }
    round.add(item);
    rounds.set(t, round);
    if (!out.has(t)) out.set(t, []);
    out.get(t).push({ item, correct: a.correct });
  }
  return out;
}

/**
 * Where a check stands (the header's rule). Pure.
 *
 * `prerequisites`: the run's, nearest first ({ topicId, prior }); `attempts`: the
 * check's own answers; `available`: topic id (lower case) -> the ids (lower case)
 * of the questions the check may ask on it now, with no entry for a topic on
 * none of the student's classes; `ended`: the check's end is written, so it is
 * read as it ended (a prerequisite it had not decided is Not sure yet, reason
 * 'ended', and nothing is asked).
 *
 * @returns {{ items: object[], asked: number, askedIds: Set<string>, current: number|null, complete: boolean }}
 *   each item: the prerequisite with `status` ('decided' | 'asking' | 'waiting'),
 *   `outcome` (null until decided), `source` ('check' | 'practice' | 'none'),
 *   `reason`, and `answers` / `right` (the check's, or the practice N behind a
 *   prior Ready, with `right` null).
 */
export function checkState(prerequisites = [], { attempts = [], available = new Map(), ended = false } = {}) {
  const { byTopic, asked } = firstAnswers(attempts);
  let current = null;
  const items = prerequisites.map((p, i) => {
    const results = (byTopic.get(lower(p.topicId)) ?? []).slice(0, MAX_PER_PREREQUISITE).map((x) => x.correct);
    const counts = { answers: results.length, right: results.filter(Boolean).length };
    const decided = (outcome, source, reason, n = counts) => ({ ...p, status: 'decided', outcome, source, reason, ...n });
    if (p.prior) return decided('ready', 'practice', 'mastered', { answers: p.prior.answers, right: null });
    const d = decide(results);
    if (d) return decided(d, 'check', 'decided');
    const pool = available.get(lower(p.topicId));
    const source = results.length ? 'check' : 'none';
    if (!pool) return decided('not-sure', source, 'elsewhere');
    if (!pool.some((q) => !asked.has(q))) return decided('not-sure', source, pool.length ? 'too-few' : 'no-questions');
    if (!ended && current !== null) return { ...p, status: 'waiting', outcome: null, source, reason: null, ...counts };
    if (asked.size >= MAX_CHECK_QUESTIONS) return decided('not-sure', source, results.length ? 'budget' : 'not-reached');
    // Questions it could ask now, after it ended: it stays as it ended.
    if (ended) return decided('not-sure', source, 'ended');
    current = i;
    return { ...p, status: 'asking', outcome: null, source, reason: null, ...counts };
  });
  return { items, asked: asked.size, askedIds: asked, current, complete: current === null };
}

/**
 * The next question on the prerequisite being checked: never one asked in this
 * check; one the student has not met in the hub first; then the check's seeded
 * order. Pure. `met`: question ids (lower case) the student has answered before.
 */
export function nextCheckQuestion(pool = [], { asked = new Set(), met = new Set(), seed = '' } = {}) {
  const left = pool.filter((q) => !asked.has(lower(q._id)));
  left.sort((a, b) => (Number(met.has(lower(a._id))) - Number(met.has(lower(b._id))))
    || (hashOf(`${seed}:${lower(a._id)}`) - hashOf(`${seed}:${lower(b._id)}`)));
  return left[0] ?? null;
}

const got = (item, you) => `${you ? 'you' : 'they'} got ${item.right} of ${item.answers} right`;

/** A prerequisite's sentence: what it ended as, and the counts behind it. */
export function outcomeSentence(item, { audience = 'student' } = {}) {
  const you = audience === 'student';
  if (item.status === 'asking') return item.answers ? `Being checked now: ${got(item, you)} so far.` : 'Being checked now.';
  if (item.status === 'waiting') return 'Still to check.';
  if (item.reason === 'mastered') {
    return `Ready: ${you ? 'you have' : 'they had'} mastered it in practice (${answersWord(item.answers)}), so the check did not ask about it.`;
  }
  if (item.outcome === 'ready') return `Ready: ${got(item, you)}.`;
  if (item.outcome === 'needs-review') return `Needs review: ${got(item, you)}.`;
  const whose = you ? 'your professor has' : 'the professor has';
  switch (item.reason) {
    case 'budget': return `Not sure yet: ${got(item, you)} before the check used its ${MAX_CHECK_QUESTIONS} questions.`;
    case 'not-reached': return `Not sure yet: the check used its ${MAX_CHECK_QUESTIONS} questions before it reached this topic.`;
    case 'too-few': return `Not sure yet: ${got(item, you)}, and ${whose} approved no other question on it to decide with.`;
    case 'no-questions': return `Not sure yet: ${whose} not approved any questions on it yet.`;
    case 'ended':
      return item.answers
        ? `Not sure yet: ${got(item, you)} when the check ended.`
        : 'Not sure yet: the check ended before it could ask about this topic.';
    case 'elsewhere':
      return item.answers
        ? `Not sure yet: ${got(item, you)}, and its chapter is no longer on ${you ? 'your' : 'their'} classes in the hub.`
        : `Not sure yet: it is in material that is not on ${you ? 'your' : 'their'} classes in the hub, so the check could not ask about it.`;
    default: return 'Not sure yet.';
  }
}

/** The check's one-line result. */
export function checkSentence(state, targetName, { audience = 'student' } = {}) {
  const you = audience === 'student';
  const n = (o) => state.items.filter((i) => i.outcome === o).length;
  if (!state.items.length) {
    return `"${targetName}" has no prerequisites the professor has confirmed, so ${you ? 'you can' : 'they can'} start it straight away.`;
  }
  if (!state.complete) return `Checking the topics "${targetName}" needs first: ${questionsWord(state.asked)} asked of at most ${MAX_CHECK_QUESTIONS}.`;
  const review = n('needs-review');
  const unsure = n('not-sure');
  const parts = [];
  if (review) {
    parts.push(`${review} prerequisite${review === 1 ? ' needs' : 's need'} review first; the refresher path goes through `
      + `${review === 1 ? 'it' : 'them'} and then to "${targetName}".`);
  } else {
    parts.push(`Nothing the check could decide needs review: ${you ? 'you can' : 'they can'} start "${targetName}".`);
  }
  if (unsure) parts.push(`${unsure} ${unsure === 1 ? 'is' : 'are'} not sure yet; practising ${unsure === 1 ? 'it' : 'them'} helps too.`);
  return parts.join(' ');
}

/**
 * A refresher path's steps from a complete check. Pure.
 *
 * `items`: the check's (checkState); `links`: the professor's confirmed links,
 * for the order; `since`: the student's counted hub attempts on those topics
 * after the check (not its own answers); `pools`: each step's practisable
 * question ids now, for stepAnswers' rounds (without them, each question counts
 * once).
 *
 * @returns {{ steps: object[], target: object, next: string|null, done: number }}
 *   each step: { topicId, name, depth, via, why, status: 'done' | 'in-progress' | 'to-do', answers, right, sentence };
 *   `next`: the first step not done, or the target's id once all are.
 */
export function refresherPath({ items = [], target, links = [], since = [], pools = new Map(), audience = 'student' } = {}) {
  const you = audience === 'student';
  const review = items.filter((i) => i.outcome === 'needs-review');
  const byId = new Map(review.map((i) => [lower(i.topicId), i]));
  const names = new Map([[lower(target.topicId), target.name], ...items.map((i) => [lower(i.topicId), i.name])]);
  const byTopic = stepAnswers(since, pools);
  const steps = dependencyOrder(review.map((i) => String(i.topicId)), links).map((id) => {
    const item = byId.get(lower(id));
    const results = (byTopic.get(lower(id)) ?? []).map((x) => x.correct);
    const right = results.filter(Boolean).length;
    const done = stepDone(results);
    const via = (item.via ?? []).map((v) => names.get(lower(v))).filter(Boolean);
    const needed = item.depth === 1 || !via.length
      ? `"${target.name}" builds on it${item.depth === 1 ? ' directly' : ''}.`
      : `It comes before ${via.map((v) => `"${v}"`).join(' and ')}, on the way to "${target.name}".`;
    const rule = you ? STEP_RULE : STAFF_STEP_RULE;
    let sentence;
    if (done) sentence = `Done: since the check ${you ? 'you' : 'they'} got ${right} of ${answersWord(results.length)} right.`;
    else if (results.length) sentence = `Since the check: ${right} of ${answersWord(results.length)} right. ${rule}`;
    else sentence = `Not practised since the check. ${rule}`;
    return {
      topicId: String(item.topicId),
      name: item.name,
      depth: item.depth,
      why: `On ${you ? 'your' : 'the'} path because ${got(item, you)} on it in the Get Ready check. ${needed}`,
      status: done ? 'done' : results.length ? 'in-progress' : 'to-do',
      answers: results.length,
      right,
      sentence,
    };
  });
  const doneCount = steps.filter((s) => s.status === 'done').length;
  const allDone = doneCount === steps.length;
  const next = steps.find((s) => s.status !== 'done');
  return {
    steps,
    target: {
      topicId: String(target.topicId),
      name: target.name,
      status: allDone ? 'ready' : 'waiting',
      sentence: allDone
        ? `${steps.length ? 'Every step before it is done' : 'Nothing needs review first'}: ${you ? 'start' : 'they can start'} "${target.name}" now.`
        : `The goal: start "${target.name}" once the steps above are done.`,
    },
    next: next ? next.topicId : String(target.topicId),
    done: doneCount,
  };
}

/* ----------------------------------------------------------------- reads -- */

const topicView = (id, name, chapter = null) => ({
  id: String(id),
  name,
  nameHtml: labelHtml(name),
  ...(chapter ? { chapter: { id: String(chapter.id), title: chapter.title ?? '', titleHtml: labelHtml(chapter.title ?? '') } } : {}),
});

/** topic id (lower case) -> the ids of its practisable questions, for the student's scope now. */
function availableIn(scope, prerequisites) {
  const out = new Map();
  for (const p of prerequisites) {
    const entry = scope.topics.get(lower(p.topicId));
    if (entry) out.set(lower(p.topicId), entry.questions.map((q) => lower(q._id)));
  }
  return out;
}

/** A check's own answers that count: all of them while it is open; once ended, those the server had by its end. */
const answersOf = (run, rows) => (run.endedAt ? rows.filter((a) => Date.parse(a.createdAt) <= Date.parse(run.endedAt)) : rows);

/** The check's answers, read once; its state for this student's scope now (as it ended, once it has). */
async function readCheck(repo, account, run, { scope = null } = {}) {
  const s = scope ?? await studentScope(repo, account);
  const prerequisites = run.spec?.prerequisites ?? [];
  const attempts = answersOf(run, await repo.listHubAttempts({ runIds: [String(run._id)] }));
  const state = checkState(prerequisites, { attempts, available: availableIn(s, prerequisites), ended: Boolean(run.endedAt) });
  return { scope: s, attempts, state };
}

/**
 * The question the check asks now on the prerequisite being checked
 * (nextCheckQuestion), leaving out the `closed` ones (closedToCheck); null
 * when none is left open.
 */
async function questionToAsk(repo, account, run, read, closed = new Map()) {
  const current = read.state.items[read.state.current];
  const entry = read.scope.topics.get(lower(current.topicId));
  const mine = await repo.listHubAttempts({ accountId: String(account.id), topicIds: [String(current.topicId)] });
  return nextCheckQuestion(entry.questions.filter((q) => !closed.has(lower(q._id))), {
    asked: read.state.askedIds, met: new Set(mine.map((a) => lower(itemKeyOf(a)))), seed: String(run._id),
  });
}

/** The chapter of the prerequisite a check is asking about now, for closedToCheck. */
const currentContentId = (read) => String(read.scope.topics.get(lower(read.state.items[read.state.current].topicId)).content._id);

/**
 * The question each of the student's open Get Ready checks is asking now, by id
 * (lower case) -> the check's id: closed to practice, lessons and the tutor
 * while it is asked (services/hubClosed.js). Writes nothing. Without 0028's
 * table no check can be open, and the log says why none is read.
 */
export async function currentCheckQuestions(repo, account, { scope = null, now = new Date() } = {}) {
  const out = new Map();
  const runs = (await repo.listHubRuns({ accountId: String(account.id), kind: 'getready' }).catch((err) => {
    console.error('[hub] Get Ready checks could not be read, so none is taken as open:', err.message);
    return [];
  })).filter((r) => !r.endedAt);
  if (!runs.length) return out;
  const s = scope ?? await studentScope(repo, account);
  for (const run of runs) {
    const read = await readCheck(repo, account, run, { scope: s });
    if (read.state.complete) continue;
    const closed = await closedToCheck(repo, account, { contentIds: [currentContentId(read)], now });
    const q = await questionToAsk(repo, account, run, read, closed);
    if (q) out.set(lower(q._id), String(run._id));
  }
  return out;
}

/** When a complete check ended: its written end, else the time of its last answer (or its start); null while open. */
function endOf(run, { attempts, state }) {
  if (run.endedAt) return run.endedAt;
  if (!state.complete) return null;
  return [...attempts].sort(attemptOrder).pop()?.createdAt ?? run.startedAt;
}

/** A complete check that has no end written yet gets it now (endOf). */
async function settle(repo, run, read) {
  const end = endOf(run, read);
  if (run.endedAt || !end) return run;
  return (await repo.endHubRun(run._id, { endedAt: end, endReason: 'complete' })) ?? run;
}

/** The same end for a staff read, which writes nothing: the run as it would read once settled. */
const asSettled = (run, read) => (run.endedAt || !read.state.complete ? run : { ...run, endedAt: endOf(run, read), endReason: 'complete' });

/** The student's counted hub attempts on these topics since the check ended, its own answers left out. */
async function attemptsSince(repo, accountId, run, topicIds) {
  if (!topicIds.length || !run.endedAt) return [];
  const rows = await repo.listHubAttempts({ accountId: String(accountId), topicIds: topicIds.map(String), since: run.endedAt });
  return (await countedAttempts(repo, rows)).filter((a) => String(a.runId ?? '') !== String(run._id));
}

/** The professor's confirmed links, for a path's order (the target's chapter's owner). */
async function linksFor(repo, run) {
  const target = run.spec?.target ?? {};
  const content = target.contentId ? await repo.getContent(target.contentId).catch(() => null) : null;
  if (!content) return [];
  return repo.listTopicLinks({ ownerId: ownerOf(content) });
}

/** One prerequisite as a screen shows it. */
const itemView = (item, audience) => ({
  topic: topicView(item.topicId, item.name, item.contentId ? { id: item.contentId, title: item.chapterTitle } : null),
  depth: item.depth,
  status: item.status,
  outcome: item.outcome,
  label: item.outcome ? OUTCOME_LABEL[item.outcome] : null,
  answers: item.answers,
  right: item.right,
  source: item.source,
  // Not sure yet is an honest "the check could not tell": provisional.
  provisional: item.outcome !== 'ready' && item.outcome !== 'needs-review',
  sentence: outcomeSentence(item, { audience }),
});

const pathView = (path, audience = 'student') => ({
  steps: path.steps.map((s) => ({ ...s, topic: topicView(s.topicId, s.name) })),
  target: { ...path.target, topic: topicView(path.target.topicId, path.target.name) },
  next: path.next,
  done: path.done,
  total: path.steps.length,
  rule: audience === 'student' ? STEP_RULE : STAFF_STEP_RULE,
});

/** A check's path, for a complete check: its order, why, and progress since (each step's questions from `scope`). */
async function pathFor(repo, accountId, run, state, audience, scope) {
  const target = { topicId: run.spec.targetTopicId, name: run.spec.target?.name ?? '' };
  const reviewIds = state.items.filter((i) => i.outcome === 'needs-review').map((i) => i.topicId);
  const [links, since] = await Promise.all([linksFor(repo, run), attemptsSince(repo, accountId, run, reviewIds)]);
  const pools = new Map(reviewIds.map((id) => [lower(id), (scope?.topics.get(lower(id))?.questions ?? []).map((q) => lower(q._id))]));
  return refresherPath({ items: state.items, target, links, since, pools, audience });
}

/** A check as its student sees it: where it stands, the question to answer, and once complete the path. */
export async function checkView(repo, account, run, { scope = null } = {}) {
  const read = await readCheck(repo, account, run, { scope });
  const ended = await settle(repo, run, read);
  const { state } = read;
  const spec = ended.spec ?? {};
  const out = {
    check: {
      id: String(ended._id),
      clientRunId: ended.clientRunId,
      startedAt: ended.startedAt,
      endedAt: ended.endedAt ?? null,
      status: state.complete ? 'complete' : 'open',
      asked: state.asked,
      maxQuestions: MAX_CHECK_QUESTIONS,
      rule: STOPPING_RULE,
    },
    target: topicView(spec.targetTopicId, spec.target?.name ?? '', spec.target?.contentId ? { id: spec.target.contentId, title: spec.target.chapterTitle } : null),
    prerequisites: state.items.map((i) => itemView(i, 'student')),
    sentence: checkSentence(state, spec.target?.name ?? ''),
    question: null,
  };
  if (!state.complete) {
    const current = state.items[state.current];
    const closed = await closedToCheck(repo, account, { contentIds: [currentContentId(read)] });
    const q = await questionToAsk(repo, account, ended, read, closed);
    if (q) {
      const shown = (await shownQuestions(repo, account, [q])).get(lower(q._id));
      out.question = {
        ...shown,
        topic: topicView(current.topicId, current.name),
        why: `Checking "${current.name}", which "${spec.target?.name ?? ''}" needs first.`,
        hints: NO_HINTS.getready,
      };
    } else {
      out.waiting = CHECK_WAITS;
    }
  } else {
    out.path = pathView(await pathFor(repo, account.id, ended, state, 'student', read.scope));
  }
  return out;
}

/* ---------------------------------------------------------------- writes -- */

/**
 * Start a check on a target topic of the student's (H9), or the stored one for
 * a resent client run id. The prerequisites, nearest first, and the practice
 * evidence that makes one Ready without asking, are fixed now.
 *
 * @returns {Promise<{ run, duplicate: boolean, scope }>}
 */
export async function startCheck(repo, account, body = {}, { now = new Date() } = {}) {
  const clientRunId = cleanRunId(body.clientRunId);
  if (!clientRunId) throw fail('Each Get Ready check needs its own id: 8 to 64 letters, digits, - or _.', 400);
  const held = await repo.getHubRunByKey(String(account.id), clientRunId);
  if (held) {
    if (held.kind !== 'getready') throw fail('That id belongs to a self-test. Start the check with a new id.', 409);
    return { run: held, duplicate: true, scope: null };
  }
  const raw = String(body.targetTopicId ?? '').trim();
  if (!raw) throw fail('Choose the topic to get ready for.', 400);
  const scope = await studentScope(repo, account);
  const entry = scope.topics.get(lower(raw));
  if (!entry) throw notFound('topic');

  const links = await repo.listTopicLinks({ ownerId: ownerOf(entry.content) });
  const chain = prerequisiteChain(entry.topic._id, links);
  const records = new Map((await repo.listChapterTopicsByIds(chain.map((c) => c.topicId))).map((t) => [lower(t._id), t]));
  // A retired topic is left out, as a student's view of the chain leaves it out.
  const live = chain.filter((c) => records.get(lower(c.topicId)) && !records.get(lower(c.topicId)).retiredAt);
  const reachable = live.map((c) => scope.topics.get(lower(c.topicId))).filter(Boolean);
  const models = await topicModels(repo, reachable, { now });
  const titles = new Map();
  const titleOf = async (contentId) => {
    const key = lower(contentId);
    if (!titles.has(key)) {
      const c = scope.chapters.get(key)?.content ?? await repo.getContent(contentId).catch(() => null);
      titles.set(key, c?.title ?? '');
    }
    return titles.get(key);
  };
  const prerequisites = [];
  for (const c of live) {
    const t = records.get(lower(c.topicId));
    const model = models.get(lower(c.topicId));
    const st = model ? stateFrom(model, account.id, { now }) : null;
    prerequisites.push({
      topicId: String(t._id),
      name: t.name,
      contentId: String(t.contentId),
      chapterTitle: await titleOf(t.contentId),
      depth: c.depth,
      via: c.via.map(String),
      prior: st?.state === 'mastered' ? { state: 'mastered', answers: st.answers } : null,
    });
  }
  const spec = {
    targetTopicId: String(entry.topic._id),
    target: { name: entry.topic.name, contentId: String(entry.content._id), chapterTitle: entry.content.title ?? '' },
    prerequisites,
  };
  const startedAt = now.toISOString();
  const state = checkState(prerequisites, { attempts: [], available: availableIn(scope, prerequisites) });
  const { run, duplicate } = await repo.addHubRun({
    accountId: String(account.id),
    clientRunId,
    kind: 'getready',
    spec,
    startedAt,
    // Nothing to ask (no prerequisites, or every one decided already): complete now.
    ...(state.complete ? { endedAt: startedAt, endReason: 'complete' } : {}),
  });
  return { run, duplicate, scope };
}

/**
 * Mark and keep one answer in a check: to a question on the prerequisite being
 * checked, not asked before in this check. A resent attempt id returns the
 * stored attempt (and is refused if it was another answer's).
 *
 * @returns {Promise<{ attempt, duplicate: boolean, entry: object|null }>}
 */
export async function answerCheck(repo, account, run, body = {}, { now = new Date() } = {}) {
  // The route asked ownRun() already; this keeps any other caller from filing an answer under someone else's.
  if (String(run?.accountId) !== String(account?.id) || run?.kind !== 'getready') throw fail(RUN_NOT_FOUND.getready, 404);
  const attemptId = cleanAttemptId(body.attemptId);
  if (!attemptId) throw fail('Each attempt needs its own id: 8 to 64 letters, digits, - or _.', 400);
  const held = await repo.getHubAttemptByKey(String(account.id), attemptId);
  if (held) {
    if (String(held.runId ?? '') !== String(run._id)) throw fail('That attempt id was used for another answer. Send this one with a new id.', 409);
    return { attempt: held, duplicate: true, entry: null };
  }
  // Read again here: a check whose end is written takes no answer, whatever
  // has changed since (its state is read as it ended).
  const fresh = (await repo.getHubRun(run._id).catch(() => null)) ?? run;
  if (fresh.endedAt) throw fail(COMPLETE, 409);
  const read = await readCheck(repo, account, fresh);
  if (read.state.complete) throw fail(COMPLETE, 409);
  const current = read.state.items[read.state.current];
  const entry = read.scope.topics.get(lower(current.topicId));
  const qid = lower(body.questionId);
  const q = entry.questions.find((x) => lower(x._id) === qid);
  if (!q || read.state.askedIds.has(qid)) throw fail(NO_QUESTION, 404);
  // Its feedback shows the answer: never for a question a room is asking now or one on an open self-test.
  const why = (await closedToCheck(repo, account, { contentIds: [String(entry.content._id)], now })).get(qid);
  if (why) throw closedError(why);
  return recordAttempt(repo, account, {
    attemptId,
    questionId: String(q._id),
    topicId: String(current.topicId),
    response: body.response,
    mode: 'getready',
    timeTakenMs: body.timeTakenMs,
    shown: body.shown,
  }, { now, hintsUsed: 0, runId: run._id });
}

/* ----------------------------------------------------------------- lists -- */

/** Each check's state, for a list or a staff read: one read of all their answers. */
async function statesOf(repo, runs, scope) {
  const attempts = runs.length ? await repo.listHubAttempts({ runIds: runs.map((r) => String(r._id)) }) : [];
  return runs.map((run) => {
    const own = answersOf(run, attempts.filter((a) => String(a.runId) === String(run._id)));
    const prerequisites = run.spec?.prerequisites ?? [];
    return {
      run,
      attempts: own,
      state: checkState(prerequisites, { attempts: own, available: availableIn(scope, prerequisites), ended: Boolean(run.endedAt) }),
    };
  });
}

const tallyOf = (state) => Object.fromEntries(OUTCOMES.map((o) => [o, state.items.filter((i) => i.outcome === o).length]));

/** The student's checks, newest first (`topicId` narrows to one target). */
export async function listChecks(repo, account, { topicId = null } = {}) {
  const runs = (await repo.listHubRuns({ accountId: String(account.id), kind: 'getready' }))
    .filter((r) => !topicId || lower(r.spec?.targetTopicId) === lower(topicId)).reverse();
  const scope = await studentScope(repo, account);
  const out = [];
  for (const { run, attempts, state } of await statesOf(repo, runs, scope)) {
    const ended = await settle(repo, run, { attempts, state });
    out.push({
      id: String(ended._id),
      clientRunId: ended.clientRunId,
      target: topicView(ended.spec?.targetTopicId, ended.spec?.target?.name ?? ''),
      startedAt: ended.startedAt,
      endedAt: ended.endedAt ?? null,
      status: state.complete ? 'complete' : 'open',
      asked: state.asked,
      counts: tallyOf(state),
      sentence: checkSentence(state, ended.spec?.target?.name ?? ''),
    });
  }
  return { checks: out, rule: STOPPING_RULE };
}

/**
 * The student's refresher paths for the hub home: the latest complete check per
 * target, newest first, at most `limit`.
 */
export async function activePaths(repo, account, { scope = null, limit = 5 } = {}) {
  const runs = (await repo.listHubRuns({ accountId: String(account.id), kind: 'getready' })).reverse();
  const s = scope ?? await studentScope(repo, account);
  const out = [];
  const seen = new Set();
  for (const { run, attempts, state } of await statesOf(repo, runs, s)) {
    const key = lower(run.spec?.targetTopicId);
    if (seen.has(key) || !state.complete) continue;
    seen.add(key);
    const ended = await settle(repo, run, { attempts, state });
    const path = await pathFor(repo, account.id, ended, state, 'student', s);
    out.push({
      checkId: String(ended._id),
      target: topicView(ended.spec.targetTopicId, ended.spec.target?.name ?? ''),
      endedAt: ended.endedAt,
      steps: path.steps.length,
      done: path.done,
      next: path.next,
      nextName: path.steps.find((st) => st.topicId === path.next)?.name ?? path.target.name,
      sentence: path.steps.length
        ? `${path.done} of ${path.steps.length} refresher step${path.steps.length === 1 ? '' : 's'} done before "${path.target.name}".`
        : path.target.sentence,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * One student's checks, for staff (H17): those whose target is one of the
 * class's topics, newest first, each prerequisite with its outcome and counts,
 * and the refresher path's progress. `account`: the roster row's student
 * account (services/hubProgress.js rosterAccounts).
 */
export async function checksForStaff(repo, account, { classTopicIds = new Set() } = {}) {
  const runs = (await repo.listHubRuns({ accountId: String(account.id), kind: 'getready' }))
    .filter((r) => classTopicIds.has(lower(r.spec?.targetTopicId))).reverse();
  const scope = await studentScope(repo, account);
  const out = [];
  for (const { run, attempts, state } of await statesOf(repo, runs, scope)) {
    // A staff read writes nothing, not even a check's end (an HOD writes nothing at all).
    const ended = asSettled(run, { attempts, state });
    const path = state.complete ? pathView(await pathFor(repo, account.id, ended, state, 'staff', scope), 'staff') : null;
    out.push({
      id: String(ended._id),
      target: topicView(ended.spec?.targetTopicId, ended.spec?.target?.name ?? ''),
      startedAt: ended.startedAt,
      endedAt: ended.endedAt ?? null,
      status: state.complete ? 'complete' : 'open',
      asked: state.asked,
      counts: tallyOf(state),
      prerequisites: state.items.map((i) => itemView(i, 'staff')),
      sentence: checkSentence(state, ended.spec?.target?.name ?? '', { audience: 'staff' }),
      path,
    });
  }
  return out;
}
