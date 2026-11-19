// Phase 3 - how a room runs (0018): its settings, the waiting room, Teacher-led
// and Mixed, and the projector's whitelist. The end-to-end half, with real
// phones and a real projector connection, is server/scripts/modes.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  applyAnswer,
  emptyProfile,
  hydrate,
  isSlowLearner,
  sessionSettings,
} from '../src/services/mastery.js';
import { selectNext } from '../src/services/selector.js';
import { buildRoomArchive } from '../src/services/archive.js';
import { roomFeed, startBlocker, waitingLine, capReason } from '../src/services/modes.js';
import * as wall from '../src/services/projector.js';
import {
  PROJECTOR_FIELDS,
  TOKEN_SHAPE,
  linkView,
  newToken,
  projectorPayload,
  screenChangeFrom,
  screenOf,
  setScreen,
  showPick,
  toProjector,
  tokenHash,
} from '../src/services/projector.js';

const LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

describe('a room\'s settings (sessionSettings)', () => {
  test('a room from before 0018 reads as it ran: devices, adapting, from Understand, no cap, no time', () => {
    const s = sessionSettings({ masteryGoal: 0.8, reattempts: 0, redemption: false });
    assert.deepEqual(
      [s.mode, s.adapt, s.startLevel, s.questionsPerStudent, s.timePerQuestion],
      ['devices', true, 'understand', null, null],
    );
  });

  test('what a room set is read back; anything malformed falls back to how rooms ran', () => {
    const set = sessionSettings({ mode: 'mixed', adapt: false, startLevel: 'apply', questionsPerStudent: 12, timePerQuestion: 60 });
    assert.deepEqual([set.mode, set.adapt, set.startLevel, set.questionsPerStudent, set.timePerQuestion], ['mixed', false, 'apply', 12, 60]);
    const odd = sessionSettings({ mode: 'lecture', adapt: 'no', startLevel: 'analyze', questionsPerStudent: 0, timePerQuestion: 5 });
    assert.deepEqual([odd.mode, odd.adapt, odd.startLevel, odd.questionsPerStudent, odd.timePerQuestion],
      ['devices', true, 'understand', null, null], 'only a strict false turns adapting off');
  });
});

describe('the start level and the adapt switch', () => {
  test('a new student starts at the room\'s level, and the default sentence is unchanged', () => {
    assert.equal(emptyProfile({ sessionId: 's', rollNo: '1' }).reason, 'No history yet - starting at Understand.');
    const p = emptyProfile({ sessionId: 's', rollNo: '1', startLevel: 'apply' });
    assert.deepEqual([p.workingLevel, p.reason], ['apply', 'No history yet - starting at Apply.']);
    assert.equal(emptyProfile({ sessionId: 's', rollNo: '1', startLevel: 'nonsense' }).workingLevel, 'understand');
  });

  test('with adapt off, five right answers record the accuracy and move nobody', () => {
    let on = hydrate(emptyProfile({ sessionId: 's', rollNo: '1' }));
    let off = hydrate(emptyProfile({ sessionId: 's', rollNo: '1' }));
    for (let i = 0; i < 5; i += 1) {
      ({ profile: on } = applyAnswer(on, { questionId: `q${i}`, bloom: 'understand', correct: true }));
      ({ profile: off } = applyAnswer(off, { questionId: `q${i}`, bloom: 'understand', correct: true, adapt: false }));
    }
    assert.equal(on.workingLevel, 'apply', 'the ladder promotes in a room that adapts');
    assert.equal(off.workingLevel, 'understand', 'and holds in a room that does not');
    assert.deepEqual(off.levels.understand, { seen: 5, correct: 5 }, 'the answers are recorded all the same');
    assert.match(off.reason, /Adaptive levels are off in this room - staying at Understand/);
  });

  test('with adapt off, the below-40% ceiling still holds (CONTRACT section 6 rule 4)', () => {
    let p = hydrate(emptyProfile({ sessionId: 's', rollNo: '1', startLevel: 'apply' }));
    for (let i = 0; i < 4; i += 1) ({ profile: p } = applyAnswer(p, { questionId: `w${i}`, bloom: 'apply', correct: false, adapt: false }));
    assert.equal(p.workingLevel, 'apply', 'the level stays where it started');
    assert.ok(isSlowLearner(p));
    assert.match(p.reason, /below-40% band - serving Remember and Understand items only/);
    const bank = LEVELS.flatMap((bloom) => [1, 2].map((n) => ({ _id: `${bloom}${n}`, bloom, status: 'active' })));
    for (let i = 0; i < 6; i += 1) {
      const pick = selectNext(p, bank);
      assert.ok(['remember', 'understand'].includes(pick.level), `served ${pick.level}`);
    }
  });
});

