// What the Material screen says about a chapter (Batch 8, design-zip gaps M1,
// M2 and M5; docs/UI_ZIP_AUDIT.md).
//
//   topicSources   M1  where each topic came from: its slides ("Slides 3–4",
//                      "Slide 14"), from the slide numbers kept at upload
//                      (topic_slides) or, failing those, the slide whose own
//                      words name it (slide_texts, Phase 6); for pasted text, the
//                      line that names it ("Line 3"). Null, with a reason, when
//                      neither says.
//   levelSupport   M2  which Bloom levels the material can carry for each topic,
//                      ticked or not, each with a reason. Worked out by the same
//                      check the built-in writer applies before it writes an item
//                      (fallbackForTopic in services/generate.js tries each kind
//                      the level allows, and writes nothing a kind cannot carry
//                      honestly), with one item asked per level. A level with no
//                      such item is "not supported by the material", in those
//                      words. It is the templates' reading: the AI writer may find
//                      more, and the note says so.
//   lastUsed       M5  when the chapter was last used: the newest room opened on it.
//
// Staff-only reads: the content routes are behind the teacher gate. Nothing is
// written, and no model is called.

import { LEVELS, LABEL } from '../bloom.js';
import { KINDS_FOR_LEVEL, LABEL as KIND_LABEL, isUngraded } from '../questionTypes.js';
import { contextForTopic, fallbackForTopic } from './generate.js';
import { slidesOfTopic, topicKey } from './hubTopics.js';

export const SUPPORT_NOTE = 'Worked out from what the built-in question writer can write honestly from this material, one question '
  + 'per level. The AI writer may manage a level the templates cannot.';
export const NOT_SUPPORTED = 'not supported by the material';

const listMarker = /^(?:[-*•]|\d+[.)])\s+/;
const uniqueSorted = (xs) => [...new Set(xs)].sort((a, b) => a - b);

/** "Slide 14", "Slides 3–4", "Slides 3–5 and 9": runs of slides as ranges. */
export function slideLabel(slides = []) {
  const ns = uniqueSorted((slides ?? []).filter((n) => Number.isInteger(n) && n > 0));
  if (!ns.length) return null;
  const runs = [];
  for (const n of ns) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else runs.push([n, n]);
  }
  const parts = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`));
  const body = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${ns.length === 1 ? 'Slide' : 'Slides'} ${body}`;
}

/** The slides whose own words carry the topic's name as a line of their own (slide_texts). */
function slidesNaming(content, name) {
  const texts = Array.isArray(content?.slideTexts) ? content.slideTexts : [];
  const want = topicKey(name);
  if (!want) return [];
  return texts.filter((s) => String(s.text ?? '').split(/\r?\n/)
    .some((line) => topicKey(line.trim().replace(listMarker, '')) === want)).map((s) => s.slide);
}

/** The first line of pasted text that names the topic (1-based), or null. */
function lineNaming(rawText, name) {
  const lines = String(rawText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const want = topicKey(name);
  if (!want) return null;
  let i = lines.findIndex((line) => topicKey(line.trim().replace(listMarker, '')) === want);
  if (i < 0) i = lines.findIndex((line) => line.toLowerCase().includes(String(name).toLowerCase().trim()));
  return i < 0 ? null : i + 1;
}

/**
 * Where one topic came from (M1).
 *
 * @returns {{ topic: string, kind: 'slides'|'line'|null, slides: number[], line: number|null, label: string|null, from: string, note?: string }}
 *   `from`: 'topic-slides' (kept at upload), 'slide-text' (found in a slide's own words), 'pasted-line', or 'none'
 */
export function topicSource(content, topic) {
  const name = String(topic ?? '');
  if (content?.kind === 'pptx') {
    const kept = slidesOfTopic(content, name);
    if (kept.length) return { topic: name, kind: 'slides', slides: kept, line: null, label: slideLabel(kept), from: 'topic-slides' };
    const named = uniqueSorted(slidesNaming(content, name));
    if (named.length) return { topic: name, kind: 'slides', slides: named, line: null, label: slideLabel(named), from: 'slide-text' };
    return {
      topic: name, kind: null, slides: [], line: null, label: null, from: 'none',
      note: 'No slide of this deck names this topic: it was added or renamed by hand, or the deck was read before slides were kept.',
    };
  }
  const line = lineNaming(content?.rawText, name);
  if (line) return { topic: name, kind: 'line', slides: [], line, label: `Line ${line}`, from: 'pasted-line' };
  return { topic: name, kind: null, slides: [], line: null, label: null, from: 'none', note: 'No line of the pasted text names this topic.' };
}

export const topicSources = (content) => (Array.isArray(content?.topics) ? content.topics : []).map((t) => topicSource(content, t));

/** Every kind the built-in writer may be asked for at a level, equally weighted. */
const ALL_KINDS = Object.fromEntries(LEVELS.map((level) => [
  level,
  Object.fromEntries((KINDS_FOR_LEVEL[level] ?? []).filter((k) => !isUngraded(k)).map((k) => [k, 1])),
]));
const ONE_EACH = Object.fromEntries(LEVELS.map((level) => [level, 1]));

const article = (label) => (/^[AEIOU]/i.test(label) ? 'an' : 'a');

/**
 * The levels the material can carry for one topic (M2), each with a reason.
 *
 * @returns {{ topic: string, supports: string[], levels: { level, label, supported: boolean, kind: string|null, reason: string }[] }}
 */
export function levelSupport(content, topic) {
  const name = String(topic ?? '');
  const items = fallbackForTopic({ topic: name, contextText: contextForTopic(content?.rawText ?? '', name), mix: ONE_EACH, kinds: ALL_KINDS });
  const levels = LEVELS.map((level) => {
    const item = items.find((q) => q.bloom === level) ?? null;
    const as = Object.keys(ALL_KINDS[level]).map((k) => KIND_LABEL[k] ?? k).join(' or ');
    return item
      ? {
        level, label: LABEL[level], supported: true, kind: item.kind,
        reason: `Supported: the material gives enough to write ${article(LABEL[level])} ${LABEL[level]} question on this topic (as ${KIND_LABEL[item.kind] ?? item.kind}).`,
      }
      : {
        level, label: LABEL[level], supported: false, kind: null,
        reason: `Not supported by the material: it does not give enough to write ${article(LABEL[level])} ${LABEL[level]} question on this topic honestly (as ${as}).`,
      };
  });
  return { topic: name, supports: levels.filter((l) => l.supported).map((l) => l.level), levels };
}

export const levelSupports = (content) => (Array.isArray(content?.topics) ? content.topics : []).map((t) => levelSupport(content, t));

/** When a chapter was last used (M5): the newest room opened on it, or null. `sessions` newest first or not. */
export function lastUsedOf(sessions = []) {
  let newest = null;
  for (const s of sessions ?? []) {
    const at = s?.startedAt ?? s?.createdAt;
    if (at && (!newest || Date.parse(at) > Date.parse(newest.at))) newest = { at, code: s.code ?? null, status: s.status ?? null };
  }
  return newest;
}
