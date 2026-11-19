// Lessons from a professor's own slides (Phase 6, decision H11, under the
// owner's decisions 1 and 5).
//
// A lesson is per topic, made on the professor's button only, never in anything
// a student waits on. It is the topic's slides in order, as steps:
//
//   chunk      a piece of the professor's OWN text, word for word, cited by
//              slide number. Never written by a model.
//   example    one worked example of that chunk: an AI draft, from the chunk's
//              text only (decision 1: never new syllabus).
//   questions  2 to 4 retrieval questions on that chunk, written into the bank
//              as DRAFTS (status 'draft', source 'llm', cited to the chunk's
//              slides), so they pass the normal approval gate like every
//              generated question; a student sees each only once it is approved.
//   ... then the next chunk.
//
// A lesson is an "AI draft" until the professor approves it, and only an
// approved lesson reaches a student (H2). Regenerating writes a new version as a
// draft and leaves the approved one serving; approving the new one retires the
// old in the same statement (approve_topic_lesson, 0027). A lesson is written
// once: what a student read is kept as they read it (topic_lessons, 0027).
//
// OFFLINE (no model key, or the model failed): a "slides only" lesson of the
// professor's chunks and the topic's questions a professor already approved,
// spread over the chunks; no generated prose. It too waits for the professor's
// approval, since the chunking is the machine's.
//
// WHERE THE TEXT COMES FROM (H4):
//   - a deck uploaded from Phase 6 on kept each slide's own words: the topic's
//     slides (topic_slides) in order, each chunk citing its own slides;
//   - an older deck kept only slide numbers: the chapter's text from the line
//     that names the topic to the line that names another of its topics, each
//     chunk citing the topic's slides together, and the lesson says so;
//   - pasted text: the same section of the text, citing no slide, and it says so.
//
// What the model returns is held here, not trusted (parseLessonReply): only the
// chunks it was shown, one example and at most four questions per chunk, every
// question through the generator's own validator (validateItems) and then kept
// only as a recall question (Remember, "Choose one" or "True or false"), nothing
// holding contact details. Each refusal is named. Tests drive the parser with
// fixture replies and writeLessonDraft with a stand-in `callModel`; nothing here
// is called with a real key in a test.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { LEVELS } from '../bloom.js';
import { PAYLOAD_FIELDS, awaitsReview, forStudent, isUngraded, score } from '../questionTypes.js';
import { contextForTopic, questionTopicFor, validateItems } from './generate.js';
import { runChecks } from './checks.js';
import { holdsContact } from './roster.js';
import { cleanTopic } from './outcomes.js';
import { slidesOfTopic, topicKey, topicMatcher } from './hubTopics.js';
import { phoneRich, richText } from './richText.js';
import { phoneProvenance, questionProvenance } from './honesty.js';
import {
  ORIGINAL, localiseQuestion, servableTranslations, shownLanguage,
} from './hubLanguages.js';
import { attemptStoreConnected, listHubAttempts } from './hubAttemptBridge.js';
import { hubSeed, wasApproved } from './hubPractice.js';
import { feedbackAfter, hintsOffered } from './hubHintHook.js';
import { studentTopicState } from './hubTutor.js';
import { CLOSED_SENTENCE, ROOM_HELD_NOTE, closedQuestions } from './hubClosed.js';
import { attemptOrder } from './hubElo.js';
import { explanationForStudent } from './hubExplanations.js';
import { figureWithSteps } from '../figures/index.js';
// ---- Batch 8: the concept panel, rooms-only questions and serve tokens ----
import { cleanConcept, conceptOfReply, conceptPrompt, sectionsView } from './hubConcept.js';
import { isRoomsOnly } from './bankShare.js';
import { UNPROVEN_NOTE, serveToken } from './serveTokens.js';

/** One chunk: at most this many characters, and this many slides. */
export const MAX_CHUNK_CHARS = 900;
export const MAX_CHUNK_SLIDES = 3;
/** The most chunks one lesson holds. A longer topic is cut, and the lesson says where. */
export const MAX_CHUNKS = 8;
/** The most of a chapter's text one lesson reads when no slide kept its own words. */
export const MAX_SECTION_CHARS = 6000;
/** Retrieval questions per chunk. */
export const MIN_QUESTIONS = 2;
export const MAX_QUESTIONS = 4;
/** A worked example's parts, in characters, and its steps. */
export const MAX_PROBLEM = 600;
export const MAX_STEP = 400;
export const MAX_EXAMPLE_STEPS = 6;
export const MAX_ANSWER = 300;

/** What a retrieval question may be: a recall question, at Remember. */
export const RETRIEVAL_KINDS = Object.freeze({ remember: { mcq: 1, truefalse: 1 } });

const CALL_TIMEOUT_MS = 60000;

export const NOTHING_TO_TEACH = 'This topic has no text in its chapter to make a lesson from. Add the words to the slides, '
  + 'or paste the chapter\'s text, and try again.';

export const NO_QUESTIONS_YET = 'No approved question on this topic yet, so this lesson has no questions to answer. '
  + 'Approve some in the bank and make the lesson again to add them.';

/** What a student is told about who made the lesson and its examples. */
export const STUDENT_LABEL = Object.freeze({
  llm: 'Made from your professor\'s slides with AI help, and checked by your professor.',
  slides: 'Your professor\'s slides, in short steps.',
});
export const EXAMPLE_LABEL = 'Worked example, written with AI help and checked by your professor.';

export const NO_LESSON = 'Your professor has not published a lesson on this topic yet.';

const fail = (message, status) => Object.assign(new Error(message), { status });
const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const sameId = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const uniqueSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);

