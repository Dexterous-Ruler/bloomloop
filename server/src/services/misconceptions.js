// Phase 5 - misconception labels on wrong options, and the counts behind them.
//
// A wrong option is worth more than "wrong" when it is wrong in a particular
// way: "Thinks UDP guarantees delivery" says what to reteach, where "4 chose
// option C" says only that something went wrong. So each wrong option of a
// question with options may carry a short label naming the misunderstanding a
// student who picks it most likely holds, and the staff reports count how many
// students chose each labelled option: "12 students chose the option linked to
// the misunderstanding ...".
//
// What a label is.
//   - On a wrong option of a Choose one (mcq), Choose all that apply (multi) or
//     True or false question, at most one per option. Never on a poll, which has
//     no wrong answer, and never on a right answer.
//   - At most MAX_LABEL characters, and no contact details: it names a
//     misunderstanding, not a person.
//   - Its provenance: 'ai' when the generator proposed it (shown as "AI draft"
//     until the professor confirms it), 'professor' once the professor wrote,
//     edited or confirmed it.
//   - Stored on the question (questions.misconceptions, 0024) by the option's
//     TEXT, not its position: options are reordered by edits, and a label belongs
//     to what the option says. A label whose option is reworded or becomes a
//     right answer no longer applies (keptLabels), and the bank routes drop it
//     with the edit and say so.
//
// What a label is not. It changes no marking: the score, the ladder, the bands,
// item statistics' proportions and attainment never read it. So editing one on
// an approved question does not send the question back to draft, and approving
// a question does not confirm its labels. It never reaches a phone or the
// projector: forStudent() builds the phone's question field by field, the
// answer snapshot leaves it out (snapshotOf in sockets/index.js), and the
// projector's whitelist never names it.
//
// Which label an answer counts under. The question's CURRENT label for the
// option the student chose, matched by that option's text in the answer's own
// snapshot (the question as that student saw it), so an answer given before the
// options were reordered still lands on the right option, and an answer given
// before the label was written is counted under it and says so ("Label added
// after these answers"). An answer to an option reworded since matches nothing.
//
// Pure: no repository, no request, no ownership. The readers are in
// services/itemStats.js, beside the item report these counts belong to, and the
// routes in routes/bank.js and routes/misconceptions.js decide who may ask.

import { levelIndex } from '../bloom.js';
import { LABEL as KIND_LABEL, isUngraded, kindLabel, toOriginalResponse } from '../questionTypes.js';
import { rollKey } from './evidence.js';
import { questionProvenance } from './honesty.js';

/** The kinds whose wrong options may carry a label. */
export const LABELLED_KINDS = Object.freeze(['mcq', 'multi', 'truefalse']);

/** The longest label: a phrase naming one misunderstanding, not a paragraph. */
export const MAX_LABEL = 120;

export const PROVENANCES = Object.freeze(['ai', 'professor']);

/** How each provenance is shown to staff. */
export const PROVENANCE_LABEL = Object.freeze({ ai: 'AI draft', professor: 'Professor\'s label' });

/** A true/false question's two answers, named as the item report names them. */
const TRUE_FALSE = Object.freeze(['True', 'False']);

export const MISCONCEPTIONS_PRIVACY = 'Misconception labels and these counts are for staff only: never shown on a phone '
  + 'or the projector. They count students and never name them, and they change no mark, level or attainment figure.';

export const MISCONCEPTIONS_METHOD = 'Each student\'s counted answer to a question in a room is their final answer to it '
  + '(an attempt they retried is not counted, and nor are a class question\'s votes). A student who chose a labelled '
  + 'option is counted under that option\'s label as it stands now, matched by the option\'s words in the question as '
  + 'the student saw it, so reordering options changes nothing and an option reworded since is not counted. A choose-all '
  + 'question counts every labelled option a student ticked. An AI draft label is counted, and marked as a draft until '
  + 'the professor confirms it.';

