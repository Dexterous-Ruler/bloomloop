// Phase 6: lessons from the professor's slides and the English/Hindi/Marathi
// switch (decisions H11 and H12).
//
// Pinned here: where a lesson's text comes from and how it is cited (each
// slide's words, an older deck's slide numbers, pasted text); the model's lesson
// reply and translation reply parsed from fixture responses through the real
// parsers; the offline "slides only" lesson; approval gating and regenerating
// that keeps the approved lesson serving; the translation check catching a
// changed number, a dropped option and a changed formula; which language a
// student is shown and which an attempt records; item statistics by language;
// and the in-process store's side of 0027's contract. End to end, over HTTP,
// in scripts/lessons.mjs. Never calls Gemini, Supabase or any network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { syncTopics } from '../src/services/hubTopics.js';
import { approvePatch } from '../src/services/edits.js';
import { score } from '../src/questionTypes.js';
import {
  MAX_CHUNKS, MAX_CHUNK_CHARS, MAX_QUESTIONS, NO_QUESTIONS_YET, STUDENT_LABEL, buildLessonPrompt, chunkPieces, citeSlides,
  lessonQuestion, lessonSource, parseLessonReply, retrievalPool, servedFor, splitLong, staffLessonView, studentLessonView,
  topicSection, writeLessonDraft,
} from '../src/services/hubLessons.js';
import {
  ITEM_KINDS, OPTION_KINDS, attemptLanguage, buildTranslationPrompt, checkTranslation, fieldsHtml, fieldsOf, isCurrent, languageItemStats,
  languageShown, localiseQuestion, numbersIn, parseTranslationReply, registerTranslatable, servableTranslations, shownLanguage,
  sourceHash, translateItems, translationView,
} from '../src/services/hubLanguages.js';
import {
  PRACTICE_STORE, attemptStoreConnected, connectAttemptStore, listHubAttempts, recordHubAttempt,
} from '../src/services/hubAttemptBridge.js';

// The model is never called here: replies are fixtures through the real parsers.
config.gemini.apiKey = '';

const PROF = 'a0000000-0000-4000-8000-00000000000a';
const asha = { id: 'student-1', role: 'student' };
const prof = { id: PROF, role: 'professor' };

const SLIDES = [
  { slide: 1, text: 'Sets\nA set is a collection of distinct objects.\nMembership is written $x \\in S$.' },
  { slide: 2, text: 'Sets\nThe empty set has 0 elements.' },
  { slide: 3, text: 'Relations\nA relation pairs elements of two sets.' },
];

/** A deck that kept each slide's words, its topic records, and the bank's questions on "Sets". */
async function fixture() {
  const repo = createMemoryRepo();
  const content = await repo.createContent({
    title: 'Discrete structures', kind: 'pptx', ownerId: PROF,
    rawText: SLIDES.map((s) => s.text).join('\n\n'), topics: ['Sets', 'Relations'],
    topicSlides: { Sets: [1, 2], Relations: [3] }, slideTexts: SLIDES,
  });
  const { topics } = await syncTopics(repo, content);
  const sets = topics.find((t) => t.name === 'Sets');
  const relations = topics.find((t) => t.name === 'Relations');
  const mcq = (text, extra = {}) => ({
    contentId: content._id, topic: 'Sets', text, kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember',
    source: 'teacher', status: 'active', ...extra,
  });
  const bank = await repo.insertQuestions([
    mcq('Which is a set?'),
    mcq('Pick the empty set', { bloom: 'understand' }),
    mcq('A draft on sets', { status: 'draft', source: 'llm', model: 'm' }),
    mcq('Gone', { status: 'discarded' }),
    { contentId: content._id, topic: 'Sets', text: 'Explain sets', kind: 'open', rubric: ['distinct objects'], bloom: 'create', source: 'teacher', status: 'active' },
    { contentId: content._id, topic: 'Sets', text: 'How sure?', kind: 'poll', options: ['a', 'b'], bloom: 'remember', source: 'teacher', status: 'active' },
    mcq('About relations', { topic: 'Relations' }),
  ]);
  return { repo, content, sets, relations, bank };
}

/** What a model might reply for the "Sets" topic's two chunks (C1: slide 1, C2: slide 2). */
function fixtureReply(over = {}) {
  return JSON.stringify({
    parts: [
      {
        part: 'C1',
        example: { problem: 'Is {1, 1, 2} written as a set with 3 elements?', steps: ['A set holds distinct objects.', 'Repeats count once.'], answer: 'No: it has 2 elements.' },
        questions: [
          { kind: 'mcq', bloom: 'remember', text: 'What does a set hold?', options: ['Distinct objects', 'Ordered pairs', 'Repeated values', 'Only numbers'], answerIdx: 0 },
          { kind: 'truefalse', bloom: 'remember', text: 'Membership is written with the symbol $\\in$.', answerBool: true },
        ],
      },
      {
        part: 'C2',
        example: { problem: 'How many elements has the empty set?', steps: ['The slide says the empty set has 0 elements.'], answer: '0' },
        questions: [
          { kind: 'truefalse', bloom: 'remember', text: 'The empty set has one element.', answerBool: false },
          { kind: 'mcq', bloom: 'remember', text: 'How many elements has the empty set?', options: ['0', '1', '2', 'Infinitely many'], answerIdx: 0 },
        ],
      },
      ...(over.extra ?? []),
    ],
  });
}

/* ------------------------------------------------------------ the source -- */