/* ---------------------------------------------------------------- locks -- */

const queues = new Map();

/** Run `fn` after every earlier call with the same key has finished, in this process. */
export function withLock(key, fn) {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/* ------------------------------------------------------------ the source -- */

/** "Slide 3", "Slides 3 and 4", "Slides 3, 4 and 7"; null for none. */
export function citeSlides(slides = []) {
  const ns = uniqueSorted((Array.isArray(slides) ? slides : []).filter((n) => Number.isInteger(n) && n > 0));
  if (!ns.length) return null;
  if (ns.length === 1) return `Slide ${ns[0]}`;
  return `Slides ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** Split one text at line ends, then sentence ends, then spaces, into pieces of at most `max` characters. */
export function splitLong(text, max = MAX_CHUNK_CHARS) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return [];
  if (source.length <= max) return [source];
  const units = source.split('\n').map((l) => l.trim()).filter(Boolean)
    .flatMap((line) => (line.length <= max ? [line] : line.split(/(?<=[.!?])\s+/)))
    .flatMap((piece) => {
      const out = [];
      let rest = piece;
      while (rest.length > max) {
        const at = rest.lastIndexOf(' ', max);
        const cut = at > max * 0.5 ? at : max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
      return out;
    });
  const out = [];
  for (const unit of units) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + 1 + unit.length <= max) out[out.length - 1] = `${last}\n${unit}`;
    else out.push(unit);
  }
  return out;
}

/**
 * Pieces of the professor's text, in order ([{ slides, text }]), as lesson
 * chunks: consecutive pieces joined while a chunk stays within MAX_CHUNK_CHARS
 * and MAX_CHUNK_SLIDES; a longer piece is split (splitLong). Each chunk cites
 * the slides its pieces came from.
 *
 * @returns {{ label: string, slides: number[], text: string }[]}
 */
export function chunkPieces(pieces = []) {
  const parts = pieces.flatMap((p) => splitLong(p.text).map((text) => ({ slides: p.slides ?? [], text })));
  const chunks = [];
  let current = null;
  for (const part of parts) {
    const slides = uniqueSorted([...(current?.slides ?? []), ...part.slides]);
    if (current && current.text.length + 2 + part.text.length <= MAX_CHUNK_CHARS && slides.length <= MAX_CHUNK_SLIDES) {
      current.text = `${current.text}\n\n${part.text}`;
      current.slides = slides;
    } else {
      current = { slides: uniqueSorted(part.slides), text: part.text };
      chunks.push(current);
    }
  }
  return chunks.map((c, i) => ({ label: `C${i + 1}`, slides: c.slides, text: c.text }));
}

/**
 * The part of a chapter's text about one topic, when no slide kept its own
 * words: from a line naming the topic to the next line naming another of the
 * chapter's topics (a repeated title continues the topic, as the deck's own
 * reading of topics has it). With no line naming it, the generator's own
 * reading of the text about the topic (contextForTopic). At most
 * MAX_SECTION_CHARS.
 *
 * @returns {{ text: string, found: boolean }}
 */
export function topicSection(rawText, name, topics = []) {
  const lines = String(rawText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const want = new Set([topicKey(name), topicKey(questionTopicFor(name))].filter(Boolean));
  const others = new Set((Array.isArray(topics) ? topics : []).map((t) => topicKey(t)).filter((k) => k && !want.has(k)));
  const out = [];
  let inside = false;
  let found = false;
  for (const line of lines) {
    // A heading may carry a list marker ("- Sets", "2. Sets"); the topic list was read without it.
    const key = topicKey(cleanTopic(line).replace(/^(?:[-*•]|\d+[.)])\s+/, ''));
    if (want.has(key)) { inside = true; found = true; } else if (others.has(key)) inside = false;
    if (inside) out.push(line);
  }
  const text = found ? out.join('\n') : contextForTopic(rawText ?? '', name, MAX_SECTION_CHARS);
  return { text: String(text ?? '').trim().slice(0, MAX_SECTION_CHARS), found };
}

/**
 * What a topic's lesson is read from, as chunks, and what to say about it (H4).
 *
 * @returns {{ chunks, basis: { from: 'slides'|'chapter-slides'|'chapter-text', perSlideText: boolean, slides: number[], note: string }, warnings: string[] }}
 */
export function lessonSource(content, topic) {
  const name = topic?.name ?? '';
  const numbers = slidesOfTopic(content, name);
  const texts = Array.isArray(content?.slideTexts) ? content.slideTexts : null;
  const warnings = [];
  let chunks = [];
  let basis;

  const kept = texts && numbers.length
    ? numbers.map((n) => texts.find((s) => s.slide === n)).filter((s) => s && s.text.trim())
    : [];
  if (kept.length) {
    chunks = chunkPieces(kept.map((s) => ({ slides: [s.slide], text: s.text })));
    basis = {
      from: 'slides',
      perSlideText: true,
      slides: numbers,
      note: 'Each part is your slides\' own words, cited slide by slide.',
    };
  } else {
    const section = topicSection(content?.rawText, name, content?.topics);
    const cited = content?.kind === 'pptx' ? numbers : [];
    const paragraphs = section.text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    chunks = chunkPieces(paragraphs.map((text) => ({ slides: [], text })))
      .map((c) => ({ ...c, slides: cited }));
    const place = section.found ? 'the chapter\'s text about this topic' : 'the parts of the chapter\'s text that mention this topic';
    if (content?.kind === 'pptx' && cited.length) {
      basis = {
        from: 'chapter-slides',
        perSlideText: false,
        slides: cited,
        note: `This deck was uploaded before each slide's words were kept, so the lesson is made from ${place}, and each part `
          + `cites the topic's slides together (${citeSlides(cited)}) rather than one slide each. Upload the deck again to cite slide by slide.`,
      };
    } else if (content?.kind === 'pptx') {
      basis = {
        from: 'chapter-text',
        perSlideText: false,
        slides: [],
        note: `This deck kept no slide numbers for this topic, so the lesson is made from ${place} and cites no slide.`,
      };
    } else {
      basis = {
        from: 'chapter-text',
        perSlideText: false,
        slides: [],
        note: `This chapter was pasted as text, so the lesson is made from ${place} and cites no slide.`,
      };
    }
  }
  if (chunks.length > MAX_CHUNKS) {
    const left = chunks.slice(MAX_CHUNKS);
    const leftSlides = uniqueSorted(left.flatMap((c) => c.slides));
    warnings.push(`This topic's text is longer than one lesson holds, so the lesson covers its first ${MAX_CHUNKS} parts`
      + `${leftSlides.length && basis.perSlideText ? `; ${citeSlides(leftSlides).toLowerCase()} are left out` : ''}. `
      + 'Split the topic into two on the chapter\'s list to cover the rest.');
    chunks = chunks.slice(0, MAX_CHUNKS);
  }
  return { chunks, basis, warnings };
}

