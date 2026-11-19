// F4 - the room. Opening a session, reading it back, and the teacher grid.
//
// `buildGridRow` is exported and is also what ../sockets/index.js broadcasts,
// so the REST grid and the live grid are one code path and cannot drift. That
// is also why this file and the socket file import each other: they are two
// halves of one feature, and the online-presence map has exactly one owner
// (the socket file, which is the only place that learns a socket has dropped).

import express from 'express';
import crypto from 'node:crypto';

import { LEVELS } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import {
  hydrate,
  isSlowLearner,
  totals,
  countedTotals,
  masteredLevels,
  masteryBasis,
  levelEvidence,
  nextStep,
  sessionSettings,
  MASTERY_GOALS,
  MAX_REATTEMPTS,
  DEFAULT_MASTERY_GOAL,
  REDEMPTION_RULE,
  ROOM_MODES,
  QUESTIONS_PER_STUDENT,
  TIME_PER_QUESTION,
} from '../services/mastery.js';
import { summarise, HONESTY } from '../services/integrity.js';
import { ARCHIVE_LIMIT_BYTES, buildRoomArchive, servedArchive } from '../services/archive.js';
import { answerItem, pageFrom, rollKey, roomTopics } from '../services/evidence.js';
import { roomItemStats } from '../services/itemStats.js';
import { roomQuestionIds, servableFor } from '../services/selector.js';
import { isRecordId } from '../ids.js';
// The v2 guard, not the v1 key-only one: a professor who signed in properly
// carries a bearer token and no shared key, and the v1 guard 401s her out of
// the console she was just routed to.
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite, canRead, canWrite, ownerOf, readable } from '../ownership.js';
import {
  isOnline,
  releaseSession,
  holdRoomForDelete,
  lockProfile,
  roomDeleting,
  broadcastGrid,
  startRoom,
  closeClassQuestionWithRoom,
  resendClassQuestion,
} from '../sockets/index.js';
import { roomFeed, startBlocker } from '../services/modes.js';
import { closeWall, forgetScreen, pushProjector } from '../services/projector.js';
import {
  ATTENDANCE_LOCK,
  attendanceReport,
  classGrid,
  markRollNo,
  marksFrom,
  marksFromJoins,
  signalsOff,
} from '../services/roster.js';
import { RECORDS_LOCK } from '../services/records.js';
import { newerMarks, newerMarksSentence, staleReply } from '../services/recordSync.js';
import { importedRooms } from '../services/roomImport.js';
import { forgetInsights } from '../services/insights.js';
import { CLASS_LOCK } from '../services/classQuestions.js';

const router = express.Router();

// No O/0 and no I/1/L. The code is read off a projector at the back of a hall
// and retyped on a phone keyboard; those are the characters students confuse.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 40;

// Under this the adaptive loop has nothing to choose between - the first
// student would empty the bank before the teacher finished talking.
const MIN_BANK = 6;

// A question set is picked by hand, one question at a time; a list longer than
// this is not a pick, it is the bank, and leaving questionIds out says that.
const MAX_SET = 500;

// Ids are uuids on Supabase and 24-char hex on Mongo / in-process; isRecordId
// accepts either. Checking the shape turns a database cast error into an
// honest 400.


const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * The one and only GridRow builder (CONTRACT section 4). `profile` may be a raw
 * repo document; it is hydrated here so a half-written profile still renders.
 */
export function buildGridRow(profile, { online = false, goal = DEFAULT_MASTERY_GOAL, adapt = true } = {}) {
  const p = hydrate(profile);
  const counted = countedTotals(p);
  const raw = totals(p);
  return {
    rollNo: p.rollNo,
    name: p.name,
    workingLevel: p.workingLevel,
    reason: p.reason,
    slowLearner: isSlowLearner(p),
    levels: p.levels,
    total: raw,
    answered: p.history.length,
    online: Boolean(online),
    // A summary, never the raw event list: the grid is glanceable and the detail
    // belongs on the student panel where there is room for the caveats.
    integrity: summarise(p),

    // Phase 7. `total` above stays the raw record, because that is what every
    // screen already reads and what the export archives. These say what
    // redemption did to it - and they say it as a NUMBER OF ANSWERS rather than
    // as an adjusted percentage, because "6 of 10, and 3 early misses set aside"
    // is a sentence a teacher can repeat to a student, whereas a percentage that
    // silently moved is the thing this feature exists not to be.
    //
    // In a room without redemption `counted` is `total`, exactly, and
    // `withdrawn` is 0 - there is no second code path to disagree with the first.
    counted,
    withdrawn: raw.seen - counted.seen,
    // Levels this student has met the room's goal at. Not the ladder: a student
    // can be working above a level they have not mastered, and the grid showing
    // both is how a teacher sees who is being carried by the cushion level.
    mastered: masteredLevels(p, goal),
    masteryGoal: goal,
    // Phase 5, honest indicators: what the working level rests on, provisional
    // while the ladder has no decision behind it (levelEvidence), and per level
    // answered at, what its mastery rests on (masteryBasis). The room's adapt
    // setting decides the first: with adapt off the level is the room's, not an
    // estimate.
    levelBasis: levelEvidence(p, { adapt }),
    masteryBasis: masteryBasis(p, { goal }),
  };
}

