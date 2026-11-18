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
import { selectNext, servableFor, inRoomSet } from '../services/selector.js';
import { needsApproval } from '../services/edits.js';
import { buildGridRow } from '../routes/session.js';
import { isRecordId } from '../ids.js';
import { score, forStudent, countsTowardMastery, shownOptionIndices } from '../questionTypes.js';
import { verifyTeacherCredentials } from '../auth.js';
import { canRead, ownerOf } from '../ownership.js';
import { phoneSupports } from '../accommodations.js';
import { findStudentForRoll } from '../services/accounts.js';
import {
  reportFromClient,
  checkLatency,
  noteSecondSocket,
  checkLevelJump,
} from '../services/integrity.js';

const presence = new Map(); // `${code}:${rollNo}` -> socket.id
const bankCache = new Map(); // sessionId -> Promise<question[]>
const sessionCache = new Map(); // code -> open session document
const profileLocks = new Map(); // `${sessionId}:${rollNo}` -> tail of that student's queue
const deletingRooms = new Map(); // sessionId -> how many deletes of it are under way

// Roll numbers in the wild look like 21BCE1234, CS-045, 2/A. Anything else is a
// typo or a probe, and an empty one would collide with every other empty one.
const ROLL_SHAPE = /^[A-Z0-9][A-Z0-9 ._\-\/]{0,23}$/;

// The idempotency key a phone sends with every attempt. One key per attempt,
// reused verbatim on every resend of that attempt, so the server can tell "the
// same answer again" from "a new answer".
const ANSWER_ID = /^[A-Za-z0-9_-]{8,64}$/;

const key = (code, rollNo) => `${String(code).toUpperCase()}:${rollNo}`;

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

/** A payload we chose to drop is not a crash - one line, no stack. */
function logIgnored(event, detail) {
  console.warn(`[socket] ${event} ignored: ${detail}`);
}

