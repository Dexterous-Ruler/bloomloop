// F5 - the live loop. Ten phones, one code, zero LLM calls: everything served
// here comes out of the bank that F2 built before the class started.
//
// Three module-level caches keep the hot path off the database:
//   presence     - who is connected right now, the grid's `online` column
//   bankCache    - the active question bank, read once per session
//   sessionCache - the open session document, so answering does not re-query it
// The session router clears the last two through releaseSession() on close.

import { getRepo } from '../repo/index.js';
import {
  emptyProfile,
  hydrate,
  applyAnswer,
  recordUngraded,
  sessionSettings,
  retriesFor,
  triesSpent,
  answerPrint,
  applyReview,
  REVIEW_MARKS,
} from '../services/mastery.js';
import { selectNext, servableFor, inRoomSet, reasonForPhone } from '../services/selector.js';
import { practisedQuestionIds } from '../services/bankShare.js';
import { needsApproval } from '../services/edits.js';
import { buildGridRow, phoneRow } from '../routes/session.js';
import { isRecordId } from '../ids.js';
import { score, forStudent, countsTowardMastery, shownOptionIndices, readyToMark } from '../questionTypes.js';
import { enginesReady } from '../figures/index.js';
import { verifyAccountToken, verifyTeacherCredentials } from '../auth.js';
import { canRead, ownerOf } from '../ownership.js';
import { phoneSupports } from '../accommodations.js';
import { findStudentForRoll, getAccommodations, rollKey } from '../services/accounts.js';
import {
  reportFromClient,
  checkLatency,
  noteSecondSocket,
  checkLevelJump,
} from '../services/integrity.js';
// Roll numbers in the wild look like 21BCE1234, CS-045, 2/A. Anything else is a
// typo or a probe, and an empty one would collide with every other empty one.
// ROLL_SHAPE lives with the roster so a class list can never hold a roll number
// no phone could join with.
import { ROLL_SHAPE, markJoined, classGrid, signalsOff } from '../services/roster.js';
import { TEACHER_LED_MESSAGE, WAITING_MESSAGE, capReason, roomFeed } from '../services/modes.js';
import { claimConnection, pushProjector, screenOf, watchWall } from '../services/projector.js';
import { roomInsights, sampleFromGrid, scheduleInsights } from '../services/insights.js';
import { CONFIDENCE_CHOICES, confidenceFrom, storedConfidence } from '../services/confidence.js';
import { phoneProvenance } from '../services/honesty.js';
// Phase 6 (decision H15): formulas and code as HTML, an additive field.
import { phoneRich } from '../services/richText.js';
import {
  CLASS_LOCK,
  OWN_QUESTION_DETAIL,
  LATE_DETAIL,
  EARLY_DETAIL,
  PAUSED_DETAIL,
  UNVERIFIED_DETAIL,
  asQuestion,
  classQuestionBody,
  mineNow,
  phoneClosed,
  phoneQuestion,
  phoneVote,
  roundOf,
  runningOf,
  startable,
  transition,
  votesOf,
  votingRound,
  withoutAsked,
} from '../services/classQuestions.js';
import {
  AFTER_CLOSE_DETAIL,
  ANSWERED_AGAIN_DETAIL,
  ANSWERED_AGAIN_MESSAGE,
  ASKED_KEPT_MESSAGE,
  DELIVER_IMPORTED_REASON,
  DELIVER_MESSAGE,
  GRACE_MS,
  KEPT_LIMIT,
  KEPT_LIMIT_MESSAGE,
  NOT_THIS_ROOM_MESSAGE,
  OVER_CAP_DETAIL,
  PACK_EMPTY_NOTE,
  PACK_FAILED_NOTE,
  PACK_SIZE,
  choosePack,
  deviceTimeOf,
  keptAfterClose,
  keptAnsweredAgain,
  keptNotCounted,
  lateVerdict,
  livePack,
  logServed,
  overCapMessage,
  packExpiry,
  packPayload,
  packRecordNeed,
  packableLevels,
  sameId,
  servedAtFor,
} from '../services/offline.js';
import { isImportedRoom } from '../services/roomImport.js';
import { allAnswers } from '../services/evidence.js';

const presence = new Map(); // `${code}:${rollNo}` -> socket.id
const bankCache = new Map(); // sessionId -> Promise<question[]>
const sessionCache = new Map(); // code -> open session document
const profileLocks = new Map(); // `${sessionId}:${rollNo}` -> tail of that student's queue
const deletingRooms = new Map(); // sessionId -> how many deletes of it are under way

// The idempotency key a phone sends with every attempt. One key per attempt,
// reused verbatim on every resend of that attempt, so the server can tell "the
// same answer again" from "a new answer".
const ANSWER_ID = /^[A-Za-z0-9_-]{8,64}$/;

const key = (code, rollNo) => `${String(code).toUpperCase()}:${rollNo}`;

/**
 * What a phone is told about itself (phoneRow in routes/session.js): the room's
 * goal and whether it adapts decide the row's `next`. Decision (a) of 19 Nov
 * 2026: never the teacher's GridRow, which carries the band and the signals.
 */
const rowFor = (profile, settings) =>
  phoneRow(profile, { online: true, goal: settings.masteryGoal, adapt: settings.adapt });

/**
 * Said to a phone that sent a sign-in the room could not link (decision 7): an
 * expired token, another kind of account, another roll number, or a room that is
 * not their professor's. One sentence for all of them; the phone joins as a guest.
 */
const NOT_LINKED = 'This room is not linked to your account, so your answers here will not appear in your history. '
  + 'Check that you are signed in and typed your own roll number.';

/** Did a check just record a signal? `before` is the list as it was, element for element. */
const recorded = (list, before) => list.length !== before.length || list.at(-1) !== before.at(-1);

/** The grid's online column. Read by the REST grid too, so both agree. */
export function isOnline(code, rollNo) {
  return presence.has(key(code, rollNo));
}

/** Called by the session router when a session closes. */
export function releaseSession({ sessionId = null, code = null } = {}) {
  if (sessionId) bankCache.delete(String(sessionId));
  if (code) sessionCache.delete(String(code).toUpperCase());
}

/**
 * Called when the question bank changes underneath a session that is already
 * running - a discard, a split, a merge, a regenerate, a replacing generate.
 *
 * Without this the cache outlives the edit: a teacher discarding the item a
 * student is stuck on watched the same item come straight back on their next
 * question, and a replacing generate left every live session serving rows that
 * no longer existed. The pin-resurrection guard in dispatchNext() could not
 * catch either, because it checks the status of the copy IN the cache.
 *
 * Clearing all of it rather than one entry is deliberate. The cache is keyed by
 * session and holds no contentId, so there is nothing to match on, and the
 * alternative - a second index kept in step by hand - is a bug waiting to be
 * written. The cost is one bank read per live session on its next question;
 * teachers edit a bank a handful of times, so this runs a handful of times.
 */
export function releaseBanks() {
  bankCache.clear();
}

/**
 * One read-modify-write of a student's profile at a time. Resolves once every
 * earlier holder for this student has finished, with the function to call when
 * this one has.
 *
 * Every handler below reads the profile, changes it and writes the whole row
 * back. For one phone that was sequential in practice. A professor's review
 * (routes/review.js) is a second writer on another connection, and an override
 * landing between a socket's read and its write was silently undone by that
 * write: the answer row said "overridden" and the level tally did not. So the
 * handlers that write a profile, and the review route, all take this first.
 *
 * In-process, which is enough: one server process owns every socket and every
 * route. Nothing that runs while it is held may ask for it again.
 */
export async function lockProfile(sessionId, rollNo) {
  const k = `${String(sessionId)}:${String(rollNo)}`;
  const before = profileLocks.get(k) ?? Promise.resolve();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const tail = before.then(() => held);
  profileLocks.set(k, tail);
  await before;
  return () => {
    release();
    if (profileLocks.get(k) === tail) profileLocks.delete(k);
  };
}

/**
 * Hold a room still while it is archived and deleted.
 *
 * DELETE /api/session/:code reads the whole room into its archive, then deletes
 * the live rows. A review or a live answer landing between the two was answered
 * as saved and then deleted with the room: in neither the archive nor the
 * tables. So the room is marked first - every writer checks the mark under the
 * student's lock and refuses (roomDeleting) - and then each student's lock is
 * taken and dropped once, which waits out any writer that got in before the
 * mark. After that nothing can change what the archive reads.
 *
 * `students` lists the room's roll numbers. It is called after the mark is set,
 * so a student who joins while this runs is either in the list, or joins a room
 * already marked and has every answer refused.
 * Returns the function that lifts the mark; the route calls it whether or not
 * the delete went ahead. Counted, not a set, so a second DELETE of the same room
 * finishing first cannot lift the first one's mark.
 */
export async function holdRoomForDelete(sessionId, students) {
  const id = String(sessionId);
  deletingRooms.set(id, (deletingRooms.get(id) ?? 0) + 1);
  const lift = () => {
    const n = (deletingRooms.get(id) ?? 1) - 1;
    if (n > 0) deletingRooms.set(id, n);
    else deletingRooms.delete(id);
  };
  try {
    for (const rollNo of new Set((await students()).map(String))) (await lockProfile(id, rollNo))();
  } catch (err) {
    lift();
    throw err;
  }
  return lift;
}

/** True while a delete of this room is under way. Read under the student's lock. */
export const roomDeleting = (sessionId) => deletingRooms.has(String(sessionId));

function logError(event, err) {
  console.error(`[socket] ${event} failed:`, err);
}

const fail = (message, status) => Object.assign(new Error(message), { status });

/** A payload we chose to drop is not a crash - one line, no stack. */
function logIgnored(event, detail) {
  console.warn(`[socket] ${event} ignored: ${detail}`);
}

function reject(socket, reason, ids = {}) {
  socket.emit('session:rejected', { reason, ...ids });
}

/**
 * Which of a phone's answers a reply is about (Batch 8, the phone outbox's
 * ask): the question as the phone sent it, and its own answerId when that is
 * one the server takes as a key. Spread into every reply to an answer,
 * refusals and "not now" replies included, so an outbox matches each reply to
 * its item by id and never by the order replies arrive in.
 */
function answerEcho(payload) {
  const sent = String(payload?.answerId ?? '');
  return { questionId: String(payload?.questionId ?? ''), ...(ANSWER_ID.test(sent) ? { answerId: sent } : {}) };
}

/** The same for a vote: the class question, and the phone's own answerId. */
function voteEcho(payload) {
  const sent = String(payload?.answerId ?? '');
  return { classQuestionId: String(payload?.classQuestionId ?? ''), ...(ANSWER_ID.test(sent) ? { answerId: sent } : {}) };
}

function normaliseRoll(raw) {
  const value = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
  return ROLL_SHAPE.test(value) ? value : null;
}

/**
 * Open sessions are cached; a closed one is not, so the next lookup after the
 * teacher hits Close reads the real status and shuts the loop down.
 */
async function loadSession(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) return null;
  const cached = sessionCache.get(code);
  if (cached) return cached;
  const session = await getRepo().getSessionByCode(code);
  if (session && session.status === 'open') sessionCache.set(code, session);
  return session;
}

/**
 * One bank read per session, shared by every student in it. The promise itself
 * is cached so ten simultaneous joins issue one query, not ten.
 *
 * The bank is what the ROOM may serve: active, and inside its question set when
 * it has one (servableFor). Selection, the resumed pin and the bank count a
 * phone is told all read this, so none of them can reach outside the set.
 *
 * Nor to a question the room has asked to the class (Phase 5, 0023): once put
 * to the whole class it is never served to a phone on its own in this room
 * again (services/classQuestions.js says why). Starting a class question clears
 * this cache (releaseSession), so the next read leaves it out.
 *
 * A closed room's bank is read and not cached (Phase 7): only answers that
 * arrive after the close read it, and a cache entry would outlive the room.
 */
function loadBank(session) {
  const id = String(session._id);
  const read = () => {
    const repo = getRepo();
    return Promise.all([repo.listQuestions(session.contentId), repo.listClassQuestions(session._id)])
      .then(([questions, asked]) => withoutAsked(servableFor(session, questions), asked));
  };
  if (session.status === 'closed') return read();
  let pending = bankCache.get(id);
  if (!pending) {
    pending = read();
    // A failed read must not poison the cache for the rest of the session.
    pending.catch(() => bankCache.delete(id));
    bankCache.set(id, pending);
  }
  return pending;
}