/* ------------------------------------------------------------- the model -- */

/** The instruction the model is given. Built from the professor's own text only. */
export function buildLessonPrompt({ topic, chapterTitle = '', chunks, avoid = [] }) {
  return [
    'You help a college professor in India turn their own slides into a short lesson for their students.',
    `The topic is "${collapse(topic)}"${chapterTitle ? ` from the chapter "${collapse(chapterTitle)}"` : ''}. Below is the professor's own `
      + 'text for it, in parts labelled C1, C2 and so on. For EACH part write:',
    '1. "example": ONE worked example that uses only what that part says: a short "problem", 1 to 6 "steps" that solve it in '
      + 'order (one line each), and the "answer". Use only the ideas, terms and facts in that part. Never add anything the part '
      + 'does not teach. When a part only defines or lists things, make the example a short worked use of them on a concrete case.',
    `2. "questions": ${MIN_QUESTIONS} to ${MAX_QUESTIONS} retrieval questions answerable from that part alone, each with "bloom": `
      + '"remember", and either "kind": "mcq" (a question, exactly 4 distinct "options" of similar length, and "answerIdx" 0 to 3 '
      + 'of the one right option) or "kind": "truefalse" (a statement, not a question, and "answerBool"). Wrong options are real '
      + 'ideas from the part that a student who half-understands would pick. Never "all of the above" or "none of the above".',
    // Batch 8: the concept panel's sections (services/hubConcept.js), cited part by part.
    conceptPrompt(),
    'Write plain, exam-ready English. Write mathematics in TeX between $ signs, such as $x^2$. No markdown, no headings, no commentary.',
    avoid.length ? `Do not repeat these questions already in the bank: ${avoid.slice(0, 12).map((t) => `"${collapse(t).slice(0, 160)}"`).join('; ')}.` : '',
    'Reply with JSON only: {"parts": [{"part": "C1", "example": {"problem": "...", "steps": ["..."], "answer": "..."}, '
      + '"questions": [{"kind": "mcq", "bloom": "remember", "text": "...", "options": ["...", "...", "...", "..."], "answerIdx": 0}]}], '
      + '"concept": {"intro": {"text": "...", "parts": ["C1"]}, "facts": [], "steps": [], "mistakes": []}}.',
    '',
    'PARTS',
    ...chunks.map((c) => `${c.label}${citeSlides(c.slides) ? ` (${citeSlides(c.slides)})` : ''}:\n"""\n${c.text}\n"""`),
  ].filter((line) => line !== '').join('\n');
}

const LESSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    parts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          part: { type: Type.STRING },
          example: {
            type: Type.OBJECT,
            properties: {
              problem: { type: Type.STRING },
              steps: { type: Type.ARRAY, items: { type: Type.STRING } },
              answer: { type: Type.STRING },
            },
            required: ['problem', 'steps', 'answer'],
          },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                kind: { type: Type.STRING },
                bloom: { type: Type.STRING },
                text: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answerIdx: { type: Type.INTEGER },
                answerBool: { type: Type.BOOLEAN },
              },
              required: ['kind', 'bloom', 'text'],
            },
          },
        },
        required: ['part', 'example', 'questions'],
      },
    },
    // Batch 8: the concept panel's sections, optional (services/hubConcept.js).
    concept: {
      type: Type.OBJECT,
      properties: {
        intro: { type: Type.OBJECT, properties: { text: { type: Type.STRING }, parts: { type: Type.ARRAY, items: { type: Type.STRING } } } },
        facts: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { kind: { type: Type.STRING }, text: { type: Type.STRING }, parts: { type: Type.ARRAY, items: { type: Type.STRING } } } },
        },
        steps: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { term: { type: Type.STRING }, text: { type: Type.STRING }, parts: { type: Type.ARRAY, items: { type: Type.STRING } } } },
        },
        example: {
          type: Type.OBJECT,
          properties: {
            language: { type: Type.STRING }, body: { type: Type.STRING }, caption: { type: Type.STRING },
            parts: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
        },
        mistakes: {
          type: Type.ARRAY,
          items: { type: Type.OBJECT, properties: { text: { type: Type.STRING }, parts: { type: Type.ARRAY, items: { type: Type.STRING } } } },
        },
      },
    },
  },
  required: ['parts'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Write the lesson\'s parts now. Reply with the JSON object and nothing else.',
    config: {
      temperature: config.gemini.temperature,
      responseMimeType: 'application/json',
      responseSchema: LESSON_SCHEMA,
      systemInstruction: prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return text;
}

const stripFence = (text) => String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/** A worked example as kept: { ok, value } or { ok: false, why }. */
export function cleanExample(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, why: 'there was none' };
  const problem = collapse(raw.problem);
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).map(collapse).filter(Boolean);
  const answer = collapse(raw.answer);
  if (!problem) return { ok: false, why: 'it had no problem' };
  if (problem.length > MAX_PROBLEM) return { ok: false, why: `its problem was over ${MAX_PROBLEM} characters` };
  if (!steps.length || steps.length > MAX_EXAMPLE_STEPS) return { ok: false, why: `it needs 1 to ${MAX_EXAMPLE_STEPS} steps` };
  if (steps.some((s) => s.length > MAX_STEP)) return { ok: false, why: `a step was over ${MAX_STEP} characters` };
  if (!answer) return { ok: false, why: 'it had no answer' };
  if (answer.length > MAX_ANSWER) return { ok: false, why: `its answer was over ${MAX_ANSWER} characters` };
  if (holdsContact([problem, ...steps, answer].join(' '))) return { ok: false, why: 'it held contact details' };
  return { ok: true, value: { problem, steps, answer } };
}

