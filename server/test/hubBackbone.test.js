// Phase 6, the Learning Hub's content backbone (decisions H1 to H4).
//
// Pinned here: the access rule (a rostered student of the class's professor, the
// owner, an HOD, and the one 404 for everyone else, word for word); the
// prerequisite graph (loops refused with a sentence, chains nearest first, what
// a topic leads to, dependency order, only confirmed links used); a chapter's
// topic records kept in step with its list without rewriting a question; the
// model's proposed links parsed from fixture responses through the real parser,
// and the offline generator proposing none; per-slide text and what is said
// where none was kept; and the in-process store's side of the contract. The
// formula and code renderer is in richText.test.js; end to end, over HTTP and a
// phone's socket, in scripts/hub.mjs. Never calls Gemini, Supabase or any
// network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  NOT_FOUND, READ_ONLY, STAFF_ONLY, hubChapter, hubClass, hubClassToEdit, hubTopic, studentClasses, studentOnClass,
} from '../src/services/hubAccess.js';
import {
  dependantsOf, dependencyOrder, impliedByChain, loopSentence, prerequisiteChain, wouldLoop,
} from '../src/services/hubGraph.js';
import {
  MAX_TOPIC_NAME, slideTextsFrom, slidesNote, syncTopics, topicMatcher, topicRecordsFrom, topicSlideText,
} from '../src/services/hubTopics.js';
import {
  MAX_REASON, OFFLINE_NOTE, buildProposalPrompt, parseProposals, proposalInput, proposeLinks,
} from '../src/services/hubProposals.js';
import { staffClassView, studentClassView, topicView } from '../src/services/hubViews.js';
import { questionTopicFor } from '../src/services/generate.js';

// The model is never called here: proposals are parsed from fixture replies.
config.gemini.apiKey = '';

const PROF_A = 'a0000000-0000-4000-8000-00000000000a';
const PROF_B = 'b0000000-0000-4000-8000-00000000000b';
const HOD = 'c0000000-0000-4000-8000-00000000000c';
const student = (over = {}) => ({ id: 's1', role: 'student', reportsTo: PROF_A, rollNo: '21cs01', active: true, ...over });
const profA = { id: PROF_A, role: 'professor' };
const profB = { id: PROF_B, role: 'professor' };
const hod = { id: HOD, role: 'hod' };

/** A class of professor A with Asha (21CS01) on it and Bilal (21CS02) removed, and one chapter placed. */
async function fixture() {
  const repo = createMemoryRepo();
  const cls = await repo.createClass({ courseName: 'Networks', section: 'A', ownerId: PROF_A });
  const other = await repo.createClass({ courseName: 'Networks', section: 'B', ownerId: PROF_A });
  const theirs = await repo.createClass({ courseName: 'Signals', section: 'A', ownerId: PROF_B });
  const [, bilal] = await repo.addClassStudents(cls._id, [{ rollNo: '21CS01', name: 'Asha' }, { rollNo: '21CS02', name: 'Bilal' }]);
  await repo.updateClassStudent(bilal._id, { removedAt: '2026-11-19T08:00:00.000Z' });
  await repo.addClassStudents(theirs._id, [{ rollNo: '21CS01', name: 'Omar' }]);
  const content = await repo.createContent({ title: 'Layers', kind: 'syllabus', rawText: '', topics: ['Framing', 'Routing'], ownerId: PROF_A });
  const hidden = await repo.createContent({ title: 'Not placed', kind: 'syllabus', rawText: '', topics: ['Secret'], ownerId: PROF_A });
  await syncTopics(repo, content);
  await syncTopics(repo, hidden);
  await repo.placeClassChapter({ classId: cls._id, contentId: content._id, unitId: null, position: 1 });
  return { repo, cls, other, theirs, content, hidden };
}

/** Answers Supabase's accounts_below for the HOD, in-process; nothing leaves the machine. */
async function withHod(fn) {
  const saved = { ...config.supabase };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.pathname === '/rest/v1/rpc/accounts_below') {
      return new Response(JSON.stringify([{ id: PROF_A, role: 'professor', reports_to: HOD, active: true }]), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`refused: ${url.href}`);
  };
  Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(config.supabase, saved);
  }
}

const rejects404 = async (promise, what) => {
  await assert.rejects(promise, (err) => err.status === 404 && err.message === NOT_FOUND[what]);
};

/* ------------------------------------------------------------- the rule -- */

