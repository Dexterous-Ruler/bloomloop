// Batch 8: the seams between its three parts, pinned after the merge.
//
//   the concept panel's Visual   The figure engines' stepped lesson figure (gap
//                                H9c) and the concept panel's sections (H9a,
//                                H9b) are one panel: the sections carry a
//                                Visual that points at the lesson's figure
//                                step, for staff and for a student, whether or
//                                not the model wrote any section, and never
//                                draws the figure a second time.
//   sections on a stored lesson   A lesson version holding both a figure step and
//                                AI sections reads back with both, through the
//                                same views every lesson route uses.
//
// End to end, over HTTP (adding the figure through its route keeps the
// sections), in scripts/zipgaps2.mjs. Never calls Gemini, Supabase or any
// network service.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { config } from '../src/config.js';
import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import {
  VISUAL_NONE_STAFF, VISUAL_NONE_STUDENT, cleanConcept, sectionsView, visualOf,
} from '../src/services/hubConcept.js';
import { staffLessonView, studentLessonView } from '../src/services/hubLessons.js';
import { SPECS } from './fixtures/figures.js';

// The model is never called here.
config.gemini.apiKey = '';

const CHUNKS = [{ label: 'C1', slides: [1] }, { label: 'C2', slides: [2] }];
const CONCEPT = {
  intro: { text: 'Recursion solves a problem through smaller copies of itself.', parts: ['C1'] },
  steps: [{ term: 'Base case', text: 'It stops the calls.', parts: ['C1'] }, { term: 'Call stack', text: 'Each call waits on it.', parts: ['C2'] }],
};

describe('the concept panel\'s Visual (H9c inside the H9a/H9b sections)', () => {
  test('it points at each figure step of the view, by its place there', () => {
    const steps = [
      { type: 'chunk', cite: 'Slide 1' },
      { type: 'figure', cite: 'Slide 2', figure: { title: 'fact(3)', steps: [{}, {}, {}] } },
      { type: 'questions', cite: null },
    ];
    assert.deepEqual(visualOf(steps), {
      available: true, figures: [{ step: 1, title: 'fact(3)', stepCount: 3, cite: 'Slide 2' }], note: null,
    });
    assert.deepEqual(visualOf([], 'staff'), { available: false, figures: [], note: VISUAL_NONE_STAFF });
    assert.equal(visualOf(undefined).note, VISUAL_NONE_STUDENT);
  });

  test('a lesson with no section still has its Visual; one with sections has both', async () => {
    const viewSteps = [{ type: 'figure', cite: null, figure: { title: 'Stack', steps: [{}] } }];
    const none = await sectionsView({ status: 'approved', source: 'slides', sections: null }, { viewSteps });
    assert.equal(none.available, false);
    assert.equal(none.visual.available, true);
    const { sections } = cleanConcept(CONCEPT, CHUNKS);
    const both = await sectionsView({ status: 'draft', source: 'llm', sections }, { audience: 'staff', viewSteps });
    assert.equal(both.available, true);
    assert.equal(both.aiDraft, true);
    assert.equal(both.steps.length, 2, 'the explanation steps are the model\'s; the Visual is a separate piece');
    assert.deepEqual(both.visual.figures.map((f) => f.step), [0]);
  });

  test('a stored version with a figure step and AI sections reads back with both, for staff and a student', async () => {
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'Recursion', kind: 'syllabus', rawText: 'x', topics: ['Recursion'] });
    const { sections } = cleanConcept(CONCEPT, CHUNKS);
    const lesson = await repo.createTopicLesson({
      topicId: 'aaaaaaaaaaaaaaaaaaaaaaaa', contentId: content._id, version: 2, source: 'llm', model: 'stand-in',
      steps: [
        { type: 'chunk', slides: [1], text: 'A function that calls itself.' },
        { type: 'chunk', slides: [2], text: 'The call stack, frame by frame.', figure: SPECS.stack },
      ],
      sections,
    });
    const staff = await staffLessonView(repo, lesson);
    assert.equal(staff.sections.available, true);
    const at = staff.sections.visual.figures[0].step;
    assert.equal(staff.steps[at].type, 'figure');
    assert.equal(staff.sections.visual.figures[0].stepCount, 3);
    assert.equal(staff.sections.visual.figures[0].cite, 'Slide 2');

    const student = await studentLessonView(repo, { lesson, account: { id: 'stu', role: 'student' } });
    const shown = student.steps[student.sections.visual.figures[0].step];
    assert.equal(shown.type, 'figure');
    assert.equal(shown.figure.steps.length, 3);
    assert.equal(student.sections.intro.text, CONCEPT.intro.text);
    // The drawing is sent once, in its step: the panel names it, and no spec goes anywhere.
    assert.ok(!JSON.stringify(student.sections).includes('<svg'));
    assert.ok(!JSON.stringify(student).includes('"frames"'));
  });
});
