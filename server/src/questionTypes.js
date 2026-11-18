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
// and the live loop calls it on every answer.

import { LEVELS } from './bloom.js';
// One string, imported rather than retyped. A misspelling of this key would not
// throw anywhere at all - it would simply stop reducing, silently, for every
// student who had been given the support.
import { FEWER_CHOICES } from './accommodations.js';

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
];

/**
 * Every interaction a level may legitimately be asked through.
 * First entry is the default, which is what KIND_FOR_LEVEL returns.
 */
export const KINDS_FOR_LEVEL = {
  remember: ['mcq', 'truefalse'],
  understand: ['match', 'categorise'],
  // dropdown: the answer is produced in context, in a passage the student has to
  // hold together while they work - which is Apply and not Remember. It sits
  // beside cloze rather than below it because recognition is still available:
  // the words are on the screen, so it is the easiest interaction at this level
  // and the right one to swap a struggling class's cloze items into.
  // table: completing a grid IS executing a procedure repeatedly - each blank
  // cell is the same rule applied to a new row, which is exactly Krathwohl's
  // "execute". A given cell shows the rule; the blank ones demand it be used.
  apply: ['blank', 'cloze', 'numeric', 'dropdown', 'table'],
  // hottext: picking out which words in a sentence do the work is
  // differentiation - separating the load-bearing parts from the surrounding
  // material. The student is not recalling the words, they are already on the
  // screen; they are deciding which of them matter, which is Analyse.
  // grid: a multi-select over a relation. Every intersection is a separate
  // "does this attribute belong to this case", so it is `multi` run across two
  // axes at once - the same attributing move, applied systematically. It is
  // marked differently from multi, though, and scoreOne() says why: the same
  // move over a whole matrix makes leaving a cell alone a judgement too.
  analyse: ['multi', 'categorise', 'hottext', 'grid'],
  evaluate: ['order', 'rank'],
  create: ['open'],
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
};

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

/** What a stimulus may be. A third entry here needs a branch in both validators. */
export const STIMULUS_KINDS = ['passage', 'image'];

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

    default:
      return `unhandled kind ${kind}`;
  }
}

export const isValid = (q) => invalidReason(q) === null;

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

    default:
      return { score: 0, correct: false, solution: null, detail: `unhandled kind ${kind}` };
  }
}

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
const stimulusForStudent = (s) => (s.kind === 'passage'
  ? { kind: 'passage', text: s.text }
  : { kind: 'image', url: s.url, alt: s.alt ?? '' });

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
    case 'open':
      return { ...base, hint: `${q.rubric.length} points to cover` };
    default:
      return base;
  }
}
