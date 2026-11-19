// Phase 3 - the teacher-record store, under /api/session/:code/...
//
//   observations        GET, POST   a professor's private mark on a student, per day
//   wheel               GET, PATCH  the wheel: the round in force, its settings, every pick
//   wheel/draw          POST        draw the next student (on the server, crypto randomness)
//   wheel/rounds        POST        start a new round; earlier picks stay
//   wheel/picks/:id     PATCH       what the pick was asked, and how they responded
//   tallies             GET, POST   raised hands per option for a question asked aloud
//   tallies/:id         PATCH       edit; set the counts; reveal
//   tallies/:id/increment, /decrement   POST, never below 0
//   activities          GET, POST   the no-device activities run in the room
//   activities/:id      PATCH
//   insights/actions    GET, POST   what a professor did about a flag (append-only)
//
// Mounted at /api/session AFTER the room router (app.js), with requireTeacher on
// every route rather than at the mount: GET /api/session/:code is the phones'
// own route and must stay open. Every path here is two segments or more, so it
// can never answer for that one.
//
// Who: the read rule (ownership.js) for reads, so an HOD reads the department's
// records; the write rule for writes, so an HOD gets 403. A room the caller may
// not read is the same 404 as one that does not exist, word for word.
//
// Staff-only, all of it: nothing here is sent to a phone (no socket event to a
// student's room, nothing in GET /api/session/:code) or to the projector, and
// none of it moves a Bloom level or touches accuracy. The one exception is the
// projector's: a draw puts the pick up as a roll number and a first name, and a
// question asked aloud may be put up by the professor, never its hands
// (services/projector.js). A room opened for a class works from its roster, so
// every record here works with no phone joined.
//
// Phase 7 (an offline console): every write here may carry a replay key, which
// routes/recordSync.js, mounted ahead of this router, honours; and a write that
// replaces a mark (an observation, a pick's response, a tally or activity edit,
// an insight action) may say what it was made from, `basedOn`, and is refused
// with 409 if that has moved on (services/recordSync.js). Without either, as
// before.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { lockProfile, roomDeleting, broadcastGrid } from '../sockets/index.js';
import { servableFor } from '../services/selector.js';
import { sessionSettings } from '../services/mastery.js';
import { pushProjector, showPick } from '../services/projector.js';
import { scheduleInsights } from '../services/insights.js';
import { ATTENDANCE_LOCK, markRollNo } from '../services/roster.js';
import {
  ACTIVITY_KINDS,
  GROUP_RESULTS,
  MAX_HANDS,
  OBSERVATION_KINDS,
  RECORDS_LOCK,
  STAFF_ONLY,
  activityKindFrom,
  activityView,
  correctFrom,
  countsFrom,
  currentObservation,
  flagIdFrom,
  groupsFrom,
  insightActionFrom,
  insightActionView,
  labelsFrom,
  laterThan,
  nextSeq,
  noteFrom,
  observationKindFrom,
  observationReport,
  observationSubject,
  observationView,
  optionIndex,
  presentCount,
  questionTextFrom,
  roomDay,
  roomPeople,
  tallyDefaultsFrom,
  tallyView,
} from '../services/records.js';
import {
  basedOnFields,
  basedOnTime,
  changedSentence,
  insightSentence,
  insightStale,
  movedFields,
  observationSentence,
  observationStale,
  staleReply,
} from '../services/recordSync.js';
import {
  DEFAULT_SETTINGS,
  askFrom,
  drawFrom,
  emptyWheelReason,
  pickStatusFrom,
  settingsFrom,
  wheelPool,
  wheelState,
} from '../services/wheel.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------- the room --

async function findRoom(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  return code ? getRepo().getSessionByCode(code) : null;
}

/** A room the caller may read, or the one 404 for "not there" and "not yours". */
const readRoom = async (code, viewer) => assertCanRead(viewer, await findRoom(code), 'That room');

/** A room the caller may change: 404 as above, 403 for an HOD who may only read it. */
const writeRoom = async (code, viewer) => assertCanWrite(viewer, await findRoom(code), 'That room');

const roomView = (session) => ({
  code: session.code,
  title: session.title ?? '',
  startedAt: session.startedAt ?? null,
  status: session.status,
  classId: session.classId ?? null,
});

