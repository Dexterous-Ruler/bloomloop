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

import { LEVELS, LABEL, DEFAULT_MIX } from '../bloom.js';
import { KIND_FOR_LEVEL, LABEL as KIND_LABEL, kindSuitsLevel } from '../questionTypes.js';

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
 *   spec.weights   optional per-topic relative weight (same length as topics)
 *
 * @returns {{topics, total, perLevel, perKind, warnings, needsConfirm}}
 */
export function planBank(topics, spec = {}) {
  const list = (Array.isArray(topics) ? topics : []).map((t) => String(t ?? '').trim()).filter(Boolean);
  const warnings = [];

  if (list.length === 0) {
    return { topics: [], total: 0, perLevel: {}, perKind: {}, warnings: ['No topics selected.'], needsConfirm: false };
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
  const asked = spec.kinds && typeof spec.kinds === 'object' ? spec.kinds : {};
  const kinds = { ...KIND_FOR_LEVEL };
  LEVELS.forEach((level) => {
    const raw = asked[level];
    if (raw === undefined || raw === null || raw === '') return;
    // Case is normalised, not repaired, exactly as the generator normalises a
    // bloom tag: "Mcq" names one kind and only one. Anything that still is not
    // in this level's set is refused below rather than coerced into something.
    const want = String(raw).trim().toLowerCase();
    if (kindSuitsLevel(want, level)) kinds[level] = want;
    else {
      warnings.push(
        `${LABEL[level]} cannot be asked as "${KIND_LABEL[want] ?? want}" - kept ${KIND_LABEL[kinds[level]]}.`,
      );
    }
  });

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

  // Recount from what was actually planned, since trimming may have shed some.
  const finalPerLevel = LEVELS.reduce((a, l) => ({ ...a, [l]: 0 }), {});
  const perKind = {};
  planned.forEach((t) => {
    LEVELS.forEach((l) => {
      finalPerLevel[l] += t.mix[l];
      perKind[kinds[l]] = (perKind[kinds[l]] || 0) + t.mix[l];
    });
  });
  Object.assign(perLevel, finalPerLevel);

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
    kinds,
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