describe('the waiting room and the feed', () => {
  test('"N / M present" in a class room, "N joined" without one; a phone is needed to start, except Teacher-led', () => {
    const rows = [{ rollNo: '1', answered: 0 }, { rollNo: '2', answered: 0 }];
    assert.deepEqual(waitingLine({ status: 'waiting' }, rows, { present: 30, classSize: 36 }),
      { joinedN: 2, present: 30, classSize: 36, summary: '2 / 30 present', canStart: true });
    assert.deepEqual(waitingLine({ status: 'waiting' }, rows), { joinedN: 2, present: null, classSize: null, summary: '2 joined', canStart: true });
    const empty = waitingLine({ status: 'waiting' }, []);
    assert.equal(empty.canStart, false);
    assert.match(empty.reason, /No phone has joined/);
    assert.equal(startBlocker({ mode: 'teacher-led' }, 0), null);
    assert.match(capReason(1), /asks each student 1 question,/);
  });

  test('an open Student-devices room\'s grid gets nothing new', async () => {
    const repo = createMemoryRepo();
    assert.deepEqual(await roomFeed(repo, { _id: 'r', status: 'open', mode: 'devices' }, []), {});
  });

  test('a Mixed room\'s feed keeps digital answers and teacher records apart, each labelled', async () => {
    const repo = createMemoryRepo();
    const session = await repo.createSession({ code: 'MIX001', contentId: 'c', status: 'open', mode: 'mixed', startedAt: '2026-11-19T04:00:00.000Z' });
    await repo.addObservation({ sessionId: session._id, classId: null, classStudentId: null, rollNo: '1', day: '2026-11-19', kind: 'revision', note: '' });
    await repo.addObservation({ sessionId: session._id, classId: null, classStudentId: null, rollNo: '2', day: '2026-11-19', kind: 'understood', note: '' });
    await repo.addObservation({ sessionId: session._id, classId: null, classStudentId: null, rollNo: '2', day: '2026-11-19', kind: null, note: '' });
    const { feed } = await roomFeed(repo, session, [{ rollNo: '1', answered: 3 }, { rollNo: '2', answered: 0 }]);
    assert.equal(feed.digital.label, 'Digital answers');
    assert.deepEqual([feed.digital.joined, feed.digital.answered, feed.digital.answers], [2, 1, 3]);
    assert.equal(feed.teacher.label, 'Teacher records');
    assert.deepEqual([feed.teacher.observations.revision, feed.teacher.observations.understood, feed.teacher.observations.observed], [1, 0, 1],
      'a cleared mark is not counted');
    const tl = await roomFeed(repo, { ...session, mode: 'teacher-led' }, []);
    assert.equal(tl.feed.digital, undefined, 'a Teacher-led room has no digital answers to show');
  });
});