/**
 * The `teacher:grid` payload: { rows, code }, and for a room opened for a class
 * each row's `rosterName` and the room's `attendance` (classGrid in
 * services/roster.js, which the REST grid uses too); while a room waits to
 * start, `waiting`, and in a Mixed or Teacher-led room, `feed` (roomFeed in
 * services/modes.js, likewise). Teacher screens only: the roster's names, the
 * present count and the teacher records never go to a phone.
 *
 * Every grid built here is also a sample of the room's KPIs for the live
 * insights' series (sampleFromGrid), from what this already read.
 */
async function gridPayload(session) {
  const repo = getRepo();
  const profiles = await repo.listProfiles(session._id);
  // The room's own mastery goal, so the live grid and the REST grid agree.
  const { masteryGoal, adapt } = sessionSettings(session);
  const rows = profiles.map((p) =>
    buildGridRow(p, { online: isOnline(session.code, p.rollNo), goal: masteryGoal, adapt }));
  const seen = {};
  const { rows: decorated, attendance } = await classGrid(repo, session, rows, seen);
  sampleFromGrid(session, { profiles, ...seen });
  return {
    rows: decorated,
    code: session.code,
    ...(attendance ? { attendance } : {}),
    ...(await roomFeed(repo, session, decorated, attendance)),
  };
}

/**
 * The question as it stood when it was answered, kept with the answer.
 *
 * Questions are edited, regenerated and deleted after a class; the evidence of
 * what a student was actually asked must not change with them. Teacher-only:
 * this lives in the answers store, which no student route reads.
 */
export function snapshotOf(question, shownOptions = null) {
  // `checks` is the professor's review advice, not part of what was asked, and
  // at a kilobyte or so it would be copied into every answer row. Who approved
  // the question and when describe the bank's row, not what was asked, and they
  // change without the question changing (an older question approved during a
  // class): kept here, they split one unchanged question into two versions in
  // the item report and two copies in a room's archive. The model and the slides
  // stay - they say where the question came from, and never change on a row.
  // The misconception labels (0024) are staff commentary that changes without
  // the question changing, and a report reads the question's current ones
  // (services/misconceptions.js); kept here, a label would ride in every answer
  // row and its archive, a step nearer a phone than it ever needs to be.
  // `roomsOnly` (Batch 8, 0035) is the owner's sharing switch on the bank's row,
  // not part of what was asked, and it changes without the question changing.
  const { _id, contentId, createdAt, status, checks, approvedBy, approvedAt, misconceptions, roomsOnly, ...rest } = question ?? {};
  // With the fewer-choices support an mcq or multi is shown as a shorter list,
  // and the response is a position in THAT list. Which options were left is
  // derived from the student's supports at the moment of serving, and those can
  // change afterwards, so it is kept here (original indices, in shown order):
  // without it a later reading of the response, item analysis's option counts
  // above all, would put the student's pick on the wrong option. Absent for
  // everyone shown the full list, which is everyone without the support.
  return { id: String(_id ?? ''), ...rest, ...(shownOptions ? { shownOptions } : {}) };
}

/**
 * How many extra goes this student gets at this question. Computed on the
 * options the student was actually SHOWN: with fewer choices on, a retry that
 * would be safe on the full list could leave a single option standing.
 */
function retriesAllowed(question, settings, rollNo, supports) {
  const keep = shownOptionIndices(question, `${rollNo}:${question._id}`, supports);
  const shown = keep && Array.isArray(question.options)
    ? { ...question, options: keep.map((i) => question.options[i]) }
    : question;
  return retriesFor(shown, settings.reattempts);
}

/**
 * Push the room's grid to every teacher screen watching it. Also used after a
 * review. A projector showing the class's progress moves with the same joins
 * and answers, so it is pushed too; on any other screen it has nothing new.
 * The live insights follow the grid to the same teacher screens, throttled
 * (teacher:insights, services/insights.js scheduleInsights); never to a phone or
 * the projector.
 */
export async function broadcastGrid(io, session) {
  io.to(`teacher:${session.code}`).emit('teacher:grid', await gridPayload(session));
  await pushProjector(io, getRepo(), session, { onlyIf: 'progress' });
  scheduleInsights(io, getRepo(), session);
}

/**
 * Hand the student their next item. The payload is assembled field by field:
 * `answerIdx` must never reach a phone before the answer is in.
 */
async function dispatchNext(socket, { profile, session, bank = null, resume = false }) {
  const supports = socket.data.student?.supports ?? null;
  try {
    const settings = sessionSettings(session);
    // The room's cap on questions per student (0018). `history` holds one entry
    // per question finished, so a question still being retried is under it.
    const cap = settings.questionsPerStudent;
    if (cap && profile.history.length >= cap) {
      socket.emit('server:exhausted', { profile: rowFor(profile, settings), reason: capReason(cap) });
      return;
    }

    const items = bank ?? (await loadBank(session));

    // Resuming: serve the question this student was already on, not a new one.
    // Without this a reconnect ran the selector again and handed back a
    // different item, so a half-finished answer was not merely lost - the
    // question it belonged to was gone too.
    let pick = null;
    // Whether the pin was actually honoured. Derived here, at the one moment it
    // is known, because it is the only honest source: the reason string is not.
    let resumed = false;
    if (resume && profile.served?.questionId) {
      const held = items.find((q) => sameId(q._id, profile.served.questionId));
      // Only if it is still servable. A question the teacher discarded between
      // the drop and the reconnect must not come back from the dead.
      if (held && (held.status ?? 'active') === 'active') {
        pick = { question: held, reason: profile.served.reason || 'Picking up where you left off.' };
        resumed = true;
      }
    }
    // Batch 8: a signed-in student is not served, at the level chosen, a question
    // they already practised in the hub while another is left (services/bankShare.js).
    if (!pick) pick = selectNext(profile, items, { avoid: socket.data.student?.practised ?? null });

    if (!pick) {
      socket.emit('server:exhausted', { profile: rowFor(profile, settings) });
      return;
    }

    const q = pick.question;

    // Pinned before it is sent, and only when it changes: the profile is the
    // record of what this student is looking at, and it has to be written before
    // the phone can possibly answer it. Logged too, in the same write (Phase 7):
    // the pin moves on, the log keeps every question this phone was given, so an
    // answer to one of them that waited on the phone past the close is still
    // known for one it was given (servedAtFor).
    const repin = !sameId(profile.served?.questionId, q._id);
    if (repin) {
      // The question it replaces was given too: a profile from before the log
      // has it only on its pin.
      if (profile.served?.questionId) logServed(profile, profile.served.questionId, profile.served.at);
      profile.served = { questionId: String(q._id), at: new Date().toISOString(), reason: pick.reason };
    }
    const logged = logServed(profile, q._id, profile.served.at);
    if (repin || logged) await getRepo().saveProfile(profile).catch((err) => logError('pin', err));

    // forStudent() is the single place that decides what a phone may see. It
    // strips every answer field and shuffles match/order/rank/categorise
    // deterministically from the student + question, so a reconnect returns the
    // same board rather than rearranging under a half-finished answer.
    // Goes left on this question. A resumed question may already have spent
    // some, and the phone has to say so rather than promise a fresh set.
    const allowed = retriesAllowed(q, settings, profile.rollNo, supports);
    const spent = triesSpent(profile, q._id);
    const shown = forStudent(q, `${profile.rollNo}:${q._id}`, supports);

    socket.emit('server:question', {
      // `provenance` (Phase 5): who wrote it, in a student's words (never
      // "template" or a model's name). `q` is always servable here, so never a
      // draft. `source` stays beside it as it always was.
      // `rich` (Phase 6, H15): HTML for each field of `shown` holding a formula
      // or a code block, built from what the phone is sent and nothing else;
      // {} for a question without either (services/richText.js). Every other
      // field is as it was.
      question: { ...shown, provenance: phoneProvenance(q), rich: await phoneRich(shown) },
      // The phone's own words for the choice (decision (a)): pick.reason, the
      // professor's, can name the band. It stays on the pin, server-side.
      reason: reasonForPhone(profile, q.bloom),
      index: profile.history.length + 1,
      bankCount: items.length,
      triesLeft: Math.max(1, allowed + 1 - spent),
      // True only when the item below is one this student was already pinned to.
      // The old test compared pick.reason against the pin's reason, which the
      // block above has just overwritten with pick.reason - so it was true on
      // every join, including a brand-new student's very first question, and
      // false in the one case it was written for: a pin saved with no reason.
      resumed,
      // Seconds for this question, when the room set them (0018). The phone
      // keeps the time; a late answer is taken like any other.
      ...(settings.timePerQuestion ? { timePerQuestion: settings.timePerQuestion } : {}),
    });
  } catch (err) {
    logError('dispatch', err);
  }
}

