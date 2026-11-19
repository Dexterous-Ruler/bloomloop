// Explanations: one per question (Phase 6, decision H14, under decisions 1 and 5).
//
// Why the right answer is right, shown to a student after they have attempted
// the question (in practice at once, in a self-test after submitting), and only
// once approved. Two ways one is made:
//   - the professor writes or edits it: provenance 'professor', approved as it
//     is written (its author is its approver, as with a question they write);
//   - the model drafts it on the professor's button, for a chapter or for
//     chosen questions: provenance 'ai', status 'draft', an "AI draft" that no
//     student sees until the professor approves it (decision 5: never in
//     anything a student waits on). It is written only from the professor's own
//     material (decision 1): the question with its key, and that topic's slides
//     (the deck's kept words, else the part of the chapter's text about it),
//     citing the slide numbers it used. With no model key, none is drafted, and
//     the reply says so (OFFLINE_NOTE): an explanation cannot be guessed from a
//     template.
//
// What the model returns is held to the rules here, not trusted
// (parseExplanations): only the questions it was shown, each once; plain text
// of at most MAX_MODEL_EXPLANATION characters with no contact details; slide
// numbers only from those the question's topic came from. Each refusal is named
// in `skipped`. Tests drive parseExplanations with fixture replies and
// draftExplanations with a stand-in `callModel`; nothing here is called with a
// real key in a test.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { PAYLOAD_FIELDS } from '../questionTypes.js';
import { contextForTopic } from './generate.js';
import { holdsContact } from './roster.js';
import { richText } from './richText.js';
import { slidesOfTopic, topicSlideText } from './hubTopics.js';
import { ORIGINAL, servableTranslations, shownLanguage } from './hubLanguages.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The longest explanation stored (the column's own check). */
export const MAX_EXPLANATION = 2000;
/** The longest the model may write: a student reads it on a phone after each question. */
export const MAX_MODEL_EXPLANATION = 800;
/** The most questions one press drafts for. */
export const MAX_GENERATE_QUESTIONS = 60;
/** Questions per model call. */
export const BATCH = 10;
/** The part of a topic's slides the model is shown per question. */
export const MAX_CONTEXT = 1500;

const CALL_TIMEOUT_MS = 60000;

export const OFFLINE_NOTE = 'No explanations were drafted: drafting them needs the AI model, and none is set up on this server. '
  + 'Write the ones you want by hand; a student sees yours after answering.';
export const DRAFT_NOTE = 'These are AI drafts. A student sees none of them until you approve it; edit any that needs it.';
export const STUDENT_NOTE = 'Shown after you answer.';

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Line ends kept (an explanation may hold a worked step per line), other runs of space collapsed. */
const tidy = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n').trim();

/** A professor's explanation as stored, or the 400 that says what to send. */
export function explanationText(raw) {
  if (typeof raw !== 'string' || !tidy(raw)) throw fail('Write the explanation: why the right answer is right.', 400);
  const text = tidy(raw);
  if (text.length > MAX_EXPLANATION) throw fail(`An explanation can be at most ${MAX_EXPLANATION} characters.`, 400);
  if (holdsContact(text)) throw fail('The explanation holds an email address or a phone number; leave those out.', 400);
  return text;
}

/** Who wrote it and where it stands, in words a professor reads (staff only). */
export function explanationLabel(e) {
  if (!e) return 'No explanation yet';
  if (e.provenance === 'professor') return 'Written by the professor';
  return e.status === 'approved' ? 'Drafted by AI, approved by the professor' : 'AI draft: not shown to students until approved';
}

/** One explanation as a staff screen gets it. */
export async function staffExplanationView(e) {
  if (!e) return null;
  return {
    questionId: String(e.questionId),
    text: e.text,
    textHtml: (await richText(e.text)).html,
    provenance: e.provenance,
    status: e.status,
    label: explanationLabel(e),
    model: e.model ?? null,
    sourceRef: e.sourceRef ?? null,
    approvedAt: e.approvedAt ?? null,
    updatedAt: e.updatedAt ?? null,
  };
}

