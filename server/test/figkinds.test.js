// Batch 8 - the five kinds asked on a figure (hotspot, label, plot, numberline,
// chart) and figures in generated questions.
//
// Per kind: what the validator refuses, the marking (partial credit, and the
// tolerance at its edges), and what a phone is sent - checked key by key and
// for every name the stored question uses, so a key that reached a phone under
// any name shows up here.
//
// Generation is checked with fixture responses fed through the real parsing
// code (validateItems): a figure whose key the server reads itself and the
// model got wrong, a figure that fails the check, and the offline templates.
// Nothing here calls a model or any network service.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

import {
  invalidReason, score, forStudent, toOriginalResponse, kindSuitsLevel, KINDS, FIGURE_ASKED_KINDS, PAYLOAD_FIELDS,
} from '../src/questionTypes.js';
import { loadFigureEngines } from '../src/figures/index.js';
import { safeSvg } from '../src/figures/common.js';
import { runChecks, keyBasis, failedChecks, isSelectedResponse } from '../src/services/checks.js';
import { validateItems, fallbackForTopic, generateForTopic } from '../src/services/generate.js';
import {
  FIGURE_KIND_RULES, draftChecks, figureTemplate, templateFigureNote,
} from '../src/services/figureDrafts.js';
import { config } from '../src/config.js';
import { answerItem, redactForStudent } from '../src/services/evidence.js';

config.gemini.apiKey = '';

before(async () => {
  await loadFigureEngines();
});

/* --------------------------------------------------------------- fixtures -- */

const PLOT = {
  type: 'plot', x: { min: 0, max: 10, step: 1 }, y: { min: 0, max: 20, step: 2 },
  functions: [{ id: 'growth', family: 'linear', params: { m: 2, c: 0 } }],
  points: [{ id: 'peak', x: 6, y: 12 }, { id: 'start', x: 0, y: 0 }, { id: 'dip', x: 3, y: 2 }],
};
const AXES = { type: 'plot', x: { min: -5, max: 5, step: 1 }, y: { min: -10, max: 10, step: 2 } };
const LINE = { type: 'numberline', min: -5, max: 5, step: 1 };
const LEAF = {
  kind: 'image', url: '/api/media/0123456789abcdef01234567', alt: 'A leaf with three parts marked.',
  regions: [
    { id: 'stoma', label: 'Stoma', points: [[10, 10], [30, 10], [20, 30]] },
    { id: 'vein', label: 'Vein', points: [[50, 50], [70, 50], [60, 80]] },
    { id: 'margin', label: 'Margin', points: [[80, 10], [95, 10], [90, 30]] },
  ],
};

const hotspot = (extra = {}) => ({
  _id: 'q-hot', kind: 'hotspot', bloom: 'analyse', topic: 'Rates',
  text: 'Tap the point that does not lie on the line.', stimulus: { kind: 'figure', spec: PLOT }, answerIds: ['dip'], ...extra,
});
const label = (extra = {}) => ({
  _id: 'q-label', kind: 'label', bloom: 'remember', topic: 'Rates', text: 'Label the marked points.',
  stimulus: { kind: 'figure', spec: PLOT },
  placements: [{ target: 'peak', label: 'Highest reading' }, { target: 'start', label: 'Origin' }],
  distractors: ['Asymptote'], ...extra,
});
const plotQ = (plotKey, extra = {}) => ({
  _id: 'q-plot', kind: 'plot', bloom: 'apply', topic: 'Lines', text: 'Plot it.', stimulus: { kind: 'figure', spec: AXES }, plotKey, ...extra,
});
const lineQ = (lineKey, extra = {}) => ({
  _id: 'q-line', kind: 'numberline', bloom: 'apply', topic: 'Inequalities', text: 'Mark it.', stimulus: { kind: 'figure', spec: LINE }, lineKey, ...extra,
});
const chartQ = (extra = {}) => ({
  _id: 'q-chart', kind: 'chart', bloom: 'apply', topic: 'Crops', text: 'Rice 45, wheat 30 and maize 10: set the bars.',
  bars: { categories: ['Rice', 'Wheat', 'Maize'], max: 50, step: 5, label: 'Per cent' }, values: [45, 30, 10], ...extra,
});

/** Every key at every depth. */
function keysOf(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.add(k); keysOf(v, out); }
  return out;
}

/** The stored question's answer fields: none may reach a phone under its own name. */
const STORED = ['answerIds', 'placements', 'distractors', 'plotKey', 'lineKey', 'bars', 'values', 'spec', 'regions', 'solution', 'tolerance'];

/** Assert a phone's copy carries none of the stored fields, and none of these words anywhere. */
function clean(shown, words = []) {
  const keys = keysOf(shown);
  for (const k of STORED) assert.ok(!keys.has(k), `"${k}" reached the phone`);
  const text = JSON.stringify(shown);
  for (const w of words) assert.ok(!text.toLowerCase().includes(w.toLowerCase()), `"${w}" reached the phone`);
}

/** The token a student was shown for a part, read back through the server's own solution. */
const tokenFor = (q, seed) => score(q, [], seed).solution;

/* ------------------------------------------------------------ the kinds -- */

