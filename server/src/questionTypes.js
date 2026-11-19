// Question kinds, and the rule that makes them worth having.
//
// Wayground and its peers offer twenty-odd question types, but the type is a
// property of the QUESTION, chosen by the teacher and independent of any
// cognitive framework - so a Remember item and an Analyse item both end up as
// "tap one of four", and the taxonomy becomes a label rather than a mechanism.
//
// Here the interaction is chosen BY THE LEVEL, because Krathwohl's verbs already
// name the interaction: "classify" is a sorting task, "differentiate" is a
// multi-select, "rank/justify" is an ordering task, "design" is open response.
// Since each student's level differs, the interaction differs per student too -
// two phones in one room show different KINDS of thinking, not just different
// wording.
//
// Each level now offers a SET rather than a single kind. That is the one change
// that lets a teacher say "ask Understand as sorting this time, not matching"
// without breaking the thesis: everything in a level's set demands the same
// cognitive move, so swapping within it changes the surface and not the demand.
// Swapping ACROSS levels is the thing that would make the taxonomy decorative,
// and nothing here permits it.
//
// A question may also hang off a STIMULUS - a passage or an image - and that is
// deliberately not a kind. The competitor sells "Passage" as its own paid
// question type, which quietly fixes the ratio at one passage to one question:
// the reading is consumed by a single item at a single depth. Here any kind may
// carry one, so the same passage can hold an mcq at Remember, a hottext at
// Analyse and an open response at Create - one reading, assessed at three
// depths. A stimulus is context, never content: it is validated, it reaches the
// phone, and it may never carry an answer.
//
// One kind - poll - assesses nothing at all, and the honest way to represent
// that is spelled out at UNGRADED_KINDS rather than by giving it a level it
// does not have.
//
// Everything in this file is pure: no I/O, no framework, fully unit-testable,
// and the live loop calls it on every answer. The one exception is
// readyToMark() (Batch 8), which waits for the drawing engines to load.

import crypto from 'node:crypto';

import { LEVELS } from './bloom.js';
import { secretFor } from './secrets.js';
// One string, imported rather than retyped. A misspelling of this key would not
// throw anywhere at all - it would simply stop reducing, silently, for every
// student who had been given the support.
import { FEWER_CHOICES } from './accommodations.js';
// Figures (Batch 8): the spec check is pure; the drawing is synchronous once the
// engines have loaded, which the server does before it listens.
import { specReason, normaliseSpec, emptyGraph, EMPTY_GRAPH } from './figures/spec.js';
import {
  engineReason, enginesReady, figureForStudent, loadFigureEngines, needsEngine,
} from './figures/index.js';
// The five interaction kinds (Batch 8) read their figure through this: the parts
// to tap or label under per-student tokens, the grids, and the marking.
import {
  boardOf, idOn, drawnLabel, LABEL_FIGURES, tokensFor, zonesFor, plotGrid, numberlineGrid,
  plotKeyReason, gradePlot, plotSolution, MAX_PLOT_POINTS, lineKeyReason, gradeNumberline, barsReason, gradeChart,
} from './figures/interact.js';

export const KINDS = [
  'mcq',        // choose one of four
  'truefalse',  // is this claim true
  'match',      // pair each term with its meaning
  'categorise', // drop each item into the right bucket
  'blank',      // produce the missing word
  'cloze',      // produce several missing words in one passage
  'numeric',    // compute a value, within a tolerance
  'multi',      // choose all that hold
  'order',      // put these in sequence
  'rank',       // order them against a stated criterion
  'open',       // write an answer against a rubric
  'hottext',    // pick the words in a sentence that do a stated job
  'dropdown',   // choose the right word for each gap in a passage
  'table',      // complete the empty cells of a grid
  'grid',       // tick every true row-column intersection
  'poll',       // ungraded: what does the room think
  // Batch 8: interactions on a figure the server draws, or a professor's picture.
  'hotspot',    // tap the right part(s) of a figure or picture
  'label',      // drag labels onto the parts they name
  'plot',       // place points, or a line, on a graph
  'numberline', // mark points, intervals or rays on a number line
  'chart',      // set the height of each bar
  // Batch 9 (decision E4): a whiteboard answer, never marked by the machine.
  'drawing',    // draw the answer, and perhaps add words to it
];

/**
 * The kind-specific fields a question may carry beyond text/options/answerIdx.
 *
 * Anything that persists or copies a question must carry these across. This list
 * is the single source of truth and is imported by the repositories and the
 * generate route rather than retyped - a second copy already went stale once and
 * silently dropped the payload of every non-mcq item on insert, so every match,
 * order, blank and open question arrived with nothing to answer.
 */
export const PAYLOAD_FIELDS = [
  'answerIdxs', 'pairs', 'sequence', 'accept', 'rubric',
  'answerBool', 'buckets', 'blanks', 'value', 'tolerance', 'unit', 'criterion',
  // Appended, never re-ordered: `tokens` is hottext's sentence, `columns` and
  // `rows` are shared by table and grid, `answers` is grid's truth matrix.
  // Four of the new kinds deliberately reuse a field that already exists -
  // hottext takes `answerIdxs`, dropdown takes `blanks`, table takes `accept`
  // inside its cells - because a second name for the same idea is how the
  // editor and the validator end up disagreeing about what a question holds.
  'tokens', 'columns', 'rows', 'answers',
  // Not answer-bearing, but it must travel with the question everywhere the
  // payload does, or a passage survives generation and vanishes on save.
  'stimulus',
  // Batch 8. Answer-bearing: hotspot's `answerIds` (the parts to tap), label's
  // `placements` (which label goes on which part), plot's `plotKey`, the number
  // line's `lineKey` and the bar heights in `values`. Not answer-bearing but
  // stored with them: label's `distractors` and the empty chart in `bars`.
  // numberline and chart reuse numeric's `tolerance`, for the same idea.
  'answerIds', 'placements', 'distractors', 'plotKey', 'lineKey', 'bars', 'values',
  // Batch 9. Not answer-bearing: an open question's `length` (short or long,
  // OPEN_LENGTHS) and whether a drawing question takes words beside the
  // drawing (`allowText`). A drawing's optional `rubric` is the reviewer's,
  // and reuses the open kind's field for the same idea.
  'length', 'allowText',
];

/**
 * Every interaction a level may legitimately be asked through.
 * First entry is the default, which is what KIND_FOR_LEVEL returns.
 */
export const KINDS_FOR_LEVEL = {
  // hotspot and label (Batch 8): pointing at the part a figure names, or putting
  // the names on the parts, is recognising - Remember - and reading what a part
  // of a figure means (tap where the population peaks) is interpreting, which is
  // Understand. Tapping the part that does not fit is Analyse, below.
  remember: ['mcq', 'truefalse', 'hotspot', 'label'],
  understand: ['match', 'categorise', 'hotspot', 'label'],
  // dropdown: the answer is produced in context, in a passage the student has to
  // hold together while they work - which is Apply and not Remember. It sits
  // beside cloze rather than below it because recognition is still available:
  // the words are on the screen, so it is the easiest interaction at this level
  // and the right one to swap a struggling class's cloze items into.
  // table: completing a grid IS executing a procedure repeatedly - each blank
  // cell is the same rule applied to a new row, which is exactly Krathwohl's
  // "execute". A given cell shows the rule; the blank ones demand it be used.
  // plot, numberline, chart (Batch 8): placing points, marking a solution set or
  // drawing the bars from a table is using a procedure on given values - Apply.
  // drawing (Batch 9, E4), last at each level it is in, so no level's default
  // changes: drawing a circuit, a structure or a flow from what was taught is
  // using it (Apply); drawing what relates to what is analysing it; marking up
  // a design with what is wrong in it is judging it (Evaluate); a drawing the
  // student designs is Create, where it belongs most. Never at Remember or
  // Understand: a picture copied from memory is recall through a slower screen.
  apply: ['blank', 'cloze', 'numeric', 'dropdown', 'table', 'plot', 'numberline', 'chart', 'drawing'],
  // hottext: picking out which words in a sentence do the work is
  // differentiation - separating the load-bearing parts from the surrounding
  // material. The student is not recalling the words, they are already on the
  // screen; they are deciding which of them matter, which is Analyse.
  // grid: a multi-select over a relation. Every intersection is a separate
  // "does this attribute belong to this case", so it is `multi` run across two
  // axes at once - the same attributing move, applied systematically. It is
  // marked differently from multi, though, and scoreOne() says why: the same
  // move over a whole matrix makes leaving a cell alone a judgement too.
  // hotspot: tap the step, point or part that does not fit - finding the error.
  analyse: ['multi', 'categorise', 'hottext', 'grid', 'hotspot', 'drawing'],
  evaluate: ['order', 'rank', 'drawing'],
  // plot at Create is a line drawn to conditions ("any line with a negative
  // slope through (1, 1)"): the student makes one of many right answers and the
  // server checks it by rule. The validator refuses a single right answer here.
  create: ['open', 'plot', 'drawing'],
};

/**
 * Kinds that ask something without assessing anything.
 *
 * `poll` appears in no level's set above, and that absence is the honest
 * representation of "it has no cognitive level" - not a placement, and not a
 * sixth-of-six fudge. KINDS_FOR_LEVEL answers one question: which interactions
 * legitimately ASSESS this level? A poll assesses nothing, so every answer is
 * "none of them", and listing it anywhere would be precisely the move this file
 * exists to refuse - a taxonomy label stuck on an item that does not earn it.
 *
 * Three consequences follow from the absence, and all three are wanted:
 *  - kindSuitsLevel('poll', *) is false, so a teacher can never SWAP an item
 *    into a poll and silently delete an assessment from their bank;
 *  - the generator walks levels through swapsFor(), so no poll is ever invented
 *    by a model - "how does the room feel about this" is the teacher's question
 *    to ask, not the LLM's to guess;
 *  - a poll is authored, not generated, and must be added by the route that
 *    creates items outright rather than by the edit path.
 *
 * A poll still carries a `bloom`, because the store requires one (models/index.js
 * has bloom as a required enum) and the selector pools by it. On a poll that tag
 * is POSITIONAL - where in the lesson the question sits - and never evaluative.
 * What stops it from being read as evidence is countsTowardMastery() below.
 */
export const UNGRADED_KINDS = ['poll'];

export const isUngraded = (kind) => UNGRADED_KINDS.includes(kind);