describe('the access rule (H1)', () => {
  const cls = { _id: 'k1', ownerId: PROF_A };
  const roster = [
    { rollNo: '21CS01', removedAt: null },
    { rollNo: '21CS02', removedAt: '2026-11-19T08:00:00.000Z' },
  ];

  test('a student of the class\'s professor whose roll number is on the roster, in any case or spacing', () => {
    assert.equal(studentOnClass(student(), cls, roster), true);
    assert.equal(studentOnClass(student({ rollNo: ' 21cs01 ' }), cls, roster), true);
  });

  test('not a student of another professor, even holding the same roll number', () => {
    assert.equal(studentOnClass(student({ reportsTo: PROF_B }), cls, roster), false);
  });

  test('not a student removed from the roster, nor one whose roll number it does not hold', () => {
    assert.equal(studentOnClass(student({ rollNo: '21CS02' }), cls, roster), false);
    assert.equal(studentOnClass(student({ rollNo: '21CS09' }), cls, roster), false);
    assert.equal(studentOnClass(student({ rollNo: null }), cls, roster), false);
  });

  test('not a deactivated account, a professor or an HOD, and not a class nobody owns', () => {
    assert.equal(studentOnClass(student({ active: false }), cls, roster), false);
    assert.equal(studentOnClass({ ...profA, reportsTo: PROF_A, rollNo: '21CS01' }, cls, roster), false);
    assert.equal(studentOnClass(student({ reportsTo: null }), { _id: 'k2', ownerId: null }, roster), false);
  });

  test('a student reaches their own class, and only it', async () => {
    const { repo, cls: own, other, theirs } = await fixture();
    const ctx = await hubClass(repo, student(), own._id);
    assert.deepEqual([ctx.access, ctx.canEdit], ['student', false]);
    assert.deepEqual((await studentClasses(repo, student())).map((c) => String(c._id)), [String(own._id)]);
    // On none of B's roster, of the same professor: the 404.
    await rejects404(hubClass(repo, student(), other._id), 'class');
    // Another professor's class whose roster holds the same roll number.
    await rejects404(hubClass(repo, student(), theirs._id), 'class');
  });

  test('a removed student, another professor\'s student and a class that does not exist get one 404, word for word', async () => {
    const { repo, cls } = await fixture();
    const errors = [];
    for (const [viewer, id] of [
      [student({ rollNo: '21CS02' }), cls._id],
      [student({ reportsTo: PROF_B }), cls._id],
      [student(), '0123456789abcdef01234567'],
      [student(), 'not-an-id'],
    ]) {
      errors.push(await hubClass(repo, viewer, id).then(() => null, (err) => ({ status: err.status, message: err.message })));
    }
    assert.ok(errors.every((e) => e && e.status === 404 && e.message === 'That class was not found.'), JSON.stringify(errors));
  });

  test('the owner reads and writes; another professor gets the 404', async () => {
    const { repo, cls } = await fixture();
    const own = await hubClassToEdit(repo, profA, cls._id);
    assert.deepEqual([own.access, own.canEdit], ['owner', true]);
    await rejects404(hubClass(repo, profB, cls._id), 'class');
    await rejects404(hubClassToEdit(repo, profB, cls._id), 'class');
  });

  test('an HOD reads the department\'s class and is refused a write with 403', async () => {
    const { repo, cls } = await fixture();
    await withHod(async () => {
      const read = await hubClass(repo, hod, cls._id);
      assert.deepEqual([read.access, read.canEdit], ['reader', false]);
      await assert.rejects(hubClassToEdit(repo, hod, cls._id), (err) => err.status === 403 && err.message === READ_ONLY);
    });
  });

  test('a student on a staff write is refused with 403 before anything is read', async () => {
    const { repo, cls } = await fixture();
    await assert.rejects(hubClassToEdit(repo, student(), cls._id), (err) => err.status === 403 && err.message === STAFF_ONLY);
    await assert.rejects(hubClassToEdit(repo, student(), 'nonsense'), (err) => err.status === 403);
  });

  test('a student reaches a chapter only while it is placed on their class; a retired topic is staff-only', async () => {
    const { repo, cls, content, hidden } = await fixture();
    const ctx = await hubChapter(repo, student(), content._id);
    assert.deepEqual(ctx.classIds, [String(cls._id)]);
    await rejects404(hubChapter(repo, student(), hidden._id), 'chapter');
    const [secret] = await repo.listChapterTopics(hidden._id);
    await rejects404(hubTopic(repo, student(), secret._id), 'topic');
    const [framing] = await repo.listChapterTopics(content._id);
    assert.equal((await hubTopic(repo, student(), framing._id)).access, 'student');
    await repo.updateChapterTopic(framing._id, { retiredAt: '2026-11-19T09:00:00.000Z' });
    await rejects404(hubTopic(repo, student(), framing._id), 'topic');
    assert.equal((await hubTopic(repo, profA, framing._id)).access, 'owner');
    await repo.removeClassChapter(cls._id, content._id);
    await rejects404(hubChapter(repo, student(), content._id), 'chapter');
  });
});

