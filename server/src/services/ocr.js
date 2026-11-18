// F1b - reading a deck that has no text in it.
//
// extract.js pulls <a:t> runs out of the slide XML, which is the right first
// move and costs nothing. It finds nothing at all in the deck people actually
// bring to a viva: slides exported as pictures, a PDF re-saved as .pptx, or
// photographs of a whiteboard pasted one per slide. Until now that ended at
// "type the topics in below", which is a fair fallback and a bad experience.
//
// So: when the text pass comes back empty, read the pictures instead. Gemini is
// already configured for F2 and is multimodal, so this adds no dependency, no
// native binary and nothing new to install on the deployment - which rules out
// tesseract on both counts. It also beats a classical OCR engine on exactly the
// input we care about, because a lecture slide is a layout (title, bullets,
// diagram labels) and not a scanned page of prose.
//
// Three rules this module holds to:
//   1. It never runs unless the cheap path already failed. OCR costs quota and
//      seconds; a normal deck must not pay for either.
//   2. It never invents. The prompt says transcribe, and a slide it cannot read
//      comes back empty rather than described.
//   3. It never throws into the upload. A failed OCR pass degrades to the same
//      "type the topics in" message the teacher would have got anyway.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';

/** Whole-deck text under this is "nothing usable came out of that file". */
export const MIN_USABLE_CHARS = 40;

/** Formats PowerPoint actually embeds, and that Gemini accepts inline. */
const MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/png', // relabelled below; PowerPoint rarely emits it
};

// EMF/WMF are Windows metafiles - vector clip art, chart frames, arrows. They
// are never the slide body, no vision model reads them, and including them
// would spend the budget on decoration.
const SKIP_EXT = /\.(emf|wmf|svg|x-emf|x-wmf)$/i;

const MEDIA_ENTRY = /^ppt\/media\/([^/]+)$/i;
const SLIDE_RELS = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/i;
const REL_TARGET = /Target="([^"]+)"/g;

/** One image over this is a photograph, not a slide render; it wastes the call. */
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

/** Inline data is base64, so the wire payload is ~4/3 of this. */
const MAX_CALL_BYTES = 12 * 1024 * 1024;

/** Slides per request. Enough to amortise latency, few enough to stay coherent. */
const SLIDES_PER_CALL = 5;

/** Requests in flight. Matches the generator, for the same free-tier reasons. */
const CONCURRENCY = 2;

const CALL_TIMEOUT_MS = 60000;

/** Ceiling on a whole OCR pass, so an upload cannot hang on a 200-slide deck. */
export const OCR_BUDGET_MS = 120000;

/** Past this the deck is a photo album; read the front of it and say so. */
export const MAX_OCR_SLIDES = 60;

const PAGE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      n: { type: Type.INTEGER, description: 'Slide number exactly as labelled in the prompt.' },
      title: { type: Type.STRING, description: 'The slide heading. Empty string if it has none.' },
      lines: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'Every other line of text on the slide, top to bottom, verbatim.',
      },
    },
    required: ['n', 'title', 'lines'],
  },
};

const SYSTEM = `You are transcribing lecture slides that were saved as images, so a
teaching tool can read their topics.

Transcribe only. Copy the text that is visibly printed on each slide - heading
first, then body lines, bullet text, and any words that label a diagram, axis or
table. Keep the wording and the reading order exactly as they appear.

Rules:
- Never describe a slide, summarise it, translate it or tidy its grammar.
- Never invent a heading. A slide with no heading gets an empty title.
- Ignore decoration: page numbers, the institution's name in a running footer,
  logos, watermarks, and the presenter's name if it repeats on every slide.
- A slide that is a photograph, a blank, or otherwise carries no legible text
  gets an empty title and an empty lines array. That is a correct answer.
- Mathematical notation: write it as it reads, in plain text.

Return one object per slide you were shown, using the slide numbers given.`;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Has the cheap path already given us something worth using?
 * Deliberately generous - one real slide of text is enough to skip OCR.
 */
export function hasUsableText({ rawText = '', topics = [] } = {}) {
  if (Array.isArray(topics) && topics.length > 0) return true;
  return String(rawText).replace(/\s+/g, '').length >= MIN_USABLE_CHARS;
}

function mimeFor(name) {
  const ext = String(name).split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? null;
}

/**
 * Which pictures sit on which slide.
 *
 * Read through each slide's relationship file rather than by sorting
 * ppt/media/*: media is shared and de-duplicated across a deck, so the file
 * order there has no relationship to the slide order. Getting this wrong would
 * hand the model slide 30's picture labelled as slide 2, and the topic list
 * would come out shuffled.
 *
 * @returns {Map<number, string[]>} slide number -> media entry names, in order
 */
