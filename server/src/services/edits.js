// Phase 4 - the pure half of the question editor.
//
// Everything here is a transform on question documents: no repository, no
// request, no ownership. routes/bank.js does the fetching, the ownership check
// and the writing; this file decides what the result should BE. That is the
// half worth unit-testing, and the half that must never disagree with
// questionTypes.js - so every rule below is asked of that file rather than
// restated here.
//
// The one rule this file exists to hold: the interaction is chosen by the Bloom
// LEVEL. A teacher may move a question between the kinds inside its own level's
// set, because everything in a set demands the same cognitive move and only the
// surface changes. Across levels is refused here, once, so that no route and no
// screen can forget to ask.

import { LEVELS, LABEL as LEVEL_LABEL, isLevel } from '../bloom.js';
import {
  KINDS,
  KIND_FOR_LEVEL,
  LABEL as KIND_LABEL,
  PAYLOAD_FIELDS,
  BLANK_MARK,
  swapsFor,
  kindSuitsLevel,
  invalidReason,
  isUngraded,
} from '../questionTypes.js';

/**
 * Every field a hand edit may set. `options` and `answerIdx` are not payload
 * fields - mcq and multi keep them as columns of their own - so they are named
 * here, and the rest is taken from the contract rather than retyped.
 */
export const EDITABLE = ['text', 'bloom', 'kind', 'options', 'answerIdx', ...PAYLOAD_FIELDS];

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const list = (v) => (Array.isArray(v) ? v : []);
const key = (v) => collapse(v).toLowerCase();
const quoted = (kinds) => kinds.map((k) => `"${KIND_LABEL[k]}"`).join(' or ');
const levelsOffering = (kind) => LEVELS.filter((l) => kindSuitsLevel(kind, l));

/** Whitespace only. Never drops an entry - see tidied(). */
const trimmed = (v) => (typeof v === 'string' ? collapse(v) : v);

/**
 * Collapse the whitespace in every string a question carries, without ever
 * removing one. A blank row the teacher left behind stays a blank row, so the
 * validator can name it ("mcq has an empty option") and the complaint lands
 * next to the box that caused it. Filtering it away here would leave them
 * reading "mcq needs exactly 4 options" over four boxes they had just filled.
 */
function tidied(q) {
  const out = { ...q };
  if (typeof out.text === 'string') out.text = collapse(out.text);
  // tokens, columns and a grid's row labels are read by position, which is one
  // more reason nothing here ever drops an entry: a hot text's answer is a list
  // of token indices, and losing one token would move every index after it.
  for (const f of ['options', 'sequence', 'accept', 'rubric', 'tokens', 'columns']) {
    if (Array.isArray(out[f])) out[f] = out[f].map(trimmed);
  }
  for (const f of ['criterion', 'unit']) out[f] = trimmed(out[f]);
  if (Array.isArray(out.pairs)) {
    out.pairs = out.pairs.map((p) => ({ ...p, left: trimmed(p?.left), right: trimmed(p?.right) }));
  }
  if (Array.isArray(out.buckets)) {
    out.buckets = out.buckets.map((b) => ({
      ...b,
      name: trimmed(b?.name),
      items: Array.isArray(b?.items) ? b.items.map(trimmed) : b?.items,
    }));
  }
  if (Array.isArray(out.blanks)) {
    // A cloze gap holds typed answers, a dropdown gap a list to choose from.
    // Only the fields a gap actually carries are touched, so neither kind is
    // handed an empty field of the other's.
    out.blanks = out.blanks.map((b) => (b && typeof b === 'object' && !Array.isArray(b)
      ? {
        ...b,
        ...(b.accept !== undefined ? { accept: Array.isArray(b.accept) ? b.accept.map(trimmed) : b.accept } : {}),
        ...(Array.isArray(b.options) ? { options: b.options.map(trimmed) } : {}),
      }
      : b));
  }
  if (Array.isArray(out.rows)) {
    // A grid's rows are labels; a table's are a heading and its cells. Each
    // cell keeps exactly the keys it was sent with: a cell sent as both given
    // and blank must still reach the validator as both, and be refused there.
    const cell = (c) => (c && typeof c === 'object' && !Array.isArray(c)
      ? {
        ...c,
        ...(c.given !== undefined ? { given: trimmed(c.given) } : {}),
        ...(Array.isArray(c.accept) ? { accept: c.accept.map(trimmed) } : {}),
      }
      : c);
    out.rows = out.rows.map((r) => (r && typeof r === 'object' && !Array.isArray(r)
      ? { ...r, header: trimmed(r.header), ...(Array.isArray(r.cells) ? { cells: r.cells.map(cell) } : {}) }
      : trimmed(r)));
  }
  return out;
}

