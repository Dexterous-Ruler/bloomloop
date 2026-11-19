// The owner's decisions of 19 Nov 2026, as the pure parts and the repositories
// build them (docs/PRODUCT_DECISIONS.md). The end-to-end half, over a real
// server and real phones, is server/scripts/decisions.mjs.
//
//   (a)  what a phone is told about itself: a student subset of GridRow, with a
//        neutral `next` in place of slowLearner, the signals and the band
//   7    a link is verified only by a sign-in; a student reads verified rows only
//   8    the under-18 mark: which of a room's roll numbers it covers, and that no
//        signal is shown for them
//   the rest: a professor's question is 'teacher', a merge's source, the best
//        attempt rule (attainment.test.js), the room's mode on the projector,
//        and the boot probe naming the migration to apply
//
// Never reaches a network: the Supabase tests answer every request in-process.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { LEVELS } from '../src/bloom.js';
import { emptyProfile, hydrate, applyAnswer, nextStep, isSlowLearner } from '../src/services/mastery.js';
import { reasonForPhone } from '../src/services/selector.js';
import { buildGridRow, phoneRow } from '../src/routes/session.js';
import { record } from '../src/services/integrity.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { minorRolls, signalsOff, studentView } from '../src/services/roster.js';
import { mergeQuestions } from '../src/services/edits.js';
import { profilesToCsv } from '../src/services/csv.js';
import { buildRoomArchive, decodeRoomArchive, servedArchive } from '../src/services/archive.js';
import { verifiedKeys, verifiedView } from '../src/services/evidence.js';
import { projectorPayload, toProjector } from '../src/services/projector.js';

/** Words a phone must never be shown about its own place (decision (a)). */
const LABELS = /band|below-40|40%|slow|support|watch|signal|Left the page|faster than/i;

/** A profile after these answers, as the live loop builds one. */
function answered(list, { startLevel } = {}) {
  let p = hydrate(emptyProfile({ sessionId: 's1', rollNo: '21CS01', name: 'Asha', startLevel }));
  list.forEach(([bloom, correct], i) => {
    p = applyAnswer(p, { questionId: `q${i}`, bloom, correct, at: `2026-11-19T09:${String(i).padStart(2, '0')}:00.000Z` }).profile;
  });
  return p;
}

/* ---------------------------------------------------- (a) the phone's row -- */

