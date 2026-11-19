// Batch 8: the design-zip gaps for material, the bank and the hub's concept
// panel (docs/UI_ZIP_AUDIT.md M1-M5, H9a, H9b, the older file's H5, and the
// shared question bank).
//
// Pinned here: where each topic came from (M1); the levels the material
// supports, for every topic, with a reason (M2); the template writer on purpose
// and which writer ran (M3); when a chapter was last used (M5); the concept
// panel's sections parsed from fixture replies through the real parser, cited,
// an AI draft with the lesson, translated through the lesson's own fields, and
// absent (with a note) from a slides-only lesson; "why this path" naming each
// change the evidence made; serve tokens; rooms-only questions kept out of
// lessons; the room selector avoiding a question already practised; and the
// practised notes. End to end, over HTTP, in scripts/zipgaps2.mjs. Never calls
// Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { selectNext } from '../src/services/selector.js';
import { hydrate } from '../src/services/mastery.js';
import { emptyLevels } from '../src/bloom.js';
import { checkServeToken, serveToken, TOKEN_EXPIRED, TOKEN_MISSING } from '../src/services/serveTokens.js';
import { isRoomsOnly, practisedBefore, PRACTISED_NOTE } from '../src/services/bankShare.js';
import { lastUsedOf, levelSupport, slideLabel, topicSource, topicSources } from '../src/services/materialInfo.js';
import { generateForTopic } from '../src/services/generate.js';
import { writerReport } from '../src/routes/generate.js';
import {
  FACT_LABEL, SECTIONS_SLIDES_ONLY, STUDENT_NO_SECTIONS, cleanConcept, conceptOfReply, sectionFields, sectionsView,
} from '../src/services/hubConcept.js';
import {
  buildLessonPrompt, lessonQuestion, retrievalPool, staffLessonView, studentLessonView, writeLessonDraft,
} from '../src/services/hubLessons.js';
import { checkTranslation, fieldsOf, sourceHash } from '../src/services/hubLanguages.js';
import { practisable, onceServable } from '../src/services/hubPractice.js';
import { pathWhy, refresherPath } from '../src/services/hubGetReady.js';

// The model is never called here: replies are fixtures through the real parsers.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const prof = { id: PROF, role: 'professor' };
const asha = { id: 'b0000000-0000-4000-8000-00000000000b', role: 'student' };

/* ------------------------------------------------------------ material -- */

describe('where each topic came from (M1)', () => {
  test('slide runs read as ranges', () => {
    assert.equal(slideLabel([14]), 'Slide 14');
    assert.equal(slideLabel([4, 3]), 'Slides 3–4');
    assert.equal(slideLabel([3, 4, 5, 9]), 'Slides 3–5 and 9');
    assert.equal(slideLabel([1, 3, 5]), 'Slides 1, 3 and 5');
    assert.equal(slideLabel([]), null);
  });

  test('a deck: the slides kept at upload, else the slide whose words name it, else a reason', () => {
    const deck = {
      kind: 'pptx', topics: ['Trees', 'Graphs', 'Heaps'], topicSlides: { Trees: [3, 4] },
      slideTexts: [{ slide: 9, text: 'Graphs\nA graph has vertices and edges.' }, { slide: 10, text: 'More on graphs' }],
    };
    assert.deepEqual(topicSource(deck, 'Trees'), { topic: 'Trees', kind: 'slides', slides: [3, 4], line: null, label: 'Slides 3–4', from: 'topic-slides' });
    const graphs = topicSource(deck, 'Graphs');
    assert.equal(graphs.label, 'Slide 9');
    assert.equal(graphs.from, 'slide-text');
    const heaps = topicSource(deck, 'Heaps');
    assert.equal(heaps.label, null);
    assert.match(heaps.note, /No slide of this deck names this topic/);
    assert.equal(topicSources(deck).length, 3);
  });

  test('pasted text: the line that names it, list markers aside', () => {
    const pasted = { kind: 'syllabus', topics: ['Stacks', 'Queues'], rawText: 'Unit 3\n- Stacks\nPush and pop.\n2. Queues\n' };
    assert.equal(topicSource(pasted, 'Stacks').label, 'Line 2');
    assert.equal(topicSource(pasted, 'Queues').line, 4);
    assert.match(topicSource(pasted, 'Deques').note, /No line of the pasted text/);
  });
});