/**
 * May this item's result move a student's level? Read this BEFORE calling
 * mastery.applyAnswer().
 *
 * The mastery model consumes one field - `correct` - and it consumes it twice:
 * levels[bloom].correct/seen feeds overallAccuracy() and the below-40% band,
 * and the history entry feeds rollingAccuracy() at that level, which is what
 * promotes and demotes. A poll scores 1 and correct:true for every well-formed
 * answer, by design, so passing one through applyAnswer() would be handing out
 * a guaranteed right answer: three polls in a row is a promotion earned by
 * tapping anything at all, and the "why did this student get this set" sentence
 * a teacher is owed would cite evidence that never existed.
 *
 * So the poll's result never reaches the model. score() also stamps
 * `ungraded: true` on the result for the same reason, derived from this same
 * list so the two cannot drift; the caller needs only:
 *
 *     const graded = score(question, response, seed);
 *     if (countsTowardMastery(question)) applyAnswer(profile, { ...graded });
 *
 * The student is still shown their answer landed, the teacher still sees the
 * distribution - the item simply produces no evidence, because it collected
 * none.
 */
export const countsTowardMastery = (q) => !isUngraded(q?.kind ?? 'mcq');

/** The default interaction per level. */
export const KIND_FOR_LEVEL = Object.fromEntries(
  LEVELS.map((level) => [level, KINDS_FOR_LEVEL[level][0]]),
);

/**
 * How a level's questions are spread over its kinds when nobody has chosen, as
 * relative weights. A level asked through one kind only tests one surface: a
 * student who is good at spotting the answer among four, and nothing else,
 * looks like a Remember student. Spreading the level over the kinds in its own
 * set changes the surface and not the demand, which is the whole reason a level
 * offers a set (see KINDS_FOR_LEVEL).
 *
 * Every level that has two or more kinds gets at least two here. Create has one,
 * the written answer, and that is the rule this product follows rather than a
 * gap: picking from offered options never reaches Create (Crowe et al. 2008),
 * so no selected-response kind may ever carry that tag.
 *
 * Each level's first key is that level's default kind, and ties go to the
 * earlier key, so a one-question request (a regenerate, Harder, Easier) still
 * lands on the default exactly as before.
 *
 * Left out on purpose: numeric, because a chapter with no figures in it would
 * push the model into inventing one, and categorise at Analyse, which Understand
 * already asks. Both stay one choice away for a teacher who wants them.
 *
 * Left out for the same reason as numeric: the five kinds asked on a figure
 * (FIGURE_ASKED_KINDS). A chapter with no graph, chart or picture in it would
 * push the model into drawing one for its own sake. So Create, whose set now
 * also holds plot, is still spread over the written answer alone by default.
 *
 * Left out too: the drawing (Batch 9). Every one waits for a professor to mark
 * it, so how many a bank holds is the professor's choice, never a default.
 */
export const DEFAULT_KIND_MIX = {
  remember: { mcq: 2, truefalse: 1 },
  understand: { match: 1, categorise: 1 },
  apply: { blank: 1, cloze: 1, dropdown: 1, table: 1 },
  analyse: { multi: 1, hottext: 1, grid: 1 },
  evaluate: { order: 1, rank: 1 },
  create: { open: 1 },
};

export const LABEL = {
  mcq: 'Choose one',
  truefalse: 'True or false',
  match: 'Match the pairs',
  categorise: 'Sort into groups',
  blank: 'Fill in the blank',
  cloze: 'Complete the passage',
  numeric: 'Work out the value',
  multi: 'Choose all that apply',
  order: 'Put these in order',
  rank: 'Rank them',
  open: 'Write your answer',
  hottext: 'Pick the words',
  dropdown: 'Choose for each gap',
  table: 'Complete the table',
  grid: 'Tick every match',
  poll: 'Have your say',
  hotspot: 'Tap the part',
  label: 'Label the figure',
  plot: 'Plot on the graph',
  numberline: 'Mark the number line',
  chart: 'Draw the bars',
  drawing: 'Draw your answer',
};

/**
 * The two lengths of a written answer (Batch 9, decision E3): a short answer in
 * a small box, a long one in a large editor with a word count. A question with
 * no `length` is a short answer, which is every question written before the two
 * existed: none of them is rewritten, and none is marked differently, because
 * the rubric matcher reads the words and not the box.
 */
export const OPEN_LENGTHS = Object.freeze({
  short: Object.freeze({ maxWords: 60, label: 'Short answer' }),
  long: Object.freeze({ maxWords: 600, label: 'Long answer' }),
});
export const DEFAULT_OPEN_LENGTH = 'short';

/** An open question's length: 'short' unless it says 'long'. */
export const openLength = (q) => (q?.length === 'long' ? 'long' : DEFAULT_OPEN_LENGTH);

/** The most words a drawing's added text may hold: a long answer's, since words beside a drawing elaborate it. */
export const DRAWING_TEXT_WORDS = OPEN_LENGTHS.long.maxWords;

/**
 * A question's kind as a person reads it: the kind's label, and for a written
 * answer which of the two lengths it is. Every staff payload that labels a
 * question's kind uses this, so the editor, the bank, the label routes and the
 * tutor all say "Short answer" or "Long answer" alike.
 */
export const kindLabel = (q) => {
  const kind = q?.kind ?? 'mcq';
  if (kind === 'open') return OPEN_LENGTHS[openLength(q)].label;
  return LABEL[kind] ?? kind;
};

/** Words, as a person counts them: runs of anything but white space. */
export const wordCount = (text) => (String(text ?? '').match(/\S+/g) ?? []).length;

/**
 * Kinds the machine never marks (Batch 9): every answer waits for a professor's
 * review, and counts for nothing until it has one. Unlike a poll, such a
 * question does assess its level - the assessment is a person's.
 */
export const REVIEWED_KINDS = ['drawing'];
export const awaitsReview = (q) => REVIEWED_KINDS.includes(q?.kind ?? 'mcq');

/** The kinds asked on a figure or a picture (Batch 8): none is in DEFAULT_KIND_MIX, on purpose. */
export const FIGURE_ASKED_KINDS = ['hotspot', 'label', 'plot', 'numberline', 'chart'];

/** Which kinds a teacher may switch a question INTO, without changing its level. */
export const swapsFor = (level) => KINDS_FOR_LEVEL[level] ?? ['mcq'];

/** Is this kind honest about this level? Used by the editor and the validator. */
export const kindSuitsLevel = (kind, level) => (KINDS_FOR_LEVEL[level] ?? []).includes(kind);

/** How much of a partially-credited answer counts as "demonstrated". */
export const PASS_MARK = 0.7;

export const kindForLevel = (level) => KIND_FOR_LEVEL[level] ?? 'mcq';

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const uniq = (a) => new Set(a.map((s) => String(s).trim().toLowerCase())).size === a.length;
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const low = (v) => String(v ?? '').toLowerCase();

/** A figure stimulus's spec, normalised, when it is of this type; else null. */
function figureSpec(stimulus, type) {
  if (stimulus?.kind !== 'figure') return null;
  const { spec } = normaliseSpec(stimulus.spec);
  return spec?.type === type ? spec : null;
}

/** An optional tolerance: absent, or zero or more. */
const toleranceReason = (kind, t) => (t === undefined || t === null || (num(t) !== null && t >= 0) ? null : `${kind} tolerance must be zero or more`);

/**
 * The words of a rubric point the open-answer marker looks for. Exported so the
 * rule checks (services/checks.js) judge "can this point ever be found" by the
 * marker's own rule rather than a copy of it.
 */
export const rubricKeys = (point) => norm(point).split(' ').filter((w) => w.length > 3);

/** Blank markers, shared by blank and cloze so the two cannot disagree. */
export const BLANK_MARK = '____';
const blankCount = (text) => String(text ?? '').split(BLANK_MARK).length - 1;

// ----------------------------------------------------------------- stimulus

/**
 * What a stimulus may be. A new entry here needs a branch in both validators.
 * `figure` (Batch 8) is a JSON spec the server draws itself (src/figures): never
 * code and never an SVG from anyone, so it is checked key by key below.
 */
export const STIMULUS_KINDS = ['passage', 'image', 'figure'];

/** The keys a figure stimulus may carry: anything else, a ready-made picture included, is refused. */
const FIGURE_STIMULUS_KEYS = ['kind', 'spec', 'sourceRef'];

/**
 * Regions a professor marks on an image for later interactions: polygons in
 * percentages of the picture's width and height, each with a name and a label.
 * Teacher-side only for now (forStudent() leaves them out), since a label is
 * what a "tap the part" question would ask for.
 */
export const MAX_REGIONS = 24;
export const MAX_REGION_POINTS = 24;
const REGION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;

function regionsReason(regions) {
  if (regions === undefined || regions === null) return null;
  if (!Array.isArray(regions)) return 'an image\'s regions must be a list';
  if (regions.length > MAX_REGIONS) return `an image may have at most ${MAX_REGIONS} regions`;
  const seen = new Set();
  for (const [i, r] of regions.entries()) {
    const what = `region ${i + 1}`;
    if (!r || typeof r !== 'object' || Array.isArray(r)) return `${what} must be an object`;
    for (const k of Object.keys(r)) if (!['id', 'label', 'points'].includes(k)) return `${what} carries ${k}, which a region cannot use`;
    if (typeof r.id !== 'string' || !REGION_ID.test(r.id)) return `${what} needs a short name made of letters, digits, - or _`;
    if (seen.has(r.id.toLowerCase())) return `two regions are both called ${r.id}`;
    seen.add(r.id.toLowerCase());
    if (!str(r.label) || r.label.length > 60) return `${what} needs a label of at most 60 characters`;
    if (!Array.isArray(r.points) || r.points.length < 3 || r.points.length > MAX_REGION_POINTS) {
      return `${what} needs between 3 and ${MAX_REGION_POINTS} corners`;
    }
    for (const p of r.points) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100)) {
        return `each corner of ${what} is two percentages, across and down, from 0 to 100`;
      }
    }
  }
  return null;
}

/**
 * A passage long enough to be worth sharing between questions, and short enough
 * that it is not a textbook chapter pasted into a socket frame. Roughly 700
 * words - past that it stops being a stimulus and starts being the lesson.
 */
export const MAX_STIMULUS_TEXT = 4000;

