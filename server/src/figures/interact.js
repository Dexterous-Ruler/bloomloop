// What the five interaction kinds (Batch 8) need from a figure or a professor's
// picture: the parts a student may tap or label, under names that give nothing
// away; the grid a phone turns a tap into numbers with; the marking of placed
// points, lines, number-line marks and bars; and the values a figure itself
// settles, so the server can work a key out instead of trusting one.
//
// The names matter. A part's own name is whatever the professor (or a model)
// called it - "nucleus", "maximum", "root" - and the drawing carries it in
// data-part and id attributes, and a geometry description reads an unlabelled
// point out by it. So a student's copy of a tap or label figure is drawn from a
// copy of the spec with every name replaced by a token (z0, z1, ...) in an order
// shuffled per student, and any name the drawing makes up itself (a chart's
// bars, a molecule's groups, a ray diagram's parts) is retagged the same way
// afterwards. The server can always work the tokens back out from the seed, so
// it never has to remember them, and the phone never learns a real name.
//
// The figure is drawn once under stand-in names (not once per student, which
// laid out a 25-box diagram sixty times for one room and churned the render
// cache), and each student's copy is that drawing with the stand-ins swapped
// for their own tokens, as text.
//
// Pure apart from rendering, which is synchronous once the engines are loaded.

import { scaleLinear } from 'd3-scale';

import { safeSvg, fmt } from './common.js';
import { normaliseSpec, FAMILIES } from './spec.js';
import { renderFigure, figureForStudent, specHash } from './index.js';
import { plotFrame, axisStep, evaluate, equation } from './plot.js';
import { numberlineFrame } from './numberline.js';

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const low = (v) => String(v ?? '').toLowerCase();

/**
 * A number a phone sent: a number, or text that is one ("3,000" too). Never a
 * blank, null or true, which Number() reads as 0 or 1: a bar left empty, or a
 * mark with no place, is no answer, not an answer of 0.
 */
export function numberOf(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return NaN;
  const t = v.replace(/[\s,]/g, '');
  return t === '' ? NaN : Number(t);
}

/**
 * "Within a grid step" means closer than the next grid line: a placed point one
 * whole step away is on a different line and is wrong. The factor keeps a point
 * exactly one step off from creeping under the bar through floating-point
 * rounding (0.3 - 0.2 is 0.09999999999999998).
 */
const UNDER = 1 - 1e-6;
/** A stated tolerance is inclusive, as numeric's is; this absorbs the same rounding. */
const SLACK = 1e-9;

/** Off by less than one step, or by no more than a stated tolerance. */
export function near(a, b, step, tolerance = null) {
  if (!finite(a) || !finite(b)) return false;
  const d = Math.abs(a - b);
  return tolerance === null || tolerance === undefined ? d < step * UNDER : d <= tolerance + SLACK;
}

/* ------------------------------------------------------------- the board -- */

/**
 * What a tap or label question is asked on: a drawn figure's parts, or a
 * picture's regions. Null when the stimulus is neither.
 *
 * `pending` is true for a diagram or molecule asked for before the engines have
 * loaded: its parts are not known yet, and a validator should not refuse on that
 * (the save path waits for the engines, as checkFigure does).
 */
export function boardOf(stimulus) {
  if (stimulus?.kind === 'image') {
    const regions = Array.isArray(stimulus.regions) ? stimulus.regions : [];
    return { kind: 'image', ids: regions.map((r) => r.id), regions, pending: false };
  }
  if (stimulus?.kind === 'figure') {
    const { spec } = normaliseSpec(stimulus.spec);
    if (!spec) return null;
    const r = renderFigure(spec);
    return {
      kind: 'figure', spec, ids: r.ok ? r.parts.map((p) => p.part) : [], parts: r.ok ? r.parts : [], pending: Boolean(r.pending),
    };
  }
  return null;
}

/** Find an id on a board, ignoring case as the figure checks do; the board's own spelling, or null. */
export const idOn = (board, id) => board.ids.find((b) => low(b) === low(id)) ?? null;

/**
 * The words a figure shows for a part, or '': what its renderer wrote beside it
 * or named it by in the description (each part's `drawn`), which is more than
 * the spec's own label: an unlabelled curve has its equation written beside it,
 * and a ray diagram always writes "Object" and "Image". A label question's
 * target must have none: the drawing would be showing the answer it asks for.
 */
export function drawnLabel(board, id) {
  const part = (board?.parts ?? []).find((p) => low(p.part) === low(id));
  return String(part?.drawn ?? '');
}

/** The figure types a label question may be asked on: their parts can be drawn without words. */
export const LABEL_FIGURES = ['plot', 'numberline', 'geometry'];

/* ---------------------------------------------------------------- tokens -- */

/** Every id the spec itself names, in reading order. */
function idsIn(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => idsIn(v, out));
  else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'steps') continue;
      if (k === 'id' && typeof v === 'string') out.push(v);
      else idsIn(v, out);
    }
  }
  return out;
}

/**
 * Every name a student could learn something from, and the token each becomes
 * for this student. `shuffle(n)` is the caller's seeded permutation, so the
 * same student always gets the same tokens and the server can recompute them.
 *
 * @returns {{ tokenOf: Map<string,string>, idOf: Map<string,string> }} keyed by lower-case name / by token
 */