/** The roster, attendance and joined phones, and everyone the room can call on (roomPeople). */
async function roomContext(session) {
  const repo = getRepo();
  const [roster, marks, profiles] = await Promise.all([
    session.classId ? repo.listClassStudents(session.classId) : [],
    session.classId ? repo.listAttendance(session._id) : [],
    repo.listProfiles(session._id),
  ]);
  return { roster, marks, profiles, people: roomPeople({ session, roster, marks, profiles }) };
}

/**
 * Every record write in a room, one at a time, under the room's records lock,
 * which a room delete waits out (routes/session.js) before it reads the room
 * into its archive. Refused while the room is being deleted: a record landing
 * after the archive was read would be deleted with the room and kept nowhere.
 * And refused, as not found, if the delete finished while this waited for the
 * lock: the room read before waiting is gone, and a record written to it would
 * belong to nothing.
 */
async function withRecordsLock(session, fn) {
  const release = await lockProfile(session._id, RECORDS_LOCK);
  try {
    if (roomDeleting(session._id)) throw fail('That room is being deleted. Nothing was changed.', 409);
    if (!(await getRepo().getSession(session._id))) throw fail('That room was not found.', 404);
    return await fn();
  } finally {
    release();
  }
}

/** Session id -> room code, for the rooms a list of records was written in. */
async function roomCodes(records, session) {
  const out = new Map([[String(session._id), session.code]]);
  for (const id of new Set(records.map((r) => String(r.sessionId)))) {
    if (!out.has(id)) out.set(id, (await getRepo().getSession(id))?.code ?? null);
  }
  return out;
}

/** The room's approved questions (its set's, when it has one): what a bank ask or a tally may name. */
async function servable(session) {
  return servableFor(session, await getRepo().listQuestions(session.contentId));
}

const sameId = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

const viewerId = (req) => req.viewer?.id ?? null;

/**
 * After a record is written. A Mixed or Teacher-led room's teacher grid carries
 * a count of its records beside the digital answers (feed, services/modes.js),
 * so every teacher screen watching it is pushed the new grid; a Student-devices
 * room's grid has no feed and is left alone, as before. With `projector`, the
 * wall is pushed too: a pick or a question asked aloud may be on it. Neither
 * push can fail the write it follows.
 */
async function afterRecord(req, session, { grid = false, projector = false } = {}) {
  const io = req.app.get('io');
  if (!io) return;
  if (grid || sessionSettings(session).mode !== 'devices') {
    await broadcastGrid(io, session).catch((err) => console.error('[records] grid push failed:', err));
  }
  if (projector) await pushProjector(io, getRepo(), session);
}

// --------------------------------------------------------- observations --

/**
 * Every event of one student's day, oldest first. In a class room the day is
 * the class's: a mark set in another of its rooms that day is the same mark.
 */
async function slotEvents(session, subject, day) {
  const repo = getRepo();
  if (subject.classStudentId) return repo.listObservations({ classStudentId: subject.classStudentId, day });
  return (await repo.listObservations({ sessionId: session._id })).filter((o) => o.rollNo === subject.rollNo && o.day === day);
}

/**
 * Every student's mark for the room's day, with the events behind it and the
 * counts per kind. Read rule. A room opened for a class lists its roster.
 */
