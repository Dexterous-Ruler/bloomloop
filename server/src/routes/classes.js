// Phase 3 - a professor's classes and their rosters, at /api/classes.
//
// Teacher-only (requireTeacher at the mount). Who may touch which class is the
// same rule as for chapters and rooms (ownership.js): the owner reads and
// writes; an HOD reads their department's classes and changes nothing; the
// shared teacher key reaches only classes nobody owns. A class that is not the
// caller's to read answers exactly like one that does not exist.
//
// A roster holds a roll number and a name per student and nothing else, and a
// student is never deleted from it, only removed: their answers in every room
// and their attendance stay where they are (services/roster.js).

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { assertCanRead, assertCanWrite, canWrite, readable } from '../ownership.js';
import {
  classFields,
  classView,
  cleanName,
  nameProblem,
  rosterRoll,
  studentView,
  validateRoster,
} from '../services/roster.js';
import { OBSERVATION_KINDS, STAFF_ONLY, observationDays } from '../services/records.js';
import { classAnalytics, windowFrom } from '../services/classAnalytics.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Removed students, as the reply that removes one says them. */
const KEPT = 'Nothing they did is deleted: their answers in every room, their attendance and their records stay, '
  + 'and they can be put back on the roster (PATCH with { "active": true }).';

/** A class this viewer may read, by id, or the one 404 for "not there" and "not yours". */
async function readableClass(rawId, viewer) {
  const id = String(rawId ?? '').trim();
  const cls = isRecordId(id) ? await getRepo().getClass(id) : null;
  return assertCanRead(viewer, cls, 'That class');
}

/** A class this viewer may change: 404 as above, 403 for an HOD who may only read it. */
async function writableClass(rawId, viewer) {
  const id = String(rawId ?? '').trim();
  const cls = isRecordId(id) ? await getRepo().getClass(id) : null;
  return assertCanWrite(viewer, cls, 'That class');
}

/** One student of this class, or the one 404 for "not there" and "not in this class". */
async function studentOf(cls, rawId) {
  const id = String(rawId ?? '').trim();
  const student = isRecordId(id) ? await getRepo().getClassStudent(id) : null;
  if (!student || String(student.classId) !== String(cls._id)) throw fail('That student was not found.', 404);
  return student;
}

/** The class with its roster split in two, so a screen cannot show a removed student as enrolled. */
async function classBody(cls, viewer) {
  const roster = await getRepo().listClassStudents(cls._id);
  return {
    class: { ...classView(cls, roster), canEdit: await canWrite(viewer, cls.ownerId ?? null) },
    students: roster.filter((s) => !s.removedAt).map(studentView),
    removed: roster.filter((s) => s.removedAt).map(studentView),
  };
}