export const LABEL_NOTE = 'A misconception label changes no mark: editing one does not send an approved question back '
  + 'to draft, and approving a question does not confirm its labels.';

const KIND_REFUSAL = `Misconception labels go on the wrong options of a "${KIND_LABEL.mcq}", "${KIND_LABEL.multi}" `
  + `or "${KIND_LABEL.truefalse}" question.`;
const POLL_REFUSAL = 'A poll has no wrong answer, so it takes no misconception label.';
const CONTACT_REFUSAL = 'A misconception label names a misunderstanding, not a person, so it cannot hold an email '
  + 'address, a web address, a handle or a phone number.';

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** How option text is compared: case and runs of spaces ignored, as the validator compares options. */
export const textKey = (v) => collapse(v).toLowerCase();

/**
 * Contact details. A run of ten or more digits is a phone number here: no
 * misconception about a chapter needs one, and an Indian mobile is ten.
 */
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const WEB = /\bhttps?:\/\/|\bwww\.[^\s.]+\./i;
const HANDLE = /(^|\s)@\w{2,}/;
const DIGIT_RUNS = /\+?\d[\d\s().-]*\d/g;
const hasContact = (text) => EMAIL.test(text) || WEB.test(text) || HANDLE.test(text)
  || (text.match(DIGIT_RUNS) ?? []).some((run) => run.replace(/\D/g, '').length >= 10);

/**
 * Why this text cannot be a label, or null. Empty is not a label: clearing one
 * is its own action.
 */
export function labelProblem(raw) {
  if (typeof raw !== 'string') return 'A misconception label must be text.';
  const text = collapse(raw);
  if (!text) return 'A misconception label cannot be empty.';
  if (text.length > MAX_LABEL) return `A misconception label is at most ${MAX_LABEL} characters; this one is ${text.length}.`;
  if (hasContact(text)) return CONTACT_REFUSAL;
  return null;
}

/** The options a label can sit on, in the question's own order, or null for a kind that takes none. */
export function optionTexts(q) {
  const kind = q?.kind ?? 'mcq';
  if (kind === 'truefalse') return [...TRUE_FALSE];
  if (kind === 'mcq' || kind === 'multi') return (Array.isArray(q?.options) ? q.options : []).map((o) => String(o ?? ''));
  return null;
}

/** The indices of the wrong options, by the question's own key. */
export function wrongIdxs(q) {
  const texts = optionTexts(q) ?? [];
  switch (q?.kind ?? 'mcq') {
    case 'mcq':
      return Number.isInteger(q?.answerIdx) ? texts.map((_, i) => i).filter((i) => i !== q.answerIdx) : [];
    case 'multi': {
      const right = new Set((Array.isArray(q?.answerIdxs) ? q.answerIdxs : []).map(Number));
      return right.size ? texts.map((_, i) => i).filter((i) => !right.has(i)) : [];
    }
    case 'truefalse':
      return typeof q?.answerBool === 'boolean' ? [q.answerBool ? 1 : 0] : [];
    default:
      return [];
  }
}

/** The stored labels, each a well-formed entry, whatever else the column holds. */
export function labelsOf(q) {
  return (Array.isArray(q?.misconceptions) ? q.misconceptions : []).filter((l) => l && typeof l === 'object'
    && typeof l.option === 'string' && typeof l.label === 'string' && PROVENANCES.includes(l.provenance));
}

/**
 * The stored labels that still apply to this question: each on an option it
 * has, which is a wrong option, one per option. `removed` is the rest: an
 * option reworded or taken away, an option that is now a right answer, a kind
 * that takes no label, or a second label for one option. Each kept label takes
 * the option's text as it is now (it may differ in case or spacing).
 */