describe('where a lesson\'s text comes from, and how it is cited (H4)', () => {
  test('citations read as a person writes them', () => {
    assert.equal(citeSlides([3]), 'Slide 3');
    assert.equal(citeSlides([4, 3]), 'Slides 3 and 4');
    assert.equal(citeSlides([7, 3, 4, 3]), 'Slides 3, 4 and 7');
    assert.equal(citeSlides([]), null);
  });

  test('a long text is split at line ends, then sentences, never past the cap', () => {
    const long = Array.from({ length: 30 }, (_, i) => `Line ${i} says something about sets that is worth reading.`).join('\n');
    const parts = splitLong(long, 200);
    assert.ok(parts.length > 1 && parts.every((p) => p.length <= 200));
    assert.equal(parts.join('\n').replace(/\n/g, ' '), long.replace(/\n/g, ' '));
    const sentence = `${'Word '.repeat(80).trim()}.`;
    assert.ok(splitLong(sentence, 100).every((p) => p.length <= 100));
  });

  test('chunks join consecutive slides within the caps and cite their own slides', () => {
    const chunks = chunkPieces([
      { slides: [1], text: 'a'.repeat(300) },
      { slides: [2], text: 'b'.repeat(300) },
      { slides: [3], text: 'c'.repeat(500) },
      { slides: [4], text: 'd' },
      { slides: [5], text: 'e' },
      { slides: [6], text: 'f' },
    ]);
    assert.deepEqual(chunks.map((c) => [c.label, c.slides]), [['C1', [1, 2]], ['C2', [3, 4, 5]], ['C3', [6]]]);
    assert.ok(chunks.every((c) => c.text.length <= MAX_CHUNK_CHARS));
  });

  test('a deck that kept its slides\' words: the topic\'s slides, word for word, cited slide by slide', async () => {
    const { content, sets } = await fixture();
    const src = lessonSource(content, sets);
    assert.equal(src.basis.from, 'slides');
    assert.equal(src.basis.perSlideText, true);
    assert.deepEqual(src.chunks.map((c) => c.slides), [[1, 2]]);
    assert.ok(src.chunks[0].text.includes('Membership is written $x \\in S$.') && src.chunks[0].text.includes('0 elements'));
    assert.ok(!src.chunks[0].text.includes('relation'));
  });

  test('an older deck: the chapter\'s text from the topic\'s heading to the next topic\'s, citing its slides together, and saying so', () => {
    const content = {
      kind: 'pptx', title: 'Old', topics: ['Sets', 'Relations'], topicSlides: { Sets: [1, 2], Relations: [3] },
      rawText: 'Sets\nA set is a collection.\n\nSets\nThe empty set.\n\nRelations\nA relation pairs elements.',
    };
    const src = lessonSource(content, { name: 'Sets' });
    assert.equal(src.basis.from, 'chapter-slides');
    assert.match(src.basis.note, /uploaded before each slide's words were kept/);
    assert.match(src.basis.note, /Slides 1 and 2/);
    assert.ok(src.chunks.every((c) => JSON.stringify(c.slides) === '[1,2]'));
    const all = src.chunks.map((c) => c.text).join('\n');
    assert.ok(all.includes('The empty set.') && !all.includes('relation pairs'));
  });

  test('pasted text: the topic\'s section, citing no slide, and saying so', () => {
    const content = { kind: 'syllabus', topics: ['Direct proof', 'Induction'], rawText: 'Direct proof\nAssume P, show Q.\nInduction\nA base case and a step.' };
    const src = lessonSource(content, { name: 'Induction' });
    assert.equal(src.basis.from, 'chapter-text');
    assert.match(src.basis.note, /pasted as text/);
    assert.deepEqual(src.chunks.map((c) => c.slides), [[]]);
    assert.equal(src.chunks[0].text, 'Induction\nA base case and a step.');
    assert.equal(topicSection(content.rawText, '2. Induction', content.topics).found, false);
    assert.equal(topicSection('- Induction\nsteps', 'Induction', []).found, true);
  });

  test('a topic longer than one lesson is cut at MAX_CHUNKS, and the lesson says what was left out', () => {
    const texts = Array.from({ length: 20 }, (_, i) => ({ slide: i + 1, text: `Sets ${i}\n${'x'.repeat(800)}` }));
    const content = { kind: 'pptx', topics: ['Sets'], topicSlides: { Sets: texts.map((t) => t.slide) }, slideTexts: texts };
    const src = lessonSource(content, { name: 'Sets' });
    assert.equal(src.chunks.length, MAX_CHUNKS);
    assert.match(src.warnings[0], /first 8 parts; slides 9, .* are left out/);
  });
});

/* ------------------------------------------------------------- the model -- */

describe('the model\'s lesson reply, parsed from fixtures (H11)', () => {
  const chunks = [{ label: 'C1', slides: [1], text: 'one' }, { label: 'C2', slides: [2], text: 'two' }];

  test('the prompt carries only the professor\'s text, the rules and the parts', () => {
    const prompt = buildLessonPrompt({ topic: 'Sets', chapterTitle: 'Discrete', chunks, avoid: ['Which is a set?'] });
    assert.match(prompt, /C1 \(Slide 1\):\n"""\none\n"""/);
    assert.match(prompt, /Never add anything the part does not teach/);
    assert.match(prompt, /Which is a set\?/);
  });

  test('a good reply: one example and its recall questions per part', () => {
    const { parts, skipped } = parseLessonReply(fixtureReply(), { chunks, topic: 'Sets' });
    assert.deepEqual(skipped, []);
    assert.equal(parts.get('C1').example.steps.length, 2);
    assert.deepEqual(parts.get('C1').questions.map((q) => [q.kind, q.bloom, q.topic]), [['mcq', 'remember', 'Sets'], ['truefalse', 'remember', 'Sets']]);
  });

  test('held to the rules: unknown parts, a second answer for a part, bad examples and bad questions are named and left out', () => {
    const bad = JSON.stringify({
      parts: [
        { part: 'C9', example: { problem: 'x', steps: ['y'], answer: 'z' }, questions: [] },
        {
          part: 'c1',
          example: { problem: 'P', steps: [], answer: 'A' },
          questions: [
            { kind: 'mcq', bloom: 'remember', text: 'Three options?', options: ['a', 'b', 'c'], answerIdx: 0 },
            { kind: 'mcq', bloom: 'remember', text: 'Which?', options: ['a', 'b', 'c', 'All of the above'], answerIdx: 3 },
            { kind: 'match', bloom: 'understand', text: 'Pair them', pairs: [{ left: 'a', right: '1' }, { left: 'b', right: '2' }, { left: 'c', right: '3' }] },
            { kind: 'truefalse', bloom: 'remember', text: 'Is this a question?', answerBool: true },
            { kind: 'truefalse', bloom: 'remember', text: 'Sets hold distinct objects.', answerBool: true },
            ...Array.from({ length: 6 }, (_, i) => ({ kind: 'truefalse', bloom: 'remember', text: `Claim ${i}.`, answerBool: true })),
          ],
        },
        { part: 'C1', example: { problem: 'again', steps: ['s'], answer: 'a' }, questions: [] },
        { part: 'C2', example: { problem: 'Call 98765 43210', steps: ['s'], answer: 'a' }, questions: [] },
      ],
    });
    const { parts, skipped } = parseLessonReply(bad, { chunks, topic: 'Sets', avoid: ['Sets hold distinct objects.'] });
    const why = skipped.map((s) => `${s.part}: ${s.why}`).join(' | ');
    assert.ok(!parts.has('C9'));
    assert.equal(parts.get('C1').example, null);
    assert.equal(parts.get('C1').questions.length, MAX_QUESTIONS);
    assert.ok(parts.get('C1').questions.every((q) => q.kind === 'truefalse' && /^Claim/.test(q.text)));
    assert.match(why, /C9: it named a part of the slides that was not offered/);
    assert.match(why, /C1: its worked example was left out: it needs 1 to 6 steps/);
    assert.match(why, /mcq needs exactly 4 options/);
    assert.match(why, /truefalse text must be a statement/);
    assert.match(why, /all of the above/);
    assert.match(why, /not a recall question/);
    assert.match(why, /repeats one already in the bank/);
    assert.match(why, /more than 4 were written/);
    assert.match(why, /C1: the part was written twice/);
    assert.match(why, /C2: its worked example was left out: it held contact details/);
  });

  test('a reply that is not JSON, or holds no parts, is refused', () => {
    assert.throws(() => parseLessonReply('sure, here you go', { chunks, topic: 'Sets' }), /not JSON/);
    assert.throws(() => parseLessonReply('{"lesson": 1}', { chunks, topic: 'Sets' }), /no list of parts/);
    assert.equal(parseLessonReply(`\`\`\`json\n${fixtureReply()}\n\`\`\``, { chunks, topic: 'Sets' }).parts.size, 2);
  });
});

/* -------------------------------------------------------------- writing -- */

describe('writing a lesson draft (H11)', () => {
  test('with the model: an AI draft, chunk -> example -> questions in order, its questions written into the bank as drafts', async () => {
    const { repo, content, sets } = await fixture();
    // Two chunks for the fixture's two parts.
    const two = { ...content, slideTexts: SLIDES.map((s) => ({
      ...s, text: `${s.text}\n${(s.slide === 1 ? 'More about sets. ' : 'Still on the empty set. ').repeat(25)}`.trim(),
    })) };
    let asked = '';
    const { lesson, drafted, warnings } = await writeLessonDraft(repo, {
      content: two, topic: sets, viewer: prof, callModel: async (prompt) => { asked = prompt; return fixtureReply(); },
    });
    assert.match(asked, /C1 \(Slide 1\)/);
    assert.match(asked, /C2 \(Slide 2\)/);
    assert.equal(lesson.status, 'draft');
    assert.equal(lesson.source, 'llm');
    assert.equal(lesson.model, 'stand-in');
    assert.equal(lesson.version, 1);
    assert.deepEqual(lesson.steps.map((s) => s.type), ['chunk', 'example', 'questions', 'chunk', 'example', 'questions']);
    assert.ok(lesson.steps[0].text.startsWith('Sets\nA set is a collection'), 'the chunk is the professor\'s own words');
    assert.equal(drafted.length, 4);
    assert.ok(drafted.every((q) => q.status === 'draft' && q.source === 'llm' && q.model === 'stand-in' && q.createdBy === PROF
      && Array.isArray(q.checks) && q.topic === 'Sets'));
    assert.deepEqual(drafted.map((q) => q.sourceRef), [{ kind: 'slides', slides: [1] }, { kind: 'slides', slides: [1] },
      { kind: 'slides', slides: [2] }, { kind: 'slides', slides: [2] }]);
    assert.deepEqual(lesson.steps[2].questionIds, drafted.slice(0, 2).map((q) => String(q._id)));
    assert.deepEqual(warnings, []);
    // The bank's active questions are as they were: drafts serve no room.
    assert.equal(await repo.countQuestions(content._id), 5);
  });

  test('offline (no key): slides only, the topic\'s approved questions dealt over the chunks, no generated prose, no new question', async () => {
    const { repo, content, sets } = await fixture();
    const before = (await repo.listQuestions(content._id, { includeDiscarded: true })).length;
    const { lesson, drafted } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    assert.equal(lesson.source, 'slides');
    assert.equal(lesson.model, null);
    assert.deepEqual(lesson.steps.map((s) => s.type), ['chunk', 'questions']);
    assert.equal(drafted.length, 0);
    assert.equal((await repo.listQuestions(content._id, { includeDiscarded: true })).length, before);
    const asked = (await Promise.all(lesson.steps[1].questionIds.map((id) => repo.getQuestion(id)))).map((q) => q.text);
    assert.deepEqual(asked, ['Which is a set?', 'Pick the empty set'], 'approved, answered at once, lowest level first; no draft, discarded, open or poll');
    assert.ok(!lesson.steps.some((s) => s.type === 'example'));
  });

  test('offline with no approved question: chunks only, and the lesson says how to add some', async () => {
    const { repo, content, relations, bank } = await fixture();
    await repo.updateQuestion(bank[6]._id, { status: 'draft' });
    const { lesson } = await writeLessonDraft(repo, { content, topic: relations, viewer: prof });
    assert.deepEqual(lesson.steps.map((s) => s.type), ['chunk']);
    assert.ok(lesson.warnings.includes(NO_QUESTIONS_YET));
  });

  test('a failed model call, or a reply with nothing usable, makes a slides-only lesson and says why', async () => {
    const { repo, content, sets } = await fixture();
    const failed = await writeLessonDraft(repo, { content, topic: sets, viewer: prof, callModel: async () => { throw new Error('quota exhausted'); } });
    assert.equal(failed.lesson.source, 'slides');
    assert.match(failed.lesson.warnings.join(' '), /could not write this lesson \(quota exhausted\)/);
    const empty = await writeLessonDraft(repo, { content, topic: sets, viewer: prof, callModel: async () => '{"parts": []}' });
    assert.equal(empty.lesson.source, 'slides');
    assert.equal(empty.lesson.version, 2);
    assert.match(empty.lesson.warnings.join(' '), /nothing usable/);
  });

  test('a topic with no text is refused before anything is written', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Empty', kind: 'syllabus', rawText: '', topics: ['Nothing'], ownerId: PROF });
    const [topic] = (await syncTopics(repo, content)).topics;
    await assert.rejects(writeLessonDraft(repo, { content, topic, viewer: prof }), (err) => err.status === 409);
    assert.deepEqual(await repo.listTopicLessons({ topicId: topic._id }), []);
  });
});

