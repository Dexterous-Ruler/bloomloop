// Phase 3: the wheel's draw. Who is on the wheel (present only, no repeats,
// rounds), that every student on it has the same chance, and what a pick may
// carry to the projector.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, test } from 'node:test';

import { roomPeople } from '../src/services/records.js';
import {
  DEFAULT_SETTINGS,
  askFrom,
  currentRound,
  drawFrom,
  emptyWheelReason,
  pickForProjector,
  pickStatusFrom,
  settingsFrom,
  wheelPool,
  wheelState,
} from '../src/services/wheel.js';

const status400 = (fn, match) => assert.throws(fn, (err) => err.status === 400 && (!match || match.test(err.message)));

// A class of six as the repo returns it: two present, one late, one absent, one
// nobody marked, one removed; and a phone that joined with a roll number off it.
const classRoom = { _id: 'room', classId: 'c1', startedAt: '2026-11-19T04:00:00.000Z' };
const s = (_id, rollNo, name, removedAt = null) => ({ _id, classId: 'c1', rollNo, name, removedAt });
const roster = [
  s('a', '01', 'Asha Rao'), s('b', '02', 'Bilal Khan'), s('c', '03', 'Chitra'), s('d', '04', 'Dev'),
  s('e', '05', 'Esha'), s('f', '06', 'Farhan', '2026-11-18T00:00:00.000Z'),
];
const marks = [
  { classStudentId: 'a', status: 'present' }, { classStudentId: 'b', status: 'present' },
  { classStudentId: 'c', status: 'late' }, { classStudentId: 'd', status: 'absent' },
  { classStudentId: 'f', status: 'present' },
];
const profiles = [{ rollNo: '01', name: 'asha' }, { rollNo: 'GUEST9', name: 'Visitor' }, { rollNo: '06', name: 'Farhan' }];
const people = roomPeople({ session: classRoom, roster, marks, profiles });

describe('who is on the wheel', () => {
  test('a class room: the roster now, and phones off it; present means marked present or late', () => {
    assert.deepEqual(people.map((p) => [p.rollNo, p.present]), [
      ['01', true], ['02', true], ['03', true], ['04', false], ['05', false], ['06', false], ['GUEST9', false],
    ]);
    assert.equal(people.find((p) => p.rollNo === '01').name, 'Asha Rao', 'the roster name, not what the phone typed');
    assert.equal(people.find((p) => p.rollNo === '06').classStudentId, null, 'a removed student who joined is a phone off the roster');
    assert.equal(people.find((p) => p.rollNo === 'GUEST9').classStudentId, null);
  });

  test('a room with no class: the phones that joined, each present', () => {
    const plain = roomPeople({ session: { _id: 'r2', classId: null }, profiles: [{ rollNo: '2', name: 'B' }, { rollNo: '10', name: 'A' }] });
    assert.deepEqual(plain.map((p) => [p.rollNo, p.present, p.classStudentId]), [['2', true, null], ['10', true, null]]);
  });

  test('a class room with no phone joined still has its whole roster (Teacher-led)', () => {
    const led = roomPeople({ session: classRoom, roster, marks });
    assert.deepEqual(led.map((p) => p.rollNo), ['01', '02', '03', '04', '05']);
  });

  test('present only: the present students; off: everyone joined or on the roster', () => {
    assert.deepEqual(wheelPool(people, { presentOnly: true, noRepeat: true }).eligible.map((p) => p.rollNo), ['01', '02', '03']);
    assert.deepEqual(wheelPool(people, { presentOnly: false, noRepeat: true }).eligible.map((p) => p.rollNo),
      ['01', '02', '03', '04', '05', '06', 'GUEST9']);
  });

  test('no repeats leaves out whoever was picked this round, and says "N picked of M"', () => {
    const pool = wheelPool(people, { presentOnly: true, noRepeat: true, pickedThisRound: [{ rollNo: '02' }] });
    assert.deepEqual(pool.eligible.map((p) => p.rollNo), ['01', '03']);
    assert.deepEqual([pool.picked, pool.total, pool.left, pool.summary], [1, 3, 2, '1 picked of 3']);
    const repeats = wheelPool(people, { presentOnly: true, noRepeat: false, pickedThisRound: [{ rollNo: '02' }] });
    assert.deepEqual(repeats.eligible.map((p) => p.rollNo), ['01', '02', '03'], 'repeats allowed: everyone stays on');
    assert.equal(repeats.summary, '1 picked of 3');
  });

  test('someone picked and then marked absent leaves the round\'s total, and the count stays honest', () => {
    const later = roomPeople({ session: classRoom, roster, marks: marks.map((m) => (m.classStudentId === 'b' ? { ...m, status: 'absent' } : m)), profiles });
    const pool = wheelPool(later, { presentOnly: true, noRepeat: true, pickedThisRound: [{ rollNo: '02' }] });
    assert.equal(pool.summary, '0 picked of 2', 'never "1 picked of 2" for a student no longer on the wheel');
  });
});