describe('the archive keeps how the room ran', () => {
  test('only the settings a room changed, so a room on the defaults archives as before', async () => {
    const repo = createMemoryRepo();
    const plain = await repo.createSession({ code: 'ARC001', contentId: 'c', status: 'closed', masteryGoal: 0.8, reattempts: 0, redemption: false });
    const set = await repo.createSession({ code: 'ARC002', contentId: 'c', status: 'closed', masteryGoal: 0.8, reattempts: 0, redemption: false,
      mode: 'mixed', adapt: false, timePerQuestion: 90 });
    assert.deepEqual((await buildRoomArchive(repo, plain)).doc.data.room.settings, { masteryGoal: 0.8, reattempts: 0, redemption: false });
    assert.deepEqual((await buildRoomArchive(repo, set)).doc.data.room.settings,
      { masteryGoal: 0.8, reattempts: 0, redemption: false, mode: 'mixed', adapt: false, timePerQuestion: 90 });
  });

  test('a room opened for no class archives with no classId key, as before 0016; a class room keeps its class', async () => {
    const repo = createMemoryRepo();
    const plain = await repo.createSession({ code: 'ARC003', contentId: 'c', status: 'closed', masteryGoal: 0.8, reattempts: 0, redemption: false });
    const cls = await repo.createSession({ code: 'ARC004', contentId: 'c', status: 'closed', masteryGoal: 0.8, reattempts: 0, redemption: false,
      classId: 'class-1' });
    assert.equal('classId' in (await buildRoomArchive(repo, plain)).doc.data.room, false);
    assert.equal((await buildRoomArchive(repo, cls)).doc.data.room.classId, 'class-1');
  });
});

describe('projector links', () => {
  test('a token is 256 random bits, kept only as its SHA-256, and a link\'s view never carries either', () => {
    const a = newToken();
    const b = newToken();
    assert.match(a, TOKEN_SHAPE);
    assert.notEqual(a, b);
    assert.match(tokenHash(a), /^[0-9a-f]{64}$/);
    assert.notEqual(tokenHash(a), tokenHash(b));
    const view = linkView({ _id: 'l', tokenHash: tokenHash(a), createdAt: new Date().toISOString(), revokedAt: null });
    assert.deepEqual(Object.keys(view).sort(), ['active', 'createdAt', 'createdBy', 'expiresAt', 'id', 'revokedAt', 'revokedBy']);
  });

  test('a link stops working PROJECTOR_LINK_HOURS after it was made, and says when', () => {
    const now = Date.parse('2026-11-19T10:00:00.000Z');
    const hours = (h) => new Date(now - h * 3600 * 1000).toISOString();
    assert.equal(wall.PROJECTOR_LINK_HOURS, 12);
    const fresh = linkView({ _id: 'l1', createdAt: hours(11), revokedAt: null }, new Date(now));
    assert.deepEqual([fresh.active, fresh.expiresAt], [true, new Date(now + 3600 * 1000).toISOString()]);
    assert.equal(linkView({ _id: 'l2', createdAt: hours(13), revokedAt: null }, new Date(now)).active, false);
    assert.equal(wall.linkExpired({ createdAt: hours(13) }, new Date(now)), true);
    assert.equal(wall.linkExpired({ createdAt: hours(1) }, new Date(now)), false);
    assert.equal(wall.linkExpired({ createdAt: 'not a time' }, new Date(now)), true, 'a link with no readable creation time works for nobody');
  });

  test('the memory repo: one token per link, found by its hash, revoked in place, gone with its room', async () => {
    const repo = createMemoryRepo();
    const room = await repo.createSession({ code: 'LNK001', contentId: 'c', status: 'open' });
    const made = await repo.addProjectorLink({ sessionId: room._id, tokenHash: 'a'.repeat(64), createdBy: null });
    await assert.rejects(repo.addProjectorLink({ sessionId: room._id, tokenHash: 'a'.repeat(64) }), (err) => err.status === 409);
    assert.equal((await repo.getProjectorLinkByHash('a'.repeat(64)))._id, made._id);
    const revoked = await repo.revokeProjectorLink(made._id, { revokedAt: '2026-11-19T05:00:00.000Z', revokedBy: 'p' });
    assert.deepEqual([revoked.revokedAt, revoked.revokedBy, revoked.tokenHash], ['2026-11-19T05:00:00.000Z', 'p', 'a'.repeat(64)]);
    await repo.deleteSession(room._id);
    assert.equal(await repo.getProjectorLinkByHash('a'.repeat(64)), null);
  });
});