export function keptLabels(q, labels = labelsOf(q)) {
  const texts = optionTexts(q);
  if (!texts) return { kept: [], removed: [...labels] };
  const wrong = new Map(wrongIdxs(q).map((i) => [textKey(texts[i]), texts[i]]));
  const seen = new Set();
  const kept = [];
  const removed = [];
  for (const l of labels) {
    const k = textKey(l.option);
    if (wrong.has(k) && !seen.has(k)) {
      seen.add(k);
      kept.push({ ...l, option: wrong.get(k) });
    } else {
      removed.push(l);
    }
  }
  return { kept, removed };
}

/**
 * The labels as a staff screen shows them: one per labelled wrong option, in
 * the question's option order, with its index (true/false: 0 is True, 1 False).
 */
export function labelView(q) {
  const texts = optionTexts(q);
  if (!texts) return [];
  const byKey = new Map(keptLabels(q).kept.map((l) => [textKey(l.option), l]));
  const out = [];
  texts.forEach((text, i) => {
    const l = byKey.get(textKey(text));
    if (!l) return;
    out.push({
      optionIdx: i,
      option: text,
      label: l.label,
      provenance: l.provenance,
      provenanceLabel: PROVENANCE_LABEL[l.provenance],
      // The label's approval state (Phase 5): a professor wrote or confirmed it.
      // An AI draft stays unconfirmed until then, whatever the question's status.
      confirmed: l.provenance === 'professor',
      addedAt: l.addedAt ?? null,
      changedAt: l.changedAt ?? l.addedAt ?? null,
    });
  });
  return out;
}

/** The label on the option with this text, as the item report shows it beside the option, or null. */
export function labelFor(q, optionText) {
  const hit = labelView(q).find((l) => textKey(l.option) === textKey(optionText));
  return hit ? { label: hit.label, provenance: hit.provenance, provenanceLabel: hit.provenanceLabel, confirmed: hit.confirmed } : null;
}

/**
 * Add, edit, confirm or clear labels, as the professor asks. `changes` is a
 * list of { option, label } or { option, confirm: true }:
 *   option        the option's index in the question as it stands (true/false:
 *                 0 True, 1 False)
 *   label         text adds or replaces the label; null or empty clears it
 *   confirm       true, with no label, confirms the label already there as is
 * Options not named keep what they have. A label the professor writes or
 * confirms is 'professor'. All or nothing: one refused change refuses them all.
 * Labels that no longer apply (keptLabels) are dropped with the write.
 *
 * @returns {{labels: object[], changed: object[]} | {reason: string}}
 */