describe('the five kinds belong to the levels they claim', () => {
  test('each is a kind, in its levels, and none is in the default mix', () => {
    for (const k of FIGURE_ASKED_KINDS) assert.ok(KINDS.includes(k), k);
    assert.ok(kindSuitsLevel('hotspot', 'remember') && kindSuitsLevel('hotspot', 'analyse'));
    assert.ok(kindSuitsLevel('label', 'understand'));
    for (const k of ['plot', 'numberline', 'chart']) assert.ok(kindSuitsLevel(k, 'apply'), k);
    assert.ok(kindSuitsLevel('plot', 'create'), 'a line drawn to conditions');
    assert.ok(!kindSuitsLevel('chart', 'create') && !kindSuitsLevel('hotspot', 'create'));
    // Placing points is produced, not picked: so plot may stand at Create.
    assert.equal(isSelectedResponse('plot'), false);
    assert.equal(isSelectedResponse('hotspot'), true);
  });

  test('every answer field is a payload field, so it is stored and copied with the question', () => {
    for (const f of ['answerIds', 'placements', 'distractors', 'plotKey', 'lineKey', 'bars', 'values']) assert.ok(PAYLOAD_FIELDS.includes(f), f);
  });

  test('the generator is told how to write each one', () => {
    for (const k of FIGURE_ASKED_KINDS) assert.ok(typeof FIGURE_KIND_RULES[k] === 'string' && FIGURE_KIND_RULES[k].length > 40, k);
  });
});

describe('hotspot: tap the right part(s)', () => {
  test('valid on a drawn figure and on a picture with regions', () => {
    assert.equal(invalidReason(hotspot()), null);
    assert.equal(invalidReason(hotspot({ stimulus: LEAF, answerIds: ['vein'], bloom: 'remember' })), null);
  });

  test('refused: no board, a part the figure lacks, every part right, a picture without regions', () => {
    assert.match(invalidReason(hotspot({ stimulus: undefined })), /needs a figure, or a picture/);
    assert.match(invalidReason(hotspot({ answerIds: ['nowhere'] })), /part the figure does not have/);
    assert.match(invalidReason(hotspot({ answerIds: ['growth', 'peak', 'start', 'dip'] })), /every part right/);
    assert.match(invalidReason(hotspot({ stimulus: { ...LEAF, regions: [] }, answerIds: ['vein'] })), /at least two marked regions/);
    assert.match(invalidReason(hotspot({ answerIds: ['dip', 'DIP'] })), /repeat/);
  });

  test('marked by the multi rule: the right tap scores 1, an extra one cancels it, a stray token is dropped', () => {
    const q = hotspot();
    const [right] = tokenFor(q, 'S1:q-hot');
    assert.deepEqual(score(q, [right], 'S1:q-hot'), { score: 1, correct: true, solution: [right], detail: '1/1 parts' });
    const shown = forStudent(q, 'S1:q-hot');
    const wrong = shown.zones.map((z) => z.zone).find((z) => z !== right);
    assert.equal(score(q, [right, wrong], 'S1:q-hot').score, 0);
    assert.equal(score(q, [right, 'z99', 'nonsense', 7], 'S1:q-hot').score, 1);
    assert.equal(score(q, 'garbage', 'S1:q-hot').score, 0);
    // Partial credit with two right parts.
    const two = hotspot({ answerIds: ['dip', 'peak'] });
    const both = tokenFor(two, 'S1:q-hot');
    assert.equal(score(two, [both[0]], 'S1:q-hot').score, 0.5);
  });

  test('a phone gets the figure drawn under tokens and the zones, never a name or the key', () => {
    const q = hotspot();
    const shown = forStudent(q, 'S1:q-hot');
    assert.deepEqual(Object.keys(shown).sort(), ['_id', 'bloom', 'kind', 'source', 'stimulus', 'text', 'topic', 'zones']);
    assert.ok(shown.zones.length === 4 && shown.zones.every((z) => /^z\d+$/.test(z.zone) && Object.keys(z).length === 1));
    assert.ok(safeSvg(shown.stimulus.svg));
    const parts = shown.stimulus.svg.match(/data-part="([^"]*)"/g).map((m) => m.slice(11, -1));
    assert.ok(parts.every((p) => /^z\d+$/.test(p)), parts.join());
    clean(shown, ['peak', 'dip', 'growth', '"start"']);
  });

  test('tokens are dealt per student, and read back to the parts for staff', () => {
    const q = hotspot();
    const a = forStudent(q, 'S1:q-hot').stimulus.svg;
    const b = forStudent(q, 'S2:q-hot').stimulus.svg;
    assert.notEqual(a, b, 'two students see the parts under different tokens');
    assert.equal(forStudent(q, 'S1:q-hot').stimulus.svg, a, 'and the same student always the same ones');
    const [right] = tokenFor(q, 'S2:q-hot');
    assert.deepEqual(toOriginalResponse(q, [right, right, 'z99'], 'S2:q-hot'), ['dip']);
  });

  test('on a picture, zones carry their outlines and nothing else', () => {
    const q = hotspot({ stimulus: LEAF, answerIds: ['vein'], bloom: 'remember' });
    const shown = forStudent(q, 'S1:q-hot');
    assert.deepEqual(shown.stimulus, { kind: 'image', url: LEAF.url, alt: LEAF.alt });
    assert.equal(shown.zones.length, 3);
    for (const z of shown.zones) assert.deepEqual(Object.keys(z).sort(), ['points', 'zone']);
    clean(shown, ['stoma', 'vein', 'margin']);
    const [right] = tokenFor(q, 'S1:q-hot');
    const outline = shown.zones.find((z) => z.zone === right).points;
    assert.deepEqual(outline, LEAF.regions[1].points, 'the right zone is the vein\'s outline');
    assert.equal(score(q, [right], 'S1:q-hot').score, 1);
  });

  test('a diagram\'s boxes can be tapped (Graphviz, once the engines are loaded)', () => {
    const spec = { type: 'diagram', layout: 'tree', nodes: [{ id: 'root', label: 'Root' }, { id: 'kid', label: 'Child' }, { id: 'leaf', label: 'Leaf' }], edges: [{ from: 'root', to: 'kid' }, { from: 'kid', to: 'leaf' }] };
    const q = hotspot({ bloom: 'remember', text: 'Tap the root of the tree.', stimulus: { kind: 'figure', spec }, answerIds: ['root'] });
    assert.equal(invalidReason(q), null);
    const shown = forStudent(q, 'S3:q-hot');
    assert.ok(safeSvg(shown.stimulus.svg));
    assert.ok(!/data-part="(root|kid|leaf)"/.test(shown.stimulus.svg));
    assert.equal(score(q, tokenFor(q, 'S3:q-hot'), 'S3:q-hot').score, 1);
  });
});

