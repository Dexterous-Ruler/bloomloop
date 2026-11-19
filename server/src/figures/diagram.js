// Diagrams (flowchart, tree, cycle, network, mind map) laid out by Graphviz.
//
// The server writes the DOT itself. Nothing from the spec reaches Graphviz but
// escaped label text and values chosen from fixed lists (shapes, line styles,
// arrowheads), so there is no attribute passthrough: no URL, image, HTML label
// or tooltip can be asked for. Node ids in the DOT are n0, n1... and the ids in
// the SVG are set from the spec's validated names.
//
// Box sizes are measured here, not by Graphviz (see common.js emWidth): its own
// estimate counts code points at a Latin width, which made Hindi and Marathi
// boxes far too wide.

import { esc, wrap, textWidth, FONT, INK, AXIS, HIGHLIGHT } from './common.js';

const SHAPE = {
  box: { shape: 'box', style: 'filled', w: 1, h: 1 },
  rounded: { shape: 'box', style: 'rounded,filled', w: 1, h: 1 },
  ellipse: { shape: 'ellipse', style: 'filled', w: 1.3, h: 1.35 },
  circle: { shape: 'circle', style: 'filled', w: 1.25, h: 1.25 },
  diamond: { shape: 'diamond', style: 'filled', w: 1.75, h: 1.9 },
  parallelogram: { shape: 'parallelogram', style: 'filled', w: 1.4, h: 1 },
  hexagon: { shape: 'hexagon', style: 'filled', w: 1.3, h: 1.1 },
  note: { shape: 'note', style: 'filled', w: 1.1, h: 1 },
  cylinder: { shape: 'cylinder', style: 'filled', w: 1.05, h: 1.4 },
};

const ENGINE = { flowchart: 'dot', tree: 'dot', cycle: 'circo', network: 'neato', mindmap: 'twopi' };
const FONT_SIZE = 12;
const LINE_PX = 140;

/** A DOT string literal: backslashes doubled first, so no escape sequence can be smuggled in. */
const dotString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;

/** A label's lines, and the box size it needs, in inches (Graphviz's unit). */
export function nodeBox(label, shape) {
  const ls = wrap(label, LINE_PX, FONT_SIZE);
  const w = Math.max(...ls.map((l) => textWidth(l, FONT_SIZE)));
  const h = ls.length * FONT_SIZE * 1.3;
  const s = SHAPE[shape];
  let width = (w + 20) * s.w;
  let height = (h + 14) * s.h;
  if (shape === 'circle') width = height = Math.max(width, height);
  return { lines: ls, width: Math.max(width, 36) / 72, height: Math.max(height, 26) / 72 };
}

/** The DOT for a spec. `measured: false` leaves sizing to Graphviz, for the test that shows why we measure. */
export function diagramDot(spec, { prefix, hl, measured = true }) {
  const lit = (id) => hl.has(String(id).toLowerCase());
  const index = new Map(spec.nodes.map((n, i) => [n.id, `n${i}`]));
  const out = [
    'digraph G {',
    `graph [rankdir=${spec.direction === 'right' ? 'LR' : 'TB'}, bgcolor="transparent", pad="0.2", nodesep="0.35", ranksep="0.45", overlap="scale", splines="true"${spec.layout === 'mindmap' ? ', root="n0"' : ''}];`,
    `node [fontname=${dotString(FONT)}, fontsize=${FONT_SIZE}, color="${INK}", fontcolor="${INK}", fillcolor="#FFFFFF", penwidth=1.4];`,
    `edge [fontname=${dotString(FONT)}, fontsize=10, color="${AXIS}", fontcolor="${INK}", penwidth=1.3, arrowsize=0.8];`,
  ];
  for (const n of spec.nodes) {
    const s = SHAPE[n.shape];
    const box = nodeBox(n.label, n.shape);
    const attrs = [
      `id=${dotString(`${prefix}-${n.id}`)}`,
      `label=${measured ? `"${box.lines.map((l) => dotString(l).slice(1, -1)).join('\\n')}"` : dotString(n.label)}`,
      `shape=${s.shape}`,
      `style="${s.style}"`,
      ...(measured ? [`width=${box.width.toFixed(3)}`, `height=${box.height.toFixed(3)}`, 'fixedsize=true'] : []),
      ...(lit(n.id) ? [`color="${HIGHLIGHT}"`, 'penwidth=3', 'fillcolor="#FBF3E2"'] : []),
    ];
    out.push(`${index.get(n.id)} [${attrs.join(', ')}];`);
  }
  for (const e of spec.edges) {
    const attrs = [
      `id=${dotString(`${prefix}-${e.id}`)}`,
      `dir=${e.arrow === 'forward' ? 'forward' : e.arrow}`,
      ...(e.style !== 'solid' ? [`style=${e.style}`] : []),
      ...(e.label ? [`label=${dotString(e.label)}`] : []),
      ...(lit(e.id) ? [`color="${HIGHLIGHT}"`, 'penwidth=2.6'] : []),
    ];
    out.push(`${index.get(e.from)} -> ${index.get(e.to)} [${attrs.join(', ')}];`);
  }
  out.push('}');
  return out.join('\n');
}

