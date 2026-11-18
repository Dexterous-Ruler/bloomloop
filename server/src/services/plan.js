// The generation plan: the teacher decides the size and shape of the bank
// BEFORE anything is written.
//
// This exists because the opposite happened. The old path applied a fixed
// twelve-per-topic default to however many topics were ticked, silently
// truncated to the first twelve topics, and then APPENDED on every run - which
// is how one deck ended up with 864 questions across six presses of a button
// labelled "regenerate". The teacher never chose any of those numbers.
//
// Pure functions, no I/O: the same math answers the live preview in the browser
// and the actual run on the server, so what the teacher is shown is what they get.

import { LEVELS, LABEL, DEFAULT_MIX, CEILING } from '../bloom.js';
import { KINDS_FOR_LEVEL, DEFAULT_KIND_MIX, LABEL as KIND_LABEL, kindSuitsLevel } from '../questionTypes.js';
import { isSelectedResponse } from './checks.js';

/** Above this a run stops being "before class" and becomes a coffee break. */
export const HARD_CAP = 200;
/** Above this the teacher has to say yes on purpose. */
export const CONFIRM_ABOVE = 120;
/** A single topic beyond this is a sign the plan is wrong, not ambitious. */
export const MAX_PER_TOPIC = 30;

/**
 * Shapes, expressed as relative weights across the six levels. The teacher
 * picks a shape and a size; the two are independent, which is what makes the
 * control comprehensible.
 */
export const PRESETS = {
  balanced: { label: 'Balanced', hint: 'Every level represented, weighted low', mix: { ...DEFAULT_MIX } },
  foundations: {
    label: 'Foundations',
    hint: 'For a class that is still securing the basics',
    mix: { remember: 4, understand: 4, apply: 2, analyse: 1, evaluate: 1, create: 0 },
  },
  higher: {
    label: 'Higher-order',
    hint: 'For revision, once recall is solid',
    mix: { remember: 1, understand: 2, apply: 3, analyse: 3, evaluate: 2, create: 1 },
  },
  recall: {
    label: 'Recall check',
    hint: 'A fast pulse on whether the reading was done',
    mix: { remember: 5, understand: 4, apply: 2, analyse: 1, evaluate: 0, create: 0 },
  },
};

const totalOf = (mix) => LEVELS.reduce((n, l) => n + (Number(mix?.[l]) || 0), 0);

// ------------------------------------------------------------- kind mix --

/**
 * May this level be asked through this kind? Its own set, and never a
 * selected-response kind at Create: a format sets the ceiling on the level an
 * item can reach, and picking from offered options does not reach Create
 * (Crowe et al. 2008). Create's set holds only the written answer today, so the
 * second half refuses nothing yet - it is here so that widening a set can never
 * quietly put an mcq under a Create tag.
 */
export const kindAllowedAt = (kind, level) =>
  kindSuitsLevel(kind, level) && !(level === CEILING && isSelectedResponse(kind));

/**
 * One level's kind weights, cleaned: only kinds the level allows, only positive
 * finite weights, rebuilt in the order of the level's own set so a tie always
 * goes to the earlier kind - which makes the level's default win a one-item run.
 * Returns the kinds it refused alongside, so a caller can say so.
 */
export function cleanKindWeights(level, raw) {
  const weights = {};
  const refused = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { weights, refused };
  const asked = {};
  for (const [k, w] of Object.entries(raw)) asked[String(k).trim().toLowerCase()] = Number(w);
  for (const [kind, w] of Object.entries(asked)) {
    if (!kindAllowedAt(kind, level)) refused.push({ kind, why: 'level' });
    else if (!Number.isFinite(w) || w < 0) refused.push({ kind, why: 'weight' });
  }
  for (const kind of KINDS_FOR_LEVEL[level] ?? []) {
    const w = asked[kind];
    if (kindAllowedAt(kind, level) && Number.isFinite(w) && w > 0) weights[kind] = w;
  }
  return { weights, refused };
}

/**
 * Hand out `n` questions of one level across its kinds in the proportions of
 * `weights`, one at a time, by smooth weighted round-robin.
 *
 * `carry` is the running score per kind and is mutated, so passing the same
 * object for every topic continues the rotation from one topic to the next.
 * That is the point of it: a level given one question per topic would
 * otherwise open every topic on the same kind, and a bank of six topics would
 * ask Evaluate six times as "Put these in order" and never as "Rank them". Over
 * any run of W picks (W the sum of whole-number weights) each kind is picked
 * exactly its weight's worth of times, so counts handed in as weights come back
 * as exactly those counts.
 *
 * @returns {string[]} n kinds, in the order they should be filled
 */
