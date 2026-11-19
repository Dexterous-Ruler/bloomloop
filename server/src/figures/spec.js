// What a figure may be: one JSON spec per type, checked field by field.
//
// A spec is data, never code: functions come from fixed families with numeric
// parameters (there is no expression to parse, so nothing typed can run), a
// diagram is nodes and edges from a short list of shapes, a molecule is a SMILES
// string the chemistry engine must accept. Every size, count and label length is
// capped here, and every number must be finite, so the engines downstream can
// trust what they draw.
//
// Each check returns the spec as it will be stored: only the keys a type knows,
// labels trimmed, defaults filled in. A spec that fails is refused with one plain
// sentence a professor can act on (FigureRefusal, caught in figures/index.js).

import { FigureRefusal, need, graphemes, fmt } from './common.js';

export const FIGURE_TYPES = ['plot', 'chart', 'numberline', 'geometry', 'timeline', 'diagram', 'molecule', 'pattern', 'stack'];

/** The refusal for a graph with nothing on it, outside a question that is answered by plotting on it. */
export const EMPTY_GRAPH = 'The graph needs something on it: a function, a point or a segment.';

/** A normalised plot with nothing drawn on it: only its axes. */
export const emptyGraph = (spec) => spec?.type === 'plot'
  && spec.functions.length + spec.points.length + spec.segments.length + spec.shade.length === 0;

/** The caps, named so the tests and the refusals say the same numbers. */
export const LIMITS = {
  label: 60,
  title: 120,
  caption: 160,
  number: 1e6,
  steps: 12,
  highlight: 20,
  functions: 6,
  plotPoints: 40,
  segments: 30,
  shades: 6,
  stepPieces: 20,
  categories: 24,
  series: 4,
  slices: 8,
  bins: 30,
  dots: 200,
  boxes: 6,
  numberTicks: 60,
  numberPoints: 20,
  intervals: 6,
  rays: 6,
  geoPoints: 30,
  polygons: 8,
  polygonCorners: 12,
  circles: 6,
  angles: 10,
  vectors: 12,
  events: 30,
  nodes: 25,
  edges: 50,
  smiles: 200,
  patternItems: 12,
  frames: 10,
  specBytes: 20000,
};

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nth = (noun, i) => `${noun} ${i + 1}`;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function keys(o, allowed, what) {
  need(isObj(o), `${cap(what)} must be a set of named values.`);
  for (const k of Object.keys(o)) need(allowed.includes(k), `${cap(what)} has "${String(k).slice(0, 30)}", which a figure cannot use.`);
  return o;
}

function num(v, what, { min = -LIMITS.number, max = LIMITS.number, int = false } = {}) {
  need(typeof v === 'number' && Number.isFinite(v), `${cap(what)} must be a number.`);
  need(v >= min && v <= max, `${cap(what)} must be between ${fmt(min)} and ${fmt(max)}.`);
  if (int) need(Number.isInteger(v), `${cap(what)} must be a whole number.`);
  return v;
}

const optNum = (v, what, opts, dflt) => (v === undefined || v === null ? dflt : num(v, what, opts));

function label(v, what, max = LIMITS.label, { required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    need(!required, `${cap(what)} needs a label.`);
    return '';
  }
  need(typeof v === 'string', `${cap(what)} must be text.`);
  // Control characters are never wanted in a label, and some (a bidirectional
  // override) would let a label pretend to say something else.
  need(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]/.test(v), `${cap(what)} contains a character that cannot be shown.`);
  const s = v.replace(/\s+/g, ' ').trim();
  need(!required || s, `${cap(what)} needs a label.`);
  need(graphemes(s).length <= max, `${cap(what)} is longer than ${max} characters.`);
  return s;
}

function list(v, what, max, { min = 0 } = {}) {
  const l = v === undefined || v === null ? [] : v;
  need(Array.isArray(l), `${cap(what)} must be a list.`);
  need(l.length <= max, `A figure can have at most ${max} ${what}.`);
  need(l.length >= min, min === 1 ? `The figure needs at least one of its ${what}.` : `The figure needs at least ${min} ${what}.`);
  return l;
}

const bool = (v, what) => {
  if (v === undefined || v === null) return false;
  need(typeof v === 'boolean', `${cap(what)} is either on or off.`);
  return v;
};

function oneOf(v, allowed, what, dflt) {
  if (v === undefined || v === null) return dflt;
  need(allowed.includes(v), `${cap(what)} must be one of: ${allowed.join(', ')}.`);
  return v;
}

/**
 * The set each check collects its part names in, knowing beforehand every name
 * the spec gives a part anywhere (any `id`, at any depth). An automatic name
 * steps past those, so a box the professor called "e1" and an arrow they left
 * unnamed are not refused for a clash with a name they never wrote.
 */
function namesFor(raw) {
  const given = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'id' && typeof x === 'string') given.add(x.toLowerCase());
        else walk(x);
      }
    }
  };
  walk(raw);
  return Object.assign(new Set(), { given });
}