describe('the levels the material supports, for every topic (M2)', () => {
  const RICH = [
    'Photosynthesis is the process by which green plants make glucose from carbon dioxide and water using light energy.',
    'Chlorophyll is the pigment that absorbs light in the chloroplast.',
    'Stomata are pores on the leaf that let carbon dioxide in and oxygen out.',
    'Glucose is stored as starch in the leaf.',
    'Respiration releases energy from glucose, the reverse of photosynthesis.',
    'The rate of photosynthesis rises with light intensity until another factor limits it.',
    'Temperature affects the enzymes, so the rate falls above about 40 degrees.',
    'Carbon dioxide concentration is often the limiting factor in a greenhouse.',
  ].join('\n');

  test('every level is listed with a reason; a supported level names how it would be asked', () => {
    const out = levelSupport({ kind: 'syllabus', rawText: RICH, topics: ['Photosynthesis'] }, 'Photosynthesis');
    assert.equal(out.levels.length, 6);
    assert.ok(out.supports.includes('remember'), JSON.stringify(out.levels));
    for (const l of out.levels) {
      assert.match(l.reason, l.supported ? /^Supported: the material gives enough/ : /^Not supported by the material:/);
      assert.equal(l.supported, out.supports.includes(l.level));
    }
  });

  test('a topic the material barely mentions is "not supported" in plain words', () => {
    const out = levelSupport({ kind: 'syllabus', rawText: 'Quantum chromodynamics.', topics: ['Quantum chromodynamics'] }, 'Quantum chromodynamics');
    const unsupported = out.levels.filter((l) => !l.supported);
    assert.ok(unsupported.length > 0, JSON.stringify(out.supports));
    assert.ok(unsupported.every((l) => /does not give enough to write/.test(l.reason)));
  });
});

describe('the template writer on purpose, and which writer ran (M3)', () => {
  test('asked for templates, no model is called even with a key, and the reply says so', async () => {
    const realFetch = globalThis.fetch;
    let reached = 0;
    globalThis.fetch = async () => { reached += 1; throw new Error('no network in this test'); };
    config.gemini.apiKey = 'not-a-real-key';
    try {
      const out = await generateForTopic({ topic: 'Photosynthesis', contextText: 'Photosynthesis makes glucose. Chlorophyll absorbs light.', mix: { remember: 2 }, templatesOnly: true });
      assert.equal(out.source, 'fallback');
      assert.ok(out.questions.every((q) => q.source === 'fallback'));
    } finally {
      config.gemini.apiKey = '';
      globalThis.fetch = realFetch;
    }
    assert.equal(reached, 0);
  });

  test('the writer report, in words', () => {
    assert.deepEqual(writerReport('templates', 'fallback'), { asked: 'templates', ran: 'templates', sentence: 'Written by the built-in templates, as you asked.' });
    assert.match(writerReport('auto', 'fallback').sentence, /^AI unavailable/);
    assert.equal(writerReport('auto', 'llm').ran, 'model');
    assert.equal(writerReport('auto', 'mixed').ran, 'mixed');
  });
});

describe('when a chapter was last used (M5)', () => {
  test('the newest room opened on it, or null', () => {
    assert.equal(lastUsedOf([]), null);
    const used = lastUsedOf([
      { code: 'AAA111', startedAt: '2026-11-10T04:00:00Z', status: 'closed' },
      { code: 'BBB222', startedAt: '2026-11-12T04:00:00Z', status: 'closed' },
    ]);
    assert.deepEqual(used, { at: '2026-11-12T04:00:00Z', code: 'BBB222', status: 'closed' });
  });
});

/* ------------------------------------------------------ concept panel -- */

const CHUNKS = [
  { label: 'C1', slides: [1], text: 'Recursion: a function calls itself. A base case stops it.' },
  { label: 'C2', slides: [2, 3], text: 'def fact(n): return 1 if n == 0 else n * fact(n - 1)' },
];

