// F2 - the Bloom-tagged question bank. Two paths behind one shape: Gemini when
// GEMINI_API_KEY is present, a deterministic template bank when it is not.
//
// The fallback is not a stub. The demo has to survive a dead venue wifi and an
// exhausted free-tier quota, so the offline path builds the same schema-valid
// items out of the real source text and every one of them is tagged
// source:'fallback' [CONTRACT.md section 6 rule 5] so the UI can never pass a
// template item off as model output.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { LEVELS, LABEL, VERBS, DEFAULT_MIX, isLevel } from '../bloom.js';
import {
  KINDS,
  LABEL as KIND_LABEL,
  BLANK_MARK,
  MAX_STIMULUS_TEXT,
  swapsFor,
  isUngraded,
  invalidReason,
} from '../questionTypes.js';
import { resolveKindMix, spreadKinds, countKinds, kindAllowedAt } from './plan.js';
import { MAX_LABEL, proposedLabels } from './misconceptions.js';

/**
 * The kinds this file may write. Everything the contract offers, minus the
 * ungraded ones.
 *
 * Derived rather than listed, so a kind added to UNGRADED_KINDS stops being
 * generable the moment it lands there. A poll has no right answer, which makes
 * it the one item type a model cannot be asked for: "invent an opinion question
 * about this chapter" produces a question whose answer the source text does not
 * settle, and every other rule in the prompt below exists to forbid exactly
 * that. It is the teacher's to author.
 */
const GENERATED_KINDS = KINDS.filter((kind) => !isUngraded(kind));

/**
 * What questions.model records for an item the offline templates built. A model
 * item records the model id it was asked of (config.gemini.model), so a bank
 * written across a model change still says which model wrote which item.
 */
export const OFFLINE_MODEL = 'offline-template';

/** Enough of the chapter for the model to answer from, small enough to stay fast. */
const MAX_CONTEXT_CHARS = 6000;

const MAX_OPTION_CHARS = 140;
const MAX_TERM_CHARS = 48;
const MAX_TOPIC_CHARS = 60;

/** Guard rails so a bad `perTopic` cannot turn one click into a 10-minute run. */
const MAX_PER_LEVEL = 12;
const MAX_PER_TOPIC = 30;
const MAX_TOPICS = 12;

/** Three in flight: enough to beat the two-minute bar, gentle on the free tier. */
const CONCURRENCY = 3;

/** A hung request must not eat the retry budget. */
const CALL_TIMEOUT_MS = 45000;

/**
 * Hard ceiling on a whole bank run. Slow topics stop calling the API once it is
 * spent and take template items instead, so "a chapter in under two minutes"
 * holds even when the venue wifi is crawling.
 */
const BANK_BUDGET_MS = 90000;

/** Mined vocabulary is capped so distractor selection stays cheap and stable. */
const MAX_TERMS = 24;

/**
 * A shared reading has to be long enough to be worth asking three questions
 * about and short enough to sit above the question on a phone. The contract's
 * MAX_STIMULUS_TEXT is the outer wall - four thousand characters, past which a
 * stimulus stops being context and becomes the lesson - and these are the
 * working range this file generates inside.
 */
const MIN_PASSAGE_CHARS = 260;
const MAX_PASSAGE_CHARS = 1200;

/**
 * Two readings per topic at most. The point of a passage is that SEVERAL
 * questions hang off it; a bank of a dozen items with five passages in it has
 * gone back to one reading per question, which is the arrangement this feature
 * exists to break.
 */
const MAX_PASSAGES = 2;

// Explicitly forbidden in the prompt, so also refused by the validator - the two
// have to agree or "strict validation" means nothing.
const BANNED_OPTIONS = [/\ball of the above\b/i, /\bnone of the above\b/i];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'these', 'those', 'with', 'from', 'into', 'onto',
  'their', 'there', 'then', 'than', 'them', 'they', 'have', 'has', 'had', 'been', 'being',
  'are', 'was', 'were', 'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'not', 'but', 'also', 'such', 'each', 'other', 'more', 'most', 'some', 'any',
  'all', 'both', 'when', 'while', 'where', 'which', 'what', 'who', 'whom', 'how', 'why',
  'you', 'your', 'our', 'its', 'his', 'her', 'him', 'she', 'here', 'about', 'above',
  'after', 'before', 'between', 'during', 'over', 'under', 'through', 'because', 'however',
  'therefore', 'thus', 'very', 'much', 'many', 'only', 'just', 'like', 'used', 'using',
  'use', 'uses', 'example', 'examples', 'following', 'below', 'slide', 'chapter',
  'unit', 'lecture', 'note', 'notes', 'introduction', 'overview', 'summary', 'topic',
]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Single-line normalisation. For fields that must never contain a newline. */
const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Multi-line normalisation. Line breaks survive on purpose: extracted slide text
 * is mostly punctuation-free bullets, and the newline is the only sentence
 * boundary such text has.
 */
const tidy = (value) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const normKey = (value) => collapse(value).toLowerCase();

const contentWords = (value) =>
  new Set(
    normKey(value)
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );

/**
 * Two options that say the same thing in different words are two correct
 * answers. Distinct strings is not a strong enough test on mined text, where
 * "X is the process that ..." and "the process that ..." both surface.
 */
function tooSimilar(a, b) {
  const left = contentWords(a);
  const right = contentWords(b);
  if (!left.size || !right.size) return normKey(a) === normKey(b);
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size) >= 0.7;
}

/** Slide decks are full of title lines; they define nothing and make weak options. */
function looksLikeHeading(sentence) {
  const words = sentence.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  return words.filter((word) => /^[A-Z0-9]/.test(word)).length / words.length >= 0.6;
}

/**
 * Give every option the same shape - leading capital, closing full stop - so
 * formatting alone never marks out the correct answer.
 */
function asStatement(value) {
  const text = collapse(value);
  if (!text) return text;
  const capped = text[0].toUpperCase() + text.slice(1);
  return /[.!?;]$/.test(capped) ? capped : `${capped}.`;
}