/**
 * Ids a part is addressed by: given, or made from its kind and position (the
 * next free number when that one is taken or given elsewhere). Unique across
 * the figure.
 */
function idOf(v, what, fallback, used) {
  const auto = v === undefined || v === null || v === '';
  let id = auto ? fallback : v;
  if (auto) {
    const [, stem, n] = /^(.*?)(\d+)$/.exec(fallback);
    const taken = (name) => used.has(name.toLowerCase()) || Boolean(used.given?.has(name.toLowerCase()));
    for (let k = Number(n) + 1; taken(id); k += 1) id = `${stem}${k}`;
  }
  need(typeof id === 'string' && ID.test(id), `${cap(what)} needs a short name made of letters, digits, - or _, starting with a letter.`);
  need(!used.has(id.toLowerCase()), `Two parts of the figure are both called "${id}": each needs its own name.`);
  used.add(id.toLowerCase());
  return id;
}

function axis(v, what) {
  keys(v, ['min', 'max', 'label', 'step'], what);
  const min = num(v.min, `the lowest value on ${what}`);
  const max = num(v.max, `the highest value on ${what}`);
  need(max > min, `On ${what} the highest value must be above the lowest.`);
  const step = optNum(v.step, `the tick spacing on ${what}`, { min: 1e-9 }, null);
  if (step !== null) need((max - min) / step <= LIMITS.numberTicks, `${cap(what)} would have more than ${LIMITS.numberTicks} ticks: use a wider spacing.`);
  return { min, max, label: label(v.label, `the label of ${what}`), ...(step !== null ? { step } : {}) };
}

/** Steps on plot, geometry and diagram: each lights up named parts, with a caption. */
function highlightSteps(v, parts) {
  const steps = list(v, 'steps', LIMITS.steps);
  return steps.map((s, i) => {
    const what = nth('step', i);
    keys(s, ['highlight', 'caption'], what);
    const hl = list(s.highlight, `parts lit up in ${what}`, LIMITS.highlight).map((h) => {
      need(typeof h === 'string' && parts.has(h.toLowerCase()), `${cap(what)} lights up "${String(h).slice(0, 30)}", which is not a part of the figure.`);
      return h;
    });
    return { highlight: hl, caption: label(s.caption, `the caption of ${what}`, LIMITS.caption, { required: true }) };
  });
}

const titleOf = (v) => label(v, 'the title', LIMITS.title);

/* ------------------------------------------------------------------ plot -- */

export const FAMILIES = {
  linear: { m: 1, c: 0 },
  quadratic: { a: 1, b: 0, c: 0 },
  cubic: { a: 1, b: 0, c: 0, d: 0 },
  exponential: { a: 1, base: 2, c: 0 },
  logarithmic: { a: 1, base: 10, h: 0, c: 0 },
  sine: { a: 1, b: 1, c: 0, d: 0 },
  cosine: { a: 1, b: 1, c: 0, d: 0 },
  absolute: { a: 1, h: 0, k: 0 },
  step: {},
};

function plotFunction(f, i, used) {
  const what = nth('function', i);
  keys(f, ['id', 'family', 'params', 'pieces', 'domain', 'label', 'dashed'], what);
  const family = oneOf(f.family, Object.keys(FAMILIES), `the kind of ${what}`, undefined);
  need(family, `${cap(what)} needs a kind: ${Object.keys(FAMILIES).join(', ')}.`);
  const out = { id: idOf(f.id, what, `f${i + 1}`, used), family };
  if (family === 'step') {
    need(f.params === undefined, `${cap(what)} is a step function: give its pieces, not parameters.`);
    out.pieces = list(f.pieces, `pieces of ${what}`, LIMITS.stepPieces, { min: 1 }).map((p, j) => {
      const pw = `piece ${j + 1} of ${what}`;
      keys(p, ['from', 'to', 'y', 'fromClosed', 'toClosed'], pw);
      const from = num(p.from, `where ${pw} starts`);
      const to = num(p.to, `where ${pw} ends`);
      need(to > from, `${cap(pw)} must end to the right of where it starts.`);
      return { from, to, y: num(p.y, `the height of ${pw}`), fromClosed: bool(p.fromClosed, `${pw}'s left end`), toClosed: bool(p.toClosed, `${pw}'s right end`) };
    });
  } else {
    need(f.pieces === undefined, `Only a step function has pieces; ${what} is ${family}.`);
    const params = f.params ?? {};
    keys(params, Object.keys(FAMILIES[family]), `the numbers of ${what}`);
    const p = {};
    for (const [k, d] of Object.entries(FAMILIES[family])) p[k] = optNum(params[k], `${what}'s ${k}`, {}, d);
    if (family === 'quadratic' || family === 'cubic') need(p.a !== 0, `${cap(what)} needs a non-zero a, or it is not ${family}.`);
    if (family === 'exponential' || family === 'logarithmic') need(p.base > 0 && p.base !== 1, `The base of ${what} must be positive and not 1.`);
    out.params = p;
  }
  if (f.domain !== undefined && f.domain !== null) {
    need(Array.isArray(f.domain) && f.domain.length === 2, `The range of ${what} is two numbers, where it starts and ends.`);
    const [a, b] = f.domain.map((v, j) => num(v, `${j ? 'the end' : 'the start'} of ${what}'s range`));
    need(b > a, `${cap(what)}'s range must end to the right of where it starts.`);
    out.domain = [a, b];
  }
  out.label = label(f.label, `the label of ${what}`);
  out.dashed = bool(f.dashed, `${what} dashed`);
  return out;
}

