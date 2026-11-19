// Batch 8, the design zip's server gaps for the live room, the wheel and
// analytics (docs/UI_ZIP_AUDIT.md L1, C2, L2, W2, A1, A3; the older file's gaps
// 2, 6 and 9; and the phone outbox's three asks). Pure parts and the store's
// contract; server/scripts/zipgaps1.mjs drives the routes end to end.
//
// The model is never called: its replies are fixtures, read through the real
// parsing (parseMove), and the background path runs on a stand-in.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { LEVELS } from '../src/bloom.js';
import {
  AI_LABEL, FAILED_MESSAGE, LABELLING, MAX_MODEL_BODY, MAX_TITLE, OFFLINE_MESSAGE, basisSentence, buildMovePrompt, chooseTopic,
  draftMove, materialFor, modelReady, moveBasis, moveKindFrom, moveRequest, moveView, parseMove, startMove, useModelForTests,
} from '../src/services/teachingMoves.js';
import { ASK_TYPES, askFrom, drawQuestion, drawableQuestions, pickView, wheelState } from '../src/services/wheel.js';
import { roomComparison } from '../src/services/classAnalytics.js';
import { levelPoint, noteSample, seriesOf, forgetInsights, supportAgainstPrevious } from '../src/services/insights.js';
import { classLabel, roomClasses } from '../src/services/roomClass.js';
import { activityView } from '../src/services/records.js';

config.gemini.apiKey = '';

const cells = (spec = {}) => Object.fromEntries(LEVELS.map((l) => [l, { answers: spec[l]?.[1] ?? 0, correct: spec[l]?.[0] ?? 0, withdrawn: 0 }]));
const student = (rollNo, workingLevel, answers, correct, name = `Student ${rollNo}`) => ({ rollNo, name, workingLevel, answers, correct });

// A class of six present: four working at Apply, two at Understand; one not answered; two below 40%.
const FIGURES = {
  students: [
    student('01', 'apply', 6, 2, 'Asha Rao'), student('02', 'apply', 5, 3, 'Bilal Khan'), student('03', 'apply', 7, 5),
    student('04', 'apply', 4, 1), student('05', 'understand', 3, 2), student('06', 'understand', 0, 0),
  ],
  present: 6,
  answered: 5,
  graded: 5,
  support: 2,
  banded: 5,
  supportRolls: ['01', '04'],
  silentRolls: ['06'],
};
const LEVELS_NOW = cells({ remember: [8, 9], understand: [5, 7], apply: [4, 10] });

describe('teaching moves: the basis is counts only', () => {
  test('per level, the working counts and the class\'s right of answered; the focus is where most students work', () => {
    const b = moveBasis({ figures: FIGURES, levels: LEVELS_NOW });
    assert.equal(b.focus.level, 'apply');
    assert.deepEqual([b.focus.working, b.focus.correct, b.focus.answers], [4, 4, 10]);
    assert.deepEqual([b.present, b.graded, b.notAnswered, b.support.count, b.support.banded], [6, 5, 1, 2, 5]);
    assert.equal(b.levels.length, 6);
    assert.equal(b.sentence, 'Based on 4 students working at Apply, 4 of 10 Apply answers right, 2 of 5 below 40% overall, '
      + '1 present student not answered yet.');
  });

  test('no name or roll number anywhere in the basis or the prompt built from it', () => {
    const b = moveBasis({ figures: FIGURES, levels: LEVELS_NOW });
    const prompt = buildMovePrompt({
      purpose: 'move', basis: b, chapter: 'Trees', topic: 'Traversals', material: { slides: [4, 5], text: 'Preorder visits the root first.' },
    });
    for (const s of FIGURES.students) {
      assert.ok(!JSON.stringify(b).includes(s.name), `basis names ${s.name}`);
      assert.ok(!prompt.includes(s.name), `prompt names ${s.name}`);
    }
    assert.ok(!/\b0[1-6]\b/.test(JSON.stringify(b.levels)), 'no roll number in the level counts');
    assert.match(prompt, /Never name, label, rank or judge any student/);
    assert.match(prompt, /two minutes and needs no phone/);
    assert.match(prompt, /slides: 4, 5/);
  });

  test('with no graded answers there is no focus, and the sentence says so', () => {
    const empty = { ...FIGURES, students: FIGURES.students.map((s) => ({ ...s, answers: 0, correct: 0 })), graded: 0, support: null, banded: 0 };
    const b = moveBasis({ figures: empty, levels: cells() });
    assert.equal(b.focus, null);
    assert.match(basisSentence(b), /no graded answers yet/);
    assert.match(basisSentence(b), /nobody with 3 graded answers yet/);
  });
});

