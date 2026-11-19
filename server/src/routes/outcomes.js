// Phase 4 - a class's course outcomes, what they are mapped to, and copying
// them, at /api/classes/:id/outcomes.
//
// Teacher-only (requireTeacher at the mount). Ownership follows the class
// (readableClass / writableClass in routes/classes.js, ownership.js under them):
// the owner reads and writes; an HOD reads their department's and gets 403 on
// every write; anyone else, and an id that names nothing, the class's one 404.
// A chapter or question named in a body must be one the caller may read, or it
// is the same 404 as one that does not exist.
//
// Staff-only, like everything a class keeps: nothing here reaches a phone, the
// projector or a student-facing route. Which evidence belongs to which outcome
// is decided in services/outcomes.js (resolveAnswer), never here.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { assertCanRead, canRead, canWrite, readable } from '../ownership.js';
import { readableClass, writableClass } from './classes.js';
import {
  MAX_CODE,
  MAX_OUTCOMES,
  MAX_STATEMENT,
  MAX_TOPICS_PER_OUTCOME,
  MAX_WEIGHT,
  OUTCOMES_PRIVACY,
  chapterMap,
  classCoverage,
  inOrder,
  knownTopics,
  outcomeFields,
  outcomeView,
  overrideFrom,
  overrideQuestions,
  overrideView,
  readOutcomeMap,
  topicKey,
  topicLinksFrom,
} from '../services/outcomes.js';
import { formulaOf, methodologyText } from '../services/attainment.js';
import { exportFilename, fileHeaders, outcomesCsv, reportFormat } from '../services/exports.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

const NOT_FOUND = 'That course outcome was not found.';

/** One outcome of this class, or the one 404 for "not there" and "not in this class". */
async function outcomeOf(cls, rawId) {
  const id = String(rawId ?? '').trim();
  const outcome = isRecordId(id) ? await getRepo().getOutcome(id) : null;
  if (!outcome || String(outcome.classId) !== String(cls._id)) throw fail(NOT_FOUND, 404);
  return outcome;
}

const classSummary = (cls) => ({
  id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '',
});

const nextPosition = (outcomes) => outcomes.reduce((m, o) => Math.max(m, Number(o.position) || 0), 0) + 1;

/** The chapters behind some mappings and overridden questions, for their titles and topic lists. */
async function chaptersFor(repo, links, questions) {
  const ids = [...new Set([...links.map((l) => String(l.contentId)), ...questions.filter(Boolean).map((q) => String(q.contentId))])];
  return chapterMap(await Promise.all(ids.map((id) => repo.getContent(id))));
}

/** The outcomes, their topics and the overrides, as GET answers them and every write echoes them. */
async function outcomesBody(cls, viewer) {
  const repo = getRepo();
  const { outcomes, links, overrides } = await readOutcomeMap(repo, cls._id);
  const questions = await overrideQuestions(repo, overrides);
  const chapters = await chaptersFor(repo, links, questions);
  return {
    class: classSummary(cls),
    canEdit: await canWrite(viewer, cls.ownerId ?? null),
    outcomes: inOrder(outcomes).map((o) => outcomeView(o, links, chapters)),
    overrides: overrides.map((ov, i) => overrideView(ov, questions[i], outcomes, chapters)),
    limits: {
      outcomes: MAX_OUTCOMES, code: MAX_CODE, statement: MAX_STATEMENT, topicsPerOutcome: MAX_TOPICS_PER_OUTCOME, weight: MAX_WEIGHT,
    },
    privacy: OUTCOMES_PRIVACY,
  };
}

/** A write's reply: the outcome it touched, with its topics, then the whole list as GET gives it. */
async function withOutcome(cls, viewer, id) {
  const body = await outcomesBody(cls, viewer);
  return { outcome: body.outcomes.find((o) => o.id === String(id)) ?? null, ...body };
}

/**
 * The class's course outcomes in its order (archived ones after, marked), each
 * with the topics it is mapped to, and every per-question override. Read rule.
 * ?format=csv is the same list as a sheet (services/exports.js outcomesCsv),
 * with the formula in force that the reports apply to it.
 */
