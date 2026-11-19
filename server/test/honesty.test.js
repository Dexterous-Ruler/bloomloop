// Phase 5 - honest indicators, as the pure parts build them: who wrote a
// question and whether it was approved (staff and phone wording), an uncertain
// Bloom level, the reason kept with every level move, the count every estimate
// rests on, provisional levels and bands, and the translation warning. The
// end-to-end half, over a real server and real phones, is
// server/scripts/honesty.mjs.
//
// Never reaches a network.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEMPLATE_MODEL,
  TRANSLATION_WARNING,
  approvalOf,
  basedOn,
  languageName,
  languageSplit,
  levelCheck,
  phoneProvenance,
  questionProvenance,
  sourceOf,
  staffQuestion,
  studentLanguages,
} from '../src/services/honesty.js';
import { OFFLINE_MODEL } from '../src/services/generate.js';
import {
  emptyProfile, hydrate, applyAnswer, levelEvidence, levelMoves, masteryBasis, WINDOW, MIN_LEVEL_EVIDENCE,
} from '../src/services/mastery.js';
import { buildGridRow, phoneRow } from '../src/routes/session.js';
import { itemAnalysis } from '../src/services/itemStats.js';
import { bandBasis, focusCard, supportCard, participationCard, roomFigures, classLevels, standingOf } from '../src/services/insights.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';

/** Words a phone must never be shown about its own place (decision (a)), and the jargon it must never see. */
const LABELS = /band|below-40|40%|slow|support|watch|signal|Left the page|faster than/i;
const JARGON = /template|fallback|offline|\bllm\b|gemini|model/i;

const AT = '2026-11-19T07:00:00.000Z';

/** A profile after these answers, as the live loop builds one. */
function answered(list, { startLevel, adapt = true } = {}) {
  let p = hydrate(emptyProfile({ sessionId: 's1', rollNo: '21CS01', name: 'Asha', startLevel }));
  list.forEach(([bloom, correct], i) => {
    p = applyAnswer(p, { questionId: `q${i}`, bloom, correct, adapt, at: `2026-11-19T09:${String(i).padStart(2, '0')}:00.000Z` }).profile;
  });
  return p;
}
const times = (n, entry) => Array(n).fill(entry);

/* ------------------------------------------------------------ provenance -- */

