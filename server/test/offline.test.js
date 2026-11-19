// Phase 7, stage "Next" (decisions O2 and O3): the question pack a phone takes
// for use offline, the order an outbox's answers move the ladder in, and the
// grace window after a room closes. The pure rules in services/offline.js, the
// lock that keeps arrival order (sockets/index.js), the repositories' pack
// records, attainment leaving a late answer out, and the boot probe. End to end,
// with a phone over the socket going offline and coming back, in
// scripts/offline.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  AFTER_CLOSE_DETAIL, ANSWERED_AGAIN_DETAIL, ANSWERED_AGAIN_MESSAGE, DELIVER_IMPORTED_REASON, DELIVER_MESSAGE, GRACE_MINUTES,
  GRACE_MS, KEPT_LIMIT, KEPT_LIMIT_MESSAGE, LATE_COUNTED_MESSAGE, LATE_NOT_SERVED_MESSAGE, LATE_TOO_LATE_MESSAGE, NOT_THIS_ROOM_MESSAGE, OVER_CAP_DETAIL,
  PACK_HOURS, PACK_NOTE, PACK_RECORD_LIMIT, PACK_SHARE, PACK_SIZE, SERVED_LOG_LIMIT, choosePack, deviceTimeOf, keptAfterClose,
  keptAnsweredAgain, keptNotCounted, lateVerdict, livePack, logServed, overCapMessage, packExpiry, packLevels, packPayload,
  packReason, packRecordNeed, packableLevels, sameId, servedAtFor,
} from '../src/services/offline.js';
import { applyAnswer, emptyProfile, hydrate, triesSpent } from '../src/services/mastery.js';
import { chooseAnswers } from '../src/services/attainment.js';
import { DEFAULT_PRESET, presetById } from '../src/services/attainmentPresets.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { lockProfile } from '../src/sockets/index.js';
import { LEVELS } from '../src/bloom.js';

/* ------------------------------------------------------------- fixtures -- */

const ROLL = '21CS07';
let n = 0;
/** A bank question, active, at a level; mcq unless the kind is given. */
const q = (bloom, extra = {}) => {
  n += 1;
  return {
    _id: `q${String(n).padStart(3, '0')}`, contentId: 'c1', status: 'active', bloom, topic: 'Sets', kind: 'mcq', source: 'llm',
    text: `Question ${n}`, options: ['a', 'b', 'c', 'd'], answerIdx: 2, approvedAt: '2026-11-19T08:00:00.000Z', ...extra,
  };
};
/** Eight questions at every level. */
const BANK = LEVELS.flatMap((level) => Array.from({ length: 8 }, () => q(level)));

const profileAt = (workingLevel, history = []) => hydrate({
  ...emptyProfile({ sessionId: 's1', rollNo: ROLL }), workingLevel, history,
});
/** A history of `right` correct and `wrong` wrong answers at a level (ids not in BANK). */
const historyOf = (level, right, wrong) => [
  ...Array.from({ length: right }, (_, i) => ({ questionId: `h-${level}-r${i}`, bloom: level, correct: true, score: 1, at: '2026-11-19T09:00:00.000Z' })),
  ...Array.from({ length: wrong }, (_, i) => ({ questionId: `h-${level}-w${i}`, bloom: level, correct: false, score: 0, at: '2026-11-19T09:00:00.000Z' })),
];
/** A profile counted by applyAnswer, so its tallies agree with its history. */
const answered = (answers, start = profileAt('understand')) => answers.reduce((p, a, i) => applyAnswer(p, {
  questionId: a.questionId ?? `x${i}`, bloom: a.bloom, topic: 'Sets', kind: 'mcq', answerId: a.answerId ?? `k${i}`,
  correct: a.correct, score: a.correct ? 1 : 0, at: a.at ?? '2026-11-19T09:00:00.000Z', tries: 1,
}).profile, start);

const levelsOf = (pack) => pack.map((p) => p.level);
const idsOf = (pack) => pack.map((p) => String(p.question._id));

// Field names that carry a key, a rubric or the machine's reading: none may
// be anywhere in what a phone is sent, at any depth.
const KEY_FIELDS = ['answerIdx', 'answerIdxs', 'answerBool', 'pairs', 'sequence', 'accept', 'rubric', 'buckets', 'blanks',
  'value', 'tolerance', 'answers', 'solution', 'modelAnswer', 'misconceptions', 'checks', 'levelCheck', 'correct', 'score'];
function keysIn(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (KEY_FIELDS.includes(k)) found.push(k);
      keysIn(v, found);
    }
  }
  return found;
}

