// F2 - the bank builder. Nothing here runs during a live session
// [CONTRACT.md section 6 rule 2].
//
// Two routes, on purpose:
//   POST /preview  - resolve a plan and show it, writing nothing
//   POST /         - run that same plan for real
// Both call planBank(), so the numbers a teacher approves are the numbers they
// get. Before this, the size of a bank was decided by a default nobody chose.

import { Router } from 'express';

import { getRepo } from '../repo/index.js';
import { generateBank } from '../services/generate.js';
import { planBank, describePlan, PRESETS, CONFIRM_ABOVE } from '../services/plan.js';
import { PAYLOAD_FIELDS, KINDS_FOR_LEVEL } from '../questionTypes.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { startRun, updateRun, finishRun, failRun, getRun, cleanRunId } from '../services/runs.js';

const router = Router();

/**
 * Who owns a progress run. An account id when there is one; the legacy key path
 * has no id, so every key holder shares one bucket - which is correct, since
 * they already share one console.
 */
const ownerKeyOf = (req) => String(req.viewer?.id ?? 'legacy-teacher-key');

const fail = (message, status) => Object.assign(new Error(message), { status });

const cleanTopics = (topics, content) =>
  (Array.isArray(topics) ? topics : (content?.topics ?? []))
    .map((t) => String(t ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

/** What the teacher is choosing between, so the UI never hard-codes it. */
router.get('/presets', (_req, res) => {
  res.json({
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, hint: p.hint, mix: p.mix })),
    // The interactions each level may be asked through, straight from the
    // contract, first entry first. The console offers exactly these and nothing
    // else, so what a teacher is allowed to pick cannot drift from what the
    // validator will accept - and a level's set can grow without a client build.
    kindsForLevel: KINDS_FOR_LEVEL,
    confirmAbove: CONFIRM_ABOVE,
  });
});

/** Resolve a plan without writing anything. Drives the live preview. */
router.post('/preview', async (req, res, next) => {
  try {
    const { contentId, topics, plan: spec } = req.body ?? {};
    const repo = getRepo();

    let content = null;
    if (contentId) {
      content = await repo.getContent(contentId).catch(() => null);
      await assertCanRead(req.viewer, content, 'That content');
    }

    const list = cleanTopics(topics, content);
    if (!list.length) throw fail('Select at least one topic first.', 400);

    const plan = planBank(list, spec ?? {});
    res.json({ plan, describe: describePlan(plan), existing: content ? await repo.countQuestions(content._id) : 0 });
  } catch (err) {
    next(err);
  }
});

/**
 * Progress for a run in flight. Polled by the console while the POST below is
 * still open, which is the only way to report on a call that answers once.
 */
router.get('/run/:runId', (req, res, next) => {
  const run = getRun(req.params.runId, ownerKeyOf(req));
  // Same 404 for "no such run" and "not yours", so this cannot be used to find
  // out what somebody else is generating.
  if (!run) return next(Object.assign(new Error('No such run.'), { status: 404 }));
  res.json({ run });
});

router.post('/', async (req, res, next) => {
  let runId = '';
  try {
    const { contentId, topics, plan: spec, mode = 'replace', confirm = false } = req.body ?? {};

    if (!contentId || typeof contentId !== 'string') throw fail('contentId is required.', 400);
    if (topics !== undefined && !Array.isArray(topics)) throw fail('topics must be an array of strings.', 400);
    if (mode !== 'replace' && mode !== 'append') throw fail("mode must be 'replace' or 'append'.", 400);

    const repo = getRepo();
    // A malformed id is a bad request, not a 500 - Mongo throws a CastError here.
    const content = await repo.getContent(contentId).catch(() => null);
    // Generating replaces the bank, so this is a write on someone's material.
    await assertCanWrite(req.viewer, content, 'That content');

    const list = cleanTopics(topics, content);
    // Falling back to the title beats refusing to generate ten minutes before a
    // class because nobody edited the topic list.
    const useTopics = list.length ? list : [String(content.title || 'Chapter').trim()];

    const plan = planBank(useTopics, spec ?? {});
    if (plan.total === 0) throw fail('That plan produces no questions. Raise the total or pick more topics.', 400);
    // A big run is allowed, but the teacher has to have seen the number.
    if (plan.needsConfirm && !confirm) {
      throw fail(
        `That plan is ${plan.total} questions. Send confirm:true if you meant it - anything over ${CONFIRM_ABOVE} takes a while and costs real quota.`,
        409,
      );
    }

    // Opened before the first model call so the very first poll finds it, rather
    // than 404ing for the second or two it takes to get going.
    runId = startRun({
      id: req.body?.runId,
      ownerKey: ownerKeyOf(req),
      total: plan.total,
      topicsTotal: plan.topics?.length ?? useTopics.length,
      perLevel: plan.perLevel,
    });

    const { questions, source, warnings, perLevel } = await generateBank({
      content,
      topics: useTopics,
      plan,
      onProgress: (p) => updateRun(runId, {
        topic: p.topic,
        topicsDone: p.topicsDone,
        topicsTotal: p.topicsTotal,
        written: p.written,
        perLevelDone: p.perLevel,
      }),
    });

    if (!questions.length) throw fail('Generation produced no valid questions.', 502);

    // Replace is the default because "Generate" reads as "make me a bank", not
    // "add another bank on top of the one already there".
    let removed = 0;
    if (mode === 'replace') removed = await repo.deleteQuestions(content._id);

    const inserted = await repo.insertQuestions(
      questions.map((q) => {
        const row = {
          contentId: content._id,
          topic: q.topic,
          text: q.text,
          kind: q.kind ?? 'mcq',
          bloom: q.bloom,
          source: q.source,
          status: 'active',
        };
        // Carry whatever this kind needs. Listing only options/answerIdx here is
        // what silently stripped every match, order, blank and open payload.
        if (Array.isArray(q.options)) row.options = q.options;
        if (Number.isInteger(q.answerIdx)) row.answerIdx = q.answerIdx;
        for (const f of PAYLOAD_FIELDS) if (q[f] !== undefined) row[f] = q[f];
        return row;
      }),
    );

    const bankCount = await repo.countQuestions(content._id);
    finishRun(runId, { written: inserted.length });

    res.json({
      runId,
      bankCount,
      generated: inserted.length,
      removed,
      mode,
      source,
      perLevel,
      plan: { total: plan.total, perLevel: plan.perLevel, perKind: plan.perKind },
      warnings: [...(plan.warnings ?? []), ...(warnings ?? [])],
    });
  } catch (err) {
    // The poller is watching this run and would otherwise sit on "running"
    // forever, showing a clock for work that has already stopped.
    if (runId) failRun(runId, err.message);
    next(err);
  }
});

export default router;