// --------------------------------------------------------------- messages --

/**
 * Why a type outside the level is not on offer. This is the product's central
 * claim, so it is stated in full rather than answered with "invalid kind": a
 * teacher who is told no is owed the reason the product works this way.
 */
function crossLevelReason(kind, bloom) {
  const home = levelsOffering(kind);
  const where = home.map((l) => LEVEL_LABEL[l]).join(' and ');
  return (
    `${LEVEL_LABEL[bloom]} is asked as ${quoted(swapsFor(bloom))}. ` +
    `"${KIND_LABEL[kind]}" is how ${where} is asked, and a question cannot cross levels by changing its type: ` +
    'the level chooses the interaction, which is the only reason the Bloom tag means anything here. ' +
    `Retag it to ${LEVEL_LABEL[home[0]]} first if that is what you meant.`
  );
}

/**
 * Retagging the level takes the interaction with it, so a question can arrive
 * at its new level in a shape that level never asks for. The validator's own
 * words are carried through verbatim - they are written to be read by a teacher
 * - with one sentence in front, because "multi needs 2+ correct answers" on its
 * own reads like a bug to somebody who only changed a tag.
 */
function retagReason(bloom, kind, why) {
  return (
    `${LEVEL_LABEL[bloom]} is asked as ${quoted(swapsFor(bloom))}, so this question becomes a ` +
    `"${KIND_LABEL[kind]}" - and it is not one yet: ${why}. ` +
    `Write it out at ${LEVEL_LABEL[bloom]}, or regenerate it there.`
  );
}

// ------------------------------------------------------------------ edit --

/**
 * A full hand edit: text, level, kind and any payload field, merged over what
 * is already stored and validated as one whole.
 *
 * Fields the new kind does not use are left on the document on purpose. They
 * cost nothing - invalidReason and forStudent both read only the fields of the
 * declared kind - and they mean a teacher who tries "Choose one" as "True or
 * false" and changes their mind gets their four options back rather than an
 * empty form.
 *
 * @returns {{question: object} | {reason: string}} the merged question, or why not
 */
export function applyEdit(existing, body = {}) {
  const merged = { ...existing };
  for (const field of EDITABLE) {
    if (body[field] !== undefined) merged[field] = body[field];
  }

  // The validator's own wording, so one mistake never has two voices.
  if (!isLevel(merged.bloom)) return { reason: `bad bloom "${merged.bloom}"` };

  let retagged = false;

  if (body.kind !== undefined) {
    const wanted = String(body.kind);
    if (!KINDS.includes(wanted)) return { reason: `bad kind "${wanted}"` };
    if (!kindSuitsLevel(wanted, merged.bloom)) return { reason: crossLevelReason(wanted, merged.bloom) };
    merged.kind = wanted;
  } else if (!kindSuitsLevel(merged.kind ?? 'mcq', merged.bloom)) {
    // The level moved and the old interaction does not belong at the new one.
    // Land on that level's default rather than leaving a question tagged one
    // way and asked another, which is the exact dishonesty this product exists
    // to remove.
    merged.kind = KIND_FOR_LEVEL[merged.bloom];
    retagged = true;
  }

  const clean = tidied(merged);
  const why = invalidReason(clean);
  if (why) return { reason: retagged ? retagReason(clean.bloom, clean.kind, why) : why };
  return { question: clean };
}

/**
 * The flat patch a repository takes. Every payload field the question still
 * carries travels together, every time: the Postgres store keeps them in one
 * jsonb column and replaces it wholesale, so a patch naming only what changed
 * would blank everything it did not mention.
 */