// One question of every kind, its key held in KEY... strings where the key is
// text a phone is never shown (the items of a match, a sort or an order are
// shown, shuffled: there the key is the pairing), so a leak shows in a plain
// search of the payload too.
const EVERY_KIND = [
  q('remember', { kind: 'mcq', misconceptions: [{ option: 'a', label: 'Thinks a set repeats', provenance: 'ai' }] }),
  q('remember', { kind: 'truefalse', options: undefined, answerIdx: undefined, answerBool: false }),
  q('understand', { kind: 'match', options: undefined, answerIdx: undefined, pairs: [{ left: 'A', right: 'Holds A' }, { left: 'B', right: 'Holds B' }] }),
  q('understand', { kind: 'categorise', options: undefined, answerIdx: undefined, buckets: [{ name: 'X', items: ['One'] }, { name: 'Y', items: ['Two'] }] }),
  q('apply', { kind: 'blank', options: undefined, answerIdx: undefined, accept: ['KEYBLANK'] }),
  q('apply', { kind: 'cloze', options: undefined, answerIdx: undefined, text: 'A ____ and a ____.', blanks: [{ accept: ['KEYCLOZEA'] }, { accept: ['KEYCLOZEB'] }] }),
  q('apply', { kind: 'numeric', options: undefined, answerIdx: undefined, value: 4242.5, tolerance: 0.5, unit: 'g' }),
  q('apply', { kind: 'dropdown', options: undefined, answerIdx: undefined, text: 'Water moves by ____.', blanks: [{ options: ['osmosis', 'magic'], answerIdx: 0 }] }),
  q('analyse', { kind: 'multi', options: ['a', 'b', 'c', 'd', 'e'], answerIdx: undefined, answerIdxs: [0, 2] }),
  q('evaluate', { kind: 'order', options: undefined, answerIdx: undefined, sequence: ['First', 'Second', 'Third'] }),
  q('create', { kind: 'open', options: undefined, answerIdx: undefined, rubric: ['KEYRUBRIC names a control'] }),
];

/* ---------------------------------------------------------- pack contents -- */