describe('the draw', () => {
  const pool = wheelPool(people, { presentOnly: false, noRepeat: false }).eligible;

  test('every random number names exactly one student, and every student exactly one number', () => {
    // With a uniform source this is what fairness is: n equally likely outcomes,
    // one per student. Each index is fed in once.
    const drawn = pool.map((_, i) => drawFrom(pool, (n) => { assert.equal(n, pool.length); return i; }).rollNo);
    assert.deepEqual([...drawn].sort(), pool.map((p) => p.rollNo).sort());
    assert.equal(new Set(drawn).size, pool.length);
  });

  test('the default source is crypto.randomInt', () => {
    const real = crypto.randomInt;
    try {
      crypto.randomInt = (n) => n - 1;
      assert.equal(drawFrom(pool).rollNo, pool.at(-1).rollNo, 'with no source given, the draw asked crypto.randomInt');
    } finally {
      crypto.randomInt = real;
    }
  });

  test('over many real draws each student comes up about as often', () => {
    const counts = new Map(pool.map((p) => [p.rollNo, 0]));
    const N = 7000;
    for (let i = 0; i < N; i += 1) { const r = drawFrom(pool).rollNo; counts.set(r, counts.get(r) + 1); }
    // Expected 1000 each, standard deviation about 29: 700 to 1300 is over ten of them.
    for (const [roll, n] of counts) assert.ok(n > 700 && n < 1300, `${roll} came up ${n} times in ${N}`);
  });

  test('a source that gives a number outside the pool is an error, never a quiet wrong pick', () => {
    assert.throws(() => drawFrom(pool, () => pool.length), /random source/);
    assert.throws(() => drawFrom(pool, () => -1), /random source/);
    assert.throws(() => drawFrom(pool, () => 0.5), /random source/);
  });

  test('an empty wheel draws nobody', () => {
    assert.equal(drawFrom([], () => 0), null);
  });

  test('a round with no repeats gives everyone one turn, then the next round starts full again', () => {
    let rng = 0;
    const seq = () => (n) => { rng = (rng * 7 + 3) % 97; return rng % n; };
    const round1 = [];
    for (;;) {
      const p = wheelPool(people, { presentOnly: false, noRepeat: true, pickedThisRound: round1 });
      if (!p.left) {
        assert.match(emptyWheelReason({ session: classRoom, presentOnly: false, pool: p }), /had a turn this round/);
        break;
      }
      round1.push(drawFrom(p.eligible, seq()));
    }
    assert.equal(round1.length, people.length);
    assert.equal(new Set(round1.map((p) => p.rollNo)).size, people.length, 'nobody twice before everyone once');
    const round2 = wheelPool(people, { presentOnly: false, noRepeat: true, pickedThisRound: [] });
    assert.equal(round2.left, people.length, 'a new round has everyone back on the wheel');
  });

  test('present only with nobody marked present says so', () => {
    const nobody = roomPeople({ session: classRoom, roster, marks: [] });
    const p = wheelPool(nobody, { presentOnly: true, noRepeat: true });
    assert.equal(p.left, 0);
    assert.match(emptyWheelReason({ session: classRoom, presentOnly: true, pool: p }), /Nobody in this class is marked present/);
    assert.match(emptyWheelReason({ session: { classId: null }, presentOnly: true, pool: p }), /No phone has joined/);
  });
});