describe('what a phone is told about itself (decision (a))', () => {
  // masteryBasis since Phase 5 (honest indicators): the same words as the
  // professor's row, with no band and no percentage.
  const PHONE_KEYS = ['answered', 'counted', 'levels', 'mastered', 'masteryBasis', 'masteryGoal', 'name', 'next', 'online', 'rollNo',
    'total', 'withdrawn', 'workingLevel'];

  test('a student subset of GridRow: never slowLearner, the signals or the professor\'s reason', () => {
    const p = answered([['understand', false], ['understand', false], ['remember', false], ['remember', false]]);
    record(p, 'hidden', { src: 'reported' });
    record(p, 'too-fast', { src: 'observed' });
    assert.ok(isSlowLearner(p), 'the fixture is inside the below-40% band');
    const staff = buildGridRow(p, { online: true });
    assert.equal(staff.slowLearner, true);
    assert.match(staff.reason, /below-40% band/, 'the teacher\'s row is unchanged');
    const row = phoneRow(p, { online: true });
    assert.deepEqual(Object.keys(row).sort(), PHONE_KEYS);
    for (const k of PHONE_KEYS.filter((x) => x !== 'next')) assert.deepEqual(row[k], staff[k], k);
    assert.doesNotMatch(JSON.stringify(row), LABELS);
  });

  test('`next` says what level comes next, why, and on how many answers', () => {
    assert.deepEqual(nextStep(answered([])), { levels: ['understand'], why: 'Your first questions are at Understand.', answers: 0 });
    const up = answered([['understand', true], ['understand', true], ['understand', true]]);
    assert.equal(up.workingLevel, 'apply');
    assert.deepEqual(nextStep(up), {
      levels: ['apply'], why: 'Your last 3 answers at Understand were mostly right, so your next questions are at Apply.', answers: 3,
    });
    const one = answered([['understand', true], ['understand', true], ['understand', true], ['apply', true]]);
    assert.deepEqual(nextStep(one), {
      levels: ['apply'],
      why: 'Your next questions are at Apply. You have 1 answer there so far, and your level can change once you have 3.',
      answers: 1,
    });
    // Up to Analyse, then three wrong there: back to Apply, said without a band.
    const down = answered([...Array(3).fill(['understand', true]), ...Array(3).fill(['apply', true]), ...Array(3).fill(['analyse', false])]);
    assert.equal(down.workingLevel, 'apply');
    assert.deepEqual(nextStep(down), {
      levels: ['apply'], why: 'Your last 3 answers at Analyse were mostly wrong, so your next questions step back to Apply.', answers: 3,
    });
    const mixed = answered([['understand', true], ['understand', false], ['understand', true], ['understand', false]]);
    assert.deepEqual(nextStep(mixed), { levels: ['understand'], why: 'Your next questions are at Understand, from your last 4 answers there.', answers: 4 });
  });

  test('inside the band: Remember and Understand, and why, never the band', () => {
    const p = answered([['understand', false], ['understand', false], ['understand', true], ['remember', false]]);
    const step = nextStep(p);
    assert.deepEqual(step.levels, ['remember', 'understand']);
    assert.equal(step.answers, 4);
    assert.match(step.why, /From your 4 answers so far, your next questions are at Remember and Understand, to build a firm base/);
    assert.doesNotMatch(step.why, LABELS);
    assert.match(reasonForPhone(p, 'remember'), /This question is at Remember, to build a firm base/);
  });

  test('a room that does not adapt says so; the top of the ladder says so', () => {
    const p = answered([['apply', true], ['apply', false]], { startLevel: 'apply' });
    assert.equal(nextStep(p, { adapt: false }).why, 'This room keeps every student at Apply, so your next questions are at Apply.');
    const top = answered(Array(4).fill(['create', true]), { startLevel: 'create' });
    assert.match(nextStep(top).why, /Create is the highest level, so your next questions stay there/);
  });

  test('why this question: on the level, below it when the level has run out, never the band', () => {
    const p = answered([['apply', true]], { startLevel: 'apply' });
    assert.equal(reasonForPhone(p, 'apply'), 'This question is at Apply, the level you are working at.');
    assert.equal(reasonForPhone(p, 'understand'), 'No questions are left for you at Apply, so this one is at Understand.');
  });

  test('over a thousand random rooms, no phone sentence names a band, a cut-off or a signal', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let room = 0; room < 1000; room += 1) {
      let p = hydrate(emptyProfile({ sessionId: 's', rollNo: 'R', startLevel: LEVELS[Math.floor(rand() * 3)] }));
      const adapt = rand() > 0.2;
      for (let i = 0; i < 12; i += 1) {
        const level = rand() < 0.7 ? p.workingLevel : LEVELS[Math.floor(rand() * LEVELS.length)];
        p = applyAnswer(p, { questionId: `q${i}`, bloom: level, correct: rand() < 0.5, adapt }).profile;
        const said = [nextStep(p, { adapt }).why, reasonForPhone(p, level), JSON.stringify(phoneRow(p, { adapt }))].join(' ');
        assert.doesNotMatch(said, LABELS, said);
        assert.doesNotMatch(said, /\d+%/, 'no percentage either');
      }
    }
  });
});

/* ------------------------------------------------------- 7, the identity -- */