export function patchFor(q) {
  const patch = { text: q.text, bloom: q.bloom, kind: q.kind ?? 'mcq' };
  if (Array.isArray(q.options)) patch.options = q.options;
  if (Number.isInteger(q.answerIdx)) patch.answerIdx = q.answerIdx;
  for (const f of PAYLOAD_FIELDS) if (q[f] !== undefined) patch[f] = q[f];
  return patch;
}

// ---------------------------------------------------------------- author --

/**
 * A question a professor writes from scratch: text, level, kind and the kind's
 * payload, validated as one whole exactly like an edit.
 *
 * The level still chooses the interaction. A kind from another level's set is
 * refused with the same explanation an edit gets, because a professor's own
 * question is held to the rule the product is built on, not exempted from it.
 * The one exception is an ungraded kind: a poll belongs to no level's set, its
 * tag only says where it sits in the lesson, and questionTypes.js names this
 * route - the one that creates items outright - as the way a poll is made.
 *
 * `kind` may be left out, and is then the level's default.
 *
 * @returns {{question: object} | {reason: string}}
 */
export function authorQuestion(body = {}) {
  const bloom = body.bloom;
  if (!isLevel(bloom)) return { reason: `bad bloom "${bloom}"` };
  const kind = body.kind === undefined || body.kind === null ? KIND_FOR_LEVEL[bloom] : String(body.kind);
  if (!KINDS.includes(kind)) return { reason: `bad kind "${kind}"` };
  if (!isUngraded(kind) && !kindSuitsLevel(kind, bloom)) return { reason: crossLevelReason(kind, bloom) };

  const draft = { bloom, kind };
  for (const field of EDITABLE) {
    if (field !== 'bloom' && field !== 'kind' && body[field] !== undefined) draft[field] = body[field];
  }
  const clean = tidied(draft);
  const why = invalidReason(clean);
  return why ? { reason: why } : { question: clean };
}

/**
 * Not yet let into rooms by anyone: a draft, or model output nobody approved.
 * The second half is what catches a REJECTED draft, which is `discarded` like
 * any other rejected question but has still never been reviewed - asking only
 * for status 'draft' let its halves, or a merge with it, come out active.
 */
const unreviewed = (q) => q?.status === 'draft' || needsApproval(q);

/** What a new row keeps from the question it came out of. */
const inherit = (q) => ({
  contentId: q.contentId,
  topic: q.topic ?? '',
  bloom: q.bloom,
  kind: q.kind ?? 'mcq',
  // Provenance survives the edit. A half of a template item is still template
  // text, and the UI labels it from this field [CONTRACT.md section 6 rule 5].
  source: q.source ?? 'llm',
  // A half of a draft is still a draft. Splitting or merging is an edit, not an
  // approval, and two active halves of an unreviewed item would be a way round
  // the approval gate.
  status: unreviewed(q) ? 'draft' : 'active',
  model: q.model ?? null,
  sourceRef: q.sourceRef ?? null,
  approvedBy: unreviewed(q) ? null : (q.approvedBy ?? null),
  approvedAt: unreviewed(q) ? null : (q.approvedAt ?? null),
});

// ----------------------------------------------------------------- split --

/**
 * Cut a run of indices in two. Both halves keep at least `min` entries, which
 * on a short list forces them to share one - and sharing is honest: the same
 * term may appear in two questions of one bank, it is the same QUESTION twice
 * that would be wrong. A list at or under the floor has no split in it at all,
 * because both halves would have to be the whole thing.
 */
function halve(n, min) {
  if (n <= min) return null;
  const cut = Math.ceil(n / 2);
  const idx = Array.from({ length: n }, (_, i) => i);
  return [idx.slice(0, Math.max(cut, min)), idx.slice(Math.min(cut, n - min))];
}

const take = (items, idxs) => idxs.map((i) => items[i]);

/**
 * Make a passage able to start where it now starts: drop the punctuation the
 * cut left hanging off the front and raise the first letter. Orthography only -
 * nothing is added, removed or reworded, because a question repaired into
 * something the teacher did not write is a question they did not check.
 */