router.get('/:code/observations', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    const repo = getRepo();
    const day = roomDay(session);
    const [cls, ctx, events] = await Promise.all([
      session.classId ? repo.getClass(session.classId) : null,
      roomContext(session),
      session.classId
        ? repo.listObservations({ classId: session.classId, day })
        : repo.listObservations({ sessionId: session._id }),
    ]);
    res.json({
      room: roomView(session),
      class: cls ? { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' } : null,
      day,
      kinds: OBSERVATION_KINDS,
      ...observationReport({ session, roster: ctx.roster, profiles: ctx.profiles, events, rooms: await roomCodes(events, session) }),
      privacy: STAFF_ONLY,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Set or clear one student's mark for the room's day: { studentId | rollNo,
 * kind: understood | participated | revision | support | null, note? }.
 *
 * One mark per student per class per day: setting one replaces the day's mark,
 * and `kind: null` clears it. Every set and clear is a new row (append-only), so
 * the mark replaced stays in the day's `history`. The same mark and note again
 * writes nothing (`changed: false`). Write rule. Allowed on a closed room: a
 * professor often fills these in after the class.
 */
router.post('/:code/observations', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    if (!('kind' in body)) {
      throw fail('kind is required: understood, participated, revision or support, or null to clear the mark.', 400);
    }
    const kind = observationKindFrom(body.kind);
    const note = noteFrom(body.note);
    if (kind === null && note) throw fail('A cleared mark carries no note: send kind null without one.', 400);
    const basedOn = basedOnTime(body.basedOn);
    const day = roomDay(session);

    const out = await withRecordsLock(session, async () => {
      const { roster, profiles } = await roomContext(session);
      const subject = observationSubject({ session, roster, profiles, body });
      const events = await slotEvents(session, subject, day);
      const before = currentObservation(events);
      const same = kind === null ? !before : Boolean(before) && before.kind === kind && (before.note ?? '') === note;
      if (same) return { subject, events, before, changed: false };
      // Phase 7: made from another mark than the one in force now (basedOn).
      if (observationStale(before, basedOn)) return { subject, events, before, stale: true };
      const made = await getRepo().addObservation({
        sessionId: String(session._id),
        classId: session.classId ?? null,
        classStudentId: subject.classStudentId,
        rollNo: subject.rollNo,
        day,
        kind,
        note,
        observedBy: viewerId(req),
        observedAt: laterThan(events.at(-1)?.observedAt),
      });
      return { subject, events: [...events, made], before, changed: true };
    });

    if (out.changed) await afterRecord(req, session);
    const rooms = await roomCodes(out.events, session);
    const current = currentObservation(out.events);
    const student = { studentId: out.subject.classStudentId, rollNo: out.subject.rollNo, name: out.subject.name };
    if (out.stale) {
      // As a success reads (student, day, current, history), with the sentence.
      const labelOf = (k) => OBSERVATION_KINDS.find((x) => x.id === k)?.label ?? k;
      return res.status(409).json(staleReply(
        observationSentence(out.subject.name, out.before, out.events.at(-1), labelOf),
        current ? observationView(current, rooms) : null,
        { student, day, history: out.events.map((e) => observationView(e, rooms)), privacy: STAFF_ONLY },
      ));
    }
    res.json({
      changed: out.changed,
      student,
      day,
      current: current ? observationView(current, rooms) : null,
      replaced: out.changed && out.before ? observationView(out.before, rooms) : null,
      history: out.events.map((e) => observationView(e, rooms)),
      privacy: STAFF_ONLY,
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- wheel --

/** The bank questions some pick names, by id, for the pick's text and level. */
async function pickQuestions(session, picks) {
  if (!picks.some((p) => p.questionId)) return new Map();
  const bank = await getRepo().listQuestions(session.contentId, { includeDiscarded: true });
  return new Map(bank.map((q) => [String(q._id), q]));
}

async function wheelBody(session, ctx = null) {
  const repo = getRepo();
  const [{ people }, rounds, picks] = await Promise.all([
    ctx ?? roomContext(session),
    repo.listWheelRounds(session._id),
    repo.listWheelPicks(session._id),
  ]);
  return {
    room: roomView(session),
    ...wheelState({ session, rounds, picks, people, questions: await pickQuestions(session, picks) }),
    privacy: STAFF_ONLY,
  };
}

/** The wheel draws only in a room still running: there is nobody to call on in a closed one. */
function assertRunning(session) {
  if (session.status === 'closed') {
    throw fail('That room is closed: the wheel draws only while a room is open or paused. Its picks can still be filled in.', 409);
  }
}

/**
 * The round in force, made if there is none yet (round 1), with these settings
 * applied. Under the records lock.
 */
async function roundInForce(session, settings, startedBy) {
  const repo = getRepo();
  const round = (await repo.listWheelRounds(session._id)).at(-1);
  if (!round) {
    return repo.addWheelRound({
      sessionId: String(session._id),
      round: 1,
      ...DEFAULT_SETTINGS,
      ...settings,
      startedAt: new Date().toISOString(),
      startedBy,
    });
  }
  if (Object.entries(settings).some(([k, v]) => round[k] !== v)) {
    return (await repo.updateWheelRound(round._id, settings)) ?? round;
  }
  return round;
}

/** The round in force, its settings, who is on the wheel ("N picked of M"), and every pick. Read rule. */
router.get('/:code/wheel', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json(await wheelBody(session));
  } catch (err) {
    next(err);
  }
});

/** Change the round's settings: { presentOnly?, noRepeat? }. */
router.patch('/:code/wheel', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    assertRunning(session);
    const settings = settingsFrom(req.body);
    if (!Object.keys(settings).length) throw fail('Send presentOnly or noRepeat to change.', 400);
    await withRecordsLock(session, () => roundInForce(session, settings, viewerId(req)));
    res.json(await wheelBody(session));
  } catch (err) {
    next(err);
  }
});

/**
 * Draw the next student. The server picks, with crypto randomness, from
 * everyone on the wheel, and stores the pick before answering, so a screen's
 * spin only ever shows a choice already made. { presentOnly?, noRepeat? } change
 * the round's settings first. 409 when the wheel is empty, with the reason.
 */
router.post('/:code/wheel/draw', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    assertRunning(session);
    const settings = settingsFrom(req.body);
    const repo = getRepo();

    const { made, ctx } = await withRecordsLock(session, async () => {
      const round = await roundInForce(session, settings, viewerId(req));
      const [context, picks] = await Promise.all([roomContext(session), repo.listWheelPicks(session._id)]);
      const thisRound = picks.filter((p) => p.round === round.round);
      const pool = wheelPool(context.people, { presentOnly: round.presentOnly, noRepeat: round.noRepeat, pickedThisRound: thisRound });
      if (!pool.left) throw fail(emptyWheelReason({ session, presentOnly: round.presentOnly, pool }), 409);
      const chosen = drawFrom(pool.eligible);
      const pick = await repo.addWheelPick({
        sessionId: String(session._id),
        round: round.round,
        order: thisRound.length + 1,
        rollNo: chosen.rollNo,
        classStudentId: chosen.classStudentId,
        poolSize: pool.left,
        presentOnly: round.presentOnly,
        noRepeat: round.noRepeat,
        ask: 'bank',
        questionId: null,
        status: 'pending',
        pickedAt: new Date().toISOString(),
        pickedBy: viewerId(req),
      });
      return { made: pick, ctx: context };
    });

    // The pick goes up on the projector as a roll number and a first name
    // (services/projector.js), as the handoff's projector shows who answers.
    showPick(session, made._id);
    await afterRecord(req, session, { projector: true });
    const body = await wheelBody(session, ctx);
    res.status(201).json({ pick: body.picks.find((p) => p.id === String(made._id)) ?? null, ...body });
  } catch (err) {
    next(err);
  }
});

/**
 * "Start new round": the next round, with { presentOnly?, noRepeat? } or the
 * last round's settings. Nothing is deleted; every earlier pick stays.
 */
router.post('/:code/wheel/rounds', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    assertRunning(session);
    const settings = settingsFrom(req.body);
    const repo = getRepo();
    await withRecordsLock(session, async () => {
      const last = (await repo.listWheelRounds(session._id)).at(-1);
      return repo.addWheelRound({
        sessionId: String(session._id),
        round: (last?.round ?? 0) + 1,
        presentOnly: settings.presentOnly ?? last?.presentOnly ?? DEFAULT_SETTINGS.presentOnly,
        noRepeat: settings.noRepeat ?? last?.noRepeat ?? DEFAULT_SETTINGS.noRepeat,
        startedAt: new Date().toISOString(),
        startedBy: viewerId(req),
      });
    });
    res.status(201).json(await wheelBody(session));
  } catch (err) {
    next(err);
  }
});