describe('a link is verified only by a sign-in (decision 7)', () => {
  test('a profile is unverified unless it says true, links before 0022 included', () => {
    assert.equal(emptyProfile({ sessionId: 's', rollNo: '1' }).accountVerified, false);
    assert.equal(hydrate({ accountId: 'acct-1' }).accountVerified, false, 'an old link, from a typed roll number');
    assert.equal(hydrate({ accountId: 'acct-1', accountVerified: 'true' }).accountVerified, false, 'strictly true');
    assert.equal(hydrate({ accountId: 'acct-1', accountVerified: true }).accountVerified, true);
  });

  test('in-process: a student reads only rows linked to them and verified, never by roll number', async () => {
    const repo = createMemoryRepo();
    const row = (answerKey, extra) => repo.recordAnswer({ sessionId: 's1', answerKey, rollNo: '21CS01', bloom: 'apply', ...extra });
    await row('k1', { accountId: 'acct-1', accountVerified: true });
    await row('k2', { accountId: 'acct-1' }); // linked by a typed roll number
    await row('k3', {}); // unlinked
    await row('k4', { accountId: 'acct-2', accountVerified: true });
    const keys = async (student) => (await repo.listAnswers({ student })).map((a) => a.answerKey).sort();
    assert.deepEqual(await keys({ accountId: 'acct-1', verifiedOnly: true }), ['k1']);
    assert.deepEqual(await keys({ accountId: 'acct-1', rollNo: '21CS01', verifiedOnly: true }), ['k1'], 'the roll number is ignored');
    assert.deepEqual(await keys({ accountId: null, rollNo: '21CS01', verifiedOnly: true }), []);
    assert.deepEqual(await keys({ accountId: 'acct-1', rollNo: '21CS01' }), ['k1', 'k2', 'k3'], 'the professor\'s view is as before');
    assert.equal((await repo.getAnswerByKey('s1', 'k3')).accountVerified, false, 'a row is unverified unless written so');
  });

  test('Supabase: verified only is two equality filters, and no roll number', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (url, init = {}) => {
      seen.push({ url: new URL(String(url)), body: init.body ? JSON.parse(init.body) : null });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      await repo.listAnswers({ sessionIds: ['11111111-1111-1111-1111-111111111111'], student: { accountId: '22222222-2222-2222-2222-222222222222', rollNo: '21CS01', verifiedOnly: true } });
      const p = seen[0].url.searchParams;
      assert.equal(p.get('account_id'), 'eq.22222222-2222-2222-2222-222222222222');
      assert.equal(p.get('account_verified'), 'eq.true');
      assert.equal(p.get('or'), null);
      assert.equal(p.get('roll_no'), null);
      assert.deepEqual(await repo.listAnswers({ student: { verifiedOnly: true } }), []);
      assert.equal(seen.length, 1, 'no account, nothing asked of the database');
      // What a join and an answer write.
      await repo.recordAnswer({ sessionId: 's', answerKey: 'k', rollNo: 'R', bloom: 'apply', accountId: 'a', accountVerified: true }).catch(() => {});
      assert.equal(seen[1].body.account_verified, true);
      await repo.saveProfile({ sessionId: 's', rollNo: 'R', accountId: 'a', accountVerified: true }).catch(() => {});
      assert.equal(seen[2].body.account_verified, true);
      await repo.saveProfile({ sessionId: 's', rollNo: 'R', accountId: 'a' }).catch(() => {});
      assert.equal(seen[3].body.account_verified, false);
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  test('Mongo: verified only is one condition on the account and the flag', async () => {
    const { Answer } = await import('../src/models/index.js');
    const { createMongoRepo } = await import('../src/repo/mongoRepo.js');
    const realFind = Answer.find;
    const seen = [];
    const chain = { sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
    Answer.find = (q) => { seen.push(q); return chain; };
    try {
      const repo = createMongoRepo();
      await repo.listAnswers({ sessionIds: ['s1'], student: { accountId: 'acct-1', rollNo: 'S-1', verifiedOnly: true } });
      assert.deepEqual(seen[0], { sessionId: { $in: ['s1'] }, $or: [{ accountId: 'acct-1', accountVerified: true }] });
      assert.deepEqual(await repo.listAnswers({ student: { verifiedOnly: true } }), []);
      assert.equal(seen.length, 1);
    } finally {
      Answer.find = realFind;
    }
  });
});

/* ------------------------------------------------------ 8, under 18 ------ */

describe('the under-18 mark (decision 8)', () => {
  const roster = [
    { _id: 'a', rollNo: '21CS01', name: 'Asha', under18: true },
    { _id: 'b', rollNo: '21CS02', name: 'Bilal' },
    { _id: 'c', rollNo: '21CS13', name: 'Chitra', under18: true, removedAt: '2026-11-19T10:00:00.000Z' },
  ];

  test('which roll numbers of a room it covers: the roster\'s, and any a mark there was made under', () => {
    const marks = [{ classStudentId: 'c', rollNo: '21CS03' }, { classStudentId: 'b', rollNo: '21CS02' }, { classStudentId: 'a', rollNo: null }];
    assert.deepEqual([...minorRolls(roster, marks)].sort(), ['21CS01', '21CS03', '21CS13']);
    assert.deepEqual([...minorRolls([], [])], []);
  });

  test('a roster row says it, staff-side', () => {
    assert.equal(studentView(roster[0]).under18, true);
    assert.equal(studentView(roster[1]).under18, false);
  });

  test('signalsOff: a class room\'s minor only; a room with no class has no roster to read; a failed read drops the signal', async () => {
    const repo = { listClassStudents: async () => roster, listAttendance: async () => [] };
    assert.equal(await signalsOff(repo, { _id: 's', classId: 'k' }, '21CS01'), true);
    assert.equal(await signalsOff(repo, { _id: 's', classId: 'k' }, '21CS02'), false);
    assert.equal(await signalsOff(repo, { _id: 's', classId: null }, '21CS01'), false);
    assert.equal(await signalsOff(null, null, '21CS01'), false);
    const quiet = console.error;
    console.error = () => {};
    try {
      assert.equal(await signalsOff({ listClassStudents: async () => { throw new Error('down'); }, listAttendance: async () => [] },
        { _id: 's', classId: 'k' }, '21CS02'), true);
    } finally {
      console.error = quiet;
    }
  });

  test('the in-process store keeps the mark on add and on edit, false unless sent', async () => {
    const repo = createMemoryRepo();
    const [a, b] = await repo.addClassStudents('k', [{ rollNo: 'A1', name: 'A', under18: true }, { rollNo: 'A2', name: 'B' }]);
    assert.deepEqual([a.under18, b.under18], [true, false]);
    assert.equal((await repo.updateClassStudent(b._id, { under18: true })).under18, true);
    assert.equal((await repo.updateClassStudent(a._id, { name: 'Asha' })).under18, true, 'an edit of something else keeps it');
  });

  test('the room\'s CSV leaves their signals cell empty, and only theirs', () => {
    const p = (rollNo) => {
      const prof = hydrate(emptyProfile({ sessionId: 's', rollNo, name: rollNo }));
      for (let i = 0; i < 3; i += 1) record(prof, 'hidden', { src: 'reported' });
      return prof;
    };
    const lines = profilesToCsv([p('21CS01'), p('21CS02')], { quiet: new Set(['21CS01']) }).trim().split('\r\n');
    assert.ok(!/Left the page/.test(lines[1]) && lines[1].startsWith('21CS01'), lines[1]);
    assert.ok(/Left the page 3 times/.test(lines[2]) && lines[2].startsWith('21CS02'), lines[2]);
  });

  test('a deleted class room\'s archive keeps no signal of theirs', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'Networks', section: 'A' });
    await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha', under18: true }, { rollNo: '21CS02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'ARCH18', contentId: 'c', title: 'R', classId: cls._id });
    for (const rollNo of ['21CS01', '21CS02']) {
      const prof = hydrate(emptyProfile({ sessionId: String(session._id), rollNo }));
      record(prof, 'paste', { src: 'reported' });
      await repo.saveProfile(prof);
    }
    const { doc } = await buildRoomArchive(repo, session);
    const students = decodeRoomArchive(doc.data).students;
    const of = (roll) => students.find((s) => s.rollNo === roll);
    assert.deepEqual(of('21CS01').integrity, []);
    assert.equal(of('21CS02').integrity.length, 1);
  });

  test('an archive written before a student was marked is served without their signals, as the roster stands now', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'Networks', section: 'B' });
    const [, bilal] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }]);
    const session = await repo.createSession({ code: 'ARCH19', contentId: 'c', title: 'R', classId: cls._id });
    for (const rollNo of ['21CS01', '21CS02', '21CS09']) {
      const prof = hydrate(emptyProfile({ sessionId: String(session._id), rollNo }));
      record(prof, 'paste', { src: 'reported' });
      await repo.saveProfile(prof);
    }
    // Bilal's phone typed 21CS09; his attendance mark was made under it (0021).
    await repo.saveAttendance([{ sessionId: String(session._id), classStudentId: String(bilal._id), rollNo: '21CS09', status: 'present' }]);
    const { doc } = await buildRoomArchive(repo, session);
    const signals = (data) => Object.fromEntries(decodeRoomArchive(data).students.map((s) => [s.rollNo, s.integrity.length]));
    assert.deepEqual(signals(doc.data), { '21CS01': 1, '21CS02': 1, '21CS09': 1 }, 'nobody marked when it was written');
    assert.equal(servedArchive(doc.data, await repo.listClassStudents(cls._id)), doc.data, 'nobody marked now: served as stored');
    await repo.updateClassStudent(bilal._id, { under18: true });
    const served = servedArchive(doc.data, await repo.listClassStudents(cls._id));
    assert.deepEqual(signals(served), { '21CS01': 1, '21CS02': 0, '21CS09': 0 }, 'his roster roll number, and the one his mark was made under');
    assert.deepEqual(signals(doc.data), { '21CS01': 1, '21CS02': 1, '21CS09': 1 }, 'the stored archive is not rewritten');
    const unclassed = { ...doc.data, room: { ...doc.data.room, classId: undefined } };
    assert.equal(servedArchive(unclassed, await repo.listClassStudents(cls._id)), unclassed, 'a room with no class has no roster');
  });
});