/* ------------------------------------------------------------ approving -- */

describe('approval gating, and regenerating keeps the approved lesson serving (H11, H2)', () => {
  const serving = async (repo, topic) => (await repo.listTopicLessons({ topicId: topic._id })).find((l) => l.status === 'approved') ?? null;

  test('a draft serves nobody; approved, it serves; a new version waits as a draft until approved, then retires the old', async () => {
    const { repo, content, sets } = await fixture();
    const { lesson: v1, drafted } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof, callModel: async () => fixtureReply() });
    assert.equal(await serving(repo, sets), null);
    await repo.approveTopicLesson(v1._id, { by: PROF });
    assert.equal(String((await serving(repo, sets))._id), String(v1._id));

    // The student reads it, and its questions only once the bank approves them.
    let view = await studentLessonView(repo, { lesson: await repo.getTopicLesson(v1._id), account: asha });
    assert.equal(view.label, STUDENT_LABEL.llm);
    assert.deepEqual(view.steps.map((s) => s.type), ['chunk', 'example'], 'no question step while every question is a draft');
    const q = drafted[0];
    await repo.updateQuestion(q._id, approvePatch(q, { by: PROF }).patch);
    view = await studentLessonView(repo, { lesson: await repo.getTopicLesson(v1._id), account: asha });
    assert.deepEqual(view.steps.map((s) => s.type), ['chunk', 'example', 'questions']);
    assert.deepEqual(view.steps[2].questions.map((x) => x._id), [String(q._id)]);

    const { lesson: v2 } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    assert.equal(v2.version, 2);
    assert.equal(String((await serving(repo, sets))._id), String(v1._id), 'regenerating leaves the approved lesson serving');
    await repo.approveTopicLesson(v2._id, { by: PROF });
    const after = await repo.listTopicLessons({ topicId: sets._id });
    assert.deepEqual(after.map((l) => [l.version, l.status]), [[1, 'superseded'], [2, 'approved']]);
    assert.ok(after[0].retiredAt && after[0].approvedAt, 'the old one keeps when it was approved, and says when it was retired');
  });

  test('the student\'s view carries no key, draft, model, warning or basis; the staff view says what waits for approval', async () => {
    const { repo, content, sets } = await fixture();
    const { lesson } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    const approved = await repo.approveTopicLesson(lesson._id, { by: PROF });
    const view = await studentLessonView(repo, { lesson: approved, account: asha });
    const text = JSON.stringify(view);
    assert.ok(!/answerIdx|answerBool|"accept"|rubric|warnings|basis|"model"|stand-in|draft|misconception/.test(text), text.match(/answerIdx|answerBool|accept|rubric|warnings|basis|model|draft/)?.[0]);
    assert.deepEqual(Object.keys(view).sort(), ['answering', 'approvedAt', 'id', 'label', 'language', 'steps', 'version']);
    assert.equal(view.steps[1].questions[0].provenance.text, 'Written by your professor.');
    assert.ok(view.steps[0].html.includes('<math>'), 'the slide\'s formula is rendered');

    const { lesson: ai, drafted } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof, callModel: async () => fixtureReply() });
    const staff = await staffLessonView(repo, ai);
    assert.equal(staff.statusLabel, 'AI draft: students do not see it until you approve it.');
    assert.equal(staff.questions.waiting, drafted.length);
    assert.match(staff.questions.note, /wait for your approval in the bank/);
  });

  // The client session's ask of 19 Nov 2026: a lesson's questions reached the
  // staff queue as plain text only, so a formula showed as its TeX source.
  test('the staff view gives each of a lesson\'s questions as HTML too, beside its text', async () => {
    const { repo, content, sets, bank } = await fixture();
    await repo.updateQuestion(bank[0]._id, { text: 'Which of these is $\\{1, 2\\}$?' });
    const lesson = await repo.createTopicLesson({
      topicId: sets._id, contentId: content._id, ownerId: PROF, version: 1, source: 'slides', model: null,
      steps: [{ type: 'questions', slides: null, questionIds: [bank[0]._id, bank[1]._id] }], basis: { from: 'chapter-text' }, warnings: [],
    });
    const [first, second] = (await staffLessonView(repo, lesson)).steps[0].questions;
    assert.equal(first.text, 'Which of these is $\\{1, 2\\}$?');
    assert.match(first.textHtml, /<math/);
    assert.doesNotMatch(first.textHtml, /\$/);
    assert.equal(second.textHtml, 'Pick the empty set');
  });

  test('approving or discarding anything but a draft is a 409, and nothing changes', async () => {
    const { repo, content, sets } = await fixture();
    const { lesson } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    await repo.approveTopicLesson(lesson._id, { by: PROF });
    await assert.rejects(repo.approveTopicLesson(lesson._id, { by: PROF }), (err) => err.status === 409 && /this one is approved/.test(err.message));
    await assert.rejects(repo.discardTopicLesson(lesson._id, { by: PROF }), (err) => err.status === 409);
    assert.equal((await repo.getTopicLesson(lesson._id)).status, 'approved');
    assert.equal(await repo.approveTopicLesson('0123456789abcdef01234567'), null);
    const { lesson: second } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    assert.equal((await repo.discardTopicLesson(second._id, { by: PROF })).status, 'discarded');
  });

  test('a lesson\'s question replaced through the bank is served as its replacement; a draft is never one a student answers', async () => {
    const bank = [
      { _id: 'q1', status: 'discarded' },
      { _id: 'q2', status: 'discarded', replacesId: 'q1' },
      { _id: 'q3', status: 'active', replacesId: 'q1' },
      { _id: 'q4', status: 'draft' },
    ];
    assert.equal(servedFor('q1', bank)._id, 'q3');
    assert.equal(servedFor('q4', bank), null);
    const lesson = { steps: [{ type: 'questions', questionIds: ['q1', 'q4'] }] };
    assert.equal(lessonQuestion(lesson, 'q3', bank)._id, 'q3');
    assert.equal(lessonQuestion(lesson, 'q1', bank)._id, 'q1', 'an answer to what the student was shown is still taken');
    assert.equal(lessonQuestion(lesson, 'q4', bank), null);
    assert.equal(lessonQuestion(lesson, 'q9', bank), null);
    assert.deepEqual(retrievalPool([{ _id: 'a', status: 'active', kind: 'poll' }, { _id: 'b', status: 'active', kind: 'open' }]), []);
  });
});