describe('what the projector may show', () => {
  test('the whitelist drops anything it does not name, at every depth', () => {
    const out = toProjector('projector:state', {
      code: 'ABC234', mode: 'question', name: 'Asha Rao', accuracy: 0.4,
      question: { text: 'Q', options: [{ key: 'A', label: 'x', correct: true }], answerIdx: 2, correct: null, stimulus: { kind: 'image', url: '/u', alt: 'a', sourceRef: 'secret' } },
      progress: { present: 3, levels: [{ level: 'apply', answers: 2, accuracy: 0.5 }], bands: [1, 2] },
      pick: { rollNo: '21CS01', firstName: 'Asha', name: 'Asha Rao', status: 'help' },
    });
    assert.deepEqual(out, {
      code: 'ABC234', mode: 'question',
      question: { text: 'Q', options: [{ key: 'A', label: 'x' }], correct: null, stimulus: { kind: 'image', url: '/u', alt: 'a' } },
      progress: { present: 3, levels: [{ level: 'apply', answers: 2 }] },
      pick: { rollNo: '21CS01', firstName: 'Asha' },
    });
    assert.deepEqual(toProjector('projector:refused', { reason: 'r', token: 't' }), { reason: 'r' });
    assert.ok(Object.keys(PROJECTOR_FIELDS).every((k) => k.startsWith('projector:')));
  });

  async function room(extra = {}) {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Trees', kind: 'syllabus', rawText: '', topics: ['T'] });
    const [mcq, tf, open] = await repo.insertQuestions([
      { contentId: content._id, topic: 'T', bloom: 'remember', kind: 'mcq', text: 'Root first?', options: ['In', 'Pre', 'Post', 'Level'], answerIdx: 1,
        stimulus: { kind: 'image', url: '/api/media/abc', alt: 'A tree', sourceRef: 'Unit 3' } },
      { contentId: content._id, topic: 'T', bloom: 'understand', kind: 'truefalse', text: 'A heap is a tree.', answerBool: true },
      { contentId: content._id, topic: 'T', bloom: 'create', kind: 'open', text: 'Design a tree.', rubric: ['balance', 'height'] },
    ]);
    const session = await repo.createSession({ code: 'WAL001', contentId: content._id, title: 'Trees', status: 'open', ...extra });
    return { repo, session, mcq, tf, open };
  }

  test('a bank question: its options, and no key until it is revealed (a Teacher-led room)', async () => {
    const { repo, session, mcq, tf, open } = await room({ mode: 'teacher-led', classId: 'class-1' });
    const servable = await repo.listQuestions(session.contentId);
    const mode = 'teacher-led';
    setScreen(session, screenChangeFrom({ question: { questionId: String(mcq._id) } }, screenOf(session), { servable, mode }));
    let shown = await projectorPayload(repo, session);
    assert.deepEqual(shown.question.options.map((o) => `${o.key}:${o.label}`), ['A:In', 'B:Pre', 'C:Post', 'D:Level']);
    assert.equal(shown.question.correct, null);
    assert.deepEqual(shown.question.stimulus, { kind: 'image', url: '/api/media/abc', alt: 'A tree' }, 'never the professor\'s citation');
    assert.doesNotMatch(JSON.stringify(shown), /answerIdx|answerBool|rubric|solution/);

    setScreen(session, screenChangeFrom({ revealed: true }, screenOf(session), { servable, mode }));
    shown = await projectorPayload(repo, session);
    assert.deepEqual([shown.question.revealed, shown.question.correct], [true, ['B']]);

    setScreen(session, screenChangeFrom({ question: { questionId: String(tf._id) } }, screenOf(session), { servable, mode }));
    shown = await projectorPayload(repo, session);
    assert.deepEqual([shown.question.revealed, shown.question.correct], [false, null], 'a new question goes up unrevealed');
    assert.deepEqual(shown.question.options.map((o) => o.label), ['True', 'False']);

    setScreen(session, screenChangeFrom({ question: { questionId: String(open._id) }, revealed: true }, screenOf(session), { servable, mode }));
    shown = await projectorPayload(repo, session);
    assert.deepEqual([shown.question.options, shown.question.correct], [[], null], 'a written answer is shown as its stem, never its rubric');
    assert.doesNotMatch(JSON.stringify(shown), /balance|height/);
  });

  test('a professor\'s change is checked against the room', async () => {
    const { repo, session, mcq, tf } = await room();
    const servable = await repo.listQuestions(session.contentId);
    const now = screenOf(session);
    const refused = (body, ctx = { servable }) => assert.throws(() => screenChangeFrom(body, now, ctx), (err) => err.status === 400);
    refused({});
    refused({ mode: 'leaderboard' });
    refused({ revealed: 'yes' });
    refused({ question: { questionId: '0123456789abcdef01234567' } });
    refused({ question: { questionId: String(mcq._id), tallyId: 'x' } });
    refused({ diagram: { questionId: String(tf._id) } }, { servable });
    refused({ question: { questionId: String(mcq._id) } }, { servable: servable.filter((q) => q._id !== mcq._id) });
    const next = screenChangeFrom({ mode: 'diagram', diagram: { questionId: String(mcq._id) } }, now, { servable });
    assert.deepEqual([next.mode, next.diagram], ['diagram', { questionId: String(mcq._id) }]);
  });

  test('a key never goes on the wall while a phone in the room could still be served the question', async () => {
    const { repo, session, mcq } = await room();
    const servable = await repo.listQuestions(session.contentId);
    const fromBank = { _id: 't1', questionId: String(mcq._id), text: 'Root first?', correct: 1 };
    const typed = { _id: 't2', questionId: null, text: 'Asked aloud', correct: 2 };
    const tallies = [fromBank, typed];
    const refused = (body, current, mode) => assert.throws(
      () => screenChangeFrom(body, current, { servable, tallies, mode }),
      (err) => err.status === 409 && /phone/.test(err.message),
    );
    const onBank = screenChangeFrom({ question: { questionId: String(mcq._id) } }, screenOf(session), { servable, mode: 'devices' });
    for (const mode of ['devices', 'mixed']) {
      refused({ revealed: true }, onBank, mode);
      refused({ question: { questionId: String(mcq._id) }, revealed: true }, screenOf(session), mode);
      refused({ question: { tallyId: 't1' }, revealed: true }, screenOf(session), mode);
      const onTally = screenChangeFrom({ question: { tallyId: 't1' } }, screenOf(session), { servable, tallies, mode });
      refused({ revealed: true }, onTally, mode);
      const onTyped = screenChangeFrom({ question: { tallyId: 't2' } }, screenOf(session), { servable, tallies, mode });
      assert.equal(screenChangeFrom({ revealed: true }, onTyped, { servable, tallies, mode }).revealed, true,
        'a question typed in by the professor is no bank question: its key may go up');
    }
    assert.throws(() => screenChangeFrom({ revealed: true }, onBank, { servable }), (err) => err.status === 409,
      'a caller that does not say the mode gets the strict rule');
    assert.equal(screenChangeFrom({ revealed: true }, onBank, { servable, mode: 'teacher-led' }).revealed, true,
      'no phone is served in a Teacher-led room');
    assert.equal(screenChangeFrom({ revealed: false }, onBank, { servable, mode: 'mixed' }).revealed, false, 'taking a key down is always allowed');
  });

  test('progress is counts, and a pick is a roll number and a first name, or the roll number alone', async () => {
    const { repo, session } = await room();
    let p = emptyProfile({ sessionId: String(session._id), rollNo: '21CS01', name: 'Asha Rao' });
    ({ profile: p } = applyAnswer(p, { questionId: 'q1', bloom: 'apply', correct: false }));
    await repo.saveProfile(p);
    await repo.saveProfile(emptyProfile({ sessionId: String(session._id), rollNo: '21CS02', name: 'Bilal Khan' }));
    await repo.addWheelRound({ sessionId: session._id, round: 1, presentOnly: false, noRepeat: true });
    const pick = await repo.addWheelPick({ sessionId: session._id, round: 1, order: 1, rollNo: '21CS01', classStudentId: null, poolSize: 2, presentOnly: false, noRepeat: true });
    setScreen(session, screenChangeFrom({ mode: 'progress' }, screenOf(session), {}));
    showPick(session, pick._id);
    let shown = await projectorPayload(repo, session);
    assert.equal(wall.MIN_ANSWERED_FOR_LEVELS, 5);
    assert.deepEqual(shown.progress, { present: 2, classSize: null, answered: 1, levels: null, minAnswered: 5 },
      'one student\'s answers are that student\'s: no per-level count until five have answered');
    assert.deepEqual(shown.pick, { rollNo: '21CS01', firstName: 'Asha' });
    assert.doesNotMatch(JSON.stringify(shown), /Rao|Bilal|accuracy|score|band|slowLearner/);
    setScreen(session, screenChangeFrom({ showNames: false }, screenOf(session), {}));
    shown = await projectorPayload(repo, session);
    assert.deepEqual(shown.pick, { rollNo: '21CS01', firstName: null });

    for (const roll of ['21CS03', '21CS04', '21CS05', '21CS06']) {
      let q = emptyProfile({ sessionId: String(session._id), rollNo: roll, name: roll });
      ({ profile: q } = applyAnswer(q, { questionId: 'q1', bloom: 'understand', correct: true }));
      await repo.saveProfile(q);
    }
    shown = await projectorPayload(repo, session);
    assert.deepEqual(shown.progress, {
      present: 6, classSize: null, answered: 5, minAnswered: 5,
      levels: LEVELS.map((level) => ({
        level, label: level[0].toUpperCase() + level.slice(1), answers: { apply: 1, understand: 4 }[level] ?? 0,
      })),
    }, 'from five students who have answered, the counts per level go up');
  });

  test('the names toggle: on for a room opened since this server started, off for one it cannot remember', () => {
    const before = { _id: 'names-old', startedAt: '2020-01-01T00:00:00.000Z' };
    const since = { _id: 'names-new', startedAt: new Date().toISOString() };
    assert.equal(screenOf(before).showNames, false, 'the toggle may have been off before a restart: names stay off until turned on');
    assert.equal(screenOf(since).showNames, true, 'the handoff\'s default for a room this server has seen from the start');
    assert.equal(screenOf({ _id: 'names-none' }).showNames, false, 'no start time, no guess');
    setScreen(before, { ...screenOf(before), showNames: true });
    assert.equal(screenOf(before).showNames, true, 'and turned on, it is on');
  });
});