router.get('/:id/outcomes', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    // After the class's 404, so an outsider learns nothing from a 400.
    const format = reportFormat(req.query, ['json', 'csv']);
    const body = await outcomesBody(cls, req.viewer);
    if (format !== 'csv') return res.json(body);
    const repo = getRepo();
    const [stored, rooms] = await Promise.all([
      repo.getAttainmentConfig(cls._id),
      repo.listSessionsForClass(cls._id).then((list) => readable(req.viewer, list)),
    ]);
    const formula = formulaOf(stored);
    const now = new Date();
    const csv = outcomesCsv(body, { formula, methodology: methodologyText(formula, { rooms }), now });
    return res.set(fileHeaders('csv', exportFilename(cls, 'outcomes', 'csv', now))).send(csv);
  } catch (err) {
    return next(err);
  }
});

/**
 * Coverage: for each outcome, its topics with the approved questions and the
 * recorded answers under each, what is mapped to it directly, its totals, and
 * whether it has any evidence; and every answer that reaches no outcome, counted
 * by topic (services/outcomes.js classCoverage). Over the class's rooms the
 * caller may read. Read rule.
 */
router.get('/:id/outcomes/coverage', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const rooms = await readable(req.viewer, await repo.listSessionsForClass(cls._id));
    res.json(await classCoverage(repo, cls, rooms));
  } catch (err) {
    next(err);
  }
});

/** Create one: { code, statement, targetLevel? }. It goes last in the class's order. Owner. */
router.post('/:id/outcomes', async (req, res, next) => {
  try {
    // Ownership before validation: an outsider learns nothing from a 400.
    const cls = await writableClass(req.params.id, req.viewer);
    const fields = outcomeFields(req.body);
    const repo = getRepo();
    const all = await repo.listOutcomes(cls._id);
    const active = all.filter((o) => !o.archivedAt);
    if (active.length >= MAX_OUTCOMES) throw fail(`This class already has ${MAX_OUTCOMES} course outcomes, the most it may hold.`, 409);
    if (active.some((o) => o.code === fields.code)) throw fail(`${fields.code} is already a course outcome of this class.`, 409);
    const made = await repo.createOutcome({ ...fields, classId: String(cls._id), position: nextPosition(all) });
    res.status(201).json(await withOutcome(cls, req.viewer, made._id));
  } catch (err) {
    next(err);
  }
});

/**
 * Put the class's outcomes in a new order: { ids }, every outcome that is not
 * archived, each once, first to last. Owner.
 */
router.post('/:id/outcomes/reorder', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const active = (await repo.listOutcomes(cls._id)).filter((o) => !o.archivedAt);
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => String(id ?? '').trim().toLowerCase()) : null;
    const byId = new Map(active.map((o) => [String(o._id).toLowerCase(), o]));
    if (!ids || ids.length !== active.length || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
      throw fail(`ids must list every course outcome of this class that is not archived (${active.length}), each once, `
        + 'in the new order.', 400);
    }
    for (const [i, id] of ids.entries()) {
      const o = byId.get(id);
      if (Number(o.position) !== i + 1) await repo.updateOutcome(o._id, { position: i + 1 });
    }
    res.json(await outcomesBody(cls, req.viewer));
  } catch (err) {
    next(err);
  }
});

/**
 * Copy another class's outcomes into this one: { fromClassId }, any class the
 * caller may read. Its outcomes that are not archived are created here with
 * their topic mappings and its per-question overrides, as new rows: nothing
 * stays linked, so a later edit in either class leaves the other as it was.
 * A topic of a chapter the caller may not read, an override of a question that
 * is gone or that they may not read, and one naming only archived outcomes are
 * skipped and listed. Refused whole (409) when this class already has one of the
 * codes, so nothing is half-copied over a clash. Owner of this class.
 */
