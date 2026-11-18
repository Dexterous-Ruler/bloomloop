// F1 - ingestion. Everything downstream (topic picker, generator, question bank)
// only ever sees what this module produced, so it is deliberately defensive: a
// slide made of pictures, a chart with no cached text, a table, speaker notes or
// one corrupt part must degrade to "nothing came out of that slide" and never to
// a thrown request. [TC-01]
//
// A .pptx is a zip. The slide text we want lives in ppt/slides/slideN.xml as
// <a:t> runs inside <a:p> paragraphs - no XML parser needed, and none is
// installed, so this walks the markup with one ordered scan.

import AdmZip from 'adm-zip';

import { ocrDeck, hasUsableText } from './ocr.js';

/** Hard cap on the topic list - a teacher will not curate more than this before a class. */
export const MAX_TOPICS = 40;

const MIN_TOPIC_CHARS = 3;

// A "title" longer than this is a paragraph of body text that happened to sit
// first on the slide. Dropping it beats feeding a sentence to the generator as
// if it were a topic; the teacher can still add it by hand via PATCH /:id.
const MAX_TOPIC_CHARS = 160;

// A line that shows up on more than this share of slides is a running header or
// footer (unit name, lecturer, university), not a topic.
const BOILERPLATE_RATIO = 0.6;

// Below this many slides/sections "appears on most of them" is meaningless and
// would throw away genuine repeats.
const BOILERPLATE_MIN_GROUPS = 5;

const SLIDE_ENTRY = /^ppt\/slides\/slide(\d+)\.xml$/i;

// Ordered scan: a text run, a hard break, or the end of a paragraph. The last
// two are the only places a line break exists in DrawingML.
const RUN_OR_BREAK = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*>|<\/a:p>/g;

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Leading bullet glyphs and list numbering, e.g. "3. ", "c) ", "iv) ", "- ".
const LIST_MARKER = /^(?:[-*•·▪◦–—>»]+|\(?\d{1,3}[.)]|[a-z][.)]|[ivxlcdm]+[.)])\s+/i;

// "Unit 3:", "Chapter II -", "Module 2)" ... the subject matter after it is the topic.
const SECTION_PREFIX =
  /^(?:unit|module|chapter|week|topic|section|part|lesson|lecture)\s*[-–—]?\s*(?:\d{1,3}|[ivxlcdm]+)?\s*[:.)\-–—]\s*/i;

// Splits a one-line paste such as "1. Arrays 2. Stacks - Queues" into items.
// Both sides of a dash must be spaced so hyphenated words survive intact.
const INLINE_MARKER =
  /(?=\s(?:\d{1,3}[.)]\s|[-–—*•]\s|(?:unit|module|chapter|week|section|part|lesson)\s*(?:\d{1,3}|[ivxlcdm]+)\s*[:.)\-–—]))/i;

// Slides that exist to frame the deck rather than teach anything. Keys are in
// the normalised form produced by topicKey().
const NON_TOPICS = new Set([
  'thank you',
  'thank you for your attention',
  'thanks',
  'thanks for listening',
  'questions',
  'question',
  'any questions',
  'q a',
  'outline',
  'course outline',
  'contents',
  'table of contents',
  'agenda',
  'references',
  'reference',
  'bibliography',
  'further reading',
  'acknowledgements',
  'acknowledgments',
  'objectives',
  'learning objectives',
  'course objectives',
  'summary',
  'conclusion',
  'conclusions',
  'recap',
  'syllabus',
  'course syllabus',
  'the end',
  'end',
]);

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Lone surrogates and out-of-range values make fromCodePoint throw.
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** Collapse the whitespace soup PowerPoint emits into clean, non-empty lines. */
function tidyLines(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u000b\u2028\u2029]/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function textFromSlideXml(xml) {
  let out = '';
  for (const match of xml.matchAll(RUN_OR_BREAK)) {
    out += match[1] === undefined ? '\n' : decodeEntities(match[1]);
  }
  return tidyLines(out);
}

