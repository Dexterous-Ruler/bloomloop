// Figures (Batch 8): the professor's side of the figure engines.
//
// A figure reaches a phone only as a question's stimulus (or a lesson step),
// through the routes that already save those, and is drawn by the server
// (src/figures). The routes here are what the professor's screens need around
// that: a preview while a figure is being described, what the engines accept,
// the pictures kept from a deck's slides, a printable page of a chapter's
// figure questions, and a stepped figure added to a Learning Hub lesson.
//
// Two routers, because they sit behind two different gates: `figureRoutes` at
// /api/figures behind requireTeacher (staff, with the teacher key or a staff
// sign-in; an HOD reads), and `lessonFigureRoutes` at /api/hub behind the hub's
// gate (accounts only). Nothing here is a phone's.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { assertCanRead } from '../ownership.js';
import { isRecordId } from '../ids.js';
import { hubGate } from './hub.js';
import { READ_ONLY, assertStaff, hubChapter } from '../services/hubAccess.js';
import { staffLessonView, withLock } from '../services/hubLessons.js';
import { escapeHtml } from '../services/printable.js';
import { mediaUrl } from '../services/media.js';
import { slidePicturesNote } from '../services/slideImages.js';
import { servableFor } from '../services/selector.js';
import {
  FIGURE_TYPES, LIMITS, checkFigure, figureAtStep, figureForStaff,
} from '../figures/index.js';
import { forStudent } from '../questionTypes.js';
import {
  EMPTY_GRAPH, emptyGraph, ARROWS, CHARTS, EDGE_STYLES, FAMILIES, LAYOUTS, OPTICS, PATTERN_COLOURS, PATTERN_FILLS, PATTERN_SHAPES, SHAPES, STEPPED_TYPES,
} from '../figures/spec.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export const figureRoutes = express.Router();

/**
 * What the engines accept, so the editor offers exactly that: the types, the
 * function families and their numbers, the chart kinds, shapes, layouts and the
 * caps. Read from the validator's own lists, so the two cannot drift apart.
 */
figureRoutes.get('/kinds', (_req, res) => {
  res.json({
    types: FIGURE_TYPES,
    stepped: STEPPED_TYPES,
    families: FAMILIES,
    charts: CHARTS,
    diagram: { layouts: LAYOUTS, shapes: SHAPES, lines: EDGE_STYLES, arrows: ARROWS },
    optics: OPTICS,
    pattern: { shapes: PATTERN_SHAPES, fills: PATTERN_FILLS, colours: PATTERN_COLOURS },
    limits: LIMITS,
    note: 'A figure is described, never drawn by hand: the server draws it, with its description and data table, '
      + 'and every phone, the projector and printed pages show that same drawing.',
  });
});

/**
 * Draw a figure without saving it: the editor's live preview. The same check a
 * save goes through, so a figure that previews is one that saves. `step` shows
 * one step lit up (0 is the figure itself).
 */
figureRoutes.post('/preview', async (req, res, next) => {
  try {
    const checked = await checkFigure(req.body?.spec);
    if (checked.reason) throw fail(checked.reason, 400);
    const step = Number.isInteger(req.body?.step) ? req.body.step : 0;
    const view = figureForStaff(checked.spec);
    if (step < 0 || step > view.stepCount) {
      throw fail(`This figure has ${view.stepCount} step${view.stepCount === 1 ? '' : 's'}: choose one from 0 to ${view.stepCount}.`, 400);
    }
    res.json({
      spec: checked.spec,
      figure: view,
      ...(step ? { atStep: figureAtStep(checked.spec, step) } : {}),
    });
  } catch (err) {
    next(err);
  }
});

/** A chapter the viewer may read, or the one 404. */
async function readableChapter(repo, viewer, rawId) {
  const id = String(rawId ?? '').trim();
  const content = isRecordId(id) ? await repo.getContent(id).catch(() => null) : null;
  await assertCanRead(viewer, content, 'That content');
  return content;
}

/**
 * The pictures kept from the chapter's slides, in slide order, each with the
 * url an image stimulus carries. A chapter from before pictures were kept says
 * so, in a sentence.
 */