function pair(v, what) {
  need(Array.isArray(v) && v.length === 2, `${cap(what)} is two numbers, x and y.`);
  return [num(v[0], `x of ${what}`), num(v[1], `y of ${what}`)];
}

function plotSpec(s) {
  keys(s, ['type', 'title', 'x', 'y', 'grid', 'functions', 'points', 'segments', 'shade', 'steps'], 'the graph');
  const used = namesFor(s);
  const out = {
    type: 'plot',
    title: titleOf(s.title),
    x: axis(s.x, 'the x axis'),
    y: axis(s.y, 'the y axis'),
    grid: s.grid === undefined ? true : bool(s.grid, 'the grid'),
  };
  out.functions = list(s.functions, 'functions', LIMITS.functions).map((f, i) => plotFunction(f, i, used));
  out.points = list(s.points, 'points', LIMITS.plotPoints).map((p, i) => {
    const what = nth('point', i);
    keys(p, ['id', 'x', 'y', 'label', 'open'], what);
    return { id: idOf(p.id, what, `p${i + 1}`, used), x: num(p.x, `x of ${what}`), y: num(p.y, `y of ${what}`), label: label(p.label, `the label of ${what}`), open: bool(p.open, `${what} open`) };
  });
  out.segments = list(s.segments, 'segments', LIMITS.segments).map((g, i) => {
    const what = nth('segment', i);
    keys(g, ['id', 'from', 'to', 'label', 'dashed', 'arrow'], what);
    return { id: idOf(g.id, what, `s${i + 1}`, used), from: pair(g.from, `the start of ${what}`), to: pair(g.to, `the end of ${what}`), label: label(g.label, `the label of ${what}`), dashed: bool(g.dashed, `${what} dashed`), arrow: bool(g.arrow, `${what}'s arrow`) };
  });
  const fnIds = new Set(out.functions.map((f) => f.id.toLowerCase()));
  out.shade = list(s.shade, 'shaded regions', LIMITS.shades).map((h, i) => {
    const what = nth('shaded region', i);
    keys(h, ['id', 'from', 'to', 'under', 'label'], what);
    const from = num(h.from, `where ${what} starts`);
    const to = num(h.to, `where ${what} ends`);
    need(to > from, `${cap(what)} must end to the right of where it starts.`);
    let under = null;
    if (h.under !== undefined && h.under !== null) {
      need(typeof h.under === 'string' && fnIds.has(h.under.toLowerCase()), `${cap(what)} is shaded under a function the graph does not have.`);
      under = out.functions.find((f) => f.id.toLowerCase() === h.under.toLowerCase()).id;
    }
    return { id: idOf(h.id, what, `sh${i + 1}`, used), from, to, under, label: label(h.label, `the label of ${what}`) };
  });
  // Empty axes are allowed here: they are what a "plot on the graph" question
  // (questionTypes.js) is answered on. Anywhere else a graph with nothing on it
  // carries nothing, and the question validator refuses it there (EMPTY_GRAPH).
  if (s.steps !== undefined) out.steps = highlightSteps(s.steps, used);
  return out;
}

/* ----------------------------------------------------------------- chart -- */

export const CHARTS = ['bar', 'line', 'pie', 'histogram', 'dot', 'box'];