describe('teaching moves: the topic and the professor\'s material', () => {
  const answers = [
    { topic: 'Traversals', bloom: 'apply', correct: false, final: true }, { topic: 'Traversals', bloom: 'apply', correct: false, final: true },
    { topic: 'Traversals', bloom: 'apply', correct: true, final: true }, { topic: 'Heaps', bloom: 'apply', correct: true, final: true },
    { topic: 'Heaps', bloom: 'apply', correct: false, final: true }, { topic: 'Heaps', bloom: 'remember', correct: false, final: true },
    { topic: 'Heaps', bloom: 'apply', correct: false, final: false }, { topic: 'Heaps', bloom: 'apply', ungraded: true, correct: null },
  ];
  test('the topic that went worst at the focus level, with at least two answers', () => {
    const c = chooseTopic({ topics: ['Heaps', 'Traversals'], answers, focus: 'apply' });
    assert.equal(c.topic, 'Traversals');
    assert.match(c.why, /1 of 3 right at Apply/);
  });
  test('a topic the professor names wins; one not in the chapter is a 400', () => {
    assert.equal(chooseTopic({ topics: ['Heaps', 'Traversals'], answers, focus: 'apply', wanted: 'heaps' }).topic, 'Heaps');
    assert.throws(() => chooseTopic({ topics: ['Heaps'], wanted: 'Graphs' }), (e) => e.status === 400);
  });
  test('no answers: the chapter\'s first topic; no topics: none', () => {
    assert.equal(chooseTopic({ topics: ['Heaps', 'Traversals'] }).topic, 'Heaps');
    assert.equal(chooseTopic({ topics: [] }).topic, '');
  });
  test('the topic\'s own slides and kept words, else the chapter\'s text', () => {
    const content = {
      title: 'Trees', rawText: 'Trees. Traversals: preorder, inorder and postorder visit nodes in different orders.',
      topicSlides: { Traversals: [5, 4, 4] }, slideTexts: [{ slide: 4, text: 'Preorder: root first.' }, { slide: 5, text: 'Postorder: root last.' }],
    };
    assert.deepEqual(materialFor(content, 'Traversals'), { slides: [4, 5], text: 'Preorder: root first. Postorder: root last.', from: 'slides' });
    const plain = materialFor({ ...content, slideTexts: null }, 'Traversals');
    assert.equal(plain.from, 'text');
    assert.deepEqual(plain.slides, [4, 5]);
    assert.match(plain.text, /preorder, inorder and postorder/);
  });
});