const CONCEPT = {
  intro: { text: 'Recursion solves a problem by solving smaller copies of it.', parts: ['C1'] },
  facts: [
    { kind: 'connects', text: 'It connects to the call stack.', parts: ['C2'] },
    { kind: 'why', text: 'Many tree algorithms are recursive.', parts: ['C1'] },
    { kind: 'trivia', text: 'Not a kind.', parts: ['C1'] },
    { kind: 'where', text: 'Uncited.', parts: [] },
  ],
  steps: [
    { term: 'Base case', text: 'The smallest input is answered directly.', parts: ['C1'] },
    { term: 'Recursive case', text: 'The function calls itself on a smaller input.', parts: ['C1', 'C2'] },
  ],
  example: { language: 'py', body: 'def fact(n):\n\treturn 1 if n == 0 else n * fact(n - 1)', caption: 'Factorial, from slide 2.', parts: ['C2'] },
  mistakes: [{ text: 'Forgetting the base case.', parts: ['C1'] }, { text: 'Call me on 9876543210.', parts: ['C1'] }, { text: 'Unknown part.', parts: ['C9'] }],
};

describe('the concept panel\'s sections (H9a, H9b)', () => {
  test('each piece kept is cited to its parts and their slides; uncited, unknown and unsafe pieces are named and left out', () => {
    const { sections, skipped } = cleanConcept(CONCEPT, CHUNKS);
    assert.deepEqual(sections.intro, { text: CONCEPT.intro.text, parts: ['C1'], slides: [1] });
    assert.deepEqual(sections.facts.map((f) => [f.kind, f.label, f.slides]), [['why', FACT_LABEL.why, [1]], ['connects', FACT_LABEL.connects, [2, 3]]]);
    assert.deepEqual(sections.steps[1].slides, [1, 2, 3]);
    assert.equal(sections.example.language, 'python');
    assert.ok(!sections.example.body.includes('\t'));
    assert.deepEqual(sections.mistakes.map((m) => m.text), ['Forgetting the base case.']);
    assert.ok(skipped.some((s) => /not why it matters/.test(s)));
    assert.ok(skipped.some((s) => /named no part/.test(s)));
    assert.ok(skipped.some((s) => /contact details/.test(s)));
  });

  test('a single explanation step is no explanation; nothing usable is null', () => {
    const { sections, skipped } = cleanConcept({ steps: [{ term: 'Only', text: 'One step.', parts: ['C1'] }] }, CHUNKS);
    assert.equal(sections, null);
    assert.ok(skipped.some((s) => /fewer than 2 steps/.test(s)));
    assert.equal(cleanConcept(null, CHUNKS).sections, null);
    assert.equal(conceptOfReply('not json'), null);
    assert.deepEqual(conceptOfReply(JSON.stringify({ parts: [], concept: { a: 1 } })), { a: 1 });
  });

  test('the prompt asks for the sections from the parts only, each citing its parts', () => {
    const prompt = buildLessonPrompt({ topic: 'Recursion', chunks: CHUNKS });
    assert.match(prompt, /"concept"/);
    assert.match(prompt, /from these parts ONLY, each naming the parts it uses/);
  });

  test('translated through the lesson\'s own fields: terms and code stay English; a lesson without them hashes as before', () => {
    const { sections } = cleanConcept(CONCEPT, CHUNKS);
    const lesson = { steps: [{ type: 'chunk', text: 'Recursion' }], sections };
    const fields = fieldsOf('lesson', lesson);
    assert.deepEqual(Object.keys(fields).sort(), ['sections.example.caption', 'sections.facts', 'sections.intro', 'sections.mistakes', 'sections.steps', 'steps.0.text']);
    assert.ok(!JSON.stringify(fields).includes('def fact'), 'code is not translated');
    assert.ok(!fields['sections.steps'].includes('Base case'), 'terms are not translated');
    assert.equal(sourceHash(fieldsOf('lesson', { steps: lesson.steps })), sourceHash({ 'steps.0.text': 'Recursion' }));
    const dropped = checkTranslation(fields, { ...fields, 'sections.facts': ['एक'] });
    assert.ok(dropped.blocking.some((f) => f.field === 'sections.facts'), JSON.stringify(dropped.findings));
  });

  test('a view: staff see the AI-draft label; a student reads the translation where it is whole, English where it is not', async () => {
    const { sections } = cleanConcept(CONCEPT, CHUNKS);
    const staff = await sectionsView({ status: 'draft', source: 'llm', sections }, { audience: 'staff' });
    assert.equal(staff.aiDraft, true);
    assert.match(staff.label, /^AI draft/);
    assert.equal(staff.intro.cite, 'Slide 1');
    assert.match(staff.example.html, /<pre|<code/);
    const hi = await sectionsView({ status: 'approved', source: 'llm', sections }, {
      fields: { 'sections.intro': 'पुनरावृत्ति', 'sections.facts': ['केवल एक'] },
    });
    assert.equal(hi.intro.text, 'पुनरावृत्ति');
    assert.equal(hi.facts[0].text, sections.facts[0].text, 'a list of another length falls back to English');
    assert.ok(!('aiDraft' in hi));
    const none = await sectionsView({ status: 'draft', source: 'slides', sections: null }, { audience: 'staff' });
    assert.equal(none.available, false);
    assert.equal(none.note, SECTIONS_SLIDES_ONLY);
    assert.equal((await sectionsView({ source: 'slides' })).note, STUDENT_NO_SECTIONS);
    assert.deepEqual(sectionFields(null), {});
  });
});