describe('label: drag labels onto the parts', () => {
  test('valid; refused when the drawing already names a target, or a target is missing', () => {
    assert.equal(invalidReason(label()), null);
    const named = { ...PLOT, points: PLOT.points.map((p) => (p.id === 'peak' ? { ...p, label: 'Highest reading' } : p)) };
    assert.match(invalidReason(label({ stimulus: { kind: 'figure', spec: named } })), /already labels a part/);
    assert.match(invalidReason(label({ placements: [{ target: 'peak', label: 'A' }, { target: 'ghost', label: 'B' }] })), /part the figure does not have/);
    assert.match(invalidReason(label({ distractors: ['Origin'] })), /same label twice/);
    assert.match(invalidReason(label({ placements: [{ target: 'peak', label: 'A' }, { target: 'PEAK', label: 'B' }] })), /two labels on one part/);
    const pie = { type: 'chart', chart: 'pie', slices: [{ id: 'a', label: 'A', value: 1 }, { id: 'b', label: 'B', value: 2 }] };
    assert.match(invalidReason(label({ stimulus: { kind: 'figure', spec: pie }, placements: [{ target: 'a', label: 'X' }, { target: 'b', label: 'Y' }] })), /other figures draw the names themselves/);
  });

  test('partial credit per label, as match; a label that belongs nowhere is never right', () => {
    const q = label();
    const seed = 'S1:q-label';
    const shown = forStudent(q, seed);
    const solution = score(q, {}, seed).solution;
    assert.equal(score(q, solution, seed).score, 1);
    const [first, second] = Object.keys(solution);
    assert.equal(score(q, { [first]: solution[first] }, seed).score, 0.5);
    const extra = shown.labels.indexOf('Asymptote');
    assert.equal(score(q, { [first]: extra, [second]: extra }, seed).score, 0);
    // Swapped labels: both wrong.
    assert.equal(score(q, { [first]: solution[second], [second]: solution[first] }, seed).score, 0);
    assert.equal(score(q, ['not', 'an', 'object'], seed).score, 0);
    assert.deepEqual(toOriginalResponse(q, { [first]: solution[first] }, seed).filter((x) => x !== null).length, 1);
  });

  test('a phone gets the zones for the targets only and the labels shuffled, never which goes where', () => {
    const shown = forStudent(label(), 'S1:q-label');
    assert.equal(shown.zones.length, 2);
    assert.deepEqual([...shown.labels].sort(), ['Asymptote', 'Highest reading', 'Origin']);
    clean(shown, ['peak', '"start"', 'growth']);
  });
});

