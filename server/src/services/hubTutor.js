// The hub's tutor: hint ladders and feedback on wrong options (Phase 6,
// decision H13, under the owner's decisions 1 and 5).
//
// NO LIVE MODEL CALL. Decision 5 stands: nothing a student waits on calls a
// model. A hint is written before any student asks for it, by the professor or
// by the model on the professor's button (in the background), and a student
// sees only what the professor approved. So the tutor works offline and costs
// no quota while students use it. A live chat tutor is not built (H13).
//
// WHAT A QUESTION MAY CARRY (question_hints and option_feedback, 0029):
//   a hint ladder of up to three steps, each citing the slides it came from:
//     1 a nudge      what to look at or recall
//     2 a strategy   how to approach the question, without doing it
//     3 a worked step   the first part of the working, stopping short of the answer
//   feedback on each wrong option of a "Choose one", "Choose all that apply" or
//   "True or false" question: what a student who chose it most likely
//   confused, and what to look at again. Keyed by the option's words, as
//   misconception labels are (services/misconceptions.js), so a reorder keeps it
//   and a reworded option, or one that became a right answer, drops it.
// Each is an "AI draft" until approved, or the professor's own (approved as
// written: its author is its approver, as with an explanation).
//
// NEVER THE ANSWER (answerLeak). A hint is read BEFORE the attempt, so it must
// not hold the answer: the right option's words, its letter or number, the
// value a numeric question computes to, an accepted typed answer, a whole
// pairing, grouping or order, a rubric point word for word, or a statement that
// a true-or-false claim is true (or false). The check refuses such a hint when
// the professor writes it and when the model drafts it, saying why; it runs
// again before anything is shown, because a question's key can change after
// its hints were written, and on a translation before it is shown, because a
// translation is text the English check never read. Feedback is held to the
// same rule: it is also offered as a hint when the student meets the question
// again.
//
// WHICH HINT FIRST (planHints, pure). From the student's own recent attempts
// on this question and topic in the modes whose results they have already seen
// (practice, review sets, lessons; never a self-test or Get Ready, whose results
// may not be out), the wrong option they chose, and their topic state:
//   - the last attempt at this question was wrong and chose an option with
//     approved feedback: that feedback first, in place of the nudge (it is the
//     nudge that fits them), then the ladder from the strategy;
//   - the last attempt at this question was wrong after k hints: the ladder
//     starts at step k + 1 (those hints were not enough);
//   - most of their last five answers on the topic were wrong, or their
//     estimate (not provisional) gives them under an even chance on the topic's
//     typical question: the ladder starts at the strategy;
//   - otherwise the nudge (least help first: they can always ask for more).
// When the ladder has no step that far, the deepest step it has is offered. At
// most three hints per attempt (hub_attempts.hints_used is 0 to 3).
//
// RECORDED (hub_hint_views, 0029). Each hint opened is a row, append-only,
// under the client's attempt id, with the words shown, their language and the
// plan. The attempt then records how many (hintsUsedFor, through the practice
// loop's hint hook, services/hubHintHook.js). Asking again for a hint already
// shown returns it and records nothing new, so a resent request is harmless.
//
// MODES. Practice, review sets and lessons only (HINT_MODES). Never a self-test
// (H10: no hints) and never Get Ready (H9: a check of what the student knows).
// The database refuses a hint view in another mode, and hints on an attempt in
// those two modes (0029). Nor, in practice or a lesson, on a question closed to
// the student now (services/hubClosed.js): on one of their self-tests still open
// (those hints open once it is handed in or its time is up), the question an
// open Get Ready check of theirs is asking, or one being asked in a room.
//
// HINTS USED (hintsUsedFor). Every hint the student opened on the question
// since their previous answer to it counts, under whichever attempt id it was
// opened: a hint opened under one id and an answer sent under another is still
// help used (H13), and what staff read and the review rating rely on.
//
// What the model returns is held to the rules here, not trusted
// (parseTutorReply): only the questions it was shown, the steps and options it
// was asked for, each once; plain text of at most MAX_MODEL_TEXT characters with
// no contact details and no answer; slide numbers only from those the question's
// topic came from. Each refusal is named. Tests drive the parser with fixture
// replies and draftTutor with a stand-in `callModel`; nothing here is called
// with a real key in a test.

import { GoogleGenAI, Type } from '@google/genai';

import { config, hasGemini } from '../config.js';
import { LABEL as KIND_LABEL, toOriginalResponse } from '../questionTypes.js';
import { holdsContact } from './roster.js';
import { richText } from './richText.js';
import { slidesOfTopic } from './hubTopics.js';
import { attemptOrder, itemKeyOf } from './hubElo.js';
import { LABELLED_KINDS, optionTexts, textKey, wrongIdxs } from './misconceptions.js';
import { explanationInput, questionForModel } from './hubExplanations.js';
import {
  ORIGINAL, languageChoice, numbersIn, registerTranslatable, servableTranslations, shownLanguage,
} from './hubLanguages.js';
// Used inside functions only: hubPractice imports this module's hook
// (services/hubHintHook.js), so these bindings are read at call time, never
// while the modules load.
import { citeSlides, withLock } from './hubLessons.js';
import { hubSeed, stateFrom, studentScope, topicModels } from './hubPractice.js';
import { CLOSED_SENTENCE, closedQuestions } from './hubClosed.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const lower = (v) => String(v ?? '').trim().toLowerCase();
const sameId = (a, b) => lower(a) === lower(b);
const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------ constants -- */

/** The ladder's steps, in order. */
export const STEP_KINDS = Object.freeze({ 1: 'nudge', 2: 'strategy', 3: 'worked' });
export const HINT_KINDS = Object.freeze(['feedback', 'nudge', 'strategy', 'worked']);
const KIND_STEP = Object.freeze({ nudge: 1, strategy: 2, worked: 3 });

/** The modes a hint may be opened in (H10, H13). */
export const HINT_MODES = Object.freeze(['practice', 'review', 'lesson']);
/** The modes that never offer one: a self-test (H10) and Get Ready (H9). */
export const NO_HINT_MODES = Object.freeze(['exam', 'getready']);
/**
 * The modes whose results a student has already been shown, so their own
 * attempts there may choose the first hint. A self-test's or Get Ready's may
 * not be out yet: reading them here could tell the student how they did.
 */
export const SEEN_MODES = HINT_MODES;

/** The most hints one attempt opens (hub_attempts.hints_used is 0 to 3). */
export const MAX_HINTS = 3;
/** The kinds whose wrong options may carry feedback: those a misconception label may sit on. */
export const FEEDBACK_KINDS = LABELLED_KINDS;

/** The longest hint or feedback kept (the columns' own checks). */
export const MAX_TEXT = 600;
/** The longest the model may write: a student reads one on a phone, mid-question. */
export const MAX_MODEL_TEXT = 300;
/** The most questions one press drafts for, and the questions per model call. */
export const MAX_GENERATE_QUESTIONS = 60;
export const BATCH = 6;
/** How many of a student's latest answers on a topic say whether it is going badly, and the fewest that can. */
export const RECENT_TOPIC = 5;
export const MIN_RECENT = 3;
/** Under this estimated chance on the topic's typical question, the ladder starts at the strategy. */
export const LOW_P = 0.5;

const CALL_TIMEOUT_MS = 60000;

/** What a student reads above each hint. */
export const KIND_LABEL_STUDENT = Object.freeze({
  feedback: 'About the option you chose last time',
  nudge: 'A nudge',
  strategy: 'A way in',
  worked: 'A worked step',
});