export function tokensFor(board, shuffle) {
  const names = namesOn(board);
  const perm = shuffle(names.length);
  const tokenOf = new Map();
  const idOf = new Map();
  perm.forEach((orig, pos) => {
    tokenOf.set(low(names[orig]), `z${pos}`);
    idOf.set(`z${pos}`, names[orig]);
  });
  return { tokenOf, idOf };
}

/** Every name on a board, each once, in reading order: the spec's ids, then the parts the drawing made up. */
function namesOn(board) {
  const names = [];
  const seen = new Set();
  const add = (n) => {
    if (typeof n !== 'string' || seen.has(low(n))) return;
    seen.add(low(n));
    names.push(n);
  };
  if (board.kind === 'figure') idsIn(board.spec).forEach(add);
  board.ids.forEach(add);
  return names;
}

/** The keys that hold a reference to another part's id. */
const REF_KEYS = new Set(['id', 'from', 'to', 'through', 'centre', 'at', 'under']);

/** A copy of a spec with every id, and every reference to one, swapped for its token. Steps are left behind. */
function renamed(value, key, tokenOf) {
  const swap = (s) => tokenOf.get(low(s)) ?? s;
  if (Array.isArray(value)) {
    // A polygon's corners are named points; a plot's points are objects, so only bare strings here are names.
    return value.map((v) => (key === 'points' && typeof v === 'string' ? swap(v) : renamed(v, null, tokenOf)));
  }
  if (isObj(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'steps') continue;
      out[k] = REF_KEYS.has(k) && typeof v === 'string' ? swap(v) : renamed(v, k, tokenOf);
    }
    return out;
  }
  return value;
}

/**
 * Names the drawing made up itself (a bar, a molecule's group, a lens) are still
 * in the picture after renaming; each is retagged here, in its data-part and the
 * id beside it. A name with no token loses the attribute rather than keep it.
 * `isToken` says which parts already carry a token (or a stand-in).
 */
function retag(svg, tokenOf, isToken = (part) => /^z\d+$/.test(part)) {
  return svg.replace(/<[A-Za-z][^<>]*\sdata-part="([^"]*)"[^<>]*>/g, (tag, part) => {
    if (isToken(part)) return tag;
    const tok = tokenOf.get(low(part));
    return tag
      .replace(` data-part="${part}"`, tok ? ` data-part="${tok}"` : '')
      .replace(/ id="([^"]*)"/, (whole, id) => {
        if (!id.endsWith(`-${part}`)) return whole;
        return tok ? ` id="${id.slice(0, id.length - part.length)}${tok}"` : '';
      });
  });
}

/**
 * The stimulus and the zones a phone gets for a tap or label question: the
 * figure drawn under tokens (or the picture as it always goes), and one zone per
 * part that may be tapped or labelled, in token order. `only` limits the zones
 * to those ids (a label question's targets); null offers every part.
 *
 * An image's zones carry their outlines, in percentages of the picture, because
 * the phone has nothing else to find them by; never their names or labels.
 */
export function zonesFor(stimulus, board, shuffle, only = null) {
  const { tokenOf } = tokensFor(board, shuffle);
  const wanted = (only ?? board.ids).map(low);
  const tokens = wanted.map((id) => tokenOf.get(id)).filter(Boolean)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  if (board.kind === 'image') {
    const byToken = new Map(board.regions.map((r) => [tokenOf.get(low(r.id)), r]));
    return {
      stimulus: { kind: 'image', url: stimulus.url, alt: stimulus.alt ?? '' },
      zones: tokens.map((zone) => ({ zone, points: byToken.get(zone).points.map(([x, y]) => [x, y]) })),
    };
  }
  const once = drawnOnce(board);
  let view;
  let svg;
  if (once) {
    // The one drawing, its stand-ins swapped for this student's tokens.
    const tokenAt = once.names.map((n) => tokenOf.get(low(n)) ?? '');
    const swap = (text) => String(text ?? '').replace(once.pattern, (_, i) => tokenAt[Number(i)] ?? '');
    const t = once.view.table;
    view = {
      ...once.view,
      title: swap(once.view.title),
      description: swap(once.view.description),
      table: t ? { caption: swap(t.caption), columns: t.columns.map(swap), rows: t.rows.map((r) => r.map(swap)) } : t,
    };
    svg = once.view.svg ? swap(once.view.svg) : once.view.svg;
  } else {
    // No stand-in is free of the figure's own words (a professor wrote one in a
    // label): drawn for this student, as it always could be.
    view = figureForStudent(renamed(board.spec, null, tokenOf));
    svg = view.svg ? retag(view.svg, tokenOf) : view.svg;
  }
  return {
    // A retagged picture that somehow failed the check goes without its picture rather than unchecked.
    stimulus: { ...view, svg: svg && safeSvg(svg) ? svg : null },
    zones: tokens.map((zone) => ({ zone })),
  };
}

/** Letter pairs no English word and no number holds, for the stand-in names a figure is drawn under. */
const STAND_INS = ['zq', 'qz', 'xq', 'qx', 'jq', 'qj', 'vq', 'qv'];
const DRAWN_ONCE = 200;
const drawnCache = new Map();

