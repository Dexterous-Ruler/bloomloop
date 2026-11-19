// Cheap surface checks on one question, shown beside a draft while a professor
// reviews it.
//
// Why rules and not a second model: the review of the evidence behind this
// (reports/BloomLoop gap analysis and roadmap.md, "Questions from uploaded units
// need a review gate") found rule checks cheap and reliable for exactly these
// surface flaws, while a model asked to solve or review the item caught about a
// third of the bad ones. And the live loop must stay free of model calls anyway.
//
// Every check is ADVICE. Nothing here refuses a question: a professor may approve
// one that fails, and the approve route says which checks failed. The validator
// in questionTypes.js is the thing that refuses.
//
// Pure: a question document in, an array of results out. Each result is
// { id, ok, message }, and only the checks that apply to the question's kind are
// in the array (a written answer has no options to be too long), always in the
// order of CHECK_IDS.

import { LABEL as LEVEL_LABEL } from '../bloom.js';
import { LABEL as KIND_LABEL, isUngraded, rubricKeys } from '../questionTypes.js';

export const CHECK_IDS = [
  'longest-option-is-key',
  'absolute-words',
  'all-none-of-the-above',
  'duplicate-options',
  'several-keys',
  'empty-rubric',
  'slide-only-reference',
  'create-selected-response',
];

/**
 * Kinds where the student writes or types the answer rather than picking it out
 * of what the screen offers. Everything else is selected response.
 */
export const PRODUCED_KINDS = ['blank', 'cloze', 'numeric', 'open', 'table'];

/** Does the screen offer the answer to be picked out? */
export const isSelectedResponse = (kind) => !PRODUCED_KINDS.includes(kind ?? 'mcq');

/**
 * How much longer than every wrong option the answer must be before its length
 * gives it away. Strictly longest alone fires on a quarter of honest four-option
 * items by chance, and a check that cries wolf that often is one a professor
 * learns to ignore.
 */
export const LONGER_BY = 1.2;

/** Two options whose content words overlap this much say the same thing. */
const NEAR_DUPLICATE = 0.75;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was', 'were', 'its', 'into', 'than', 'then',
  'but', 'not', 'has', 'have', 'had', 'been', 'which', 'what', 'who', 'how', 'why', 'when', 'where', 'they',
  'them', 'their', 'there', 'these', 'those', 'also', 'such', 'each', 'some', 'any', 'can', 'may', 'will',
]);