/** What staff read beside each step. */
export const STEP_LABEL_STAFF = Object.freeze({
  1: 'Hint 1: a nudge',
  2: 'Hint 2: a strategy',
  3: 'Hint 3: a worked step that stops short of the answer',
});

export const OFFLINE_NOTE = 'No hints or feedback were drafted: drafting them needs the AI model, and none is set up on this server. '
  + 'Write the ones you want by hand; students see yours as soon as you save them.';
export const DRAFT_NOTE = 'These are AI drafts. A student sees none of them until you approve it; edit any that needs it.';
export const STUDENT_NOTE = 'Each hint you open is noted with your answer, and your professor can see how many you used. '
  + 'A hint never gives the answer away; your result comes after you answer.';
/** A client attempt id, as hub_attempts and hub_hint_views take it (0026, 0029). */
const ATTEMPT_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const NEEDS_ATTEMPT_ID = 'Each question needs its own attempt id from the device, the one its answer will carry: '
  + '8 to 64 letters, digits, - or _.';
export const ANSWERED = 'That question is answered already, so its hints are closed. Your result is with your answer.';
export const OTHER_QUESTION = 'That attempt is for another question. Each question you answer has its own hints.';
export const NO_HINTS_HERE = (mode) => (mode === 'exam'
  ? 'No hints in a self-test: it shows what you can do on your own.'
  : mode === 'getready'
    ? 'No hints in Get Ready: it checks what you know now, so your path fits you.'
    : 'Hints are offered in practice, review sets and lessons.');
export const IN_SELF_TEST = 'That question is on a self-test you have not handed in yet, so its hints stay closed until you hand it in.';

/* -------------------------------------------------------- the leak check -- */

/** Text as compared: compatibility forms folded, lower case, every run of non-letters, marks and digits one space. */
const norm = (v) => String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (v, max = 60) => {
  const t = collapse(v);
  return `"${t.length > max ? `${t.slice(0, max - 3)}...` : t}"`;
};
const list = (v) => (Array.isArray(v) ? v : []);

/** Does the normalised text hold this phrase as whole words? */
const holds = (hay, phrase) => {
  const p = norm(phrase);
  return Boolean(p) && ` ${hay} `.includes(` ${p} `);
};

/** Words that state a result: "is 42", "= 42", "answer 42", "gives 42". */
const STATING = ['is', 'are', 'was', 'were', 'be', 'equals', 'equal', 'gives', 'give', 'get', 'gets', 'makes', 'make',
  'comes to', 'answer', 'answer is', 'result', 'result is', 'total', 'has', 'have'];

/**
 * Does the text STATE this phrase as a result? Used where the phrase is in the
 * question itself (a number in the stem, an option the stem names): mentioning
 * it there tells the student nothing new, saying it is the answer does.
 */
function states(text, phrase) {
  const p = norm(phrase);
  if (!p) return false;
  const flat = norm(String(text ?? '').replace(/=/g, ' equals '));
  return new RegExp(`(?:^| )(?:${STATING.map(escapeRe).join('|')}) ${escapeRe(p)}(?= |$)`).test(flat);
}

/** What the student sees besides the options: the stem and a passage, as written and as compared. */
const visibleRaw = (q) => `${q?.text ?? ''} ${q?.stimulus?.kind === 'passage' ? q.stimulus.text ?? '' : ''}`;
const visibleText = (q) => norm(visibleRaw(q));

/** The key phrase in the hint: stated, if the question shows it anyway; held as words otherwise. */
function names(q, text, hay, phrase) {
  return holds(visibleText(q), phrase) ? states(text, phrase) : holds(hay, phrase);
}

/** "option B", "choice 2", "(B)", "B)": a pointer at the option in this position. */
function pointsAt(text, idx) {
  const letter = 'ABCDEF'[idx];
  if (!letter) return false;
  const n = idx + 1;
  const word = new RegExp(`\\b(?:option|choice|alternative|answer|ans)\\s*(?:is\\s*|was\\s*|no\\.?\\s*|number\\s*)?[:#-]?\\s*\\(?\\s*(?:${letter}|${letter.toLowerCase()}|${n})\\s*\\)?(?![\\p{L}\\p{N}])`, 'iu');
  return word.test(text) || new RegExp(`\\(\\s*${letter}\\s*\\)`).test(text) || new RegExp(`(?:^|\\s)${letter}\\)`).test(text);
}

/** The hint's words, with every OTHER option that contains the key's words taken out ("TCP and UDP" when the key is "TCP"). */
function withoutOthers(hay, key, options) {
  const k = norm(key);
  let out = ` ${hay} `;
  for (const o of options) {
    const n = norm(o);
    if (n && n !== k && ` ${n} `.includes(` ${k} `)) out = out.split(` ${n} `).join(' ');
  }
  return out.trim();
}

/** Does the text hold this phrase character for character (case and runs of space aside), not glued to a letter or digit? */
function holdsExactly(text, phrase) {
  const t = collapse(text).toLowerCase();
  const p = collapse(phrase).toLowerCase();
  if (!p) return false;
  const glued = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c);
  for (let i = t.indexOf(p); i >= 0; i = t.indexOf(p, i + 1)) {
    if (!glued(t[i - 1]) && !glued(t[i + p.length])) return true;
  }
  return false;
}

/**
 * Does the text name this option? By its words, unless another option has the
 * same words and differs only in symbols ("x+1" and "x-1", "{1, 2}" and
 * "(1, 2)"): then by its exact characters, or every hint naming either would be
 * refused.
 */
function namesOption(q, text, hay, key, options) {
  const k = norm(key);
  if (options.some((o) => o !== key && norm(o) === k)) return holdsExactly(text, key);
  return names(q, text, withoutOthers(hay, key, options), key);
}

/** The words before a match say it is a question, not a claim: "check whether the claim is true". */
const ASKING = new Set(['whether', 'if', 'check', 'decide', 'ask']);

/**
 * Does this text hold the question's answer? Null when it does not; otherwise
 * { id, message }, the message saying what it gives away, in a professor's words.
 * Pure. For every kind with an answer; a poll has none, and a grid's answer is
 * a pattern of ticks no sentence can quote, so neither is checked.
 */