describe('what a student reads of a linked room: their own verified answers only (decision 7)', () => {
  const answered = (profile, key, { bloom = 'apply', correct = true, questionId = key } = {}) => applyAnswer(profile, {
    questionId, bloom, correct, answerId: key, topic: 'T',
  }).profile;

  test('a profile all of whose answers are theirs comes back unchanged, working level and all', () => {
    let p = hydrate(emptyProfile({ sessionId: 's', rollNo: '21CS01' }));
    p = answered(p, 'k1');
    p = answered(p, 'k2', { correct: false });
    const { profile, whole } = verifiedView(p, new Set(['k1', 'k2']));
    assert.equal(whole, true);
    assert.equal(profile, p);
  });

  test('answers a phone that did not sign in sent leave the trail, the tallies and the working level', () => {
    let p = hydrate(emptyProfile({ sessionId: 's', rollNo: '21CS01' }));
    p = answered(p, 'guest-1', { bloom: 'understand', correct: false });
    p = answered(p, 'mine-1', { bloom: 'apply' });
    p = answered(p, 'guest-2', { bloom: 'apply', correct: true });
    p = answered(p, 'mine-2', { bloom: 'apply', correct: false });
    const { profile, whole } = verifiedView(p, new Set(['mine-1', 'mine-2']));
    assert.equal(whole, false);
    assert.deepEqual(profile.history.map((h) => h.answerId), ['mine-1', 'mine-2']);
    assert.deepEqual([profile.levels.apply, profile.levels.understand], [{ seen: 2, correct: 1 }, { seen: 0, correct: 0 }]);
    assert.equal(profile.workingLevel, null, 'set by the others\' answers too');
    assert.ok(LEVELS.every((l) => profile.levels[l]), 'every level is there');
    assert.equal(p.history.length, 4, 'the room\'s own profile is untouched');
  });

  test('a redemption pairing with an answer that is not theirs is left off', () => {
    let p = hydrate(emptyProfile({ sessionId: 's', rollNo: '21CS01' }));
    p = applyAnswer(p, { questionId: 'q1', bloom: 'apply', correct: false, answerId: 'guest-1', redemption: true }).profile;
    p = applyAnswer(p, { questionId: 'q2', bloom: 'apply', correct: true, answerId: 'mine-1', redemption: true }).profile;
    assert.equal(p.history[1].redeems, 'q1', 'the room paired them');
    const { profile } = verifiedView(p, new Set(['mine-1']));
    assert.ok(!('redeems' in profile.history[0]), JSON.stringify(profile.history[0]));
  });

  test('the keys are her verified final answers per room, never a vote or another phone\'s', async () => {
    const repo = createMemoryRepo();
    const row = (sessionId, answerKey, extra) => repo.recordAnswer({ sessionId, answerKey, rollNo: '21CS01', bloom: 'apply', final: true, ...extra });
    await row('r1', 'k1', { accountId: 'acct-1', accountVerified: true });
    await row('r1', 'k2', { accountId: 'acct-1' });
    await row('r1', 'k3', { accountId: 'acct-1', accountVerified: true, final: false });
    await row('r1', 'k4', { accountId: 'acct-1', accountVerified: true, classQuestionId: 'cq1', round: 1 });
    await row('r2', 'k5', { accountId: 'acct-1', accountVerified: true });
    const keys = await verifiedKeys(repo, { sessionIds: ['r1', 'r2', 'r3'], accountId: 'acct-1' });
    assert.deepEqual([...keys.entries()].map(([room, set]) => [room, [...set]]), [['r1', ['k1']], ['r2', ['k5']], ['r3', []]]);
    assert.deepEqual([...(await verifiedKeys(repo, { sessionIds: ['r1'], accountId: null })).get('r1')], []);
  });
});