/**
 * A tap or label figure drawn once for every student: every name swapped for a
 * stand-in (zq0, zq1, ... in reading order), made-up parts retagged the same
 * way. Null when every stand-in already appears in the figure's own words, so a
 * swap could not tell the two apart. Cached by the spec.
 *
 * @returns {{ names: string[], pattern: RegExp, view: object } | null}
 */
function drawnOnce(board) {
  const key = specHash(board.spec);
  if (drawnCache.has(key)) return drawnCache.get(key);
  const names = namesOn(board);
  const plain = renderFigure(board.spec);
  const words = low(`${JSON.stringify(board.spec)} ${plain.svg ?? ''} ${plain.title} ${plain.description} ${JSON.stringify(plain.table)}`);
  const stem = STAND_INS.find((x) => !words.includes(x));
  let out = null;
  if (stem) {
    const standIn = new Map(names.map((n, i) => [low(n), `${stem}${i}`]));
    const isStandIn = (part) => new RegExp(`^${stem}\\d+$`).test(part);
    const view = figureForStudent(renamed(board.spec, null, standIn));
    out = {
      names,
      pattern: new RegExp(`${stem}(\\d+)(?!\\d)`, 'g'),
      view: { ...view, svg: view.svg ? retag(view.svg, standIn, isStandIn) : view.svg },
    };
  }
  // A drawing that could not be made yet (the engines still loading) is not kept.
  if (!plain.pending) {
    if (drawnCache.size >= DRAWN_ONCE) drawnCache.delete(drawnCache.keys().next().value);
    drawnCache.set(key, out);
  }
  return out;
}

/** A token a phone sent, back to the id it stands for; null for anything else. */
export function idForToken(board, shuffle, token) {
  if (typeof token !== 'string') return null;
  return tokensFor(board, shuffle).idOf.get(token) ?? null;
}

/** An id, as the token this student was shown for it. */
export function tokenForId(board, shuffle, id) {
  return tokensFor(board, shuffle).tokenOf.get(low(id)) ?? null;
}

/* ------------------------------------------------------------------ grids -- */

/**
 * The plot's axes and where they sit in its picture: what a phone needs to turn
 * a tap into x and y (and to snap to the grid if it wants to).
 */
export function plotGrid(spec) {
  const { W, H, m } = plotFrame(spec);
  return {
    x: { min: spec.x.min, max: spec.x.max, step: axisStep(spec.x) },
    y: { min: spec.y.min, max: spec.y.max, step: axisStep(spec.y) },
    frame: { width: W, height: H, left: m.l, right: W - m.r, top: m.t, bottom: H - m.b },
  };
}

/** The number line's range, its tick gap and where the line sits in its picture. */
export function numberlineGrid(spec) {
  const f = numberlineFrame(spec);
  return {
    min: spec.min,
    max: spec.max,
    step: spec.step,
    frame: { width: f.W, height: f.H + (spec.points.some((p) => p.label) ? 14 : 0), left: f.left, right: f.right, y: f.axisY },
  };
}

/* ------------------------------------------------------------------- plot -- */

export const PLOT_PLACES = ['points', 'line'];
export const PLOT_RULES = ['through', 'slope', 'intercept'];
export const SLOPE_SIGNS = ['positive', 'negative', 'zero'];
export const MAX_PLOT_POINTS = 8;
export const MAX_CONDITIONS = 4;

const pairOf = (p) => (Array.isArray(p) && p.length === 2 ? p : isObj(p) ? [p.x, p.y] : null);
const onGrid = (p, spec) => p[0] >= spec.x.min && p[0] <= spec.x.max && p[1] >= spec.y.min && p[1] <= spec.y.max;

/** A key's function, as a plot figure's function would be stored, or a reason. */
function keyFunction(f) {
  if (!isObj(f)) return { reason: 'the function a plot is marked against needs a family and its numbers' };
  if (!Object.keys(FAMILIES).includes(f.family) || f.family === 'step') {
    return { reason: `a plot's function must be one of ${Object.keys(FAMILIES).filter((k) => k !== 'step').join(', ')}` };
  }
  const params = f.params ?? {};
  if (!isObj(params)) return { reason: 'a plot function\'s numbers must be named' };
  const out = {};
  for (const k of Object.keys(params)) if (!(k in FAMILIES[f.family])) return { reason: `a ${f.family} function has no number called ${k}` };
  for (const [k, d] of Object.entries(FAMILIES[f.family])) {
    const v = params[k] ?? d;
    if (!finite(v)) return { reason: `a plot function's ${k} must be a number` };
    out[k] = v;
  }
  if ((f.family === 'exponential' || f.family === 'logarithmic') && (out.base <= 0 || out.base === 1)) return { reason: 'a plot function\'s base must be positive and not 1' };
  return { fn: { family: f.family, params: out } };
}

/**
 * A plot key with its function's numbers filled in from the family's defaults,
 * as the validator reads it (keyFunction): `{ family: 'linear', params: { m: 2 } }`
 * is y = 2x, and is stored and marked as { m: 2, c: 0 }. Anything that is not a
 * readable function form comes back as it was, for the validator to refuse.
 */