export function answerLeak(q, raw) {
  const text = String(raw ?? '');
  const hay = norm(text);
  if (!hay || !q) return null;
  const leak = (id, message) => ({ id, message: `It gives the answer away: ${message}` });
  const kind = q.kind ?? 'mcq';
  const options = list(q.options).map(String);

  const optionLeak = (idxs) => {
    for (const i of idxs) {
      const key = options[i];
      if (key !== undefined && namesOption(q, text, hay, key, options)) return leak('key-text', `it names the right option, ${quote(key)}.`);
      if (pointsAt(text, i)) return leak('key-letter', `it points at the right option by its letter (${'ABCDEF'[i]}) or number (${i + 1}).`);
    }
    return null;
  };

  switch (kind) {
    case 'mcq':
      return Number.isInteger(q.answerIdx) ? optionLeak([q.answerIdx]) : null;
    case 'multi':
      return optionLeak(list(q.answerIdxs).filter(Number.isInteger));
    case 'truefalse': {
      if (typeof q.answerBool !== 'boolean') return null;
      const word = q.answerBool ? 'true' : 'false';
      const says = leak('key-claim', `it says the statement is ${word}.`);
      if (hay === word || new RegExp(`(?:^| )answer (?:is )?${word}(?= |$)`).test(hay)) return says;
      // A claim, with its verb: "this is true", "the statement is true", "it's true".
      // "Is this true for n = 0?" asks, and is left alone.
      const re = new RegExp(`(?:^| )(?:(?:(?:the )?statement|it|this|that|(?:the )?claim) (?:is|would be|must be)|it s) ${word}(?= |$)`, 'g');
      for (const m of hay.matchAll(re)) {
        const before = hay.slice(0, m.index).split(' ').slice(-4);
        if (!before.some((w) => ASKING.has(w))) return says;
      }
      return null;
    }
    case 'numeric': {
      const v = Number(q.value);
      if (!Number.isFinite(v)) return null;
      const tol = Math.max(0, Number(q.tolerance) || 0) + 1e-9 * Math.max(1, Math.abs(v));
      const shown = numbersIn(visibleRaw(q)).map(Number).some((x) => Math.abs(x - Math.abs(v)) <= tol);
      const said = (numbersIn(text).map(Number)).find((x) => Math.abs(x - Math.abs(v)) <= tol);
      if (said === undefined) return null;
      // A number the question itself shows may be named; stated as the result, it may not.
      if (shown && !states(text, String(said)) && !states(text, String(v))) return null;
      return leak('key-value', `it holds the answer's value, ${q.value}${q.unit ? ` ${q.unit}` : ''}.`);
    }
    case 'blank':
    case 'cloze':
    case 'table': {
      const accepted = kind === 'blank' ? list(q.accept)
        : kind === 'cloze' ? list(q.blanks).flatMap((b) => list(b?.accept))
          : list(q.rows).flatMap((r) => list(r?.cells).flatMap((c) => list(c?.accept)));
      const hit = accepted.find((a) => names(q, text, hay, a));
      return hit === undefined ? null : leak('key-text', `it holds an accepted answer, ${quote(hit)}.`);
    }
    case 'dropdown': {
      const hit = list(q.blanks).map((b) => list(b?.options)[b?.answerIdx]).find((a) => a !== undefined && names(q, text, hay, a));
      return hit === undefined ? null : leak('key-text', `it names a right choice, ${quote(hit)}.`);
    }
    case 'match': {
      const pair = list(q.pairs).find((p) => p && holds(hay, p.left) && holds(hay, p.right));
      return pair ? leak('pair', `it pairs ${quote(pair.left)} with ${quote(pair.right)}.`) : null;
    }
    case 'categorise': {
      for (const b of list(q.buckets)) {
        const item = list(b?.items).find((it) => holds(hay, it) && holds(hay, b.name));
        if (item !== undefined) return leak('group', `it puts ${quote(item)} in ${quote(b.name)}.`);
      }
      return null;
    }
    case 'order':
    case 'rank': {
      const seq = list(q.sequence);
      if (seq.length < 2) return null;
      const at = seq.map((s) => ` ${hay} `.indexOf(` ${norm(s)} `));
      return at.every((p, i) => p >= 0 && (i === 0 || p > at[i - 1])) ? leak('order', 'it lists every item in the right order.') : null;
    }
    case 'hottext': {
      const keys = list(q.answerIdxs).map((i) => list(q.tokens)[i]).filter((t) => norm(t).length >= 3);
      return keys.length && keys.every((t) => holds(hay, t)) ? leak('tokens', 'it names the words to pick.') : null;
    }
    case 'open': {
      const point = list(q.rubric).find((p) => norm(p).length >= 12 && holds(hay, p));
      return point === undefined ? null : leak('rubric', `it quotes a point the answer is marked on, ${quote(point)}.`);
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------- what is stored -- */

const tidy = (v) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[ \t\f\v]+/g, ' ').replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n').trim();

/**
 * A professor's hint or feedback as stored, or the 400 that says what to send.
 * `what` is 'hint' or 'feedback'. Refused when it holds the answer, with why.
 */
export function tutorText(raw, question, what = 'hint') {
  const noun = what === 'hint' ? 'hint' : 'feedback';
  if (typeof raw !== 'string' || !tidy(raw)) {
    throw fail(what === 'hint' ? 'Write the hint: what helps a student who is stuck, without the answer.'
      : 'Write the feedback: what a student who chose this option most likely confused, and what to look at again.', 400);
  }
  const text = tidy(raw);
  if (text.length > MAX_TEXT) throw fail(`A ${noun} can be at most ${MAX_TEXT} characters.`, 400);
  if (holdsContact(text)) throw fail(`The ${noun} holds an email address or a phone number; leave those out.`, 400);
  const leak = answerLeak(question, text);
  if (leak) throw fail(`This ${noun} was not saved. ${leak.message} Rewrite it so it helps without giving the answer.`, 400);
  return text;
}

/** Slide numbers a professor sent: whole numbers 1 to 999, each once, in order; or 400. Undefined when none were sent. */
export function slidesFrom(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw) || raw.length > 50 || !raw.every((n) => Number.isInteger(n) && n >= 1 && n <= 999)) {
    throw fail('Name the slides as a list of slide numbers, such as 3 and 4.', 400);
  }
  return [...new Set(raw)].sort((a, b) => a - b);
}

/** The slides a question's hints cite by default: its own, else its topic's. */
export function defaultSlides(question, content) {
  const own = list(question?.sourceRef?.slides).filter((n) => Number.isInteger(n) && n > 0);
  return own.length ? [...new Set(own)].sort((a, b) => a - b) : slidesOfTopic(content, question?.topic ?? '');
}

export const slidesRef = (slides) => (Array.isArray(slides) && slides.length ? { kind: 'slides', slides } : null);

/** An option's key, as feedback is stored and matched: its words, lower case, runs of space made one. */
export const optionKeyOf = textKey;

/**
 * The wrong options of a question that may carry feedback, in its own order:
 * [{ optionIdx, option, optionKey }]. Empty for a kind that takes none.
 */
export function feedbackOptions(question) {
  if (!FEEDBACK_KINDS.includes(question?.kind ?? 'mcq')) return [];
  const texts = optionTexts(question) ?? [];
  return wrongIdxs(question).map((i) => ({ optionIdx: i, option: texts[i], optionKey: optionKeyOf(texts[i]) }));
}

/** The wrong option a feedback row is on now, or null when its option was reworded, removed or made right. */
export function feedbackPlace(row, question) {
  return feedbackOptions(question).find((o) => o.optionKey === row?.optionKey) ?? null;
}

/**
 * The wrong options this attempt chose, by key, read from the attempt's own
 * snapshot (the question as the student saw it) and matched by their words to
 * the question's wrong options NOW. `seed` is the shuffle the student was shown
 * (the hub's one seed, hubSeed).
 */
export function chosenWrongKeys(question, attempt, seed = '') {
  const kind = question?.kind ?? 'mcq';
  if (!FEEDBACK_KINDS.includes(kind) || !attempt) return [];
  const snap = attempt.questionSnapshot && typeof attempt.questionSnapshot === 'object' ? attempt.questionSnapshot : {};
  const asked = { ...snap, kind: attempt.kind ?? snap.kind ?? kind };
  if (asked.kind !== kind) return [];
  const texts = optionTexts(asked) ?? [];
  const keep = Array.isArray(snap.shownOptions) ? snap.shownOptions : null;
  const orig = toOriginalResponse(asked, attempt.response, seed, keep);
  let picked;
  if (kind === 'truefalse') picked = orig === true ? ['True'] : orig === false ? ['False'] : [];
  else picked = (kind === 'mcq' ? (orig === null ? [] : [orig]) : list(orig)).map((i) => texts[i]).filter((t) => t !== undefined);
  const wrongNow = new Set(feedbackOptions(question).map((o) => o.optionKey));
  return [...new Set(picked.map(optionKeyOf))].filter((k) => wrongNow.has(k));
}

