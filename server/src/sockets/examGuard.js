// Batch 9, decision E5: the live loop's half of exam mode.
//
// sockets/index.js stays the owner of every connection; it calls in here at the
// join (Safe Exam Browser, what the phone is told, who is under 18), on a
// signal (rate and the exam kinds), before an answer (screen share), and hands
// over two events of exam mode's own:
//
//   student:screen    { state: 'started' | 'stopped' | 'declined', surface? }
//                     the phone's screen share. 'started' counts only for the
//                     whole screen (surface 'monitor', what getDisplayMedia's
//                     track reports); 'stopped' after a start is a signal;
//                     'declined' is recorded once per join as "not started",
//                     and nothing more.
//   student:snapshot  { jpeg } one low-resolution picture of the shared screen,
//                     at most one per interval (services/examGuard.js).
//   student:exam-consent  {} the phone has shown the consent notice (E5) after
//                     exam mode was turned on while it was already in the room.
//                     Until then nothing about it is recorded as an exam signal:
//                     a phone that joined an exam room showed the notice before
//                     joining, one already in the room when it was turned on had
//                     not.
//
// All three take an optional acknowledgement: { ok, reason?, message? }. Signals stay
// silent as they always were (integrity.js: telling a phone which reports land
// tells it what to suppress); a picture is acknowledged so a phone can shrink one
// that was too big, and learns nothing about any signal.
//
// To staff only, in the room's teacher room: teacher:integrity
//   { code, full, students: [{ rollNo, name?, summary?, snapshotAt? }], ... }
// full: true (on teacher:watch) lists every student who is not marked under 18,
// in roll order, with the room's exam summary and the honesty sentence; full:
// false carries the students that changed, and only the fields that changed
// (a picture moves `snapshotAt` alone). Never a picture's bytes, never to a
// phone or the projector.

import { config } from '../config.js';
import { getRepo } from '../repo/index.js';
import { hydrate } from '../services/mastery.js';
import { HONESTY, noteScreen, noteSnapshotMissing, summarise } from '../services/integrity.js';
import { minorRolls, signalsOff } from '../services/roster.js';
import {
  EXAM_PRIVACY,
  SCREEN_NEEDED,
  SEB_BEK_HEADER,
  SEB_HEADER,
  SEB_REFUSED,
  WHOLE_SCREEN,
  allowSignal,
  examModeOf,
  examSummary,
  handshakeUrl,
  phoneExamMode,
  sebCheck,
  snapshotFrom,
  snapshotOverdue,
  snapshots,
} from '../services/examGuard.js';

export { SCREEN_NEEDED };

/** What sockets/index.js lends this file: its lock, its session cache and its delete mark. */
let deps = {
  lockProfile: null,
  loadSession: null,
  roomDeleting: () => false,
};

const limits = new Map(); // `${sessionId}:${rollNo}` -> allowSignal's state
const minorCache = new Map(); // sessionId -> { at, rolls }
/** How long a room's under-18 list is reused for pictures before it is read again. */
const MINOR_CACHE_MS = 30000;
/** How often the live loop looks for overdue pictures, and how many looks between purges. */
export const TICK_MS = 5000;
const SWEEP_EVERY = 12;

const iso = (ms) => new Date(ms).toISOString();
const byRoll = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });

function logError(event, err) {
  console.error(`[exam] ${event} failed:`, err);
}

/* ------------------------------------------------------------------ join -- */

/**
 * The Safe Exam Browser values a join carried (SEB's JavaScript API), kept on the
 * phone's state so the check can be made again when the owner turns SEB on
 * later. Only the fields the check reads, each a short string.
 */
export function sebEvidence(payload) {
  const seb = payload?.seb;
  if (!seb || typeof seb !== 'object') return null;
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  return { url: str(seb.url, 2048), configKeyHash: str(seb.configKeyHash, 128), browserExamKeyHash: str(seb.browserExamKeyHash, 128) };
}

/**
 * Null when this phone may join, or the sentence that turns it away: a room that
 * requires Safe Exam Browser, joined from anything else. `seb` is what the join
 * carried (sebEvidence). The request's own address is the server's public one
 * when PUBLIC_ORIGIN is set, and a proxy's forwarded headers are believed only
 * with TRUST_PROXY=1 (services/examGuard.js handshakeUrl).
 */