// Not a database test: no Supabase is reachable from here. This pins the
// requests the Supabase repo sends for the room's settings and its links.
describe('the Supabase repo\'s requests for 0018', () => {
  test('a room writes and reads its five settings; a link is written as its hash, and a taken token is a 409', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const ROOM = '22222222-2222-4222-8222-222222222222';
    let nextReply = null;
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(String(url));
      seen.push({ url: u, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : null });
      const r = nextReply ?? { status: 201, body: {} };
      nextReply = null;
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      nextReply = { status: 201, body: { id: ROOM, code: 'SET001', content_id: 'c', status: 'waiting', mastery_goal: '0.80', reattempts: 0,
        redemption: false, question_ids: null, class_id: null, mode: 'mixed', adapt: false, start_level: 'apply', questions_per_student: 12,
        time_per_question: 60 } };
      const room = await repo.createSession({ code: 'SET001', contentId: 'c', status: 'waiting', mode: 'mixed', adapt: false, startLevel: 'apply',
        questionsPerStudent: 12, timePerQuestion: 60 });
      assert.deepEqual([seen[0].body.status, seen[0].body.mode, seen[0].body.adapt, seen[0].body.start_level,
        seen[0].body.questions_per_student, seen[0].body.time_per_question], ['waiting', 'mixed', false, 'apply', 12, 60]);
      assert.deepEqual([room.status, room.mode, room.adapt, room.startLevel, room.questionsPerStudent, room.timePerQuestion],
        ['waiting', 'mixed', false, 'apply', 12, 60]);

      nextReply = { status: 201, body: { id: ROOM, code: 'SET002', content_id: 'c', status: 'open', mastery_goal: '0.80' } };
      await repo.createSession({ code: 'SET002', contentId: 'c' });
      assert.deepEqual([seen[1].body.mode, seen[1].body.adapt, seen[1].body.start_level, seen[1].body.questions_per_student,
        seen[1].body.time_per_question], ['devices', true, 'understand', null, null], 'a room that sets nothing gets the old behaviour');

      nextReply = { status: 201, body: { id: 'l1', session_id: ROOM, token_hash: 'a'.repeat(64), created_at: 'T', created_by: null, revoked_at: null } };
      const link = await repo.addProjectorLink({ sessionId: ROOM, tokenHash: 'a'.repeat(64), createdBy: null });
      assert.equal(seen[2].url.pathname, '/rest/v1/projector_links');
      assert.deepEqual(Object.keys(seen[2].body).sort(), ['created_at', 'created_by', 'session_id', 'token_hash']);
      assert.deepEqual([link.tokenHash, link.revokedAt], ['a'.repeat(64), null]);

      nextReply = { status: 409, body: { code: '23505', message: 'duplicate key value violates unique constraint "projector_links_token_hash_key"' } };
      await assert.rejects(repo.addProjectorLink({ sessionId: ROOM, tokenHash: 'a'.repeat(64) }), (err) => err.status === 409);

      assert.deepEqual(await repo.listProjectorLinks('not-a-uuid'), []);
      assert.equal(await repo.revokeProjectorLink('not-a-uuid', { revokedAt: 'T' }), null);
      assert.equal(seen.length, 4, 'no request for a malformed id');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});

// Not a database test either: the Mongo schemas, checked by building documents.
describe('the Mongo schemas for 0018', () => {
  test('a room may be created waiting and keeps its settings; a link holds a 64-character hash', async () => {
    const { Session, ProjectorLink } = await import('../src/models/index.js');
    const room = new Session({ code: 'MON001', contentId: '0123456789abcdef01234567', status: 'waiting', mode: 'teacher-led',
      adapt: false, startLevel: 'evaluate', questionsPerStudent: 10, timePerQuestion: 30 });
    assert.equal(room.validateSync(), undefined);
    assert.deepEqual([room.mode, room.adapt, room.startLevel, room.questionsPerStudent, room.timePerQuestion], ['teacher-led', false, 'evaluate', 10, 30]);
    const plain = new Session({ code: 'MON002', contentId: '0123456789abcdef01234567' });
    assert.deepEqual([plain.status, plain.mode, plain.adapt, plain.startLevel, plain.questionsPerStudent, plain.timePerQuestion],
      ['open', 'devices', true, 'understand', null, null]);
    assert.ok(new Session({ code: 'MON003', contentId: '0123456789abcdef01234567', status: 'started' }).validateSync());
    assert.ok(new Session({ code: 'MON004', contentId: '0123456789abcdef01234567', timePerQuestion: 5 }).validateSync());
    assert.equal(new ProjectorLink({ sessionId: 's', tokenHash: 'a'.repeat(64) }).validateSync(), undefined);
    assert.ok(new ProjectorLink({ sessionId: 's', tokenHash: 'not-a-hash' }).validateSync());
  });
});
