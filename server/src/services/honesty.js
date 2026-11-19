// Phase 5 - honest indicators.
//
// The directive's words: show AI draft labels, the reasons for mastery
// movements, the number of responses behind an estimate, uncertain
// classifications and translation-related difficulty warnings; no stigmatising
// label on a student's screen, and no coins, leaderboards or streaks.
//
// The server's half is to send each indicator as data with a plain sentence, so a
// screen can show it without working anything out. Most of the numbers already
// existed; this module holds what is new and shared:
//
//   provenance     who wrote a question and whether a professor let it into
//                  rooms, in the professor's terms (questionProvenance) and in a
//                  student's (phoneProvenance, never "offline template" or
//                  "fallback")
//   level check    a question's Bloom level the professor should not take on
//                  trust: the model chose it and nobody has approved the question,
//                  or its kind is not one that asks for that level (levelCheck).
//                  Staff-only, and never on a phone
//   counts         "Based on 4 answers." (basedOn), the sentence every estimate
//                  carries beside its count
//   languages      per question, the share right in each language the answers
//                  came in, and a warning when two languages differ by more than
//                  a threshold (languageSplit); per student, which answers were in
//                  a language other than the question's own (studentLanguages)
//
// The level and mastery sentences live with the ladder (levelEvidence,
// levelMoves and masteryBasis in services/mastery.js), because they read it.
//
// Pure: no I/O, no framework. Who may see what is decided by the routes and the
// socket, never here.

import { LABEL as LEVEL_LABEL } from '../bloom.js';
import { KINDS_FOR_LEVEL, LABEL as KIND_LABEL, isUngraded, kindLabel, kindSuitsLevel } from '../questionTypes.js';
import { runChecks } from './checks.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------- provenance --

   Read off the question row as Phase 2 writes it (0013, 0022): `source` says
   who wrote the text ('llm', 'teacher', 'fallback'), `model` which model
   ('offline-template' for the offline generator, null when none is recorded),
   `status` and `approvedAt` whether a professor let it into rooms. */

/**
 * The offline generator's model id: OFFLINE_MODEL in services/generate.js, and
 * the value 0013 documents. Written out here rather than imported, because
 * generate.js loads the model client and the configuration, and this module is
 * read by every report; a unit test holds the two equal.
 */
export const TEMPLATE_MODEL = 'offline-template';

export const SOURCE_LABEL = Object.freeze({
  ai: 'AI-generated',
  professor: 'Professor-written',
  template: 'Offline template',
  // 'fallback' with no model: a professor's own question from before 19 Nov
  // 2026 (when 'teacher' arrived), or a template row older than 0013. Nothing
  // on the row tells the two apart, so neither is claimed.
  'professor-or-template': 'Professor-written or offline template',
});

/** Who wrote a question: ai, professor, template, or professor-or-template. */
export function sourceOf(q) {
  const source = q?.source ?? 'llm';
  if (source === 'teacher') return 'professor';
  if (source === 'fallback') return q?.model == null ? 'professor-or-template' : 'template';
  // 'llm', and a row with none (the column's default is 'llm').
  return 'ai';
}

/**
 * Where a question stands at the approval gate:
 *   draft        generated, waiting for a professor; no room serves it
 *   approved     a professor approved it (approvedAt)
 *   written      a professor wrote it, which is its approval
 *   unrecorded   in use since before approvals were recorded (Phase 2, 0013)
 *   discarded    rejected, retired by its replacement, or removed
 */
export function approvalOf(q) {
  const status = q?.status ?? 'active';
  if (status === 'draft') return 'draft';
  if (status === 'discarded') return 'discarded';
  if (q?.approvedAt) return 'approved';
  if (sourceOf(q) === 'professor') return 'written';
  return 'unrecorded';
}

const SOURCE_SENTENCE = {
  ai: (q) => `Written by the language model${q?.model ? ` (${q.model})` : ''} from the professor's material.`,
  professor: () => 'Written by a professor.',
  template: () => 'Made by the offline template from the professor\'s material, without a language model.',
  'professor-or-template': () => 'Written by a professor before 19 Nov 2026, or made by the offline template before '
    + 'models were recorded. No language model wrote it.',
};