/**
 * Where a stimulus was taken from, as the professor types it: "NCERT Biology
 * XI, ch. 13" or "Unit 3 slides 4-6". Optional, on a passage or an image.
 *
 * Text, unlike a question's own sourceRef ({kind: 'slides', slides}), because a
 * passage is pasted from anywhere (a textbook, a paper, the deck) and a citation
 * is read by a person, not matched by code. Teacher-side only: forStudent()
 * rebuilds the stimulus without it, since the phone has nowhere to show it yet.
 */
export const MAX_STIMULUS_SOURCE = 300;

/**
 * Anything but an absolute http(s) URL or a site-relative path. `javascript:`
 * and `data:` are the two that matter: a stimulus URL is rendered into an
 * attribute on every phone in the room, and the teacher who typed it is not
 * necessarily the person whose class it ends up in.
 */
const SAFE_URL = /^(?:https?:\/\/|\/)[^\s]+$/i;

/**
 * Is this a well-formed stimulus? Returns null when absent, because a stimulus
 * is optional on every kind - that optionality is the whole feature, since it
 * is what lets one passage carry several questions at different levels instead
 * of being locked to one paid "Passage" item.
 */
function stimulusReason(s) {
  if (s === undefined || s === null) return null;
  if (typeof s !== 'object' || Array.isArray(s)) return 'stimulus must be an object';
  if (!STIMULUS_KINDS.includes(s.kind)) return `stimulus kind must be ${STIMULUS_KINDS.join(' or ')}`;

  if (s.kind === 'passage') {
    if (!str(s.text)) return 'a passage stimulus needs text';
    if (String(s.text).length > MAX_STIMULUS_TEXT) return `stimulus text is over ${MAX_STIMULUS_TEXT} characters`;
  }

  if (s.kind === 'image') {
    if (!str(s.url)) return 'an image stimulus needs a url';
    if (!SAFE_URL.test(String(s.url).trim())) return 'stimulus url must be http(s) or a site-relative path';
    // Not politeness. A question whose subject is only in the picture is
    // unanswerable without this - the student using a screen reader gets the
    // stem, the options, and silence where the evidence should be.
    if (!str(s.alt)) return 'an image stimulus needs alt text describing it';
    const badRegions = regionsReason(s.regions);
    if (badRegions) return badRegions;
  }

  if (s.kind === 'figure') {
    for (const k of Object.keys(s)) {
      if (!FIGURE_STIMULUS_KEYS.includes(k)) return `a figure stimulus carries ${k}, which it cannot use: a figure is described by its spec and drawn by the server`;
    }
    const badSpec = specReason(s.spec) ?? engineReason(s.spec);
    if (badSpec) return badSpec;
  }

  // Empty is allowed and means "not given": a form's blank citation box.
  if (s.sourceRef !== undefined && s.sourceRef !== null) {
    if (typeof s.sourceRef !== 'string') return 'stimulus sourceRef must be text saying where it came from';
    if (s.sourceRef.length > MAX_STIMULUS_SOURCE) return `stimulus sourceRef is over ${MAX_STIMULUS_SOURCE} characters`;
  }

  // A stimulus is context, never content. Every payload field is answer-bearing
  // for some kind, so none of them may appear here - which also rules out a
  // stimulus nested inside a stimulus, since `stimulus` is itself in the list.
  for (const f of PAYLOAD_FIELDS) if (s[f] !== undefined) return `stimulus must not carry ${f}`;
  if (s.answerIdx !== undefined) return 'stimulus must not carry answerIdx';
  return null;
}

// ---------------------------------------------------------------- validation

/**
 * Is this a well-formed item of its kind? Generation rejects anything that
 * fails here and retries rather than patching, so nothing half-built is ever
 * stored or served.
 * @returns {string|null} the reason it is invalid, or null when it is fine
 */
