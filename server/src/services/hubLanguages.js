// Hindi and Marathi versions of what a student reads in the hub (Phase 6,
// decision H12, under decision 5).
//
// English is the original. A Hindi ('hi') or Marathi ('mr') version of an item
// is made on the professor's button only (the model, never in anything a student
// waits on) or written by the professor, and is stored per item and language
// (item_translations, 0027) as a draft until the professor approves it. A
// student who chose a language sees an approved translation; otherwise English,
// with a plain note. Technical terms stay in English inside a translation: the
// prompt says so, and the check below holds what can be checked.
//
// ONE GENERIC SHAPE, reused by every kind of item. An item kind registers how to
// load an item, which chapter it belongs to and which of its fields a student
// reads (registerTranslatable); a translation is then a map of those field names
// to translated text (a string, or a list of strings translated entry for entry).
// 'question', 'lesson' and 'explanation' (H14) are registered here; 'hint' and
// 'feedback' (H13) are registered the same way by the tutor (services/hubTutor.js).
//
// NEVER A KEY. A question's translatable fields are its wording and, for the
// kinds answered by picking from a list (mcq, multi, poll), its options, item for
// item. Positions never move, so score() marks the same answer the same way in
// every language, and the solution a student is shown after an attempt points
// at the same option. Accepted typed answers, pairs, groups, sequences and the
// rest stay in English: how they are marked depends on their exact words.
//
// THE CHECK (checkTranslation), run on every translation made, edited or
// approved. It compares each field with the English it was made from:
//   missing   a field the English has is empty or absent            blocks approval
//   count     a list (a question's options) has another length      blocks approval
//   blanks    the ____ gaps of a fill-in question differ in number  blocks approval
//             (each gap is marked against its own answer, in order, so a
//             translation that drops or adds one cannot be answered)
//   numbers   the numbers outside formulas and code differ          a flag
//   formulas  the formulas between $ signs differ                   a flag
//   code      a fenced code block differs                           a flag
//   untranslated  a sentence of four or more English words came back
//                 with no Devanagari at all                         a flag
// A translation with a blocking finding cannot be approved. One with a flag is
// approved only when the professor confirms they checked it (a second press),
// because a Hindi ordinal can legitimately drop a digit.
//
// STALE. A translation keeps the English it was made from (source_fields) and its
// hash. When the English changes (an edited question), the translation is never
// shown again until it is edited against the new English or made again.
//
// WHAT AN ATTEMPT RECORDS (H5, H12). languageShown() answers which language an
// item is shown in to one student now; attemptLanguage() which language an
// answer was given in, from what the screen says it showed, checked here, so the
// hub's attempt store can record it on every attempt. languageItemStats() splits
// hub attempts by that language for Phase 5's translation warning
// (languageSplit in services/honesty.js).

import crypto from 'node:crypto';
import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { isRecordId } from '../ids.js';
import { BLANK_MARK } from '../questionTypes.js';
import { readPieces, richText } from './richText.js';
import { holdsContact } from './roster.js';
import { languageSplit } from './honesty.js';
import { sectionFieldLabel, sectionFields } from './hubConcept.js';

export const ORIGINAL = 'en';
export const TRANSLATED_LANGUAGES = Object.freeze(['hi', 'mr']);
export const LANGUAGES = Object.freeze({
  en: Object.freeze({ tag: 'en', name: 'English', native: 'English' }),
  hi: Object.freeze({ tag: 'hi', name: 'Hindi', native: 'हिन्दी' }),
  mr: Object.freeze({ tag: 'mr', name: 'Marathi', native: 'मराठी' }),
});
export const isLanguage = (tag) => Object.hasOwn(LANGUAGES, String(tag ?? ''));

/** What a translation may name (0027's item_translations_kind_check). */
export const ITEM_KINDS = Object.freeze(['question', 'lesson', 'explanation', 'hint', 'feedback']);

/** The question kinds whose options a student picks from: translated item for item. */
export const OPTION_KINDS = Object.freeze(['mcq', 'multi', 'poll']);

/** The longest translated field kept, in characters. */
export const MAX_TRANSLATED_FIELD = 12000;
/** Items one model call translates, and the most one run translates per language. */
export const BATCH_ITEMS = 8;
export const MAX_RUN_ITEMS = 60;

const CALL_TIMEOUT_MS = 60000;

