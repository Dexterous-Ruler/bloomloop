// Whiteboard answers (Batch 9, decision E4): a question of kind 'drawing' is
// answered with a picture the student draws, and may carry their words beside it.
//
// The picture travels on its own before the answer that names it: a phone in a
// room sends it over the room's socket (student:drawing in sockets/index.js),
// the Learning Hub inside its practice attempt (services/hubPractice.js). Either
// way it is kept as an upload in `media` (0014), marked as a drawing (0037), and
// the answer's response is { mediaId, text }.
//
// Three things are decided here and nowhere else:
//   what a drawing is   a PNG or WebP picture, told by its own bytes (the type a
//                       phone claims is never read), at most DRAWING_MAX_BYTES,
//                       with what the drawing app wrote into it beside the pixels
//                       taken out (withoutMetadata in services/media.js). JPEG is
//                       not taken: a drawing has no photograph's reason to be one,
//                       and its blocks smear thin pen lines.
//   whose it is         a room's drawing belongs to the room, the roll number
//                       that sent it and the question it answers; a hub drawing
//                       to the student account that sent it. An answer may name
//                       only a drawing its own sender stored for that question
//                       (drawingRefusal), so no phone can hand in a classmate's.
//   who may see it      staff only, through the image route: whoever may read
//                       the room (or, for a hub drawing, the chapter), and in the
//                       hub the student who drew it. Never a phone, never the
//                       projector, never the rule that serves a professor's
//                       pictures to phones (servedToPhones), and never a
//                       question's stimulus (withUpload refuses one).
//
// A drawing is never marked by the machine. Its answer is stored as
// provisional with the detail AWAITING_DETAIL and goes to the professor's review
// queue; the student's level moves, and attainment counts it, only once a
// professor has marked it (applyReview in services/mastery.js,
// awaitingReview in services/attainment.js).

import crypto from 'node:crypto';

import { isRecordId } from '../ids.js';
import { awaitsReview } from '../questionTypes.js';
import { looksLikeSvg, sniffImage, withoutMetadata } from './media.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();

/**
 * Is this answer row one that still waits for a professor's mark? A final answer
 * of a kind the machine never marks (a drawing), not yet confirmed or
 * overridden. Every reader that counts marks leaves such a row out until then:
 * the ladder (recordAwaiting), attainment, item statistics and confidence counts.
 */
export const awaitingMark = (a) => awaitsReview(a) && a?.final !== false
  && a?.reviewStatus !== 'confirmed' && a?.reviewStatus !== 'overridden';

/** The picture types a drawing may be, as its bytes say. */
export const DRAWING_TYPES = Object.freeze(['image/png', 'image/webp']);

/**
 * The most a drawing may weigh. A phone's whiteboard exported as PNG at screen
 * size is well under this; the cap is for the room's wifi and for the store,
 * where every drawing is a row.
 */
export const DRAWING_MAX_BYTES = 400 * 1024;

/**
 * The longest base64 text a drawing can arrive as, read before anything is
 * decoded: four characters per three bytes, and room for a data URL's prefix.
 */
const MAX_ENCODED = Math.ceil(DRAWING_MAX_BYTES / 3) * 4 + 64;

/** What a screen reader says in place of the picture: a student's drawing has no professor's description. */
export const DRAWING_ALT = 'A drawing a student made as their answer.';

/** The detail stored on a drawing's answer until a professor marks it. */
export const AWAITING_DETAIL = 'waits for your professor';

/** Said to the student beside the answer that was kept. */
export const AWAITING_NOTE = 'Your drawing is saved. Your professor will look at it and mark it; until then it does not count either way.';

/** Said in the hub, where nobody reviews a practice drawing. */
export const HUB_DRAWING_NOTE = 'Your drawing is saved with your practice. Drawings are not marked by the machine, '
  + 'so this one does not count either way; compare it with your notes, or show it to your professor.';

export const DRAWING_TOO_BIG = `That drawing is larger than ${Math.round(DRAWING_MAX_BYTES / 1024)} KB, so it was not saved. `
  + 'Send it again smaller, or draw it again more simply.';
export const DRAWING_NOT_PICTURE = 'That drawing could not be read as a PNG or WebP picture, so it was not saved. Draw it again and send it.';
export const DRAWING_SVG = 'A drawing is sent as a PNG or WebP picture. An SVG can carry script, so it is not taken.';
export const DRAWING_NOT_HERE = 'A drawing can be sent only for the drawing question on your screen. Nothing was saved.';
export const DRAWING_NOT_YOURS = 'That answer names a drawing this device did not save for this question, so it was not taken. '
  + 'Draw it again and send it.';