router.post('/:id/outcomes/copy', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    if (req.body?.fromClassId === undefined || req.body?.fromClassId === null || req.body?.fromClassId === '') {
      throw fail('Send { "fromClassId": "..." }: the class whose course outcomes to copy.', 400);
    }
    const from = await readableClass(req.body.fromClassId, req.viewer);
    if (String(from._id) === String(cls._id)) throw fail('A class cannot copy its own course outcomes.', 400);

    const repo = getRepo();
    const [src, mine] = await Promise.all([readOutcomeMap(repo, from._id), repo.listOutcomes(cls._id)]);
    const wanted = inOrder(src.outcomes).filter((o) => !o.archivedAt);
    if (!wanted.length) throw fail('That class has no course outcomes to copy.', 409);
    const mineActive = mine.filter((o) => !o.archivedAt);
    const clash = wanted.filter((o) => mineActive.some((m) => m.code === o.code)).map((o) => o.code);
    if (clash.length) {
      throw fail(`This class already has ${clash.join(', ')}. Nothing was copied: rename or remove ${clash.length === 1 ? 'it' : 'them'} `
        + 'here first.', 409);
    }
    if (mineActive.length + wanted.length > MAX_OUTCOMES) {
      throw fail(`Copying would give this class ${mineActive.length + wanted.length} course outcomes; ${MAX_OUTCOMES} is the most.`, 409);
    }

    // What the caller may read, decided before anything is written.
    const chapterIds = [...new Set(src.links.map((l) => String(l.contentId)))];
    const chapterOk = new Map(await Promise.all(chapterIds.map(async (id) => {
      const content = await repo.getContent(id);
      return [id, Boolean(content) && (await canRead(req.viewer, content.ownerId ?? null))];
    })));
    const questions = await overrideQuestions(repo, src.overrides);
    const questionOk = await Promise.all(questions.map(async (q) => {
      if (!q) return false;
      const content = await repo.getContent(q.contentId);
      return Boolean(content) && canRead(req.viewer, content.ownerId ?? null);
    }));

    const skipped = { archivedOutcomes: src.outcomes.length - wanted.length, topics: [], overrides: [] };
    const newId = new Map();
    let position = nextPosition(mine);
    for (const o of wanted) {
      const made = await repo.createOutcome({
        classId: String(cls._id), code: o.code, statement: o.statement, targetLevel: o.targetLevel ?? null, position,
      });
      position += 1;
      newId.set(String(o._id), String(made._id));
    }
    let topics = 0;
    for (const o of wanted) {
      const links = [];
      for (const l of src.links.filter((x) => String(x.outcomeId) === String(o._id))) {
        if (chapterOk.get(String(l.contentId))) links.push({ contentId: String(l.contentId), topic: l.topic, weight: Number(l.weight) || 1 });
        else skipped.topics.push({ code: o.code, contentId: String(l.contentId), topic: l.topic, reason: 'that chapter was not found' });
      }
      if (links.length) topics += (await repo.setOutcomeTopics(newId.get(String(o._id)), String(cls._id), links)).length;
    }
    let overrides = 0;
    for (const [i, ov] of src.overrides.entries()) {
      const questionId = String(ov.questionId);
      if (!questionOk[i]) {
        skipped.overrides.push({ questionId, reason: questions[i] ? 'that question was not found' : 'the question has been deleted' });
        continue;
      }
      const outcomeIds = (ov.outcomeIds ?? []).map((id) => newId.get(String(id))).filter(Boolean);
      if (!ov.excluded && !outcomeIds.length) {
        skipped.overrides.push({ questionId, reason: 'it names only archived course outcomes, which are not copied' });
        continue;
      }
      if (!ov.excluded && outcomeIds.length < (ov.outcomeIds ?? []).length) {
        skipped.overrides.push({ questionId, reason: 'copied without the archived course outcomes it also names' });
      }
      await repo.setQuestionOverride({
        classId: String(cls._id), questionId, excluded: ov.excluded === true, outcomeIds: ov.excluded ? [] : outcomeIds,
        updatedBy: req.viewer?.id ?? null,
      });
      overrides += 1;
    }

    res.status(201).json({
      copied: { outcomes: wanted.length, topics, overrides },
      skipped,
      from: classSummary(from),
      message: `Copied ${wanted.length} course outcome${wanted.length === 1 ? '' : 's'} with their mappings. Nothing is linked: `
        + 'a later change in either class does not change the other.',
      ...(await outcomesBody(cls, req.viewer)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Edit one: { code?, statement?, targetLevel? }, or { archived: false } to
 * restore an archived one (it goes last in the order; it may carry edits too).
 * An archived outcome is otherwise kept as it was. Owner.
 */
router.patch('/:id/outcomes/:outcomeId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const outcome = await outcomeOf(cls, req.params.outcomeId);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.archived !== undefined && body.archived !== false) {
      throw fail('archived may only be false here, to restore an archived outcome. DELETE removes one.', 400);
    }
    const restore = body.archived === false && Boolean(outcome.archivedAt);
    if (outcome.archivedAt && !restore) {
      throw fail(`${outcome.code} is archived; restore it ({ "archived": false }) before changing it.`, 409);
    }
    const { archived, ...edits } = body;
    const editing = ['code', 'statement', 'targetLevel'].some((k) => edits[k] !== undefined);
    if (!editing && !restore) {
      if (archived === false) throw fail(`${outcome.code} is not archived.`, 409);
      throw fail('Send code, statement or targetLevel to change, or { "archived": false } to restore.', 400);
    }
    const fields = editing ? outcomeFields(edits, { partial: true }) : {};

    const repo = getRepo();
    const all = await repo.listOutcomes(cls._id);
    // A restore adds one outcome in use, so it meets the cap a create meets.
    if (restore && all.filter((o) => !o.archivedAt).length >= MAX_OUTCOMES) {
      throw fail(`This class already has ${MAX_OUTCOMES} course outcomes, the most it may hold. Archive one before restoring `
        + `${outcome.code}.`, 409);
    }
    const code = fields.code ?? outcome.code;
    if ((fields.code !== undefined || restore)
      && all.some((o) => !o.archivedAt && String(o._id) !== String(outcome._id) && o.code === code)) {
      throw fail(`${code} is already a course outcome of this class.`, 409);
    }
    const updated = await repo.updateOutcome(outcome._id, {
      ...fields,
      ...(restore ? { archivedAt: null, position: nextPosition(all) } : {}),
    });
    if (!updated) throw fail(NOT_FOUND, 404);
    res.json(await withOutcome(cls, req.viewer, updated._id));
  } catch (err) {
    next(err);
  }
});

/**
 * Map one outcome to topics: { topics: [{ contentId, topic, weight? }] }, the
 * whole set (it replaces what was mapped; [] maps none). Each chapter must be
 * one the caller may read, and each topic one its evidence carries: the
 * chapter's list, its questions' topics, or a topic answers in this class's
 * rooms were given under (an old name after a rename). A topic may map to
 * several outcomes. Owner.
 */
router.put('/:id/outcomes/:outcomeId/topics', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const outcome = await outcomeOf(cls, req.params.outcomeId);
    if (outcome.archivedAt) throw fail(`${outcome.code} is archived; restore it ({ "archived": false }) before mapping it.`, 409);
    const wanted = topicLinksFrom(req.body?.topics);

    const repo = getRepo();
    const rooms = await repo.listSessionsForClass(cls._id);
    const chapters = new Map();
    for (const [i, link] of wanted.entries()) {
      if (!chapters.has(link.contentId)) {
        const content = await repo.getContent(link.contentId);
        await assertCanRead(req.viewer, content, `That chapter (topics[${i}])`);
        chapters.set(link.contentId, { content, known: await knownTopics(repo, content, rooms) });
      }
      const { content, known } = chapters.get(link.contentId);
      const spelled = known.get(topicKey(link.topic));
      if (!spelled) {
        const list = [...known.values()];
        throw fail(`topics[${i}]: "${link.topic}" is not a topic of "${content.title}". Its topics are: `
          + `${list.slice(0, 20).join('; ')}${list.length > 20 ? `; and ${list.length - 20} more` : ''}${list.length ? '' : 'none yet'}.`, 400);
      }
      // As the chapter spells it, so one topic is never two spellings.
      link.topic = spelled;
    }
    await repo.setOutcomeTopics(outcome._id, String(cls._id), wanted);
    res.json(await withOutcome(cls, req.viewer, outcome._id));
  } catch (err) {
    next(err);
  }
});

