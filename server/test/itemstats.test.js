// Phase 2 - item statistics and a question set per room, tested without a server.
//
// Pinned here: the statistics against values worked by hand (the point-biserial
// by the textbook formula, proportions, mean scores, counts per option); the
// shuffle mapping that puts each student's pick back on the option it really was
// (toOriginalResponse in questionTypes.js); the band's cut points and the floors;
// and the set: what a room may serve (services/selector.js), which images a phone
// may load (services/media.js), the archive, and that all three repos keep it.
// The end-to-end half, over HTTP and the socket, is server/scripts/items.mjs.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { forStudent, score, shownOptionIndices, toOriginalResponse } from '../src/questionTypes.js';
import { FEWER_CHOICES } from '../src/accommodations.js';
import {
  pearson, pointBiserial, difficultyBand, itemAnalysis, gradedAnswers, roomItemStats, contentItemStats,
  THRESHOLDS, EASY_AT, HARD_BELOW, MIN_STUDENTS_FOR_PB, MIN_ANSWERS_FOR_BAND,
} from '../src/services/itemStats.js';
import { DEFAULT_MASTERY_GOAL, DEMOTE_AT, WINDOW, emptyProfile, hydrate } from '../src/services/mastery.js';
import { roomQuestionIds, inRoomSet, servableFor, selectNext } from '../src/services/selector.js';
import { servedToPhones, mediaUrl } from '../src/services/media.js';
import { buildRoomArchive } from '../src/services/archive.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

const close = (actual, expected, tol = 5e-4) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tol, `${actual} is not within ${tol} of ${expected}`);

/* ---------------------------------------------------------- the questions -- */

const QA = { _id: 'qa', kind: 'mcq', bloom: 'remember', topic: 'Transport', text: 'Which layer carries segments?', options: ['Network', 'Transport', 'Link', 'Physical'], answerIdx: 1 };
// Keyed to option 0, but the right answer is option 2: the wrong key the statistics should catch.
const QB = { _id: 'qb', kind: 'mcq', bloom: 'remember', topic: 'Transport', text: 'Which protocol is connectionless?', options: ['TCP', 'SCTP', 'UDP', 'QUIC'], answerIdx: 0 };
const QC = {
  _id: 'qc', kind: 'match', bloom: 'understand', topic: 'Transport', text: 'Match each protocol to what it gives.',
  pairs: [{ left: 'TCP', right: 'A reliable byte stream' }, { left: 'UDP', right: 'Single datagrams' }, { left: 'IP', right: 'Routing between networks' }],
};
const QD = { _id: 'qd', kind: 'truefalse', bloom: 'remember', topic: 'Transport', text: 'Port numbers identify processes.', answerBool: true };

/** A fixture question without its id, for a store to give it one. */
const strip = ({ _id, ...q }) => q;

const STUDENTS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'];

/** What each student did, in the question's own terms (original indices). */
const PLAN = {
  // S1-S6 right; S7 and S10 pick option 0, S8 option 2, S9 option 3.
  qa: { S1: 1, S2: 1, S3: 1, S4: 1, S5: 1, S6: 1, S7: 0, S8: 2, S9: 3, S10: 0 },
  // The five strongest pick the true answer (2) and are marked wrong; the rest pick the key (0).
  qb: { S1: 2, S2: 2, S3: 2, S4: 2, S5: 2, S6: 0, S7: 0, S8: 0, S9: 0, S10: 0 },
  // Per left item, the right item chosen: all three pairs, one of three, none.
  qc: {
    S1: [0, 1, 2], S2: [0, 1, 2], S3: [0, 1, 2], S4: [0, 1, 2],
    S5: [0, 2, 1], S6: [0, 2, 1], S7: [0, 2, 1],
    S8: [1, 2, 0], S9: [1, 2, 0], S10: [1, 2, 0],
  },
  qd: { S1: true, S2: true, S3: true, S4: true, S5: true, S6: true, S7: true, S8: false, S9: false, S10: false },
};

/** The response a phone sends for that choice: a SHOWN position wherever forStudent shuffles. */
function respond(q, rollNo, choice) {
  if (q.kind !== 'match') return choice;
  const shown = forStudent(q, `${rollNo}:${q._id}`).right;
  return choice.map((orig) => shown.indexOf(q.pairs[orig].right));
}