export const OFFLINE_NOTE = 'No translations were made: translating needs the AI model, and none is set up on this server. '
  + 'You can write a translation yourself; it stays a draft until you approve it.';

export const TERMS_NOTE = 'Technical terms stay in English inside a translation, as your slides write them.';

export const STALE_NOTE = 'The English has changed since this translation was made, so students are not shown it. '
  + 'Edit it against the new English, or make it again.';

const fail = (message, status) => Object.assign(new Error(message), { status });
const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const sameId = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/* ------------------------------------------------------------- registry -- */

const registry = new Map();

/**
 * How one kind of item is translated. `spec`:
 *   noun          what a student calls it ("question")
 *   load(repo, id)          the item, or null
 *   contentIdOf(item)       the chapter it belongs to (for ownership)
 *   fields(item)            { name: English string | [English strings] }, what a student reads
 *   note(item)              optional: a staff sentence on what is left in English
 */
export function registerTranslatable(kind, spec) {
  if (!ITEM_KINDS.includes(kind)) throw new Error(`"${kind}" is not an item kind a translation may name (0027).`);
  registry.set(kind, spec);
}

export function translatable(kind) {
  const spec = registry.get(kind);
  if (!spec) throw fail(`Items of the kind "${String(kind).slice(0, 40)}" cannot be translated yet.`, 400);
  return spec;
}

/** The English a student reads of one item, by field name. */
export const fieldsOf = (kind, item) => translatable(kind).fields(item);

registerTranslatable('question', {
  noun: 'question',
  load: (repo, id) => repo.getQuestion(id).catch(() => null),
  contentIdOf: (q) => q?.contentId,
  fields(q) {
    const out = {};
    if (typeof q?.text === 'string' && q.text.trim()) out.text = q.text;
    if (OPTION_KINDS.includes(q?.kind ?? 'mcq') && Array.isArray(q?.options) && q.options.length) out.options = [...q.options];
    return out;
  },
  note(q) {
    const kind = q?.kind ?? 'mcq';
    if (OPTION_KINDS.includes(kind) || kind === 'truefalse') return null;
    return 'Only the question\'s wording is translated. Its items stay in English, because how they are marked depends on their exact words.';
  },
});

registerTranslatable('lesson', {
  noun: 'lesson',
  load: (repo, id) => repo.getTopicLesson(id).catch(() => null),
  contentIdOf: (l) => l?.contentId,
  fields(lesson) {
    const out = {};
    (Array.isArray(lesson?.steps) ? lesson.steps : []).forEach((s, i) => {
      if (s?.type === 'chunk' && s.text) out[`steps.${i}.text`] = s.text;
      if (s?.type === 'example') {
        if (s.problem) out[`steps.${i}.problem`] = s.problem;
        if (Array.isArray(s.steps) && s.steps.length) out[`steps.${i}.steps`] = [...s.steps];
        if (s.answer) out[`steps.${i}.answer`] = s.answer;
      }
    });
    // Batch 8: the concept panel's sections (services/hubConcept.js). A lesson
    // without them has the same fields, and so the same hash, as before.
    return { ...out, ...sectionFields(lesson?.sections) };
  },
  note: (lesson) => (lesson?.sections
    ? 'An explanation step\'s term and the code example stay in English: they are the words and code the slides use.' : null),
});

// A question's explanation (H14, services/hubExplanations.js). There is one per
// question, so it is named by its QUESTION's id: an explanation rewritten after
// its translation was made puts that translation out of date (its hash), rather
// than leaving it attached to a row that is gone.
registerTranslatable('explanation', {
  noun: 'explanation',
  async load(repo, questionId) {
    const [e, q] = await Promise.all([
      repo.getQuestionExplanation(questionId).catch(() => null),
      repo.getQuestion(questionId).catch(() => null),
    ]);
    return e && q ? { ...e, _id: q._id, contentId: q.contentId } : null;
  },
  contentIdOf: (e) => e?.contentId,
  fields: (e) => (typeof e?.text === 'string' && e.text.trim() ? { explanation: e.text } : {}),
  note: () => null,
});

/* ------------------------------------------------------------ the source -- */

/** One canonical spelling of a field map (keys sorted), for its hash. */
function canonical(fields = {}) {
  return JSON.stringify(Object.keys(fields).sort().map((k) => [k, fields[k]]));
}

