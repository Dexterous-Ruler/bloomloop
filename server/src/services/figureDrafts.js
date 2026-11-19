// Figures in generated questions (Batch 8): what the model may send, how the
// server turns it into a figure it draws itself, and the key it works out from
// that figure instead of taking the model's word for it.
//
// The rules (the owner's decisions 1, 4 and 5): a figure is attached only when it
// carries what the question asks about, never as decoration; it is a spec in a
// fixed schema, checked field by field and drawn by the server (no picture from
// any model); where the drawing settles the answer - the value read off a graph,
// the bars of a chart - the server reads it off the spec, and when the model's
// own answer disagrees the draft says so to the professor in a sentence. A figure
// that fails the check is left out and the draft says that too; on a kind that
// cannot be asked without one, the item is refused instead.
//
// The offline templates make plot, number-line and chart questions only from
// numbers the material actually states (an equation, a range, a list of figures),
// or none, and the generator says which.
//
// Pure: no model call happens here. generate.js makes the call and hands the
// parsed JSON through validateItems(), which calls attachFigure() below.

import { Type } from '@google/genai';
import { scaleLinear } from 'd3-scale';

import { normaliseSpec, engineReason } from '../figures/index.js';
import { readFigure, READINGS, near, niceAxis, normalisePlotKey } from '../figures/interact.js';
import { axisStep, evaluate, equation } from '../figures/plot.js';
import { fmt } from '../figures/common.js';
import { generationFlag, runChecks } from './checks.js';

/** The figure types a model may draw: the ones whose answers the server can read. */
export const GENERATED_FIGURES = ['plot', 'chart', 'numberline'];

/** The kinds that cannot be asked without a figure (or, for hotspot and label, a picture). */
export const NEEDS_FIGURE = ['hotspot', 'label', 'plot', 'numberline'];

const collapse = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
/** Parsed as score() parses a student's "3,000". */
const number = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[\s,]/g, '')) : NaN);

/** An object without the keys the schema left empty: one schema covers every type, so empty is not a claim. */
function drop(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)));
}

const list = (v, fn) => (Array.isArray(v) ? v.map(fn) : undefined);
const text = (v) => (typeof v === 'string' ? collapse(v) : v);

/**
 * The model's figure in the spec shape the engines take. Only the fields of the
 * stated type are read; anything wrong in them is left as it came, so the figure
 * check refuses it by name rather than having it repaired here.
 */
export function figureFromModel(f) {
  if (!isObj(f)) return f;
  const type = typeof f.type === 'string' ? collapse(f.type).toLowerCase() : f.type;
  if (type === 'plot') {
    const axis = (a) => (isObj(a) ? drop({ min: a.min, max: a.max, step: a.step, label: text(a.label) }) : a);
    return drop({
      type,
      title: text(f.title),
      x: axis(f.x),
      y: axis(f.y),
      functions: list(f.functions, (fn) => (isObj(fn) ? drop({ id: fn.id, family: fn.family, params: isObj(fn.params) ? drop(fn.params) : fn.params, label: text(fn.label) }) : fn)),
      points: list(f.points, (p) => (isObj(p) ? drop({ id: p.id, x: p.x, y: p.y, label: text(p.label) }) : p)),
    });
  }
  if (type === 'chart') {
    const axis = (a) => (isObj(a) ? drop({ label: text(a.label), min: a.min, max: a.max }) : a);
    return drop({
      type,
      chart: f.chart,
      title: text(f.title),
      x: axis(f.x),
      y: axis(f.y),
      categories: list(f.categories, text),
      series: list(f.series, (s) => (isObj(s) ? drop({ name: text(s.name), values: s.values }) : s)),
      slices: list(f.slices, (s) => (isObj(s) ? drop({ label: text(s.label), value: s.value }) : s)),
    });
  }
  if (type === 'numberline') {
    return drop({
      type,
      title: text(f.title),
      min: f.min,
      max: f.max,
      step: f.step,
      points: list(f.points, (p) => (isObj(p) ? drop({ id: p.id, value: p.value, label: text(p.label) }) : p)),
      intervals: list(f.intervals, (v) => (isObj(v) ? drop({ from: v.from, to: v.to, fromOpen: v.fromOpen, toOpen: v.toOpen, label: text(v.label) }) : v)),
    });
  }
  return { type };
}