export function invalidReason(q) {
  if (!q || typeof q !== 'object') return 'not an object';
  if (!str(q.text)) return 'missing text';
  if (!LEVELS.includes(q.bloom)) return `bad bloom "${q.bloom}"`;

  const kind = q.kind ?? 'mcq';
  if (!KINDS.includes(kind)) return `bad kind "${kind}"`;

  // Checked for every kind, before the kind's own rules, because a stimulus is
  // the one field that is not the property of any single kind.
  const badStimulus = stimulusReason(q.stimulus);
  if (badStimulus) return badStimulus;
  // Empty axes carry nothing to read; they are only the board a plot question
  // is answered on (figures/spec.js allows them for that).
  if (kind !== 'plot' && emptyGraph(figureSpec(q.stimulus, 'plot'))) return EMPTY_GRAPH;

  switch (kind) {
    case 'mcq': {
      if (!Array.isArray(q.options) || q.options.length !== 4) return 'mcq needs exactly 4 options';
      if (!q.options.every(str)) return 'mcq has an empty option';
      if (!uniq(q.options)) return 'mcq has duplicate options';
      if (!Number.isInteger(q.answerIdx) || q.answerIdx < 0 || q.answerIdx > 3) return 'mcq answerIdx out of range';
      return null;
    }

    case 'truefalse': {
      if (typeof q.answerBool !== 'boolean') return 'truefalse needs answerBool true or false';
      // A statement, not a question: "Is X true?" with a true/false answer reads
      // as a riddle. The generator is told this and the validator holds it.
      if (/\?\s*$/.test(q.text.trim())) return 'truefalse text must be a statement, not a question';
      return null;
    }

    case 'multi': {
      if (!Array.isArray(q.options) || q.options.length < 4 || q.options.length > 6) return 'multi needs 4-6 options';
      if (!q.options.every(str)) return 'multi has an empty option';
      if (!uniq(q.options)) return 'multi has duplicate options';
      if (!Array.isArray(q.answerIdxs) || q.answerIdxs.length < 2) return 'multi needs 2+ correct answers';
      if (q.answerIdxs.length >= q.options.length) return 'multi cannot have every option correct';
      if (!q.answerIdxs.every((i) => Number.isInteger(i) && i >= 0 && i < q.options.length)) return 'multi answerIdxs out of range';
      if (new Set(q.answerIdxs).size !== q.answerIdxs.length) return 'multi answerIdxs repeat';
      return null;
    }

    case 'match': {
      if (!Array.isArray(q.pairs) || q.pairs.length < 3 || q.pairs.length > 5) return 'match needs 3-5 pairs';
      if (!q.pairs.every((p) => p && str(p.left) && str(p.right))) return 'match pair missing a side';
      if (!uniq(q.pairs.map((p) => p.left)) || !uniq(q.pairs.map((p) => p.right))) return 'match has duplicate sides';
      return null;
    }

    case 'categorise': {
      if (!Array.isArray(q.buckets) || q.buckets.length < 2 || q.buckets.length > 4) return 'categorise needs 2-4 groups';
      if (!q.buckets.every((b) => b && str(b.name) && Array.isArray(b.items))) return 'categorise group missing a name or items';
      if (!uniq(q.buckets.map((b) => b.name))) return 'categorise has duplicate group names';
      // Every group must be reachable. An empty one is an answer nobody can give
      // and reads to a student as a mistake in the question.
      if (!q.buckets.every((b) => b.items.length >= 1)) return 'every categorise group needs at least one item';
      const items = q.buckets.flatMap((b) => b.items);
      if (items.length < 4 || items.length > 10) return 'categorise needs 4-10 items in total';
      if (!items.every(str)) return 'categorise has an empty item';
      if (!uniq(items)) return 'the same item appears in two categorise groups';
      return null;
    }

    case 'blank': {
      if (blankCount(q.text) !== 1) return `blank text needs exactly one ${BLANK_MARK} where the answer goes`;
      if (!Array.isArray(q.accept) || q.accept.length === 0) return 'blank needs accepted answers';
      if (!q.accept.every(str)) return 'blank has an empty accepted answer';
      return null;
    }

    case 'cloze': {
      const n = blankCount(q.text);
      if (n < 2 || n > 4) return `cloze needs 2-4 ${BLANK_MARK} markers in its text`;
      if (!Array.isArray(q.blanks) || q.blanks.length !== n) return 'cloze needs one blanks entry per marker';
      if (!q.blanks.every((b) => b && Array.isArray(b.accept) && b.accept.length && b.accept.every(str))) {
        return 'every cloze blank needs at least one accepted answer';
      }
      return null;
    }

    case 'numeric': {
      if (num(q.value) === null) return 'numeric needs a value';
      const tol = num(q.tolerance);
      if (tol === null || tol < 0) return 'numeric needs a tolerance of zero or more';
      if (q.unit !== undefined && q.unit !== null && typeof q.unit !== 'string') return 'numeric unit must be text';
      return null;
    }

    case 'order':
    case 'rank': {
      // `sequence` holds the items in their CORRECT order; the student sees them shuffled.
      if (!Array.isArray(q.sequence) || q.sequence.length < 3 || q.sequence.length > 5) return `${kind} needs 3-5 items`;
      if (!q.sequence.every(str)) return `${kind} has an empty item`;
      if (!uniq(q.sequence)) return `${kind} has duplicate items`;
      // Ranking without a stated criterion is not answerable - "put these in
      // order" by WHAT? order gets its order from the material; rank does not.
      if (kind === 'rank' && !str(q.criterion)) return 'rank needs a criterion to rank against';
      return null;
    }

    case 'open': {
      if (!Array.isArray(q.rubric) || q.rubric.length < 2 || q.rubric.length > 5) return 'open needs 2-5 rubric points';
      if (!q.rubric.every(str)) return 'open has an empty rubric point';
      // Absent is a short answer (Batch 9, E3), as every question before it.
      if (q.length !== undefined && q.length !== null && !Object.hasOwn(OPEN_LENGTHS, q.length)) {
        return `open length must be ${Object.keys(OPEN_LENGTHS).join(' or ')}`;
      }
      return null;
    }

    case 'drawing': {
      // The rubric is the reviewer's guide, never matched by the machine, so it
      // is optional; when given it is held to the open kind's shape.
      if (q.rubric !== undefined && q.rubric !== null) {
        if (!Array.isArray(q.rubric) || q.rubric.length > 5) return 'a drawing rubric is a list of up to 5 points for the reviewer';
        if (!q.rubric.every(str)) return 'a drawing has an empty rubric point';
      }
      if (q.allowText !== undefined && q.allowText !== null && typeof q.allowText !== 'boolean') {
        return 'a drawing allowText is true or false';
      }
      // A stimulus is optional, as on every kind: "draw the circuit in the
      // figure with the switch closed" carries one, "draw a cell" does not.
      return null;
    }

    case 'hottext': {
      if (!Array.isArray(q.tokens) || q.tokens.length < 3 || q.tokens.length > 40) return 'hottext needs 3-40 tokens';
      if (!q.tokens.every(str)) return 'hottext has an empty token';
      // No uniqueness check, unlike every other option-bearing kind: this is a
      // real sentence, and "the" appearing twice in it is not a fault. The two
      // are different targets at different positions, which is exactly why the
      // answer is a set of INDICES here rather than a set of words.
      if (!str(q.criterion)) return 'hottext needs a criterion saying which words to pick';
      if (!Array.isArray(q.answerIdxs) || q.answerIdxs.length < 1) return 'hottext needs at least one correct token';
      // One correct token is legitimate here where multi demands two ("select
      // the verb" is a fair question); every token correct is not, because
      // selecting all of them is then indistinguishable from not reading.
      if (q.answerIdxs.length >= q.tokens.length) return 'hottext cannot have every token correct';
      if (!q.answerIdxs.every((i) => Number.isInteger(i) && i >= 0 && i < q.tokens.length)) return 'hottext answerIdxs out of range';
      if (new Set(q.answerIdxs).size !== q.answerIdxs.length) return 'hottext answerIdxs repeat';
      return null;
    }

    case 'dropdown': {
      const n = blankCount(q.text);
      if (n < 2 || n > 4) return `dropdown needs 2-4 ${BLANK_MARK} markers in its text`;
      if (!Array.isArray(q.blanks) || q.blanks.length !== n) return 'dropdown needs one blanks entry per marker';
      for (const b of q.blanks) {
        if (!b || typeof b !== 'object') return 'a dropdown gap is not a gap';
        if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 5) return 'every dropdown gap needs 2-5 options';
        if (!b.options.every(str)) return 'a dropdown gap has an empty option';
        if (!uniq(b.options)) return 'a dropdown gap has duplicate options';
        if (!Number.isInteger(b.answerIdx) || b.answerIdx < 0 || b.answerIdx >= b.options.length) {
          return 'a dropdown gap has an answerIdx out of range';
        }
      }
      return null;
    }

    case 'table': {
      if (!Array.isArray(q.columns) || q.columns.length < 2 || q.columns.length > 4) return 'table needs 2-4 columns';
      if (!q.columns.every(str)) return 'table has an empty column heading';
      if (!uniq(q.columns)) return 'table has duplicate column headings';
      if (!Array.isArray(q.rows) || q.rows.length < 2 || q.rows.length > 6) return 'table needs 2-6 rows';
      if (!q.rows.every((r) => r && str(r.header))) return 'every table row needs a heading';
      if (!uniq(q.rows.map((r) => r.header))) return 'table has duplicate row headings';

      let blanks = 0;
      for (const r of q.rows) {
        if (!Array.isArray(r.cells) || r.cells.length !== q.columns.length) return 'every table row needs one cell per column';
        for (const c of r.cells) {
          if (!c || typeof c !== 'object' || Array.isArray(c)) return 'a table cell is not a cell';
          // Given XOR blank. A cell that is both shows the student the answer it
          // is about to mark them on; a cell that is neither renders as an empty
          // box that scores zero however it is filled.
          const isGiven = c.given !== undefined;
          const isBlank = c.accept !== undefined;
          if (isGiven === isBlank) return 'every table cell is either given or blank, never both and never neither';
          if (isGiven && !str(c.given)) return 'a given table cell is empty';
          if (isBlank) {
            if (!Array.isArray(c.accept) || c.accept.length === 0 || !c.accept.every(str)) {
              return 'every blank table cell needs at least one accepted answer';
            }
            blanks += 1;
          }
        }
      }
      if (blanks === 0) return 'a table with no blank cells has nothing to answer';
      // No matching floor on GIVEN cells on purpose: a table where every cell is
      // blank is still a fair question - the row and column headings carry the
      // pattern - and demanding a worked example would refuse it for no reason.
      return null;
    }

    case 'grid': {
      if (!Array.isArray(q.rows) || q.rows.length < 2 || q.rows.length > 6) return 'grid needs 2-6 rows';
      if (!q.rows.every(str)) return 'grid has an empty row label';
      if (!uniq(q.rows)) return 'grid has duplicate row labels';
      if (!Array.isArray(q.columns) || q.columns.length < 2 || q.columns.length > 5) return 'grid needs 2-5 columns';
      if (!q.columns.every(str)) return 'grid has an empty column label';
      if (!uniq(q.columns)) return 'grid has duplicate column labels';
      if (!Array.isArray(q.answers) || q.answers.length !== q.rows.length) return 'grid needs one answers row per row';
      if (!q.answers.every((r) => Array.isArray(r) && r.length === q.columns.length && r.every((v) => typeof v === 'boolean'))) {
        return 'every grid answers row needs one true or false per column';
      }
      const cells = q.rows.length * q.columns.length;
      const trues = q.answers.flat().filter(Boolean).length;
      if (trues === 0) return 'a grid with no true intersections has nothing to tick';
      // All-true is the grid version of multi's "cannot have every option
      // correct": ticking the whole board would score full marks without a
      // single discrimination being made.
      if (trues === cells) return 'a grid where every intersection is true asks nothing';
      return null;
    }

    case 'poll': {
      if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return 'poll needs 2-6 options';
      if (!q.options.every(str)) return 'poll has an empty option';
      if (!uniq(q.options)) return 'poll has duplicate options';
      // An answer key on an ungraded item is a contradiction, and a dangerous
      // one: it reads to every later maintainer as a thing that ought to be
      // marked, and the first person to "fix" score() by honouring it turns the
      // room's opinion into a wrong answer. Refuse it at the door.
      if (q.answerIdx !== undefined || q.answerIdxs !== undefined) return 'a poll has no correct answer, so it must carry none';
      return null;
    }

    case 'hotspot': {
      const board = boardOf(q.stimulus);
      if (!board) return 'hotspot needs a figure, or a picture with marked regions, to tap';
      if (!Array.isArray(q.answerIds) || q.answerIds.length < 1) return 'hotspot needs at least one right part to tap';
      if (!q.answerIds.every((id) => typeof id === 'string' && id)) return 'hotspot answerIds are the names of parts';
      if (new Set(q.answerIds.map(low)).size !== q.answerIds.length) return 'hotspot answerIds repeat';
      // A diagram or molecule before the engines load: its parts are not known
      // yet, and the save path waits for them (figures/index.js checkFigure).
      if (board.pending) return null;
      if (board.ids.length < 2) return `hotspot needs ${board.kind === 'image' ? 'a picture with at least two marked regions' : 'a figure with at least two parts'} to choose between`;
      if (!q.answerIds.every((id) => idOn(board, id))) return `hotspot names a part the ${board.kind === 'image' ? 'picture' : 'figure'} does not have`;
      // As hottext: tapping everything must not be the answer.
      if (q.answerIds.length >= board.ids.length) return 'hotspot cannot have every part right';
      return null;
    }

    case 'label': {
      const board = boardOf(q.stimulus);
      if (!board) return 'label needs a figure, or a picture with marked regions, to label';
      if (board.kind === 'figure' && !LABEL_FIGURES.includes(board.spec.type)) {
        return `label is asked on a ${LABEL_FIGURES.join(', ')} figure, or a picture with marked regions: other figures draw the names themselves`;
      }
      if (!Array.isArray(q.placements) || q.placements.length < 2 || q.placements.length > 8) return 'label needs 2-8 labels to place';
      if (!q.placements.every((p) => p && typeof p.target === 'string' && str(p.label) && p.label.length <= 60)) {
        return 'every label placement needs a part and a label of at most 60 characters';
      }
      if (q.distractors !== undefined && (!Array.isArray(q.distractors) || q.distractors.length > 3 || !q.distractors.every(str))) {
        return 'label may carry up to 3 extra labels that belong nowhere';
      }
      if (!uniq([...q.placements.map((p) => p.label), ...(q.distractors ?? [])])) return 'label has the same label twice';
      if (new Set(q.placements.map((p) => low(p.target))).size !== q.placements.length) return 'label puts two labels on one part';
      if (board.pending) return null;
      for (const p of q.placements) {
        if (!idOn(board, p.target)) return `label names a part the ${board.kind === 'image' ? 'picture' : 'figure'} does not have`;
        // The drawing would be showing the answer it asks for.
        if (board.kind === 'figure' && drawnLabel(board, p.target)) return 'the figure already labels a part the student is asked to label';
      }
      return null;
    }

    case 'plot': {
      const spec = figureSpec(q.stimulus, 'plot');
      if (!spec) return 'plot needs a graph to place on: a plot figure as its stimulus';
      return plotKeyReason(q.plotKey, spec, q.bloom);
    }

    case 'numberline': {
      const spec = figureSpec(q.stimulus, 'numberline');
      if (!spec) return 'numberline needs a number line to mark: a number-line figure as its stimulus';
      return toleranceReason('numberline', q.tolerance) ?? lineKeyReason(q.lineKey, spec, q.tolerance ?? null);
    }

    case 'chart': {
      const why = barsReason(q.bars, q.values) ?? toleranceReason('chart', q.tolerance);
      if (why) return why;
      // A bar or line chart of the same heights beside it would be the answer.
      const spec = figureSpec(q.stimulus, 'chart');
      if (spec?.series?.some((s) => s.values.length === q.values.length && s.values.every((v, i) => Math.abs(v - q.values[i]) < 1e-9))) {
        return 'the figure already draws the bars the student is asked to set';
      }
      return null;
    }

    default:
      return `unhandled kind ${kind}`;
  }
}

export const isValid = (q) => invalidReason(q) === null;

// ------------------------------------------------- what an answer may hold

/** An answer over a written question's word limit (Batch 9, E3), in the student's words. */
export const tooManyWords = (limit, got) => `Your answer has ${got} words, and this question takes at most ${limit}. `
  + 'Shorten it and send it again; nothing was saved.';

/** A drawing's answer that is not a drawing (Batch 9, E4). */
export const NOT_A_DRAWING = 'This question is answered with a drawing. Draw your answer and send it; nothing was saved.';
/** Words sent with a drawing on a question that takes the drawing alone. */
export const DRAWING_ONLY = 'This question asks for a drawing only, without words. Send the drawing on its own; nothing was saved.';