describe('plot: points or a line on a graph', () => {
  test('a point within one grid step is right, one whole step away is wrong', () => {
    const q = plotQ({ place: 'points', points: [[2, 4]] });
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, [[2, 4]], 's').score, 1);
    assert.equal(score(q, [[2.99, 5.99]], 's').score, 1, 'just under a step on each axis (x step 1, y step 2)');
    assert.equal(score(q, [[3, 4]], 's').score, 0, 'one whole x step away');
    assert.equal(score(q, [[2, 6]], 's').score, 0, 'one whole y step away');
    assert.equal(score(q, [{ x: 2, y: 4 }], 's').score, 1, 'a point may come as {x, y}');
  });

  test('several points: the multi rule, so scattering points everywhere does not score', () => {
    const q = plotQ({ place: 'points', points: [[1, 2], [3, 6]] });
    assert.equal(score(q, [[1, 2], [3, 6]], 's').score, 1);
    assert.equal(score(q, [[1, 2]], 's').score, 0.5);
    assert.equal(score(q, [[1, 2], [3, 6], [-4, -8]], 's').score, 0.5);
    const everywhere = [];
    for (let x = -5; x <= 5; x += 1) for (let y = -10; y <= 10; y += 2) everywhere.push([x, y]);
    assert.equal(score(q, everywhere, 's').score, 0);
    assert.equal(score(q, [[1, 2], [1, 2]], 's').score, 0.5, 'one right point placed twice counts once');
  });

  test('points on a function: each counts once, a grid column apart', () => {
    const q = plotQ({ place: 'points', function: { family: 'quadratic', params: { a: 1, b: 0, c: -4 } }, count: 3 });
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, [[0, -4], [2, 0], [-2, 0]], 's').score, 1);
    assert.equal(score(q, [[0, -4], [0, -4], [0, -4]], 's').score, 1 / 3);
    assert.equal(score(q, [[0, -4], [2, 0], [1, 8]], 's').score, 1 / 3, 'two on the curve, one off it');
  });

  test('a line: each of its two points on the right line, measured square to the line', () => {
    const q = plotQ({ place: 'line', function: { family: 'linear', params: { m: 2, c: 1 } } });
    assert.equal(score(q, [[0, 1], [2, 5]], 's').score, 1);
    assert.equal(score(q, [[0, 1], [2, 8]], 's').score, 0.5);
    assert.equal(score(q, [[0, 1], [0, 1]], 's').score, 0, 'two points on top of each other are no line');
    assert.equal(score(q, [[0, 1]], 's').score, 0, 'a line needs two points');
    const steep = plotQ({ place: 'line', function: { family: 'linear', params: { m: 8, c: 0 } } }, { stimulus: { kind: 'figure', spec: { ...AXES, y: { min: -40, max: 40, step: 2 } } } });
    // 0.2 to the side of a steep line is a long way up and down, but close to the line itself.
    assert.equal(score(steep, [[0.2, 0], [1, 8]], 's').score, 1);
    const vertical = plotQ({ place: 'line', points: [[2, -4], [2, 4]] });
    assert.equal(invalidReason(vertical), null);
    assert.equal(score(vertical, [[2, 0], [2, 8]], 's').score, 1);
  });

  test('Create: a line drawn to conditions, checked by rule, with partial credit', () => {
    const q = plotQ({ place: 'line', conditions: [{ rule: 'slope', sign: 'negative' }, { rule: 'through', point: [1, 1] }] }, { bloom: 'create', text: 'Draw any line with a negative slope through (1, 1).' });
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, [[0, 2], [2, 0]], 's').score, 1);
    assert.equal(score(q, [[1, 1], [3, -5]], 's').score, 1, 'another right answer');
    assert.equal(score(q, [[0, 0], [2, 2]], 's').score, 0.5, 'through (1, 1), but rising');
    assert.equal(score(q, [[0, 6], [2, 4]], 's').score, 0.5, 'falling, but not through (1, 1)');
    // Within one grid step of (1, 1) counts as through it: the y axis here goes up in twos.
    assert.equal(score(q, [[0, 4], [2, 2]], 's').score, 1);
    assert.equal(score(q, [[1, -4], [1, 4]], 's').score, 0.5, 'an upright line has no slope to be negative');
    assert.deepEqual(score(q, [], 's').solution, { place: 'line', conditions: ['has a negative slope', 'passes through (1, 1)'] });
  });

  test('refused: one right answer at Create, conditions that fix one line at Create, conditions no line meets', () => {
    assert.match(invalidReason(plotQ({ place: 'points', points: [[1, 2]] }, { bloom: 'create' })), /drawn to conditions/);
    assert.match(invalidReason(plotQ({ place: 'line', conditions: [{ rule: 'through', point: [1, 1] }, { rule: 'through', point: [2, 3] }] }, { bloom: 'create' })), /more than one line/);
    assert.match(invalidReason(plotQ({ place: 'line', conditions: [{ rule: 'intercept', value: 2 }, { rule: 'slope', value: 3 }] }, { bloom: 'create' })), /more than one line/);
    assert.match(invalidReason(plotQ({ place: 'line', conditions: [{ rule: 'through', point: [0, 2] }, { rule: 'intercept', value: 3 }, { rule: 'slope', value: 1 }] })), /no line meets/);
    assert.equal(invalidReason(plotQ({ place: 'line', conditions: [{ rule: 'through', point: [0, 2] }, { rule: 'slope', value: -1 }, { rule: 'slope', sign: 'negative' }] })), null);
    assert.match(invalidReason(plotQ({ place: 'line', conditions: [{ rule: 'slope', sign: 'negative', value: -1 }] })), /a sign or a value, not both/);
  });

  test('refused: a key off the graph, a point the figure already shows, the curve already drawn, no graph', () => {
    assert.match(invalidReason(plotQ({ place: 'points', points: [[9, 9]] })), /off the graph/);
    const shows = { ...AXES, points: [{ id: 'A', x: 1, y: 2 }] };
    assert.match(invalidReason(plotQ({ place: 'points', points: [[1, 2]] }, { stimulus: { kind: 'figure', spec: shows } })), /already shows a point/);
    const draws = { ...AXES, functions: [{ family: 'linear', params: { m: 2, c: 1 } }] };
    assert.match(invalidReason(plotQ({ place: 'line', function: { family: 'linear', params: { m: 2, c: 1 } } }, { stimulus: { kind: 'figure', spec: draws } })), /already draws the function/);
    assert.match(invalidReason(plotQ({ place: 'line', function: { family: 'quadratic', params: { a: 1 } } })), /linear function/);
    assert.match(invalidReason(plotQ({ place: 'points', points: [[1, 2]], function: { family: 'linear' } })), /exactly one of/);
    assert.match(invalidReason(plotQ({ place: 'points', points: [[1, 2]] }, { stimulus: undefined })), /plot figure as its stimulus/);
    assert.match(invalidReason(plotQ({ place: 'points', points: [[1, 2], [1.5, 2.5]] })), /closer than a grid step/);
  });

  test('a phone gets the grid and what to place, never the key', () => {
    const q = plotQ({ place: 'line', function: { family: 'linear', params: { m: 2, c: 1 } } });
    const shown = forStudent(q, 's');
    assert.deepEqual(shown.grid.x, { min: -5, max: 5, step: 1 });
    assert.deepEqual(shown.grid.y, { min: -10, max: 10, step: 2 });
    assert.ok(shown.grid.frame.right > shown.grid.frame.left && shown.grid.frame.bottom > shown.grid.frame.top);
    assert.equal(shown.place, 'line');
    assert.equal(shown.maxPoints, 2);
    clean(shown, ['2x + 1', 'linear']);
    assert.ok(safeSvg(shown.stimulus.svg), 'the empty axes are drawn');
  });
});