/**
 * The model's reply held to the rules in the header. `chunks` as sent;
 * `topic` the topic's name; `avoid` question texts already in the bank.
 *
 * @returns {{ parts: Map<string, { example: object|null, questions: object[] }>, skipped: { part, why }[] }}
 * @throws when the reply is not JSON holding a list of parts
 */
export function parseLessonReply(text, { chunks, topic, avoid = [] }) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const list = Array.isArray(raw) ? raw : raw?.parts;
  if (!Array.isArray(list)) throw new Error('the model\'s reply held no list of parts');
  const labels = new Set(chunks.map((c) => c.label));
  const seen = new Set(avoid.map((t) => collapse(t).toLowerCase()));
  const parts = new Map();
  const skipped = [];

  for (const entry of list) {
    const label = collapse(entry?.part ?? entry?.chunk).toUpperCase();
    const skip = (why) => skipped.push({ part: label || '?', why });
    if (!labels.has(label)) { skip('it named a part of the slides that was not offered'); continue; }
    if (parts.has(label)) { skip('the part was written twice; the first was kept'); continue; }
    const example = cleanExample(entry?.example);
    if (!example.ok) skip(`its worked example was left out: ${example.why}`);
    const { valid, errors } = validateItems(Array.isArray(entry?.questions) ? entry.questions : [], questionTopicFor(topic), RETRIEVAL_KINDS);
    for (const why of errors) skip(`a question was left out: ${why.replace(/^"[^"]*"\s*/, '')}`);
    const questions = [];
    for (const q of valid) {
      if (q.bloom !== 'remember' || !Object.keys(RETRIEVAL_KINDS.remember).includes(q.kind)) {
        skip('a question was left out: it was not a recall question of the kinds asked for');
        continue;
      }
      const key = collapse(q.text).toLowerCase();
      if (seen.has(key)) { skip('a question was left out: it repeats one already in the bank or this lesson'); continue; }
      if (holdsContact(JSON.stringify(q))) { skip('a question was left out: it held contact details'); continue; }
      if (questions.length >= MAX_QUESTIONS) { skip(`a question was left out: more than ${MAX_QUESTIONS} were written for the part`); continue; }
      seen.add(key);
      // Advice the model may have attached; a recall question is kept without it.
      delete q.misconceptions;
      questions.push(q);
    }
    parts.set(label, { example: example.ok ? example.value : null, questions });
  }
  return { parts, skipped };
}

/* -------------------------------------------------------------- writing -- */

const levelOrder = (q) => LEVELS.indexOf(q.bloom);

/** The topic's questions in the chapter's bank (matched as the hub matches them: by name, or the generator's clipped name). */
export async function topicQuestions(repo, content, topic) {
  const [records, bank] = await Promise.all([
    repo.listChapterTopics(content._id),
    repo.listQuestions(content._id, { includeDiscarded: true }),
  ]);
  const match = topicMatcher(records);
  return bank.filter((q) => sameId(match(q.topic)?._id, topic._id));
}

/**
 * Approved questions a slides-only lesson may ask: answered at once (not a poll,
 * not a written answer waiting for review, not a drawing, which only a
 * professor marks: Batch 9), lowest level first.
 */