/** Every class this viewer may read, newest first, with its size (the active roster). */
router.get('/', async (req, res, next) => {
  try {
    const repo = getRepo();
    const classes = await readable(req.viewer, await repo.listClasses());
    const rows = await Promise.all(classes.map(async (cls) => ({
      ...classView(cls, await repo.listClassStudents(cls._id)),
      // An HOD sees the department's classes but may not change them; the
      // buttons follow the rule the routes enforce, as in the room list.
      canEdit: await canWrite(req.viewer, cls.ownerId ?? null),
    })));
    res.json({ classes: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    // An HOD reads the department's classes and writes none of them; a class
    // the HOD owned would be a class nobody teaches.
    if (req.viewer?.role === 'hod') throw fail('An HOD can read the department\'s classes but not create one.', 403);
    const fields = classFields(req.body);
    const cls = await getRepo().createClass({
      ...fields,
      // Stamped from the verified token, never from the request body. Null on
      // the shared key, which is then the only path that reaches it.
      ownerId: req.viewer?.id ?? null,
    });
    res.status(201).json(await classBody(cls, req.viewer));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    res.json(await classBody(cls, req.viewer));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    // Ownership before validation: an outsider learns nothing from a 400.
    const cls = await writableClass(req.params.id, req.viewer);
    const updated = await getRepo().updateClass(cls._id, classFields(req.body, { partial: true }));
    if (!updated) throw fail('That class was not found.', 404);
    res.json(await classBody(updated, req.viewer));
  } catch (err) {
    next(err);
  }
});

/**
 * Add students from a JSON list of { roll, name } (rollNo is taken for roll,
 * as every other route spells it). Rows that can join are added; every other
 * row comes back in `refused` with its position and a reason, and nothing is
 * added twice. Fields other than the roll number and the name are not stored,
 * and are named in `ignoredFields`. CSV import is Phase 4.
 */
router.post('/:id/students', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const { accepted, refused, ignoredFields } = validateRoster(req.body?.students, await repo.listClassStudents(cls._id));
    const made = accepted.length
      ? await repo.addClassStudents(cls._id, accepted.map(({ rollNo, name }) => ({ rollNo, name })))
      : [];
    // A row that passed the check and was still not added lost a race with
    // another request adding the same roll number: it is on the roster, once.
    const added = new Set(made.map((s) => s.rollNo));
    for (const row of accepted) {
      if (!added.has(row.rollNo)) {
        refused.push({ index: row.index, roll: row.rollNo, name: row.name, reason: `roll number ${row.rollNo} is already on this class's roster` });
      }
    }
    refused.sort((a, b) => a.index - b.index);
    const body = await classBody(cls, req.viewer);
    res.json({
      added: made.map(studentView),
      refused,
      ignoredFields,
      ...(ignoredFields.length
        ? { note: `A roster keeps a roll number and a name only. Not stored: ${ignoredFields.join(', ')}.` }
        : {}),
      size: body.class.size,
      class: body.class,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Change one student: { name }, { rollNo } (or roll), or { active: true } to put
 * a removed student back ({ active: false } removes, as DELETE does). Changing a
 * roll number keeps the student's attendance, which points at this row; rooms
 * already run keep the roll number their answers were given under.
 */
router.patch('/:id/students/:studentId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const student = await studentOf(cls, req.params.studentId);
    const body = req.body ?? {};
    const patch = {};

    if (body.name !== undefined) {
      const name = cleanName(body.name);
      const problem = nameProblem(name);
      if (problem) throw fail(`${problem[0].toUpperCase()}${problem.slice(1)}.`, 400);
      patch.name = name;
    }
    const given = body.rollNo ?? body.roll;
    if (given !== undefined) {
      const rollNo = rosterRoll(given);
      if (!rollNo) {
        throw fail('That roll number is not one a phone can join with: letters, digits, spaces and . _ - / only, '
          + 'starting with a letter or digit, at most 24 characters.', 400);
      }
      if (rollNo !== student.rollNo) {
        const holder = (await getRepo().listClassStudents(cls._id)).find((s) => s.rollNo === rollNo);
        if (holder) {
          throw fail(`Roll number ${rollNo} is already on this class's roster (${holder.name}${holder.removedAt ? ', removed' : ''}).`, 409);
        }
        patch.rollNo = rollNo;
      }
    }
    if (body.active !== undefined) {
      if (typeof body.active !== 'boolean') throw fail('active must be true or false.', 400);
      // Removing twice keeps the first date: it is when they left.
      if (body.active && student.removedAt) patch.removedAt = null;
      if (!body.active && !student.removedAt) patch.removedAt = new Date().toISOString();
    }
    if (body.name === undefined && given === undefined && body.active === undefined) {
      throw fail('Send name, rollNo or active to change.', 400);
    }

    const updated = Object.keys(patch).length ? await getRepo().updateClassStudent(student._id, patch) : student;
    if (!updated) throw fail('That student was not found.', 404);
    res.json({
      student: studentView(updated),
      ...(patch.removedAt ? { message: `Removed from the roster. ${KEPT}` } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * One student's observations across days (Phase 3 teacher records): for each
 * day, newest first, the mark in force and every set and clear behind it, with
 * the room it was set in. Read rule, so an HOD reads it too; a removed student's
 * are kept and readable. Staff-only, like every teacher record. Rooms deleted
 * since took their records into their archives.
 */
router.get('/:id/students/:studentId/observations', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const student = await studentOf(cls, req.params.studentId);
    const repo = getRepo();
    const events = await repo.listObservations({ classStudentId: student._id });
    const rooms = new Map();
    for (const id of new Set(events.map((e) => String(e.sessionId)))) {
      rooms.set(id, (await repo.getSession(id))?.code ?? null);
    }
    const days = observationDays(events, rooms);
    const counts = Object.fromEntries(OBSERVATION_KINDS.map((k) => [k.id, 0]));
    for (const d of days) if (d.current) counts[d.current.kind] += 1;
    res.json({
      class: { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' },
      student: studentView(student),
      kinds: OBSERVATION_KINDS,
      // Days with a mark in force, per kind: a count of class meetings, never a score.
      counts: { ...counts, days: days.filter((d) => d.current).length },
      days,
      privacy: STAFF_ONLY,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The class across its last 4 or 8 rooms (?last=4|8, default 4): accuracy and
 * participation per room, the accuracy histogram with the three accuracy bands,
 * accuracy at each Bloom level per room as six levels and as three level bands,
 * attendance per room, and the hardest questions, each figure with the answers
 * behind it (services/classAnalytics.js). Read rule, so an HOD reads it too; the
 * class's 404 as for every route here, checked before ?last= so an outsider
 * learns nothing from a 400. Only rooms the caller may read are counted. A class
 * with no rooms answers empty lists. Staff-only: nothing here reaches a phone.
 */
router.get('/:id/analytics', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const last = windowFrom(req.query.last);
    const repo = getRepo();
    const rooms = await readable(req.viewer, await repo.listSessionsForClass(cls._id));
    res.json(await classAnalytics(repo, cls, rooms, { last }));
  } catch (err) {
    next(err);
  }
});

/**
 * Take a student off the roster. Soft: the row stays with `removedAt` set, so
 * their answers, attendance and records are all kept and they can be restored.
 * A removed student no longer counts in the class size or gets marked present
 * by a join; a phone with their roll number still gets into a room, as any
 * roll number does, and shows as not on the roster.
 */
router.delete('/:id/students/:studentId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const student = await studentOf(cls, req.params.studentId);
    const updated = student.removedAt
      ? student
      : await getRepo().updateClassStudent(student._id, { removedAt: new Date().toISOString() });
    if (!updated) throw fail('That student was not found.', 404);
    res.json({ student: studentView(updated), removed: true, message: `Removed from the roster. ${KEPT}` });
  } catch (err) {
    next(err);
  }
});

export default router;
