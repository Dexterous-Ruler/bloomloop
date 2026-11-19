// The figure engines' one entrance: a spec in, { svg, description, table } out.
//
// Everything that shows a figure - a phone, the projector, the Learning Hub, a
// room's archive, the professor's own preview - comes through renderFigure(), so
// they all show the same picture. The description and the data table are built
// from the spec by the same code that draws it, never by a model, so they always
// say what the picture shows. They say only what is drawn: a value the engine
// worked out (a length, an angle, where an image forms, a formula, the largest
// bar) is so often what a question asks that it goes to the professor alone
// (`worked`, figureForStaff), never to a student before they answer.
//
// Two engines are WebAssembly and load once (about 0.2 s): Graphviz for
// diagrams and RDKit for molecules. After that every render is synchronous,
// which is what lets forStudent() stay synchronous. The server loads them before
// it listens (index.js); checkFigure(), which every save goes through, waits for
// them. A render asked for in the moment before they load says so, and draws.
//
// Renders are cached by a hash of the spec (and the step), so a room of sixty
// phones asking for the same question draws it once.

import crypto from 'node:crypto';

import { FigureRefusal, safeSvg, wrapSvg } from './common.js';
import { normaliseSpec, STEPPED_TYPES, specReason } from './spec.js';
import { renderPlot } from './plot.js';
import { renderChart } from './chart.js';
import { renderNumberline } from './numberline.js';
import { renderGeometry } from './geometry.js';
import { renderTimeline, renderPattern, renderStack } from './sequences.js';
import { renderDiagram } from './diagram.js';
import { renderMolecule } from './molecule.js';

export { FIGURE_TYPES, LIMITS, normaliseSpec, specReason, STEPPED_TYPES } from './spec.js';

/** Bumped whenever a renderer's output changes, so a cached picture is never stale across versions. */
export const RENDERER_VERSION = 1;

let graphviz = null;
let rdkit = null;
let loading = null;

/** Load Graphviz and RDKit once. Safe to call any number of times; a failure lets the next call try again. */
export function loadFigureEngines() {
  if (graphviz && rdkit) return Promise.resolve();
  loading ??= (async () => {
    const [{ Graphviz }, rd] = await Promise.all([import('@hpcc-js/wasm-graphviz'), import('@rdkit/rdkit')]);
    graphviz = await Graphviz.load();
    rdkit = await (rd.default ?? rd)();
  })().catch((err) => {
    loading = null;
    throw err;
  });
  return loading;
}

export const enginesReady = () => Boolean(graphviz && rdkit);
const NEEDS_ENGINE = new Set(['diagram', 'molecule']);
/** Does drawing this (normalised or raw) spec need Graphviz or RDKit? */
export const needsEngine = (spec) => NEEDS_ENGINE.has(spec?.type);

/**
 * The largest picture the server sends. Every phone in a room downloads it, and
 * it is drawn synchronously, so a spec that would make more (a grid, a frame in
 * real-world units) is refused rather than drawn. The largest figures the caps
 * in spec.js allow (a 120-atom molecule, 25 boxes, 200 dots) stay far under it.
 */
export const MAX_SVG_BYTES = 300 * 1024;

const CACHE_SIZE = 400;
/** What the cache may hold in all, so a run of unusual figures cannot fill the process's memory. */
const CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map();
let cachedBytes = 0;

const sizeOf = (value) => (value.svg?.length ?? 0) + (value.description?.length ?? 0) + 512;

function remember(key, value) {
  const size = sizeOf(value);
  while (cache.size && (cache.size >= CACHE_SIZE || cachedBytes + size > CACHE_BYTES)) {
    const oldest = cache.keys().next().value;
    cachedBytes -= sizeOf(cache.get(oldest));
    cache.delete(oldest);
  }
  cache.set(key, value);
  cachedBytes += size;
  return value;
}

/** A stable hash of a normalised spec: the cache key, and the source of the figure's id prefix. */
export const specHash = (spec) => crypto.createHash('sha256').update(`${RENDERER_VERSION}:${JSON.stringify(spec)}`).digest('hex');