export function retrievalPool(questions = []) {
  return questions
    .filter((q) => q.status === 'active' && !isUngraded(q.kind ?? 'mcq') && (q.kind ?? 'mcq') !== 'open' && !awaitsReview(q) && !isRoomsOnly(q))
    .sort((a, b) => levelOrder(a) - levelOrder(b) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
}

/** Questions dealt over the chunks in turn, at most MAX_QUESTIONS each. */
export function dealQuestions(chunks, questions) {
  const out = chunks.map(() => []);
  if (!chunks.length) return out;
  questions.forEach((q, i) => {
    const at = i % chunks.length;
    if (out[at].length < MAX_QUESTIONS) out[at].push(String(q._id));
  });
  return out;
}

/** A bank row for a retrieval question the model wrote: a draft, cited to its chunk's slides. */
function draftRow(q, { content, chunk, model, viewer }) {
  const row = {
    contentId: content._id,
    topic: q.topic,
    text: q.text,
    kind: q.kind,
    bloom: q.bloom,
    source: 'llm',
    // Never straight to a student or a room: a professor approves it first, in the bank.
    status: 'draft',
    model,
    sourceRef: chunk.slides.length ? { kind: 'slides', slides: chunk.slides } : null,
    createdBy: viewer?.id ?? null,
  };
  if (Array.isArray(q.options)) row.options = q.options;
  if (Number.isInteger(q.answerIdx)) row.answerIdx = q.answerIdx;
  for (const f of PAYLOAD_FIELDS) if (q[f] !== undefined) row[f] = q[f];
  row.checks = runChecks(row);
  return row;
}

/** The lesson's steps: each chunk, then its example, then its questions. */
function stepsFor(chunks, { examples = [], questionIds = [] } = {}) {
  const steps = [];
  chunks.forEach((c, i) => {
    steps.push({ type: 'chunk', slides: c.slides, text: c.text });
    if (examples[i]) steps.push({ type: 'example', slides: c.slides, ...examples[i] });
    if (questionIds[i]?.length) steps.push({ type: 'questions', slides: c.slides, questionIds: questionIds[i] });
  });
  return steps;
}

/**
 * Write a new version of a topic's lesson as a draft, on the professor's
 * button (see the header). With a model (a key, or a stand-in `callModel`):
 * the AI draft, its retrieval questions written into the bank as drafts. With
 * none, or when the model fails or writes nothing usable: slides only. Never
 * throws for a model problem.
 *
 * @returns {Promise<{ lesson: object, drafted: object[], warnings: string[] }>}
 */
export async function writeLessonDraft(repo, { content, topic, viewer = null, callModel = null }) {
  const src = lessonSource(content, topic);
  if (!src.chunks.length) throw fail(NOTHING_TO_TEACH, 409);
  const warnings = [...src.warnings];
  const mine = await topicQuestions(repo, content, topic);

  let model = null;
  let parsed = null;
  let sections = null;
  if (callModel || hasGemini()) {
    try {
      const prompt = buildLessonPrompt({ topic: topic.name, chapterTitle: content.title, chunks: src.chunks, avoid: mine.map((q) => q.text) });
      const text = await (callModel ?? geminiCall)(prompt, { timeoutMs: CALL_TIMEOUT_MS });
      const reply = parseLessonReply(text, { chunks: src.chunks, topic: topic.name, avoid: mine.map((q) => q.text) });
      // Batch 8: the concept panel's sections from the same reply, each piece
      // cited to the parts it came from or left out (services/hubConcept.js).
      const concept = cleanConcept(conceptOfReply(text), src.chunks);
      const usable = [...reply.parts.values()].some((p) => p.example || p.questions.length);
      if (usable) {
        parsed = reply;
        sections = concept.sections;
        model = callModel ? 'stand-in' : config.gemini.model;
        for (const why of concept.skipped.slice(0, 8)) warnings.push(`${why}.`);
      } else {
        warnings.push('The model wrote nothing usable for this topic, so a slides-only lesson was made instead.');
      }
      for (const s of reply.skipped.slice(0, 12)) warnings.push(`Part ${s.part}: ${s.why}.`);
      if (reply.skipped.length > 12) warnings.push(`${reply.skipped.length - 12} more of the model's items were left out.`);
    } catch (err) {
      warnings.push(`The model could not write this lesson (${err.message}), so a slides-only lesson was made instead.`);
    }
  }

  let steps;
  let drafted = [];
  if (parsed) {
    const rows = [];
    const owners = [];
    src.chunks.forEach((chunk, i) => {
      const part = parsed.parts.get(chunk.label);
      if (!part?.example) warnings.push(`Part ${i + 1} has no worked example.`);
      const qs = part?.questions ?? [];
      if (qs.length < MIN_QUESTIONS) warnings.push(`Part ${i + 1} has ${qs.length} retrieval question${qs.length === 1 ? '' : 's'}, fewer than ${MIN_QUESTIONS}.`);
      for (const q of qs) {
        rows.push(draftRow(q, { content, chunk, model, viewer }));
        owners.push(i);
      }
    });
    drafted = rows.length ? await repo.insertQuestions(rows) : [];
    const questionIds = src.chunks.map(() => []);
    drafted.forEach((q, j) => questionIds[owners[j]].push(String(q._id)));
    steps = stepsFor(src.chunks, { examples: src.chunks.map((c) => parsed.parts.get(c.label)?.example ?? null), questionIds });
  } else {
    const pool = retrievalPool(mine);
    if (!pool.length) warnings.push(NO_QUESTIONS_YET);
    steps = stepsFor(src.chunks, { questionIds: dealQuestions(src.chunks, pool) });
  }

  const versions = (await repo.listTopicLessons({ topicId: topic._id })).map((l) => l.version);
  const lesson = await repo.createTopicLesson({
    topicId: topic._id,
    contentId: content._id,
    ownerId: content.ownerId ?? null,
    version: (versions.length ? Math.max(...versions) : 0) + 1,
    source: parsed ? 'llm' : 'slides',
    model,
    steps,
    basis: src.basis,
    warnings,
    createdBy: viewer?.id ?? null,
    // Batch 8: only an AI-written lesson has them; a slides-only one says why not.
    ...(sections ? { sections } : {}),
  });
  return { lesson, drafted, warnings };
}

/* ------------------------------------------------------------ questions -- */

/**
 * The question a student is asked for a question id a lesson lists: the
 * question itself while it is active, else the active question that replaced it
 * through a regenerate (replacesId), followed to the end. Null when neither.
 */
export function servedFor(id, bank) {
  const byId = new Map(bank.map((q) => [String(q._id).toLowerCase(), q]));
  let current = byId.get(String(id).toLowerCase()) ?? null;
  const seen = new Set();
  while (current && current.status !== 'active' && !seen.has(String(current._id))) {
    seen.add(String(current._id));
    const from = String(current._id);
    // A rejected draft also names what it would have replaced: the active one wins.
    const next = bank.filter((q) => q.replacesId && sameId(q.replacesId, from) && q.status !== 'draft');
    current = next.find((q) => q.status === 'active') ?? next[0] ?? null;
  }
  return current && current.status === 'active' ? current : null;
}

/** Every question id a lesson lists, in order. */
export const lessonQuestionIds = (lesson) => (Array.isArray(lesson?.steps) ? lesson.steps : [])
  .filter((s) => s?.type === 'questions').flatMap((s) => (Array.isArray(s.questionIds) ? s.questionIds.map(String) : []));

/**
 * The question behind one id a student answers in a lesson: one the lesson
 * lists, or the active question that replaced one of them. Null when it is
 * not the lesson's. A question never approved (a draft, or an AI draft the
 * professor rejected) is never one a student was shown (wasApproved).
 *
 * A question kept for rooms only is never one a lesson asks (Batch 8), so it
 * is null here, except with `answered`: an answer to it, given while the
 * lesson still showed it, is kept (never discarded), with no key shown.
 */
export function lessonQuestion(lesson, questionId, bank, { answered = false } = {}) {
  const want = String(questionId ?? '').toLowerCase();
  // A drawing (Batch 9) is never one a lesson asks either: a lesson marks its
  // answer at once, and nobody marks a drawing in the hub. A question edited
  // into one after the lesson listed it is left out like a rooms-only one; with
  // `answered`, it comes back so the answer route can refuse it in a sentence.
  const asked = (q) => answered || (!isRoomsOnly(q) && !awaitsReview(q));
  for (const id of lessonQuestionIds(lesson)) {
    if (String(id).toLowerCase() === want) {
      const q = bank.find((x) => String(x._id).toLowerCase() === want) ?? null;
      return wasApproved(q) && asked(q) ? q : null;
    }
    const served = servedFor(id, bank);
    if (served && asked(served) && String(served._id).toLowerCase() === want) return served;
  }
  return null;
}

/* ---------------------------------------------------------------- views -- */

const html = async (text) => (await richText(String(text ?? ''))).html;

/**
 * The right answer to a stored lesson attempt, in the positions the student was
 * shown: worked out from the attempt's own snapshot, with the hub's one seed,
 * never from the question as it stands now (which may have been edited since).
 * Null when the snapshot cannot be marked.
 */
export function attemptSolution(attempt, accountId) {
  const qid = String(attempt?.questionId ?? attempt?.questionSnapshot?.id ?? '');
  const snap = attempt?.questionSnapshot && typeof attempt.questionSnapshot === 'object' ? attempt.questionSnapshot : {};
  try {
    return score({ ...snap, _id: qid, kind: attempt.kind ?? snap.kind ?? 'mcq' }, attempt.response, hubSeed(accountId, qid)).solution ?? null;
  } catch {
    return null;
  }
}

/**
 * Why an earlier answer keeps what was right back while its question is closed
 * to the student (services/hubClosed.js): the reload must not show a key the
 * hub would not show in practice now.
 */
export const ANSWER_HELD = Object.freeze({
  room: ROOM_HELD_NOTE,
  'self-test': 'This question is on a self-test you have not handed in yet, so what was right, and why, is shown here '
    + 'once you hand it in.',
  getready: 'Your Get Ready check is asking this question now, so what was right, and why, is shown here once you have '
    + 'answered it there.',
});

/** Each question's latest answer by this student in a lesson, by question id in lower case. */
async function lastLessonAnswers(repo, account, questionIds) {
  if (!questionIds.length) return new Map();
  const rows = await listHubAttempts(repo, { accountId: String(account.id), questionIds, mode: 'lesson' });
  const out = new Map();
  for (const a of [...rows].sort(attemptOrder)) out.set(String(a.questionId ?? '').toLowerCase(), a);
  return out;
}

/**
 * A question's earlier answer as the lesson shows it on a reload: what the
 * student sent and its mark, with the key, the approved explanation and the
 * feedback on the option chosen, all of which the student was shown when they
 * answered. Kept back (`held`) while the question is closed to them.
 */
async function lastAnswerView(repo, { account, attempt, closedWhy, language }) {
  const view = {
    attemptId: attempt.clientAttemptId ?? attempt.attemptId ?? null,
    answeredAt: attempt.createdAt ?? null,
    response: attempt.response ?? null,
    correct: attempt.correct,
    score: attempt.score,
    language: attempt.language ?? ORIGINAL,
  };
  if (closedWhy) return { ...view, solution: null, explanation: null, optionFeedback: [], held: true, heldNote: ANSWER_HELD[closedWhy] ?? ROOM_HELD_NOTE };
  // Kept without proof the lesson served it (Batch 8): no mark, key or feedback on a
  // reload either, as the answer's own reply gave none.
  if (attempt.unproven) return { ...view, correct: null, score: null, solution: null, explanation: null, optionFeedback: [], unproven: true, note: UNPROVEN_NOTE };
  const explanation = await explanationForStudent(repo, attempt.questionId, language).catch((err) => {
    console.error('[hub] an explanation could not be read:', err.message);
    return null;
  });
  return {
    ...view,
    solution: attemptSolution(attempt, account.id),
    explanation,
    optionFeedback: await feedbackAfter(repo, { account, attempt }),
  };
}

const STATUS_LABEL = {
  draft: {
    llm: 'AI draft: students do not see it until you approve it.',
    slides: 'Slides only, not yet approved: your own slides in steps, with questions you already approved. Students do not see it until you approve it.',
  },
  approved: {
    llm: 'Approved: made from your slides with AI help. Students on your classes read this lesson.',
    slides: 'Approved: your own slides in steps. Students on your classes read this lesson.',
  },
  superseded: 'Replaced by a newer approved version: students no longer see it.',
  discarded: 'Discarded: students never saw it.',
};

const statusLabel = (l) => (typeof STATUS_LABEL[l.status] === 'string' ? STATUS_LABEL[l.status] : STATUS_LABEL[l.status][l.source]);

/** One lesson as staff see it: every step, each question's place at the approval gate, what to do next. */
export async function staffLessonView(repo, lesson, { bank = null } = {}) {
  const questions = bank ?? await repo.listQuestions(lesson.contentId, { includeDiscarded: true });
  const byId = new Map(questions.map((q) => [String(q._id).toLowerCase(), q]));
  const tally = { listed: 0, approved: 0, waiting: 0, gone: 0 };
  const steps = await Promise.all((lesson.steps ?? []).map(async (s, index) => {
    const cite = citeSlides(s.slides);
    // Batch 8 (gap H9c): a chunk carrying a figure is shown as a figure step,
    // drawn with every step, with its spec for the professor's editor.
    if (s.type === 'chunk' && s.figure) {
      return { index, type: 'figure', slides: s.slides ?? [], cite, text: s.text ?? '', html: await html(s.text ?? ''), spec: s.figure, figure: figureWithSteps(s.figure) };
    }
    if (s.type === 'chunk') return { index, type: 'chunk', slides: s.slides ?? [], cite, text: s.text, html: await html(s.text) };
    if (s.type === 'example') {
      return {
        index,
        type: 'example',
        slides: s.slides ?? [],
        cite,
        label: lesson.status === 'draft' ? 'AI draft' : 'Written with AI help, approved',
        problem: s.problem,
        problemHtml: await html(s.problem),
        steps: await Promise.all((s.steps ?? []).map(async (t) => ({ text: t, html: await html(t) }))),
        answer: s.answer,
        answerHtml: await html(s.answer),
      };
    }
    return {
      index,
      type: 'questions',
      slides: s.slides ?? [],
      cite,
      questions: await Promise.all((s.questionIds ?? []).map(async (id) => {
        tally.listed += 1;
        const q = byId.get(String(id).toLowerCase());
        const served = servedFor(id, questions);
        if (!q) {
          tally.gone += 1;
          return { id: String(id), missing: true, note: 'No longer in the bank, so students do not see it.' };
        }
        if (q.status === 'draft') tally.waiting += 1;
        else if (served) tally.approved += 1;
        else tally.gone += 1;
        return {
          id: String(q._id),
          text: q.text,
          // As a student is shown it: a formula in a retrieval question reads as TeX in plain text.
          textHtml: await html(q.text),
          kind: q.kind ?? 'mcq',
          bloom: q.bloom,
          status: q.status,
          provenance: questionProvenance(q),
          ...(served && !sameId(served._id, q._id) ? { servedAs: String(served._id), note: 'Replaced in the bank; students see its replacement.' } : {}),
          // Batch 8: kept for rooms only, so a student never sees it in this lesson.
          ...(isRoomsOnly(served ?? q) ? { roomsOnly: true, note: 'Kept for rooms only, so students do not see it in this lesson.' } : {}),
        };
      })),
    };
  }));
  const waitingNote = tally.waiting
    ? `${tally.waiting} of this lesson's ${tally.listed} questions ${tally.waiting === 1 ? 'waits' : 'wait'} for your approval in the bank. `
      + 'Students see only the questions you approve.'
    : null;
  return {
    id: String(lesson._id),
    topicId: String(lesson.topicId),
    contentId: String(lesson.contentId),
    version: lesson.version,
    status: lesson.status,
    statusLabel: statusLabel(lesson),
    source: lesson.source,
    sourceLabel: lesson.source === 'llm' ? 'AI draft from your slides' : 'Slides only',
    model: lesson.model ?? null,
    basis: lesson.basis ?? {},
    warnings: lesson.warnings ?? [],
    steps,
    // Batch 8: the concept panel's sections, each cited, an AI draft while the
    // lesson is, and its Visual: the lesson's stepped figures, by step.
    sections: await sectionsView(lesson, { audience: 'staff', viewSteps: steps }),
    questions: { ...tally, note: waitingNote },
    createdAt: lesson.createdAt ?? null,
    createdBy: lesson.createdBy ?? null,
    approvedAt: lesson.approvedAt ?? null,
    approvedBy: lesson.approvedBy ?? null,
    retiredAt: lesson.retiredAt ?? null,
  };
}

/**
 * The approved lesson as one student reads it (H2, H11, H12, H15): each step
 * in their language where an approved translation can be shown (else English,
 * with a note), formulas and code as HTML, and each retrieval question that a
 * professor approved as the phone would see it (forStudent: never a key),
 * translated item for item where approved. Field by field: no draft, model,
 * warning, basis or status reaches a student.
 *
 * `account` is the student (their id seeds each question's shuffle through the
 * hub's one seed, hubSeed, as an attempt's marking and practice do); `language`
 * the language they chose.
 */
export async function studentLessonView(repo, { lesson, account, language = ORIGINAL }) {
  const bank = await repo.listQuestions(lesson.contentId, { includeDiscarded: true });
  const lessonTranslation = (await servableTranslations(repo, { kind: 'lesson', items: [lesson], language }))
    .get(String(lesson._id).toLowerCase()) ?? null;
  const shown = shownLanguage({ kind: 'lesson', wanted: language, translation: lessonTranslation });
  const f = lessonTranslation?.fields ?? {};
  const pick = (key, english) => (typeof f[key] === 'string' && f[key].trim() ? f[key] : english);

  const served = new Map();
  for (const s of lesson.steps ?? []) {
    if (s.type !== 'questions') continue;
    for (const id of s.questionIds ?? []) {
      const q = servedFor(id, bank);
      // Batch 8: a question kept for rooms only is never shown in a lesson; nor
      // (Batch 9) a drawing, which a lesson cannot mark (lessonQuestion).
      if (q && !isRoomsOnly(q) && !awaitsReview(q)) served.set(String(id), q);
    }
  }
  const questionTranslations = await servableTranslations(repo, { kind: 'question', items: [...new Set(served.values())], language });
  // HINT HOOK (H13): what each question offers in hints, from this student's own
  // attempts and their state on the lesson's topic (null for a staff preview).
  const hintState = served.size && account?.role === 'student'
    ? await studentTopicState(repo, account, lesson.topicId).catch(() => null) : null;
  // Questions closed to this student now (services/hubClosed.js): shown, but
  // their answer box and hints say why they wait, read once for the lesson.
  const closed = served.size && account?.role === 'student'
    ? await closedQuestions(repo, account, { contentIds: [String(lesson.contentId)] }) : new Map();
  // The student's earlier answers here, so a reload does not show a question
  // they answered as unanswered again. Answers in any version of a lesson count:
  // the attempt store keeps the mode, not the lesson (hubAttemptBridge.js).
  const earlier = served.size && account?.role === 'student'
    ? await lastLessonAnswers(repo, account, [...new Set([...served.values()].map((q) => String(q._id)))]) : new Map();

  const steps = [];
  for (const [i, s] of (lesson.steps ?? []).entries()) {
    const cite = citeSlides(s.slides);
    if (s.type === 'chunk' && s.figure) {
      // Batch 8 (gap H9c): the figure with every step drawn, so the student
      // steps through it on the phone, offline too, and the text beside it
      // (translated like any chunk). Never the spec. The figure's own labels
      // are shown as written: they are not translated yet.
      const text = pick(`steps.${i}.text`, s.text ?? '');
      steps.push({ type: 'figure', cite, text, html: await html(text), figure: figureWithSteps(s.figure) });
    } else if (s.type === 'chunk') {
      const text = pick(`steps.${i}.text`, s.text);
      steps.push({ type: 'chunk', cite, text, html: await html(text) });
    } else if (s.type === 'example') {
      const problem = pick(`steps.${i}.problem`, s.problem);
      const list = Array.isArray(f[`steps.${i}.steps`]) && f[`steps.${i}.steps`].length === (s.steps ?? []).length
        ? f[`steps.${i}.steps`] : (s.steps ?? []);
      const answer = pick(`steps.${i}.answer`, s.answer);
      steps.push({
        type: 'example',
        cite,
        label: EXAMPLE_LABEL,
        problem,
        problemHtml: await html(problem),
        steps: await Promise.all(list.map(async (t) => ({ text: t, html: await html(t) }))),
        answer,
        answerHtml: await html(answer),
      });
    } else if (s.type === 'questions') {
      const questions = [];
      const done = new Set();
      for (const id of s.questionIds ?? []) {
        const q = served.get(String(id));
        if (!q || done.has(String(q._id))) continue;
        done.add(String(q._id));
        const t = questionTranslations.get(String(q._id).toLowerCase()) ?? null;
        const base = forStudent(q, hubSeed(account?.id ?? '', q._id));
        const question = localiseQuestion(q, base, t);
        const why = closed.get(String(q._id).toLowerCase()) ?? null;
        const last = earlier.get(String(q._id).toLowerCase()) ?? null;
        questions.push({
          ...question,
          rich: await phoneRich(question),
          provenance: phoneProvenance(q),
          language: shownLanguage({ kind: 'question', wanted: language, translation: t }),
          hints: account?.role === 'student'
            ? await hintsOffered(repo, { account, question: q, topicId: String(lesson.topicId), mode: 'lesson', state: hintState, closed })
            : { available: 0, note: 'A student sees the hints you approved for each question here.' },
          ...(why ? { closed: { reason: why, note: CLOSED_SENTENCE[why] } } : {}),
          // Never a key before an attempt: null until the student has answered it here.
          lastAnswer: last ? await lastAnswerView(repo, { account, attempt: last, closedWhy: why, language }) : null,
          // Batch 8: sent back with the answer, the proof the lesson served it to this student.
          ...(account?.role === 'student' ? { serveToken: serveToken({ accountId: account.id, questionId: q._id, mode: 'lesson' }) } : {}),
        });
      }
      if (questions.length) steps.push({ type: 'questions', cite, questions });
    }
  }
  return {
    id: String(lesson._id),
    version: lesson.version,
    approvedAt: lesson.approvedAt ?? null,
    label: STUDENT_LABEL[lesson.source] ?? STUDENT_LABEL.slides,
    language: shown,
    steps,
    // Batch 8: the concept panel (introduction, facts, explanation, code example,
    // common mistakes), in the language shown where the approved translation has it.
    sections: await sectionsView(lesson, { fields: f, audience: 'student', viewSteps: steps }),
    answering: attemptStoreConnected(),
  };
}