/* -------------------------------------------------------------- the graph -- */

describe('prerequisite links (H3)', () => {
  // Sets before Relations before Functions; Logic before Relations; Proofs
  // proposed (unused) before Functions; Graphs rejected before Sets.
  const L = (p, t, state = 'confirmed') => ({ _id: `${p}-${t}`, prerequisiteId: p, topicId: t, state });
  const links = [
    L('sets', 'relations'), L('relations', 'functions'), L('logic', 'relations'),
    L('proofs', 'functions', 'proposed'), L('graphs', 'sets', 'rejected'),
  ];

  test('a topic\'s chain is its confirmed prerequisites at every distance, nearest first, each once', () => {
    assert.deepEqual(prerequisiteChain('functions', links), [
      { topicId: 'relations', depth: 1, via: ['functions'] },
      { topicId: 'sets', depth: 2, via: ['relations'] },
      { topicId: 'logic', depth: 2, via: ['relations'] },
    ]);
    assert.deepEqual(prerequisiteChain('sets', links), [], 'a rejected link is never used');
  });

  test('what a topic leads to, nearest first; a proposal is not used', () => {
    assert.deepEqual(dependantsOf('sets', links).map((e) => [e.topicId, e.depth]), [['relations', 1], ['functions', 2]]);
    assert.deepEqual(dependantsOf('proofs', links), []);
  });

  test('a loop is refused, with the path it would close, named in a sentence', () => {
    const path = wouldLoop(links, 'functions', 'sets');
    assert.deepEqual(path, ['sets', 'relations', 'functions']);
    const names = { sets: 'Sets', relations: 'Relations', functions: 'Functions' };
    assert.equal(loopSentence(path, (x) => names[x], 'functions', 'sets'),
      '"Functions" cannot come before "Sets": the confirmed links already put "Sets" before "Relations" before "Functions", '
      + 'so this link would make a loop. A topic cannot be needed before itself.');
    assert.deepEqual(wouldLoop(links, 'sets', 'sets'), ['sets']);
    assert.equal(loopSentence(['sets'], (x) => names[x], 'sets', 'sets'), '"Sets" cannot be a prerequisite of itself.');
    assert.equal(wouldLoop(links, 'sets', 'functions'), null, 'a link along the chain closes no loop');
    assert.equal(wouldLoop(links, 'functions', 'proofs'), null, 'a proposed link is not part of the graph');
  });

  test('topics in an order a student can take them, ties in the list\'s order', () => {
    assert.deepEqual(dependencyOrder(['functions', 'logic', 'sets', 'relations'], links), ['logic', 'sets', 'relations', 'functions']);
    // Functions needs Sets through Relations, which is not in the list.
    assert.deepEqual(dependencyOrder(['functions', 'sets'], links), ['sets', 'functions']);
  });

  test('a link a longer chain implies is not direct', () => {
    assert.equal(impliedByChain(links, 'sets', 'functions'), true);
    assert.equal(impliedByChain(links, 'sets', 'relations'), false);
  });
});

/* --------------------------------------------------------- topic records -- */

