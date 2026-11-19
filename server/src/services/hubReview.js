// Spaced review in the Learning Hub, and weekly consistency (Phase 6, decision
// H8). Pure: no store; every function takes the clock as an argument.
//
// ONE CARD PER (student, topic), scheduled by ts-fsrs (MIT, pinned at 6.0.0)
// with its DEFAULT parameters (generatorParameters(): request retention 0.9,
// the published default weights, no fuzz, short-term learning steps of 1 and
// 10 minutes). A topic is a skill, not a single fact, so a "review" here is a
// short practice set on the topic (REVIEW_SET_SIZE questions), and the set's
// result is turned into the one rating FSRS takes.
//
// SESSIONS. A session is a run of the student's attempts on the topic, in any
// mode, with no gap of SESSION_GAP_MINUTES or more between two of them (server
// time). Each session is one review of the card, at the time of its last
// attempt, so the card follows the student as they answer: an attempt that
// continues a session re-rates that session, and one after a gap starts the
// next. The gap matches FSRS's longest default learning step (10 minutes): a
// student who comes back once a learning step is due starts a new review.
//
// THE SESSION RESULT AS A RATING (the mapping H8 asks to be documented). Each
// question's first attempt within the session counts once; `share` is the part
// of those answered right.
//   Again   share below 0.4         (the room ladder's demotion line, decision 2)
//   Hard    0.4 up to below 0.7
//   Good    0.7 or more             (the room ladder's promotion line, decision 2)
//   Easy    0.9 or more, from at least 5 answers, and no hint used in the
//           session (a hinted answer is not an effortless one)
// A session of one right answer is Good, of one wrong answer Again.
//
// DUE. A topic is due for review when its card's due time has passed. That is
// what makes its state "Needs review" (services/hubElo.js). A topic first
// practised a few minutes ago is due again soon after (FSRS's learning steps);
// a second session then sends it days ahead.
//
// WEEKLY CONSISTENCY. Per week (Monday to Sunday, India's time), the days the
// student practised and the days they rested, from their own attempts only.
// Rest days are named as rest, not as a gap. No streak is counted, kept or
// shown: a broken streak is a reason students quit (the roadmap's motivation
// section), and nothing here compares one student with another.

import { Rating, createEmptyCard, fsrs, generatorParameters } from 'ts-fsrs';

import { roomDay } from './records.js';
import { attemptOrder } from './hubElo.js';

export const SESSION_GAP_MINUTES = 10;
/** How many questions a review set asks for. */
export const REVIEW_SET_SIZE = 5;
/** How far ahead "coming up" looks in the due list. */
export const UPCOMING_DAYS = 7;

export const RATING_CUTS = Object.freeze({ hard: 0.4, good: 0.7, easy: 0.9, easyMinAnswers: 5 });

export const RATING_NAMES = Object.freeze({ [Rating.Again]: 'again', [Rating.Hard]: 'hard', [Rating.Good]: 'good', [Rating.Easy]: 'easy' });

/** The mapping in words, for a screen that explains a review (staff and student alike). */
export const RATING_RULE = 'A review is a short practice set on the topic. Its result sets when the topic comes back: '
  + 'under 40% right brings it back soonest, 40% to under 70% soon, 70% or more later, and 90% or more from at least '
  + '5 answers with no hint latest.';

const scheduler = fsrs(generatorParameters());

const timeOf = (a) => Date.parse(a?.createdAt ?? '') || 0;
const keyOf = (a) => String(a?.questionId ?? a?.questionSnapshot?.id ?? a?._id ?? '');

/**
 * One student's attempts on ONE topic as sessions, in order.
 *
 * @returns {{ startAt, endAt, answers, right, hints, questions: string[] }[]}
 *   `answers` and `right` count each question's first attempt in the session.
 */
export function sessionsOf(attempts = []) {
  const gap = SESSION_GAP_MINUTES * 60 * 1000;
  const out = [];
  let current = null;
  for (const a of [...attempts].filter((x) => typeof x.correct === 'boolean').sort(attemptOrder)) {
    const at = timeOf(a);
    if (!current || at - Date.parse(current.endAt) >= gap) {
      current = { startAt: a.createdAt, endAt: a.createdAt, answers: 0, right: 0, hints: 0, questions: [] };
      out.push(current);
    }
    current.endAt = a.createdAt;
    current.hints += Number(a.hintsUsed) || 0;
    const key = keyOf(a);
    if (current.questions.includes(key)) continue;
    current.questions.push(key);
    current.answers += 1;
    if (a.correct) current.right += 1;
  }
  return out;
}

/**
 * A session's result as the rating FSRS takes (the mapping in the header).
 *
 * @returns {{ grade: number, rating: 'again'|'hard'|'good'|'easy', share: number }}
 */