let clock = Date.parse('2026-11-19T09:00:00.000Z');
/** One stored answer row, marked by the real marker, as handleAnswer writes it. */
function row(q, rollNo, response, over = {}) {
  const { _id, ...rest } = q;
  const graded = score(q, response, `${rollNo}:${_id}`);
  clock += 1000;
  return {
    _id: `a${clock}`, sessionId: 'R1', rollNo, questionId: _id, kind: q.kind, bloom: q.bloom, topic: q.topic,
    questionSnapshot: { id: _id, ...rest }, response, correct: graded.correct, score: graded.score,
    final: true, ungraded: false, answeredAt: new Date(clock).toISOString(), ...over,
  };
}

function roomAnswers() {
  const rows = [];
  for (const q of [QA, QB, QC, QD]) {
    for (const s of STUDENTS) rows.push(row(q, s, respond(q, s, PLAN[q._id][s])));
  }
  return rows;
}

/* ----------------------------------------------------------- the maths -- */

describe('the arithmetic', () => {
  test('Pearson\'s r: perfect, inverse, and null when a list has no spread', () => {
    close(pearson([1, 2, 3], [2, 4, 6]), 1, 1e-12);
    close(pearson([1, 2, 3], [6, 4, 2]), -1, 1e-12);
    assert.equal(pearson([1, 1, 1], [1, 2, 3]), null);
    // The mean of three 0.1s is not exactly 0.1 in floating point: still no spread.
    assert.equal(pearson([1, 0, 1], [0.1, 0.1, 0.1]), null);
    assert.equal(pearson([], []), null);
  });

  // Worked by hand: right = 1 1 1 1 1 0 0 0 0 0, rest = 0.9 ... 0.1 with 0.5 twice.
  // M1 = 0.7, M0 = 0.3, population sd = sqrt(0.06), p = q = 0.5:
  // r = (0.7 - 0.3) / sqrt(0.06) * 0.5 = 0.2 / 0.244949 = 0.816497 (= sqrt(2/3)).
  test('the point-biserial is the textbook (M1 - M0) / s * sqrt(pq)', () => {
    const rest = [0.9, 0.8, 0.7, 0.6, 0.5, 0.5, 0.4, 0.3, 0.2, 0.1];
    const right = rest.map((_, i) => ({ item: i < 5 ? 1 : 0, rest: rest[i] }));
    const out = pointBiserial(right);
    close(out.r, Math.sqrt(2 / 3), 1e-9);
    assert.equal(out.n, 10);
    assert.equal(out.note, null);
    // The same students with the key reversed: the sign of a wrong key.
    close(pointBiserial(right.map((p) => ({ ...p, item: 1 - p.item }))).r, -Math.sqrt(2 / 3), 1e-9);
  });

  test('null, with the reason, below the floor or with nothing to compare', () => {
    assert.equal(MIN_STUDENTS_FOR_PB, 10);
    const nine = Array.from({ length: 9 }, (_, i) => ({ item: i % 2, rest: i / 10 }));
    assert.deepEqual(pointBiserial(nine), { r: null, n: 9, note: 'Fewer than 10 students who also answered other questions.' });
    const allRight = Array.from({ length: 12 }, (_, i) => ({ item: 1, rest: i / 12 }));
    assert.match(pointBiserial(allRight).note, /same mark on it/);
    const flat = Array.from({ length: 12 }, (_, i) => ({ item: i % 2, rest: 0.5 }));
    assert.match(pointBiserial(flat).note, /other answers came to the same mark/);
  });

  test('the band: easy at 0.8 and above, hard below 0.4, none under five answers', () => {
    assert.equal(EASY_AT, DEFAULT_MASTERY_GOAL);
    assert.equal(HARD_BELOW, DEMOTE_AT);
    assert.equal(MIN_ANSWERS_FOR_BAND, WINDOW);
    assert.deepEqual(THRESHOLDS, { easyAt: 0.8, hardBelow: 0.4, minAnswersForBand: 5, minStudentsForPointBiserial: 10 });
    assert.equal(difficultyBand(0.8, 5), 'easy');
    assert.equal(difficultyBand(4 / 5, 5), 'easy');
    assert.equal(difficultyBand(0.79, 30), 'medium');
    assert.equal(difficultyBand(0.4, 30), 'medium');
    assert.equal(difficultyBand(0.39, 30), 'hard');
    assert.equal(difficultyBand(0, 5), 'hard');
    assert.equal(difficultyBand(1, 4), null, 'four answers');
    assert.equal(difficultyBand(null, 0), null);
  });
});

/* ------------------------------------------------- the shuffle mapping -- */

