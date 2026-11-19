// Phase 3: live insights, the student card and class analytics. The pure parts:
// the three accuracy bands (the floor and the cut points), the histogram's
// buckets, the insight cards' text and their dismissal rule, the series and its
// "since the start", the planned next set and its clipping at the ends, the
// sort orders, and the class report's level bands. The end-to-end half, with a
// real class room, phones, teacher records and a projector, is
// server/scripts/insights.mjs.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { applyAnswer, emptyProfile, hydrate, isSlowLearner } from '../src/services/mastery.js';
import {
  BAND_CUTS,
  MIN_BAND_ANSWERS,
  SERIES_POINTS,
  bandFor,
  bucketOf,
  focusCard,
  forgetInsights,
  histogram,
  latestActions,
  noteSample,
  participationCard,
  plannedNextSet,
  rollsDigest,
  roomFigures,
  classLevels,
  seriesOf,
  sortOrders,
  standingOf,
  supportCard,
  withActions,
} from '../src/services/insights.js';
import { LEVEL_BANDS, classAnalytics, levelBandsOf, levelViews, roomReport, windowFrom } from '../src/services/classAnalytics.js';

const LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

/** A profile from a list of [level, right] answers, through the engine itself. */
function profileOf(rollNo, answers = [], extra = {}) {
  let p = emptyProfile({ sessionId: 'room', rollNo, name: `Student ${rollNo}` });
  answers.forEach(([bloom, correct], i) => {
    p = applyAnswer(p, { questionId: `${rollNo}-q${i}`, bloom, correct, answerId: `${rollNo}-a${i}` }).profile;
  });
  return { ...p, ...extra };
}

/** `right` of `n` answers at Understand. */
const scored = (rollNo, right, n) => profileOf(rollNo, Array.from({ length: n }, (_, i) => ['understand', i < right]));

const room = { _id: 'room', code: 'INS001', classId: null, startedAt: '2026-11-19T04:00:00.000Z', status: 'open' };
const status400 = (fn) => assert.throws(fn, (err) => err.status === 400);

describe('the three accuracy bands', () => {
  test('one pair of cut points: 0.4, the engine\'s own line, and 0.6, the handoff\'s legend', () => {
    assert.deepEqual({ ...BAND_CUTS }, { needsSupportBelow: 0.4, excellingFrom: 0.6 });
    assert.equal(MIN_BAND_ANSWERS, 3);
  });

  test('no band below three graded answers: not enough answers yet, never a guess', () => {
    assert.equal(bandFor(0, 0), null);
    assert.equal(bandFor(0, 2), null, 'two wrong is not yet a band');
    assert.equal(bandFor(2, 2), null, 'two right is not yet a band');
    assert.equal(bandFor(0, 3), 'needs-support');
    assert.equal(bandFor(3, 3), 'excelling');
  });

  test('the cut points: 40% is Developing, 60% is Excelling, exactly, at any number of answers', () => {
    assert.equal(bandFor(2, 5), 'developing', '2 of 5 is 40%');
    assert.equal(bandFor(6, 15), 'developing', '6 of 15 is 40%, where 0.4 * 15 is not 6 in floating point');
    assert.equal(bandFor(39, 100), 'needs-support');
    assert.equal(bandFor(3, 5), 'excelling', '3 of 5 is 60%');
    assert.equal(bandFor(59, 100), 'developing');
    assert.equal(bandFor(12, 20), 'excelling');
    for (let n = 3; n <= 60; n += 1) {
      for (let c = 0; c <= n; c += 1) {
        const exact = c / n;
        const want = exact < 0.4 ? 'needs-support' : exact < 0.6 ? 'developing' : 'excelling';
        // Compared in whole numbers too, so a rounding slip in either cannot hide.
        const whole = 10 * c < 4 * n ? 'needs-support' : 10 * c < 6 * n ? 'developing' : 'excelling';
        assert.equal(bandFor(c, n), want, `${c} of ${n}`);
        assert.equal(want, whole, `${c} of ${n} in whole numbers`);
      }
    }
  });

  test('Needs support is exactly the engine\'s below-40% band, the students it serves Remember and Understand only', () => {
    let checked = 0;
    for (let n = 0; n <= 12; n += 1) {
      for (let right = 0; right <= n; right += 1) {
        const p = scored(`${n}-${right}`, right, n);
        assert.equal(standingOf(p).band === 'needs-support', isSlowLearner(hydrate(p)), `${right} of ${n}`);
        checked += 1;
      }
    }
    assert.ok(checked > 80);
  });

  test('a poll counts towards neither the band nor accuracy, only towards having answered', () => {
    let p = scored('7', 1, 3);
    p = { ...p, history: [...p.history, { questionId: 'poll', bloom: 'apply', ungraded: true, at: null }] };
    const s = standingOf(p);
    assert.deepEqual([s.answers, s.correct, s.band, s.answered], [3, 1, 'needs-support', 4]);
  });
});