async function handleJoin(io, socket, payload) {
  let release = null;
  try {
    const session = await loadSession(payload?.code);
    if (!session) {
      reject(socket, 'No session with that code - check the code on the board.');
      return;
    }
    // `deliver` (Phase 7, O2): the phone holds answers it has not yet sent. In a
    // closed room that is the only reason to come back: the phone is let in to
    // send them, and is given no question. At any time while the room exists,
    // not only inside the grace window: O2 stores every late answer that
    // reaches the server, and one after the window is stored and counts
    // nowhere (lateVerdict). Without it a closed room refuses the join as it
    // always has.
    const deliver = payload?.deliver === true;
    const closed = session.status === 'closed';
    if (closed && !deliver) {
      reject(socket, 'That session has already been closed.');
      return;
    }
    // A Teacher-led room (0018) takes no answers from phones. The phone is told
    // so in its own event and goes no further: no profile, no attendance mark
    // (the professor takes attendance in this room), no place on the wheel, and
    // never a question.
    if (sessionSettings(session).mode === 'teacher-led') {
      socket.emit('session:teacher-led', { code: session.code, title: session.title ?? '', message: TEACHER_LED_MESSAGE });
      return;
    }

    const rollNo = normaliseRoll(payload?.rollNo);
    if (!rollNo) {
      reject(socket, 'Enter your roll number to join.');
      return;
    }

    // Decision 7 (19 Nov 2026): a room profile is linked to a student account
    // only when the phone presents that signed-in student's token here,
    // verified as the student's own routes verify it (verifyAccountToken). It
    // must be a student account of this room's owner with this roll number. A
    // typed roll number alone links nothing: it proves nothing about who holds
    // the phone, and since Phase 1 a link reaches the student's own history.
    // Checked before the student's lock, so a slow sign-in check holds up no
    // one else's answer. Never allowed to stop a join: a sign-in that does not
    // qualify, or a failed check, joins as a guest and is told so.
    const token = typeof payload?.token === 'string' ? payload.token.trim() : '';
    let signedIn = null;
    if (token) {
      const { account } = await verifyAccountToken(token).catch((err) => {
        logError('sign-in', err);
        return { account: null };
      });
      if (account?.role === 'student' && session.ownerId && String(account.reportsTo ?? '') === String(session.ownerId)
        && rollKey(account.rollNo) === rollNo) {
        signedIn = account;
      }
    }

    release = await lockProfile(session._id, rollNo);
    const repo = getRepo();
    const name = String(payload?.name ?? '').trim().slice(0, 60);
    const stored = await repo.getProfile(session._id, rollNo);
    // A phone with nothing of its own in a closed room has nothing to send to
    // it; nor has one whose room is being archived and deleted, where anything
    // this join wrote would land after the archive was read.
    if (closed && (!stored || roomDeleting(session._id))) {
      reject(socket, 'That session has already been closed.');
      return;
    }
    // A room imported from laptop mode (Phase 7, O4) was run on the laptop: its
    // phones answered there, and the file it was imported from is its whole
    // record, never added to (services/roomImport.js). Read only here, for a
    // phone that has a row of its own in the closed room, and by the room's id
    // (one indexed read): before the roll number and the row were checked,
    // anyone with the code on the wall could make the server list every import.
    if (closed && await isImportedRoom(repo, session._id).catch((err) => {
      // A store without the import records (0031) holds no import.
      logError('imports', err);
      return false;
    })) {
      reject(socket, DELIVER_IMPORTED_REASON);
      return;
    }

    // The supports the student's professor set. A signed-in student's come
    // with their account. Without a sign-in they still come from the room
    // owner's student behind the typed roll number, as before decision 7, on a
    // live database: supports render the questions, they reveal nothing and
    // they link nothing. A failed lookup is no supports, never a refused join.
    let supports = null;
    if (signedIn) {
      supports = await getAccommodations(signedIn.id).catch((err) => {
        logError('supports', err);
        return null;
      });
    } else if (repo.kind === 'supabase' && session.ownerId) {
      const found = await findStudentForRoll(session.ownerId, rollNo).catch((err) => {
        logError('supports', err);
        return null;
      });
      supports = found?.accommodations ?? null;
    }

    // TC-07: the same roll number resumes the same profile. Never a second row.
    const profile = stored
      ? hydrate({ ...stored, name: stored.name || name })
      : hydrate(emptyProfile({ sessionId: String(session._id), rollNo, name, startLevel: sessionSettings(session).startLevel }));
    // A sign-in links the profile, verified, over whatever link it had (one a
    // typed roll number made before 0022 included). Without one the profile
    // keeps its link as it is: an unverified one stays unverified.
    const linkChanged = Boolean(signedIn) && (profile.accountId !== signedIn.id || !profile.accountVerified);
    if (linkChanged) {
      profile.accountId = signedIn.id;
      profile.accountVerified = true;
    }
    if (!stored || linkChanged || profile.name !== (stored.name ?? '')) await repo.saveProfile(profile);

    // Two live sockets on one roll number. This is the strongest signal the
    // server has: it is not a browser self-report, devtools cannot switch it
    // off, and the innocent explanation - a phone that dropped and came back -
    // is already excluded, because in that case the old socket is gone and this
    // lookup finds nothing. Not recorded for a student marked under 18
    // (decision 8; signalsOff).
    const heldBy = presence.get(key(session.code, rollNo));
    if (heldBy && heldBy !== socket.id && io.sockets.sockets.get(heldBy)?.connected
      && !(await signalsOff(repo, session, rollNo))) {
      noteSecondSocket(profile, { other: heldBy });
      await repo.saveProfile(profile).catch((err) => logError('integrity', err));
    }

    // A room opened for a class: a roll number on its roster marks that student
    // present, unless the professor has already marked them; one off the roster
    // joins as always and marks nobody (services/roster.js markJoined). The
    // phone is told nothing about it. Decision 7's known gap: the roll number is
    // typed, not proven, so a classmate's phone can mark someone present.
    // Here, under this student's lock and after the profile is saved, so a room
    // being deleted has either waited for this or is seen and nothing is written.
    // Never allowed to stop a join: a failed write is logged, not shown.
    // Attendance closes with the room: a phone back only to send what it
    // saved (Phase 7) marks nobody.
    if (session.classId && !closed && !roomDeleting(session._id)) {
      await markJoined(repo, session, rollNo).catch((err) => logError('attendance', err));
    }

    // A rejoin replaces the entry rather than kicking the old socket: kicking it
    // would make two tabs on one roll number fight each other forever.
    presence.set(key(session.code, rollNo), socket.id);
    socket.data.student = {
      code: session.code,
      rollNo,
      sessionId: String(session._id),
      key: key(session.code, rollNo),
      // The full set, for forStudent() and score(). The phone is told only the
      // rendering switches (phoneSupports), never that options were removed.
      supports,
      // The account this phone proved it is signed in as, when that is the
      // profile's link (decision 7). Its answers are written as verified, and
      // only verified answers reach the student's own history.
      verifiedAccountId: signedIn?.id ?? null,
      // Batch 8: the questions that account practised in the Learning Hub, read
      // once at the join, so the room serves others first (selectNext's avoid).
      // Only for a verified sign-in: a typed roll number proves nothing.
      practised: signedIn && !closed ? await practisedQuestionIds(repo, signedIn.id) : null,
      // True once this join has told the phone to wait for the start (below);
      // the start serves only such phones (startRoom), so a phone this join
      // served itself is not served a second time.
      waiting: false,
      // Phase 7 (O2): in a closed room, here only to send answers saved on
      // the phone; each is answered, and nothing new is served.
      deliverOnly: closed,
      // Phase 7: in an open room, a phone with answers waiting is served
      // nothing at the join. They go first and move the ladder, and its next
      // question is chosen when it asks (student:next), resuming the question
      // pinned on its screen as this join would have.
      resumePending: deliver && !closed,
    };
    socket.join(`session:${session.code}`);

    const bank = closed ? [] : await loadBank(session);
    const settings = sessionSettings(session);
    socket.emit('session:accepted', {
      profile: rowFor(profile, settings),
      session: { code: session.code, title: session.title ?? '', settings },
      bankCount: bank.length,
      ...(closed ? {
        deliverOnly: true,
        deliverUntil: new Date(Date.parse(session.closedAt) + GRACE_MS).toISOString(),
        message: DELIVER_MESSAGE,
      } : {}),
      supports: phoneSupports(supports),
      // Whether this phone's answers go into the signed-in student's history
      // (decision 7), and, when it sent a sign-in that could not be linked, why not.
      linked: Boolean(signedIn),
      ...(token && !signedIn ? { linkNote: NOT_LINKED } : {}),
      // The three confidence taps a phone may send with any answer (Phase 5).
      // Optional, and information only: they change no mark and no level.
      confidence: CONFIDENCE_CHOICES,
    });

    await broadcastGrid(io, session);
    if (closed) return;
    // Paused: the student is in the room and stays in it, but gets nothing to
    // answer until the teacher resumes. The phone shows the paused card.
    if (session.status === 'paused') {
      socket.emit('session:paused', { code: session.code });
      return;
    }
    // A waiting room (0018): in the room, nothing to answer until the professor
    // starts it. Read again from the store, not the cache, and only after this
    // phone is in the room (socket.data.student above): a start lands either
    // before this read, which then finds the room open and serves the phone
    // here, or after it, and then finds this phone among the waiting ones and
    // serves it (startRoom, which takes this student's lock, so after this join).
    let room = session;
    if (session.status === 'waiting') {
      room = await repo.getSession(session._id);
      if (room?.status === 'waiting') {
        socket.data.student.waiting = true;
        socket.emit('server:waiting', { code: session.code, title: session.title ?? '', message: WAITING_MESSAGE });
        return;
      }
      if (!room || room.status === 'closed') {
        socket.emit('session:closed', {});
        return;
      }
      if (room.status === 'paused') {
        socket.emit('session:paused', { code: session.code });
        return;
      }
    }
    // `resume` because every join is potentially a reconnect: the same roll
    // number finding an existing profile IS the resume case, and a first join
    // simply has no pin to honour. Not for a phone with answers waiting
    // (resumePending above): it asks once they are in.
    if (!socket.data.student.resumePending) await dispatchNext(socket, { profile, session: room, bank, resume: true });
    // A class question running in the room (Phase 5): a phone that joins or
    // reconnects mid-question is sent it where it stands, with its own vote in
    // the current round, after its own question, which it parks.
    await sendClassState(socket, room, profile);
  } catch (err) {
    logError('student:join', err);
    reject(socket, 'Could not join - try again.');
  } finally {
    release?.();
  }
}

/**
 * Re-send the outcome of an attempt the server already holds.
 *
 * Reached when a phone resends an answer whose result it never received. If the
 * evidence was stored but the profile write behind it failed, the profile is
 * repaired from the stored answer here, so a resend can never leave the two
 * disagreeing and never counts twice.
 */
async function replayStored(io, socket, { session, profile, prior, settings, ids = {} }) {
  // Only ever this student's own row. handleAnswer re-keys an attempt whose key
  // another student's row holds, so the one way left to get here with someone
  // else's row is two phones racing on one key. Answering from it would credit
  // this student with that student's mark; refusing sends the phone the "did not
  // save" notice, and its resend then takes the re-keyed path.
  if (String(prior.rollNo) !== String(profile.rollNo)) {
    throw new Error(`answer key ${prior.answerKey} is held by another student's row`);
  }
  // Nor ever a row kept with a class question (Phase 5): a vote, or an answer
  // sent as the phone's own after the question was put to the class. Answered
  // from here, its mark and the key went to the phone before the professor
  // revealed it, and a vote went into the ladder. handleAnswer never sends one
  // here; this is the same race as above, and refuses the same way.
  if (prior.classQuestionId) {
    throw new Error(`answer key ${prior.answerKey} is held by a row kept with a class question`);
  }
  const repo = getRepo();
  const question = await repo.getQuestion(prior.questionId).catch(() => null);
  const seed = `${prior.rollNo}:${prior.questionId}`;

  if (!prior.final) {
    const allowed = question ? retriesAllowed(question, settings, prior.rollNo, socket.data.student?.supports) : 0;
    const row = rowFor(profile, settings);
    socket.emit('server:result', {
      retry: true,
      correct: false,
      score: prior.score,
      detail: prior.detail ?? '',
      kind: prior.kind,
      triesLeft: Math.max(1, allowed + 1 - prior.attempt),
      workingLevel: profile.workingLevel,
      reason: row.next.why,
      levelChanged: false,
      profile: row,
      ...ids,
    });
    return;
  }

  let current = profile;
  // Without case (sameId): a row stored before ids were compared that way can
  // hold its question id as the phone sent it, and an exact match would put
  // that question into the ladder a second time.
  const inHistory = profile.history.some((h) => sameId(h.questionId, prior.questionId));
  if (!inHistory) {
    const fields = {
      questionId: prior.questionId,
      bloom: prior.bloom,
      topic: prior.topic,
      kind: prior.kind,
      answerId: prior.answerKey,
    };
    current = prior.ungraded
      ? recordUngraded(profile, fields).profile
      : applyAnswer(profile, {
        ...fields,
        correct: prior.correct,
        score: prior.score,
        tries: prior.attempt,
        redemption: settings.redemption,
        adapt: settings.adapt,
      }).profile;
    // A row a professor has reviewed: the rebuilt entry is tagged the way
    // applyReview tags it. Without the tag the mark is the professor's but reads
    // as the machine's provisional one, and a later double-tap was told so.
    if (!prior.ungraded && REVIEW_MARKS.includes(prior.reviewStatus)) {
      current = applyReview(current, {
        answerId: prior.answerKey,
        correct: prior.correct,
        score: prior.score,
        review: prior.reviewStatus,
        redemption: settings.redemption,
      }).profile;
    }
    // The pin is spent only when it is on the question this answer settles. An
    // answer to a packed question (Phase 7) was never the pin, and clearing it
    // here lost the question still on the phone's screen.
    if (String(current.served?.questionId ?? '').toLowerCase() === String(prior.questionId ?? '').toLowerCase()) {
      current.served = null;
    }
    await repo.saveProfile(current);
    await broadcastGrid(io, session);
  }

  const row = rowFor(current, settings);
  socket.emit('server:result', {
    correct: prior.ungraded ? false : Boolean(prior.correct),
    score: prior.score,
    // Once reviewed, the stored mark is the professor's and no longer provisional.
    ...(prior.reviewStatus === 'provisional' ? { provisional: true } : {}),
    ungraded: prior.ungraded,
    solution: question ? score(question, prior.response, seed, socket.data.student?.supports).solution : null,
    // The machine's reading in words, only while its mark is the one in force.
    // Once a professor has overridden it, '1/2 rubric points' beside the
    // professor's mark contradicts the mark the phone is showing.
    detail: prior.reviewStatus === 'overridden' ? '' : (prior.detail ?? ''),
    kind: prior.kind,
    workingLevel: current.workingLevel,
    reason: row.next.why,
    levelChanged: false,
    profile: row,
    ...ids,
  });
}

/**
 * An answer row the answer path stored, kept and not counted (KEPT_LIMIT): a
 * late one, one past the cap, one to a question already marked, and the
 * student's own answer to a question put to the class. A vote is not one: the
 * vote path keeps its own rows.
 */
const keptRow = (a) => keptNotCounted(a)
  || (a?.final === false && Boolean(a?.classQuestionId) && a?.detail === OWN_QUESTION_DETAIL);

