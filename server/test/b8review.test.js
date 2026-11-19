// Batch 8: the fixes from the review, one describe per finding, each written so
// it fails on the code the review read (c496726) and passes now.
//
// End to end (practice and lessons keeping an answer without a serve token,
// a regenerated rooms-only question) in scripts/zipgaps2.mjs. Never calls
// Gemini, Supabase or any network service: model output is a fixture through
// the real parser.

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { config } from '../src/config.js';

// A fixed server secret for this process, before anything signs or deals, so
// the deal tested below is the same on every run. And no network service.
config.serverSecret = 'b8review-test-secret';
config.gemini.apiKey = '';
config.supabase.url = '';
config.supabase.serviceKey = '';
config.mongoUri = '';

const { invalidReason, forStudent, score, readyToMark } = await import('../src/questionTypes.js');
const figures = await import('../src/figures/index.js');
const { textWidth } = await import('../src/figures/common.js');
const { gradeNumberline, lineKeyReason, gradeChart } = await import('../src/figures/interact.js');
const { normaliseSpec } = await import('../src/figures/spec.js');
const { checkServeToken } = await import('../src/services/serveTokens.js');
const { countable } = await import('../src/services/hubHeld.js');
const { feedbackFor, onceServable, practisable } = await import('../src/services/hubPractice.js');
const { splitQuestion, mergeQuestions } = await import('../src/services/edits.js');
const { classQuestionView } = await import('../src/services/classQuestions.js');
const { parseMove } = await import('../src/services/teachingMoves.js');
const { slidePictures, slidePicturesNote } = await import('../src/services/slideImages.js');
const { plotKeyFromModel } = await import('../src/services/figureDrafts.js');
const { createMemoryRepo } = await import('../src/repo/memoryRepo.js');
const { projectorPayload, screenChangeFrom, screenOf, setScreen } = await import('../src/services/projector.js');
const { deckWithPictures, PNG, JPEG } = await import('./fixtures/figures.js');
const AdmZip = (await import('adm-zip')).default;

/* ------------------------------------------- 17: the engines before a mark -- */

// First in the file, before anything loads the engines: a tap on a diagram
// answered while Graphviz is still loading.
describe('a tap on a diagram is never marked before the drawing engines are up (17)', () => {
  test('the answer path waits for them, and then the tap is marked right', async () => {
    const q = {
      _id: 'q-diagram', kind: 'hotspot', bloom: 'remember', text: 'Tap the start.',
      stimulus: { kind: 'figure', spec: { type: 'diagram', nodes: [{ id: 'start', label: 'Start' }, { id: 'end', label: 'End' }], edges: [{ from: 'start', to: 'end' }] } },
      answerIds: ['start'],
    };
    assert.equal(figures.enginesReady(), false, 'nothing in this process has loaded them yet');
    assert.equal(await readyToMark(q), true);
    assert.equal(figures.enginesReady(), true);
    const seed = 'roll1:q-diagram';
    const zone = forStudent(q, seed).zones.find((z) => score(q, [z.zone], seed).score === 1);
    assert.ok(zone, 'one zone is the start box, marked right once the engines are up');
    assert.equal(await readyToMark({ ...q, kind: 'mcq' }), true, 'other kinds never wait');
  });
});

/* ---------------------------------------------------- 1: the bounded grid -- */