describe('the histogram', () => {
  test('10-point buckets in whole numbers: 40% is in the 40-50 bucket, 100% shares the top one', () => {
    assert.equal(bucketOf(4, 10), 4);
    assert.equal(bucketOf(6, 15), 4);
    assert.equal(bucketOf(3, 10), 3);
    assert.equal(bucketOf(0, 7), 0);
    assert.equal(bucketOf(10, 10), 9);
    assert.equal(bucketOf(9, 10), 9);
  });

  test('the legend\'s three counts are the three bands, bucket for bucket', () => {
    const students = [];
    for (let n = 3; n <= 25; n += 1) for (let c = 0; c <= n; c += 1) students.push({ correct: c, answers: n });
    students.push({ correct: 1, answers: 2 }, { correct: 0, answers: 0 });
    const h = histogram(students);
    assert.equal(h.buckets.length, 10);
    assert.equal(h.notEnough, 2, 'below the floor is counted apart, not in a bucket');
    assert.equal(h.students, students.length - 2);
    const want = (id) => students.filter((s) => bandFor(s.correct, s.answers) === id).length;
    assert.deepEqual(h.legend.map((l) => l.students), [want('needs-support'), want('developing'), want('excelling')]);
    assert.deepEqual(h.legend.map((l) => l.label), ['Below 40%', '40-60%', '60% and above']);
    assert.equal(h.answers, students.filter((s) => s.answers >= 3).reduce((n, s) => n + s.answers, 0));
  });

  test('an empty class is ten empty buckets, not an error', () => {
    const h = histogram([]);
    assert.deepEqual([h.students, h.answers, h.notEnough, h.buckets.every((b) => b.students === 0)], [0, 0, 0, true]);
  });
});

describe('the room\'s figures', () => {
  test('class accuracy is the mean of each student\'s, support counts the banded, participation the present who answered', () => {
    const profiles = [scored('01', 1, 4), scored('02', 3, 4), scored('03', 1, 2), profileOf('04')];
    const f = roomFigures({ session: room, profiles });
    assert.equal(f.accuracy, (0.25 + 0.75 + 0.5) / 3, 'students with no graded answer are left out');
    assert.deepEqual([f.support, f.banded, f.graded, f.answers], [1, 2, 3, 10]);
    assert.deepEqual([f.present, f.answered, f.participation], [4, 3, 0.75], 'a room with no class: every phone is present');
    assert.deepEqual(f.silentRolls, ['04']);
  });

  test('in a class room, present is attendance: unmarked and absent are not, a phone off the roster has none', () => {
    const cls = { ...room, classId: 'c1' };
    const roster = ['01', '02', '03'].map((r) => ({ _id: `s${r}`, classId: 'c1', rollNo: r, name: `Name ${r}`, removedAt: null }));
    const marks = [{ classStudentId: 's01', status: 'present' }, { classStudentId: 's02', status: 'late' }, { classStudentId: 's03', status: 'absent' }];
    const profiles = [scored('01', 2, 3), profileOf('02'), scored('03', 3, 3), scored('GUEST', 3, 3)];
    const f = roomFigures({ session: cls, profiles, roster, marks });
    assert.deepEqual([f.present, f.answered, f.participation], [2, 1, 0.5]);
    assert.deepEqual(f.silentRolls, ['02']);
  });

  test('nobody banded yet: the support count is null, not 0; a Teacher-led room has no digital figure at all', () => {
    const f = roomFigures({ session: room, profiles: [scored('01', 0, 2)] });
    assert.equal(f.support, null);
    const led = roomFigures({ session: { ...room, classId: 'c1', mode: 'teacher-led' }, roster: [{ _id: 's1', rollNo: '01', name: 'A' }], marks: [{ classStudentId: 's1', status: 'present' }] });
    assert.deepEqual([led.accuracy, led.support, led.participation, led.present], [null, null, null, 1]);
  });
});