export function normalisePlotKey(key) {
  if (!isObj(key) || !isObj(key.function)) return key;
  const { fn } = keyFunction(key.function);
  return fn ? { ...key, function: fn } : key;
}

/**
 * How far conditions go towards fixing one line. A line has two degrees of
 * freedom: each point it must pass through, a stated intercept and a stated
 * slope (zero included) take one away; a slope's sign only narrows it. Two or
 * more and there is at most one line left to draw.
 */
const pinsOf = (conditions) => conditions.filter((c) => c.rule !== 'slope' || c.value !== undefined || c.sign === 'zero').length;

/**
 * Is this a plot key that can be marked on this graph? Exactly one of three
 * forms: the points to place, the function they must lie on, or (for a line)
 * conditions a drawn line must meet. A Create question must be the last, and
 * its conditions must leave more than one line: a single right answer to place
 * is Apply, whatever it is tagged.
 */
export function plotKeyReason(key, spec, bloom) {
  if (!isObj(key)) return 'plot needs a key: what the student places and what it is marked against';
  for (const k of Object.keys(key)) if (!['place', 'points', 'function', 'count', 'conditions'].includes(k)) return `a plot key has no field called ${k}`;
  if (!PLOT_PLACES.includes(key.place)) return 'a plot key says whether the student places points or a line';
  const forms = ['points', 'function', 'conditions'].filter((k) => key[k] !== undefined && key[k] !== null);
  if (forms.length !== 1) return 'a plot key is marked against exactly one of: the points, the function, or the conditions';
  if (bloom === 'create' && forms[0] !== 'conditions') return 'a plot at Create is drawn to conditions, so it needs conditions rather than one right answer';
  const step = { x: axisStep(spec.x), y: axisStep(spec.y) };

  if (forms[0] === 'points') {
    if (!Array.isArray(key.points)) return 'a plot key\'s points must be a list';
    const pts = key.points.map(pairOf);
    if (!pts.every((p) => p && finite(p[0]) && finite(p[1]))) return 'each point in a plot key is two numbers, x and y';
    if (!pts.every((p) => onGrid(p, spec))) return 'a point in the plot key is off the graph';
    if (key.place === 'line' && pts.length !== 2) return 'a line is marked against exactly two points on it';
    if (key.place === 'points' && (pts.length < 1 || pts.length > MAX_PLOT_POINTS)) return `a plot asks for 1 to ${MAX_PLOT_POINTS} points`;
    for (let i = 0; i < pts.length; i += 1) {
      for (let j = i + 1; j < pts.length; j += 1) {
        if (near(pts[i][0], pts[j][0], step.x) && near(pts[i][1], pts[j][1], step.y)) return 'two points in the plot key are closer than a grid step, so one placed point would answer both';
      }
    }
    // The figure must not already show them.
    for (const p of pts) if (spec.points.some((q) => near(q.x, p[0], step.x) && near(q.y, p[1], step.y))) return 'the figure already shows a point the student is asked to place';
    return null;
  }
  if (forms[0] === 'function') {
    const { fn, reason } = keyFunction(key.function);
    if (reason) return reason;
    if (key.place === 'line' && fn.family !== 'linear') return 'a line is marked against a linear function';
    if (key.place === 'points') {
      if (!Number.isInteger(key.count) || key.count < 1 || key.count > MAX_PLOT_POINTS) return `a plot marked against a function says how many points to place, 1 to ${MAX_PLOT_POINTS}`;
    } else if (key.count !== undefined) return 'a line is always two points, so it takes no count';
    if (spec.functions.some((f) => f.family === fn.family && JSON.stringify(f.params) === JSON.stringify(fn.params))) {
      return 'the figure already draws the function the student is asked to plot';
    }
    return null;
  }
  if (key.place !== 'line') return 'conditions are for drawing a line';
  if (!Array.isArray(key.conditions) || key.conditions.length < 1 || key.conditions.length > MAX_CONDITIONS) return `a line drawn to conditions needs 1 to ${MAX_CONDITIONS} conditions`;
  for (const c of key.conditions) {
    if (!isObj(c) || !PLOT_RULES.includes(c.rule)) return `each condition is one of: ${PLOT_RULES.join(', ')}`;
    if (c.rule === 'through') {
      const p = pairOf(c.point);
      if (!p || !finite(p[0]) || !finite(p[1])) return 'a "through" condition names a point, x and y';
      if (!onGrid(p, spec)) return 'a "through" condition names a point off the graph';
    } else if (c.rule === 'slope') {
      const hasSign = c.sign !== undefined;
      const hasValue = c.value !== undefined;
      if (hasSign === hasValue) return 'a slope condition gives a sign or a value, not both';
      if (hasSign && !SLOPE_SIGNS.includes(c.sign)) return `a slope's sign is ${SLOPE_SIGNS.join(', ')}`;
      if (hasValue && !finite(c.value)) return 'a slope\'s value must be a number';
    } else if (!finite(c.value)) return 'an intercept condition gives where the line crosses the y axis';
  }
  const pins = pinsOf(key.conditions);
  if (bloom === 'create' && pins >= 2) {
    return 'at Create the conditions must leave more than one line to draw: these fix a single line, which makes it an Apply question';
  }
  // Two pins fix the line: every condition must hold on it, or no line can be drawn.
  if (pins >= 2 && !lineForConditions(key.conditions, step)) return 'no line meets all of these conditions';
  return null;
}