/** The SHA-256 of the English a translation is made from: 64 hex digits. */
export const sourceHash = (fields) => crypto.createHash('sha256').update(canonical(fields), 'utf8').digest('hex');

/** Is this translation made from the English the item holds now? */
export const isCurrent = (translation, english) => Boolean(translation) && translation.sourceHash === sourceHash(english);

/* ------------------------------------------------------------- the check -- */

const DEVANAGARI = /[ऀ-ॿ]/;
const DEVANAGARI_DIGITS = /[०-९]/g;
const LATIN_WORD = /[A-Za-z]{2,}/g;

/** The numbers a stretch of prose holds, sorted: Devanagari digits read as 0 to 9, thousands separators dropped. */
export function numbersIn(prose) {
  const text = String(prose ?? '')
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966))
    .replace(/(\d),(?=\d)/g, '$1');
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).sort();
}

/** A text as its formulas, code blocks and the numbers of its prose. */
function partsOf(text) {
  const pieces = readPieces(String(text ?? ''));
  return {
    formulas: pieces.filter((p) => p.type === 'math').map((p) => p.raw.replace(/\s+/g, '')).sort(),
    code: pieces.filter((p) => p.type === 'code').map((p) => p.value.trim()).sort(),
    numbers: numbersIn(pieces.filter((p) => p.type === 'text').map((p) => p.value).join(' ')),
  };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** How many ____ gaps a text holds, counted as questionTypes.js counts them. */
export const gapsIn = (text) => String(text ?? '').split(BLANK_MARK).length - 1;
const listed = (xs) => (xs.length ? xs.join(', ') : 'none');

/** A field's name as a professor reads it: "the question", "option 3", "part 2's text". */
export function fieldLabel(key) {
  if (key === 'text') return 'the question';
  if (key === 'options') return 'the options';
  if (key === 'explanation') return 'the explanation';
  // The tutor's items (H13, services/hubTutor.js).
  if (key === 'hint') return 'the hint';
  if (key === 'feedback') return 'the feedback';
  const section = sectionFieldLabel(key);
  if (section) return section;
  const option = /^options\.(\d+)$/.exec(key);
  if (option) return `option ${Number(option[1]) + 1}`;
  const step = /^steps\.(\d+)\.(text|problem|steps|answer)(?:\.(\d+))?$/.exec(key);
  if (step) {
    const n = Number(step[1]) + 1;
    const what = { text: 'text', problem: 'worked example\'s problem', steps: 'worked example\'s steps', answer: 'worked example\'s answer' }[step[2]];
    return step[3] === undefined ? `step ${n}'s ${what}` : `step ${n}'s worked example, line ${Number(step[3]) + 1}`;
  }
  return `"${key}"`;
}

/**
 * Compare a translation with the English it was made from (see the header).
 *
 * @returns {{ ok: boolean, findings: {field, id, blocking, message}[], blocking: object[], flags: object[] }}
 */
export function checkTranslation(source = {}, translated = {}) {
  const findings = [];
  const add = (field, id, blocking, message) => findings.push({ field, id, blocking, message });

  const compare = (key, want, got) => {
    const label = fieldLabel(key);
    if (typeof got !== 'string' || !got.trim()) {
      add(key, 'missing', true, `${label} has no translation.`);
      return;
    }
    const gapsWanted = gapsIn(want);
    const gapsGot = gapsIn(got);
    if (gapsWanted !== gapsGot) {
      add(key, 'blanks', true, `${label} has ${gapsGot} ${BLANK_MARK} gap${gapsGot === 1 ? '' : 's'} where the English has ${gapsWanted}. `
        + `Every ${BLANK_MARK} is kept exactly, in its place: each one is marked against its own answer.`);
    }
    const a = partsOf(want);
    const b = partsOf(got);
    if (!sameList(a.formulas, b.formulas)) {
      add(key, 'formulas', false, `The formulas in ${label} differ from the English. Formulas are copied exactly, never translated.`);
    }
    if (!sameList(a.code, b.code)) add(key, 'code', false, `The code in ${label} differs from the English. Code is copied exactly.`);
    if (!sameList(a.numbers, b.numbers)) {
      add(key, 'numbers', false, `The numbers in ${label} differ: the English has ${listed(a.numbers)}, the translation ${listed(b.numbers)}.`);
    }
    const words = String(want).replace(/\$[^$]*\$/g, ' ').match(LATIN_WORD) ?? [];
    if (words.length >= 4 && !DEVANAGARI.test(got)) {
      add(key, 'untranslated', false, `${label} reads as if it was not translated: it has no Devanagari at all.`);
    }
  };

  for (const [key, want] of Object.entries(source)) {
    const got = translated?.[key];
    if (Array.isArray(want)) {
      if (!Array.isArray(got) || !got.length) {
        add(key, 'missing', true, `${fieldLabel(key)} have no translation.`);
        continue;
      }
      if (got.length !== want.length) {
        const counted = key === 'options'
          ? `The English question has ${want.length} options, the translation ${got.length}.`
          : `The English has ${want.length} entries in ${fieldLabel(key)}, the translation ${got.length}.`;
        add(key, 'count', true, `${counted} A list is translated entry for entry, so nothing can be dropped or added.`);
        continue;
      }
      want.forEach((w, i) => compare(`${key}.${i}`, w, got[i]));
      continue;
    }
    compare(key, want, got);
  }
  return {
    ok: findings.length === 0,
    findings,
    blocking: findings.filter((f) => f.blocking),
    flags: findings.filter((f) => !f.blocking),
  };
}

/* ------------------------------------------------------------- the model -- */

/** The instruction the model is given. The professor's own material only, and the rules above. */
export function buildTranslationPrompt({ language, items }) {
  const lang = LANGUAGES[language];
  return [
    `You translate a college course's study material from English into ${lang.name} (${lang.native}), in Devanagari script, `
      + 'for undergraduate students in India.',
    'Rules, all of them mandatory:',
    '1. Keep technical terms in English, in Latin letters, exactly as written: names of concepts, methods, algorithms, laws, '
      + 'protocols, units, chemical names, programming keywords and identifiers. Translate the sentence around them.',
    '2. Copy every formula between $ signs, and every block of code between ``` fences, exactly as it is, character for character.',
    '3. Keep every number exactly as written, in the digits 0 to 9. Never write a number in Devanagari digits or in words.',
    '4. A list stays the same length and order: translate it entry for entry. Never add, drop, merge or reorder an entry.',
    `5. Keep every ${BLANK_MARK} (four underscores, a gap the student fills in) exactly as it is: the same number of them, `
      + 'in the same order. Never translate, drop, add or merge one.',
    '6. Translate only. Do not explain, correct, shorten or add anything, and never say which answer is right.',
    `7. Write plain, standard ${lang.name} that a first-year undergraduate reads easily.`,
    'Reply with JSON only: {"items": [{"item": "I1", "fields": [{"key": "text", "text": "..."}, {"key": "options", '
      + '"list": ["...", "..."]}]}]}: one entry per item, every key it was given, a "text" for a text and a "list" for a list.',
    '',
    'ITEMS',
    ...items.map((it) => `${it.label}: ${JSON.stringify(it.fields)}`),
  ].join('\n');
}

const TRANSLATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          item: { type: Type.STRING },
          fields: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                key: { type: Type.STRING },
                text: { type: Type.STRING },
                list: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['key'],
            },
          },
        },
        required: ['item', 'fields'],
      },
    },
  },
  required: ['items'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Translate the items now. Reply with the JSON object and nothing else.',
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: TRANSLATION_SCHEMA,
      systemInstruction: prompt,
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const text = response?.text;
  if (!text) throw new Error('the model returned an empty response');
  return text;
}