export const DRAWING_KEY_TAKEN = 'That drawing was sent under an id this device already used for another drawing. '
  + 'Send it again with a new id.';
export const DRAWING_NEEDS_ID = 'A drawing is sent with the id of the answer it belongs to. Nothing was saved.';
export const DRAWING_AGAIN = 'That drawing did not save. It is still on your device and will be sent again.';

/**
 * The most drawings one sender may keep for one question: a room's phone, or a
 * hub student. Enough for every honest redraw and resend; it stops a phone
 * filling the store with pictures.
 */
export const MAX_DRAWINGS_PER_QUESTION = 10;
export const DRAWING_LIMIT = `You have sent ${MAX_DRAWINGS_PER_QUESTION} drawings for this question already, so this one was not saved. `
  + 'Answer with one you have sent.';

/**
 * The most one room may keep in drawings, all its phones together: a count and
 * a weight. Roll numbers are typed, so the per-question cap above is per roll
 * number, and one person holding a room's code could join under roll after roll
 * and fill the store. A class of 300 sending three drawings each at a typical
 * phone size (under 100 KB) stays inside both. Past either, a drawing is refused for good
 * with a sentence telling the student to show it to their professor (their
 * phone keeps it).
 */
export const ROOM_DRAWINGS_MAX = 1500;
export const ROOM_DRAWING_BYTES = 100 * 1024 * 1024;
export const ROOM_DRAWINGS_FULL = 'This room cannot keep any more drawings, so this one was not saved. It is still on your '
  + 'device: show it to your professor.';

/**
 * How many drawings one connection may send in a minute (student:drawing),
 * checked before anything is read or decoded. An outbox replaying a pack after
 * a reconnection sends a handful together; past the rate a drawing is told to
 * be sent again later, never refused for good.
 */
export const DRAWING_RATE = 12;

/** Said in laptop mode, which serves no drawing question (sockets/index.js loadBank). */
export const DRAWING_LAPTOP = 'Drawings cannot be taken in a room run on a laptop, so this one was not saved. It is still on '
  + 'your device: show it to your professor.';

/** Said by bytesOf for text too long to be a drawing, before any of it is decoded. */
const TOO_LONG = Symbol('too long');

/**
 * The bytes of a drawing as sent: a data URL ("data:image/png;base64,..."), bare
 * base64 text, or binary (a Buffer, an ArrayBuffer or a typed array, as a socket
 * delivers a phone's blob). Null when it is none of them; TOO_LONG for text
 * longer than any drawing can be, judged before decoding.
 */