/* ---------------------------------------------------------- the check -- */

describe('the translation check (H12)', () => {
  const english = { text: 'If $x^2 = 9$, how many of the 3 roots are real?', options: ['2', '3', 'None', 'All 3'] };
  const good = { text: 'यदि $x^2 = 9$ है, तो 3 roots में से कितने real हैं?', options: ['2', '3', 'कोई नहीं', 'सभी 3'] };

  test('a faithful translation passes', () => {
    const check = checkTranslation(english, good);
    assert.equal(check.ok, true, JSON.stringify(check.findings));
  });

  // The client session's ask of 19 Nov 2026: the translation queue showed both
  // sides as plain text only, so a formula read as its TeX source on each.
  test('staff read a translation and its English as HTML too, field for field', async () => {
    const englishHtml = await fieldsHtml(english);
    assert.deepEqual(Object.keys(englishHtml), ['text', 'options']);
    assert.match(englishHtml.text, /<math/);
    assert.deepEqual(englishHtml.options, ['2', '3', 'None', 'All 3']);
    const listed = await fieldsHtml({ 'steps.0.steps': ['$a$', 'b < c'], hint: 7 });
    assert.match(listed['steps.0.steps'][0], /<math/);
    assert.equal(listed['steps.0.steps'][1], 'b &lt; c');
    assert.equal(listed.hint, null);
    const view = await translationView({
      _id: 't1', itemKind: 'question', itemId: 'q1', language: 'hi', status: 'draft', provenance: 'professor',
      fields: good, sourceFields: english, sourceHash: sourceHash(english), checks: [],
    }, english);
    assert.deepEqual(view.fields, good);
    assert.match(view.fieldsHtml.text, /<math/);
    assert.doesNotMatch(view.fieldsHtml.text, /\$/);
    assert.equal(view.fieldsHtml.options[2], 'कोई नहीं');
  });

  test('a changed number is flagged, naming both', () => {
    const check = checkTranslation(english, { ...good, text: good.text.replace('3 roots', '4 roots') });
    assert.equal(check.blocking.length, 0);
    assert.deepEqual(check.flags.map((f) => [f.field, f.id]), [['text', 'numbers']]);
    assert.match(check.flags[0].message, /the English has 3, the translation 4\./, 'numbers inside a formula are the formula check\'s');
  });

  test('a dropped option blocks approval', () => {
    const check = checkTranslation(english, { ...good, options: good.options.slice(0, 3) });
    assert.deepEqual(check.blocking.map((f) => [f.field, f.id]), [['options', 'count']]);
    assert.match(check.blocking[0].message, /The English question has 4 options, the translation 3\./);
  });

  test('a changed formula, a missing field and an untranslated sentence are each found', () => {
    const check = checkTranslation(
      { text: 'Solve $x + 1 = 2$ for x in this question here.', options: ['one', 'two'] },
      { text: 'Solve $x + 2 = 2$ for x in this question here.', options: ['एक', ' '] },
    );
    assert.deepEqual(check.findings.map((f) => [f.field, f.id]).sort(), [
      ['options.1', 'missing'], ['text', 'formulas'], ['text', 'untranslated'],
    ].sort());
  });

  test('numbers read in Devanagari digits and with thousands separators are the same numbers', () => {
    assert.deepEqual(numbersIn('३,००० और 12.5'), ['12.5', '3000']);
    assert.equal(checkTranslation({ text: 'It costs 3,000 rupees.' }, { text: 'इसकी कीमत ३००० रुपये है।' }).ok, true);
  });
});

