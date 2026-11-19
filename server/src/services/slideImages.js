// The pictures on a deck's slides, kept as uploads of the chapter (Batch 8, 0033).
//
// For what code cannot draw - anatomy, apparatus, specimens, maps, engineering
// drawings - the figure is the professor's own picture, and the deck already
// holds them. Until now the server read slide pictures only to pull text out of
// them (OCR) and threw them away. Now each PNG, JPEG or WebP picture a slide
// shows is kept as an ordinary upload of the chapter (media), with the slide it
// was on, so a professor can hang it off a question as an image stimulus.
//
// The same rules as an upload: the type is told by the bytes, never the file
// name (an SVG or anything else is skipped, and counted); the size limit is the
// upload limit, since every phone in a room downloads it; and what a camera or
// an editor wrote into the file is taken out before it is kept.
//
// Each picture is kept once, at the first slide that shows it: a logo on every
// slide is one picture, not forty, and the same bytes stored under two names in
// the deck are one picture too. Pictures are linked to slides through each
// slide's relationship file, because ppt/media is shared and de-duplicated and
// its order says nothing about which slide shows what. A relationship's target
// is read as the package format allows it to be written: relative to the slide
// ("../media/image1.png") or absolute from the package's root
// ("/ppt/media/image1.png"), with its attributes in either quote. A picture a
// slide names that the deck does not hold is counted, so the professor is told.

import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

import { sniffImage, withoutMetadata } from './media.js';

/** At most this many pictures are kept from one deck: more is clip art, and every one is a row of bytes. */
export const MAX_SLIDE_PICTURES = 60;

const SLIDE = /^ppt\/slides\/slide(\d+)\.xml$/i;
const RELS = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/i;
const REL = /<Relationship\b([^>]*)\/?>/g;
const attr = (s, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(s);
  return m ? (m[1] ?? m[2]) : null;
};

/**
 * The package part a slide's relationship points at, as a key into the deck's
 * entries (lower case), or null when it leaves the package. Relative targets
 * are read from the slide's own folder (ppt/slides); absolute ones from the root.
 */
function partOf(target) {
  let t = String(target ?? '').trim().replace(/\\/g, '/');
  if (!t || /^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  // Part names in a target are written as a URI ("my%20chart.png").
  try {
    t = decodeURIComponent(t);
  } catch {
    // Not percent-encoded after all: read as written.
  }
  const resolved = t.startsWith('/') ? path.posix.normalize(t).slice(1) : path.posix.join('ppt/slides', t);
  if (!resolved || resolved.startsWith('..') || resolved.startsWith('/')) return null;
  return resolved.toLowerCase();
}

/** The alt text a kept picture starts with, until a professor describes it on a question. */
export const slideAlt = (n) => `Picture from slide ${n} (not yet described)`;

/**
 * The deck's pictures, slide by slide, ready to keep. Never throws: a deck that
 * cannot be read keeps no pictures, and says so in the summary.
 *
 * @returns {{ pictures: { slideNo: number, mime: string, data: Buffer, bytes: number, sha256: string }[],
 *   summary: { kept: number, skippedType: number, skippedLarge: number, skippedOver: number, skippedMissing: number, slides: number[] } }}
 */
export function slidePictures(buffer, { maxBytes }) {
  const summary = { kept: 0, skippedType: 0, skippedLarge: 0, skippedOver: 0, skippedMissing: 0, slides: [] };
  let entries;
  try {
    entries = new AdmZip(buffer).getEntries();
  } catch {
    return { pictures: [], summary: { ...summary, unreadable: true } };
  }
  const byName = new Map(entries.map((e) => [String(e.entryName ?? '').replace(/\\/g, '/').toLowerCase(), e]));
  // The deck's own slide numbers, renumbered 1..n in order, as the text pass numbers them.
  const fileNos = entries.map((e) => SLIDE.exec(String(e.entryName ?? '').replace(/\\/g, '/'))).filter(Boolean).map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  const position = new Map(fileNos.map((n, i) => [n, i + 1]));
  const rels = entries.map((e) => ({ e, m: RELS.exec(String(e.entryName ?? '').replace(/\\/g, '/')) }))
    .filter((x) => x.m && position.has(Number(x.m[1])))
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]));

  const seen = new Set();
  const sameBytes = new Set();
  const pictures = [];
  for (const { e, m } of rels) {
    const slideNo = position.get(Number(m[1]));
    let xml = '';
    try {
      xml = e.getData().toString('utf8');
    } catch {
      continue;
    }
    for (const rel of xml.matchAll(REL)) {
      const type = attr(rel[1], 'Type') ?? '';
      const target = attr(rel[1], 'Target') ?? '';
      if (!/\/image$/i.test(type) || attr(rel[1], 'TargetMode') === 'External') continue;
      const key = partOf(target);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      const entry = key ? byName.get(key) : null;
      if (!entry || entry.isDirectory) {
        summary.skippedMissing += 1;
        continue;
      }
      let data;
      try {
        data = entry.getData();
      } catch {
        summary.skippedType += 1;
        continue;
      }
      const mime = sniffImage(data);
      if (!mime) {
        summary.skippedType += 1;
        continue;
      }
      const kept = withoutMetadata(data, mime);
      if (kept.length > maxBytes) {
        summary.skippedLarge += 1;
        continue;
      }
      // The same picture under a second name in the deck: kept once, at its first slide.
      const sha256 = crypto.createHash('sha256').update(kept).digest('hex');
      if (sameBytes.has(sha256)) continue;
      sameBytes.add(sha256);
      if (pictures.length >= MAX_SLIDE_PICTURES) {
        summary.skippedOver += 1;
        continue;
      }
      pictures.push({ slideNo, mime, data: kept, bytes: kept.length, sha256 });
    }
  }
  summary.kept = pictures.length;
  summary.slides = [...new Set(pictures.map((p) => p.slideNo))];
  return { pictures, summary };
}