export function changeLabels(q, changes, { by = null, at = new Date().toISOString() } = {}) {
  const kind = q?.kind ?? 'mcq';
  if (isUngraded(kind)) return { reason: POLL_REFUSAL };
  const texts = optionTexts(q);
  if (!texts) return { reason: KIND_REFUSAL };
  if (!Array.isArray(changes) || !changes.length) {
    return { reason: 'Name at least one option, with a label to add, a label to clear, or a label to confirm.' };
  }
  if (changes.length > texts.length) return { reason: `This question has ${texts.length} options; that names ${changes.length}.` };

  const wrong = new Set(wrongIdxs(q));
  const held = new Map(keptLabels(q).kept.map((l) => [textKey(l.option), l]));
  const named = new Set();
  const plan = [];
  for (const c of changes) {
    if (!c || typeof c !== 'object' || Array.isArray(c) || !Number.isInteger(c.option)) {
      return { reason: 'Each change names an option by its number in the question, counting from 0.' };
    }
    const i = c.option;
    if (i < 0 || i >= texts.length) {
      return { reason: `This question has no option ${i + 1}: its options are numbered 1 to ${texts.length}.` };
    }
    if (named.has(i)) return { reason: `Option ${i + 1} is named twice.` };
    named.add(i);
    const clearing = 'label' in c && (c.label === null || (typeof c.label === 'string' && !collapse(c.label)));
    const setting = 'label' in c && !clearing;
    if (!setting && !clearing && c.confirm !== true) {
      return { reason: `Say what to do with option ${i + 1}: give it a label, clear its label, or confirm the label it has.` };
    }
    // Clearing a right answer's label is a no-op (it has none that applies);
    // giving it one, or confirming one, is not allowed.
    if (!wrong.has(i) && !clearing) {
      return { reason: `Option ${i + 1} ("${texts[i]}") is a right answer: a misconception label goes on a wrong option.` };
    }
    const key = textKey(texts[i]);
    if (setting) {
      const why = labelProblem(c.label);
      if (why) return { reason: `Option ${i + 1}: ${why}` };
      plan.push({ i, key, action: 'set', label: collapse(c.label) });
    } else if (clearing) {
      plan.push({ i, key, action: 'clear' });
    } else {
      if (!held.has(key)) return { reason: `Option ${i + 1} has no label to confirm.` };
      plan.push({ i, key, action: 'confirm' });
    }
  }

  const changed = [];
  for (const { i, key, action, label } of plan) {
    const before = held.get(key);
    if (action === 'clear') {
      if (before) {
        held.delete(key);
        changed.push({ optionIdx: i, action: 'cleared' });
      }
    } else if (action === 'confirm' || (before && before.label === label)) {
      // The same words again is a confirmation, not an edit: the label did not change.
      if (before.provenance !== 'professor') {
        held.set(key, { ...before, provenance: 'professor', by });
        changed.push({ optionIdx: i, action: 'confirmed' });
      }
    } else {
      held.set(key, {
        option: texts[i],
        label,
        provenance: 'professor',
        addedAt: before?.addedAt ?? at,
        changedAt: at,
        by,
      });
      changed.push({ optionIdx: i, action: before ? 'edited' : 'added' });
    }
  }

  const order = new Map(texts.map((t, i) => [textKey(t), i]));
  const labels = [...held.values()].sort((a, b) => order.get(textKey(a.option)) - order.get(textKey(b.option)));
  return { labels, changed };
}

/**
 * The labels a model proposed with one of its items, as stored: 'ai', one per
 * wrong option, each a valid label. The model sends { optionIdx, label }; on a
 * true/false item it may leave optionIdx out, since there is one wrong answer.
 * Anything else (a right option, an index off the list, a label too long or
 * holding contact details, a second label for one option) is left out: a label
 * is advice beside the question, so a bad one costs the label, never the item.
 * Timeless: the route that saves the item stamps it (stampLabels).
 */
export function proposedLabels(item, raw) {
  const texts = optionTexts(item);
  if (!texts || !Array.isArray(raw)) return [];
  const wrong = wrongIdxs(item);
  const out = new Map();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    let i = entry.optionIdx;
    if ((item.kind ?? 'mcq') === 'truefalse' && (i === undefined || i === null)) [i] = wrong;
    if (!Number.isInteger(i) || !wrong.includes(i) || out.has(i)) continue;
    if (labelProblem(entry.label)) continue;
    out.set(i, { option: texts[i], label: collapse(entry.label), provenance: 'ai' });
  }
  return [...out.entries()].sort(([a], [b]) => a - b).map(([, l]) => l);
}

/** Proposed labels with the moment they were saved: added and last changed then, by nobody. */
export const stampLabels = (labels, at = new Date().toISOString()) => (Array.isArray(labels) ? labels : [])
  .map((l) => ({ ...l, addedAt: at, changedAt: at, by: null }));

/* ------------------------------------------------------------- the counts -- */

const snapOf = (a) => (a?.questionSnapshot && typeof a.questionSnapshot === 'object' ? a.questionSnapshot : {});
const kindOf = (a) => a?.kind ?? snapOf(a).kind ?? 'mcq';
const questionKey = (a) => String(a?.questionId || snapOf(a).id || '').toLowerCase();