const APPROVAL_SENTENCE = {
  draft: 'A draft: no room serves it until a professor approves it.',
  approved: 'Approved by a professor.',
  written: 'In use since a professor wrote it.',
  unrecorded: 'In use since before approvals were recorded.',
  discarded: 'Not in use: rejected, retired or removed.',
};

/** The short chip a screen shows beside the question. An AI question waiting for approval is an "AI draft". */
function chipOf(source, approval) {
  if (source === 'ai' && approval === 'draft') return 'AI draft';
  if (approval === 'draft') return `${SOURCE_LABEL[source]} draft`;
  if (approval === 'discarded') return `${SOURCE_LABEL[source]}, not in use`;
  if (approval === 'approved') return `${SOURCE_LABEL[source]}, approved`;
  if (approval === 'unrecorded') return `${SOURCE_LABEL[source]}, approval not recorded`;
  return SOURCE_LABEL[source];
}

/**
 * A question's provenance and approval state, for staff: who wrote it (and
 * which model), where it stands at the approval gate, a chip and a sentence.
 * Read from the row; nothing is stored.
 */
export function questionProvenance(q) {
  const source = sourceOf(q);
  const approval = approvalOf(q);
  return {
    source,
    sourceLabel: SOURCE_LABEL[source],
    model: q?.model ?? null,
    approval,
    approvedAt: q?.approvedAt ?? null,
    approvedBy: q?.approvedBy ?? null,
    aiDraft: source === 'ai' && approval === 'draft',
    label: chipOf(source, approval),
    sentence: `${SOURCE_SENTENCE[source](q)} ${APPROVAL_SENTENCE[approval]}`,
  };
}

/**
 * Who wrote a question, as a student may be told it. Only ever computed for a
 * question a room serves, so never a draft (servableFor in services/selector.js
 * is the gate). `checked` is true when a professor approved it, or wrote it. An
 * AI question with no approval recorded was still put in this room by the
 * professor, so it says "chosen", which is true, and not "checked", which is not
 * known. No "template", "fallback" or model name: a student is told what is true
 * in words a student uses.
 *
 * @returns {{ by: 'professor'|'ai'|'not-ai', checked: boolean, text: string }}
 */
export function phoneProvenance(q) {
  const source = sourceOf(q);
  const checked = Boolean(q?.approvedAt);
  if (source === 'professor') return { by: 'professor', checked: true, text: 'Written by your professor.' };
  if (source === 'ai') {
    return {
      by: 'ai',
      checked,
      text: checked ? 'Written with AI help and checked by your professor.' : 'Written with AI help and chosen by your professor.',
    };
  }
  if (source === 'template') {
    return {
      by: 'not-ai',
      checked,
      text: checked
        ? 'Made without AI from your professor\'s material, and checked by your professor.'
        : 'Made without AI from your professor\'s material.',
    };
  }
  return { by: 'not-ai', checked: false, text: 'Made without AI, by your professor or from their material.' };
}

/* ------------------------------------------------------------ level check --

   A question's Bloom level is a claim about what it asks. Two things make the
   claim one a professor should not take on trust, and each is shown with its
   reason, to staff only (a phone is never told its question's level might be
   wrong: it can do nothing about it, and it would read as the question being
   unfair):
     - the language model chose it and no professor has approved the question
       (the gap analysis: in one expert study about a third of model-written
       items missed the level asked for). Approval is the professor's
       confirmation; an edit before it is still a draft;
     - its kind is not one that asks for that level (KINDS_FOR_LEVEL), which on
       a stored question means a row from before kinds were tied to levels, or a
       Create question that offers the answer to pick (checks.js). A poll has no
       level to be wrong about. */

export const LEVEL_UNCONFIRMED = 'The language model chose this level and no professor has approved the question yet. '
  + 'Model-written questions often miss the level they were asked for, so check that it really asks for this level.';

/**
 * Is this question's level uncertain, and why? Staff-only.
 * @returns {{ uncertain: boolean, reasons: {id: string, message: string}[], sentence: string|null }}
 */