function chartSpec(s) {
  keys(s, ['type', 'chart', 'title', 'x', 'y', 'categories', 'series', 'slices', 'bins', 'values', 'boxes'], 'the chart');
  const chart = oneOf(s.chart, CHARTS, 'the kind of chart', undefined);
  need(chart, `The chart needs a kind: ${CHARTS.join(', ')}.`);
  const out = { type: 'chart', chart, title: titleOf(s.title) };
  const axisLabel = (v, what) => {
    if (v === undefined || v === null) return { label: '' };
    keys(v, ['label', 'min', 'max'], what);
    const o = { label: label(v.label, `the label of ${what}`) };
    if (v.min !== undefined) o.min = num(v.min, `the lowest value on ${what}`);
    if (v.max !== undefined) o.max = num(v.max, `the highest value on ${what}`);
    if (o.min !== undefined && o.max !== undefined) need(o.max > o.min, `On ${what} the highest value must be above the lowest.`);
    return o;
  };
  out.x = axisLabel(s.x, 'the horizontal axis');
  out.y = axisLabel(s.y, 'the vertical axis');
  const used = namesFor(s);
  const others = (allowed) => {
    for (const k of ['categories', 'series', 'slices', 'bins', 'values', 'boxes']) {
      need(allowed.includes(k) || s[k] === undefined, `A ${chart} chart does not use ${k}.`);
    }
  };
  if (chart === 'bar' || chart === 'line') {
    others(['categories', 'series']);
    out.categories = list(s.categories, 'categories', LIMITS.categories, { min: 1 }).map((c, i) => label(c, nth('category', i), LIMITS.label, { required: true }));
    out.series = list(s.series, 'series', LIMITS.series, { min: 1 }).map((r, i) => {
      const what = nth('series', i);
      keys(r, ['id', 'name', 'values'], what);
      const values = list(r.values, `values in ${what}`, LIMITS.categories);
      need(values.length === out.categories.length, `${cap(what)} needs one value for each of the ${out.categories.length} categories.`);
      return { id: idOf(r.id, what, `series${i + 1}`, used), name: label(r.name, `the name of ${what}`, LIMITS.label, { required: Array.isArray(s.series) && s.series.length > 1 }), values: values.map((v, j) => num(v, `value ${j + 1} of ${what}`)) };
    });
  } else if (chart === 'pie') {
    others(['slices']);
    out.slices = list(s.slices, 'slices', LIMITS.slices, { min: 2 }).map((p, i) => {
      const what = nth('slice', i);
      keys(p, ['id', 'label', 'value'], what);
      return { id: idOf(p.id, what, `slice${i + 1}`, used), label: label(p.label, what, LIMITS.label, { required: true }), value: num(p.value, `the value of ${what}`, { min: 0 }) };
    });
    need(out.slices.reduce((t, p) => t + p.value, 0) > 0, 'A pie chart needs at least one slice above zero.');
  } else if (chart === 'histogram') {
    others(['bins']);
    out.bins = list(s.bins, 'bins', LIMITS.bins, { min: 1 }).map((b, i) => {
      const what = nth('bin', i);
      keys(b, ['id', 'from', 'to', 'count'], what);
      const from = num(b.from, `where ${what} starts`);
      const to = num(b.to, `where ${what} ends`);
      need(to > from, `${cap(what)} must end above where it starts.`);
      return { id: idOf(b.id, what, `bin${i + 1}`, used), from, to, count: num(b.count, `the count in ${what}`, { min: 0 }) };
    });
    out.bins.sort((a, b) => a.from - b.from);
    for (let i = 1; i < out.bins.length; i += 1) {
      need(Math.abs(out.bins[i].from - out.bins[i - 1].to) < 1e-9, `The bins of a histogram must meet with no gap or overlap: one ends at ${fmt(out.bins[i - 1].to)} and the next starts at ${fmt(out.bins[i].from)}.`);
    }
  } else if (chart === 'dot') {
    others(['values']);
    out.values = list(s.values, 'values', LIMITS.dots, { min: 1 }).map((v, i) => num(v, nth('value', i)));
  } else {
    others(['boxes']);
    out.boxes = list(s.boxes, 'boxes', LIMITS.boxes, { min: 1 }).map((b, i) => {
      const what = nth('box', i);
      keys(b, ['id', 'label', 'min', 'q1', 'median', 'q3', 'max'], what);
      const five = ['min', 'q1', 'median', 'q3', 'max'].map((k) => num(b[k], `the ${k === 'q1' ? 'lower quartile' : k === 'q3' ? 'upper quartile' : k} of ${what}`));
      for (let j = 1; j < 5; j += 1) need(five[j] >= five[j - 1], `${cap(what)} must go lowest, lower quartile, median, upper quartile, highest, each at least the one before.`);
      return { id: idOf(b.id, what, `box${i + 1}`, used), label: label(b.label, `the label of ${what}`), min: five[0], q1: five[1], median: five[2], q3: five[3], max: five[4] };
    });
  }
  return out;
}

/* ------------------------------------------------------------ numberline -- */