describe('a geometry grid in real-world units is a bounded picture (1)', () => {
  before(() => figures.loadFigureEngines());
  test('a frame thousands of units across draws at most 60 grid lines a side, quickly', () => {
    const spec = { type: 'geometry', grid: true, view: { xMin: -5000, xMax: 5000, yMin: -5000, yMax: 5000 }, points: [{ id: 'A', x: 0, y: 0 }] };
    const started = Date.now();
    const r = figures.renderFigure(spec);
    assert.equal(r.ok, true);
    const grid = /<g stroke="#E3E5E0">([\s\S]*?)<\/g>/.exec(r.svg)[1];
    assert.ok((grid.match(/<line /g) ?? []).length <= 2 * 61, 'not one line per unit');
    assert.ok(r.svg.length < figures.MAX_SVG_BYTES);
    assert.ok(Date.now() - started < 1000);
  });
  test('a small frame keeps one line per unit', () => {
    const r = figures.renderFigure({ type: 'geometry', grid: true, view: { xMin: 0, xMax: 4, yMin: 0, yMax: 3 }, points: [{ id: 'A', x: 1, y: 1 }] });
    const grid = /<g stroke="#E3E5E0">([\s\S]*?)<\/g>/.exec(r.svg)[1];
    assert.equal((grid.match(/<line /g) ?? []).length, 5 + 4);
  });
});

/* -------------------------------------- 2: no worked-out answer on a phone -- */

describe('what a phone is sent describes what is drawn, never what was worked out (2)', () => {
  before(() => figures.loadFigureEngines());
  const shown = (q) => {
    const s = forStudent(q, 'roll7:q').stimulus;
    return `${s.description} ${JSON.stringify(s.table)} ${/<desc[^>]*>([^<]*)<\/desc>/.exec(s.svg ?? '')?.[1] ?? ''}`;
  };
  test('a labelled line\'s equation', () => {
    const q = {
      _id: 'q', kind: 'mcq', bloom: 'apply', text: 'What is the equation of line L?', options: ['y = 3x - 2', 'y = 2x - 3', 'y = -3x + 2', 'y = 3x + 2'], answerIdx: 0,
      stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5 }, y: { min: -10, max: 10 }, functions: [{ id: 'L', family: 'linear', params: { m: 3, c: -2 }, label: 'L' }] } },
    };
    assert.equal(invalidReason(q), null);
    assert.doesNotMatch(shown(q), /3x/);
    assert.match(shown(q), /straight line labelled L/);
    assert.ok(figures.figureForStaff(q.stimulus.spec).worked.some((w) => /L is y = 3x − 2/.test(w)), 'the professor still sees it');
  });
  test('an angle\'s size and a segment\'s length', () => {
    const spec = {
      type: 'geometry', view: { xMin: -1, xMax: 5, yMin: -1, yMax: 4 },
      points: [{ id: 'A', x: 0, y: 0, label: 'A' }, { id: 'B', x: 4, y: 0, label: 'B' }, { id: 'C', x: 4, y: 3, label: 'C' }],
      segments: [{ id: 'AC', from: 'A', to: 'C' }], angles: [{ id: 'x', at: 'A', from: 'B', to: 'C', label: 'x' }],
    };
    const text = shown({ _id: 'q', kind: 'numeric', bloom: 'apply', text: 'Find angle x and AC.', value: 36.87, tolerance: 0.1, stimulus: { kind: 'figure', spec } });
    assert.doesNotMatch(text, /36\.9|length 5|degrees/);
    assert.match(text, /a segment from A to C/);
    const worked = figures.figureForStaff(spec).worked.join(' ');
    assert.match(worked, /36\.9 degrees/);
    assert.match(worked, /is 5 long/);
  });
  test('where a lens forms its image, and what the image is like', () => {
    const spec = { type: 'geometry', optics: { element: 'convex-lens', focal: 10, objectDistance: 15, objectHeight: 2 } };
    const text = shown({ _id: 'q', kind: 'numeric', bloom: 'apply', text: 'Find the image distance.', value: 30, tolerance: 0.5, stimulus: { kind: 'figure', spec } });
    assert.doesNotMatch(text, /\b30\b|real|inverted|larger|Image distance|Image height/);
    assert.match(figures.figureForStaff(spec).worked.join(' '), /real, inverted and larger, 30 away/);
  });
  test('a molecule\'s formula', () => {
    const text = shown({ _id: 'q', kind: 'blank', bloom: 'apply', text: 'The molecular formula is ____.', accept: ['C2H6O'], stimulus: { kind: 'figure', spec: { type: 'molecule', smiles: 'CCO' } } });
    assert.doesNotMatch(text, /C2H6O|formula/);
    assert.match(text, /SMILES CCO/);
  });
  test('a number line\'s inequality', () => {
    const text = shown({
      _id: 'q', kind: 'blank', bloom: 'apply', text: 'The inequality shown is ____.', accept: ['-2 <= x < 3'],
      stimulus: { kind: 'figure', spec: { type: 'numberline', min: -5, max: 5, intervals: [{ from: -2, to: 3, toOpen: true }] } },
    });
    assert.doesNotMatch(text, /≤ x|x </);
    assert.match(text, /from −2 to 3, closed at −2 and open at 3/);
  });
  test('the highest bar', () => {
    const q = {
      _id: 'q', kind: 'hotspot', bloom: 'understand', text: 'Tap the census year in which the population peaked.',
      stimulus: { kind: 'figure', spec: { type: 'chart', chart: 'bar', categories: ['1991', '2001', '2011', '2021'], series: [{ values: [84, 102, 121, 118] }] } },
      answerIds: ['bar-1-3'],
    };
    assert.equal(invalidReason(q), null);
    assert.doesNotMatch(shown(q), /highest|peak/);
  });
});