/**
 * The hints a student may be shown now: approved, steps 1 to 3, and not holding
 * the answer as the question stands now. [{ step, kind, id, row }], in step order.
 */
export function servableLadder(question, rows = []) {
  return rows
    .filter((h) => h.status === 'approved' && STEP_KINDS[h.step] && !answerLeak(question, h.text))
    .sort((a, b) => a.step - b.step)
    .map((h) => ({ step: h.step, kind: STEP_KINDS[h.step], id: String(h._id), row: h }));
}

/** The feedback a student may be shown now: approved, on a wrong option the question still has, not holding the answer. In option order. */
export function servableFeedback(question, rows = []) {
  return rows
    .map((f) => ({ f, place: f.status === 'approved' ? feedbackPlace(f, question) : null }))
    .filter(({ f, place }) => place && !answerLeak(question, f.text))
    .sort((a, b) => a.place.optionIdx - b.place.optionIdx)
    .map(({ f, place }) => ({ id: String(f._id), optionKey: place.optionKey, option: place.option, optionIdx: place.optionIdx, row: f }));
}

/* -------------------------------------------------------- which hint first -- */

const hintsWord = (n) => `${n} hint${n === 1 ? '' : 's'}`;

export const WHY = Object.freeze({
  feedback: 'Last time you chose an option your professor wrote a note about, so that note comes first.',
  question: (n) => `Last time you answered this question wrong after ${hintsWord(n)}, so the hints start further on.`,
  topic: 'Your last few answers on this topic were more often wrong than right, so the hints start with a way in.',
  state: 'From your answers on this topic so far, a way in is likely to help more than a nudge, so the hints start there.',
  deepest: 'The hints start with the most detailed one your professor wrote for this question.',
  plain: 'The hints start with a small nudge. Ask for the next one whenever you want it.',
  none: 'Your professor has not added hints to this question.',
});

/**
 * Which hints this attempt offers, in order (the header's rule). Pure.
 *
 * `ladder`: servableLadder(); `feedback`: servableFeedback(); `history`: the
 * student's own hub attempts on this question's topic (any modes: only
 * SEEN_MODES are read); `state`: their topic state (stateFrom), or null;
 * `seedOf(attempt)`: the shuffle an attempt was shown with.
 *
 * @returns {{ items: { kind, step?, id, option? }[], start: number, reasons: string[], why: string }}
 */
export function planHints({ question, ladder = [], feedback = [], history = [], state = null, seedOf = null } = {}) {
  const qid = lower(question?._id);
  const seen = history
    .filter((a) => SEEN_MODES.includes(a?.mode ?? 'practice') && typeof a?.correct === 'boolean')
    .sort(attemptOrder);
  const last = seen.filter((a) => lower(itemKeyOf(a)) === qid).at(-1) ?? null;
  const reasons = [];
  let start = 1;

  const usedLast = Math.max(0, Math.min(MAX_HINTS, Number(last?.hintsUsed) || 0));
  if (last && last.correct === false && usedLast > 0) {
    start = Math.max(start, Math.min(3, usedLast + 1));
    reasons.push('question');
  }
  const recent = seen.slice(-RECENT_TOPIC);
  if (recent.length >= MIN_RECENT && recent.filter((a) => a.correct === false).length * 2 > recent.length) {
    start = Math.max(start, 2);
    reasons.push('topic');
  }
  if (state && !state.provisional && Number.isFinite(state.pRight) && state.pRight < LOW_P) {
    start = Math.max(start, 2);
    reasons.push('state');
  }

  let first = null;
  if (last && last.correct === false && feedback.length) {
    const seed = seedOf ? seedOf(last) : hubSeed(last.accountId, itemKeyOf(last));
    const chosen = new Set(chosenWrongKeys(question, last, seed));
    first = feedback.find((f) => chosen.has(f.optionKey)) ?? null;
  }

  const steps = [...ladder].sort((a, b) => a.step - b.step);
  // Feedback first stands in for the nudge, so the ladder goes on from the strategy.
  const from = first ? Math.max(start, 2) : start;
  let rest = steps.filter((h) => h.step >= from);
  let deepest = false;
  if (!rest.length && steps.length) {
    rest = [steps[steps.length - 1]];
    deepest = !first;
  }
  const items = [
    ...(first ? [{ kind: 'feedback', id: first.id, option: first.option }] : []),
    ...rest.map((h) => ({ kind: h.kind, step: h.step, id: h.id })),
  ].slice(0, MAX_HINTS);

  let why;
  if (!items.length) why = WHY.none;
  else if (first) why = WHY.feedback;
  else if (deepest) why = WHY.deepest;
  else if (reasons.includes('question')) why = WHY.question(usedLast);
  else if (reasons.includes('topic') && rest[0]?.step > 1) why = WHY.topic;
  else if (reasons.includes('state') && rest[0]?.step > 1) why = WHY.state;
  else if (rest[0]?.step === 1) why = WHY.plain;
  else why = WHY.deepest;
  return { items, start, reasons: first ? ['feedback', ...reasons] : reasons, why };
}

/* ------------------------------------------------------------- the store -- */

/** A question's hint and feedback rows, every status. Without 0029's tables: none, said in the log. */
export async function tutorRowsOf(repo, questionIds = []) {
  const ids = questionIds.map(String);
  const [hints, feedback] = await Promise.all([repo.listQuestionHints(ids), repo.listOptionFeedback(ids)]);
  const by = (rows) => {
    const out = new Map();
    for (const r of rows) {
      const k = lower(r.questionId);
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(r);
    }
    return out;
  };
  return { hints: by(hints), feedback: by(feedback) };
}

/** One student's state on one topic, as practice works it out (H6); null when the topic is not theirs. */
export async function studentTopicState(repo, account, topicId) {
  const scope = await studentScope(repo, account);
  const entry = scope.topics.get(lower(topicId));
  if (!entry) return null;
  const model = (await topicModels(repo, [entry])).get(lower(entry.topic._id));
  return model ? stateFrom(model, account.id) : null;
}

/**
 * The plan for one student's next attempt at one question, from the store.
 * `topicId` names the topic whose attempts are read (the question's record).
 */
export async function planFor(repo, { account, question, topicId = null, state = null }) {
  const rows = await tutorRowsOf(repo, [String(question._id)]);
  const ladder = servableLadder(question, rows.hints.get(lower(question._id)) ?? []);
  const feedback = servableFeedback(question, rows.feedback.get(lower(question._id)) ?? []);
  if (!ladder.length && !feedback.length) return { items: [], start: 1, reasons: [], why: WHY.none, ladder, feedback };
  const history = await repo.listHubAttempts(topicId
    ? { accountId: String(account.id), topicIds: [String(topicId)] }
    : { accountId: String(account.id), questionIds: [String(question._id)] });
  return { ...planHints({ question, ladder, feedback, history, state }), ladder, feedback };
}

/**
 * Why the question's hints are closed to this student now (services/hubClosed.js),
 * or null. `closed` is the caller's set when it has one (a lesson reads it once
 * for all its questions); otherwise it is read for the question's chapter.
 */
async function closedReason(repo, account, question, { contentId = null, closed = null } = {}) {
  const set = closed ?? await closedQuestions(repo, account, { contentIds: [String(contentId ?? question.contentId ?? '')].filter(Boolean) });
  return set.get(lower(question._id)) ?? null;
}

/** What a student reads when a closed question's hints are asked for: the self-test's own sentence, or the reason's. */
const closedNote = (reason) => (reason === 'self-test' ? IN_SELF_TEST : CLOSED_SENTENCE[reason]);