async function handleAnswer(io, socket, payload) {
  const ctx = socket.data.student;
  // This phone's place in its student's queue, taken as the answer ARRIVES:
  // before the first await, so no answer can overtake the one sent before it
  // while either waits on the store. The ladder moves in the order the server
  // receives answers (Phase 7, O2 and O3), never by a phone's clock, and an
  // outbox sending a morning's answers is marked one by one in that order.
  const turn = ctx ? lockProfile(ctx.sessionId, ctx.rollNo) : null;
  // When the answer reached the server, read from the server's clock beside the
  // turn, before anything waits. The grace window is judged by this, and it is
  // the time the row is stored with: read after the wait for the student's
  // turn and the store reads below, an answer that arrived inside the window
  // behind a slow outbox burst was judged as arriving after it. The phone's
  // clock is still never read for this.
  const arrivedAt = Date.now();
  // Echoed in the replies that come before the answer is read (Batch 8): the
  // ones after carry `ids` below, which say the same.
  const echo = answerEcho(payload);
  let release = null;
  try {
    if (!ctx) {
      reject(socket, 'Join a session before answering.', echo);
      return;
    }
    release = await turn;

    const session = await loadSession(ctx.code);
    if (!session) {
      socket.emit('session:closed', { ...echo });
      return;
    }
    // Phase 7 (O2): an answer reaching a closed room is stored, never dropped.
    // It counts when the server served or packed its question to this phone
    // before the close and it arrived within the grace window; otherwise it is
    // kept, marked as having arrived after the close, and counts nowhere.
    // Either way the phone is told which, and nothing new is served.
    const closed = session.status === 'closed';
    // A phone still in the room when it closed is then told so, as it always
    // was; one back only to send what it saved knows already.
    const closedNote = () => { if (closed && !ctx.deliverOnly) socket.emit('session:closed', {}); };
    if (session.status === 'paused') {
      socket.emit('session:paused', { code: session.code, ...echo });
      return;
    }
    // Nothing has been served in a room still waiting to start (0018).
    if (session.status === 'waiting') {
      socket.emit('server:waiting', { code: session.code, title: session.title ?? '', message: WAITING_MESSAGE, ...echo });
      return;
    }

    // The id as the phone sent it, echoed in every reply; and the id this
    // handler compares, in lower case. The store finds a uuid (Postgres) or an
    // ObjectId (Mongo) whatever the case of its letters, so an id compared here
    // as sent let a phone send a question it had been marked on in upper case,
    // pass the double-tap guard below and be marked on it a second time, once
    // per mix of cases. Every id the server hands out is in lower case; once
    // the question is found, its own id is used from there on.
    const sentId = String(payload?.questionId ?? '');
    let questionId = sentId.trim().toLowerCase();
    // `response` carries whatever the kind needs - a number, an array of
    // numbers, or a string. `answerIdx` is still read so a phone that was
    // already mid-session on the previous client keeps working.
    const response = payload?.response !== undefined ? payload.response : payload?.answerIdx;
    if (!isRecordId(questionId) || response === undefined || response === null) {
      logIgnored('student:answer', `malformed payload from ${ctx.rollNo}`);
      return;
    }

    // The room is being archived and deleted. An answer written now would land
    // after the archive was read and go with the room. Refused the way a failed
    // save is, so the phone keeps it and resends: a room that is gone then says
    // so, and one whose delete was refused simply takes the answer.
    if (roomDeleting(ctx.sessionId)) {
      reject(socket, 'That answer did not save. Tap Next question to carry on.', echo);
      return;
    }
    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.', echo);
      return;
    }
    const profile = hydrate(stored);
    const settings = sessionSettings(session);
    const supports = ctx.supports ?? null;

    // The idempotency key. A current phone sends one per attempt; an older one
    // does not, and then the key is derived from the student, the question and
    // the answer, so an identical resend is still recognised as the same attempt.
    // The roll number is in it because a key is unique per room, not per
    // student: without it, two students giving the same answer to the same
    // question shared one key, and the second was answered from the first one's
    // row - never stored, never in the review queue, never moved by a review.
    const print = answerPrint(response);
    const sent = String(payload?.answerId ?? '');
    let answerKey = ANSWER_ID.test(sent) ? sent : `legacy-${ctx.rollNo}-${questionId}-${print}`;
    // Which of its answers a reply is about (Phase 7): the question, and the
    // phone's own answerId as it sent it, so an outbox sending several can tell
    // its replies apart. Added to every reply below; nothing else changes.
    const ids = { questionId: sentId, ...(ANSWER_ID.test(sent) ? { answerId: sent } : {}) };
    // Said instead of a mark: the answer is saved and counts nowhere.
    const kept = (message, extra = {}) => socket.emit('server:kept', { ...ids, counted: false, ...extra, message });
    // Room for one more answer kept and not counted (KEPT_LIMIT)? Asked only on
    // the way to storing one, and under the student's turn, so no other answer
    // of theirs is stored between the count and the write. Every page of their
    // rows that are not final is read: votes are among them, and a read of one
    // page only would let a phone bury its kept rows under votes.
    // Past the limit the phone is told plainly, in the event that says the
    // answer is refused for good (its outbox keeps it), and nothing is stored.
    const keptRoom = async () => {
      const rows = await allAnswers(repo, { sessionId: ctx.sessionId, rollNo: ctx.rollNo, final: false });
      if (rows.filter(keptRow).length < KEPT_LIMIT) return true;
      logIgnored('student:answer', `${ctx.rollNo} has ${KEPT_LIMIT} answers kept and not counted in this room; not stored`);
      socket.emit('server:refused', { ...ids, message: KEPT_LIMIT_MESSAGE });
      return false;
    };

    // 1. An attempt the server already holds: answer it with the stored outcome.
    let prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    // A phone picks its own key, so one can arrive that another student's row
    // already holds. That row is theirs, and answering from it would credit this
    // student with their mark. This attempt is filed under the key scoped to
    // this student instead, which its own resends find again. ANSWER_ID has no
    // '@', so no phone can send a scoped key itself.
    // A vote's key is not an answer's either (Phase 5), the phone's own vote
    // included: answering from a vote handed the phone the class question's
    // key before the reveal, and put the vote into the ladder, which no vote
    // touches. It is re-keyed the same way (a vote's own scoped keys carry a
    // ':', so the two never meet).
    if (prior && (prior.rollNo !== ctx.rollNo || (prior.classQuestionId && prior.detail !== OWN_QUESTION_DETAIL))) {
      answerKey = `${answerKey}@${ctx.rollNo}`;
      prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    }
    // A resend of an answer this phone sent to a question already put to the
    // class (kept below with the class question, never counted). The phone is
    // moved on again, as it was then, and told nothing about the mark: sent
    // back, the stored mark told any phone the key of a question still being
    // voted on, one option at a time, and still did after a close without the
    // key. Since Phase 7 it is also told the answer is saved and not counted
    // (server:kept, no mark), so an outbox can settle it; a closed room serves
    // nothing.
    // Moved on to a new question only when the answer was to the question on
    // its screen (or it has none). An answer to another question (an outbox
    // answer, Phase 7) is sent the screen's own question again instead
    // (resume), so the phone still hears a question back, as it always did,
    // and the pin stays where it is: moved, the screen's question was lost,
    // and with it, after a close, the record that it was given.
    const onScreen = (id) => !profile.served?.questionId || sameId(profile.served.questionId, id);
    if (prior?.classQuestionId) {
      kept(ASKED_KEPT_MESSAGE);
      if (closed) closedNote();
      else await dispatchNext(socket, { profile, session, resume: !onScreen(prior.questionId) });
      return;
    }
    // An answer kept and not counted (Phase 7), sent again: told again why (as
    // it was when it arrived), never marked. After the close: the verdict on
    // when it arrived. Past the room's cap: the cap.
    if (prior && keptAfterClose(prior)) {
      const packs = await repo.listQuestionPacks(ctx.sessionId, ctx.rollNo);
      const servedAt = servedAtFor({ profile, packs, questionId: prior.questionId, before: session.closedAt });
      kept(lateVerdict({ closedAt: session.closedAt, servedAt, now: Date.parse(prior.answeredAt) }).message, { late: true });
      closedNote();
      return;
    }
    if (prior && keptAnsweredAgain(prior)) {
      kept(ANSWERED_AGAIN_MESSAGE);
      closedNote();
      return;
    }
    if (prior && keptNotCounted(prior)) {
      kept(overCapMessage(settings.questionsPerStudent ?? 0));
      closedNote();
      return;
    }
    if (prior) {
      await replayStored(io, socket, { session, profile, prior, settings, ids });
      closedNote();
      return;
    }

    // Batch 8: a tap or label answer on a diagram or molecule is marked from the
    // parts the drawing engines find. Arriving before they are up (an outbox
    // replayed straight after a restart), it is refused the way a failed save
    // is, so the phone keeps it and sends it again, rather than marked wrong.
    // The engines load at boot, so this costs nothing once they are up.
    if (!enginesReady()) {
      const asked = await repo.getQuestion(questionId).catch(() => null);
      if (asked && !(await readyToMark(asked))) {
        reject(socket, 'That answer did not save. Tap Next question to carry on.', echo);
        return;
      }
    }

    // 2. A question this student has already been marked on, arriving under a
    // new key. A double-tap on a phone must not score twice - but the phone still
    // has to hear something back, or it sits with its options disabled.
    const already = profile.history.find((h) => sameId(h.questionId, questionId));
    // A student at the room's cap (0018) has finished. Checked below, once it is
    // known whether the server gave this phone the question (Phase 7): one it
    // never gave is not taken, as always; one it served or packed is stored,
    // not counted, since an outbox replaying a pack can honestly arrive past the
    // cap. Either way the phone is told it has finished, as it always was.
    // Below `already`, so a resend of the answer that reached the cap is still
    // answered from what was recorded.
    const cap = settings.questionsPerStudent;
    // Stored and not counted (19 Nov 2026 fix): before, this answer was never
    // stored. That broke O1's "never drops an answer": a packed question can be
    // served and answered live while its copy waits in the phone's outbox, and
    // the copy then arrives here. It is kept as given, `final` false with a
    // detail saying why and no mark of its own (the machine's reading beside it
    // for staff). It moves no level and every report leaves it out
    // (keptNotCounted). The phone is told, as before, the mark the question
    // was given when this is the same answer sent again (a double-tap): that
    // mark is this answer's too. Any other answer is told it is saved and does
    // not count, and no mark: the earlier mark is not its own.
    if (already) {
      if (!(await keptRoom())) {
        closedNote();
        return;
      }
      const earlier = already.answerId ? await repo.getAnswerByKey(ctx.sessionId, already.answerId).catch(() => null) : null;
      const stale = await repo.getQuestion(questionId).catch(() => null);
      // The question as it was asked: the earlier answer's own snapshot, which
      // outlives an edit or a delete, else the question as it stands now.
      const asked = stale && String(stale.contentId) === String(session.contentId) ? stale : null;
      const seed = `${ctx.rollNo}:${asked?._id ?? questionId}`;
      const graded = asked ? score(asked, response, seed, supports) : null;
      const stamped = await repo.recordAnswer({
        sessionId: ctx.sessionId,
        answerKey,
        rollNo: ctx.rollNo,
        accountId: profile.accountId ?? null,
        accountVerified: Boolean(ctx.verifiedAccountId) && String(ctx.verifiedAccountId) === String(profile.accountId ?? ''),
        questionId: String(earlier?.questionId ?? asked?._id ?? already.questionId),
        contentId: earlier?.contentId ?? asked?.contentId ?? session.contentId ?? null,
        topic: earlier?.topic ?? asked?.topic ?? already.topic ?? '',
        bloom: earlier?.bloom ?? asked?.bloom ?? already.bloom,
        kind: earlier?.kind ?? asked?.kind ?? already.kind ?? 'mcq',
        questionSnapshot: earlier?.questionSnapshot
          ?? (asked ? snapshotOf(asked, shownOptionIndices(asked, seed, supports)) : { id: String(already.questionId) }),
        response,
        attempt: Math.min(32767, (Number(earlier?.attempt) || 1) + 1),
        final: false,
        correct: null,
        score: null,
        ungraded: already.ungraded === true,
        servedAt: earlier?.servedAt ?? null,
        answeredAt: new Date(arrivedAt).toISOString(),
        ...(deviceTimeOf(payload?.deviceAnsweredAt) ? { deviceAnsweredAt: deviceTimeOf(payload.deviceAnsweredAt) } : {}),
        language: 'en',
        questionSource: earlier?.questionSource ?? asked?.source ?? 'llm',
        detail: ANSWERED_AGAIN_DETAIL,
        autoCorrect: graded?.correct ?? null,
        autoScore: graded?.score ?? null,
        autoDetail: graded?.detail ?? '',
        reviewStatus: 'auto',
        confidence: storedConfidence(confidenceFrom(payload?.confidence)),
      });
      // Two resends racing on one key: the second is answered from the first.
      if (stamped.duplicate && !keptNotCounted(stamped.answer)) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings, ids });
      } else if (earlier && answerPrint(earlier.response) === print) {
        const row = rowFor(profile, settings);
        socket.emit('server:result', {
          correct: already.correct,
          score: already.score ?? (already.correct ? 1 : 0),
          ...((already.kind ?? stale?.kind) === 'open' && !already.review ? { provisional: true } : {}),
          ungraded: already.ungraded === true,
          solution: asked ? score(asked, response, seed, supports).solution : null,
          kind: already.kind ?? stale?.kind ?? 'mcq',
          workingLevel: profile.workingLevel,
          reason: row.next.why,
          levelChanged: false,
          profile: row,
          ...ids,
        });
      } else {
        kept(ANSWERED_AGAIN_MESSAGE, closed ? { late: true } : {});
      }
      closedNote();
      return;
    }

    const bank = await loadBank(session);
    // The store is asked only for an item discarded after it was served, which
    // has left the cached bank. Such an item must still belong to this room's
    // content: the fallback used to take any question id in the database, so a
    // phone could answer another professor's question, be sent its key as the
    // solution, and put that question and its rubric into this room's evidence.
    // Nor may it be a draft. A draft has never been active, so it was never in
    // a bank and never served: an answer naming one names an id no phone was
    // given, and must not put an unapproved question into the evidence.
    // Nor model output nobody approved: a REJECTED draft is discarded, which is
    // the status this fallback exists for, but it was never served either. On
    // the Mongo store one batch's ids are consecutive, so a phone that has seen
    // one served id can work out its rejected siblings'.
    // Nor may it be outside the room's question set: the bank above already
    // leaves those out, and this fallback would otherwise take them back in.
    // Without case, as every other id in this handler is compared (sameId),
    // and as the store below finds one.
    const inBank = bank.find((q) => sameId(q._id, questionId));
    const found = inBank ?? (await repo.getQuestion(questionId));
    const question = found && String(found.contentId) === String(session.contentId) && found.status !== 'draft'
      && !needsApproval(found) && inRoomSet(session, found._id)
      ? found
      : null;
    if (!question) {
      logIgnored('student:answer', `question ${questionId} is not in this bank`);
      // Unfreeze the phone by moving it on rather than leaving it stuck. A
      // closed room has nothing to move it on to, so it is told plainly, in an
      // event that says the answer is refused for good (server:refused), not
      // the "did not save, send it again" of session:rejected. A phone whose
      // screen holds another question is sent that one again (onScreen above).
      if (closed) {
        socket.emit('server:refused', { ...ids, message: NOT_THIS_ROOM_MESSAGE });
        closedNote();
      } else {
        await dispatchNext(socket, { profile, session, bank, resume: !onScreen(questionId) });
      }
      return;
    }
    // The question's own id from here on: every comparison, the stored row and
    // the ladder carry it exactly as the bank does.
    questionId = String(question._id);

    // A question put to the class in this room (Phase 5): the bank leaves it
    // out, so a phone gets here when it held the question on its own screen
    // before it was asked, or sends its id from anywhere else. Its answer is
    // kept, with the class question and never counted, since the question may
    // have been discussed or its key shown by now; and the phone is moved on to
    // a question of its own. It is told nothing about its mark, now or on a
    // resend (above): that would tell it the key.
    if (!inBank) {
      const asked = (await repo.listClassQuestions(session._id))
        .find((c) => String(c.questionId ?? '').toLowerCase() === questionId.toLowerCase());
      if (asked) {
        // Past KEPT_LIMIT: not stored, and moved on all the same.
        if (!(await keptRoom())) {
          if (closed) closedNote();
          else await dispatchNext(socket, { profile, session, bank, resume: !onScreen(questionId) });
          return;
        }
        const seed = `${ctx.rollNo}:${question._id}`;
        const graded = score(question, response, seed, supports);
        await repo.recordAnswer({
          sessionId: ctx.sessionId,
          answerKey,
          rollNo: ctx.rollNo,
          accountId: profile.accountId ?? null,
          accountVerified: Boolean(ctx.verifiedAccountId) && String(ctx.verifiedAccountId) === String(profile.accountId ?? ''),
          questionId,
          contentId: question.contentId ?? session.contentId ?? null,
          topic: question.topic ?? '',
          bloom: question.bloom,
          kind: question.kind ?? 'mcq',
          questionSnapshot: snapshotOf(question, shownOptionIndices(question, seed, supports)),
          response,
          attempt: triesSpent(profile, questionId) + 1,
          final: false,
          correct: countsTowardMastery(question) ? graded.correct : null,
          score: countsTowardMastery(question) ? graded.score : null,
          ungraded: !countsTowardMastery(question),
          // When this question was given to the phone (the pin's time only when
          // it is the pin), not the time of whatever is on its screen now.
          servedAt: servedAtFor({ profile, questionId }),
          questionSource: question.source ?? 'llm',
          detail: OWN_QUESTION_DETAIL,
          autoCorrect: graded.correct,
          autoScore: graded.score,
          autoDetail: graded.detail ?? '',
          reviewStatus: 'auto',
          confidence: storedConfidence(confidenceFrom(payload?.confidence)),
          classQuestionId: String(asked._id),
          round: roundOf(asked),
        });
        logIgnored('student:answer', `question ${questionId} was put to the class; kept with it, not counted`);
        kept(ASKED_KEPT_MESSAGE);
        if (closed) closedNote();
        else await dispatchNext(socket, { profile, session, bank, resume: !onScreen(questionId) });
        return;
      }
    }

    // Phase 7: was this question given to this phone, and when? The question
    // pinned on its screen was; otherwise one the server put on its screen
    // before (the profile's log of serves) or sent in a pack (question_packs,
    // read only then: a live answer is to the pinned question). In an open
    // room an answer to a question other than the pinned one is marked now,
    // in one go, and the pin is left where it is. In a closed room only what
    // was given before the close can count (lateVerdict).
    const pinned = sameId(profile.served?.questionId, questionId);
    const packs = pinned ? [] : await repo.listQuestionPacks(ctx.sessionId, ctx.rollNo).catch((err) => {
      // In an open room a pack that cannot be read leaves the answer as it was
      // taken before packs existed; in a closed room it decides whether the
      // answer counts, so the phone is told it did not save and sends it again.
      if (closed) throw err;
      logError('packs', err);
      return [];
    });
    // When it was given: the pin's time only when it is the pin, never the time
    // of another question still on the screen.
    const givenAt = pinned ? (profile.served?.at ?? null) : servedAtFor({ profile, packs, questionId });
    const given = pinned || Boolean(givenAt);
    const verdict = closed
      ? lateVerdict({
        closedAt: session.closedAt, servedAt: servedAtFor({ profile, packs, questionId, before: session.closedAt }), now: arrivedAt,
      })
      : null;
    // An answer to a question not on the phone's screen (from its outbox, or a
    // pack), or one after the close, had no screen to try again on. It also
    // never re-pins the question (the retry below), which moved the pin off
    // the question really on the screen.
    const oneGo = !pinned || closed;
    // At the room's cap (0018; see `cap` above). An answer to a question the
    // server never gave this phone is not taken, as before Phase 7, unless it
    // arrived after the close, where O2 keeps every answer (below).
    const overCap = Boolean(cap) && profile.history.length >= cap;
    if (overCap && !given && !(verdict && !verdict.counted)) {
      socket.emit('server:exhausted', { profile: rowFor(profile, settings), reason: capReason(cap), ...ids });
      closedNote();
      return;
    }
    // Why an answer that reached the server is kept and not counted, or null.
    const keptAs = verdict && !verdict.counted ? AFTER_CLOSE_DETAIL : overCap ? OVER_CAP_DETAIL : null;

    const spent = triesSpent(profile, questionId);
    // The same answer as the attempt just refused, under a new key: that is a
    // resend, not a new attempt, and must not cost a retry.
    if (spent > 0 && profile.served?.last === print) {
      const allowed = retriesAllowed(question, settings, ctx.rollNo, supports);
      const row = rowFor(profile, settings);
      socket.emit('server:result', {
        retry: true,
        correct: false,
        kind: question.kind ?? 'mcq',
        triesLeft: Math.max(1, allowed + 1 - spent),
        workingLevel: profile.workingLevel,
        reason: row.next.why,
        levelChanged: false,
        profile: row,
        ...ids,
      });
      closedNote();
      return;
    }
    const attempt = spent + 1;

    // Decision 8: a signal this answer records is dropped again, before any
    // write, for a student their class's roster marks under 18. The roster is
    // read only when a signal was recorded (signalsOff).
    const signalsBefore = profile.integrity.slice();
    const unlessMinor = async (p) => {
      if (recorded(p.integrity, signalsBefore) && (await signalsOff(repo, session, ctx.rollNo))) {
        p.integrity = signalsBefore.slice();
      }
      return p;
    };

    // Checked on the first attempt only: `served.at` is when the server sent
    // this question, so the gap is real elapsed time and not something the
    // phone reported about itself. A retry's gap measures nothing new. A packed
    // question's gap runs from when the pack was sent (Phase 7), so only a
    // first answer arriving faster than that can show here. An answer that
    // will not count touches no profile, so records nothing.
    const servedAt = givenAt;
    if (attempt === 1 && !keptAs) checkLatency(profile, question, servedAt);

    // Scored here, from the stored item, per its kind. A client-sent
    // correctness flag is never read. The SAME seed and supports forStudent()
    // used, so shown positions map back to the items they really are.
    const seed = `${ctx.rollNo}:${question._id}`;
    const graded = score(question, response, seed, supports);
    const kind = question.kind ?? 'mcq';
    // One moment for this answer: the stored row and the history entry carry
    // the same timestamp, so the two records of one answer always agree. It is
    // when the answer arrived (arrivedAt), the moment the grace window was
    // judged by, so a resend of a kept row is told the verdict it was given.
    const answeredAt = new Date(arrivedAt).toISOString();
    const evidence = {
      sessionId: ctx.sessionId,
      answerKey,
      rollNo: ctx.rollNo,
      accountId: profile.accountId ?? null,
      // Decision 7: verified only when THIS phone signed in as the linked
      // account. Another phone typing the same roll number writes unverified
      // rows, which never reach the student's own history.
      accountVerified: Boolean(ctx.verifiedAccountId) && String(ctx.verifiedAccountId) === String(profile.accountId ?? ''),
      questionId,
      contentId: question.contentId ?? session.contentId ?? null,
      topic: question.topic ?? '',
      bloom: question.bloom,
      kind,
      questionSnapshot: snapshotOf(question, shownOptionIndices(question, seed, supports)),
      response,
      attempt,
      servedAt,
      answeredAt,
      // When the phone says it was answered (Phase 7): for the record only.
      // `answeredAt` above is when the server received it, and is the time
      // that orders and counts. Written only when the phone sent one.
      ...(deviceTimeOf(payload?.deviceAnsweredAt) ? { deviceAnsweredAt: deviceTimeOf(payload.deviceAnsweredAt) } : {}),
      language: 'en',
      questionSource: question.source ?? 'llm',
      detail: graded.detail ?? '',
      autoCorrect: graded.correct,
      autoScore: graded.score,
      autoDetail: graded.detail ?? '',
      // A written answer is marked by matching rubric words. That is a first
      // reading, not a verdict, so it is stored as provisional for a professor
      // to confirm or override.
      reviewStatus: kind === 'open' ? 'provisional' : 'auto',
      // The phone's confidence tap (Phase 5), or null for none. Stored and
      // never read below: the mark, the ladder and the reply are the same with
      // or without it (services/confidence.js).
      confidence: storedConfidence(confidenceFrom(payload?.confidence)),
    };
    // Late fields on a reply (Phase 7): whether it arrived after the close, and why it counts.
    const lateNote = verdict ? { late: true, message: verdict.message } : {};
    // An answer to the pinned question spends the pin, as before; an answer to
    // any other (a packed one, an outbox one, Phase 7) leaves the question on
    // the screen pinned where it is. Spending it then lost the screen's
    // question, and with it, after a close, the record that it was given.
    const pinAfter = () => (pinned ? null : (profile.served ?? null));

    // Phase 7 (O2): after the close, and not served or packed to this phone
    // before it, or past the grace window; or past the room's cap. Stored as
    // given, `final` false and a detail saying why; no profile, no level, no
    // band moves, and every report leaves it out (keptNotCounted). The
    // machine's reading is kept beside it for staff (`auto*`, in `evidence`)
    // and the row's own mark is left empty: a mark on it would reach the
    // student's own list of answers, and a phone that sent any id of the room's
    // bank could read a key from it, one option at a time. The phone is told it
    // is saved and does not count, and is sent no mark and no key; at the cap it
    // is told it has finished, as it always was.
    if (keptAs) {
      // Past KEPT_LIMIT: not stored. At the cap the phone has still finished.
      if (!(await keptRoom())) {
        if (keptAs === OVER_CAP_DETAIL && !closed) {
          socket.emit('server:exhausted', { profile: rowFor(profile, settings), reason: capReason(cap) });
        }
        closedNote();
        return;
      }
      const stamped = await repo.recordAnswer({
        ...evidence,
        final: false,
        correct: null,
        score: null,
        ungraded: !countsTowardMastery(question),
        detail: keptAs,
      });
      if (stamped.duplicate && !keptNotCounted(stamped.answer)) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings, ids });
      } else if (keptAs === AFTER_CLOSE_DETAIL) {
        kept(verdict.message, { late: true });
      } else {
        kept(overCapMessage(cap), closed ? { late: true } : {});
        if (!closed) socket.emit('server:exhausted', { profile: rowFor(profile, settings), reason: capReason(cap), ...ids });
      }
      closedNote();
      return;
    }

    // A poll asks without assessing. It is recorded so it is never served
    // again, and it touches no level, no accuracy and no band.
    if (!countsTowardMastery(question)) {
      const stamped = await repo.recordAnswer({
        ...evidence, ungraded: true, correct: null, score: null, final: true, reviewStatus: 'auto',
      });
      if (stamped.duplicate) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings, ids });
        closedNote();
        return;
      }
      const { profile: next } = recordUngraded(profile, {
        questionId, bloom: question.bloom, topic: question.topic ?? '', kind, answerId: answerKey, at: answeredAt,
      });
      next.served = pinAfter();
      await repo.saveProfile(await unlessMinor(next));
      const row = rowFor(next, settings);
      socket.emit('server:result', {
        ungraded: true,
        correct: false,
        score: null,
        solution: null,
        detail: '',
        kind,
        workingLevel: next.workingLevel,
        reason: row.next.why,
        levelChanged: false,
        profile: row,
        ...lateNote,
        ...ids,
      });
      closedNote();
      await broadcastGrid(io, session);
      return;
    }

    // Wrong with goes left: this attempt is stored as evidence but does not
    // count. The answer is NOT revealed - that would end the retry. Never for
    // an answer marked after the fact (`oneGo`, Phase 7): a packed question
    // answered offline, or any answer after the room closed, had no screen to
    // try again on, so it is final at its first attempt.
    const allowed = retriesAllowed(question, settings, ctx.rollNo, supports);
    if (!graded.correct && attempt <= allowed && !oneGo) {
      const stamped = await repo.recordAnswer({
        ...evidence, final: false, correct: false, score: graded.score,
      });
      if (stamped.duplicate) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings, ids });
        return;
      }
      profile.served = {
        ...(profile.served ?? {}),
        questionId,
        at: profile.served?.at ?? new Date().toISOString(),
        reason: profile.served?.reason ?? '',
        tries: attempt,
        last: print,
      };
      await repo.saveProfile(await unlessMinor(profile));
      const row = rowFor(profile, settings);
      socket.emit('server:result', {
        retry: true,
        correct: false,
        score: graded.score,
        detail: graded.detail ?? '',
        kind,
        triesLeft: allowed + 1 - attempt,
        workingLevel: profile.workingLevel,
        reason: row.next.why,
        levelChanged: false,
        profile: row,
        ...ids,
      });
      return;
    }

    // Final. The evidence is written first: it is also the idempotency gate, so
    // a resend racing this one finds it and is answered from it.
    const stamped = await repo.recordAnswer({
      ...evidence, final: true, correct: graded.correct, score: graded.score,
    });
    if (stamped.duplicate) {
      await replayStored(io, socket, { session, profile, prior: stamped.answer, settings, ids });
      closedNote();
      return;
    }

    const { profile: next, decision, redeemed } = applyAnswer(profile, {
      questionId,
      bloom: question.bloom,
      topic: question.topic ?? '',
      kind,
      answerId: answerKey,
      correct: graded.correct,
      score: graded.score,
      at: answeredAt,
      tries: attempt,
      redemption: settings.redemption,
      adapt: settings.adapt,
    });
    checkLevelJump(next);
    // Answered, so the pin is spent. Leaving it set would resume a student onto
    // a question they have already been marked on. A packed question was not
    // the pin, so the pin stays on the question still on the screen.
    next.served = pinAfter();
    await repo.saveProfile(await unlessMinor(next));

    const row = rowFor(next, settings);
    socket.emit('server:result', {
      correct: graded.correct,
      score: graded.score,
      // A written answer's mark is the rubric matcher's first reading and stands
      // until a professor confirms or overrides it, so the phone can say so.
      ...(kind === 'open' ? { provisional: true } : {}),
      solution: graded.solution,
      detail: graded.detail ?? '',
      kind,
      attempts: attempt,
      redeemed: redeemed ? redeemed.reason : null,
      workingLevel: next.workingLevel,
      // The phone's own sentence (decision (a)): next.reason is the professor's
      // and can name the band. It stays on the profile for the teacher's grid.
      reason: row.next.why,
      levelChanged: Boolean(decision.changed),
      profile: row,
      ...lateNote,
      ...ids,
    });
    closedNote();

    await broadcastGrid(io, session);
  } catch (err) {
    logError('student:answer', err);
    // The phone is sitting with its options disabled waiting for a result. A
    // store hiccup must not strand a student for the rest of the session, so
    // tell them plainly rather than leaving a dead screen. The phone keeps the
    // attempt and its key, so sending it again is safe.
    socket.emit('session:rejected', {
      reason: 'That answer did not save. Tap Next question to carry on.',
      ...echo,
    });
  } finally {
    release?.();
  }
}

