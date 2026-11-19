// Batch 9, decision E5 - exam mode's staff routes, under /api/session/:code/exam.
//
//   GET    /:code/exam                    read rule   the setting (keys included),
//                                                     its help, and every student's
//                                                     signals and newest picture time
//   PATCH  /:code/exam                    owner only  change the setting while the
//                                                     room is not closed; its phones
//                                                     are told at once (exam:mode)
//   GET    /:code/exam/snapshots/:roll    read rule   the newest screen picture of
//                                                     one student, as a JPEG
//   GET    /:code/exam/collusion          read rule   pairs of matching wrong
//                                                     answers: signals, not proof;
//                                                     an exam room only (409)
//
// requireTeacher on every route, so a phone (no credentials: 401) or a student
// account (403) never reaches one. A room the caller may not read is the same 404
// as one that does not exist, word for word; an HOD reads the department's rooms
// and changes none (403). Nothing here is sent to a phone or the projector, and
// a picture is served from memory only (services/examGuard.js says why).

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { allAnswers, rollKey } from '../services/evidence.js';
import { HONESTY } from '../services/integrity.js';
import { minorRolls, signalsOff } from '../services/roster.js';
import { sessionSettings } from '../services/mastery.js';
import {
  COLLUSION,
  COLLUSION_NOTE,
  COLLUSION_RULE,
  EXAM_HELP,
  EXAM_PRIVACY,
  collusionPairs,
  examModeFrom,
  examModeOf,
  examModeProblem,
  snapshots,
} from '../services/examGuard.js';
import { integrityFull, pushExamMode } from '../sockets/examGuard.js';
import { releaseSession } from '../sockets/index.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The room by code under the read rule (or the write rule), or the one 404 for "not there" and "not yours". */
async function room(rawCode, viewer, { write = false } = {}) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return (write ? assertCanWrite : assertCanRead)(viewer, session, 'That room');
}

const head = (session) => ({ code: session.code, title: session.title ?? '', status: session.status });

router.get('/:code/exam', requireTeacher, async (req, res, next) => {
  try {
    const session = await room(req.params.code, req.viewer);
    const live = examModeOf(session).on ? await integrityFull(getRepo(), session) : null;
    res.json({
      room: head(session),
      examMode: examModeOf(session),
      help: EXAM_HELP,
      // Every student not marked under 18, in roll order, with their signals and
      // when their newest picture arrived; null while exam mode is off.
      students: live ? live.students : null,
      honesty: HONESTY,
      privacy: EXAM_PRIVACY,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Change the setting: { examMode: { on, fullscreen, screenShare, snapshotSeconds,
 * seb } }, checked as at the opening. Refused for a closed room (409): there is
 * nothing left to enforce. Turning pictures or screen share off forgets no
 * picture already kept: it is purged with the room's others.
 */
router.patch('/:code/exam', requireTeacher, async (req, res, next) => {
  try {
    const found = await room(req.params.code, req.viewer, { write: true });
    if (found.status === 'closed') throw fail('That room is closed, so its exam mode can no longer change.', 409);
    if (req.body?.examMode === undefined || req.body?.examMode === null) {
      throw fail('Send examMode: { on, fullscreen, screenShare, snapshotSeconds, seb }.', 400);
    }
    const examMode = examModeFrom(req.body.examMode);
    if (examMode.on && sessionSettings(found).mode === 'teacher-led') {
      throw fail('Exam mode needs phones, and no phone joins a Teacher-led room.', 400);
    }
    const problem = examModeProblem(examMode, { classId: found.classId ?? null });
    if (problem) throw fail(problem, 400);
    const repo = getRepo();
    const updated = (await repo.setSessionExamMode(found._id, examMode)) ?? { ...found, examMode };
    // The live loop's cached copy goes, so the next join and answer read the new setting.
    releaseSession({ code: found.code });
    await pushExamMode(req.app.get('io'), updated);
    res.json({ room: head(updated), examMode: examModeOf(updated), help: EXAM_HELP });
  } catch (err) {
    next(err);
  }
});

/**
 * One student's newest screen picture. 404 in one sentence when there is none:
 * never sent, purged, or a student the roster marks under 18 (whose pictures are
 * never taken, and are not served even if one were somehow held). Not cached
 * anywhere on the way.
 */
router.get('/:code/exam/snapshots/:roll', requireTeacher, async (req, res, next) => {
  try {
    const session = await room(req.params.code, req.viewer);
    const rollNo = rollKey(req.params.roll);
    const shot = rollNo ? snapshots.latest(session._id, rollNo) : null;
    if (!shot || (await signalsOff(getRepo(), session, rollNo))) throw fail('There is no screen picture for that student.', 404);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
      'X-Snapshot-At': new Date(shot.at).toISOString(),
    });
    res.send(shot.jpeg);
  } catch (err) {
    next(err);
  }
});

/**
 * The collusion check: pairs of students whose wrong answers match, by the rule
 * in services/examGuard.js (COLLUSION), in roll order and never ranked. Students
 * the class roster marks under 18 are left out, pairs and all. An exam room
 * only (decision E5 makes it part of exam mode): its students were shown the
 * consent notice. A room in exam mode now is one; any other is a 409 in a
 * sentence, after the read rule, so it says nothing to someone who may not
 * read the room.
 */
router.get('/:code/exam/collusion', requireTeacher, async (req, res, next) => {
  try {
    const session = await room(req.params.code, req.viewer);
    if (!examModeOf(session).on) {
      throw fail('The collusion check is part of exam mode, and this room is not in exam mode, so its students were never told their answers might be compared.', 409);
    }
    const repo = getRepo();
    const [answers, profiles, roster, marks] = await Promise.all([
      allAnswers(repo, { sessionId: session._id, final: true, classVotes: false }),
      repo.listProfiles(session._id),
      session.classId ? repo.listClassStudents(session.classId) : [],
      session.classId ? repo.listAttendance(session._id) : [],
    ]);
    const onRoster = new Map(roster.filter((s) => !s.removedAt).map((s) => [s.rollNo, s.name]));
    const names = new Map(profiles.map((p) => [String(p.rollNo), onRoster.get(String(p.rollNo)) || p.name || '']));
    res.json({
      room: head(session),
      rule: { ...COLLUSION, sentence: COLLUSION_RULE },
      pairs: collusionPairs({ answers, exclude: minorRolls(roster, marks), names }),
      note: COLLUSION_NOTE,
      privacy: EXAM_PRIVACY,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