/* -------------------------------------------------- the translation model -- */

describe('the model\'s translation reply, parsed from fixtures (H12)', () => {
  const items = [
    { label: 'I1', fields: { text: 'What is a set?', options: ['A list', 'A collection', 'A number', 'A map'] } },
    { label: 'I2', fields: { 'steps.0.text': 'Sets hold distinct objects.' } },
  ];

  test('the prompt keeps technical terms, formulas, numbers and list lengths', () => {
    const prompt = buildTranslationPrompt({ language: 'mr', items });
    assert.match(prompt, /into Marathi \(मराठी\)/);
    assert.match(prompt, /Keep technical terms in English/);
    assert.match(prompt, /Copy every formula between \$ signs/);
    assert.match(prompt, /Keep every number exactly as written/);
    assert.match(prompt, /same length and order/);
  });

  test('the schema\'s shape and a plain object both read; unknown items and keys are left out; an option list sent piece by piece is put together', () => {
    const reply = JSON.stringify({
      items: [
        { item: 'I1', fields: [{ key: 'text', text: 'set क्या है?' }, { key: 'options', list: ['एक list', 'एक collection', 'एक संख्या', 'एक map'] }, { key: 'answerIdx', text: '1' }] },
        { item: 'i2', fields: { 'steps.0.text': 'Sets में distinct objects होते हैं।', extra: 'x' } },
        { item: 'I7', fields: { text: 'x' } },
      ],
    });
    const { results, skipped } = parseTranslationReply(reply, { items });
    assert.deepEqual(Object.keys(results.get('I1')).sort(), ['options', 'text']);
    assert.deepEqual(results.get('I2'), { 'steps.0.text': 'Sets में distinct objects होते हैं।' });
    assert.deepEqual(skipped, [{ item: 'I7', why: 'it named an item that was not sent' }]);
    const pieces = parseTranslationReply(JSON.stringify({ items: [{ item: 'I1', fields: [
      { key: 'text', text: 't' }, { key: 'options.1', text: 'b' }, { key: 'options.0', text: 'a' }] }] }), { items });
    assert.deepEqual(pieces.results.get('I1').options, ['a', 'b'], 'two options came back: the check, not the parser, finds that');
    assert.throws(() => parseTranslationReply('नहीं', { items }), /not JSON/);
  });

  test('translateItems batches, keeps each result by its own key, and a failed call is a warning, never a throw', async () => {
    let calls = 0;
    const many = Array.from({ length: 10 }, (_, i) => ({ key: `q${i}`, fields: { text: `Question ${i}?` } }));
    const out = await translateItems({
      language: 'hi',
      items: many,
      callModel: async (prompt) => {
        calls += 1;
        if (calls === 2) throw new Error('timeout');
        const labels = [...prompt.matchAll(/^(I\d+): /gm)].map((m) => m[1]);
        return JSON.stringify({ items: labels.map((label) => ({ item: label, fields: [{ key: 'text', text: `प्रश्न ${label}?` }] })) });
      },
    });
    assert.equal(calls, 2);
    assert.equal(out.results.length, 8);
    assert.equal(out.results[0].key, 'q0');
    assert.deepEqual(out.skipped.map((s) => s.key), ['q8', 'q9']);
    assert.match(out.warnings[0], /could not translate 2 items: timeout/);
    const offline = await translateItems({ language: 'mr', items: many });
    assert.equal(offline.source, 'offline');
    assert.equal(offline.results.length, 0);
  });
});