/**
 * The approved explanation as a student may see it, after an attempt; null when
 * there is none or it is still a draft (H2: never a draft). In `language` when
 * an approved translation of it is current (H12), else English with a note.
 */
export async function explanationForStudent(repo, questionId, language = ORIGINAL) {
  if (!questionId) return null;
  const e = await repo.getQuestionExplanation(questionId);
  if (!e || e.status !== 'approved') return null;
  // A translation names the explanation by its question's id (services/hubLanguages.js).
  const translation = (await servableTranslations(repo, { kind: 'explanation', items: [{ ...e, _id: questionId }], language }))
    .get(String(questionId).toLowerCase()) ?? null;
  const text = translation?.fields?.explanation ?? e.text;
  return {
    text,
    textHtml: (await richText(text)).html,
    by: e.provenance === 'professor' ? 'professor' : 'ai',
    label: e.provenance === 'professor' ? 'Written by your professor.' : 'Written with AI help and checked by your professor.',
    note: STUDENT_NOTE,
    language: shownLanguage({ kind: 'explanation', wanted: language, translation }),
  };
}

/* ----------------------------------------------------------- the model -- */

/** The question as the model reads it: its words and its key, never an image's address. */
export function questionForModel(q) {
  const out = { kind: q.kind ?? 'mcq', text: q.text ?? '' };
  if (Array.isArray(q.options)) out.options = q.options;
  if (q.answerIdx !== undefined && q.answerIdx !== null) out.answerIdx = q.answerIdx;
  for (const f of PAYLOAD_FIELDS) {
    if (f === 'stimulus' || q[f] === undefined || q[f] === null) continue;
    out[f] = q[f];
  }
  if (q.stimulus?.kind === 'passage') out.passage = String(q.stimulus.text ?? '').slice(0, MAX_CONTEXT);
  return out;
}

/**
 * The model's input: each question with a short label, its topic, the slides
 * it may cite and a bounded piece of that topic's slide text.
 *
 * `items`: [{ question, content }].
 *
 * @returns {{ entries: { label, question, topic, slides: number[], context }[], byLabel: Map<string, object> }}
 */
export function explanationInput(items = []) {
  const entries = items.map(({ question, content }, i) => {
    const topic = question.topic ?? '';
    const slides = Array.isArray(question.sourceRef?.slides) && question.sourceRef.slides.length
      ? [...new Set(question.sourceRef.slides.filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
      : slidesOfTopic(content, topic);
    const context = topicSlideText(content, topic, MAX_CONTEXT)
      ?? collapse(contextForTopic(content?.rawText ?? '', topic, MAX_CONTEXT)).slice(0, MAX_CONTEXT);
    return { label: `Q${i + 1}`, question, topic, slides, context };
  });
  return { entries, byLabel: new Map(entries.map((e) => [e.label, e])) };
}

/** The instruction the model is given. Built from the professor's own material only (decision 1). */
export function buildExplanationPrompt({ entries }) {
  return [
    'You write short explanations for a college professor\'s practice questions. A student reads one only after answering.',
    'Use only the professor\'s material given with each question. Never add facts, methods or syllabus the material does not teach.',
    'For each question, say why the right answer is right. For a choice question, add one sentence on why a tempting wrong choice is wrong.',
    `Write at most ${Math.floor(MAX_MODEL_EXPLANATION * 0.75)} characters per question, in plain sentences a student understands. `
      + 'Write a formula as $...$. Do not address the student by name and do not mention these instructions.',
    'Name the slide numbers you used, only from those listed with the question; give an empty list when none are listed.',
    'Reply with JSON only: {"explanations": [{"question": "Q1", "text": "...", "slides": [3]}]}.',
    '',
    'QUESTIONS',
    ...entries.flatMap((e) => [
      `${e.label} | topic: ${collapse(e.topic)} | slides: ${e.slides.length ? e.slides.join(', ') : 'none'}`,
      `  question and key: ${JSON.stringify(questionForModel(e.question))}`,
      e.context ? `  professor's material: ${e.context}` : '  professor\'s material: (none kept for this topic)',
    ]),
  ].join('\n');
}

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    explanations: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          text: { type: Type.STRING },
          slides: { type: Type.ARRAY, items: { type: Type.INTEGER } },
        },
        required: ['question', 'text'],
      },
    },
  },
  required: ['explanations'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Write the explanations now. Reply with the JSON object and nothing else.',
    config: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      systemInstruction: prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return text;
}