export function examJoinRefusal(session, socket, seb) {
  const m = examModeOf(session);
  if (!m.on || !m.seb.required) return null;
  const hs = socket.handshake ?? {};
  const headers = hs.headers ?? {};
  const one = (v) => (Array.isArray(v) ? v[0] : v ?? null);
  const { ok } = sebCheck(m, {
    headerHash: one(headers[SEB_HEADER]),
    bekHeaderHash: one(headers[SEB_BEK_HEADER]),
    requestUrl: handshakeUrl(hs, { publicOrigin: config.publicOrigin, trustProxy: config.trustProxy }),
    origin: typeof headers.origin === 'string' ? headers.origin : null,
    api: seb ?? null,
    code: session.code,
  });
  return ok ? null : SEB_REFUSED;
}

/**
 * This phone's exam state for its socket, or null in a room without exam mode.
 * Who is under 18 is read fresh here (signalsOff: a failed read counts as under
 * 18, so nothing is asked of, or recorded about, a student it cannot rule out).
 * `before` keeps a share already started when the owner changes the setting,
 * and whether the phone has shown the consent notice: a phone joining an exam
 * room has (`consented`, the join), one in the room when exam mode is turned on
 * has not, until it says so (handleConsent).
 */
export async function examStateFor(repo, session, rollNo, before = null, { consented = false } = {}) {
  if (!examModeOf(session).on) return null;
  const minor = await signalsOff(repo, session, rollNo);
  return {
    minor,
    screen: before?.screen ?? 'none',
    screenAt: before?.screenAt ?? 0,
    // When this phone was last seen in an open room: pictures are due from here.
    ref: Date.now(),
    missingNoted: false,
    declinedNoted: before?.declinedNoted ?? false,
    consented: consented || before?.consented === true,
  };
}

/**
 * Are this phone's signals recorded as an exam room's? Only once it has shown
 * the consent notice. Until then the room records what any room records (the
 * older kinds, too-fast, second-socket), as before exam mode was turned on.
 */
export const examSignalsOn = (ctx) => Boolean(ctx?.exam?.consented);

/** session:accepted's additions: what to enforce, only in an exam room. */
export function examAccepted(session, exam) {
  return exam ? { examMode: phoneExamMode(session, { minor: exam.minor }) } : {};
}

/**
 * Must this answer wait for a screen share? In a screen-share room, for a phone
 * that has not shared its whole screen (or stopped), unless the roster marks the
 * student under 18. The answer is not taken; the phone keeps it and is told why
 * (exam:screen-needed), as a paused room tells it.
 *
 * The under-18 mark is the one read at the join, read again here before an
 * answer is held back: a professor who marks a student under 18 during the room
 * must not leave them asked to share their screen, which decision 8 never asks
 * of them. When the mark has changed, the phone is told what it is asked for now
 * (exam:mode).
 */
export async function examScreenBlocks(session, socket) {
  const ctx = socket?.data?.student;
  const m = examModeOf(session);
  if (!(m.on && m.screenShare && ctx?.exam && !ctx.exam.minor && ctx.exam.screen !== 'started')) return false;
  if (!(await signalsOff(getRepo(), session, ctx.rollNo))) return true;
  ctx.exam.minor = true;
  snapshots.forget(ctx.sessionId, ctx.rollNo);
  socket.emit('exam:mode', { examMode: phoneExamMode(session, { minor: true }) });
  return false;
}

/** May this student send one more signal now? Exam rooms only (services/examGuard.js SIGNAL_LIMIT). */
export function signalAllowed(ctx, kind, now = Date.now()) {
  const k = `${ctx.sessionId}:${ctx.rollNo}`;
  const state = limits.get(k) ?? {};
  limits.set(k, state);
  return allowSignal(state, kind, now);
}

/* ------------------------------------------------------------ staff feed -- */

/** One student's changed summary to the room's staff, in an exam room. */
export function pushIntegrity(io, session, profile) {
  if (!io || !session || !examModeOf(session).on) return;
  const p = hydrate(profile);
  const shot = snapshots.latest(session._id, p.rollNo);
  io.to(`teacher:${session.code}`).emit('teacher:integrity', {
    code: session.code,
    full: false,
    students: [{ rollNo: p.rollNo, name: p.name, summary: summarise(p), snapshotAt: shot ? iso(shot.at) : null }],
  });
}

/**
 * The whole room for a staff screen that has just started watching: every
 * student not marked under 18, in roll order. A failed read of the roster lists
 * nobody: who is under 18 cannot be told without it.
 */