describe('numberline: points, intervals and rays', () => {
  test('a point within one tick is right, one whole tick away is wrong; a stated tolerance is inclusive', () => {
    const q = lineQ({ points: [2] });
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, { points: [2.99] }, 's').score, 1);
    assert.equal(score(q, { points: [3] }, 's').score, 0);
    const tight = lineQ({ points: [2] }, { tolerance: 0.25 });
    assert.equal(score(tight, { points: [2.25] }, 's').score, 1, 'exactly the tolerance away');
    assert.equal(score(tight, { points: [2.26] }, 's').score, 0);
    assert.match(invalidReason(lineQ({ points: [2] }, { tolerance: -1 })), /zero or more/);
  });

  test('an interval is two ends, each half: in the right place and open or closed as it should be', () => {
    const q = lineQ({ intervals: [{ from: -2, to: 3, fromOpen: true }] });
    assert.equal(score(q, { intervals: [{ from: -2, to: 3, fromOpen: true }] }, 's').score, 1);
    assert.equal(score(q, { intervals: [{ from: -2, to: 3 }] }, 's').score, 0.5, 'the left end should be open');
    assert.equal(score(q, { intervals: [{ from: -4, to: 3, fromOpen: true }] }, 's').score, 0.5);
  });

  test('a ray the wrong way earns nothing; marks beyond the key cost a mark each', () => {
    const q = lineQ({ rays: [{ from: 1, direction: 'right', open: true }] });
    assert.equal(score(q, { rays: [{ from: 1, direction: 'right', open: true }] }, 's').score, 1);
    assert.equal(score(q, { rays: [{ from: 1, direction: 'right' }] }, 's').score, 0.5);
    assert.equal(score(q, { rays: [{ from: 1, direction: 'left', open: true }] }, 's').score, 0);
    assert.equal(score(q, { rays: [{ from: 1, direction: 'right', open: true }, { from: -3, direction: 'left' }] }, 's').score, 0);
    assert.equal(score(q, null, 's').score, 0);
  });

  test('refused: points beside intervals, a mark off the line, a mark the figure already shows', () => {
    assert.match(invalidReason(lineQ({ points: [1], intervals: [{ from: 0, to: 2 }] })), /not both/);
    assert.match(invalidReason(lineQ({ points: [9] })), /off the line/);
    const shows = { ...LINE, intervals: [{ from: -2, to: 3 }] };
    assert.match(invalidReason(lineQ({ intervals: [{ from: -2, to: 3 }] }, { stimulus: { kind: 'figure', spec: shows } })), /already shows an interval/);
  });

  test('a phone gets the line and its ticks, not which marks are wanted', () => {
    const shown = forStudent(lineQ({ intervals: [{ from: -2, to: 3, fromOpen: true }] }), 's');
    assert.deepEqual({ min: shown.grid.min, max: shown.grid.max, step: shown.grid.step }, { min: -5, max: 5, step: 1 });
    assert.ok(shown.grid.frame.right > shown.grid.frame.left);
    clean(shown);
    assert.ok(!keysOf(shown).has('intervals') && !keysOf(shown).has('rays'));
  });
});

describe('chart: set the bars', () => {
  test('marked per bar: under one step of the value axis by default, a stated tolerance inclusive', () => {
    const q = chartQ();
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, [45, 30, 10], 's').score, 1);
    assert.equal(score(q, [45, 34.9, 10], 's').score, 1, 'just under a step (5)');
    assert.equal(score(q, [45, 35, 10], 's').score, 2 / 3, 'a whole step out');
    assert.equal(score(q, ['45', '30', 'ten'], 's').score, 2 / 3, 'typed numbers are read as numbers, words are not');
    assert.equal(score(q, ['45', '3,0', 10], 's').score, 1, 'a comma is read as a digit group, as numeric reads one');
    const exact = chartQ({ tolerance: 0 });
    assert.equal(score(exact, [45, 30.5, 10], 's').score, 2 / 3);
    assert.equal(score(exact, [45, 30, 10], 's').score, 1);
    assert.equal(score(q, { not: 'a list' }, 's').score, 0);
  });

  test('refused: values off the axis, a value missing, a figure that already draws the bars', () => {
    assert.match(invalidReason(chartQ({ values: [45, 60, 10] })), /on the value axis/);
    assert.match(invalidReason(chartQ({ values: [45, 30] })), /one value for each category/);
    const same = { type: 'chart', chart: 'bar', categories: ['Rice', 'Wheat', 'Maize'], series: [{ values: [45, 30, 10] }] };
    assert.match(invalidReason(chartQ({ stimulus: { kind: 'figure', spec: same } })), /already draws the bars/);
    assert.match(invalidReason(chartQ({ bars: { categories: ['A', 'A'], max: 10, step: 1 }, values: [1, 2] })), /same name/);
  });

  test('a phone gets the empty chart, named so the stored fields have no namesake', () => {
    const shown = forStudent(chartQ(), 's');
    assert.deepEqual(shown.board, { categories: ['Rice', 'Wheat', 'Maize'], min: 0, max: 50, step: 5, label: 'Per cent', xLabel: '' });
    clean(shown);
  });
});