function numberlineSpec(s) {
  keys(s, ['type', 'title', 'min', 'max', 'step', 'labelEvery', 'points', 'intervals', 'rays'], 'the number line');
  const min = num(s.min, 'the start of the number line');
  const max = num(s.max, 'the end of the number line');
  need(max > min, 'The number line must end to the right of where it starts.');
  const step = num(s.step ?? 1, 'the gap between ticks', { min: 1e-9 });
  need((max - min) / step <= LIMITS.numberTicks, `The number line would have more than ${LIMITS.numberTicks} ticks: use a wider gap between them.`);
  const used = namesFor(s);
  const inRange = (v, what) => {
    num(v, what);
    need(v >= min && v <= max, `${cap(what)} is off the number line, which runs from ${fmt(min)} to ${fmt(max)}.`);
    return v;
  };
  return {
    type: 'numberline',
    title: titleOf(s.title),
    min,
    max,
    step,
    labelEvery: num(s.labelEvery ?? 1, 'how often ticks are numbered', { min: 1, max: LIMITS.numberTicks, int: true }),
    points: list(s.points, 'points', LIMITS.numberPoints).map((p, i) => {
      const what = nth('point', i);
      keys(p, ['id', 'value', 'label', 'open'], what);
      return { id: idOf(p.id, what, `p${i + 1}`, used), value: inRange(p.value, what), label: label(p.label, `the label of ${what}`), open: bool(p.open, `${what} open`) };
    }),
    intervals: list(s.intervals, 'intervals', LIMITS.intervals).map((v, i) => {
      const what = nth('interval', i);
      keys(v, ['id', 'from', 'to', 'fromOpen', 'toOpen', 'label'], what);
      const from = inRange(v.from, `the start of ${what}`);
      const to = inRange(v.to, `the end of ${what}`);
      need(to > from, `${cap(what)} must end to the right of where it starts.`);
      return { id: idOf(v.id, what, `i${i + 1}`, used), from, to, fromOpen: bool(v.fromOpen, `${what}'s left end open`), toOpen: bool(v.toOpen, `${what}'s right end open`), label: label(v.label, `the label of ${what}`) };
    }),
    rays: list(s.rays, 'rays', LIMITS.rays).map((r, i) => {
      const what = nth('ray', i);
      keys(r, ['id', 'from', 'direction', 'open', 'label'], what);
      const direction = oneOf(r.direction, ['left', 'right'], `the direction of ${what}`, undefined);
      need(direction, `${cap(what)} needs a direction: left or right.`);
      return { id: idOf(r.id, what, `r${i + 1}`, used), from: inRange(r.from, `the start of ${what}`), direction, open: bool(r.open, `${what}'s end open`), label: label(r.label, `the label of ${what}`) };
    }),
  };
}

/* -------------------------------------------------------------- geometry -- */

export const OPTICS = ['convex-lens', 'concave-lens', 'concave-mirror', 'convex-mirror', 'plane-mirror'];

