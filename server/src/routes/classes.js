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
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
  REFUSAL,
  UNDER_18_NOTE,
  addToRoster,
  classFields,
  classView,
  cleanName,
  nameProblem,
  rosterFromCsv,
  rosterRoll,
  studentView,
  under18From,
  validateRoster,
} from '../services/roster.js';
import { OBSERVATION_KINDS, STAFF_ONLY, observationDays } from '../services/records.js';
import { pushUnder18 } from '../sockets/examGuard.js';
import { classAnalytics, windowFrom } from '../services/classAnalytics.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Removed students, as the reply that removes one says them. */
const KEPT = 'Nothing they did is deleted: their answers in every room, their attendance and their records stay, '
  + 'and they can be put back on the roster at any time.';

/**
 * A class this viewer may read, by id, or the one 404 for "not there" and "not
 * yours". Exported for the course-outcome routes (routes/outcomes.js), whose
 * ownership follows the class's.
 */
export async function readableClass(rawId, viewer) {
  const id = String(rawId ?? '').trim();
  const cls = isRecordId(id) ? await getRepo().getClass(id) : null;
  return assertCanRead(viewer, cls, 'That class');
}

/** A class this viewer may change: 404 as above, 403 for an HOD who may only read it. */
export async function writableClass(rawId, viewer) {
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
    // Decision 8's sentence whenever a student on the roster is marked, removed
    // ones included (they are still the age they were), so a screen opened fresh,
    // or an HOD's, says it as the write that set the mark did.
    ...(roster.some((s) => s.under18 === true) ? { under18Note: UNDER_18_NOTE } : {}),
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
    // Whether this viewer may make a class, by the rule POST / enforces: an HOD
    // reads the department's classes and creates none.
    res.json({ classes: rows, canCreate: req.viewer?.role !== 'hod' });
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
 * and are named in `ignoredFields`. A CSV file is the import below; both add
 * through addToRoster.
 */
router.post('/:id/students', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const { made, refused, ignoredFields } = await addToRoster(getRepo(), cls._id, req.body?.students);
    const body = await classBody(cls, req.viewer);
    res.json({
      added: made.map(studentView),
      // As this route has always answered: the refusal's `code` is the import's.
      refused: refused.map(({ code, ...row }) => row),
      ignoredFields,
      ...(ignoredFields.length
        ? { note: `A roster keeps a roll number and a name only. Not stored: ${ignoredFields.join(', ')}.` }
        : {}),
      ...(made.some((s) => s.under18) ? { under18Note: UNDER_18_NOTE } : {}),
      size: body.class.size,
      class: body.class,
    });
  } catch (err) {
    next(err);
  }
});

// The import's body as text when it is sent as a file (text/csv, or text/plain
// from a pasted sheet). JSON ({ csv }) is read by the app's own JSON parser.
const csvText = express.text({ type: ['text/csv', 'text/plain', 'application/csv'], limit: MAX_CSV_BYTES });

const DELIMITER_NAMES = { ',': 'comma', ';': 'semicolon', '\t': 'tab' };

/** ?dryRun= or { dryRun } in a JSON body. Either saying true is a dry run: the safe way to read a disagreement. */
function dryRunFrom(req) {
  const q = req.query?.dryRun;
  if (q !== undefined && !['true', 'false'].includes(String(q))) throw fail('dryRun must be true or false.', 400);
  const b = req.body && typeof req.body === 'object' ? req.body.dryRun : undefined;
  if (b !== undefined && typeof b !== 'boolean') throw fail('dryRun must be true or false.', 400);
  return q === 'true' || b === true;
}

/**
 * Import students from a CSV file (Phase 4): the roll number and name columns
 * of a class list as a spreadsheet exports it. The body is the file
 * (Content-Type: text/csv) or JSON { csv }; at most 1 MB and 2,000 rows.
 *
 * With ?dryRun=true (or { dryRun: true }) nothing is written and the reply says
 * exactly what an import would do: the rows it would add, every row it would
 * refuse with its line and reason, the duplicates (twice in the file, already on
 * the roster), the rows naming a removed student, and the columns it did not
 * read. Without it the same rows are added, through addToRoster: the same check
 * and the same write as POST /:id/students, so the two cannot disagree.
 *
 * A roster keeps a roll number and a name only: every other column (a phone
 * number, an email, a date of birth) is never read into a row, never stored, and
 * named back in `ignoredColumns`. A roll number of a removed student is reported
 * and NOT restored: restoring is a decision about one student
 * (PATCH /:id/students/:studentId { active: true }), not a side effect of a file.
 *
 * Owner only, dry run included: an HOD reads the class and gets 403 here.
 */
