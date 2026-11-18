// F1 - one endpoint, two ways in: a .pptx upload or a pasted syllabus. The
// teacher should never have to pick a different button for the same job, so the
// path is chosen from the request's own content type rather than the URL.

import express from 'express';
import multer from 'multer';
import path from 'node:path';

import { getRepo } from '../repo/index.js';
import { extractFromPptx, extractFromText, MAX_TOPICS } from '../services/extract.js';
import { isRecordId } from '../ids.js';
import { assertCanRead, assertCanWrite, readable } from '../ownership.js';

const router = express.Router();

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const upload = multer({
  // Decks are read once and thrown away - nothing is worth writing to disk on a
  // laptop that is about to be carried into a lecture hall.
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (!/\.pptx$/i.test(file.originalname ?? '')) {
      cb(
        Object.assign(
          new Error('Only .pptx files can be read. Save a .ppt or .pdf as .pptx and try again.'),
          { status: 400 },
        ),
      );
      return;
    }
    cb(null, true);
  },
});

// Multer's own errors carry a `code`, not a `status`, so they would surface as
// 500s from the app error handler unless they are translated here.
function readUpload(req, res, next) {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      next(Object.assign(new Error('That deck is over the 25 MB limit.'), { status: 413 }));
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      next(Object.assign(new Error('Send one deck, in a field named "file".'), { status: 400 }));
      return;
    }
    if (!err.status) err.status = 400;
    next(err);
  });
}

function titleFromFilename(originalname) {
  const name = String(originalname ?? '');
  const base = path.basename(name, path.extname(name)).trim();
  return base || 'Untitled deck';
}

// A malformed id fails differently in each store: Mongo throws a CastError,
// Postgres rejects the uuid syntax, the in-memory store just misses. All three
// mean the caller asked for something that is not there - a 404, not a server
// fault - so the shape is checked up front and the store errors are mapped too.
async function lookup(op, id, ...rest) {
  if (!isRecordId(id)) return null;
  try {
    return await getRepo()[op](id, ...rest);
  } catch (err) {
    const message = String(err?.message ?? '');
    if (err?.name === 'CastError' || err?.kind === 'ObjectId') return null;
    if (/invalid input syntax for type uuid/i.test(message)) return null;
    throw err;
  }
}

/** Teacher-supplied topic lists get the same trim/de-dup/cap treatment as extracted ones. */
function tidyTopics(list) {
  const topics = [];
  const seen = new Set();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const topic = raw.replace(/\s+/g, ' ').trim();
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
    if (topics.length >= MAX_TOPICS) break;
  }
  return topics;
}

router.post('/', readUpload, async (req, res, next) => {
  try {
    const repo = getRepo();

    if (req.file) {
      // ?ocr=off skips reading the pictures even when the text pass finds
      // nothing, and ?ocr=force reads them even when it does - for a deck whose
      // text layer exists but is garbage. Default is auto: pictures only when
      // there was no text to find.
      const mode = ['off', 'force', 'auto'].includes(String(req.query.ocr))
        ? String(req.query.ocr)
        : 'auto';

      const { rawText, topics, topicSlides, slideCount, readBy, ocr, warnings } = await extractFromPptx(
        req.file.buffer,
        { ocr: mode },
      );
      const content = await repo.createContent({
        title: titleFromFilename(req.file.originalname),
        kind: 'pptx',
        rawText,
        topics,
        // The deck itself is thrown away after this request, so the slide each
        // topic came from has to be kept now or never: generation runs later and
        // stamps it on every question (questions.source_ref).
        topicSlides,
        // Stamped from the verified token, never from the request body.
        ownerId: req.viewer?.id ?? null,
      });
      res.status(201).json({
        contentId: content._id,
        title: content.title,
        kind: content.kind,
        topics: content.topics,
        slideCount,
        chars: rawText.length,
        // 'ocr' means the words came out of the pictures, which is worth saying
        // out loud: the teacher should skim those topics harder than parsed ones.
        readBy,
        ocr: ocr ?? null,
        warnings: warnings ?? [],
      });
      return;
    }

    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      throw Object.assign(
        new Error('Nothing to ingest - attach a .pptx file or paste some syllabus text.'),
        { status: 400 },
      );
    }

    const { rawText, topics } = extractFromText(text);
    const given = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const content = await repo.createContent({
      title: given || 'Pasted syllabus',
      kind: 'syllabus',
      rawText,
      topics,
      ownerId: req.viewer?.id ?? null,
    });

    res.status(201).json({
      contentId: content._id,
      title: content.title,
      kind: content.kind,
      topics: content.topics,
      chars: rawText.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const repo = getRepo();
    // Scoped before anything else: this list hands out the contentIds that
    // reach the question bank, so an unfiltered list is a route into every
    // other teacher's answer keys.
    const contents = await readable(req.viewer, await repo.listContents());
    // The picker is useless without knowing which decks already have a bank.
    const rows = await Promise.all(
      contents.map(async (content) => ({
        _id: content._id,
        title: content.title,
        kind: content.kind,
        topics: content.topics ?? [],
        createdAt: content.createdAt,
        // Approved questions, the ones a room can serve.
        questionCount: await repo.countQuestions(content._id),
        // Generated and waiting for approval. Without it a freshly generated
        // deck reads as having no bank, and generating again (which replaces
        // the bank) would throw the drafts away.
        draftCount: await repo.countQuestions(content._id, { status: 'draft' }),
      })),
    );
    res.json({ contents: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const content = await lookup('getContent', req.params.id);
    await assertCanRead(req.viewer, content, 'That content');
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!Array.isArray(req.body?.topics)) {
      throw Object.assign(new Error('Send { topics: [String] }.'), { status: 400 });
    }
    // Check ownership BEFORE writing, not after: updateContent would otherwise
    // have already overwritten another teacher's topic list by the time we
    // discovered it was not ours.
    const existing = await lookup('getContent', req.params.id);
    await assertCanWrite(req.viewer, existing, 'That content');

    const content = await lookup('updateContent', req.params.id, {
      topics: tidyTopics(req.body.topics),
    });
    if (!content) throw Object.assign(new Error('No such content.'), { status: 404 });
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

export default router;
