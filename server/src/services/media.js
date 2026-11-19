// Images a professor uploads to hang a question off, and the rule for who may
// load one.
//
// Three things are decided here and nowhere else:
//   what an upload is   PNG, JPEG or WebP, told by its first bytes. The file name
//                       and the browser's Content-Type are the sender's claim,
//                       and the sender is not the person whose phone renders it.
//   where it is served  /api/media/<id>, the url an image stimulus carries. The
//                       phone already draws `stimulus.url` (learn/Stimulus.jsx),
//                       so an upload needs no new field on the phone.
//   who may load it     a teacher who may read the image's chapter, always; a
//                       phone, which carries no credential, only while a room is
//                       running on that chapter and an approved question there
//                       shows the image (servedToPhones).
//
// The pure half (sniffing, urls) is unit-tested on its own. The half that reads
// the store is handed the repository rather than importing it, so it can be
// tested on an in-process store without a server.

import { isRecordId } from '../ids.js';
import { servableFor } from './selector.js';

/** What may be uploaded, as the type its bytes say it is. SVG is left out on purpose: see sniffImage. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Alt text is a description, not a second passage. */
export const MAX_ALT_CHARS = 1000;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The image type a file's own bytes say it is, or null.
 *
 *   PNG   89 50 4E 47 0D 0A 1A 0A
 *   JPEG  FF D8 FF
 *   WebP  "RIFF", four bytes of length, "WEBP"
 *
 * SVG has no signature: it is a text document, and it can carry script that a
 * browser runs when the file is opened on its own. So it falls through to null
 * with every other file, whatever it is called.
 */
export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * Is this upload a student's drawing (Batch 9, 0037)? Asked of the store's
 * drawing read, so a database without 0037, which holds no drawing, answers no.
 */
export const isDrawing = async (repo, id) => Boolean(await repo.getDrawing(String(id)).catch(() => null));

/** Is this an SVG? Asked only to word the refusal: it is refused either way. */
export const looksLikeSvg = (buf) => Buffer.isBuffer(buf) && /<svg[\s>]/i.test(buf.toString('utf8', 0, 4096));

/* ------------------------------------------------------ metadata in the bytes -- */

/**
 * The image with the metadata its maker wrote into it taken out, pixels untouched.
 *
 * A phone camera writes where a photo was taken (GPS), the camera and its serial
 * number, often the owner's name, and a thumbnail of the uncropped original. An
 * upload is served to every phone in the room and to anyone a student passes the
 * url to, so all of that goes before the bytes are stored. Nothing is decoded or
 * re-encoded - the server has no image library - the file is walked segment by
 * segment and the metadata is left out, so what a browser draws is unchanged.
 *
 *   JPEG  kept: JFIF (APP0), the colour profile (APP2 "ICC_PROFILE"), Adobe's
 *         colour transform (APP14) and every segment that is not an APPn.
 *         Dropped: every other APPn - Exif and XMP (APP1), IPTC (APP13), MPF
 *         (APP2) - comments, and whatever follows the end of the image, where
 *         phones append depth maps, gain maps and motion clips. The one Exif
 *         field that changes the picture, its orientation, is written back on
 *         its own: without it a photo taken upright shows on its side.
 *   PNG   dropped: eXIf, tEXt, zTXt, iTXt and tIME, and whatever follows IEND.
 *   WebP  dropped: the EXIF and XMP chunks, with their flags in VP8X cleared,
 *         and whatever follows the RIFF container.
 *
 * A file that cannot be walked to its end keeps the rest as it was sent, from
 * the point where it stops making sense. Refusing it would refuse pictures a
 * browser draws, and the metadata this is for is written by cameras and
 * editors, whose files do walk. A file with nothing to take out comes back as
 * the very same bytes.
 */
export function withoutMetadata(buf, mime) {
  if (!Buffer.isBuffer(buf)) return buf;
  if (mime === 'image/jpeg') return jpegWithout(buf);
  if (mime === 'image/png') return pngWithout(buf);
  if (mime === 'image/webp') return webpWithout(buf);
  return buf;
}

const startsWith = (body, text) => body.length >= text.length && body.toString('latin1', 0, text.length) === text;