function opener(text) {
  const body = String(text).replace(/^[\s,;:.–—-]+/, '').replace(/\s+$/, '');
  return body ? body[0].toUpperCase() + body.slice(1) : body;
}

/**
 * One question in, two out. Each half has to stand on its own as a valid item
 * of the same kind at the same level, so the kinds whose floor is their whole
 * payload - a four-option "Choose one", a single blank, one rubric - refuse and
 * say why rather than producing two things a student cannot answer.
 *
 * @returns {{parts: object[]} | {reason: string}}
 */
export function splitQuestion(q) {
  const kind = q?.kind ?? 'mcq';
  const base = inherit(q);
  const text = q.text;
  let parts = null;

  switch (kind) {
    case 'mcq':
      return {
        reason:
          'A "Choose one" is exactly four options and needs all four to be asked, so neither half of it is still a question. Rewrite it as two, or regenerate it.',
      };

    case 'truefalse':
    case 'blank':
    case 'numeric':
      return {
        reason: `A "${KIND_LABEL[kind]}" has one answer, so a half of it is a question with nothing to answer.`,
      };

    case 'open':
      return {
        reason:
          'An open response is one question marked against one rubric. Splitting the rubric leaves two identical questions, each marked against half an answer.',
      };

    case 'multi': {
      const halves = halve(list(q.options).length, 4);
      if (!halves) {
        return { reason: 'multi needs 4-6 options, so a four-option one has no half that is still a "Choose all that apply". Add an option first.' };
      }
      const want = new Set(list(q.answerIdxs).map(Number));
      parts = halves.map((idxs) => ({
        ...base,
        text,
        options: take(q.options, idxs),
        // Re-indexed against the half it lands in: an answer key that still
        // pointed at the original positions would mark the wrong options.
        answerIdxs: idxs.map((orig, i) => (want.has(orig) ? i : -1)).filter((i) => i >= 0),
      }));
      break;
    }

    case 'match': {
      const halves = halve(list(q.pairs).length, 3);
      if (!halves) return { reason: 'match needs 3-5 pairs, and there are not enough here for two questions of three.' };
      parts = halves.map((idxs) => ({ ...base, text, pairs: take(q.pairs, idxs) }));
      break;
    }

    case 'categorise': {
      const halves = halve(list(q.buckets).length, 2);
      if (!halves) return { reason: 'categorise needs 2-4 groups, and a two-group question cannot give two groups to each half.' };
      parts = halves.map((idxs) => ({ ...base, text, buckets: take(q.buckets, idxs) }));
      break;
    }

    case 'order':
    case 'rank': {
      const halves = halve(list(q.sequence).length, 3);
      if (!halves) return { reason: `${kind} needs 3-5 items, and there are not enough here for two runs of three.` };
      // Contiguous slices, so each half is still in its own correct order.
      parts = halves.map((idxs) => ({
        ...base,
        text,
        sequence: take(q.sequence, idxs),
        ...(kind === 'rank' ? { criterion: q.criterion } : {}),
      }));
      break;
    }

    case 'cloze': {
      // Segments around the markers: n markers means n+1 pieces of prose.
      const segs = String(text).split(BLANK_MARK);
      const n = segs.length - 1;
      if (n !== 4) {
        return {
          reason: `A passage needs at least two blanks on each side of the cut, so only a four-blank one divides in two. This one has ${n}.`,
        };
      }
      // Cut immediately after the second blank. The prose between blank two and
      // blank three belongs to the second half only: left on the end of the
      // first it dangles ("...and the electrons travel to"), and repeated in
      // both it reads as the same passage asked twice.
      parts = [
        { ...base, text: opener(`${segs.slice(0, 2).join(BLANK_MARK)}${BLANK_MARK}`), blanks: list(q.blanks).slice(0, 2) },
        { ...base, text: opener(segs.slice(2).join(BLANK_MARK)), blanks: list(q.blanks).slice(2) },
      ];
      break;
    }

    default:
      return { reason: `A "${KIND_LABEL[kind] ?? kind}" cannot be split.` };
  }

  // Two rows with identical wording read as a duplicate in the bank and on the
  // phone, so where the halves share a stem they are numbered.
  if (parts[0].text === parts[1].text) {
    parts[0].text = `${text} (part 1)`;
    parts[1].text = `${text} (part 2)`;
  }

  for (const part of parts) {
    const why = invalidReason(part);
    if (why) return { reason: `Splitting this one leaves a question that is not valid: ${why}.` };
  }

  return { parts };
}