export function levelCheck(q) {
  const reasons = [];
  const kind = q?.kind ?? 'mcq';
  const level = q?.bloom;
  if (sourceOf(q) === 'ai' && !q?.approvedAt) reasons.push({ id: 'model-level-unconfirmed', message: LEVEL_UNCONFIRMED });
  if (level && !isUngraded(kind) && !kindSuitsLevel(kind, level)) {
    // The Create rule says it best for Create; the rest get the general reason.
    const create = runChecks(q).find((c) => c.id === 'create-selected-response' && c.ok === false);
    const kinds = (KINDS_FOR_LEVEL[level] ?? []).map((k) => `"${KIND_LABEL[k] ?? k}"`).join(', ');
    reasons.push({
      id: 'kind-does-not-fit-level',
      message: create?.message
        ?? `A "${KIND_LABEL[kind] ?? kind}" question is not one of the kinds that ask for ${LEVEL_LABEL[level] ?? level} (${kinds}), `
          + 'so it may not ask for that level at all. Retag it, or change its kind.',
    });
  }
  return {
    uncertain: reasons.length > 0,
    reasons,
    sentence: reasons.length ? `Level uncertain. ${reasons.map((r) => r.message).join(' ')}` : null,
  };
}

/**
 * A bank question as staff are sent it: the row, its provenance, its level check
 * and its kind as a person reads it (Batch 9: "Short answer" or "Long answer"
 * for a written one; kindLabel in questionTypes.js).
 */
export const staffQuestion = (q) => (q ? { ...q, provenance: questionProvenance(q), levelCheck: levelCheck(q), kindLabel: kindLabel(q) } : q);

/* ----------------------------------------------------------------- counts -- */

/**
 * The sentence an estimate carries beside its count: "Based on 4 answers.",
 * "Based on 34 graded answers from 12 students.", or "No answers yet."
 */
export function basedOn(answers, { students = null, unit = 'answer' } = {}) {
  const n = Number(answers) || 0;
  if (!n) return `No ${unit}s yet.`;
  const from = students === null || students === undefined ? '' : ` from ${plural(Number(students) || 0, 'student')}`;
  return `Based on ${plural(n, unit)}${from}.`;
}

/* -------------------------------------------------------------- languages --

   Every answer row keeps the language it was given in (answers.language, 0008).
   Today the live loop writes 'en' on every answer and vote (sockets/index.js):
   no phone shows a translated question yet, and no question records the
   language it was written in. Every question is taken as written in English,
   the language the generator writes in (its prompt asks for it), until one
   records otherwise. So everything below is ready for the Hub's language switch
   (Phase 6) and, until then, finds one language and says nothing. */

export const ORIGINAL_LANGUAGE = 'en';

/**
 * When two languages' shares right on one question are worth a warning.
 *
 *   minAnswersPerLanguage  5: the item report's own floor for a difficulty band
 *                          (MIN_ANSWERS_FOR_BAND in services/itemStats.js, the
 *                          ladder's window). Fewer than that, and one answer moves
 *                          a share by more than a fifth.
 *   gapAbovePoints         20 percentage points, strictly above. At the floor one
 *                          answer is exactly 20 points, so a single answer either
 *                          way can never raise the warning: it takes two.
 *
 * A default, chosen here (docs/PRODUCT_DECISIONS.md); the owner may want others.
 */
export const TRANSLATION_WARNING = Object.freeze({ minAnswersPerLanguage: 5, gapAbovePoints: 20 });

export const TRANSLATION_NOTE = 'Translation can change how hard a question is: a word with no exact match, a longer '
  + 'sentence or a changed example can make one language\'s version harder than another\'s. A gap between languages is a '
  + 'reason to check the translation before reading it as a gap in understanding.';

const TAG = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;

/** An answer's language tag, lower case; the original for a row with none or an unreadable one. */
export function languageOf(answer) {
  const tag = String(answer?.language ?? '').trim().toLowerCase();
  return TAG.test(tag) ? tag : ORIGINAL_LANGUAGE;
}