/** Case- and punctuation-insensitive identity for a topic, unicode-safe. */
function topicKey(topic) {
  return topic
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cleanTopic(line) {
  let topic = String(line ?? '').replace(/\s+/g, ' ').trim();
  if (!topic) return '';
  topic = topic.replace(LIST_MARKER, '');
  topic = topic.replace(SECTION_PREFIX, '');
  topic = topic.replace(/[\s:;,.–—-]+$/, '');
  return topic.trim();
}

function isJunk(topic, key) {
  if (topic.length < MIN_TOPIC_CHARS || topic.length > MAX_TOPIC_CHARS) return true;
  if (!key) return true;
  // Slide numbers, dates and rule lines carry no letters at all.
  if (!/\p{L}/u.test(topic)) return true;
  return NON_TOPICS.has(key);
}

/**
 * Lines a single slide (or a single pasted section) offers as its topic, best
 * first. Passing the whole slide - not just its title - means a deck whose
 * every slide starts with a running header still yields real topics.
 */
function candidateLines(item) {
  if (typeof item === 'string') return [item];
  if (!item || typeof item !== 'object') return [];
  const title = typeof item.title === 'string' ? [item.title] : [];
  const body = typeof item.text === 'string' ? item.text.split('\n') : [];
  return [...title, ...body];
}

function boilerplateKeys(groups) {
  const repeated = new Set();
  if (groups.length < BOILERPLATE_MIN_GROUPS) return repeated;

  const counts = new Map();
  for (const lines of groups) {
    // Count each line once per slide, so a word repeated inside one slide is
    // not mistaken for a header.
    const here = new Set();
    for (const line of lines) {
      const topic = cleanTopic(line);
      if (topic) here.add(topicKey(topic));
    }
    for (const key of here) counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const limit = groups.length * BOILERPLATE_RATIO;
  for (const [key, count] of counts) {
    if (count > limit) repeated.add(key);
  }
  return repeated;
}

/**
 * Turn slides ([{n, title, text}]) or plain sections ([String]) into the
 * de-duplicated topic list the teacher curates before generation.
 */
export function deriveTopics(items = []) {
  const source = Array.isArray(items) ? items : [items];
  const groups = source.map(candidateLines);
  const boilerplate = boilerplateKeys(groups);

  const topics = [];
  const seen = new Set();

  for (const lines of groups) {
    if (topics.length >= MAX_TOPICS) break;
    for (const line of lines) {
      const topic = cleanTopic(line);
      if (!topic) continue;
      const key = topicKey(topic);
      if (isJunk(topic, key) || boilerplate.has(key)) continue;
      if (!seen.has(key)) {
        seen.add(key);
        topics.push(topic);
      }
      // One topic per slide either way - a repeated title means that slide
      // continues the previous one, not that it has a second subject.
      break;
    }
  }

  return topics.slice(0, MAX_TOPICS);
}

/**
 * Read a .pptx upload. Rejects only what is genuinely unreadable; anything that
 * opens as a deck comes back with whatever text was in it.
 *
 * Two passes, cheap one first. The XML pass costs nothing and answers for every
 * normally-authored deck. Only when it comes back with nothing usable do the
 * slide images go to OCR - which is the deck people actually bring: slides
 * exported as pictures, or a PDF re-saved as .pptx.
 *
 * @param {Buffer} buffer
 * @param {{ocr?: 'auto'|'off'|'force'}} [options]
 *   auto (default) reads pictures only when the text pass found nothing;
 *   force always reads them, for a deck whose text layer is junk;
 *   off never does, which is what the tests and the offline demo want.
 */
export async function extractFromPptx(buffer, { ocr = 'auto' } = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);

  let zipEntries;
  try {
    zipEntries = new AdmZip(bytes).getEntries();
  } catch (err) {
    throw Object.assign(new Error(`That file could not be opened as a .pptx (${err.message}).`), {
      status: 400,
    });
  }

  const parts = [];
  for (const entry of zipEntries) {
    const name = String(entry.entryName ?? '').replace(/\\/g, '/');
    const match = SLIDE_ENTRY.exec(name);
    // Numeric, not lexicographic: slide10 comes after slide2.
    if (match) parts.push({ entry, order: Number(match[1]) });
  }
  parts.sort((a, b) => a.order - b.order);

  if (parts.length === 0) {
    throw Object.assign(
      new Error('No slides found in that file - is it really a PowerPoint .pptx?'),
      { status: 400 },
    );
  }

  // The file's own slide numbering is kept here, not the 1..n position, because
  // OCR keys its results off ppt/slides/slideN.xml and the two have to line up.
  // The renumbering to a gapless 1..slideCount happens once, at the end.
  const slides = parts.map(({ entry, order }) => {
    let text = '';
    try {
      text = textFromSlideXml(entry.getData().toString('utf8'));
    } catch {
      // One unreadable part must not cost us the other twenty-nine slides.
      text = '';
    }
    return { n: order, title: text.split('\n')[0] ?? '', text };
  });

  const build = (rows, extra = {}) => {
    const ordered = rows
      .slice()
      .sort((a, b) => a.n - b.n)
      .map((slide, i) => ({ ...slide, n: i + 1 }));
    return {
      rawText: ordered.map((s) => s.text).filter(Boolean).join('\n\n'),
      slides: ordered,
      topics: deriveTopics(ordered),
      slideCount: ordered.length,
      readBy: 'text',
      warnings: [],
      ...extra,
    };
  };

  const fromText = build(slides);
  if (ocr === 'off') return fromText;
  if (ocr !== 'force' && hasUsableText(fromText)) return fromText;

  // The pictures are the only text this deck has. ocrDeck never rejects, so a
  // failure here lands as an empty result and the teacher gets the text pass
  // back unchanged - the same outcome as before OCR existed.
  const read = await ocrDeck(zipEntries);
  if (!read.slides.length) {
    return { ...fromText, warnings: read.warnings };
  }

  // Merged rather than replaced: a deck can be half typed and half pictures,
  // and the typed half is both free and more accurate.
  const merged = new Map(slides.map((s) => [s.n, s]));
  for (const slide of read.slides) {
    const existing = merged.get(slide.n);
    if (existing?.text) continue;
    merged.set(slide.n, slide);
  }

  return build([...merged.values()], {
    readBy: 'ocr',
    ocr: { pagesRead: read.pagesRead, pagesTotal: read.pagesTotal },
    warnings: read.warnings,
  });
}

/** Read a pasted syllabus: one topic per line, list marker or semicolon. */
export function extractFromText(text) {
  const rawText = String(text ?? '');

  const sections = rawText
    .replace(/\r\n?/g, '\n')
    .split(/[\n;]+/)
    .flatMap((line) => line.split(INLINE_MARKER))
    .map((line) => line.trim())
    .filter(Boolean);

  return { rawText, topics: deriveTopics(sections) };
}