export function ratingFor(session) {
  const answers = Number(session?.answers) || 0;
  const share = answers ? (Number(session.right) || 0) / answers : 0;
  let grade;
  if (share < RATING_CUTS.hard) grade = Rating.Again;
  else if (share < RATING_CUTS.good) grade = Rating.Hard;
  else if (share >= RATING_CUTS.easy && answers >= RATING_CUTS.easyMinAnswers && !(Number(session.hints) > 0)) grade = Rating.Easy;
  else grade = Rating.Good;
  return { grade, rating: RATING_NAMES[grade], share };
}

/**
 * The topic's card after every session, and when it is due.
 *
 * @returns {{ card: object|null, sessions: number, reviews: { at, rating, share, answers, dueAt }[],
 *   dueAt: string|null, due: boolean, lastRating: string|null }}
 *   No card (and never due) before the first attempt.
 */
export function reviewState(attempts = [], now = new Date()) {
  const sessions = sessionsOf(attempts);
  if (!sessions.length) return { card: null, sessions: 0, reviews: [], dueAt: null, due: false, lastRating: null };
  let card = createEmptyCard(new Date(sessions[0].startAt));
  const reviews = [];
  for (const s of sessions) {
    const { grade, rating, share } = ratingFor(s);
    card = scheduler.next(card, new Date(s.endAt), grade).card;
    reviews.push({ at: s.endAt, rating, share, answers: s.answers, dueAt: card.due.toISOString() });
  }
  const dueAt = card.due.toISOString();
  return {
    card,
    sessions: sessions.length,
    reviews,
    dueAt,
    due: card.due.getTime() <= now.getTime(),
    lastRating: reviews[reviews.length - 1].rating,
  };
}

/** When a review is due, in words: "now", "in 9 minutes", "tomorrow", "on 2026-11-23". India's days. */
export function dueWords(dueAt, now = new Date()) {
  const t = Date.parse(dueAt ?? '');
  if (!Number.isFinite(t)) return '';
  const ms = t - now.getTime();
  if (ms <= 0) return 'now';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const today = indiaDay(now.toISOString());
  const day = indiaDay(dueAt);
  if (day === today) return 'later today';
  if (day === addDays(today, 1)) return 'tomorrow';
  return `on ${day}`;
}

/* --------------------------------------------------------- consistency -- */

/** A time's day in India (YYYY-MM-DD): one zone, no daylight saving (roomDay's rule). */
export const indiaDay = (iso) => roomDay({ startedAt: iso });

/** A YYYY-MM-DD day moved by n days. */
export function addDays(day, n) {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The Monday of the week a day is in. */
export function weekStart(day) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((dow + 6) % 7));
}

export const MAX_WEEKS = 26;

/**
 * The student's own weeks, newest first: which days they practised and which
 * they rested. Days still to come this week are `upcoming`, neither.
 *
 * @returns {{ start, end, days: { day, practised, attempts, upcoming }[], practisedDays, restDays, attempts, sentence }[]}
 */
export function weeklyConsistency(attempts = [], { now = new Date(), weeks = 8 } = {}) {
  const n = Math.max(1, Math.min(MAX_WEEKS, Number.isInteger(weeks) ? weeks : 8));
  const today = indiaDay(now.toISOString());
  const perDay = new Map();
  for (const a of attempts) {
    const day = indiaDay(a.createdAt);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const out = [];
  const thisWeek = weekStart(today);
  for (let w = 0; w < n; w += 1) {
    const start = addDays(thisWeek, -7 * w);
    const days = Array.from({ length: 7 }, (_, i) => {
      const day = addDays(start, i);
      const count = perDay.get(day) ?? 0;
      return { day, practised: count > 0, attempts: count, upcoming: day > today };
    });
    const practisedDays = days.filter((d) => d.practised).length;
    const restDays = days.filter((d) => !d.practised && !d.upcoming).length;
    const total = days.reduce((sum, d) => sum + d.attempts, 0);
    const current = w === 0;
    let sentence;
    if (!practisedDays) sentence = current ? 'No practice yet this week.' : 'A week of rest.';
    else {
      const p = `${practisedDays} day${practisedDays === 1 ? '' : 's'}`;
      const r = `${restDays} day${restDays === 1 ? '' : 's'}`;
      sentence = `${current ? 'This week you practised' : 'You practised'} on ${p}${restDays ? ` and rested on ${r}` : ''}.`;
    }
    out.push({ start, end: addDays(start, 6), days, practisedDays, restDays, attempts: total, sentence });
  }
  return out;
}

export const CONSISTENCY_NOTE = 'Rest days are part of learning: a few short sessions spread over the week help more than one long one. '
  + 'Only you and your professor see this, and nothing here is compared with anyone else.';