/** What a student is told about the hints on offer for a question (the hint hook's payload). */
export async function hintsOfferedFor(repo, { account, question, topicId = null, mode = 'practice', state = null, closed = null }) {
  if (!HINT_MODES.includes(mode)) return { available: 0, note: NO_HINTS_HERE(mode) };
  if (!repo || !account?.id || !question?._id) return { available: 0, note: WHY.none };
  const reason = await closedReason(repo, account, question, { closed });
  if (reason) return { available: 0, note: closedNote(reason) };
  const plan = await planFor(repo, { account, question, topicId, state });
  if (!plan.items.length) return { available: 0, note: WHY.none };
  return { available: plan.items.length, note: STUDENT_NOTE };
}

/**
 * How many hints the student used on this question for this answer: 0 to 3.
 * Every hint opened on it since their previous answer to it, under any attempt
 * id (the header's rule), as distinct hints. Never in a self-test or Get Ready.
 */
export async function hintsUsedFor(repo, { account, questionId, attemptId, mode = 'practice' }) {
  if (!HINT_MODES.includes(mode)) return 0;
  if (!repo || !account?.id || !questionId || !ATTEMPT_ID.test(String(attemptId ?? ''))) return 0;
  const who = String(account.id);
  const qid = lower(questionId);
  // One after the other: a store that fails the first read leaves no second one running.
  const views = await repo.listHintViews({ accountId: who, questionIds: [qid] });
  if (!views.length) return 0;
  const answered = await repo.listHubAttempts({ accountId: who, questionIds: [qid] });
  const last = [...answered].sort(attemptOrder).pop();
  const since = last ? Date.parse(last.createdAt) : -Infinity;
  const counted = views.filter((v) => sameId(v.questionId, questionId)
    && (v.clientAttemptId === String(attemptId) || Date.parse(v.createdAt) > since));
  return Math.min(MAX_HINTS, new Set(counted.map((v) => `${v.kind}:${v.hintId ?? v.position}`)).size);
}

/* --------------------------------------------------------------- showing -- */

const BY_LABEL = Object.freeze({
  professor: 'Written by your professor.',
  ai: 'Written with AI help and checked by your professor.',
});

/** The translation kind and field a hint or feedback row is translated under (services/hubLanguages.js). */
const TRANSLATED = Object.freeze({ hint: 'hint', feedback: 'feedback' });

/**
 * The words of one hint or feedback row as this student is shown them: an
 * approved, current translation in their language when there is one AND it
 * holds no answer (the English was checked; a translation is other text), else
 * the English with a plain note.
 */
export async function shownWords(repo, { what, row, question, language = ORIGINAL }) {
  const kind = TRANSLATED[what];
  const t = (await servableTranslations(repo, { kind, items: [row], language })).get(lower(row._id)) ?? null;
  const words = t?.fields?.[kind];
  const usable = t && typeof words === 'string' && words.trim() && !answerLeak(question, words);
  return {
    text: usable ? words : row.text,
    language: shownLanguage({ kind, wanted: language, translation: usable ? t : null }),
  };
}

/** One hint view as a student reads it. Never a key, an explanation or a solution. */
export async function hintForStudent(view) {
  const slides = list(view.sourceRef?.slides);
  return {
    position: view.position,
    kind: view.kind,
    label: KIND_LABEL_STUDENT[view.kind] ?? 'A hint',
    text: view.text,
    html: (await richText(view.text)).html,
    cite: citeSlides(slides),
    by: view.provenance,
    byLabel: BY_LABEL[view.provenance] ?? BY_LABEL.professor,
    language: view.language ?? ORIGINAL,
    ...(view.languageNote ? { languageNote: view.languageNote } : {}),
  };
}

/** Plan items not shown yet that can still be shown now. */
function stillOpen(plan, views, ladder, feedback) {
  const shown = new Set(views.map((v) => v.kind));
  return list(plan?.items).filter((it) => !shown.has(it.kind) && (it.kind === 'feedback'
    ? feedback.some((f) => f.id === String(it.id))
    : ladder.some((h) => h.step === KIND_STEP[it.kind])));
}

const ONE_AT_A_TIME = (n) => `Hints come one at a time: ask for hint ${n} next.`;
export const LAST_HINT = 'That was the last hint for this question. Try your answer now.';

/**
 * The hints already opened for this attempt at this question, as a student
 * reads them (for a screen that reloads), and how many more there are.
 */
export async function shownHints(repo, { account, question, topicId = null, attemptId, state = null }) {
  if (!ATTEMPT_ID.test(String(attemptId ?? ''))) throw fail(NEEDS_ATTEMPT_ID, 400);
  const views = (await repo.listHintViews({ accountId: String(account.id), clientAttemptId: String(attemptId) }))
    .filter((v) => sameId(v.questionId, question._id))
    .sort((a, b) => a.position - b.position);
  const plan = views.length ? views[0].plan : await planFor(repo, { account, question, topicId, state });
  const rows = await tutorRowsOf(repo, [String(question._id)]);
  const ladder = servableLadder(question, rows.hints.get(lower(question._id)) ?? []);
  const feedback = servableFeedback(question, rows.feedback.get(lower(question._id)) ?? []);
  return {
    hints: await Promise.all(views.map(hintForStudent)),
    hintsUsed: views.length,
    remaining: stillOpen(plan, views, ladder, feedback).length,
    why: plan?.why ?? WHY.none,
    note: STUDENT_NOTE,
  };
}

/**
 * Open the next hint (or hint `step`, 1 to 3) for this attempt at this question,
 * and record it (hub_hint_views). A hint already opened is returned again and
 * nothing new is recorded. Serialised per attempt, in this process.
 *
 * `question` must already be one this student may be served (the caller's
 * access rule); `state` is their topic state, or null.
 *
 * @returns {Promise<{ status: 200|201, body: object }>}
 */