/* -------------------------------- 3: label targets that the picture names -- */

describe('a label question cannot ask for words the picture already shows (3)', () => {
  before(() => figures.loadFigureEngines());
  test('an unlabelled curve has its equation written beside it', () => {
    const q = {
      _id: 'q1', kind: 'label', bloom: 'remember', text: 'Label each graph with its equation.',
      stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: -5, max: 5 }, y: { min: -5, max: 25 }, functions: [
        { id: 'curveA', family: 'quadratic', params: { a: 1, b: 0, c: 0 } }, { id: 'curveB', family: 'linear', params: { m: 2, c: 1 } }] } },
      placements: [{ target: 'curveA', label: 'y = x²' }, { target: 'curveB', label: 'y = 2x + 1' }],
    };
    assert.match(invalidReason(q), /already labels a part/);
  });
  test('a ray diagram always writes "Object" and "Image" and names its lens', () => {
    const q = {
      _id: 'q2', kind: 'label', bloom: 'remember', text: 'Label the object, the image and the lens.',
      stimulus: { kind: 'figure', spec: { type: 'geometry', optics: { element: 'convex-lens', focal: 10, objectDistance: 25, objectHeight: 4 } } },
      placements: [{ target: 'object', label: 'Object' }, { target: 'image', label: 'Image' }, { target: 'element', label: 'Convex lens' }],
    };
    assert.match(invalidReason(q), /already labels a part/);
  });
  test('unlabelled points are still a label question', () => {
    const q = {
      _id: 'q3', kind: 'label', bloom: 'remember', text: 'Label the parts of the cell.',
      stimulus: { kind: 'figure', spec: { type: 'geometry', view: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 }, points: [{ id: 'nucleus', x: 5, y: 5 }, { id: 'membrane', x: 9, y: 5 }] } },
      placements: [{ target: 'nucleus', label: 'Nucleus' }, { target: 'membrane', label: 'Cell membrane' }],
    };
    assert.equal(invalidReason(q), null);
  });
});

/* --------------------------------------------- 4: the wall and part names -- */