describe('teaching moves: the model\'s reply, held to the rules (fixtures through parseMove)', () => {
  const ctx = { kind: null, slides: [4, 5], topic: 'Traversals' };
  const reply = (o) => JSON.stringify({ activity: 'group', title: 'Benches trace it', text: 'Benches of four write the postorder sequence of the tree on slide 5.', slides: [5], ...o });

  test('a good reply: its kind, title, text and the slide it cites', () => {
    assert.deepEqual(parseMove(reply(), ctx), {
      activityKind: 'group', title: 'Benches trace it', body: 'Benches of four write the postorder sequence of the tree on slide 5.',
      sourceRef: { kind: 'slides', slides: [5], topic: 'Traversals' },
    });
  });
  test('fenced JSON, or wrapped as { suggestion }, reads the same', () => {
    assert.equal(parseMove(`\`\`\`json\n${reply()}\n\`\`\``, ctx).activityKind, 'group');
    assert.equal(parseMove(JSON.stringify({ suggestion: JSON.parse(reply()) }), ctx).activityKind, 'group');
  });
  test('slides outside those offered are dropped; citing none cites all offered; no slides offered cites the text', () => {
    assert.deepEqual(parseMove(reply({ slides: [5, 9, 'x'] }), ctx).sourceRef.slides, [5]);
    assert.deepEqual(parseMove(reply({ slides: [] }), ctx).sourceRef.slides, [4, 5]);
    assert.deepEqual(parseMove(reply({ slides: [5] }), { ...ctx, slides: [] }).sourceRef, { kind: 'text', topic: 'Traversals' });
  });
  test('a long title is cut at a word, never the text', () => {
    const t = parseMove(reply({ title: 'word '.repeat(40) }), ctx).title;
    assert.ok(t.length <= MAX_TITLE && t.endsWith('…'), t);
  });
  test('refused whole: not JSON, no text, an unknown kind, the wrong kind, too long', () => {
    assert.throws(() => parseMove('Here is an idea: ...', ctx), /not JSON/);
    assert.throws(() => parseMove(reply({ text: '  ' }), ctx), /no text/);
    assert.throws(() => parseMove(reply({ activity: 'quiz' }), ctx), /activity kind the room does not have/);
    assert.throws(() => parseMove(reply({ activity: 'think' }), { ...ctx, kind: 'real' }), /not the activity kind asked for/);
    assert.throws(() => parseMove(reply({ text: 'x'.repeat(MAX_MODEL_BODY + 1) }), ctx), /longer than/);
  });
  test('refused whole: a label or judgement of students, or contact details', () => {
    for (const text of ['Pair the weak students with the toppers.', 'Ask the slow learners to go first.',
      'Give the at-risk benches an easier tree.', 'Below-average students repeat slide 4.']) {
      assert.throws(() => parseMove(reply({ text }), ctx), /labelled or judged students/, text);
    }
    assert.throws(() => parseMove(reply({ text: 'Mail answers to prof@example.com.' }), ctx), /email address or a phone number/);
    // Ordinary words that only look close are fine.
    for (const text of ['Walk slowly through the tree on slide 4.', 'Which traversal is weakest at finding the root first?']) {
      assert.doesNotThrow(() => parseMove(reply({ text }), ctx), text);
    }
    assert.ok(!LABELLING.test('a failing test case'));
  });
  test('draftMove: the prompt goes to the model, the reply through the parser', async () => {
    let seen = '';
    const made = await draftMove({ purpose: 'prompt', kind: 'real', basis: moveBasis({ figures: FIGURES, levels: LEVELS_NOW }), chapter: 'Trees',
      topic: 'Traversals', material: { slides: [4], text: 'Folders on a phone are a tree.' }, earlier: ['Old: an earlier idea'] },
    { callModel: async (prompt) => { seen = prompt; return reply({ activity: 'real', slides: [4] }); } });
    assert.equal(made.activityKind, 'real');
    assert.match(seen, /"Real-world application" activity on this chapter/);
    assert.match(seen, /Do not repeat these earlier suggestions/);
    assert.match(seen, /Folders on a phone are a tree/);
  });
  test('the kind asked for must be one of the five', () => {
    assert.equal(moveKindFrom(undefined), null);
    assert.equal(moveKindFrom('diagram'), 'diagram');
    assert.throws(() => moveKindFrom('quiz'), (e) => e.status === 400);
  });
});