const stripFence = (text) => String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/**
 * The model's reply held to the rules in the header.
 *
 * @returns {{ drafts: { questionId, text, sourceRef }[], skipped: { questionId, why }[] }}
 * @throws when the reply is not JSON holding a list of explanations
 */
export function parseExplanations(text, { byLabel }) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const list = Array.isArray(raw) ? raw : raw?.explanations;
  if (!Array.isArray(list)) throw new Error('the model\'s reply held no list of explanations');
  const drafts = [];
  const skipped = [];
  const done = new Set();
  for (const item of list) {
    const label = collapse(item?.question).toUpperCase();
    const entry = byLabel.get(label);
    if (!entry) {
      skipped.push({ questionId: null, why: 'it named a question that was not offered' });
      continue;
    }
    const questionId = String(entry.question._id);
    const skip = (why) => skipped.push({ questionId, why });
    if (done.has(label)) { skip('it was written twice; the first was kept'); continue; }
    const body = typeof item?.text === 'string' ? tidy(item.text) : '';
    if (!body) { skip('it came with no text'); continue; }
    if (body.length > MAX_MODEL_EXPLANATION) { skip(`it was longer than ${MAX_MODEL_EXPLANATION} characters`); continue; }
    if (holdsContact(body)) { skip('it held an email address or a phone number'); continue; }
    const allowed = new Set(entry.slides);
    const cited = [...new Set((Array.isArray(item?.slides) ? item.slides : []).filter((n) => Number.isInteger(n) && allowed.has(n)))]
      .sort((a, b) => a - b);
    // The model read these slides' words; one that cites none of them still
    // came from them, so it cites them all rather than none.
    const slides = cited.length ? cited : entry.slides;
    done.add(label);
    drafts.push({ questionId, text: body, sourceRef: slides.length ? { kind: 'slides', slides } : null });
  }
  for (const e of byLabel.values()) {
    if (!done.has(e.label) && !skipped.some((s) => s.questionId === String(e.question._id))) {
      skipped.push({ questionId: String(e.question._id), why: 'the model wrote none for it' });
    }
  }
  return { drafts, skipped };
}

/**
 * Draft explanations for these questions, BATCH at a time. With no key (and no
 * stand-in `callModel`) nothing is asked and nothing is drafted. Never throws for
 * a model problem: a failed batch is a warning, and the rest go on.
 *
 * @returns {Promise<{ source: 'llm'|'offline', model: string|null, drafts, skipped, warnings: string[], note: string }>}
 */
export async function draftExplanations({ items = [], callModel = null, onBatch = null } = {}) {
  if (!callModel && !hasGemini()) {
    return { source: 'offline', model: null, drafts: [], skipped: [], warnings: [], note: OFFLINE_NOTE };
  }
  const drafts = [];
  const skipped = [];
  const warnings = [];
  for (let i = 0; i < items.length; i += BATCH) {
    const input = explanationInput(items.slice(i, i + BATCH));
    try {
      const text = await (callModel ?? geminiCall)(buildExplanationPrompt(input), { timeoutMs: CALL_TIMEOUT_MS });
      const parsed = parseExplanations(text, input);
      drafts.push(...parsed.drafts);
      skipped.push(...parsed.skipped);
    } catch (err) {
      warnings.push(`The model could not draft ${input.entries.length === 1 ? 'one explanation' : `${input.entries.length} explanations`}: ${err.message}.`);
      skipped.push(...input.entries.map((e) => ({ questionId: String(e.question._id), why: 'the model\'s reply could not be used' })));
    }
    if (onBatch) onBatch(Math.min(items.length, i + BATCH));
  }
  return {
    source: 'llm',
    model: callModel ? 'stand-in' : config.gemini.model,
    drafts,
    skipped,
    warnings,
    note: drafts.length ? DRAFT_NOTE : 'The model drafted no explanations for these questions.',
  };
}