describe('who wrote a question, and whether it was let into rooms', () => {
  const ai = { source: 'llm', model: 'gemini-2.5-flash', status: 'draft' };

  test('the four sources, read off the row', () => {
    assert.equal(sourceOf(ai), 'ai');
    assert.equal(sourceOf({}), 'ai', 'no source is the column default, llm');
    assert.equal(sourceOf({ source: 'teacher' }), 'professor');
    assert.equal(sourceOf({ source: 'fallback', model: TEMPLATE_MODEL }), 'template');
    assert.equal(sourceOf({ source: 'fallback', model: null }), 'professor-or-template', 'nothing on the row tells the two apart');
    assert.equal(TEMPLATE_MODEL, OFFLINE_MODEL, 'the offline generator\'s model id, written out in honesty.js');
  });

  test('approval: draft, approved, written, in use from before approvals, discarded', () => {
    assert.equal(approvalOf(ai), 'draft');
    assert.equal(approvalOf({ ...ai, status: 'active', approvedAt: AT }), 'approved');
    assert.equal(approvalOf({ source: 'teacher', status: 'active' }), 'written');
    assert.equal(approvalOf({ source: 'llm', status: 'active' }), 'unrecorded');
    assert.equal(approvalOf({ ...ai, status: 'discarded' }), 'discarded');
  });

  test('staff: an AI question waiting for approval is an "AI draft", with who wrote it and the model', () => {
    const p = questionProvenance(ai);
    assert.equal(p.aiDraft, true);
    assert.equal(p.label, 'AI draft');
    assert.equal(p.sourceLabel, 'AI-generated');
    assert.equal(p.model, 'gemini-2.5-flash');
    assert.match(p.sentence, /language model \(gemini-2\.5-flash\).*A draft: no room serves it until a professor approves it\./);
    const approved = questionProvenance({ ...ai, status: 'active', approvedAt: AT, approvedBy: 'prof' });
    assert.deepEqual([approved.aiDraft, approved.label, approved.approvedAt, approved.approvedBy], [false, 'AI-generated, approved', AT, 'prof']);
    assert.equal(questionProvenance({ source: 'fallback', model: TEMPLATE_MODEL, status: 'draft' }).label, 'Offline template draft');
    assert.equal(questionProvenance({ source: 'teacher', status: 'active' }).label, 'Professor-written');
    assert.match(questionProvenance({ source: 'fallback', status: 'active' }).sentence, /before 19 Nov 2026.*No language model wrote it/);
  });

  test('every bank question sent to staff carries it, and its level check, without losing a field', () => {
    const q = { _id: 'q1', text: 'T', bloom: 'apply', kind: 'blank', accept: ['x'], ...ai };
    const out = staffQuestion(q);
    assert.deepEqual({ ...out, provenance: undefined, levelCheck: undefined, kindLabel: undefined },
      { ...q, provenance: undefined, levelCheck: undefined, kindLabel: undefined });
    assert.equal(out.kindLabel, 'Fill in the blank');
    assert.equal(out.provenance.label, 'AI draft');
    assert.equal(out.levelCheck.uncertain, true);
    assert.equal(staffQuestion(null), null);
  });

  test('the phone: in a student\'s words, never "template", "fallback" or a model\'s name', () => {
    const cases = [
      [{ source: 'teacher', status: 'active' }, 'professor', true, 'Written by your professor.'],
      [{ ...ai, status: 'active', approvedAt: AT }, 'ai', true, 'Written with AI help and checked by your professor.'],
      [{ source: 'llm', status: 'active' }, 'ai', false, 'Written with AI help and chosen by your professor.'],
      [{ source: 'fallback', model: TEMPLATE_MODEL, approvedAt: AT }, 'not-ai', true,
        'Made without AI from your professor\'s material, and checked by your professor.'],
      [{ source: 'fallback', model: TEMPLATE_MODEL }, 'not-ai', false, 'Made without AI from your professor\'s material.'],
      [{ source: 'fallback', model: null }, 'not-ai', false, 'Made without AI, by your professor or from their material.'],
    ];
    for (const [q, by, checked, text] of cases) {
      assert.deepEqual(phoneProvenance(q), { by, checked, text });
      assert.doesNotMatch(JSON.stringify(phoneProvenance(q)), JARGON);
    }
  });
});

/* ----------------------------------------------------------- level check -- */

describe('an uncertain Bloom level, for staff', () => {
  test('the model chose it and no professor has approved the question', () => {
    const c = levelCheck({ source: 'llm', model: 'm', status: 'draft', bloom: 'analyse', kind: 'multi' });
    assert.equal(c.uncertain, true);
    assert.deepEqual(c.reasons.map((r) => r.id), ['model-level-unconfirmed']);
    assert.match(c.sentence, /^Level uncertain\. The language model chose this level/);
    // An older AI question in use with no approval recorded was never confirmed either.
    assert.equal(levelCheck({ source: 'llm', status: 'active', bloom: 'remember', kind: 'mcq' }).uncertain, true);
  });

  test('approval confirms it; a professor\'s own and a template\'s level are not the model\'s guess', () => {
    for (const q of [
      { source: 'llm', model: 'm', status: 'active', approvedAt: AT, bloom: 'analyse', kind: 'multi' },
      { source: 'teacher', status: 'active', bloom: 'apply', kind: 'blank' },
      { source: 'fallback', model: TEMPLATE_MODEL, status: 'draft', bloom: 'remember', kind: 'truefalse' },
      { source: 'teacher', status: 'active', bloom: 'evaluate', kind: 'poll' },
    ]) {
      assert.deepEqual(levelCheck(q), { uncertain: false, reasons: [], sentence: null }, JSON.stringify(q));
    }
  });

  test('a kind that does not ask for its level: an older Choose one at Analyse, a pick at Create', () => {
    const old = levelCheck({ source: 'teacher', status: 'active', bloom: 'analyse', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0 });
    assert.deepEqual(old.reasons.map((r) => r.id), ['kind-does-not-fit-level']);
    assert.match(old.reasons[0].message, /"Choose one" question is not one of the kinds that ask for Analyse/);
    const create = levelCheck({ source: 'teacher', status: 'active', bloom: 'create', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0 });
    assert.match(create.reasons[0].message, /Crowe et al\. 2008/, 'the Create rule says it in its own words');
    const both = levelCheck({ source: 'llm', status: 'draft', bloom: 'analyse', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0 });
    assert.deepEqual(both.reasons.map((r) => r.id), ['model-level-unconfirmed', 'kind-does-not-fit-level']);
  });
});

