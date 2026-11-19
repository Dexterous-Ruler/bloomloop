// Phase 5: the confidence tap and the class question (pause, discuss, re-vote).
// The round rules, the class-level change counts worked out by hand, what a
// phone and the projector may be told before the key is revealed, the new
// attainment evidence type, and the proof that a confidence tap changes no
// mark, level or report. End to end, with eight phones over the socket, in
// scripts/classquestion.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  CLASS_KINDS, EARLY_DETAIL, LATE_DETAIL, MIN_VOTES_FOR_WALL, PAUSED_DETAIL, UNVERIFIED_DETAIL, answeredAloneOf,
  askedQuestionIds, changesView, classQuestionView, distribution, keyOf,
  optionsOf, phoneClosed, phoneQuestion, phoneVote, pickedOf, roundClosed, roundOf, roundView, startable, transition,
  votesInForce, votingRound, wallQuestion, withoutAsked,
} from '../src/services/classQuestions.js';
import {
  CONFIDENCE, confidenceCounts, confidenceFrom, confidenceOf, storedConfidence,
} from '../src/services/confidence.js';
import {
  chooseAnswers, classAttainment, evidenceTypeOf, marksRegister, studentAttainment, validateConfig,
} from '../src/services/attainment.js';
import { DEFAULT_PRESET, presetById } from '../src/services/attainmentPresets.js';
import { applyAnswer, emptyProfile } from '../src/services/mastery.js';
import { topicReport } from '../src/services/evidence.js';
import { itemAnalysis } from '../src/services/itemStats.js';
import { attainmentCsv, registerCsv } from '../src/services/exports.js';
import { attainmentHtml } from '../src/services/printable.js';
import { toProjector } from '../src/services/projector.js';

const status = (code, fn, match) => assert.throws(fn, (err) => err.status === code && (!match || match.test(err.message)));

/* ------------------------------------------------------------- fixtures -- */

// One mcq whose key is C (index 2).
const SNAP = { id: 'q-cq', text: 'Which layer routes packets?', kind: 'mcq', options: ['Link', 'Transport', 'Network', 'Physical'], answerIdx: 2, bloom: 'understand', topic: 'Layers', source: 'llm' };
const cqAt = (state, extra = {}) => ({
  _id: 'cq1', sessionId: 'room1', seq: 1, questionId: 'q-cq', questionSnapshot: SNAP, state, revealed: false,
  startedAt: '2026-11-19T09:00:00.000Z', pausedAt: null, revoteAt: null, closedAt: null, ...extra,
});
const CLOSED_AFTER_REVOTE = cqAt('closed', {
  pausedAt: '2026-11-19T09:02:00.000Z', revoteAt: '2026-11-19T09:05:00.000Z', closedAt: '2026-11-19T09:07:00.000Z',
});

let seq = 0;
/** A vote row as handleVote writes it: `pick` is the option index, `tap` the stored confidence. */
const vote = (rollNo, round, pick, { tap = null, final = true, detail = '', at } = {}) => {
  seq += 1;
  return {
    _id: `v${String(seq).padStart(3, '0')}`, sessionId: 'room1', rollNo, classQuestionId: 'cq1', round, questionId: 'q-cq',
    questionSnapshot: SNAP, kind: 'mcq', bloom: 'understand', topic: 'Layers', response: pick, final, correct: pick === 2,
    score: pick === 2 ? 1 : 0, ungraded: false, reviewStatus: 'auto', confidence: tap, detail,
    answeredAt: at ?? `2026-11-19T09:${String(round === 1 ? 1 : 6).padStart(2, '0')}:${String(seq).padStart(2, '0')}.000Z`,
  };
};