function geometrySpec(s) {
  keys(s, ['type', 'title', 'view', 'grid', 'axes', 'points', 'segments', 'rays', 'polygons', 'circles', 'angles', 'vectors', 'optics', 'steps'], 'the drawing');
  const used = namesFor(s);
  const out = { type: 'geometry', title: titleOf(s.title), grid: bool(s.grid, 'the grid'), axes: bool(s.axes, 'the axes') };
  if (s.view !== undefined && s.view !== null) {
    keys(s.view, ['xMin', 'xMax', 'yMin', 'yMax'], 'the drawing\'s frame');
    const v = {
      xMin: num(s.view.xMin, 'the left edge of the drawing'),
      xMax: num(s.view.xMax, 'the right edge of the drawing'),
      yMin: num(s.view.yMin, 'the bottom edge of the drawing'),
      yMax: num(s.view.yMax, 'the top edge of the drawing'),
    };
    need(v.xMax > v.xMin && v.yMax > v.yMin, 'The drawing\'s frame must be wider and taller than nothing.');
    out.view = v;
  } else need(s.optics, 'The drawing needs a frame: the left, right, bottom and top edges it shows.');
  const pointIds = new Map();
  out.points = list(s.points, 'points', LIMITS.geoPoints).map((p, i) => {
    const what = nth('point', i);
    keys(p, ['id', 'x', 'y', 'label', 'hidden'], what);
    const pt = { id: idOf(p.id, what, `P${i + 1}`, used), x: num(p.x, `x of ${what}`), y: num(p.y, `y of ${what}`), label: label(p.label, `the label of ${what}`), hidden: bool(p.hidden, `${what} hidden`) };
    pointIds.set(pt.id.toLowerCase(), pt);
    return pt;
  });
  // A corner or an end is a named point or a pair of numbers.
  const ref = (v, what) => {
    if (typeof v === 'string') {
      need(pointIds.has(v.toLowerCase()), `${cap(what)} names a point "${v.slice(0, 30)}" that the drawing does not have.`);
      return pointIds.get(v.toLowerCase()).id;
    }
    return pair(v, what);
  };
  out.segments = list(s.segments, 'segments', LIMITS.segments).map((g, i) => {
    const what = nth('segment', i);
    keys(g, ['id', 'from', 'to', 'label', 'dashed', 'marks'], what);
    return { id: idOf(g.id, what, `s${i + 1}`, used), from: ref(g.from, `the start of ${what}`), to: ref(g.to, `the end of ${what}`), label: label(g.label, `the label of ${what}`), dashed: bool(g.dashed, `${what} dashed`), marks: g.marks === undefined ? 0 : num(g.marks, `the tick marks on ${what}`, { min: 0, max: 3, int: true }) };
  });
  out.rays = list(s.rays, 'rays', LIMITS.rays).map((r, i) => {
    const what = nth('ray', i);
    keys(r, ['id', 'from', 'through', 'label'], what);
    return { id: idOf(r.id, what, `r${i + 1}`, used), from: ref(r.from, `the start of ${what}`), through: ref(r.through, `the point ${what} passes through`), label: label(r.label, `the label of ${what}`) };
  });
  out.polygons = list(s.polygons, 'shapes', LIMITS.polygons).map((g, i) => {
    const what = nth('shape', i);
    keys(g, ['id', 'points', 'label', 'shaded'], what);
    const corners = list(g.points, `corners of ${what}`, LIMITS.polygonCorners, { min: 3 }).map((c, j) => ref(c, `corner ${j + 1} of ${what}`));
    return { id: idOf(g.id, what, `shape${i + 1}`, used), points: corners, label: label(g.label, `the label of ${what}`), shaded: bool(g.shaded, `${what} shaded`) };
  });
  out.circles = list(s.circles, 'circles', LIMITS.circles).map((c, i) => {
    const what = nth('circle', i);
    keys(c, ['id', 'centre', 'radius', 'label'], what);
    return { id: idOf(c.id, what, `c${i + 1}`, used), centre: ref(c.centre, `the centre of ${what}`), radius: num(c.radius, `the radius of ${what}`, { min: 1e-9 }), label: label(c.label, `the label of ${what}`) };
  });
  out.angles = list(s.angles, 'angles', LIMITS.angles).map((a, i) => {
    const what = nth('angle', i);
    keys(a, ['id', 'at', 'from', 'to', 'label', 'right'], what);
    return { id: idOf(a.id, what, `a${i + 1}`, used), at: ref(a.at, `the corner of ${what}`), from: ref(a.from, `the first arm of ${what}`), to: ref(a.to, `the second arm of ${what}`), label: label(a.label, `the label of ${what}`), right: bool(a.right, `${what} marked as a right angle`) };
  });
  out.vectors = list(s.vectors, 'arrows', LIMITS.vectors).map((v, i) => {
    const what = nth('arrow', i);
    keys(v, ['id', 'from', 'dx', 'dy', 'label'], what);
    const dx = num(v.dx, `how far ${what} goes across`);
    const dy = num(v.dy, `how far ${what} goes up`);
    need(dx !== 0 || dy !== 0, `${cap(what)} has no length.`);
    return { id: idOf(v.id, what, `v${i + 1}`, used), from: ref(v.from, `the start of ${what}`), dx, dy, label: label(v.label, `the label of ${what}`) };
  });
  if (s.optics !== undefined && s.optics !== null) {
    keys(s.optics, ['element', 'focal', 'objectDistance', 'objectHeight'], 'the ray diagram');
    const element = oneOf(s.optics.element, OPTICS, 'the lens or mirror', undefined);
    need(element, `The ray diagram needs its lens or mirror: ${OPTICS.join(', ')}.`);
    const o = {
      element,
      objectDistance: num(s.optics.objectDistance, 'the object\'s distance from the lens or mirror', { min: 0.01, max: 1000 }),
      objectHeight: num(s.optics.objectHeight ?? 1, 'the object\'s height', { min: -500, max: 500 }),
    };
    need(o.objectHeight !== 0, 'The object in a ray diagram needs a height.');
    if (element !== 'plane-mirror') o.focal = num(s.optics.focal, 'the focal length', { min: 0.01, max: 1000 });
    for (const p of ['object', 'image', 'element', 'axis', 'ray1', 'ray2']) used.add(p);
    out.optics = o;
  }
  const n = out.points.length + out.segments.length + out.rays.length + out.polygons.length + out.circles.length + out.angles.length + out.vectors.length;
  need(n > 0 || out.optics, 'The drawing needs something in it: a point, a line, a shape or an arrow.');
  if (s.steps !== undefined) out.steps = highlightSteps(s.steps, used);
  return out;
}