/**
 * Override one question's outcomes in this class: { outcomeIds: [...] } maps it
 * to exactly those (not archived, of this class), in place of its topic's;
 * { exclude: true } keeps it out of every outcome. Kept by the question's id, so
 * it holds through edits to the question, and for answers to it once it is
 * deleted. The question must be one the caller may read. Owner.
 */
router.put('/:id/outcomes/questions/:questionId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const repo = getRepo();
    const qid = String(req.params.questionId ?? '').trim();
    const question = isRecordId(qid) ? await repo.getQuestion(qid) : null;
    const content = question ? await repo.getContent(question.contentId) : null;
    await assertCanRead(req.viewer, question && content ? { ownerId: content.ownerId ?? null } : null, 'That question');
    const { excluded, outcomeIds } = overrideFrom(req.body);

    const outcomes = await repo.listOutcomes(cls._id);
    const byId = new Map(outcomes.map((o) => [String(o._id).toLowerCase(), o]));
    outcomeIds.forEach((id, i) => {
      const o = byId.get(id);
      if (!o) throw fail(`outcomeIds[${i}] is not a course outcome of this class.`, 400);
      if (o.archivedAt) throw fail(`${o.code} is archived; a question cannot be mapped to it.`, 400);
    });
    await repo.setQuestionOverride({
      classId: String(cls._id),
      questionId: String(question._id),
      excluded,
      outcomeIds: outcomeIds.map((id) => String(byId.get(id)._id)),
      updatedBy: req.viewer?.id ?? null,
    });
    res.json(await outcomesBody(cls, req.viewer));
  } catch (err) {
    next(err);
  }
});