describe('each pick back on the option it really was (toOriginalResponse)', () => {
  const seeds = STUDENTS.map((s) => `${s}:qc`);

  test('match: a student pairing by the text on their screen is read back in the question\'s own order', () => {
    let shuffled = 0;
    for (const seed of seeds) {
      const shown = forStudent(QC, seed).right;
      if (shown.some((t, i) => t !== QC.pairs[i].right)) shuffled += 1;
      for (const want of [[0, 1, 2], [0, 2, 1], [1, 2, 0], [2, 0, 1]]) {
        const response = want.map((orig) => shown.indexOf(QC.pairs[orig].right));
        assert.deepEqual(toOriginalResponse(QC, response, seed), want, `${seed} ${want}`);
        // And the marker agrees: right exactly where the pick is the item's own pair.
        const hits = want.filter((orig, i) => orig === i).length;
        close(score(QC, response, seed).score, hits / 3, 1e-12);
      }
    }
    assert.ok(shuffled >= 5, `only ${shuffled} of 10 boards were shuffled; the test would prove nothing`);
    assert.deepEqual(toOriginalResponse(QC, [7, null], seeds[0]).slice(0, 1), [null], 'off the board');
    assert.equal(toOriginalResponse(QC, [], seeds[0])[2], null, 'nothing sent for an item');
  });

  test('categorise: each item, wherever it was shown, gets the group the student put it in', () => {
    const q = { _id: 'qs', kind: 'categorise', bloom: 'understand', text: 'Sort them.', buckets: [{ name: 'Transport', items: ['TCP', 'UDP'] }, { name: 'Network', items: ['IP', 'ICMP', 'ARP'] }] };
    const flat = ['TCP', 'UDP', 'IP', 'ICMP', 'ARP'];
    const want = [0, 1, 1, 1, 0]; // TCP, IP and ICMP placed right; UDP and ARP not
    for (const s of STUDENTS) {
      const seed = `${s}:qs`;
      const shown = forStudent(q, seed).items;
      const response = Object.fromEntries(shown.map((text, pos) => [pos, want[flat.indexOf(text)]]));
      assert.deepEqual(toOriginalResponse(q, response, seed), want);
      close(score(q, response, seed).score, 3 / 5, 1e-12); // TCP, IP, ICMP right; UDP and ARP not
    }
  });

  test('dropdown: each gap is undone on its own seed', () => {
    const q = {
      _id: 'qd2', kind: 'dropdown', bloom: 'apply', text: 'TCP is ____ and UDP is ____.',
      blanks: [{ options: ['reliable', 'unordered', 'lossy'], answerIdx: 0 }, { options: ['connectionless', 'stateful'], answerIdx: 0 }],
    };
    for (const s of STUDENTS) {
      const seed = `${s}:qd2`;
      const gaps = forStudent(q, seed).gaps;
      const response = [gaps[0].options.indexOf('lossy'), gaps[1].options.indexOf('connectionless')];
      assert.deepEqual(toOriginalResponse(q, response, seed), [2, 0]);
      close(score(q, response, seed).score, 0.5, 1e-12);
    }
  });

  test('fewer choices: a position in the shorter list is the option at that position of the list shown', () => {
    const supports = { [FEWER_CHOICES]: true };
    for (const s of STUDENTS) {
      const seed = `${s}:qa`;
      const keep = shownOptionIndices(QA, seed, supports);
      assert.equal(keep.length, 2);
      const shown = forStudent(QA, seed, supports).options;
      shown.forEach((text, pos) => assert.equal(toOriginalResponse(QA, pos, seed, keep), QA.options.indexOf(text)));
      assert.equal(toOriginalResponse(QA, 2, seed, keep), null, 'a third option that was never on the screen');
      // The marker reads the same position the same way.
      const right = shown.indexOf(QA.options[QA.answerIdx]);
      assert.equal(score(QA, right, seed, supports).correct, true);
    }
    const multi = { _id: 'qm', kind: 'multi', bloom: 'analyse', text: 'Which are transport protocols?', options: ['TCP', 'IP', 'UDP', 'ARP', 'SCTP', 'ICMP'], answerIdxs: [0, 2, 4] };
    const keep = shownOptionIndices(multi, 'S1:qm', supports);
    assert.ok(keep && keep.length < 6);
    assert.deepEqual(toOriginalResponse(multi, keep.map((_, pos) => pos), 'S1:qm', keep), [...keep].sort((a, b) => a - b));
  });

  test('the kinds that are not shuffled, and the ones with no options to count', () => {
    assert.equal(toOriginalResponse(QA, 3, 'x'), 3);
    assert.equal(toOriginalResponse(QA, 4, 'x'), null);
    assert.deepEqual(toOriginalResponse({ ...QA, kind: 'multi', answerIdxs: [1, 2] }, [2, 0, 2, 9], 'x'), [0, 2]);
    assert.equal(toOriginalResponse(QD, false, 'x'), false);
    assert.equal(toOriginalResponse(QD, 'false', 'x'), null, 'only a real boolean, as the marker reads it');
    const hot = { kind: 'hottext', tokens: ['TCP', 'is', 'reliable'], answerIdxs: [0], criterion: 'protocols' };
    assert.deepEqual(toOriginalResponse(hot, [2, 0, 5], 'x'), [0, 2]);
    const grid = { kind: 'grid', rows: ['TCP', 'UDP'], columns: ['Reliable', 'Ordered'], answers: [[true, true], [false, false]] };
    assert.deepEqual(toOriginalResponse(grid, { '0:1': true, '1:0': true, '5:5': true }, 'x'), [[false, true], [true, false]]);
    assert.equal(toOriginalResponse({ kind: 'poll', options: ['Yes', 'No'] }, 1, 'x'), 1);
    for (const kind of ['blank', 'cloze', 'numeric', 'open', 'table', 'order', 'rank']) {
      assert.equal(toOriginalResponse({ kind }, 'anything', 'x'), null, kind);
    }
  });
});

