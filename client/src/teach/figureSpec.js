/**
 * The figure builder's plain helpers (batch 8): what each of the nine figure
 * types is called, the drawable spec each starts from, and the small rules the
 * forms share. No JSX here, so the gallery and the forms read the same data.
 *
 * A figure is described, never drawn here: the server checks the spec and
 * draws it (POST /api/figures/preview, then the bank's save). So this file
 * never decides whether a spec is valid. It only keeps the ids the steps and
 * the cross-references point at stable while the professor edits.
 */

/** The nine types, in the order the picker shows them, with a name a professor would use. */
export const TYPES = [
  { id: 'plot', label: 'Graph', line: 'Functions, points and shading on axes' },
  { id: 'chart', label: 'Chart', line: 'Bar, line, pie, histogram, dot or box plot' },
  { id: 'numberline', label: 'Number line', line: 'Points, intervals and rays' },
  { id: 'geometry', label: 'Geometry', line: 'Points, lines, shapes, angles, or a ray diagram' },
  { id: 'timeline', label: 'Timeline', line: 'Dated events, set out in order' },
  { id: 'diagram', label: 'Diagram', line: 'Flowchart, tree, cycle, network or mind map' },
  { id: 'molecule', label: 'Molecule', line: 'A structure drawn from its SMILES string' },
  { id: 'pattern', label: 'Pattern', line: 'A sequence of shapes with one left blank' },
  { id: 'stack', label: 'Call stack', line: 'Frames pushed and popped, step by step' },
];

export const TYPE_LABEL = Object.fromEntries(TYPES.map((t) => [t.id, t.label]));

export const CHART_LABEL = { bar: 'Bar', line: 'Line', pie: 'Pie', histogram: 'Histogram', dot: 'Dot plot', box: 'Box plot' };
export const LAYOUT_LABEL = { flowchart: 'Flowchart', tree: 'Tree', cycle: 'Cycle', network: 'Network', mindmap: 'Mind map' };
export const OPTICS_LABEL = {
  'convex-lens': 'Convex lens',
  'concave-lens': 'Concave lens',
  'concave-mirror': 'Concave mirror',
  'convex-mirror': 'Convex mirror',
  'plane-mirror': 'Plane mirror',
};
export const SHAPE_LABEL = {
  box: 'Box', rounded: 'Rounded box', ellipse: 'Ellipse', circle: 'Circle', diamond: 'Diamond (a decision)',
  parallelogram: 'Parallelogram (input or output)', hexagon: 'Hexagon', note: 'Note', cylinder: 'Cylinder (stored data)',
};
export const ARROW_LABEL = { forward: 'Arrow at the end', back: 'Arrow at the start', both: 'Arrows at both ends', none: 'No arrowhead' };

/** Each function family as a professor reads it, with what its numbers do. */
export const FAMILY = {
  linear: { label: 'Straight line', form: 'y = m·x + c' },
  quadratic: { label: 'Quadratic', form: 'y = a·x² + b·x + c' },
  cubic: { label: 'Cubic', form: 'y = a·x³ + b·x² + c·x + d' },
  exponential: { label: 'Exponential', form: 'y = a·baseˣ + c' },
  logarithmic: { label: 'Logarithmic', form: 'y = a·log_base(x − h) + c' },
  sine: { label: 'Sine', form: 'y = a·sin(b·x + c) + d' },
  cosine: { label: 'Cosine', form: 'y = a·cos(b·x + c) + d' },
  absolute: { label: 'Absolute value', form: 'y = a·|x − h| + k' },
  step: { label: 'Step (piecewise)', form: 'flat pieces, each with its own height' },
};

/** The caps the server sends with /kinds; used only to grey out an Add button before the server would refuse. */
export const DEFAULT_LIMITS = {
  label: 60, title: 120, caption: 160, steps: 12, highlight: 20, functions: 6, plotPoints: 40, segments: 30,
  shades: 6, stepPieces: 20, categories: 24, series: 4, slices: 8, bins: 30, dots: 200, boxes: 6, numberTicks: 60,
  numberPoints: 20, intervals: 6, rays: 6, geoPoints: 30, polygons: 8, polygonCorners: 12, circles: 6, angles: 10,
  vectors: 12, events: 30, nodes: 25, edges: 50, smiles: 200, patternItems: 12, frames: 10,
};

/** Which types carry steps that light up parts (stack carries frames per step instead). */
export const HIGHLIGHT_STEPS = ['plot', 'geometry', 'diagram'];

/**
 * A drawable figure for each type (and each chart kind and geometry mode), so a
 * professor starts from a picture and edits it, never from an empty form.
 */