/* -------------------------------------------- lessons with the sections -- */

const SLIDES = [
  { slide: 1, text: 'Sets\nA set is a collection of distinct objects.' },
  { slide: 2, text: 'Sets\nThe empty set has 0 elements.' },
];

async function lessonFixture() {
  const repo = createMemoryRepo();
  const content = await repo.createContent({
    title: 'Discrete structures', kind: 'pptx', ownerId: PROF, rawText: SLIDES.map((s) => s.text).join('\n\n'),
    topics: ['Sets'], topicSlides: { Sets: [1, 2] }, slideTexts: SLIDES,
  });
  const { topics } = await syncTopics(repo, content);
  const sets = topics.find((t) => t.name === 'Sets');
  const mcq = (text, extra = {}) => ({
    contentId: content._id, topic: 'Sets', text, kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember',
    source: 'teacher', status: 'active', ...extra,
  });
  const [shared, kept] = await repo.insertQuestions([mcq('Which is a set?'), mcq('Kept for rooms?')]);
  await repo.setQuestionRoomsOnly(kept._id, true);
  return { repo, content, sets, shared, kept: await repo.getQuestion(kept._id) };
}

const reply = () => JSON.stringify({
  parts: [
    { part: 'C1', example: { problem: 'Is {1, 1} two things?', steps: ['Repeats count once.'], answer: 'No.' },
      questions: [{ kind: 'truefalse', bloom: 'remember', text: 'A set holds distinct objects.', answerBool: true },
        { kind: 'truefalse', bloom: 'remember', text: 'A set may hold repeats.', answerBool: false }] },
  ],
  concept: {
    intro: { text: 'Sets are where discrete structures start.', parts: ['C1'] },
    steps: [{ term: 'Set', text: 'A collection of distinct objects.', parts: ['C1'] }, { term: 'Empty set', text: 'It has no elements.', parts: ['C1'] }],
  },
});