// The worked example (the same one scripts/classquestion.mjs plays over the socket).
// The key is C. Round 1: S1 taps D and changes to A; S5 sends a second vote after the
// pause (kept, not counted); S8 misses it. Round 2: S7 misses it; S8 votes.
//
//   student  round 1 (tap)        round 2      change
//   S1       A wrong (guess)      C right      wrong -> right
//   S2       C right (sure)       C right      right -> right
//   S3       B wrong (sure)       A wrong      wrong -> another wrong
//   S4       C right (think)      B wrong      right -> wrong
//   S5       A wrong (no tap)     A wrong      wrong -> the same wrong
//   S6       D wrong (guess)      C right      wrong -> right
//   S7       C right (sure)       -            round 1 only
//   S8       -                    C right      round 2 only
const R1 = [
  vote('S1', 1, 3, { tap: 'guess', final: false }), vote('S1', 1, 0, { tap: 'guess' }),
  vote('S2', 1, 2, { tap: 'sure' }), vote('S3', 1, 1, { tap: 'sure' }), vote('S4', 1, 2, { tap: 'think' }),
  vote('S5', 1, 0), vote('S6', 1, 3, { tap: 'guess' }), vote('S7', 1, 2, { tap: 'sure' }),
  vote('S5', 1, 2, { final: false, detail: LATE_DETAIL }),
];
const R2 = [
  vote('S1', 2, 2, { tap: 'sure' }), vote('S2', 2, 2, { tap: 'sure' }), vote('S3', 2, 0, { tap: 'think' }),
  vote('S4', 2, 1, { tap: 'think' }), vote('S5', 2, 0, { tap: 'guess' }), vote('S6', 2, 2, { tap: 'sure' }),
  vote('S8', 2, 2, { tap: 'think' }),
];
const ROWS = [...R1, ...R2];

/* ------------------------------------------------------------ the rounds -- */

describe('the rounds of a class question', () => {
  test('open takes round 1, revote takes round 2, paused and closed take none', () => {
    assert.deepEqual(['open', 'paused', 'revote', 'closed'].map(votingRound), [1, null, 2, null]);
    assert.equal(roundOf(cqAt('open')), 1);
    assert.equal(roundOf(cqAt('paused', { pausedAt: 'x' })), 1);
    assert.equal(roundOf(cqAt('revote', { revoteAt: 'x' })), 2);
    assert.equal(roundOf(cqAt('closed', { closedAt: 'x' })), 1, 'closed with no re-vote ended in round 1');
    assert.equal(roundOf(CLOSED_AFTER_REVOTE), 2);
    assert.deepEqual([roundClosed(cqAt('open'), 1), roundClosed(cqAt('paused'), 1), roundClosed(cqAt('revote', { revoteAt: 'x' }), 2),
      roundClosed(CLOSED_AFTER_REVOTE, 2)], [false, true, false, true]);
  });

  test('pause from round 1, re-vote from the pause, close from any round; everything else is an honest 409', () => {
    const at = '2026-11-19T10:00:00.000Z';
    assert.deepEqual(transition(cqAt('open'), 'pause', { at }), { state: 'paused', pausedAt: at });
    assert.deepEqual(transition(cqAt('paused'), 'revote', { at }), { state: 'revote', revoteAt: at });
    for (const from of ['open', 'paused', 'revote']) {
      assert.deepEqual(transition(cqAt(from), 'close', { at, by: 'p1', reveal: true }),
        { state: 'closed', closedAt: at, closedBy: 'p1', revealed: true });
    }
    assert.equal(transition(cqAt('open'), 'close', { at }).revealed, false, 'not revealed unless asked');
    status(409, () => transition(cqAt('paused'), 'pause'), /already paused/);
    status(409, () => transition(cqAt('revote'), 'pause'), /re-vote/);
    status(409, () => transition(cqAt('open'), 'revote'), /Pause the first vote/);
    status(409, () => transition(cqAt('revote'), 'revote'), /already open/);
    status(409, () => transition(cqAt('closed'), 'close'), /already closed/);
    status(409, () => transition(cqAt('closed'), 'revote'), /closed/);
    const poll = cqAt('open', { questionSnapshot: { ...SNAP, kind: 'poll', answerIdx: undefined } });
    status(400, () => transition(poll, 'close', { reveal: true }), /poll has no right answer/);
    assert.equal(transition(poll, 'close', { reveal: false }).state, 'closed');
  });
});

/* ------------------------------------------------------------ the counts -- */