const stripFence = (text) => String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

const keptText = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, MAX_TRANSLATED_FIELD) : null);

/**
 * The model's reply held to what it was given. `items`: [{ label, fields }] as
 * sent. Only labels sent, only their keys, a text for a text and a list of texts
 * for a list (its length is the check's business, not the parser's), nothing
 * holding contact details. A list may come back as one key per entry
 * ("options.0", ...) and is put back together.
 *
 * @returns {{ results: Map<string, object>, skipped: { item, why }[] }}
 * @throws when the reply is not JSON holding a list of items
 */
export function parseTranslationReply(text, { items }) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const list = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(list)) throw new Error('the model\'s reply held no list of items');
  const byLabel = new Map(items.map((it) => [it.label, it]));
  const results = new Map();
  const skipped = [];

  for (const entry of list) {
    const label = collapse(entry?.item).toUpperCase();
    const sent = byLabel.get(label);
    if (!sent) { skipped.push({ item: label || '?', why: 'it named an item that was not sent' }); continue; }
    if (results.has(label)) { skipped.push({ item: label, why: 'it was translated twice; the first was kept' }); continue; }
    // Either [{ key, text | list }] (the schema's shape) or { key: value }.
    const pairs = Array.isArray(entry?.fields)
      ? entry.fields.map((f) => [collapse(f?.key), f?.list !== undefined && f?.list !== null ? f.list : f?.text])
      : Object.entries(entry?.fields && typeof entry.fields === 'object' ? entry.fields : {});
    const fields = {};
    const pieces = new Map();
    for (const [key, value] of pairs) {
      const piece = /^(.+)\.(\d+)$/.exec(key);
      if (piece && Array.isArray(sent.fields[piece[1]])) {
        const got = keptText(value);
        if (got !== null) pieces.set(piece[1], [...(pieces.get(piece[1]) ?? []), [Number(piece[2]), got]]);
        continue;
      }
      if (!(key in sent.fields) || key in fields) continue;
      if (Array.isArray(sent.fields[key])) {
        if (Array.isArray(value)) fields[key] = value.map(keptText).filter((v) => v !== null);
      } else {
        const got = keptText(value);
        if (got !== null) fields[key] = got;
      }
    }
    for (const [key, list2] of pieces) {
      if (!(key in fields)) fields[key] = list2.sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    }
    if (!Object.keys(fields).length) { skipped.push({ item: label, why: 'it came back with no usable text' }); continue; }
    if (holdsContact(JSON.stringify(fields))) { skipped.push({ item: label, why: 'it held contact details' }); continue; }
    results.set(label, fields);
  }
  return { results, skipped };
}