/**
 * "Absent" on a pick, carried into attendance: the student's mark in this room
 * becomes absent, as the professor's. Only in a class room, for a student on its
 * roster now; otherwise the reply says why nothing was marked. Under the
 * attendance lock as well, which POST /:code/attendance takes too (always after
 * the records lock, so the two never wait on each other).
 */
async function markPickAbsent(session, pick, markedBy) {
  if (!session.classId) {
    return { marked: false, reason: 'This room was opened for no class, so it has no attendance to mark.' };
  }
  if (!pick.classStudentId) {
    return { marked: false, reason: `${pick.rollNo} is not on the class roster, so has no attendance to mark.` };
  }
  const repo = getRepo();
  const release = await lockProfile(session._id, ATTENDANCE_LOCK);
  try {
    const [roster, marks] = await Promise.all([repo.listClassStudents(session.classId), repo.listAttendance(session._id)]);
    const student = roster.find((s) => String(s._id) === String(pick.classStudentId) && !s.removedAt);
    if (!student) {
      return { marked: false, reason: `${pick.rollNo} has been removed from the roster, so has no attendance to mark.` };
    }
    await repo.saveAttendance([{
      sessionId: String(session._id),
      classStudentId: String(student._id),
      status: 'absent',
      source: 'teacher',
      markedAt: new Date().toISOString(),
      markedBy,
      rollNo: markRollNo(marks, roster)(student._id),
    }]);
    return { marked: true, status: 'absent', studentId: String(student._id) };
  } finally {
    release();
  }
}