/* -------------------------------------------- a room worked by hand -- */

describe('item analysis of a room, against a hand count', () => {
  const { items, counted } = itemAnalysis({ answers: roomAnswers(), questions: [QA, QB, QC, QD] });
  const item = (id) => items.find((i) => i.questionId === id);

  test('the marks are the plan\'s (so the hand values below are about the right data)', () => {
    const rows = roomAnswers();
    const qc = rows.filter((r) => r.questionId === 'qc').map((r) => r.score);
    assert.deepEqual(qc.map((x) => Math.round(x * 3)), [3, 3, 3, 3, 1, 1, 1, 0, 0, 0]);
    assert.deepEqual(counted, { answers: 40, students: 10 });
  });

  test('attempts, proportion correct and mean score', () => {
    assert.deepEqual([QA, QB, QC, QD].map((q) => item(q._id).attempts), [10, 10, 10, 10]);
    assert.deepEqual([QA, QB, QC, QD].map((q) => item(q._id).proportionCorrect), [0.6, 0.5, 0.4, 0.7]);
    // Match gives partial credit: (4 x 1 + 3 x 1/3 + 3 x 0) / 10 = 0.5.
    close(item('qc').meanScore, 0.5, 1e-12);
    assert.equal(item('qa').meanScore, null, 'all or nothing: the proportion already says it');
    assert.equal(item('qd').meanScore, null);
  });

  test('bands: 0.6, 0.5, 0.4 (the boundary) and 0.7 are all medium', () => {
    assert.deepEqual(items.map((i) => i.band), ['medium', 'medium', 'medium', 'medium']);
  });

  // Each student's rest is their mean over the other three questions. Worked by
  // hand with M1, M0, the population sd and p (scratch figures in the comments):
  //   QA  M1 35/54, M0 4/9, sd 0.175330, p 0.6  ->  0.5692
  //   QB  M1 11/45, M0 43/45, sd 0.425136, p 0.5 -> -0.8363
  //   QC  M1 2/3, M0 5/9, sd 0.2, p 0.4          ->  0.2722
  //   QD  M1 13/21, M0 1/3, sd 0.163299, p 0.7   ->  0.8018
  test('the point-biserials equal the hand values', () => {
    close(item('qa').pointBiserial, 0.5692);
    close(item('qb').pointBiserial, -0.8363);
    close(item('qc').pointBiserial, 0.2722);
    close(item('qd').pointBiserial, 0.8018);
    assert.ok(items.every((i) => i.pointBiserialN === 10 && i.pointBiserialNote === null));
  });

  test('the wrong key is flagged, and listed first', () => {
    assert.equal(items[0].questionId, 'qb');
    assert.deepEqual(item('qb').flags.map((f) => f.id), ['negative-point-biserial']);
    assert.match(item('qb').flags[0].message, /check the key first/);
    assert.ok(['qa', 'qc', 'qd'].every((id) => item(id).flags.length === 0));
  });

  test('how many chose each option, by hand', () => {
    const counts = (id) => item(id).distribution.rows.map((r) => r.options.map((o) => o.count));
    assert.deepEqual(counts('qa'), [[2, 6, 1, 1]]);
    assert.deepEqual(counts('qb'), [[5, 0, 5, 0]]);
    assert.deepEqual(counts('qd'), [[7, 3]]);
    // Match, per left item, in the question's own order of right items, though
    // no two phones were shown that order.
    assert.deepEqual(counts('qc'), [[7, 3, 0], [0, 4, 6], [3, 3, 4]]);
    assert.deepEqual(item('qc').distribution.rows.map((r) => r.label), ['TCP', 'UDP', 'IP']);
    assert.deepEqual(item('qc').distribution.rows[1].options.map((o) => o.key), [false, true, false]);
    assert.deepEqual(item('qb').distribution.rows[0].options.map((o) => o.key), [true, false, false, false]);
    assert.deepEqual(item('qd').distribution.rows[0].options.map((o) => [o.text, o.key]), [['True', true], ['False', false]]);
    assert.ok(items.every((i) => i.distribution.answers === 10 && i.distribution.otherVersions === 0
      && i.distribution.rows.every((r) => r.unanswered === 0) && i.versions === 1));
  });
});