/**
 * What a phone is told about itself (decision (a) of 19 Nov 2026; CONTRACT.md
 * sections 4 and 5, amended): a student subset of GridRow, in every
 * session:accepted, server:result and server:exhausted.
 *
 * Labels are staff-only. Never `slowLearner`, the integrity summary or the
 * professor's `reason`, which can name the below-40% band; `next` says instead
 * which level comes next, why, in plain words, and on how many answers
 * (nextStep in services/mastery.js). Built field by field from the teacher's
 * row, never by deleting from it, so a field added to GridRow later stays off
 * the phone until somebody adds it here on purpose.
 */
export function phoneRow(profile, { online = true, goal = DEFAULT_MASTERY_GOAL, adapt = true } = {}) {
  const row = buildGridRow(profile, { online, goal, adapt });
  return {
    rollNo: row.rollNo,
    name: row.name,
    workingLevel: row.workingLevel,
    levels: row.levels,
    total: row.total,
    answered: row.answered,
    online: row.online,
    counted: row.counted,
    withdrawn: row.withdrawn,
    mastered: row.mastered,
    masteryGoal: row.masteryGoal,
    // The same words the professor's row carries: no band, no percentage.
    masteryBasis: row.masteryBasis,
    // `provisional` (Phase 5): the level is a starting point, not yet an
    // estimate, as the professor's levelBasis says; the sentence is still `why`.
    next: { ...nextStep(profile, { adapt }), provisional: row.levelBasis.provisional },
  };
}

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Keep drawing codes until one is free. 31^6 codes, so this almost never loops.
 * Also draws the code of a room imported from laptop mode whose own code is
 * taken here (routes/laptop.js, Phase 7).
 */
export async function allocateCode(repo) {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    if (!(await repo.getSessionByCode(code))) return code;
  }
  throw fail('Could not allocate a free room code - close some old sessions.', 500);
}

async function requireSession(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) throw fail('Room code is required', 400);
  const session = await getRepo().getSessionByCode(code);
  if (!session) throw fail(`No session with code ${code}`, 404);
  return session;
}

/**
 * A room by code for a teacher's route, by the read rule or, with `write`, the
 * write rule. "No such code" and "not a room you may see" are one 404 in one
 * sentence: requireSession names the code, so a route that used it told a
 * caller which codes exist by the wording alone. An HOD who may read the room
 * still gets the write rule's 403.
 */
async function teacherRoom(rawCode, viewer, { write = false } = {}) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return (write ? assertCanWrite : assertCanRead)(viewer, session, 'That session');
}

/**
 * The lock every change of a room's status takes (start, pause, resume and
 * close; lockProfile in sockets/index.js), and that a delete waits out. '#' is
 * outside ROLL_SHAPE, so it is never a student's own lock.
 */
const STATUS_LOCK = '#status';

/**
 * Change a room's status under STATUS_LOCK, from the status read again under
 * it. Each of these used to read the room, check it and write it with nothing
 * held, so a close landing while a start was at work was undone (the closed
 * room written back to open, and its phones served after they were told it had
 * closed), and two starts both started. `fn` gets the room as stored now.
 * Refused while the room is being deleted, as every other room write is.
 */
async function withStatusLock(session, what, fn) {
  const release = await lockProfile(session._id, STATUS_LOCK);
  try {
    if (roomDeleting(session._id)) throw fail('That room is being deleted. Nothing was changed.', 409);
    const now = await getRepo().getSession(session._id);
    if (!now) throw fail(`${what} was not found.`, 404);
    return await fn(now);
  } finally {
    release();
  }
}

/**
 * The teacher's grid: { rows } for any room, plus each row's `rosterName` and
 * the room's `attendance` ("N / M present") for a room opened for a class
 * (services/roster.js classGrid, which the socket's broadcast uses too), and
 * `waiting` and `feed` for a waiting room and a Mixed or Teacher-led one
 * (services/modes.js roomFeed, which the broadcast uses too).
 */
async function gridFor(session) {
  const repo = getRepo();
  const profiles = await repo.listProfiles(session._id);
  const { masteryGoal, adapt } = sessionSettings(session);
  const rows = profiles.map((p) =>
    buildGridRow(p, { online: isOnline(session.code, p.rollNo), goal: masteryGoal, adapt }));
  const grid = await classGrid(repo, session, rows);
  return { ...grid, ...(await roomFeed(repo, session, grid.rows, grid.attendance)) };
}

/**
 * The class a room is being opened for, from a `classId` the caller did send,
 * or null for none. Only a class the caller may CHANGE: opening a room for a
 * class is a write to its attendance. Any other class, and one that does not
 * exist, is one 404 with one message, so ids cannot be probed.
 */
async function roomClassFrom(raw, viewer) {
  if (raw === undefined || raw === null) return null;
  const id = typeof raw === 'string' ? raw.trim() : '';
  if (!isRecordId(id)) throw fail('classId is not a valid id', 400);
  const cls = await getRepo().getClass(id);
  const owner = ownerOf(cls);
  if (!cls || !(await canRead(viewer, owner)) || !(await canWrite(viewer, owner))) {
    throw fail('That class was not found.', 404);
  }
  return String(cls._id);
}

/**
 * The three settings, off the request body, or an honest 400.
 *
 * Rejected rather than clamped. A teacher who sends 95% has a number in their
 * head that this product does not offer, and quietly running their class at 90%
 * while the screen agrees with them is the failure that only shows up weeks
 * later in a mark nobody can account for. The same goes for three retries: the
 * cap exists for a reason, and silently honouring two of the three would produce
 * a room that does not do what it was asked to do.
 */