describe('a tap or label answer, as the professor reads it', () => {
  const row = (q, response, rollNo = 'S9') => ({
    _id: `a-${q.kind}`, rollNo, questionId: q._id, kind: q.kind, bloom: q.bloom, topic: q.topic, response,
    questionSnapshot: { id: q._id, ...q }, final: true, correct: true, score: 1,
  });

  test('the tokens a phone sent become the names of the parts, for staff only', () => {
    const q = hotspot();
    const r = row(q, tokenFor(q, `S9:${q._id}`));
    assert.deepEqual(answerItem(r, null).parts, { tapped: ['dip'] });
    assert.equal(redactForStudent(r, null).parts, undefined);
  });

  test('a label answer: each part with the label put on it, or none', () => {
    const q = label();
    const sol = score(q, {}, `S9:${q._id}`).solution;
    const [first] = Object.keys(sol);
    const placed = answerItem(row(q, { [first]: sol[first] }), null).parts.placed;
    assert.equal(placed.length, 2);
    assert.equal(placed.filter((p) => p.label !== null).length, 1);
    assert.ok(placed.every((p) => p.label === null || q.placements.some((x) => x.target === p.part && x.label === p.label)));
  });
});

describe('the fingerprint a finding is kept by', () => {
  test('is the same however a store hands the question back', () => {
    const q = { kind: 'numeric', value: 6, tolerance: 0, unit: '', stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: 0, max: 1 } } } };
    // Supabase: options [] and keys reordered; Mongo: declared lists as [].
    const back = { options: [], answerIdx: null, accept: [], unit: '', tolerance: 0, value: 6, stimulus: { spec: { x: { max: 1, min: 0 }, type: 'plot' }, kind: 'figure' } };
    assert.equal(keyBasis(back), keyBasis(q));
    assert.notEqual(keyBasis({ ...q, value: 7 }), keyBasis(q));
  });
});

describe('every phone payload of every new kind', () => {
  test('carries no stored answer field at any depth, for many students', () => {
    const qs = [
      hotspot(), hotspot({ stimulus: LEAF, answerIds: ['vein'], bloom: 'remember' }), label(),
      plotQ({ place: 'points', points: [[1, 2]] }), plotQ({ place: 'line', conditions: [{ rule: 'slope', sign: 'positive' }] }, { bloom: 'create' }),
      lineQ({ rays: [{ from: 1, direction: 'left' }] }), chartQ(),
    ];
    for (const q of qs) {
      assert.equal(invalidReason(q), null, q.kind);
      for (let s = 0; s < 12; s += 1) clean(forStudent(q, `ROLL${s}:${q._id}`));
    }
  });
});

/* ------------------------------------------------------------ generation -- */

const TOPIC = 'Growth';
const PLAN_NUMERIC = { apply: 'numeric' };