/* ------------------------------------------------- reasons for movements -- */

describe('every level move keeps why, on the answer that caused it', () => {
  test('promote: the window, the share and the answers, and the professor\'s sentence', () => {
    const p = answered(times(3, ['understand', true]));
    assert.equal(p.workingLevel, 'apply');
    const { move } = p.history.at(-1);
    assert.deepEqual(move, {
      rule: 'promote', from: 'understand', to: 'apply', window: WINDOW, share: 1, answers: 3,
      reason: '100% at Understand over the last 3 - promoted to Apply.',
    });
    assert.equal(p.history.filter((h) => h.move).length, 1, 'the answers before it moved nothing and keep nothing');
  });

  test('demote, with the share to four places', () => {
    const p = answered([...times(3, ['understand', true]), ['apply', true], ['apply', false], ['apply', false]]);
    assert.equal(p.workingLevel, 'understand');
    const { move } = p.history.at(-1);
    assert.deepEqual([move.rule, move.from, move.to, move.window, move.share, move.answers], ['demote', 'apply', 'understand', 5, 0.3333, 3]);
    assert.match(move.reason, /33% at Apply over the last 3 - demoted to Understand\./);
  });

  test('a hold at either end of the ladder is kept; a hold in the middle is not', () => {
    const top = answered(times(3, ['create', true]), { startLevel: 'create' });
    assert.deepEqual(top.history.map((h) => h.move?.rule ?? null), [null, null, 'top']);
    assert.equal(top.history.at(-1).move.from, 'create');
    assert.equal(top.history.at(-1).move.to, 'create');
    // Right at Understand, wrong at Remember: over 40% overall, so not the band,
    // and under 40% in Remember's window, with nowhere lower to go.
    const floor = answered([...times(4, ['understand', true]), ...times(3, ['remember', false])], { startLevel: 'remember' });
    assert.equal(floor.workingLevel, 'remember');
    assert.deepEqual(floor.history.at(-1).move, {
      rule: 'floor', from: 'remember', to: 'remember', window: WINDOW, share: 0, answers: 3,
      reason: '0% at Remember over the last 3 - already at the floor, holding at Remember.',
    });
    const middle = answered([['understand', true], ['understand', false], ['understand', true], ['understand', false]]);
    assert.equal(middle.history.filter((h) => h.move).length, 0);
  });

  test('the below-40% band: the move into it is kept, with every counted answer as its window', () => {
    const p = answered([...times(3, ['understand', true]), ['apply', false], ['apply', false], ['apply', false], ['apply', false], ['apply', false],
      ['apply', false]]);
    const band = p.history.find((h) => h.move?.rule === 'band')?.move;
    assert.ok(band, 'kept');
    assert.equal(band.window, null, 'every counted answer, not the last five at one level');
    assert.equal(band.to, 'understand');
    assert.ok(band.answers >= 3);
    assert.match(band.reason, /below-40% band/, 'the professor\'s sentence, which is why moves are staff-only');
  });

  test('a room that does not adapt moves nobody and keeps nothing', () => {
    const p = answered(times(5, ['understand', true]), { adapt: false });
    assert.equal(p.history.filter((h) => h.move).length, 0);
  });

  test('kept through a reload: hydrate, JSON and the in-process store give back every move', async () => {
    const p = answered([...times(3, ['understand', true]), ...times(3, ['apply', true])]);
    const moves = levelMoves(p);
    assert.deepEqual(moves.map((m) => [m.rule, m.from, m.to]), [['promote', 'apply', 'analyse'], ['promote', 'understand', 'apply']], 'newest first');
    assert.deepEqual(levelMoves(JSON.parse(JSON.stringify(p))), moves);
    const repo = createMemoryRepo();
    await repo.saveProfile({ ...p, sessionId: 's1' });
    assert.deepEqual(levelMoves(await repo.getProfile('s1', '21CS01')), moves);
    assert.equal(moves[0].questionId, 'q5');
    assert.equal(moves[0].at, p.history.at(-1).at);
  });
});