describe('what a pack holds', () => {
  test('five questions by default: three at the working level, one below, one above, in that order', () => {
    const profile = profileAt('apply');
    const pack = choosePack(profile, BANK);
    assert.equal(PACK_SIZE, 5);
    assert.deepEqual(PACK_SHARE, { working: 3, below: 1, above: 1 });
    assert.equal(pack.length, 5);
    assert.deepEqual(levelsOf(pack), ['apply', 'apply', 'apply', 'understand', 'analyse']);
    assert.ok(pack.every((p) => p.question.bloom === p.level));
  });

  test('never above or below one level either side of the working level', () => {
    for (const level of LEVELS) {
      const allowed = new Set(packableLevels(profileAt(level)));
      const pack = choosePack(profileAt(level), BANK);
      assert.ok(pack.length > 0);
      assert.ok(pack.every((p) => allowed.has(p.level)), `${level}: ${levelsOf(pack)}`);
      const i = LEVELS.indexOf(level);
      assert.ok(pack.every((p) => Math.abs(LEVELS.indexOf(p.level) - i) <= 1), `${level}: ${levelsOf(pack)}`);
    }
  });

  test('at either end of the ladder the missing side\'s place goes to the working level', () => {
    assert.deepEqual(levelsOf(choosePack(profileAt('remember'), BANK)), ['remember', 'remember', 'remember', 'understand', 'remember']);
    assert.deepEqual(levelsOf(choosePack(profileAt('create'), BANK)), ['create', 'create', 'create', 'evaluate', 'create']);
  });

  test('a level with too few questions leaves its places to the others, the working level first', () => {
    const thin = [q('apply'), q('understand'), q('understand'), q('understand'), q('analyse'), q('analyse')];
    const pack = choosePack(profileAt('apply'), thin);
    assert.equal(pack.length, 5);
    assert.deepEqual(levelsOf(pack), ['apply', 'understand', 'analyse', 'understand', 'understand']);
  });

  test('inside the below-40% band: Remember and Understand only, alternating as the live selector does', () => {
    // 1 right of 4 at Understand: inside the band.
    const slow = answered([
      { bloom: 'understand', correct: false }, { bloom: 'understand', correct: false },
      { bloom: 'understand', correct: true }, { bloom: 'understand', correct: false },
    ]);
    assert.equal(packLevels(slow).alternate.length, 2);
    const pack = choosePack(slow, BANK);
    assert.equal(pack.length, 5);
    assert.ok(pack.every((p) => p.level === 'remember' || p.level === 'understand'), levelsOf(pack).join());
    // Four answers given: the fifth is Remember first, as selectNext opens on it.
    assert.deepEqual(levelsOf(pack), ['remember', 'understand', 'remember', 'understand', 'remember']);
    assert.deepEqual(packableLevels(slow), ['remember', 'understand']);
  });

  test('a room that does not adapt packs nothing above the level it holds a student at', () => {
    const pack = choosePack(profileAt('apply'), BANK, { adapt: false });
    assert.ok(pack.every((p) => p.level !== 'analyse'), levelsOf(pack).join());
    assert.deepEqual(packableLevels(profileAt('apply'), { adapt: false }), ['apply', 'understand']);
    assert.equal(pack.length, 5);
  });

  test('never a question the student has been marked on, the one on their screen, or one that is not active', () => {
    const level = 'understand';
    const atLevel = BANK.filter((x) => x.bloom === level);
    const marked = atLevel.slice(0, 3).map((x) => ({ questionId: x._id, bloom: level, correct: true, score: 1, at: '2026-11-19T09:00:00.000Z' }));
    const profile = profileAt(level, marked);
    const pin = atLevel[3]._id;
    const draft = { ...q(level), status: 'draft' };
    const discarded = { ...q(level), status: 'discarded' };
    const pack = choosePack(profile, [...BANK, draft, discarded], { exclude: [pin] });
    const ids = new Set(idsOf(pack));
    for (const m of marked) assert.ok(!ids.has(m.questionId), `marked ${m.questionId}`);
    assert.ok(!ids.has(pin), 'the pinned question');
    assert.ok(!ids.has(draft._id) && !ids.has(discarded._id), 'not active');
  });

  test('an id in other letters is the same question: marked or on the screen, it is never packed', () => {
    const level = 'understand';
    const atLevel = BANK.filter((x) => x.bloom === level);
    const marked = atLevel.slice(0, 3).map((x) => ({ questionId: x._id.toUpperCase(), bloom: level, correct: true, score: 1, at: '2026-11-19T09:00:00.000Z' }));
    const pin = atLevel[3]._id.toUpperCase();
    const ids = new Set(idsOf(choosePack(profileAt(level, marked), BANK, { exclude: [pin] })).map((id) => id.toLowerCase()));
    for (const m of marked) assert.ok(!ids.has(m.questionId.toLowerCase()), `marked ${m.questionId}`);
    assert.ok(!ids.has(pin.toLowerCase()), 'the pinned question');
  });

  test('the size follows the room\'s cap: smaller, and nothing at all at the cap', () => {
    assert.equal(choosePack(profileAt('apply'), BANK, { size: 2 }).length, 2);
    assert.deepEqual(choosePack(profileAt('apply'), BANK, { size: 0 }), []);
    assert.equal(choosePack(profileAt('apply'), BANK, { size: 50 }).length, PACK_SIZE, 'never more than PACK_SIZE');
  });

  test('an empty bank, or one with nothing at these levels, is an empty pack', () => {
    assert.deepEqual(choosePack(profileAt('apply'), []), []);
    assert.deepEqual(choosePack(profileAt('apply'), BANK.filter((x) => x.bloom === 'create')), []);
  });

  test('the same student is offered the same questions every time; two students, different orders', () => {
    const a1 = idsOf(choosePack(profileAt('apply'), BANK));
    const a2 = idsOf(choosePack(profileAt('apply'), [...BANK].reverse()));
    assert.deepEqual(a1, a2, 'stable whatever order the bank is read in');
    const others = ['21CS08', '21CS09', '21CS10'].map((rollNo) =>
      idsOf(choosePack({ ...profileAt('apply'), rollNo }, BANK)).join());
    assert.ok(others.some((o) => o !== a1.join()), 'a row of phones does not hold one identical pack');
  });

  test('questions the phone already holds are kept first, as they were, and count towards their level\'s share', () => {
    const profile = profileAt('apply');
    const first = choosePack(profile, BANK);
    // The first two answered: the three still held come first, two new ones after.
    const held = first.slice(2).map((p) => p.question);
    const done = first.slice(0, 2).map((p) => ({ questionId: p.question._id, bloom: p.level, correct: true, score: 1, at: '2026-11-19T09:00:00.000Z' }));
    const next = choosePack(profileAt('apply', done), BANK, { held });
    assert.deepEqual(idsOf(next).slice(0, 3), idsOf(first.slice(2)));
    assert.equal(next.length, 5);
    assert.equal(new Set(idsOf(next)).size, 5, 'no question twice');
    assert.ok(!idsOf(next).some((id) => done.some((d) => d.questionId === id)), 'nothing answered');
    assert.equal(levelsOf(next).filter((l) => l === 'understand').length, 1, 'below still holds one');
    assert.equal(levelsOf(next).filter((l) => l === 'analyse').length, 1, 'above still holds one');
  });
});