/**
 * Why this response may not be taken for this question, before anything is
 * marked or stored, or null. Only the Batch 9 kinds' limits: every other kind
 * takes whatever it is sent and marks it, as it always has.
 *
 *   open     at most the length's word limit (OPEN_LENGTHS)
 *   drawing  { mediaId, text? }: a media id, and words only when the question
 *            allows them, within DRAWING_TEXT_WORDS. Whether the media id is
 *            this sender's drawing for this question needs the store, and is
 *            asked by the caller (services/drawings.js drawingRefusal).
 */
export function responseProblem(q, response) {
  const kind = q?.kind ?? 'mcq';
  if (kind === 'open') {
    const limit = OPEN_LENGTHS[openLength(q)].maxWords;
    const got = wordCount(typeof response === 'string' ? response : '');
    return got > limit ? tooManyWords(limit, got) : null;
  }
  if (kind === 'drawing') {
    if (!response || typeof response !== 'object' || Array.isArray(response)) return NOT_A_DRAWING;
    if (typeof response.mediaId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(response.mediaId.trim())) return NOT_A_DRAWING;
    for (const k of Object.keys(response)) if (k !== 'mediaId' && k !== 'text') return NOT_A_DRAWING;
    return drawingTextProblem(q, response.text);
  }
  return null;
}

/**
 * Why the words sent with a drawing may not be taken, or null: none at all is
 * always fine; words only where the question allows them, within
 * DRAWING_TEXT_WORDS.
 */
export function drawingTextProblem(q, text) {
  if (text === undefined || text === null) return null;
  if (typeof text !== 'string') return NOT_A_DRAWING;
  const got = wordCount(text);
  if (!got) return null;
  if (q?.allowText !== true) return DRAWING_ONLY;
  return got > DRAWING_TEXT_WORDS ? tooManyWords(DRAWING_TEXT_WORDS, got) : null;
}

// ---------------------------------------------------------- reduced choices

/**
 * Which kinds a distractor can honestly be taken out of.
 *
 * Not `dropdown`, although it has options too: a gap already carries as few as
 * two, and the ones it carries are the grammar of the sentence rather than
 * padding. Not `poll`, emphatically - a poll's options are the positions the
 * room is being asked to hold, so removing one is not making a question easier,
 * it is deleting somebody's answer before they can give it.
 */
const REDUCIBLE_KINDS = ['mcq', 'multi'];

/** What a reduced mcq is cut down to: the answer, and one distractor. */
const MCQ_KEEP = 2;

/**
 * The fewest distractors a reduced `multi` may be left with.
 *
 * Derived from PASS_MARK rather than picked, because the number that matters is
 * the one at which the support would start handing out marks. selectionScore()
 * gives a student who ticks every option on the screen (k - d) / k, where k is
 * how many are correct and d how many distractors are left, so the blanket tick
 * stays under PASS_MARK exactly while d > k * (1 - PASS_MARK). Taking a
 * distractor below that line would turn "tick everything" into a demonstrated
 * level for the one student who was given a support to help them read.
 *
 * The same arithmetic run on the ORIGINAL question is why shownOptionIndices()
 * refuses to reduce at all when a question already sits under this line: a dense
 * multi (five correct of six) is already gameable, that is multi's own hole and
 * not this feature's, and a support must not be the thing that widens it.
 */
const minDistractors = (correct) => Math.floor(correct * (1 - PASS_MARK)) + 1;

/**
 * Which of a question's options this student is actually offered, as ORIGINAL
 * indices in the order they will appear - or null when the full set is shown,
 * which is the case for every student who has no accommodation and every kind
 * that has nothing to remove.
 *
 * Null is the whole safety story of this function. forStudent() and score() both
 * call it, and both fall straight back onto exactly the code they ran before
 * this existed the moment it returns null, so the unaccommodated path is not
 * merely equivalent to the old one - it IS the old one.
 *
 * Deterministic and recomputable, the same trick permFor() plays and for the same
 * reason: the server never has to remember which distractor it dropped, a
 * reconnect mid-question gets the identical two options back rather than a board
 * that rearranged under a half-finished answer, and the marking can rebuild the
 * mapping from the seed at the other end.
 *
 * Original order is preserved among the survivors. The options of an mcq are not
 * shuffled anywhere in this file, and starting now - only for the students with a
 * support - would make their screen visibly different from their neighbour's in
 * the one way that is easy to notice.
 */
export function shownOptionIndices(q, seed = '', accommodations = null) {
  if (accommodations?.[FEWER_CHOICES] !== true) return null;

  const kind = q?.kind ?? 'mcq';
  if (!REDUCIBLE_KINDS.includes(kind)) return null;

  const options = Array.isArray(q?.options) ? q.options : [];
  if (options.length === 0) return null;
  const all = options.map((_, i) => i);

  if (kind === 'mcq') {
    const answer = Number(q.answerIdx);
    // A malformed item is left exactly as it is. Reducing around an answerIdx
    // that points nowhere could drop the correct option and leave a question
    // nobody can get right - and only for the students given the support.
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
    const distractors = all.filter((i) => i !== answer);
    if (distractors.length <= MCQ_KEEP - 1) return null;
    const perm = permFor(distractors.length, `${seed}:fc`);
    const keep = perm.slice(0, MCQ_KEEP - 1).map((p) => distractors[p]);
    return [answer, ...keep].sort((a, b) => a - b);
  }

  // multi. Every correct option survives, always: dropping one would not make
  // the question easier, it would make the marked answer wrong.
  const want = new Set((Array.isArray(q.answerIdxs) ? q.answerIdxs : []).map(Number));
  const correct = all.filter((i) => want.has(i));
  const distractors = all.filter((i) => !want.has(i));
  if (correct.length === 0 || distractors.length === 0) return null;

  const floor = minDistractors(correct.length);
  const target = Math.max(floor, Math.ceil(distractors.length / 2));
  // Also the "already gameable" refusal described at minDistractors: when the
  // floor is at or above what the question started with, target >= distractors
  // and nothing is taken away.
  if (target >= distractors.length) return null;

  const perm = permFor(distractors.length, `${seed}:fc`);
  const keep = perm.slice(0, target).map((p) => distractors[p]);
  return [...correct, ...keep].sort((a, b) => a - b);
}

// ------------------------------------------------------------------- scoring

/**
 * The multi-select rule: credit for what was found, penalty for what was
 * over-claimed, clamped so picking everything cannot score full marks.
 *
 * Shared by multi and hottext because the two are one cognitive move - pick the
 * members of a set out of a list - wearing two interfaces. Two copies of this
 * arithmetic is how the two quietly stop agreeing about what half-right is
 * worth, and a student's level would then depend on which interface a teacher
 * happened to pick for the same question.
 *
 * grid is the same MOVE but not the same marking, and deliberately does not use
 * this - see its branch in scoreOne() for the two holes this rule leaves open
 * once every cell, rather than every pick, is a judgement.
 */
function selectionScore(want, got) {
  let hits = 0;
  let wrong = 0;
  got.forEach((k) => (want.has(k) ? (hits += 1) : (wrong += 1)));
  const raw = want.size === 0 ? 0 : (hits - wrong) / want.size;
  return { score: Math.max(0, Math.min(1, raw)), hits, wrong };
}

/** Adjacent-pair agreement: "almost right" is not zero, one slip is not fatal. */
function sequenceScore(got, n) {
  if (got.length !== n || new Set(got).size !== n) return null;
  let agree = 0;
  for (let i = 0; i < n - 1; i += 1) if (got[i] < got[i + 1]) agree += 1;
  return n < 2 ? 0 : agree / (n - 1);
}

/**
 * The per-kind marking itself. Wrapped by score() below; call that, not this.
 *
 * `keep` is shownOptionIndices()' answer for this student - null for everyone
 * whose options were not reduced, which is the path every branch below already
 * took before the support existed.
 */