export async function integrityFull(repo, session) {
  const head = { code: session.code, full: true, examMode: examSummary(session), honesty: HONESTY, privacy: EXAM_PRIVACY };
  let minors;
  try {
    minors = session.classId
      ? minorRolls(...(await Promise.all([repo.listClassStudents(session.classId), repo.listAttendance(session._id)])))
      : new Set();
  } catch (err) {
    logError('under-18 check', err);
    return { ...head, students: [] };
  }
  const profiles = (await repo.listProfiles(session._id)).map(hydrate).filter((p) => !minors.has(p.rollNo)).sort(byRoll);
  return {
    ...head,
    students: profiles.map((p) => {
      const shot = snapshots.latest(session._id, p.rollNo);
      return { rollNo: p.rollNo, name: p.name, summary: summarise(p), snapshotAt: shot ? iso(shot.at) : null };
    }),
  };
}

/**
 * A signal the server records about a phone (a share stopped or not started, a
 * picture missing), under the student's lock as every profile write is, never
 * for a student marked under 18, then pushed to staff.
 */
async function recordSignal(io, ctx, mutate) {
  const release = await deps.lockProfile(ctx.sessionId, ctx.rollNo);
  try {
    if (deps.roomDeleting(ctx.sessionId)) return false;
    const repo = getRepo();
    const stored = await repo.getProfile(ctx.sessionId, ctx.rollNo);
    if (!stored) return false;
    const profile = hydrate(stored);
    if (!mutate(profile)) return false;
    const session = await deps.loadSession(ctx.code);
    if (!session || (await signalsOff(repo, session, ctx.rollNo))) return false;
    await repo.saveProfile(profile);
    pushIntegrity(io, session, profile);
    return true;
  } finally {
    release();
  }
}

/* ---------------------------------------------------------- screen share -- */

export async function handleScreen(io, socket, payload, ack) {
  const reply = (body) => { if (typeof ack === 'function') ack(body); };
  try {
    const ctx = socket.data.student;
    if (!ctx?.exam || ctx.deliverOnly) return reply({ ok: false });
    const e = ctx.exam;
    // Nothing is asked of a student marked under 18, and nothing is recorded.
    if (e.minor) return reply({ ok: true, asked: false });
    const state = String(payload?.state ?? '');
    // The state changes before anything waits, so an answer sent straight after
    // a start (the same socket, in order) finds it.
    if (state === 'started') {
      if (payload?.surface !== 'monitor') {
        if (e.screen === 'started') e.screen = 'stopped';
        return reply({ ok: false, message: WHOLE_SCREEN });
      }
      e.screen = 'started';
      e.screenAt = Date.now();
      e.missingNoted = false;
      return reply({ ok: true });
    }
    if (state !== 'stopped' && state !== 'declined') return reply({ ok: false });
    const was = e.screen;
    e.screen = state;
    reply({ ok: true });
    const session = await deps.loadSession(ctx.code);
    if (!session || session.status === 'closed' || !examModeOf(session).screenShare) return undefined;
    // The share's state above is kept from the start; what it records waits
    // for the consent notice (examSignalsOn).
    if (!examSignalsOn(ctx)) return undefined;
    if (state === 'stopped') {
      if (was !== 'started' || !signalAllowed(ctx, 'screenshare_stopped')) return undefined;
      await recordSignal(io, ctx, (p) => noteScreen(p, 'screenshare_stopped'));
      return undefined;
    }
    // Declined: recorded once per join, and nothing more (decision E5).
    if (e.declinedNoted) return undefined;
    e.declinedNoted = true;
    await recordSignal(io, ctx, (p) => noteScreen(p, 'screenshare_not_started'));
  } catch (err) {
    logError('student:screen', err);
  }
  return undefined;
}

/* ---------------------------------------------------------------- pictures -- */

/** Is this roll number marked under 18? Reused for 30 seconds, for pictures only; a failed read says yes. */
async function minorNow(repo, session, rollNo) {
  if (!session.classId) return false;
  const id = String(session._id);
  const hit = minorCache.get(id);
  if (hit && Date.now() - hit.at < MINOR_CACHE_MS) return hit.rolls.has(String(rollNo));
  try {
    const [roster, marks] = await Promise.all([repo.listClassStudents(session.classId), repo.listAttendance(session._id)]);
    const rolls = minorRolls(roster, marks);
    minorCache.set(id, { at: Date.now(), rolls });
    return rolls.has(String(rollNo));
  } catch (err) {
    logError('under-18 check', err);
    return true;
  }
}