function reject(socket, reason) {
  socket.emit('session:rejected', { reason });
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
 */
function loadBank(session) {
  const id = String(session._id);
  let pending = bankCache.get(id);
  if (!pending) {
    pending = getRepo()
      .listQuestions(session.contentId)
      .then((questions) => servableFor(session, questions));
    // A failed read must not poison the cache for the rest of the session.
    pending.catch(() => bankCache.delete(id));
    bankCache.set(id, pending);
  }
  return pending;
}

async function gridRows(session) {
  const profiles = await getRepo().listProfiles(session._id);
  // The room's own mastery goal, so the live grid and the REST grid agree.
  const { masteryGoal } = sessionSettings(session);
  return profiles.map((p) =>
    buildGridRow(p, { online: isOnline(session.code, p.rollNo), goal: masteryGoal }));
}

/**
 * The question as it stood when it was answered, kept with the answer.
 *
 * Questions are edited, regenerated and deleted after a class; the evidence of
 * what a student was actually asked must not change with them. Teacher-only:
 * this lives in the answers store, which no student route reads.
 */
function snapshotOf(question, shownOptions = null) {
  // `checks` is the professor's review advice, not part of what was asked, and
  // at a kilobyte or so it would be copied into every answer row. Who approved
  // the question and when describe the bank's row, not what was asked, and they
  // change without the question changing (an older question approved during a
  // class): kept here, they split one unchanged question into two versions in
  // the item report and two copies in a room's archive. The model and the slides
  // stay - they say where the question came from, and never change on a row.
  const { _id, contentId, createdAt, status, checks, approvedBy, approvedAt, ...rest } = question ?? {};
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

/** Push the room's grid to every teacher screen watching it. Also used after a review. */
export async function broadcastGrid(io, session) {
  io.to(`teacher:${session.code}`).emit('teacher:grid', {
    rows: await gridRows(session),
    code: session.code,
  });
}

/**
 * Hand the student their next item. The payload is assembled field by field:
 * `answerIdx` must never reach a phone before the answer is in.
 */
async function dispatchNext(socket, { profile, session, bank = null, resume = false }) {
  const supports = socket.data.student?.supports ?? null;
  try {
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
      const held = items.find((q) => String(q._id) === String(profile.served.questionId));
      // Only if it is still servable. A question the teacher discarded between
      // the drop and the reconnect must not come back from the dead.
      if (held && (held.status ?? 'active') === 'active') {
        pick = { question: held, reason: profile.served.reason || 'Picking up where you left off.' };
        resumed = true;
      }
    }
    if (!pick) pick = selectNext(profile, items);

    if (!pick) {
      socket.emit('server:exhausted', { profile: buildGridRow(profile, { online: true }) });
      return;
    }

    const q = pick.question;

    // Pinned before it is sent, and only when it changes: the profile is the
    // record of what this student is looking at, and it has to be written before
    // the phone can possibly answer it.
    if (String(profile.served?.questionId ?? '') !== String(q._id)) {
      profile.served = { questionId: String(q._id), at: new Date().toISOString(), reason: pick.reason };
      await getRepo().saveProfile(profile).catch((err) => logError('pin', err));
    }

    // forStudent() is the single place that decides what a phone may see. It
    // strips every answer field and shuffles match/order/rank/categorise
    // deterministically from the student + question, so a reconnect returns the
    // same board rather than rearranging under a half-finished answer.
    // Goes left on this question. A resumed question may already have spent
    // some, and the phone has to say so rather than promise a fresh set.
    const allowed = retriesAllowed(q, sessionSettings(session), profile.rollNo, supports);
    const spent = triesSpent(profile, q._id);

    socket.emit('server:question', {
      question: forStudent(q, `${profile.rollNo}:${q._id}`, supports),
      reason: pick.reason,
      index: profile.history.length + 1,
      bankCount: items.length,
      triesLeft: Math.max(1, allowed + 1 - spent),
      // True only when the item below is one this student was already pinned to.
      // The old test compared pick.reason against the pin's reason, which the
      // block above has just overwritten with pick.reason - so it was true on
      // every join, including a brand-new student's very first question, and
      // false in the one case it was written for: a pin saved with no reason.
      resumed,
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
    if (session.status === 'closed') {
      reject(socket, 'That session has already been closed.');
      return;
    }

    const rollNo = normaliseRoll(payload?.rollNo);
    if (!rollNo) {
      reject(socket, 'Enter your roll number to join.');
      return;
    }

    release = await lockProfile(session._id, rollNo);
    const repo = getRepo();
    const name = String(payload?.name ?? '').trim().slice(0, 60);
    const stored = await repo.getProfile(session._id, rollNo);

    // The student account behind this roll number, on the room owner's roster.
    // Gives the profile a lasting identity (so the answers follow the student
    // across rooms) and brings the supports their professor set. Only on a live
    // database, and never allowed to block a join: a failed lookup is a guest.
    let link = null;
    if (repo.kind === 'supabase' && session.ownerId) {
      link = await findStudentForRoll(session.ownerId, rollNo).catch((err) => {
        logError('account link', err);
        return null;
      });
    }

    // TC-07: the same roll number resumes the same profile. Never a second row.
    const profile = stored
      ? hydrate({ ...stored, name: stored.name || name })
      : hydrate(emptyProfile({ sessionId: String(session._id), rollNo, name }));
    const linkChanged = Boolean(link) && profile.accountId !== link.id;
    if (linkChanged) profile.accountId = link.id;
    if (!stored || linkChanged || profile.name !== (stored.name ?? '')) await repo.saveProfile(profile);
    const supports = link?.accommodations ?? null;

    // Two live sockets on one roll number. This is the strongest signal the
    // server has: it is not a browser self-report, devtools cannot switch it
    // off, and the innocent explanation - a phone that dropped and came back -
    // is already excluded, because in that case the old socket is gone and this
    // lookup finds nothing.
    const heldBy = presence.get(key(session.code, rollNo));
    if (heldBy && heldBy !== socket.id && io.sockets.sockets.get(heldBy)?.connected) {
      noteSecondSocket(profile, { other: heldBy });
      await repo.saveProfile(profile).catch((err) => logError('integrity', err));
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
    };
    socket.join(`session:${session.code}`);

    const bank = await loadBank(session);
    const settings = sessionSettings(session);
    socket.emit('session:accepted', {
      profile: buildGridRow(profile, { online: true, goal: settings.masteryGoal }),
      session: { code: session.code, title: session.title ?? '', settings },
      bankCount: bank.length,
      supports: phoneSupports(supports),
    });

    await broadcastGrid(io, session);
    // Paused: the student is in the room and stays in it, but gets nothing to
    // answer until the teacher resumes. The phone shows the paused card.
    if (session.status === 'paused') {
      socket.emit('session:paused', { code: session.code });
      return;
    }
    // `resume` because every join is potentially a reconnect: the same roll
    // number finding an existing profile IS the resume case, and a first join
    // simply has no pin to honour.
    await dispatchNext(socket, { profile, session, bank, resume: true });
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
async function replayStored(io, socket, { session, profile, prior, settings }) {
  // Only ever this student's own row. handleAnswer re-keys an attempt whose key
  // another student's row holds, so the one way left to get here with someone
  // else's row is two phones racing on one key. Answering from it would credit
  // this student with that student's mark; refusing sends the phone the "did not
  // save" notice, and its resend then takes the re-keyed path.
  if (String(prior.rollNo) !== String(profile.rollNo)) {
    throw new Error(`answer key ${prior.answerKey} is held by another student's row`);
  }
  const repo = getRepo();
  const question = await repo.getQuestion(prior.questionId).catch(() => null);
  const seed = `${prior.rollNo}:${prior.questionId}`;

  if (!prior.final) {
    const allowed = question ? retriesAllowed(question, settings, prior.rollNo, socket.data.student?.supports) : 0;
    socket.emit('server:result', {
      retry: true,
      correct: false,
      score: prior.score,
      detail: prior.detail ?? '',
      kind: prior.kind,
      triesLeft: Math.max(1, allowed + 1 - prior.attempt),
      workingLevel: profile.workingLevel,
      reason: profile.reason,
      levelChanged: false,
      profile: buildGridRow(profile, { online: true, goal: settings.masteryGoal }),
    });
    return;
  }

  let current = profile;
  const inHistory = profile.history.some((h) => String(h.questionId) === String(prior.questionId));
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
    current.served = null;
    await repo.saveProfile(current);
    await broadcastGrid(io, session);
  }

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
    reason: current.reason,
    levelChanged: false,
    profile: buildGridRow(current, { online: true, goal: settings.masteryGoal }),
  });
}

async function handleAnswer(io, socket, payload) {
  let release = null;
  try {
    const ctx = socket.data.student;
    if (!ctx) {
      reject(socket, 'Join a session before answering.');
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

    const questionId = String(payload?.questionId ?? '');
    // `response` carries whatever the kind needs - a number, an array of
    // numbers, or a string. `answerIdx` is still read so a phone that was
    // already mid-session on the previous client keeps working.
    const response = payload?.response !== undefined ? payload.response : payload?.answerIdx;
    if (!isRecordId(questionId) || response === undefined || response === null) {
      logIgnored('student:answer', `malformed payload from ${ctx.rollNo}`);
      return;
    }

    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    // The room is being archived and deleted. An answer written now would land
    // after the archive was read and go with the room. Refused the way a failed
    // save is, so the phone keeps it and resends: a room that is gone then says
    // so, and one whose delete was refused simply takes the answer.
    if (roomDeleting(ctx.sessionId)) {
      reject(socket, 'That answer did not save. Tap Next question to carry on.');
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

    // 1. An attempt the server already holds: answer it with the stored outcome.
    let prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    // A phone picks its own key, so one can arrive that another student's row
    // already holds. That row is theirs, and answering from it would credit this
    // student with their mark. This attempt is filed under the key scoped to
    // this student instead, which its own resends find again. ANSWER_ID has no
    // '@', so no phone can send a scoped key itself.
    if (prior && prior.rollNo !== ctx.rollNo) {
      answerKey = `${answerKey}@${ctx.rollNo}`;
      prior = await repo.getAnswerByKey(ctx.sessionId, answerKey);
    }
    if (prior) {
      await replayStored(io, socket, { session, profile, prior, settings });
      return;
    }

    // 2. A question this student has already been marked on, arriving under a
    // new key. A double-tap on a phone must not score twice - but the phone still
    // has to hear something back, or it sits with its options disabled.
    const already = profile.history.find((h) => String(h.questionId) === questionId);
    if (already) {
      const stale = await repo.getQuestion(questionId).catch(() => null);
      socket.emit('server:result', {
        correct: already.correct,
        score: already.score ?? (already.correct ? 1 : 0),
        ...((already.kind ?? stale?.kind) === 'open' && !already.review ? { provisional: true } : {}),
        ungraded: already.ungraded === true,
        solution: stale ? score(stale, response, `${ctx.rollNo}:${stale._id}`, supports).solution : null,
        kind: already.kind ?? stale?.kind ?? 'mcq',
        workingLevel: profile.workingLevel,
        reason: profile.reason,
        levelChanged: false,
        profile: buildGridRow(profile, { online: true, goal: settings.masteryGoal }),
      });
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
    const found =
      bank.find((q) => String(q._id) === questionId) ?? (await repo.getQuestion(questionId));
    const question = found && String(found.contentId) === String(session.contentId) && found.status !== 'draft'
      && !needsApproval(found) && inRoomSet(session, found._id)
      ? found
      : null;
    if (!question) {
      logIgnored('student:answer', `question ${questionId} is not in this bank`);
      // Unfreeze the phone by moving it on rather than leaving it stuck.
      await dispatchNext(socket, { profile, session, bank });
      return;
    }

    const spent = triesSpent(profile, questionId);
    // The same answer as the attempt just refused, under a new key: that is a
    // resend, not a new attempt, and must not cost a retry.
    if (spent > 0 && profile.served?.last === print) {
      const allowed = retriesAllowed(question, settings, ctx.rollNo, supports);
      socket.emit('server:result', {
        retry: true,
        correct: false,
        kind: question.kind ?? 'mcq',
        triesLeft: Math.max(1, allowed + 1 - spent),
        workingLevel: profile.workingLevel,
        reason: profile.reason,
        levelChanged: false,
        profile: buildGridRow(profile, { online: true, goal: settings.masteryGoal }),
      });
      return;
    }
    const attempt = spent + 1;

    // Checked on the first attempt only: `served.at` is when the server sent
    // this question, so the gap is real elapsed time and not something the
    // phone reported about itself. A retry's gap measures nothing new.
    if (attempt === 1) checkLatency(profile, question, profile.served?.at);

    // Scored here, from the stored item, per its kind. A client-sent
    // correctness flag is never read. The SAME seed and supports forStudent()
    // used, so shown positions map back to the items they really are.
    const seed = `${ctx.rollNo}:${question._id}`;
    const graded = score(question, response, seed, supports);
    const kind = question.kind ?? 'mcq';
    // One moment for this answer: the stored row and the history entry carry
    // the same timestamp, so the two records of one answer always agree.
    const answeredAt = new Date().toISOString();
    const evidence = {
      sessionId: ctx.sessionId,
      answerKey,
      rollNo: ctx.rollNo,
      accountId: profile.accountId ?? null,
      questionId,
      contentId: question.contentId ?? session.contentId ?? null,
      topic: question.topic ?? '',
      bloom: question.bloom,
      kind,
      questionSnapshot: snapshotOf(question, shownOptionIndices(question, seed, supports)),
      response,
      attempt,
      servedAt: profile.served?.at ?? null,
      answeredAt,
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
    };

    // A poll asks without assessing. It is recorded so it is never served
    // again, and it touches no level, no accuracy and no band.
    if (!countsTowardMastery(question)) {
      const stamped = await repo.recordAnswer({
        ...evidence, ungraded: true, correct: null, score: null, final: true, reviewStatus: 'auto',
      });
      if (stamped.duplicate) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings });
        return;
      }
      const { profile: next } = recordUngraded(profile, {
        questionId, bloom: question.bloom, topic: question.topic ?? '', kind, answerId: answerKey, at: answeredAt,
      });
      next.served = null;
      await repo.saveProfile(next);
      socket.emit('server:result', {
        ungraded: true,
        correct: false,
        score: null,
        solution: null,
        detail: '',
        kind,
        workingLevel: next.workingLevel,
        reason: next.reason,
        levelChanged: false,
        profile: buildGridRow(next, { online: true, goal: settings.masteryGoal }),
      });
      await broadcastGrid(io, session);
      return;
    }

    // Wrong with goes left: this attempt is stored as evidence but does not
    // count. The answer is NOT revealed - that would end the retry.
    const allowed = retriesAllowed(question, settings, ctx.rollNo, supports);
    if (!graded.correct && attempt <= allowed) {
      const stamped = await repo.recordAnswer({
        ...evidence, final: false, correct: false, score: graded.score,
      });
      if (stamped.duplicate) {
        await replayStored(io, socket, { session, profile, prior: stamped.answer, settings });
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
      await repo.saveProfile(profile);
      socket.emit('server:result', {
        retry: true,
        correct: false,
        score: graded.score,
        detail: graded.detail ?? '',
        kind,
        triesLeft: allowed + 1 - attempt,
        workingLevel: profile.workingLevel,
        reason: profile.reason,
        levelChanged: false,
        profile: buildGridRow(profile, { online: true, goal: settings.masteryGoal }),
      });
      return;
    }

    // Final. The evidence is written first: it is also the idempotency gate, so
    // a resend racing this one finds it and is answered from it.
    const stamped = await repo.recordAnswer({
      ...evidence, final: true, correct: graded.correct, score: graded.score,
    });
    if (stamped.duplicate) {
      await replayStored(io, socket, { session, profile, prior: stamped.answer, settings });
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
    });
    checkLevelJump(next);
    // Answered, so the pin is spent. Leaving it set would resume a student onto
    // a question they have already been marked on.
    next.served = null;
    await repo.saveProfile(next);

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
      reason: next.reason,
      levelChanged: Boolean(decision.changed),
      profile: buildGridRow(next, { online: true, goal: settings.masteryGoal }),
    });

    await broadcastGrid(io, session);
  } catch (err) {
    logError('student:answer', err);
    // The phone is sitting with its options disabled waiting for a result. A
    // store hiccup must not strand a student for the rest of the session, so
    // tell them plainly rather than leaving a dead screen. The phone keeps the
    // attempt and its key, so sending it again is safe.
    socket.emit('session:rejected', {
      reason: 'That answer did not save. Tap Next question to carry on.',
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

    // dispatchNext() writes the pin back over the profile read here.
    release = await lockProfile(ctx.sessionId, ctx.rollNo);
    const stored = await getRepo().getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.');
      return;
    }

    await dispatchNext(socket, { profile: hydrate(stored), session });
  } catch (err) {
    logError('student:next', err);
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
    const who = await verifyTeacherCredentials({ key: payload?.key, token: payload?.token });
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
    socket.emit('teacher:grid', { rows: await gridRows(session), code: session.code });
    socket.emit('teacher:status', { code: session.code, status: session.status });
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
    await repo.saveProfile(profile);
  } catch (err) {
    logError('student:signal', err);
  } finally {
    release?.();
  }
}

export function attachSockets(io) {
  io.on('connection', (socket) => {
    socket.on('student:join', (payload) => handleJoin(io, socket, payload));
    socket.on('student:signal', (payload) => handleSignal(socket, payload));
    socket.on('student:answer', (payload) => handleAnswer(io, socket, payload));
    socket.on('student:next', () => handleNext(socket));
    socket.on('teacher:watch', (payload) => handleWatch(socket, payload));
    socket.on('disconnect', () => handleDisconnect(io, socket));
  });
}