function scoreOne(q, response, seed = '', keep = null) {
  const kind = q.kind ?? 'mcq';

  /** A position on the reduced screen, back to the option it really is. */
  const fromShown = (pos) => {
    if (!keep) return pos;
    return Number.isInteger(pos) && pos >= 0 && pos < keep.length ? keep[pos] : -1;
  };
  /** ...and the reverse, for an answer key the phone has to be able to read. */
  const toShown = (orig) => (keep ? keep.indexOf(orig) : orig);

  switch (kind) {
    case 'mcq': {
      // With fewer choices the phone was handed a shorter list and its index is
      // a position in THAT list, so it is translated back here - the same move
      // match, order and dropdown already make, for the same reason: the phone
      // was never told which option is which.
      const picked = fromShown(Number(response));
      const ok = Number.isInteger(picked) && picked === Number(q.answerIdx);
      // The solution goes back in SHOWN space too. An answer key in original
      // indices would highlight the wrong row on a screen that is missing two.
      return { score: ok ? 1 : 0, correct: ok, solution: toShown(Number(q.answerIdx)) };
    }

    case 'truefalse': {
      // Only a real boolean counts. A missing answer arriving as `false` would
      // otherwise score full marks on every statement that happens to be false.
      const ok = typeof response === 'boolean' && response === q.answerBool;
      return { score: ok ? 1 : 0, correct: ok, solution: q.answerBool };
    }

    case 'multi': {
      // `want` is untouched by a reduction: every correct option survives it by
      // construction, so the denominator selectionScore divides by is the same
      // number for an accommodated student as for anybody else, and half-right
      // is worth the same on both screens.
      const want = new Set(q.answerIdxs.map(Number));
      const sent = (Array.isArray(response) ? response : []).map(Number).filter((i) => Number.isInteger(i));
      // Only translated when there was a reduction, and only then are positions
      // off the end of the list dropped instead of penalised - a position that
      // does not exist on a shortened screen is a client bug rather than a
      // student's judgement, exactly as the grid branch argues below. Without a
      // reduction this is the same Set of the same numbers it always was.
      const got = new Set(keep ? sent.map(fromShown).filter((i) => i >= 0) : sent);
      // Credit for what they found, penalty for what they over-claimed. Picking
      // everything must not score full marks. The arithmetic moved to
      // selectionScore() unchanged, so hottext and grid mark identically.
      const { score: s } = selectionScore(want, got);
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: [...want].map(toShown).sort((a, b) => a - b),
      };
    }

    case 'match': {
      // response: array where index i is the SHOWN position of the right-hand
      // item chosen for left i. Translated back here, because the phone is no
      // longer told which original item it is looking at.
      const n = q.pairs.length;
      const got = toOriginal(Array.isArray(response) ? response : [], n, `${seed}:r`);
      let hits = 0;
      for (let i = 0; i < n; i += 1) if (got[i] === i) hits += 1;
      const s = n === 0 ? 0 : hits / n;
      // The solution goes back in SHOWN space too - the phone has no idea which
      // original item is which, so an answer key in original indices would be
      // unreadable to it. Safe to send: it only travels once the answer is in.
      const posOf = [];
      permFor(n, `${seed}:r`).forEach((orig, pos) => { posOf[orig] = pos; });
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: q.pairs.map((_, i) => posOf[i]),
        detail: `${hits}/${n} pairs`,
      };
    }

    case 'categorise': {
      // response: { itemIndex: bucketIndex }, keyed on the flattened item list
      // the student was shown. Partial credit per item placed correctly.
      const truth = [];
      q.buckets.forEach((b, bi) => b.items.forEach(() => truth.push(bi)));
      // Keys are SHOWN positions; map each back to the item it really is.
      const raw = response && typeof response === 'object' ? response : {};
      const perm = permFor(truth.length, `${seed}:c`);
      const got = {};
      for (const [pos, bucket] of Object.entries(raw)) {
        const orig = perm[Number(pos)];
        if (Number.isInteger(orig)) got[orig] = bucket;
      }
      let hits = 0;
      for (let i = 0; i < truth.length; i += 1) if (Number(got[i]) === truth[i]) hits += 1;
      const s = truth.length ? hits / truth.length : 0;
      return {
        score: s,
        correct: s >= PASS_MARK,
        // Indexed by shown position, for the same reason as match above.
        solution: perm.map((orig) => truth[orig]),
        detail: `${hits}/${truth.length} placed`,
      };
    }

    case 'blank': {
      const given = norm(Array.isArray(response) ? response[0] : response);
      const ok = q.accept.some((a) => norm(a) === given);
      return { score: ok ? 1 : 0, correct: ok, solution: q.accept[0] };
    }

    case 'cloze': {
      const given = Array.isArray(response) ? response : [];
      let hits = 0;
      q.blanks.forEach((b, i) => {
        if (b.accept.some((a) => norm(a) === norm(given[i]))) hits += 1;
      });
      const s = q.blanks.length ? hits / q.blanks.length : 0;
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: q.blanks.map((b) => b.accept[0]),
        detail: `${hits}/${q.blanks.length} blanks`,
      };
    }

    case 'numeric': {
      // Parsed leniently on purpose: students type "3,000", "3 000" and "3000"
      // for the same number, and a comma should not be marked wrong.
      const given = Number(String(response ?? '').replace(/[\s,]/g, ''));
      const ok = Number.isFinite(given) && Math.abs(given - q.value) <= (q.tolerance ?? 0);
      return {
        score: ok ? 1 : 0,
        correct: ok,
        solution: q.value,
        detail: q.tolerance ? `within ±${q.tolerance}` : 'exact',
      };
    }

    case 'order':
    case 'rank': {
      // response: SHOWN positions, in the order the student put them. Mapped to
      // original indices here; scoring below is unchanged and still measures
      // adjacent-pair agreement in the true sequence's own terms.
      const n = q.sequence.length;
      const got = toOriginal(Array.isArray(response) ? response : [], n, `${seed}:o`);
      const s = sequenceScore(got, n);
      if (s === null) return { score: 0, correct: false, solution: q.sequence, detail: 'incomplete order' };
      return { score: s, correct: s >= PASS_MARK, solution: q.sequence, detail: `${Math.round(s * (n - 1))}/${n - 1} in sequence` };
    }

    case 'open': {
      // Rubric points are matched on their significant words, so a student who
      // makes the point in their own words still gets credit. Deterministic and
      // explainable - the teacher can see which points were found.
      const said = norm(response);
      if (!said) return { score: 0, correct: false, solution: q.rubric, detail: 'no answer' };
      const found = q.rubric.filter((point) => {
        const keys = rubricKeys(point);
        if (keys.length === 0) return false;
        const hit = keys.filter((w) => said.includes(w)).length;
        return hit / keys.length >= 0.5;
      });
      const s = found.length / q.rubric.length;
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: q.rubric,
        detail: `${found.length}/${q.rubric.length} rubric points`,
      };
    }

    case 'hottext': {
      // Indices into the sentence, which is shown unshuffled - see forStudent.
      const want = new Set(q.answerIdxs.map(Number));
      const got = new Set((Array.isArray(response) ? response : []).map(Number).filter((i) => Number.isInteger(i)));
      const { score: s, hits } = selectionScore(want, got);
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: [...want].sort((a, b) => a - b),
        detail: `${hits}/${want.size} words`,
      };
    }

    case 'dropdown': {
      // response: one SHOWN position per gap, in gap order. Each gap shuffles on
      // its own seed, so the mapping is per gap too.
      const given = Array.isArray(response) ? response : [];
      let hits = 0;
      const solution = [];
      q.blanks.forEach((b, i) => {
        const gapSeed = `${seed}:d${i}`;
        const [picked] = toOriginal([given[i]], b.options.length, gapSeed);
        if (picked === b.answerIdx) hits += 1;
        // Back into SHOWN space, for the same reason as match and categorise:
        // the phone was never told which option is which, so an answer key in
        // original indices would highlight the wrong word on the screen.
        const posOf = [];
        permFor(b.options.length, gapSeed).forEach((orig, pos) => { posOf[orig] = pos; });
        solution.push(posOf[b.answerIdx]);
      });
      const s = q.blanks.length ? hits / q.blanks.length : 0;
      return { score: s, correct: s >= PASS_MARK, solution, detail: `${hits}/${q.blanks.length} gaps` };
    }

    case 'table': {
      // response: { "row:column": text }, blank cells only. Addressed by real
      // coordinates because a table is not shuffled - the headings are what make
      // a cell answerable, so moving them would change the question.
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      const solution = {};
      let hits = 0;
      let total = 0;
      q.rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
        if (c.accept === undefined) return;
        total += 1;
        const at = `${ri}:${ci}`;
        solution[at] = c.accept[0];
        const said = norm(raw[at]);
        if (said && c.accept.some((a) => norm(a) === said)) hits += 1;
      }));
      const s = total ? hits / total : 0;
      // Partial credit per cell, because a student who gets four rows of a table
      // right and fumbles the fifth has demonstrated the procedure.
      return { score: s, correct: s >= PASS_MARK, solution, detail: `${hits}/${total} cells` };
    }

    case 'grid': {
      // response: { "row:column": true } for every intersection ticked.
      const want = new Set();
      const cells = new Set();
      q.answers.forEach((row, ri) => row.forEach((v, ci) => {
        cells.add(`${ri}:${ci}`);
        if (v) want.add(`${ri}:${ci}`);
      }));
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      // Keys off the board are dropped rather than penalised: they are a client
      // bug, not a student's judgement, and a stray key must not cost a mark.
      const got = new Set(Object.keys(raw).filter((k) => raw[k] && cells.has(k)));

      // A grid is marked on BOTH classes - what was ticked and what was rightly
      // left alone - averaged, and this is the one place grid parts company with
      // multi and hottext. There, only the picks are judgements. Here every
      // intersection is its own yes/no, so both mistakes have to cost something,
      // and each of the two simple rules leaves a hole a student can walk
      // through without thinking:
      //   - plain per-cell agreement pays for abstaining. Most grids are sparse,
      //     so on a 4x4 with four true cells, ticking nothing agrees with twelve
      //     of sixteen - 75% for touching the screen once.
      //   - the multi rule pays for blanket-ticking whenever true cells outnumber
      //     false ones. On five true and one false it returns 0.8, which is over
      //     PASS_MARK: ticking everything would be recorded as Analyse
      //     demonstrated.
      // Averaging the two rates closes both at once - either extreme lands on
      // exactly 0.5 and neither can ever reach PASS_MARK. Both denominators are
      // guaranteed non-zero by the validator, which is why it refuses a grid that
      // is all-false or all-true.
      const trues = want.size;
      const falses = cells.size - trues;
      let hits = 0;
      let overclaimed = 0;
      got.forEach((k) => (want.has(k) ? (hits += 1) : (overclaimed += 1)));
      const s = (hits / trues + (falses - overclaimed) / falses) / 2;
      return {
        score: Math.max(0, Math.min(1, s)),
        correct: s >= PASS_MARK,
        solution: [...want].sort(),
        detail: `${hits}/${trues} ticked, ${overclaimed} wrongly ticked`,
      };
    }

    case 'poll': {
      // Every well-formed answer is right, because there is nothing to be right
      // about. `correct` is true so the phone shows the same "answer landed"
      // state it shows everywhere else - and countsTowardMastery() is what keeps
      // that true out of the mastery model, which would otherwise read it as a
      // free promotion. There is no solution to return: sending one would invent
      // an opinion the class was supposed to supply.
      const picked = Number(response);
      const ok = Number.isInteger(picked) && picked >= 0 && picked < q.options.length;
      return {
        score: ok ? 1 : 0,
        correct: ok,
        solution: null,
        detail: ok ? 'recorded' : 'no answer recorded',
      };
    }

    case 'hotspot': {
      // response: the zone tokens tapped (figures/interact.js). Each is turned
      // back into the part it stands for from the seed; a token that names no
      // tappable part is a client bug and is dropped, as grid drops stray keys.
      const board = boardOf(q.stimulus);
      if (!board) return { score: 0, correct: false, solution: null, detail: 'the figure could not be read' };
      const { tokenOf, idOf } = tokensFor(board, zoneShuffle(seed));
      const parts = new Set(board.ids.map(low));
      const want = new Set(q.answerIds.map(low));
      const got = new Set((Array.isArray(response) ? response : [])
        .map((t) => (typeof t === 'string' ? idOf.get(t) : undefined)).filter(Boolean).map(low).filter((id) => parts.has(id)));
      // The multi rule, for the reason selectionScore gives: tap everything and
      // the over-claims cancel the finds.
      const { score: s, hits } = selectionScore(want, got);
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: [...want].map((id) => tokenOf.get(id)).sort(byToken),
        detail: `${hits}/${want.size} parts`,
      };
    }

    case 'label': {
      // response: { zone token: SHOWN position of the label put there }. Partial
      // credit per label, as match: one slip is not fatal.
      const board = boardOf(q.stimulus);
      if (!board) return { score: 0, correct: false, solution: null, detail: 'the figure could not be read' };
      const { tokenOf } = tokensFor(board, zoneShuffle(seed));
      const all = labelsOf(q);
      const perm = permFor(all.length, labelSeed(seed));
      const posOf = [];
      perm.forEach((orig, pos) => { posOf[orig] = pos; });
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      let hits = 0;
      const solution = {};
      q.placements.forEach((p, i) => {
        const zone = tokenOf.get(low(p.target));
        solution[zone] = posOf[i];
        const pos = Number(raw[zone]);
        if (Number.isInteger(pos) && perm[pos] === i) hits += 1;
      });
      const s = q.placements.length ? hits / q.placements.length : 0;
      return { score: s, correct: s >= PASS_MARK, solution, detail: `${hits}/${q.placements.length} labels` };
    }

    case 'plot': {
      // response: the points placed, as [x, y] in the graph's own numbers.
      const spec = figureSpec(q.stimulus, 'plot');
      if (!spec) return { score: 0, correct: false, solution: null, detail: 'the graph could not be read' };
      const { score: s, detail } = gradePlot(q.plotKey, spec, response);
      return { score: s, correct: s >= PASS_MARK, solution: plotSolution(q.plotKey), detail };
    }

    case 'numberline': {
      const spec = figureSpec(q.stimulus, 'numberline');
      if (!spec) return { score: 0, correct: false, solution: null, detail: 'the number line could not be read' };
      const { score: s, detail } = gradeNumberline(q.lineKey, spec, response, q.tolerance ?? null);
      return {
        score: s,
        correct: s >= PASS_MARK,
        solution: { points: q.lineKey.points ?? [], intervals: q.lineKey.intervals ?? [], rays: q.lineKey.rays ?? [] },
        detail,
      };
    }

    case 'chart': {
      // response: one height per category, in the categories' own order (a
      // chart is not shuffled: the order is the data's).
      const { score: s, detail } = gradeChart(q.bars, q.values, response, q.tolerance ?? null);
      return { score: s, correct: s >= PASS_MARK, solution: q.values, detail };
    }

    case 'drawing':
      // Never marked by the machine (Batch 9, E4): no score, no verdict and no
      // solution, only the note that it waits. The caller stores it as
      // provisional for the professor's review queue (awaitsReview).
      return { score: null, correct: null, solution: null, detail: 'waits for your professor', awaitingReview: true };

    default:
      return { score: 0, correct: false, solution: null, detail: `unhandled kind ${kind}` };
  }
}

