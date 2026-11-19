// Phase 4 - the attainment formulas BloomLoop ships, as data.
//
// Colleges compute course-outcome attainment by their own rules: what share of
// the marks a student needs, what share of students makes level 1, 2 or 3, which
// evidence counts. No one of those is "the" rule, so none is written into the
// code. What ships is this list of EXAMPLES, each a complete formula in the shape
// services/attainment.js validates (configFrom), named for what it does and never
// for a body ("NAAC", "NBA") whose standard it is not.
//
// A college's own formula is a data change: add an entry here (an id, a name, a
// description and a config), or save the config on a class through
// PUT /api/classes/:id/attainment/config, which needs no code at all. The unit
// tests run every entry through the same validation a saved config gets.
//
// Every report states the formula it used, and says when it is one of these
// examples rather than a class's own.

/** The example a class uses until its owner saves a formula of their own. */
export const DEFAULT_PRESET = 'example-60-50-60-70';

export const PRESETS = Object.freeze([
  Object.freeze({
    id: 'example-60-50-60-70',
    name: 'Example: 60% of marks; levels at 50 / 60 / 70% of students',
    description: 'A student attains an outcome with 60% of the marks on its questions, from at least 3 answers. '
      + 'The class reaches level 1 when 50% of its students attain it, level 2 at 60% and level 3 at 70%. Digital '
      + 'answers and reviewed written answers count; provisional written marks wait for a review. Final attempts; '
      + 'every room counts the same. An example to start from, not an institutional standard.',
    config: Object.freeze({
      studentThreshold: 0.6,
      minAnswers: 3,
      levels: Object.freeze([
        Object.freeze({ level: 1, minShare: 0.5 }),
        Object.freeze({ level: 2, minShare: 0.6 }),
        Object.freeze({ level: 3, minShare: 0.7 }),
      ]),
      evidence: Object.freeze({ digital: true, aiProvisional: false, humanReviewed: true }),
      attempts: 'final',
      roomWeights: Object.freeze([]),
    }),
  }),
  Object.freeze({
    id: 'example-60-60-70-85',
    name: 'Example: 60% of marks; levels at 60 / 70 / 85% of students',
    description: 'A stricter class target: a student attains an outcome with 60% of the marks on its questions, from at '
      + 'least 3 answers, and the class reaches level 1 when 60% of its students attain it, level 2 at 70% and level 3 '
      + 'at 85%. The same evidence and attempts as the first example. An example to start from, not an institutional '
      + 'standard.',
    config: Object.freeze({
      studentThreshold: 0.6,
      minAnswers: 3,
      levels: Object.freeze([
        Object.freeze({ level: 1, minShare: 0.6 }),
        Object.freeze({ level: 2, minShare: 0.7 }),
        Object.freeze({ level: 3, minShare: 0.85 }),
      ]),
      evidence: Object.freeze({ digital: true, aiProvisional: false, humanReviewed: true }),
      attempts: 'final',
      roomWeights: Object.freeze([]),
    }),
  }),
]);

/** One preset by id, or null. */
export const presetById = (id) => PRESETS.find((p) => p.id === id) ?? null;