export function spreadKinds(weights, n, carry = {}) {
  const kinds = Object.keys(weights ?? {}).filter((k) => Number(weights[k]) > 0);
  const total = kinds.reduce((s, k) => s + Number(weights[k]), 0);
  const out = [];
  if (!kinds.length || total <= 0) return out;
  for (let i = 0; i < n; i += 1) {
    let best = null;
    for (const k of kinds) {
      carry[k] = (carry[k] ?? 0) + Number(weights[k]);
      if (best === null || carry[k] > carry[best]) best = k;
    }
    carry[best] -= total;
    out.push(best);
  }
  return out;
}

/** A list of kinds as counts: ['mcq', 'truefalse', 'mcq'] -> {mcq: 2, truefalse: 1}. */
export const countKinds = (list) => list.reduce((a, k) => ({ ...a, [k]: (a[k] || 0) + 1 }), {});

const kindNames = (weights) => Object.keys(weights).map((k) => KIND_LABEL[k] ?? k).join(' and ');

/**
 * What the teacher asked for, per level, as kind weights.
 *
 *   spec.kindMix  { level: { kind: weight } } - several kinds, in proportion
 *   spec.kinds    { level: 'kind' }           - the whole level as one kind
 *
 * kindMix wins where both name a level. A level neither names gets
 * DEFAULT_KIND_MIX. Anything outside a level's own set is refused out loud and
 * the level keeps its default, for the reason given at the call in planBank.
 */
export function resolveKindMix(spec = {}, warnings = []) {
  const mixAsked = spec.kindMix && typeof spec.kindMix === 'object' ? spec.kindMix : {};
  const oneAsked = spec.kinds && typeof spec.kinds === 'object' ? spec.kinds : {};
  const out = {};

  LEVELS.forEach((level) => {
    const fallback = { ...DEFAULT_KIND_MIX[level] };
    const rawMix = mixAsked[level];
    const rawOne = oneAsked[level];

    if (rawMix !== undefined && rawMix !== null) {
      const { weights, refused } = cleanKindWeights(level, rawMix);
      for (const { kind, why } of refused) {
        warnings.push(
          why === 'weight'
            ? `${LABEL[level]}: "${KIND_LABEL[kind] ?? kind}" needs a weight of zero or more - left out.`
            : `${LABEL[level]} cannot be asked as "${KIND_LABEL[kind] ?? kind}" - left out of the mix.`,
        );
      }
      if (Object.keys(weights).length) {
        out[level] = weights;
        return;
      }
      warnings.push(`${LABEL[level]} was given no kind it can be asked as - kept ${kindNames(fallback)}.`);
      out[level] = fallback;
      return;
    }

    if (rawOne !== undefined && rawOne !== null && rawOne !== '') {
      // Case is normalised, not repaired, exactly as the generator normalises a
      // bloom tag: "Mcq" names one kind and only one. Anything that still is not
      // in this level's set is refused rather than coerced into something.
      const want = String(rawOne).trim().toLowerCase();
      if (kindAllowedAt(want, level)) {
        out[level] = { [want]: 1 };
        return;
      }
      warnings.push(`${LABEL[level]} cannot be asked as "${KIND_LABEL[want] ?? want}" - kept ${kindNames(fallback)}.`);
    }
    out[level] = fallback;
  });

  return out;
}

/**
 * Split `total` across the six levels in the proportions of `weights`, using
 * largest-remainder so the parts sum to exactly `total` and the shape is
 * preserved rather than drifting to whichever level rounds up first.
 */
function apportion(weights, total) {
  const weightTotal = totalOf(weights);
  if (weightTotal <= 0 || total <= 0) return LEVELS.reduce((a, l) => ({ ...a, [l]: 0 }), {});

  const exact = LEVELS.map((l) => ((Number(weights[l]) || 0) / weightTotal) * total);
  const out = {};
  let used = 0;
  LEVELS.forEach((l, i) => {
    out[l] = Math.floor(exact[i]);
    used += out[l];
  });

  // Hand the leftovers to the largest fractional parts.
  LEVELS.map((l, i) => ({ l, frac: exact[i] - Math.floor(exact[i]) }))
    .sort((a, b) => b.frac - a.frac)
    .slice(0, Math.max(0, total - used))
    .forEach(({ l }) => { out[l] += 1; });

  return out;
}