describe('figures in generated questions, through the real parsing code', () => {
  test('the server reads the key off the graph, and flags the model\'s disagreeing answer', () => {
    const fixture = [{
      bloom: 'apply', kind: 'numeric', text: 'Read the height at x = 3 off the graph.', value: 7, unit: '',
      figure: { type: 'plot', x: { min: 0, max: 10, step: 1, label: 'x' }, y: { min: 0, max: 20, step: 2 }, functions: [{ id: 'f', family: 'linear', params: { m: 2, c: 0 } }], points: [], categories: [] },
      reading: { what: 'y-at', function: 0, x: 3 },
    }];
    const { valid, errors } = validateItems(fixture, TOPIC, PLAN_NUMERIC);
    assert.deepEqual(errors, []);
    const [q] = valid;
    assert.equal(q.value, 6, 'the key is what the drawing gives');
    assert.equal(q.stimulus.kind, 'figure');
    assert.equal(q.figureFlags.length, 1);
    assert.equal(q.figureFlags[0].id, 'figure-key');
    assert.match(q.figureFlags[0].message, /The model gave 7, but the figure gives 6 at x = 3, so the key is now 6/);
    assert.equal(invalidReason(q), null);
  });

  test('the flag is stored as a check, kept while the key is unchanged, dropped once it is edited', () => {
    const fixture = [{
      bloom: 'apply', kind: 'numeric', text: 'Read the height at x = 3 off the graph.', value: 7,
      figure: { type: 'plot', x: { min: 0, max: 10 }, y: { min: 0, max: 20 }, functions: [{ family: 'linear', params: { m: 2, c: 0 } }] },
      reading: { what: 'y-at', x: 3 },
    }];
    const [item] = validateItems(fixture, TOPIC, PLAN_NUMERIC).valid;
    const row = { contentId: 'c', topic: TOPIC, text: item.text, kind: item.kind, bloom: item.bloom, value: item.value, tolerance: item.tolerance, unit: item.unit, stimulus: item.stimulus };
    const checks = draftChecks(row, item);
    const flag = checks.find((c) => c.id === 'figure-key');
    assert.ok(flag && flag.ok === false && flag.basis === keyBasis(row));
    assert.ok(failedChecks(checks).some((c) => c.id === 'figure-key'));
    // Read back from a store that reorders keys: the same question, the same finding.
    const reordered = JSON.parse(JSON.stringify({ ...row, stimulus: { spec: row.stimulus.spec, kind: 'figure' }, checks }));
    assert.ok(runChecks(reordered).some((c) => c.id === 'figure-key'));
    // The professor sets the key: the finding no longer describes the question.
    assert.ok(!runChecks({ ...row, value: 6.5, checks }).some((c) => c.id === 'figure-key'));
  });

  test('a choose-one key is moved to the option the drawing gives, and said', () => {
    const fixture = [{
      bloom: 'remember', kind: 'mcq', text: 'Which crop has the largest share?', options: ['Rice', 'Wheat', 'Maize', 'Pulses'], answerIdx: 1,
      figure: { type: 'chart', chart: 'bar', categories: ['Rice', 'Wheat', 'Maize', 'Pulses'], series: [{ name: 'Share', values: [45, 30, 10, 15] }] },
      reading: { what: 'largest' },
    }];
    const [q] = validateItems(fixture, TOPIC, { remember: 'mcq' }).valid;
    assert.equal(q.answerIdx, 0);
    assert.match(q.figureFlags[0].message, /marked "Wheat" as right, but the figure gives Rice \(45\), so the key is now "Rice"/);
  });

  test('an answer the drawing agrees with carries no flag', () => {
    const fixture = [{
      bloom: 'apply', kind: 'numeric', text: 'How many in July?', value: 300,
      figure: { type: 'chart', chart: 'bar', categories: ['June', 'July'], series: [{ values: [120, 300] }] },
      reading: { what: 'bar', category: 'july' },
    }];
    const [q] = validateItems(fixture, TOPIC, PLAN_NUMERIC).valid;
    assert.equal(q.value, 300);
    assert.equal(q.figureFlags, undefined);
  });

  test('a figure that fails the check is left out and the draft says so; a kind that needs one is refused', () => {
    const broken = { type: 'plot', x: { min: 5, max: 1 }, y: { min: 0, max: 1 }, points: [{ x: 1, y: 1 }] };
    const [q] = validateItems([{ bloom: 'remember', kind: 'mcq', text: 'Which is right?', options: ['a', 'b', 'c', 'd'], answerIdx: 2, figure: broken }], TOPIC, { remember: 'mcq' }).valid;
    assert.equal(q.stimulus, undefined, 'no figure on the draft');
    assert.equal(q.answerIdx, 2);
    assert.equal(q.figureFlags[0].id, 'figure-dropped');
    assert.match(q.figureFlags[0].message, /left out because it did not pass the figure check: On the x axis the highest value must be above the lowest\./);

    const notDrawable = [{ bloom: 'remember', kind: 'mcq', text: 'Which?', options: ['a', 'b', 'c', 'd'], answerIdx: 0, figure: { type: 'molecule', smiles: 'CCO' } }];
    assert.equal(validateItems(notDrawable, TOPIC, { remember: 'mcq' }).valid[0].figureFlags[0].id, 'figure-dropped');

    const { valid, errors } = validateItems([{ bloom: 'apply', kind: 'plot', text: 'Plot (1, 2).', plotKey: { place: 'points', points: [{ x: 1, y: 2 }] }, figure: broken }], TOPIC, { apply: 'plot' });
    assert.equal(valid.length, 0);
    assert.match(errors[0], /item 1 \(plot\) rejected: its figure did not pass the figure check \(On the x axis the highest value must be above the lowest\)/);
    const none = validateItems([{ bloom: 'apply', kind: 'numberline', text: 'Mark 2.', lineKey: { points: [2] } }], TOPIC, { apply: 'numberline' });
    assert.match(none.errors[0], /it needs a figure to be asked on/);
  });

  test('each of the five kinds parses from the model\'s schema shape', () => {
    const items = [
      {
        bloom: 'analyse', kind: 'hotspot', text: 'Tap the reading that breaks the pattern.', answerIds: ['odd'],
        figure: { type: 'plot', x: { min: 0, max: 6 }, y: { min: 0, max: 12 }, points: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: 2, y: 4 }, { id: 'odd', x: 3, y: 9 }], functions: [], categories: [], series: [] },
      },
      {
        bloom: 'understand', kind: 'label', text: 'Label the two temperatures.', placements: [{ target: 'f', label: 'Freezing' }, { target: 'b', label: 'Boiling' }], distractors: [],
        figure: { type: 'numberline', min: -20, max: 120, step: 10, points: [{ id: 'f', value: 0 }, { id: 'b', value: 100 }] },
      },
      {
        bloom: 'apply', kind: 'plot', text: 'Plot two points on y = x + 1.', plotKey: { place: 'line', function: { family: 'linear', params: { m: 1, c: 1 } } },
        figure: { type: 'plot', x: { min: -5, max: 5, step: 1 }, y: { min: -5, max: 5, step: 1 } },
      },
      {
        bloom: 'apply', kind: 'numberline', text: 'Mark every x with x >= 2.', lineKey: { rays: [{ from: 2, direction: 'right', open: false }], points: [], intervals: [] },
        figure: { type: 'numberline', min: -5, max: 5, step: 1 },
      },
      { bloom: 'apply', kind: 'chart', text: 'Rice 45%, wheat 30% and maize 10%: set the bars.', bars: { categories: ['Rice', 'Wheat', 'Maize'], min: 0, max: 50, step: 5, label: 'Per cent' }, values: [45, 30, 10] },
    ];
    const plan = { remember: 'mcq', understand: 'label', apply: { plot: 1, numberline: 1, chart: 1 }, analyse: 'hotspot' };
    const { valid, errors } = validateItems(items, TOPIC, plan);
    assert.deepEqual(errors, []);
    assert.deepEqual(valid.map((q) => q.kind), ['hotspot', 'label', 'plot', 'numberline', 'chart']);
    for (const q of valid) assert.equal(invalidReason(q), null, q.kind);
    assert.ok(valid.every((q) => q.figureFlags === undefined));
    assert.equal(valid[1].distractors, undefined, 'an empty list from the schema is no claim');
  });

  test('a plot key given as a function and points: the function is the key, stray points are said', () => {
    const [q] = validateItems([{
      bloom: 'apply', kind: 'plot', text: 'Place three points on y = 2x.',
      plotKey: { place: 'points', function: { family: 'linear', params: { m: 2, c: 0 } }, points: [{ x: 1, y: 2 }, { x: 2, y: 5 }, { x: 3, y: 6 }] },
      figure: { type: 'plot', x: { min: 0, max: 5, step: 1 }, y: { min: 0, max: 10, step: 1 } },
    }], TOPIC, { apply: 'plot' }).valid;
    assert.deepEqual(q.plotKey, { place: 'points', function: { family: 'linear', params: { m: 2, c: 0 } }, count: 3 });
    assert.match(q.figureFlags[0].message, /points \(2, 5\) are not on y = 2x, so the key is the function itself/);
  });

  test('a chart whose bars disagree with the numbers its own words give is flagged, not changed', () => {
    const [q] = validateItems([{
      bloom: 'apply', kind: 'chart', text: 'Rice had 45, wheat 30 and maize 10 hectares: set the bars.',
      bars: { categories: ['Rice', 'Wheat', 'Maize'], max: 50, step: 5 }, values: [45, 35, 10],
    }], TOPIC, { apply: 'chart' }).valid;
    assert.deepEqual(q.values, [45, 35, 10]);
    assert.match(q.figureFlags[0].message, /The question gives Wheat as 30, but its bar is set to 35\. Check the bars against the question\./);
  });

  test('a figure carrying the model\'s own picture or an unknown key is refused by the figure check', () => {
    const [q] = validateItems([{
      bloom: 'remember', kind: 'mcq', text: 'Which?', options: ['a', 'b', 'c', 'd'], answerIdx: 0,
      figure: { type: 'diagram', nodes: [{ id: 'x', label: 'X' }] },
    }], TOPIC, { remember: 'mcq' }).valid;
    assert.equal(q.stimulus, undefined);
    assert.match(q.figureFlags[0].message, /A generated figure must be a graph, a chart or a number line\./);
  });
});