describe('topic records kept in step with a chapter\'s list (H3)', () => {
  const LONG = 'Distance vector routing protocols and the count to infinity problem in detail';

  async function chapter(topics) {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Routing', kind: 'syllabus', rawText: '', topics, ownerId: PROF_A });
    return { repo, content };
  }

  test('made from the list, in its order, one per name, too long a name named back', () => {
    const { wanted, skipped } = topicRecordsFrom([' Framing ', 'framing', 'Error  detection', 7, 'x'.repeat(MAX_TOPIC_NAME + 1)]);
    assert.deepEqual(wanted.map((w) => [w.name, w.key, w.position]), [['Framing', 'framing', 1], ['Error detection', 'error detection', 2]]);
    assert.equal(skipped.length, 1);
  });

  test('questions match by name in any case and spacing, or by the generator\'s clipped name', async () => {
    const { repo, content } = await chapter(['Framing', LONG]);
    const { topics } = await syncTopics(repo, content);
    const match = topicMatcher(topics);
    assert.equal(match('  framing ')?.name, 'Framing');
    assert.ok(questionTopicFor(LONG).endsWith('...'));
    assert.equal(match(questionTopicFor(LONG))?.name, LONG);
    assert.equal(match('Switching'), null);
  });

  test('a topic that leaves the list is retired when questions or links hang off it, removed when not, and comes back with its id', async () => {
    const { repo, content } = await chapter(['Framing', 'Routing', 'Switching', 'Flow control']);
    const first = await syncTopics(repo, content);
    assert.deepEqual(first.added, ['Framing', 'Routing', 'Switching', 'Flow control']);
    const id = (name) => String(first.topics.find((t) => t.name === name)._id);
    await repo.insertQuestions([
      { contentId: content._id, topic: 'routing', text: 'Which?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', status: 'draft' },
    ]);
    await repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: id('Framing'), topicId: id('Switching'), provenance: 'professor', state: 'confirmed' });
    const questionsBefore = await repo.listQuestions(content._id, { includeDiscarded: true });

    const after = await syncTopics(repo, { ...content, topics: ['Flow control', 'Framing'] });
    assert.deepEqual(after.retired.sort(), ['Routing', 'Switching']);
    assert.deepEqual(after.removed, []);
    assert.deepEqual(after.topics.filter((t) => !t.retiredAt).map((t) => [t.name, t.position]), [['Flow control', 1], ['Framing', 2]]);
    assert.deepEqual(await repo.listQuestions(content._id, { includeDiscarded: true }), questionsBefore, 'no question row is rewritten');

    const unused = await syncTopics(repo, { ...content, topics: ['Framing'] });
    assert.deepEqual(unused.removed, ['Flow control']);

    const back = await syncTopics(repo, { ...content, topics: ['Framing', 'ROUTING'] });
    assert.deepEqual(back.restored, ['ROUTING']);
    const routing = back.topics.find((t) => t.key === 'routing');
    assert.equal(String(routing._id), id('Routing'), 'the same record, so its questions and links still point at it');
    assert.equal(routing.retiredAt, null);
    assert.equal(routing.name, 'ROUTING');
  });

  test('running it twice changes nothing the second time', async () => {
    const { repo, content } = await chapter(['Framing', 'Routing']);
    const one = await syncTopics(repo, content);
    const two = await syncTopics(repo, content);
    assert.deepEqual([two.added, two.retired, two.removed, two.restored], [[], [], [], []]);
    assert.deepEqual(two.topics, one.topics);
  });
});

/* ------------------------------------------------------------ slide texts -- */