const RENDER = {
  plot: renderPlot,
  chart: renderChart,
  numberline: renderNumberline,
  geometry: renderGeometry,
  timeline: renderTimeline,
  pattern: renderPattern,
  stack: renderStack,
  diagram: renderDiagram,
  molecule: renderMolecule,
};

/** How many steps a spec has (0 when it has none). */
export const stepCount = (spec) => (STEPPED_TYPES.includes(spec?.type) && Array.isArray(spec.steps) ? spec.steps.length : 0);

/**
 * Draw a figure, at a step (0 is the figure itself; 1..n light up step n's parts,
 * or show its stack). Never throws: a spec that cannot be drawn comes back with
 * ok: false, a sentence, and no picture.
 *
 * @returns {{ ok: boolean, reason?: string, pending?: boolean, svg: string|null, title: string,
 *   description: string, table: object|null, parts: object[], type: string, hash: string,
 *   step: number, stepCount: number, caption: string, formula?: string }}
 */
export function renderFigure(raw, { step = 0 } = {}) {
  const { spec, reason } = normaliseSpec(raw);
  if (!spec) return refused(reason, raw?.type);
  const hash = specHash(spec);
  const steps = stepCount(spec);
  const at = Number.isInteger(step) && step >= 0 && step <= steps ? step : 0;
  const key = `${hash}:${at}`;
  if (cache.has(key)) return cache.get(key);
  if (NEEDS_ENGINE.has(spec.type) && !enginesReady()) {
    loadFigureEngines().catch(() => {});
    const wait = 'This figure is still being prepared: try again in a moment.';
    return { ...refused(wait, spec.type), description: wait, pending: true };
  }
  const prefix = `fig-${hash.slice(0, 10)}`;
  const s = at ? spec.steps[at - 1] : null;
  const hl = new Set((s?.highlight ?? []).map((h) => h.toLowerCase()));
  let out;
  try {
    out = RENDER[spec.type](spec, {
      prefix, hl, graphviz, rdkit, ...(spec.type === 'stack' && s ? { frames: s.frames, caption: s.caption } : {}),
    });
  } catch (err) {
    // An engine failure is the server's fault, not the spec's; it is logged and refused politely.
    if (!(err instanceof FigureRefusal)) console.error('[figures] render failed:', err?.message ?? err);
    return refused(err instanceof FigureRefusal ? err.message : 'This figure could not be drawn.', spec.type);
  }
  if (out.ok === false) return remember(key, { ...refused(out.reason, spec.type), ...(out.formula ? { formula: out.formula } : {}) });
  const caption = s?.caption ?? '';
  const description = `${out.description}${caption && spec.type !== 'stack' ? ` Step ${at} of ${steps}: ${caption}` : ''}`;
  const svg = wrapSvg({ prefix, width: out.width, height: out.height, title: out.title, description, body: out.body, defs: out.defs });
  if (svg.length > MAX_SVG_BYTES) {
    return remember(key, refused('This figure has too much in it to send to every phone: show a smaller part of it, or fewer things.', spec.type));
  }
  // The last line of defence: whatever an engine wrote, only drawing leaves.
  if (!safeSvg(svg)) {
    console.error('[figures] a rendered figure failed the safety check:', spec.type);
    return refused('This figure could not be drawn safely.', spec.type);
  }
  return remember(key, {
    ok: true,
    type: spec.type,
    hash,
    svg,
    title: out.title,
    description,
    table: out.table,
    parts: out.parts,
    // What the engine worked out from the spec rather than drew (a length, an
    // angle, where an image forms, a formula, the largest bar): the professor's
    // to see, never in what a student is sent before answering, because it is
    // so often exactly what the question asks for.
    worked: out.worked ?? [],
    step: at,
    stepCount: steps,
    caption,
    ...(out.formula ? { formula: out.formula } : {}),
  });
}

