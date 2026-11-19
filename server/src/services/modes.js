// How a room runs (Phase 3, 0018): the waiting room, Teacher-led and Mixed.
//
// The settings themselves are read by sessionSettings() in services/mastery.js,
// beside the three that came before them, so there is one reader for all of
// them. This file holds what the rest of the server says and shows about them:
//
//   phones    the sentences a phone is sent in a waiting room, a Teacher-led
//             room, and when it reaches the room's cap on questions
//   teachers  the waiting room's "12 / 36 present" line, and for Mixed and
//             Teacher-led rooms the teacher records beside the digital answers,
//             each labelled, on the teacher's grid (teacher:grid and
//             GET /api/session/:code/grid)
//
// Nothing here goes to the projector (services/projector.js has its own
// whitelist), and the teacher records summarised here never reach a phone.

import { sessionSettings } from './mastery.js';
import { OBSERVATION_KINDS, STAFF_ONLY, roomDay, slotKey } from './records.js';

/** server:waiting, to a phone in a room the professor has not started yet. */
export const WAITING_MESSAGE = 'You are in. Your professor will start the questions soon - keep this page open.';

/** session:teacher-led, to a phone that tries to join a Teacher-led room. */
export const TEACHER_LED_MESSAGE = 'This class is teacher-led: no answers are taken on phones today. '
  + 'Follow along on the board and answer when your professor asks.';

/** server:exhausted's reason when a student reaches the room's questionsPerStudent. */
export const capReason = (cap) =>
  `This room asks each student ${cap} question${cap === 1 ? '' : 's'}, and you have answered them all.`;

/**
 * Why a waiting room cannot be started yet, or null when it can. A Teacher-led
 * room needs no phones; any other waits for one, as the handoff's Start button
 * does (canStart), since starting a room nobody has joined serves nobody.
 */
export function startBlocker(session, joined) {
  if (sessionSettings(session).mode === 'teacher-led' || joined > 0) return null;
  return 'No phone has joined this room yet, so there is nobody to start it for. '
    + 'Wait for the class to join with the room code, then start.';
}

/**
 * The waiting room's line for the teacher's screen: "12 / 36 present" is 12
 * phones joined of the 36 students marked present (present or late) in a class
 * room; a room with no class has no attendance and says "12 joined".
 * `attendance` is what classGrid() (services/roster.js) already worked out.
 */
export function waitingLine(session, rows, attendance = null) {
  const joinedN = rows.length;
  const present = attendance ? attendance.present : null;
  const blocker = startBlocker(session, joinedN);
  return {
    joinedN,
    present,
    classSize: attendance ? attendance.classSize : null,
    summary: attendance ? `${joinedN} / ${present} present` : `${joinedN} joined`,
    canStart: !blocker,
    ...(blocker ? { reason: blocker } : {}),
  };
}

/**
 * The teacher records of a Mixed or Teacher-led room, counted, beside the
 * digital answers, each under its own label: decision 3's safe default keeps
 * them apart, so neither is ever folded into the other's numbers.
 *
 *   digital  phones' answers: who joined, how many answered, how many answers.
 *            Absent in a Teacher-led room, where no phone answers.
 *   teacher  the marks in force today (one per student, as the observations
 *            read counts them), the wheel's picks and how many answered, the
 *            questions asked aloud, and the activities run.
 */
export async function teacherFeed(repo, session, rows) {
  const { mode } = sessionSettings(session);
  const day = roomDay(session);
  const [events, picks, tallies, activities] = await Promise.all([
    session.classId
      ? repo.listObservations({ classId: session.classId, day })
      : repo.listObservations({ sessionId: session._id }),
    repo.listWheelPicks(session._id),
    repo.listTallies(session._id),
    repo.listActivities(session._id),
  ]);

  // The mark in force per student is the latest event of their slot; a clear
  // (kind null) leaves none.
  const latest = new Map();
  for (const e of events) latest.set(slotKey(e), e);
  const observations = Object.fromEntries(OBSERVATION_KINDS.map((k) => [k.id, 0]));
  for (const e of latest.values()) if (e.kind && e.kind in observations) observations[e.kind] += 1;

  return {
    mode,
    ...(mode === 'teacher-led' ? {} : {
      digital: {
        label: 'Digital answers',
        joined: rows.length,
        answered: rows.filter((r) => r.answered > 0).length,
        answers: rows.reduce((n, r) => n + (r.answered ?? 0), 0),
      },
    }),
    teacher: {
      label: 'Teacher records',
      observations: { ...observations, observed: [...latest.values()].filter((e) => e.kind).length },
      wheel: {
        picks: picks.length,
        answered: picks.filter((p) => p.status === 'answered').length,
        pending: picks.filter((p) => p.status === 'pending').length,
      },
      tallies: tallies.length,
      activities: activities.length,
      privacy: STAFF_ONLY,
    },
  };
}

/**
 * What a room's teacher grid carries beyond its rows and attendance: the
 * waiting room's line while it waits, and the feed in a Mixed or Teacher-led
 * room. A Student-devices room that opened straight to open gets nothing, so
 * its grid is exactly what it always was.
 *
 * Never allowed to break the grid, which is pushed after every answer: a failed
 * read of the records leaves the feed out rather than telling a phone its saved
 * answer "did not save".
 */
export async function roomFeed(repo, session, rows, attendance = null) {
  const out = {};
  if (session.status === 'waiting') out.waiting = waitingLine(session, rows, attendance);
  if (sessionSettings(session).mode !== 'devices') {
    try {
      out.feed = await teacherFeed(repo, session, rows);
    } catch (err) {
      console.error('[modes] teacher feed failed:', err);
    }
  }
  return out;
}