/**
 * Fill in a pick: { ask?: bank | diagram | demo, questionId?, status?:
 * answered | passed | help | skipped | absent, markAttendance? }.
 *
 * questionId names one of the room's approved questions, and only for a bank
 * ask. Who was drawn, from how many and when are written once and cannot be
 * changed. `status: absent` also marks the student absent in this room's
 * attendance, unless `markAttendance: false` (docs/PRODUCT_DECISIONS.md).
 * Allowed on a closed room: picks are often filled in after the class.
 */
router.patch('/:code/wheel/picks/:pickId', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    if (body.ask === undefined && body.questionId === undefined && body.status === undefined) {
      throw fail('Send ask, questionId or status to change.', 400);
    }
    if (body.markAttendance !== undefined && typeof body.markAttendance !== 'boolean') {
      throw fail('markAttendance must be true or false.', 400);
    }
    const status = body.status === undefined ? undefined : pickStatusFrom(body.status);
    const basedOn = basedOnFields(body.basedOn, ['ask', 'questionId', 'status']);
    const repo = getRepo();

    const { pick, attendance, stale } = await withRecordsLock(session, async () => {
      const current = (await repo.listWheelPicks(session._id)).find((p) => sameId(p._id, req.params.pickId));
      if (!current) throw fail('That pick was not found.', 404);
      const wantsQuestion = body.questionId !== undefined && body.questionId !== null;
      const patch = askFrom(body, { current, servable: wantsQuestion ? await servable(session) : [] });
      // Phase 7: what this write sets, against the pick as the screen showed it
      // (basedOn) and as it is now. Ids compared in any case, as sameId does.
      const id = (v) => (v === undefined || v === null ? null : String(v).trim().toLowerCase());
      const wanted = {};
      if (body.ask !== undefined) wanted.ask = patch.ask;
      if (body.questionId !== undefined) wanted.questionId = id(patch.questionId);
      if (status !== undefined) wanted.status = status;
      const seen = basedOn && { ...basedOn, ...('questionId' in basedOn ? { questionId: id(basedOn.questionId) } : {}) };
      if (movedFields(seen, { ask: current.ask, questionId: id(current.questionId), status: current.status }, wanted).length) {
        return { pick: current, attendance: null, stale: true };
      }
      if (status !== undefined && status !== current.status) {
        Object.assign(patch, { status, statusAt: laterThan(current.statusAt), statusBy: viewerId(req) });
      }
      const changed = Object.keys(patch).some((k) => patch[k] !== current[k]);
      const updated = changed ? ((await repo.updateWheelPick(current._id, patch)) ?? current) : current;
      const marked = status === 'absent' && body.markAttendance !== false
        ? await markPickAbsent(session, updated, viewerId(req))
        : null;
      return { pick: updated, attendance: marked };
    });

    if (stale) {
      const view = (await wheelBody(session)).picks.find((p) => p.id === String(pick._id)) ?? null;
      // No time: a pick keeps one for its response only, not for what was asked.
      return res.status(409).json(staleReply(changedSentence('This pick', null, view?.statusLabel), view, { privacy: STAFF_ONLY }));
    }

    // The present count on every teacher screen watching the room, and a Mixed
    // or Teacher-led room's feed.
    await afterRecord(req, session, { grid: Boolean(attendance?.marked) });

    const wheel = await wheelBody(session);
    res.json({
      pick: wheel.picks.find((p) => p.id === String(pick._id)) ?? null,
      ...(attendance ? { attendance } : {}),
      privacy: STAFF_ONLY,
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- tallies --

/** A tally of this room, by id, or the one 404. */
async function roomTally(session, rawId) {
  const t = (await getRepo().listTallies(session._id)).find((x) => sameId(x._id, rawId));
  if (!t) throw fail('That tally was not found.', 404);
  return t;
}

/** Every question asked aloud in the room, in order, with "N of M present responded". Read rule. */
router.get('/:code/tallies', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    const [{ people }, tallies] = await Promise.all([roomContext(session), getRepo().listTallies(session._id)]);
    const present = presentCount(people);
    res.json({ room: roomView(session), present, tallies: tallies.map((t) => tallyView(t, present)), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

/**
 * Record a question asked aloud: { text } or { questionId } of the room's bank
 * (or both), and optionally labels for A to D, the correct option, counts and
 * revealed. A bank mcq brings its own text, options and key unless they are
 * sent. Its text is always stored, so a later edit of the bank does not change
 * what was asked.
 */
router.post('/:code/tallies', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    let question = null;
    if (body.questionId !== undefined && body.questionId !== null) {
      question = (await servable(session)).find((q) => sameId(q._id, body.questionId)) ?? null;
      if (!question) throw fail('questionId is not a question this room serves: pick one of its approved questions, or send text.', 400);
    }
    const defaults = question ? tallyDefaultsFrom(question) : null;
    const text = questionTextFrom(body.text, { required: !question }) ?? defaults.text;
    if (!text) throw fail('That question has no text to record: send text.', 400);
    if (body.revealed !== undefined && typeof body.revealed !== 'boolean') throw fail('revealed must be true or false.', 400);
    const doc = {
      sessionId: String(session._id),
      questionId: question ? String(question._id) : null,
      text,
      labels: body.labels !== undefined ? labelsFrom(body.labels) : (defaults?.labels ?? ['', '', '', '']),
      counts: body.counts !== undefined ? countsFrom(body.counts) : [0, 0, 0, 0],
      revealed: body.revealed === true,
      correct: body.correct !== undefined ? correctFrom(body.correct) : (defaults?.correct ?? null),
      createdBy: viewerId(req),
    };
    const repo = getRepo();
    const made = await withRecordsLock(session, async () => {
      const now = new Date().toISOString();
      return repo.addTally({ ...doc, seq: nextSeq(await repo.listTallies(session._id)), createdAt: now, updatedAt: now });
    });
    await afterRecord(req, session);
    const { people } = await roomContext(session);
    res.status(201).json({ tally: tallyView(made, presentCount(people)), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

/** A tally edit's fields off a body, checked; also what the screen showed (basedOn), in the same form. */
function tallyFields(body) {
  const patch = {};
  if (body.text !== undefined) patch.text = questionTextFrom(body.text, { required: true });
  if (body.labels !== undefined) patch.labels = labelsFrom(body.labels);
  if (body.counts !== undefined) patch.counts = countsFrom(body.counts);
  if (body.correct !== undefined) patch.correct = correctFrom(body.correct);
  if (body.revealed !== undefined) {
    if (typeof body.revealed !== 'boolean') throw fail('revealed must be true or false.', 400);
    patch.revealed = body.revealed;
  }
  return patch;
}

/** Edit a tally: { text?, labels?, counts?, revealed?, correct? }. Counts are whole numbers of 0 or more. */
router.patch('/:code/tallies/:tallyId', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    const patch = tallyFields(body);
    if (!Object.keys(patch).length) throw fail('Send text, labels, counts, revealed or correct to change.', 400);
    const basedOn = basedOnFields(body.basedOn, ['text', 'labels', 'counts', 'revealed', 'correct']);
    const shown = basedOn && tallyFields(basedOn);
    const repo = getRepo();
    const { updated, stale } = await withRecordsLock(session, async () => {
      const t = await roomTally(session, req.params.tallyId);
      // Phase 7: a field this edit sets that changed since the screen showed it (basedOn).
      const now = {
        text: t.text,
        labels: t.labels ?? ['', '', '', ''],
        counts: (Array.isArray(t.counts) ? t.counts : [0, 0, 0, 0]).map(Number),
        revealed: t.revealed === true,
        correct: Number.isInteger(t.correct) ? t.correct : null,
      };
      if (movedFields(shown, now, patch).length) return { updated: t, stale: true };
      return { updated: (await repo.updateTally(t._id, { ...patch, updatedAt: laterThan(t.updatedAt) })) ?? t };
    });
    if (stale) {
      const { people } = await roomContext(session);
      return res.status(409).json(staleReply(changedSentence('This question\'s tally', updated.updatedAt),
        tallyView(updated, presentCount(people)), { privacy: STAFF_ONLY }));
    }
    // Its text or options may be on the projector.
    await pushProjector(req.app.get('io'), repo, session);
    const { people } = await roomContext(session);
    res.json({ tally: tallyView(updated, presentCount(people)), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

/**
 * One more or one fewer hand for an option: { option: A | B | C | D }. A count
 * never goes below 0: a decrement at 0 changes nothing and says so
 * (`clamped: true`).
 */
async function stepTally(req, res, next, step) {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const i = optionIndex(req.body?.option);
    const repo = getRepo();
    const { tally, clamped } = await withRecordsLock(session, async () => {
      const t = await roomTally(session, req.params.tallyId);
      const counts = (Array.isArray(t.counts) ? t.counts : [0, 0, 0, 0]).map(Number);
      if (step < 0 && counts[i] <= 0) return { tally: t, clamped: true };
      if (step > 0 && counts[i] >= MAX_HANDS) throw fail(`Option ${'ABCD'[i]} already has ${MAX_HANDS} hands.`, 400);
      counts[i] = Math.max(0, counts[i] + step);
      return { tally: (await repo.updateTally(t._id, { counts, updatedAt: laterThan(t.updatedAt) })) ?? t, clamped: false };
    });
    const { people } = await roomContext(session);
    res.json({ tally: tallyView(tally, presentCount(people)), clamped, privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
}

router.post('/:code/tallies/:tallyId/increment', requireTeacher, (req, res, next) => stepTally(req, res, next, 1));
router.post('/:code/tallies/:tallyId/decrement', requireTeacher, (req, res, next) => stepTally(req, res, next, -1));

// ------------------------------------------------------------ activities --

/** A tally id an activity may point at: a quick check's, of this room. */
async function activityTally(session, kind, raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (kind !== 'check') throw fail('Only a quick knowledge check points at a tally.', 400);
  const t = (await getRepo().listTallies(session._id)).find((x) => sameId(x._id, raw));
  if (!t) throw fail('tallyId is not a tally of this room.', 400);
  return String(t._id);
}

/** Groups for this kind: only a group challenge records them. */
function activityGroups(kind, raw) {
  if (raw === undefined) return undefined;
  const groups = groupsFrom(raw);
  if (groups.length && kind !== 'group') throw fail('Only a group challenge records groups.', 400);
  return groups;
}

/** Every activity run in the room, in order. Read rule. */
router.get('/:code/activities', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    const activities = await getRepo().listActivities(session._id);
    res.json({
      room: roomView(session),
      kinds: ACTIVITY_KINDS,
      results: GROUP_RESULTS,
      activities: activities.map(activityView),
      privacy: STAFF_ONLY,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Record an activity run: { kind: check | think | group | diagram | real,
 * outcome?, groups?, tallyId? }. A group challenge records groups, never
 * students: groups is [{ label, gotIt: yes | partly | no }]. A quick check may
 * point at the tally that recorded it.
 */
router.post('/:code/activities', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    const kind = activityKindFrom(body.kind);
    const outcome = noteFrom(body.outcome, 'outcome');
    const groups = activityGroups(kind, body.groups) ?? [];
    const repo = getRepo();
    const made = await withRecordsLock(session, async () => {
      const tallyId = (await activityTally(session, kind, body.tallyId)) ?? null;
      const now = new Date().toISOString();
      return repo.addActivity({
        sessionId: String(session._id),
        seq: nextSeq(await repo.listActivities(session._id)),
        kind,
        outcome,
        groups,
        tallyId,
        createdAt: now,
        createdBy: viewerId(req),
        updatedAt: now,
      });
    });
    await afterRecord(req, session);
    res.status(201).json({ activity: activityView(made), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

/** Change an activity's outcome, groups or tally. Its kind is what was run, and stays. */
router.patch('/:code/activities/:activityId', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const body = req.body ?? {};
    if (body.outcome === undefined && body.groups === undefined && body.tallyId === undefined) {
      throw fail('Send outcome, groups or tallyId to change.', 400);
    }
    // Phase 7: the activity as the screen showed it, in the form it is stored in.
    const id = (v) => (v === undefined || v === null ? null : String(v).trim().toLowerCase());
    const basedOn = basedOnFields(body.basedOn, ['outcome', 'groups', 'tallyId']);
    const shown = basedOn && {
      ...('outcome' in basedOn ? { outcome: noteFrom(basedOn.outcome, 'outcome') } : {}),
      ...('groups' in basedOn ? { groups: groupsFrom(basedOn.groups) } : {}),
      ...('tallyId' in basedOn ? { tallyId: id(basedOn.tallyId) } : {}),
    };
    const repo = getRepo();
    const { updated, stale } = await withRecordsLock(session, async () => {
      const a = (await repo.listActivities(session._id)).find((x) => sameId(x._id, req.params.activityId));
      if (!a) throw fail('That activity was not found.', 404);
      const patch = {};
      if (body.outcome !== undefined) patch.outcome = noteFrom(body.outcome, 'outcome');
      if (body.groups !== undefined) patch.groups = activityGroups(a.kind, body.groups);
      if (body.tallyId !== undefined) patch.tallyId = await activityTally(session, a.kind, body.tallyId);
      const now = { outcome: a.outcome ?? '', groups: Array.isArray(a.groups) ? a.groups : [], tallyId: id(a.tallyId) };
      if (movedFields(shown, now, { ...patch, ...('tallyId' in patch ? { tallyId: id(patch.tallyId) } : {}) }).length) {
        return { updated: a, stale: true };
      }
      return { updated: (await repo.updateActivity(a._id, { ...patch, updatedAt: laterThan(a.updatedAt) })) ?? a };
    });
    if (stale) {
      return res.status(409).json(staleReply(changedSentence('This activity', updated.updatedAt), activityView(updated), { privacy: STAFF_ONLY }));
    }
    res.json({ activity: activityView(updated), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------ insight actions --

/** What was done about each flag in the room, oldest first. Read rule. */
router.get('/:code/insights/actions', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    const actions = await getRepo().listInsightActions(session._id);
    res.json({ room: roomView(session), actions: actions.map(insightActionView), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

/**
 * A professor dismissed or acted on a flag: { flagId, action: dismissed |
 * acted, note? }. Append-only: a later action is a new row, never an edit, so a
 * flag can always show what was done about it and when.
 */
router.post('/:code/insights/actions', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const flagId = flagIdFrom(req.body?.flagId);
    const action = insightActionFrom(req.body?.action);
    const note = noteFrom(req.body?.note);
    const basedOn = basedOnTime(req.body?.basedOn);
    const repo = getRepo();
    const { made, stale } = await withRecordsLock(session, async () => {
      const actions = await repo.listInsightActions(session._id);
      const last = actions.at(-1);
      // Phase 7: another action on this card since the screen showed its last
      // one (basedOn), and not this same action: the latest action is in force.
      const onCard = actions.filter((a) => a.flagId === flagId).at(-1);
      if (insightStale(onCard, basedOn, action)) return { made: onCard, stale: true };
      return {
        made: await repo.addInsightAction({
          sessionId: String(session._id),
          flagId,
          action,
          note,
          actedBy: viewerId(req),
          actedAt: laterThan(last?.actedAt),
        }),
      };
    });
    if (stale) {
      return res.status(409).json(staleReply(insightSentence(made), insightActionView(made), { privacy: STAFF_ONLY }));
    }
    // A dismissal hides the card on every teacher screen watching the room, at
    // the next insights push (services/insights.js); never sent anywhere else.
    scheduleInsights(req.app.get('io'), repo, session);
    res.status(201).json({ action: insightActionView(made), privacy: STAFF_ONLY });
  } catch (err) {
    next(err);
  }
});

export default router;