/**
 * The option texts an answer chose, read from its own snapshot: its response
 * translated back from the order that student was shown (toOriginalResponse,
 * seeded as the live loop seeds forStudent, with a fewer-choices student's
 * shorter list), then each index to the option's words as they then stood.
 */
export function chosenTexts(answer) {
  const kind = kindOf(answer);
  if (!LABELLED_KINDS.includes(kind)) return [];
  const snap = { ...snapOf(answer), kind };
  const texts = optionTexts(snap);
  const qid = String(snap.id || answer?.questionId || '');
  const keep = Array.isArray(snap.shownOptions) ? snap.shownOptions : null;
  const orig = toOriginalResponse(snap, answer?.response, `${answer?.rollNo ?? ''}:${qid}`, keep);
  if (kind === 'truefalse') return orig === true ? [TRUE_FALSE[0]] : orig === false ? [TRUE_FALSE[1]] : [];
  const picked = kind === 'mcq' ? (orig === null ? [] : [orig]) : orig;
  return picked.map((i) => texts[i]).filter((t) => t !== undefined);
}

const plural = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

/** The report's own sentence for one labelled option. */
export function sentenceFor(students, { label, provenance }) {
  const who = students === 0 ? 'No student' : plural(students, 'student', 'students');
  const draft = provenance === 'ai' ? ' (an AI draft label, not yet confirmed by the professor)' : '';
  return `${who} chose the option linked to the misunderstanding "${label}"${draft}.`;
}

/** When the label came after some of the answers counted under it, a sentence saying so; else null. */
export function timingNote({ answers, beforeLabel, beforeChange }) {
  const parts = [];
  if (beforeLabel && beforeLabel === answers) parts.push('Label added after these answers.');
  else if (beforeLabel) parts.push(`Label added after ${beforeLabel} of these ${answers} answers.`);
  if (beforeChange) parts.push(`Label reworded after ${beforeChange} of these answers.`);
  return parts.length ? parts.join(' ') : null;
}

const timeOf = (v) => {
  const t = Date.parse(v ?? '');
  return Number.isFinite(t) ? t : null;
};

/** One question's labelled options and their counts. `list` is its counted answers. */
function questionItem(question, labels, list, studentOf) {
  const kind = question.kind ?? 'mcq';
  const now = new Set((optionTexts(question) ?? []).map(textKey));
  const per = labels.map((l) => ({ ...l, who: new Set(), answers: 0, beforeLabel: 0, beforeChange: 0 }));
  const byKey = new Map(per.map((p) => [textKey(p.option), p]));
  const answered = new Set();
  let otherWording = 0;

  for (const a of list) {
    answered.add(studentOf(a));
    const snapTexts = optionTexts({ ...snapOf(a), kind: kindOf(a) }) ?? [];
    const same = kindOf(a) === kind && snapTexts.length === now.size && snapTexts.every((t) => now.has(textKey(t)));
    if (!same) otherWording += 1;
    // A question asked as another kind then: its options are not these options.
    if (kindOf(a) !== kind) continue;
    const at = timeOf(a.answeredAt);
    for (const text of new Set(chosenTexts(a).map(textKey))) {
      const p = byKey.get(text);
      if (!p) continue;
      p.who.add(studentOf(a));
      p.answers += 1;
      const added = timeOf(p.addedAt);
      const changedAt = timeOf(p.changedAt);
      if (at !== null && added !== null && at < added) p.beforeLabel += 1;
      else if (at !== null && changedAt !== null && at < changedAt) p.beforeChange += 1;
    }
  }

  return {
    questionId: String(question._id),
    text: question.text ?? '',
    kind,
    kindLabel: kindLabel(question),
    bloom: question.bloom ?? null,
    topic: question.topic ?? '',
    status: question.status ?? 'active',
    // Who wrote the question and where it stands at the gate (Phase 5).
    provenance: questionProvenance(question),
    answers: list.length,
    students: answered.size,
    otherWording,
    ...(otherWording ? {
      otherWordingNote: `${plural(otherWording, 'of these answers was', 'of these answers were')} given to an earlier wording `
        + 'of the options. Each is counted under the label of the option whose words it chose; an option reworded since '
        + 'is not counted.',
    } : {}),
    options: per.map(({ who, ...p }) => {
      const counts = { students: who.size, answers: p.answers, beforeLabel: p.beforeLabel, beforeChange: p.beforeChange };
      return {
        optionIdx: p.optionIdx,
        option: p.option,
        label: p.label,
        provenance: p.provenance,
        provenanceLabel: p.provenanceLabel,
        confirmed: p.confirmed,
        addedAt: p.addedAt,
        changedAt: p.changedAt,
        ...counts,
        sentence: sentenceFor(who.size, p),
        note: timingNote(counts),
      };
    }),
  };
}