function clip(value, max) {
  const text = collapse(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  const body = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${body.replace(/[\s,;:.\-]+$/, '')}...`;
}

/**
 * A topic as the generator stamps it on each question it writes: collapsed and
 * clipped to MAX_TOPIC_CHARS. The Learning Hub (Phase 6) matches a question to
 * its chapter's topic record by this as well as by the full name, so a long
 * slide title still owns its questions; no question is rewritten.
 */
export const questionTopicFor = (topic) => clip(collapse(topic), MAX_TOPIC_CHARS);

/** FNV-1a. Only needs to be stable and well spread, not cryptographic. */
function hashString(value) {
  let h = 0x811c9dc5;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded Fisher-Yates: the fallback bank must be reproducible run to run. */
function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const totalOf = (mix) => LEVELS.reduce((sum, level) => sum + (mix[level] || 0), 0);

function countByLevel(items) {
  const out = LEVELS.reduce((acc, level) => ({ ...acc, [level]: 0 }), {});
  for (const item of items) {
    if (isLevel(item?.bloom)) out[item.bloom] += 1;
  }
  return out;
}

function sanitiseMix(spec) {
  const out = {};
  let any = false;
  for (const level of LEVELS) {
    const n = Math.floor(Number(spec?.[level]));
    out[level] = Number.isFinite(n) ? Math.min(Math.max(n, 0), MAX_PER_LEVEL) : 0;
    if (out[level] > 0) any = true;
  }
  return any ? out : { ...DEFAULT_MIX };
}

/**
 * Scale the default weighting to a requested per-topic total using the
 * largest-remainder method, so the shape of DEFAULT_MIX (deep at the bottom of
 * the ladder, thin at the top) survives the rescale.
 */
function scaleMix(base, total) {
  const baseTotal = totalOf(base);
  const raw = LEVELS.map((level) => ((base[level] || 0) * total) / baseTotal);
  const counts = raw.map((n) => Math.floor(n));
  let rest = total - counts.reduce((a, b) => a + b, 0);

  const order = LEVELS.map((_, i) => i).sort(
    (a, b) => raw[b] - counts[b] - (raw[a] - counts[a]) || a - b,
  );
  for (let k = 0; rest > 0; k += 1, rest -= 1) counts[order[k % order.length]] += 1;

  return LEVELS.reduce((acc, level, i) => ({ ...acc, [level]: counts[i] }), {});
}

/** `perTopic` is either a whole-number target or an explicit per-level mix. */
function resolveMix(spec) {
  if (spec && typeof spec === 'object') return sanitiseMix(spec);
  const total = Math.round(Number(spec));
  if (Number.isFinite(total) && total > 0) return scaleMix(DEFAULT_MIX, Math.min(total, MAX_PER_TOPIC));
  return { ...DEFAULT_MIX };
}

/**
 * The interactions for one run: level -> { kind: weight }.
 *
 * A level offers a SET of kinds and the caller may pick any of them, because
 * everything in a set demands the same cognitive move. Two shapes are taken:
 * level -> 'kind', the whole level as one kind, which is what every caller sent
 * before the kind mix; and level -> { kind: weight }, several kinds in
 * proportion - a plan's per-topic counts are this shape too, and come back out
 * as exactly those counts (spreadKinds). A level not named gets the default
 * mix. A kind from another level's set is dropped here rather than obeyed -
 * "Evaluate, rendered as an mcq" is the one thing this whole design exists to
 * make impossible, and a generator that quietly honoured it would undo the
 * plan validation upstream.
 */
function sanitiseKinds(kinds) {
  const one = {};
  const mix = {};
  if (kinds && typeof kinds === 'object') {
    for (const level of LEVELS) {
      const v = kinds[level];
      if (v && typeof v === 'object') mix[level] = v;
      else if (typeof v === 'string') one[level] = v;
    }
  }
  return resolveKindMix({ kinds: one, kindMix: mix });
}

/** level -> { kind: count }, exactly plan[level] questions at each level. */
function slotsFor(plan, kindMix) {
  const out = {};
  for (const level of LEVELS) {
    const n = plan[level] || 0;
    if (n > 0) out[level] = countKinds(spreadKinds(kindMix[level], n));
  }
  return out;
}

/** What is still missing per level and kind, once `items` are counted against `slots`. */
function slotShortfall(slots, items) {
  const out = {};
  for (const level of LEVELS) {
    const left = { ...(slots[level] ?? {}) };
    for (const item of items) {
      if (item?.bloom === level && left[item.kind] > 0) left[item.kind] -= 1;
    }
    for (const k of Object.keys(left)) if (left[k] <= 0) delete left[k];
    if (Object.keys(left).length) out[level] = left;
  }
  return out;
}

/** level -> { kind: count } summed to level -> count. */
const levelTotals = (slots) =>
  LEVELS.reduce((acc, level) => ({
    ...acc,
    [level]: Object.values(slots[level] ?? {}).reduce((a, b) => a + b, 0),
  }), {});

/**
 * The kinds to try for one slot, in order: the one this slot asked for, the
 * others planned at the level, then the rest of the level's own set. If this
 * chapter cannot carry a Sort honestly it may still carry a Match, and both are
 * Understand - so the item survives without the level being lied about.
 * Dropping to an mcq at a level that does not offer one is NOT in this list:
 * that is the taxonomy going decorative, which is the failure this product
 * exists to prevent, and it would happen precisely on the thin material where
 * the level tags matter most.
 */
const tryOrder = (level, asked, planned) =>
  [...new Set([asked, ...planned, ...swapsFor(level)])].filter((k) => k && kindAllowedAt(k, level));

/** Take one slot for a kind just built: its own if one is waiting, else the slot at the head. */
function takeSlot(pending, kind) {
  const at = pending.indexOf(kind);
  pending.splice(at >= 0 ? at : 0, 1);
}

function shortfall(plan, items) {
  const have = countByLevel(items);
  return LEVELS.reduce(
    (acc, level) => ({ ...acc, [level]: Math.max(0, (plan[level] || 0) - have[level]) }),
    {},
  );
}

function keywordsOf(topic) {
  const words = normKey(topic)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const whole = normKey(topic);
  return whole && !words.includes(whole) ? [whole, ...words] : words;
}

/**
 * Narrow a whole chapter down to the part that is actually about this topic.
 * The model is told every item must be answerable from the text it is given, so
 * feeding it the wrong 6000 characters is worse than feeding it fewer.
 */
export function contextForTopic(rawText, topic, maxChars = MAX_CONTEXT_CHARS) {
  const text = tidy(rawText);
  if (!text) return '';
  if (text.length <= maxChars) return text;

  const blocks = text
    .split(/\n{2,}|\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block, i) => ({ i, block }));

  const keys = keywordsOf(topic);
  const scored = blocks.map((entry) => {
    const low = entry.block.toLowerCase();
    const score = keys.reduce((sum, key) => sum + (low.includes(key) ? 1 : 0), 0);
    return { ...entry, score };
  });

  const picked = [];
  let used = 0;
  const take = (entry) => {
    if (used + entry.block.length + 1 > maxChars) return;
    picked.push(entry);
    used += entry.block.length + 1;
  };

  for (const entry of scored.filter((e) => e.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)) {
    take(entry);
  }
  // Surrounding material still helps: a topic named once needs the paragraphs
  // around it before the model has anything to write four options from.
  if (used < maxChars * 0.6) {
    const chosen = new Set(picked.map((p) => p.i));
    for (const entry of scored) {
      if (chosen.has(entry.i)) continue;
      take(entry);
      if (used >= maxChars * 0.95) break;
    }
  }

  if (!picked.length) return text.slice(0, maxChars);
  return picked
    .sort((a, b) => a.i - b.i)
    .map((entry) => entry.block)
    .join('\n');
}

/**
 * Where in the uploaded deck a question's topic was read from, for
 * questions.source_ref: {kind: 'slides', slides: [3, 4]}, or null.
 *
 * The topic's slides, not the exact sentence the item was built from: the
 * generator is handed the topic's part of the whole chapter (contextForTopic),
 * so this is where the topic lives in the deck, which is what a professor needs
 * to open beside the draft. Null for pasted text, a topic the professor renamed
 * after upload, and a deck uploaded before slides were kept.
 *
 * Matched the way the generator names a topic - collapsed, clipped to the same
 * length, case ignored - so a long slide title still finds its slides.
 */
export function sourceRefFor(content, topic) {
  const map = content?.topicSlides;
  const want = normKey(topic);
  if (!want || !map || typeof map !== 'object') return null;
  for (const [name, slides] of Object.entries(map)) {
    if (normKey(name) !== want && normKey(clip(name, MAX_TOPIC_CHARS)) !== want) continue;
    const numbers = [...new Set((Array.isArray(slides) ? slides : []).filter((n) => Number.isInteger(n) && n > 0))];
    if (numbers.length) return { kind: 'slides', slides: numbers.sort((a, b) => a - b) };
  }
  return null;
}

/**
 * A newline ends a *line*, not a sentence. Source text arrives hard-wrapped -
 * a pasted syllabus, or one line per DrawingML paragraph out of a deck - so
 * splitting on every newline chopped sentences mid-clause and put fragments
 * like "The gathering of data from multiple." on a student's phone as an
 * answer option. Re-join a line with the next one unless it actually finished.
 */
function unwrapLines(text) {
  const out = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const prev = out[out.length - 1];
    if (prev === undefined || /[.!?;:]$/.test(prev)) out.push(line);
    else out[out.length - 1] = `${prev} ${line}`;
  }
  return out.join('\n');
}

function sentencesOf(text) {
  const candidates = unwrapLines(tidy(text))
    .split(/\n+|(?<=[.!?;])\s+/)
    .map((s) => s.replace(/^[\s\u2022*\-\d.)]+/, '').trim())
    .filter((s) => s.length >= 12 && s.length <= 320);

  // Prefer only complete sentences, since these become answer options verbatim.
  // Fall back to the raw list rather than starve the generator on a source that
  // is all headings and no prose.
  const complete = candidates.filter((s) => /[.!?;]$/.test(s));
  return complete.length >= 4 ? complete : candidates;
}

const DEFINITION =
  /^(?:the |a |an )?([A-Za-z][A-Za-z0-9 \-/()]{2,44}?)\s+(?:is|are|means|refers to|is called|is known as|is defined as|can be defined as|consists of|describes|denotes)\s+(.{12,})$/i;

const PROPER_PHRASE = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/g;

const LINKING =
  /^(.{2,48}?)\s+(?:is|are|means|refers to|is called|is known as|is defined as|consists of|describes|denotes)\s+(.{12,})$/i;

/**
 * Turn "X is Y" into "Y". Options must not name their own subject, or the
 * correct answer is the only one that repeats the term in the stem.
 */
function toPredicate(sentence) {
  const match = sentence.match(LINKING);
  return match ? match[2].replace(/^[\s:\-\u2013]+/, '').trim() : sentence;
}

/**
 * Pull real vocabulary out of the source so template items are about the actual
 * material rather than about the topic name. Definition-shaped sentences first,
 * then proper-noun phrases, then plain repeated content words.
 */
function mineTerms(topic, contextText) {
  const sentences = sentencesOf(contextText);
  const entries = new Map();
  let order = 0;

  // `defined` marks a term some sentence of the source defines outright ("X is
  // ..."). The hot-text template asks a student to pick exactly these out of a
  // line, so it has to be a fact about the text, not a guess from the score.
  const put = (rawTerm, gloss, score, defined = false) => {
    const term = collapse(rawTerm)
      .replace(/^(?:the|a|an)\s+/i, '')
      .replace(/[^\w\s\-/()]+$/, '')
      .trim();
    if (term.length < 3 || term.length > MAX_TERM_CHARS) return;
    const key = term.toLowerCase();
    if (STOPWORDS.has(key)) return;

    const existing = entries.get(key);
    if (existing) {
      if (gloss && (!existing.gloss || score > existing.score)) existing.gloss = gloss;
      existing.score = Math.max(existing.score, score);
      existing.defined = existing.defined || defined;
      return;
    }
    entries.set(key, { term, key, gloss: gloss || '', score, defined, order: (order += 1) });
  };

  // The topic itself is always a legitimate subject for a question.
  put(topic, '', 6);

  for (const sentence of sentences) {
    const match = sentence.match(DEFINITION);
    if (match) put(match[1], match[2], 5, true);
  }
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(PROPER_PHRASE)) put(match[1], '', 2);
  }

  const tokens = tidy(contextText).toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? [];
  const freq = new Map();
  const firstAt = new Map();
  tokens.forEach((token, i) => {
    if (STOPWORDS.has(token)) return;
    freq.set(token, (freq.get(token) || 0) + 1);
    if (!firstAt.has(token)) firstAt.set(token, i);
  });
  [...freq.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || firstAt.get(a[0]) - firstAt.get(b[0]))
    .slice(0, 20)
    .forEach(([token]) => put(token, '', 1));

  for (const entry of entries.values()) {
    if (entry.gloss) continue;
    const sentence = sentences.find(
      (s) => s.length >= 25 && !looksLikeHeading(s) && s.toLowerCase().includes(entry.key),
    );
    if (sentence) entry.gloss = toPredicate(sentence);
  }

  // A gloss that opens with its own term ("Tracked by a process control block")
  // hands the answer away, so those terms sink to the bottom of the ranking
  // rather than being dropped - a bullet-only deck may have nothing better.
  const giveaway = (entry) => (normKey(entry.gloss).startsWith(entry.key) ? 1 : 0);

  const ranked = [...entries.values()]
    .filter((entry) => entry.gloss || entry.score >= 4)
    .sort((a, b) => giveaway(a) - giveaway(b) || b.score - a.score || a.order - b.order)
    .slice(0, MAX_TERMS);

  if (!ranked.length) {
    ranked.push({ term: collapse(topic), key: normKey(topic), gloss: '', score: 6, defined: false, order: 1 });
  }

  return ranked.map((entry) => ({
    ...entry,
    term: clip(entry.term, MAX_TERM_CHARS),
    // `generic` marks a term the source text never actually described. It can
    // still carry a question, but it makes a hollow distractor.
    generic: !entry.gloss,
    gloss: asStatement(
      clip(entry.gloss || `a core idea the material on ${topic} introduces by name`, MAX_OPTION_CHARS),
    ),
  }));
}

// Three stems per level so a thin chapter (few mined terms) still yields three
// distinct items at each level. Each stem leans on a Krathwohl exemplar verb for
// its level, and every stem is answered by a description, which is what keeps
// the four options grammatically interchangeable. `topic` is always placed so
// that the substitute label ("this chapter") reads correctly too.
const STEMS = {
  remember: [
    (topic, term) => `Which of the following best identifies "${term}" as it is used in ${topic}?`,
    (topic, term) => `Recall the material on ${topic}: which statement correctly names what "${term}" is?`,
    (topic, term) => `Which option states the definition of "${term}" given in the material on ${topic}?`,
  ],
  understand: [
    (topic, term) => `Which statement best explains "${term}" in the context of ${topic}?`,
    (topic, term) => `Which option best summarises what the material on ${topic} describes as "${term}"?`,
    (topic, term) => `How would you classify "${term}" on the basis of the material on ${topic}?`,
  ],
  apply: [
    (topic, term) => `You are working through an exercise on ${topic} that needs "${term}". Which description should you apply?`,
    (topic, term) => `A student solving a problem in ${topic} reaches "${term}". Which statement should they use to proceed?`,
    (topic, term) => `Which description would you demonstrate to a classmate who has to use "${term}" in ${topic}?`,
  ],
  analyse: [
    (topic, term) => `Which option correctly differentiates "${term}" from the other ideas covered in ${topic}?`,
    (topic, term) => `Analysing the material on ${topic}, which statement is the one attributable to "${term}"?`,
    (topic, term) => `Contrast the ideas in ${topic}: which description belongs to "${term}" rather than to the others?`,
  ],
  evaluate: [
    (topic, term) => `Which description of "${term}" is best justified by the material on ${topic}?`,
    (topic, term) => `Judge these accounts of "${term}": which one does the material on ${topic} defend?`,
    (topic, term) => `Critique the following claims about "${term}": which is the most defensible given ${topic}?`,
  ],
  create: [
    (topic, term) => `You are designing a new worked example in ${topic} built around "${term}". Which description should it rest on?`,
    (topic, term) => `Propose an extension to ${topic} that uses "${term}": which statement must it stay consistent with?`,
    (topic, term) => `Which description would you construct a new illustration of "${term}" in ${topic} from?`,
  ],
};

function syntheticDistractors(topic, term) {
  const t = clip(topic, 30);
  const k = clip(term, 30);
  return [
    `A related point from another part of ${t}, not what "${k}" refers to.`,
    `A definition that belongs to a different ${t} concept.`,
    `A common misreading of ${t} that swaps "${k}" for something else.`,
    `A detail mentioned in ${t} that does not define "${k}".`,
  ];
}

/**
 * Always returns exactly four distinct, non-empty options with the correct one
 * first shuffled into place. Distractors come from the glosses of *other* mined
 * terms, so they are wrong but topically plausible rather than filler.
 */
function buildOptions({ correct, pool, topic, term, seed }) {
  const seen = new Set();
  const out = [];

  // `strict` is dropped only by the last-resort filler below, whose variants
  // differ by a trailing counter and so can never pass a similarity test.
  const push = (candidate, strict = true) => {
    const value = asStatement(clip(candidate, MAX_OPTION_CHARS));
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    if (BANNED_OPTIONS.some((rx) => rx.test(value))) return false;
    if (strict && out.some((existing) => tooSimilar(existing, value))) return false;
    seen.add(key);
    out.push(value);
    return true;
  };

  if (!push(correct)) push(`The description of "${clip(term, 30)}" given in the material on ${clip(topic, 30)}.`);
  const answer = out[0];

  for (const candidate of pool) {
    if (out.length >= 4) break;
    push(candidate);
  }
  for (const candidate of syntheticDistractors(topic, term)) {
    if (out.length >= 4) break;
    push(candidate);
  }
  for (let n = 1; out.length < 4; n += 1) {
    push(`Not "${clip(term, 24)}" - a different point from the material on ${clip(topic, 24)} (${n}).`, false);
  }

  const options = shuffled(out.slice(0, 4), mulberry32(seed));
  return { options, answerIdx: options.indexOf(answer) };
}

/**
 * One template mcq. Hoisted out of the build loop because the passage pass below
 * needs it too, against a different pool of terms - the ones mined from the
 * passage alone rather than from the whole chapter.
 */
function buildMcqItem({ term, terms, topic, label, stem, seed }) {
  const pool = terms
    .filter(
      (other) => !other.generic && other.key !== term.key && normKey(other.gloss) !== normKey(term.gloss),
    )
    .map((other) => other.gloss);
  const { options, answerIdx } = buildOptions({
    correct: term.gloss,
    pool: shuffled(pool, mulberry32(seed ^ 0x9e3779b9)),
    topic,
    term: term.term,
    seed,
  });
  return { text: stem(label, term.term), options, answerIdx };
}

/**
 * Two items are the same question only if their stem AND their payload agree.
 * Comparing stems alone was enough while every level was an mcq; it is not now,
 * because "Match each idea from X to what it means." is the right wording for
 * every match item in a topic, and three of them over different material are
 * three questions rather than one repeated three times - which is exactly what
 * the old stem-only check produced the moment a level stopped being an mcq.
 */
function signatureOf(q) {
  const parts = [
    normKey(q.text),
    q.answerBool === undefined ? '' : String(q.answerBool),
    q.value === undefined ? '' : String(q.value),
    (q.options ?? []).map(normKey).join(','),
    (q.pairs ?? []).map((p) => normKey(p.left)).join(','),
    (q.buckets ?? []).map((b) => `${normKey(b.name)}>${b.items.map(normKey).join('+')}`).join(','),
    (q.sequence ?? []).map(normKey).join(','),
    // A cloze gap carries `accept`, a dropdown gap carries `options` and an
    // index. Reading `b.accept[0]` unconditionally threw on the first dropdown
    // that reached here, which is a crash inside the fallback builder - the one
    // path that exists because everything else has already failed.
    (q.blanks ?? []).map((b) => normKey(b.accept?.[0] ?? b.options?.[b.answerIdx] ?? '')).join(','),
    (q.accept ?? []).map(normKey).join(','),
    (q.rubric ?? []).map(normKey).join(','),
    // The new kinds all share a stem with their siblings - every hottext in a
    // topic is "read this line and pick out its technical vocabulary" - so the
    // payload is the only thing that tells two of them apart. Without these,
    // three genuinely different hottext items over three different sentences
    // collapse to one and the level comes back short.
    (q.tokens ?? []).map(normKey).join(','),
    (q.answerIdxs ?? []).join(','),
    (q.columns ?? []).map(normKey).join(','),
    (q.rows ?? []).map((r) => normKey(typeof r === 'string' ? r : r?.header)).join(','),
    (q.answers ?? []).map((row) => (Array.isArray(row) ? row.map((v) => (v ? 1 : 0)).join('') : '')).join('|'),
    normKey(q.criterion ?? ''),
  ];
  return parts.join('#');
}

/**
 * The best stretch of the source to hand a student as a reading.
 *
 * Consecutive sentences, because a passage assembled out of lines from three
 * different parts of a chapter is not a passage - it is a collage, and half the
 * questions asked about it would turn on a join the author never wrote. Headings
 * are skipped for the same reason: a title line inside a reading reads as a
 * missing paragraph.
 *
 * Scored on how much of the chapter's named vocabulary the window contains,
 * which is the only proxy this file has for "there is enough here to ask about".
 * Three named terms is the floor: below that a passage cannot carry questions at
 * three different levels, and one question on a passage is just a long question.
 */
function passageIn(contextText, terms) {
  const sentences = sentencesOf(contextText).filter((s) => !looksLikeHeading(s) && s.length >= 40);
  if (sentences.length < 3) return null;

  const keys = [...new Set(terms.filter(isNamed).map((t) => t.key))];
  if (keys.length < 3) return null;

  let best = null;
  for (let i = 0; i + 3 <= sentences.length; i += 1) {
    for (let len = 3; len <= 6 && i + len <= sentences.length; len += 1) {
      const text = collapse(sentences.slice(i, i + len).join(' '));
      if (text.length < MIN_PASSAGE_CHARS) continue;
      // Longer windows from the same start only get longer, so nothing is lost
      // by stopping here.
      if (text.length > MAX_PASSAGE_CHARS) break;
      const body = normKey(text);
      const covered = keys.filter((key) => countOf(body, key)).length;
      // Shorter wins a tie: the student reads it once per question it carries.
      if (!best || covered > best.covered || (covered === best.covered && text.length < best.text.length)) {
        best = { text, covered };
      }
    }
  }

  return best && best.covered >= 3 ? best.text : null;
}

/**
 * One passage, several questions, at DIFFERENT levels - built offline.
 *
 * This is the shape the competitor cannot express. There "Passage" is itself a
 * question type, which fixes the ratio at one reading to one question: the same
 * three paragraphs get read once and asked once, at whatever single depth that
 * item happened to be. Here the passage is an attachment, so the same reading
 * carries a Remember item, an Apply item and an Analyse item, and the difference
 * between the three students answering them is the depth, not the material.
 *
 * Every item is built from the PASSAGE and nothing else - the terms are re-mined
 * from it alone - because a question hung under a reading that does not contain
 * its answer is worse than one with no reading at all: the student searches the
 * text they were given, does not find it, and concludes they misread.
 *
 * @returns {Map<string, object[]>} level -> at most one anchored item, empty
 *          unless at least two levels landed
 */
function anchoredForPassage({ topic, contextText, terms, plan, orderFor, avoid }) {
  const none = new Map();
  const passage = passageIn(contextText, terms);
  if (!passage) return none;

  const local = mineTerms(topic, passage);
  const named = local.filter((entry) => entry.key !== normKey(topic));
  const subjects = named.length >= 2 ? named : local;
  const out = new Map();

  LEVELS.forEach((level, levelIdx) => {
    if ((plan[level] || 0) <= 0) return;
    const stems = STEMS[level];
    const order = orderFor(level);

    for (let attempt = 0; attempt < subjects.length; attempt += 1) {
      const term = subjects[(levelIdx + attempt) % subjects.length];
      const label = term.key === normKey(topic) ? 'this chapter' : topic;
      const seed = hashString(`${topic}|passage|${level}|${term.key}`);

      for (const kind of order) {
        const built = kind === 'mcq'
          ? buildMcqItem({ term, terms: local, topic, label, stem: stems[attempt % stems.length], seed })
          : buildNonMcq({ kind, term, terms: local, topic, contextText: passage, seed, n: attempt });
        if (!built) continue;
        const item = {
          topic,
          bloom: level,
          kind,
          ...built,
          source: 'fallback',
          // Rebuilt per item rather than shared by reference: these three
          // objects travel separately from here to three different phones, and
          // a shared one is a single mutation away from changing all three.
          stimulus: { kind: 'passage', text: passage },
        };
        if (invalidReason(item)) continue;
        if (avoid.has(normKey(item.text))) continue;
        out.set(level, [item]);
        return;
      }
    }
  });

  // One question on a passage is just a long question - it costs the student a
  // reading and buys them nothing the stem could not have said. Two levels is
  // the point at which the reading starts paying for itself.
  return out.size >= 2 ? out : none;
}

/**
 * Deterministic template bank: same topic + same source text -> byte-identical
 * items, every run, with no network. Shuffling is seeded from a hash of the
 * topic rather than Math.random so a re-run of the demo cannot drift.
 */
export function fallbackForTopic({ topic, contextText = '', mix, kinds, avoidTexts = [] } = {}) {
  const cleanTopic = clip(collapse(topic) || 'this chapter', MAX_TOPIC_CHARS);
  const plan = resolveMix(mix);
  const kindMix = sanitiseKinds(kinds);
  const terms = mineTerms(cleanTopic, contextText);
  const avoid = new Set(avoidTexts.map(normKey));
  const items = [];

  // The topic name stays in the distractor pool but stops being a question
  // subject once the material has offered better ones, because "identifies
  // 'Photosynthesis' as it is used in Photosynthesis" reads like a bug.
  const withoutTopic = terms.filter((entry) => entry.key !== normKey(cleanTopic));
  const subjects = withoutTopic.length >= 3 ? withoutTopic : terms;

  // Which kind each of a level's questions should be, in fill order. A level
  // spread over two kinds asks for both; a kind this chapter cannot carry
  // honestly gives its slot to a sibling, never to another level's kind.
  const slots = LEVELS.reduce((acc, level) => ({ ...acc, [level]: spreadKinds(kindMix[level], plan[level] || 0) }), {});
  const planned = (level) => [...new Set(slots[level])];

  // The offline path gets the shared reading too. A venue with no wifi is
  // exactly when a teacher would notice the bank had quietly become flatter
  // than the one they were shown last week, and "one passage, three levels" is
  // the capability this phase is for - it must not be a thing that only happens
  // when the API answers.
  //
  // The reading may only use the kinds the plan asked of a level, never the
  // rest of the level's set: a passage is short, and on a level with one slot
  // it would otherwise turn the plan's "Rank them" into the "Put these in
  // order" the passage happens to carry, every time. The main pass below is
  // where a sibling may stand in, and only when the whole chapter cannot carry
  // the kind asked.
  const anchored = anchoredForPassage({
    topic: cleanTopic,
    contextText,
    terms,
    plan,
    orderFor: (level) => [...new Set([slots[level][0], ...planned(level)])].filter((k) => k && kindAllowedAt(k, level)),
    avoid,
  });

  LEVELS.forEach((level, levelIdx) => {
    const want = plan[level] || 0;
    if (want <= 0) return;

    const stems = STEMS[level];
    // Passage-anchored items first: they are the ones that cost the student a
    // reading, and a level that has already spent its quota on template items
    // would drop them.
    const made = (anchored.get(level) ?? []).slice(0, want);
    const seen = new Set(made.map(signatureOf));
    made.forEach((item) => avoid.add(normKey(item.text)));
    const budget = (want + avoid.size + 2) * stems.length + subjects.length;

    const pending = slots[level].slice();
    made.forEach((item) => takeSlot(pending, item.kind));

    for (let attempt = 0; made.length < want && attempt < budget; attempt += 1) {
      // The slot at the head of the queue asks first; see tryOrder for the rest.
      const order = tryOrder(level, pending[0], planned(level));
      // Offset by level so the six levels do not all open on the same term,
      // while still keeping every level near the top of the ranked list.
      const term = subjects[(levelIdx + attempt) % subjects.length];
      const label = term.key === normKey(cleanTopic) ? 'this chapter' : cleanTopic;
      const seed = hashString(`${cleanTopic}|${level}|${term.key}|${made.length}`);

      let candidate = null;
      for (const kind of order) {
        const built = kind === 'mcq'
          ? buildMcqItem({
            term,
            terms,
            topic: cleanTopic,
            label,
            stem: stems[attempt % stems.length],
            seed,
          })
          : buildNonMcq({ kind, term, terms, topic: cleanTopic, contextText, seed, n: attempt });
        if (!built) continue;
        const item = { topic: cleanTopic, bloom: level, kind, ...built, source: 'fallback' };
        // Strict, same as the model path: a template that comes out malformed is
        // discarded and the next kind is tried, never patched.
        if (invalidReason(item)) continue;
        // A repeat is judged here too, not after the loop, or a kind that has
        // run out of fresh material - four numeric figures in a chapter with
        // two - would keep winning the attempt and block the siblings that
        // could still have filled the level.
        const key = signatureOf(item);
        if (avoid.has(normKey(item.text)) || seen.has(key)) continue;
        seen.add(key);
        candidate = item;
        break;
      }
      if (!candidate) continue;

      made.push(candidate);
      takeSlot(pending, candidate.kind);
    }

    items.push(...made);
  });

  return items;
}

/** Rotate a list so successive items in one level draw on different material. */
const rotate = (list, n) => (list.length ? list.slice(n % list.length).concat(list.slice(0, n % list.length)) : list);

/** Pick the nth phrasing, cycling. Two items of a kind should not read identically. */
const pick = (list, n) => list[n % list.length];

/** Strip the punctuation a claim inherited from its source sentence. */
const unpunct = (value) => collapse(value).replace(/[\s.,;:!?]+$/, '');

/**
 * A claim to be judged true or false. It must end in a full stop and never in a
 * question mark - the validator refuses a truefalse item phrased as a question,
 * because "Is X true?" with a true/false answer reads as a riddle.
 */
const asClaim = (value) => {
  const body = unpunct(value);
  return body ? `${body}.` : '';
};

/** What counts as having typed this term: the term, lower-cased, de-pluralised. */
const acceptFor = (term) => [...new Set([term, term.toLowerCase(), term.replace(/s$/i, '')].filter(Boolean))];

/**
 * Vocabulary solid enough to stand on its own as a name.
 *
 * A defined term or a proper phrase - never a word that merely recurred, which
 * is how "control" and "layer" get mined out of a networking chapter, and never
 * a heading fragment carrying a pronoun ("Its header"). Every kind that shows a
 * term bare, with no sentence around it to carry the sense - a group, a blank, a
 * ranked item - needs this. An mcq option does not: it has its whole gloss.
 */
const isNamed = (t) => t.score >= 2 && !/^(its|this|that|these|those|their|such)\b/i.test(t.term);

/** A gloss the miner had to cut off. Fine mid-option, a lie as a whole claim. */
const isClipped = (gloss) => /\.{3}$/.test(collapse(gloss));

/** Whole-word occurrences of a mined key, so "port" is not counted inside "transport". */
function countOf(body, key) {
  const rx = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  return (body.match(rx) ?? []).length;
}

/** A word as it is compared, with the punctuation it is displayed with removed. */
const tokenCore = (token) => String(token).toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

/**
 * A term as it should read in a gap: capitalised at the start of a line, and
 * otherwise as the source itself writes it mid-sentence. A term mined from the
 * start of a sentence arrives capitalised ("Multiplexing"); if the source also
 * writes it in lower case it is an ordinary word and is lowered, and if not it
 * is a name ("Reno") and keeps its capital.
 */
function inCase(label, start, source) {
  const lower = label ? label[0].toLowerCase() + label.slice(1) : label;
  // Collapsed first: source text arrives hard-wrapped, and "flow\ncontrol"
  // is still the source writing "flow control" in lower case.
  const ordinary = /^[A-Z][^A-Z]*$/.test(label)
    && new RegExp(`\\b${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(collapse(source));
  const plain = ordinary ? lower : label;
  return start && plain ? plain[0].toUpperCase() + plain.slice(1) : plain;
}

/**
 * Ideas worth a column of their own: ones the material defines, or names in
 * more than one word, or abbreviates. A lone capitalised word ("Connection") is
 * usually just the first word of a sentence, which makes a weak heading. Falls
 * back to every idea when fewer than two strong ones exist.
 */
const isStrong = (t) => t.defined || /\s/.test(t.key) || /^[A-Z0-9]{2,}$/.test(t.term);

function strongIdeas(ideas) {
  const strong = ideas.filter(isStrong);
  return strong.length >= 2 ? strong : ideas;
}

/**
 * Which sentences of the source each mined term appears in.
 *
 * Everything the co-occurrence kinds do is set arithmetic over this one map, so
 * it is computed once and shared: categorise sorts by it, table asks which of
 * two ideas a term keeps company with, and grid asks the same question across a
 * whole matrix. Three copies of this scan is three chances for the three kinds
 * to disagree about what the chapter says.
 */
function whereEach(terms, contextText) {
  const sentences = sentencesOf(contextText).map(normKey);
  const where = new Map();
  for (const t of terms) {
    const at = new Set();
    sentences.forEach((sentence, i) => {
      if (countOf(sentence, t.key)) at.add(i);
    });
    if (at.size) where.set(t.key, at);
  }
  return { sentences, where };
}

/** Do these two ideas ever share a sentence? */
const meets = (a, b) => Boolean(a && b) && [...a].some((i) => b.has(i));

/** One term spelling out the other ("port" inside "port number") is not a contrast. */
const nested = (a, b) => a.includes(b) || b.includes(a);

/**
 * The ideas a chapter keeps returning to, most-mentioned first.
 *
 * An idea named once is a detail, not an axis: sorting terms against it, or
 * putting it at the head of a column, asks a student to weigh something the
 * material itself barely weighed.
 */
const recurringIdeas = (real, where) =>
  real
    .filter((t) => isNamed(t) && (where.get(t.key)?.size ?? 0) >= 2)
    .sort((a, b) => where.get(b.key).size - where.get(a.key).size);

/**
 * Sentences of the source that can carry 2 to `max` gaps: they contain that many
 * mined terms, each removable whole-word without wrecking the words around it.
 *
 * Shared by cloze and dropdown, which differ only in what the student does at
 * the gap - type the word, or choose it. The scan that decides where a gap can
 * honestly go is the same one, and two copies of it is how the same sentence
 * ends up gapped in two different places by two kinds in the same bank.
 */
function* gapHosts(contextText, pool, n, max = 3) {
  const hosts = sentencesOf(contextText).filter((s) => s.length >= 60 && s.length <= 240);

  for (const host of rotate(hosts, n)) {
    const flat = collapse(host);
    const low = flat.toLowerCase();
    const hits = [];
    for (const t of pool) {
      const at = low.indexOf(t.key);
      if (at < 0) continue;
      // Whole word only: blanking the "port" inside "transport" leaves a
      // fragment no student can complete.
      const before = at === 0 ? ' ' : low[at - 1];
      const after = low[at + t.key.length] ?? ' ';
      if (/[a-z0-9]/.test(before) || /[a-z0-9]/.test(after)) continue;
      hits.push({ at, len: t.key.length, term: t.term });
    }

    const picked = [];
    for (const hit of hits.sort((a, b) => a.at - b.at)) {
      if (picked.length >= max) break;
      const last = picked[picked.length - 1];
      if (last && hit.at < last.at + last.len) continue;
      picked.push(hit);
    }
    if (picked.length < 2) continue;

    yield { flat, picked };
  }
}

/** The host sentence with its picked terms replaced by blank markers. */
function gapped(flat, picked) {
  let out = '';
  let cursor = 0;
  for (const hit of picked) {
    out += flat.slice(cursor, hit.at) + BLANK_MARK;
    cursor = hit.at + hit.len;
  }
  return out + flat.slice(cursor);
}

/**
 * Words that follow a number without being its unit. "ports range from 0 to
 * 65535" would otherwise ship a numeric item measured in "to".
 */
const NON_UNITS = new Set([
  'to', 'of', 'in', 'on', 'or', 'and', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be',
  'by', 'with', 'from', 'as', 'at', 'it', 'its', 'that', 'this', 'than', 'then', 'per',
  'if', 'so', 'up', 'out', 'for', 'into', 'when', 'while', 'each', 'both', 'other', 'more',
]);

/**
 * Deterministic templates for every kind but mcq, all grounded in the mined
 * source text.
 *
 * Nothing here invents facts. Pairs are terms with their own glosses, blanks
 * remove a term from a sentence that actually contains it, the ordering task
 * uses the order the chapter itself introduces the terms, the ranking criterion
 * is how often the chapter returns to each idea, and a numeric item quotes a
 * figure the text states - every one of them a real, checkable answer rather
 * than an opinion. When the material cannot carry a kind honestly this returns
 * null and the caller tries the next kind IN THE SAME LEVEL.
 *
 * @returns {object|null} the kind-specific payload, or null
 */
function buildNonMcq({ kind, term, terms, topic, contextText, seed, n = 0 }) {
  // `real` is the mined vocabulary the source actually described. A term the
  // text only names carries a synthesised gloss, which is honest filler in an
  // mcq distractor but would be a lie as a match pair or a bucket item.
  const real = rotate(terms.filter((t) => !t.generic && t.gloss), n);
  const here = clip(topic, 40);

  switch (kind) {
    case 'truefalse': {
      // Only whole glosses. A clipped one ends mid-clause, and stripping its
      // ellipsis to close the sentence would put a claim in front of a student
      // that the chapter never made - "...reliability, flow control and."
      const whole = real.filter((t) => isNamed(t) && !isClipped(t.gloss) && unpunct(t.gloss).length <= 150);
      const subject = whole.find((t) => t.key === term.key) ?? whole[0];
      if (!subject) return null;
      // Half of them false, and a false one is a real description from this same
      // chapter attached to the wrong term - the misconception a student who
      // half-read it actually holds. An absurd claim tests nothing.
      const wantTrue = n % 2 === 0;
      // The borrowed description comes from the far end of the list, because
      // subjects are taken from the near end: a claim used as the false answer
      // here and as the true answer two questions later gives both away.
      const other = [...whole].reverse().find((t) => t.key !== subject.key && !tooSimilar(t.gloss, subject.gloss));
      if (!wantTrue && !other) return null;
      const claim = asClaim(wantTrue ? subject.gloss : other.gloss);
      if (!claim) return null;
      return {
        text: `${pick(
          [
            `The material on ${here} says this about "${clip(subject.term, 40)}":`,
            `In ${here}, this is what "${clip(subject.term, 40)}" means:`,
            `According to ${here}, "${clip(subject.term, 40)}" is described like this:`,
          ],
          n,
        )} ${claim}`,
        answerBool: wantTrue,
      };
    }

    case 'match': {
      // Named terms first, since the left column is read bare. A chapter with
      // too few of them still gets a match - there the gloss on the right is
      // carrying the sense anyway.
      const named = real.filter(isNamed);
      const seen = new Set();
      const pairs = [];
      for (const t of (named.length >= 3 ? named : real)) {
        if (pairs.length >= 4) break;
        const right = clip(asStatement(t.gloss), 90);
        const key = normKey(right);
        if (!right || seen.has(key)) continue;
        seen.add(key);
        pairs.push({ left: clip(t.term, 40), right });
      }
      if (pairs.length < 3) return null;
      return {
        text: pick(
          [
            `Match each idea from ${here} to what it means.`,
            `Pair each term below with the meaning the material on ${here} gives it.`,
            `The material on ${here} defines each of these. Match them to their definitions.`,
          ],
          n,
        ),
        pairs,
      };
    }

    case 'categorise': {
      // The two groups are ideas the chapter keeps coming back to; the things to
      // sort are the other mined terms, each filed under the idea it actually
      // keeps company with in the text. A reader can check every placement
      // against the source, which is what makes it a question rather than a
      // matter of taste.
      // Which sentences each term appears in, computed once. Everything below is
      // set arithmetic over this, so trying several pairings stays cheap.
      const { sentences, where } = whereEach(terms, contextText);
      if (sentences.length < 3) return null;

      // Both the groups and the things sorted into them are read bare, so this
      // kind takes only vocabulary solid enough to name something, and a group
      // has to be an idea the chapter returns to rather than mentions once.
      const groups = recurringIdeas(real, where);

      const sortInto = (a, b) => {
        const out = [[], []];
        const seen = new Set();
        for (const t of rotate(terms.filter(isNamed), n)) {
          if (out[0].length + out[1].length >= 8) break;
          const at = where.get(t.key);
          if (!at) continue;
          // An item that spells out its own group answers itself.
          if (nested(t.key, a.key) || nested(t.key, b.key)) continue;
          const inA = meets(at, where.get(a.key));
          const inB = meets(at, where.get(b.key));
          // Company kept with both groups is company kept with neither: a
          // student could argue that item either way, so it is not askable.
          if (inA === inB) continue;
          const label = clip(t.term, 40);
          if (seen.has(normKey(label))) continue;
          seen.add(normKey(label));
          const side = inA ? 0 : 1;
          if (out[side].length < 4) out[side].push(label);
        }
        return out;
      };

      let best = null;
      for (let i = 0; i < groups.length && i < 6; i += 1) {
        for (let j = i + 1; j < groups.length && j < 6; j += 1) {
          if (nested(groups[i].key, groups[j].key)) continue;
          const [left, right] = sortInto(groups[i], groups[j]);
          const total = left.length + right.length;
          // Both groups reachable - an empty one reads to a student as a mistake
          // in the question - and four items at least, or sorting is a coin toss.
          if (!left.length || !right.length || total < 4) continue;
          // Balance first: a 6-and-1 split is answered by guessing the big group.
          const evenness = Math.min(left.length, right.length);
          if (!best || evenness > best.evenness || (evenness === best.evenness && total > best.total)) {
            best = { a: groups[i], b: groups[j], left, right, total, evenness };
          }
        }
      }
      if (!best) return null;

      return {
        // Worded as what the answer key actually encodes - which idea the
        // material discusses each term alongside - rather than as a claim about
        // what a term "is". The first is checkable by reading the chapter; the
        // second would be the template asserting something it cannot know.
        text: pick(
          [
            `Sort these terms from ${here} by which idea the material discusses each one with.`,
            `The material on ${here} discusses each of these alongside one of the two ideas below. Sort them.`,
            `Group these terms from ${here} by the idea the material pairs each one with.`,
          ],
          n,
        ),
        buckets: [
          { name: clip(best.a.term, 40), items: best.left },
          { name: clip(best.b.term, 40), items: best.right },
        ],
      };
    }

    case 'blank': {
      // The answer is typed from memory, so it has to be a word a student could
      // actually produce. "Its core services" is a heading the miner caught, not
      // an answer anybody can give.
      if (!isNamed(term)) return null;
      // Find a sentence that genuinely contains the term, then remove it. Whole
      // word, or blanking "multiplexing" hollows out the "demultiplexing" three
      // words later and leaves the student a "de____" nobody can complete.
      const hosts = sentencesOf(contextText).filter(
        (s) => countOf(normKey(s), term.key) > 0 && s.length > term.term.length + 24 && s.length < 220,
      );
      const host = rotate(hosts, n)[0];
      if (!host) return null;
      const rx = new RegExp(`\\b${term.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const blanked = collapse(host).replace(rx, BLANK_MARK);
      if (blanked.split(BLANK_MARK).length - 1 !== 1) return null;
      return {
        text: `Complete this statement from ${here}: ${blanked}`,
        accept: acceptFor(term.term),
      };
    }

    case 'cloze': {
      // One passage, several holes: the sentence has to carry two mined terms
      // that do not overlap, or there is nothing honest to take out of it twice.
      const pool = terms.filter((t) => isNamed(t) && t.key.length >= 4);

      for (const { flat, picked } of gapHosts(contextText, pool, n)) {
        const text = `Complete this passage from ${here}: ${gapped(flat, picked)}`;
        // The blanks array is read positionally against the markers, so a count
        // that disagrees is a wrong answer key rather than a cosmetic fault.
        if (text.split(BLANK_MARK).length - 1 !== picked.length) continue;
        return { text, blanks: picked.map((hit) => ({ accept: acceptFor(hit.term) })) };
      }
      return null;
    }

    case 'numeric': {
      const hosts = sentencesOf(contextText).filter(
        (s) => /\d/.test(s) && s.length >= 40 && s.length <= 220,
      );
      for (const host of rotate(hosts, n)) {
        const flat = collapse(host);
        const match = flat.match(/(-?\d[\d,]*(?:\.\d+)?)\s*(%|[A-Za-z][A-Za-z/°²³-]{0,7})?/);
        if (!match) continue;
        const at = match.index;
        // A figure glued to a word is part of a name - "IPv4", "H2O" - not a value.
        if (at > 0 && /[A-Za-z0-9]/.test(flat[at - 1])) continue;

        const raw = match[1];
        const value = Number(raw.replace(/,/g, ''));
        if (!Number.isFinite(value)) continue;

        const word = collapse(match[2] ?? '');
        const unit = word === '%' ? '%' : NON_UNITS.has(word.toLowerCase()) ? '' : word;
        // Slack for the rounding the text itself quotes - half of its last
        // decimal place - and nothing beyond that, since a wider window marks a
        // wrong method right.
        const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
        const tolerance = decimals ? 0.5 * 10 ** -decimals : 0;

        const gapped = `${flat.slice(0, at)}${BLANK_MARK}${flat.slice(at + raw.length)}`;
        return {
          text: `Work out the missing figure in this line from ${here}, and give the number only: ${gapped}`,
          value,
          tolerance,
          unit,
        };
      }
      return null;
    }

    case 'multi': {
      const correct = real.slice(0, 3).map((t) => clip(asStatement(t.gloss), 110));
      if (correct.length < 2) return null;
      const wrong = syntheticDistractors(topic, term.term).slice(0, 3).map((d) => clip(d, 110));
      const all = shuffled([...correct, ...wrong], mulberry32(seed ^ 0x51ed270b));
      const answerIdxs = correct.map((c) => all.indexOf(c)).filter((i) => i >= 0);
      if (answerIdxs.length < 2 || answerIdxs.length >= all.length) return null;
      return {
        text: pick(
          [
            `Which of these statements about ${clip(topic, 50)} does the material actually support? Select all that apply.`,
            `Select every statement below that the material on ${clip(topic, 50)} bears out.`,
            `Which claims about ${clip(topic, 50)} can you attribute to the material? Select all that apply.`,
          ],
          n,
        ),
        options: all,
        answerIdxs,
      };
    }

    case 'order': {
      // Order of first appearance in the chapter: checkable, not a matter of taste.
      const body = String(contextText || '').toLowerCase();
      const placed = terms
        .filter((t) => !t.generic && t.gloss && isNamed(t))
        .map((t) => ({ term: t.term, at: body.indexOf(t.term.toLowerCase()) }))
        .filter((t) => t.at >= 0)
        .sort((a, b) => a.at - b.at);
      // A window rather than the first four, so a second Evaluate item is a
      // different question and not the same one twice.
      const from = placed.length > 4 ? n % (placed.length - 3) : 0;
      const window = placed.slice(from, from + 4);
      if (window.length < 3) return null;
      return {
        text: `Put these in the order the material on ${here} introduces them.`,
        sequence: window.map((t) => clip(t.term, 60)),
      };
    }

    case 'rank': {
      // Rank needs a yardstick, and the only one this template can defend from
      // the text alone is how much of the chapter each idea takes up. Ties are
      // dropped rather than ordered arbitrarily: a rank whose answer is a coin
      // toss between two equals marks an honest student wrong.
      const body = normKey(contextText);
      // Rank the ideas the chapter named, not every word it repeated: "window"
      // above "control" above "network" is a ranking of the miner's leftovers.
      const described = terms.filter((t) => !t.generic && t.gloss && isNamed(t));
      const counted = described
        .map((t) => ({ term: t.term, times: countOf(body, t.key) }))
        .filter((t) => t.times > 0)
        .sort((a, b) => b.times - a.times || a.term.localeCompare(b.term));

      const from = counted.length > 4 ? n % (counted.length - 3) : 0;
      const chain = [];
      for (const entry of counted.slice(from)) {
        if (chain.length >= 4) break;
        if (chain.length && entry.times >= chain[chain.length - 1].times) continue;
        chain.push(entry);
      }
      if (chain.length < 3) return null;
      return {
        text: pick(
          [
            `Rank these ideas from ${here} by how much of the material is spent on them, most first.`,
            `Which of these does ${here} give the most room to? Rank them, most first.`,
            `Put these in order of how much of ${here} is devoted to each, starting with the most.`,
          ],
          n,
        ),
        criterion: `how much of the material on ${here} is spent on each, most to least`,
        sequence: chain.map((entry) => clip(entry.term, 60)),
      };
    }

    case 'open': {
      // The term is quoted back at the student as the thing to explain, so it
      // has to be something the chapter actually named.
      if (!isNamed(term)) return null;
      const words = collapse(term.gloss)
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .slice(0, 8);
      const rubric = [words.slice(0, 2).join(' '), words.slice(2, 4).join(' '), words.slice(4, 6).join(' ')]
        // A rubric point with no word over three letters can never be matched by
        // the scorer, so it is a point the student cannot score.
        .filter((point) => point.split(/\s+/).some((w) => w.length > 3));
      if (rubric.length < 2) return null;
      return {
        text: `In your own words, explain "${clip(term.term, 50)}" and why it matters in ${here}.`,
        rubric,
      };
    }

    case 'hottext': {
      // One line of the source, and the student picks out every word that names
      // a term the material defines outright ("X is ..."). Checkable against the
      // text: each right pick has a definition sentence in the chapter, and no
      // wrong one does. Single words only, because a student who taps "port" out
      // of "port number" has half of a right answer and no way to give it.
      const defined = new Set(
        terms.filter((t) => t.defined && isNamed(t) && /^[a-z0-9][a-z0-9-]*$/.test(t.key)).map((t) => t.key),
      );
      if (!defined.size) return null;
      // Named vocabulary of more than one word, defined or not, leaves a line
      // open to the same argument, so a line carrying any is not used.
      const phrases = terms.filter((t) => isNamed(t) && /\s/.test(t.key)).map((t) => t.key);
      const hosts = sentencesOf(contextText).filter((s) => !looksLikeHeading(s) && s.length >= 40 && s.length <= 240);

      const usable = [];
      for (const host of hosts) {
        const tokens = collapse(host).split(' ');
        if (tokens.length < 6 || tokens.length > 40) continue;
        if (phrases.some((p) => countOf(normKey(host), p))) continue;

        let unclear = false;
        const answerIdxs = [];
        tokens.forEach((token, i) => {
          if (defined.has(tokenCore(token))) {
            answerIdxs.push(i);
            return;
          }
          // "TCP's", "UDP-based", "sockets" beside a defined "socket": a word
          // that carries a defined term without being it. Whichever way it was
          // marked, a student could fairly argue the other.
          const parts = token.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
          if (parts.some((p) => defined.has(p) || defined.has(p.replace(/e?s$/, '')))) unclear = true;
        });
        if (unclear || answerIdxs.length === 0 || answerIdxs.length >= tokens.length) continue;
        usable.push({ host, tokens, answerIdxs, definition: DEFINITION.test(host) });
      }
      if (!usable.length) return null;

      // Lines that are not themselves a definition first: "Multiplexing is ..."
      // points straight at its own answer, so those come last. The nth item
      // takes the nth line, so a second hot text in a topic is a second line.
      usable.sort((a, b) => Number(a.definition) - Number(b.definition));
      const { host, tokens, answerIdxs } = usable[n % usable.length];
      return {
        // Worded by the line, not by n: the same line asked twice must read the
        // same, so the bank's duplicate check catches it instead of shipping
        // one question under two stems.
        text: pick(
          [
            `Read this line from ${here} and pick out every word that names a term the material defines.`,
            `Which words in this line from ${here} name a term the material defines? Pick each one.`,
            `Pick every word in this line from ${here} that is a term the material gives a definition of.`,
          ],
          hashString(host),
        ),
        tokens,
        criterion: 'every word that names a term the material defines',
        answerIdxs,
      };
    }

    case 'dropdown': {
      // The cloze scan with the typing taken away: each gap offers the term that
      // was there and named terms from elsewhere in the chapter. The wrong ones
      // are terms this line never mentions, so none of them is another gap's
      // answer - two terms that could swap places would make both readings right
      // and mark one of them wrong.
      const pool = terms.filter((t) => isNamed(t) && t.key.length >= 4);
      const offered = terms.filter(isNamed);
      // Every line that can carry the gaps, and the nth item takes the nth: a
      // second dropdown in a topic is a second line, not the first one again
      // with other wrong options.
      const lines = [...gapHosts(contextText, pool, 0)];

      for (let k = 0; k < lines.length; k += 1) {
        const { flat, picked } = lines[(n + k) % lines.length];
        const body = normKey(flat);
        const elsewhere = offered.filter((t) => !countOf(body, t.key));
        // Fixed by the line, for the same reason as the line itself.
        const turn = hashString(flat);
        const blanks = [];
        for (const [i, hit] of picked.entries()) {
          // Every option in the case the gap's position calls for. A term mined
          // from the start of a sentence arrives capitalised ("Multiplexing"),
          // and in mid-line that capital alone would point at the answer.
          const shape = (label) => inCase(label, hit.at === 0, contextText);
          const answer = shape(clip(hit.term, 40));
          const options = [answer];
          for (const t of rotate(elsewhere, turn + i)) {
            if (options.length >= 4) break;
            const label = shape(clip(t.term, 40));
            // "port" offered beside "port number" is half of the right answer.
            if (options.some((o) => nested(normKey(o), normKey(label)))) continue;
            options.push(label);
          }
          if (options.length < 3) break;
          // The phone shuffles each gap again per student; this only keeps the
          // stored order from always putting the answer first.
          const order = shuffled(options, mulberry32((turn ^ Math.imul(0x2545f491, i + 1)) >>> 0));
          blanks.push({ options: order, answerIdx: order.indexOf(answer) });
        }
        if (blanks.length !== picked.length) continue;

        const text = `${pick(
          [
            `Choose the right term for each gap in this line from ${here}:`,
            `Complete this line from ${here} by choosing a term for each gap:`,
            `Pick the term that belongs in each gap of this line from ${here}:`,
          ],
          turn,
        )} ${gapped(flat, picked)}`;
        // Read positionally against the markers, like cloze.
        if (text.split(BLANK_MARK).length - 1 !== picked.length) continue;
        return { text, blanks };
      }
      return null;
    }

    case 'table': {
      // One rule applied row by row, which is what makes completing a table
      // Apply: which of two ideas the chapter discusses each term alongside -
      // the same co-occurrence categorise sorts by, so every cell can be checked
      // by reading the chapter. The first row is filled in as the worked
      // example; the rest are typed.
      //
      // Beside each term is a line of the source that names it and names
      // neither idea: context that is true by construction and cannot give the
      // answer away. Not the miner's gloss, which is the first line containing
      // the term's letters - "connection" inside "connectionless" - and a given
      // cell describing a term wrongly is worse than no cell.
      const { sentences, where } = whereEach(terms, contextText);
      if (sentences.length < 3) return null;
      // Not rotated by n, unlike `real`: the nth table is the nth layout found
      // below, so the same layout always comes out the same and the bank's
      // duplicate check sees it, rather than as its rows in another order.
      const steady = terms.filter((t) => !t.generic && t.gloss);
      // An idea is typed as the answer, so it must fit a cell unclipped.
      const ideas = recurringIdeas(steady, where).filter((t) => t.term.length <= 40);
      const lines = sentencesOf(contextText).filter((s) => !looksLikeHeading(s));
      const QUOTE = 90;
      const quoteFor = (t, a, b) => {
        // The term has to be in the part of the line a cell shows; a long line
        // clipped before it is a quote about something else.
        const fits = lines.filter((s) => {
          const body = normKey(s);
          if (!countOf(body, t.key) || countOf(body, a.key) || countOf(body, b.key)) return false;
          const at = body.search(new RegExp(`\\b${t.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`));
          return at >= 0 && at + t.key.length <= QUOTE - 8;
        });
        return fits.length ? clip(fits[0], QUOTE) : null;
      };
      const described = steady.filter(isNamed);

      const layouts = [];
      for (let i = 0; i < ideas.length && i < 6; i += 1) {
        for (let j = i + 1; j < ideas.length && j < 6; j += 1) {
          const [a, b] = [ideas[i], ideas[j]];
          if (nested(a.key, b.key)) continue;
          const rows = [];
          const labels = new Set();
          for (const t of described) {
            if (rows.length >= 5) break;
            // A term that spells out an idea answers its own row.
            if (nested(t.key, a.key) || nested(t.key, b.key)) continue;
            const at = where.get(t.key);
            if (!at) continue;
            const inA = meets(at, where.get(a.key));
            const inB = meets(at, where.get(b.key));
            // Company kept with both is company kept with neither, as in categorise.
            if (inA === inB) continue;
            const label = clip(t.term, 40);
            if (labels.has(normKey(label))) continue;
            const quote = quoteFor(t, a, b);
            if (!quote) continue;
            labels.add(normKey(label));
            rows.push({ label, quote, idea: inA ? a : b });
          }
          const toA = rows.filter((r) => r.idea === a).length;
          const toB = rows.length - toA;
          // One worked row and at least two to do, with both ideas among the
          // answers: a column with one right answer is filled without reading.
          if (rows.length < 3 || !toA || !toB) continue;
          layouts.push({
            a, b, rows, toA, toB,
            // Strong ideas first (strongIdeas), then balance, then size.
            strength: Number(isStrong(a)) + Number(isStrong(b)),
            evenness: Math.min(toA, toB),
          });
        }
      }
      if (!layouts.length) return null;
      layouts.sort((x, y) => y.strength - x.strength || y.evenness - x.evenness || y.rows.length - x.rows.length);
      const best = layouts[n % layouts.length];

      // The worked row comes from the larger side, so the rows left to do still
      // need both ideas.
      const big = best.toA >= best.toB ? best.a : best.b;
      const first = best.rows.findIndex((r) => r.idea === big);
      const rows = [best.rows[first], ...best.rows.filter((_, i) => i !== first)];
      const [A, B] = [best.a.term, best.b.term];

      return {
        // Worded by the layout, not by n, for the reason given at `steady`.
        text: pick(
          [
            `The material on ${here} discusses each term below alongside either "${A}" or "${B}". Complete the table with the one it goes with. The first row is done for you.`,
            `For each term from ${here}, write whether the material discusses it alongside "${A}" or "${B}". The first row is done for you.`,
            `Complete the table: each of these terms from ${here} is discussed alongside "${A}" or "${B}" in the material. Write which. The first row shows how.`,
          ],
          hashString(`${A}|${B}|${rows.map((r) => r.label).join('|')}`),
        ),
        columns: ['Where the material names it', 'Discussed alongside'],
        rows: rows.map((r, i) => ({
          header: r.label,
          cells: [
            { given: r.quote },
            i === 0 ? { given: r.idea.term } : { accept: acceptFor(r.idea.term) },
          ],
        })),
      };
    }

    case 'grid': {
      // The same judgement across a whole matrix: for every term and every idea,
      // does the material discuss the two together? Each tick is checked by
      // finding a sentence that holds both, and each box left alone by finding
      // none - which is why a grid is marked on both (questionTypes.js).
      const { sentences, where } = whereEach(terms, contextText);
      if (sentences.length < 3) return null;
      // Not rotated by n, as in the table: the nth grid is the nth layout.
      const steady = terms.filter((t) => !t.generic && t.gloss);
      const ideas = strongIdeas(recurringIdeas(steady, where).filter((t) => t.term.length <= 40)).slice(0, 6);
      const candidates = terms.filter(isNamed);

      /** Rows for these columns, or null when they do not make a fair grid. */
      const gridFor = (columns) => {
        const rows = [];
        for (const t of candidates) {
          if (rows.length >= 5) break;
          if (columns.some((c) => nested(c.key, t.key))) continue;
          // "Flow" and "Flow control" as two rows are one term asked twice.
          if (rows.some((r) => nested(r.key, t.key))) continue;
          const at = where.get(t.key);
          if (!at) continue;
          const marks = columns.map((c) => meets(at, where.get(c.key)));
          // A row of all ticks or no ticks makes no distinction of its own.
          if (marks.every(Boolean) || !marks.some(Boolean)) continue;
          rows.push({ key: t.key, label: clip(t.term, 40), marks });
        }
        if (rows.length < 3) return null;
        // Nor may a column: one ticked all the way down is answered without
        // reading a single row.
        const mixed = columns.every((_, c) => rows.some((r) => r.marks[c]) && rows.some((r) => !r.marks[c]));
        return mixed ? rows : null;
      };

      // Every fair layout, three columns before two; the nth grid takes the
      // nth, so a second grid in a topic asks about other ideas.
      const sets = [];
      for (let i = 0; i < ideas.length; i += 1) {
        for (let j = i + 1; j < ideas.length; j += 1) {
          for (let k = j + 1; k < ideas.length; k += 1) sets.push([ideas[i], ideas[j], ideas[k]]);
        }
      }
      for (let i = 0; i < ideas.length; i += 1) {
        for (let j = i + 1; j < ideas.length; j += 1) sets.push([ideas[i], ideas[j]]);
      }
      const layouts = [];
      for (const set of sets) {
        if (set.some((a, x) => set.some((b, y) => x < y && nested(a.key, b.key)))) continue;
        const found = gridFor(set);
        if (found) layouts.push({ columns: set, rows: found });
      }
      if (!layouts.length) return null;
      const { columns, rows } = layouts[n % layouts.length];

      return {
        // Worded by the layout, not by n, so the same grid always reads the same.
        text: pick(
          [
            `Tick every box where the material on ${here} discusses the term in the row alongside the idea in the column.`,
            `For each term from ${here}, tick every idea the material discusses it alongside.`,
            `Which of these ideas does the material on ${here} discuss each term alongside? Tick every one that does.`,
          ],
          hashString(`${columns.map((c) => c.key).join('|')}#${rows.map((r) => r.key).join('|')}`),
        ),
        rows: rows.map((r) => r.label),
        columns: columns.map((c) => c.term),
        answers: rows.map((r) => r.marks),
      };
    }

    default:
      return null;
  }
}

/**
 * Strict, non-healing validation. An item is either schema-perfect or it is
 * thrown away and the topic is retried - we never pad options or clamp an
 * answer index, because a silently repaired item is a wrong item in front of a
 * student.
 */
export function validateItems(raw, topic = '', kinds) {
  const valid = [];
  const errors = [];
  const label = collapse(topic) ? `"${collapse(topic)}"` : 'response';
  const kindMix = sanitiseKinds(kinds);

  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.items)
      ? raw.items
      : Array.isArray(raw?.questions)
        ? raw.questions
        : null;

  if (!list) {
    errors.push(`${label}: the response was not a JSON array of question items.`);
    return { valid, errors };
  }

  list.forEach((item, i) => {
    // Case is normalised, not repaired: the contract forbids a capitalised tag
    // in any payload, and 'Analyse' still names exactly one valid level.
    const bloom = typeof item?.bloom === 'string' ? collapse(item.bloom).toLowerCase() : '';
    if (!isLevel(bloom)) {
      errors.push(`${label} item ${i + 1} rejected: bloom must be one of ${LEVELS.join(', ')}.`);
      return;
    }

    // The kind is a property of the level, not a free choice. The caller's plan
    // - the one the teacher approved - names the kinds each level is asked as,
    // and sanitiseKinds has already dropped anything from another level's set.
    // An item declaring one of the planned kinds is that kind. Where the plan
    // names just one, an item declaring something else is judged against the
    // plan rather than its own claim, exactly as before the kind mix; where it
    // names several, there is no telling which was meant, so the item is
    // refused rather than guessed at.
    const planned = Object.keys(kindMix[bloom] ?? {});
    const declared = typeof item?.kind === 'string' ? collapse(item.kind).toLowerCase() : '';
    let kind;
    if (planned.includes(declared)) kind = declared;
    else if (planned.length === 1) [kind] = planned;
    else {
      errors.push(
        `${label} item ${i + 1} rejected: kind "${declared || 'none'}" is not one this plan asks ${bloom} as (${planned.join(', ')}).`,
      );
      return;
    }

    const clean = {
      topic: collapse(topic),
      bloom,
      kind,
      // collapse() leaves the ____ markers of blank and cloze untouched, which
      // is the only thing in the text the validator counts.
      text: typeof item?.text === 'string' ? collapse(item.text) : '',
    };

    const strings = (v) =>
      Array.isArray(v) && v.every((s) => typeof s === 'string') ? v.map((s) => collapse(s)).filter(Boolean) : null;
    // For lists read by position (tokens, options with an index into them, the
    // labels a grid's answers line up with): collapsed, never filtered, so an
    // empty entry is refused by the validator instead of shifting the key.
    const positional = (v) => (Array.isArray(v) ? v.map((s) => (typeof s === 'string' ? collapse(s) : s)) : []);
    // A table cell from the model: given or blank. The schema makes both fields
    // optional, so an empty `given` or an empty `accept` beside the other is
    // the schema's noise, not a second claim, and is set aside. Both filled, or
    // neither, is left as it came and refused by the validator.
    const tableCell = (c) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) return c;
      const out = {};
      if (typeof c.given === 'string' && collapse(c.given)) out.given = collapse(c.given);
      else if (c.given !== undefined && c.given !== null && c.given !== '') out.given = c.given;
      if (Array.isArray(c.accept) && c.accept.length) out.accept = positional(c.accept);
      else if (c.accept !== undefined && c.accept !== null && !Array.isArray(c.accept)) out.accept = c.accept;
      return out;
    };

    // Parsed leniently, exactly as score() parses a student's "3,000" - the same
    // number written the same way must not be right from a phone and wrong from
    // the model. Anything that is not a number stays NaN and is rejected below.
    const number = (v) =>
      typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[\s,]/g, '')) : NaN;

    if (kind === 'mcq' || kind === 'multi') {
      clean.options = strings(item?.options) ?? [];
      if (kind === 'mcq') clean.answerIdx = item?.answerIdx;
      else clean.answerIdxs = Array.isArray(item?.answerIdxs) ? item.answerIdxs.filter(Number.isInteger) : [];
    } else if (kind === 'truefalse') {
      // A model under structured output returns a real boolean; one that has
      // stringified it still means what it says.
      clean.answerBool =
        typeof item?.answerBool === 'boolean'
          ? item.answerBool
          : item?.answerBool === 'true'
            ? true
            : item?.answerBool === 'false'
              ? false
              : undefined;
    } else if (kind === 'match') {
      clean.pairs = Array.isArray(item?.pairs)
        ? item.pairs
            .filter((p) => p && typeof p.left === 'string' && typeof p.right === 'string')
            .map((p) => ({ left: collapse(p.left), right: collapse(p.right) }))
        : [];
    } else if (kind === 'categorise') {
      clean.buckets = Array.isArray(item?.buckets)
        ? item.buckets
            .filter((b) => b && typeof b.name === 'string' && Array.isArray(b.items))
            .map((b) => ({ name: collapse(b.name), items: strings(b.items) ?? [] }))
        : [];
    } else if (kind === 'order' || kind === 'rank') {
      clean.sequence = strings(item?.sequence) ?? [];
      // Only rank carries a criterion; order gets its order from the material.
      if (kind === 'rank') clean.criterion = typeof item?.criterion === 'string' ? collapse(item.criterion) : '';
    } else if (kind === 'blank') {
      clean.accept = strings(item?.accept) ?? [];
    } else if (kind === 'cloze') {
      clean.blanks = Array.isArray(item?.blanks)
        ? item.blanks
            .filter((b) => b && Array.isArray(b.accept))
            .map((b) => ({ accept: strings(b.accept) ?? [] }))
        : [];
    } else if (kind === 'numeric') {
      clean.value = number(item?.value);
      // A missing tolerance means exact, never "pick something generous" - slack
      // this file invented would be slack nobody chose.
      clean.tolerance = item?.tolerance === undefined || item?.tolerance === null ? 0 : number(item.tolerance);
      clean.unit = typeof item?.unit === 'string' ? collapse(item.unit) : '';
    } else if (kind === 'open') {
      clean.rubric = strings(item?.rubric) ?? [];
    } else if (kind === 'hottext') {
      // Collapsed but never filtered: the answer is a list of POSITIONS in the
      // sentence, so dropping an empty token would quietly move every index
      // after it onto the wrong word. An empty one stays and is refused.
      clean.tokens = positional(item?.tokens);
      clean.criterion = typeof item?.criterion === 'string' ? collapse(item.criterion) : '';
      clean.answerIdxs = Array.isArray(item?.answerIdxs) ? item.answerIdxs : [];
    } else if (kind === 'dropdown') {
      // `gaps` in the model's schema, so it cannot be confused with cloze's
      // typed `blanks`; stored as `blanks` like every other gapped kind.
      const gaps = Array.isArray(item?.gaps) ? item.gaps : Array.isArray(item?.blanks) ? item.blanks : [];
      clean.blanks = gaps.map((g) => ({ options: positional(g?.options), answerIdx: g?.answerIdx }));
    } else if (kind === 'table') {
      clean.columns = positional(item?.columns);
      const rows = Array.isArray(item?.tableRows) ? item.tableRows : Array.isArray(item?.rows) ? item.rows : [];
      clean.rows = rows.map((r) => ({
        header: typeof r?.header === 'string' ? collapse(r.header) : '',
        cells: Array.isArray(r?.cells) ? r.cells.map(tableCell) : [],
      }));
    } else if (kind === 'grid') {
      clean.rows = positional(Array.isArray(item?.gridRows) ? item.gridRows : item?.rows);
      clean.columns = positional(item?.columns);
      // A stringified boolean still means what it says, as for truefalse;
      // anything else stays as it came and is refused.
      clean.answers = Array.isArray(item?.answers)
        ? item.answers.map((row) => (Array.isArray(row)
          ? row.map((v) => (v === 'true' ? true : v === 'false' ? false : v))
          : row))
        : [];
    }

    const problems = [];
    const why = invalidReason(clean);
    if (why) problems.push(why);

    // The banned-option rule applies wherever options are shown, and a
    // dropdown shows a list at every gap.
    const shownOptions = kind === 'mcq' || kind === 'multi'
      ? clean.options
      : kind === 'dropdown' ? clean.blanks.flatMap((g) => g.options) : [];
    if (shownOptions.some((o) => typeof o === 'string' && BANNED_OPTIONS.some((rx) => rx.test(o)))) {
      problems.push('"all of the above" / "none of the above" options are forbidden');
    }

    if (problems.length) {
      errors.push(`${label} item ${i + 1} (${kind}) rejected: ${problems.join('; ')}.`);
      return;
    }
    // The misunderstanding behind each wrong option, if the model proposed one
    // (0024): stored as an AI draft until the professor confirms it. Read only
    // from a valid item, and a bad label costs that label, never the item: it is
    // advice beside the question, not part of it. The offline templates propose
    // none, so only this path ever carries one.
    const labels = proposedLabels(clean, item?.misconceptions);
    if (labels.length) clean.misconceptions = labels;
    valid.push(clean);
  });

  return { valid, errors };
}

