// The hub's concept panel (Batch 8, design-zip gaps H9a and H9b): optional
// sections on a topic's lesson, written with it on the professor's button.
//
//   intro      one paragraph introducing the topic
//   facts      up to three: "Why it matters", "Where it is used", "Connects to"
//   steps      an explanation in steps, each a term and one sentence
//   example    a code example, stored as text and rendered with the rich-text
//              service (a fenced block, shiki), never run
//   mistakes   common mistakes, one sentence each
//
// Decision 1 holds for every piece: written by the model from the professor's
// own lesson parts only (the chunks the lesson is made of), each piece naming
// the parts it came from, so it cites their slides. A piece naming no part
// offered, or none at all, is dropped and the warning says so. The sections go
// in the lesson's version (topic_lessons.sections, 0035), so they are an "AI
// draft" exactly while the lesson is, and students read them only once the
// professor approves the lesson. A slides-only lesson (no model) has none, and
// says so. Translations use the lesson's own fields (services/hubLanguages.js),
// keyed "sections.*"; terms and code stay in English (decision H12).
//
// What the model returns is held here, not trusted: lengths are capped, contact
// details refused, and each piece must cite a part. Tests drive cleanConcept()
// with fixture replies; nothing here calls a model.

import { holdsContact } from './roster.js';
import { CODE_LANGUAGES as RICH_LANGUAGES, richText } from './richText.js';

export const FACT_KINDS = Object.freeze(['why', 'where', 'connects']);
export const FACT_LABEL = Object.freeze({ why: 'Why it matters', where: 'Where it is used', connects: 'Connects to' });
export const MAX_INTRO = 900;
export const MAX_FACT = 300;
export const MAX_TERM = 60;
export const MAX_STEP_TEXT = 400;
export const MIN_STEPS = 2;
export const MAX_STEPS = 6;
export const MAX_CODE = 2000;
export const MAX_CODE_LINES = 40;
export const MAX_CAPTION = 200;
export const MAX_MISTAKES = 5;
export const MAX_MISTAKE = 300;
/** The languages a code example may name: those the rich-text service highlights (services/richText.js), or plain text. */
export const CODE_LANGUAGES = Object.freeze([...Object.keys(RICH_LANGUAGES), 'text']);
const LANGUAGE_OF = new Map(Object.entries(RICH_LANGUAGES).flatMap(([id, names]) => [[id, id], ...names.map((n) => [n, id])]));

export const SECTIONS_SLIDES_ONLY = 'This lesson is your slides only, so it has no introduction, facts, explanation steps, code example or '
  + 'common mistakes: those are written with AI help, and no AI model wrote this version.';
export const SECTIONS_NONE = 'The AI model wrote no introduction, facts, explanation, code example or common mistakes it could cite to '
  + 'your slides, so this lesson has none.';
/** What a student is told when the lesson has none: no professor-facing words, no model. */
export const STUDENT_NO_SECTIONS = 'This lesson is your professor\'s slides in short steps, with nothing added to them yet.';
export const SECTIONS_DRAFT = 'AI draft: written from your slides with AI help, cited to them. Students read it only once you approve the lesson.';
export const SECTIONS_APPROVED = 'Written with AI help from your slides; approved with the lesson.';
export const STUDENT_SECTIONS_LABEL = 'Written from your professor\'s slides with AI help, and checked by your professor.';

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const uniqueSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);

/** The instruction added to the lesson prompt (services/hubLessons.js buildLessonPrompt). */
export function conceptPrompt() {
  return [
    '3. Once, for the topic as a whole, "concept": short teaching sections from these parts ONLY, each naming the parts it uses in '
      + '"parts" (such as ["C1", "C2"]). Leave out any section the parts do not support; never add anything they do not teach.',
    '   "intro": {"text": one paragraph of 2 to 4 sentences, "parts"}. "facts": up to three of {"kind": "why" (why it matters) or '
      + '"where" (where it is used) or "connects" (what it connects to), "text": one sentence, "parts"}, only what the parts say. '
      + '"steps": 2 to 6 explanation steps {"term": a few words, "text": one sentence, "parts"}. "example": {"language": one of '
      + `${CODE_LANGUAGES.slice(0, 8).join(', ')} (or text), "body": the code, "caption": one sentence, "parts"} ONLY when the parts show or describe code; `
      + 'otherwise leave it out. "mistakes": up to 3 {"text": one sentence, "parts"}, mistakes the parts warn about or that follow directly from them.',
  ].join('\n');
}