/* -------------------------------------------------------------- timeline -- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A date as a year (BCE as negative), "YYYY-MM" or "YYYY-MM-DD"; returns { value, text } with value in fractional years. */
export function readDate(v, what) {
  if (typeof v === 'number') {
    num(v, what, { min: -10000, max: 3000, int: true });
    return { value: v, text: v < 0 ? `${-v} BCE` : String(v) };
  }
  need(typeof v === 'string', `${cap(what)} must be a year, or a date written as year-month-day.`);
  const m = /^(\d{1,4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(v.trim());
  need(m, `${cap(what)} must be a year, or a date written as year-month-day, like 1947-08-15.`);
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : null;
  const d = m[3] ? Number(m[3]) : null;
  need(y <= 3000, `${cap(what)} is too far in the future.`);
  if (mo !== null) need(mo >= 1 && mo <= 12, `${cap(what)} has no such month.`);
  if (d !== null) need(d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate(), `${cap(what)} has no such day.`);
  const value = y + (mo ? (mo - 1) / 12 : 0) + (d ? (d - 1) / 365 : 0);
  // British order: 15 August 1947.
  const textOf = d ? `${d} ${MONTHS[mo - 1]} ${y}` : mo ? `${MONTHS[mo - 1]} ${y}` : String(y);
  return { value, text: textOf };
}

function timelineSpec(s) {
  keys(s, ['type', 'title', 'events'], 'the timeline');
  const used = namesFor(s);
  const events = list(s.events, 'events', LIMITS.events, { min: 2 }).map((e, i) => {
    const what = nth('event', i);
    keys(e, ['id', 'date', 'label'], what);
    const d = readDate(e.date, `the date of ${what}`);
    return { id: idOf(e.id, what, `e${i + 1}`, used), date: e.date, label: label(e.label, `the label of ${what}`, LIMITS.label, { required: true }), _value: d.value };
  });
  events.sort((a, b) => a._value - b._value);
  return { type: 'timeline', title: titleOf(s.title), events: events.map(({ _value, ...e }) => e) };
}

/* --------------------------------------------------------------- diagram -- */

export const LAYOUTS = ['flowchart', 'tree', 'cycle', 'network', 'mindmap'];
export const SHAPES = ['box', 'rounded', 'ellipse', 'circle', 'diamond', 'parallelogram', 'hexagon', 'note', 'cylinder'];
export const EDGE_STYLES = ['solid', 'dashed', 'dotted'];
export const ARROWS = ['forward', 'back', 'both', 'none'];

function diagramSpec(s) {
  keys(s, ['type', 'title', 'layout', 'direction', 'nodes', 'edges', 'steps'], 'the diagram');
  const layout = oneOf(s.layout, LAYOUTS, 'the kind of diagram', 'flowchart');
  const used = namesFor(s);
  const nodes = list(s.nodes, 'boxes', LIMITS.nodes, { min: 1 }).map((n, i) => {
    const what = nth('box', i);
    keys(n, ['id', 'label', 'shape'], what);
    return { id: idOf(n.id, what, `n${i + 1}`, used), label: label(n.label, what, LIMITS.label, { required: true }), shape: oneOf(n.shape, SHAPES, `the shape of ${what}`, layout === 'flowchart' ? 'rounded' : 'ellipse') };
  });
  const byId = new Map(nodes.map((n) => [n.id.toLowerCase(), n.id]));
  const edges = list(s.edges, 'arrows between boxes', LIMITS.edges).map((e, i) => {
    const what = nth('arrow', i);
    keys(e, ['id', 'from', 'to', 'label', 'style', 'arrow'], what);
    const end = (v, w) => {
      need(typeof v === 'string' && byId.has(v.toLowerCase()), `${cap(w)} names a box the diagram does not have.`);
      return byId.get(v.toLowerCase());
    };
    return {
      id: idOf(e.id, what, `e${i + 1}`, used),
      from: end(e.from, `the start of ${what}`),
      to: end(e.to, `the end of ${what}`),
      label: label(e.label, `the label of ${what}`),
      style: oneOf(e.style, EDGE_STYLES, `the line of ${what}`, 'solid'),
      arrow: oneOf(e.arrow, ARROWS, `the arrowhead of ${what}`, layout === 'mindmap' || layout === 'network' ? 'none' : 'forward'),
    };
  });
  const out = {
    type: 'diagram',
    title: titleOf(s.title),
    layout,
    direction: oneOf(s.direction, ['down', 'right'], 'the direction of the diagram', 'down'),
    nodes,
    edges,
  };
  if (s.steps !== undefined) out.steps = highlightSteps(s.steps, used);
  return out;
}

/* -------------------------------------------------------------- molecule -- */

const SMILES = /^[A-Za-z0-9@+\-[\]()=#$:/\\.%*]+$/;

function moleculeSpec(s) {
  keys(s, ['type', 'title', 'smiles', 'name', 'formula'], 'the molecule');
  need(typeof s.smiles === 'string' && s.smiles.trim(), 'The molecule needs its structure as a SMILES string, such as CCO for ethanol.');
  const smiles = s.smiles.trim();
  need(smiles.length <= LIMITS.smiles, `The SMILES string is longer than ${LIMITS.smiles} characters.`);
  need(SMILES.test(smiles), 'The SMILES string has a character SMILES does not use.');
  const out = { type: 'molecule', title: titleOf(s.title), smiles, name: label(s.name, 'the molecule\'s name') };
  if (s.formula !== undefined && s.formula !== null && s.formula !== '') {
    need(typeof s.formula === 'string' && /^[A-Z][A-Za-z0-9+\-]{0,39}$/.test(s.formula.trim()), 'The stated formula must be written like C2H6O.');
    out.formula = s.formula.trim();
  }
  return out;
}

/* --------------------------------------------------------------- pattern -- */

export const PATTERN_SHAPES = ['circle', 'square', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'cross', 'arrow', 'semicircle'];
export const PATTERN_FILLS = ['solid', 'outline', 'dotted'];
export const PATTERN_COLOURS = ['green', 'gold', 'blue', 'grey'];

function patternSpec(s) {
  keys(s, ['type', 'title', 'items'], 'the pattern');
  const items = list(s.items, 'items in the pattern', LIMITS.patternItems, { min: 2 }).map((it, i) => {
    const what = nth('item', i);
    if (isObj(it) && it.blank === true) {
      keys(it, ['blank'], what);
      return { blank: true };
    }
    keys(it, ['shape', 'fill', 'colour', 'size', 'rotate', 'count'], what);
    const shape = oneOf(it.shape, PATTERN_SHAPES, `the shape of ${what}`, undefined);
    need(shape, `${cap(what)} needs a shape (${PATTERN_SHAPES.join(', ')}), or to be the blank.`);
    return {
      shape,
      fill: oneOf(it.fill, PATTERN_FILLS, `the fill of ${what}`, 'solid'),
      colour: oneOf(it.colour, PATTERN_COLOURS, `the colour of ${what}`, 'green'),
      size: oneOf(it.size, ['small', 'medium', 'large'], `the size of ${what}`, 'medium'),
      rotate: it.rotate === undefined ? 0 : num(it.rotate, `the turn of ${what}`, { min: 0, max: 359, int: true }),
      count: it.count === undefined ? 1 : num(it.count, `how many shapes ${what} shows`, { min: 1, max: 9, int: true }),
    };
  });
  need(items.some((it) => !it.blank), 'The pattern needs at least one shape.');
  return { type: 'pattern', title: titleOf(s.title), items };
}

/* ----------------------------------------------------------------- stack -- */

function frames(v, what, used = null) {
  return list(v, `frames in ${what}`, LIMITS.frames).map((f, i) => {
    const fw = `frame ${i + 1} of ${what}`;
    keys(f, ['id', 'label', 'note'], fw);
    const id = f.id === undefined ? `frame${i + 1}` : f.id;
    need(typeof id === 'string' && ID.test(id), `${cap(fw)} needs a short name made of letters, digits, - or _, starting with a letter.`);
    if (used) {
      need(!used.has(id.toLowerCase()), `Two frames in ${what} are both called "${id}".`);
      used.add(id.toLowerCase());
    }
    return { id, label: label(f.label, fw, LIMITS.label, { required: true }), note: label(f.note, `the note on ${fw}`) };
  });
}

function stackSpec(s) {
  keys(s, ['type', 'title', 'frames', 'steps'], 'the stack');
  const out = { type: 'stack', title: titleOf(s.title), frames: frames(s.frames, 'the stack', new Set()) };
  if (s.steps !== undefined) {
    out.steps = list(s.steps, 'steps', LIMITS.steps, { min: 1 }).map((st, i) => {
      const what = nth('step', i);
      keys(st, ['frames', 'caption'], what);
      return { frames: frames(st.frames, what, new Set()), caption: label(st.caption, `the caption of ${what}`, LIMITS.caption, { required: true }) };
    });
  }
  need(out.frames.length || out.steps?.length, 'The stack needs frames, or steps that push and pop them.');
  return out;
}

/* ----------------------------------------------------------------- entry -- */

const CHECKS = {
  plot: plotSpec,
  chart: chartSpec,
  numberline: numberlineSpec,
  geometry: geometrySpec,
  timeline: timelineSpec,
  diagram: diagramSpec,
  molecule: moleculeSpec,
  pattern: patternSpec,
  stack: stackSpec,
};

/** Which types may carry steps (stack carries its own, frame by frame). */
export const STEPPED_TYPES = ['plot', 'geometry', 'diagram', 'stack'];

/**
 * The spec as it will be stored, or a refusal. Pure and synchronous: the
 * chemistry engine's own check of a SMILES string runs later (figures/index.js
 * checkFigure), when the figure is saved.
 *
 * @returns {{ spec: object } | { reason: string }}
 */
export function normaliseSpec(raw) {
  try {
    need(isObj(raw), 'A figure must be described as a set of named values, starting with its type.');
    let bytes = 0;
    try {
      bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
    } catch {
      need(false, 'That figure could not be read.');
    }
    need(bytes <= LIMITS.specBytes, `That figure is described at more than ${Math.round(LIMITS.specBytes / 1000)} KB: make it smaller.`);
    need(FIGURE_TYPES.includes(raw.type), `A figure's type must be one of: ${FIGURE_TYPES.join(', ')}.`);
    return { spec: CHECKS[raw.type](raw) };
  } catch (err) {
    if (err instanceof FigureRefusal) return { reason: err.message };
    return { reason: 'That figure could not be read.' };
  }
}

/** The refusal sentence for a spec, or null when it is fine. */
export const specReason = (raw) => normaliseSpec(raw).reason ?? null;

export { readDate as dateOf };