/**
 * Keep the deck's pictures on its chapter, and what was kept. Called after the
 * chapter is made; never throws, so a store without 0033 (or any failure here)
 * costs the pictures and nothing else: the upload has already succeeded.
 *
 * @returns {Promise<object|null>} the summary, or null when nothing could be kept
 */
export async function keepSlidePictures(repo, { content, buffer, ownerId = null, maxBytes }) {
  try {
    const { pictures, summary } = slidePictures(buffer, { maxBytes });
    for (const p of pictures) {
      await repo.createSlideMedia({ ownerId, contentId: content._id, mime: p.mime, bytes: p.bytes, sha256: p.sha256, data: p.data, alt: slideAlt(p.slideNo), slideNo: p.slideNo });
    }
    await repo.setContentSlidePictures(content._id, { ...summary, keptAt: new Date().toISOString() });
    return summary;
  } catch (err) {
    console.error('[content] the deck\'s slide pictures were not kept:', err.message);
    return null;
  }
}

/** The sentence a professor reads about a chapter's slide pictures. */
export function slidePicturesNote(summary, count) {
  if (!summary) {
    return 'This chapter was uploaded before slide pictures were kept, or was typed in, so it has none. Upload the deck again to keep its pictures.';
  }
  const skipped = [];
  if (summary.skippedType) skipped.push(`${summary.skippedType} of a kind phones are not sent (only PNG, JPEG and WebP are)`);
  if (summary.skippedLarge) skipped.push(`${summary.skippedLarge} too large to send to every phone`);
  if (summary.skippedOver) skipped.push(`${summary.skippedOver} past the first ${MAX_SLIDE_PICTURES}`);
  if (summary.skippedMissing) skipped.push(`${summary.skippedMissing} that a slide names but the file does not hold`);
  const kept = count === 0 ? 'No pictures were kept from this deck\'s slides.' : `${count} picture${count === 1 ? '' : 's'} kept from this deck's slides.`;
  return `${kept}${skipped.length ? ` Left out: ${skipped.join('; ')}.` : ''} Describe a picture when you put it on a question: students who cannot see it get only that description.`;
}