/**
 * The one line two or more pinning conditions fix, when every condition holds
 * on it; null when they contradict each other. Worked in exact numbers: a key
 * is the professor's arithmetic, not a placed point.
 */
function lineForConditions(conditions, step) {
  const through = conditions.filter((c) => c.rule === 'through').map((c) => pairOf(c.point));
  const slope = conditions.find((c) => c.rule === 'slope' && (c.value !== undefined || c.sign === 'zero'));
  const cut = conditions.find((c) => c.rule === 'intercept');
  const m = slope ? (slope.value ?? 0) : null;
  let line = null;
  if (through.length >= 2) {
    const [a, b] = through;
    if (a[0] === b[0] && a[1] === b[1]) return null;
    line = lineThrough([a, b]);
  } else if (m !== null && through.length === 1) line = lineThrough([through[0], [through[0][0] + 1, through[0][1] + m]]);
  else if (m !== null && cut) line = lineThrough([[0, cut.value], [1, cut.value + m]]);
  else if (cut && through.length === 1) {
    if (through[0][0] === 0) return null;
    line = lineThrough([[0, cut.value], through[0]]);
  }
  if (!line) return null;
  // Exact, so "meets" here means to rounding, not to a grid step.
  const exact = { x: 1e-6 * step.x, y: 1e-6 * step.y };
  return conditions.every((c) => meets(line, c, exact)) ? line : null;
}

/**
 * A line through two points, kept as the points themselves and as slope and
 * intercept where it has them. Vertical only when the two share an x exactly:
 * a steep line drawn by hand is still a steep line, and its slope still counts.
 */
function lineThrough([a, b]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0) return { vertical: true, a, b, dx, dy };
  const m = dy / dx;
  return { vertical: false, a, b, m, c: a[1] - m * a[0], dx, dy };
}

/**
 * Is the point within one grid step of the line? Measured square to the line
 * on the grid's own scale (one step across is 1, one step up is 1), so a steep
 * line and a flat one are judged alike: up-and-down distance alone would fail
 * every point a hair to the side of a steep line.
 */
function onLine(line, p, step) {
  const ax = line.a[0] / step.x;
  const ay = line.a[1] / step.y;
  const ux = line.dx / step.x;
  const uy = line.dy / step.y;
  const len = Math.hypot(ux, uy);
  if (!len) return false;
  const off = Math.abs((p[0] / step.x - ax) * uy - (p[1] / step.y - ay) * ux) / len;
  return off < UNDER;
}

/** Does the line meet one condition, to within `step` on each axis? */
function meets(line, c, step) {
  if (c.rule === 'through') return onLine(line, pairOf(c.point), step);
  if (c.rule === 'intercept') return !line.vertical && near(line.c, c.value, step.y);
  // A slope, or its sign, is judged only on two points at least a grid step
  // apart across. The rise is allowed a grid step either way, and over a
  // shorter run that allows almost any slope: (0, 0) to (0.01, 1) "had a slope
  // of 2". Over a run of a step or more it allows at most one grid unit of
  // slope. A line snapped to the grid always has that run unless it is vertical.
  if (line.vertical || Math.abs(line.dx) < step.x * UNDER) return false;
  if (c.sign) {
    if (c.sign === 'zero') return Math.abs(line.dy) < step.y * UNDER;
    if (Math.abs(line.dy) < step.y * UNDER) return false;
    return c.sign === 'positive' ? line.m > 0 : line.m < 0;
  }
  // A stated slope: the rise across the line's own run must be within a grid step of it.
  return near(line.dy, c.value * line.dx, step.y);
}

/** Bipartite matching of placed points to wanted ones, within a grid step on both axes. */
function matchPoints(want, got, step) {
  const owner = new Array(got.length).fill(-1);
  const tryOne = (w, seen) => {
    for (let g = 0; g < got.length; g += 1) {
      if (seen.has(g) || !(near(got[g][0], want[w][0], step.x) && near(got[g][1], want[w][1], step.y))) continue;
      seen.add(g);
      if (owner[g] === -1 || tryOne(owner[g], seen)) {
        owner[g] = w;
        return true;
      }
    }
    return false;
  };
  let hits = 0;
  for (let w = 0; w < want.length; w += 1) if (tryOne(w, new Set())) hits += 1;
  return hits;
}

/** A condition, said the way a student reads it. */
export function conditionWords(c) {
  if (c.rule === 'through') {
    const p = pairOf(c.point);
    return `passes through (${fmt(p[0])}, ${fmt(p[1])})`;
  }
  if (c.rule === 'slope') return c.sign ? `has a ${c.sign} slope` : `has a slope of ${fmt(c.value)}`;
  return `crosses the y axis at ${fmt(c.value)}`;
}