export async function handleSnapshot(io, socket, payload, ack) {
  const reply = (body) => { if (typeof ack === 'function') ack(body); };
  try {
    const ctx = socket.data.student;
    // A phone not asked for pictures may not send any: no exam mode, under 18,
    // a room without pictures, back only to deliver answers to a closed room, or
    // one that has not shown the consent notice yet.
    if (!ctx?.exam || ctx.exam.minor || ctx.deliverOnly || !examSignalsOn(ctx)) return reply({ ok: false, reason: 'not-asked' });
    const session = await deps.loadSession(ctx.code);
    if (!session || session.status === 'closed') return reply({ ok: false, reason: 'not-asked' });
    const m = examModeOf(session);
    if (!m.on || !m.screenShare || !m.snapshotSeconds) return reply({ ok: false, reason: 'not-asked' });
    if (ctx.exam.screen !== 'started') return reply({ ok: false, reason: 'not-sharing' });
    const now = Date.now();
    if (!snapshots.accepts(ctx.sessionId, ctx.rollNo, m.snapshotSeconds, now)) return reply({ ok: false, reason: 'too-soon' });
    const shot = snapshotFrom(payload?.jpeg);
    if (!shot.ok) return reply({ ok: false, reason: shot.reason });
    if (await minorNow(getRepo(), session, ctx.rollNo)) {
      ctx.exam.minor = true;
      snapshots.forget(ctx.sessionId, ctx.rollNo);
      return reply({ ok: false, reason: 'not-asked' });
    }
    // Noted as arrived either way; kept when the memory caps allow
    // (services/examGuard.js createSnapshotStore). One not kept is acknowledged
    // as 'full', so the laptop carries on sending at its interval.
    const kept = snapshots.put(ctx.sessionId, ctx.rollNo, shot.jpeg, now);
    ctx.exam.missingNoted = false;
    if (!kept) return reply({ ok: false, reason: 'full' });
    reply({ ok: true });
    io.to(`teacher:${session.code}`).emit('teacher:integrity', {
      code: session.code, full: false, students: [{ rollNo: ctx.rollNo, snapshotAt: iso(now) }],
    });
  } catch (err) {
    logError('student:snapshot', err);
    reply({ ok: false, reason: 'error' });
  }
  return undefined;
}

/* --------------------------------------------------------------- consent -- */

/**
 * student:exam-consent: the phone has shown the consent notice it was sent with
 * exam:mode. From now its exam signals are recorded. Acknowledged { ok }; false
 * outside an exam room.
 */
export function handleConsent(socket, ack) {
  const ctx = socket.data.student;
  const ok = Boolean(ctx?.exam);
  if (ok) ctx.exam.consented = true;
  if (typeof ack === 'function') ack({ ok });
}

/* ------------------------------------------------------------ the ticker -- */

/**
 * Look for pictures that are overdue (snapshot_missing), once per gap: the note
 * is not made again until a picture arrives. Only phones connected now, sharing,
 * in an open room that asks for pictures, and not marked under 18. A room that
 * is paused or waiting moves every phone's starting point on, so a resume is not
 * read as a gap. `now` is handed in so a test can run the clock forward.
 */
export async function examTick(io, now = Date.now()) {
  const byCode = new Map();
  for (const socket of io.sockets.sockets.values()) {
    const ctx = socket.data?.student;
    if (!ctx?.exam || ctx.deliverOnly || !socket.connected) continue;
    if (!byCode.has(ctx.code)) byCode.set(ctx.code, []);
    byCode.get(ctx.code).push(ctx);
  }
  for (const [code, list] of byCode) {
    const session = await deps.loadSession(code).catch(() => null);
    if (!session) continue;
    const m = examModeOf(session);
    if (!m.on || !m.screenShare || !m.snapshotSeconds) continue;
    if (session.status !== 'open') {
      for (const ctx of list) ctx.exam.ref = now;
      continue;
    }
    for (const ctx of list) {
      const e = ctx.exam;
      if (e.minor || e.screen !== 'started' || e.missingNoted || !examSignalsOn(ctx)) continue;
      // When the last picture arrived, kept or not: a picture the store had no
      // room for, or that a memory cap pushed out, was still sent on time.
      const last = snapshots.lastAt(ctx.sessionId, ctx.rollNo) ?? 0;
      const since = Math.max(e.ref ?? 0, e.screenAt ?? 0, last);
      if (!snapshotOverdue({ everySeconds: m.snapshotSeconds, since, now })) continue;
      e.missingNoted = true;
      await recordSignal(io, ctx, (p) => {
        noteSnapshotMissing(p, { everySeconds: m.snapshotSeconds, lastAt: last ? iso(last) : null });
        return true;
      }).catch((err) => logError('snapshot_missing', err));
    }
  }
  // Rate states nobody has used for ten minutes, and under-18 lists long stale.
  for (const [k, state] of limits) if (!state.seen || now - state.seen > 600000) limits.delete(k);
  for (const [id, hit] of minorCache) if (now - hit.at > 600000) minorCache.delete(id);
}