/* ------------------------------------------------------- what counts -- */

describe('what is counted', () => {
  test('a retried attempt and a poll are not; a second final row replaces the first', () => {
    const poll = { _id: 'qp', kind: 'poll', bloom: 'understand', text: 'Ready?', options: ['Yes', 'No'] };
    const rows = [
      row(QA, 'S1', 0, { final: false }),
      row(QA, 'S1', 1),
      row(QA, 'S2', 0),
      row(QA, 'S2', 2),
      { ...row(poll, 'S1', 0), ungraded: true, correct: null, score: null },
    ];
    assert.equal(gradedAnswers(rows).length, 2);
    const { items } = itemAnalysis({ answers: rows, questions: [QA, poll] });
    assert.deepEqual(items.map((i) => i.questionId), ['qa']);
    assert.equal(items[0].attempts, 2);
    assert.deepEqual(items[0].distribution.rows[0].options.map((o) => o.count), [0, 1, 1, 0]);
  });

  test('a student is a roll number in a room: the same roll number in two rooms is two students', () => {
    const rows = [row(QA, 'S1', 1), row(QA, 'S1', 0, { sessionId: 'R2' })];
    const { items, counted } = itemAnalysis({ answers: rows });
    assert.equal(counted.students, 2);
    assert.equal(items[0].attempts, 2);
  });

  test('below ten students who answered something else, no point-biserial', () => {
    const rows = [];
    for (const s of STUDENTS.slice(0, 9)) rows.push(row(QA, s, 1), row(QD, s, true));
    rows.push(row(QA, 'S10', 0)); // one answer only: no rest to compare
    const qa = itemAnalysis({ answers: rows }).items.find((i) => i.questionId === 'qa');
    assert.equal(qa.attempts, 10);
    assert.equal(qa.pointBiserial, null);
    assert.equal(qa.pointBiserialN, 9);
    assert.match(qa.pointBiserialNote, /Fewer than 10/);
    assert.deepEqual(qa.flags, []);
  });

  test('a fewer-choices answer is counted on the option it was, from the snapshot\'s shownOptions', () => {
    const keep = shownOptionIndices(QA, 'S1:qa', { [FEWER_CHOICES]: true });
    const reduced = row(QA, 'S1', 1, { questionSnapshot: { ...row(QA, 'S1', 1).questionSnapshot, shownOptions: keep } });
    const { items } = itemAnalysis({ answers: [reduced, row(QA, 'S2', 1)] });
    const counts = items[0].distribution.rows[0].options.map((o) => o.count);
    const expected = [0, 0, 0, 0];
    expected[keep[1]] += 1; // S1 picked the second of the two shown
    expected[1] += 1; //       S2, the full list, picked option 1
    assert.deepEqual(counts, expected);
    assert.equal(items[0].versions, 1, 'a shorter list is not a new version of the question');
  });

  test('a question since deleted is still reported, by its snapshot\'s id', () => {
    const gone = row(QA, 'S1', 1, { questionId: null });
    const { items } = itemAnalysis({ answers: [gone] });
    assert.equal(items[0].questionId, 'qa');
    assert.equal(items[0].status, 'deleted');
    assert.equal(items[0].text, QA.text);
  });

  test('a question nobody has answered is listed at zero when asked for', () => {
    const { items } = itemAnalysis({ answers: [], questions: [QA], include: ['QA'] });
    assert.equal(items.length, 1);
    assert.equal(items[0].attempts, 0);
    assert.equal(items[0].proportionCorrect, null);
    assert.equal(items[0].band, null);
    assert.deepEqual(items[0].distribution.rows[0].options.map((o) => [o.text, o.count]),
      [['Network', 0], ['Transport', 0], ['Link', 0], ['Physical', 0]]);
  });

  test('answers to an earlier version with other options are kept out of the counts, and said to be', () => {
    const before = { ...QA, options: ['Network', 'Transport', 'Link', 'Physical', 'Session'] };
    const rows = [row({ ...before, kind: 'mcq' }, 'S1', 4), row(QA, 'S2', 1)];
    const { items } = itemAnalysis({ answers: rows });
    assert.equal(items[0].attempts, 2, 'both still count as attempts, marked as they were');
    assert.equal(items[0].versions, 2);
    assert.equal(items[0].distribution.answers, 1);
    assert.equal(items[0].distribution.otherVersions, 1);
  });

  // The likely sequence after a wrong-key flag: the professor fixes the key by
  // rewriting the options, keeping four. Matched by count alone, the two right
  // answers to the old wording showed up as two students picking "Link".
  test('answers to an earlier version whose options were reworded are kept out too, though the count is the same', () => {
    const before = { ...QA, options: ['Session', 'Presentation', 'Transport', 'Physical'], answerIdx: 2 };
    const rows = [row(before, 'S1', 2), row(before, 'S2', 2), row(QA, 'S3', 1)];
    const { items } = itemAnalysis({ answers: rows, questions: [QA] });
    assert.equal(items[0].attempts, 3);
    assert.equal(items[0].versions, 2);
    assert.equal(items[0].distribution.answers, 1);
    assert.equal(items[0].distribution.otherVersions, 2);
    assert.deepEqual(items[0].distribution.rows[0].options.map((o) => [o.text, o.count]),
      [['Network', 0], ['Transport', 1], ['Link', 0], ['Physical', 0]]);
  });

  test('a key moved over the same options still counts the earlier answers, on the options they were', () => {
    const before = { ...QA, answerIdx: 2 };
    const rows = [row(before, 'S1', 1), row(QA, 'S2', 1)];
    const { items } = itemAnalysis({ answers: rows, questions: [QA] });
    assert.equal(items[0].distribution.answers, 2);
    assert.equal(items[0].distribution.otherVersions, 0);
    assert.deepEqual(items[0].distribution.rows[0].options.map((o) => o.count), [0, 2, 0, 0]);
  });

  // Snapshots from before the approval gate carry none of its fields, later ones
  // carry them empty, and an older question approved during a class carries a
  // stamp from then on. None of that is a change to what the students were asked.
  test('one unchanged question is one version, whatever bookkeeping its snapshots carry', () => {
    const snap = row(QA, 'S1', 1).questionSnapshot;
    const rows = [
      row(QA, 'S1', 1),
      row(QA, 'S2', 1, { questionSnapshot: { ...snap, model: null, sourceRef: null, createdBy: null, approvedBy: null, approvedAt: null, stimulus: null } }),
      row(QA, 'S3', 1, { questionSnapshot: { ...snap, model: null, approvedBy: 'prof-1', approvedAt: '2026-11-19T10:00:00.000Z' } }),
      row(QA, 'S4', 1, { questionSnapshot: { ...snap, checks: [{ id: 'absolute-words', ok: true }], source: 'llm', topic: 'Layers' } }),
    ];
    const { items } = itemAnalysis({ answers: rows, questions: [QA] });
    assert.equal(items[0].versions, 1);
    assert.equal(items[0].distribution.answers, 4);
  });
});