export async function serveHint(repo, {
  account, question, topicId = null, contentId = null, mode = 'practice', attemptId, step = null, state = null, closed = null,
}) {
  if (!HINT_MODES.includes(mode)) throw fail(NO_HINTS_HERE(mode), 400);
  const id = String(attemptId ?? '').trim();
  if (!ATTEMPT_ID.test(id)) throw fail(NEEDS_ATTEMPT_ID, 400);
  if (step !== null && step !== undefined && !(Number.isInteger(step) && step >= 1 && step <= MAX_HINTS)) {
    throw fail(`Ask for hint 1, 2 or ${MAX_HINTS}, or leave the number out for the next one.`, 400);
  }
  const who = String(account.id);
  return withLock(`hint:${who}:${id}`, async () => {
    if (await repo.getHubAttemptByKey(who, id)) throw fail(ANSWERED, 409);
    const reason = await closedReason(repo, account, question, { contentId, closed });
    if (reason) throw fail(closedNote(reason), 409);
    const all = (await repo.listHintViews({ accountId: who, clientAttemptId: id })).sort((a, b) => a.position - b.position);
    if (all.some((v) => !sameId(v.questionId, question._id))) throw fail(OTHER_QUESTION, 409);
    const views = all;
    const wanted = step ?? views.length + 1;
    const reply = async (view, { duplicate, plan, remaining }) => ({
      hint: await hintForStudent(view),
      hintsUsed: Math.max(views.length, view.position),
      remaining,
      why: plan?.why ?? '',
      note: STUDENT_NOTE,
      duplicate,
    });

    const rows = await tutorRowsOf(repo, [String(question._id)]);
    const ladder = servableLadder(question, rows.hints.get(lower(question._id)) ?? []);
    const feedback = servableFeedback(question, rows.feedback.get(lower(question._id)) ?? []);

    if (wanted <= views.length) {
      const plan = views[0].plan;
      return { status: 200, body: await reply(views[wanted - 1], { duplicate: true, plan, remaining: stillOpen(plan, views, ladder, feedback).length }) };
    }
    if (wanted > views.length + 1) throw fail(ONE_AT_A_TIME(views.length + 1), 400);

    let plan = views.length ? views[0].plan : null;
    if (!plan) {
      const made = await planFor(repo, { account, question, topicId, state });
      plan = { items: made.items, start: made.start, reasons: made.reasons, why: made.why };
    }
    const open = stillOpen(plan, views, ladder, feedback);
    if (!open.length) {
      return {
        status: 200,
        body: {
          hint: null, hintsUsed: views.length, remaining: 0, why: plan.why,
          note: STUDENT_NOTE, message: views.length ? LAST_HINT : WHY.none, duplicate: false,
        },
      };
    }
    const next = open[0];
    const source = next.kind === 'feedback'
      ? feedback.find((f) => f.id === String(next.id)).row
      : ladder.find((h) => h.step === KIND_STEP[next.kind]).row;
    const language = await languageChoice(repo, account);
    const words = await shownWords(repo, { what: next.kind === 'feedback' ? 'feedback' : 'hint', row: source, question, language });
    const { view, duplicate } = await repo.addHintView({
      accountId: who,
      clientAttemptId: id,
      questionId: String(question._id),
      topicId: topicId ? String(topicId) : null,
      contentId: contentId ? String(contentId) : (question.contentId ? String(question.contentId) : null),
      mode,
      position: views.length + 1,
      kind: next.kind,
      hintId: String(source._id),
      text: words.text,
      provenance: source.provenance === 'ai' ? 'ai' : 'professor',
      language: words.language.language,
      translationId: words.language.translationId,
      sourceRef: source.sourceRef ?? null,
      plan,
    });
    const shownNow = [...views, view];
    return {
      status: duplicate ? 200 : 201,
      body: {
        ...(await reply({ ...view, languageNote: words.language.note }, { duplicate, plan, remaining: stillOpen(plan, shownNow, ladder, feedback).length })),
        hintsUsed: shownNow.length,
      },
    };
  });
}

/**
 * The approved feedback on the wrong option(s) an attempt chose, as the student
 * reads it after the attempt (and only then: the result comes with it).
 */
export async function optionFeedbackAfter(repo, { account, attempt }) {
  if (!attempt || attempt.correct === true || !FEEDBACK_KINDS.includes(attempt.kind ?? 'mcq')) return [];
  const qid = itemKeyOf(attempt);
  const question = qid ? await repo.getQuestion(qid).catch(() => null) : null;
  if (!question) return [];
  const rows = await repo.listOptionFeedback([String(question._id)]);
  const chosen = new Set(chosenWrongKeys(question, attempt, hubSeed(attempt.accountId, qid)));
  const servable = servableFeedback(question, rows).filter((f) => chosen.has(f.optionKey));
  if (!servable.length) return [];
  const language = await languageChoice(repo, account);
  return Promise.all(servable.map(async (f) => {
    const words = await shownWords(repo, { what: 'feedback', row: f.row, question, language });
    return {
      option: f.option,
      text: words.text,
      html: (await richText(words.text)).html,
      cite: citeSlides(list(f.row.sourceRef?.slides)),
      by: f.row.provenance,
      byLabel: BY_LABEL[f.row.provenance] ?? BY_LABEL.professor,
      language: words.language,
    };
  }));
}

/* ----------------------------------------------------------- staff views -- */

const STATUS_LABEL = (row) => {
  if (row.provenance === 'professor') return 'Written by the professor';
  return row.status === 'approved' ? 'Drafted by AI, approved by the professor' : 'AI draft: not shown to students until approved';
};

/** One hint as a staff screen gets it, with how often students opened it. */
export async function staffHintView(row, question, { opened = 0 } = {}) {
  const leak = answerLeak(question, row.text);
  return {
    id: String(row._id),
    step: row.step,
    kind: STEP_KINDS[row.step],
    label: STEP_LABEL_STAFF[row.step],
    text: row.text,
    textHtml: (await richText(row.text)).html,
    provenance: row.provenance,
    status: row.status,
    statusLabel: STATUS_LABEL(row),
    model: row.model ?? null,
    sourceRef: row.sourceRef ?? null,
    cite: citeSlides(list(row.sourceRef?.slides)),
    opened,
    ...(leak ? { leak: `Students are not shown this hint. ${leak.message} The question was changed after the hint was written; rewrite it.` } : {}),
    approvedAt: row.approvedAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/** One feedback row as a staff screen gets it: where it sits now, or why it no longer shows. */
export async function staffFeedbackView(row, question, { opened = 0 } = {}) {
  const place = feedbackPlace(row, question);
  const leak = answerLeak(question, row.text);
  return {
    id: String(row._id),
    optionIdx: place ? place.optionIdx : null,
    option: place ? place.option : row.option,
    text: row.text,
    textHtml: (await richText(row.text)).html,
    provenance: row.provenance,
    status: row.status,
    statusLabel: STATUS_LABEL(row),
    model: row.model ?? null,
    sourceRef: row.sourceRef ?? null,
    cite: citeSlides(list(row.sourceRef?.slides)),
    opened,
    applies: Boolean(place),
    ...(place ? {} : { note: 'This option was reworded, removed or made a right answer since, so students are not shown this feedback.' }),
    ...(leak ? { leak: `Students are not shown this feedback. ${leak.message} The question was changed after it was written; rewrite it.` } : {}),
    approvedAt: row.approvedAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

/**
 * A question's tutor as staff read it: its ladder (every status), each wrong
 * option with its feedback, feedback that no longer applies, and counts.
 * `views` are the hint views of this question (how often each was opened).
 */
export async function staffQuestionTutor(question, { hints = [], feedback = [], views = [] } = {}) {
  const openedOf = (id) => views.filter((v) => sameId(v.hintId, id)).length;
  const ladder = await Promise.all([...hints].sort((a, b) => a.step - b.step)
    .map((h) => staffHintView(h, question, { opened: openedOf(h._id) })));
  const fviews = await Promise.all(feedback.map((f) => staffFeedbackView(f, question, { opened: openedOf(f._id) })));
  const kind = question.kind ?? 'mcq';
  const options = feedbackOptions(question).map((o) => ({
    optionIdx: o.optionIdx,
    option: o.option,
    feedback: fviews.find((f) => f.applies && f.optionIdx === o.optionIdx) ?? null,
  }));
  const servedSteps = servableLadder(question, hints).map((h) => h.step);
  return {
    questionId: String(question._id),
    text: question.text,
    topic: question.topic ?? '',
    bloom: question.bloom,
    kind,
    kindLabel: KIND_LABEL[kind] ?? kind,
    status: question.status ?? 'active',
    hints: ladder,
    missingSteps: [1, 2, 3].filter((s) => !hints.some((h) => h.step === s)),
    takesFeedback: FEEDBACK_KINDS.includes(kind),
    options,
    noLongerShown: fviews.filter((f) => !f.applies),
    counts: {
      hints: { approved: hints.filter((h) => h.status === 'approved').length, draft: hints.filter((h) => h.status === 'draft').length },
      feedback: {
        approved: fviews.filter((f) => f.applies && f.status === 'approved').length,
        draft: fviews.filter((f) => f.applies && f.status === 'draft').length,
      },
      shownToStudents: servedSteps.length,
      opened: views.length,
    },
  };
}

/* ------------------------------------------------------------ the model -- */

/**
 * The model's input: each question with a short label, its topic, the slides it
 * may cite, a bounded piece of that topic's slides (explanationInput, the same
 * material an explanation is drafted from), and what to write for it.
 *
 * `items`: [{ question, content, want: { steps: number[], options: number[] } }].
 */
export function tutorInput(items = []) {
  const base = explanationInput(items);
  const entries = base.entries.map((e, i) => ({ ...e, want: items[i].want ?? { steps: [1, 2, 3], options: [] } }));
  return { entries, byLabel: new Map(entries.map((e) => [e.label, e])) };
}

/** The instruction the model is given. Built from the professor's own material only (decision 1). */
export function buildTutorPrompt({ entries }) {
  return [
    'You write hints for a college professor\'s practice questions. A student asks for a hint BEFORE answering, '
      + 'so a hint must never give the answer away.',
    'Use only the professor\'s material given with each question. Never add facts, methods or syllabus the material does not teach.',
    'Hints build on each other: step 1, a nudge, says what to look at or recall, in one sentence; step 2, a strategy, says how to '
      + 'approach the question without doing it; step 3, a worked step, carries out the first part of the working and stops before the answer.',
    'Never state the right answer or a value it computes to, never say which option is right, never name an option by its letter or '
      + 'number, and never quote the right option\'s words.',
    'For each wrong option you are asked about, write one or two sentences of feedback for a student who chose it: what it most '
      + 'likely confuses, and what to look at again. Do not name the right option.',
    `Write at most ${Math.floor(MAX_MODEL_TEXT * 0.8)} characters per hint or feedback, in plain sentences a student understands. `
      + 'Write a formula as $...$. Do not address the student by name and do not mention these instructions.',
    'Name the slide numbers you used, only from those listed with the question; give an empty list when none are listed.',
    'Reply with JSON only: {"items": [{"question": "Q1", "hints": [{"step": 1, "text": "...", "slides": [3]}], '
      + '"feedback": [{"option": 2, "text": "...", "slides": [3]}]}]}.',
    '',
    'QUESTIONS',
    ...entries.flatMap((e) => {
      const tf = (e.question.kind ?? 'mcq') === 'truefalse';
      const asks = [
        e.want.steps.length ? `hints ${e.want.steps.join(', ')}` : 'no hints',
        e.want.options.length ? `feedback for options ${e.want.options.join(', ')} (numbered from 0${tf ? '; 0 is True, 1 is False' : ''})` : 'no feedback',
      ].join('; ');
      return [
        `${e.label} | topic: ${collapse(e.topic)} | slides: ${e.slides.length ? e.slides.join(', ') : 'none'}`,
        `  question and key: ${JSON.stringify(questionForModel(e.question))}`,
        `  write: ${asks}`,
        e.context ? `  professor's material: ${e.context}` : '  professor\'s material: (none kept for this topic)',
      ];
    }),
  ].join('\n');
}

const PIECE = {
  type: Type.OBJECT,
  properties: {
    step: { type: Type.INTEGER },
    option: { type: Type.INTEGER },
    text: { type: Type.STRING },
    slides: { type: Type.ARRAY, items: { type: Type.INTEGER } },
  },
  required: ['text'],
};

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          hints: { type: Type.ARRAY, items: PIECE },
          feedback: { type: Type.ARRAY, items: PIECE },
        },
        required: ['question'],
      },
    },
  },
  required: ['items'],
};