/** Remove a question's override: it follows its topic's outcomes again. Owner. */
router.delete('/:id/outcomes/questions/:questionId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    // Ids are stored in lower case (uuids and hex alike), as the question gave it.
    const qid = String(req.params.questionId ?? '').trim().toLowerCase();
    const removed = isRecordId(qid) ? await getRepo().deleteQuestionOverride(String(cls._id), qid) : false;
    if (!removed) throw fail('That question has no override in this class.', 404);
    res.json({
      removed: true,
      questionId: qid,
      message: 'The question follows its topic\'s course outcomes again.',
      ...(await outcomesBody(cls, req.viewer)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Remove one. An outcome with evidence (a counted answer from any of this
 * class's rooms reaches it) is archived, not deleted: its mappings stay, so its
 * evidence is still traced to it and a later report still names it; the reply
 * says so. One with none is deleted with its topic mappings, and taken off any
 * override naming it (an override left naming nothing is removed, and that
 * question follows its topic again; `overridesChanged` lists them). Owner.
 */
router.delete('/:id/outcomes/:outcomeId', async (req, res, next) => {
  try {
    const cls = await writableClass(req.params.id, req.viewer);
    const outcome = await outcomeOf(cls, req.params.outcomeId);
    const repo = getRepo();
    if (outcome.archivedAt) {
      return res.json({
        removed: 'archived', message: `${outcome.code} was already archived.`, ...(await withOutcome(cls, req.viewer, outcome._id)),
      });
    }
    // Every room of the class, not only those the caller may read: whether
    // evidence exists is a fact about the class, and its owner may read them all.
    const coverage = await classCoverage(repo, cls, await repo.listSessionsForClass(cls._id));
    const evidence = coverage.outcomes.find((o) => o.id === String(outcome._id)) ?? { answers: 0, students: 0 };
    if (evidence.answers > 0) {
      await repo.updateOutcome(outcome._id, { archivedAt: new Date().toISOString() });
      return res.json({
        removed: 'archived',
        evidence: { answers: evidence.answers, students: evidence.students },
        message: `${outcome.code} has ${evidence.answers} answer${evidence.answers === 1 ? '' : 's'} from ${evidence.students} `
          + `student${evidence.students === 1 ? '' : 's'} mapped to it, so it was archived, not deleted: its mappings and `
          + 'evidence are kept, and later reports still name it. Restore it with { "archived": false }.',
        ...(await withOutcome(cls, req.viewer, outcome._id)),
      });
    }

    const { links, overrides } = await readOutcomeMap(repo, cls._id);
    const id = String(outcome._id);
    const narrowed = [];
    const freed = [];
    for (const ov of overrides.filter((o) => (o.outcomeIds ?? []).map(String).includes(id))) {
      const rest = ov.outcomeIds.map(String).filter((x) => x !== id);
      if (rest.length) {
        await repo.setQuestionOverride({ ...ov, outcomeIds: rest, updatedBy: req.viewer?.id ?? null });
        narrowed.push(String(ov.questionId));
      } else {
        await repo.deleteQuestionOverride(String(cls._id), String(ov.questionId));
        freed.push(String(ov.questionId));
      }
    }
    const topics = links.filter((l) => String(l.outcomeId) === id).length;
    // As it was, topics included, for the reply to say what went.
    const gone = outcomeView(outcome, links, await chaptersFor(repo, links.filter((l) => String(l.outcomeId) === id), []));
    await repo.deleteOutcome(outcome._id);
    return res.json({
      removed: 'deleted',
      outcome: gone,
      topicsRemoved: topics,
      // Apart from `overrides`, the list as it now stands (outcomesBody).
      overridesChanged: { narrowed, removed: freed },
      message: `${outcome.code} had no answers mapped to it, so it was deleted with its ${topics} topic mapping${topics === 1 ? '' : 's'}.`
        + (freed.length ? ` ${freed.length} question${freed.length === 1 ? ' was' : 's were'} mapped only to it and now `
          + `follow${freed.length === 1 ? 's' : ''} ${freed.length === 1 ? 'its' : 'their'} topic again.` : ''),
      ...(await outcomesBody(cls, req.viewer)),
    });
  } catch (err) {
    return next(err);
  }
});

export default router;