function settingsFrom(body = {}) {
  const out = { masteryGoal: DEFAULT_MASTERY_GOAL, reattempts: 0, redemption: false };

  if (body.masteryGoal !== undefined && body.masteryGoal !== null) {
    const goal = Number(body.masteryGoal);
    if (!MASTERY_GOALS.includes(goal)) {
      throw fail(
        `masteryGoal must be one of ${MASTERY_GOALS.map((g) => `${g * 100}%`).join(', ')}.`,
        400,
      );
    }
    out.masteryGoal = goal;
  }

  if (body.reattempts !== undefined && body.reattempts !== null) {
    const tries = Number(body.reattempts);
    if (!Number.isInteger(tries) || tries < 0 || tries > MAX_REATTEMPTS) {
      throw fail(`reattempts must be a whole number from 0 to ${MAX_REATTEMPTS}.`, 400);
    }
    out.reattempts = tries;
  }

  if (body.redemption !== undefined && body.redemption !== null) {
    if (typeof body.redemption !== 'boolean') throw fail('redemption must be true or false.', 400);
    out.redemption = body.redemption;
  }

  // How the room runs (0018). Each is left out of the stored room when not sent,
  // so the store's default (how every room ran before) is what it gets.
  if (body.mode !== undefined && body.mode !== null) {
    if (!ROOM_MODES.includes(body.mode)) {
      throw fail(`mode must be one of ${ROOM_MODES.join(', ')}: Student devices, Teacher-led or Mixed.`, 400);
    }
    out.mode = body.mode;
  }

  if (body.adapt !== undefined && body.adapt !== null) {
    if (typeof body.adapt !== 'boolean') throw fail('adapt must be true or false.', 400);
    out.adapt = body.adapt;
  }

  if (body.startLevel !== undefined && body.startLevel !== null) {
    if (!LEVELS.includes(body.startLevel)) throw fail(`startLevel must be one of ${LEVELS.join(', ')}.`, 400);
    out.startLevel = body.startLevel;
  }

  for (const [key, range, unit] of [
    ['questionsPerStudent', QUESTIONS_PER_STUDENT, 'questions'],
    ['timePerQuestion', TIME_PER_QUESTION, 'seconds'],
  ]) {
    if (body[key] === undefined || body[key] === null) continue;
    if (!Number.isInteger(body[key]) || body[key] < range.min || body[key] > range.max) {
      throw fail(`${key} must be a whole number of ${unit} from ${range.min} to ${range.max}, or left out for none.`, 400);
    }
    out[key] = body[key];
  }

  return out;
}

/**
 * The room's question set, from a `questionIds` the caller did send (left out
 * or null means the whole approved bank, and never reaches here). Every id must
 * be an ACTIVE question of this chapter, or an honest 400.
 *
 * A draft, a rejected question, another chapter's question, another teacher's
 * and an id that names nothing are refused in one sentence, so a set cannot be
 * used to ask which ids exist. Stored as the bank spells the ids, each once, in
 * the order given.
 *
 * No MIN_BANK floor here: that floor protects a room from a bank too thin to
 * adapt over, and a professor who picks two questions has decided the room is
 * those two.
 */
function questionSetFrom(raw, bank, title) {
  if (!Array.isArray(raw)) {
    throw fail('questionIds must be a list of question ids, or left out to use every approved question.', 400);
  }
  if (!raw.length) {
    throw fail('questionIds is empty. Pick at least one question, or leave questionIds out to use every approved question.', 400);
  }
  // Any case: a uuid may be typed either way. A non-string is no id at all.
  const ids = [...new Set(raw.map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : '')))];
  if (ids.length > MAX_SET) throw fail(`questionIds names ${ids.length} questions; ${MAX_SET} is the most a set may hold.`, 400);
  const approved = new Map(bank.filter((q) => (q.status ?? 'active') === 'active')
    .map((q) => [String(q._id).toLowerCase(), String(q._id)]));
  const outside = ids.filter((id) => !approved.has(id));
  if (outside.length) {
    throw fail(
      `${outside.length} of the ${ids.length} questions picked ${outside.length === 1 ? 'is' : 'are'} not an approved question of "${title}". `
        + 'A room may only use approved questions of its own chapter: approve them in the question bank first, or leave them out.',
      400,
    );
  }
  return ids.map((id) => approved.get(id));
}