async function handleNext(socket) {
  let release = null;
  try {
    const ctx = socket.data.student;
    if (!ctx) {
      reject(socket, 'Join a session before asking for a question.');
      return;
    }

    const session = await loadSession(ctx.code);
    if (!session || session.status === 'closed') {
      socket.emit('session:closed', {});
      return;
    }
    if (session.status === 'paused') {
      socket.emit('session:paused', { code: session.code });
      return;
    }
    if (session.status === 'waiting') {
      socket.emit('server:waiting', { code: session.code, title: session.title ?? '', message: WAITING_MESSAGE });
      return;
    }

    // dispatchNext() writes the pin back over the profile read here.
    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    const stored = await getRepo().getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.');
      return;
    }

    // The first ask after a join that served nothing because the phone had
    // answers waiting (Phase 7, resumePending) resumes the question pinned on
    // its screen, as that join would have; every other ask is for a new one.
    const resume = ctx.resumePending === true;
    ctx.resumePending = false;
    await dispatchNext(socket, { profile: hydrate(stored), session, resume });
  } catch (err) {
    logError('student:next', err);
  } finally {
    release?.();
  }
}

/* ----------------------------------------------- question packs (Phase 7) --
 *
 * student:pack {} -> server:pack { issuedAt, expiresAt, graceMinutes,
 * timePerQuestion?, questions: [{ question, reason }], note } (packPayload in
 * services/offline.js), or { questions: [], note } when there is nothing to
 * pack or it could not be recorded: the few questions this phone would
 * be served next, for use while its connection is down (O3; the rules are
 * services/offline.js, the reasoning docs/OFFLINE_SELECTION.md).
 *
 * Every question goes through forStudent(), as a live one does: no key, nothing
 * a phone could mark with. Its answers arrive later as ordinary student:answer
 * events and are marked here, in the order they arrive. The pack is recorded
 * (question_packs, 0030) BEFORE it is sent, so every answer to it is
 * recognised as served; one that could not be recorded is not sent.
 *
 * Asking again returns the pack the phone holds while it has not expired, its
 * answered questions replaced from the same stable order. A new record is
 * written only when the pack gains a question its live record does not hold
 * (packRecordNeed): the question on the screen moving does not, and a phone
 * has at most PACK_RECORD_LIMIT records in a room.
 *
 * One request at a time per connection: a request that arrives while one is
 * being answered is folded into one more answer after it, however many arrive.
 * And only this student's lock is taken, never the room's: the room's
 * class-question lock (CLASS_LOCK) taken here let one phone sending pack
 * requests without end hold up every class question, the room's close and its
 * delete, and every other phone's pack.
 */