// One object shape covering every kind: the payload fields are all optional and
// only the fields for the declared `kind` are read. Strict per-kind validation
// happens after, in questionTypes.invalidReason - the schema keeps the model
// roughly on the rails, the validator is what actually decides.
const ITEM_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      bloom: {
        type: Type.STRING,
        enum: LEVELS,
        description: 'Exactly one Bloom level, lower-case, British spelling "analyse".',
      },
      kind: {
        type: Type.STRING,
        enum: KINDS,
        description: 'The interaction, which is fixed by the bloom level. See the mapping in the instructions.',
      },
      text: {
        type: Type.STRING,
        description:
          'The question stem. kind "blank": it must contain exactly one ____ where the answer goes. kinds "cloze" and "dropdown": it is one passage containing 2 to 4 ____ markers. kind "truefalse": it is a STATEMENT to be judged, never a question, and must not end in "?".',
      },
      options: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'kind "mcq": exactly 4 options. kind "multi": 4 to 6 options.',
      },
      answerIdx: { type: Type.INTEGER, description: 'kind "mcq" only: index of the single correct option.' },
      answerIdxs: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description:
          'kind "multi": indices of every correct option (at least 2, never all of them). kind "hottext": indices into "tokens" of every word that meets the criterion (at least 1, never all of them).',
      },
      pairs: {
        type: Type.ARRAY,
        description: 'kind "match" only: 3 to 5 pairs to be matched.',
        items: {
          type: Type.OBJECT,
          properties: {
            left: { type: Type.STRING, description: 'The term or concept.' },
            right: { type: Type.STRING, description: 'Its meaning, example or counterpart.' },
          },
          required: ['left', 'right'],
        },
      },
      answerBool: {
        type: Type.BOOLEAN,
        description: 'kind "truefalse" only: true if the statement in "text" is true, false if it is false.',
      },
      buckets: {
        type: Type.ARRAY,
        description:
          'kind "categorise" only: 2 to 4 groups holding 4 to 10 items in total. Every group holds at least one item and no item may belong to two groups.',
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING, description: 'The group, named as the material names it.' },
            items: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'The things that belong in this group. Never name the group inside its own items.',
            },
          },
          required: ['name', 'items'],
        },
      },
      blanks: {
        type: Type.ARRAY,
        description:
          'kind "cloze" only: one entry per ____ marker in "text", IN THE SAME ORDER as the markers.',
        items: {
          type: Type.OBJECT,
          properties: {
            accept: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: 'Every answer accepted for this marker, including reasonable spellings and synonyms.',
            },
          },
          required: ['accept'],
        },
      },
      value: { type: Type.NUMBER, description: 'kind "numeric" only: the correct value, as a plain number.' },
      tolerance: {
        type: Type.NUMBER,
        description:
          'kind "numeric" only: how far from "value" still counts as right. Cover the rounding the working honestly needs and no more; use 0 for an exact figure.',
      },
      unit: { type: Type.STRING, description: 'kind "numeric" only: the unit of "value", or empty if it has none.' },
      sequence: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          'kinds "order" and "rank": 3 to 5 items written in their CORRECT order. The student sees them shuffled.',
      },
      criterion: {
        type: Type.STRING,
        description:
          'kind "rank": the yardstick the items are ranked against, e.g. "most to least secure". Required - ranking with no stated criterion is unanswerable. kind "hottext": which words to pick, e.g. "every word that names a transport protocol".',
      },
      // The four kinds below have their own field names wherever a shared name
      // would need two shapes: a schema property has one type, and cloze's
      // `blanks` are typed answers where a dropdown's gaps are lists to choose
      // from; a table's rows are objects where a grid's are labels.
      tokens: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          'kind "hottext" only: ONE sentence from the source split into its words, in reading order, 3 to 40 of them, punctuation kept on the word it follows.',
      },
      gaps: {
        type: Type.ARRAY,
        description: 'kind "dropdown" only: one entry per ____ marker in "text", IN THE SAME ORDER as the markers.',
        items: {
          type: Type.OBJECT,
          properties: {
            options: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '2 to 5 short words or phrases to choose from at this gap, all different.',
            },
            answerIdx: { type: Type.INTEGER, description: 'Index of the one option that belongs in this gap.' },
          },
          required: ['options', 'answerIdx'],
        },
      },
      columns: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'kind "table": 2 to 4 column headings. kind "grid": 2 to 5 column labels.',
      },
      tableRows: {
        type: Type.ARRAY,
        description: 'kind "table" only: 2 to 6 rows, each with a heading and exactly one cell per column.',
        items: {
          type: Type.OBJECT,
          properties: {
            header: { type: Type.STRING, description: 'The row heading.' },
            cells: {
              type: Type.ARRAY,
              description: 'One per column. A cell is EITHER given (shown to the student) OR a blank to fill, never both.',
              items: {
                type: Type.OBJECT,
                properties: {
                  given: { type: Type.STRING, description: 'The text shown in a given cell. Leave out for a blank.' },
                  accept: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: 'Every answer accepted in a blank cell. Leave out for a given cell.',
                  },
                },
              },
            },
          },
          required: ['header', 'cells'],
        },
      },
      gridRows: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'kind "grid" only: 2 to 6 row labels.',
      },
      answers: {
        type: Type.ARRAY,
        items: { type: Type.ARRAY, items: { type: Type.BOOLEAN } },
        description:
          'kind "grid" only: one array per row of "gridRows", each with one true or false per column - true where that row and that column go together.',
      },
      accept: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'kind "blank" only: every answer that should be accepted, including reasonable spellings and synonyms.',
      },
      rubric: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'kind "open" only: 2 to 5 short points a full answer must make. Each is a few significant words.',
      },
      misconceptions: {
        type: Type.ARRAY,
        description:
          'Optional, kinds "mcq", "multi" and "truefalse" only: for a WRONG option, the misunderstanding a student who picks it most likely holds. Never for a correct option.',
        items: {
          type: Type.OBJECT,
          properties: {
            optionIdx: {
              type: Type.INTEGER,
              description: 'Index into "options" of the wrong option. Leave it out for "truefalse": the label is for the wrong judgement.',
            },
            label: {
              type: Type.STRING,
              description: `The misunderstanding itself, in at most ${MAX_LABEL} characters, e.g. "Thinks UDP resends lost packets".`,
            },
          },
          required: ['label'],
        },
      },
    },
    required: ['bloom', 'kind', 'text'],
    propertyOrdering: [
      'bloom', 'kind', 'text', 'options', 'answerIdx', 'answerIdxs', 'answerBool', 'pairs',
      'buckets', 'blanks', 'value', 'tolerance', 'unit', 'sequence', 'criterion', 'accept', 'rubric',
      'tokens', 'gaps', 'columns', 'tableRows', 'gridRows', 'answers', 'misconceptions',
    ],
  },
};