const APP0 = 0xe0;
const APP1 = 0xe1;
const APP2 = 0xe2;
const APP14 = 0xee;
const APP15 = 0xef;
const SOS = 0xda;
const EOI = 0xd9;

/** A JPEG segment to keep: anything but metadata. */
function keepJpegSegment(marker, body) {
  if (marker === 0xfe) return false; // COM, a comment
  if (marker < APP0 || marker > APP15) return true;
  if (marker === APP0) return true;
  if (marker === APP2) return startsWith(body, 'ICC_PROFILE\0');
  if (marker === APP14) return startsWith(body, 'Adobe');
  return false;
}

/** The Exif orientation (2-8) in an APP1 body, or null when there is none or it is upright. */
function exifOrientation(body) {
  if (!startsWith(body, 'Exif\0\0')) return null;
  const t = body.subarray(6);
  const order = t.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const le = order === 'II';
  const u16 = (o) => (o >= 0 && o + 2 <= t.length ? (le ? t.readUInt16LE(o) : t.readUInt16BE(o)) : null);
  const u32 = (o) => (o >= 0 && o + 4 <= t.length ? (le ? t.readUInt32LE(o) : t.readUInt32BE(o)) : null);
  const ifd = u32(4);
  const count = ifd === null ? null : u16(ifd);
  for (let n = 0; n < (count ?? 0); n += 1) {
    const entry = ifd + 2 + n * 12;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 2) === 3 ? u16(entry + 8) : null; // SHORT, held in the entry
      return value >= 2 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** An APP1 segment holding a single Exif field, the orientation. */
function orientationSegment(value) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4); // IFD0 straight after this header
  tiff.writeUInt16LE(1, 8); // one entry
  tiff.writeUInt16LE(0x0112, 10); // Orientation
  tiff.writeUInt16LE(3, 12); // SHORT
  tiff.writeUInt32LE(1, 14); // one value, held in the entry; no next IFD
  tiff.writeUInt16LE(value, 18);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, APP1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
}

function jpegWithout(buf) {
  const out = [buf.subarray(0, 2)]; // SOI, which sniffImage has already seen
  let changed = false;
  let oriented = false;
  let i = 2;
  const asSent = () => (changed ? Buffer.concat([...out, buf.subarray(i)]) : buf);
  while (i < buf.length) {
    if (buf[i] !== 0xff) return asSent();
    let m = i + 1;
    while (m < buf.length && buf[m] === 0xff) m += 1; // fill bytes before a marker
    if (m >= buf.length || buf[m] === 0x00) return asSent();
    const marker = buf[m];
    if (marker === EOI) {
      out.push(buf.subarray(i, m + 1));
      if (m + 1 < buf.length) changed = true;
      return changed ? Buffer.concat(out) : buf;
    }
    // Markers that are the whole segment: restarts, TEM, a stray SOI.
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) {
      out.push(buf.subarray(i, m + 1));
      i = m + 1;
      continue;
    }
    if (m + 3 > buf.length) return asSent();
    const end = m + 1 + buf.readUInt16BE(m + 1); // the length counts its own two bytes
    if (end < m + 3 || end > buf.length) return asSent();
    if (marker === SOS) {
      // The compressed data after a scan header has no length of its own: it
      // runs to the next marker that is not a stuffed zero, a restart or fill.
      let j = end;
      while (j < buf.length) {
        if (buf[j] === 0xff && j + 1 < buf.length) {
          const next = buf[j + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j += 2; continue; }
          if (next === 0xff) { j += 1; continue; }
          break;
        }
        j += 1;
      }
      out.push(buf.subarray(i, j));
      i = j;
      continue;
    }
    const body = buf.subarray(m + 3, end);
    if (keepJpegSegment(marker, body)) {
      out.push(buf.subarray(i, end));
    } else {
      changed = true;
      const orientation = marker === APP1 && !oriented ? exifOrientation(body) : null;
      if (orientation) {
        out.push(orientationSegment(orientation));
        oriented = true;
      }
    }
    i = end;
  }
  return asSent();
}

const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