/* ------------------------------------------------------------- the rest -- */

describe('who wrote it, and the room on the wall', () => {
  const multi = (over) => ({
    _id: 'q1', contentId: 'c1', topic: 'T', status: 'active', bloom: 'analyse', kind: 'multi',
    text: 'Which hold? Select all that apply.', options: ['A one.', 'B two.', 'C three.', 'D four.'], answerIdxs: [0], ...over,
  });
  const merged = (a, b) => mergeQuestions(multi({ source: a }), multi({ _id: 'q2', source: b, options: ['E five.', 'F six.'], answerIdxs: [1] })).question.source;

  test('a merge takes the least model-like source: template, then the professor\'s, then the model\'s', () => {
    assert.equal(merged('fallback', 'teacher'), 'fallback');
    assert.equal(merged('teacher', 'llm'), 'teacher');
    assert.equal(merged('llm', 'teacher'), 'teacher');
    assert.equal(merged('teacher', 'teacher'), 'teacher');
    assert.equal(merged('llm', 'llm'), 'llm');
  });

  test('the projector is told how the room runs, beside what its screen shows', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'WALL01', contentId: 'c', title: 'R', mode: 'teacher-led', classId: 'k' });
    const state = toProjector('projector:state', await projectorPayload(repo, room));
    assert.equal(state.roomMode, 'teacher-led');
    assert.equal(state.mode, 'question', 'the screen\'s own mode is unchanged');
    const plain = await repo.createSession({ code: 'WALL02', contentId: 'c', title: 'R' });
    assert.equal(toProjector('projector:state', await projectorPayload(repo, plain)).roomMode, 'devices');
  });
});