describe('the wall never carries a label question\'s part names before the reveal (4)', () => {
  before(() => figures.loadFigureEngines());
  test('description, table and drawing are the tokenised copy until revealed', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: '', topics: ['Cells'] });
    const [q] = await repo.insertQuestions([{
      contentId: content._id, topic: 'Cells', bloom: 'remember', kind: 'label', text: 'Label the parts of the cell.',
      stimulus: { kind: 'figure', spec: { type: 'geometry', view: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
        points: [{ id: 'nucleus', x: 5, y: 5 }, { id: 'membrane', x: 9, y: 5 }, { id: 'vacuole', x: 3, y: 7 }] } },
      placements: [{ target: 'nucleus', label: 'Nucleus' }, { target: 'membrane', label: 'Cell membrane' }, { target: 'vacuole', label: 'Vacuole' }],
    }]);
    const session = await repo.createSession({ code: 'WAL036', contentId: content._id, title: 'Cells', status: 'open', mode: 'teacher-led', classId: 'class-1' });
    const servable = await repo.listQuestions(session.contentId);
    setScreen(session, screenChangeFrom({ question: { questionId: String(q._id) } }, screenOf(session), { servable, mode: 'teacher-led' }));
    const wall = await projectorPayload(repo, session);
    assert.ok(wall.question.stimulus.svg, 'the figure is shown');
    assert.doesNotMatch(JSON.stringify(wall.question.stimulus), /nucleus|membrane|vacuole/i);
    setScreen(session, screenChangeFrom({ revealed: true }, screenOf(session), { servable, mode: 'teacher-led' }));
    const after = await projectorPayload(repo, session);
    assert.match(after.question.stimulus.description, /nucleus/, 'once revealed, the figure as drawn');
  });
});

/* ------------------------------------------ 5 and 15: no published secret -- */

describe('a serve token cannot be minted from anything in the source (5, 15)', () => {
  test('the old fixed default signs nothing that checks', () => {
    const who = { accountId: 'a1', questionId: 'q1', mode: 'practice' };
    const at = Math.floor(Date.now() / 1000) + 3600;
    const forged = `${at}.${crypto.createHmac('sha256', 'bloomloop-dev-serve-token-secret').update(`a1|q1|practice|${at}`).digest('base64url')}`;
    assert.equal(checkServeToken(forged, who).ok, false);
    assert.equal(config.hub, undefined, 'no fixed default is left in the configuration');
  });
});

/* ------------------------------- 6 and 13: an answer without a token is kept -- */

describe('an answer without proof it was served is kept, counted nowhere and told nothing (6, 13)', () => {
  test('countable() leaves it out; feedbackFor() gives no mark, key or explanation', async () => {
    const proven = { _id: '1', mode: 'practice', correct: true };
    const unproven = { _id: '2', mode: 'practice', correct: true, unproven: true, clientAttemptId: 'attempt-002', response: 0 };
    assert.deepEqual(countable([proven, unproven]).map((a) => a._id), ['1']);
    const reply = await feedbackFor(null, { id: 'a1' }, unproven, { duplicate: true });
    assert.deepEqual([reply.counted, reply.unproven, reply.correct, reply.score, reply.solution, reply.explanation],
      [false, true, null, null, null, null]);
    assert.match(reply.note, /saved/);
  });
});

/* ---------------------------------- 7: rooms only does not discard answers -- */

describe('keeping a question for rooms only keeps the answers already given to it (7)', () => {
  test('practice no longer serves it, but an answer to it may be stored', () => {
    const q = { _id: 'q1', status: 'active', kind: 'mcq', roomsOnly: true };
    assert.equal(practisable(q), false);
    assert.equal(onceServable(q), true);
  });
});

/* --------------------------------------- 8: a stored drawing never passes -- */

describe('a class question\'s stored figure is drawn again, never passed on (8)', () => {
  before(() => figures.loadFigureEngines());
  const evil = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><image href="https://example.invalid/x.png"/></svg>';
  const cq = (stimulus) => classQuestionView({
    _id: 'cq1', seq: 1, state: 'closed', startedAt: new Date().toISOString(),
    questionSnapshot: { text: 'Which?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', stimulus },
  });
  test('markup from an archive is dropped', () => {
    assert.equal(cq({ kind: 'figure', svg: evil }).question.stimulus.svg, null);
  });
  test('a spec beside it wins, drawn by the server', () => {
    const s = cq({ kind: 'figure', svg: evil, spec: { type: 'numberline', min: 0, max: 5 } }).question.stimulus;
    assert.notEqual(s.svg, evil);
    assert.match(s.svg, /^<svg [^>]*role="img"/);
  });
});