/**
 * One rule per kind, each naming the trap that kind falls into.
 *
 * These are written against the validator: every "rejected" below is a rule
 * invalidReason() actually enforces, so the model is told the truth about what
 * will come back. A prompt that asked for less than the validator demands just
 * burns retries.
 */
const KIND_RULES = {
  mcq: 'exactly 4 "options", exactly one of them correct, and "answerIdx" is its index. The three wrong ones are real ideas from the source that a student who half-understands it would pick.',
  truefalse:
    'the "text" is a STATEMENT to be judged, never a question - anything ending in "?" is rejected - and "answerBool" says whether it is true. Make about half of them false, and build a false one out of the source: a real definition attached to the wrong term, a real limit quoted with the wrong figure, the misconception a student who skimmed the chapter actually holds. Never write an absurd claim, and never write a statement so obviously true that agreeing with it proves nothing.',
  match:
    '3 to 5 "pairs", each a term on the left and its meaning, example or counterpart on the right. Every left matches one and only one right. Keep both sides short.',
  categorise:
    '2 to 4 groups in "buckets", each {name, items}, with 4 to 10 items in total. The groups must be genuinely distinguishable from the source - if a student could argue an item into two of them, the question is wrong - EVERY group must hold at least one item, and no item may appear in two groups. Never let an item name the group it belongs to.',
  blank:
    'the stem contains exactly one ____ where the answer goes and the student types it. Give every acceptable answer in "accept" - synonyms, common spellings, with and without units. Keep the answer short: one word, a number, or a short phrase.',
  cloze:
    'ONE passage in "text" with 2 to 4 ____ markers in it, and one "blanks" entry per marker IN THE SAME ORDER as the markers. Blank the load-bearing words - the ones that carry the meaning - never articles or connectives, and leave enough of the passage standing that the gaps are answerable.',
  numeric:
    'only when the source actually supports working a value out or reading one off. "value" is the number, "unit" its unit (empty when it has none), "tolerance" the slack. The tolerance covers honest rounding - half of the last place you expect them to work to - and nothing more: a wide tolerance marks a wrong method right.',
  multi:
    '4 to 6 "options" of which AT LEAST TWO are correct and at least one is wrong, with every correct index in "answerIdxs". Ask which statements hold, which factors apply, which claims the evidence supports.',
  order:
    '3 to 5 items in "sequence", written in the CORRECT order, which the student sees shuffled. Order by a sequence the source text itself settles: the steps of a process, the stages of an argument, the order of events.',
  rank: '3 to 5 items in "sequence" in the CORRECT order, plus "criterion": the yardstick they are ranked against, stated plainly ("most to least secure"). Say the criterion in the stem too. Ranking with no stated criterion is unanswerable and is rejected.',
  open: 'the student writes a short answer. Give 2 to 5 "rubric" points, each a few significant words naming something a full answer must contain. Rubric points are matched against the student\'s own words, so use the content words a correct answer would really use.',
  hottext:
    '"tokens" is ONE sentence taken from the source, split into its words in reading order (3 to 40), "criterion" says plainly which words to pick ("every word that names a transport protocol"), and "answerIdxs" holds the index of every token that meets it - at least one, never all of them. The criterion must be one the source settles, so a student who has read it can defend every pick and every word left alone; never one that turns on a word only half meeting it.',
  dropdown:
    'ONE passage in "text" with 2 to 4 ____ markers, and one "gaps" entry per marker IN THE SAME ORDER: each gap has 2 to 5 short "options" and "answerIdx", the index of the one that belongs there. Wrong options are real terms from the source that do not fit that gap - never a synonym of the right one, and never another gap\'s answer if the two could swap places and still read true.',
  table:
    '2 to 4 "columns" and 2 to 6 "tableRows", each {header, cells} with exactly one cell per column. A cell is either given ({"given": text}) or a blank for the student to fill ({"accept": [every accepted answer]}), never both and never neither. Every row follows one rule the source settles, so the given cells show the rule and the blanks ask for it to be applied; fill at least one row completely as a worked example, and keep blank answers short enough to type.',
  grid:
    '2 to 6 "gridRows" and 2 to 5 "columns", and "answers": one array per row with one true or false per column, true exactly where the source says that row and that column go together. At least one true and at least one false, every row and every column checkable against the source - a grid ticked all the way down a column is answered without reading.',
};