const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v) => text(v).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const bare = (v) => norm(v).replace(/^(?:a|an|the) /, '');
const words = (v) => new Set(norm(v).split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
const list = (v) => (Array.isArray(v) ? v : []);
const quote = (v, max = 60) => {
  const t = text(v);
  return `"${t.length > max ? `${t.slice(0, max - 3)}...` : t}"`;
};

/**
 * The same option twice, or nearly: equal once case, punctuation and a leading
 * article are set aside, or sharing most of their content words. Two options of
 * one word each are compared only for equality - "Agree" and "Strongly agree"
 * are a scale, not a duplicate.
 */
export function sameOption(a, b) {
  if (bare(a) && bare(a) === bare(b)) return true;
  const x = words(a);
  const y = words(b);
  if (x.size < 2 || y.size < 2) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return shared / (x.size + y.size - shared) >= NEAR_DUPLICATE;
}

/**
 * The option lists a kind shows, each with the positions that are correct.
 * A dropdown has one list per gap; a poll has options and no key.
 */
function optionSets(q) {
  switch (q.kind ?? 'mcq') {
    case 'mcq':
      return [{ label: '', options: list(q.options), keys: Number.isInteger(q.answerIdx) ? [q.answerIdx] : [] }];
    case 'multi':
      return [{ label: '', options: list(q.options), keys: list(q.answerIdxs).filter(Number.isInteger) }];
    case 'dropdown':
      return list(q.blanks).map((b, i) => ({
        label: `Gap ${i + 1}: `,
        options: list(b?.options),
        keys: Number.isInteger(b?.answerIdx) ? [b.answerIdx] : [],
      }));
    case 'poll':
      return [{ label: '', options: list(q.options), keys: [] }];
    default:
      return [];
  }
}

const result = (id, ok, message) => ({ id, ok, message });

// ------------------------------------------------------------------ checks --

function longestIsKey(q) {
  const id = 'longest-option-is-key';
  const [set] = optionSets(q);
  const keys = new Set(set.keys);
  const right = set.options.filter((_, i) => keys.has(i)).map((o) => text(o).length);
  const wrong = set.options.filter((_, i) => !keys.has(i)).map((o) => text(o).length);
  if (!right.length || !wrong.length) return result(id, true, 'There is no answer and distractor to compare.');
  const shortestRight = Math.min(...right);
  const longestWrong = Math.max(...wrong);
  if (shortestRight > longestWrong * LONGER_BY) {
    const which = right.length > 1 ? 'Every correct option is' : 'The answer is';
    return result(id, false,
      `${which} clearly the longest (${shortestRight} characters against at most ${longestWrong} for a wrong one). ` +
      'Students learn to pick the longest option; even the lengths out.');
  }
  return result(id, true, 'The answer does not stand out by its length.');
}

// "all that apply" is the instruction of a multi, and "of the above" phrases are
// their own check below, so neither is counted twice here.
const ABSOLUTE = /\b(always|never|all|none)\b/gi;
const NOT_ABSOLUTE = /\b(?:all|none|both|neither) of (?:the )?(?:above|these|them|those)\b|\ball that apply\b/gi;

function absoluteWords(q) {
  const id = 'absolute-words';
  const found = (value) => [...text(value).replace(NOT_ABSOLUTE, ' ').matchAll(ABSOLUTE)].map((m) => m[1].toLowerCase());
  if ((q.kind ?? 'mcq') === 'truefalse') {
    const hits = found(q.text);
    return hits.length
      ? result(id, false,
        `The statement says "${hits[0]}". Absolute claims are usually false, and students who know that can answer without the material.`)
      : result(id, true, 'The statement has no absolute words (always, never, all, none).');
  }
  const [set] = optionSets(q);
  const where = [];
  set.options.forEach((option, i) => {
    const hits = found(option);
    if (hits.length) where.push(`"${hits[0]}" in option ${i + 1} (${quote(option)})`);
  });
  return where.length
    ? result(id, false,
      `${where.join('; ')}. Absolute words usually mark a wrong option, and students who know that can answer without the material.`)
    : result(id, true, 'No option uses an absolute word (always, never, all, none).');
}

const OF_THE_ABOVE = /\b(?:all|none|both|neither) of (?:the )?(?:above|these|them|those)\b/i;

function allNoneOfTheAbove(q) {
  const id = 'all-none-of-the-above';
  const where = [];
  for (const set of optionSets(q)) {
    set.options.forEach((option, i) => {
      if (OF_THE_ABOVE.test(text(option))) where.push(`${set.label}option ${i + 1} (${quote(option)})`);
    });
  }
  return where.length
    ? result(id, false,
      `${where.join('; ')} refers to the other options. It can be answered by spotting two right or two wrong options, without knowing all of them.`)
    : result(id, true, 'No option refers to the other options.');
}

function duplicateOptions(q) {
  const id = 'duplicate-options';
  const lists = (q.kind ?? 'mcq') === 'match'
    ? [
      { label: 'Left column: ', options: list(q.pairs).map((p) => p?.left) },
      { label: 'Right column: ', options: list(q.pairs).map((p) => p?.right) },
    ]
    : optionSets(q);
  const where = [];
  for (const set of lists) {
    for (let i = 0; i < set.options.length; i += 1) {
      for (let j = i + 1; j < set.options.length; j += 1) {
        if (sameOption(set.options[i], set.options[j])) {
          where.push(`${set.label}${i + 1} and ${j + 1} say the same thing (${quote(set.options[i], 40)} / ${quote(set.options[j], 40)})`);
        }
      }
    }
  }
  return where.length
    ? result(id, false, `${where.join('; ')}. Make every option say something different.`)
    : result(id, true, 'Every option says something different.');
}

function severalKeys(q) {
  const id = 'several-keys';
  const where = [];
  for (const set of optionSets(q)) {
    const keys = new Set(set.keys);
    for (const k of keys) {
      set.options.forEach((option, j) => {
        if (keys.has(j) || !sameOption(set.options[k], option)) return;
        where.push(`${set.label}option ${j + 1} (${quote(option, 40)}) says the same as the correct ${quote(set.options[k], 40)}`);
      });
    }
  }
  return where.length
    ? result(id, false, `${where.join('; ')}, so a student who picks it is right too but is marked wrong.`)
    : result(id, true, 'No wrong option says the same as a correct one.');
}

function emptyRubric(q) {
  const id = 'empty-rubric';
  const rubric = list(q.rubric);
  if (!rubric.length || rubric.every((point) => !text(point))) {
    return result(id, false, 'The rubric is empty, so no written answer can earn a mark.');
  }
  // The marker looks for a point's words over three letters; a point with none
  // can never be found, however good the answer.
  const dead = rubric.map((point, i) => ({ point, i })).filter(({ point }) => rubricKeys(point).length === 0);
  if (dead.length) {
    return result(id, false,
      `${dead.map(({ point, i }) => `Rubric point ${i + 1} (${quote(point, 40)})`).join('; ')} has no word over three letters, ` +
      'so the marker can never find it in an answer.');
  }
  return result(id, true, `The rubric has ${rubric.length} points the marker can look for.`);
}

/**
 * Words that point at something only the slide shows. "Which of the following"
 * is deliberately not here: the options ARE the following, and it is in half of
 * all stems.
 */
const VISUAL = [
  /\b(?:the|this|that|above|below|given|following|adjacent)\s+(?:figure|diagram|graph|chart|image|picture|plot|illustration|screenshot|photo|photograph|map|drawing|sketch)\b/i,
  /\bfig(?:ure)?\.?\s*\d/i,
  /\b(?:red|orange|yellow|green|blue|purple|pink|brown|grey|gray|black|white|dashed|dotted|shaded|highlighted|bold)\s+(?:curve|line|bar|arrow|box|region|area|circle|node|point|dot|graph|text|shape|block)s?\b/i,
];
const ON_SCREEN = [
  /\b(?:on|in|from)\s+(?:the|this)\s+slide\b/i,
  /\b(?:shown|given|depicted|illustrated|pictured|drawn)\s+(?:above|below|here|alongside)\b/i,
  /\bas shown\b/i,
];

function slideOnlyReference(q) {
  const id = 'slide-only-reference';
  const stimulus = q.stimulus && typeof q.stimulus === 'object' ? q.stimulus : null;
  const said = [q.text, ...optionSets(q).flatMap((s) => s.options)].map(text).join(' \n ');
  const visual = VISUAL.map((rx) => said.match(rx)?.[0]).find(Boolean);
  // An attached image or passage clears it (the owner's decision of 19 Nov
  // 2026): a passage can carry what the figure showed, a table or a described
  // curve, and the professor who attached it has judged that it does.
  if (visual && stimulus?.kind !== 'image' && stimulus?.kind !== 'passage') {
    return result(id, false,
      `It refers to "${visual}", which only the slide shows. Add the picture or a passage as a stimulus, or reword it so it can be answered without the slide.`);
  }
  const onScreen = ON_SCREEN.map((rx) => said.match(rx)?.[0]).find(Boolean);
  if (onScreen && !stimulus) {
    return result(id, false,
      `It says "${onScreen}", but nothing is shown with the question. Add the passage or picture as a stimulus, or reword it.`);
  }
  return result(id, true, 'It can be answered without seeing the slide.');
}

function createSelectedResponse(q) {
  const id = 'create-selected-response';
  const kind = q.kind ?? 'mcq';
  if (q.bloom === 'create' && isSelectedResponse(kind)) {
    return result(id, false,
      `A "${KIND_LABEL[kind] ?? kind}" is tagged ${LEVEL_LABEL.create}, but a question that offers the answer to pick ` +
      'cannot ask a student to create anything (Crowe et al. 2008). Retag it, or ask it as a written answer.');
  }
  return result(id, true, !isSelectedResponse(kind)
    ? 'The student writes the answer, so any level can be asked.'
    : `A "${KIND_LABEL[kind] ?? kind}" at ${LEVEL_LABEL[q.bloom] ?? q.bloom} is a level picking can reach.`);
}

// --------------------------------------------------------- which applies --

/** Which checks look at which kinds. A kind not named here gets only the last two. */
const APPLIES = {
  'longest-option-is-key': ['mcq', 'multi'],
  'absolute-words': ['mcq', 'multi', 'truefalse'],
  'all-none-of-the-above': ['mcq', 'multi', 'dropdown'],
  'duplicate-options': ['mcq', 'multi', 'dropdown', 'match', 'poll'],
  'several-keys': ['mcq', 'multi', 'dropdown'],
  'empty-rubric': ['open'],
};

const RUN = {
  'longest-option-is-key': longestIsKey,
  'absolute-words': absoluteWords,
  'all-none-of-the-above': allNoneOfTheAbove,
  'duplicate-options': duplicateOptions,
  'several-keys': severalKeys,
  'empty-rubric': emptyRubric,
  'slide-only-reference': slideOnlyReference,
  'create-selected-response': createSelectedResponse,
};

function applies(id, kind) {
  if (APPLIES[id]) return APPLIES[id].includes(kind);
  // A poll's level is where it sits in the lesson, not what it demands, so the
  // Create rule has nothing to judge on one.
  if (id === 'create-selected-response') return !isUngraded(kind);
  return true;
}

/**
 * Every check that applies to this question, in CHECK_IDS order.
 * @returns {{id: string, ok: boolean, message: string}[]}
 */
export function runChecks(q) {
  if (!q || typeof q !== 'object') return [];
  const kind = q.kind ?? 'mcq';
  return CHECK_IDS.filter((id) => applies(id, kind)).map((id) => RUN[id](q));
}

/** The failed ones, as a route reports them. Accepts null (never checked). */
export const failedChecks = (checks) =>
  list(checks).filter((c) => c && c.ok === false).map(({ id, message }) => ({ id, message }));