figureRoutes.get('/content/:contentId/slide-pictures', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await readableChapter(repo, req.viewer, req.params.contentId);
    const [rows, summary] = await Promise.all([
      repo.listSlideMedia(content._id).catch(() => []),
      repo.getContentSlidePictures(content._id).catch(() => null),
    ]);
    res.json({
      pictures: rows.map((m) => ({
        id: String(m._id), url: mediaUrl(m._id), slide: m.slideNo, mime: m.mime, bytes: m.bytes, alt: m.alt,
      })),
      kept: Boolean(summary),
      summary: summary ?? null,
      note: slidePicturesNote(summary, rows.length),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A printable page of the chapter's approved questions that carry a figure:
 * each question's text, its figure as phones see it (the same drawing) and its
 * data table. No answers: it is for a class to work from.
 */
figureRoutes.get('/content/:contentId/print', async (req, res, next) => {
  try {
    const repo = getRepo();
    const content = await readableChapter(repo, req.viewer, req.params.contentId);
    const served = servableFor({ questionIds: null }, await repo.listQuestions(content._id));
    const withFigures = served.filter((q) => q.stimulus?.kind === 'figure');
    const items = withFigures.map((q, i) => {
      // As a phone gets it: a tap or label figure is drawn with its parts under
      // tokens, so the page carries no part's name in its markup either.
      const f = forStudent(q, `print:${q._id}`).stimulus;
      const table = f.table
        ? `<table><caption>${escapeHtml(f.table.caption)}</caption><thead><tr>${f.table.columns.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join('')}</tr></thead>`
          + `<tbody>${f.table.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
        : '';
      // The SVG is the server's own drawing, already checked element by element (figures/common.js safeSvg).
      return `<section><h2>${i + 1}. ${escapeHtml(q.text)}</h2><figure>${f.svg ?? `<p>${escapeHtml(f.description)}</p>`}`
        + `<figcaption>${escapeHtml(f.description)}</figcaption></figure>${table}</section>`;
    });
    const body = items.length ? items.join('') : '<p>No approved question in this chapter carries a figure yet.</p>';
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>${escapeHtml(content.title)}: figures</title>`
      + '<style>body{font-family:Manrope,"Noto Sans Devanagari",system-ui,sans-serif;color:#1F2A24;margin:24px;max-width:820px}'
      + 'section{break-inside:avoid;margin:0 0 28px}h1{font-size:20px}h2{font-size:15px;font-weight:600}svg{max-width:100%;height:auto}'
      + 'figcaption{font-size:12px;color:#585C63;margin-top:6px}table{border-collapse:collapse;font-size:12px;margin-top:8px}'
      + 'th,td{border:1px solid #D5D8D2;padding:3px 8px;text-align:left}caption{text-align:left;font-weight:600;padding-bottom:4px}</style></head>'
      + `<body><h1>${escapeHtml(content.title)}: questions with figures</h1>${body}</body></html>`);
  } catch (err) {
    next(err);
  }
});

/* ---------------------------------------------------- lessons (the hub) -- */

export const lessonFigureRoutes = express.Router();
lessonFigureRoutes.use(hubGate);

const LESSON_NOT_FOUND = 'That lesson was not found.';

/**
 * Add a figure to a lesson (gap H9c): { spec, text?, after?, slides? }. `text`
 * is the words shown beside it; `after` is the step it follows (-1 for the
 * start; the end when left out). A lesson students
 * read is never changed under them: this writes a NEW draft version with the
 * figure in it, which students read only once the professor approves it, as a
 * regenerated lesson is (decision H11). The chapter's owner only; an HOD reads.
 */
lessonFigureRoutes.post('/lessons/:lessonId/figures', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const id = String(req.params.lessonId ?? '').trim();
    const lesson = isRecordId(id) ? await repo.getTopicLesson(id) : null;
    if (!lesson) throw fail(LESSON_NOT_FOUND, 404);
    let ctx;
    try {
      ctx = await hubChapter(repo, req.viewer, lesson.contentId);
    } catch (err) {
      if (err.status === 404) throw fail(LESSON_NOT_FOUND, 404);
      throw err;
    }
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    if (lesson.status === 'discarded' || lesson.status === 'superseded') {
      throw fail('That version is no longer in use: add the figure to the current draft or the approved lesson.', 409);
    }
    const checked = await checkFigure(req.body?.spec);
    if (checked.reason) throw fail(`The figure was not added: ${checked.reason}`, 400);
    // Empty axes are only the board a plot question is answered on; in a lesson they show nothing.
    if (emptyGraph(checked.spec)) throw fail(`The figure was not added: ${EMPTY_GRAPH}`, 400);
    const steps = Array.isArray(lesson.steps) ? lesson.steps : [];
    const after = req.body?.after === undefined ? steps.length - 1 : req.body.after;
    if (!Number.isInteger(after) || after < -1 || after >= steps.length) {
      throw fail(`Choose where the figure goes: after one of the lesson's ${steps.length} steps, or at the start.`, 400);
    }
    const slides = Array.isArray(req.body?.slides) ? req.body.slides.filter((n) => Number.isInteger(n) && n >= 1).slice(0, 20) : [];
    const said = typeof req.body?.text === 'string' ? req.body.text.replace(/\s+/g, ' ').trim() : '';
    if (said.length > 500) throw fail('The words beside the figure must be at most 500 characters.', 400);
    // A chunk step carrying the figure, with the words beside it (its title when
    // none are given): a lesson's steps are chunks, examples and questions
    // (0027), and a chunk's words are translated like any other.
    const step = { type: 'chunk', slides, text: said || checked.spec.title || 'Figure', figure: checked.spec };
    const made = await withLock(`lesson:${lesson.topicId}`, async () => {
      const versions = (await repo.listTopicLessons({ topicId: lesson.topicId })).map((l) => l.version);
      return repo.createTopicLesson({
        topicId: lesson.topicId,
        contentId: lesson.contentId,
        ownerId: lesson.ownerId ?? null,
        version: Math.max(0, ...versions) + 1,
        source: lesson.source,
        model: lesson.model ?? null,
        steps: [...steps.slice(0, after + 1), step, ...steps.slice(after + 1)],
        basis: lesson.basis ?? {},
        warnings: lesson.warnings ?? [],
        // The concept panel's sections (0035) go with the rest of the version: a
        // figure added to an AI lesson must not drop its introduction, facts,
        // explanation, code example or common mistakes. Only when there are some,
        // as on a slides-only lesson there are none to carry.
        ...(lesson.sections ? { sections: lesson.sections } : {}),
        createdBy: req.viewer.id ?? null,
      });
    });
    res.status(201).json({
      lesson: await staffLessonView(repo, made),
      message: `A new draft, version ${made.version}, holds the figure. Students go on reading the approved version until you approve this one.`,
    });
  } catch (err) {
    next(err);
  }
});