function pngWithout(buf) {
  const out = [buf.subarray(0, 8)]; // the signature
  let changed = false;
  let i = 8;
  while (i + 12 <= buf.length) {
    const end = i + 12 + buf.readUInt32BE(i); // length, type, data, CRC
    if (end > buf.length) break;
    const type = buf.toString('latin1', i + 4, i + 8);
    if (PNG_METADATA.has(type)) changed = true;
    else out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') {
      if (i < buf.length) changed = true;
      return changed ? Buffer.concat(out) : buf;
    }
  }
  return changed ? Buffer.concat([...out, buf.subarray(i)]) : buf;
}

const WEBP_EXIF_FLAG = 0x08;
const WEBP_XMP_FLAG = 0x04;

function webpWithout(buf) {
  if (buf.length < 12) return buf;
  const riffEnd = 8 + buf.readUInt32LE(4);
  // A container that claims more than the file holds is left as it was sent.
  if (riffEnd > buf.length) return buf;
  const out = [];
  let changed = riffEnd < buf.length;
  let vp8x = -1;
  let i = 12;
  while (i + 8 <= riffEnd) {
    const size = buf.readUInt32LE(i + 4);
    const end = i + 8 + size + (size % 2); // an odd chunk is padded to even
    if (end > riffEnd) break;
    const type = buf.toString('latin1', i, i + 4);
    if (type === 'EXIF' || type === 'XMP ') {
      changed = true;
    } else {
      if (type === 'VP8X') vp8x = out.length;
      out.push(buf.subarray(i, end));
    }
    i = end;
  }
  if (!changed) return buf;
  if (i < riffEnd) out.push(buf.subarray(i, riffEnd));
  if (vp8x >= 0 && out[vp8x].length > 8) {
    // A copy: the upload's own buffer is not written to. VP8X still saying
    // "there is EXIF" over a file with none would send a reader looking for it.
    const chunk = Buffer.from(out[vp8x]);
    chunk[8] &= ~(WEBP_EXIF_FLAG | WEBP_XMP_FLAG);
    out[vp8x] = chunk;
  }
  const body = Buffer.concat(out);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(4 + body.length, 4);
  head.write('WEBP', 8, 'latin1');
  return Buffer.concat([head, body]);
}

const PREFIX = '/api/media/';
const API = '/api/';

/** Stands in for this server when a site-relative url is resolved. `.invalid` never resolves. */
const HERE = 'http://bloomloop.invalid';

/** The url an upload is served at, and the one an image stimulus stores. */
export const mediaUrl = (id) => `${PREFIX}${id}`;

/**
 * Where a browser would send the request for this url: the path with its dot
 * segments resolved, its percent-escapes undone and repeated slashes collapsed,
 * in lower case because Express routes case-insensitively. Also whether the url
 * stays on this site, and whether it carries a query or fragment. Null for
 * anything that is not a url.
 *
 * Judged on this and never on the raw text: /api/./media/<id> and
 * http://<this host>/api/media/<id> both reach the media route, and reading
 * the raw text let them past the same-chapter check.
 */
function resolved(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url.trim(), HERE);
  } catch {
    return null;
  }
  let path = parsed.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A stray % stays as it is: no route decodes it either.
  }
  return {
    path: path.replace(/\/{2,}/g, '/').toLowerCase(),
    local: parsed.origin === HERE,
    plain: !parsed.search && !parsed.hash,
  };
}

/**
 * Does this url point at an upload of ours, or anywhere else in our API?
 *
 *   - any url whose path resolves under /api/media/, ON ANY HOST: an absolute
 *     url may name this server by any of its names (its own host, a custom
 *     domain, a tunnel), and it cannot know them all. Another site's image at
 *     that exact path is refused with them, which costs nothing real.
 *   - a site-relative url anywhere under /api/: nothing else there is an image.
 *
 * Such a url is either one of the chapter's own uploads, stored in canonical
 * spelling, or refused (withUpload). Everything else is an outside image.
 */
export function pointsAtMedia(url) {
  const r = resolved(url);
  return Boolean(r) && (r.path.startsWith(PREFIX) || (r.local && r.path.startsWith(API)));
}

/** The id in an upload's url, or null when what follows the prefix is not an id. */
export function mediaIdFromUrl(url) {
  const r = resolved(url);
  if (!r?.plain || !r.path.startsWith(PREFIX)) return null;
  const id = r.path.slice(PREFIX.length);
  return isRecordId(id) ? id : null;
}