describe('a lesson with its concept panel', () => {
  test('the stand-in model\'s sections are kept on the draft, cited; a student reads them once approved', async () => {
    const { repo, content, sets } = await lessonFixture();
    const { lesson } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof, callModel: async () => reply() });
    assert.equal(lesson.sections.intro.text, 'Sets are where discrete structures start.');
    assert.deepEqual(lesson.sections.intro.slides, [1, 2]);
    const staff = await staffLessonView(repo, lesson);
    assert.equal(staff.sections.aiDraft, true);
    const approved = await repo.approveTopicLesson(lesson._id, { by: PROF });
    const student = await studentLessonView(repo, { lesson: approved, account: asha });
    assert.equal(student.sections.available, true);
    assert.equal(student.sections.steps.length, 2);
    assert.ok(!/AI draft|stand-in|"parts"/.test(JSON.stringify(student.sections)));
  });

  test('the slides-only lesson has none, and says so', async () => {
    const { repo, content, sets } = await lessonFixture();
    const { lesson } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    assert.equal(lesson.source, 'slides');
    assert.equal(lesson.sections ?? null, null);
    assert.equal((await staffLessonView(repo, lesson)).sections.note, SECTIONS_SLIDES_ONLY);
  });

  test('a question kept for rooms only is never one a lesson deals, shows or takes an answer to; the rest carry a serve token', async () => {
    const { repo, content, sets, shared, kept } = await lessonFixture();
    assert.ok(isRoomsOnly(kept) && !isRoomsOnly(shared));
    assert.deepEqual(retrievalPool([shared, kept]).map((q) => q.text), ['Which is a set?']);
    // A lesson listing both (written before the switch was turned on).
    const lesson = await repo.createTopicLesson({
      topicId: sets._id, contentId: content._id, ownerId: PROF, version: 1, source: 'slides', model: null,
      steps: [{ type: 'chunk', slides: [1], text: 'Sets' }, { type: 'questions', slides: [1], questionIds: [String(shared._id), String(kept._id)] }],
    });
    const approved = await repo.approveTopicLesson(lesson._id, { by: PROF });
    const bank = await repo.listQuestions(content._id, { includeDiscarded: true });
    assert.equal(lessonQuestion(approved, kept._id, bank), null);
    assert.equal(String(lessonQuestion(approved, shared._id, bank)._id), String(shared._id));
    const view = await studentLessonView(repo, { lesson: approved, account: asha });
    const qs = view.steps.find((s) => s.type === 'questions').questions;
    assert.deepEqual(qs.map((q) => q.text), ['Which is a set?']);
    assert.ok(checkServeToken(qs[0].serveToken, { accountId: asha.id, questionId: shared._id, mode: 'lesson' }).ok);
    const staff = await staffLessonView(repo, approved);
    assert.equal(staff.steps[1].questions.find((q) => q.id === String(kept._id)).roomsOnly, true);
  });

  test('practice never serves or takes an answer to a rooms-only question', () => {
    const q = { _id: 'q1', status: 'active', kind: 'mcq', roomsOnly: true };
    assert.equal(practisable(q), false);
    assert.equal(onceServable(q), false);
    assert.equal(practisable({ ...q, roomsOnly: false }), true);
  });
});

/* -------------------------------------------------------- serve tokens -- */

describe('serve tokens', () => {
  const who = { accountId: asha.id, questionId: 'Q-1', mode: 'practice' };
  test('a token proves this question was served to this account in this loop, and nothing else', () => {
    const token = serveToken(who);
    assert.ok(checkServeToken(token, who).ok);
    assert.ok(checkServeToken(token, { ...who, questionId: 'q-1' }).ok, 'ids compare in lower case');
    assert.ok(checkServeToken(token, { ...who, mode: 'review' }).ok, 'practice and review are one loop');
    for (const other of [{ accountId: 'someone-else' }, { questionId: 'Q-2' }, { mode: 'lesson' }]) {
      const v = checkServeToken(token, { ...who, ...other });
      assert.deepEqual([v.ok, v.message], [false, TOKEN_MISSING]);
    }
    assert.equal(checkServeToken('', who).ok, false);
    assert.equal(checkServeToken(`${token.slice(0, -1)}A`, who).ok, token.endsWith('A'));
  });

  test('an old token is refused as expired; a forged expiry breaks the signature', () => {
    const then = new Date('2026-11-01T00:00:00Z');
    const token = serveToken({ ...who, now: then });
    const late = checkServeToken(token, { ...who, now: new Date('2026-11-19T00:00:00Z') });
    assert.deepEqual([late.ok, late.why, late.message], [false, 'expired', TOKEN_EXPIRED]);
    const [, sig] = token.split('.');
    assert.equal(checkServeToken(`9999999999.${sig}`, who).why, 'missing');
  });
});

/* -------------------------------------------- the room and the hub share -- */

function q(id, bloom) {
  return { _id: id, contentId: 'c', topic: 'T', text: id, options: ['A', 'B', 'C', 'D'], answerIdx: 0, bloom, status: 'active', source: 'teacher' };
}