describe('teaching moves: in the background, kept with their basis', () => {
  after(() => useModelForTests(null));
  const input = (o = {}) => ({
    purpose: 'move', kind: null, basis: { ...moveBasis({ figures: FIGURES, levels: LEVELS_NOW }), topicWhy: 'x' }, chapter: 'Trees', topic: 'Traversals',
    material: { slides: [4, 5], text: 'Preorder visits the root first.' }, earlier: [], ...o,
  });
  const settled = (repo, requestId, owner, sessionId) => new Promise((resolve) => {
    const tick = () => {
      const r = moveRequest(requestId, { ownerKey: owner, sessionId });
      if (r && r.state !== 'running') resolve(r); else setTimeout(tick, 5);
    };
    tick();
  });

  test('no model: said plainly, nothing asked, nothing kept', async () => {
    useModelForTests(null);
    assert.equal(modelReady(), false);
    const repo = createMemoryRepo();
    const out = startMove(repo, { session: { _id: 'room-1' }, input: input(), ownerKey: 'prof' });
    assert.deepEqual(out, { state: 'offline', message: OFFLINE_MESSAGE });
    assert.equal((await repo.listTeachingMoves('room-1')).length, 0);
    assert.doesNotMatch(OFFLINE_MESSAGE, /\/api\/|POST|GET|kind|topic/);
  });

  test('a usable reply is kept, append-only, with the figures it was built from, and the request says done', async () => {
    useModelForTests(async () => JSON.stringify({ activity: 'think', title: 'Pairs', text: 'Pairs explain why preorder starts at the root.', slides: [4] }));
    const repo = createMemoryRepo();
    const events = [];
    const out = startMove(repo, { session: { _id: 'room-2' }, input: input(), ownerKey: 'prof', askedBy: null, notify: (e) => events.push(e) });
    assert.equal(out.state, 'running');
    const r = await settled(repo, out.requestId, 'prof', 'room-2');
    assert.equal(r.state, 'done');
    const kept = await repo.listTeachingMoves('room-2');
    assert.equal(kept.length, 1);
    assert.equal(kept[0].focusLevel, 'apply');
    assert.equal(kept[0].basis.support.count, 2);
    assert.deepEqual(kept[0].sourceRef, { kind: 'slides', slides: [4], topic: 'Traversals' });
    assert.equal(events[0].state, 'done');
    assert.equal(events[0].suggestion.label, AI_LABEL);
    // Not another owner's, nor another room's.
    assert.equal(moveRequest(out.requestId, { ownerKey: 'someone', sessionId: 'room-2' }), null);
    assert.equal(moveRequest(out.requestId, { ownerKey: 'prof', sessionId: 'room-3' }), null);
    const v = moveView(kept[0], { used: ['a1'] });
    assert.deepEqual([v.kind, v.kindLabel, v.focus.label, v.label, v.used], ['think', 'Think and explain', 'Apply', AI_LABEL, ['a1']]);
  });

  test('an unusable reply keeps nothing and says the model could not make one; never a made-up suggestion', async () => {
    useModelForTests(async () => JSON.stringify({ activity: 'think', text: 'Ask the weak students to explain.' }));
    const repo = createMemoryRepo();
    const out = startMove(repo, { session: { _id: 'room-4' }, input: input(), ownerKey: 'prof' });
    const r = await settled(repo, out.requestId, 'prof', 'room-4');
    assert.deepEqual([r.state, r.message], ['failed', FAILED_MESSAGE]);
    assert.equal((await repo.listTeachingMoves('room-4')).length, 0);
  });

  test('one request per room at a time', async () => {
    let release;
    useModelForTests(() => new Promise((resolve) => { release = () => resolve(JSON.stringify({ activity: 'check', text: 'Hands up for A or B.' })); }));
    const repo = createMemoryRepo();
    const first = startMove(repo, { session: { _id: 'room-5' }, input: input(), ownerKey: 'prof' });
    assert.throws(() => startMove(repo, { session: { _id: 'room-5' }, input: input(), ownerKey: 'prof' }), (e) => e.status === 409);
    await new Promise((r) => setTimeout(r, 5));
    release();
    assert.equal((await settled(repo, first.requestId, 'prof', 'room-5')).state, 'done');
  });
});