/* -------------------------------------------- a question set per room -- */

describe('a question set per room', () => {
  const bank = [
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', status: 'active', bloom: 'remember' },
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa2', status: 'active', bloom: 'understand' },
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa3', status: 'active', bloom: 'remember' },
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa4', status: 'discarded', bloom: 'remember' },
    { _id: 'aaaaaaaaaaaaaaaaaaaaaaa5', status: 'draft', bloom: 'remember' },
  ];

  test('no set is the whole approved bank, as every room before sets', () => {
    assert.equal(roomQuestionIds({}), null);
    assert.equal(roomQuestionIds({ questionIds: null }), null);
    assert.ok(inRoomSet({ questionIds: null }, 'anything'));
    assert.deepEqual(servableFor({ questionIds: null }, bank).map((q) => q._id.slice(-1)), ['1', '2', '3']);
  });

  test('a set: active questions in it only, whatever case the ids are in', () => {
    const room = { questionIds: ['AAAAAAAAAAAAAAAAAAAAAAA2', 'aaaaaaaaaaaaaaaaaaaaaaa4', 'aaaaaaaaaaaaaaaaaaaaaaa5'] };
    assert.deepEqual(roomQuestionIds(room), room.questionIds.map((id) => id.toLowerCase()));
    assert.ok(inRoomSet(room, 'aaaaaaaaaaaaaaaaaaaaaaa2'));
    assert.ok(!inRoomSet(room, 'aaaaaaaaaaaaaaaaaaaaaaa1'));
    // In the set but discarded or a draft since: not served.
    assert.deepEqual(servableFor(room, bank).map((q) => q._id.slice(-1)), ['2']);
  });

  test('the selector, handed what a set room serves, never reaches outside it', () => {
    const room = { questionIds: ['aaaaaaaaaaaaaaaaaaaaaaa1', 'aaaaaaaaaaaaaaaaaaaaaaa2'] };
    for (let trial = 0; trial < 20; trial += 1) {
      const profile = hydrate(emptyProfile({ sessionId: 's', rollNo: `R${trial}` }));
      const served = [];
      for (;;) {
        const pick = selectNext(profile, servableFor(room, bank));
        if (!pick) break;
        served.push(pick.question._id);
        profile.history.push({ questionId: pick.question._id, bloom: pick.question.bloom, correct: true });
      }
      assert.deepEqual(served.sort(), room.questionIds);
    }
  });

  test('an image is loadable by phones only through a running room that can show its question', async () => {
    const repo = createMemoryRepo();
    const chapter = await repo.createContent({ title: 'C', kind: 'syllabus', rawText: '', topics: [] });
    const media = await repo.createMedia({ contentId: chapter._id, mime: 'image/png', bytes: 1, sha256: 'f'.repeat(64), data: Buffer.from([1]), alt: 'A leaf' });
    const [withImage, other] = await repo.insertQuestions([
      { ...strip(QA), contentId: chapter._id, stimulus: { kind: 'image', url: mediaUrl(media._id), alt: 'A leaf' } },
      { ...strip(QB), contentId: chapter._id },
    ]);
    const setRoom = await repo.createSession({ code: 'SETIMG', contentId: chapter._id, status: 'open', questionIds: [other._id] });
    assert.equal(await servedToPhones(repo, media), false, 'the only room running leaves that question out of its set');
    await repo.updateSession(setRoom._id, { status: 'closed' });
    await repo.createSession({ code: 'SETIM2', contentId: chapter._id, status: 'open', questionIds: [withImage._id] });
    assert.equal(await servedToPhones(repo, media), true, 'a room whose set holds it');
    const repo2 = createMemoryRepo();
    const c2 = await repo2.createContent({ title: 'C', kind: 'syllabus', rawText: '', topics: [] });
    const m2 = await repo2.createMedia({ contentId: c2._id, mime: 'image/png', bytes: 1, sha256: 'f'.repeat(64), data: Buffer.from([1]), alt: 'A leaf' });
    await repo2.insertQuestions([{ ...strip(QA), contentId: c2._id, stimulus: { kind: 'image', url: mediaUrl(m2._id), alt: 'A leaf' } }]);
    await repo2.createSession({ code: 'WHOLE1', contentId: c2._id, status: 'open' });
    assert.equal(await servedToPhones(repo2, m2), true, 'a room with no set serves the whole approved bank');
  });

  test('a deleted room\'s archive keeps its set', async () => {
    const repo = createMemoryRepo();
    const chapter = await repo.createContent({ title: 'C', kind: 'syllabus', rawText: '', topics: [] });
    const room = await repo.createSession({ code: 'ARCSET', contentId: chapter._id, status: 'closed', questionIds: ['aaaaaaaaaaaaaaaaaaaaaaa1'] });
    const plain = await repo.createSession({ code: 'ARCALL', contentId: chapter._id, status: 'closed' });
    assert.deepEqual((await buildRoomArchive(repo, room)).doc.data.room.questionIds, ['aaaaaaaaaaaaaaaaaaaaaaa1']);
    assert.equal((await buildRoomArchive(repo, plain)).doc.data.room.questionIds, null);
  });
});