describe('the insight cards', () => {
  const profiles = [
    profileOf('01', [['understand', true], ['understand', true], ['understand', true]]),
    profileOf('02', [['understand', false], ['understand', true]]),
    profileOf('03', [['understand', false], ['understand', false], ['understand', false]]),
    profileOf('04'),
  ];
  const figures = roomFigures({ session: room, profiles });
  const levels = classLevels(profiles);

  test('Focus: the level most students are working at, what the class got right there, and "Ask {level}"', () => {
    // 01 was promoted to Apply; 02 and 03 are at Understand (03 held by the band).
    const card = focusCard(figures, levels);
    assert.equal(card.flagId, 'focus:understand');
    assert.equal(card.text, '2 students are working at Understand, the most at any level. '
      + '4 of the 8 Understand answers in this room were right.');
    assert.deepEqual(card.action, { label: 'Ask Understand', do: 'ask', level: 'understand' });
  });

  test('Focus: a tie goes to the lower level; with no graded answer nothing stands out and nothing is asked', () => {
    const tie = roomFigures({ session: room, profiles: [scored('01', 3, 3), profileOf('02', [['apply', true]])] });
    tie.students[0].workingLevel = 'apply';
    tie.students[1].workingLevel = 'remember';
    assert.equal(focusCard(tie, classLevels([])).flagId, 'focus:remember');
    const none = focusCard(roomFigures({ session: room, profiles: [profileOf('09')] }), classLevels([]));
    assert.deepEqual([none.flagId, none.action], ['focus:none', null]);
  });

  test('Support: how many are below 40% now, against the first count, worded as evidence', () => {
    assert.equal(supportCard(figures, { value: 1 }).text, '1 student is below 40% overall, the same as at the start.');
    assert.equal(supportCard(figures, { value: 0 }).text, '1 student is below 40% overall, 1 more than at the start.');
    assert.equal(supportCard(figures, { value: 3 }).text, '1 student is below 40% overall, 2 fewer than at the start.');
    assert.equal(supportCard(figures, null).text, '1 student is below 40% overall.');
    assert.deepEqual(supportCard(figures, { value: 0 }).action, { label: 'Show them', do: 'sort', sort: 'lowest' });
    const nobody = supportCard(roomFigures({ session: room, profiles: [scored('01', 0, 2)] }));
    assert.equal(nobody.text, 'Nobody has 3 graded answers yet, so nobody is placed in a band.');
    const none = supportCard(roomFigures({ session: room, profiles: [scored('01', 3, 3)] }), { value: 0 });
    assert.equal(none.text, 'No student is below 40% overall (1 student has 3 or more graded answers), the same as at the start.');
  });

  test('Participation: present students who have not answered; everyone; nobody present', () => {
    assert.equal(participationCard(figures, room).text, '1 present student has not answered yet in this room.');
    assert.equal(participationCard(figures, room).evidence, '4 present · room INS001');
    const all = roomFigures({ session: room, profiles: [scored('01', 1, 1)] });
    assert.equal(participationCard(all, room).text, 'Every present student has answered at least once.');
    const empty = roomFigures({ session: { ...room, classId: 'c1' }, profiles: [], roster: [], marks: [] });
    assert.equal(participationCard(empty, { ...room, classId: 'c1' }).text, 'Nobody is marked present yet.');
  });

  test('no card predicts: no "risk", "fail", "likely", "will" or "slow" in any of them', () => {
    const texts = [focusCard(figures, levels), supportCard(figures, { value: 0 }), participationCard(figures, room)]
      .map((c) => `${c.text} ${c.evidence}`).join(' ');
    assert.doesNotMatch(texts, /risk|fail|likely|will |slow|predict/i);
  });

  test('the flag id is the evidence: the same students give the same id, in any order', () => {
    assert.equal(rollsDigest(['02', '01']), rollsDigest(['01', '02']));
    assert.notEqual(rollsDigest(['01']), rollsDigest(['01', '02']));
    assert.equal(rollsDigest([]), 'none');
    assert.match(supportCard(figures).flagId, /^support:[0-9a-f]{16}$/);
    assert.ok(supportCard(figures).flagId.length <= 120, 'fits the insight-actions store');
  });

  test('dismissed until the evidence changes; a later action on the same id ends the dismissal', () => {
    const card = supportCard(figures, { value: 0 });
    const at = (n) => `2026-11-19T04:0${n}:00.000Z`;
    const dismissed = latestActions([{ flagId: card.flagId, action: 'dismissed', note: 'Seen', actedAt: at(1) }]);
    assert.deepEqual([withActions(card, dismissed).dismissed, withActions(card, dismissed).lastAction.note], [true, 'Seen']);

    // A student enters Needs support: a new id, so the old dismissal does not hide it.
    const worse = roomFigures({ session: room, profiles: [...profiles, scored('05', 0, 3)] });
    const changed = supportCard(worse, { value: 0 });
    assert.notEqual(changed.flagId, card.flagId);
    assert.equal(withActions(changed, dismissed).dismissed, false);

    // More answers that leave the same students in the band: the same id, still dismissed.
    const same = roomFigures({ session: room, profiles: [...profiles.slice(0, 2), scored('03', 0, 5), profiles[3]] });
    assert.equal(supportCard(same).flagId, card.flagId);

    const reopened = latestActions([
      { flagId: card.flagId, action: 'dismissed', actedAt: at(1) },
      { flagId: card.flagId, action: 'acted', actedAt: at(2) },
    ]);
    assert.equal(withActions(card, reopened).dismissed, false);
    assert.equal(withActions(card, new Map()).lastAction, null);
  });
});