/** plot's key from the model: points come as {x, y}, a "through" condition as x and y. */
export function plotKeyFromModel(k) {
  if (!isObj(k)) return k;
  const pt = (p) => (isObj(p) ? [p.x, p.y] : p);
  // Stored with the family's defaults filled in (y = 2x keeps c = 0), as it is
  // checked and marked: a number the model left out is never stored as missing.
  return normalisePlotKey(drop({
    place: k.place,
    points: list(k.points, pt),
    function: isObj(k.function) ? drop({ family: k.function.family, params: isObj(k.function.params) ? drop(k.function.params) : k.function.params }) : k.function,
    count: k.count,
    conditions: list(k.conditions, (c) => (isObj(c)
      ? drop({ rule: c.rule, sign: c.sign, value: c.value, point: c.rule === 'through' ? [c.x, c.y] : undefined })
      : c)),
  }));
}

/** numberline's key from the model. */
export function lineKeyFromModel(k) {
  if (!isObj(k)) return k;
  return drop({
    points: k.points,
    intervals: list(k.intervals, (v) => (isObj(v) ? drop({ from: v.from, to: v.to, fromOpen: v.fromOpen, toOpen: v.toOpen }) : v)),
    rays: list(k.rays, (r) => (isObj(r) ? drop({ from: r.from, direction: r.direction, open: r.open }) : r)),
  });
}

/** chart's empty chart from the model. */
export function barsFromModel(b) {
  if (!isObj(b)) return b;
  return drop({ categories: list(b.categories, text), min: b.min, max: b.max, step: b.step, label: text(b.label), xLabel: text(b.xLabel) });
}

/* ------------------------------------------------------ attaching a figure -- */

const firstNumber = (s) => {
  const m = String(s ?? '').match(/-?\d[\d,]*(?:\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, '')) : NaN;
};
const same = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const keyText = (v) => collapse(v).toLowerCase();

/**
 * Put the model's figure on the item and work its key out from it.
 *
 * Mutates `clean` (the item validateItems() is building) and returns what to
 * tell the professor: { flags: [{ id, message }], refused: sentence | null }.
 * `refused` is the figure check's sentence when the figure was left out, so a
 * kind that needs one can say why it failed.
 */
export function attachFigure(clean, item) {
  const flags = [];
  if (item?.figure === undefined || item?.figure === null) return { flags, refused: null };
  const raw = figureFromModel(item.figure);
  let reason = null;
  let spec = null;
  if (!GENERATED_FIGURES.includes(raw?.type)) reason = 'A generated figure must be a graph, a chart or a number line.';
  else {
    const n = normaliseSpec(raw);
    reason = n.reason ?? engineReason(n.spec);
    spec = reason ? null : n.spec;
  }
  if (!spec) {
    flags.push({
      id: 'figure-dropped',
      message: `The model drew a figure for this question, but it was left out because it did not pass the figure check: ${reason} Check the question can be answered without it, or add a figure yourself.`,
    });
    return { flags, refused: reason };
  }
  clean.stimulus = { kind: 'figure', spec };
  flags.push(...keyFromFigure(clean, spec, item?.reading));
  return { flags, refused: null };
}