async function handlePack(socket) {
  if (socket.data.packing) {
    socket.data.packAgain = true;
    return;
  }
  socket.data.packing = true;
  try {
    do {
      socket.data.packAgain = false;
      await packOnce(socket);
    } while (socket.data.packAgain && socket.connected);
  } finally {
    socket.data.packing = false;
  }
}

async function packOnce(socket) {
  let release = null;
  try {
    const ctx = socket.data.student;
    if (!ctx) {
      reject(socket, 'Join a session before asking for questions.');
      return;
    }
    const session = await loadSession(ctx.code);
    if (!session || session.status === 'closed') {
      socket.emit('session:closed', {});
      return;
    }
    if (session.status === 'paused') {
      socket.emit('session:paused', { code: session.code });
      return;
    }
    if (session.status === 'waiting') {
      socket.emit('server:waiting', { code: session.code, title: session.title ?? '', message: WAITING_MESSAGE });
      return;
    }

    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    if (roomDeleting(ctx.sessionId)) {
      socket.emit('server:pack', { questions: [], note: PACK_FAILED_NOTE });
      return;
    }
    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.');
      return;
    }
    const profile = hydrate(stored);
    const settings = sessionSettings(session);
    // The live loop's own bank (servable, nothing asked to the class), with
    // the room's class questions read again here.
    const [bank, asked, packs] = await Promise.all([
      loadBank(session), repo.listClassQuestions(session._id), repo.listQuestionPacks(ctx.sessionId, ctx.rollNo),
    ]);
    const items = withoutAsked(bank, asked);
    // The question on the phone's screen is not packed: the phone holds it.
    const pin = profile.served?.questionId ? [String(profile.served.questionId)] : [];

    // What the phone holds already and keeps: its live pack's questions still
    // open (not marked, not pinned, still servable, still at a level it may be
    // packed at), in the order it had them.
    const live = livePack(packs);
    const marked = new Set(profile.history.map((h) => String(h.questionId)));
    const levels = new Set(packableLevels(profile, { adapt: settings.adapt }));
    const byId = new Map(items.map((q) => [String(q._id), q]));
    const held = (live?.questionIds ?? []).map((id) => byId.get(String(id)))
      .filter((q) => q && !marked.has(String(q._id)) && !pin.includes(String(q._id)) && levels.has(q.bloom));
    // Never more than the room's cap on questions per student leaves. A
    // question of the live pack now on the screen keeps its place in the pack:
    // filled from the bank, every move of the pin onto a packed question
    // (student:next asks for a new pin each time) made a new pack and a new
    // record, without one answer.
    const cap = settings.questionsPerStudent;
    const pinHeld = pin.length > 0 && (live?.questionIds ?? []).some((id) => sameId(id, pin[0]));
    const size = Math.max(0, (cap ? cap - profile.history.length - pin.length : PACK_SIZE) - (pinHeld ? 1 : 0));
    let chosen = choosePack(profile, items, { size, adapt: settings.adapt, exclude: pin, held });

    const need = packRecordNeed({ live, chosen, count: packs.length });
    // At the limit: only what the live pack's record already covers.
    if (need === 'limit') chosen = chosen.filter((c) => (live?.questionIds ?? []).some((id) => sameId(id, c.question._id)));
    if (!chosen.length) {
      socket.emit('server:pack', { questions: [], note: PACK_EMPTY_NOTE });
      return;
    }
    let pack = live;
    if (need === 'write') {
      const issuedAt = new Date().toISOString();
      pack = await repo.addQuestionPack({
        sessionId: ctx.sessionId, rollNo: ctx.rollNo, questionIds: chosen.map((c) => String(c.question._id)), issuedAt,
        expiresAt: packExpiry(issuedAt),
      });
    }
    // A question put to the class while this ran is not sent (the bank above
    // was read before it started). Its record does no harm: an answer to it is
    // kept with the class question first, whatever any pack says.
    const nowAsked = await repo.listClassQuestions(session._id);
    const sendable = new Set(withoutAsked(chosen.map((c) => c.question), nowAsked).map((q) => String(q._id)));
    chosen = chosen.filter((c) => sendable.has(String(c.question._id)));
    if (!chosen.length) {
      socket.emit('server:pack', { questions: [], note: PACK_EMPTY_NOTE });
      return;
    }
    // Each question as server:question carries it (packPayload): forStudent()
    // and the phone's own provenance, never a key.
    socket.emit('server:pack', packPayload({ pack, chosen, profile, supports: ctx.supports ?? null, settings }));
  } catch (err) {
    logError('student:pack', err);
    socket.emit('server:pack', { questions: [], note: PACK_FAILED_NOTE });
  } finally {
    release?.();
  }
}