/**
 * Mark placed points against a plot key. `response` is a list of [x, y] (or
 * {x, y}); anything else in it is ignored rather than guessed at.
 *
 * Credit: the points form is the multi rule (found minus over-claimed, over the
 * number wanted), so scattering points everywhere cannot score; a function's
 * points each count once, a grid step apart; a line scores by how many of its
 * two points sit on the right line, or by how many conditions it meets.
 */
export function gradePlot(key, spec, response) {
  const step = { x: axisStep(spec.x), y: axisStep(spec.y) };
  const got = (Array.isArray(response) ? response : []).map(pairOf)
    .filter((p) => p && finite(numberOf(p[0])) && finite(numberOf(p[1])))
    .map((p) => [numberOf(p[0]), numberOf(p[1])])
    .slice(0, MAX_PLOT_POINTS * 2);
  // The function as the validator read it: a number left out is the family's
  // default (y = 2x has c = 0), never NaN, which marked every answer wrong.
  const fn = key.function ? keyFunction(key.function).fn ?? null : null;
  if (key.function && !fn) return { score: 0, detail: 'the key could not be read' };
  const clamp = (v) => Math.max(0, Math.min(1, v));

  if (key.place === 'line') {
    if (got.length !== 2) return { score: 0, detail: 'a line needs exactly two points' };
    if (near(got[0][0], got[1][0], step.x) && near(got[0][1], got[1][1], step.y)) return { score: 0, detail: 'the two points are on top of each other' };
    if (key.conditions) {
      const line = lineThrough(got);
      const met = key.conditions.filter((c) => meets(line, c, step)).length;
      return { score: met / key.conditions.length, detail: `${met}/${key.conditions.length} conditions met` };
    }
    const { m, c } = fn?.params ?? {};
    const target = key.points ? lineThrough(key.points.map(pairOf)) : lineThrough([[0, c], [1, m + c]]);
    const on = got.filter((p) => onLine(target, p, step)).length;
    return { score: on / 2, detail: `${on}/2 points on the line` };
  }

  if (key.points) {
    const want = key.points.map(pairOf);
    // One point placed twice is one point, as on the curve below: a second tap
    // on the same spot neither earns nor costs anything.
    const placed = got.filter((p, i) => !got.slice(0, i).some((q) => near(q[0], p[0], step.x) && near(q[1], p[1], step.y)));
    const hits = matchPoints(want, placed, step);
    const wrong = placed.length - hits;
    return { score: clamp((hits - wrong) / want.length), detail: `${hits}/${want.length} points placed` };
  }
  // On the function: each placed point on the curve counts once, and two that
  // share a grid column count as one, so one right point placed twice is not two.
  const on = [];
  let off = 0;
  for (const p of got) {
    if (!near(evaluate(fn, p[0]), p[1], step.y)) off += 1;
    else if (!on.some((q) => near(q[0], p[0], step.x))) on.push(p);
  }
  const hits = Math.min(on.length, key.count);
  return { score: clamp((hits - off) / key.count), detail: `${hits}/${key.count} points on the curve` };
}

/** The plot key as a phone may see it once the answer is in. */
export function plotSolution(key) {
  if (key.points) return { place: key.place, points: key.points.map(pairOf) };
  if (key.function) return { place: key.place, equation: equation(keyFunction(key.function).fn ?? key.function) };
  return { place: key.place, conditions: key.conditions.map(conditionWords) };
}

/* ------------------------------------------------------------- number line -- */

export const MAX_LINE_MARKS = 6;

/** Is this a number-line key that can be marked on this line (with the question's tolerance, if it has one)? */
export function lineKeyReason(key, spec, tolerance = null) {
  if (!isObj(key)) return 'numberline needs a key: the points, or the intervals and rays, to mark';
  for (const k of Object.keys(key)) if (!['points', 'intervals', 'rays'].includes(k)) return `a number-line key has no field called ${k}`;
  const points = key.points ?? [];
  const intervals = key.intervals ?? [];
  const rays = key.rays ?? [];
  if (![points, intervals, rays].every(Array.isArray)) return 'a number-line key\'s points, intervals and rays are lists';
  if (points.length && (intervals.length || rays.length)) return 'a number-line question asks for points, or for intervals and rays, not both';
  const n = points.length + intervals.length + rays.length;
  if (n < 1 || n > MAX_LINE_MARKS) return `a number-line question asks for 1 to ${MAX_LINE_MARKS} marks`;
  const on = (v) => finite(v) && v >= spec.min && v <= spec.max;
  if (!points.every(on)) return 'a point in the number-line key is off the line';
  for (const iv of intervals) {
    if (!isObj(iv) || !on(iv.from) || !on(iv.to) || !(iv.to > iv.from)) return 'each interval in the key runs from one point on the line to a later one';
    if (iv.fromOpen !== undefined && typeof iv.fromOpen !== 'boolean') return 'an interval\'s ends are open or closed';
    if (iv.toOpen !== undefined && typeof iv.toOpen !== 'boolean') return 'an interval\'s ends are open or closed';
  }
  for (const r of rays) {
    if (!isObj(r) || !on(r.from) || !['left', 'right'].includes(r.direction)) return 'each ray in the key starts on the line and points left or right';
    if (r.open !== undefined && typeof r.open !== 'boolean') return 'a ray\'s end is open or closed';
  }
  // As on a plot: marks are told apart only to a tick (or the tolerance), and
  // two marks that close are taken as one, so key points must be further apart.
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (near(points[i], points[j], spec.step, tolerance)) return `two points in the number-line key are closer than ${tolerance === null || tolerance === undefined ? 'a tick' : 'the tolerance'}, so one mark would answer both`;
    }
  }
  if (points.some((v) => spec.points.some((p) => Math.abs(p.value - v) < 1e-9))) return 'the figure already shows a point the student is asked to mark';
  const same = (a, b) => Math.abs(a - b) < 1e-9;
  if (intervals.some((iv) => spec.intervals.some((s) => same(s.from, iv.from) && same(s.to, iv.to)))) return 'the figure already shows an interval the student is asked to mark';
  if (rays.some((r) => spec.rays.some((s) => same(s.from, r.from) && s.direction === r.direction))) return 'the figure already shows a ray the student is asked to mark';
  return null;
}