describe('offline templates: numbers the material states, or none, and which', () => {
  const MATERIAL = [
    'Motion in a straight line can be modelled simply.',
    'The distance travelled is given by y = 2x + 3 for the first five seconds.',
    'The safe range for the reading is between 10 and 40 units.',
    'Crop shares were rice 45%, wheat 30% and maize 10% last year.',
    'A body at rest stays at rest unless a force acts on it.',
  ].join(' ');

  test('each template builds a valid question from a line of the material', () => {
    const sentences = MATERIAL.split(/(?<=\.)\s+/);
    const plot = figureTemplate('plot', { sentences, topic: 'Motion' });
    assert.deepEqual(plot.plotKey, { place: 'line', function: { family: 'linear', params: { m: 2, c: 3 } } });
    assert.equal(invalidReason({ bloom: 'apply', kind: 'plot', ...plot }), null);
    const nl = figureTemplate('numberline', { sentences, topic: 'Motion' });
    assert.deepEqual(nl.lineKey, { intervals: [{ from: 10, to: 40, fromOpen: false, toOpen: false }] });
    assert.equal(invalidReason({ bloom: 'apply', kind: 'numberline', ...nl }), null);
    const chart = figureTemplate('chart', { sentences, topic: 'Motion' });
    assert.deepEqual(chart.bars.categories, ['Rice', 'Wheat', 'Maize']);
    assert.deepEqual(chart.values, [45, 30, 10]);
    assert.equal(invalidReason({ bloom: 'apply', kind: 'chart', ...chart }), null);
    assert.match(chart.text, /rice 45%, wheat 30% and maize 10%/);
  });

  test('a power or a letter after x is not a straight line, and is not plotted', () => {
    assert.equal(figureTemplate('plot', { sentences: ['The area is y = 3x^2 for a square.'], topic: 'T' }), null);
    assert.equal(figureTemplate('plot', { sentences: ['Here y = 2x + 3z holds.'], topic: 'T' }), null);
    assert.equal(figureTemplate('plot', { sentences: ['A line y = -x - 4 crosses below.'], topic: 'T' }).plotKey.function.params.m, -1);
  });

  test('the bank asks for the three kinds and says which the material could carry', async () => {
    const kinds = { apply: { plot: 1, numberline: 1, chart: 1 } };
    const made = fallbackForTopic({ topic: 'Motion', contextText: MATERIAL, mix: { apply: 3 }, kinds });
    assert.deepEqual(made.map((q) => q.kind).sort(), ['chart', 'numberline', 'plot']);
    assert.ok(made.every((q) => q.source === 'fallback' && invalidReason(q) === null));

    const bare = 'Plants make food from light. Leaves are green because of chlorophyll. Roots take up water from the soil. Stems carry water upwards.';
    const run = await generateForTopic({ topic: 'Plants', contextText: bare, mix: { apply: 3 }, kinds });
    assert.ok(run.questions.every((q) => !['plot', 'numberline', 'chart'].includes(q.kind)));
    assert.ok(run.warnings.some((w) => /could not make a graph or number-line or bar-chart question, because the material states no equation of a line or range between two numbers or list of three or more figures/.test(w)), run.warnings.join(' | '));

    const rich = await generateForTopic({ topic: 'Motion', contextText: MATERIAL, mix: { apply: 3 }, kinds });
    assert.ok(rich.warnings.some((w) => /made 1 graph and 1 number-line and 1 bar-chart questions from numbers the material states/.test(w)), rich.warnings.join(' | '));
  });

  test('the note names only the figure kinds asked for, and nothing when none were', () => {
    assert.equal(templateFigureNote('T', ['mcq', 'open'], []), null);
    assert.equal(templateFigureNote('T', ['chart'], [{ kind: 'chart' }]), '"T": the offline templates made 1 bar-chart question from numbers the material states.');
  });
});