describe('the wheel: "Question + student" and a verbal question', () => {
  const Q = (id, kind = 'mcq') => ({ _id: id, text: `Question ${id}`, bloom: 'apply', kind });
  const bank = [Q('q3'), Q('q1'), Q('q2'), Q('poll1', 'poll')];
  const first = (n) => 0 * n;

  test('drawable: approved non-poll questions, in id order, so an index always names the same one', () => {
    assert.deepEqual(drawableQuestions(bank).map((q) => q._id), ['q1', 'q2', 'q3']);
  });
  test('a draw is uniform over the pool: questions asked in the room left out first', () => {
    const d = drawQuestion(bank, { askedInRoom: ['Q1'], rng: first });
    assert.deepEqual([d.question._id, d.poolSize, d.widened], ['q2', 2, false]);
  });
  test('once every one was asked, only this pick\'s draws are left out, and the reply says it widened', () => {
    const d = drawQuestion(bank, { askedInRoom: ['q1', 'q2', 'q3'], drawnForPick: ['q1'], rng: first });
    assert.deepEqual([d.question._id, d.poolSize, d.widened], ['q2', 2, true]);
  });
  test('nothing left: no question, and the reason in words', () => {
    const none = drawQuestion(bank, { drawnForPick: ['q1', 'q2', 'q3'] });
    assert.equal(none.question, null);
    assert.match(none.reason, /drawn for this pick already/);
    assert.match(drawQuestion([Q('p', 'poll')]).reason, /no approved question to draw/);
  });
  test('the random source is checked, as the student draw\'s is', () => {
    assert.throws(() => drawQuestion(bank, { rng: () => 7 }), /random source/);
  });
  test('a pick shows the draw that put its question there, until the question is changed by hand', () => {
    const draws = [{ pickId: 'p1', drawOrder: 1, questionId: 'q1', poolSize: 3 }, { pickId: 'p1', drawOrder: 2, questionId: 'q2', poolSize: 2 }];
    const pick = { _id: 'p1', round: 1, order: 1, rollNo: '01', ask: 'bank', questionId: 'q2', status: 'pending' };
    assert.deepEqual(pickView(pick, { draws }).questionDraw, { order: 2, poolSize: 2, drawnAt: null, draws: 2 });
    assert.equal(pickView({ ...pick, questionId: 'q3' }, { draws }).questionDraw, null);
    assert.equal(pickView(pick).questionDraw, null);
    const w = wheelState({ session: {}, picks: [pick], draws: [...draws].reverse(), people: [] });
    assert.equal(w.picks[0].questionDraw.order, 2);
  });
  test('a verbal question is a fourth ask, with no bank question', () => {
    assert.deepEqual(ASK_TYPES.find((a) => a.id === 'verbal').label, 'Verbal question');
    assert.deepEqual(askFrom({ ask: 'verbal' }, { current: { ask: 'bank', questionId: 'q1' } }), { ask: 'verbal', questionId: null });
    assert.throws(() => askFrom({ ask: 'verbal', questionId: 'q1' }, { current: {} }), (e) => e.status === 400 && /verbal question has none/.test(e.message));
  });
});

