// Questions the hub keeps closed to a student for now (Phase 6, decisions H9,
// H10, H13 and H14, and the room's own rule that a question's answer is never
// shown while it is being asked).
//
// Practice, a lesson and the tutor show a question's answer, its approved
// explanation and its hints to anyone who may be served it. Three things make a
// question that is otherwise practisable CLOSED for a while, because answering
// it in the hub would tell the student something they must not know yet:
//
//   'room'       it is being asked in a room right now: the question a phone in
//                an open room has been served and not yet finished (the room
//                keeps the answer back even through a retry), or the question
//                put to the whole class in an open room (a class question still
//                taking votes or paused). Any phone, not only this student's: a
//                room is account-free (decision 7), so a phone in it may be this
//                student under any roll number.
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
// refuses an answer to one. A self-test's result and the error log keep back
// the answer and the explanation of a question being asked in a room. Nothing
// here is written: the closed set is worked out from the rooms, self-tests and
// checks as they stand on every request.

import { openSelfTestQuestions } from './hubHeld.js';
import { currentCheckQuestions } from './hubGetReady.js';
import { studentScope } from './hubPractice.js';

const lower = (v) => String(v ?? '').trim().toLowerCase();
const fail = (message, status) => Object.assign(new Error(message), { status });

export const CLOSED_REASONS = Object.freeze(['room', 'self-test', 'getready']);

/** What a student is told about a closed question, by reason. */
export const CLOSED_SENTENCE = Object.freeze({
  room: 'That question is being asked in class right now, so it stays closed here until the class has moved on.',
  'self-test': 'That question is on a self-test you have not handed in yet, so it stays closed here until you hand it in.',
  getready: 'That question is the one your Get Ready check is asking now, so it stays closed here until you answer it there.',
});

/** What a self-test's result or the error log says where it keeps an answer back because a room is asking the question. */
export const ROOM_HELD_NOTE = 'This question is being asked in class right now, so what was right, and why, is shown here once the class has moved on.';

/** The 409 for an answer or a hint on a closed question. Nothing is stored. */
export const closedError = (reason) => fail(CLOSED_SENTENCE[reason] ?? CLOSED_SENTENCE.room, 409);

/**
 * The questions being asked in a room right now, among the open rooms on these
 * chapters: each phone's served question and the running class question. Ids
 * in lower case.
 */
export async function roomLiveQuestions(repo, contentIds = []) {
  const out = new Set();
  const seen = new Set();
  for (const raw of contentIds) {
    const key = lower(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const room of await repo.listSessionsForContent(raw)) {
      if (room.status === 'closed') continue;
      const [profiles, asked] = await Promise.all([repo.listProfiles(room._id), repo.listClassQuestions(room._id)]);
      for (const p of profiles) if (p.served?.questionId) out.add(lower(p.served.questionId));
      for (const cq of asked) {
        const id = cq.questionId ?? cq.questionSnapshot?.id;
        if (cq.state !== 'closed' && id) out.add(lower(id));
      }
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