/* ------------------------------------------------------- the boot probe -- */

describe('the Supabase boot probe names the migration to apply (deploy safety)', () => {
  /**
   * A stand-in for PostgREST that knows every table and column except `missing`
   * ("table" or "table.column"), and answers as PostgREST does: a 404 with its
   * error for a missing table, a 400 for a missing column.
   */
  async function probeWith(missing, { boot = false } = {}) {
    const { config } = await import('../src/config.js');
    const { probeSupabase } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const asked = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      if (u.origin !== 'http://supabase.invalid') throw new Error(`refused: ${u.origin}`);
      asked.push(init.method ?? 'GET');
      const table = u.pathname.replace('/rest/v1/', '');
      const cols = (u.searchParams.get('select') ?? '*').split(',').map((c) => c.trim());
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (missing.includes(table)) return json(404, { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` });
      const gone = cols.find((c) => missing.includes(`${table}.${c}`));
      if (gone) return json(400, { code: '42703', message: `column ${table}.${gone} does not exist` });
      return json(200, []);
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      if (!boot) return { result: await probeSupabase(), asked };
      const { initStore, getRepo } = await import('../src/repo/index.js');
      const lines = [];
      await initStore({ log: (line) => lines.push(line) });
      return { lines, kind: getRepo().kind, asked };
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  }

  test('everything there: no warning, and no request is a HEAD (a HEAD cannot see a missing table)', async () => {
    const { result, asked } = await probeWith([]);
    assert.deepEqual(result, { warnings: [] });
    assert.ok(asked.length > 30 && asked.every((m) => m === 'GET'), asked.join(','));
  });

  test('a missing column only some routes write: a warning naming the file, and what fails until it is applied', async () => {
    const { result } = await probeWith(['attendance.roll_no', 'attainment_configs']);
    assert.equal(result.warnings.length, 2);
    assert.match(result.warnings[0], /^the attainment_configs table is missing: apply supabase\/migrations\/0020_attainment_configs\.sql/);
    const roll = result.warnings.find((w) => /roll_no/.test(w));
    assert.match(roll, /attendance\.roll_no is missing: apply supabase\/migrations\/0021_attendance_roll\.sql/);
    assert.match(roll, /Until it is applied, every attendance mark fails to save/);
  });

  test('a missing piece every room writes stops the probe, naming the file', async () => {
    await assert.rejects(probeWith(['profiles.account_verified', 'course_outcomes']), (err) => {
      assert.match(err.message, /profiles\.account_verified is missing: apply supabase\/migrations\/0022_owner_decisions\.sql/);
      assert.doesNotMatch(err.message, /course_outcomes/, 'route-only pieces are warnings, after the room schema is whole');
      return true;
    });
    await assert.rejects(probeWith(['projector_links']), /the projector_links table is missing: apply supabase\/migrations\/0018_room_modes_and_projector\.sql/);
  });

  test('at boot: Supabase is kept, and the log names the migration to apply', async () => {
    const { lines, kind } = await probeWith(['attendance.roll_no'], { boot: true });
    assert.equal(kind, 'supabase');
    assert.ok(lines.some((l) => /^\[store\] WARNING: attendance\.roll_no is missing: apply supabase\/migrations\/0021_attendance_roll\.sql/.test(l)),
      lines.join('\n'));
  });
});