/* -------------------------------------------- the count behind estimates -- */

describe('what a level and a mastery figure rest on', () => {
  test('provisional while the ladder has no decision behind the level', () => {
    const none = levelEvidence(answered([]));
    assert.deepEqual(none, { answers: 0, provisional: true, sentence: 'No graded answers yet: Understand is the room\'s start level, not an estimate.' });
    const two = levelEvidence(answered([['understand', true], ['understand', true]]));
    assert.deepEqual(two, {
      answers: 2, provisional: true,
      sentence: `Provisional: 2 answers at Understand so far, and the ladder needs ${MIN_LEVEL_EVIDENCE} before it can move a student.`,
    });
  });

  test('firm on the level\'s own answers, or on the move that brought the student there', () => {
    assert.deepEqual(levelEvidence(answered([['understand', true], ['understand', false], ['understand', true], ['understand', false]])),
      { answers: 4, provisional: false, sentence: 'Based on the last 4 answers at Understand.' });
    const moved = answered([...times(3, ['understand', true]), ['apply', true]]);
    assert.deepEqual(levelEvidence(moved),
      { answers: 3, provisional: false, sentence: 'Moved to Apply on the last 3 answers at Understand; 1 answer at Apply since.' });
    // A history from before moves were kept: read off the last answers, as nextStep does.
    const legacy = hydrate({ ...answered(times(3, ['understand', true])) });
    legacy.history = legacy.history.map(({ move, ...h }) => h);
    assert.deepEqual(levelEvidence(legacy), { answers: 3, provisional: false, sentence: 'Moved to Apply on the last 3 answers at Understand.' });
  });

  test('the band rests on every counted answer; with adapt off the level is the room\'s', () => {
    const band = answered([['understand', false], ['understand', false], ['understand', false]]);
    assert.deepEqual(levelEvidence(band), { answers: 3, provisional: false, sentence: 'Based on 3 answers overall.' });
    assert.equal(levelEvidence(answered([['apply', true]], { startLevel: 'apply', adapt: false }), { adapt: false }).provisional, false);
  });

  test('mastery per level, no percentage and no band, provisional under the minimum', () => {
    const p = answered([...times(3, ['understand', true]), ['apply', true], ['apply', false]]);
    assert.deepEqual(masteryBasis(p), [
      { level: 'understand', answers: 3, correct: 3, mastered: true, provisional: false,
        sentence: '3 of 3 right at Understand: at or above this room\'s goal, so Understand counts as mastered.' },
      { level: 'apply', answers: 2, correct: 1, mastered: false, provisional: true,
        sentence: '2 answers at Apply so far: 3 are needed before Apply can count as mastered.' },
    ]);
    const under = answered([['remember', true], ['remember', false], ['remember', true]], { startLevel: 'remember' });
    assert.equal(masteryBasis(under)[0].sentence, '2 of 3 right at Remember: not yet at this room\'s goal.');
    assert.doesNotMatch(JSON.stringify([masteryBasis(p), masteryBasis(under)]), /%|band/);
  });

  test('the teacher\'s row and the phone\'s carry them; the phone\'s are band-free and percentage-free', () => {
    const p = answered([['understand', true], ['understand', true]]);
    const staff = buildGridRow(p, { online: true });
    assert.equal(staff.levelBasis.provisional, true);
    assert.equal(staff.masteryBasis.length, 1);
    const phone = phoneRow(p, { online: true });
    assert.equal(phone.next.provisional, true);
    assert.deepEqual(phone.masteryBasis, staff.masteryBasis);
    assert.equal('levelBasis' in phone, false, 'the phone\'s level sentence is `next.why`');
    const firm = phoneRow(answered(times(3, ['understand', true])));
    assert.equal(firm.next.provisional, false);
    // With adapt off the room sets the level: not provisional, on the phone too.
    assert.equal(phoneRow(answered([], { startLevel: 'apply' }), { adapt: false }).next.provisional, false);
    const band = answered([['understand', false], ['understand', false], ['understand', false]]);
    assert.doesNotMatch(JSON.stringify(phoneRow(band)), LABELS);
    assert.doesNotMatch(JSON.stringify(phoneRow(band)), /\d+%/);
  });

  test('basedOn: the sentence beside every count', () => {
    assert.equal(basedOn(4), 'Based on 4 answers.');
    assert.equal(basedOn(1), 'Based on 1 answer.');
    assert.equal(basedOn(34, { students: 12, unit: 'graded answer' }), 'Based on 34 graded answers from 12 students.');
    assert.equal(basedOn(0), 'No answers yet.');
  });

  test('a band under the minimum is provisional, never a state; cards and their counts', () => {
    assert.deepEqual(bandBasis({ answers: 2, correct: 0, band: null }),
      { answers: 2, provisional: true, sentence: '2 graded answers so far; a band needs at least 3.' });
    assert.deepEqual(bandBasis({ answers: 4, correct: 1, band: 'needs-support' }),
      { answers: 4, provisional: false, sentence: '1 of 4 graded answers right (25%): Needs support.' });
    const profiles = [answered(times(3, ['understand', true])), { ...answered([['understand', false]]), rollNo: '21CS02' }];
    const figures = roomFigures({ session: { code: 'R1' }, profiles });
    assert.deepEqual(figures.students.map(standingOf).length, 2);
    const focus = focusCard(figures, classLevels(profiles));
    assert.equal(focus.basis.students, 2);
    assert.match(focus.basis.sentence, /^Based on 2 students with a graded answer, and \d+ (Understand|Apply) answers? in this room\.$/);
    assert.deepEqual(supportCard(figures).basis, { students: 1, sentence: 'Based on 1 student with at least 3 graded answers each.' });
    assert.deepEqual(participationCard(figures, { code: 'R1' }).basis, { students: 2, sentence: 'Based on 2 present students.' });
  });
});