const notFound = () => Object.assign(new Error('That image was not found.'), { status: 404 });

/**
 * A stimulus as it may be stored on a question of chapter `contentId`.
 *
 * An image under /api/media/ must be an upload to this same chapter. That needs
 * the store, so it is checked here: questionTypes.js validates shape and is pure.
 * Without it a question could carry another professor's upload, or one from the
 * same professor's other chapter, which no phone could load anyway, since
 * servedToPhones only counts questions of the image's own chapter. A missing
 * upload and someone else's are one 404, word for word, so ids cannot be probed.
 *
 * The url comes back in its canonical spelling, which is what servedToPhones
 * compares. When the question gives no alt text the upload's is used: the
 * professor described the picture once, when they uploaded it.
 *
 * Anything else (a passage, an outside image, null) comes back as it went in.
 */
export async function withUpload(repo, stimulus, contentId) {
  if (!stimulus || typeof stimulus !== 'object' || stimulus.kind !== 'image' || !pointsAtMedia(stimulus.url)) {
    return stimulus;
  }
  const id = mediaIdFromUrl(stimulus.url);
  const media = id ? await repo.getMedia(id).catch(() => null) : null;
  if (!media || String(media.contentId) !== String(contentId)) throw notFound();
  // A student's drawing (Batch 9) is an upload of the chapter too, and is never
  // a question's picture: every phone in a room would be shown a classmate's
  // answer. The same 404, so a drawing's id says nothing it did not before.
  if (await isDrawing(repo, media._id)) throw notFound();
  const alt = typeof stimulus.alt === 'string' && stimulus.alt.trim() ? stimulus.alt : media.alt;
  // A picture kept from a deck's slide (Batch 8) has no description yet, only
  // a placeholder naming its slide: it is described when it goes on a question.
  if (/\(not yet described\)$/.test(String(alt).trim())) {
    throw Object.assign(new Error('Describe this picture from the slides first: a student who cannot see it gets only that description.'), { status: 400 });
  }
  return { ...stimulus, url: mediaUrl(media._id), alt };
}

/**
 * A room students are in: open, paused with its phones still connected, or
 * waiting to start (0018). A waiting room serves phones nothing yet, but its
 * projector may show a diagram from its questions (services/projector.js), and
 * the projector carries no credential either; the room's phones are shown the
 * same questions the moment it starts.
 */
const RUNNING = ['waiting', 'open', 'paused'];

/**
 * May a phone, or the room's projector, neither of which carries a credential,
 * load this upload now?
 *
 * Only while both hold:
 *   - a room on the upload's chapter is running (waiting, open or paused), and
 *   - an approved question of that chapter shows it.
 *
 * Why this rule. A student joins with a room code and a roll number, and an
 * <img> on the phone sends neither, so the request cannot be tied to a student.
 * What it can be tied to is the question: an image is served to phones exactly
 * while some phone could be shown it. Before a room opens, after it closes, while
 * the image sits on a draft or on nothing at all, the url answers 404 to anyone
 * without a teacher's credential. The id is also unguessable (a random uuid on
 * Supabase, 96 random bits on the other stores), so during a class the picture
 * reaches the people who were shown the question, and whoever they pass the
 * link to, which is no more than a screenshot of the question would reach.
 *
 * The cost: a student's later review of an answer shows the alt text in place of
 * a picture the browser has not kept, which the phone's renderer already does
 * for an image that fails to load.
 */
export async function servedToPhones(repo, media) {
  // A student's drawing (Batch 9) is staff-only: never shown to a phone or the
  // projector, whatever a question's url says.
  if (media.drawing || await isDrawing(repo, media._id)) return false;
  const running = (await repo.listSessionsForContent(media.contentId)).filter((s) => RUNNING.includes(s.status));
  if (!running.length) return false;
  const url = mediaUrl(media._id);
  const showing = (await repo.listQuestions(media.contentId))
    .filter((q) => q.stimulus?.kind === 'image' && q.stimulus.url === url);
  // Per room, through the live loop's own reading of what a room serves
  // (servableFor: approved, and in its question set when it has one), so an
  // image is not handed out by a room that will never show its question.
  return running.some((room) => servableFor(room, showing).length > 0);
}