describe('what a phone is sent with a pack', () => {
  const profile = profileAt('apply');
  const pack = { issuedAt: '2026-11-19T09:00:00.000Z', expiresAt: packExpiry('2026-11-19T09:00:00.000Z') };

  test('every kind of question goes as the live loop sends it: no key, no rubric, no label, at any depth', () => {
    const chosen = EVERY_KIND.map((question) => ({ question, level: question.bloom }));
    const body = packPayload({ pack, chosen, profile });
    assert.equal(body.questions.length, EVERY_KIND.length);
    assert.deepEqual(keysIn(body), [], JSON.stringify(body));
    assert.doesNotMatch(JSON.stringify(body), /KEY[A-Z0-9]|4242\.5|Thinks a set repeats/);
    for (const [i, item] of body.questions.entries()) {
      assert.equal(item.question._id, EVERY_KIND[i]._id);
      assert.equal(item.question.bloom, EVERY_KIND[i].bloom);
      assert.equal(typeof item.question.provenance?.text, 'string', 'the phone\'s own provenance, as server:question carries it');
      assert.equal(typeof item.reason, 'string');
    }
  });

  test('with the fewer-choices support, the same shortened list the live question would show', () => {
    const mcq = EVERY_KIND[0];
    const supports = { fewerChoices: true };
    const body = packPayload({ pack, chosen: [{ question: mcq }], profile, supports });
    assert.ok(body.questions[0].question.options.length < mcq.options.length, JSON.stringify(body.questions[0].question));
    assert.deepEqual(keysIn(body), []);
  });

  test('its times, the grace window, the room\'s seconds per question, and a note that names no field', () => {
    const body = packPayload({ pack, chosen: [{ question: EVERY_KIND[0] }], profile, settings: { timePerQuestion: 45 } });
    assert.equal(body.issuedAt, pack.issuedAt);
    assert.equal(body.expiresAt, '2026-11-19T15:00:00.000Z');
    assert.equal(body.graceMinutes, GRACE_MINUTES);
    assert.equal(body.timePerQuestion, 45);
    assert.equal(body.note, PACK_NOTE);
    assert.doesNotMatch(PACK_NOTE, /student:|server:|answerId|questionId|\/api\//);
    assert.ok(!('timePerQuestion' in packPayload({ pack, chosen: [], profile })));
  });

  test('each question\'s sentence names its level and never a band, a rank or a share', () => {
    const slow = answered([
      { bloom: 'understand', correct: false }, { bloom: 'understand', correct: false }, { bloom: 'understand', correct: false },
    ]);
    const all = [
      packReason(profile, 'apply'), packReason(profile, 'understand'), packReason(profile, 'analyse'),
      packReason(slow, 'remember'), packReason(slow, 'understand'),
    ];
    assert.match(all[0], /at Apply, the level you are working at/);
    assert.match(all[1], /at Understand, the level before/);
    assert.match(all[2], /at Analyse, the next level up/);
    for (const s of all) assert.doesNotMatch(s, /40|band|slow|rank|%|No questions are left/i, s);
  });
});

describe('a pack\'s life', () => {
  const issued = '2026-11-19T09:00:00.000Z';
  const packs = [
    { _id: 'p1', questionIds: ['qa', 'qb'], issuedAt: issued, expiresAt: packExpiry(issued) },
    { _id: 'p2', questionIds: ['qb', 'qc'], issuedAt: '2026-11-19T09:30:00.000Z', expiresAt: packExpiry('2026-11-19T09:30:00.000Z') },
  ];

  test('expires six hours after it is sent', () => {
    assert.equal(PACK_HOURS, 6);
    assert.equal(Date.parse(packExpiry(issued)) - Date.parse(issued), 6 * 60 * 60 * 1000);
  });

  test('the phone holds its latest pack until it expires, and none after', () => {
    assert.equal(livePack(packs, Date.parse('2026-11-19T15:29:59.999Z'))?._id, 'p2', 'kept across hours away');
    assert.equal(livePack(packs, Date.parse('2026-11-19T15:30:00.000Z')), null, 'expired at six hours');
    assert.equal(livePack([], Date.parse(issued)), null);
  });

  test('a packed question is served from the first pack that held it, whether or not that pack has expired since', () => {
    assert.equal(servedAtFor({ packs, questionId: 'qb' }), issued);
    assert.equal(servedAtFor({ packs, questionId: 'QC' }), '2026-11-19T09:30:00.000Z', 'ids compared without case, as a uuid may be');
    assert.equal(servedAtFor({ packs, questionId: 'qz' }), null);
  });

  test('the question on the phone\'s screen is served from when it was pinned', () => {
    const profile = { served: { questionId: 'qd', at: '2026-11-19T08:50:00.000Z' } };
    assert.equal(servedAtFor({ profile, packs, questionId: 'qd' }), '2026-11-19T08:50:00.000Z');
    assert.equal(servedAtFor({ profile, packs, questionId: 'qa' }), issued);
  });

  test('before the close only: a pack or a pin after it is not "served before the room closed"', () => {
    const closedAt = '2026-11-19T09:15:00.000Z';
    assert.equal(servedAtFor({ packs, questionId: 'qb', before: closedAt }), issued);
    assert.equal(servedAtFor({ packs, questionId: 'qc', before: closedAt }), null, 'packed only after the close');
    const late = { served: { questionId: 'qe', at: '2026-11-19T09:20:00.000Z' } };
    assert.equal(servedAtFor({ profile: late, packs, questionId: 'qe', before: closedAt }), null);
  });

  test('a question the pin has moved off is still one it was given: the log of serves keeps it', () => {
    // Served qf, its answer failed to save, "Next question" pinned qg: the pin
    // alone forgot qf, so its answer after the close was "never given".
    const profile = hydrate({ rollNo: ROLL, served: { questionId: 'qg', at: '2026-11-19T09:05:00.000Z' } });
    assert.equal(logServed(profile, 'qf', '2026-11-19T09:00:00.000Z'), true);
    assert.equal(logServed(profile, 'qg', '2026-11-19T09:05:00.000Z'), true);
    assert.equal(logServed(profile, 'QF', '2026-11-19T09:30:00.000Z'), false, 'the first serve is the one kept, whatever the case');
    const closedAt = '2026-11-19T09:15:00.000Z';
    assert.equal(servedAtFor({ profile, packs: [], questionId: 'qf', before: closedAt }), '2026-11-19T09:00:00.000Z');
    assert.equal(servedAtFor({ profile, packs, questionId: 'qa', before: closedAt }), issued, 'packs still count');
    assert.equal(servedAtFor({ profile, packs: [], questionId: 'qh', before: closedAt }), null);
    // It survives the round trip every profile write makes.
    const again = hydrate(JSON.parse(JSON.stringify(profile)));
    assert.deepEqual(again.servedLog.map((e) => e.questionId), ['qf', 'qg']);
    assert.deepEqual(hydrate({ rollNo: ROLL }).servedLog, [], 'a profile from before the log has none');
    // Bounded: the oldest go first.
    const busy = hydrate({ rollNo: ROLL });
    for (let i = 0; i < SERVED_LOG_LIMIT + 5; i += 1) logServed(busy, `q${i}`, issued);
    assert.equal(busy.servedLog.length, SERVED_LOG_LIMIT);
    assert.equal(busy.servedLog[0].questionId, 'q5');
    assert.equal(sameId('ABC', 'abc'), true);
    assert.equal(sameId('', ''), false);
  });

  test('the retries spent on the pinned question are its own whatever the case of its id', () => {
    const profile = { served: { questionId: 'ab12cd', at: issued, tries: 1 } };
    assert.equal(triesSpent(profile, 'AB12CD'), 1);
    assert.equal(triesSpent(profile, 'ab12cd'), 1);
    assert.equal(triesSpent(profile, 'ab12ce'), 0);
    assert.equal(triesSpent({ served: null }, 'ab12cd'), 0);
  });
});

describe('a pack\'s record', () => {
  const issued = '2026-11-19T09:00:00.000Z';
  const live = { questionIds: ['qa', 'qb', 'qc'], issuedAt: issued, expiresAt: packExpiry(issued) };
  const chosen = (...ids) => ids.map((id) => ({ question: { _id: id } }));

  test('questions the live record already holds need no new record, in any order or number', () => {
    assert.equal(packRecordNeed({ live, chosen: chosen('qa', 'qb', 'qc'), count: 1 }), 'reuse');
    assert.equal(packRecordNeed({ live, chosen: chosen('qc', 'QA'), count: 1 }), 'reuse', 'fewer, since the pin moved onto one');
  });

  test('a question it does not hold needs one, up to the limit', () => {
    assert.equal(packRecordNeed({ live, chosen: chosen('qa', 'qd'), count: 1 }), 'write');
    assert.equal(packRecordNeed({ live: null, chosen: chosen('qa'), count: 0 }), 'write');
    assert.equal(packRecordNeed({ live, chosen: chosen('qd'), count: PACK_RECORD_LIMIT }), 'limit');
    assert.equal(packRecordNeed({ live, chosen: chosen('qa'), count: PACK_RECORD_LIMIT }), 'reuse', 'at the limit, the live record still serves');
  });
});

/* ------------------------------------------------------ the grace window -- */

describe('an answer that reaches the server after its room closed', () => {
  const closedAt = '2026-11-19T10:00:00.000Z';
  const closed = Date.parse(closedAt);
  const servedAt = '2026-11-19T09:40:00.000Z';

  test('the window is ten minutes, a named constant', () => {
    assert.equal(GRACE_MINUTES, 10);
    assert.equal(GRACE_MS, 600000);
  });

  test('served before the close and just inside the window: counted', () => {
    for (const now of [closed, closed + 1, closed + GRACE_MS - 1, closed + GRACE_MS]) {
      assert.deepEqual(lateVerdict({ closedAt, servedAt, now }), { counted: true, message: LATE_COUNTED_MESSAGE }, String(now - closed));
    }
  });

  test('arrived before the close and marked after it (it waited its turn): inside the window, counted', () => {
    for (const now of [closed - 1, closed - 60000]) {
      assert.deepEqual(lateVerdict({ closedAt, servedAt, now }), { counted: true, message: LATE_COUNTED_MESSAGE }, String(now - closed));
    }
    assert.equal(lateVerdict({ closedAt, servedAt: null, now: closed - 1 }).counted, false, 'never served still never counts');
  });

  test('served before the close and just outside the window: kept, not counted, and the phone is told why', () => {
    for (const now of [closed + GRACE_MS + 1, closed + GRACE_MS + 60000, closed + 24 * 60 * 60 * 1000]) {
      assert.deepEqual(lateVerdict({ closedAt, servedAt, now }), { counted: false, message: LATE_TOO_LATE_MESSAGE });
    }
  });

  test('never served to that phone: kept, not counted, however soon it arrives', () => {
    for (const now of [closed, closed + 1000, closed + GRACE_MS + 1]) {
      assert.deepEqual(lateVerdict({ closedAt, servedAt: null, now }), { counted: false, message: LATE_NOT_SERVED_MESSAGE });
    }
  });

  test('a room with no close time counts nothing late', () => {
    assert.equal(lateVerdict({ closedAt: null, servedAt, now: closed }).counted, false);
  });

  test('the sentences a phone is told name no field, route or event', () => {
    for (const s of [LATE_COUNTED_MESSAGE, LATE_NOT_SERVED_MESSAGE, LATE_TOO_LATE_MESSAGE, AFTER_CLOSE_DETAIL, OVER_CAP_DETAIL,
      overCapMessage(1), overCapMessage(20), NOT_THIS_ROOM_MESSAGE, DELIVER_MESSAGE, DELIVER_IMPORTED_REASON,
      ANSWERED_AGAIN_DETAIL, ANSWERED_AGAIN_MESSAGE, KEPT_LIMIT_MESSAGE]) {
      assert.doesNotMatch(s, /student:|server:|answerId|questionId|\/api\/|final|detail/, s);
    }
    assert.match(overCapMessage(1), /asks each student 1 question, and/);
    assert.match(overCapMessage(20), /asks each student 20 questions, and/);
  });

  test('answers kept and not counted: at most a named number per student per room, far above an honest outbox', () => {
    assert.equal(KEPT_LIMIT, 100);
    // An honest outbox at one outage: the question on the screen and one pack.
    assert.ok(KEPT_LIMIT >= 10 * (PACK_SIZE + 1));
    assert.match(KEPT_LIMIT_MESSAGE, new RegExp(`already saved ${KEPT_LIMIT} of your answers that do not count`));
  });

  test('a kept row is told apart from a retried attempt and from a vote', () => {
    assert.equal(keptAfterClose({ final: false, detail: AFTER_CLOSE_DETAIL }), true);
    assert.equal(keptAfterClose({ final: false, detail: 'wrong' }), false);
    assert.equal(keptAfterClose({ final: true, detail: AFTER_CLOSE_DETAIL }), false);
    assert.equal(keptAfterClose({ final: false, detail: OVER_CAP_DETAIL }), false, 'past the cap is not after the close');
    assert.equal(keptNotCounted({ final: false, detail: AFTER_CLOSE_DETAIL }), true);
    assert.equal(keptNotCounted({ final: false, detail: OVER_CAP_DETAIL }), true);
    assert.equal(keptNotCounted({ final: false, detail: '1/2 rubric points' }), false);
    assert.equal(keptNotCounted({ final: true, detail: OVER_CAP_DETAIL }), false);
    // A second answer to a question already marked (the review of 19 Nov 2026).
    assert.equal(keptNotCounted({ final: false, detail: ANSWERED_AGAIN_DETAIL }), true);
    assert.equal(keptAnsweredAgain({ final: false, detail: ANSWERED_AGAIN_DETAIL }), true);
    assert.equal(keptAnsweredAgain({ final: false, detail: AFTER_CLOSE_DETAIL }), false);
    assert.equal(keptAfterClose({ final: false, detail: ANSWERED_AGAIN_DETAIL }), false);
  });

  test('attainment never counts one, under either attempts rule, and says why', () => {
    const base = { sessionId: 'r1', rollNo: '07', questionId: 'qx', bloom: 'apply', kind: 'mcq', ungraded: false, reviewStatus: 'auto' };
    const rows = [
      { ...base, _id: 'a1', final: true, correct: false, score: 0, answeredAt: '2026-11-19T09:50:00.000Z' },
      // The machine read it right; the row itself carries no mark (sockets/index.js).
      { ...base, _id: 'a2', final: false, correct: null, score: null, autoCorrect: true, autoScore: 1, detail: AFTER_CLOSE_DETAIL, answeredAt: '2026-11-19T10:30:00.000Z' },
      { ...base, _id: 'a3', questionId: 'qy', final: false, correct: null, score: null, autoCorrect: true, autoScore: 1, detail: AFTER_CLOSE_DETAIL, answeredAt: '2026-11-19T10:31:00.000Z' },
      { ...base, _id: 'a4', questionId: 'qz', final: false, correct: null, score: null, autoCorrect: true, autoScore: 1, detail: OVER_CAP_DETAIL, answeredAt: '2026-11-19T09:55:00.000Z' },
    ];
    const config = presetById(DEFAULT_PRESET).config;
    for (const attempts of ['final', 'best']) {
      const { chosen } = chooseAnswers(rows, { ...config, attempts });
      assert.deepEqual(chosen.map((a) => a._id), ['a1'], attempts);
    }
  });
});

/* ------------------------------------------- the device's clock is not read -- */

describe('the time a phone says it answered', () => {
  test('is kept as a time when it is one, and dropped when it is not', () => {
    assert.equal(deviceTimeOf('2026-11-19T10:02:00.000+05:30'), '2026-11-19T04:32:00.000Z');
    assert.equal(deviceTimeOf(Date.parse('2026-11-19T10:02:00.000Z')), '2026-11-19T10:02:00.000Z');
    for (const junk of [null, undefined, '', 'yesterday', {}, [], '1970-01-01T00:00:00Z', '2999-01-01T00:00:00Z', Number.NaN]) {
      assert.equal(deviceTimeOf(junk), null, String(junk));
    }
  });
});

/* -------------------------------------------- arrival order moves the ladder -- */

describe('an outbox\'s answers move the ladder in the order the server receives them', () => {
  // Five offline answers at Understand: wrong, wrong, right, right, right, in the
  // order they ARRIVE. The phone's clock says it answered them the other way
  // round. Marked in arrival order the student passes through the band and is
  // held at Understand; in the phone's order, three rights would promote first.
  const ARRIVALS = [
    { answerId: 'k1', questionId: 'u1', bloom: 'understand', correct: false, device: '2026-11-19T10:05:00.000Z' },
    { answerId: 'k2', questionId: 'u2', bloom: 'understand', correct: false, device: '2026-11-19T10:04:00.000Z' },
    { answerId: 'k3', questionId: 'u3', bloom: 'understand', correct: true, device: '2026-11-19T10:03:00.000Z' },
    { answerId: 'k4', questionId: 'u4', bloom: 'understand', correct: true, device: '2026-11-19T10:02:00.000Z' },
    { answerId: 'k5', questionId: 'u5', bloom: 'understand', correct: true, device: '2026-11-19T10:01:00.000Z' },
  ];

  test('each answer takes its place in its student\'s queue as it arrives, so a slow one is never overtaken', async () => {
    const order = [];
    let profile = profileAt('understand');
    // Each handler as handleAnswer starts: the place is taken before any await,
    // then the work waits on the store, the first answer longest.
    const handle = (a, delay) => {
      const turn = lockProfile('room-arrival', ROLL);
      return (async () => {
        const release = await turn;
        try {
          await new Promise((r) => setTimeout(r, delay));
          order.push(a.answerId);
          profile = applyAnswer(profile, { ...a, topic: 'Sets', kind: 'mcq', score: a.correct ? 1 : 0, tries: 1, at: new Date().toISOString() }).profile;
        } finally {
          release();
        }
      })();
    };
    await Promise.all(ARRIVALS.map((a, i) => handle(a, 25 - i * 5)));
    assert.deepEqual(order, ['k1', 'k2', 'k3', 'k4', 'k5']);
    assert.deepEqual(profile.history.map((h) => h.answerId), ['k1', 'k2', 'k3', 'k4', 'k5']);
    assert.equal(profile.workingLevel, 'understand', 'held: 3 of 5 at Understand');
  });

  test('the phone\'s own order would have moved the student differently, which is why it is never read', () => {
    const byArrival = answered(ARRIVALS);
    const byDevice = answered([...ARRIVALS].sort((a, b) => Date.parse(a.device) - Date.parse(b.device)));
    assert.equal(byArrival.workingLevel, 'understand');
    assert.equal(byDevice.workingLevel, 'apply');
  });
});

/* ------------------------------------------------------- the pack records -- */

describe('the repository\'s pack records (memory; Mongo and Supabase hold the same methods)', () => {
  test('written once each, listed oldest first per phone, refused empty, oversized or expiring at once, gone with the room', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'PACK01', contentId: 'c1', status: 'open' });
    const at = (m) => `2026-11-19T09:${String(m).padStart(2, '0')}:00.000Z`;
    await repo.addQuestionPack({ sessionId: room._id, rollNo: '07', questionIds: ['q2'], issuedAt: at(30), expiresAt: packExpiry(at(30)) });
    await repo.addQuestionPack({ sessionId: room._id, rollNo: '07', questionIds: ['q1', 'q3'], issuedAt: at(0), expiresAt: packExpiry(at(0)) });
    await repo.addQuestionPack({ sessionId: room._id, rollNo: '08', questionIds: ['q9'], issuedAt: at(10), expiresAt: packExpiry(at(10)) });
    const mine = await repo.listQuestionPacks(room._id, '07');
    assert.deepEqual(mine.map((p) => p.questionIds), [['q1', 'q3'], ['q2']]);
    assert.ok(mine.every((p) => p._id && p.rollNo === '07' && String(p.sessionId) === String(room._id)));
    for (const bad of [
      { questionIds: [] },
      { questionIds: Array.from({ length: 21 }, (_, i) => `q${i}`) },
      { questionIds: ['q1'], expiresAt: at(0) },
    ]) {
      await assert.rejects(repo.addQuestionPack({ sessionId: room._id, rollNo: '07', issuedAt: at(0), expiresAt: packExpiry(at(0)), ...bad }),
        (err) => err.status === 400, JSON.stringify(bad));
    }
    // A list read back is a copy: changing it changes no record.
    mine[0].questionIds.push('q99');
    assert.deepEqual((await repo.listQuestionPacks(room._id, '07'))[0].questionIds, ['q1', 'q3']);
    assert.equal(typeof repo.updateQuestionPack, 'undefined', 'no way to change a pack');
    await repo.deleteSession(room._id);
    assert.deepEqual(await repo.listQuestionPacks(room._id, '07'), []);
    assert.deepEqual(await repo.listQuestionPacks(room._id, '08'), []);
  });

  test('an answer keeps the phone\'s own time beside the server\'s, and none when the phone sent none', async () => {
    const repo = createMemoryRepo();
    const base = { sessionId: 's1', rollNo: '07', questionId: 'q1', bloom: 'apply', response: 0 };
    const { answer: timed } = await repo.recordAnswer({ ...base, answerKey: 'k-timed', deviceAnsweredAt: '2026-11-19T10:02:00.000Z' });
    const { answer: plain } = await repo.recordAnswer({ ...base, answerKey: 'k-plain' });
    assert.equal(timed.deviceAnsweredAt, '2026-11-19T10:02:00.000Z');
    assert.notEqual(timed.answeredAt, timed.deviceAnsweredAt);
    assert.equal(plain.deviceAnsweredAt, null);
  });
});

describe('the boot probe', () => {
  test('a database without 0030 is not used for rooms: the probe names the file', async () => {
    const { probeSupabase } = await import('../src/repo/supabaseRepo.js');
    const { config } = await import('../src/config.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.origin !== 'http://supabase.invalid') throw new Error(`refused: ${u.origin}`);
      const table = u.pathname.replace('/rest/v1/', '');
      const cols = (u.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (table === 'question_packs') return json(404, { code: 'PGRST205', message: 'Could not find the table \'public.question_packs\'' });
      if (table === 'answers' && cols.includes('device_answered_at')) return json(400, { code: '42703', message: 'column answers.device_answered_at does not exist' });
      return json(200, []);
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      await assert.rejects(probeSupabase(), (err) => /answers\.device_answered_at is missing: apply supabase\/migrations\/0030_offline_packs\.sql/.test(err.message)
        && /the question_packs table is missing: apply supabase\/migrations\/0030_offline_packs\.sql/.test(err.message));
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});