/* -------------------------------------------------------------- showing -- */

describe('which language a student is shown, and which an attempt records (H12)', () => {
  async function translated() {
    const { repo, content, bank } = await fixture();
    const q = bank[0];
    const english = fieldsOf('question', q);
    const make = (fields, extra = {}) => repo.addItemTranslation({
      itemKind: 'question', itemId: q._id, contentId: content._id, ownerId: PROF, language: 'hi', fields,
      sourceFields: english, sourceHash: sourceHash(english), provenance: 'ai', model: 'm', checks: [], ...extra,
    });
    return { repo, content, q, english, make, bank };
  }

  test('a question\'s translatable fields are its wording and options, never its key', async () => {
    const { q, english } = await translated();
    assert.deepEqual(english, { text: 'Which is a set?', options: ['a', 'b', 'c', 'd'] });
    assert.deepEqual(fieldsOf('question', { text: 'Pair them', kind: 'match', pairs: [] }), { text: 'Pair them' });
    assert.deepEqual(fieldsOf('question', { text: 'True?', kind: 'truefalse', answerBool: true }), { text: 'True?' });
    assert.ok(!('answerIdx' in fieldsOf('question', q)));
    assert.deepEqual([...OPTION_KINDS], ['mcq', 'multi', 'poll']);
    assert.ok(ITEM_KINDS.includes('explanation') && ITEM_KINDS.includes('hint'));
    assert.throws(() => registerTranslatable('slides', {}), /not an item kind/);
  });

  test('a draft is not shown: English, with a plain note', async () => {
    const { repo, q, make } = await translated();
    await make({ text: 'कौन सा set है?', options: ['क', 'ख', 'ग', 'घ'] });
    const shown = await languageShown(repo, { kind: 'question', item: q, wanted: 'hi' });
    assert.deepEqual(shown, { requested: 'hi', language: 'en', translationId: null, note: 'This question is not in Hindi yet, so it is shown in English.' });
  });

  test('an approved translation is shown, position for position, so marking is the same in every language', async () => {
    const { repo, q, make } = await translated();
    const t = await make({ text: 'कौन सा set है?', options: ['क', 'ख', 'ग', 'घ'] });
    await repo.approveItemTranslation(t._id, { by: PROF });
    const shown = await languageShown(repo, { kind: 'question', item: q, wanted: 'hi' });
    assert.equal(shown.language, 'hi');
    assert.equal(shown.translationId, String(t._id));
    const map = await servableTranslations(repo, { kind: 'question', items: [q], language: 'hi' });
    const view = localiseQuestion(q, { _id: String(q._id), text: q.text, options: q.options, kind: 'mcq' }, map.get(String(q._id)));
    assert.deepEqual(view.options, ['क', 'ख', 'ग', 'घ']);
    assert.equal(score(q, 1, 's').correct, true, 'the same position is right whatever the language');
    assert.equal(shownLanguage({ kind: 'question', wanted: 'en', translation: null }).language, 'en');
  });

  test('when the English changes, the approved translation is out of date and English is shown again', async () => {
    const { repo, q, make } = await translated();
    const t = await make({ text: 'कौन सा set है?', options: ['क', 'ख', 'ग', 'घ'] });
    await repo.approveItemTranslation(t._id, { by: PROF });
    const edited = await repo.updateQuestion(q._id, { text: 'Which one is a set?' });
    assert.equal(isCurrent(await repo.getItemTranslation(t._id), fieldsOf('question', edited)), false);
    const shown = await languageShown(repo, { kind: 'question', item: edited, wanted: 'hi' });
    assert.equal(shown.language, 'en');
    assert.match(shown.note, /not in Hindi yet/);
  });

  test('an attempt records what the screen showed when it can have been shown, else what would be shown now', async () => {
    const { repo, q, make, content, bank } = await translated();
    const t = await make({ text: 'कौन सा set है?', options: ['क', 'ख', 'ग', 'घ'] });
    assert.deepEqual(await attemptLanguage(repo, { item: q, claim: { language: 'hi', translationId: String(t._id) }, wanted: 'hi' }),
      { language: 'en', translationId: null }, 'a draft was never on a student\'s screen');
    await repo.approveItemTranslation(t._id, { by: PROF });
    assert.deepEqual(await attemptLanguage(repo, { item: q, claim: { language: 'hi', translationId: String(t._id) } }),
      { language: 'hi', translationId: String(t._id) });
    assert.deepEqual(await attemptLanguage(repo, { item: bank[1], claim: { language: 'hi', translationId: String(t._id) }, wanted: 'hi' }),
      { language: 'en', translationId: null }, 'a translation of another question is not this one\'s');
    assert.deepEqual(await attemptLanguage(repo, { item: q, claim: { language: 'en' }, wanted: 'hi' }), { language: 'en', translationId: null });
    assert.deepEqual(await attemptLanguage(repo, { item: q, claim: null, wanted: 'hi' }), { language: 'hi', translationId: String(t._id) });
    // A newer approved translation replaces it; an answer given to the older one still says what it saw.
    const newer = await make({ text: 'कौनसा set है?', options: ['क', 'ख', 'ग', 'घ'] });
    await repo.approveItemTranslation(newer._id, { by: PROF });
    assert.deepEqual(await attemptLanguage(repo, { item: q, claim: { language: 'hi', translationId: String(t._id) } }),
      { language: 'hi', translationId: String(t._id) });
    assert.equal(content.title, 'Discrete structures');
  });

  test('a lesson is shown in the student\'s language once its translation is approved; its questions each by their own', async () => {
    const { repo, content, sets } = await fixture();
    const { lesson } = await writeLessonDraft(repo, { content, topic: sets, viewer: prof });
    const approved = await repo.approveTopicLesson(lesson._id, { by: PROF });
    const english = fieldsOf('lesson', approved);
    assert.deepEqual(Object.keys(english), ['steps.0.text']);
    const t = await repo.addItemTranslation({
      itemKind: 'lesson', itemId: approved._id, contentId: content._id, ownerId: PROF, language: 'mr',
      fields: { 'steps.0.text': 'Sets म्हणजे distinct objects चा संग्रह. $x \\in S$. रिकाम्या set मध्ये 0 घटक असतात.' },
      sourceFields: english, sourceHash: sourceHash(english), provenance: 'professor', checks: [],
    });
    let view = await studentLessonView(repo, { lesson: approved, account: asha, language: 'mr' });
    assert.equal(view.language.language, 'en');
    assert.match(view.language.note, /This lesson is not in Marathi yet/);
    await repo.approveItemTranslation(t._id, { by: PROF });
    view = await studentLessonView(repo, { lesson: approved, account: asha, language: 'mr' });
    assert.equal(view.language.language, 'mr');
    assert.match(view.steps[0].text, /म्हणजे/);
    assert.ok(view.steps[1].questions.every((q) => q.language.language === 'en' && /not in Marathi yet/.test(q.language.note)));
  });
});

