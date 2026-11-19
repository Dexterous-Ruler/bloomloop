// Phase 4 - attainment and the marks register, at /api/classes/:id/...
//
//   GET  /:id/attainment/config               the formula in force, its methodology (read rule)
//   PUT  /:id/attainment/config               save a formula, as a new version (owner)
//   GET  /:id/attainment?from=&to=&rooms=     the class's course-outcome and Bloom attainment (read rule)
//   GET  /:id/attainment/students/:studentId  one roster student's, with the answers behind it (read rule)
//   GET  /:id/register?from=&to=&rooms=       the marks register (read rule)
//
// and, mounted at /api/attainment, GET /presets: the example formulas.
//
// The three reports also come as files, from the same routes: ?format=csv (the
// class report as its course-outcome sheet, or with &sheet=bloom its Bloom
// sheet; the register) and ?format=html (a page to print; the class report, one
// student's, the register). The route builds the JSON report exactly as for
// JSON and hands it to services/exports.js or services/printable.js, so a file
// is the JSON of the same query, formula and filters, never a second reckoning.
//
// Teacher-only (requireTeacher at both mounts). Ownership follows the class
// (readableClass / writableClass in routes/classes.js, ownership.js under them):
// the owner reads and saves; an HOD reads their department's and gets 403 on a
// save; anyone else, and an id that names nothing, the class's one 404. Only the
// class's rooms the caller may read are counted.
//
// Staff-only, all of it: nothing here reaches a phone, the projector or a
// student-facing route. The computing is in services/attainment.js; this file
// reads, checks who is asking, and answers.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { canWrite, readable } from '../ownership.js';
import { readableClass, writableClass } from './classes.js';
import {
  ATTAINMENT_PRIVACY,
  CONFIG_FIELDS,
  EVIDENCE_TYPES,
  STATES,
  classAttainment,
  configFrom,
  formulaOf,
  formulaView,
  marksRegister,
  methodologyText,
  readAttainmentInputs,
  roomsWindow,
  sameConfig,
  studentAttainment,
  validateConfig,
} from '../services/attainment.js';
import { DEFAULT_PRESET, PRESETS } from '../services/attainmentPresets.js';
import {
  attainmentCsv, bloomCsv, exportFilename, fileHeaders, registerCsv, reportFormat, sheetFrom,
} from '../services/exports.js';
import { attainmentHtml, registerHtml, studentHtml } from '../services/printable.js';
import { importedRooms } from '../services/roomImport.js';
import { practisedAnswers } from '../services/bankShare.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** A report as a file: `body` is the CSV or the page, `kind` names it in the filename. */
const sendFile = (res, { cls, kind, format, body, now }) => res.set(fileHeaders(format, exportFilename(cls, kind, format, now))).send(body);

const classSummary = (cls) => ({
  id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '',
});

/** The formula in force, as GET answers it and a save echoes it. `rooms`: the class's, to name room weights. */
async function configBody(cls, viewer, formula, rooms) {
  return {
    class: classSummary(cls),
    canEdit: await canWrite(viewer, cls.ownerId ?? null),
    formula: formulaView(formula, rooms),
    methodology: methodologyText(formula, { rooms }),
    presets: PRESETS.map((p) => ({ id: p.id, name: p.name })),
    fields: CONFIG_FIELDS,
    privacy: ATTAINMENT_PRIVACY,
  };
}

/**
 * The class's rooms the caller may read, then those the query asks for.
 * `classRooms` is all of the first: a report names its room weights from them,
 * so a weighted room the query leaves out is not mistaken for a deleted one.
 * Each room imported from a file laptop mode saved carries `importedFrom`
 * (Phase 7), so a report names it, and ?imported=leave-out can leave it out.
 */
async function roomsFor(cls, viewer, query) {
  const repo = getRepo();
  const readableRooms = await readable(viewer, await repo.listSessionsForClass(cls._id));
  const imported = await importedRooms(repo, readableRooms);
  const all = readableRooms.map((r) => (imported.has(String(r._id)) ? { ...r, importedFrom: imported.get(String(r._id)) } : r));
  return { ...roomsWindow(query, all), classRooms: all };
}

/** The formula a class's reports use now. */
async function formulaFor(cls) {
  return formulaOf(await getRepo().getAttainmentConfig(cls._id));
}

router.get('/:id/attainment/config', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const rooms = await readable(req.viewer, await getRepo().listSessionsForClass(cls._id));
    res.json(await configBody(cls, req.viewer, await formulaFor(cls), rooms));
  } catch (err) {
    next(err);
  }
});

/**
 * Save the class's formula: { preset } starts from an example, { config }
 * changes the fields it names of the formula in force (or of the preset, when
 * both are sent). Checked whole, then stored as the next version; the version in
 * force is never changed in place, so a report printed under it can always be
 * checked. A save equal to the formula already saved writes nothing
 * (`changed: false`). Owner.
 */
