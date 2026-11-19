// Phase 4: configurable attainment, computed from stored evidence, and the
// marks register. Every expected figure below was worked out by hand from the
// fixture next to it; the comments show the sums.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { DEFAULT_PRESET, PRESETS, presetById } from '../src/services/attainmentPresets.js';
import { formulaLabel } from '../src/services/exports.js';
import {
  CONFIG_FIELDS,
  EVIDENCE_TYPES,
  QUESTION_SOURCES,
  chooseAnswers,
  classAttainment,
  classLevelOf,
  configFrom,
  evidenceTypeOf,
  formulaOf,
  marksRegister,
  matchingPreset,
  methodologyText,
  questionSourceOf,
  recordsSummary,
  registerMethodologyText,
  rollResolver,
  roomsWindow,
  scoreOf,
  stateOf,
  studentAttainment,
  validateConfig,
} from '../src/services/attainment.js';

const status = (code, fn, match) => assert.throws(fn, (err) => err.status === code && (!match || match.test(err.message)));
const clone = (v) => JSON.parse(JSON.stringify(v));
const EXAMPLE = clone(presetById(DEFAULT_PRESET).config);
const formula = (changes = {}) => ({
  source: 'saved', version: 7, savedAt: '2026-11-19T10:00:00.000Z', savedBy: null, preset: null,
  config: validateConfig({ ...clone(EXAMPLE), ...changes }),
});

/* ------------------------------------------------------------ fixtures -- */

const R1 = { _id: 'aaaaaaaaaaaaaaaaaaaaaa01', code: 'ROOMA1', title: 'Week 1', status: 'closed', startedAt: '2026-11-02T04:00:00.000Z', contentId: 'cccccccccccccccccccccc01', classId: 'k1' };
const R2 = { _id: 'aaaaaaaaaaaaaaaaaaaaaa02', code: 'ROOMB2', title: 'Week 2', status: 'open', startedAt: '2026-11-09T04:00:00.000Z', contentId: 'cccccccccccccccccccccc01', classId: 'k1' };
const C1 = 'cccccccccccccccccccccc01';
const q = (id, topic, bloom, kind = 'mcq') => ({ _id: id, contentId: C1, topic, bloom, kind, status: 'active' });
const Q = {
  L1: q('q-l1', 'Layers', 'understand'), L2: q('q-l2', 'Layers', 'understand'), L3: q('q-l3', 'Layers', 'understand'),
  L4: q('q-l4', 'Layers', 'understand'), L5: q('q-l5', 'Layers', 'understand'), L6: q('q-l6', 'Layers', 'understand'),
  RT1: q('q-rt1', 'Routing', 'apply'), RT2: q('q-rt2', 'Routing', 'apply'),
  SW1: q('q-sw1', 'Switching', 'remember'), EX1: q('q-ex1', 'Layers', 'understand'),
  P1: q('q-p1', 'Layers', 'understand', 'poll'),
  OP1: q('q-op1', 'Layers', 'create', 'open'), OP2: q('q-op2', 'Layers', 'create', 'open'),
};
const OUTCOMES = [
  { _id: 'co1', classId: 'k1', code: 'CO1', statement: 'Explain the layered model.', position: 1, archivedAt: null },
  { _id: 'co2', classId: 'k1', code: 'CO2', statement: 'Analyse routing.', position: 2, archivedAt: null },
];
const LINKS = [
  { outcomeId: 'co1', classId: 'k1', contentId: C1, topic: 'Layers', weight: 1 },
  { outcomeId: 'co2', classId: 'k1', contentId: C1, topic: 'Routing', weight: 2 },
  { outcomeId: 'co2', classId: 'k1', contentId: C1, topic: 'Layers', weight: 1 },
];
const OVERRIDES = [{ classId: 'k1', questionId: 'q-ex1', outcomeIds: [], excluded: true }];
const ROSTER = [
  { _id: 's01', classId: 'k1', rollNo: '21CS01', name: 'Asha Rao', removedAt: null },
  { _id: 's10', classId: 'k1', rollNo: '21CS10', name: 'Chitra Iyer', removedAt: null },
  { _id: 's02', classId: 'k1', rollNo: '21CS02', name: 'Bilal Khan', removedAt: null },
  { _id: 's03', classId: 'k1', rollNo: '21CS03', name: 'Dev Patel', removedAt: '2026-11-05T00:00:00.000Z' },
];

let n = 0;
/** An answer row in the shape the live loop writes (sockets/index.js). */
function ans(roll, question, score, extra = {}) {
  n += 1;
  const ungraded = question.kind === 'poll';
  return {
    _id: `ans${String(n).padStart(4, '0')}`,
    sessionId: R1._id,
    rollNo: roll,
    questionId: question._id,
    contentId: C1,
    topic: question.topic,
    bloom: question.bloom,
    kind: question.kind,
    questionSnapshot: { id: question._id, topic: question.topic, text: `${question._id}?` },
    response: 1,
    attempt: 1,
    final: true,
    correct: ungraded ? null : score >= 0.7,
    score: ungraded ? null : score,
    ungraded,
    reviewStatus: question.kind === 'open' ? 'provisional' : 'auto',
    answeredAt: new Date(Date.UTC(2026, 10, 2, 5, 0, 0) + n * 1000).toISOString(),
    ...extra,
  };
}

// The class's evidence. Per student, in words:
//   21CS01  Layers 1,1,1,0,0 (3 of 5); Routing 1; Switching 1 (unmapped);
//           EX1 1 (excluded by an override); a poll
//   21CS02  Layers 1,0; a provisional written answer (1) on Layers; Routing 0,0;
//           and a retried Layers attempt (not final)
//   21CS10  Layers 1,0,0; a written answer a professor overrode to 1, on Layers
//   21CS03  (removed) Layers 1,1,1
//   GUEST   (not on the roster) Layers 1,1,1
const ANSWERS = [
  ans('21CS01', Q.L1, 1), ans('21CS01', Q.L2, 1), ans('21CS01', Q.L3, 1), ans('21CS01', Q.L4, 0), ans('21CS01', Q.L5, 0),
  ans('21CS01', Q.RT1, 1), ans('21CS01', Q.SW1, 1), ans('21CS01', Q.EX1, 1), ans('21CS01', Q.P1, null),
  ans('21CS02', Q.L1, 1), ans('21CS02', Q.L2, 0), ans('21CS02', Q.OP1, 1), ans('21CS02', Q.RT1, 0), ans('21CS02', Q.RT2, 0),
  ans('21CS10', Q.L1, 1), ans('21CS10', Q.L2, 0), ans('21CS10', Q.L3, 0), ans('21CS10', Q.OP2, 1, { reviewStatus: 'overridden' }),
  ans('21CS03', Q.L1, 1), ans('21CS03', Q.L2, 1), ans('21CS03', Q.L3, 1),
  ans('GUEST', Q.L1, 1), ans('GUEST', Q.L2, 1), ans('GUEST', Q.L3, 1),
  ans('21CS02', Q.L3, 0, { final: false }),
];
const CHAPTERS = new Map([[C1, { title: 'Networks: Unit 2', keys: new Set(['layers', 'routing', 'switching']) }]]);
const CLS = { _id: 'k1', courseName: 'Computer Networks', section: 'TY-CS A', termLabel: 'Sem V' };
const base = (extra = {}) => ({
  cls: CLS, rooms: [R1], window: {}, answers: ANSWERS, roster: ROSTER, outcomes: OUTCOMES, links: LINKS,
  overrides: OVERRIDES, questions: Object.values(Q), chapters: CHAPTERS, ...extra,
});
const report = (f = formula(), extra = {}) => classAttainment({ ...base(extra), formula: f });
const studentOf = (r, roll) => r.students.find((s) => s.rollNo === roll);
const outcomeOf = (row, code) => row.outcomes.find((o) => o.code === code);

/* ------------------------------------------------------- evidence types -- */