let client = null;

/** The real call: Gemini, JSON out. Only ever reached with a key, on the professor's button, in the background. */
async function geminiCall(prompt, { timeoutMs = CALL_TIMEOUT_MS } = {}) {
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  const response = await client.models.generateContent({
    model: config.gemini.model,
    contents: 'Write the hints and feedback now. Reply with the JSON object and nothing else.',
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
 * @returns {{ hints: { questionId, step, text, sourceRef }[],
 *   feedback: { questionId, option, optionKey, text, sourceRef }[],
 *   skipped: { questionId, what, why }[] }}
 * @throws when the reply is not JSON holding a list of items
 */
export function parseTutorReply(text, { byLabel }) {
  let raw;
  try {
    raw = JSON.parse(stripFence(text));
  } catch {
    throw new Error('the model\'s reply was not JSON');
  }
  const items = Array.isArray(raw) ? raw : raw?.items;
  if (!Array.isArray(items)) throw new Error('the model\'s reply held no list of items');
  const hints = [];
  const feedback = [];
  const skipped = [];
  const done = new Set();

  const cleanPiece = (entry, piece, what) => {
    const body = typeof piece?.text === 'string' ? tidy(piece.text) : '';
    if (!body) return { why: 'it came with no text' };
    if (body.length > MAX_MODEL_TEXT) return { why: `it was longer than ${MAX_MODEL_TEXT} characters` };
    if (holdsContact(body)) return { why: 'it held an email address or a phone number' };
    const leak = answerLeak(entry.question, body);
    if (leak) return { why: `${what === 'hint' ? 'the hint' : 'the feedback'} gave the answer away (${leak.message.replace(/^It gives the answer away: /, '').replace(/\.$/, '')})` };
    const allowed = new Set(entry.slides);
    const cited = [...new Set(list(piece?.slides).filter((n) => Number.isInteger(n) && allowed.has(n)))].sort((a, b) => a - b);
    // The model read these slides' words; one that cites none of them still came from them.
    return { text: body, sourceRef: slidesRef(cited.length ? cited : entry.slides) };
  };

  for (const item of items) {
    const label = collapse(item?.question).toUpperCase();
    const entry = byLabel.get(label);
    if (!entry) {
      skipped.push({ questionId: null, what: 'question', why: 'it named a question that was not offered' });
      continue;
    }
    const questionId = String(entry.question._id);
    if (done.has(label)) {
      skipped.push({ questionId, what: 'question', why: 'it was written twice; the first was kept' });
      continue;
    }
    done.add(label);
    const steps = new Set();
    for (const h of list(item?.hints)) {
      const what = `hint ${h?.step ?? '?'}`;
      if (!Number.isInteger(h?.step) || !STEP_KINDS[h.step]) { skipped.push({ questionId, what: 'hint', why: 'it named a step other than 1, 2 or 3' }); continue; }
      if (!entry.want.steps.includes(h.step)) { skipped.push({ questionId, what, why: 'that step was not asked for (the question has one already)' }); continue; }
      if (steps.has(h.step)) { skipped.push({ questionId, what, why: 'it was written twice; the first was kept' }); continue; }
      const got = cleanPiece(entry, h, 'hint');
      if (got.why) { skipped.push({ questionId, what, why: got.why }); continue; }
      steps.add(h.step);
      hints.push({ questionId, step: h.step, text: got.text, sourceRef: got.sourceRef });
    }
    const places = new Map(feedbackOptions(entry.question).map((o) => [o.optionIdx, o]));
    const options = new Set();
    for (const f of list(item?.feedback)) {
      let i = f?.option;
      // A true/false question has one wrong answer, so the model may leave its number out.
      if ((entry.question.kind ?? 'mcq') === 'truefalse' && (i === undefined || i === null)) [i] = [...places.keys()];
      const what = `feedback on option ${Number.isInteger(i) ? i + 1 : '?'}`;
      if (!Number.isInteger(i) || !places.has(i)) { skipped.push({ questionId, what, why: 'it was not on a wrong option of the question' }); continue; }
      if (!entry.want.options.includes(i)) { skipped.push({ questionId, what, why: 'that option was not asked for (it has feedback already)' }); continue; }
      if (options.has(i)) { skipped.push({ questionId, what, why: 'it was written twice; the first was kept' }); continue; }
      const got = cleanPiece(entry, f, 'feedback');
      if (got.why) { skipped.push({ questionId, what, why: got.why }); continue; }
      options.add(i);
      const place = places.get(i);
      feedback.push({ questionId, option: place.option, optionKey: place.optionKey, text: got.text, sourceRef: got.sourceRef });
    }
  }
  for (const e of byLabel.values()) {
    if (!done.has(e.label)) skipped.push({ questionId: String(e.question._id), what: 'question', why: 'the model wrote nothing for it' });
  }
  return { hints, feedback, skipped };
}

/**
 * Draft hints and feedback for these questions, BATCH at a time. With no key
 * (and no stand-in `callModel`) nothing is asked and nothing is drafted. Never
 * throws for a model problem: a failed batch is a warning, and the rest go on.
 *
 * @returns {Promise<{ source: 'llm'|'offline', model: string|null, hints, feedback, skipped, warnings: string[], note: string }>}
 */
export async function draftTutor({ items = [], callModel = null, onBatch = null } = {}) {
  if (!callModel && !hasGemini()) {
    return { source: 'offline', model: null, hints: [], feedback: [], skipped: [], warnings: [], note: OFFLINE_NOTE };
  }
  const out = { source: 'llm', model: callModel ? 'stand-in' : config.gemini.model, hints: [], feedback: [], skipped: [], warnings: [] };
  for (let i = 0; i < items.length; i += BATCH) {
    const input = tutorInput(items.slice(i, i + BATCH));
    try {
      const text = await (callModel ?? geminiCall)(buildTutorPrompt(input), { timeoutMs: CALL_TIMEOUT_MS });
      const parsed = parseTutorReply(text, input);
      out.hints.push(...parsed.hints);
      out.feedback.push(...parsed.feedback);
      out.skipped.push(...parsed.skipped);
    } catch (err) {
      out.warnings.push(`The model could not draft hints for ${input.entries.length === 1 ? 'one question' : `${input.entries.length} questions`}: ${err.message}.`);
      out.skipped.push(...input.entries.map((e) => ({ questionId: String(e.question._id), what: 'question', why: 'the model\'s reply could not be used' })));
    }
    if (onBatch) onBatch(Math.min(items.length, i + BATCH));
  }
  return {
    ...out,
    note: out.hints.length || out.feedback.length ? DRAFT_NOTE : 'The model drafted no hints or feedback for these questions.',
  };
}

/**
 * May the tutor draft for this question? Approved (a draft question may yet be
 * rejected, and its hints with it), not a poll (no answer to hint at), and no
 * uploaded image (the model cannot see it, and the hub does not serve such a
 * question yet). A reason, or null.
 */
export function cannotDraft(q) {
  if ((q?.status ?? 'active') !== 'active') return 'it is not approved yet';
  if ((q?.kind ?? 'mcq') === 'poll') return 'a poll has no answer to hint at';
  if (q?.stimulus?.kind === 'image') return 'it shows an uploaded image, which the model cannot see';
  return null;
}

/** What one question still lacks: the ladder's missing steps and the wrong options with no feedback. */
export function wantedFor(question, { hints = [], feedback = [] } = {}) {
  const steps = [1, 2, 3].filter((s) => !hints.some((h) => h.step === s));
  const have = new Set(feedback.map((f) => f.optionKey));
  const options = feedbackOptions(question).filter((o) => !have.has(o.optionKey)).map((o) => o.optionIdx);
  return { steps, options };
}

/**
 * Draft what these questions lack and store each piece as an AI draft. A piece
 * written meanwhile (by the professor, or another press) is kept, and the draft
 * for it skipped. `items`: [{ question, content }].
 *
 * @returns {Promise<{ written: number, source, model, skipped, warnings, note }>}
 */
export async function writeTutorDrafts(repo, { items = [], viewer = null, callModel = null, onBatch = null } = {}) {
  const rows = await tutorRowsOf(repo, items.map((it) => String(it.question._id)));
  const asked = items
    .map((it) => ({ ...it, want: wantedFor(it.question, { hints: rows.hints.get(lower(it.question._id)) ?? [], feedback: rows.feedback.get(lower(it.question._id)) ?? [] }) }))
    .filter((it) => it.want.steps.length || it.want.options.length);
  const out = await draftTutor({ items: asked, callModel, onBatch });
  const skipped = [...out.skipped];
  let written = 0;
  const keep = async (write, questionId, what) => {
    try {
      await write();
      written += 1;
    } catch (err) {
      if (err.status !== 409) throw err;
      skipped.push({ questionId, what, why: 'one was written for it meanwhile, and is kept' });
    }
  };
  for (const h of out.hints) {
    await keep(() => repo.addQuestionHint({
      questionId: h.questionId, step: h.step, text: h.text, provenance: 'ai', status: 'draft', model: out.model, sourceRef: h.sourceRef, createdBy: viewer?.id ?? null,
    }), h.questionId, `hint ${h.step}`);
  }
  for (const f of out.feedback) {
    await keep(() => repo.addOptionFeedback({
      questionId: f.questionId, option: f.option, optionKey: f.optionKey, text: f.text, provenance: 'ai', status: 'draft', model: out.model,
      sourceRef: f.sourceRef, createdBy: viewer?.id ?? null,
    }), f.questionId, `feedback on "${f.option}"`);
  }
  return { written, source: out.source, model: out.model, skipped, warnings: out.warnings, note: out.note };
}

/* ---------------------------------------------------------- translations -- */

// A hint and a feedback row are translated one by one, in the generic shape
// lessons and languages made (services/hubLanguages.js): each is an item named
// by its own id, whose one field ('hint' or 'feedback') is its words. A row
// rewritten after its translation was made puts that translation out of date
// (its hash), so it is not shown until it is brought up to date.
async function withChapter(repo, row) {
  if (!row) return null;
  const q = await repo.getQuestion(row.questionId).catch(() => null);
  return q ? { ...row, contentId: q.contentId } : null;
}

registerTranslatable('hint', {
  noun: 'hint',
  load: async (repo, id) => withChapter(repo, await repo.getQuestionHint(id).catch(() => null)),
  contentIdOf: (h) => h?.contentId,
  fields: (h) => (typeof h?.text === 'string' && h.text.trim() ? { hint: h.text } : {}),
  note: () => 'Never shown before it is approved, and never if it would give the answer away.',
});

registerTranslatable('feedback', {
  noun: 'note',
  load: async (repo, id) => withChapter(repo, await repo.getOptionFeedback(id).catch(() => null)),
  contentIdOf: (f) => f?.contentId,
  fields: (f) => (typeof f?.text === 'string' && f.text.trim() ? { feedback: f.text } : {}),
  note: () => 'Feedback on one wrong option. Never shown before it is approved, and never if it would give the answer away.',
});

/**
 * The hints and feedback of these questions (a chapter's approved ones) as
 * items to translate: every hint, and the feedback whose option still applies.
 */
export async function tutorTranslationItems(repo, questions = []) {
  if (!questions.length) return [];
  const byId = new Map(questions.map((q) => [lower(q._id), q]));
  const ids = questions.map((q) => String(q._id));
  const [hints, feedback] = await Promise.all([repo.listQuestionHints(ids), repo.listOptionFeedback(ids)]);
  const chapterOf = (r) => byId.get(lower(r.questionId))?.contentId;
  return [
    ...hints.map((h) => ({ kind: 'hint', item: { ...h, contentId: chapterOf(h) } })),
    ...feedback.filter((f) => feedbackPlace(f, byId.get(lower(f.questionId))))
      .map((f) => ({ kind: 'feedback', item: { ...f, contentId: chapterOf(f) } })),
  ];
}
