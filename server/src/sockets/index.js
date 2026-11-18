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
} from '../services/mastery.js';
import { selectNext } from '../services/selector.js';
import { buildGridRow } from '../routes/session.js';
import { isRecordId } from '../ids.js';
import { score, forStudent, countsTowardMastery } from '../questionTypes.js';
import { verifyTeacherCredentials } from '../auth.js';
import { reportFromClient, checkLatency, noteSecondSocket } from '../services/integrity.js';

const presence = new Map(); // `${code}:${rollNo}` -> socket.id
const bankCache = new Map(); // sessionId -> Promise<question[]>
const sessionCache = new Map(); // code -> open session document

// Roll numbers in the wild look like 21BCE1234, CS-045, 2/A. Anything else is a
// typo or a probe, and an empty one would collide with every other empty one.
const ROLL_SHAPE = /^[A-Z0-9][A-Z0-9 ._\-\/]{0,23}$/;
const MAX_OPTION_INDEX = 3;

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
 */
function loadBank(session) {
  const id = String(session._id);
  let pending = bankCache.get(id);
  if (!pending) {
    pending = getRepo()
      .listQuestions(session.contentId)
      .then((questions) => questions.filter((q) => (q.status ?? 'active') === 'active'));
    // A failed read must not poison the cache for the rest of the session.
    pending.catch(() => bankCache.delete(id));
    bankCache.set(id, pending);
  }
  return pending;
}

async function gridRows(session) {
  const profiles = await getRepo().listProfiles(session._id);
  return profiles.map((p) => buildGridRow(p, { online: isOnline(session.code, p.rollNo) }));
}

async function broadcastGrid(io, session) {
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
    socket.emit('server:question', {
      question: forStudent(q, `${profile.rollNo}:${q._id}`),
      reason: pick.reason,
      index: profile.history.length + 1,
      bankCount: items.length,
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

    const repo = getRepo();
    const name = String(payload?.name ?? '').trim().slice(0, 60);
    const stored = await repo.getProfile(session._id, rollNo);

    // TC-07: the same roll number resumes the same profile. Never a second row.
    const profile = stored
      ? hydrate({ ...stored, name: stored.name || name })
      : hydrate(emptyProfile({ sessionId: String(session._id), rollNo, name }));
    if (!stored || profile.name !== (stored.name ?? '')) await repo.saveProfile(profile);

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
    };
    socket.join(`session:${session.code}`);

    const bank = await loadBank(session);
    socket.emit('session:accepted', {
      profile: buildGridRow(profile, { online: true }),
      session: { code: session.code, title: session.title ?? '' },
      bankCount: bank.length,
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
  }
}

async function handleAnswer(io, socket, payload) {
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

    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.');
      return;
    }
    const profile = hydrate(stored);

    // A double-tap on a phone must not score twice - but the phone still has to
    // hear something back. It disables its options the moment one is tapped and
    // only re-enables on server:result, so a silent return freezes that student
    // with no way forward and no visible error.
    const already = profile.history.find((h) => String(h.questionId) === questionId);
    if (already) {
      const stale = await repo.getQuestion(questionId).catch(() => null);
      socket.emit('server:result', {
        correct: already.correct,
        score: already.score ?? (already.correct ? 1 : 0),
        solution: stale ? score(stale, response, `${ctx.rollNo}:${stale._id}`).solution : null,
        workingLevel: profile.workingLevel,
        reason: profile.reason,
        levelChanged: false,
        profile: buildGridRow(profile, { online: true }),
      });
      return;
    }

    const bank = await loadBank(session);
    const question =
      bank.find((q) => String(q._id) === questionId) ?? (await repo.getQuestion(questionId));
    if (!question) {
      logIgnored('student:answer', `question ${questionId} is not in this bank`);
      // Unfreeze the phone by moving it on rather than leaving it stuck.
      await dispatchNext(socket, { profile, session, bank });
      return;
    }

    // Scored here, from the stored item, per its kind. A client-sent
    // correctness flag is never read - the phone only ever reports what it did.
    // Partial-credit kinds return a 0..1 score; the mastery model still consumes
    // a boolean, so the threshold lives in questionTypes and not in the model.
    // The SAME seed forStudent() shuffled with. It is what turns the positions
    // the phone reported back into the items they actually are - the phone is no
    // longer told which item is which, so this is the only place that knows.
    // Checked before the pin is cleared: `served.at` is when the server sent
    // this question, so the gap is real elapsed time and not something the phone
    // reported about itself.
    checkLatency(profile, question, profile.served?.at);

    const graded = score(question, response, `${ctx.rollNo}:${question._id}`);
    const { profile: next, decision } = applyAnswer(profile, {
      questionId,
      bloom: question.bloom,
      correct: graded.correct,
      score: graded.score,
    });
    // Answered, so the pin is spent. Leaving it set would resume a student onto
    // a question they have already been marked on, which the double-tap guard
    // would then refuse to score - a dead end they could not get out of.
    next.served = null;
    await repo.saveProfile(next);

    socket.emit('server:result', {
      correct: graded.correct,
      score: graded.score,
      solution: graded.solution,
      detail: graded.detail ?? '',
      kind: question.kind ?? 'mcq',
      workingLevel: next.workingLevel,
      reason: next.reason,
      levelChanged: Boolean(decision.changed),
      profile: buildGridRow(next, { online: true }),
    });

    await broadcastGrid(io, session);
  } catch (err) {
    logError('student:answer', err);
    // The phone is sitting with its options disabled waiting for a result. A
    // store hiccup must not strand a student for the rest of the session, so
    // tell them plainly rather than leaving a dead screen.
    socket.emit('session:rejected', {
      reason: 'That answer did not save. Tap Next question to carry on.',
    });
  }
}

async function handleNext(socket) {
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

    const stored = await getRepo().getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) {
      reject(socket, 'Your row is gone - rejoin with your roll number.');
      return;
    }

    await dispatchNext(socket, { profile: hydrate(stored), session });
  } catch (err) {
    logError('student:next', err);
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

    socket.data.teacher = { code: session.code, accountId: who.accountId, role: who.role };
    socket.join(`teacher:${session.code}`);
    socket.emit('teacher:grid', { rows: await gridRows(session), code: session.code });
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
  try {
    const ctx = socket.data.student;
    if (!ctx) return;
    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) return;
    const profile = hydrate(stored);
    if (!reportFromClient(profile, String(payload?.kind ?? ''), payload ?? {})) return;
    await repo.saveProfile(profile);
  } catch (err) {
    logError('student:signal', err);
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