/* ------------------------------------------------------- item statistics -- */

describe('item statistics: difficulty with its count, provenance, level check and languages', () => {
  const Q = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', contentId: 'c', topic: 'UDP', text: 'Which is connectionless?', kind: 'mcq',
    options: ['TCP', 'UDP', 'SCTP', 'QUIC'], answerIdx: 1, bloom: 'remember', source: 'llm', model: 'm', status: 'active', approvedAt: AT,
  };
  let n = 0;
  const row = (correct, language = 'en', extra = {}) => {
    n += 1;
    return {
      _id: `a${n}`, sessionId: 'room1', rollNo: `S${n}`, questionId: Q._id, bloom: 'remember', kind: 'mcq', final: true, ungraded: false,
      correct, score: correct ? 1 : 0, language, questionSnapshot: { id: Q._id, ...Q }, response: correct ? 1 : 0, ...extra,
    };
  };

  test('the difficulty says what it rests on, and is provisional under the band\'s floor', () => {
    const few = itemAnalysis({ answers: [row(true), row(false)], questions: [Q] }).items[0];
    assert.equal(few.band, null);
    assert.deepEqual(few.basis, { answers: 2, provisional: true, sentence: 'Based on 2 answers: too few for a difficulty band (5 needed).' });
    const none = itemAnalysis({ answers: [], questions: [Q], include: [Q._id] }).items[0];
    assert.deepEqual(none.basis, { answers: 0, provisional: true, sentence: 'No answers yet.' });
    const enough = itemAnalysis({ answers: Array.from({ length: 6 }, (_, i) => row(i < 3)), questions: [Q] }).items[0];
    assert.deepEqual(enough.basis, { answers: 6, provisional: false, sentence: 'Based on 6 answers.' });
  });

  test('each item carries its question\'s provenance and level check; a deleted one its snapshot\'s source', () => {
    const r = itemAnalysis({ answers: [row(true)], questions: [Q] }).items[0];
    assert.equal(r.provenance.label, 'AI-generated, approved');
    assert.equal(r.levelCheck.uncertain, false);
    const gone = itemAnalysis({ answers: [row(true, 'en', { questionSource: 'teacher', questionSnapshot: { id: Q._id, ...Q, source: 'teacher' } })] }).items[0];
    assert.equal(gone.status, 'deleted');
    assert.equal(gone.provenance.source, 'professor');
    assert.equal(gone.levelCheck, null);
  });

  test('one language: no warning, no note', () => {
    const r = itemAnalysis({ answers: Array.from({ length: 6 }, (_, i) => row(i < 3)), questions: [Q] });
    assert.equal(r.items[0].languages.warning, null);
    assert.equal(r.items[0].languages.note, null);
    assert.equal(r.items[0].languages.otherThanOriginal, 0);
    assert.deepEqual([r.translation.minAnswersPerLanguage, r.translation.gapAbovePoints, r.translation.warnings], [5, 20, 0]);
  });

  test('two languages far apart, each with enough answers: a warning with the numbers behind it', () => {
    const answers = [...Array.from({ length: 10 }, (_, i) => row(i < 8)), ...Array.from({ length: 5 }, (_, i) => row(i < 2, 'hi'))];
    const r = itemAnalysis({ answers, questions: [Q] });
    const l = r.items[0].languages;
    assert.deepEqual(l.languages.map((x) => [x.language, x.answers, x.correct, x.original]), [['en', 10, 8, true], ['hi', 5, 2, false]]);
    assert.equal(l.otherThanOriginal, 5);
    assert.equal(l.note, '5 of 15 answers were given in a language other than the question\'s own (English).');
    assert.ok(l.warning);
    assert.deepEqual(l.warning.languages, ['en', 'hi']);
    assert.equal(l.warning.text, 'Answers in Hindi were right 2 of 5 times (40%), against 8 of 10 (80%) in English: a gap of 40 points, '
      + 'above the 20-point threshold. Translation can change how hard a question is, so check the Hindi version before reading '
      + 'this as a gap in understanding.');
    assert.equal(r.translation.warnings, 1);
  });

  test('exactly 20 points, or too few in one language, is no warning', () => {
    const at20 = languageSplit([...Array.from({ length: 10 }, (_, i) => ({ correct: i < 8, language: 'en' })),
      ...Array.from({ length: 5 }, (_, i) => ({ correct: i < 3, language: 'hi' }))]);
    assert.equal(at20.warning, null, '80% against 60% is 20 points, not above');
    const few = languageSplit([...Array.from({ length: 10 }, () => ({ correct: true, language: 'en' })),
      ...Array.from({ length: TRANSLATION_WARNING.minAnswersPerLanguage - 1 }, () => ({ correct: false, language: 'mr' }))]);
    assert.equal(few.warning, null);
    assert.match(few.note, /^4 of 14 answers were given/);
    // Neither is the original language: still compared.
    const others = languageSplit([...Array.from({ length: 5 }, () => ({ correct: true, language: 'ta' })),
      ...Array.from({ length: 5 }, () => ({ correct: false, language: 'te' }))]);
    assert.deepEqual(others.warning.languages, ['ta', 'te']);
    assert.equal(languageName('hi'), 'Hindi');
    assert.equal(languageSplit([{ correct: true, language: 'not a tag!' }]).languages[0].language, 'en', 'an unreadable tag is the original');
  });

  test('a student\'s answers in another language are named on the card', () => {
    assert.deepEqual(studentLanguages([{ language: 'en' }, { language: 'en' }]).note, null);
    const s = studentLanguages([{ language: 'en' }, { language: 'hi' }, { language: 'hi' }]);
    assert.equal(s.otherThanOriginal, 2);
    assert.equal(s.note, '2 of this student\'s 3 answers were in Hindi, not the question\'s own English. Translation can change how hard a question is.');
  });
});