describe('evidence types, as Phase 1 writes them', () => {
  test('auto is digital; provisional is the keyword marker\'s; confirmed and overridden are a professor\'s; a poll is ungraded', () => {
    assert.equal(evidenceTypeOf({ reviewStatus: 'auto' }), 'digital');
    assert.equal(evidenceTypeOf({}), 'digital', 'a row from before review_status took the column default, auto');
    assert.equal(evidenceTypeOf({ reviewStatus: 'provisional' }), 'aiProvisional');
    assert.equal(evidenceTypeOf({ reviewStatus: 'confirmed' }), 'humanReviewed');
    assert.equal(evidenceTypeOf({ reviewStatus: 'overridden' }), 'humanReviewed');
    assert.equal(evidenceTypeOf({ ungraded: true, reviewStatus: 'auto' }), 'ungraded');
  });

  test('the keyword marker\'s provisional mark is called a machine mark, never AI; the stored key keeps its name', () => {
    const t = EVIDENCE_TYPES.find((x) => x.id === 'aiProvisional');
    assert.equal(t.label, 'Provisional machine marks');
    assert.match(t.description, /keyword marker, which matches the rubric's words in the answer: a provisional machine mark, not AI/);
    assert.doesNotMatch(`${t.label} ${t.description}`, /model marker|marked by AI|AI mark/i);
    assert.match(CONFIG_FIELDS.evidence, /aiProvisional is the keyword marker's provisional machine mark, not AI; the key keeps its stored name/);
    const all = formula({ evidence: { digital: true, aiProvisional: true, humanReviewed: true } });
    assert.match(methodologyText(all), /written answers given only a provisional machine mark \(a keyword match against the rubric, not AI\)/);
    assert.doesNotMatch(methodologyText(all), /or model\) marker/);
    assert.deepEqual(Object.keys(all.config.evidence), ['digital', 'aiProvisional', 'humanReviewed'], 'the stored keys are unchanged');
  });

  test('who wrote the question: llm is AI-generated, teacher professor-written, fallback the offline template\'s', () => {
    assert.equal(questionSourceOf({ questionSource: 'llm' }), 'aiGenerated');
    assert.equal(questionSourceOf({}), 'aiGenerated', 'the column\'s default is llm');
    assert.equal(questionSourceOf({ questionSource: 'teacher' }), 'professorWritten');
    assert.equal(questionSourceOf({ questionSource: 'fallback' }), 'offlineTemplate');
    assert.deepEqual(QUESTION_SOURCES.map((x) => x.id), ['aiGenerated', 'professorWritten', 'offlineTemplate']);
    assert.match(QUESTION_SOURCES[2].description, /a professor's own while they are stored the same way/);
  });

  test('the mark in force is the score, else 1 or 0 from correct, kept between 0 and 1', () => {
    assert.equal(scoreOf({ score: 0.5, correct: false }), 0.5);
    assert.equal(scoreOf({ score: null, correct: true }), 1);
    assert.equal(scoreOf({ score: '0.25' }), 0.25, 'numeric arrives as text from some drivers');
    assert.equal(scoreOf({ score: 3 }), 1);
  });
});

/* ------------------------------------------------------------ the formula -- */

describe('the formula is data, checked whole', () => {
  test('every shipped preset passes the check and is named as an example, never as a standard', () => {
    assert.ok(PRESETS.length >= 1 && presetById(DEFAULT_PRESET));
    for (const p of PRESETS) {
      assert.deepEqual(validateConfig(p.config), clone(p.config), p.id);
      assert.match(p.name, /^Example: /);
      assert.doesNotMatch(`${p.name} ${p.description}`, /NAAC|NBA|standard formula/i);
    }
  });

  test('bad values are refused with a sentence that says what is wanted', () => {
    const bad = (changes, match) => status(400, () => validateConfig({ ...clone(EXAMPLE), ...changes }), match);
    bad({ studentThreshold: 60 }, /share from above 0 to 1/);
    bad({ studentThreshold: 0 }, /above 0/);
    bad({ studentThreshold: 0.6667 }, /3 decimal places/);
    bad({ minAnswers: 0 }, /minAnswers/);
    bad({ minAnswers: 2.5 }, /whole number/);
    bad({ levels: [] }, /levels/);
    bad({ levels: [{ level: 0, minShare: 0.5 }] }, /level 0 is "below the first"/);
    bad({ levels: [{ level: 1, minShare: 1.5 }] }, /minShare/);
    bad({ levels: [{ level: 1, minShare: 0.6 }, { level: 2, minShare: 0.6 }] }, /strictly increase/);
    bad({ levels: [{ level: 2, minShare: 0.5 }, { level: 1, minShare: 0.6 }] }, /strictly increase/);
    bad({ evidence: { digital: false, aiProvisional: false, humanReviewed: false } }, /at least one/);
    bad({ evidence: { digital: true, aiProvisional: false, humanReviewed: true, observations: true } }, /decision 3/);
    bad({ evidence: { digital: 'yes', aiProvisional: false, humanReviewed: true } }, /true or false/);
    bad({ attempts: 'last' }, /attempts/);
    bad({ roomWeights: [{ roomId: 'nope', weight: 2 }] }, /not a valid id/);
    status(400, () => validateConfig({ ...clone(EXAMPLE), extra: 1 }), /does not take extra/);
    const { attempts, ...partial } = clone(EXAMPLE);
    status(400, () => validateConfig(partial), /missing attempts/);
  });

  test('a save starts from a preset, or changes named fields of the formula in force, evidence key by key', () => {
    const current = validateConfig({ ...clone(EXAMPLE), minAnswers: 5 });
    assert.equal(configFrom({ config: { studentThreshold: 0.5 } }, { current }).minAnswers, 5, 'the rest stays as in force');
    assert.deepEqual(configFrom({ config: { evidence: { aiProvisional: true } } }, { current }).evidence,
      { digital: true, aiProvisional: true, humanReviewed: true });
    const fromPreset = configFrom({ preset: 'example-60-60-70-85', config: { attempts: 'best' } }, { current });
    assert.deepEqual([fromPreset.minAnswers, fromPreset.levels.at(-1).minShare, fromPreset.attempts], [3, 0.85, 'best']);
    status(400, () => configFrom({}, { current }), /Send \{ "preset"/);
    status(400, () => configFrom({ preset: 'naac' }, { current }), /preset must be one of/);
    status(400, () => configFrom({ config: { colour: 'red' } }, { current }), /does not take colour/);
    status(400, () => configFrom({ formula: {} }, { current }), /does not take formula/);
  });

  test('a save may not count unreviewed written marks without reviewed ones; one stored that way still reads, and says so', () => {
    // A review replaces the machine's mark: counting unreviewed marks but not
    // reviewed ones would make every review take an answer out of the count.
    const current = validateConfig(EXAMPLE);
    status(400, () => configFrom({ config: { evidence: { aiProvisional: true, humanReviewed: false } } }, { current }),
      /aiProvisional needs evidence\.humanReviewed.*every review would take an answer out/);
    status(400, () => configFrom({ preset: DEFAULT_PRESET, config: { evidence: { digital: false, aiProvisional: true, humanReviewed: false } } }, { current }));
    const only = { ...clone(EXAMPLE), evidence: { digital: false, aiProvisional: true, humanReviewed: false } };
    const stored = formulaOf({ version: 3, config: only, createdAt: '2026-11-19T10:00:00.000Z' });
    assert.match(methodologyText(stored), /this formula does not count reviewed marks, so an answer leaves the count once it is reviewed/);
    assert.match(registerMethodologyText(stored), /an answer leaves the count once it is reviewed/);
    assert.doesNotMatch(methodologyText(formula()), /leaves the count/);
    // and the class can still save a better one over it
    assert.deepEqual(configFrom({ config: { evidence: { humanReviewed: true } } }, { current: stored.config }).evidence,
      { digital: false, aiProvisional: true, humanReviewed: true });
  });

  test('room weights name a room of the class by code or id, and are stored by id', () => {
    const current = validateConfig(EXAMPLE);
    const rooms = [R1, R2];
    const c = configFrom({ config: { roomWeights: [{ code: 'roomb2', weight: 2 }, { roomId: R1._id.toUpperCase(), weight: 0.5 }] } }, { current, rooms });
    assert.deepEqual(c.roomWeights, [{ roomId: R2._id, weight: 2 }, { roomId: R1._id, weight: 0.5 }]);
    status(400, () => configFrom({ config: { roomWeights: [{ code: 'NOPE01', weight: 2 }] } }, { current, rooms }), /not a room of this class/);
    status(400, () => configFrom({ config: { roomWeights: [{ code: 'ROOMA1', weight: 2 }, { roomId: R1._id, weight: 3 }] } }, { current, rooms }), /twice/);
    status(400, () => configFrom({ config: { roomWeights: [{ code: 'ROOMA1', weight: 0 }] } }, { current, rooms }), /above 0/);
    status(400, () => configFrom({ config: { roomWeights: [{ code: 'ROOMA1', roomId: R1._id, weight: 2 }] } }, { current, rooms }), /one of the two/);
    // Carried forward from the formula in force, the stored entries are not re-checked against today's rooms.
    const kept = configFrom({ config: { minAnswers: 4 } }, { current: c, rooms: [] });
    assert.deepEqual(kept.roomWeights, c.roomWeights);
  });

  test('no formula saved: the default example, version 0, said to be an example; a saved one keeps its version', () => {
    const f = formulaOf(null);
    assert.deepEqual([f.source, f.version, f.preset.id], ['example', 0, DEFAULT_PRESET]);
    const saved = formulaOf({ version: 3, config: clone(EXAMPLE), createdAt: 'T', createdBy: 'u1' });
    assert.deepEqual([saved.source, saved.version, saved.preset?.id, saved.savedBy], ['saved', 3, DEFAULT_PRESET, 'u1']);
    assert.equal(matchingPreset({ ...clone(EXAMPLE), minAnswers: 4 }), null);
    status(500, () => formulaOf({ version: 2, config: { studentThreshold: 7 } }), /version 2/);
  });
});

/* ------------------------------------------------------- the boundaries -- */

describe('states and levels at their boundaries, decided exactly', () => {
  const config = validateConfig(EXAMPLE); // 0.6, 3 answers, 50 / 60 / 70
  const marks = (scores, weight = 1) => {
    const m = { answers: 0, obtained: 0n, possible: 0n };
    for (const s of scores) {
      m.answers += 1;
      m.obtained += BigInt(Math.round(s * 1000)) * BigInt(Math.round(weight * 1000)) * 1000n;
      m.possible += 1000n * BigInt(Math.round(weight * 1000)) * 1000n;
    }
    return m;
  };

  test('exactly 60% attains; a hair under does not', () => {
    assert.equal(stateOf(marks([1, 1, 1, 0, 0]), config), 'attained', '3 of 5 is 60%');
    assert.equal(stateOf(marks([1, 1, 0.5, 0.5, 0]), config), 'attained', '3.0 of 5 in part marks is 60%');
    assert.equal(stateOf(marks([1, 1, 0.999, 0, 0]), config), 'not-attained', '2.999 of 5 is 59.98%');
    assert.equal(stateOf(marks([1, 1, 0, 0, 0]), config), 'not-attained');
  });

  test('three answers of 0.7 are exactly 70%, though 0.7 + 0.7 + 0.7 is not 2.1 in floating point', () => {
    assert.ok((0.7 + 0.7 + 0.7) / 3 < 0.7, 'the trap this guards against');
    assert.equal(stateOf(marks([0.7, 0.7, 0.7]), { ...config, studentThreshold: 0.7 }), 'attained');
  });

  test('fewer than minAnswers is not enough evidence, never not attained; at minAnswers it is judged', () => {
    assert.equal(stateOf(marks([1, 1]), config), 'not-enough-evidence', 'two right answers are still too few');
    assert.equal(stateOf(marks([0, 0]), config), 'not-enough-evidence', 'two wrong ones are not "not attained"');
    assert.equal(stateOf(marks([1, 1, 0]), config), 'attained', '2 of 3 at exactly 3 answers');
    assert.equal(stateOf(marks([]), config), 'not-enough-evidence');
  });

  test('a share is rounded DOWN for display, so one under the threshold never prints at it beside "Not attained"', () => {
    // Topic weights 59.996 and 40.004, one right and one wrong: 59.996 of 100, a hair under 60%.
    const links = [
      { outcomeId: 'co1', classId: 'k1', contentId: C1, topic: 'Layers', weight: 59.996 },
      { outcomeId: 'co1', classId: 'k1', contentId: C1, topic: 'Routing', weight: 40.004 },
    ];
    const r = classAttainment({ ...base(), links, answers: [ans('21CS01', Q.L1, 1), ans('21CS01', Q.RT1, 0)], formula: formula({ minAnswers: 1 }) });
    const cell = outcomeOf(studentOf(r, '21CS01'), 'CO1');
    assert.deepEqual([cell.state, cell.obtained, cell.possible, cell.share], ['not-attained', 59.996, 100, 0.5999]);
    // Twenty answers scoring 11.999 in all: 59.995%, which rounding to the nearest printed as 60%.
    const twenty = Array.from({ length: 20 }, (_, i) => ans('21CS01', { ...Q.L1, _id: `q-x${i}` }, i < 11 ? 1 : (i === 11 ? 0.999 : 0)));
    const many = outcomeOf(studentOf(classAttainment({ ...base(), answers: twenty, formula: formula() }), '21CS01'), 'CO1');
    assert.deepEqual([many.state, many.obtained, many.possible, many.share], ['not-attained', 11.999, 20, 0.5999]);
  });

  test('marks are rounded down (obtained) and up (possible) to 3 decimals for display, never overstating a share', () => {
    // A score of 0.999 on a topic weighted 60.06 is 59.99994 of 60.06 exactly.
    const links = [{ outcomeId: 'co1', classId: 'k1', contentId: C1, topic: 'Layers', weight: 60.06 }];
    const room = { ...R1 };
    const f = formula({ minAnswers: 1, roomWeights: [{ roomId: R1._id, weight: 1.001 }] });
    // Room weight 1.001: obtained 0.999 x 60.06 x 1.001 = 60.05993994, possible 60.06 x 1.001 = 60.12006.
    const cell = outcomeOf(studentOf(classAttainment({ ...base(), rooms: [room], links, answers: [ans('21CS01', Q.L1, 0.999)], formula: f }), '21CS01'), 'CO1');
    assert.deepEqual([cell.obtained, cell.possible, cell.share], [60.059, 60.121, 0.999]);
  });

  test('class levels at their edges: 50% is level 1, 60% level 2, 70% level 3, 49.99% level 0, nobody counted none', () => {
    const levels = config.levels;
    assert.equal(classLevelOf(5, 10, levels), 1);
    assert.equal(classLevelOf(6, 10, levels), 2);
    assert.equal(classLevelOf(7, 10, levels), 3);
    assert.equal(classLevelOf(10, 10, levels), 3);
    assert.equal(classLevelOf(4, 10, levels), 0);
    assert.equal(classLevelOf(4999, 10000, levels), 0);
    assert.equal(classLevelOf(0, 0, levels), null);
    assert.equal(classLevelOf(0, 3, [{ level: 1, minShare: 0 }]), 1, 'a first level at 0% is reached by any class counted');
  });
});

/* ---------------------------------------------------- the class report -- */

describe('the class report on a hand-computed class', () => {
  const r = report();

  test('students are listed in roll order (roster, then removed, then off the roster), never by score', () => {
    assert.deepEqual(r.students.map((s) => [s.rollNo, s.status]), [
      ['21CS01', 'active'], ['21CS02', 'active'], ['21CS10', 'active'], ['21CS03', 'removed'], ['GUEST', 'not-on-roster']]);
    assert.ok(!JSON.stringify(r).match(/"rank"|"position":\s*\d+,\s*"rollNo"/), 'no rank anywhere');
  });

  test('CO1 per student: 3 of 5 attains at the boundary; 2 counted answers are not enough; a reviewed mark counts', () => {
    const a = outcomeOf(studentOf(r, '21CS01'), 'CO1');
    assert.deepEqual([a.state, a.answers, a.obtained, a.possible, a.share], ['attained', 5, 3, 5, 0.6]);
    assert.deepEqual([a.marks.digital.answers, a.marks.digital.obtained, a.marks.ungraded.answers], [5, 3, 1], 'the poll is a count only');
    const b = outcomeOf(studentOf(r, '21CS02'), 'CO1');
    // L1 1, L2 0 counted; the provisional written answer is shown, not counted; the retried attempt is set aside.
    assert.deepEqual([b.state, b.answers, b.obtained, b.possible], ['not-enough-evidence', 2, 1, 2]);
    assert.deepEqual([b.marks.aiProvisional.answers, b.marks.aiProvisional.obtained, b.marks.aiProvisional.counted], [1, 1, false]);
    const c = outcomeOf(studentOf(r, '21CS10'), 'CO1');
    // L1 1, L2 0, L3 0 digital and the overridden written answer 1: 2 of 4.
    assert.deepEqual([c.state, c.answers, c.obtained, c.possible, c.share], ['not-attained', 4, 2, 4, 0.5]);
    assert.deepEqual([c.marks.humanReviewed.answers, c.marks.humanReviewed.counted], [1, true]);
  });

  test('CO2 applies the topic weights: Routing x2, Layers x1', () => {
    // 21CS01: Layers 3 of 5 (x1) and Routing 1 of 1 (x2): (3 + 2) / (5 + 2) = 5/7.
    const a = outcomeOf(studentOf(r, '21CS01'), 'CO2');
    // 5/7 is 0.714285...: shown rounded down, 0.7142.
    assert.deepEqual([a.state, a.answers, a.obtained, a.possible, a.share], ['attained', 6, 5, 7, 0.7142]);
    // 21CS02: Layers 1 of 2 (x1), Routing 0 of 2 (x2): 1 / (2 + 4).
    const b = outcomeOf(studentOf(r, '21CS02'), 'CO2');
    assert.deepEqual([b.state, b.answers, b.obtained, b.possible], ['not-attained', 4, 1, 6]);
  });

  test('the class figure counts the roster now; removed and off-roster students are beside it, not in it', () => {
    const co1 = outcomeOf(r, 'CO1');
    assert.deepEqual(co1.students, { roster: 3, counted: 2, attained: 1, notAttained: 1, notEnoughEvidence: 1, withNoAnswers: 0 });
    assert.deepEqual([co1.share, co1.attainmentLevel], [0.5, 1], '1 of 2 is exactly 50%: level 1');
    const { notEnoughEvidence, ...apart } = co1.outside;
    assert.deepEqual(apart, { removed: { students: 1, answers: 3 }, notOnRoster: { students: 1, answers: 3 } });
    // The evidence behind the share is the counted students' only (21CS01 and
    // 21CS10): digital 5 + 3 answers, 3 + 1 right; one reviewed; 21CS01's poll.
    assert.deepEqual([co1.marks.digital.answers, co1.marks.digital.obtained, co1.marks.humanReviewed.answers,
      co1.marks.aiProvisional.answers, co1.marks.ungraded.answers], [8, 4, 1, 0, 1]);
    // 21CS02 is short of evidence: 2 counted answers and a provisional one shown, outside the share.
    assert.deepEqual([notEnoughEvidence.students, notEnoughEvidence.answers, notEnoughEvidence.marks.digital.answers,
      notEnoughEvidence.marks.aiProvisional.answers, notEnoughEvidence.marks.aiProvisional.counted], [1, 2, 2, 1, false]);
    assert.equal(co1.summary, '1 of 2 students counted attained CO1 (50%): level 1. 1 on the roster has not enough evidence '
      + '(fewer than 3 counted answers). Rests on 9 counted answers from the 2 students counted: 8 digital and 1 reviewed '
      + 'written. Outside the share: 2 counted answers from 1 student with not enough evidence. 1 provisional written answer '
      + 'is shown but not counted.');
    const co2 = outcomeOf(r, 'CO2');
    assert.deepEqual([co2.students.counted, co2.students.attained, co2.share, co2.attainmentLevel], [3, 1, 0.3333, 0]);
  });

  test('every chosen answer is mapped, excluded or unmapped, and they add up', () => {
    assert.deepEqual(r.answers, {
      rows: 25, setAside: 1, chosen: 24, ungraded: 1, graded: 23,
      byType: { digital: 21, aiProvisional: 1, humanReviewed: 1 }, mapped: 21, excluded: 1, unmapped: 1,
      bySource: { aiGenerated: 23, professorWritten: 0, offlineTemplate: 0 },
    });
    assert.deepEqual(r.unmapped, [{ contentId: C1, chapter: 'Networks: Unit 2', topic: 'Switching', inChapter: true, answers: 1 }]);
  });

  test('Bloom attainment: the same rules per level and per level band, mapped or not', () => {
    const lvl = (s, level) => studentOf(r, s).bloom.levels.find((l) => l.level === level);
    // 21CS01 understand: L1..L5 and EX1 (excluded from outcomes, still Understand): 4 of 6.
    assert.deepEqual([lvl('21CS01', 'understand').state, lvl('21CS01', 'understand').answers, lvl('21CS01', 'understand').obtained], ['attained', 6, 4]);
    assert.equal(lvl('21CS01', 'remember').state, 'not-enough-evidence', 'the unmapped Switching answer still counts at its level');
    assert.equal(lvl('21CS01', 'remember').answers, 1);
    const understand = r.bloom.levels.find((l) => l.level === 'understand');
    assert.deepEqual([understand.students.counted, understand.students.attained, understand.attainmentLevel], [2, 1, 1]);
    const lower = r.bloom.bands.find((b) => b.id === 'lower');
    // 21CS01: Remember 1 of 1 and Understand 4 of 6: 5 of 7.
    const mine = studentOf(r, '21CS01').bloom.bands.find((b) => b.id === 'lower');
    assert.deepEqual([mine.answers, mine.obtained, mine.state], [7, 5, 'attained']);
    assert.deepEqual([lower.students.counted, lower.attainmentLevel], [2, 1]);
    const middle = r.bloom.bands.find((b) => b.id === 'middle');
    assert.deepEqual([middle.students.counted, middle.attainmentLevel], [0, null]);
  });

  test('switching provisional marks on changes the result and says so', () => {
    const on = report(formula({ evidence: { digital: true, aiProvisional: true, humanReviewed: true } }));
    const b = outcomeOf(studentOf(on, '21CS02'), 'CO1');
    assert.deepEqual([b.state, b.answers, b.obtained], ['attained', 3, 2], 'L1 1, L2 0 and the provisional 1: 2 of 3');
    const co1 = outcomeOf(on, 'CO1');
    assert.deepEqual([co1.students.counted, co1.students.attained, co1.attainmentLevel], [3, 2, 2], '2 of 3 is 66.7%: level 2');
    // 2 of 3 is 0.6666...: shown rounded down, so it never reads as a level's 66.7% when it is under it.
    assert.equal(co1.share, 0.6666);
    assert.match(co1.summary, /^2 of 3 students counted attained CO1 \(66\.66%\): level 2\./);
    assert.match(on.methodology, /written answers given only a provisional machine mark \(a keyword match against the rubric, not AI\) and not yet reviewed\./);
    assert.doesNotMatch(on.methodology, /shown but not counted/);
  });

  test('a stricter example moves the class level, not any student\'s state', () => {
    const strict = report(formulaOf({ version: 1, config: clone(presetById('example-60-60-70-85').config), createdAt: 'T' }));
    assert.equal(outcomeOf(strict, 'CO1').attainmentLevel, 0, '50% is under the 60% for level 1');
    assert.equal(outcomeOf(studentOf(strict, '21CS01'), 'CO1').state, 'attained');
    assert.equal(strict.formula.preset.id, 'example-60-60-70-85');
  });

  test('teacher records sit beside the figures and never move one', () => {
    const records = {
      observations: [
        { sessionId: R1._id, classStudentId: 's02', rollNo: '21CS02', day: '2026-11-02', kind: 'support', observedAt: '1' },
        { sessionId: R1._id, classStudentId: 's02', rollNo: '21CS02', day: '2026-11-02', kind: 'understood', observedAt: '2' },
        { sessionId: R1._id, classStudentId: 's10', rollNo: '21CS10', day: '2026-11-02', kind: 'revision', observedAt: '3' },
        { sessionId: R1._id, classStudentId: 's10', rollNo: '21CS10', day: '2026-11-02', kind: null, observedAt: '4' },
      ],
      picks: [{ sessionId: R1._id, classStudentId: 's02', rollNo: '21CS02', status: 'answered' }, { sessionId: R1._id, classStudentId: null, rollNo: 'GUEST', status: 'help' }],
      tallies: [{ counts: [3, 4, 0, 1] }],
      activities: [{ kind: 'group' }],
    };
    const withRecords = report(formula(), { records });
    const strip = (x) => JSON.stringify([x.outcomes, x.bloom, x.students.map(({ records: _r, ...s }) => s)]);
    assert.equal(strip(withRecords), strip(r), 'every figure, every student, unchanged');
    const t = withRecords.teacherRecords;
    // 21CS02's day: support then understood, so understood is in force; 21CS10's mark was cleared.
    assert.deepEqual([t.observations.counts.understood, t.observations.counts.support, t.observations.counts.revision, t.observations.studentDays], [1, 0, 0, 1]);
    assert.deepEqual([t.picks.answeredAloud, t.picks.counts.help, t.tallies.questions, t.tallies.hands, t.activities.counts.group], [1, 1, 1, 8, 1]);
    assert.match(t.label, /never part of one/);
    assert.equal(studentOf(withRecords, '21CS02').records.observations.understood, 1);
    assert.equal(studentOf(withRecords, 'GUEST').records.picks.help, 1);
    assert.deepEqual(studentOf(withRecords, '21CS01').records.picks, { pending: 0, answered: 0, passed: 0, help: 0, skipped: 0, absent: 0 },
      'no record is zeros, never missing');
  });

  test('the report carries the formula it used, its methodology, the evidence types and the privacy line', () => {
    assert.equal(r.formula.version, 7);
    assert.deepEqual(r.formula.config, validateConfig(EXAMPLE));
    assert.match(r.methodology, /^Formula: version 7 of this class's own formula, saved 2026-11-19\./);
    assert.deepEqual(r.evidenceTypes.map((t) => t.id), ['digital', 'aiProvisional', 'humanReviewed']);
    assert.match(r.privacy, /staff only/);
    assert.doesNotMatch(JSON.stringify(r), /slow learner|weak student|topper/i);
  });

  test('a figure nobody is counted in rests on nothing, and says what evidence there is outside any share', () => {
    const f = formula({ minAnswers: 10 });
    const co1 = outcomeOf(report(f), 'CO1');
    assert.deepEqual([co1.students.counted, co1.marks.digital.answers, co1.outside.notEnoughEvidence.students,
      co1.outside.notEnoughEvidence.answers], [0, 0, 3, 11]);
    assert.equal(co1.summary, 'No student on the roster has 10 counted answers on CO1 yet, so it has no class level. Outside '
      + 'the share: 11 counted answers from 3 students with not enough evidence. 1 provisional written answer is shown but '
      + 'not counted.');
  });

  test('every figure splits its counted marks again by who wrote the question; they add up, and move nothing', () => {
    // 21CS01's Layers answers: L1 and L2 the model's, L3 a professor's, L4 and L5 the template's.
    const src = { 'q-l3': 'teacher', 'q-l4': 'fallback', 'q-l5': 'fallback' };
    const answers = ANSWERS.map((a) => (a.rollNo === '21CS01' && src[a.questionId] ? { ...a, questionSource: src[a.questionId] } : a));
    const mixed = classAttainment({ ...base(), answers, formula: formula() });
    const asha = outcomeOf(studentOf(mixed, '21CS01'), 'CO1');
    // L1 1, L2 1 | L3 1 | L4 0, L5 0.
    assert.deepEqual(asha.marks.questionSources, {
      aiGenerated: { answers: 2, obtained: 2, possible: 2, notCounted: 0 },
      professorWritten: { answers: 1, obtained: 1, possible: 1, notCounted: 0 },
      offlineTemplate: { answers: 2, obtained: 0, possible: 2, notCounted: 0 },
    });
    // The share's evidence: 21CS01's five, and 21CS10's four (L1 1, L2 0, L3 0 and the overridden 1), all the model's.
    const co1 = outcomeOf(mixed, 'CO1');
    assert.deepEqual(Object.values(co1.marks.questionSources).map((m) => [m.answers, m.obtained, m.possible]), [[6, 4, 6], [1, 1, 1], [2, 0, 2]]);
    assert.equal(Object.values(co1.marks.questionSources).reduce((n, m) => n + m.answers, 0),
      co1.marks.digital.answers + co1.marks.humanReviewed.answers, 'the sources add up to the counted types');
    // 21CS02's provisional written answer is outside the share, of a type not counted.
    assert.equal(co1.outside.notEnoughEvidence.marks.questionSources.aiGenerated.notCounted, 1);
    assert.deepEqual(mixed.answers.bySource, { aiGenerated: 20, professorWritten: 1, offlineTemplate: 2 });
    const plain = report();
    const figures = (x) => JSON.stringify(x.outcomes.map((o) => [o.students, o.share, o.attainmentLevel, o.summary]));
    assert.equal(figures(mixed), figures(plain), 'no state, share, level or sentence moves');
    assert.match(mixed.methodology, /Every figure also splits its counted marks by who wrote the question: AI-generated/);
    assert.deepEqual(mixed.questionSources, QUESTION_SOURCES);
  });

  test('an empty roster says how to get a class figure', () => {
    const empty = report(formula(), { roster: [] });
    assert.match(outcomeOf(empty, 'CO1').summary, /class roster is empty/);
    assert.ok(empty.students.every((s) => s.status === 'not-on-roster'));
  });
});

/* ------------------------------------------------ attempts and weights -- */

describe('which attempts count, and room weights', () => {
  // One student, one question of CO1 in two rooms: wrong in the first, right in
  // the second; and a multi question with a half-right first attempt (retried)
  // then a wrong final one.
  const rows = () => {
    const multi = { ...q('q-m1', 'Layers', 'understand', 'multi') };
    return [
      ans('21CS01', Q.L1, 0, { sessionId: R1._id }),
      ans('21CS01', Q.L1, 1, { sessionId: R2._id }),
      ans('21CS01', multi, 0.5, { sessionId: R1._id, final: false }),
      ans('21CS01', multi, 0, { sessionId: R1._id }),
    ];
  };
  const run = (changes) => outcomeOf(studentOf(classAttainment({
    ...base(), rooms: [R1, R2], answers: rows(), formula: formula({ minAnswers: 1, ...changes }),
  }), '21CS01'), 'CO1');

  test('final: both rooms\' answers to L1 count, and the multi\'s final 0; best: one answer per question, the best', () => {
    const fin = run({ attempts: 'final' });
    assert.deepEqual([fin.answers, fin.obtained, fin.possible], [3, 1, 3], 'L1 0 + L1 1 + multi 0');
    const best = run({ attempts: 'best' });
    assert.deepEqual([best.answers, best.obtained, best.possible], [2, 1.5, 2], 'L1 1 (room 2) + the multi\'s retried 0.5');
  });

  test('best picks among counted evidence first: a provisional 1 does not beat a reviewed 0.4 when provisional is off', () => {
    const open = Q.OP1;
    const answers = [
      ans('21CS01', open, 1, { sessionId: R1._id, reviewStatus: 'provisional' }),
      ans('21CS01', open, 0.4, { sessionId: R2._id, reviewStatus: 'confirmed' }),
    ];
    const { chosen } = chooseAnswers(answers, validateConfig({ ...clone(EXAMPLE), attempts: 'best' }));
    assert.deepEqual(chosen.map((a) => a.score), [0.4]);
    const all = chooseAnswers(answers, validateConfig({ ...clone(EXAMPLE), attempts: 'best', evidence: { digital: true, aiProvisional: true, humanReviewed: true } }));
    assert.deepEqual(all.chosen.map((a) => a.score), [1]);
  });

  test('best never counts a written attempt followed by a retry: no professor can review it, so it cannot beat a review', () => {
    // Attempt 1 of a written question: provisional 0.5, retried. Attempt 2: final,
    // and a professor overrode its mark to 0.1. The review route refuses to review
    // attempt 1 ("it never counted"), so the professor's 0.1 is what counts.
    const all = formula({ minAnswers: 1, attempts: 'best', evidence: { digital: true, aiProvisional: true, humanReviewed: true } });
    const answers = [
      ans('21CS01', Q.OP1, 0.5, { final: false, attempt: 1 }),
      ans('21CS01', Q.OP1, 0.1, { attempt: 2, reviewStatus: 'overridden' }),
    ];
    const cell = outcomeOf(studentOf(classAttainment({ ...base(), answers, formula: all }), '21CS01'), 'CO1');
    assert.deepEqual([cell.answers, cell.obtained, cell.marks.humanReviewed.answers, cell.marks.aiProvisional.answers], [1, 0.1, 1, 0]);
    // Not yet reviewed: still the final attempt, the one the review queue holds.
    const unreviewed = [answers[0], { ...answers[1], reviewStatus: 'provisional', score: 0.2 }];
    assert.deepEqual(chooseAnswers(unreviewed, all.config).chosen.map((a) => a.score), [0.2]);
    // An objective question's retried attempt is marked from the key, and still counts under best.
    const multi = { ...q('q-m2', 'Layers', 'understand', 'multi') };
    assert.deepEqual(chooseAnswers([ans('21CS01', multi, 0.5, { final: false }), ans('21CS01', multi, 0)], all.config).chosen
      .map((a) => a.score), [0.5]);
    const one = studentAttainment({ ...base(), answers, formula: all, student: ROSTER[0] });
    assert.match(one.answers.find((a) => a.score === 0.5).note, /written attempt followed by a retry/);
    assert.match(methodologyText(all), /a written answer's attempt followed by a retry is left out/);
  });

  test('room weights: room 2 counting double turns 1 of 2 into 2 of 3', () => {
    const equal = run({ attempts: 'final', roomWeights: [] });
    assert.deepEqual([equal.obtained, equal.possible], [1, 3]);
    const weighted = run({ attempts: 'final', roomWeights: [{ roomId: R2._id, weight: 2 }] });
    // L1 0 (room 1, x1) + L1 1 (room 2, x2) + multi 0 (room 1, x1): 2 of 4.
    assert.deepEqual([weighted.obtained, weighted.possible, weighted.share], [2, 4, 0.5]);
  });

  test('a weighted room left out by ?rooms= or the dates is named and said to be outside the report, never "deleted"', () => {
    const f = formula({ roomWeights: [{ roomId: R2._id, weight: 2 }] });
    const narrowed = { ...base(), rooms: [R1], classRooms: [R1, R2], formula: f };
    const weight = { roomId: R2._id, code: 'ROOMB2', weight: 2, found: true, inReport: false };
    for (const r of [classAttainment(narrowed), studentAttainment({ ...narrowed, student: ROSTER[0] }), marksRegister(narrowed)]) {
      assert.deepEqual(r.formula.roomWeights, [weight]);
    }
    assert.match(classAttainment(narrowed).methodology, /Rooms are weighted: ROOMB2 x 2 \(a room not in this report\); every other room x 1\./);
    const whole = classAttainment({ ...narrowed, rooms: [R1, R2] });
    assert.match(whole.methodology, /Rooms are weighted: ROOMB2 x 2; every other room x 1\./);
    assert.equal(whole.formula.roomWeights[0].inReport, true);
    // Gone from the class's rooms altogether: that is a deleted room.
    const gone = classAttainment({ ...narrowed, classRooms: [R1] });
    assert.match(gone.methodology, /Rooms are weighted: a room since deleted x 2; every other room x 1\./);
    assert.deepEqual([gone.formula.roomWeights[0].found, gone.formula.roomWeights[0].code], [false, null]);
  });

  test('a second final row for one question in one room replaces the first, as item statistics read it', () => {
    const answers = [ans('21CS01', Q.L1, 0), ans('21CS01', Q.L1, 1)];
    const { chosen, setAside } = chooseAnswers(answers, validateConfig(EXAMPLE));
    assert.deepEqual([chosen.length, chosen[0].score, setAside], [1, 1, 1]);
  });
});

/* -------------------------------------------------------- the methodology -- */

describe('the methodology paragraph follows the formula', () => {
  test('it states the threshold, the minimum, the evidence, the attempts, the weights and every level', () => {
    const text = methodologyText(formula(), { rooms: [R1, R2] });
    for (const part of [/Only rooms opened for this class are counted: a room opened without choosing this class is not in this report/,/at least 60% of the marks/, /fewer than 3 such answers/, /never as not attained/,
      /from digital answers marked automatically and written answers a professor has reviewed/, /counting final attempts only/,
      /Every room counts the same/, /level 3 from 70%, level 2 from 60%, level 1 from 50% and level 0 below 50%/,
      /never enter a mark or move a level/, /not counted; their evidence is kept in room archives/]) {
      assert.match(text, part);
    }
  });

  test('changing the formula changes the words', () => {
    const f = formula({
      studentThreshold: 0.55, minAnswers: 1, attempts: 'best', roomWeights: [{ roomId: R2._id, weight: 2 }],
      levels: [{ level: 1, minShare: 0 }, { level: 2, minShare: 0.4 }],
    });
    const text = methodologyText(f, { rooms: [R1, R2] });
    assert.match(text, /at least 55% of the marks/);
    assert.match(text, /fewer than 1 such answer on an outcome/);
    assert.match(text, /only their best attempt at each question/);
    assert.match(text, /Rooms are weighted: ROOMB2 x 2; every other room x 1\./);
    assert.match(text, /level 2 from 40% and level 1 from 0%\./, 'no "level 0 below 0%"');
  });

  test('the day a formula was saved is India\'s day, like every other day in a report', () => {
    // 20:00 UTC on the 19th is 01:30 on the 20th in India.
    const late = formulaOf({ version: 1, config: { ...clone(EXAMPLE), minAnswers: 4 }, createdAt: '2026-11-19T20:00:00.000Z' });
    assert.match(methodologyText(late), /version 1 of this class's own formula, saved 2026-11-20\./);
    assert.match(registerMethodologyText(late), /saved 2026-11-20\./);
    assert.match(formulaLabel(late), /saved 2026-11-20$/);
    const early = formulaOf({ version: 1, config: { ...clone(EXAMPLE), minAnswers: 4 }, createdAt: '2026-11-19T18:29:00.000Z' });
    assert.match(methodologyText(early), /saved 2026-11-19\./);
  });

  test('a default example and a preset-equal saved formula are named as examples, not standards', () => {
    assert.match(methodologyText(formulaOf(null)), /No formula has been saved for this class.*as an example to start from, not as an institutional standard/);
    const saved = formulaOf({ version: 2, config: clone(EXAMPLE), createdAt: '2026-11-18T09:00:00Z' });
    assert.match(methodologyText(saved), /version 2 of this class's formula, saved 2026-11-18, the same as the example/);
    assert.match(registerMethodologyText(saved), /not a zero/);
  });
});

/* ------------------------------------------- a corrected roll number -- */

describe('a roll number corrected on the roster keeps the student\'s answers (0021)', () => {
  // Asha (s01) answered in ROOMA1 as 21CS01, where her phone's join marked her
  // present under 21CS01. Her roll number was corrected to 21CS11 since.
  const renamed = ROSTER.map((s) => (s._id === 's01' ? { ...s, rollNo: '21CS11' } : s));
  const joinMark = new Map([[R1._id, [{ classStudentId: 's01', rollNo: '21CS01', status: 'present', source: 'joined' }]]]);
  const before = report();

  test('her answers stay in her own row and in the class figures', () => {
    const r = classAttainment({ ...base(), roster: renamed, attendance: joinMark, formula: formula() });
    assert.deepEqual(r.students.map((s) => [s.rollNo, s.status]), [
      ['21CS02', 'active'], ['21CS10', 'active'], ['21CS11', 'active'], ['21CS03', 'removed'], ['GUEST', 'not-on-roster']]);
    const asha = studentOf(r, '21CS11');
    assert.deepEqual([asha.outcomes, asha.bloom], [studentOf(before, '21CS01').outcomes, studentOf(before, '21CS01').bloom],
      'every cell as before the correction');
    for (const code of ['CO1', 'CO2']) {
      assert.deepEqual([outcomeOf(r, code).students, outcomeOf(r, code).share, outcomeOf(r, code).marks],
        [outcomeOf(before, code).students, outcomeOf(before, code).share, outcomeOf(before, code).marks], code);
    }
    assert.deepEqual(r.rollNotes.map((x) => x.rollNo), ['GUEST'], 'nothing is left under 21CS01');
  });

  test('her own report finds them, each saying the roll number it was given under', () => {
    const one = studentAttainment({ ...base(), roster: renamed, attendance: joinMark, student: renamed[0], formula: formula() });
    assert.equal(one.answers.length, 9);
    assert.ok(one.answers.every((a) => a.givenAs === '21CS01' && /Given under roll number 21CS01, which this room's attendance mark/.test(a.note)));
    assert.deepEqual(one.outcomes.map((o) => [o.code, o.state, o.answers]), [['CO1', 'attained', 5], ['CO2', 'attained', 6]]);
  });

  test('the register: present, with her marks, under her roll number now', () => {
    const reg = marksRegister({
      cls: CLS, rooms: [R1], formula: formula(), answers: ANSWERS, roster: renamed, attendance: joinMark,
      profiles: new Map([[R1._id, [{ rollNo: '21CS01', name: 'Asha' }]]]),
    });
    const row = reg.students.find((s) => s.rollNo === '21CS11');
    // L1 to L5 (3 of 5), RT1 1, SW1 1, EX1 1: 6 of 8, and her poll.
    assert.deepEqual([row.rooms[0].attendance, row.rooms[0].answered, row.rooms[0].joined, row.rooms[0].counted.obtained,
      row.rooms[0].counted.possible], ['present', true, true, 6, 8]);
    assert.ok(!reg.students.some((s) => s.rollNo === '21CS01'));
  });

  test('a mark from before 0021 carries no roll number: matched to the roster as it stands now, with a note', () => {
    const old = new Map([[R1._id, [{ classStudentId: 's01', rollNo: null, status: 'present', source: 'joined' }]]]);
    const r = classAttainment({ ...base(), roster: renamed, attendance: old, formula: formula() });
    assert.equal(studentOf(r, '21CS01').status, 'not-on-roster');
    assert.equal(outcomeOf(studentOf(r, '21CS11'), 'CO1').state, 'not-enough-evidence');
    assert.equal(studentOf(r, '21CS01').note, '21CS01 is not on the class roster, so its answers in ROOMA1 are listed apart and counted '
      + 'in no class figure.');
  });

  test('an answer under the old roll number in a room whose mark does not carry it stays apart; the note says whose it was', () => {
    const answers = [...ANSWERS, ans('21CS01', Q.RT2, 1, { sessionId: R2._id })];
    const r = classAttainment({ ...base(), rooms: [R1, R2], roster: renamed, attendance: joinMark, answers, formula: formula() });
    const off = studentOf(r, '21CS01');
    assert.equal(off.status, 'not-on-roster');
    assert.equal(off.note, '21CS01 is not on the class roster, so its answers in ROOMB2 are listed apart and counted in no class '
      + 'figure. The attendance mark in ROOMA1 was made under it for Asha Rao (now 21CS11); answers under it are theirs only in '
      + 'a room whose mark carries it.');
    assert.deepEqual(r.rollNotes.find((x) => x.rollNo === '21CS01').tiedTo,
      [{ studentId: 's01', rollNo: '21CS11', name: 'Asha Rao', rooms: ['ROOMA1'] }]);
    assert.equal(outcomeOf(studentOf(r, '21CS11'), 'CO1').answers, 5, 'her ROOMA1 answers are still hers');
    assert.equal(studentOf(r, 'GUEST').note, 'GUEST is not on the class roster, so its answers in ROOMA1 are listed apart and '
      + 'counted in no class figure.');
  });

  test('nothing is guessed: only in the room whose mark carries it, and a roll number two marks carry is tied to neither', () => {
    const resolve = rollResolver(renamed, joinMark);
    assert.equal(resolve(R1._id.toUpperCase(), '21CS01'), '21CS11', 'a room id in any case');
    assert.equal(resolve(R2._id, '21CS01'), '21CS01');
    assert.equal(resolve(R1._id, '21CS02'), '21CS02', 'a roll number no mark carries is as it was');
    const twice = rollResolver(renamed, new Map([[R1._id, [{ classStudentId: 's01', rollNo: '21CS01' }, { classStudentId: 's02', rollNo: '21CS01' }]]]));
    assert.equal(twice(R1._id, '21CS01'), '21CS01');
  });
});

/* ------------------------------------------------- the student's report -- */

describe('one student\'s report, with the answers behind it', () => {
  const s = studentAttainment({ ...base(), student: ROSTER.find((x) => x.rollNo === '21CS02'), formula: formula() });

  test('their outcomes and levels, as in the class report', () => {
    assert.deepEqual(s.outcomes.map((o) => [o.code, o.state, o.answers]), [['CO1', 'not-enough-evidence', 2], ['CO2', 'not-attained', 4]]);
    assert.equal(s.student.rollNo, '21CS02');
  });

  test('every answer they gave, with its type, whether it counted and why', () => {
    assert.equal(s.answers.length, 6);
    const note = (qid) => s.answers.find((a) => a.questionId === qid && a.final).note;
    assert.match(note('q-op1'), /Shown, not counted: the formula does not count provisional machine marks/);
    assert.equal(s.answers.find((a) => a.questionId === 'q-op1').evidenceType, 'aiProvisional');
    assert.match(s.answers.find((a) => a.final === false).note, /an attempt followed by a retry/);
    const counted = s.answers.find((a) => a.questionId === 'q-rt1');
    assert.deepEqual([counted.counts, counted.via, counted.outcomes.map((o) => [o.code, o.weight])], [true, 'topic', [['CO2', 2]]]);
    assert.ok(counted.snapshot && counted.auto, 'the teacher\'s view of the answer, as the evidence reads give it');
  });
});

/* ----------------------------------------------------------- the register -- */

describe('the marks register', () => {
  const answers = [
    ans('21CS01', Q.L1, 1, { sessionId: R1._id }), ans('21CS01', Q.L2, 0, { sessionId: R1._id }),
    ans('21CS01', Q.OP1, 1, { sessionId: R2._id }), // provisional, not counted
    ans('21CS01', Q.L3, 1, { sessionId: R2._id }),
    ans('21CS10', Q.L1, 1, { sessionId: R2._id }), ans('21CS10', Q.P1, null, { sessionId: R2._id }),
  ];
  const reg = marksRegister({
    cls: CLS, rooms: [R1, R2], formula: formula(), answers, roster: ROSTER,
    attendance: new Map([[R1._id, [{ classStudentId: 's01', status: 'present' }, { classStudentId: 's10', status: 'absent' }]],
      [R2._id, [{ classStudentId: 's01', status: 'late' }, { classStudentId: 's10', status: 'present' }]]]),
    profiles: new Map([[R1._id, [{ rollNo: '21CS01' }]], [R2._id, [{ rollNo: '21CS01' }, { rollNo: '21CS10' }, { rollNo: 'GUEST', name: 'Guest typed' }]]]),
  });
  const row = (roll) => reg.students.find((s) => s.rollNo === roll);

  test('rooms in date order, students in roll order, with the typed name of a phone off the roster', () => {
    assert.deepEqual(reg.rooms.map((r) => r.code), ['ROOMA1', 'ROOMB2']);
    assert.deepEqual(reg.students.map((s) => [s.rollNo, s.status]), [['21CS01', 'active'], ['21CS02', 'active'], ['21CS10', 'active'], ['GUEST', 'not-on-roster']]);
    assert.equal(row('GUEST').name, 'Guest typed');
  });

  test('each cell: counted marks of possible, every type apart, and the attendance mark', () => {
    const [a1, a2] = row('21CS01').rooms;
    assert.deepEqual([a1.attendance, a1.counted.obtained, a1.counted.possible], ['present', 1, 2]);
    assert.deepEqual([a2.attendance, a2.counted.obtained, a2.counted.possible, a2.marks.aiProvisional.answers], ['late', 1, 1, 1]);
    assert.deepEqual([row('21CS01').total.counted.obtained, row('21CS01').total.counted.possible], [2, 3]);
    assert.deepEqual(row('21CS01').total.attendance, { present: 1, late: 1, absent: 0, unmarked: 0 });
  });

  test('absent is not zero: no answers is 0 of 0 with the mark that says why', () => {
    const [c1, c2] = row('21CS10').rooms;
    assert.deepEqual([c1.attendance, c1.answered, c1.counted.possible, c1.counted.share], ['absent', false, 0, null]);
    assert.deepEqual([c2.counted.obtained, c2.counted.possible, c2.marks.ungraded.answers], [1, 1, 1]);
    assert.deepEqual([row('21CS02').rooms[0].attendance, row('21CS02').rooms[0].answered], ['unmarked', false]);
    assert.equal(row('GUEST').rooms[1].attendance, null);
    assert.equal(row('GUEST').rooms[1].joined, true);
  });
});

/* ------------------------------------------------------------- the rooms -- */

describe('which rooms a report counts', () => {
  test('by the day each room opened (India\'s time), and by code', () => {
    assert.deepEqual(roomsWindow({ from: '2026-11-03' }, [R2, R1]).rooms.map((r) => r.code), ['ROOMB2']);
    assert.deepEqual(roomsWindow({ to: '2026-11-02' }, [R2, R1]).rooms.map((r) => r.code), ['ROOMA1']);
    assert.deepEqual(roomsWindow({}, [R2, R1]).rooms.map((r) => r.code), ['ROOMA1', 'ROOMB2'], 'oldest first');
    assert.deepEqual(roomsWindow({ rooms: 'roomb2, ROOMA1' }, [R1, R2]).window.rooms, ['ROOMB2', 'ROOMA1']);
    // 20:00 UTC on the 1st is 01:30 on the 2nd in India.
    const late = { ...R1, startedAt: '2026-11-01T20:00:00.000Z' };
    assert.deepEqual(roomsWindow({ from: '2026-11-02', to: '2026-11-02' }, [late]).rooms.length, 1);
  });

  test('bad dates, an inverted range and a code not of the class are 400s', () => {
    status(400, () => roomsWindow({ from: '2026-13-01' }, [R1]), /YYYY-MM-DD/);
    status(400, () => roomsWindow({ from: '2026-11-09', to: '2026-11-01' }, [R1]), /after/);
    status(400, () => roomsWindow({ rooms: 'ROOMA1,ZZZZZZ' }, [R1]), /ZZZZZZ is not a room of this class/);
  });
});

/* ------------------------------------------------------------ the stores -- */

describe('the formula\'s storage', () => {
  test('memory: the highest version is in force, and a version taken twice is a 409', async () => {
    const repo = createMemoryRepo();
    assert.equal(await repo.getAttainmentConfig('k1'), null);
    await repo.addAttainmentConfig({ classId: 'k1', version: 1, config: clone(EXAMPLE), createdBy: null });
    await repo.addAttainmentConfig({ classId: 'k1', version: 2, config: { ...clone(EXAMPLE), minAnswers: 4 }, createdBy: 'u1' });
    await repo.addAttainmentConfig({ classId: 'k2', version: 9, config: clone(EXAMPLE) });
    const now = await repo.getAttainmentConfig('k1');
    assert.deepEqual([now.version, now.config.minAnswers, now.createdBy], [2, 4, 'u1']);
    await assert.rejects(repo.addAttainmentConfig({ classId: 'k1', version: 2, config: clone(EXAMPLE) }), (e) => e.status === 409);
    assert.equal((await repo.getAttainmentConfig('k1')).config.minAnswers, 4, 'the losing save wrote nothing');
  });

  // Not a database test: no Supabase is reachable from here. This pins the
  // requests the Supabase repo sends, against the names 0020 gives.
  test('the Supabase repo\'s requests: the latest version by order, an insert of the four columns, a clash as 409', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const replies = [];
    const CLASS = '11111111-1111-4111-8111-111111111111';
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      seen.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      const r = replies.shift() ?? { status: 200, body: [] };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    const row = { id: 'v1', class_id: CLASS, version: 3, config: clone(EXAMPLE), created_at: 'T', created_by: null };
    try {
      const repo = createSupabaseRepo();
      replies.push({ status: 200, body: row });
      const got = await repo.getAttainmentConfig(CLASS);
      assert.equal(seen[0].url.pathname, '/rest/v1/attainment_configs');
      assert.deepEqual([seen[0].url.searchParams.get('class_id'), seen[0].url.searchParams.get('order'), seen[0].url.searchParams.get('limit')],
        [`eq.${CLASS}`, 'version.desc', '1']);
      assert.deepEqual([got.version, got.config.minAnswers, got.classId], [3, 3, CLASS]);

      replies.push({ status: 201, body: { ...row, version: 4 } });
      const added = await repo.addAttainmentConfig({ classId: CLASS, version: 4, config: clone(EXAMPLE), createdBy: null });
      assert.deepEqual([seen[1].method, Object.keys(seen[1].body).sort()], ['POST', ['class_id', 'config', 'created_by', 'version']]);
      assert.equal(added.version, 4);

      replies.push({ status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "attainment_configs_class_version_key"' } });
      await assert.rejects(repo.addAttainmentConfig({ classId: CLASS, version: 4, config: clone(EXAMPLE) }), (e) => e.status === 409);

      const before = seen.length;
      assert.equal(await repo.getAttainmentConfig('0123456789abcdef01234567'), null);
      assert.equal(seen.length, before, 'no request for an id that cannot be a uuid');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  test('the Mongo schema keeps the same fields and refuses version 0 (built, not saved: no Mongo here)', async () => {
    const { AttainmentConfig } = await import('../src/models/index.js');
    const ok = new AttainmentConfig({ classId: 'k1', version: 1, config: clone(EXAMPLE) });
    assert.equal(ok.validateSync(), undefined);
    assert.ok(new AttainmentConfig({ classId: 'k1', version: 0, config: {} }).validateSync());
    assert.deepEqual(Object.keys(ok.toObject()).sort(), ['_id', 'classId', 'config', 'createdAt', 'createdBy', 'version']);
  });
});

test('recordsSummary with nothing recorded is all zeros, not missing', () => {
  const t = recordsSummary({});
  assert.deepEqual([t.observations.studentDays, t.picks.total, t.tallies.questions, t.activities.total], [0, 0, 0, 0]);
});