/**
 * A waiting room has just been started (POST /api/session/:code/start): every
 * phone waiting in it gets its first question, the teacher screens hear the new
 * status, and the projector shows it. Each phone under its own student's lock,
 * as every serve is; a phone that joins while this runs is served by its own
 * join (handleJoin reads the status again once it is in the room).
 *
 * Only a phone its join told to wait (`waiting`), and that flag is spent here
 * under the student's lock: a join that overlapped the start and found the room
 * open has served its phone already, and serving it again sent the same
 * question twice. The route calls this under the room's status lock, so a
 * close waits for it and a second start finds the room open and is refused.
 */
export async function startRoom(io, session) {
  const id = String(session._id);
  io.to(`teacher:${session.code}`).emit('teacher:status', { code: session.code, status: session.status });
  const waiting = [...io.sockets.sockets.values()].filter((s) => s.data.student?.sessionId === id);
  await Promise.all(waiting.map(async (socket) => {
    const release = await lockProfile(id, socket.data.student.rollNo);
    try {
      const ctx = socket.data.student;
      if (ctx?.sessionId !== id || !ctx.waiting) return;
      ctx.waiting = false;
      // Served here, so its next ask is for a new question (Phase 7).
      ctx.resumePending = false;
      const stored = await getRepo().getProfile(id, ctx.rollNo);
      if (stored && socket.connected) await dispatchNext(socket, { profile: hydrate(stored), session, resume: true });
    } catch (err) {
      logError('start', err);
    } finally {
      release();
    }
  }));
  await broadcastGrid(io, session);
  await pushProjector(io, getRepo(), session);
}

/* ------------------------------------------------- class questions (Phase 5) --
 *
 * One approved question put to every phone in the room, a pause to discuss, a
 * re-vote (services/classQuestions.js holds the rules and every payload). The
 * professor's routes (routes/classQuestions.js) call startClassQuestion and
 * changeClassQuestion; the phones vote with student:vote. The state is in the
 * store (class_questions, 0023), so a restart loses none of it.
 *
 * Votes and changes of state meet under locks, so a round's counts are exact
 * when the professor sees them: a vote is written under its student's lock,
 * and reads the class question's state there; a change of state is written
 * under the room's CLASS_LOCK and then takes and drops every student's lock
 * once (sweepVotes), which waits out any vote that read the old state. After
 * that no vote can land in a round that has closed: it reads the new state and
 * is kept, not counted.
 */

/** Wait out every vote already under way in a room: each student's lock, taken and dropped once. */
async function sweepVotes(sessionId) {
  const profiles = await getRepo().listProfiles(sessionId);
  for (const rollNo of new Set(profiles.map((p) => String(p.rollNo)))) (await lockProfile(sessionId, rollNo))();
}

/** The class question running in a room now, or null. */
async function runningClassQuestion(session) {
  return runningOf(await getRepo().listClassQuestions(session._id));
}

/** Is this phone signed in as the account its profile is linked to (decision 7)? */
const signedInAs = (ctx, profile) => Boolean(ctx?.verifiedAccountId) && String(ctx.verifiedAccountId) === String(profile?.accountId ?? '');

/**
 * The votes under a roll number a phone may be sent back as its own. Under a
 * roll number a signed-in student's phone linked (decision 7), a phone not
 * signed in as her gets only votes from phones not signed in: a typed roll
 * number proves nothing, and her vote and confidence tap are hers.
 */
const votesShownTo = (ctx, profile, rows) => (profile?.accountVerified && !signedInAs(ctx, profile)
  ? rows.filter((a) => a.accountVerified !== true)
  : rows);

/** One phone's view of the running class question, with its own vote in the current round. */
async function sendClassState(socket, session, profile) {
  try {
    const cq = await runningClassQuestion(session);
    if (!cq) return;
    const { rollNo } = profile;
    const rows = await getRepo().listAnswers({ sessionId: session._id, rollNo, classQuestionId: String(cq._id) });
    socket.emit('class:question', phoneQuestion(cq, { mine: mineNow(cq, votesShownTo(socket.data.student, profile, rows), rollNo) }));
  } catch (err) {
    logError('class:question', err);
  }
}

/**
 * class:question to every phone in the room, each with its own vote in force in
 * the current round, by sendClassState's rule: after the room is resumed and
 * when the class question is paused. Sent to the room at once it could carry no
 * phone's own vote, so a phone that reloaded during a pause showed none although
 * the server held one. The room's votes and profiles are read once, not per phone.
 */
async function sendClassQuestionToEach(io, session, cq) {
  const id = String(session._id);
  const phones = [...io.sockets.sockets.values()].filter((s) => s.data.student?.sessionId === id && s.connected);
  if (!phones.length) return;
  const repo = getRepo();
  let rows;
  let profiles;
  try {
    [rows, profiles] = await Promise.all([votesOf(repo, cq), repo.listProfiles(id)]);
  } catch (err) {
    // Without the votes, the room is still told where the question stands, with
    // no vote, as before: a phone must not keep voting in a round that has closed.
    logError('class:question', err);
    io.to(`session:${session.code}`).emit('class:question', phoneQuestion(cq));
    return;
  }
  const byRoll = new Map(profiles.map((p) => [String(p.rollNo), p]));
  for (const socket of phones) {
    const ctx = socket.data.student;
    const own = rows.filter((a) => String(a.rollNo) === String(ctx.rollNo));
    const mine = mineNow(cq, votesShownTo(ctx, byRoll.get(String(ctx.rollNo)), own), ctx.rollNo);
    socket.emit('class:question', phoneQuestion(cq, { mine }));
  }
}

/**
 * The professor's screens and the projector, after a change or a vote:
 * teacher:class-question (the staff body: counts, never a name), and the
 * projector's screen when it shows a class question.
 */
export async function pushClassQuestion(io, session, cq) {
  if (!io) return;
  try {
    const repo = getRepo();
    if (io.sockets.adapter.rooms.get(`teacher:${session.code}`)?.size) {
      io.to(`teacher:${session.code}`).emit('teacher:class-question', await classQuestionBody(repo, session, cq, { isOnline }));
    }
    if (screenOf(session).question?.source === 'class') await pushProjector(io, repo, session);
  } catch (err) {
    logError('class push', err);
  }
}

// After a vote the professor's screens and the wall follow at most once a
// second per class question: forty phones voting in one breath are one push.
const CLASS_PUSH_MS = 1000;
const classPushes = new Map(); // class question id -> { last, timer }

function scheduleClassPush(io, session, cqId) {
  if (!io) return;
  const key = String(cqId);
  const state = classPushes.get(key) ?? { last: 0, timer: null };
  classPushes.set(key, state);
  if (state.timer) return;
  const wait = Math.max(0, state.last + CLASS_PUSH_MS - Date.now());
  state.timer = setTimeout(async () => {
    state.timer = null;
    state.last = Date.now();
    // Questions no vote has reached for a while drop out, so the map does not
    // grow for the life of the process.
    if (classPushes.size > 200) {
      for (const [k, s] of classPushes) if (!s.timer && s.last + 60000 < state.last) classPushes.delete(k);
    }
    const cq = await getRepo().getClassQuestion(key).catch((err) => logError('class push', err));
    if (cq) await pushClassQuestion(io, session, cq);
  }, wait);
  state.timer.unref?.();
}

/**
 * A phone's own question again, after a class question closed. A phone parks
 * its own question while the class question runs and goes back to it; only a
 * phone whose own question WAS the class question has nothing to go back to
 * (it is never served on its own in this room again), so it is sent its next
 * one, under its own lock, as every serve is.
 */
async function resumeAfterClass(io, session, cq) {
  const room = await getRepo().getSession(session._id);
  if (!room || room.status !== 'open') return;
  const id = String(room._id);
  const asked = String(cq.questionId ?? '').toLowerCase();
  const phones = [...io.sockets.sockets.values()].filter((s) => s.data.student?.sessionId === id && s.connected);
  await Promise.all(phones.map(async (socket) => {
    const release = await lockProfile(id, socket.data.student.rollNo);
    try {
      if (roomDeleting(id)) return;
      const stored = await getRepo().getProfile(id, socket.data.student.rollNo);
      if (stored && String(stored.served?.questionId ?? '').toLowerCase() === asked) {
        await dispatchNext(socket, { profile: hydrate(stored), session: room, resume: true });
      }
    } catch (err) {
      logError('class resume', err);
    } finally {
      release();
    }
  }));
}

/**
 * Every phone, the professor's screens and the wall, after a class question
 * starts or changes. A pause goes phone by phone, each with its own round 1
 * vote; a start or a re-vote opens a round nobody has voted in yet, so it goes
 * to the room at once.
 */
async function announceClassQuestion(io, session, cq) {
  if (!io) return;
  const phones = io.to(`session:${session.code}`);
  if (cq.state === 'closed') phones.emit('class:closed', phoneClosed(cq));
  else if (cq.state === 'paused') await sendClassQuestionToEach(io, session, cq);
  else phones.emit('class:question', phoneQuestion(cq));
  await pushClassQuestion(io, session, cq);
  if (cq.state === 'closed') await resumeAfterClass(io, session, cq);
}

/**
 * The room's owner puts one approved question to every phone (POST
 * /api/session/:code/class-questions). Under the room's CLASS_LOCK, from the
 * room as stored now: only while it is open, in a room where phones answer, one
 * at a time, an approved question of the room whose options every phone can
 * vote on, never one asked to the class here before (startable). The live
 * loop's bank is cleared so the question is never served on its own here again.
 */
export async function startClassQuestion(io, session, { questionId, by = null }) {
  const repo = getRepo();
  const release = await lockProfile(session._id, CLASS_LOCK);
  let made;
  let room;
  try {
    if (roomDeleting(session._id)) throw fail('That room is being deleted. Nothing was changed.', 409);
    room = await repo.getSession(session._id);
    if (!room) throw fail('That room was not found.', 404);
    const [questions, asked] = await Promise.all([repo.listQuestions(room.contentId), repo.listClassQuestions(room._id)]);
    const question = startable({
      room, settings: sessionSettings(room), question: { _id: questionId }, servable: servableFor(room, questions), asked,
    });
    made = await repo.addClassQuestion({
      sessionId: String(room._id),
      seq: asked.reduce((n, c) => Math.max(n, Number(c.seq) || 0), 0) + 1,
      questionId: String(question._id),
      questionSnapshot: snapshotOf(question),
      state: 'open',
      startedAt: new Date().toISOString(),
      startedBy: by,
    });
    releaseSession({ sessionId: room._id });
  } finally {
    release();
  }
  await announceClassQuestion(io, room, made);
  return made;
}

/**
 * pause, revote or close (with `reveal`) a class question of this room, under
 * the room's CLASS_LOCK; when a round closes, every vote under way is waited
 * out (sweepVotes) before anyone is told, so the counts the professor then sees
 * are the round's whole. 404 for a class question of another room.
 */
export async function changeClassQuestion(io, session, cqId, action, { by = null, reveal = false } = {}) {
  const repo = getRepo();
  const release = await lockProfile(session._id, CLASS_LOCK);
  let updated;
  try {
    if (roomDeleting(session._id)) throw fail('That room is being deleted. Nothing was changed.', 409);
    const cq = isRecordId(String(cqId ?? '')) ? await repo.getClassQuestion(cqId) : null;
    if (!cq || String(cq.sessionId) !== String(session._id)) throw fail('That class question was not found.', 404);
    const patch = transition(cq, action, { by, reveal });
    updated = (await repo.updateClassQuestion(cq._id, patch)) ?? { ...cq, ...patch };
    if (votingRound(cq.state) !== null) await sweepVotes(session._id);
  } finally {
    release();
  }
  await announceClassQuestion(io, session, updated);
  return updated;
}

/**
 * A room closing closes its running class question too, without revealing its
 * key (routes/session.js, under the room's status lock). The phones are told
 * the room closed; the professor's screens get the class question as it ended.
 */
export async function closeClassQuestionWithRoom(io, session, { by = null } = {}) {
  const repo = getRepo();
  const release = await lockProfile(session._id, CLASS_LOCK);
  let updated = null;
  try {
    const cq = runningOf(await repo.listClassQuestions(session._id));
    if (!cq) return;
    const patch = transition(cq, 'close', { by, reveal: false });
    updated = (await repo.updateClassQuestion(cq._id, patch)) ?? { ...cq, ...patch };
    if (votingRound(cq.state) !== null) await sweepVotes(session._id);
  } finally {
    release();
  }
  if (updated) await pushClassQuestion(io, session, updated);
}

/**
 * A room resumed from a pause: its phones are sent the running class question
 * again, which the pause covered, each with its own vote (a phone that joined
 * or reloaded during the pause was sent none at its join).
 */