/* ------------------------------------- 9: a deal the phone cannot recompute -- */

describe('a phone cannot deal itself a label question\'s cards (9)', () => {
  before(() => figures.loadFigureEngines());
  // The published shuffle, as a phone could copy it.
  function permFor(n, seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
    const out = Array.from({ length: n }, (_, i) => i);
    for (let i = out.length - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  test('the key built from the seed and the payload alone is not the key', () => {
    const q = {
      _id: 'q-cell-1', kind: 'label', bloom: 'remember', text: 'Label the parts of the cell.',
      stimulus: { kind: 'figure', spec: { type: 'geometry', view: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
        points: [{ id: 'p1', x: 5, y: 5 }, { id: 'p2', x: 9, y: 5 }, { id: 'p3', x: 3, y: 7 }] } },
      placements: [{ target: 'p1', label: 'Nucleus' }, { target: 'p2', label: 'Cell membrane' }, { target: 'p3', label: 'Vacuole' }],
      distractors: ['Cell wall', 'Chloroplast'],
    };
    const seed = '23CS041:q-cell-1';
    const phone = forStudent(q, seed);
    const lperm = permFor(phone.labels.length, `${seed}:lb`);
    const tokens = [...new Set([...phone.stimulus.svg.matchAll(/data-part="z(\d+)"/g)].map((m) => Number(m[1])))];
    const zperm = permFor(Math.max(...tokens) + 1, `${seed}:z`);
    const guess = {};
    for (const z of phone.zones) guess[z.zone] = lperm.findIndex((orig) => orig === zperm[Number(z.zone.slice(1))]);
    assert.ok(score(q, guess, seed).score < 1, 'the deal is not the published shuffle of a known seed');
    // The server still works its own deal out at marking time.
    const right = score(q, {}, seed).solution;
    assert.equal(score(q, right, seed).score, 1);
  });
});

/* ------------------------------------------- 10: labelling in a suggestion -- */

describe('a suggestion that ranks or labels students is refused (10)', () => {
  const move = (text) => () => parseMove(JSON.stringify({ activity: 'think', title: 'Pair up', text, slides: [3] }), { slides: [3], topic: 'Ohm' });
  for (const text of [
    'Pair each slower student with a stronger one and let the stronger partner explain the formula.',
    'Ask the low scorers to sit at the front benches and redo question 2 while the rest move on.',
    'The bottom ten students should write the definition three times; the top students mark them.',
    'Students who failed the last quiz stand and read slide 3 aloud to the class.',
  ]) test(text, () => assert.throws(move(text), /labelled or judged/));
  test('subject words are left alone', () => {
    assert.doesNotThrow(move('Benches compare a weak acid with a strong base, and pick the best one of three answers.'));
  });
});

/* ------------------------- 11 and 18: one drawing for a room, not one each -- */

describe('a tap or label figure is drawn once for every student (11, 18)', () => {
  before(() => figures.loadFigureEngines());
  test('sixty phones add no more than the figure and its stand-in drawing to the cache', () => {
    const nodes = Array.from({ length: 25 }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` }));
    const q = {
      _id: 'q-net', kind: 'hotspot', bloom: 'analyse', text: 'Tap the bottleneck.',
      stimulus: { kind: 'figure', spec: { type: 'diagram', layout: 'network', nodes, edges: nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id })) } },
      answerIds: ['n7'],
    };
    figures.clearFigureCache();
    const views = Array.from({ length: 60 }, (_, s) => forStudent(q, `ROLL${s}:q-net`));
    assert.ok(figures.figureCacheSize() <= 3, `cache holds ${figures.figureCacheSize()}`);
    assert.notEqual(views[0].stimulus.svg, views[1].stimulus.svg, 'each student still has their own tokens');
    assert.equal(views[0].stimulus.svg.replace(/z\d+/g, 'Z'), views[1].stimulus.svg.replace(/z\d+/g, 'Z'), 'over one layout');
    for (const v of views.slice(0, 5)) assert.doesNotMatch(v.stimulus.svg, /zq\d|data-part="n\d/);
    // Each still marks right on its own tokens.
    const seed = 'ROLL3:q-net';
    assert.equal(score(q, score(q, [], seed).solution, seed).score, 1);
  });
});

/* -------------------------------------- 12: a key that leaves a number out -- */

describe('a plot key that leaves a number at its default is marked as checked (12)', () => {
  const graph = { kind: 'figure', spec: { type: 'plot', x: { min: 0, max: 5, step: 1 }, y: { min: 0, max: 10, step: 1 } } };
  test('points on y = 2x, written without c', () => {
    const q = { _id: 'qp', kind: 'plot', bloom: 'apply', text: 'Plot three points on y = 2x.', stimulus: graph, plotKey: { place: 'points', function: { family: 'linear', params: { m: 2 } }, count: 3 } };
    assert.equal(invalidReason(q), null);
    const r = score(q, [[0, 0], [1, 2], [2, 4]], 's');
    assert.equal(r.score, 1);
    assert.equal(r.solution.equation, 'y = 2x');
  });
  test('a line y = x, written with no numbers at all', () => {
    const q = { _id: 'ql', kind: 'plot', bloom: 'apply', text: 'Draw y = x.', stimulus: graph, plotKey: { place: 'line', function: { family: 'linear' } } };
    assert.equal(invalidReason(q), null);
    assert.equal(score(q, [[0, 0], [1, 1]], 's').score, 1);
  });
  test('a generated key is stored with the defaults filled in', () => {
    assert.deepEqual(plotKeyFromModel({ place: 'points', function: { family: 'linear', params: { m: 2 } }, count: 3 }).function, { family: 'linear', params: { m: 2, c: 0 } });
  });
});

/* ---------------------------------------------- 14: rooms only survives edits -- */

describe('split and merge keep the owner\'s rooms-only switch (14)', () => {
  const base = { contentId: 'c', topic: 'T', bloom: 'remember', status: 'active', source: 'teacher', approvedBy: 'p', approvedAt: '2026-11-19T00:00:00Z' };
  const multi = (text, roomsOnly) => ({ ...base, _id: text, kind: 'multi', text, options: ['a', 'b', 'c', 'd', 'e', 'f'], answerIdxs: [0, 1, 2], roomsOnly });
  test('both halves of a rooms-only question stay rooms only', () => {
    const { parts, reason } = splitQuestion({
      ...base, _id: 'm', kind: 'match', text: 'Match them.', roomsOnly: true,
      pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }, { left: 'd', right: '4' }, { left: 'e', right: '5' }, { left: 'f', right: '6' }],
    });
    assert.equal(reason, undefined);
    assert.ok(parts.length === 2 && parts.every((p) => p.roomsOnly === true));
  });
  test('a merge with a rooms-only question is rooms only', () => {
    const merged = mergeQuestions(multi('one', false), multi('two', true));
    assert.equal(merged.question?.roomsOnly ?? merged.roomsOnly, true, JSON.stringify(merged).slice(0, 200));
  });
});

/* ----------------------------------------------- 16: a slope over a short run -- */

describe('a stated slope is judged over a run of at least a grid step (16)', () => {
  const q = {
    _id: 'qs', kind: 'plot', bloom: 'create', text: 'Draw a line with a slope of 2.',
    stimulus: { kind: 'figure', spec: { type: 'plot', x: { min: 0, max: 5, step: 1 }, y: { min: 0, max: 10, step: 1 } } },
    plotKey: { place: 'line', conditions: [{ rule: 'slope', value: 2 }] },
  };
  test('steep lines over a tiny run no longer "have a slope of 2"', () => {
    assert.equal(invalidReason(q), null);
    for (const pts of [[[0, 0], [0.01, 1]], [[0, 0], [0.2, 1]], [[0, 0], [0.4, 1.2]]]) assert.equal(score(q, pts, 's').score, 0, JSON.stringify(pts));
  });
  test('a line of slope 2 still does', () => {
    assert.equal(score(q, [[0, 0], [1, 2]], 's').score, 1);
    assert.equal(score(q, [[1, 1], [3, 5]], 's').score, 1);
  });
});

/* ---------------------------------------------- 19: clustered timeline labels -- */

describe('a cluster of events makes a taller timeline, never overlapping labels (19)', () => {
  const boxes = (svg) => [...svg.matchAll(/<g id="[^"]*" data-part="[^"]*">([\s\S]*?)<\/g>/g)].map((g) => {
    const texts = [...g[1].matchAll(/<text x="([^"]+)" y="([^"]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] }));
    const w = Math.max(...texts.map((t) => textWidth(t.t.replace(/&amp;/g, '&'), 11)));
    return { x0: texts[0].x - w / 2, x1: texts[0].x + w / 2, y0: Math.min(...texts.map((t) => t.y)) - 6, y1: Math.max(...texts.map((t) => t.y)) + 6 };
  });
  const overlaps = (list) => list.flatMap((a, i) => list.slice(i + 1).filter((b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1)).length;
  test('1857 and then twenty-one events from 1905 to 1945', () => {
    const events = [{ date: 1857, label: 'The first war of independence' },
      ...Array.from({ length: 21 }, (_, i) => ({ date: 1905 + 2 * i, label: `Event of ${1905 + 2 * i} in the struggle` }))];
    const r = figures.renderFigure({ type: 'timeline', events });
    assert.equal(r.ok, true);
    assert.equal(overlaps(boxes(r.svg)), 0);
  });
  test('1900 and then twelve days of August 1947', () => {
    const events = [{ date: 1900, label: 'A new century' },
      ...Array.from({ length: 12 }, (_, i) => ({ date: `1947-08-${String(i + 3).padStart(2, '0')}`, label: `Day ${i + 3} of August` }))];
    assert.equal(overlaps(boxes(figures.renderFigure({ type: 'timeline', events }).svg)), 0);
  });
});

/* ---------------------------------------------- 20: number line, as a plot -- */

describe('a number line is marked like a plot (20)', () => {
  const spec = normaliseSpec({ type: 'numberline', min: 0, max: 10 }).spec;
  test('one place marked twice is one mark', () => {
    assert.equal(gradeNumberline({ points: [2] }, spec, { points: [2, 2] }).score, 1);
  });
  test('key points closer than a tick (or the tolerance) are refused', () => {
    assert.match(lineKeyReason({ points: [2, 2.5] }, spec), /closer than a tick/);
    assert.match(lineKeyReason({ points: [2, 2] }, spec), /closer than a tick/);
    assert.match(lineKeyReason({ points: [2, 4] }, spec, 3), /closer than the tolerance/);
    assert.equal(lineKeyReason({ points: [2, 4] }, spec), null);
  });
});

/* ------------------------------------------------------ 21: an empty bar -- */

describe('a bar left empty is no answer, even where the key is 0 (21)', () => {
  test('blank and spaces are not 0', () => {
    const bars = { categories: ['A', 'B', 'C'], max: 10, step: 1 };
    assert.equal(gradeChart(bars, [0, 5, 0], ['', 5, ' ']).detail, '1/3 bars');
    assert.equal(gradeChart(bars, [0, 5, 0], ['0', 5, 0]).detail, '3/3 bars');
  });
});

/* -------------------------------------------- 22: every deck's pictures -- */

describe('slide pictures from decks written other ways are kept (22)', () => {
  const REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
  const deck = (rels, media) => {
    const zip = new AdmZip();
    zip.addFile('ppt/slides/slide1.xml', Buffer.from('<p:sld/>'));
    zip.addFile('ppt/slides/_rels/slide1.xml.rels', Buffer.from(`<Relationships>${rels}</Relationships>`));
    for (const [name, bytes] of Object.entries(media)) zip.addFile(`ppt/media/${name}`, bytes);
    return zip.toBuffer();
  };
  test('an absolute target, and attributes in single quotes', () => {
    const abs = slidePictures(deck(`<Relationship Id="rId2" Type="${REL_IMAGE}" Target="/ppt/media/image1.png"/>`, { 'image1.png': PNG }), { maxBytes: 1e6 });
    assert.equal(abs.summary.kept, 1);
    const single = slidePictures(deck(`<Relationship Id='rId2' Type='${REL_IMAGE}' Target='../media/image1.png'/>`, { 'image1.png': PNG }), { maxBytes: 1e6 });
    assert.equal(single.summary.kept, 1);
  });
  test('the same bytes under two names are one picture; a picture the deck does not hold is counted', () => {
    const rels = [1, 2, 3].map((i) => `<Relationship Id="rId${i + 1}" Type="${REL_IMAGE}" Target="../media/image${i}.png"/>`).join('');
    const { summary } = slidePictures(deck(rels, { 'image1.png': PNG, 'image2.png': PNG }), { maxBytes: 1e6 });
    assert.deepEqual([summary.kept, summary.skippedMissing], [1, 1]);
    assert.match(slidePicturesNote(summary, 1), /1 that a slide names but the file does not hold/);
  });
  test('an ordinary deck is read as before', () => {
    const { summary } = slidePictures(deckWithPictures([{ n: 1, text: 'x', media: ['a.png', 'b.jpeg'] }], { 'a.png': PNG, 'b.jpeg': JPEG }), { maxBytes: 1e6 });
    assert.deepEqual([summary.kept, summary.skippedMissing], [2, 0]);
  });
});

/* -------------------------------------- 23: automatic names step past given -- */

describe('an automatic part name steps past a name the professor gave (23)', () => {
  test('a box called e1 and an unnamed arrow', () => {
    const r = normaliseSpec({ type: 'diagram', nodes: [{ id: 'e1', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'e1', to: 'b' }] });
    assert.equal(r.reason, undefined, r.reason);
    assert.equal(r.spec.edges[0].id, 'e2');
  });
  test('a first box called n2 and an unnamed second box', () => {
    const r = normaliseSpec({ type: 'diagram', nodes: [{ id: 'n2', label: 'A' }, { label: 'B' }] });
    assert.equal(r.reason, undefined, r.reason);
    assert.deepEqual(r.spec.nodes.map((n) => n.id), ['n2', 'n3']);
  });
  test('an unnamed box before one given its automatic name', () => {
    const r = normaliseSpec({ type: 'diagram', nodes: [{ label: 'A' }, { id: 'n1', label: 'B' }] });
    assert.equal(r.reason, undefined, r.reason);
    assert.deepEqual(r.spec.nodes.map((n) => n.id), ['n2', 'n1']);
  });
  test('a plot function f2 and an unnamed one', () => {
    const r = normaliseSpec({ type: 'plot', x: { min: 0, max: 1 }, y: { min: 0, max: 1 }, functions: [{ id: 'f2', family: 'linear' }, { family: 'linear', params: { m: 2 } }] });
    assert.equal(r.reason, undefined, r.reason);
  });
  test('a name the professor wrote twice is still refused', () => {
    assert.match(normaliseSpec({ type: 'diagram', nodes: [{ id: 'a', label: 'A' }, { id: 'A', label: 'B' }] }).reason, /both called/);
  });
});