export const STARTERS = {
  plot: {
    type: 'plot', title: '',
    x: { min: -5, max: 5, label: 'x' }, y: { min: -5, max: 5, label: 'y' }, grid: true,
    functions: [{ id: 'f1', family: 'linear', params: { m: 1, c: 0 }, label: '' }],
    points: [], segments: [], shade: [],
  },
  'chart.bar': {
    type: 'chart', chart: 'bar', title: '', x: { label: '' }, y: { label: '' },
    categories: ['A', 'B', 'C'], series: [{ name: '', values: [3, 5, 2] }],
  },
  'chart.line': {
    type: 'chart', chart: 'line', title: '', x: { label: '' }, y: { label: '' },
    categories: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: '', values: [3, 5, 2, 6] }],
  },
  'chart.pie': {
    type: 'chart', chart: 'pie', title: '',
    slices: [{ label: 'First', value: 50 }, { label: 'Second', value: 30 }, { label: 'Third', value: 20 }],
  },
  'chart.histogram': {
    type: 'chart', chart: 'histogram', title: '', x: { label: '' }, y: { label: '' },
    bins: [{ from: 0, to: 10, count: 3 }, { from: 10, to: 20, count: 7 }, { from: 20, to: 30, count: 4 }],
  },
  'chart.dot': { type: 'chart', chart: 'dot', title: '', x: { label: '' }, values: [1, 2, 2, 3, 3, 3, 4, 5] },
  'chart.box': {
    type: 'chart', chart: 'box', title: '', x: { label: '' },
    boxes: [{ label: '', min: 20, q1: 35, median: 48, q3: 60, max: 90 }],
  },
  numberline: {
    type: 'numberline', title: '', min: -5, max: 5, step: 1, labelEvery: 1,
    points: [{ id: 'p1', value: 2, label: '', open: false }], intervals: [], rays: [],
  },
  'geometry.shapes': {
    type: 'geometry', title: '', view: { xMin: -1, xMax: 7, yMin: -1, yMax: 6 }, grid: false, axes: false,
    points: [
      { id: 'A', x: 0, y: 0, label: 'A' }, { id: 'B', x: 6, y: 0, label: 'B' }, { id: 'C', x: 2, y: 5, label: 'C' },
    ],
    segments: [], rays: [], polygons: [{ id: 'shape1', points: ['A', 'B', 'C'], label: '', shaded: false }],
    circles: [], angles: [], vectors: [],
  },
  'geometry.optics': {
    type: 'geometry', title: '', optics: { element: 'convex-lens', focal: 10, objectDistance: 25, objectHeight: 4 },
  },
  timeline: {
    type: 'timeline', title: '',
    events: [{ id: 'e1', date: 1947, label: 'First event' }, { id: 'e2', date: 1950, label: 'Second event' }],
  },
  diagram: {
    type: 'diagram', title: '', layout: 'flowchart', direction: 'down',
    nodes: [{ id: 'n1', label: 'Start', shape: 'ellipse' }, { id: 'n2', label: 'Next step', shape: 'rounded' }],
    edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '' }],
  },
  molecule: { type: 'molecule', title: '', smiles: 'CCO', name: 'Ethanol' },
  pattern: {
    type: 'pattern', title: '',
    items: [{ shape: 'triangle' }, { shape: 'square', fill: 'outline' }, { shape: 'triangle', count: 2 }, { blank: true }],
  },
  stack: { type: 'stack', title: '', frames: [{ id: 'main', label: 'main', note: '' }] },
};

/** The key a spec's draft is kept under: its type, and for a chart its kind, for geometry its mode. */
export function draftKey(spec) {
  if (spec?.type === 'chart') return `chart.${spec.chart ?? 'bar'}`;
  if (spec?.type === 'geometry') return spec.optics ? 'geometry.optics' : 'geometry.shapes';
  return spec?.type ?? null;
}

export const typeOfKey = (key) => String(key ?? '').split('.')[0] || null;

/** A fresh copy of a starter, so editing it never touches the table above. */
export const starter = (key) => JSON.parse(JSON.stringify(STARTERS[key] ?? STARTERS[typeOfKey(key)] ?? null));

/** The first id from `prefix1, prefix2, ...` (or a letter, when prefix is '') that no part of the figure uses yet. */
export function nextId(prefix, used) {
  const taken = new Set([...used].map((s) => String(s).toLowerCase()));
  if (!prefix) {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!taken.has(ch.toLowerCase())) return ch;
    prefix = 'P';
  }
  for (let i = 1; i < 1000; i += 1) if (!taken.has(`${prefix}${i}`.toLowerCase())) return `${prefix}${i}`;
  return `${prefix}${Date.now()}`;
}

/** Every id a spec names, across its lists, so a new one never collides. */
export function idsIn(spec) {
  const out = [];
  for (const v of Object.values(spec ?? {})) {
    if (!Array.isArray(v)) continue;
    for (const it of v) if (it && typeof it === 'object' && typeof it.id === 'string') out.push(it.id);
  }
  return out;
}

/** Take an id out of every step's lit-up parts, after the part it named is removed. */
export function dropFromSteps(spec, ids) {
  if (!Array.isArray(spec.steps)) return spec;
  const gone = new Set(ids.map((s) => String(s).toLowerCase()));
  return { ...spec, steps: spec.steps.map((s) => (Array.isArray(s.highlight) ? { ...s, highlight: s.highlight.filter((h) => !gone.has(String(h).toLowerCase())) } : s)) };
}

/** "3 steps", "1 step". */
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A number typed in a box: a number when it reads as one, else the text as typed (the server then says what is wrong). */
export function readNumber(text) {
  const t = String(text ?? '').trim().replace(/[−–]/g, '-');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

/** A timeline date as typed: a whole year (negative for BCE) as a number, a date as text. */
export function readDate(text) {
  const t = String(text ?? '').trim().replace(/[−–]/g, '-');
  return /^-?\d{1,5}$/.test(t) ? Number(t) : t;
}

export const dateText = (v) => (typeof v === 'number' ? String(v) : String(v ?? ''));

/**
 * The spec to send: the draft with the step list dropped when it is empty (a
 * stack's empty steps would read as "steps that push nothing").
 */
export function specOut(draft) {
  if (!draft) return null;
  const out = { ...draft };
  if (Array.isArray(out.steps) && out.steps.length === 0) delete out.steps;
  return out;
}