describe('the counts, worked out by hand', () => {
  test('each student\'s vote in force is their latest counted one: a changed vote and a late one never count', () => {
    const r1 = votesInForce(ROWS, 1);
    assert.deepEqual([...r1.keys()].sort(), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
    assert.equal(r1.get('S1').response, 0, 'S1 changed D to A: A is in force');
    assert.equal(r1.get('S5').response, 0, 'S5\'s late C is kept, not counted');
    assert.deepEqual([...votesInForce(ROWS, 2).keys()].sort(), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S8']);
  });

  test('options, picks and keys for each kind a class question may be', () => {
    assert.deepEqual(CLASS_KINDS, ['mcq', 'truefalse', 'poll', 'multi']);
    assert.deepEqual(optionsOf(SNAP).map((o) => o.key), ['A', 'B', 'C', 'D']);
    assert.deepEqual(optionsOf({ kind: 'truefalse' }), [{ key: 'A', label: 'True' }, { key: 'B', label: 'False' }]);
    assert.deepEqual([pickedOf(SNAP, 2), pickedOf(SNAP, '1'), pickedOf(SNAP, 9), pickedOf(SNAP, 'x')], [[2], [1], [], []]);
    assert.deepEqual([pickedOf({ kind: 'truefalse' }, true), pickedOf({ kind: 'truefalse' }, false), pickedOf({ kind: 'truefalse' }, 'true')], [[0], [1], []]);
    const multi = { kind: 'multi', options: ['a', 'b', 'c', 'd'], answerIdxs: [3, 1] };
    assert.deepEqual(pickedOf(multi, [3, 1, 3, 7]), [1, 3], 'each once, in order, nothing off the list');
    assert.deepEqual([keyOf(SNAP), keyOf({ kind: 'truefalse', answerBool: false }), keyOf(multi), keyOf({ kind: 'poll', options: ['x'] })],
      [[2], [1], [1, 3], null]);
    const d = distribution(multi, [{ response: [1, 3] }, { response: [0] }, { response: [3] }, { response: 'junk' }]);
    assert.deepEqual(d.options.map((o) => o.votes), [1, 1, 0, 2], 'a multi vote counts on every option it ticked');
    assert.equal(d.unreadable, 1);
  });

  test('round 1, once closed: A 2, B 1, C 3, D 1; 3 of 7 right; the taps by right and wrong', () => {
    const open = roundView(cqAt('open'), R1, 1);
    assert.deepEqual([open.open, open.voted, open.distribution, open.right, open.confidence], [true, 7, null, null, null],
      'while round 1 is open the professor sees how many voted, not what');
    const r = roundView(cqAt('paused', { pausedAt: 'x' }), R1, 1);
    assert.equal(r.open, false);
    assert.deepEqual(r.distribution.options.map((o) => [o.key, o.votes]), [['A', 2], ['B', 1], ['C', 3], ['D', 1]]);
    assert.deepEqual(r.right, { students: 3, of: 7, share: 0.4285 }, '3/7 = 0.428571..., rounded down');
    assert.deepEqual([r.changedVotes, r.notCounted], [1, 1], 'S1 changed once; S5\'s late vote is kept, not counted');
    assert.deepEqual(r.confidence, {
      sure: { answers: 3, correct: 2, wrong: 1, ungraded: 0 }, // S2 and S7 right, S3 wrong: "1 sure and wrong"
      think_so: { answers: 1, correct: 1, wrong: 0, ungraded: 0 }, // S4
      guessing: { answers: 2, correct: 0, wrong: 2, ungraded: 0 }, // S1 and S6
      none: { answers: 1, correct: 0, wrong: 1, ungraded: 0 }, // S5
    });
  });

  test('round 2 and the changes: 2 wrong to right, 1 right to wrong, 1 right both times, 1 the same wrong, 1 another wrong', () => {
    const r2 = roundView(CLOSED_AFTER_REVOTE, ROWS, 2);
    assert.deepEqual(r2.distribution.options.map((o) => [o.key, o.votes]), [['A', 2], ['B', 1], ['C', 4], ['D', 0]]);
    assert.deepEqual(r2.right, { students: 4, of: 7, share: 0.5714 });
    assert.equal(roundView(cqAt('paused', { pausedAt: 'x' }), ROWS, 2), null, 'no round 2 before the re-vote opens');
    assert.equal(changesView(cqAt('revote', { revoteAt: 'x' }), ROWS), null, 'no changes while round 2 is open');
    assert.deepEqual(changesView(CLOSED_AFTER_REVOTE, ROWS), {
      both: 6, onlyBefore: 1, onlyAfter: 1,
      wrongToRight: 2, rightToWrong: 1, rightToRight: 1, wrongToSameWrong: 1, wrongToOtherWrong: 1,
    });
  });

  test('a poll has no right answer: its changes are kept and changed', () => {
    const poll = { ...SNAP, kind: 'poll', answerIdx: undefined };
    const cq = { ...CLOSED_AFTER_REVOTE, questionSnapshot: poll };
    const p = (roll, round, pick) => ({ ...vote(roll, round, pick), questionSnapshot: poll, kind: 'poll', ungraded: true, correct: null, score: null });
    const rows = [p('S1', 1, 0), p('S2', 1, 1), p('S3', 1, 1), p('S1', 2, 0), p('S2', 2, 0), p('S3', 2, 1)];
    assert.deepEqual(changesView(cq, rows), { both: 3, onlyBefore: 0, onlyAfter: 0, kept: 2, changed: 1 });
    assert.equal(roundView(cq, rows, 1).right, null);
    assert.deepEqual(roundView(cq, rows, 1).confidence.none, { answers: 3, correct: 0, wrong: 0, ungraded: 3 });
  });

  test('the staff view: the key, every round and the changes; counts only, no roll number anywhere', () => {
    const v = classQuestionView({ ...CLOSED_AFTER_REVOTE, revealed: true }, ROWS, { joined: 8, online: 7 });
    assert.deepEqual([v.state, v.round, v.voting, v.revealed, v.question.correct, v.phones],
      ['closed', 2, false, true, ['C'], { joined: 8, online: 7, answeredAlone: 0 }]);
    assert.ok(!('answeredAloneNote' in v), 'no sentence when no phone answered it alone first');
    assert.equal(v.rounds.length, 2);
    assert.equal(v.changes.wrongToRight, 2);
    assert.doesNotMatch(JSON.stringify(v), /"S[1-8]"|rollNo/, 'no student is named');
  });
});

/* -------------------------------------------------------------- key safety -- */

/** Every value under every key, flattened, to look for the key anywhere in a payload. */
const keyFree = (payload) => !/answerIdx|answerBool|answerIdxs|"correct":\["C"\]|"answer":2/.test(JSON.stringify(payload));

describe('nothing a phone or the projector is sent carries the key before it is revealed', () => {
  test('the phone\'s question, its vote back and the close without a reveal', () => {
    const q = phoneQuestion(cqAt('open'), { mine: { response: 1, confidence: 'sure' } });
    assert.ok(keyFree(q), JSON.stringify(q));
    assert.deepEqual([q.round, q.voting, q.options.length, q.mine.response], [1, true, 4, 1]);
    assert.deepEqual(q.confidence.map((c) => c.id), CONFIDENCE);
    const ack = phoneVote(cqAt('open'), vote('S1', 1, 2, { tap: 'sure' }), { counted: true });
    assert.deepEqual(Object.keys(ack).sort(), ['counted', 'id', 'message', 'mine', 'round']);
    assert.ok(keyFree(ack) && !('correct' in ack) && !('score' in ack), 'a vote back never says whether it was right');
    assert.match(phoneVote(cqAt('open'), vote('S1', 1, 3, { final: false }), { counted: false }).message, /your latest vote is the one that counts/,
      'a vote sent again after the phone replaced it');
    assert.match(phoneVote(cqAt('paused'), vote('S1', 1, 3, { final: false, detail: LATE_DETAIL }), { counted: false }).message, /Voting had closed/);
    const shut = phoneClosed(cqAt('closed'));
    assert.deepEqual([shut.revealed, shut.answer, shut.correct], [false, null, null]);
    const shown = phoneClosed({ ...cqAt('closed'), revealed: true });
    assert.deepEqual([shown.answer, shown.correct], [2, ['C']], 'once revealed, the key in a response\'s own terms and as letters');
  });

  test('the phone\'s question is named by the class question, never by the bank question behind it', () => {
    const q = phoneQuestion(cqAt('open'));
    assert.equal(q.question._id, 'cq1');
    assert.doesNotMatch(JSON.stringify(q), /q-cq/, 'the bank id is nowhere in it');
  });

  test('a vote kept and not counted says why, and each reason is its own', () => {
    const said = (detail) => phoneVote(cqAt('open'), vote('S1', 2, 2, { final: false, detail }), { counted: false }).message;
    assert.match(said(EARLY_DETAIL), /had not opened/);
    assert.doesNotMatch(said(EARLY_DETAIL), /had closed/);
    assert.match(said(PAUSED_DETAIL), /paused the room/);
    assert.match(said(UNVERIFIED_DETAIL), /not signed in/);
    assert.match(said(LATE_DETAIL), /Voting had closed/);
    // Each is a reason a count reads as "kept, not counted", never as a changed vote.
    const rows = [vote('S1', 1, 2), ...[EARLY_DETAIL, PAUSED_DETAIL, UNVERIFIED_DETAIL].map((detail) => vote('S1', 1, 0, { final: false, detail }))];
    assert.deepEqual([roundView(cqAt('open'), rows, 1).notCounted, roundView(cqAt('open'), rows, 1).changedVotes], [3, 0]);
  });

  test('how many phones answered the question on their own first: their own final answers, counted once each', () => {
    const own = (rollNo, extra = {}) => ({ rollNo, questionId: 'Q-CQ', final: true, classQuestionId: null, ...extra });
    const rows = [own('S1'), own('S1'), own('S2'), own('S3', { final: false }), own('S4', { classQuestionId: 'cq1' }), own('S5', { questionId: 'other' })];
    assert.equal(answeredAloneOf(cqAt('open'), rows), 2, 'S1 once and S2; never a retried attempt, a vote or another question');
    assert.equal(answeredAloneOf(cqAt('open', { questionSnapshot: { ...SNAP, kind: 'poll' } }), rows), 0, 'a poll has no key to have seen');
    assert.match(classQuestionView(cqAt('open'), [], { answeredAlone: 2 }).answeredAloneNote, /^2 phones in this room answered this question/);
  });

  test('the wall: a count of votes; counts per option only when chosen, once 5 voted; the key, share right and changes only once revealed', () => {
    const wallOf = (cq, opts) => toProjector('projector:state', { question: wallQuestion(cq, ROWS, opts) }).question;
    const open = wallOf(cqAt('open'), { showCounts: true });
    assert.deepEqual([open.voted, open.counts.before, open.correct, open.revealed], [7, null, null, false]);
    assert.equal(wallOf(cqAt('paused', { pausedAt: 'x' }), { showCounts: false }).counts, null, 'counts only when the professor chooses');
    const paused = wallOf(cqAt('paused', { pausedAt: 'x' }), { showCounts: true });
    assert.deepEqual(paused.counts.before.options, [{ key: 'A', votes: 2 }, { key: 'B', votes: 1 }, { key: 'C', votes: 3 }, { key: 'D', votes: 1 }]);
    assert.equal(paused.counts.before.correct, null, 'the share right would tell the key');
    assert.deepEqual(paused.counts.before.confidence, { sure: 3, think_so: 1, guessing: 2, none: 1 }, 'taps alone, never with right and wrong');
    const closed = wallOf(CLOSED_AFTER_REVOTE, { showCounts: true });
    assert.deepEqual([closed.counts.after.voted, closed.counts.changes, closed.correct], [7, null, null], 'no changes or key before the reveal');
    for (const w of [open, paused, closed]) assert.ok(keyFree(w), JSON.stringify(w));
    const revealed = wallOf({ ...CLOSED_AFTER_REVOTE, revealed: true }, { showCounts: true });
    assert.deepEqual(revealed.correct, ['C']);
    assert.deepEqual(revealed.counts.after.correct, { students: 4, share: 0.5714 });
    assert.equal(revealed.counts.changes.wrongToRight, 2);
    const few = wallQuestion(CLOSED_AFTER_REVOTE, ROWS.filter((r) => ['S1', 'S2'].includes(r.rollNo)), { showCounts: true });
    assert.deepEqual([few.counts.before, few.counts.after, few.counts.minVotes], [null, null, MIN_VOTES_FOR_WALL],
      'under five votes a round\'s counts could be a few students\' own');
  });
});

/* -------------------------------------------------------- starting one -- */

describe('what may be asked to the class', () => {
  const room = { status: 'open' };
  const devices = { mode: 'devices' };
  const q = (id, kind = 'mcq') => ({ _id: id, kind });
  const servable = [q('a'), q('b', 'truefalse'), q('c', 'poll'), q('d', 'multi'), q('e', 'match')];
  test('an approved question of the room, with options to vote on, in an open room where phones answer, one at a time', () => {
    assert.equal(startable({ room, settings: devices, question: { _id: 'A' }, servable }).kind, 'mcq', 'ids in any case');
    for (const id of ['b', 'c', 'd']) assert.ok(startable({ room, settings: { mode: 'mixed' }, question: { _id: id }, servable }));
    status(400, () => startable({ room, settings: devices, question: { _id: 'e' }, servable }), /"Match the pairs"/);
    status(400, () => startable({ room, settings: devices, question: { _id: 'z' }, servable }), /not one this room may serve/);
    status(409, () => startable({ room, settings: { mode: 'teacher-led' }, question: { _id: 'a' }, servable }), /Teacher-led/);
    for (const s of ['closed', 'waiting', 'paused']) status(409, () => startable({ room: { status: s }, settings: devices, question: { _id: 'a' }, servable }));
    status(409, () => startable({ room, settings: devices, question: { _id: 'a' }, servable, asked: [{ state: 'paused', questionId: 'b' }] }), /still running/);
    status(409, () => startable({ room, settings: devices, question: { _id: 'a' }, servable, asked: [{ state: 'closed', questionId: 'A' }] }), /already been asked/);
  });

  test('once asked to the class, a question leaves the room\'s bank for good', () => {
    const asked = [{ questionId: 'B' }, { questionSnapshot: { id: 'd' } }];
    assert.deepEqual([...askedQuestionIds(asked)].sort(), ['b', 'd']);
    assert.deepEqual(withoutAsked(servable, asked).map((x) => x._id), ['a', 'c', 'e']);
    assert.equal(withoutAsked(servable, []), servable);
  });
});

/* ------------------------------------------------------------ attainment -- */

describe('attainment: round 1 is a digital answer; the re-vote after discussion is its own type, shown, never counted', () => {
  const CLS = { _id: '3f2a9c1e-1111-4000-8000-000000000000', courseName: 'Networks', section: 'A', termLabel: '' };
  const ROOM = { _id: 'room1', code: 'ROOMCQ', title: 'Week 3', status: 'closed', startedAt: '2026-11-19T08:30:00.000Z', contentId: 'c1' };
  const ROSTER = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'].map((r, i) => ({ _id: `s${i}`, rollNo: r, name: `Student ${i + 1}`, removedAt: null }));
  const formula = (over = {}) => ({
    source: 'example', version: 0, savedAt: null, preset: { id: DEFAULT_PRESET, name: 'x' },
    config: validateConfig({ ...presetById(DEFAULT_PRESET).config, ...over }),
  });
  const inputs = (rows, f = formula()) => ({
    cls: CLS, rooms: [ROOM], formula: f, answers: rows.map((r) => ({ ...r, contentId: 'c1' })), roster: ROSTER,
    outcomes: [{ _id: 'co1', code: 'CO1', statement: 'Layers', position: 1 }],
    links: [{ outcomeId: 'co1', contentId: 'c1', topic: 'Layers', weight: 1 }], overrides: [], questions: [], chapters: new Map(),
  });

  test('the type of each row', () => {
    assert.equal(evidenceTypeOf(R1[1]), 'digital');
    assert.equal(evidenceTypeOf(R2[0]), 'revote');
    assert.equal(evidenceTypeOf({ ...R2[0], ungraded: true }), 'ungraded', 'a poll stays a poll, counted as a number');
    assert.equal(evidenceTypeOf({ round: 2 }), 'digital', 'a round needs its class question');
  });

  test('which rows count: round 1 in force; changed and late votes set aside; re-votes apart, never displacing round 1', () => {
    for (const attempts of ['final', 'best']) {
      const { chosen } = chooseAnswers(ROWS, formula({ attempts }).config);
      const r1 = chosen.filter((a) => a.round === 1);
      assert.deepEqual(r1.map((a) => a.rollNo).sort(), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'], attempts);
      assert.ok(r1.every((a) => a.final !== false), `${attempts}: never a changed or late vote`);
      assert.equal(chosen.filter((a) => evidenceTypeOf(a) === 'revote').length, 7, `${attempts}: each re-vote kept, apart`);
    }
  });

  test('the report: 3 of 7 round 1 marks counted on CO1; the 7 re-votes shown under their own label, not counted', () => {
    const r = classAttainment(inputs(ROWS));
    assert.equal(r.answers.byType.digital, 7);
    assert.equal(r.answers.byType.revote, 7);
    const co1 = r.outcomes[0];
    const marks = co1.marks;
    assert.deepEqual([marks.revote.counted, marks.digital.counted], [false, true]);
    const s4 = r.students.find((s) => s.rollNo === 'S4').outcomes[0];
    assert.deepEqual([s4.answers, s4.obtained, s4.marks.revote.answers, s4.marks.revote.obtained], [1, 1, 1, 0],
      'S4 right in round 1 and wrong in round 2: the round 1 mark counts, the re-vote is shown beside it');
    assert.match(r.methodology, /its re-vote after the class discussed it is shown under its own label and never counted/);
    assert.match(r.methodology, /How sure a student said they were never changes a mark/);
    assert.ok(r.evidenceTypes.some((t) => t.id === 'revote' && /never counted/.test(t.description)));
    const one = studentAttainment({ ...inputs(ROWS), student: ROSTER[0] });
    const notes = one.answers.map((a) => [a.classQuestion?.round ?? null, a.counts, a.note]);
    assert.ok(notes.some(([round, counts, note]) => round === 2 && counts === false && /re-vote after the class discussed/.test(note)));
    assert.ok(notes.some(([round, counts, note]) => round === 1 && counts === false && /changed afterwards/.test(note)), 'S1\'s changed vote');
  });

  test('a vote from a student who answered the question on their own in the same room first is set aside: their own answer counts', () => {
    // S1 answered q-cq on their own, wrong, and was shown its key; then voted C in round 1.
    const own = {
      ...vote('S1', 1, 0), _id: 'own1', classQuestionId: null, round: null, answeredAt: '2026-11-19T08:50:00.000Z', confidence: null,
    };
    const rightVote = vote('S1', 1, 2);
    const elsewhere = { ...vote('S2', 1, 2), _id: 'own2', classQuestionId: null, round: null, sessionId: 'room2', answeredAt: '2026-11-19T08:40:00.000Z' };
    const s2Vote = vote('S2', 1, 0);
    const rows = [own, rightVote, elsewhere, s2Vote];
    for (const attempts of ['final', 'best']) {
      const { chosen, knewKey } = chooseAnswers(rows, formula({ attempts }).config, { perRoom: true });
      const s1 = chosen.filter((a) => a.rollNo === 'S1');
      assert.deepEqual(s1.map((a) => a._id), ['own1'], `${attempts}: the own answer, not the later vote`);
      assert.deepEqual([...knewKey], [rightVote._id], `${attempts}: the vote is set aside, and said why`);
      assert.ok(chosen.some((a) => a._id === s2Vote._id), `${attempts}: an own answer in another room does not set a vote aside`);
    }
    const one = studentAttainment({ ...inputs(rows), student: ROSTER[0] });
    const noted = one.answers.find((a) => a.classQuestion?.round === 1);
    assert.equal(noted.counts, false);
    assert.match(noted.note, /had already answered this question on their own in this room, and was shown its answer then/);
    assert.equal(one.answers.find((a) => !a.classQuestion).counts, true, 'their own answer counts');
    assert.match(classAttainment(inputs(ROWS)).methodology, /except from a student who had already answered that question on their own/);
  });

  test('no formula may count a re-vote', () => {
    status(400, () => validateConfig({ ...presetById(DEFAULT_PRESET).config, evidence: { digital: true, aiProvisional: false, humanReviewed: true, revote: true } }),
      /re-vote after a class discussion is never counted/);
  });

  test('the CSV and the printable page carry the new type, marked not counted', () => {
    const r = classAttainment(inputs(ROWS));
    const csv = attainmentCsv(r, { now: new Date('2026-11-19T10:00:00Z') });
    assert.match(csv, /Re-votes after discussion behind the share \(not counted\)/);
    assert.match(csv, /7 re-votes after discussion, never counted/);
    assert.match(registerCsv(marksRegister(inputs(ROWS)), { now: new Date('2026-11-19T10:00:00Z') }), /Total re-votes after discussion \(not counted\)/);
    const page = attainmentHtml(r, { now: new Date('2026-11-19T10:00:00Z') });
    assert.ok(page.includes('<td>Re-votes after discussion</td>') && page.includes('Never counted: shown only'));
  });
});

/* ------------------------------------------------------------ confidence -- */

describe('the confidence tap is information only', () => {
  test('three taps, optional; stored in 0008\'s own spellings and read back as the tap', () => {
    assert.deepEqual(CONFIDENCE, ['sure', 'think_so', 'guessing']);
    assert.deepEqual(['sure', 'think_so', 'guessing', 'think', 'SURE', '', null, undefined, 3].map(confidenceFrom),
      ['sure', 'think_so', 'guessing', null, null, null, null, null, null]);
    assert.deepEqual(CONFIDENCE.map(storedConfidence), ['sure', 'think', 'guess']);
    assert.deepEqual(['sure', 'think', 'guess', null, 'x'].map((c) => confidenceOf({ confidence: c })), ['sure', 'think_so', 'guessing', null, null]);
  });

  test('counts by tap and by right and wrong', () => {
    const rows = [
      { confidence: 'sure', correct: false }, { confidence: 'sure', correct: false }, { confidence: 'sure', correct: true },
      { confidence: 'guess', correct: true }, { confidence: null, correct: false }, { confidence: 'think', ungraded: true, correct: null },
    ];
    assert.deepEqual(confidenceCounts(rows), {
      sure: { answers: 3, correct: 1, wrong: 2, ungraded: 0 },
      think_so: { answers: 1, correct: 0, wrong: 0, ungraded: 1 },
      guessing: { answers: 1, correct: 1, wrong: 0, ungraded: 0 },
      none: { answers: 1, correct: 0, wrong: 1, ungraded: 0 },
    });
  });

  // The proof the task asks for: the same answers, with and without taps, give
  // identical levels and identical reports.
  test('the same answers with and without confidence give identical levels and reports', () => {
    const answers = [
      ['q1', 'understand', true], ['q2', 'understand', true], ['q3', 'understand', false], ['q4', 'apply', true],
      ['q5', 'apply', false], ['q6', 'apply', true], ['q7', 'apply', true], ['q8', 'analyse', false],
    ];
    const taps = ['sure', 'guess', 'think', 'sure', 'guess', null, 'sure', 'think'];
    const rows = (withTaps) => answers.map(([q, bloom, correct], i) => ({
      _id: `a${i}`, sessionId: 'room1', rollNo: 'S1', questionId: q, questionSnapshot: { id: q, text: q, kind: 'mcq', options: ['a', 'b'], answerIdx: 0 },
      kind: 'mcq', bloom, topic: 'Layers', response: correct ? 0 : 1, final: true, correct, score: correct ? 1 : 0, ungraded: false,
      reviewStatus: 'auto', answeredAt: `2026-11-19T09:00:0${i}.000Z`, confidence: withTaps ? taps[i] : null, contentId: 'c1',
    }));
    const ladder = (list) => list.reduce((p, a) => applyAnswer(p, { questionId: a.questionId, bloom: a.bloom, correct: a.correct, score: a.score, at: a.answeredAt, answerId: a._id }).profile,
      emptyProfile({ sessionId: 'room1', rollNo: 'S1' }));
    const strip = (p) => ({ levels: p.levels, workingLevel: p.workingLevel, reason: p.reason, history: p.history });
    assert.deepEqual(strip(ladder(rows(true))), strip(ladder(rows(false))), 'the ladder: the same levels, working level and history');
    assert.deepEqual(topicReport({ answers: rows(true) }), topicReport({ answers: rows(false) }), 'topics');
    assert.deepEqual(itemAnalysis({ answers: rows(true) }), itemAnalysis({ answers: rows(false) }), 'item statistics');
    const att = (withTaps) => {
      const r = classAttainment({
        cls: { _id: 'c', courseName: 'N', section: 'A' }, rooms: [{ _id: 'room1', code: 'R', startedAt: '2026-11-19T08:00:00Z' }],
        formula: { source: 'example', version: 0, preset: { id: DEFAULT_PRESET, name: 'x' }, config: validateConfig(presetById(DEFAULT_PRESET).config) },
        answers: rows(withTaps), roster: [{ _id: 's1', rollNo: 'S1', name: 'A', removedAt: null }],
        outcomes: [{ _id: 'co1', code: 'CO1', statement: 'x', position: 1 }], links: [{ outcomeId: 'co1', contentId: 'c1', topic: 'Layers', weight: 1 }],
      });
      return r;
    };
    assert.deepEqual(att(true), att(false), 'the attainment report, every figure');
  });
});
