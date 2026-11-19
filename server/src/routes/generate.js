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
import { generateBank, sourceRefFor } from '../services/generate.js';
import { planBank, describePlan, PRESETS, CONFIRM_ABOVE } from '../services/plan.js';
import { PAYLOAD_FIELDS, KINDS_FOR_LEVEL } from '../questionTypes.js';
import { failedChecks } from '../services/checks.js';
import { draftChecks } from '../services/figureDrafts.js';
import { stampLabels } from '../services/misconceptions.js';
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

/**
 * A room students are in: open, paused with its phones still connected, or
 * waiting to start with its phones joined (as services/media.js). Replacing the
 * bank under a waiting room would leave it nothing to serve when it starts.
 */
const RUNNING = ['waiting', 'open', 'paused'];

/**
 * Which writer ran (Batch 8, M3), from the bank's own source tags: 'templates'
 * when every item came from the built-in writer, 'model' when every one came
 * from the AI model, 'mixed' when the model fell short and templates filled in.
 */
export function writerReport(asked, source) {
  const ran = source === 'llm' ? 'model' : source === 'mixed' ? 'mixed' : 'templates';
  const sentence = {
    templates: asked === 'templates'
      ? 'Written by the built-in templates, as you asked.'
      : 'AI unavailable: written by the built-in templates instead.',
    model: 'Written by the AI model. You approve each one.',
    mixed: 'Written by the AI model, with the built-in templates filling what it did not write. You approve each one.',
  }[ran];
  return { asked, ran, sentence };
}

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
    res.json({
      plan,
      describe: describePlan(plan),
      existing: content ? await repo.countQuestions(content._id) : 0,
      // A replacing generate deletes drafts too, so the screen that warns about
      // the approved questions it replaces should count these as well.
      existingDrafts: content ? await repo.countQuestions(content._id, { status: 'draft' }) : 0,
    });
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
    const { contentId, topics, plan: spec, mode = 'replace', confirm = false, writer = 'auto' } = req.body ?? {};

    if (!contentId || typeof contentId !== 'string') throw fail('contentId is required.', 400);
    // Batch 8 (M3): 'templates' asks for the built-in writer on purpose; 'auto'
    // (the default, as before) uses the AI model when the server has one.
    if (writer !== 'auto' && writer !== 'templates') {
      throw fail('Choose who writes the questions: the AI model when the server has one, or the built-in templates.', 400);
    }
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

    // Replacing deletes the bank and writes drafts, which no room serves until a
    // professor approves them. During a class that would leave every phone in
    // the room with nothing to answer, so it waits for the room to finish.
    // Checked before generating, so a refusal costs no quota.
    if (mode === 'replace') {
      const running = (await repo.listSessionsForContent(content._id)).filter((s) => RUNNING.includes(s.status));
      if (running.length) {
        throw fail(
          `A room on "${content.title}" is running (${running.map((s) => s.code).join(', ')}), and replacing its questions now would leave `
            + 'every phone in it with nothing to answer: new questions wait for your approval. Close the room first, '
            + "or add these to the bank with mode 'append'.",
          409,
        );
      }
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
      templatesOnly: writer === 'templates',
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

    const at = new Date().toISOString();
    const inserted = await repo.insertQuestions(
      questions.map((q) => {
        const row = {
          contentId: content._id,
          topic: q.topic,
          text: q.text,
          kind: q.kind ?? 'mcq',
          bloom: q.bloom,
          source: q.source,
          // Never straight into a room: a professor approves it first
          // (POST /api/bank/question/:id/approve, or approve-all).
          status: 'draft',
          model: q.model,
          sourceRef: sourceRefFor(content, q.topic),
          createdBy: req.viewer?.id ?? null,
        };
        // Carry whatever this kind needs. Listing only options/answerIdx here is
        // what silently stripped every match, order, blank and open payload.
        if (Array.isArray(q.options)) row.options = q.options;
        if (Number.isInteger(q.answerIdx)) row.answerIdx = q.answerIdx;
        for (const f of PAYLOAD_FIELDS) if (q[f] !== undefined) row[f] = q[f];
        // The model's proposed misconception labels (0024), AI drafts from now.
        if (q.misconceptions?.length) row.misconceptions = stampLabels(q.misconceptions, at);
        // The rule checks, and what generation found about a figure and its key.
        row.checks = draftChecks(row, q);
        return row;
      }),
    );

    // bankCount stays what a room can serve: approved questions only.
    const bankCount = await repo.countQuestions(content._id);
    const drafts = await repo.countQuestions(content._id, { status: 'draft' });
    finishRun(runId, { written: inserted.length });

    res.json({
      runId,
      bankCount,
      drafts,
      // How many of the new drafts failed at least one rule check.
      flagged: inserted.filter((q) => failedChecks(q.checks).length > 0).length,
      generated: inserted.length,
      removed,
      mode,
      source,
      // Batch 8 (M3): which writer was asked for and which ran, in words.
      writer: writerReport(writer, source),
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