describe('rounds, asks and statuses', () => {
  test('before anything is drawn, round 1 with the handoff\'s defaults', () => {
    assert.deepEqual(DEFAULT_SETTINGS, { presentOnly: true, noRepeat: true });
    assert.deepEqual(currentRound([]), { round: 1, presentOnly: true, noRepeat: true, startedAt: null, startedBy: null, started: false });
    const r = currentRound([{ round: 1, presentOnly: true, noRepeat: true }, { round: 2, presentOnly: false, noRepeat: true }]);
    assert.deepEqual([r.round, r.presentOnly, r.started], [2, false, true]);
  });

  test('settings are true or false, and only what was sent', () => {
    assert.deepEqual(settingsFrom({ presentOnly: false }), { presentOnly: false });
    assert.deepEqual(settingsFrom({}), {});
    status400(() => settingsFrom({ noRepeat: 'yes' }), /noRepeat/);
    // Think time and the names toggle are the screen's own: not settings here.
    assert.deepEqual(settingsFrom({ thinkTime: true, showName: false }), {});
  });

  test('a bank ask may name one of the room\'s servable questions; a diagram or demo names none', () => {
    const servable = [{ _id: 'Q1' }, { _id: 'Q2' }];
    const pending = { ask: 'bank', questionId: null };
    assert.deepEqual(askFrom({ questionId: 'q2' }, { current: pending, servable }), { questionId: 'Q2' });
    status400(() => askFrom({ questionId: 'Q9' }, { current: pending, servable }), /not a question this room serves/);
    status400(() => askFrom({ ask: 'diagram', questionId: 'Q1' }, { current: pending, servable }), /Only a bank ask/);
    status400(() => askFrom({ ask: 'quiz' }, { current: pending, servable }), /ask must be/);
    assert.deepEqual(askFrom({ ask: 'demo' }, { current: { ask: 'bank', questionId: 'Q1' }, servable }), { ask: 'demo', questionId: null },
      'turning a bank ask into a demo drops its question');
    assert.deepEqual(askFrom({ questionId: null }, { current: { ask: 'bank', questionId: 'Q1' }, servable }), { questionId: null });
  });

  test('a response is one of the five; pending is only where a pick starts', () => {
    for (const ok of ['answered', 'passed', 'help', 'skipped', 'absent']) assert.equal(pickStatusFrom(ok), ok);
    status400(() => pickStatusFrom('pending'));
    status400(() => pickStatusFrom('Answered'));
  });
});

describe('what the projector may show of a pick', () => {
  test('the roll number and the first name, nothing else', () => {
    const pick = { rollNo: '21CS04', status: 'help', ask: 'bank', questionId: 'Q1', poolSize: 30 };
    const shown = pickForProjector(pick, 'Asha Rao');
    assert.deepEqual(shown, { rollNo: '21CS04', firstName: 'Asha' });
    assert.deepEqual(Object.keys(shown).sort(), ['firstName', 'rollNo']);
    assert.deepEqual(pickForProjector(pick, 'Asha Rao', { showName: false }), { rollNo: '21CS04', firstName: null });
    assert.deepEqual(pickForProjector(pick, ''), { rollNo: '21CS04', firstName: null });
  });
});

describe('the wheel as a teacher\'s screen gets it', () => {
  test('the round, who is on the wheel, "N picked of M", and every pick in order with its labels', () => {
    const rounds = [{ round: 1, presentOnly: true, noRepeat: true, startedAt: '2026-11-19T04:00:00.000Z' }];
    const picks = [
      { _id: 'p1', round: 1, order: 1, rollNo: '02', classStudentId: 'b', poolSize: 3, presentOnly: true, noRepeat: true,
        ask: 'bank', questionId: 'Q1', status: 'help', pickedAt: '2026-11-19T04:05:00.000Z' },
    ];
    const questions = new Map([['Q1', { _id: 'Q1', text: 'Define a binary tree.', bloom: 'remember', kind: 'open' }]]);
    const w = wheelState({ session: classRoom, rounds, picks, people, questions });
    assert.deepEqual(w.round, { number: 1, started: true, startedAt: '2026-11-19T04:00:00.000Z', presentOnly: true, noRepeat: true, picks: 1 });
    assert.deepEqual([w.pool.summary, w.pool.left, w.pool.empty], ['1 picked of 3', 2, null]);
    assert.deepEqual(w.pool.onWheel, [{ rollNo: '01', name: 'Asha Rao' }, { rollNo: '03', name: 'Chitra' }]);
    const [p] = w.picks;
    assert.deepEqual([p.name, p.askLabel, p.statusLabel, p.question.text, p.poolSize], ['Bilal Khan', 'Bank', 'Needs help', 'Define a binary tree.', 3]);
    assert.deepEqual(w.statuses.map((x) => x.label), ['Answered', 'Passed to partner', 'Needs help', 'Skipped', 'Absent']);
    // 'verbal', a question asked aloud on the spot, since Batch 8 (0034).
    assert.deepEqual(w.asks.map((x) => x.id), ['bank', 'diagram', 'demo', 'verbal']);
  });
});