/* ------------------------------------------------------------ readers -- */

describe('the readers, on the in-process store', () => {
  test('a room lists its answered questions and the rest of its set; a bank sums its rooms', async () => {
    const repo = createMemoryRepo();
    const chapter = await repo.createContent({ title: 'C', kind: 'syllabus', rawText: '', topics: [] });
    const [a, b, c] = await repo.insertQuestions([QA, QB, QD].map((q) => ({ ...strip(q), contentId: chapter._id })));
    const r1 = await repo.createSession({ code: 'ROOM01', contentId: chapter._id, status: 'closed', questionIds: [a._id, b._id] });
    const r2 = await repo.createSession({ code: 'ROOM02', contentId: chapter._id, status: 'closed' });
    const put = (room, q, rollNo, response, correct) => repo.recordAnswer({
      sessionId: room._id, answerKey: `${rollNo}-${q._id}`, rollNo, questionId: q._id, kind: q.kind, bloom: q.bloom,
      topic: q.topic, questionSnapshot: { id: q._id, ...q }, response, correct, score: correct ? 1 : 0, final: true,
    });
    await put(r1, a, 'S1', 1, true);
    await put(r2, a, 'S1', 0, false);
    await put(r2, c, 'S1', true, true);

    const room = await roomItemStats(repo, r1);
    const attempts = Object.fromEntries(room.items.map((i) => [i.questionId, i.attempts]));
    assert.deepEqual(attempts, { [a._id]: 1, [b._id]: 0 }, 'the set\'s unanswered question listed, the other room\'s not');
    assert.deepEqual(room.thresholds, THRESHOLDS);

    const all = await contentItemStats(repo, chapter, [r1, r2]);
    assert.deepEqual(all.counted, { answers: 3, students: 2 });
    const byId = Object.fromEntries(all.items.map((i) => [i.questionId, i]));
    assert.equal(byId[a._id].attempts, 2);
    assert.equal(byId[a._id].proportionCorrect, 0.5);
    assert.equal(byId[b._id].attempts, 0, 'approved and never answered, still listed');
    assert.equal(byId[c._id].attempts, 1);
    assert.equal((await contentItemStats(repo, chapter, [r1])).counted.answers, 1, 'only the rooms it is given');
  });
});