function buildSystemPrompt({ topic, contextText, mix, kinds, avoidTexts }) {
  const ladder = LEVELS.map(
    (level) => `- ${level} (${LABEL[level]}) - exemplar verbs: ${VERBS[level].join(', ')}`,
  ).join('\n');

  const counts = LEVELS.filter((level) => (mix[level] || 0) > 0)
    .map((level) => `- ${level}: exactly ${mix[level]} question${mix[level] === 1 ? '' : 's'}`)
    .join('\n');

  const avoid = avoidTexts.length
    ? `\nDo not repeat, rephrase or re-use any of these questions that already exist in the bank:\n${avoidTexts
        .slice(0, 12)
        .map((text) => `- ${clip(text, 160)}`)
        .join('\n')}\n`
    : '';

  // Only the levels this call is actually asking for. The mapping is the whole
  // feature - the interaction is chosen by the LEVEL, not by the question - so
  // it is stated as an instruction and not as a menu. `kinds` here is counts,
  // level -> { kind: n }, and each count is said out loud: a level asked as two
  // kinds gets exactly that many of each, which is what the plan approved.
  const asked = LEVELS.filter((level) => (mix[level] || 0) > 0);
  const used = [...new Set(asked.flatMap((level) => Object.keys(kinds[level] ?? {})))];
  const kindRules = `
The INTERACTION is fixed by the level and by this plan. Never choose it yourself - for this bank use exactly these kinds, in exactly these numbers:

${asked
    .map((level) => `- ${level}: ${Object.entries(kinds[level] ?? {})
      .map(([kind, n]) => `${n} as kind "${kind}" (${KIND_LABEL[kind]})`)
      .join(', ')}`)
    .join('\n')}

What each kind must carry:
${used.map((kind) => `- "${kind}": ${KIND_RULES[kind]}`).join('\n')}`;

  return `You write assessment items for an undergraduate class. You are building part of a question bank for the topic "${topic}".

Bloom's revised taxonomy (Anderson & Krathwohl, 2001) - the six cognitive-process levels you must tag against, with their exemplar verbs:
${ladder}
${kindRules}

Produce exactly ${totalOf(mix)} questions for the topic "${topic}", distributed like this:
${counts}

Rules, all of them mandatory:
1. Every item carries exactly one bloom tag, lower-case, from the list above. Use the British spelling "analyse" - never "analyze".
2. Every item's "kind" must be one the plan above gives for its bloom level, in the numbers it gives, and it must carry that kind's payload fields and no others.
3. The tag must match the cognitive demand of the stem. Use the exemplar verbs as your guide: a "remember" item asks the student to recall or identify, an "analyse" item asks them to differentiate or attribute, and so on. Do not tag a recall question as "evaluate" to fill a quota.
4. Every question and its correct answer must be answerable from the source text below and from nothing else. No outside facts, no trivia, no knowledge the text does not contain.
5. Everything wrong must be plausible: wrong options, unmatched pairs, false statements and items that could be mis-sorted are all real ideas, terms or steps drawn from the same source text that a student who half-understands the material would genuinely pick. Never use filler, joke options, obviously absurd answers, or near-duplicates of the correct answer.
6. Never use "all of the above", "none of the above", "both of the above", or any option that refers to the other options.
7. Options must be mutually distinct and of comparable length and specificity, so that length alone does not give the answer away.
8. Write plain, exam-ready English. No markdown, no numbering inside the stem, no explanations, no commentary.
9. On "mcq", "multi" and "truefalse" items you may add "misconceptions": for a wrong option, the misunderstanding a student who picks it most likely holds, in at most ${MAX_LABEL} characters ("Thinks UDP resends lost packets"), as the source text shows it. Never label a correct option and never name a person. Leave it out when the source does not show what the misunderstanding would be.
${avoid}
Source text for "${topic}":
"""
${contextText || 'No source text was supplied. Do not invent facts - keep the questions to what the topic name itself supports.'}
"""

Return only a JSON array of items matching the provided schema.`;
}