describe('the series and "since the start"', () => {
  const figures = (accuracy, support, participation) => ({
    accuracy, support, participation, answers: 1, graded: 1, banded: 1, present: 2,
  });

  test('each KPI\'s start is its first value, frozen; a minute holds its latest state', () => {
    const id = 'series-room';
    forgetInsights(id);
    const t = (m, s = 0) => new Date(Date.UTC(2026, 10, 19, 4, m, s));
    noteSample(id, figures(null, null, 0), t(0, 1));
    noteSample(id, figures(1, null, 0.5), t(0, 30));
    noteSample(id, figures(0.5, 0, 1), t(0, 50));
    let s = seriesOf(id);
    assert.equal(s.points.length, 1, 'one minute, one point');
    assert.deepEqual(s.points[0], { at: t(0, 50).toISOString(), accuracy: 0.5, support: 0, participation: 1 });
    assert.deepEqual([s.start.participation.value, s.start.accuracy.value, s.start.support.value], [0, 1, 0]);
    assert.equal(s.start.accuracy.at, t(0, 30).toISOString());
    noteSample(id, figures(0.25, 2, 1), t(1));
    s = seriesOf(id);
    assert.equal(s.points.length, 2);
    assert.equal(s.start.accuracy.value, 1, 'the start never moves');
    forgetInsights(id);
    assert.equal(seriesOf(id).points.length, 0);
  });

  test('at most SERIES_POINTS points, the oldest dropped; the start kept', () => {
    const id = 'long-room';
    forgetInsights(id);
    for (let m = 0; m < SERIES_POINTS + 20; m += 1) noteSample(id, figures(m / 1000, 0, 1), new Date(Date.UTC(2026, 10, 19, 0, m)));
    const s = seriesOf(id);
    assert.equal(s.points.length, SERIES_POINTS);
    assert.equal(s.points[0].accuracy, 20 / 1000);
    assert.equal(s.start.accuracy.value, 0);
    forgetInsights(id);
  });
});