export async function resendClassQuestion(io, session) {
  if (!io) return;
  try {
    const cq = await runningClassQuestion(session);
    if (cq) await sendClassQuestionToEach(io, session, cq);
  } catch (err) {
    logError('class:question', err);
  }
}

/**
 * student:vote { classQuestionId, round, response, confidence?, answerId }.
 *
 * Every vote is stored, as an answers row with the class question's id and the
 * round (never overwritten): one in the round now open counts, and replaces the
 * same phone's earlier vote in that round, which is kept with `final` false; a
 * vote for a round that has closed is kept and never counted (LATE_DETAIL), and
 * so is one for a round not yet open (EARLY_DETAIL), one sent while the room is
 * paused (PAUSED_DETAIL, as an answer then is refused), and one from a phone not
 * signed in, under a roll number whose vote in the round came from the
 * signed-in student's own phone (UNVERIFIED_DETAIL, decision 7). The
 * vote touches no profile: no level, no history, no band (a class question
 * moves no level). The phone is told what it sent and whether it counts, never
 * whether it was right.
 *
 * Under the student's lock, like an answer, so a room delete waits it out and a
 * change of state's sweep finds it.
 */
async function handleVote(io, socket, payload) {
  let release = null;
  // Which vote every reply is about (Batch 8), as answers' replies say.
  const echo = voteEcho(payload);
  try {
    const ctx = socket.data.student;
    if (!ctx) {
      reject(socket, 'Join a session before voting.', echo);
      return;
    }
    const session = await loadSession(ctx.code);
    if (!session || session.status === 'closed') {
      socket.emit('session:closed', { ...echo });
      return;
    }
    const cqId = String(payload?.classQuestionId ?? '');
    const response = payload?.response;
    if (!isRecordId(cqId) || response === undefined || response === null) {
      logIgnored('student:vote', `malformed payload from ${ctx.rollNo}`);
      return;
    }

    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    if (roomDeleting(ctx.sessionId)) {
      reject(socket, 'That vote did not save. Vote again.', echo);
      return;
    }
    const repo = getRepo();
    const cq = await repo.getClassQuestion(cqId);
    if (!cq || String(cq.sessionId) !== ctx.sessionId) {
      // Nothing it could be a vote in: there is no question to store it against.
      logIgnored('student:vote', `class question ${cqId} is not this room's`);
      return;
    }
    const profile = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!profile) {
      reject(socket, 'Your row is gone - rejoin with your roll number.', echo);
      return;
    }

    const open = votingRound(cq.state);
    const sentRound = Number(payload?.round);
    const round = sentRound === 1 || sentRound === 2 ? sentRound : (open ?? roundOf(cq));
    const question = asQuestion(cq);
    const seed = `class:${cq._id}`;
    const verified = signedInAs(ctx, profile);

    const mine = await repo.listAnswers({ sessionId: ctx.sessionId, rollNo: ctx.rollNo, classQuestionId: String(cq._id) });
    const inRound = mine.filter((a) => Number(a.round) === round);

    // Why this vote is kept and not counted, or null when it counts. In this
    // order, so a phone is told the first thing that stopped it.
    let notCounted = null;
    if (round > roundOf(cq)) notCounted = EARLY_DETAIL;
    else if (open === null || round !== open) notCounted = LATE_DETAIL;
    else if (session.status === 'paused') notCounted = PAUSED_DETAIL;
    else if (!verified && inRound.some((a) => a.final !== false && a.accountVerified === true)) notCounted = UNVERIFIED_DETAIL;
    const counted = notCounted === null;

    // The idempotency key, as for an answer: the phone's, or one derived from
    // the vote and how many this phone has sent in the round (so a phone that
    // sends none and goes back to an earlier choice is a new vote, not that
    // one again). A key another row holds that is not this student's vote in
    // this question and round is filed under a key scoped to it, which no phone
    // can send ('@' and ':' are outside ANSWER_ID). So is one a signed-in
    // student's phone wrote, sent by a phone not signed in as her (decision 7):
    // answered from it, that phone was sent her vote and her confidence tap.
    const print = answerPrint(response);
    const sent = String(payload?.answerId ?? '');
    let answerKey = ANSWER_ID.test(sent) ? sent : `class-${cq._id}-${round}-${ctx.rollNo}-${inRound.length + 1}-${print}`;
    const theirs = (row) => row && row.rollNo === ctx.rollNo && String(row.classQuestionId ?? '') === String(cq._id)
      && Number(row.round) === round && (verified || row.accountVerified !== true);
    let prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    if (prior && !theirs(prior)) {
      answerKey = `${answerKey}@${ctx.rollNo}:${cq._id}:${round}`;
      prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    }
    if (prior) {
      socket.emit('class:vote', { ...phoneVote(cq, prior, { counted: prior.final !== false }), ...echo });
      return;
    }
    const graded = score(question, response, seed, null);
    const ungraded = graded.ungraded === true;
    const stamped = await repo.recordAnswer({
      sessionId: ctx.sessionId,
      answerKey,
      rollNo: ctx.rollNo,
      accountId: profile.accountId ?? null,
      accountVerified: verified,
      questionId: question._id || null,
      contentId: session.contentId ?? null,
      topic: question.topic ?? '',
      bloom: question.bloom,
      kind: question.kind ?? 'mcq',
      questionSnapshot: cq.questionSnapshot ?? {},
      response,
      // The n-th vote this phone sent in this round.
      attempt: inRound.length + 1,
      final: counted,
      correct: ungraded ? null : graded.correct,
      score: ungraded ? null : graded.score,
      ungraded,
      servedAt: (round === 2 ? cq.revoteAt : cq.startedAt) ?? null,
      answeredAt: new Date().toISOString(),
      language: 'en',
      questionSource: question.source ?? 'llm',
      detail: counted ? (graded.detail ?? '') : notCounted,
      autoCorrect: graded.correct,
      autoScore: graded.score,
      autoDetail: graded.detail ?? '',
      reviewStatus: 'auto',
      confidence: storedConfidence(confidenceFrom(payload?.confidence)),
      classQuestionId: String(cq._id),
      round,
    });
    if (stamped.duplicate) {
      socket.emit('class:vote', { ...phoneVote(cq, stamped.answer, { counted: stamped.answer.final !== false }), ...echo });
      return;
    }
    // The vote it replaces is kept, with `final` false: the record of a phone
    // that changed its mind, never counted. A failure here leaves two votes in
    // force, and the later one is still the one every count reads.
    if (counted) {
      for (const old of inRound.filter((a) => a.final !== false)) {
        await repo.updateAnswer(old._id, { final: false }).catch((err) => logError('vote', err));
      }
    }
    socket.emit('class:vote', { ...phoneVote(cq, stamped.answer, { counted }), ...echo });
    // A phone that missed the pause hears it, as an answer sent then would.
    if (notCounted === PAUSED_DETAIL) socket.emit('session:paused', { code: session.code });
    scheduleClassPush(io, session, cq._id);
  } catch (err) {
    logError('student:vote', err);
    socket.emit('session:rejected', { reason: 'That vote did not save. Vote again.', ...echo });
  } finally {
    release?.();
  }
}

async function handleWatch(socket, payload) {
  try {
    // Read through the cache: a teacher watching a closed session still gets
    // the final grid rather than a rejection.
    const code = String(payload?.code ?? '').trim().toUpperCase();
    const session = code ? await getRepo().getSessionByCode(code) : null;
    if (!session) {
      reject(socket, 'No session with that code.');
      return;
    }

    // The grid is the whole class's performance, and the room code is on a wall.
    // Credentials arrive in the payload because a socket has no headers to read,
    // and are checked against exactly the rules the HTTP guard uses.
    // The connection's address too: in laptop mode wrong keys are counted per
    // address, here as for a request (teacherAuth.js).
    const who = await verifyTeacherCredentials({ key: payload?.key, token: payload?.token, address: socket.handshake?.address });
    if (!who.ok) {
      reject(socket, who.reason || 'Teacher credentials required to watch a session.');
      return;
    }

    // Being a teacher is not enough: this has to be a room this teacher may
    // read - their own, an HOD's department, or for the shared key the rooms
    // nobody owns. The same rule GET /grid enforces, and the same answer for a
    // room that exists but is not theirs as for one that does not, so a code
    // cannot be probed.
    const viewer = { id: who.accountId ?? null, role: who.role };
    if (!(await canRead(viewer, ownerOf(session)))) {
      reject(socket, 'No session with that code.');
      return;
    }

    socket.data.teacher = { code: session.code, accountId: who.accountId, role: who.role };
    socket.join(`teacher:${session.code}`);
    socket.emit('teacher:grid', await gridPayload(session));
    socket.emit('teacher:status', { code: session.code, status: session.status });
    // The live insights at once, as the grid is; then with every grid push. A
    // failure leaves this screen without them until the next push, never
    // without its grid.
    try {
      socket.emit('teacher:insights', await roomInsights(getRepo(), session));
    } catch (err) {
      logError('teacher:insights', err);
    }
    // A class question running in the room, as it stands, so a screen opened
    // mid-question has it at once (Phase 5).
    try {
      const cq = await runningClassQuestion(session);
      if (cq) socket.emit('teacher:class-question', await classQuestionBody(getRepo(), session, cq, { isOnline }));
    } catch (err) {
      logError('teacher:class-question', err);
    }
  } catch (err) {
    logError('teacher:watch', err);
  }
}

async function handleDisconnect(io, socket) {
  try {
    const ctx = socket.data.student;
    if (!ctx) return;
    // If the entry already points elsewhere the student has rejoined on a new
    // socket; this is the old one finally timing out and it must not mark them
    // offline.
    if (presence.get(ctx.key) !== socket.id) return;
    presence.delete(ctx.key);

    const session = await loadSession(ctx.code);
    if (session) await broadcastGrid(io, session);
  } catch (err) {
    logError('disconnect', err);
  }
}


/**
 * A signal the browser is reporting about itself.
 *
 * Accepted, recorded, and never trusted as proof: this arrives over a socket the
 * student's own devtools can emit on, so it can be forged or simply switched
 * off. It is worth having anyway - most students will not touch it, and a
 * pattern across a class is informative even when any single event is not.
 *
 * Deliberately silent on failure. A student whose phone spams these gets no
 * feedback either way, because telling them which reports land is telling them
 * exactly what to suppress.
 */
async function handleSignal(socket, payload) {
  let release = null;
  try {
    const ctx = socket.data.student;
    if (!ctx) return;
    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    // Written into the profile, which the archive of a room being deleted has
    // already read: see holdRoomForDelete.
    if (roomDeleting(ctx.sessionId)) return;
    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) return;
    const profile = hydrate(stored);
    if (!reportFromClient(profile, String(payload?.kind ?? ''), payload ?? {})) return;
    // Decision 8: never recorded for a student their class's roster marks
    // under 18. The phone is told nothing either way, as for any signal.
    if (await signalsOff(repo, await loadSession(ctx.code), ctx.rollNo)) return;
    await repo.saveProfile(profile);
  } catch (err) {
    logError('student:signal', err);
  } finally {
    release?.();
  }
}

export function attachSockets(io) {
  io.on('connection', (socket) => {
    // A projector's connection carries projector events and nothing else
    // (services/projector.js), so once it has asked to watch with a link,
    // everything a phone or a teacher's screen would send is ignored on it:
    // answered, it would put a phone's or a teacher's event on the wall. The
    // claim is made here, before the handler's first await, so a connection
    // sending student:join and projector:watch together is one or the other.
    const unlessProjector = (event, handler) => (...args) => {
      if (socket.data.projector || !claimConnection(socket, 'room')) {
        logIgnored(event, 'sent on a projector connection');
        return undefined;
      }
      return handler(...args);
    };
    socket.on('student:join', unlessProjector('student:join', (payload) => handleJoin(io, socket, payload)));
    socket.on('student:signal', unlessProjector('student:signal', (payload) => handleSignal(socket, payload)));
    socket.on('student:answer', unlessProjector('student:answer', (payload) => handleAnswer(io, socket, payload)));
    socket.on('student:next', unlessProjector('student:next', () => handleNext(socket)));
    socket.on('student:pack', unlessProjector('student:pack', () => handlePack(socket)));
    socket.on('student:vote', unlessProjector('student:vote', (payload) => handleVote(io, socket, payload)));
    socket.on('teacher:watch', unlessProjector('teacher:watch', (payload) => handleWatch(socket, payload)));
    socket.on('projector:watch', (payload) => watchWall(io, getRepo(), socket, payload)
      .catch((err) => logError('projector:watch', err)));
    socket.on('disconnect', () => handleDisconnect(io, socket));
  });
}