/**
 * Mark a number line. `response` is { points: [v], intervals: [{from, to,
 * fromOpen, toOpen}], rays: [{from, direction, open}] }.
 *
 * Partial credit by mark: a point is right or wrong; each end of an interval is
 * half of it (in the right place and open or closed as it should be); a ray
 * pointing the wrong way earns nothing, and one starting in the right place is
 * half, the other half for its end. Marks beyond the key cost what one mark is
 * worth, so marking everywhere does not score.
 */
export function gradeNumberline(key, spec, response, tolerance = null) {
  const r = isObj(response) ? response : {};
  const close = (a, b) => near(numberOf(a), b, spec.step, tolerance);
  // Capped: a phone sends a handful of marks, and the matching below is a
  // product of what was wanted and what came.
  const listOf = (v) => (Array.isArray(v) ? v.slice(0, MAX_LINE_MARKS * 4) : []);
  // One place marked twice is one mark, as on a plot: the second tap neither
  // earns nor costs anything (before, it counted as a mark beyond the key and
  // cancelled the right one).
  const gotPoints = listOf(r.points).map(numberOf).filter(finite)
    .filter((v, i, all) => !all.slice(0, i).some((w) => close(v, w)));
  const gotIntervals = listOf(r.intervals).filter(isObj);
  const gotRays = listOf(r.rays).filter(isObj);
  const want = { points: key.points ?? [], intervals: key.intervals ?? [], rays: key.rays ?? [] };
  const total = want.points.length + want.intervals.length + want.rays.length;

  let credit = 0;
  const usedP = new Set();
  for (const v of want.points) {
    const i = gotPoints.findIndex((g, j) => !usedP.has(j) && close(g, v));
    if (i >= 0) { usedP.add(i); credit += 1; }
  }
  const endCredit = (g, w) => {
    let c = 0;
    if (close(g.from, w.from) && Boolean(g.fromOpen) === Boolean(w.fromOpen)) c += 0.5;
    if (close(g.to, w.to) && Boolean(g.toOpen) === Boolean(w.toOpen)) c += 0.5;
    return c;
  };
  const rayCredit = (g, w) => {
    if (g.direction !== w.direction || !close(g.from, w.from)) return 0;
    return Boolean(g.open) === Boolean(w.open) ? 1 : 0.5;
  };
  const best = (wanted, got, value) => {
    const used = new Set();
    let sum = 0;
    for (const w of wanted) {
      let pick = -1;
      let top = 0;
      got.forEach((g, j) => {
        const c = used.has(j) ? 0 : value(g, w);
        if (c > top) { top = c; pick = j; }
      });
      if (pick >= 0) { used.add(pick); sum += top; }
    }
    return sum;
  };
  credit += best(want.intervals, gotIntervals, endCredit);
  credit += best(want.rays, gotRays, rayCredit);
  const extra = Math.max(0, gotPoints.length - want.points.length)
    + Math.max(0, gotIntervals.length - want.intervals.length)
    + Math.max(0, gotRays.length - want.rays.length);
  const score = Math.max(0, Math.min(1, (credit - extra) / total));
  return { score, detail: `${Math.round(credit * 10) / 10}/${total} marks` };
}

/* ------------------------------------------------------------------ chart -- */

export const MAX_BARS = 12;

/** Is this a chart to draw? `bars` is the empty chart; `values` the heights to set. */
export function barsReason(bars, values) {
  if (!isObj(bars)) return 'chart needs its empty chart: the categories and the value axis';
  for (const k of Object.keys(bars)) if (!['categories', 'min', 'max', 'step', 'label', 'xLabel'].includes(k)) return `a chart has no field called ${k}`;
  const cats = bars.categories;
  if (!Array.isArray(cats) || cats.length < 2 || cats.length > MAX_BARS) return `chart needs 2 to ${MAX_BARS} categories`;
  if (!cats.every((c) => typeof c === 'string' && c.trim() && c.length <= 60)) return 'every chart category needs a name of at most 60 characters';
  if (new Set(cats.map((c) => c.trim().toLowerCase())).size !== cats.length) return 'chart has two categories with the same name';
  const min = bars.min ?? 0;
  if (!finite(min) || !finite(bars.max) || !(bars.max > min)) return 'a chart\'s value axis runs from a lowest value up to a higher one';
  if (!finite(bars.step) || bars.step <= 0) return 'a chart\'s value axis needs a step between its grid lines';
  if ((bars.max - min) / bars.step > 60) return 'a chart\'s value axis would have more than 60 grid lines: use a wider step';
  for (const k of ['label', 'xLabel']) if (bars[k] !== undefined && (typeof bars[k] !== 'string' || bars[k].length > 60)) return 'a chart\'s axis labels are text of at most 60 characters';
  if (!Array.isArray(values) || values.length !== cats.length) return 'chart needs one value for each category';
  if (!values.every((v) => finite(v) && v >= min && v <= bars.max)) return 'every chart value must be a number on the value axis';
  return null;
}