/** The parts a piece names, as offered chunks; empty when it names none of them. */
function citedChunks(raw, byLabel) {
  const list = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
  const out = [];
  for (const p of list) {
    const label = collapse(p).toUpperCase();
    const chunk = byLabel.get(label);
    if (chunk && !out.includes(chunk)) out.push(chunk);
  }
  return out;
}

const citeOf = (chunks) => ({ parts: chunks.map((c) => c.label), slides: uniqueSorted(chunks.flatMap((c) => c.slides ?? [])) });

/** A code example's body: line ends kept, tabs as two spaces, no fence of its own (the renderer adds one). */
function cleanCode(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(/```/g, "'''").replace(/^\n+|\s+$/g, '');
  return text;
}

/**
 * The model's "concept" held to the rules in the header. `raw` is the reply's
 * concept object; `chunks` the lesson's parts as sent.
 *
 * @returns {{ sections: object|null, skipped: string[] }} null when nothing survives
 */
export function cleanConcept(raw, chunks = []) {
  const skipped = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { sections: null, skipped };
  const byLabel = new Map(chunks.map((c) => [c.label, c]));
  const cited = (piece, what) => {
    const from = citedChunks(piece?.parts ?? piece?.part, byLabel);
    if (!from.length) skipped.push(`${what} was left out: it named no part of the slides it came from`);
    return from;
  };
  const tooLong = (text, max, what) => {
    if (text.length > max) { skipped.push(`${what} was left out: it was over ${max} characters`); return true; }
    if (holdsContact(text)) { skipped.push(`${what} was left out: it held contact details`); return true; }
    return false;
  };
  const sections = { intro: null, facts: [], steps: [], example: null, mistakes: [] };

  if (raw.intro) {
    const text = collapse(raw.intro?.text ?? raw.intro);
    const from = text ? cited(raw.intro, 'The introduction') : [];
    if (text && from.length && !tooLong(text, MAX_INTRO, 'The introduction')) sections.intro = { text, ...citeOf(from) };
  }

  for (const f of (Array.isArray(raw.facts) ? raw.facts : [])) {
    const kind = collapse(f?.kind).toLowerCase();
    const text = collapse(f?.text);
    if (!FACT_KINDS.includes(kind)) { skipped.push('A fact was left out: it was not why it matters, where it is used or what it connects to'); continue; }
    if (sections.facts.some((x) => x.kind === kind)) { skipped.push(`A second "${FACT_LABEL[kind]}" fact was left out`); continue; }
    if (!text) continue;
    const from = cited(f, `The "${FACT_LABEL[kind]}" fact`);
    if (!from.length || tooLong(text, MAX_FACT, `The "${FACT_LABEL[kind]}" fact`)) continue;
    sections.facts.push({ kind, label: FACT_LABEL[kind], text, ...citeOf(from) });
  }
  sections.facts.sort((a, b) => FACT_KINDS.indexOf(a.kind) - FACT_KINDS.indexOf(b.kind));

  for (const s of (Array.isArray(raw.steps) ? raw.steps : [])) {
    const term = collapse(s?.term);
    const text = collapse(s?.text);
    if (!term || !text) { skipped.push('An explanation step was left out: it needs a term and a sentence'); continue; }
    if (sections.steps.length >= MAX_STEPS) { skipped.push(`An explanation step was left out: more than ${MAX_STEPS} were written`); continue; }
    const from = cited(s, 'An explanation step');
    if (!from.length || tooLong(term, MAX_TERM, 'An explanation step\'s term') || tooLong(text, MAX_STEP_TEXT, 'An explanation step')) continue;
    sections.steps.push({ term, text, ...citeOf(from) });
  }
  if (sections.steps.length && sections.steps.length < MIN_STEPS) {
    skipped.push(`The explanation was left out: it had fewer than ${MIN_STEPS} steps`);
    sections.steps = [];
  }

  if (raw.example && typeof raw.example === 'object') {
    const body = cleanCode(raw.example.body);
    const caption = collapse(raw.example.caption);
    const language = LANGUAGE_OF.get(collapse(raw.example.language).toLowerCase()) ?? 'text';
    const from = body ? cited(raw.example, 'The code example') : [];
    if (body && from.length) {
      if (body.length > MAX_CODE || body.split('\n').length > MAX_CODE_LINES) {
        skipped.push(`The code example was left out: it was over ${MAX_CODE_LINES} lines or ${MAX_CODE} characters`);
      } else if (holdsContact(body) || holdsContact(caption)) {
        skipped.push('The code example was left out: it held contact details');
      } else if (!tooLong(caption, MAX_CAPTION, 'The code example\'s caption')) {
        sections.example = { language, body, caption, ...citeOf(from) };
      }
    }
  }

  for (const m of (Array.isArray(raw.mistakes) ? raw.mistakes : [])) {
    const text = collapse(m?.text ?? m);
    if (!text) continue;
    if (sections.mistakes.length >= MAX_MISTAKES) { skipped.push(`A common mistake was left out: more than ${MAX_MISTAKES} were written`); continue; }
    const from = cited(m, 'A common mistake');
    if (!from.length || tooLong(text, MAX_MISTAKE, 'A common mistake')) continue;
    sections.mistakes.push({ text, ...citeOf(from) });
  }

  const any = sections.intro || sections.facts.length || sections.steps.length || sections.example || sections.mistakes.length;
  return { sections: any ? sections : null, skipped };
}

/** The concept object of a lesson reply's JSON text, or null. Never throws. */
export function conceptOfReply(text) {
  try {
    const raw = JSON.parse(String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim());
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw.concept ?? null : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- the views -- */

/** "Slide 3", "Slides 3 and 4"; or, with no slides, the chapter's text. */
function citeText(slides = []) {
  const ns = uniqueSorted((slides ?? []).filter((n) => Number.isInteger(n) && n > 0));
  if (!ns.length) return 'From the chapter\'s text';
  if (ns.length === 1) return `Slide ${ns[0]}`;
  return `Slides ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

const html = async (text) => (await richText(String(text ?? ''))).html;

/** The code as a fenced block, so the rich-text service highlights it (or escapes it as plain text). */
export const fenced = (example) => `\`\`\`${example.language === 'text' ? '' : example.language}\n${example.body}\n\`\`\``;

/** The translatable English of the sections, by field name (hubLanguages' lesson fields). Terms and code stay English. */
export function sectionFields(sections) {
  const out = {};
  if (!sections || typeof sections !== 'object') return out;
  if (sections.intro?.text) out['sections.intro'] = sections.intro.text;
  if (Array.isArray(sections.facts) && sections.facts.length) out['sections.facts'] = sections.facts.map((f) => f.text);
  if (Array.isArray(sections.steps) && sections.steps.length) out['sections.steps'] = sections.steps.map((s) => s.text);
  if (sections.example?.caption) out['sections.example.caption'] = sections.example.caption;
  if (Array.isArray(sections.mistakes) && sections.mistakes.length) out['sections.mistakes'] = sections.mistakes.map((m) => m.text);
  return out;
}

/** A section field's name as a professor reads it, or null for a field that is not one. */
export function sectionFieldLabel(key) {
  return {
    'sections.intro': 'the introduction',
    'sections.facts': 'the facts',
    'sections.steps': 'the explanation steps',
    'sections.example.caption': 'the code example\'s caption',
    'sections.mistakes': 'the common mistakes',
  }[key] ?? null;
}

/* The Visual tab (design zip H9c, merged with H9a and H9b). A lesson's stepped
   figure is the professor's own, added by hand (routes/figures.js), never
   written by the model, so a lesson without AI sections can still have one.
   It is already drawn once, every step included, as one of the lesson's steps;
   the panel points at that step instead of sending the drawing twice to a
   phone. */
export const VISUAL_NONE_STAFF = 'No figure has been added to this lesson yet. Add one to give it a Visual to step through.';
export const VISUAL_NONE_STUDENT = 'This lesson has no figure to step through.';

/**
 * The concept panel's Visual: each figure in the lesson's steps as this reader
 * gets them (`viewSteps`, the view's own list, so `step` is an index into it),
 * with its title, how many steps it moves through and the slides it cites.
 */
export function visualOf(viewSteps = [], audience = 'student') {
  const figures = (Array.isArray(viewSteps) ? viewSteps : []).flatMap((s, i) => (s?.type === 'figure' ? [{
    step: i,
    title: s.figure?.title ?? '',
    stepCount: Array.isArray(s.figure?.steps) ? s.figure.steps.length : 0,
    cite: s.cite ?? null,
  }] : []));
  return {
    available: figures.length > 0,
    figures,
    note: figures.length ? null : (audience === 'staff' ? VISUAL_NONE_STAFF : VISUAL_NONE_STUDENT),
  };
}

/**
 * The sections as one reader sees them: every piece with its citation and its
 * text as HTML. `fields` is an approved translation's field map ({} for
 * English); a list translated with another length falls back to English.
 * `audience` 'staff' adds the AI-draft label; a student is told who wrote it.
 * `viewSteps` is the lesson's steps as the same reader gets them, for the Visual
 * (visualOf), which is there whether or not the model wrote any section.
 */
export async function sectionsView(lesson, { fields = {}, audience = 'student', viewSteps = [] } = {}) {
  const s = lesson?.sections;
  const visual = visualOf(viewSteps, audience);
  const empty = (note) => ({ available: false, note, intro: null, facts: [], steps: [], example: null, mistakes: [], visual });
  if (!s || typeof s !== 'object') {
    if (audience !== 'staff') return empty(STUDENT_NO_SECTIONS);
    return empty(lesson?.source === 'slides' ? SECTIONS_SLIDES_ONLY : SECTIONS_NONE);
  }
  const pick = (key, english) => (typeof fields[key] === 'string' && fields[key].trim() ? fields[key] : english);
  const list = (key, english) => (Array.isArray(fields[key]) && fields[key].length === english.length ? fields[key] : english);
  const facts = Array.isArray(s.facts) ? s.facts : [];
  const steps = Array.isArray(s.steps) ? s.steps : [];
  const mistakes = Array.isArray(s.mistakes) ? s.mistakes : [];
  const factTexts = list('sections.facts', facts.map((f) => f.text));
  const stepTexts = list('sections.steps', steps.map((x) => x.text));
  const mistakeTexts = list('sections.mistakes', mistakes.map((m) => m.text));
  const intro = s.intro?.text ? pick('sections.intro', s.intro.text) : null;
  const caption = s.example?.caption ? pick('sections.example.caption', s.example.caption) : '';
  const label = audience === 'staff'
    ? (lesson.status === 'draft' ? SECTIONS_DRAFT : SECTIONS_APPROVED)
    : STUDENT_SECTIONS_LABEL;
  return {
    available: true,
    label,
    ...(audience === 'staff' ? { aiDraft: lesson.status === 'draft' } : {}),
    intro: intro ? { text: intro, html: await html(intro), slides: s.intro.slides ?? [], cite: citeText(s.intro.slides) } : null,
    facts: await Promise.all(facts.map(async (f, i) => ({
      kind: f.kind, label: FACT_LABEL[f.kind] ?? f.label, text: factTexts[i], html: await html(factTexts[i]), slides: f.slides ?? [], cite: citeText(f.slides),
    }))),
    steps: await Promise.all(steps.map(async (x, i) => ({
      term: x.term, text: stepTexts[i], html: await html(stepTexts[i]), slides: x.slides ?? [], cite: citeText(x.slides),
    }))),
    example: s.example?.body ? {
      language: s.example.language,
      body: s.example.body,
      html: await html(fenced(s.example)),
      caption,
      captionHtml: caption ? await html(caption) : '',
      slides: s.example.slides ?? [],
      cite: citeText(s.example.slides),
    } : null,
    mistakes: await Promise.all(mistakes.map(async (m, i) => ({
      text: mistakeTexts[i], html: await html(mistakeTexts[i]), slides: m.slides ?? [], cite: citeText(m.slides),
    }))),
    visual,
  };
}