/* ----------------------------------------------------- the three repos -- */

describe('the three repos keep a room\'s set', () => {
  test('in-process: null unless given', async () => {
    const repo = createMemoryRepo();
    assert.equal((await repo.createSession({ code: 'A', contentId: 'c' })).questionIds, null);
    assert.deepEqual((await repo.createSession({ code: 'B', contentId: 'c', questionIds: ['q1'] })).questionIds, ['q1']);
  });

  // Not a database test: no Supabase is reachable from here. This pins what the
  // repo sends and how it reads the column back.
  test('Supabase: question_ids is written on create and read back as questionIds', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const ids = ['3f0b8f8e-6b0a-4c7e-9a51-1f2d3c4b5a69', '11111111-1111-4111-8111-111111111111'];
    globalThis.fetch = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      seen.push(body);
      const reply = { id: 'room', code: 'ROOM01', content_id: 'c', status: 'open', mastery_goal: '0.80', reattempts: 0, redemption: false, question_ids: body?.question_ids ?? null };
      return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const room = await repo.createSession({ code: 'ROOM01', contentId: 'c', questionIds: ids, masteryGoal: 0.8, reattempts: 0, redemption: false });
      assert.deepEqual(seen[0].question_ids, ids);
      assert.deepEqual(room.questionIds, ids);
      const whole = await repo.createSession({ code: 'ROOM02', contentId: 'c', masteryGoal: 0.8, reattempts: 0, redemption: false });
      assert.equal(seen[1].question_ids, null);
      assert.equal(whole.questionIds, null);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  // Not a database test either: the schema, checked by building documents.
  test('Mongo: the schema declares the path, and an absent set stays absent rather than []', async () => {
    const { Session } = await import('../src/models/index.js');
    const withSet = new Session({ code: 'A', contentId: '0123456789abcdef01234567', questionIds: ['q1', 'q2'] }).toObject();
    assert.deepEqual([...withSet.questionIds], ['q1', 'q2']);
    const without = new Session({ code: 'B', contentId: '0123456789abcdef01234567' }).toObject();
    assert.equal(without.questionIds, undefined);
  });
});