function bytesOf(image) {
  if (Buffer.isBuffer(image)) return image;
  if (image instanceof ArrayBuffer) return Buffer.from(image);
  if (ArrayBuffer.isView(image)) return Buffer.from(image.buffer, image.byteOffset, image.byteLength);
  if (typeof image !== 'string') return null;
  if (image.length > MAX_ENCODED) return TOO_LONG;
  const m = /^data:[^,;]*(?:;[^,;]*)*;base64,(.*)$/s.exec(image.trim());
  const body = (m ? m[1] : image).replace(/\s+/g, '');
  if (!body || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
  return Buffer.from(body, 'base64');
}

/**
 * A drawing as it may be kept, or why not. Pure.
 *
 * @returns {{ ok: true, data: Buffer, mime: string, bytes: number, sha256: string } | { ok: false, message: string, status: number }}
 */
export function readDrawing(image) {
  const raw = bytesOf(image);
  if (raw === TOO_LONG || (raw && raw.length > DRAWING_MAX_BYTES)) return { ok: false, message: DRAWING_TOO_BIG, status: 413 };
  if (!raw || !raw.length) return { ok: false, message: DRAWING_NOT_PICTURE, status: 400 };
  const mime = sniffImage(raw);
  if (!mime || !DRAWING_TYPES.includes(mime)) {
    return { ok: false, message: !mime && looksLikeSvg(raw) ? DRAWING_SVG : DRAWING_NOT_PICTURE, status: 415 };
  }
  const data = withoutMetadata(raw, mime);
  return { ok: true, data, mime, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
}

/** The drawing fields a store row carries, for the comparisons below. */
const sameText = (a, b) => lower(a) === lower(b);

/**
 * At most how many bytes this image can decode to, read without decoding it:
 * a byte array's length, or three bytes for every four characters of base64.
 * Null when it is neither.
 */
function sizeBound(image) {
  if (Buffer.isBuffer(image) || image instanceof ArrayBuffer || ArrayBuffer.isView(image)) return image.byteLength ?? image.length;
  return typeof image === 'string' ? Math.ceil((image.length * 3) / 4) : null;
}

/**
 * May one more drawing come in on this connection now (DRAWING_RATE a minute)?
 * `state` is the socket's own data, changed in place; the clock is handed in.
 */
export function drawingAllowed(state, now) {
  state.drawingTimes = (state.drawingTimes ?? []).filter((t) => now - t < 60000);
  if (state.drawingTimes.length >= DRAWING_RATE) return false;
  state.drawingTimes.push(now);
  return true;
}

/**
 * Keep a phone's drawing for a question in a room. Idempotent by the phone's own
 * id for it: the same id again gives back the drawing it already holds, so a
 * resend from an outbox never stores a second copy.
 *
 * The caller has checked the room, the phone and the question (sockets/index.js,
 * under the student's lock).
 *
 * @returns {Promise<{ media: object, duplicate: boolean }>}
 * @throws a 4xx with a sentence when the picture or the id is refused
 */
export async function keepRoomDrawing(repo, { session, rollNo, questionId, answerKey, image }) {
  const held = await repo.getDrawingByKey({ sessionId: String(session._id), rollNo, answerKey });
  if (held) {
    if (!sameText(held.questionId, questionId)) throw fail(DRAWING_KEY_TAKEN, 409);
    return { media: held, duplicate: true };
  }
  // Every cap is checked before the picture is decoded, so a send past one
  // costs nothing: the room's (one read of its drawings), then this roll
  // number's for this question, from the same read.
  const room = await repo.listDrawings({ sessionId: String(session._id) });
  const weight = room.reduce((n, d) => n + (Number(d.bytes) || 0), 0);
  const bound = sizeBound(image) ?? 0;
  if (room.length >= ROOM_DRAWINGS_MAX || weight + Math.min(bound, DRAWING_MAX_BYTES) > ROOM_DRAWING_BYTES) {
    throw fail(ROOM_DRAWINGS_FULL, 429);
  }
  const mine = room.filter((d) => String(d.rollNo) === String(rollNo) && sameText(d.questionId, questionId));
  if (mine.length >= MAX_DRAWINGS_PER_QUESTION) throw fail(DRAWING_LIMIT, 429);
  const read = readDrawing(image);
  if (!read.ok) throw fail(read.message, read.status);
  return repo.createDrawing({
    ownerId: null,
    accountId: null,
    contentId: session.contentId,
    sessionId: String(session._id),
    rollNo,
    questionId: String(questionId),
    answerKey,
    mime: read.mime,
    bytes: read.bytes,
    sha256: read.sha256,
    data: read.data,
    alt: DRAWING_ALT,
  });
}

/**
 * Keep a signed-in student's practice drawing, by the attempt's own id.
 *
 * @returns {Promise<{ media: object, duplicate: boolean }>}
 */
export async function keepHubDrawing(repo, { accountId, contentId, questionId, answerKey, image }) {
  const held = await repo.getDrawingByKey({ accountId: String(accountId), answerKey });
  if (held) {
    if (!sameText(held.questionId, questionId)) throw fail(DRAWING_KEY_TAKEN, 409);
    return { media: held, duplicate: true };
  }
  // Counted before the picture is decoded. Practice never serves a question
  // whose cap this student has reached (services/hubPractice.js nextQuestion),
  // so an honest device does not meet this.
  const kept = await repo.listDrawings({ accountId: String(accountId), questionId: String(questionId) });
  if (kept.length >= MAX_DRAWINGS_PER_QUESTION) throw fail(DRAWING_LIMIT, 429);
  const read = readDrawing(image);
  if (!read.ok) throw fail(read.message, read.status);
  return repo.createDrawing({
    // A student's drawing has no professor uploader: owner_id stays empty, and
    // account_id (0037) says whose it is, so it goes with their account.
    ownerId: null,
    accountId: String(accountId),
    contentId,
    sessionId: null,
    rollNo: null,
    questionId: String(questionId),
    answerKey,
    mime: read.mime,
    bytes: read.bytes,
    sha256: read.sha256,
    data: read.data,
    alt: DRAWING_ALT,
  });
}

/**
 * Why an answer may not name this drawing, or null when it may: the drawing must
 * be one this room's phone under this roll number stored for this question.
 * "Not there" and "not yours" are one sentence.
 */
export async function drawingRefusal(repo, { mediaId, sessionId, rollNo, questionId }) {
  const id = lower(mediaId);
  const drawing = isRecordId(id) ? await repo.getDrawing(id).catch(() => null) : null;
  if (!drawing || !drawing.sessionId) return DRAWING_NOT_YOURS;
  if (!sameText(drawing.sessionId, sessionId) || String(drawing.rollNo) !== String(rollNo) || !sameText(drawing.questionId, questionId)) {
    return DRAWING_NOT_YOURS;
  }
  return null;
}