/**
 * Translate items into one language. `items`: [{ key, fields }], `key` the
 * caller's own handle. With no key (and no stand-in `callModel`) nothing is
 * asked: { source: 'offline', results: [] }. Never throws for a model problem:
 * a failed batch is a warning and no translations for its items.
 *
 * @returns {Promise<{ source: 'llm'|'offline', model: string|null, results: { key, fields }[], skipped: { key, why }[], warnings: string[] }>}
 */
export async function translateItems({ language, items = [], callModel = null }) {
  if (!TRANSLATED_LANGUAGES.includes(language)) throw fail('Translations are made into Hindi or Marathi.', 400);
  if (!callModel && !hasGemini()) return { source: 'offline', model: null, results: [], skipped: [], warnings: [] };
  const out = { source: 'llm', model: callModel ? 'stand-in' : config.gemini.model, results: [], skipped: [], warnings: [] };
  for (let i = 0; i < items.length; i += BATCH_ITEMS) {
    const batch = items.slice(i, i + BATCH_ITEMS).map((it, j) => ({ ...it, label: `I${j + 1}` }));
    try {
      const text = await (callModel ?? geminiCall)(buildTranslationPrompt({ language, items: batch }), { timeoutMs: CALL_TIMEOUT_MS });
      const { results, skipped } = parseTranslationReply(text, { items: batch });
      for (const it of batch) {
        if (results.has(it.label)) out.results.push({ key: it.key, fields: results.get(it.label) });
      }
      for (const s of skipped) {
        const it = batch.find((b) => b.label === s.item);
        out.skipped.push({ key: it?.key ?? null, why: s.why });
      }
      for (const it of batch) {
        if (!results.has(it.label) && !skipped.some((s) => s.item === it.label)) out.skipped.push({ key: it.key, why: 'the model left it out' });
      }
    } catch (err) {
      out.warnings.push(`The model could not translate ${batch.length === 1 ? 'one item' : `${batch.length} items`}: ${err.message}.`);
      for (const it of batch) out.skipped.push({ key: it.key, why: 'the model call failed' });
    }
  }
  return out;
}

/* ---------------------------------------------------------- the choice -- */

/** The language a student chose to read the hub in, or English. Never throws: English stands if it cannot be read. */
export async function languageChoice(repo, account) {
  if (!account?.id) return ORIGINAL;
  try {
    const tag = await repo.getLanguageChoice(account.id);
    return isLanguage(tag) ? tag : ORIGINAL;
  } catch (err) {
    console.error('[hub] a student\'s language could not be read; English is shown:', err.message);
    return ORIGINAL;
  }
}

/** What a screen says about the languages. */
export const languageChoices = () => Object.values(LANGUAGES).map((l) => ({ ...l, original: l.tag === ORIGINAL }));