describe('per-slide text (H4)', () => {
  test('kept slide by slide from an extracted deck, empty slides left out', () => {
    assert.deepEqual(slideTextsFrom([{ n: 1, text: 'Title' }, { n: 2, text: '   ' }, { n: 3, text: ' Body ' }, { text: 'no number' }]),
      [{ slide: 1, text: 'Title' }, { slide: 3, text: 'Body' }]);
  });

  test('a chapter says whether it kept its slides\' words, and an older deck says so plainly', () => {
    assert.equal(slidesNote({ kind: 'pptx', slideTexts: [{ slide: 1, text: 'x' }] }).perSlideText, true);
    const old = slidesNote({ kind: 'pptx', slideTexts: null });
    assert.equal(old.perSlideText, false);
    assert.match(old.note, /uploaded before each slide's words were kept/);
    assert.match(old.note, /by number/);
    assert.match(slidesNote({ kind: 'syllabus' }).note, /no slides/);
  });

  test('a topic\'s own slide words, bounded, only where the deck kept them', () => {
    const deck = { kind: 'pptx', topicSlides: { Framing: [2, 3] }, slideTexts: [{ slide: 2, text: 'Frames carry bits' }, { slide: 3, text: 'and headers' }, { slide: 4, text: 'Other' }] };
    assert.equal(topicSlideText(deck, 'framing'), 'Frames carry bits and headers');
    assert.equal(topicSlideText(deck, 'framing', 6), 'Frames');
    assert.equal(topicSlideText({ ...deck, slideTexts: null }, 'Framing'), null);
  });
});

/* -------------------------------------------------------------- proposals -- */

describe('proposed links (H3, decision 5)', () => {
  const topic = (id, name) => ({ _id: id, name, key: name.toLowerCase() });
  const chapters = [
    { content: { title: 'Sets', rawText: 'Sets are collections. Relations pair elements.', topicSlides: {} }, topics: [topic('t-sets', 'Sets'), topic('t-rel', 'Relations')] },
    { content: { title: 'Functions', rawText: 'A function is a relation.', topicSlides: {} }, topics: [topic('t-fun', 'Functions'), topic('t-pro', 'Proofs')] },
  ];
  const input = proposalInput(chapters);

  test('the model is shown each topic with a label, its chapter and a bounded extract', () => {
    assert.deepEqual(input.entries.map((e) => [e.label, e.topic.name, e.chapter]), [
      ['T1', 'Sets', 'Sets'], ['T2', 'Relations', 'Sets'], ['T3', 'Functions', 'Functions'], ['T4', 'Proofs', 'Functions'],
    ]);
    const prompt = buildProposalPrompt(input, [{ prerequisiteId: 't-sets', topicId: 't-rel', state: 'confirmed' }]);
    assert.match(prompt, /DIRECT prerequisite links only/);
    assert.match(prompt, /T3 \| Functions \| chapter: Functions \| slides: A function is a relation\./);
    assert.match(prompt, /Already confirmed by the professor \(do not repeat\): T1 before T2/);
  });

  test('a fixture reply is held to the rules: offered topics, no repeats, no loops, direct only, a reason each', () => {
    const reply = '```json\n' + JSON.stringify({
      links: [
        { prerequisite: 'T1', topic: 'T2', reason: 'Relations are built from sets.' },
        { prerequisite: 't2', topic: 'T3', reason: 'A function is a kind of relation, as slide 4 says.' },
        { prerequisite: 'T1', topic: 'T3', reason: 'Implied by the two above.' },
        { prerequisite: 'T3', topic: 'T1', reason: 'Would close a loop.' },
        { prerequisite: 'T9', topic: 'T1', reason: 'Not offered.' },
        { prerequisite: 'T4', topic: 'T4', reason: 'Itself.' },
        { prerequisite: 'T4', topic: 'T3', reason: 'Call 98450 12345 for help.' },
        { prerequisite: 'T2', topic: 'T3', reason: 'Twice.' },
        { prerequisite: 'T4', topic: 'T2', reason: 'x'.repeat(400) },
      ],
    }) + '\n```';
    const { proposals, skipped } = parseProposals(reply, { byLabel: input.byLabel, links: [] });
    assert.deepEqual(proposals.map((p) => [p.prerequisiteId, p.topicId]), [['t-sets', 't-rel'], ['t-rel', 't-fun'], ['t-pro', 't-rel']]);
    assert.ok(proposals.every((p) => p.reason.length <= MAX_REASON));
    const why = Object.fromEntries(skipped.map((s) => [`${s.prerequisite}>${s.topic}`, s.why]));
    assert.match(why['Sets>Functions'], /longer chain/);
    assert.match(why['Functions>Sets'], /loop/);
    assert.match(why['T9>Sets'], /not offered/);
    assert.match(why['Proofs>Proofs'], /itself/);
    assert.match(why['Proofs>Functions'], /no usable reason/);
    assert.match(why['Relations>Functions'], /twice/);
  });

  test('a pair already linked, or rejected before, is not proposed again', () => {
    const links = [
      { prerequisiteId: 't-sets', topicId: 't-rel', state: 'rejected' },
      { prerequisiteId: 't-rel', topicId: 't-fun', state: 'proposed' },
    ];
    const reply = JSON.stringify([{ prerequisite: 'T1', topic: 'T2', reason: 'a' }, { prerequisite: 'T3', topic: 'T2', reason: 'b' }]);
    const { proposals, skipped } = parseProposals(reply, { byLabel: input.byLabel, links });
    assert.deepEqual(proposals, []);
    assert.deepEqual(skipped.map((s) => s.why), ['you rejected this link before', 'these two topics are already linked']);
  });

  test('a reply that is not JSON is refused, not guessed at', () => {
    assert.throws(() => parseProposals('Sets come first.', { byLabel: input.byLabel }), /not JSON/);
    assert.throws(() => parseProposals('{"pairs": []}', { byLabel: input.byLabel }), /no list of links/);
  });

  test('the offline generator proposes none, and says so', async () => {
    const out = await proposeLinks({ chapters, links: [] });
    assert.deepEqual([out.source, out.proposals, out.note], ['offline', [], OFFLINE_NOTE]);
  });

  test('a stand-in model\'s reply goes through the real parser; a failed call proposes none and says why', async () => {
    let seen = '';
    const out = await proposeLinks({
      chapters,
      links: [],
      callModel: async (prompt) => { seen = prompt; return JSON.stringify({ links: [{ prerequisite: 'T1', topic: 'T2', reason: 'Sets first.' }] }); },
    });
    assert.match(seen, /T1 \| Sets/);
    assert.deepEqual([out.source, out.proposals.length, out.proposals[0].reason], ['llm', 1, 'Sets first.']);
    const broken = await proposeLinks({ chapters, callModel: async () => { throw new Error('timeout'); } });
    assert.deepEqual(broken.proposals, []);
    assert.match(broken.warnings.join(' '), /could not propose links: timeout/);
  });
});

/* ------------------------------------------------------------- the views -- */

describe('what each audience is sent (H2)', () => {
  test('a student gets units, chapters and live topics, and nothing else of the professor\'s', async () => {
    const { repo, cls, content } = await fixture();
    const unit = await repo.createClassUnit({ classId: cls._id, name: 'Unit 1: $\\mathbb{Z}_n$', position: 1 });
    const second = await repo.createContent({ title: 'Switching', kind: 'pptx', rawText: 'secret slide words', topics: ['VLANs'], ownerId: PROF_A,
      topicSlides: { VLANs: [2] } });
    await repo.setContentSlideTexts(second._id, [{ slide: 2, text: 'secret slide words' }]);
    await syncTopics(repo, second);
    await repo.placeClassChapter({ classId: cls._id, contentId: second._id, unitId: unit._id, position: 1 });
    await repo.insertQuestions([{ contentId: content._id, topic: 'Framing', text: 'Key?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 2, bloom: 'remember', status: 'draft' }]);
    const view = await studentClassView(repo, cls);
    assert.equal(view.units[0].nameHtml.includes('<math>'), true, 'a unit name\'s formula is rendered');
    assert.deepEqual(view.units[0].chapters.map((c) => c.title), ['Switching']);
    assert.deepEqual(view.otherChapters.chapters.map((c) => [c.title, c.topics.map((t) => t.name)]), [['Layers', ['Framing', 'Routing']]]);
    const text = JSON.stringify(view);
    assert.doesNotMatch(text, /secret slide words|answerIdx|Key\?|draft|slideTexts|topicSlides|rawText|questions/);
    assert.deepEqual(Object.keys(view.otherChapters.chapters[0]).sort(), ['id', 'title', 'titleHtml', 'topics']);
    assert.deepEqual(Object.keys(view.otherChapters.chapters[0].topics[0]).sort(), ['id', 'name', 'nameHtml']);
  });

  test('staff get counts, retired topics, slides and the chapters still to place', async () => {
    const { repo, cls, content, hidden } = await fixture();
    await repo.insertQuestions([{ contentId: content._id, topic: 'framing', text: 'Q', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', status: 'active' }]);
    const view = await staffClassView(repo, cls, { canEdit: true, access: 'owner' });
    const ch = view.otherChapters.chapters[0];
    assert.deepEqual(ch.topics[0].questions, { active: 1, draft: 0 });
    assert.match(ch.slides.note, /pasted as text/);
    assert.deepEqual(view.available.map((c) => c.id), [String(hidden._id)]);
  });

  test('a topic\'s chain for a student: confirmed links only, retired topics left out of the list', async () => {
    const { repo, content } = await fixture();
    const [framing, routing] = await repo.listChapterTopics(content._id);
    const extra = await repo.createContent({ title: 'Basics', kind: 'syllabus', rawText: '', topics: ['Bits', 'Old'], ownerId: PROF_A });
    const { topics: [bits, old] } = await syncTopics(repo, extra);
    await repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: framing._id, topicId: routing._id, provenance: 'professor', state: 'confirmed' });
    await repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: bits._id, topicId: framing._id, provenance: 'ai', state: 'confirmed' });
    await repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: old._id, topicId: framing._id, provenance: 'ai', state: 'proposed' });
    const view = await topicView(repo, { topic: routing, content }, { audience: 'student' });
    assert.deepEqual(view.prerequisites.map((p) => [p.name, p.depth, p.chapter.title]), [['Framing', 1, 'Layers'], ['Bits', 2, 'Basics']]);
    assert.equal(view.links, undefined);
    const staff = await topicView(repo, { topic: framing, content }, { audience: 'staff' });
    assert.deepEqual(staff.links.prerequisites.map((l) => [l.prerequisite.name, l.state, l.label]),
      [['Bits', 'confirmed', 'Proposed by AI, confirmed by the professor'], ['Old', 'proposed', 'AI draft: not used until confirmed']]);
  });
});

/* -------------------------------------------------------------- the store -- */

describe('the in-process store\'s side of 0025', () => {
  test('one unit name per class, ignoring case; a removed unit leaves its chapters in no unit', async () => {
    const { repo, cls, content } = await fixture();
    const unit = await repo.createClassUnit({ classId: cls._id, name: 'Unit 1', position: 1 });
    await assert.rejects(repo.createClassUnit({ classId: cls._id, name: 'unit 1', position: 2 }), (err) => err.status === 409);
    const [placed] = await repo.listClassChapters(cls._id);
    await repo.updateClassChapter(placed._id, { unitId: unit._id });
    assert.equal(await repo.deleteClassUnit(unit._id), true);
    assert.equal((await repo.listClassChapters(cls._id))[0].unitId, null);
    assert.equal(String((await repo.listClassChapters(cls._id))[0].contentId), String(content._id));
    await assert.rejects(repo.placeClassChapter({ classId: cls._id, contentId: content._id }), (err) => err.status === 409);
  });

  test('a topic key twice in a chapter is skipped; a link twice is a 409; links listed by owner, unowned apart', async () => {
    const repo = createMemoryRepo();
    const made = await repo.addChapterTopics('c1', [{ name: 'A', key: 'a', position: 1 }, { name: 'B', key: 'b', position: 2 }]);
    const again = await repo.addChapterTopics('c1', [{ name: 'a', key: 'a', position: 1 }]);
    assert.deepEqual([made.length, again.length], [2, 0]);
    await repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: made[0]._id, topicId: made[1]._id, provenance: 'professor', state: 'confirmed' });
    await assert.rejects(repo.addTopicLink({ ownerId: PROF_A, prerequisiteId: made[0]._id, topicId: made[1]._id, provenance: 'ai', state: 'proposed' }),
      (err) => err.status === 409);
    await repo.addTopicLink({ ownerId: null, prerequisiteId: made[1]._id, topicId: made[0]._id, provenance: 'professor', state: 'confirmed' });
    assert.equal((await repo.listTopicLinks({ ownerId: PROF_A })).length, 1);
    assert.equal((await repo.listTopicLinks({ ownerId: null })).length, 1);
    assert.equal((await repo.listTopicLinks({ ownerId: PROF_A, topicIds: [made[1]._id] })).length, 1);
    await repo.deleteChapterTopic(made[0]._id);
    assert.equal((await repo.listTopicLinks({})).length, 0, 'a topic\'s links go with it, as ON DELETE CASCADE does');
  });

  test('Supabase: topic records are inserted skipping a key the chapter holds, and the unowned links are asked for by IS NULL', async () => {
    const { createSupabaseRepo } = await import('../src/repo/supabaseRepo.js');
    const saved = { ...config.supabase };
    const realFetch = globalThis.fetch;
    const seen = [];
    globalThis.fetch = async (input, init = {}) => {
      seen.push({ url: new URL(String(input.url ?? input)), headers: new Headers(init.headers ?? input.headers) });
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    Object.assign(config.supabase, { url: 'http://supabase.invalid', serviceKey: 'test-key' });
    try {
      const repo = createSupabaseRepo();
      await repo.addChapterTopics('11111111-1111-4111-8111-111111111111', [{ name: 'A', key: 'a', position: 1 }]);
      assert.equal(seen[0].url.pathname, '/rest/v1/chapter_topics');
      assert.equal(seen[0].url.searchParams.get('on_conflict'), 'content_id,key');
      assert.match(seen[0].headers.get('prefer') ?? '', /resolution=ignore-duplicates/);
      await repo.listTopicLinks({ ownerId: null });
      assert.equal(seen[1].url.searchParams.get('owner_id'), 'is.null');
    } finally {
      globalThis.fetch = realFetch;
      Object.assign(config.supabase, saved);
    }
  });
});
