import { io } from 'socket.io-client';

// Same origin in demo mode; the Vite proxy forwards the upgrade in dev mode.
//
// This runs on college wifi in a lecture hall, so a drop is the normal case and
// not the exception. Reconnection is on by default and matters: TC-07 requires a
// device that drops mid-session to rejoin on the same roll number and resume the
// same profile, and Phase 5 requires that nothing the student did in between is
// lost.
//
// Only the settings below are overridden. The rest of socket.io's defaults are
// already right for this room and are left alone deliberately:
//   reconnection: true       - on, and it has to stay on.
//   randomizationFactor: 0.5 - every delay under the ceiling is already jittered
//                              by +/-50%, which is what pulls forty phones that
//                              all dropped on the same tick apart again before
//                              they reach it. Nothing to add.
//   backoff                  - already exponential: delay * 2^attempt, jittered,
//                              then capped at reconnectionDelayMax.
export function connect() {
  return io({
    // Websocket first, but never websocket only: a hall proxy that refuses the
    // upgrade must not take the room down with it.
    transports: ['websocket', 'polling'],
    // ...and fall back inside the SAME attempt. The default (false) spends a
    // whole backoff cycle failing on websocket before it will even try polling,
    // so on a network that blocks upgrades every student waits twice as long.
    tryAllTransports: true,
    // Never stop trying. This is also the default; it is written out because
    // both screens promise it in words ("you will come back in on your own"),
    // and a promise the UI makes should not depend on a library default.
    reconnectionAttempts: Infinity,
    // First retry inside a second (default 1000). Most hall drops are half a
    // second of nothing, and the student is staring at the phone through it.
    reconnectionDelay: 600,
    // Ceiling on one wait (default 5000). A dead access point stays dead for a
    // minute or more, and at the default every phone in the room knocks twelve
    // times a minute for the whole outage. At ten seconds they still come back
    // within ten seconds of the wifi returning, for half the noise.
    reconnectionDelayMax: 10000,
    // Give up on a single attempt sooner (default 20000). Associated to an AP
    // with no upstream, a handshake does not fail - it hangs - and at the
    // default the phone sits on a connection that will never open for twenty
    // seconds before it tries anything else.
    timeout: 10000,
  });
}

/**
 * Is this socket still going to come back on its own?
 *
 * `active` is socket.io's own answer, and it is the difference between the only
 * two things a screen may honestly say. It stays true through every retry, and
 * goes false only when the client has genuinely stopped: the server refused the
 * handshake, the server hung up, or we disconnected ourselves. Reconnecting is
 * the normal state here; an error is what is left when this is false.
 */
export const stillTrying = (socket) => Boolean(socket?.active);

/**
 * Try now, not at the end of the current backoff wait. For the browser's
 * 'online' event: the wifi is back, and a phone that waits out a ten-second
 * delay it chose while the network was dead looks broken to the student.
 * A socket that is connected, or already opening, is left alone; otherwise the
 * pending wait is dropped and one attempt starts at once. If it fails, the
 * normal jittered backoff takes over from its first step.
 */
export function tryNow(socket) {
  if (!socket || socket.connected || socket.io?._readyState === 'opening') return;
  socket.disconnect().connect();
}

export const EV = {
  studentJoin: 'student:join',
  studentAnswer: 'student:answer',
  studentNext: 'student:next',
  // What the browser observed about itself: the tab hidden, the window blurred,
  // focus mode ended, a paste. Fire and forget by design - the server validates
  // the kind against its own allow-list and answers nothing either way, because
  // telling a student which of their reports landed tells them exactly which
  // ones to suppress.
  studentSignal: 'student:signal',
  teacherWatch: 'teacher:watch',

  accepted: 'session:accepted',
  rejected: 'session:rejected',
  question: 'server:question',
  result: 'server:result',
  exhausted: 'server:exhausted',
  grid: 'teacher:grid',
  closed: 'session:closed',
  // Pausing is not closing: the room is held, every phone stays in it and every
  // profile stays intact. The server emits `paused` on the pause itself, and
  // again to any phone that joins, answers or asks for a question while the room
  // is stopped - so a student who arrives late is told the same thing as one who
  // was already sitting there.
  paused: 'session:paused',
  resumed: 'session:resumed',
  // Phase 3. A waiting room answers `waiting` where a question would go, until
  // the professor starts it. A Teacher-led room answers a join with
  // `teacherLed` in place of `accepted`, and sends nothing after it.
  waiting: 'server:waiting',
  teacherLed: 'session:teacher-led',
  // Phase 5. A class question: the phone parks its own question, votes in
  // the round that is open, and goes back when it closes. `classVote` echoes
  // the phone's own vote and never says right or wrong.
  studentVote: 'student:vote',
  classQuestion: 'class:question',
  classVote: 'class:vote',
  classClosed: 'class:closed',
  teacherClassQuestion: 'teacher:class-question',
  // Phase 7. A pack: the few questions this phone would be served next,
  // without keys, for answering while the connection is down. Asked for
  // after every join, and again when a class question starts or ends.
  studentPack: 'student:pack',
  pack: 'server:pack',
  // Final replies to an answer, each naming its answerId: saved and not
  // counted (with the server's sentence, and never a mark), and refused for
  // good (kept on the phone, never sent again).
  kept: 'server:kept',
  refused: 'server:refused',
  // Batch 9 (E4): a drawing's picture, sent ahead of its answer under the
  // answer's own id. Stored (its mediaId), not saved this time (send it
  // again), or refused for good with a sentence.
  studentDrawing: 'student:drawing',
  drawingStored: 'drawing:stored',
  drawingRejected: 'drawing:rejected',
  drawingRefused: 'drawing:refused',
  // Batch 9 (E5), the phone in an exam room: its rules changed mid-room
  // ({ examMode }, null when off), and an answer not taken before the whole
  // screen is shared ({ message, questionId, answerId }). What only exam mode
  // sends (student:exam-consent, student:screen, student:snapshot) is named
  // in learn/guard/Exam.jsx, so /join's first download does not carry it.
  examMode: 'exam:mode',
  screenNeeded: 'exam:screen-needed',
  // Batch 9 (E5): an exam room's signals, to its staff screens only.
  // { code, full, students: [{ rollNo, name?, summary?, snapshotAt? }] }:
  // full replaces the list, otherwise the students named are patched.
  teacherIntegrity: 'teacher:integrity',
  // Batch 8: a teaching move or activity prompt asked for on the console has
  // been written (or could not be): { code, requestId, state: done|failed,
  // suggestion, message }. To the room's teacher screens only.
  teachingMove: 'teacher:teaching-move',
};