export function imagesBySlide(entries) {
  const byName = new Map();
  for (const entry of entries) {
    const name = String(entry.entryName ?? '').replace(/\\/g, '/');
    if (MEDIA_ENTRY.test(name)) byName.set(name.toLowerCase(), entry);
  }

  const out = new Map();
  for (const entry of entries) {
    const name = String(entry.entryName ?? '').replace(/\\/g, '/');
    const match = SLIDE_RELS.exec(name);
    if (!match) continue;

    let xml = '';
    try {
      xml = entry.getData().toString('utf8');
    } catch {
      continue; // one unreadable rels part must not cost the rest of the deck
    }

    const picked = [];
    for (const rel of xml.matchAll(REL_TARGET)) {
      const target = rel[1];
      if (!/^\.\.\/media\//i.test(target)) continue; // external or non-media link
      const key = `ppt/${target.replace(/^\.\.\//, '')}`.toLowerCase();
      const file = byName.get(key);
      if (!file) continue;
      if (SKIP_EXT.test(key)) continue;
      if (!mimeFor(key)) continue;
      picked.push(file.entryName);
    }
    if (picked.length) out.set(Number(match[1]), picked);
  }
  return out;
}

/**
 * The images to send, one entry per slide, in deck order.
 * Oversized and unreadable parts are dropped here so the caller never has to.
 */
function loadPages(entries, bySlide) {
  const byName = new Map(
    entries.map((e) => [String(e.entryName ?? '').replace(/\\/g, '/'), e]),
  );

  const pages = [];
  for (const n of [...bySlide.keys()].sort((a, b) => a - b)) {
    if (pages.length >= MAX_OCR_SLIDES) break;
    const parts = [];
    for (const name of bySlide.get(n)) {
      const entry = byName.get(String(name).replace(/\\/g, '/'));
      if (!entry) continue;
      let data;
      try {
        data = entry.getData();
      } catch {
        continue;
      }
      if (!data?.length || data.length > MAX_IMAGE_BYTES) continue;
      parts.push({ mimeType: mimeFor(name), data });
      // A slide whose whole body is one exported picture is the case this
      // exists for. More than three parts means clip art, so stop there.
      if (parts.length >= 3) break;
    }
    if (parts.length) pages.push({ n, parts });
  }
  return pages;
}

let client = null;
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

/** Batch the pages so one call stays under the inline payload ceiling. */
function batch(pages) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const page of pages) {
    const size = page.parts.reduce((n, p) => n + p.data.length, 0);
    if (current.length && (current.length >= SLIDES_PER_CALL || bytes + size > MAX_CALL_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(page);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function readBatch(pages, timeoutMs) {
  const contents = [];
  for (const page of pages) {
    contents.push({ text: `Slide ${page.n}:` });
    for (const part of page.parts) {
      contents.push({ inlineData: { mimeType: part.mimeType, data: part.data.toString('base64') } });
    }
  }
  contents.push({
    text: `Transcribe slides ${pages.map((p) => p.n).join(', ')}. Return one object per slide.`,
  });

  const response = await getClient().models.generateContent({
    model: config.gemini.model,
    contents: [{ role: 'user', parts: contents }],
    config: {
      // Transcription, not writing: any creativity here is a hallucinated line
      // of slide text, which would become a topic and then a question.
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: PAGE_SCHEMA,
      systemInstruction: SYSTEM,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  const parsed = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, ''));
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Read the pictures in a deck as slide text.
 *
 * Resolves to `{ slides, warnings, pagesRead, pagesTotal }` and never rejects:
 * every failure mode here is "we could not read the pictures either", which the
 * caller already has an answer for.
 *
 * @param {Array} entries AdmZip entries for the whole .pptx
 */
export async function ocrDeck(entries, { deadline = Date.now() + OCR_BUDGET_MS } = {}) {
  const empty = { slides: [], warnings: [], pagesRead: 0, pagesTotal: 0 };
  if (!hasGemini()) {
    return { ...empty, warnings: ['Reading slide images needs a Gemini API key on the server.'] };
  }

  const bySlide = imagesBySlide(entries);
  const pages = loadPages(entries, bySlide);
  const total = bySlide.size;
  if (!pages.length) return { ...empty, pagesTotal: total };

  const warnings = [];
  if (total > MAX_OCR_SLIDES) {
    warnings.push(`Read the first ${MAX_OCR_SLIDES} slides of ${total} - the rest were skipped.`);
  }

  const batches = batch(pages);
  const results = new Map();
  let index = 0;

  async function worker() {
    for (;;) {
      const i = index;
      index += 1;
      if (i >= batches.length) return;

      const left = deadline - Date.now();
      if (left <= 2000) {
        warnings.push('Ran out of time reading the slide images; some slides were skipped.');
        index = batches.length;
        return;
      }

      try {
        const read = await readBatch(batches[i], Math.min(CALL_TIMEOUT_MS, left));
        for (const row of read) {
          const n = Number(row?.n);
          if (!Number.isInteger(n)) continue;
          const title = clean(row?.title);
          const lines = Array.isArray(row?.lines) ? row.lines.map(clean).filter(Boolean) : [];
          if (!title && !lines.length) continue;
          results.set(n, { n, title, text: [title, ...lines].filter(Boolean).join('\n') });
        }
      } catch (err) {
        // One bad batch out of six is five sixths of a deck, so keep going.
        warnings.push(`Could not read slides ${batches[i].map((p) => p.n).join(', ')}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const slides = [...results.values()].sort((a, b) => a.n - b.n);

  // Read the pictures, found no words in any of them. That is a real answer and
  // a common one - the images in a normally-authored deck are photographs, logos
  // and chart frames, and the text was always in the XML. Saying so beats an
  // empty result that looks like a failure.
  if (!slides.length && !warnings.length) {
    warnings.push(
      `Looked at ${pages.length} slide image${pages.length === 1 ? '' : 's'} and found no readable ` +
      'text in them - they appear to be photographs or artwork rather than slides saved as pictures.',
    );
  }

  return { slides, warnings, pagesRead: slides.length, pagesTotal: total };
}
