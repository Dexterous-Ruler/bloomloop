// Questions the hub keeps closed to a student for now (Phase 6, decisions H9,
// H10, H13 and H14; and Batch 9's decision E1, which widened the room's rule).
//
// Practice, a lesson and the tutor show a question's answer, its approved
// explanation and its hints to anyone who may be served it. Three things make a
// question that is otherwise practisable CLOSED for a while, because answering
// it in the hub would tell the student something they must not know yet:
//
//   'room'       it is in the question set of a room that is not closed (open,
//                waiting to start, or paused): the room's own set
//                (sessions.question_ids), or, for a room opened on the whole
//                bank, every question of the chapter the room can serve
//                (servableFor in services/selector.js). EVERY question in it,
//                for every student, from the moment the room exists until the
//                professor closes it (E1): not only the one a phone is looking
//                at, since any of them may be the next served, and a key read
//                in the hub during the class would be the class's key. Any
//                student, not only those in the room: a room is account-free
//                (decision 7), so a phone in it may be anyone under any roll
//                number. Before E1 only the questions a phone had been served or
//                the class was being asked were closed.
//   'self-test'  it is on one of the student's self-tests that is still open
//                (H10: no hints and no feedback until it is handed in;
//                openSelfTestQuestions in services/hubHeld.js).
//   'getready'   it is the question one of the student's open Get Ready checks
//                is asking now (H9: the check finds out what the student knows,
//                with no hints; services/hubGetReady.js).
//
// While a question is closed, practice does not serve it, an answer to it in
// practice, a review set or a lesson is refused with a 409 and nothing is
// stored (the device keeps it and can send it again later), and no hint opens
// on it. A Get Ready check skips questions closed by a room or a self-test, and
// refuses an answer to one. A self-test built while a room holds a question
// leaves it out (services/hubExam.js). A self-test's result and the error log
// keep back the answer and the explanation of a question a room holds. Nothing
// here is written: the closed set is worked out from the rooms, self-tests and
// checks as they stand on every request, so a question opens the moment its
// room is closed.
//
// Cheap on purpose: a request reads the rooms of the chapters in hand (one
// indexed read each, and few rooms are ever not closed at once), and the
// chapter's questions only for such a room opened on the whole bank (one more
// read). No cache: a cached set would keep a question closed after its room
// closed.

import { openSelfTestQuestions } from './hubHeld.js';
import { currentCheckQuestions } from './hubGetReady.js';
import { studentScope } from './hubPractice.js';
import { roomQuestionIds, servableFor } from './selector.js';

const lower = (v) => String(v ?? '').trim().toLowerCase();
const fail = (message, status) => Object.assign(new Error(message), { status });

export const CLOSED_REASONS = Object.freeze(['room', 'self-test', 'getready']);

/** What a student is told about a closed question, by reason. */
export const CLOSED_SENTENCE = Object.freeze({
  room: 'That question is part of a class that is still running, so it stays closed here. It opens when your professor closes the class.',
  'self-test': 'That question is on a self-test you have not handed in yet, so it stays closed here until you hand it in.',
  getready: 'That question is the one your Get Ready check is asking now, so it stays closed here until you answer it there.',
});

/** What a self-test's result or the error log says where it keeps an answer back because a room holds the question. */
export const ROOM_HELD_NOTE = 'This question is part of a class that is still running, so what was right, and why, is shown here '
  + 'once your professor closes the class.';

/** The 409 for an answer or a hint on a closed question. Nothing is stored. */
export const closedError = (reason) => fail(CLOSED_SENTENCE[reason] ?? CLOSED_SENTENCE.room, 409);

/** A room that has not been closed: open, waiting to start or paused. */
export const roomRunning = (room) => (room?.status ?? 'open') !== 'closed';

/**
 * The questions held by the rooms on these chapters that are not closed (E1):
 * each such room's question set, or every question of the chapter it can serve
 * when it has no set. Ids in lower case.
 */
export async function roomLiveQuestions(repo, contentIds = []) {
  const out = new Set();
  const seen = new Set();
  for (const raw of contentIds) {
    const key = lower(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const running = (await repo.listSessionsForContent(raw)).filter(roomRunning);
    if (!running.length) continue;
    let bank = null;
    for (const room of running) {
      const set = roomQuestionIds(room);
      if (set) {
        for (const id of set) out.add(id);
        continue;
      }
      // Read once per chapter, and only for a room on the whole bank.
      bank ??= await repo.listQuestions(raw);
      for (const q of servableFor(room, bank)) out.add(lower(q._id));
    }
  }
  return out;
}

/**
 * Every question closed to this student now, by id (lower case) -> reason.
 * `contentIds`: the chapters whose rooms are read (those of the questions in
 * hand); `scope`: the student's (studentScope), read when not given.
 *
 * @returns {Promise<Map<string, 'room'|'self-test'|'getready'>>}
 */
export async function closedQuestions(repo, account, { contentIds = [], scope = null, now = new Date() } = {}) {
  const out = new Map();
  for (const id of await roomLiveQuestions(repo, contentIds)) out.set(id, 'room');
  for (const id of await openSelfTestQuestions(repo, account.id, now)) if (!out.has(id)) out.set(id, 'self-test');
  const s = scope ?? await studentScope(repo, account);
  for (const id of (await currentCheckQuestions(repo, account, { scope: s, now })).keys()) if (!out.has(id)) out.set(id, 'getready');
  return out;
}

/**
 * The questions a Get Ready check must not ask or take an answer to: those a
 * room is asking now and those on an open self-test. (Another open check's
 * question is not among them: two checks asking the same question at once is
 * left to the student.)
 */
export async function closedToCheck(repo, account, { contentIds = [], now = new Date() } = {}) {
  const out = new Map();
  for (const id of await roomLiveQuestions(repo, contentIds)) out.set(id, 'room');
  for (const id of await openSelfTestQuestions(repo, account.id, now)) if (!out.has(id)) out.set(id, 'self-test');
  return out;
}