/* ------------------------------------------------------- the statistics -- */

describe('item statistics by language from hub attempts (H12, for Phase 5\'s warning)', () => {
  test('each student\'s first graded attempt, split by language, with the warning past the threshold', () => {
    const at = (n) => `2026-11-19T10:${String(n).padStart(2, '0')}:00.000Z`;
    const attempts = [];
    for (let i = 0; i < 5; i += 1) attempts.push({ accountId: `en${i}`, questionId: 'q1', language: 'en', correct: true, answeredAt: at(i) });
    for (let i = 0; i < 5; i += 1) attempts.push({ accountId: `hi${i}`, questionId: 'q1', language: 'hi', correct: i < 2, answeredAt: at(i) });
    // A later, right attempt by a student whose first was wrong does not count.
    attempts.push({ accountId: 'hi4', questionId: 'q1', language: 'hi', correct: true, answeredAt: at(30) });
    attempts.push({ accountId: 'hi9', questionId: 'q1', language: 'hi', correct: true, ungraded: true, answeredAt: at(1) });
    const [row, other] = languageItemStats(attempts, [{ _id: 'q1', text: 'Which?' }, { _id: 'q2', text: 'Other' }]);
    assert.equal(row.students, 10);
    assert.deepEqual(row.languages.map((l) => [l.language, l.answers, l.correct]), [['en', 5, 5], ['hi', 5, 2]]);
    assert.match(row.warning.text, /Answers in Hindi were right 2 of 5 times \(40%\), against 5 of 5 \(100%\) in English/);
    assert.equal(other.students, 0);
    assert.equal(other.warning, null);
  });
});