/** How many labelled options the summary at the top of a report lists. */
export const TOP = 5;

/**
 * The labelled options of every question in scope, with how many distinct
 * students chose each in their counted answer.
 *
 * `rows` are counted answers, one per student per question per room
 * (gradedAnswers in services/itemStats.js), already limited to the rooms being
 * reported on; a class question's votes are left out here too. `questions` are
 * the banks' rows, whose current labels are the ones counted. `include` names
 * questions to list even with no answer yet (a room's set). `pool` says who is
 * one student: 'roll', a roll number (a room, or a class, whose rooms share a
 * roster); 'room', a roll number in a room (a bank's rooms may be different
 * classes, which can share a roll number).
 *
 * Only questions with a label are listed, in ladder order, then topic and
 * text; options in the question's own order. `top` is the labelled options
 * most students chose, for a summary: an order of misunderstandings, never of
 * students.
 */
export function misconceptionReport({ rows = [], questions = [], include = [], pool = 'roll' } = {}) {
  const studentOf = pool === 'room' ? (a) => `${a.sessionId}:${rollKey(a.rollNo)}` : (a) => rollKey(a.rollNo);
  const byQuestion = new Map();
  for (const a of rows) {
    if (!a || a.classQuestionId) continue;
    const id = questionKey(a);
    if (!id) continue;
    if (!byQuestion.has(id)) byQuestion.set(id, []);
    byQuestion.get(id).push(a);
  }
  const bank = new Map(questions.map((q) => [String(q._id).toLowerCase(), q]));
  const ids = new Set([...byQuestion.keys(), ...include.map((id) => String(id ?? '').toLowerCase()).filter(Boolean)]);

  const items = [];
  for (const id of ids) {
    const question = bank.get(id);
    const labels = question ? labelView(question) : [];
    if (labels.length) items.push(questionItem(question, labels, byQuestion.get(id) ?? [], studentOf));
  }
  items.sort((a, b) => levelIndex(a.bloom) - levelIndex(b.bloom)
    || String(a.topic).localeCompare(String(b.topic))
    || String(a.text).localeCompare(String(b.text))
    || a.questionId.localeCompare(b.questionId));

  const options = items.flatMap((q) => q.options.map((o) => ({ q, o })));
  const top = options
    .filter(({ o }) => o.students > 0)
    .sort((x, y) => y.o.students - x.o.students)
    .slice(0, TOP)
    .map(({ q, o }) => ({
      questionId: q.questionId,
      text: q.text,
      optionIdx: o.optionIdx,
      option: o.option,
      label: o.label,
      provenance: o.provenance,
      students: o.students,
      sentence: o.sentence,
    }));

  return {
    counted: {
      questions: items.length,
      labels: options.length,
      aiDrafts: options.filter(({ o }) => o.provenance === 'ai').length,
      answers: items.reduce((n, q) => n + q.answers, 0),
    },
    questions: items,
    top,
    method: MISCONCEPTIONS_METHOD,
    privacy: MISCONCEPTIONS_PRIVACY,
  };
}