// ----------------------------------------------------------------- merge --

/**
 * Two questions into one. Only the kinds that hold a LIST of independent
 * demands can merge - pairs, groups, options - because merging is concatenating
 * that list. Everything else has a single answer or a single ordering, and
 * there is nothing in either question that says how they combine.
 *
 * @returns {{question: object} | {reason: string}}
 */
export function mergeQuestions(a, b) {
  if (!a || !b) return { reason: 'Two questions are needed to merge.' };
  if (String(a._id) === String(b._id)) return { reason: 'That is one question picked twice.' };
  if (String(a.contentId) !== String(b.contentId)) {
    return { reason: 'Those two are in different chapters, and a merged question has to belong to one bank.' };
  }
  if (a.bloom !== b.bloom) {
    return {
      reason:
        `One is tagged ${LEVEL_LABEL[a.bloom] ?? a.bloom} and the other ${LEVEL_LABEL[b.bloom] ?? b.bloom}. ` +
        'A question carries exactly one level, and the level is what chooses how it is asked - so there is no level for the merged one to be.',
    };
  }

  const kind = a.kind ?? 'mcq';
  if (kind !== (b.kind ?? 'mcq')) {
    return {
      reason:
        `One is a "${KIND_LABEL[a.kind ?? 'mcq']}" and the other a "${KIND_LABEL[b.kind ?? 'mcq']}". ` +
        `Change one to match the other first - both are on offer at ${LEVEL_LABEL[a.bloom]}.`,
    };
  }

  // The first question's wording, minus the "(part 1)" a split may have put
  // there. That marker is this file's own bookkeeping, so it goes when the parts
  // come back together - a teacher's own words are never touched.
  const merged = { ...inherit(a), text: String(a.text).replace(/\s*\(part \d+\)\s*$/i, '') };
  // Either parent being template text makes the result template text.
  merged.source = a.source === 'fallback' || b.source === 'fallback' ? 'fallback' : 'llm';
  // Either parent unreviewed makes the result unreviewed; either parent written
  // by a model makes the result partly model-written. When `a` is unreviewed,
  // inherit() has already made this a draft, so b's approval is never copied
  // onto text nobody approved.
  if (unreviewed(b)) Object.assign(merged, { status: 'draft', approvedBy: null, approvedAt: null });
  else if (!merged.approvedAt && merged.status === 'active') {
    Object.assign(merged, { approvedBy: b.approvedBy ?? null, approvedAt: b.approvedAt ?? null });
  }
  merged.model = a.model ?? b.model ?? null;
  merged.sourceRef = a.sourceRef ?? b.sourceRef ?? null;

  // What the two came to between them. Said back in a refusal, because "match
  // needs 3-5 pairs" over two questions the teacher cannot see at once leaves
  // them counting; the number they have to get down to is the whole answer.
  let size = '';

  switch (kind) {
    case 'match': {
      const pairs = [];
      const byLeft = new Map();
      const rights = new Set();
      for (const p of [...list(a.pairs), ...list(b.pairs)]) {
        const l = key(p?.left);
        const r = key(p?.right);
        const seen = byLeft.get(l);
        if (seen !== undefined) {
          // The same term matched to two different meanings has no merged
          // answer key: one of the two questions would be marked wrong.
          if (seen !== r) {
            return { reason: `"${p.left}" is matched to two different things across these questions, so there is no answer key true to both.` };
          }
          continue;
        }
        if (rights.has(r)) return { reason: `"${p.right}" is the answer to two different terms across these questions.` };
        byLeft.set(l, r);
        rights.add(r);
        pairs.push(p);
      }
      merged.pairs = pairs;
      size = `${pairs.length} pairs`;
      break;
    }

    case 'categorise': {
      // Union by group name. An item that sits in two differently-named groups
      // survives into both and the validator refuses it, which is the right
      // answer: the merged question would have no correct placement for it.
      const groups = new Map();
      for (const bucket of [...list(a.buckets), ...list(b.buckets)]) {
        const k = key(bucket?.name);
        const into = groups.get(k) ?? { name: bucket?.name, items: [] };
        const seen = new Set(into.items.map(key));
        for (const item of list(bucket?.items)) if (!seen.has(key(item))) into.items.push(item);
        groups.set(k, into);
      }
      merged.buckets = [...groups.values()];
      size = `${merged.buckets.length} groups and ${merged.buckets.reduce((n, g) => n + g.items.length, 0)} items`;
      break;
    }

    case 'multi': {
      const options = [];
      const texts = new Map();
      const right = new Set();
      const wrong = new Set();
      for (const q of [a, b]) {
        const want = new Set(list(q.answerIdxs).map(Number));
        list(q.options).forEach((option, i) => {
          const k = key(option);
          if (!texts.has(k)) {
            texts.set(k, option);
            options.push(option);
          }
          (want.has(i) ? right : wrong).add(k);
        });
      }
      const clash = [...right].find((k) => wrong.has(k));
      if (clash) {
        return {
          reason: `"${texts.get(clash)}" is correct in one of these and wrong in the other, so there is no merged answer key true to both.`,
        };
      }
      merged.options = options;
      merged.answerIdxs = options.map((o, i) => (right.has(key(o)) ? i : -1)).filter((i) => i >= 0);
      size = `${options.length} options`;
      break;
    }

    case 'mcq':
      return {
        reason:
          'Two "Choose one" questions cannot merge: the result would have eight options and two correct answers, and a "Choose one" has exactly four and one.',
      };

    case 'order':
    case 'rank':
      return {
        reason:
          `Nothing in either question says how one ${kind === 'rank' ? 'ranking' : 'sequence'} sits inside the other, so a merged order would be invented rather than checked.`,
      };

    case 'open':
      return {
        reason:
          'Each of these asks its own question and is marked against its own rubric. Merged, one stem would be marked against points nobody was asked for.',
      };

    default:
      return {
        reason: `A "${KIND_LABEL[kind] ?? kind}" has one answer to give, so there is nothing in two of them to join.`,
      };
  }

  const clean = tidied(merged);
  const why = invalidReason(clean);
  if (why) return { reason: `Between them these two make ${size}, and ${why}. Trim one of them first.` };
  return { question: clean };
}