function refused(reason, type) {
  return {
    ok: false, reason, type: type ?? null, hash: null, svg: null, title: 'Figure', description: 'This figure could not be drawn.',
    table: null, parts: [], step: 0, stepCount: 0, caption: '',
  };
}

/**
 * The check every save goes through: the spec is valid, the engines accept it
 * (a SMILES string RDKit reads, a stated formula that matches) and every step
 * draws. Waits for the engines.
 *
 * @returns {Promise<{ spec: object, render: object } | { reason: string }>}
 */
export async function checkFigure(raw) {
  const { spec, reason } = normaliseSpec(raw);
  if (!spec) return { reason };
  if (NEEDS_ENGINE.has(spec.type)) {
    try {
      await loadFigureEngines();
    } catch {
      return { reason: 'The drawing engines could not start, so this figure cannot be checked now. Try again in a minute.' };
    }
  }
  const render = renderFigure(spec);
  if (!render.ok) return { reason: render.reason };
  for (let i = 1; i <= render.stepCount; i += 1) {
    const r = renderFigure(spec, { step: i });
    if (!r.ok) return { reason: `Step ${i} could not be drawn: ${r.reason}` };
  }
  return { spec, render };
}

/**
 * A reason the engines refuse an already-valid spec, when they are loaded; null
 * when it draws, or when they have not loaded yet (the save path's own check,
 * checkFigure, waits for them). Used by the synchronous validator.
 */
export function engineReason(spec) {
  if (NEEDS_ENGINE.has(spec?.type) && !enginesReady()) return null;
  const r = renderFigure(spec);
  return r.ok ? null : r.reason;
}

/** A data table as people get it: caption, column names, rows of text. */
const tableView = (t) => (t ? { caption: String(t.caption ?? ''), columns: t.columns.map(String), rows: t.rows.map((r) => r.map(String)) } : null);

/**
 * A figure as a phone or a student may see it: the picture, its description
 * and its table, built field by field. Never the spec (a "plot this" figure's
 * spec could hold what the student is asked to find), never the steps.
 */
export function figureForStudent(spec) {
  const r = renderFigure(spec);
  return {
    kind: 'figure',
    type: r.type ?? spec?.type ?? null,
    title: r.title,
    svg: r.svg,
    description: r.description,
    table: tableView(r.table),
  };
}

/** A figure at one step, for the projector: the picture and its caption, with where it is in the steps. */
export function figureAtStep(spec, step) {
  const r = renderFigure(spec, { step });
  return {
    kind: 'figure',
    type: r.type,
    title: r.title,
    svg: r.svg,
    description: r.description,
    table: tableView(r.table),
    step: r.step,
    stepCount: r.stepCount,
    caption: r.caption,
  };
}

/**
 * A stepped figure with every step drawn, for a Hub lesson: the student steps
 * through it on their own phone, offline too, so every frame travels at once.
 */
export function figureWithSteps(spec) {
  const base = renderFigure(spec);
  const steps = [];
  for (let i = 1; i <= base.stepCount; i += 1) {
    const r = renderFigure(spec, { step: i });
    steps.push({ caption: r.caption, svg: r.svg, description: r.description });
  }
  return { ...figureForStudent(spec), steps };
}

/** The professor's view: everything a student gets, plus the parts by name and the worked-out formula. */
export function figureForStaff(spec) {
  const r = renderFigure(spec);
  return {
    ...figureForStudent(spec),
    ok: r.ok,
    ...(r.ok ? {} : { reason: r.reason }),
    parts: r.parts,
    worked: r.worked ?? [],
    stepCount: r.stepCount,
    steps: r.ok ? (spec.steps ?? []).map((s, i) => ({ caption: s.caption, highlight: s.highlight ?? null, frames: s.frames ?? null, index: i + 1 })) : [],
    ...(r.formula ? { formula: r.formula } : {}),
  };
}

/** For tests: forget every cached render. */
export const clearFigureCache = () => {
  cache.clear();
  cachedBytes = 0;
};

/** For tests: how many renders are cached (each is one drawing the server made). */
export const figureCacheSize = () => cache.size;