/* ------------------------------------------------------------- showing -- */

/** The note a student reads when their language has no approved version yet. */
export function notYetNote(kind, language) {
  const noun = registry.get(kind)?.noun ?? 'item';
  return `This ${noun} is not in ${LANGUAGES[language]?.name ?? language} yet, so it is shown in English.`;
}

/**
 * The approved translations that may be shown now, by item id (lower case):
 * approved, in this language, made from the English each item holds now, and
 * with no blocking finding against it (the check refuses to approve one; this
 * holds for one approved before a rule was added, such as the gaps').
 * Never throws: when the translations cannot be read, English stands.
 */
export async function servableTranslations(repo, { kind, items = [], language }) {
  const out = new Map();
  if (!TRANSLATED_LANGUAGES.includes(language) || !items.length) return out;
  let rows;
  try {
    rows = await repo.listItemTranslations({ itemKind: kind, itemIds: items.map((i) => String(i._id)), language, status: 'approved' });
  } catch (err) {
    console.error('[hub] translations could not be read; English is shown:', err.message);
    return out;
  }
  const byId = new Map(items.map((i) => [String(i._id).toLowerCase(), i]));
  for (const t of rows) {
    const item = byId.get(String(t.itemId).toLowerCase());
    if (!item) continue;
    const english = fieldsOf(kind, item);
    if (isCurrent(t, english) && !checkTranslation(english, t.fields).blocking.length) out.set(String(t.itemId).toLowerCase(), t);
  }
  return out;
}

/**
 * Which language one item is shown in to one student, given the approved
 * translation that may be shown (servableTranslations) or none. Pure.
 *
 * @returns {{ requested: string, language: string, translationId: string|null, note: string|null }}
 */
export function shownLanguage({ kind, wanted = ORIGINAL, translation = null }) {
  const requested = isLanguage(wanted) ? wanted : ORIGINAL;
  if (requested === ORIGINAL) return { requested, language: ORIGINAL, translationId: null, note: null };
  if (translation) return { requested, language: requested, translationId: String(translation._id), note: null };
  return { requested, language: ORIGINAL, translationId: null, note: notYetNote(kind, requested) };
}

/**
 * THE function for "which language was this item shown in": the language one
 * item is shown in now to a student who chose `wanted`, with the translation
 * shown. For the hub's attempt store (H5): record `language` and
 * `translationId` on the attempt.
 */
export async function languageShown(repo, { kind = 'question', item, wanted = ORIGINAL }) {
  const map = await servableTranslations(repo, { kind, items: [item], language: wanted });
  return shownLanguage({ kind, wanted, translation: map.get(String(item._id).toLowerCase()) ?? null });
}

/**
 * The language an answer was given in, for the attempt it is recorded on. The
 * screen echoes what it was shown (`claim`: { language, translationId }), which
 * is believed when it can have been true: English always, or a translation of
 * this item into that language that a professor approved (it may have been
 * replaced since the screen loaded). Anything else is replaced by what the
 * student would be shown now.
 *
 * @returns {Promise<{ language: string, translationId: string|null }>}
 */
export async function attemptLanguage(repo, { kind = 'question', item, claim = null, wanted = ORIGINAL }) {
  const lang = claim?.language;
  if (lang === ORIGINAL) return { language: ORIGINAL, translationId: null };
  if (TRANSLATED_LANGUAGES.includes(lang) && isRecordId(String(claim?.translationId ?? ''))) {
    const t = await repo.getItemTranslation(String(claim.translationId)).catch(() => null);
    if (t && t.itemKind === kind && sameId(t.itemId, item._id) && t.language === lang && t.approvedAt) {
      return { language: lang, translationId: String(t._id) };
    }
  }
  const shown = await languageShown(repo, { kind, item, wanted });
  return { language: shown.language, translationId: shown.translationId };
}

/**
 * A question as one student is shown it (forStudent()'s output), in the
 * translation given. Only the wording and, item for item, the options change;
 * `keep` is the fewer-choices reduction (shownOptionIndices) when there is one.
 */
export function localiseQuestion(q, shown, translation, keep = null) {
  if (!translation) return shown;
  const f = translation.fields ?? {};
  const out = { ...shown };
  if (typeof f.text === 'string' && f.text.trim()) out.text = f.text;
  if (Array.isArray(shown.options) && Array.isArray(f.options) && f.options.length === (q.options ?? []).length) {
    out.options = keep ? keep.map((i) => f.options[i]) : [...f.options];
  }
  return out;
}