describe('the memory store: suggestions and draws are append-only, one draw per place', () => {
  test('kept in order, read per room; a second draw in the same place is a 409; both go with the room', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'ZGU001', contentId: 'c1', title: 'r' });
    const a = await repo.addTeachingMove({ sessionId: room._id, purpose: 'move', activityKind: 'think', body: 'one', model: 'm', basis: { n: 1 } });
    await repo.addTeachingMove({ sessionId: room._id, purpose: 'prompt', activityKind: 'real', body: 'two', model: 'm' });
    assert.deepEqual((await repo.listTeachingMoves(room._id)).map((m) => m.body), ['one', 'two']);
    assert.equal((await repo.getTeachingMove(a._id)).basis.n, 1);
    await repo.addWheelQuestionDraw({ sessionId: room._id, pickId: 'p1', drawOrder: 1, questionId: 'q1', poolSize: 3 });
    await assert.rejects(repo.addWheelQuestionDraw({ sessionId: room._id, pickId: 'p1', drawOrder: 1, questionId: 'q2', poolSize: 3 }),
      (e) => e.status === 409);
    await repo.deleteSession(room._id);
    assert.equal((await repo.listTeachingMoves(room._id)).length, 0);
    assert.equal((await repo.listWheelQuestionDraws(room._id)).length, 0);
  });
  test('an activity keeps the suggestion it came from', () => {
    assert.equal(activityView({ _id: 'x', kind: 'think', suggestionId: 's1' }).suggestionId, 's1');
    assert.equal(activityView({ _id: 'x', kind: 'think' }).suggestionId, null);
  });
});

describe('analytics: the latest room against the one before (A1)', () => {
  const lv = (spec) => LEVELS.map((level) => ({ level, label: level, answers: spec[level]?.[1] ?? 0, correct: spec[level]?.[0] ?? 0,
    accuracy: spec[level]?.[1] ? spec[level][0] / spec[level][1] : null }));
  const band = (a, c) => ({ id: 'lower', label: 'Lower', answers: a, correct: c, accuracy: a ? c / a : null });
  const room = (code, spec) => ({ code, title: code, startedAt: code, levels: lv(spec), levelBands: [band(0, 0), band(0, 0), band(0, 0)] });

  test('each level both rooms\' counts and the change in points; null where either has none', () => {
    const c = roomComparison([room('R0', {}), room('R1', { apply: [3, 10], remember: [5, 5] }), room('R2', { apply: [6, 10], analyse: [1, 2] })]);
    assert.deepEqual([c.previous.code, c.latest.code], ['R1', 'R2']);
    const apply = c.levels.find((l) => l.level === 'apply');
    assert.deepEqual([apply.previous.correct, apply.previous.answers, apply.latest.correct, apply.latest.answers, apply.change], [3, 10, 6, 10, 30]);
    assert.equal(c.levels.find((l) => l.level === 'remember').change, null);
    assert.equal(c.levels.find((l) => l.level === 'analyse').change, null);
    assert.match(c.sentence, /at the level both have answers at/);
  });
  test('fewer than two rooms: nothing to compare', () => {
    assert.equal(roomComparison([room('R1', {})]), null);
  });
});