router.post('/:id/students/import', csvText, async (req, res, next) => {
  try {
    // Ownership before reading the file: an outsider learns nothing from a 400.
    const cls = await writableClass(req.params.id, req.viewer);
    const dryRun = dryRunFrom(req);
    const csv = rosterFromCsv(typeof req.body === 'string' ? req.body : req.body?.csv);
    const repo = getRepo();
    // The under-18 mark only when the file has that column (decision 8).
    const list = csv.rows.map(({ roll, name, under18 }) => ({ roll, name, ...(under18 !== undefined ? { under18 } : {}) }));

    let result;
    if (dryRun) {
      const roster = await repo.listClassStudents(cls._id);
      result = { roster, made: [], ...validateRoster(list, roster, { maxRows: MAX_CSV_ROWS }) };
    } else {
      result = await addToRoster(repo, cls._id, list, { maxRows: MAX_CSV_ROWS });
    }
    const { roster, accepted, made, refused } = result;

    const lineOf = (index) => csv.rows[index].line;
    const byRoll = new Map(roster.map((s) => [s.rollNo, s]));
    const firstLine = new Map(accepted.map((a) => [a.rollNo, lineOf(a.index)]));
    const withCode = (code) => refused.filter((r) => r.code === code);
    const rollOf = (r) => rosterRoll(r.roll) ?? r.roll;

    const body = await classBody(cls, req.viewer);
    res.json({
      dryRun,
      read: {
        delimiter: DELIMITER_NAMES[csv.delimiter],
        columns: { roll: csv.columns.roll, name: csv.columns.name, under18: csv.columns.under18 },
        rows: csv.rows.length,
        blankLines: csv.blankLines,
      },
      ...(dryRun
        ? { wouldAdd: accepted.map((a) => ({ line: lineOf(a.index), rollNo: a.rollNo, name: a.name, under18: a.under18 })) }
        : { added: made.map((s) => ({ line: firstLine.get(s.rollNo) ?? null, ...studentView(s) })) }),
      refused: refused.map((r) => ({ line: lineOf(r.index), roll: r.roll, name: r.name, code: r.code, reason: r.reason })),
      duplicates: {
        inFile: withCode(REFUSAL.repeated).map((r) => ({ line: lineOf(r.index), rollNo: rollOf(r), firstLine: firstLine.get(rollOf(r)) ?? null })),
        onRoster: withCode(REFUSAL.onRoster).map((r) => ({
          line: lineOf(r.index), rollNo: rollOf(r), onRoster: byRoll.has(rollOf(r)) ? studentView(byRoll.get(rollOf(r))) : null,
        })),
      },
      removed: withCode(REFUSAL.removed).map((r) => ({
        line: lineOf(r.index), rollNo: rollOf(r), student: studentView(byRoll.get(rollOf(r))),
      })),
      ignoredColumns: csv.ignoredColumns,
      ...(csv.ignoredColumns.length
        ? { note: `A roster keeps a roll number and a name only. Not read from the file: ${csv.ignoredColumns.join(', ')}.` }
        : {}),
      ...(withCode(REFUSAL.removed).length
        ? { restore: 'Removed students are not restored by an import. To bring one back, restore them on the class\'s roster.' }
        : {}),
      // An import only adds: a student already on the roster keeps the mark
      // they have, whatever the file says. Said, so a file marking them under
      // 18 is not taken to have marked them.
      ...(csv.columns.under18 && withCode(REFUSAL.onRoster).some((r) => under18From(csv.rows[r.index].under18) === true
        && byRoll.get(rollOf(r))?.under18 !== true)
        ? { under18: 'Some students already on the roster are marked under 18 in the file but not on the roster. An import does '
            + 'not change a student already on it: mark them on the class\'s roster.' }
        : {}),
      ...(csv.columns.under18 ? { under18Note: UNDER_18_NOTE } : {}),
      ...(dryRun ? { message: 'Nothing was changed: this is what importing the file would do.' } : {}),
      size: body.class.size,
      ...(dryRun ? { sizeAfter: body.class.size + accepted.length } : {}),
      class: body.class,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Change one student: { name }, { rollNo } (or roll), { active: true } to put a
 * removed student back ({ active: false } removes, as DELETE does), or
 * { under18 } (decision 8). Changing a roll number keeps the student's
 * attendance, which points at this row; rooms already run keep the roll number
 * their answers were given under.
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
    // The owner's optional "under 18" mark (decision 8, 0022): integrity
    // signals are neither recorded nor shown for the student in this class's
    // rooms from the moment it is set. Owner only, like every write here.
    if (body.under18 !== undefined) {
      if (typeof body.under18 !== 'boolean') throw fail('under18 must be true or false.', 400);
      if (body.under18 !== (student.under18 === true)) patch.under18 = body.under18;
    }
    if (body.name === undefined && given === undefined && body.active === undefined && body.under18 === undefined) {
      throw fail('Send name, rollNo, active or under18 to change.', 400);
    }

    const updated = Object.keys(patch).length ? await getRepo().updateClassStudent(student._id, patch) : student;
    if (!updated) throw fail('That student was not found.', 404);
    // Batch 9 (E5): a phone of this student in a running exam room learns at
    // once what it is asked for now. Never allowed to fail the change.
    if (patch.under18 !== undefined) {
      await pushUnder18(req.app.get('io'), cls._id, updated.rollNo).catch((err) => console.error('[classes] exam mode push failed:', err));
    }
    res.json({
      student: studentView(updated),
      ...(patch.removedAt ? { message: `Removed from the roster. ${KEPT}` } : {}),
      ...(body.under18 !== undefined ? { under18Note: UNDER_18_NOTE } : {}),
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

// A CSV body over the import's limit is refused by the text parser before the
// route runs; this says so in a sentence rather than "request entity too large".
router.use((err, _req, _res, next) => {
  if (err?.type === 'entity.too.large') {
    return next(fail(`The CSV is larger than ${MAX_CSV_BYTES / (1024 * 1024)} MB. A class list is far smaller; split the file.`, 413));
  }
  return next(err);
});

export default router;