/* --------------------------------------------------------- staff views -- */

const STATUS_LABEL = {
  draft: 'Draft: students do not see it until you approve it.',
  approved: 'Approved: students who chose this language see it.',
  superseded: 'Replaced by a newer approved translation.',
  discarded: 'Discarded: never shown to students.',
};

const PROVENANCE_LABEL = {
  ai: 'AI draft',
  professor: 'Written or edited by the professor',
};

/**
 * A translation's or an item's fields as HTML, key for key: a text as one HTML
 * string, a list (a question's options, an example's steps) item for item,
 * anything else null. The professor checks a translation against the English
 * side by side, and a formula or a code block shown as its source on either
 * side is not what a student reads.
 */
export async function fieldsHtml(fields) {
  const one = async (v) => (typeof v === 'string' ? (await richText(v)).html : null);
  const out = {};
  for (const [key, value] of Object.entries(fields && typeof fields === 'object' ? fields : {})) {
    out[key] = Array.isArray(value) ? await Promise.all(value.map(one)) : await one(value);
  }
  return out;
}

/** A translation as a staff screen gets it, beside the English it is checked against now. */
export async function translationView(t, english = null) {
  const stale = english ? !isCurrent(t, english) : false;
  const check = english && !stale ? checkTranslation(english, t.fields) : null;
  const findings = check ? check.findings : (Array.isArray(t.checks) ? t.checks : []);
  return {
    id: String(t._id),
    itemKind: t.itemKind,
    itemId: String(t.itemId),
    language: t.language,
    languageName: LANGUAGES[t.language]?.name ?? t.language,
    status: t.status,
    statusLabel: stale && t.status === 'approved' ? `Approved, but out of date. ${STALE_NOTE}` : STATUS_LABEL[t.status],
    provenance: t.provenance,
    provenanceLabel: t.provenance === 'ai' && t.status === 'draft' ? 'AI draft' : PROVENANCE_LABEL[t.provenance],
    model: t.model ?? null,
    fields: t.fields,
    fieldsHtml: await fieldsHtml(t.fields),
    madeFrom: t.sourceFields,
    stale,
    ...(stale ? { staleNote: STALE_NOTE } : {}),
    findings,
    blocking: findings.filter((f) => f.blocking).length,
    flags: findings.filter((f) => !f.blocking).length,
    createdAt: t.createdAt ?? null,
    updatedAt: t.updatedAt ?? null,
    approvedAt: t.approvedAt ?? null,
    approvedBy: t.approvedBy ?? null,
  };
}

/* ------------------------------------------------------- the statistics -- */

const attemptTime = (a) => String(a?.answeredAt ?? a?.createdAt ?? '');

/**
 * Item statistics by language from hub attempts (H12), for Phase 5's
 * translation warning. Per question: each student's FIRST graded attempt at it
 * (a first attempt is the one that says how hard the item is to read; later
 * ones are practice of it), split by the language it was shown in through
 * languageSplit(), with its warning when two languages differ by more than its
 * threshold. `attempts` are hub attempts as the attempt store returns them
 * ({ accountId, questionId, language, correct, ungraded, answeredAt });
 * `questions` the questions to report, in the order wanted.
 */
export function languageItemStats(attempts = [], questions = []) {
  const firsts = new Map();
  for (const a of [...attempts].sort((x, y) => attemptTime(x).localeCompare(attemptTime(y)))) {
    if (a?.ungraded || !a?.questionId || !a?.accountId) continue;
    const key = `${String(a.questionId).toLowerCase()}\u0000${String(a.accountId)}`;
    if (!firsts.has(key)) firsts.set(key, a);
  }
  const byQuestion = new Map();
  for (const a of firsts.values()) {
    const id = String(a.questionId).toLowerCase();
    byQuestion.set(id, [...(byQuestion.get(id) ?? []), { language: a.language, correct: a.correct === true }]);
  }
  return questions.map((q) => {
    const rows = byQuestion.get(String(q._id).toLowerCase()) ?? [];
    return {
      questionId: String(q._id),
      text: q.text ?? '',
      kind: q.kind ?? 'mcq',
      bloom: q.bloom ?? null,
      students: rows.length,
      ...languageSplit(rows),
    };
  });
}