describe('insights: per-level points and the support band against the previous room', () => {
  test('a point carries each level\'s accuracy and counts when the levels are given; otherwise it is as before', () => {
    const id = 'zip-series';
    forgetInsights(id);
    const f = { accuracy: 0.5, support: 1, participation: 1, answers: 4, graded: 2, banded: 2, present: 2 };
    noteSample(id, f, new Date(Date.UTC(2026, 10, 19, 4, 0)));
    noteSample(id, f, new Date(Date.UTC(2026, 10, 19, 4, 1)), { levels: cells({ apply: [1, 4] }) });
    const [plain, withLevels] = seriesOf(id).points;
    assert.equal('levels' in plain, false);
    assert.deepEqual(withLevels.levels.apply, { accuracy: 0.25, answers: 4, correct: 1 });
    assert.deepEqual(withLevels.levels.create, { accuracy: null, answers: 0, correct: 0 });
    assert.deepEqual(levelPoint(cells({ remember: [2, 2] })).remember, { accuracy: 1, answers: 2, correct: 2 });
    forgetInsights(id);
  });

  // A profile's counted tallies are its level tallies, as applyAnswer writes them beside the history.
  const profile = (rollNo, results) => ({
    rollNo, name: rollNo, workingLevel: 'apply',
    levels: { apply: { seen: results.length, correct: results.filter(Boolean).length } },
    history: results.map((correct, i) => ({ questionId: `${rollNo}-${i}`, bloom: 'apply', correct, at: '2026-11-18T09:00:00.000Z' })),
  });
  test('the same students, like for like: pooled right of answered there and here, and the change in points', () => {
    const out = supportAgainstPrevious({
      figures: FIGURES,
      previous: { code: 'PREV01', title: 'Last week', startedAt: '2026-11-12T09:00:00.000Z' },
      previousProfiles: [profile('01', [true, true, false, false]), profile('03', [true, true, true]), profile('09', [true])],
    });
    // 01 answered there (2 of 4); 04 did not answer there, so is not compared.
    assert.deepEqual([out.students, out.compared], [2, 1]);
    assert.deepEqual([out.then.correct, out.then.answers, out.now.correct, out.now.answers], [2, 4, 2, 6]);
    assert.equal(out.change, Math.round((2 / 6 - 0.5) * 1000) / 10);
    assert.equal(out.room.code, 'PREV01');
    assert.match(out.sentence, /1 of the 2 students below 40% now answered in the previous room \(PREV01\): 2 of 4 graded answers right there \(50%\), 2 of 6 here \(33%\)\./);
    assert.ok(!/Asha|Bilal/.test(JSON.stringify(out)), 'no name');
  });
  test('the first room, nobody below 40%, nobody counted yet', () => {
    assert.match(supportAgainstPrevious({ figures: FIGURES, previous: null }).sentence, /first room/);
    assert.match(supportAgainstPrevious({ figures: { ...FIGURES, supportRolls: [], support: 0 } }).sentence, /Nobody is below 40%/);
    assert.equal(supportAgainstPrevious({ figures: { ...FIGURES, support: null } }), null);
    assert.match(supportAgainstPrevious({ figures: FIGURES, previous: { code: 'P' }, previousProfiles: [] }).sentence, /None of the 2 students/);
  });
});

describe('a room\'s class on staff reads (L2)', () => {
  test('the course, section and term; a class that cannot be read is left out', async () => {
    assert.deepEqual(classLabel({ _id: 'c1', courseName: 'Data Structures', section: 'SY-CS A' }),
      { id: 'c1', courseName: 'Data Structures', section: 'SY-CS A', termLabel: '' });
    assert.equal(classLabel(null), null);
    const repo = { getClass: async (id) => (id === 'c1' ? { _id: 'c1', courseName: 'DS', section: 'A', termLabel: 'Sem III' } : null) };
    const m = await roomClasses(repo, [{ classId: 'c1' }, { classId: 'gone' }, { classId: null }, { classId: 'c1' }]);
    assert.deepEqual([...m.keys()], ['c1']);
  });
});

describe('the phone\'s service worker is never cached hard', () => {
  test('/sw.js: no-cache; a hashed asset: a year; the shell: no-store', async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'zipgaps-dist-'));
    fs.mkdirSync(path.join(dist, 'assets'));
    fs.writeFileSync(path.join(dist, 'index.html'), '<html><head></head><body></body></html>');
    fs.writeFileSync(path.join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    fs.writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1);');
    const before = config.clientDist;
    config.clientDist = dist;
    const { createApp } = await import('../src/app.js');
    const server = http.createServer(createApp());
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const sw = await fetch(`${base}/sw.js`);
      assert.equal(sw.status, 200);
      assert.equal(sw.headers.get('cache-control'), 'no-cache');
      assert.match(await sw.text(), /addEventListener/);
      assert.match((await fetch(`${base}/assets/app-abc123.js`)).headers.get('cache-control'), /immutable/);
      assert.match((await fetch(`${base}/join`)).headers.get('cache-control'), /no-store/);
    } finally {
      await new Promise((r) => server.close(r));
      config.clientDist = before;
      fs.rmSync(dist, { recursive: true, force: true });
    }
  });
});