/**
 * Resolve what the teacher asked for into an exact per-topic plan.
 *
 * @param {string[]} topics    the topics they ticked
 * @param {object}   spec
 *   spec.total     total questions across the whole bank (preferred control)
 *   spec.perTopic  or a fixed number for every topic
 *   spec.preset    a key of PRESETS, default 'balanced'
 *   spec.mix       explicit weights per level, overrides the preset
 *   spec.kinds     pick a level's interaction from that level's own set; a kind
 *                  belonging to another level is refused, not applied
 *   spec.kindMix   or spread a level over several kinds of its own set, as
 *                  relative weights; a level left out gets DEFAULT_KIND_MIX
 *   spec.weights   optional per-topic relative weight (same length as topics)
 *
 * The kind mix only ever divides a level's count; it never changes it. Sizes,
 * levels and topics are decided exactly as before the mix existed.
 *
 * @returns {{topics, total, perLevel, perKind, perLevelKind, kinds, kindMix, warnings, needsConfirm}}
 *          each topic also carries `kinds`: { level: { kind: count } }
 */
export function planBank(topics, spec = {}) {
  const list = (Array.isArray(topics) ? topics : []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const warnings = [];

  if (list.length === 0) {
    return { topics: [], total: 0, perLevel: {}, perKind: {}, perLevelKind: {}, warnings: ['No topics selected.'], needsConfirm: false };
  }

  const shape = spec.mix && totalOf(spec.mix) > 0 ? spec.mix : (PRESETS[spec.preset] ?? PRESETS.balanced).mix;

  // Size: an explicit total is the headline control; perTopic is the escape
  // hatch for someone who thinks per-topic. One of them, never both.
  let total;
  if (Number.isFinite(Number(spec.total)) && Number(spec.total) > 0) {
    total = Math.round(Number(spec.total));
  } else if (Number.isFinite(Number(spec.perTopic)) && Number(spec.perTopic) > 0) {
    total = Math.round(Number(spec.perTopic)) * list.length;
  } else {
    total = totalOf(shape) * list.length;
  }

  if (total > HARD_CAP) {
    warnings.push(`Asked for ${total}; capped at ${HARD_CAP} so the run finishes before class does.`);
    total = HARD_CAP;
  }
  if (total < list.length) {
    warnings.push(`${list.length} topics but only ${total} questions - some topics will get none.`);
  }

  // Apportion the LEVELS first, across the whole bank, then spread each level's
  // share over the topics. Doing it the other way - shape each topic
  // independently - rounds the shape away: "balanced" over six topics of five
  // questions collapsed to a flat 6/6/6/6/6/0, because 5 x 1/12 floors to zero
  // at every level and the remainders all landed in the same places.
  const perLevel = apportion(shape, total);

  // Per-topic weights let a long chapter earn more than a one-slide aside.
  const weights = Array.isArray(spec.weights) && spec.weights.length === list.length
    ? spec.weights.map((w) => Math.max(0, Number(w) || 0))
    : list.map(() => 1);
  const weightTotal = weights.reduce((a, b) => a + b, 0) || list.length;

  const mixes = list.map(() => LEVELS.reduce((a, l) => ({ ...a, [l]: 0 }), {}));
  const evenWeights = weights.every((w) => w === weights[0]);
  // One cursor shared by all six levels. Every leftover question goes to the
  // next topic in line and the cursor keeps its place across levels, so the
  // per-topic totals come out level. Giving each level its own starting offset
  // instead produced a wave - some topics got 5 while others got 1.
  let cursor = 0;

  LEVELS.forEach((level) => {
    const n = perLevel[level];
    if (n <= 0) return;
    const exact = weights.map((w) => (w / weightTotal) * n);
    const share = exact.map(Math.floor);
    const leftover = n - share.reduce((a, b) => a + b, 0);

    if (evenWeights) {
      for (let k = 0; k < leftover; k += 1) {
        share[cursor % list.length] += 1;
        cursor += 1;
      }
    } else {
      // Uneven weights: largest remainder, which respects the weighting.
      exact
        .map((v, i) => ({ i, frac: v - Math.floor(v) }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i)
        .slice(0, Math.max(0, leftover))
        .forEach(({ i }) => { share[i] += 1; });
    }
    share.forEach((count, i) => { mixes[i][level] += count; });
  });

  // A level may be asked through any kind in its OWN set and no other. That is
  // the whole thesis: swapping inside a set changes the surface, swapping across
  // levels makes the taxonomy decorative - a Remember item asked as an open
  // response has stopped being a Remember item. So a cross-level request is
  // dropped and said out loud, rather than quietly obeyed because a caller sent
  // it. The console cannot produce one; the HTTP API can.
  const kindMix = resolveKindMix(spec, warnings);

  const planned = list.map((topic, i) => {
    const mix = mixes[i];
    let count = totalOf(mix);
    if (count > MAX_PER_TOPIC) {
      // Trim from the top of the ladder down: losing a Create item hurts the
      // bank less than losing the recall floor a struggling student needs.
      for (let li = LEVELS.length - 1; li >= 0 && count > MAX_PER_TOPIC; li -= 1) {
        const take = Math.min(mix[LEVELS[li]], count - MAX_PER_TOPIC);
        mix[LEVELS[li]] -= take;
        count -= take;
      }
      warnings.push(`"${topic}" trimmed to ${MAX_PER_TOPIC} questions.`);
    }
    return { topic, count: totalOf(mix), mix };
  });

  // Each topic's share of a level divided over the level's kinds, AFTER the
  // trim so the two always agree. One rotation per level runs across every
  // topic in order, so a level that gets one question a topic alternates its
  // kinds from topic to topic instead of opening each one on the same kind.
  const carry = LEVELS.reduce((a, l) => ({ ...a, [l]: {} }), {});
  planned.forEach((t) => {
    t.kinds = {};
    LEVELS.forEach((l) => {
      if (t.mix[l] > 0) t.kinds[l] = countKinds(spreadKinds(kindMix[l], t.mix[l], carry[l]));
    });
  });

  // Recount from what was actually planned, since trimming may have shed some.
  const finalPerLevel = LEVELS.reduce((a, l) => ({ ...a, [l]: 0 }), {});
  const perKind = {};
  const perLevelKind = LEVELS.reduce((a, l) => ({ ...a, [l]: {} }), {});
  planned.forEach((t) => {
    LEVELS.forEach((l) => {
      finalPerLevel[l] += t.mix[l];
      for (const [k, n] of Object.entries(t.kinds[l] ?? {})) {
        perKind[k] = (perKind[k] || 0) + n;
        perLevelKind[l][k] = (perLevelKind[l][k] || 0) + n;
      }
    });
  });
  Object.assign(perLevel, finalPerLevel);

  // The one kind each level leans on most, for any caller that still reads a
  // single kind per level: the kind with the most questions at that level, or,
  // at a level with none, the one the mix would open on.
  const kinds = {};
  LEVELS.forEach((l) => {
    const counted = Object.entries(perLevelKind[l]);
    kinds[l] = counted.length
      ? counted.reduce((best, cur) => (cur[1] > best[1] ? cur : best))[0]
      : spreadKinds(kindMix[l], 1, {})[0];
  });

  const realTotal = planned.reduce((n, t) => n + t.count, 0);

  // Say it plainly rather than letting a teacher discover that half the topics
  // they ticked produced nothing.
  const empty = planned.filter((t) => t.count === 0).length;
  if (empty > 0) {
    warnings.push(
      `${empty} of ${list.length} topics get no questions at this size. Raise the total to about ${list.length * 3}, or select fewer topics.`,
    );
  }

  return {
    topics: planned,
    total: realTotal,
    perLevel,
    perKind,
    perLevelKind,
    kinds,
    kindMix,
    warnings,
    needsConfirm: realTotal > CONFIRM_ABOVE,
    // Measured from real runs: topics go three at a time, and a topic costs
    // roughly six seconds plus a second per question it has to write.
    estimateSeconds: Math.max(
      8,
      Math.round((planned.filter((t) => t.count > 0).length / 3) * 6 + realTotal * 0.9),
    ),
  };
}

/** Human summary of a plan, used in the UI and in warnings. */
export function describePlan(plan) {
  const levels = LEVELS.filter((l) => plan.perLevel[l] > 0)
    .map((l) => `${LABEL[l]} ${plan.perLevel[l]}`)
    .join(' · ');
  const kinds = Object.entries(plan.perKind)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`)
    .join(' · ');
  return { levels, kinds };
}