// ---------------------------------------------------------------- status --
//
// Three statuses. 'active' is served in rooms. 'draft' is a generated question
// no professor has approved yet, and is never served. 'discarded' is rejected or
// replaced. Every way a question becomes active goes through one of the two
// functions below, so none of them can let model output into a room without an
// approval on record.

/**
 * Model output that nobody has approved: a draft, or a rejected draft. A row
 * with no model is a professor's own question or older than the approval gate,
 * and has never needed one.
 */
export const needsApproval = (q) => q?.model != null && !q?.approvedAt;

/**
 * Approve: active, stamped with who and when. Approving an active question that
 * carries no approval records one (an older question a professor has now looked
 * at); approving one already approved changes nothing, so a repeat is safe.
 *
 * @returns {{patch: object, changed: boolean}}
 */
export function approvePatch(q, { by = null, at = new Date().toISOString() } = {}) {
  if (q?.status === 'active' && q?.approvedAt) return { patch: {}, changed: false };
  return { patch: { status: 'active', approvedBy: by, approvedAt: at }, changed: true };
}

/** Reject: the existing discarded status, so a restore can bring it back. */
export function rejectPatch(q) {
  if (q?.status === 'discarded') return { patch: {}, changed: false };
  return { patch: { status: 'discarded' }, changed: true };
}

/**
 * Make a question active by the older routes - a PATCH of status 'active' (the
 * console's "restore") or a bulk restore. For model output nobody has approved,
 * that IS the approval, so it is stamped as one; for everything else it is
 * exactly the plain status change it always was.
 */
export function activatePatch(q, { by = null, at = new Date().toISOString() } = {}) {
  return needsApproval(q) ? { status: 'active', approvedBy: by, approvedAt: at } : { status: 'active' };
}