let names = null;
/** "Hindi" for 'hi'; the tag itself when the runtime has no name for it. */
export function languageName(tag) {
  try {
    names ??= new Intl.DisplayNames(['en'], { type: 'language' });
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

const pct = (correct, answers) => Math.round((100 * correct) / answers);

/**
 * One question's counted answers (one per student: gradedAnswers in
 * services/itemStats.js) split by the language each was given in: answers,
 * right, the share, the original language first. With answers in two or more
 * languages that each have at least minAnswersPerLanguage, the highest and
 * lowest shares are compared, in whole numbers so 4 of 5 against 3 of 5 is
 * exactly 20 points; a gap above gapAbovePoints is a warning naming both
 * languages and the numbers behind it.
 */
export function languageSplit(rows = [], { original = ORIGINAL_LANGUAGE } = {}) {
  const by = new Map();
  for (const a of rows) {
    const language = languageOf(a);
    const cell = by.get(language) ?? { language, answers: 0, correct: 0 };
    cell.answers += 1;
    if (a?.correct === true) cell.correct += 1;
    by.set(language, cell);
  }
  const languages = [...by.values()]
    .sort((x, y) => (y.language === original) - (x.language === original) || y.answers - x.answers || x.language.localeCompare(y.language))
    .map((c) => ({ ...c, name: languageName(c.language), share: c.answers ? c.correct / c.answers : null, original: c.language === original }));
  const total = rows.length;
  const other = total - (by.get(original)?.answers ?? 0);

  const { minAnswersPerLanguage: min, gapAbovePoints: gapAbove } = TRANSLATION_WARNING;
  const enough = languages.filter((l) => l.answers >= min);
  // a's share minus b's, as an integer numerator over a.answers * b.answers.
  const over = (a, b) => a.correct * b.answers - b.correct * a.answers;
  let warning = null;
  if (enough.length >= 2) {
    const hi = enough.reduce((a, b) => (over(b, a) > 0 ? b : a));
    const lo = enough.reduce((a, b) => (over(b, a) < 0 ? b : a));
    if (100 * over(hi, lo) > gapAbove * hi.answers * lo.answers) {
      const points = pct(hi.correct, hi.answers) - pct(lo.correct, lo.answers);
      warning = {
        languages: [hi.language, lo.language],
        higher: { language: hi.language, name: hi.name, answers: hi.answers, correct: hi.correct },
        lower: { language: lo.language, name: lo.name, answers: lo.answers, correct: lo.correct },
        gap: over(hi, lo) / (hi.answers * lo.answers),
        text: `Answers in ${lo.name} were right ${lo.correct} of ${lo.answers} times (${pct(lo.correct, lo.answers)}%), against `
          + `${hi.correct} of ${hi.answers} (${pct(hi.correct, hi.answers)}%) in ${hi.name}: a gap of ${points} points, above `
          + `the ${gapAbove}-point threshold. Translation can change how hard a question is, so check the ${lo.name} `
          + 'version before reading this as a gap in understanding.',
      };
    }
  }

  return {
    original,
    originalName: languageName(original),
    languages,
    otherThanOriginal: other,
    note: other
      ? `${other} of ${plural(total, 'answer')} ${other === 1 ? 'was' : 'were'} given in a language other than the question's own (${languageName(original)}).`
      : null,
    warning,
  };
}

/**
 * One student's answers by language, for the student card: how many were in a
 * language other than the question's own, and a sentence saying so (null when
 * none were). `rows` are the student's own answers.
 */
export function studentLanguages(rows = [], { original = ORIGINAL_LANGUAGE } = {}) {
  const counts = new Map();
  for (const a of rows) counts.set(languageOf(a), (counts.get(languageOf(a)) ?? 0) + 1);
  const other = [...counts.entries()].filter(([l]) => l !== original);
  const n = other.reduce((s, [, c]) => s + c, 0);
  return {
    original,
    originalName: languageName(original),
    languages: [...counts.entries()]
      .sort(([a, x], [b, y]) => (b === original) - (a === original) || y - x || a.localeCompare(b))
      .map(([language, answers]) => ({ language, name: languageName(language), answers, original: language === original })),
    otherThanOriginal: n,
    note: n
      ? `${n} of this student's ${plural(rows.length, 'answer')} ${n === 1 ? 'was' : 'were'} in `
        + `${other.map(([l]) => languageName(l)).join(' and ')}, not the question's own ${languageName(original)}. `
        + 'Translation can change how hard a question is.'
      : null,
  };
}
