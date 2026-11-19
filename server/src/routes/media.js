// Images for question stimuli: a professor uploads one onto a chapter they may
// write, and it is served back to them and to the phones in a running room.
//
// The bytes live in the store itself, not on disk or in a bucket: a bytea column
// on Supabase (0014), a Buffer on Mongo, memory in-process. That is what lets all
// three stores take uploads with no new service, and at a 500 KB ceiling and a
// handful of pictures a chapter, a row is a reasonable place for them.
//
// The deck upload's multer setup in routes/content.js is not reused: it allows
// 25 MB and admits a file by its .pptx name. An image is admitted by its bytes
// alone, under its own limit (config.media.maxBytes).

import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';

import { config } from '../config.js';
import { getRepo } from '../repo/index.js';
import { requireTeacher, verifyAccountToken } from '../auth.js';
import { assertCanWrite, canRead, ownerOf } from '../ownership.js';
import { isRecordId } from '../ids.js';
import { MAX_ALT_CHARS, looksLikeSvg, mediaUrl, servedToPhones, sniffImage, withoutMetadata } from '../services/media.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** Whole kilobytes, as a professor would read the limit. */
const kb = (n) => `${Math.round(n / 1024)} KB`;

/**
 * Multer, built per request so the limit is whatever config says now. Its errors
 * carry a `code`, not a `status`, and would otherwise surface as 500s.
 */
function readImage(req, res, next) {
  if (!req.is('multipart/form-data')) {
    next(fail('Send the image as multipart/form-data: the image in "file", its chapter in "contentId" and a description in "alt".', 400));
    return;
  }
  const max = config.media.maxBytes;
  const upload = multer({
    // Never written to disk: the bytes go straight into the store.
    storage: multer.memoryStorage(),
    // One over: busboy calls the limit hit when the count REACHES fileSize, as it
    // cannot know whether more bytes follow, so `max` itself would refuse an
    // image of exactly the limit. With max + 1 the rule is "at most max".
    limits: { fileSize: max + 1, files: 1, fields: 4, fieldSize: 8 * 1024 },
  });
  upload.single('file')(req, res, (err) => {
    if (!err) {
      next();
      return;
    }
    if (err.code === 'LIMIT_FILE_SIZE') {
      next(fail(`That image is over the ${kb(max)} limit. Every phone in the room downloads it over the same wifi: `
        + 'save it smaller (a screenshot, or an export about 1200 pixels wide, is usually enough).', 413));
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
      next(fail('Send one image, in a field named "file".', 400));
      return;
    }
    if (!err.status) err.status = 400;
    next(err);
  });
}

/**
 * POST /api/media, multipart: `file`, `contentId`, `alt`.
 *
 * The chapter is checked first, before anything about the file is said, so
 * another professor's chapter and one that does not exist get the same 404 and
 * nothing else.
 */
router.post('/', requireTeacher, readImage, async (req, res, next) => {
  try {
    const repo = getRepo();
    const contentId = String(req.body?.contentId ?? '').trim();
    const content = isRecordId(contentId) ? await repo.getContent(contentId).catch(() => null) : null;
    await assertCanWrite(req.viewer, content, 'That content');

    const file = req.file?.buffer;
    if (!file?.length) throw fail('Attach the image in a field named "file".', 400);

    const mime = sniffImage(file);
    if (!mime) {
      throw fail(looksLikeSvg(file)
        ? 'SVG images are not accepted: an SVG can carry script, which would run for anyone who opens it. Export it as PNG.'
        : 'Only PNG, JPEG and WebP images are accepted, and this file is none of them. It was checked by its contents, not its name.',
      415);
    }

    // Required, as the validator requires it of an image stimulus: a student on
    // a screen reader gets the stem, the options, and otherwise nothing where
    // the picture is. Asked for once, here, and copied onto each question that
    // shows the image without its own (services/media.js withUpload).
    const alt = typeof req.body?.alt === 'string' ? req.body.alt.replace(/\s+/g, ' ').trim() : '';
    if (!alt) {
      throw fail('Describe the image in "alt": what a student who cannot see it needs to know to answer.', 400);
    }
    if (alt.length > MAX_ALT_CHARS) throw fail(`"alt" must be at most ${MAX_ALT_CHARS} characters.`, 400);

    // What the camera wrote into the file - where it was taken, the camera's
    // serial, the owner's name - is taken out before anything is kept, so it
    // never reaches a phone. The size and the hash (the ETag) are of what is kept.
    const kept = withoutMetadata(file, mime);
    const media = await repo.createMedia({
      // Stamped from the verified token, never from the request body.
      ownerId: req.viewer?.id ?? null,
      contentId: content._id,
      mime,
      bytes: kept.length,
      sha256: crypto.createHash('sha256').update(kept).digest('hex'),
      data: kept,
      alt,
    });
    res.status(201).json({ media: { ...media, url: mediaUrl(media._id) } });
  } catch (err) {
    next(err);
  }
});

