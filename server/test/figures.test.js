// Batch 8 - the figure engines.
//
// Per spec type: what is refused and with which sentence, escaping (a script tag
// in a label), Hindi and Marathi labels in a diagram, the 25-box cap, a broken
// SMILES string, malformed specs, and a render snapshot of each type. Then the
// figure as a phone gets it (forStudent), the projector's step, a lesson's
// figure step, and the pictures kept from a small .pptx built here. The
// end-to-end half, over HTTP and the socket, is server/scripts/figures.mjs.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadFigureEngines, renderFigure, checkFigure, normaliseSpec, figureForStudent, figureAtStep, figureWithSteps, LIMITS, specHash,
} from '../src/figures/index.js';
import { safeSvg, textWidth, graphemes } from '../src/figures/common.js';
import { diagramDot } from '../src/figures/diagram.js';
import { evaluate, equation } from '../src/figures/plot.js';
import { opticsImage } from '../src/figures/geometry.js';
import { hill, countsOf } from '../src/figures/molecule.js';
import { invalidReason, forStudent } from '../src/questionTypes.js';
import { screenChangeFrom, toProjector } from '../src/services/projector.js';
import { slidePictures, slidePicturesNote, slideAlt } from '../src/services/slideImages.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { studentLessonView, staffLessonView } from '../src/services/hubLessons.js';
import {
  SPECS, DEVANAGARI, PNG, PNG_WITH_TEXT, JPEG, EMF, SVG_PICTURE, bigPng, deckWithPictures,
} from './fixtures/figures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOTS = path.join(here, 'snapshots', 'figures');

const refusal = (spec) => normaliseSpec(spec).reason ?? null;

before(async () => {
  await loadFigureEngines();
});

describe('every type draws, safely, with a description and a table', () => {
  for (const [name, spec] of Object.entries(SPECS)) {
    test(name, async () => {
      const checked = await checkFigure(spec);
      assert.equal(checked.reason, undefined, checked.reason);
      const r = checked.render;
      assert.equal(r.ok, true);
      assert.ok(safeSvg(r.svg), 'only drawing elements and attributes');
      assert.match(r.svg, /^<svg [^>]*role="img"/);
      assert.match(r.svg, /<title id="fig-[0-9a-f]{10}-title">/);
      assert.match(r.svg, /<desc id="fig-[0-9a-f]{10}-desc">/);
      assert.ok(r.description.length > 20);
      assert.ok(r.table && Array.isArray(r.table.columns) && Array.isArray(r.table.rows));
      // Every addressable part has a stable id under the figure's prefix and its own name.
      for (const p of r.parts) assert.ok(r.svg.includes(`data-part="${p.part}"`), `part ${p.part} is in the drawing`);
      // The same spec draws the same picture, so a phone and the wall agree.
      assert.equal(renderFigure(spec).svg, r.svg);
    });
  }
});

describe('render snapshots', () => {
  for (const name of Object.keys(SPECS)) {
    test(`${name} matches its snapshot`, () => {
      const file = path.join(SNAPSHOTS, `${name}.svg`);
      const svg = renderFigure(SPECS[name]).svg;
      if (process.env.UPDATE_FIGURE_SNAPSHOTS === '1') {
        fs.mkdirSync(SNAPSHOTS, { recursive: true });
        fs.writeFileSync(file, svg);
      }
      assert.ok(fs.existsSync(file), `no snapshot for ${name}: run with UPDATE_FIGURE_SNAPSHOTS=1 once and look at it`);
      assert.equal(svg, fs.readFileSync(file, 'utf8'));
    });
  }
});