router.post('/', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const contentId = String(req.body?.contentId ?? '').trim();
    if (!contentId) throw fail('contentId is required', 400);
    if (!isRecordId(contentId)) throw fail('contentId is not a valid id', 400);

    const content = await repo.getContent(contentId);
    // You may only open a room over material you are allowed to touch.
    await assertCanWrite(req.viewer, content, 'That content');

    // Before the set and the bank floor, and before a code is drawn, like them.
    const classId = await roomClassFrom(req.body?.classId, req.viewer);

    // Checked before the bank floor, and before a code is drawn, so a bad set is
    // a 400 that names the set rather than the size of the bank.
    const asked = req.body?.questionIds;
    const questionIds = asked === undefined || asked === null
      ? null
      : questionSetFrom(asked, await repo.listQuestions(contentId), content.title);

    const bankCount = questionIds ? questionIds.length : await repo.countQuestions(contentId);
    if (!questionIds && bankCount < MIN_BANK) {
      // A room serves approved questions only. A bank that is mostly drafts has
      // questions, just none a professor has let in yet - "generate first" would
      // send them to make a second bank and replace the one waiting for review.
      const drafts = await repo.countQuestions(contentId, { status: 'draft' });
      if (drafts > 0) {
        throw fail(
          `"${content.title}" has ${drafts} generated question${drafts === 1 ? '' : 's'} waiting for your approval ` +
            `and ${bankCount} approved. A room serves approved questions only and needs at least ${MIN_BANK}: ` +
            'approve them in the question bank first.',
          409,
        );
      }
      throw fail(
        `Only ${bankCount} active question${bankCount === 1 ? '' : 's'} in the bank for "${content.title}". ` +
          `Generate questions first - a session needs at least ${MIN_BANK}.`,
        400,
      );
    }

    const code = await allocateCode(repo);
    const title = String(req.body?.title ?? '').trim() || content.title;
    // Validated before the code is spent. A 400 after allocateCode() would burn
    // a room code on a request that never opened a room.
    const settings = settingsFrom(req.body);
    // No phone joins a Teacher-led room, so its class roster is the only list of
    // who is in it: the wheel, attendance and observations all work from it.
    if (settings.mode === 'teacher-led' && !classId) {
      throw fail('A Teacher-led room needs a class: no phones join it, so the wheel, attendance and observations '
        + 'work from the class roster. Send classId, or open the room for Student devices or Mixed.', 400);
    }
    // A waiting room (0018): phones may join, and nothing is served until the
    // professor starts it (POST /:code/start). Left out, the room opens as always.
    const lobby = req.body?.lobby;
    if (lobby !== undefined && lobby !== null && typeof lobby !== 'boolean') throw fail('lobby must be true or false.', 400);
    const session = await repo.createSession({
      code,
      contentId,
      title,
      status: lobby === true ? 'waiting' : 'open',
      ownerId: req.viewer?.id ?? null,
      ...settings,
      questionIds,
      classId,
    });

    // Read back off the stored row rather than echoed from the request, so the
    // screen shows what the room will actually run under. If a store ever drops
    // one of these on write - which is precisely what an undeclared Mongoose
    // path does - the teacher sees it here instead of finding out from a mark.
    res.json({
      code: session.code,
      sessionId: String(session._id),
      bankCount,
      settings: sessionSettings(session),
      questionIds: session.questionIds ?? null,
      // The class the room takes attendance against, or null.
      classId: session.classId ?? null,
      // 'open', or 'waiting' for a room opened with a waiting room.
      status: session.status,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Deleted rooms, newest first: who, when and how big, without the data. Only
 * archives of rooms the caller could read are listed, by the same ownership
 * rule as live rooms, so a professor never sees another professor's.
 *
 * Declared before GET /:code, which would otherwise take "archives" as a code.
 */
router.get('/archives', requireTeacher, async (req, res, next) => {
  try {
    const archives = await readable(req.viewer, await getRepo().listRoomArchives());
    res.json({ archives, limitBytes: ARCHIVE_LIMIT_BYTES });
  } catch (err) {
    next(err);
  }
});

/**
 * One deleted room as its JSON file. Same answer for "not yours" and "not there".
 * A class room's archive is served with the class's under-18 marks as they are
 * now (servedArchive, decision 8): a failed read of the roster is an error, not
 * an archive that might show a minor's signals.
 */
router.get('/archives/:id', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const id = String(req.params.id ?? '');
    const archive = isRecordId(id) ? await repo.getRoomArchive(id) : null;
    await assertCanRead(req.viewer, archive, 'That archive');
    const classId = archive.data?.room?.classId ?? null;
    const roster = classId ? await repo.listClassStudents(classId) : [];
    const day = String(archive.archivedAt ?? '').slice(0, 10) || 'undated';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bloomloop-${archive.code}-archive-${day}.json"`);
    res.send(JSON.stringify(servedArchive(archive.data, roster)));
  } catch (err) {
    next(err);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const repo = getRepo();
    const session = await requireSession(req.params.code);
    // What this room serves: its set's approved questions when it has a set,
    // the same number the phone is told on joining. The set itself stays off
    // this route: it is open to anyone holding the code, and a list of question
    // ids is a list of things to try answering.
    const [content, bankCount, profiles] = await Promise.all([
      repo.getContent(session.contentId),
      roomQuestionIds(session)
        ? repo.listQuestions(session.contentId).then((qs) => servableFor(session, qs).length)
        : repo.countQuestions(session.contentId),
      repo.listProfiles(session._id),
    ]);
    // Deliberately NOT the raw session document. It carries contentId, which is
    // the only thing standing between a student on the hotspot and
    // GET /api/bank/<contentId> - the whole answer key. Students legitimately
    // need this route, so it returns the minimum that is safe to publish.
    res.json({
      session: {
        code: session.code,
        title: session.title ?? '',
        status: session.status,
        startedAt: session.startedAt,
        closedAt: session.closedAt ?? null,
        // Safe to publish, and it has to be: these three change what a student's
        // answers are worth, and a rule a student is measured under but not told
        // is the version of this feature that cannot be defended. The rest of
        // the document still stays behind - contentId in particular, which is
        // the whole answer key.
        settings: sessionSettings(session),
      },
      // The rule in the words the student will be shown, travelling with the
      // setting it describes so no screen can display the one without the other.
      redemptionRule: REDEMPTION_RULE,
      content: { title: content?.title ?? session.title ?? '' },
      bankCount,
      studentCount: profiles.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:code/grid', requireTeacher, async (req, res, next) => {
  try {
    // An HOD may read any session in their department; a professor only theirs.
    const session = await teacherRoom(req.params.code, req.viewer);
    const { rows, attendance, waiting, feed } = await gridFor(session);
    const importedFrom = (await importedRooms(getRepo(), [session])).get(String(session._id));
    // `attendance` only for a room opened for a class, `waiting` only while a
    // room waits to start, `feed` only in a Mixed or Teacher-led room,
    // `importedFrom` only for a room imported from a file laptop mode saved
    // (Phase 7: never presented as a room this server ran): every other room's
    // grid is exactly what it was.
    res.json({
      rows,
      levels: LEVELS,
      ...(attendance ? { attendance } : {}),
      ...(waiting ? { waiting } : {}),
      ...(feed ? { feed } : {}),
      ...(importedFrom ? { importedFrom } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The room as the evidence and attendance routes head their reply. `importedFrom`
 * only for a room imported from a file laptop mode saved (Phase 7), with the
 * sentence that says the file was checked for its shape, not that it is
 * unchanged: no screen then shows such a room as one this server ran.
 */
async function roomHead(session) {
  const importedFrom = (await importedRooms(getRepo(), [session])).get(String(session._id));
  return {
    code: session.code, title: session.title ?? '', startedAt: session.startedAt ?? null, status: session.status,
    ...(importedFrom ? { importedFrom } : {}),
  };
}

/**
 * A room this viewer may read, by code. "No such code" and "not a room you may
 * read" are one 404 with one message, so a code cannot be probed by comparing
 * replies (requireSession names the code, which is why it is not used here).
 */
async function readableRoom(rawCode, viewer) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return assertCanRead(viewer, session, 'That room');
}

/*
 * The room's evidence, for teachers. Both routes are two segments deep, so
 * GET /:code (one segment, and open to students) can never answer them; and a
 * room code is six characters, so it can never be "archives" and fall into
 * /archives/:id, which is declared earlier.
 */

/**
 * Every stored attempt in the room, newest first, one page, each with the full
 * snapshot (answer key included) and the machine's reading beside the mark in
 * force. Final answers, retried attempts and polls alike: this is the record,
 * not a report. ?rollNo= narrows to one student, matched as the room stored it.
 */
router.get('/:code/answers', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    const { limit, offset } = pageFrom(req.query);
    const rollNo = rollKey(req.query.rollNo);

    const repo = getRepo();
    const rows = await repo.listAnswers({
      sessionId: session._id,
      ...(rollNo ? { rollNo } : {}),
      order: 'desc',
      limit: limit + 1,
      offset,
    });
    const names = new Map((await repo.listProfiles(session._id)).map((p) => [String(p.rollNo), p.name ?? '']));

    res.json({
      room: await roomHead(session),
      rollNo: rollNo || null,
      items: rows.slice(0, limit).map((a) => answerItem(a, session, { name: names.get(String(a.rollNo)) ?? '' })),
      limit,
      offset,
      hasMore: rows.length > limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Per topic, per level: seen, correct and accuracy, and how many students each
 * topic covers. Final, graded answers only. A room run before the evidence store
 * existed is read from its profiles' history instead, and `source` says which
 * was used (services/evidence.js topicReport).
 */
router.get('/:code/topics', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    res.json({
      room: await roomHead(session),
      ...(await roomTopics(getRepo(), session)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * How each question did in this room (services/itemStats.js): attempts,
 * proportion correct, how many chose each option, mean score, a band for the
 * class, the point-biserial against each student's other answers here, and its
 * flag. Every question answered in the room is listed, and every question of its
 * set, answered or not. Two segments deep, like /answers and /topics, with the
 * same read rule and the same 404.
 */
router.get('/:code/items', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    res.json({
      room: await roomHead(session),
      questionIds: session.questionIds ?? null,
      ...(await roomItemStats(getRepo(), session)),
    });
  } catch (err) {
    next(err);
  }
});

/** The room's class, or a 409 for a room opened for none: it has no roster to mark against. */
async function roomClass(session) {
  const cls = session.classId ? await getRepo().getClass(session.classId) : null;
  if (!cls) {
    throw fail('This room was not opened for a class, so it has no roster to take attendance against. '
      + 'Open the room with a classId to take attendance.', 409);
  }
  return cls;
}

/** The whole attendance report for a class room (services/roster.js attendanceReport). */
async function attendanceBody(session, cls) {
  const repo = getRepo();
  const [roster, marks, profiles] = await Promise.all([
    repo.listClassStudents(cls._id),
    repo.listAttendance(session._id),
    repo.listProfiles(session._id),
  ]);
  return {
    room: await roomHead(session),
    class: { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' },
    ...attendanceReport({ roster, marks, profiles }),
  };
}

/*
 * Attendance, for a room opened for a class. Teacher-only, like every
 * two-segment room route: never sent to a phone, and not in GET /:code, which
 * any phone holding the code can read. Not a Bloom level and not accuracy: it
 * moves nothing in the live loop.
 */

/**
 * Every student on the class roster with their mark in this room ('unmarked'
 * where nobody has marked them, which is not 'absent'), removed students who
 * still have a mark, phones that joined with a roll number the roster does not
 * hold, the counts and "N / M present". Read rule, and one 404, as for /answers.
 */
router.get('/:code/attendance', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    res.json(await attendanceBody(session, await roomClass(session)));
  } catch (err) {
    next(err);
  }
});

/**
 * The professor marks attendance: { marks: [{ studentId, status }] } for one
 * student or many (present, absent or late), or { fromJoins: true } for
 * "everyone who joined present, the rest absent". Every mark here is the
 * teacher's, and a later join never replaces it. With fromJoins, a student
 * already marked by hand keeps that mark. Answers with the report, as GET does.
 * fromJoins is a 409 in a Teacher-led room: no phone joins one, so it would
 * mark every student not yet marked absent.
 *
 * Phase 7: a mark may carry `basedOn`, the markedAt the screen showed for that
 * student (null for unmarked). If a professor's mark with another status was
 * made since, nothing is changed: 409, naming the newer marks, with the
 * register as it stands (services/recordSync.js). Without it, as before.
 *
 * Write rule: the room's owner (404 for anyone who may not read it, 403 for an
 * HOD who may). Allowed on a closed room: attendance is often corrected after
 * the class. Refused (409) while the room is being deleted, since a mark landing
 * after its archive was read would be deleted with it.
 */
router.post('/:code/attendance', requireTeacher, async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    const session = await assertCanWrite(req.viewer, code ? await getRepo().getSessionByCode(code) : null, 'That room');
    const cls = await roomClass(session);
    const repo = getRepo();
    if (req.body?.fromJoins === true && sessionSettings(session).mode === 'teacher-led') {
      throw fail('This room is Teacher-led, so no phone joins it: "everyone who joined present, the rest absent" '
        + 'would mark every student not yet marked absent. Mark them by hand with { marks: [{ studentId, status }] }. '
        + 'Nothing was changed.', 409);
    }

    const release = await lockProfile(session._id, ATTENDANCE_LOCK);
    let changed = 0;
    let kept = 0;
    let stale = null;
    try {
      if (roomDeleting(session._id)) throw fail('That room is being deleted. Nothing was changed.', 409);
      const [roster, marks, profiles] = await Promise.all([
        repo.listClassStudents(cls._id),
        repo.listAttendance(session._id),
        repo.listProfiles(session._id),
      ]);
      let wanted;
      if (req.body?.fromJoins === true) {
        ({ marks: wanted, kept } = marksFromJoins({ roster, marks, profiles }));
      } else {
        wanted = marksFrom(req.body?.marks, roster);
        // Phase 7: a mark sent with what the screen showed (basedOn) is not
        // written over a professor's mark made since. All or nothing, as above.
        const newer = newerMarks(req.body?.marks, wanted, marks);
        if (newer.length) {
          stale = { error: newerMarksSentence(newer, roster), newer };
          wanted = [];
        }
      }
      const markedAt = new Date().toISOString();
      const rollOf = markRollNo(marks, roster);
      if (wanted.length) {
        await repo.saveAttendance(wanted.map((m) => ({
          sessionId: String(session._id),
          classStudentId: m.classStudentId,
          status: m.status,
          source: 'teacher',
          markedAt,
          markedBy: req.viewer?.id ?? null,
          rollNo: rollOf(m.classStudentId),
        })));
      }
      changed = wanted.length;
    } finally {
      release();
    }

    if (stale) {
      const newer = stale.newer.map((m) => ({
        studentId: String(m.classStudentId), status: m.status, markedAt: m.markedAt ?? null, markedBy: m.markedBy ?? null,
      }));
      return res.status(409).json(staleReply(stale.error, await attendanceBody(session, cls), { newer }));
    }

    // The present count on every teacher screen watching the room.
    const io = req.app.get('io');
    if (io) await broadcastGrid(io, session).catch((err) => console.error('[attendance] grid push failed:', err));

    res.json({ changed, kept, ...(await attendanceBody(session, cls)) });
  } catch (err) {
    next(err);
  }
});

/**
 * Every room this viewer may see, newest first, for the management screen.
 *
 * Mounted at GET /api/session, which used to be nothing: rooms could be opened
 * and closed but never listed, so a teacher who lost the tab had no way back to
 * a room that was still running except to remember its code.
 */
router.get('/', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const rooms = await readable(req.viewer, await repo.listSessions());
    // Rooms imported from a file laptop mode saved (Phase 7), in one read.
    const imported = await importedRooms(repo, rooms);

    const rows = await Promise.all(
      rooms.map(async (session) => {
        const profiles = (await repo.listProfiles(session._id)).map(hydrate);
        let accSum = 0;
        let accN = 0;
        let banded = 0;
        let answered = 0;
        let withdrawn = 0;
        for (const profile of profiles) {
          const t = totals(profile);
          const c = countedTotals(profile);
          answered += t.seen;
          withdrawn += t.seen - c.seen;
          // The counted figure, so the accuracy this screen shows is the one the
          // room was actually run under. `answered` stays raw: it is a count of
          // work done, and redemption withdraws answers from an average, never
          // from the record of having given them.
          if (c.seen) { accSum += c.correct / c.seen; accN += 1; }
          if (isSlowLearner(profile)) banded += 1;
        }
        return {
          code: session.code,
          title: session.title ?? '',
          status: session.status,
          contentId: session.contentId,
          settings: sessionSettings(session),
          // The room's question set, or null for its whole approved bank.
          questionIds: session.questionIds ?? null,
          // The class the room was opened for, or null.
          classId: session.classId ?? null,
          // Non-zero only in a room running redemption, and listed beside the
          // accuracy it moved so the two are never read apart.
          withdrawn,
          startedAt: session.startedAt ?? null,
          pausedAt: session.pausedAt ?? null,
          closedAt: session.closedAt ?? null,
          joined: profiles.length,
          online: profiles.filter((p) => isOnline(session.code, p.rollNo)).length,
          answered,
          banded,
          accuracy: accN ? accSum / accN : null,
          // An HOD sees the whole department's rooms but may not act on them,
          // so the buttons are driven by the same rule the routes enforce.
          canControl: await canWrite(req.viewer, session.ownerId ?? null),
          // Only for a room imported from a file laptop mode saved: where it came
          // from, and that the file was checked for its shape only.
          ...(imported.has(String(session._id)) ? { importedFrom: imported.get(String(session._id)) } : {}),
        };
      }),
    );

    res.json({ rooms: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * Pause and resume. The distinction that matters: a paused room keeps every
 * student connected and every profile intact, and answering picks up exactly
 * where it stopped. Closing is final. Before this the only way to interrupt a
 * class was to end it.
 */
async function setPaused(req, res, next, paused) {
  try {
    const found = await teacherRoom(req.params.code, req.viewer, { write: true });
    // Under the status lock, from the status as it is now: a close landing
    // between a resume's read and its write was undone by that write.
    const updated = await withStatusLock(found, 'That session', async (session) => {
      if (session.status === 'closed') throw fail('That room is closed - it cannot be reopened.', 409);
      // A waiting room has served nothing to pause, and resuming it would start it
      // without the start's checks: it is started (POST /:code/start) or closed.
      if (session.status === 'waiting') {
        throw fail('That room has not started yet, so there is nothing to pause or resume. Start it, or close it.', 409);
      }

      const written = await getRepo().updateSession(session._id, {
        status: paused ? 'paused' : 'open',
        pausedAt: paused ? new Date().toISOString() : null,
      });

      // The socket layer caches only OPEN sessions, so the cached copy has to go
      // either way: on pause so the loop stops serving, and on resume so the next
      // read picks up the new status rather than the stale paused one.
      releaseSession({ sessionId: session._id, code: session.code });

      const io = req.app.get('io');
      if (io) {
        io.to(`session:${session.code}`).emit(paused ? 'session:paused' : 'session:resumed', {
          code: session.code,
        });
        // The teacher's own screens watch a different room; without this the Live
        // screen never learned the class had been paused from elsewhere.
        io.to(`teacher:${session.code}`).emit('teacher:status', {
          code: session.code,
          status: paused ? 'paused' : 'open',
        });
        // A class question the pause covered is sent to the phones again (Phase 5).
        if (!paused) await resendClassQuestion(io, written ?? session);
        // The projector says the room is paused (it shows no student either way).
        await pushProjector(io, getRepo(), written ?? session);
      }
      return written ?? session;
    });

    res.json({ session: updated });
  } catch (err) {
    next(err);
  }
}

router.post('/:code/pause', requireTeacher, (req, res, next) => setPaused(req, res, next, true));
router.post('/:code/resume', requireTeacher, (req, res, next) => setPaused(req, res, next, false));

/**
 * Start a room opened with a waiting room (0018): 'waiting' becomes 'open',
 * every phone waiting in it gets its first question, and a phone that joins
 * later is served as in any open room.
 *
 * A REST route rather than a teacher socket event, like pause, resume and close:
 * it is the same kind of act (the owner changes the room's status), it answers
 * with the room or an honest 409, and the write rule is checked the way every
 * other room write checks it.
 *
 * Write rule (an HOD who may read the room gets 403, anyone else the room's
 * 404). 409 for a room that is not waiting (already started, or closed), and for
 * a Student-devices or Mixed room nobody has joined: starting it would serve
 * nobody, as the handoff's Start button says by staying disabled. A Teacher-led
 * room starts with no phones at all.
 *
 * Under the room's status lock, from the status read again under it, and the
 * waiting phones are served before it is let go: a close waits for the start and
 * then closes the room (its phones hear "closed" after their first question,
 * never before it), and of two starts at once the second finds the room open.
 */
router.post('/:code/start', requireTeacher, async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    const repo = getRepo();
    const found = await assertCanWrite(req.viewer, code ? await repo.getSessionByCode(code) : null, 'That room');
    const updated = await withStatusLock(found, 'That room', async (session) => {
      if (session.status === 'closed') throw fail('That room is closed - it cannot be started.', 409);
      if (session.status !== 'waiting') throw fail('That room has already started.', 409);
      const blocker = startBlocker(session, (await repo.listProfiles(session._id)).length);
      if (blocker) throw fail(blocker, 409);

      const written = (await repo.updateSession(session._id, { status: 'open' })) ?? { ...session, status: 'open' };
      releaseSession({ sessionId: session._id, code: session.code });

      const io = req.app.get('io');
      if (io) await startRoom(io, written);
      return written;
    });

    res.json({ session: updated, settings: sessionSettings(updated) });
  } catch (err) {
    next(err);
  }
});

/**
 * Delete a room, keeping everything recorded in it as a JSON archive.
 *
 * The room, its profiles and its answers leave the live tables, so it is gone
 * from every list and dashboard. Before any of that, the whole room is written
 * to one compact JSON document (services/archive.js) and the delete only goes
 * ahead once that write has succeeded: if the archive cannot be written, or
 * would be over the 1 MB ceiling, nothing is deleted.
 *
 * Still asks for ?confirm=CODE - the teacher types the room code back - because
 * the room does disappear from the live screens for good.
 */
router.delete('/:code', requireTeacher, async (req, res, next) => {
  try {
    const session = await teacherRoom(req.params.code, req.viewer, { write: true });

    const typed = String(req.query.confirm ?? '').trim().toUpperCase();
    if (typed !== session.code) {
      throw fail(
        `Deleting ${session.code} removes it from your rooms; what was recorded in it is kept as a JSON archive. Send ?confirm=${session.code} to go ahead.`,
        400,
      );
    }

    const repo = getRepo();
    // Nothing may be written into the room between the archive reading it and
    // the delete removing it: a review or an answer landing there was answered
    // as saved and then lost for good. Held from here until the room is gone.
    let profiles = [];
    const lift = await holdRoomForDelete(session._id, async () => {
      profiles = await repo.listProfiles(session._id);
      // A class room's attendance is written by the teacher under a lock of its
      // own (POST /:code/attendance), and archived with the room: waited out too.
      // So are the teacher records (routes/records.js), in any room, a change
      // of status (a start serving its waiting phones, above all) and a change
      // to a class question (Phase 5, archived with the room).
      return [...profiles.map((p) => p.rollNo), ...(session.classId ? [ATTENDANCE_LOCK] : []), RECORDS_LOCK, STATUS_LOCK, CLASS_LOCK];
    });
    let archive;
    try {
      // Archive first. A failure here throws before anything is deleted.
      const { doc, bytes } = await buildRoomArchive(repo, session, { archivedBy: req.viewer?.id ?? null });
      if (bytes > ARCHIVE_LIMIT_BYTES) {
        throw fail(
          `${session.code} was not deleted: its archive would be ${(bytes / (1024 * 1024)).toFixed(2)} MB, over the 1 MB limit. `
            + 'Nothing was changed. Export the results as CSV and close the room instead.',
          413,
        );
      }
      archive = await repo.saveRoomArchive(doc);
      await repo.deleteSession(session._id);
      releaseSession({ sessionId: session._id, code: session.code });
    } finally {
      lift();
    }

    const io = req.app.get('io');
    if (io) io.to(`session:${session.code}`).emit('session:closed', {});
    // A deleted room's projector links went with it; its projectors are told.
    closeWall(io, { session, reason: 'This room was deleted.' });
    forgetScreen(session._id);
    // Its live insights' series (held in memory) goes with it.
    forgetInsights(session._id);

    res.json({
      ok: true,
      code: session.code,
      deletedProfiles: profiles.length,
      archive: { id: archive._id, bytes: archive.bytes, archivedAt: archive.archivedAt },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The full signal trail for one student, with the caveat attached.
 *
 * HONESTY travels with the payload rather than being written into the screen, so
 * every surface that shows these events shows the same limits alongside them and
 * none of them can quietly drop the qualification.
 */
router.get('/:code/integrity/:rollNo', requireTeacher, async (req, res, next) => {
  try {
    const session = await teacherRoom(req.params.code, req.viewer);
    const repo = getRepo();
    const stored = await repo.getProfile(session._id, String(req.params.rollNo));
    if (!stored) throw fail('No such student in this room.', 404);
    const profile = hydrate(stored);
    // Decision 8: nothing is shown for a student their class's roster marks
    // under 18, not even signals recorded before the mark was set.
    if (await signalsOff(repo, session, profile.rollNo)) {
      res.json({
        rollNo: profile.rollNo,
        name: profile.name,
        summary: null,
        events: [],
        signalsOff: true,
        message: 'Signals are not recorded or shown for this student: the class roster marks them under 18.',
        honesty: HONESTY,
      });
      return;
    }
    res.json({
      rollNo: profile.rollNo,
      name: profile.name,
      summary: summarise(profile),
      events: profile.integrity ?? [],
      honesty: HONESTY,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:code/close', requireTeacher, async (req, res, next) => {
  try {
    // Ending someone else's live class is a write, and an HOD does not get it.
    const found = await teacherRoom(req.params.code, req.viewer, { write: true });
    // Under the status lock, so a start at work finishes first and nothing
    // writes the room back to open after this (withStatusLock).
    const updated = await withStatusLock(found, 'That session', async (session) => {
      const written =
        session.status === 'closed'
          ? session
          : await getRepo().updateSession(session._id, {
              status: 'closed',
              closedAt: new Date().toISOString(),
            });

      // Drop the cached bank and session doc so the live loop stops serving items.
      releaseSession({ sessionId: session._id, code: session.code });

      const io = req.app.get('io');
      // A class question still running closes with the room, its key not
      // revealed (Phase 5): no vote can come any more. The room is already
      // closed when this runs, so a store error here is logged and the close
      // goes on: answering 500 would leave the phones and the projector untold
      // of a room that has closed. The class question can be closed by hand.
      try {
        await closeClassQuestionWithRoom(io, written ?? session, { by: req.viewer?.id ?? null });
      } catch (err) {
        console.error('[close] closing the class question failed:', err);
      }
      if (io) {
        io.to(`session:${session.code}`).emit('session:closed', {});
        io.to(`teacher:${session.code}`).emit('teacher:status', { code: session.code, status: 'closed' });
      }
      // A projector link works only while its room is not closed.
      closeWall(io, { session, reason: 'This room is closed.' });
      forgetScreen(session._id);
      return written ?? session;
    });

    res.json({ session: updated });
  } catch (err) {
    next(err);
  }
});

export default router;