/**
 * Graphviz's SVG cut down to drawing: its prologue, comments and per-node
 * titles go (only the figure's own title and description remain), its group
 * ids become the figure's, and each node and edge gets the data-part the steps
 * and later interactions use.
 */
function cleanGraphviz(svg, prefix) {
  const start = svg.indexOf('<svg');
  const open = svg.indexOf('>', start);
  const close = svg.lastIndexOf('</svg>');
  const head = svg.slice(start, open + 1);
  const vb = /viewBox="([\d.\s-]+)"/.exec(head)?.[1]?.trim().split(/\s+/).map(Number) ?? [0, 0, 100, 100];
  const prefixRe = prefix.replace(/[^a-z0-9-]/gi, '');
  const inner = svg.slice(open + 1, close)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/ xml:space="preserve"/g, '')
    // Graphviz writes a hyphen in an id as &#45;; the ids are ours, so they are written back plainly.
    .replace(/ id="([^"]*)"/g, (_, v) => ` id="${v.replace(/&#45;/g, '-')}"`)
    .replace(/<g id="graph0" class="graph"/,`<g id="${prefixRe}-graph" class="graph"`)
    .replace(new RegExp(`<g id="${prefixRe}-([A-Za-z][A-Za-z0-9_-]{0,23})" class="(node|edge)">`, 'g'), `<g id="${prefixRe}-$1" class="$2" data-part="$1">`)
    .replace(/\n/g, '');
  return { inner, width: vb[2], height: vb[3] };
}

const LAYOUT_WORD = { flowchart: 'A flowchart', tree: 'A tree diagram', cycle: 'A cycle diagram', network: 'A network diagram', mindmap: 'A mind map' };

export function renderDiagram(spec, { prefix, hl, graphviz }) {
  const dot = diagramDot(spec, { prefix, hl });
  const raw = graphviz.layout(dot, 'svg', ENGINE[spec.layout]);
  const { inner, width, height } = cleanGraphviz(raw, prefix);
  const byId = new Map(spec.nodes.map((n) => [n.id, n]));
  const parts = [
    ...spec.nodes.map((n) => ({ part: n.id, label: n.label })),
    ...spec.edges.map((e) => ({ part: e.id, label: `${byId.get(e.from).label} to ${byId.get(e.to).label}${e.label ? ` (${e.label})` : ''}` })),
  ];
  const arrows = spec.edges.map((e) => {
    const a = byId.get(e.from).label;
    const b = byId.get(e.to).label;
    const link = e.arrow === 'none' ? `${a} is linked to ${b}` : e.arrow === 'back' ? `${b} leads to ${a}` : e.arrow === 'both' ? `${a} and ${b} lead to each other` : `${a} leads to ${b}`;
    return `${link}${e.label ? ` (${e.label})` : ''}`;
  });
  const description = `${LAYOUT_WORD[spec.layout]} with ${spec.nodes.length} box${spec.nodes.length === 1 ? '' : 'es'}: ${spec.nodes.map((n) => n.label).join('; ')}.${arrows.length ? ` ${arrows.join('; ')}.` : ''}`;
  const rows = spec.nodes.map((n) => {
    const next = spec.edges.filter((e) => e.from === n.id && e.arrow !== 'back').map((e) => `${byId.get(e.to).label}${e.label ? ` (${e.label})` : ''}`);
    const back = spec.edges.filter((e) => e.to === n.id && (e.arrow === 'back' || e.arrow === 'both' || e.arrow === 'none')).map((e) => `${byId.get(e.from).label}${e.label ? ` (${e.label})` : ''}`);
    return [n.label, [...next, ...back].join('; ') || '(nothing)'];
  });
  return {
    width,
    height,
    defs: '',
    body: inner,
    parts,
    description,
    title: spec.title || LAYOUT_WORD[spec.layout].replace(/^An? /, '').replace(/^./, (c) => c.toUpperCase()),
    table: { caption: 'Each box and what it leads to', columns: ['Box', 'Leads to or linked with'], rows },
    dot,
  };
}

export { esc };