/**
 * The seed a tap or label question deals from: the student's seed under the
 * server's secret (src/secrets.js). The plain seed is a roll number and a
 * question id, which the phone knows, and permFor() is public, so a phone could
 * deal itself the same cards and read off which zone is which part and which
 * labels are the extra ones: the key. Still recomputable by the server alone,
 * at marking time, so nothing is stored.
 *
 * Only these two kinds (new in Batch 8, never yet served): the older kinds'
 * shuffles keep their plain seeds, because re-dealing them would mis-read every
 * answer still waiting in a phone's outbox.
 */
const dealSeed = (seed) => crypto.createHmac('sha256', secretFor('deal')).update(String(seed), 'utf8').digest('base64url');
/** The seeded order a student's zone tokens are dealt in (figures/interact.js tokensFor). */
const zoneShuffle = (seed) => (n) => permFor(n, `${dealSeed(seed)}:z`);
/** The seed a label question's labels are shuffled with. */
const labelSeed = (seed) => `${dealSeed(seed)}:lb`;

/** Said when an answer arrives before the drawing engines can mark it; the device sends it again. */
export const FIGURES_NOT_READY = 'This question\'s drawing is still being prepared, so your answer was not taken yet. '
  + 'It is still on your device and will be sent again.';

/**
 * Can this question be marked now? A tap or label answer on a diagram or a
 * molecule is turned back into parts from the drawing's own parts, which exist
 * only once Graphviz and RDKit have loaded; marked before then, every tap was
 * dropped and the answer stored as wrong, moving the ladder. So every path
 * that stores an answer asks here first: the engines are waited for (they load
 * at boot, so this is nearly always at once), and when they cannot load the
 * answer is refused the way a failed save is, for the device to send again.
 */
export async function readyToMark(q) {
  const kind = q?.kind ?? 'mcq';
  if ((kind !== 'hotspot' && kind !== 'label') || q.stimulus?.kind !== 'figure') return true;
  if (!needsEngine(q.stimulus.spec) || enginesReady()) return true;
  const wait = new Promise((resolve) => { setTimeout(resolve, 20000).unref?.(); });
  await Promise.race([loadFigureEngines().catch(() => {}), wait]);
  return enginesReady();
}
const byToken = (a, b) => Number(String(a).slice(1)) - Number(String(b).slice(1));
/** A label question's labels in stored order: the placements', then the ones that belong nowhere. */
const labelsOf = (q) => [...q.placements.map((p) => p.label), ...(Array.isArray(q.distractors) ? q.distractors : [])];

/**
 * Score one response, server-side, with no model call — the live loop must stay
 * at zero LLM calls even for open responses.
 *
 * @returns {{score:number, correct:boolean, solution:*, detail?:string, ungraded?:true}}
 *          score is 0..1; correct is what the mastery model consumes, but only
 *          when `ungraded` is absent - see countsTowardMastery().
 *
 * The flag is stamped here, derived from UNGRADED_KINDS, rather than written by
 * hand in the branch that returns it. A kind added to that list is then ungraded
 * everywhere at once, and cannot be ungraded in the predicate but graded in the
 * result - which is the failure that would matter, because the result is the
 * half the live loop actually reads.
 *
 * `accommodations` must be the SAME object forStudent() was given for this
 * student and this question, because the reduction is recomputed here rather than
 * remembered. The caller holds it against the served question for exactly that
 * reason - see the pin in sockets/index.js. Hand this a different set from the
 * one the phone was served with and the positions it reports translate back to
 * the wrong options, silently.
 */
export function score(q, response, seed = '', accommodations = null) {
  const graded = scoreOne(q, response, seed, shownOptionIndices(q, seed, accommodations));
  return isUngraded(q?.kind ?? 'mcq') ? { ...graded, ungraded: true } : graded;
}

/**
 * Deterministic shuffle, seeded by student + question.
 *
 * It must be stable: a phone that drops mid-question and reconnects gets the
 * item order it had before, rather than a board that silently rearranged under
 * a half-finished answer. It also means the server never has to remember what
 * shuffle it sent - it can recompute it.
 */
/**
 * The permutation a given student sees for a given question.
 *
 * `perm[shownPosition] = originalIndex`. Deterministic and recomputable from the
 * seed, which is the entire trick: the server never has to remember what order
 * it sent, and the phone never has to be told what the original order was.
 *
 * Stability matters as much as secrecy - a phone that drops mid-question and
 * reconnects gets the same board back rather than one that silently rearranged
 * under a half-finished answer.
 */
function permFor(n, seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The shown items, in shown order, carrying no index at all. */
const shown = (list, seed) => permFor(list.length, seed).map((orig) => list[orig]);

/**
 * Translate an answer given in SHOWN positions back into original indices.
 *
 * This is the half that used to live on the phone. Items travelled as {t, i}
 * with `i` the original index, and for match, order, rank and categorise the
 * original index IS the answer - `items.sort((a,b)=>a.i-b.i)` in devtools
 * returned the correct sequence verbatim. The shuffle was doing nothing but
 * cosmetic work. Now nothing that identifies the true position ever leaves the
 * server, and the mapping happens here, at scoring time.
 */
const toOriginal = (positions, n, seed) => {
  const perm = permFor(n, seed);
  return positions.map((p) => (Number.isInteger(Number(p)) ? perm[Number(p)] : -1));
};

/** An index into a list of n, or null. */
const inRange = (i, n) => (Number.isInteger(i) && i >= 0 && i < n ? i : null);

/**
 * A response in the question's OWN terms: every shown position translated back
 * to the original index it stands for, by the same permutations forStudent()
 * dealt and scoreOne() undoes, and read the way scoreOne() reads it.
 *
 * For item analysis (services/itemStats.js), which counts how many students
 * chose each option. Counted by shown position instead, a match's "first item
 * on the right" is a different item on every phone, and the counts would
 * describe the shuffle rather than the class.
 *
 * `keep` is the fewer-choices reduction this student was served under
 * (shownOptionIndices), or null for the full list. A position or key that names
 * nothing on the board comes back as null, or is left out of a list; it is
 * never guessed at.
 *
 *   mcq, poll        the option index, or null
 *   multi, hottext   the indices picked, ascending, each once
 *   truefalse        true, false or null
 *   match            per left item, the index of the right item paired with it
 *   categorise       per item, in the stored bucket-major order, its group index
 *   dropdown         per gap, the option index
 *   grid             per row, per column, whether it was ticked
 *   hotspot          the names of the parts tapped, sorted, each once (the
 *                    phone sent this student's zone tokens, which mean nothing
 *                    to anyone else)
 *   label            per placement, the index of the label put on its part, in
 *                    the stored order (the placements' labels, then the extra
 *                    ones), or null
 *   anything else    null: a typed or arranged answer has no options to count
 */
export function toOriginalResponse(q, response, seed = '', keep = null) {
  const kind = q?.kind ?? 'mcq';
  const options = Array.isArray(q?.options) ? q.options : [];
  const fromShown = (pos) => (keep ? (inRange(pos, keep.length) === null ? null : keep[pos]) : pos);

  switch (kind) {
    case 'mcq':
      return inRange(fromShown(Number(response)), options.length);
    case 'poll':
      return inRange(Number(response), options.length);
    case 'truefalse':
      return typeof response === 'boolean' ? response : null;
    case 'multi':
    case 'hottext': {
      const n = kind === 'multi' ? options.length : (Array.isArray(q.tokens) ? q.tokens.length : 0);
      const sent = (Array.isArray(response) ? response : []).map(Number);
      const picked = sent.map((p) => inRange(kind === 'multi' ? fromShown(p) : p, n)).filter((i) => i !== null);
      return [...new Set(picked)].sort((a, b) => a - b);
    }
    case 'match': {
      const n = Array.isArray(q.pairs) ? q.pairs.length : 0;
      const given = Array.isArray(response) ? response.slice(0, n) : [];
      const got = toOriginal(given, n, `${seed}:r`);
      return Array.from({ length: n }, (_, i) => inRange(got[i], n));
    }
    case 'categorise': {
      const buckets = Array.isArray(q.buckets) ? q.buckets : [];
      const n = buckets.reduce((sum, b) => sum + (Array.isArray(b?.items) ? b.items.length : 0), 0);
      const perm = permFor(n, `${seed}:c`);
      const out = Array.from({ length: n }, () => null);
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      for (const [pos, bucket] of Object.entries(raw)) {
        const orig = perm[Number(pos)];
        if (Number.isInteger(orig)) out[orig] = inRange(Number(bucket), buckets.length);
      }
      return out;
    }
    case 'dropdown': {
      const gaps = Array.isArray(q.blanks) ? q.blanks : [];
      const given = Array.isArray(response) ? response : [];
      return gaps.map((b, i) => {
        const n = Array.isArray(b?.options) ? b.options.length : 0;
        return inRange(toOriginal([given[i]], n, `${seed}:d${i}`)[0], n);
      });
    }
    case 'grid': {
      const rows = Array.isArray(q.rows) ? q.rows.length : 0;
      const cols = Array.isArray(q.columns) ? q.columns.length : 0;
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => Boolean(raw[`${r}:${c}`])));
    }
    case 'hotspot': {
      const board = boardOf(q.stimulus);
      if (!board) return [];
      const { idOf } = tokensFor(board, zoneShuffle(seed));
      const parts = new Map(board.ids.map((id) => [low(id), id]));
      const picked = (Array.isArray(response) ? response : [])
        .map((t) => (typeof t === 'string' ? parts.get(low(idOf.get(t))) : undefined)).filter(Boolean);
      return [...new Set(picked)].sort();
    }
    case 'label': {
      const board = boardOf(q.stimulus);
      const placements = Array.isArray(q.placements) ? q.placements : [];
      if (!board) return placements.map(() => null);
      const { tokenOf } = tokensFor(board, zoneShuffle(seed));
      const n = labelsOf(q).length;
      const perm = permFor(n, labelSeed(seed));
      const raw = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
      return placements.map((p) => {
        const pos = Number(raw[tokenOf.get(low(p.target))]);
        return Number.isInteger(pos) && pos >= 0 && pos < n ? perm[pos] : null;
      });
    }
    default:
      return null;
  }
}