/**
 * May this request read the image as a teacher? Asked only of a request that
 * carries a credential (the x-teacher-key header, ?key=, or a bearer token), and
 * a credential that fails is not an error here: the request is then judged as a
 * phone's, like any other without one. So a credential never sees less than no
 * credential would.
 */
async function teacherMayRead(req, repo, media) {
  const carries = Boolean(req.get('authorization') || req.get('x-teacher-key') || typeof req.query?.key === 'string');
  if (!carries) return false;
  const admitted = await new Promise((resolve) => {
    requireTeacher(req, null, (err) => resolve(!err));
  });
  if (!admitted) return false;
  const content = await repo.getContent(media.contentId).catch(() => null);
  return Boolean(content) && canRead(req.viewer, ownerOf(content));
}

/**
 * May this request read a student's drawing (Batch 9, E4)? Staff only, with a
 * credential: a room's drawing to whoever may read the room, a hub drawing to
 * whoever may read its chapter (its professor, their HOD), and a hub drawing to
 * the signed-in student who drew it. Never a phone's <img>, which carries
 * nothing, and never the image rule that serves a professor's pictures.
 */
async function mayReadDrawing(req, repo, drawing) {
  if (drawing.accountId) {
    const bearer = String(req.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (bearer) {
      const { account } = await verifyAccountToken(bearer).catch(() => ({ account: null }));
      if (account?.role === 'student') return String(account.id) === String(drawing.accountId);
    }
    return teacherMayRead(req, repo, drawing);
  }
  const carries = Boolean(req.get('authorization') || req.get('x-teacher-key') || typeof req.query?.key === 'string');
  if (!carries) return false;
  const admitted = await new Promise((resolve) => {
    requireTeacher(req, null, (err) => resolve(!err));
  });
  if (!admitted) return false;
  const room = await repo.getSession(drawing.sessionId).catch(() => null);
  return Boolean(room) && canRead(req.viewer, ownerOf(room));
}

/**
 * GET /api/media/:id: the image's bytes.
 *
 * Open at the mount, because the phone's <img> sends no credential. Each request
 * is let through by one of two rules: a teacher who may read the image's chapter,
 * or the phone rule in services/media.js (a running room on the chapter, and an
 * approved question there showing the image). Anything else, an id that does not
 * exist included, is the same 404.
 *
 * A student's drawing (Batch 9) is read by its own rule instead (mayReadDrawing):
 * staff of its room or chapter, or the hub student who drew it, never a phone.
 */
router.get('/:id', async (req, res, next) => {
  // Refusals must not be cached: the same url answers 404 before the room opens
  // and the picture once it has.
  res.set('Cache-Control', 'no-store');
  try {
    const repo = getRepo();
    const id = String(req.params.id ?? '').trim().toLowerCase();
    const media = isRecordId(id) ? await repo.getMedia(id).catch(() => null) : null;
    // A database without 0037 holds no drawing, and its read fails: no drawing.
    const drawing = media ? await repo.getDrawing(id).catch(() => null) : null;
    const allowed = Boolean(media) && (drawing
      ? await mayReadDrawing(req, repo, drawing)
      : (await teacherMayRead(req, repo, media)) || (await servedToPhones(repo, media)));
    if (!allowed) throw fail('That image was not found.', 404);

    const full = await repo.getMedia(media._id, { withData: true });
    if (!full?.data?.length) throw fail('That image was not found.', 404);

    res.set({
      'Content-Type': full.mime,
      // The type is the one its bytes were checked to be at upload; this stops a
      // browser second-guessing it.
      'X-Content-Type-Options': 'nosniff',
      // A url never changes its bytes (no update path, and 0014 refuses one), so
      // a phone may keep it. `private`: not a shared cache, which would go on
      // serving it after the room closes. The ETag is the bytes' own hash, so a
      // revalidation is a 304 with nothing sent.
      // A student's drawing (Batch 9) is personal and staff-only: never kept by
      // a browser at all, so a shared staff-room or lab machine cannot show it
      // again to whoever uses that browser next, with nobody asked who they are.
      'Cache-Control': drawing ? 'no-store, private' : 'private, max-age=31536000, immutable',
      ETag: `"${full.sha256}"`,
      // Opened on its own rather than in an <img>, it runs nothing.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    // Express answers If-None-Match with a 304 from the ETag set above.
    res.send(full.data);
  } catch (err) {
    next(err);
  }
});

export default router;