router.put('/:id/attainment/config', async (req, res, next) => {
  try {
    // Ownership before validation: an outsider learns nothing from a 400.
    const cls = await writableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const [stored, rooms] = await Promise.all([repo.getAttainmentConfig(cls._id), repo.listSessionsForClass(cls._id)]);
    const current = formulaOf(stored);
    const config = configFrom(req.body, { current: current.config, rooms });
    if (stored && sameConfig(config, current.config)) {
      return res.json({ changed: false, message: 'That is the formula already in force; nothing was saved.', ...(await configBody(cls, req.viewer, current, rooms)) });
    }
    const saved = await repo.addAttainmentConfig({
      classId: String(cls._id),
      version: (stored ? Number(stored.version) : 0) + 1,
      config: validateConfig(config),
      createdBy: req.viewer?.id ?? null,
    });
    return res.json({
      changed: true,
      message: `Saved as version ${saved.version}. Every report from now on uses it and says so; earlier versions are kept.`,
      ...(await configBody(cls, req.viewer, formulaOf(saved), rooms)),
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * The class's attainment: per course outcome and per Bloom level, per student
 * and for the class, each figure split by evidence type with the answers it
 * rests on, the teacher records beside it, the formula used and its methodology
 * (services/attainment.js classAttainment). ?from=&to= (YYYY-MM-DD, the day each
 * room opened) and ?rooms=CODE,CODE narrow the rooms. ?format=csv is the
 * course-outcome attainment sheet (&sheet=bloom the Bloom one), ?format=html
 * the page to print. Read rule.
 */
router.get('/:id/attainment', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    // After the class's 404, so an outsider learns nothing from a 400.
    const format = reportFormat(req.query, ['json', 'csv', 'html']);
    const sheet = sheetFrom(req.query, format);
    const { rooms, window, classRooms } = await roomsFor(cls, req.viewer, req.query);
    const formula = await formulaFor(cls);
    const inputs = await readAttainmentInputs(getRepo(), cls, rooms, { records: true });
    const report = classAttainment({ cls, rooms, classRooms, window, formula, ...inputs });
    const now = new Date();
    if (format === 'csv' && sheet === 'bloom') return sendFile(res, { cls, kind: 'bloom-attainment', format, now, body: bloomCsv(report, { now }) });
    if (format === 'csv') return sendFile(res, { cls, kind: 'attainment', format, now, body: attainmentCsv(report, { now }) });
    if (format === 'html') return sendFile(res, { cls, kind: 'attainment', format, now, body: attainmentHtml(report, { now }) });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
});

/**
 * One roster student's attainment (active or removed), with every answer they
 * gave in the rooms counted: the teacher's view of each (the snapshot with its
 * key included), its evidence type, whether it counted and why, and the outcomes
 * it reached. Their teacher records beside. Read rule; a student not on this
 * class's roster is "That student was not found." whoever asks. ?format=html is
 * the page to print.
 */
router.get('/:id/attainment/students/:studentId', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const sid = String(req.params.studentId ?? '').trim();
    const student = isRecordId(sid) ? await repo.getClassStudent(sid) : null;
    if (!student || String(student.classId) !== String(cls._id)) throw fail('That student was not found.', 404);
    const format = reportFormat(req.query, ['json', 'html']);
    const { rooms, window, classRooms } = await roomsFor(cls, req.viewer, req.query);
    const formula = await formulaFor(cls);
    const inputs = await readAttainmentInputs(repo, cls, rooms, { records: true });
    // Batch 8: their signed-in answers to questions they had practised in the
    // Learning Hub first, noted on each (services/bankShare.js).
    const practised = await practisedAnswers(repo, inputs.answers.filter((a) => String(a.rollNo) === String(student.rollNo)));
    const report = studentAttainment({ cls, student, rooms, classRooms, window, formula, ...inputs, practised });
    const now = new Date();
    // The filename names the class only, never the student.
    if (format === 'html') return sendFile(res, { cls, kind: 'student-report', format, now, body: studentHtml(report, { now }) });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
});

/**
 * The marks register: per student in roll order and room in date order, the
 * marks obtained of possible by evidence type, the room's attendance mark, and a
 * total (services/attainment.js marksRegister). The same ?from=&to=&rooms=.
 * ?format=csv is the register as a sheet, ?format=html the page to print. Read
 * rule.
 */
router.get('/:id/register', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const format = reportFormat(req.query, ['json', 'csv', 'html']);
    const { rooms, window, classRooms } = await roomsFor(cls, req.viewer, req.query);
    const formula = await formulaFor(cls);
    const inputs = await readAttainmentInputs(getRepo(), cls, rooms);
    const report = marksRegister({ cls, rooms, classRooms, window, formula, ...inputs });
    const now = new Date();
    if (format === 'csv') return sendFile(res, { cls, kind: 'register', format, now, body: registerCsv(report, { now }) });
    if (format === 'html') return sendFile(res, { cls, kind: 'register', format, now, body: registerHtml(report, { now }) });
    return res.json(report);
  } catch (err) {
    return next(err);
  }
});

export default router;

/** GET /api/attainment/presets: the example formulas, each checked and explained. Any teacher. */
export const presetRoutes = express.Router();

presetRoutes.get('/presets', (_req, res, next) => {
  try {
    res.json({
      presets: PRESETS.map((p) => {
        const formula = { source: 'preset', version: 0, savedAt: null, savedBy: null, preset: { id: p.id, name: p.name }, config: validateConfig(p.config) };
        return { id: p.id, name: p.name, description: p.description, config: formula.config, methodology: methodologyText(formula) };
      }),
      default: DEFAULT_PRESET,
      fields: CONFIG_FIELDS,
      evidenceTypes: EVIDENCE_TYPES,
      states: STATES,
      note: 'These are examples to start from, not an institutional standard. A class uses the default until its owner saves '
        + 'a formula of their own for it, and every report states the formula it used.',
    });
  } catch (err) {
    next(err);
  }
});