/**
 * The stimulus as a phone may see it, rebuilt field by field.
 *
 * Never `{ ...q.stimulus }`. A spread ships whatever a future author adds to the
 * stored object - a teacher's note, a source answer key, an internal id - and it
 * would do it silently, on every kind at once, because this rides along with all
 * sixteen. Listing the fields means a new one has to be added here on purpose.
 */
const stimulusForStudent = (s) => {
  if (s.kind === 'passage') return { kind: 'passage', text: s.text };
  // A figure goes as its drawing, description and table (figures/index.js
  // figureForStudent): never its spec, which for a "plot this" figure could
  // hold what the student is asked to find, and never its steps.
  if (s.kind === 'figure') return figureForStudent(s.spec);
  // An image's regions stay with the professor, for the same reason.
  return { kind: 'image', url: s.url, alt: s.alt ?? '' };
};

/**
 * The question as ONE student may see it.
 *
 * `accommodations` is that student's supports, and the only one this function
 * acts on is the one that changes the question rather than its rendering. That
 * is the whole reason it is a parameter here and not a class name on a phone: an
 * option removed in the browser was still serialised, still sent, and still
 * sitting in a socket frame that devtools prints on request. Removed here, it
 * never existed as far as the device is concerned.
 */
export function forStudent(q, seed = '', accommodations = null) {
  const kind = q.kind ?? 'mcq';
  const keep = shownOptionIndices(q, seed, accommodations);
  const base = {
    _id: String(q._id),
    text: q.text,
    bloom: q.bloom,
    topic: q.topic ?? '',
    kind,
    source: q.source ?? 'llm',
    // On the base, so every kind carries it without opting in - that is what
    // makes one passage able to hold an mcq, a hottext and an open response.
    ...(q.stimulus ? { stimulus: stimulusForStudent(q.stimulus) } : {}),
  };

  switch (kind) {
    case 'mcq':
    case 'multi':
      // `keep` is null for every student without the support, so this is the
      // same array reference it has always been for almost everybody.
      return { ...base, options: keep ? keep.map((i) => q.options[i]) : q.options };
    case 'truefalse':
      return base;
    case 'match':
      return {
        ...base,
        left: q.pairs.map((p) => p.left),
        // Right-hand items in shown order and nothing else. They used to carry
        // their original index, which for this kind is the answer: left[k] pairs
        // with the item whose i === k, so the whole key was one line of devtools.
        right: shown(q.pairs.map((p) => p.right), `${seed}:r`),
      };
    case 'categorise': {
      // Bucket NAMES travel; which items belong in them does not. The flat list
      // is bucket-major, so shipping each item's original index handed over the
      // exact partition and left only the labels to guess.
      const flat = [];
      q.buckets.forEach((b) => b.items.forEach((t) => flat.push(t)));
      return {
        ...base,
        groups: q.buckets.map((b) => b.name),
        items: shown(flat, `${seed}:c`),
      };
    }
    // A COUNT, never the answers. The field is deliberately not called `blanks`:
    // that is the name of the answer-bearing field on the stored question, and a
    // student payload carrying a key by that name is one careless `{...q}` away
    // from shipping the accepted answers with it. The leak test forbids the name
    // outright for that reason, and the name is the only defence that survives
    // somebody editing this function without reading it.
    case 'blank':
      return { ...base, blankCount: 1 };
    case 'cloze':
      return { ...base, blankCount: q.blanks.length };
    case 'numeric':
      return { ...base, unit: q.unit ?? '' };
    case 'order':
      return { ...base, items: shown(q.sequence, `${seed}:o`) };
    case 'rank':
      return {
        ...base,
        criterion: q.criterion ?? '',
        items: shown(q.sequence, `${seed}:o`),
      };
    case 'hottext':
      // Tokens travel in their ORIGINAL order, and that is not the leak it looks
      // like next to match and order. There the original index IS the answer; a
      // hottext's answer is which SUBSET satisfies the criterion, and the subset
      // is `answerIdxs`, which stays here. Shuffling would also destroy the one
      // thing the question is about - a sentence with its words rearranged is
      // not a sentence, and "pick the words that do X" stops meaning anything.
      return { ...base, tokens: q.tokens, criterion: q.criterion };
    case 'dropdown':
      return {
        ...base,
        blankCount: q.blanks.length,
        // Named `gaps`, not `blanks`, for the reason given above: `blanks` is
        // the answer-bearing field on the stored question, and a student payload
        // using that name is one careless spread away from shipping the key.
        // Each gap is shuffled on its own seed, so a generator that writes the
        // right option first every time - which they do - does not make the
        // whole passage answerable without reading it.
        gaps: q.blanks.map((b, i) => ({ options: shown(b.options, `${seed}:d${i}`) })),
      };
    case 'table':
      return {
        ...base,
        columns: q.columns,
        // Rebuilt cell by cell. `{ ...cell }` on a blank cell ships `accept`,
        // which is the answer to that cell - and unlike the other kinds the
        // phone genuinely needs this structure to render, so the field name
        // cannot be the defence. The rebuild is.
        rows: q.rows.map((r) => ({
          header: r.header,
          cells: r.cells.map((c) => (c.accept === undefined ? { given: c.given } : { blank: true })),
        })),
      };
    case 'grid':
      // Both axes of labels and nothing else: `answers` is the entire key, and a
      // matrix of booleans is the one field on this kind that must never travel.
      return { ...base, rows: q.rows, columns: q.columns };
    case 'poll':
      // Options in the order they were written, NOT shuffled. There is no answer
      // to protect, and a poll's options are usually a scale - shuffling
      // "Strongly agree / Agree / Neutral / Disagree" turns a reading of the
      // room into noise, and makes the teacher's bar chart unreadable.
      return { ...base, options: q.options };
    case 'open': {
      // The length and its word limit (Batch 9, E3): the phone sizes the box
      // and counts words from these; the server refuses an answer over the
      // limit before marking (responseProblem). Never the rubric.
      const length = openLength(q);
      return { ...base, hint: `${q.rubric.length} points to cover`, length, maxWords: OPEN_LENGTHS[length].maxWords };
    }
    case 'drawing':
      // The question, its stimulus on the base, and whether words may go with
      // the drawing. Never the reviewer's rubric.
      return { ...base, allowText: q.allowText === true, ...(q.allowText === true ? { maxWords: DRAWING_TEXT_WORDS } : {}) };
    case 'hotspot':
    case 'label': {
      // The figure is drawn again under this student's tokens, replacing the
      // plain drawing on the base: a part's own name ("nucleus") must not reach
      // the phone in an attribute. Zones carry a token and, on a picture, an
      // outline; never a name, a label or which of them is right.
      const board = boardOf(q.stimulus);
      if (!board) return base;
      const only = kind === 'label' ? q.placements.map((p) => p.target) : null;
      const { stimulus, zones } = zonesFor(q.stimulus, board, zoneShuffle(seed), only);
      if (kind === 'hotspot') return { ...base, stimulus, zones };
      // The labels shuffled, the extra ones among them; named `labels`, never
      // `placements`, which is the stored key.
      return { ...base, stimulus, zones, labels: shown(labelsOf(q), labelSeed(seed)) };
    }
    case 'plot': {
      // The graph and where it sits in its picture, so a tap becomes x and y;
      // whether a line or points are asked for. Never the key.
      const spec = figureSpec(q.stimulus, 'plot');
      const place = q.plotKey?.place === 'line' ? 'line' : 'points';
      return { ...base, grid: spec ? plotGrid(spec) : null, place, maxPoints: place === 'line' ? 2 : MAX_PLOT_POINTS };
    }
    case 'numberline': {
      // The line and its ticks. Not whether the answer is points or intervals:
      // the phone offers every mark, since which one is right is part of the
      // question.
      const spec = figureSpec(q.stimulus, 'numberline');
      return { ...base, grid: spec ? numberlineGrid(spec) : null };
    }
    case 'chart':
      // The empty chart, named `board` so the stored `bars` and `values` have
      // no namesake in a phone's payload.
      return {
        ...base,
        board: {
          categories: q.bars.categories,
          min: q.bars.min ?? 0,
          max: q.bars.max,
          step: q.bars.step,
          label: q.bars.label ?? '',
          xLabel: q.bars.xLabel ?? '',
        },
      };
    default:
      return base;
  }
}