/** The key the drawing settles, set on `clean`; a flag for each place the model said otherwise. */
function keyFromFigure(clean, spec, reading) {
  const flags = [];
  const say = (message) => flags.push({ id: 'figure-key', message });

  if (clean.kind === 'plot' && isObj(clean.plotKey) && clean.plotKey.function && Array.isArray(clean.plotKey.points) && spec.type === 'plot') {
    // The model gave both the function and the points on it: the function is the
    // key, and points not on it are the model's arithmetic going wrong.
    const fn = { family: clean.plotKey.function.family, params: clean.plotKey.function.params ?? {} };
    const stepY = axisStep(spec.y);
    const off = clean.plotKey.points.filter((p) => Array.isArray(p) && !near(evaluate(fn, Number(p[0])), Number(p[1]), stepY));
    const { points, ...rest } = clean.plotKey;
    clean.plotKey = clean.plotKey.place === 'points' && rest.count === undefined ? { ...rest, count: points.length } : rest;
    if (off.length) {
      say(`The model's points ${off.map((p) => `(${fmt(Number(p[0]))}, ${fmt(Number(p[1]))})`).join(', ')} are not on ${equation(fn)}, so the key is the function itself. Check the question asks for that function.`);
    }
    return flags;
  }

  if (!isObj(reading) || !READINGS.includes(reading.what)) return flags;
  const read = readFigure(spec, reading);
  if (read.reason) {
    if (['numeric', 'mcq', 'blank'].includes(clean.kind)) say(`The answer could not be read off the figure (${read.reason}), so the model's answer stands unchecked. Check it against the drawing.`);
    return flags;
  }

  if (clean.kind === 'numeric') {
    if (typeof read.value !== 'number') {
      say(`The figure gives a name (${read.words}), not a number, so the model's answer stands unchecked.`);
      return flags;
    }
    const tol = finite(clean.tolerance) ? clean.tolerance : 0;
    if (!(finite(clean.value) && Math.abs(clean.value - read.value) <= tol + 1e-9)) {
      say(`The model gave ${finite(clean.value) ? fmt(clean.value) : 'no number'}, but the figure gives ${read.words}, so the key is now ${fmt(read.value)}. Check the question asks what the figure shows.`);
      clean.value = read.value;
    }
    return flags;
  }

  if (clean.kind === 'mcq' && Array.isArray(clean.options)) {
    const hits = clean.options.map((o, i) => (typeof read.value === 'number'
      ? (same(firstNumber(o), read.value) ? i : -1)
      : (keyText(o) === keyText(read.value) ? i : -1))).filter((i) => i >= 0);
    if (hits.length !== 1) {
      say(`${hits.length ? 'More than one option matches' : 'None of the options is'} what the figure gives (${read.words}), so the model's answer stands unchecked. Check the options against the drawing.`);
    } else if (hits[0] !== clean.answerIdx) {
      say(`The model marked "${clean.options[clean.answerIdx] ?? 'no option'}" as right, but the figure gives ${read.words}, so the key is now "${clean.options[hits[0]]}".`);
      clean.answerIdx = hits[0];
    }
    return flags;
  }

  if (clean.kind === 'blank' && Array.isArray(clean.accept)) {
    const ok = clean.accept.some((a) => (typeof read.value === 'number' ? same(number(a), read.value) : keyText(a) === keyText(read.value)));
    if (!ok) {
      const answer = typeof read.value === 'number' ? fmt(read.value).replace('−', '-') : read.value;
      say(`The model accepted ${clean.accept.map((a) => `"${a}"`).join(', ') || 'nothing'}, but the figure gives ${read.words}, so "${answer}" is now accepted first.`);
      clean.accept = [answer, ...clean.accept];
    }
  }
  return flags;
}

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The number the question's own words give beside each category ("Rice 45%,
 * wheat 30%"), or null when they do not give one for every category. Read from
 * the stem only, never guessed: a category named twice is read where it is
 * first named.
 */