describe('the room avoids what a signed-in student already practised', () => {
  const profile = () => hydrate({ sessionId: 's', rollNo: '07', name: 'A', levels: emptyLevels(), workingLevel: 'remember', history: [] });
  const BANK = [q('r1', 'remember'), q('r2', 'remember'), q('u1', 'understand')];

  test('another question of the level chosen comes first', () => {
    for (let i = 0; i < 10; i += 1) {
      const pick = selectNext(profile(), BANK, { rng: () => i / 10, avoid: new Set(['r1']) });
      assert.equal(pick.question._id, 'r2');
    }
  });

  test('when every question of that level was practised, one is served anyway: the level never changes because of it', () => {
    const pick = selectNext(profile(), BANK, { rng: () => 0, avoid: new Set(['r1', 'r2']) });
    assert.equal(pick.level, 'remember');
    assert.equal(pick.question.bloom, 'remember');
  });

  test('without an avoid set, the choice is exactly as before', () => {
    for (const r of [0, 0.4, 0.9]) {
      assert.equal(selectNext(profile(), BANK, { rng: () => r }).question._id, selectNext(profile(), BANK, { rng: () => r, avoid: new Set() }).question._id);
    }
  });

  test('a verified answer to a question practised before it is noted; an unverified or earlier one is not', () => {
    const A = 'acc-1';
    const answers = [
      { _id: 'a1', accountId: A, accountVerified: true, questionId: 'Q1', answeredAt: '2026-11-19T10:00:00Z' },
      { _id: 'a2', accountId: A, accountVerified: false, questionId: 'Q1', answeredAt: '2026-11-19T10:00:00Z' },
      { _id: 'a3', accountId: A, accountVerified: true, questionId: 'Q2', answeredAt: '2026-11-19T08:00:00Z' },
    ];
    const attempts = [
      { accountId: A, questionId: 'q1', createdAt: '2026-11-18T10:00:00Z' },
      { accountId: A, questionId: 'Q2', createdAt: '2026-11-19T09:00:00Z' },
    ];
    const noted = practisedBefore(answers, attempts);
    assert.deepEqual([...noted.keys()], ['a1']);
    assert.match(PRACTISED_NOTE, /practised this question in the Learning Hub/);
  });
});

/* ------------------------------------------------------ why this path -- */

describe('why this path names the change the evidence made (older H5)', () => {
  const items = [
    { topicId: 't-fn', name: 'Functions', outcome: 'ready', reason: 'decided', source: 'check', answers: 2, right: 2, depth: 2, via: [] },
    { topicId: 't-rec', name: 'Recursion', outcome: 'needs-review', reason: 'decided', source: 'check', answers: 2, right: 0, depth: 1, via: [] },
    { topicId: 't-basics', name: 'Basics', outcome: 'ready', reason: 'mastered', source: 'practice', answers: 6, right: null, depth: 3, via: [] },
  ];
  const target = { topicId: 't-trees', name: 'Trees' };

  test('a Ready prerequisite is marked so and skipped; a step done since the check says it was marked done', () => {
    const since = [
      { topicId: 't-rec', questionId: 'r1', correct: true, createdAt: '2026-11-19T10:00:00Z' },
      { topicId: 't-rec', questionId: 'r2', correct: true, createdAt: '2026-11-19T10:01:00Z' },
    ];
    const path = refresherPath({ items, target, since, checkedAt: '2026-11-11T09:00:00Z' });
    assert.equal(path.steps[0].status, 'done');
    assert.match(path.steps[0].why, /so this step is marked done\.$/);
    assert.match(path.why.sentence, /"Functions" was 2 of 2 in the check, so it is marked Ready and you can skip it\./);
    assert.match(path.why.sentence, /"Basics" was already mastered in practice \(6 answers\)/);
    assert.match(path.why.sentence, /Since then you got 2 of 2 answers right on "Recursion", so that step is marked done\./);
    assert.deepEqual(path.why.changes.map((c) => c.change), ['ready', 'needs-review', 'done', 'ready']);
    assert.match(path.why.source.label, /^Your Get Ready check · 11 Nov/);
  });

  test('for staff, in the third person; with nothing to review, it says so', () => {
    assert.match(pathWhy({ items, steps: [], audience: 'staff' }).sentence, /they can skip it/);
    assert.equal(pathWhy({ items: [] }).sentence, 'The check found nothing you need to review first.');
  });
});