/** Purge the pictures of rooms closed two hours ago or more, or gone. `now` as above. */
export function sweepSnapshots(now = Date.now()) {
  return snapshots.sweep(now, (id) => getRepo().getSession(id));
}

/**
 * The owner changed a room's exam mode (routes/examGuard.js): every phone in it
 * is told what it must enforce now (exam:mode { examMode }, null when it was
 * turned off), its own under-18 mark read again. A phone that joined with exam
 * mode off has not shown the consent notice: nothing about it is recorded as an
 * exam signal until it says it has (handleConsent).
 *
 * When the room now requires Safe Exam Browser, each phone in it is checked as
 * a join is (with the values its join carried), and one that would be turned
 * away at the door is turned away now: told why (session:rejected) and
 * disconnected. Otherwise a phone that joined in an ordinary browser kept
 * answering until it happened to reconnect.
 */
export async function pushExamMode(io, session) {
  if (!io) return;
  const repo = getRepo();
  // The room's staff screens start again from the whole room (no student while
  // exam mode is off), so a console open before the change is not left behind.
  try {
    io.to(`teacher:${session.code}`).emit('teacher:integrity', examModeOf(session).on
      ? await integrityFull(repo, session)
      : { code: session.code, full: true, examMode: examSummary(session), students: [], honesty: HONESTY, privacy: EXAM_PRIVACY });
  } catch (err) {
    logError('teacher:integrity', err);
  }
  for (const socket of io.sockets.sockets.values()) {
    const ctx = socket.data?.student;
    if (!ctx || ctx.code !== session.code || ctx.deliverOnly) continue;
    try {
      ctx.exam = await examStateFor(repo, session, ctx.rollNo, ctx.exam);
      socket.emit('exam:mode', { examMode: ctx.exam ? phoneExamMode(session, { minor: ctx.exam.minor }) : null });
      const refusal = examJoinRefusal(session, socket, ctx.seb ?? null);
      if (refusal) {
        socket.emit('session:rejected', { reason: refusal });
        socket.disconnect(true);
      }
    } catch (err) {
      logError('exam:mode', err);
    }
  }
}

/**
 * The roster's under-18 mark on a student changed (routes/classes.js): every
 * phone of that roll number in a running exam room of that class is told at once
 * what it is asked for now (exam:mode), its exam state read again. Marked under
 * 18, nothing that watches is asked of the student any more, and their newest
 * picture goes. The room's under-18 list is read fresh for pictures too.
 */
export async function pushUnder18(io, classId, rollNo) {
  if (!io || !classId) return;
  const repo = getRepo();
  for (const socket of io.sockets.sockets.values()) {
    const ctx = socket.data?.student;
    if (!ctx?.exam || ctx.deliverOnly || String(ctx.rollNo) !== String(rollNo)) continue;
    try {
      const session = await deps.loadSession(ctx.code);
      if (!session || String(session.classId ?? '') !== String(classId)) continue;
      minorCache.delete(String(session._id));
      ctx.exam = await examStateFor(repo, session, ctx.rollNo, ctx.exam);
      if (ctx.exam?.minor) snapshots.forget(ctx.sessionId, ctx.rollNo);
      socket.emit('exam:mode', { examMode: ctx.exam ? phoneExamMode(session, { minor: ctx.exam.minor }) : null });
    } catch (err) {
      logError('exam:mode', err);
    }
  }
}

const started = new WeakSet();

/**
 * Wire exam mode into one Socket.io server: the lent helpers, and the ticker
 * (unref'd, so it never holds a process open). Called by attachSockets.
 */
export function startExamGuard(io, lent) {
  deps = { ...deps, ...lent };
  if (started.has(io)) return;
  started.add(io);
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
    examTick(io).catch((err) => logError('tick', err));
    if (ticks % SWEEP_EVERY === 0) sweepSnapshots().catch((err) => logError('sweep', err));
  }, TICK_MS);
  timer.unref?.();
}