function statedValues(text, categories) {
  const flat = collapse(text);
  const out = [];
  for (const c of categories) {
    const at = flat.search(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRx(c)}(?![\\p{L}\\p{N}])`, 'iu'));
    if (at < 0) return null;
    // The first number after the name, before any other words of substance.
    const m = flat.slice(at + c.length, at + c.length + 40).match(/^[\s:=(–-]*(?:(?:is|was|had|has|at|with|of)\s+)?(-?\d[\d,]*(?:\.\d+)?)/i);
    if (!m) return null;
    out.push(Number(m[1].replace(/,/g, '')));
  }
  return out;
}

/**
 * A chart question's bars against the numbers its own words give. The figure
 * here is the empty chart the student fills, so there is no drawing to read a
 * key off; what the stem states is the next best check. Said, not changed: a
 * reading of prose can be wrong where a reading of a spec cannot.
 */
export function chartFlags(clean) {
  if (clean.kind !== 'chart' || !Array.isArray(clean.bars?.categories) || !Array.isArray(clean.values)) return [];
  const stated = statedValues(clean.text, clean.bars.categories);
  if (!stated) return [];
  const off = clean.bars.categories.filter((c, i) => !same(Number(clean.values[i]), stated[i]));
  if (!off.length) return [];
  const i = clean.bars.categories.indexOf(off[0]);
  return [{
    id: 'figure-key',
    message: `The question gives ${off[0]} as ${fmt(stated[i])}, but its bar is set to ${finite(clean.values[i]) ? fmt(clean.values[i]) : 'no number'}`
      + `${off.length > 1 ? `, and ${off.length - 1} more bar${off.length > 2 ? 's do' : ' does'} not match either` : ''}. Check the bars against the question.`,
  }];
}

/** generate.js's item flags as checks on the row stored for it (services/checks.js). */
export const figureChecks = (row, item) => (Array.isArray(item?.figureFlags) ? item.figureFlags.map((f) => generationFlag(row, f.id, f.message)) : []);

/**
 * The checks a generated row is stored with: the rule checks, and what
 * generation found about its figure, fingerprinted to the row as stored.
 */
export const draftChecks = (row, item) => runChecks({ ...row, checks: figureChecks(row, item) });

/* ---------------------------------------------------------------- prompt -- */

export const FIGURE_KIND_RULES = {
  hotspot:
    'needs "figure": the student taps the right part(s). "answerIds" holds the "id" of every right part of the figure (a function, a point) - at least one, never all of them. Give every part an "id".',
  label:
    'needs a "plot" or "numberline" "figure" whose parts carry an "id" and NO "label" (the drawing must not show the answer). "placements" puts each label on a part: {"target": its id, "label": the words}, 2 to 8 of them; "distractors" may add up to 3 labels that belong nowhere.',
  plot:
    'needs a "plot" "figure" giving the empty axes (x and y with min, max and step) and nothing the student must place. "plotKey": {"place": "points" or "line", then exactly ONE of: "points" (the points to place, as {x, y}), "function" (the line or curve they must lie on, with "count" for how many points) or, for a line, "conditions" (each {"rule": "through", x, y} or {"rule": "slope", "sign": positive|negative|zero} or {"rule": "slope", "value"} or {"rule": "intercept", "value"})}. At Create, use conditions that leave many right lines (a point it passes through and the sign of its slope, say): two points, or a point and a stated slope, fix one line, and that is Apply.',
  numberline:
    'needs a "numberline" "figure" giving the empty line (min, max, step). "lineKey": the "points" to mark, or the "intervals" ({from, to, fromOpen, toOpen}) and "rays" ({from, direction: left|right, open}) - never both points and intervals.',
  chart:
    '"bars": the empty chart ({"categories", "min", "max", "step", "label"}) and "values": one height per category, in the same order, each a number the question or the source states. Never attach a bar chart of the same values as "figure": that is the answer.',
};

export const FIGURE_RULES = `
A FIGURE (optional, at most ONE per question): put it in "figure" only when it carries the information the question asks about - never as decoration, never as an illustration of something the text already says. It is drawn by the server from your numbers; you never draw it. Types: "plot" (axes x and y with min, max, step and label; "functions" from fixed families - linear {m, c}, quadratic {a, b, c}, cubic {a, b, c, d}, exponential {a, base, c}, logarithmic {a, base, h, c}, sine and cosine {a, b, c, d}, absolute {a, h, k} - and "points" {id, x, y, label}), "chart" ("chart": bar, line or pie; bar and line take "categories" and "series" [{name, values}], pie takes "slices" [{label, value}]) and "numberline" (min, max, step, "points" {id, value, label}, "intervals").
Use the numbers the source text gives and no others. Ideas by level: remember and understand - read a value or a part off the figure; apply - use the figure (read a value, plot a point); analyse - compare two parts, or find the point that does not fit; evaluate - judge a claim about the figure; create - draw to conditions (a "plot" question with "conditions").
When the answer is read off the figure, say how in "reading": {"what": "y-at", "function": index, "x"} for a graph's value at x, {"what": "bar", "category", "series"} for a bar or slice, {"what": "difference", "category", "other"}, {"what": "total"}, {"what": "largest"} or {"what": "smallest"} (the category's name), or {"what": "point", "point": index} on a number line. The server reads the answer off the drawing itself and checks yours against it.`;

const NUM = { type: Type.NUMBER };
const STR = { type: Type.STRING };
const BOOL = { type: Type.BOOLEAN };
const INT = { type: Type.INTEGER };
const arr = (items, description) => ({ type: Type.ARRAY, items, ...(description ? { description } : {}) });
const obj = (properties, description) => ({ type: Type.OBJECT, properties, ...(description ? { description } : {}) });
const PARAMS = obj({ m: NUM, c: NUM, a: NUM, b: NUM, d: NUM, base: NUM, h: NUM, k: NUM }, 'Only the numbers of the family named, e.g. linear: m and c.');
const XY = obj({ x: NUM, y: NUM });

/** The schema properties a generated item may carry for a figure and the five interaction kinds. */
export const FIGURE_SCHEMA_PROPERTIES = {
  figure: obj({
    type: { type: Type.STRING, enum: GENERATED_FIGURES },
    title: STR,
    x: obj({ min: NUM, max: NUM, step: NUM, label: STR }, 'plot: the x axis; chart: {label} of the horizontal axis.'),
    y: obj({ min: NUM, max: NUM, step: NUM, label: STR }, 'plot: the y axis; chart: {label, min, max} of the value axis.'),
    functions: arr(obj({ id: STR, family: { type: Type.STRING, enum: ['linear', 'quadratic', 'cubic', 'exponential', 'logarithmic', 'sine', 'cosine', 'absolute'] }, params: PARAMS, label: STR })),
    points: arr(obj({ id: STR, x: NUM, y: NUM, value: NUM, label: STR }), 'plot: {id, x, y, label}; numberline: {id, value, label}.'),
    chart: { type: Type.STRING, enum: ['bar', 'line', 'pie'] },
    categories: arr(STR),
    series: arr(obj({ name: STR, values: arr(NUM) })),
    slices: arr(obj({ label: STR, value: NUM })),
    min: NUM,
    max: NUM,
    step: NUM,
    intervals: arr(obj({ from: NUM, to: NUM, fromOpen: BOOL, toOpen: BOOL, label: STR })),
  }, 'Optional, at most one: a figure that carries what the question asks about. See the FIGURE rules.'),
  reading: obj({
    what: { type: Type.STRING, enum: READINGS },
    function: INT,
    x: NUM,
    category: STR,
    other: STR,
    series: INT,
    point: INT,
  }, 'With a figure whose answer is read off it: what to read. See the FIGURE rules.'),
  answerIds: arr(STR, 'kind "hotspot" only: the id of every right part of the figure.'),
  placements: arr(obj({ target: STR, label: STR }), 'kind "label" only: which label goes on which part (by id).'),
  distractors: arr(STR, 'kind "label" only: up to 3 labels that belong on no part.'),
  plotKey: obj({
    place: { type: Type.STRING, enum: ['points', 'line'] },
    points: arr(XY),
    function: obj({ family: { type: Type.STRING, enum: ['linear', 'quadratic', 'cubic', 'exponential', 'logarithmic', 'sine', 'cosine', 'absolute'] }, params: PARAMS }),
    count: INT,
    conditions: arr(obj({ rule: { type: Type.STRING, enum: ['through', 'slope', 'intercept'] }, sign: { type: Type.STRING, enum: ['positive', 'negative', 'zero'] }, value: NUM, x: NUM, y: NUM })),
  }, 'kind "plot" only: what the student places and what it is marked against.'),
  lineKey: obj({
    points: arr(NUM),
    intervals: arr(obj({ from: NUM, to: NUM, fromOpen: BOOL, toOpen: BOOL })),
    rays: arr(obj({ from: NUM, direction: { type: Type.STRING, enum: ['left', 'right'] }, open: BOOL })),
  }, 'kind "numberline" only: what the student marks.'),
  bars: obj({ categories: arr(STR), min: NUM, max: NUM, step: NUM, label: STR, xLabel: STR }, 'kind "chart" only: the empty chart.'),
  values: arr(NUM, 'kind "chart" only: the height of each bar, in the order of "categories".'),
};

/* -------------------------------------------------------- offline templates -- */

/** A tidy number for a question: no float noise. */
const tidyNum = (v) => Number(Number(v).toPrecision(10));

/** Sentences of the material, as generate.js splits them (passed in, so there is one splitter). */
function* hostsOf(sentences, test) {
  for (const s of sentences) if (test(s)) yield collapse(s);
}

/** Words that join a name to its number rather than name anything. */
const LINKING = new Set(['the', 'a', 'an', 'is', 'was', 'were', 'are', 'had', 'has', 'have', 'at', 'with', 'of', 'for', 'by', 'in', 'on', 'to', 'from', 'about', 'around', 'nearly', 'over', 'under', 'and', 'or']);

/**
 * A line in the material that lists three or more named figures with one unit -
 * "rice 45%, wheat 30% and maize 10%" - as a chart to draw, or null.
 */
function chartFrom(sentence) {
  const chunks = sentence.replace(/[.;]\s*$/, '').split(/,|;|\band\b/);
  const found = [];
  for (const c of chunks) {
    // One number per item: two in one piece ("between 10 and 40 in 2020") is not a list.
    const nums = c.match(/\d+(?:\.\d+)?/g) ?? [];
    if (nums.length !== 1) return null;
    const m = c.match(/^(.*?)(\d+(?:\.\d+)?)\s*(%|[A-Za-z]+)?/);
    // The name is the words just before the number, back to the first word that
    // only links ("shares were rice" is rice): at most three of them.
    const words = m[1].replace(/[:(=–-]+\s*$/, '').trim().split(/\s+/).filter(Boolean);
    const name = [];
    while (words.length && name.length < 3 && /^[A-Za-z][A-Za-z-]*$/.test(words.at(-1)) && !LINKING.has(words.at(-1).toLowerCase())) name.unshift(words.pop());
    if (!name.length) return null;
    found.push({ name: name.join(' '), value: Number(m[2]), unit: collapse(m[3] ?? '') });
  }
  if (found.length < 3 || found.length > 12) return null;
  const unit = found[0].unit;
  if (!found.every((f) => f.unit === unit)) return null;
  const names = found.map((f) => f.name.charAt(0).toUpperCase() + f.name.slice(1));
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return null;
  return { names, values: found.map((f) => f.value), unit };
}

/** A nice number line around [a, b], with the range in the middle and room either side. */
function lineAround(a, b) {
  const span = b - a || 1;
  const s = scaleLinear().domain([a - span, b + span]).nice(10);
  const ticks = s.ticks(10);
  const step = ticks.length > 1 ? tidyNum(ticks[1] - ticks[0]) : span;
  const [min, max] = s.domain();
  return { min: tidyNum(min), max: tidyNum(max), step };
}

/**
 * A plot, number-line or chart question built only from numbers the material
 * states, or null when it states none that fit. `sentences` is the material
 * split as generate.js splits it; `n` picks the nth fit, so a second question of
 * the kind uses other numbers.
 */
export function figureTemplate(kind, { sentences, topic, n = 0 }) {
  const here = String(topic).slice(0, 40);
  if (kind === 'chart') {
    const hits = [...hostsOf(sentences, (s) => (s.match(/\d/g) ?? []).length >= 3 && s.length <= 300)]
      .map((s) => ({ s, c: chartFrom(s) })).filter((h) => h.c);
    if (!hits.length) return null;
    const { s, c } = hits[n % hits.length];
    const axis = niceAxis(c.values);
    return {
      text: `Set each bar to the figure this line from ${here} gives for it: "${s}"`,
      bars: { categories: c.names, ...axis, label: c.unit === '%' ? 'Per cent' : c.unit ? `Value (${c.unit})` : 'Value' },
      values: c.values,
    };
  }
  if (kind === 'numberline') {
    const hits = [];
    for (const s of hostsOf(sentences, (x) => /\bbetween\b/i.test(x) && x.length <= 300)) {
      const m = s.match(/\bbetween\s+(-?\d+(?:\.\d+)?)\s*(?:[A-Za-z%°]+\s*)?and\s+(-?\d+(?:\.\d+)?)/i);
      if (m && Number(m[2]) > Number(m[1])) hits.push({ s, a: Number(m[1]), b: Number(m[2]) });
    }
    if (!hits.length) return null;
    const { s, a, b } = hits[n % hits.length];
    const line = lineAround(a, b);
    if ((line.max - line.min) / line.step > 60) return null;
    return {
      text: `Mark on the number line the range this line from ${here} gives, both ends included: "${s}"`,
      stimulus: { kind: 'figure', spec: { type: 'numberline', ...line } },
      lineKey: { intervals: [{ from: a, to: b, fromOpen: false, toOpen: false }] },
    };
  }
  if (kind === 'plot') {
    const hits = [];
    for (const s of hostsOf(sentences, (x) => /\by\s*=/.test(x) && x.length <= 300)) {
      // A straight line only: "y = 3x^2" or "y = 2x + 3z" is not one, so a power,
      // a letter or a digit straight after x or after the constant rules it out,
      // and so does any further sum after the line's own two terms.
      const m = s.match(/\by\s*=\s*(-?\d*(?:\.\d+)?)\s*x(?![\w^²³])\s*(?:([+-])\s*(\d+(?:\.\d+)?)(?![\w^²³]|\.\d))?(?!\s*[+\-*/^=×÷])/);
      if (!m) continue;
      const mm = m[1] === '' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
      const c = m[3] ? (m[2] === '-' ? -1 : 1) * Number(m[3]) : 0;
      if (Number.isFinite(mm) && Number.isFinite(c) && mm !== 0) hits.push({ s, m: mm, c });
    }
    if (!hits.length) return null;
    const { s, m, c } = hits[n % hits.length];
    // y over x from -5 to 5, so the line crosses the whole graph.
    const ys = [m * -5 + c, m * 5 + c];
    const yScale = scaleLinear().domain([Math.min(...ys, 0), Math.max(...ys, 0)]).nice(10);
    const yt = yScale.ticks(10);
    const [ymin, ymax] = yScale.domain();
    return {
      text: `Place two points to draw the graph of the equation in this line from ${here}: "${s}"`,
      stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5, step: 1, label: 'x' }, y: { min: tidyNum(ymin), max: tidyNum(ymax), step: tidyNum(yt[1] - yt[0]), label: 'y' } } },
      plotKey: { place: 'line', function: { family: 'linear', params: { m, c } } },
    };
  }
  return null;
}

/** The kinds the offline templates may make from figures. */
export const TEMPLATE_FIGURE_KINDS = ['plot', 'numberline', 'chart'];

/** "made 1 chart question; could not make a plot one": which figure kinds the templates managed, in a sentence. */
export function templateFigureNote(topic, asked, made) {
  const want = TEMPLATE_FIGURE_KINDS.filter((k) => asked.includes(k));
  if (!want.length) return null;
  const word = { plot: 'graph', numberline: 'number-line', chart: 'bar-chart' };
  const done = want.filter((k) => made.some((q) => q.kind === k));
  const missed = want.filter((k) => !done.includes(k));
  const parts = [];
  if (done.length) parts.push(`made ${done.map((k) => `${made.filter((q) => q.kind === k).length} ${word[k]}`).join(' and ')} question${made.filter((q) => done.includes(q.kind)).length === 1 ? '' : 's'} from numbers the material states`);
  if (missed.length) parts.push(`could not make a ${missed.map((k) => word[k]).join(' or ')} question, because the material states no ${missed.map((k) => ({ plot: 'equation of a line', numberline: 'range between two numbers', chart: 'list of three or more figures' }[k])).join(' or ')}`);
  return `"${topic}": the offline templates ${parts.join('; they ')}.`;
}