/** Per bar, within the tolerance (or under one step of the value axis). */
export function gradeChart(bars, values, response, tolerance = null) {
  const got = Array.isArray(response) ? response : [];
  let hits = 0;
  values.forEach((v, i) => {
    // A bar left empty is no answer, even where the right height is 0.
    if (near(numberOf(got[i]), v, bars.step, tolerance)) hits += 1;
  });
  return { score: values.length ? hits / values.length : 0, detail: `${hits}/${values.length} bars` };
}

/* --------------------------------------------------------------- readings -- */

/**
 * What a question may ask a figure for, so the server can read the answer off
 * the drawing itself instead of taking a model's word for it.
 */
export const READINGS = ['y-at', 'bar', 'largest', 'smallest', 'difference', 'total', 'point'];

/**
 * Read a value off a figure: a number, or (largest, smallest) a category's name.
 * @returns {{ value: number|string, words: string } | { reason: string }}
 */
export function readFigure(rawSpec, reading) {
  const { spec } = normaliseSpec(rawSpec);
  if (!spec) return { reason: 'the figure could not be read' };
  if (!isObj(reading) || !READINGS.includes(reading.what)) return { reason: 'the question does not say what to read off the figure' };
  const r = reading;
  if (spec.type === 'plot' && r.what === 'y-at') {
    const f = spec.functions[Number.isInteger(r.function) ? r.function : 0];
    if (!f || !finite(r.x)) return { reason: 'the graph has no such function to read' };
    const v = evaluate(f, r.x);
    if (!finite(v)) return { reason: `the graph gives no value at x = ${fmt(r.x)}` };
    const value = Number(v.toPrecision(10));
    return { value, words: `${fmt(value)} at x = ${fmt(r.x)}` };
  }
  if (spec.type === 'numberline' && r.what === 'point') {
    const p = spec.points[Number.isInteger(r.point) ? r.point : 0];
    return p ? { value: p.value, words: `${fmt(p.value)}` } : { reason: 'the number line has no such point' };
  }
  if (spec.type === 'chart') {
    let names;
    let vals;
    if (spec.chart === 'pie') {
      names = spec.slices.map((s) => s.label);
      vals = spec.slices.map((s) => s.value);
    } else if (spec.chart === 'bar' || spec.chart === 'line') {
      const s = spec.series[Number.isInteger(r.series) ? r.series : 0];
      if (!s) return { reason: 'the chart has no such series' };
      names = spec.categories;
      vals = s.values;
    } else return { reason: `a ${spec.chart} chart is not read this way` };
    const at = (name) => names.findIndex((n) => low(n).trim() === low(name).trim());
    if (r.what === 'bar') {
      const i = at(r.category);
      return i < 0 ? { reason: `the chart has no "${String(r.category ?? '').slice(0, 40)}"` } : { value: vals[i], words: `${fmt(vals[i])} for ${names[i]}` };
    }
    if (r.what === 'difference') {
      const i = at(r.category);
      const j = at(r.other);
      if (i < 0 || j < 0) return { reason: 'the chart does not have both categories to compare' };
      const value = Number((vals[i] - vals[j]).toPrecision(10));
      return { value, words: `${fmt(value)}, ${names[i]} less ${names[j]}` };
    }
    if (r.what === 'total') {
      const value = Number(vals.reduce((a, b) => a + b, 0).toPrecision(10));
      return { value, words: `${fmt(value)} in all` };
    }
    if (r.what === 'largest' || r.what === 'smallest') {
      const target = r.what === 'largest' ? Math.max(...vals) : Math.min(...vals);
      const hits = vals.map((v, i) => (v === target ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) return { reason: `two categories share the ${r.what} value, so the figure does not settle one answer` };
      return { value: names[hits[0]], words: `${names[hits[0]]} (${fmt(target)})` };
    }
  }
  return { reason: `a ${spec.type} figure cannot be read for "${r.what}"` };
}

/** A nice axis for bars topping out at `top`: 0 to a round number, with about five steps. */
export function niceAxis(values) {
  const top = Math.max(...values, 1);
  const ticks = scaleLinear().domain([0, top]).nice(5).ticks(5);
  const step = ticks.length > 1 ? Number((ticks[1] - ticks[0]).toPrecision(12)) : top;
  const max = Math.max(ticks.at(-1), top);
  return { min: 0, max: max >= top ? max : max + step, step };
}