let client = null;

// Built lazily so importing this module without a key is free and side-effect
// free - the fallback path never constructs a client.
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

function stripFence(text) {
  return String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

async function callModel({ topic, contextText, mix, kinds, avoidTexts, timeoutMs }) {
  const response = await getClient().models.generateContent({
    model: config.gemini.model,
    contents: 'Generate the question bank now. Reply with the JSON array and nothing else.',
    config: {
      temperature: config.gemini.temperature,
      responseMimeType: 'application/json',
      responseSchema: ITEM_SCHEMA,
      systemInstruction: buildSystemPrompt({ topic, contextText, mix, kinds, avoidTexts }),
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return JSON.parse(stripFence(text));
}

/**
 * One topic, one mix. Never throws for an LLM problem: a failed call is a
 * warning plus template items, because the teacher pressing "Generate" ten
 * minutes before class needs a bank, not a stack trace.
 */
export async function generateForTopic({
  topic,
  contextText = '',
  mix,
  kinds,
  avoidTexts = [],
  deadline = 0,
} = {}) {
  const cleanTopic = clip(collapse(topic) || 'this chapter', MAX_TOPIC_CHARS);
  const plan = resolveMix(mix);
  const kindMix = sanitiseKinds(kinds);
  // Exactly how many of each kind every level gets. The model is asked for
  // these numbers, and anything it does not deliver is topped up per kind.
  const slots = slotsFor(plan, kindMix);
  const focus = contextForTopic(contextText, cleanTopic);
  const warnings = [];
  // Read once, at the call: the id the model calls below are made with.
  const modelId = config.gemini.model;

  // Template items are built here; model items are stamped as they arrive.
  // `wanted` is level -> { kind: count }; handed over as the kind weights, it
  // comes back out of spreadKinds as exactly those counts.
  const buildFallback = (wanted, avoid) =>
    fallbackForTopic({ topic: cleanTopic, contextText: focus, mix: levelTotals(wanted), kinds: wanted, avoidTexts: avoid })
      .map((item) => ({ ...item, model: OFFLINE_MODEL }));

  // A level whose template could not be built honestly comes back short rather
  // than as an mcq wearing an Evaluate tag. Say so: a thin chapter producing
  // fewer Understand items is a fact about the chapter, and the teacher can act
  // on it - a bank that silently flattened to one interaction is undebuggable.
  const reportShort = (wanted, made) => {
    const short = shortfall(levelTotals(wanted), made);
    for (const level of LEVELS) {
      if (short[level] > 0) {
        const as = Object.keys(wanted[level] ?? {}).map((k) => KIND_LABEL[k]).join(' or ');
        warnings.push(
          `"${cleanTopic}": the material could not carry ${short[level]} more ${LABEL[level]} item${short[level] === 1 ? '' : 's'} as ${as}, so that level is short.`,
        );
      }
    }
  };

  if (!hasGemini()) {
    const questions = buildFallback(slots, avoidTexts);
    warnings.push('GEMINI_API_KEY is not set - questions came from the offline template bank.');
    reportShort(slots, questions);
    return { questions, source: 'fallback', warnings };
  }

  const attempts = Math.max(1, Number(config.gemini.maxRetries) || 1);
  const collected = [];
  const taken = new Set(avoidTexts.map(normKey));
  let used = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const need = slotShortfall(slots, collected);
    if (totalOf(levelTotals(need)) === 0) break;

    const left = deadline ? deadline - Date.now() : CALL_TIMEOUT_MS;
    if (left <= 0) {
      warnings.push(`"${cleanTopic}": the generation time budget ran out, so template items were used.`);
      break;
    }

    used += 1;

    try {
      const raw = await callModel({
        topic: cleanTopic,
        contextText: focus,
        mix: levelTotals(need),
        kinds: need,
        avoidTexts: [...avoidTexts, ...collected.map((item) => item.text)],
        timeoutMs: Math.min(CALL_TIMEOUT_MS, left),
      });
      const { valid, errors } = validateItems(raw, cleanTopic, need);
      warnings.push(...errors);

      // Valid items from earlier attempts are kept, so a retry only has to cover
      // what is still missing instead of starting the topic from scratch. Room
      // is counted per kind as well as per level: two "Choose one" items where
      // the plan asked one of those and one "True or false" fill one slot, and
      // the other is asked for again.
      for (const item of valid) {
        const room = (slotShortfall(slots, collected)[item.bloom]?.[item.kind] ?? 0) > 0;
        const key = normKey(item.text);
        if (!room || taken.has(key)) continue;
        taken.add(key);
        collected.push({ ...item, source: 'llm', model: modelId });
      }
    } catch (err) {
      warnings.push(`"${cleanTopic}" attempt ${attempt} of ${attempts} failed: ${err.message}.`);
    }

    if (attempt < attempts && totalOf(levelTotals(slotShortfall(slots, collected))) > 0) await sleep(300 * attempt);
  }

  const missing = slotShortfall(slots, collected);

  if (collected.length === 0) {
    warnings.push(
      `"${cleanTopic}" fell back to the template bank after ${used} failed attempt${used === 1 ? '' : 's'}.`,
    );
    const questions = buildFallback(slots, avoidTexts);
    reportShort(slots, questions);
    return { questions, source: 'fallback', warnings };
  }

  if (totalOf(levelTotals(missing)) > 0) {
    // Partial success: keep the real model items and top the topic up so the
    // bank still hits its target size. Each topped-up item carries its own
    // source:'fallback' tag, which is what the UI actually labels from.
    const topUp = buildFallback(missing, [...avoidTexts, ...collected.map((item) => item.text)]);
    warnings.push(
      `"${cleanTopic}": the model returned ${collected.length} of ${totalOf(plan)} valid items; ${topUp.length} template items filled the gap.`,
    );
    reportShort(missing, topUp);
    return { questions: [...collected, ...topUp], source: 'llm', warnings };
  }

  return { questions: collected, source: 'llm', warnings };
}

async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * The whole bank for one piece of content. Topics run three at a time: enough
 * to clear a chapter inside the two-minute bar, few enough not to trip the
 * free-tier rate limit.
 */
export async function generateBank({ content, topics, perTopic, plan: approved, onProgress } = {}) {
  const rawText = String(content?.rawText ?? '');
  const requested = Array.isArray(topics) && topics.length ? topics : content?.topics ?? [];
  const warnings = [];

  const list = [...new Set(requested.map((t) => clip(collapse(t), MAX_TOPIC_CHARS)).filter(Boolean))];

  // A resolved plan from planBank() is authoritative: it already decided the
  // size and shape, per topic, and the teacher approved those exact numbers.
  // Its own cap replaces the blanket MAX_TOPICS truncation, which used to drop
  // topics the teacher had explicitly ticked without telling them clearly.
  const mixFor = new Map();
  // And how planBank() divided each topic's levels over their kinds, so the
  // bank written is the bank the teacher was shown, kind for kind.
  const kindsFor = new Map();
  if (approved?.topics?.length) {
    for (const t of approved.topics) {
      const key = clip(collapse(t.topic), MAX_TOPIC_CHARS);
      mixFor.set(key, t.mix);
      if (t.kinds && typeof t.kinds === 'object') kindsFor.set(key, t.kinds);
    }
    // Keep only what the plan budgeted for; a topic given zero questions is a
    // decision, not an omission.
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const mix = mixFor.get(list[i]);
      if (!mix || totalOf(mix) === 0) list.splice(i, 1);
    }
  } else if (list.length > MAX_TOPICS) {
    warnings.push(`${list.length} topics requested - generating the first ${MAX_TOPICS} to keep the run inside the pre-class window.`);
    list.length = MAX_TOPICS;
  }

  const fallbackMix = resolveMix(perTopic);
  // The interactions the teacher approved with the plan. planBank() has already
  // refused anything outside a level's own set, and sanitiseKinds refuses it
  // again on the way in - the rule is worth enforcing at both ends, since this
  // is also the door a script or a stale client comes through.
  const kinds = sanitiseKinds(approved?.kindMix ?? approved?.kinds);
  // A topic the plan did not divide - a run with no plan, or a plan object made
  // before the kind mix - is divided here exactly as planBank() would: one
  // rotation per level, carried across the topics in order, so a level with one
  // question a topic does not open every topic on the same kind.
  const carry = LEVELS.reduce((acc, level) => ({ ...acc, [level]: {} }), {});
  for (const topic of list) {
    if (kindsFor.has(topic)) continue;
    const mix = resolveMix(mixFor.get(topic) ?? fallbackMix);
    const divided = {};
    for (const level of LEVELS) {
      if (mix[level] > 0) divided[level] = countKinds(spreadKinds(kinds[level], mix[level], carry[level]));
    }
    kindsFor.set(topic, divided);
  }
  const deadline = Date.now() + BANK_BUDGET_MS;

  // Reported as topics land, not at the end. The console shows a clock against
  // a ninety-second estimate, and with nothing moving on it a healthy run is
  // indistinguishable from a hung one.
  const done = { topics: 0, questions: [] };
  const report = (topic) => {
    if (typeof onProgress !== 'function') return;
    done.topics += 1;
    try {
      onProgress({
        topic,
        topicsDone: done.topics,
        topicsTotal: list.length,
        written: done.questions.length,
        perLevel: countByLevel(done.questions),
      });
    } catch {
      // A broken progress sink must not take the bank down with it.
    }
  };

  const results = await mapWithConcurrency(list, CONCURRENCY, async (topic) => {
    const mix = mixFor.get(topic) ?? fallbackMix;
    const topicKinds = kindsFor.get(topic);
    let result;
    try {
      result = await generateForTopic({ topic, contextText: rawText, mix, kinds: topicKinds, deadline });
    } catch (err) {
      result = {
        questions: fallbackForTopic({ topic, contextText: contextForTopic(rawText, topic), mix, kinds: topicKinds })
          .map((item) => ({ ...item, model: OFFLINE_MODEL })),
        source: 'fallback',
        warnings: [`"${topic}" generation threw (${err.message}) - template items used instead.`],
      };
    }
    done.questions.push(...result.questions);
    report(topic);
    return result;
  });

  const questions = results.flatMap((result) => result.questions);
  const allWarnings = [...new Set([...warnings, ...results.flatMap((result) => result.warnings)])];

  if (!list.length) allWarnings.push('No topics were supplied, so no questions were generated.');

  const sources = new Set(questions.map((q) => q.source));
  const source = sources.size > 1 ? 'mixed' : sources.has('llm') ? 'llm' : 'fallback';

  return { questions, source, warnings: allWarnings, perLevel: countByLevel(questions) };
}