/* ---------------------------------------------------- the attempt store -- */

describe('the attempt store\'s merge point (H5)', () => {
  test('with no store connected, an answer is refused, never taken and lost; reads find nothing', async () => {
    connectAttemptStore(null);
    assert.equal(attemptStoreConnected(), false);
    await assert.rejects(recordHubAttempt(createMemoryRepo(), { attemptId: 'a1' }), (err) => err.status === 503 && /still on your device/.test(err.message));
    assert.deepEqual(await listHubAttempts(createMemoryRepo(), {}), []);
  });

  test('a connected store gets each attempt, and its idempotency is its own', async () => {
    const kept = [];
    connectAttemptStore({
      record: async (_repo, a) => {
        const held = kept.find((k) => k.accountId === a.accountId && k.attemptId === a.attemptId);
        if (held) return { attempt: held, duplicate: true };
        kept.push(a);
        return { attempt: a, duplicate: false };
      },
      list: async () => kept,
    });
    try {
      assert.equal((await recordHubAttempt(null, { accountId: 's', attemptId: 'abcdefgh', correct: true })).duplicate, false);
      assert.equal((await recordHubAttempt(null, { accountId: 's', attemptId: 'abcdefgh', correct: false })).attempt.correct, true);
      assert.equal((await listHubAttempts(null)).length, 1);
    } finally {
      // Back to the store the merge connected: the practice loop's.
      connectAttemptStore(PRACTICE_STORE);
    }
  });
});

/* ------------------------------------------------------ the store's side -- */

describe('the in-process store keeps 0027\'s contract', () => {
  test('translations: one approved per item and language; text changes only while a draft; nothing is deleted', async () => {
    const repo = createMemoryRepo();
    const base = { itemKind: 'question', itemId: 'q1', contentId: 'c1', language: 'hi', fields: { text: 'a' }, sourceFields: { text: 'b' },
      sourceHash: sourceHash({ text: 'b' }), provenance: 'ai' };
    const one = await repo.addItemTranslation(base);
    const two = await repo.addItemTranslation(base);
    const mr = await repo.addItemTranslation({ ...base, language: 'mr' });
    assert.equal(one.status, 'draft');
    assert.equal((await repo.editItemTranslation(one._id, { fields: { text: 'c' }, provenance: 'professor', editedBy: PROF })).fields.text, 'c');
    await repo.approveItemTranslation(one._id, { by: PROF });
    await assert.rejects(repo.editItemTranslation(one._id, { fields: { text: 'd' } }), (err) => err.status === 409);
    await repo.approveItemTranslation(two._id, { by: PROF });
    await repo.approveItemTranslation(mr._id, { by: PROF });
    const rows = await repo.listItemTranslations({ itemKind: 'question', itemIds: ['q1'] });
    assert.deepEqual(rows.map((t) => [t.language, t.status]), [['hi', 'superseded'], ['hi', 'approved'], ['mr', 'approved']]);
    assert.equal((await repo.listItemTranslations({ itemIds: ['q1'], status: 'approved', language: 'hi' }))[0]._id, two._id);
    await assert.rejects(repo.discardItemTranslation(two._id), (err) => err.status === 409);
    assert.equal(typeof repo.deleteItemTranslation, 'undefined');
  });

  test('lessons: a version taken twice is a 409; a student\'s language is kept per account', async () => {
    const repo = createMemoryRepo();
    const doc = { topicId: 't1', contentId: 'c1', version: 1, source: 'slides', steps: [{ type: 'chunk', text: 'x' }] };
    await repo.createTopicLesson(doc);
    await assert.rejects(repo.createTopicLesson(doc), (err) => err.status === 409);
    assert.equal(await repo.getLanguageChoice('s1'), null);
    await repo.setLanguageChoice('s1', 'mr');
    assert.equal(await repo.getLanguageChoice('s1'), 'mr');
  });
});