describe('the planned next set', () => {
  const bank = (spec) => Object.entries(spec).flatMap(([bloom, n]) =>
    Array.from({ length: n }, (_, i) => ({ _id: `${bloom}-${i}`, bloom, status: 'active', kind: 'mcq' })));
  const at = (level, extra = {}) => hydrate({ rollNo: '01', workingLevel: level, history: [], ...extra });

  test('the working level first, as the selector serves it, and the level below once it runs dry', () => {
    const plan = plannedNextSet(at('apply'), bank({ understand: 4, apply: 3, analyse: 4 }));
    assert.equal(plan.planned, true);
    assert.equal(plan.summary, '3 Apply · 2 Understand review');
    assert.ok(!plan.levels.some((l) => l.role === 'stretch'), 'the selector schedules no stretch while lower levels have questions');
    assert.match(plan.note, /plan, not a promise/);
  });

  test('clipped at the floor: nothing below Remember, so no review; up only when Remember runs dry', () => {
    const full = plannedNextSet(at('remember'), bank({ remember: 6, understand: 6 }));
    assert.equal(full.summary, '5 Remember');
    const dry = plannedNextSet(at('remember'), bank({ remember: 2, understand: 6 }));
    assert.equal(dry.summary, '2 Remember · 3 Understand stretch');
    assert.ok(!dry.levels.some((l) => l.role === 'review'));
  });

  test('clipped at the ceiling: nothing above Create, so no stretch', () => {
    const plan = plannedNextSet(at('create'), bank({ evaluate: 6, create: 1 }));
    assert.equal(plan.summary, '1 Create · 4 Evaluate review');
    assert.ok(!plan.levels.some((l) => l.role === 'stretch'));
  });

  test('inside the below-40% band, Remember and Understand in turn and never above, whatever the bank holds', () => {
    const p = profileOf('01', [['understand', false], ['understand', false], ['understand', false]]);
    assert.ok(isSlowLearner(hydrate(p)));
    const plan = plannedNextSet(p, bank({ remember: 5, understand: 5, apply: 5, analyse: 5 }));
    // Three answers in: the selector opens on Understand (odd), then turns.
    assert.equal(plan.summary, '3 Understand · 2 Remember review');
    assert.equal(plan.size, 5);
    assert.ok(plan.levels.every((l) => ['remember', 'understand'].includes(l.level)));
  });

  test('the question on the screen now comes first, so the plan starts after it', () => {
    const p = at('apply', { served: { questionId: 'apply-0', at: null, reason: '' } });
    const plan = plannedNextSet(p, bank({ apply: 3, understand: 5 }));
    assert.deepEqual(plan.onScreen, { level: 'apply', label: 'Apply' });
    assert.equal(plan.summary, '2 Apply · 3 Understand review');
  });

  test('the room\'s cap on questions per student shortens it, and at the cap there is none', () => {
    const answered = (n) => Array.from({ length: n }, (_, i) => ({ questionId: `x${i}`, bloom: 'apply', correct: true, at: null }));
    assert.equal(plannedNextSet(at('apply', { history: answered(2) }), bank({ apply: 9 }), { cap: 3 }).size, 1);
    const done = plannedNextSet(at('apply', { history: answered(3) }), bank({ apply: 9 }), { cap: 3 });
    assert.deepEqual([done.size, done.summary], [0, '']);
    assert.match(done.empty, /reached the room's 3 questions/);
    assert.match(plannedNextSet(at('apply'), []).empty, /No unseen question/);
  });
});

describe('the sort orders', () => {
  test('By band (lowest first within each, too few answers last), Lowest first, Roll', () => {
    const students = [
      { rollNo: '10', band: 'excelling', accuracy: 0.9 },
      { rollNo: '2', band: 'needs-support', accuracy: 0.3 },
      { rollNo: '3', band: null, accuracy: 0.5 },
      { rollNo: '1', band: 'needs-support', accuracy: 0.1 },
      { rollNo: '4', band: 'developing', accuracy: 0.5 },
      { rollNo: '5', band: null, accuracy: null },
    ];
    const o = sortOrders(students);
    assert.deepEqual(o.band, ['1', '2', '4', '10', '3', '5']);
    assert.deepEqual(o.lowest, ['1', '2', '3', '4', '10', '5']);
    assert.deepEqual(o.roll, ['1', '2', '3', '4', '5', '10']);
  });
});

describe('class analytics', () => {
  test('?last= is 4 or 8, 4 when left out', () => {
    assert.equal(windowFrom(undefined), 4);
    assert.equal(windowFrom('8'), 8);
    status400(() => windowFrom('5'));
    status400(() => windowFrom('all'));
  });

  test('every level figure comes as six levels and as the three level bands, summing to the same answers', () => {
    const profiles = [profileOf('01', [['remember', true], ['understand', false], ['apply', true], ['analyse', true], ['create', false]])];
    const { levels, levelBands } = levelViews(classLevels(profiles));
    assert.deepEqual(LEVEL_BANDS.map((b) => b.levels), [['remember', 'understand'], ['apply', 'analyse'], ['evaluate', 'create']]);
    assert.deepEqual(levelBands.map((b) => [b.id, b.answers, b.correct]), [['lower', 2, 1], ['middle', 2, 2], ['higher', 1, 0]]);
    assert.equal(levels.reduce((n, l) => n + l.answers, 0), levelBands.reduce((n, b) => n + b.answers, 0));
    assert.deepEqual(levels.map((l) => l.level), LEVELS);
  });

  test('a dashboard\'s six-level report as the same three bands, the same shape and sums as class analytics (Phase 5 follow-up)', () => {
    const report = [
      { level: 'remember', seen: 4, correct: 3, accuracy: 0.75 }, { level: 'understand', seen: 2, correct: 0, accuracy: 0 },
      { level: 'apply', seen: 0, correct: 0, accuracy: null }, { level: 'analyse', seen: 5, correct: 5, accuracy: 1 },
      { level: 'evaluate', seen: 0, correct: 0, accuracy: null }, { level: 'create', seen: 0, correct: 0, accuracy: null },
    ];
    const bands = levelBandsOf(report);
    assert.deepEqual(bands.map((b) => [b.id, b.label, b.levels, b.answers, b.correct, b.accuracy]), [
      ['lower', 'Remember and Understand', ['remember', 'understand'], 6, 3, 0.5],
      ['middle', 'Apply and Analyse', ['apply', 'analyse'], 5, 5, 1],
      ['higher', 'Evaluate and Create', ['evaluate', 'create'], 0, 0, null],
    ]);
    assert.deepEqual(bands.map((b) => b.sentence), ['Based on 6 graded answers.', 'Based on 5 graded answers.', 'No graded answers yet.']);
    const cells = Object.fromEntries(report.map((r) => [r.level, { answers: r.seen, correct: r.correct, withdrawn: 0 }]));
    assert.deepEqual(bands, levelViews(cells).levelBands, 'one summation for every levelBands the server sends');
    assert.deepEqual(levelBandsOf([]).map((b) => b.answers), [0, 0, 0], 'an empty report is three empty bands');
  });

  test('a room\'s report: accuracy, participation, attendance and bands, each with what it rests on', () => {
    const roster = ['01', '02', '03'].map((r) => ({ _id: `s${r}`, classId: 'c1', rollNo: r, name: `N ${r}`, removedAt: null }));
    const marks = [{ classStudentId: 's01', status: 'present' }, { classStudentId: 's02', status: 'late' }];
    const r = roomReport({ ...room, classId: 'c1' }, { profiles: [scored('01', 1, 4), profileOf('02')], roster, marks });
    assert.deepEqual(r.accuracy, { value: 0.25, students: 1, answers: 4, sentence: 'Based on 4 graded answers from 1 student.' });
    assert.deepEqual(r.participation, { value: 0.5, present: 2, answered: 1, notAnswered: 1 });
    assert.deepEqual(r.attendance, { present: 2, late: 1, absent: 0, unmarked: 1, classSize: 3, summary: '2 / 3 present' });
    assert.deepEqual(r.bands, { 'needs-support': 1, developing: 0, excelling: 0, notEnough: 1 });
  });

  test('a class with no rooms answers empty series, not an error', async () => {
    const repo = createMemoryRepo();
    const cls = await repo.createClass({ courseName: 'Data Structures', section: 'A', termLabel: '', ownerId: null });
    const out = await classAnalytics(repo, cls, await repo.listSessionsForClass(cls._id), { last: 8 });
    assert.deepEqual([out.rooms.length, out.histogram.students, out.hardest.items.length, out.trend.accuracy.change], [0, 0, 0, null]);
    assert.equal(out.last, 8);
    assert.equal(out.levelBands.length, 3);
  });

  // Not a database test: no Supabase is reachable from here. This pins the
  // request, so a typo in the filter fails here rather than matching nothing.
  test('Supabase: a class\'s rooms by class_id, newest first, and no request for a malformed id', async () => {
    const { config } = await import('../src/config.js');
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    const CLASS = '44444444-4444-4444-8444-444444444444';
    globalThis.fetch = async (url) => {
      seen.push(new URL(String(url)));
      return new Response(JSON.stringify([{ id: 'r1', code: 'ROOM01', content_id: 'c', class_id: CLASS, status: 'open', started_at: 'T' }]),
        { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      const rows = await repo.listSessionsForClass(CLASS);
      assert.equal(seen[0].pathname, '/rest/v1/sessions');
      assert.equal(seen[0].searchParams.get('class_id'), `eq.${CLASS}`);
      assert.equal(seen[0].searchParams.get('order'), 'started_at.desc');
      assert.deepEqual([rows[0]._id, rows[0].classId, rows[0].code], ['r1', CLASS, 'ROOM01']);
      assert.deepEqual(await repo.listSessionsForClass('ffffffffffffffffffffffff'), []);
      assert.equal(seen.length, 1, 'a 24-character id is not a uuid and asks nothing');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });

  test('the in-process store lists a class\'s rooms, newest first, and no other room', async () => {
    const repo = createMemoryRepo();
    const a = await repo.createSession({ code: 'CLA001', contentId: 'c', title: 'a', classId: 'k1', startedAt: '2026-11-01T00:00:00.000Z' });
    await repo.createSession({ code: 'CLA002', contentId: 'c', title: 'b', classId: 'k2', startedAt: '2026-11-02T00:00:00.000Z' });
    const c = await repo.createSession({ code: 'CLA003', contentId: 'c', title: 'c', classId: 'k1', startedAt: '2026-11-03T00:00:00.000Z' });
    await repo.createSession({ code: 'CLA004', contentId: 'c', title: 'd', startedAt: '2026-11-04T00:00:00.000Z' });
    assert.deepEqual((await repo.listSessionsForClass('k1')).map((s) => s._id), [c._id, a._id]);
  });
});