describe('what is refused, in a sentence', () => {
  test('malformed specs', () => {
    assert.match(refusal(null), /set of named values/);
    assert.match(refusal('<svg onload="x"/>'), /set of named values/);
    assert.match(refusal([1, 2]), /set of named values/);
    assert.match(refusal({ type: 'svg', svg: '<svg/>' }), /type must be one of/);
    assert.match(refusal({ type: 'plot', x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, points: [{ x: 0, y: 0 }], onclick: 'x' }), /"onclick", which a figure cannot use/);
    assert.match(refusal({ type: 'plot', x: { min: 0, max: NaN }, y: { min: 0, max: 1 } }), /must be a number/);
    assert.match(refusal({ type: 'plot', x: { min: 0, max: Infinity }, y: { min: 0, max: 1 } }), /must be a number/);
    assert.match(refusal({ type: 'plot', x: { min: 0, max: 1e9 }, y: { min: 0, max: 1 } }), /between/);
    assert.match(refusal({ type: 'plot', x: { min: 2, max: 1 }, y: { min: 0, max: 1 } }), /highest value must be above/);
    const huge = { type: 'pattern', items: [{ shape: 'circle' }, { blank: true }], title: 'x'.repeat(30000) };
    assert.match(refusal(huge), /more than 20 KB/);
  });

  test('plot: only fixed families, numeric parameters, no expressions', () => {
    const base = { type: 'plot', x: { min: -5, max: 5 }, y: { min: -5, max: 5 } };
    assert.match(refusal({ ...base, functions: [{ family: 'expression', params: { f: 'x^2' } }] }), /kind of function 1 must be one of/);
    assert.match(refusal({ ...base, functions: [{ family: 'linear', params: { m: '2*x' } }] }), /Function 1's m must be a number/);
    assert.match(refusal({ ...base, functions: [{ family: 'linear', params: { expr: 1 } }] }), /"expr", which a figure cannot use/);
    assert.match(refusal({ ...base, functions: [{ family: 'quadratic', params: { a: 0 } }] }), /non-zero a/);
    assert.match(refusal({ ...base, functions: [{ family: 'exponential', params: { base: 1 } }] }), /positive and not 1/);
    assert.match(refusal({ ...base, functions: Array.from({ length: 7 }, () => ({ family: 'linear' })) }), /at most 6 functions/);
    assert.match(refusal({ ...base, shade: [{ from: 0, to: 1, under: 'nothing' }] }), /function the graph does not have/);
    // Empty axes pass the spec check: they are the board a plot question is
    // answered on (Batch 8). As a question's stimulus anywhere else they carry
    // nothing, and the question validator refuses them there.
    assert.equal(refusal(base), null);
    const onMcq = { text: 'Which?', bloom: 'remember', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, stimulus: { kind: 'figure', spec: base } };
    assert.match(invalidReason(onMcq), /needs something on it/);
    assert.match(refusal({ ...base, points: [{ x: 1, y: 1 }], steps: [{ highlight: ['zzz'], caption: 'x' }] }), /not a part of the figure/);
    assert.match(refusal({ ...base, points: [{ id: 'A', x: 1, y: 1 }, { id: 'a', x: 2, y: 2 }] }), /both called/);
  });

  test('plot maths is the family\'s and nothing else', () => {
    assert.equal(evaluate({ family: 'linear', params: { m: 2, c: 1 } }, 3), 7);
    assert.equal(evaluate({ family: 'quadratic', params: { a: 1, b: 0, c: -4 } }, 2), 0);
    assert.ok(Number.isNaN(evaluate({ family: 'logarithmic', params: { a: 1, base: 10, h: 0, c: 0 } }, -1)));
    assert.equal(evaluate({ family: 'step', pieces: [{ from: 0, to: 1, y: 5 }] }, 0.5), 5);
    assert.equal(equation({ family: 'linear', params: { m: -1, c: 3 } }), 'y = \u2212x + 3');
    assert.equal(equation({ family: 'quadratic', params: { a: 1, b: 0, c: -4 } }), 'y = x\u00b2 \u2212 4');
  });

  test('chart', () => {
    assert.match(refusal({ type: 'chart', chart: 'radar' }), /kind of chart must be one of/);
    assert.match(refusal({ type: 'chart', chart: 'bar', categories: ['a', 'b'], series: [{ values: [1] }] }), /one value for each of the 2 categories/);
    assert.match(refusal({ type: 'chart', chart: 'pie', slices: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }), /at least one slice above zero/);
    assert.match(refusal({ type: 'chart', chart: 'histogram', bins: [{ from: 0, to: 10, count: 1 }, { from: 12, to: 20, count: 1 }] }), /no gap or overlap/);
    assert.match(refusal({ type: 'chart', chart: 'box', boxes: [{ min: 5, q1: 3, median: 4, q3: 6, max: 9 }] }), /each at least the one before/);
    assert.match(refusal({ type: 'chart', chart: 'dot', values: [1], bins: [] }), /does not use bins/);
  });

  test('number line', () => {
    assert.match(refusal({ type: 'numberline', min: 0, max: 1000, step: 1 }), /more than 60 ticks/);
    assert.match(refusal({ type: 'numberline', min: 0, max: 10, points: [{ value: 11 }] }), /off the number line/);
    assert.match(refusal({ type: 'numberline', min: 0, max: 10, rays: [{ from: 2 }] }), /direction: left or right/);
  });

  test('geometry and ray diagrams', () => {
    const view = { xMin: 0, xMax: 5, yMin: 0, yMax: 5 };
    assert.match(refusal({ type: 'geometry', points: [{ x: 1, y: 1 }] }), /needs a frame/);
    assert.match(refusal({ type: 'geometry', view, segments: [{ from: 'A', to: [1, 1] }] }), /names a point "A"/);
    assert.match(refusal({ type: 'geometry', view, polygons: [{ points: [[0, 0], [1, 1]] }] }), /at least 3 corners/);
    assert.match(refusal({ type: 'geometry', view, vectors: [{ from: [0, 0], dx: 0, dy: 0 }] }), /has no length/);
    assert.match(refusal({ type: 'geometry', optics: { element: 'prism', focal: 1, objectDistance: 2 } }), /lens or mirror/);
    // The image is worked out, not given: 1/v - 1/u = 1/f for a convex lens.
    const img = opticsImage({ element: 'convex-lens', focal: 10, objectDistance: 25, objectHeight: 4 });
    assert.ok(Math.abs(img.v - 50 / 3) < 1e-9 && img.real === true && img.hi < 0);
    const mirror = opticsImage({ element: 'concave-mirror', focal: 10, objectDistance: 30, objectHeight: 4 });
    assert.ok(Math.abs(mirror.v + 15) < 1e-9 && mirror.real === true);
    assert.equal(opticsImage({ element: 'plane-mirror', objectDistance: 10, objectHeight: 4 }).real, false);
    assert.equal(opticsImage({ element: 'convex-lens', focal: 10, objectDistance: 10, objectHeight: 4 }).infinite, true);
    assert.equal(renderFigure({ type: 'geometry', optics: { element: 'convex-lens', focal: 10, objectDistance: 10, objectHeight: 4 } }).ok, true);
  });

  test('timeline', () => {
    assert.match(refusal({ type: 'timeline', events: [{ date: 1947, label: 'x' }] }), /at least 2 events/);
    assert.match(refusal({ type: 'timeline', events: [{ date: '1947-02-30', label: 'x' }, { date: 1950, label: 'y' }] }), /no such day/);
    assert.match(refusal({ type: 'timeline', events: [{ date: 'last year', label: 'x' }, { date: 1950, label: 'y' }] }), /year-month-day/);
    const r = renderFigure({ type: 'timeline', events: [{ date: '1947-08-15', label: 'Independence' }, { date: -326, label: 'Alexander at the Hydaspes' }] });
    assert.match(r.description, /from 326 BCE to 15 August 1947/);
  });

  test('timeline labels do not overlap, even for close years', () => {
    const events = Array.from({ length: 12 }, (_, i) => ({ date: 1940 + (i % 4), label: `Event number ${i + 1}` }));
    const r = renderFigure({ type: 'timeline', events });
    assert.equal(r.ok, true);
    // Each event's date line sits at its own place: read the bold date texts back with their positions.
    const boxes = [...r.svg.matchAll(/<text id="[^"]*"|<text x="([\d.]+)" y="([\d.]+)"[^>]*font-weight="700"[^>]*>([^<]+)<\/text>/g)]
      .filter((m) => m[1]).map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: textWidth(m[3], 11) }));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i];
        const b = boxes[j];
        if (Math.abs(a.y - b.y) < 1) assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2, `two dates overlap at y=${a.y}`);
      }
    }
  });

  test('diagram: 25 boxes at most, shapes and arrows from fixed lists', () => {
    const nodes = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Box ${i}` }));
    assert.equal(refusal({ type: 'diagram', nodes: nodes(25) }), null);
    assert.equal(refusal({ type: 'diagram', nodes: nodes(26) }), `A figure can have at most ${LIMITS.nodes} boxes.`);
    assert.match(refusal({ type: 'diagram', nodes: [{ id: 'a', label: 'x', shape: 'image' }] }), /shape of box 1 must be one of/);
    assert.match(refusal({ type: 'diagram', nodes: [{ id: 'a', label: 'x', URL: 'javascript:alert(1)' }] }), /"URL", which a figure cannot use/);
    assert.match(refusal({ type: 'diagram', nodes: [{ id: 'a', label: 'x' }], edges: [{ from: 'a', to: 'b' }] }), /names a box the diagram does not have/);
    assert.match(refusal({ type: 'diagram', nodes: [{ id: 'a b', label: 'x' }] }), /short name/);
    assert.match(refusal({ type: 'diagram', nodes: [{ id: 'a', label: 'x\u202Eevil' }] }), /cannot be shown/);
  });

  test('molecule: RDKit reads it, and a stated formula must match', async () => {
    assert.match((await checkFigure({ type: 'molecule', smiles: 'C1CC(' })).reason, /not a molecule the chemistry engine can read/);
    assert.match((await checkFigure({ type: 'molecule', smiles: 'CCO', formula: 'C2H5O' })).reason, /does not match the structure drawn, which is C2H6O/);
    assert.equal((await checkFigure({ type: 'molecule', smiles: 'CCO', formula: 'C2H5OH' })).reason, undefined, 'a condensed formula counts the same atoms');
    assert.match(refusal({ type: 'molecule', smiles: 'CC O' }), /character SMILES does not use/);
    assert.match(refusal({ type: 'molecule', smiles: 'C'.repeat(201) }), /longer than 200/);
    assert.equal(renderFigure({ type: 'molecule', smiles: 'c1ccccc1O' }).formula, 'C6H6O');
    assert.equal(hill({ C: 1, H: 4 }), 'CH4');
    assert.equal(hill({ Na: 1, Cl: 1 }), 'ClNa');
    assert.deepEqual(countsOf('C2H5OH'), { C: 2, H: 6, O: 1 });
  });

  test('pattern and stack', () => {
    assert.match(refusal({ type: 'pattern', items: [{ blank: true }, { blank: true }] }), /at least one shape/);
    assert.match(refusal({ type: 'pattern', items: [{ shape: 'smiley' }, { blank: true }] }), /shape of item 1 must be one of/);
    assert.match(refusal({ type: 'pattern', items: [{ fill: 'solid' }, { blank: true }] }), /needs a shape/);
    assert.match(refusal({ type: 'pattern', items: [{ shape: 'circle', count: 12 }, { blank: true }] }), /between 1 and 9/);
    assert.match(refusal({ type: 'stack' }), /needs frames, or steps/);
    assert.match(refusal({ type: 'stack', frames: Array.from({ length: 11 }, (_, i) => ({ label: `f${i}` })) }), /at most 10 frames/);
    assert.match(refusal({ type: 'stack', frames: [{ label: 'a' }], steps: [{ frames: [{ label: 'a' }] }] }), /caption of step 1 needs a label/);
  });
});

describe('escaping', () => {
  test('a script tag in a label is text, never markup, in every engine', async () => {
    const evil = '<script>alert(1)</script>';
    const specs = [
      { type: 'plot', x: { min: 0, max: 1, label: evil }, y: { min: 0, max: 1 }, points: [{ x: 0.5, y: 0.5, label: evil }] },
      { type: 'chart', chart: 'bar', title: evil, categories: [evil], series: [{ name: evil, values: [1] }] },
      { type: 'numberline', min: 0, max: 5, points: [{ value: 1, label: evil }] },
      { type: 'geometry', view: { xMin: 0, xMax: 5, yMin: 0, yMax: 5 }, points: [{ id: 'A', x: 1, y: 1, label: evil }] },
      { type: 'timeline', events: [{ date: 1900, label: evil }, { date: 1901, label: '"><img src=x onerror=alert(1)>' }] },
      { type: 'diagram', nodes: [{ id: 'a', label: evil }, { id: 'b', label: 'x" URL="javascript:alert(1)' }], edges: [{ from: 'a', to: 'b', label: '\\N\\G' }] },
      { type: 'molecule', smiles: 'CCO', name: evil },
      { type: 'stack', frames: [{ label: evil, note: '&amp;<b>' }] },
    ];
    for (const spec of specs) {
      const r = (await checkFigure(spec)).render;
      assert.equal(r?.ok, true, spec.type);
      assert.ok(safeSvg(r.svg), spec.type);
      // No element but drawing, and the words only ever as text: never inside an attribute.
      assert.ok(!/<script|<img|<a[\s>]/i.test(r.svg), spec.type);
      assert.ok(!/="[^"]*(?:javascript:|onerror)/i.test(r.svg), spec.type);
      assert.ok(!/\sURL=|\sonerror=/i.test(r.svg.replace(/>[^<]*</g, '><')), `${spec.type}: no attribute made from a label`);
      assert.ok(r.svg.includes('&lt;script&gt;') || r.svg.includes('&lt;img'), `${spec.type} shows the text escaped`);
    }
  });

  test('a DOT label cannot carry an attribute or an escape sequence', () => {
    const { spec } = normaliseSpec({ type: 'diagram', nodes: [{ id: 'a', label: 'x" URL="javascript:1' }, { id: 'b', label: 'back\\slash \\N' }], edges: [] });
    const dot = diagramDot(spec, { prefix: 'p', hl: new Set() });
    assert.ok(dot.includes('label="x\\" URL=\\"javascript:1"'), dot);
    assert.ok(dot.includes('back\\\\slash \\\\N'), dot);
    assert.ok(!/\bURL=|href=|image=|tooltip=|<</.test(dot.replace(/label="[^"\\]*(?:\\.[^"\\]*)*"/g, '')));
  });

  test('the safety check refuses anything but drawing', () => {
    const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect x="0" y="0" width="1" height="1" fill="#FFFFFF"/></svg>';
    assert.equal(safeSvg(ok), true);
    assert.equal(safeSvg(ok.replace('<rect', '<script>alert(1)</script><rect')), false);
    assert.equal(safeSvg(ok.replace('<rect ', '<rect onload="x" ')), false);
    assert.equal(safeSvg(ok.replace('<rect ', '<rect style="background:url(http://x)" ')), false);
    assert.equal(safeSvg(ok.replace('fill="#FFFFFF"', 'fill="url(http://x)"')), false);
    assert.equal(safeSvg(ok.replace('<rect', '<image href="x"/><rect')), false);
    assert.equal(safeSvg(ok.replace('<rect', '<foreignObject></foreignObject><rect')), false);
    assert.equal(safeSvg(ok.replace('<rect', '<!-- x --><rect')), false);
    assert.equal(safeSvg(ok.replace('<rect', '<a href="javascript:1"></a><rect')), false);
  });
});

describe('Hindi and Marathi labels', () => {
  test('measured by grapheme cluster, so a Graphviz box fits its words', async () => {
    assert.equal(graphemes('नमस्ते').length, 3, 'न म स्ते: three clusters, six code points');
    const r = renderFigure(DEVANAGARI);
    assert.equal(r.ok, true);
    assert.ok(safeSvg(r.svg));
    assert.ok(r.svg.includes('प्रकाश संश्लेषण') || r.svg.includes('&#'), 'the label is in the drawing');
    // Graphviz's own sizing against ours, box by box: ours is narrower for every Devanagari label.
    const { Graphviz } = await import('@hpcc-js/wasm-graphviz');
    const gv = await Graphviz.load();
    const { spec } = normaliseSpec(DEVANAGARI);
    const widths = (measured) => {
      const json = JSON.parse(gv.layout(diagramDot(spec, { prefix: 'p', hl: new Set(), measured }), 'json', 'twopi'));
      return Object.fromEntries(json.objects.map((o) => [o.id, Number(o.width)]));
    };
    const ours = widths(true);
    const theirs = widths(false);
    for (const id of Object.keys(ours)) assert.ok(ours[id] < theirs[id], `${id}: ${ours[id]} should be under ${theirs[id]}`);
    // And not so narrow the words spill: at least the estimated text width.
    for (const n of spec.nodes) {
      const id = `p-${n.id}`;
      assert.ok(ours[id] * 72 >= Math.min(textWidth(n.label, 12), 140), `${n.label} fits its box`);
    }
  });
});

describe('a figure on a question', () => {
  const question = (stimulus) => ({
    _id: 'q1', text: 'What is the gradient of the line?', bloom: 'apply', kind: 'numeric', value: 2, tolerance: 0, unit: '', stimulus,
  });

  test('is validated with the question, and refuses anything but its spec', () => {
    assert.equal(invalidReason(question({ kind: 'figure', spec: SPECS.plot })), null);
    assert.match(invalidReason(question({ kind: 'figure', spec: SPECS.plot, svg: '<svg/>' })), /carries svg, which it cannot use/);
    assert.match(invalidReason(question({ kind: 'figure', spec: SPECS.plot, render: {} })), /carries render/);
    assert.match(invalidReason(question({ kind: 'figure', spec: { type: 'molecule', smiles: 'C1CC(' } })), /not a molecule/);
    assert.match(invalidReason(question({ kind: 'figure' })), /set of named values/);
  });

  test('reaches a phone as its drawing, description and table only', () => {
    const shown = forStudent(question({ kind: 'figure', spec: SPECS.diagram, sourceRef: 'Unit 2 slides' }), 'seed');
    assert.deepEqual(Object.keys(shown.stimulus).sort(), ['description', 'kind', 'svg', 'table', 'title', 'type']);
    assert.equal(shown.stimulus.kind, 'figure');
    assert.ok(shown.stimulus.svg.startsWith('<svg'));
    assert.ok(!JSON.stringify(shown).includes('"spec"'));
    assert.ok(!JSON.stringify(shown).includes('steps'));
    assert.ok(!JSON.stringify(shown).includes('Check the base case first'), 'no step caption');
    assert.equal(shown.value, undefined, 'and never the key');
  });

  test('an image\'s regions are checked, and stay with the professor', () => {
    const img = (regions) => question({ kind: 'image', url: '/api/media/0123456789abcdef01234567', alt: 'A leaf', regions });
    assert.equal(invalidReason(img([{ id: 'stoma', label: 'Stoma', points: [[10, 10], [20, 10], [15, 20]] }])), null);
    assert.match(invalidReason(img([{ id: 'a', label: 'x', points: [[10, 10], [120, 10], [15, 20]] }])), /percentages/);
    assert.match(invalidReason(img([{ id: 'a', label: 'x', points: [[10, 10], [20, 10]] }])), /between 3 and 24 corners/);
    assert.match(invalidReason(img([{ id: 'a', label: 'x', points: [[1, 1], [2, 2], [3, 1]] }, { id: 'A', label: 'y', points: [[1, 1], [2, 2], [3, 1]] }])), /both called/);
    const shown = forStudent(img([{ id: 'stoma', label: 'Stoma', points: [[10, 10], [20, 10], [15, 20]] }]), 's');
    assert.deepEqual(shown.stimulus, { kind: 'image', url: '/api/media/0123456789abcdef01234567', alt: 'A leaf' });
  });
});

describe('steps', () => {
  test('a stepped figure draws each step, lit up, with its caption', () => {
    const base = renderFigure(SPECS.diagram);
    assert.equal(base.stepCount, 2);
    const one = figureAtStep(SPECS.diagram, 1);
    assert.equal(one.step, 1);
    assert.equal(one.caption, 'Check the base case first.');
    assert.notEqual(one.svg, base.svg);
    assert.match(one.svg, /#B7862B/i, 'the lit part is in the highlight colour');
    // Same ids at every step, so a client can follow a part across them.
    assert.equal(one.svg.match(/data-part="[^"]+"/g).join(), base.svg.match(/data-part="[^"]+"/g).join());
    const stack = figureWithSteps(SPECS.stack);
    assert.equal(stack.steps.length, 3);
    assert.match(stack.steps[1].description, /fact\(2\)/);
    assert.ok(stack.steps.every((s) => safeSvg(s.svg)));
    // A step past the end is the figure itself.
    assert.equal(figureAtStep(SPECS.diagram, 9).step, 0);
  });

  test('the projector moves through them, and refuses what it cannot', () => {
    const q = { _id: 'qq', stimulus: { kind: 'figure', spec: SPECS.diagram } };
    const plain = { _id: 'pp', stimulus: { kind: 'passage', text: 'x' } };
    const screen = { mode: 'diagram', diagram: { questionId: 'qq' }, step: 0, question: null, revealed: false };
    assert.equal(screenChangeFrom({ step: 2 }, screen, { servable: [q, plain] }).step, 2);
    assert.throws(() => screenChangeFrom({ step: 3 }, screen, { servable: [q] }), /2 steps: choose one from 0/);
    assert.throws(() => screenChangeFrom({ step: 1 }, { ...screen, diagram: { questionId: 'pp' } }, { servable: [q, plain] }), /no steps to move through/);
    // A new diagram starts at its first picture.
    assert.equal(screenChangeFrom({ diagram: { questionId: 'qq' } }, { ...screen, step: 2 }, { servable: [q] }).step, 0);
    // What reaches the wall: the drawing at the step, never the spec.
    const wall = toProjector('projector:state', { diagram: { stimulus: { ...figureAtStep(SPECS.diagram, 1), spec: SPECS.diagram } } });
    assert.equal(wall.diagram.stimulus.step, 1);
    assert.equal(wall.diagram.stimulus.spec, undefined);
    assert.ok(wall.diagram.stimulus.table.columns.length > 0);
  });
});

describe('a lesson\'s figure step (gap H9c)', () => {
  test('staff see the spec and every step; a student every step and never the spec', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Recursion', kind: 'syllabus', rawText: 'x', topics: ['Recursion'] });
    const lesson = await repo.createTopicLesson({
      topicId: 'aaaaaaaaaaaaaaaaaaaaaaaa', contentId: content._id, version: 1, source: 'slides', model: null,
      steps: [{ type: 'chunk', slides: [1], text: 'A function that calls itself.' }, { type: 'chunk', slides: [], text: 'The call stack, frame by frame.', figure: SPECS.stack }],
    });
    const staff = await staffLessonView(repo, lesson);
    const fig = staff.steps.find((s) => s.type === 'figure');
    assert.deepEqual(fig.spec, SPECS.stack);
    assert.equal(fig.figure.steps.length, 3);
    const student = await studentLessonView(repo, { lesson, account: { id: 'stu', role: 'student' } });
    const shown = student.steps.find((s) => s.type === 'figure');
    assert.equal(shown.figure.steps.length, 3);
    assert.ok(!JSON.stringify(shown).includes('"spec"'));
  });
});

describe('pictures kept from a deck', () => {
  test('PNG, JPEG and WebP kept by their bytes, with their slide, metadata out; the rest skipped and counted', () => {
    const deck = deckWithPictures(
      [
        { n: 2, text: 'Leaf', media: ['leaf.png', 'chart.emf', 'logo.jpeg'] },
        { n: 5, text: 'Cell', media: ['logo.jpeg', 'big.png', 'icon.svg', 'cell.png'] },
        { n: 9, text: 'No pictures', media: [] },
      ],
      {
        // cell.png is a picture of its own: the leaf's PNG without its text chunk
        // is the same bytes, and the same picture under two names is kept once.
        'leaf.png': PNG_WITH_TEXT, 'chart.emf': EMF, 'logo.jpeg': JPEG, 'big.png': bigPng(600 * 1024), 'icon.svg': SVG_PICTURE, 'cell.png': bigPng(2000),
      },
    );
    const { pictures, summary } = slidePictures(deck, { maxBytes: 500 * 1024 });
    assert.deepEqual(pictures.map((p) => [p.slideNo, p.mime]), [[1, 'image/png'], [1, 'image/jpeg'], [2, 'image/png']]);
    assert.equal(summary.kept, 3);
    assert.equal(summary.skippedType, 2, 'the EMF and the SVG');
    assert.equal(summary.skippedLarge, 1);
    assert.deepEqual(summary.slides, [1, 2]);
    assert.ok(!pictures[0].data.includes(Buffer.from('Dr Secret Person')), 'the PNG\'s text chunk is taken out');
    assert.ok(PNG_WITH_TEXT.includes(Buffer.from('Dr Secret Person')));
    assert.match(slidePicturesNote(summary, 3), /3 pictures kept.*2 of a kind phones are not sent.*1 too large/);
    assert.match(slidePicturesNote(null, 0), /uploaded before slide pictures were kept/);
    assert.equal(slideAlt(4), 'Picture from slide 4 (not yet described)');
  });

  test('a file that is not a deck keeps nothing, and says so', () => {
    const { pictures, summary } = slidePictures(Buffer.from('not a zip'), { maxBytes: 1000 });
    assert.equal(pictures.length, 0);
    assert.equal(summary.unreadable, true);
  });

  test('the memory store keeps them by slide, and the chapter says what was kept', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Leaves', kind: 'pptx', rawText: 'x', topics: [] });
    assert.equal(await repo.getContentSlidePictures(content._id), null);
    await repo.createSlideMedia({ contentId: content._id, mime: 'image/png', bytes: PNG.length, sha256: 'a'.repeat(64), data: PNG, alt: slideAlt(3), slideNo: 3 });
    await repo.createSlideMedia({ contentId: content._id, mime: 'image/png', bytes: PNG.length, sha256: 'b'.repeat(64), data: PNG, alt: slideAlt(1), slideNo: 1 });
    await repo.createMedia({ contentId: content._id, mime: 'image/png', bytes: PNG.length, sha256: 'c'.repeat(64), data: PNG, alt: 'Own upload' });
    assert.deepEqual((await repo.listSlideMedia(content._id)).map((m) => m.slideNo), [1, 3]);
    await repo.setContentSlidePictures(content._id, { kept: 2, skippedType: 0, skippedLarge: 0, skippedOver: 0, slides: [1, 3] });
    assert.equal((await repo.getContentSlidePictures(content._id)).kept, 2);
  });
});

test('the cache key is the spec, so two equal specs share a drawing', () => {
  const a = normaliseSpec(SPECS.pie).spec;
  const b = normaliseSpec(JSON.parse(JSON.stringify(SPECS.pie))).spec;
  assert.equal(specHash(a), specHash(b));
  assert.equal(figureForStudent(SPECS.pie).svg, figureForStudent(JSON.parse(JSON.stringify(SPECS.pie))).svg);
});
