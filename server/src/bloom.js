// The six cognitive-process levels of Bloom's revised taxonomy
// (Anderson & Krathwohl, 2001). Order is the ladder: index 0 is the floor.
// Every generated question carries exactly one of these tags, and every
// student profile is a vector across all six.

export const LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

export const FLOOR = LEVELS[0];
export const CEILING = LEVELS[LEVELS.length - 1];

// Exemplar verbs from Krathwohl (2002). These go verbatim into the generation
// prompt so the model has a concrete handle on each level rather than a label.
export const VERBS = {
  remember: ['define', 'list', 'recall', 'name', 'state', 'identify'],
  understand: ['explain', 'summarise', 'describe', 'classify', 'interpret', 'compare'],
  apply: ['apply', 'solve', 'compute', 'demonstrate', 'use', 'execute'],
  analyse: ['analyse', 'differentiate', 'organise', 'attribute', 'deconstruct', 'contrast'],
  evaluate: ['evaluate', 'justify', 'critique', 'judge', 'defend', 'argue'],
  create: ['create', 'design', 'formulate', 'propose', 'construct', 'devise'],
};

export const LABEL = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyse: 'Analyse',
  evaluate: 'Evaluate',
  create: 'Create',
};

// Default per-topic generation mix (completion.md section 7). Weighted toward the
// lower levels on purpose: the slow-learner band is served from Remember and
// Understand, so the bank has to be deep there or F3 starves.
export const DEFAULT_MIX = {
  remember: 3,
  understand: 3,
  apply: 2,
  analyse: 2,
  evaluate: 1,
  create: 1,
};

export const levelIndex = (level) => LEVELS.indexOf(level);

export const isLevel = (value) => typeof value === 'string' && LEVELS.includes(value);

/** Move `steps` up or down the ladder, clamped at both ends. */
export function shiftLevel(level, steps) {
  const i = levelIndex(level);
  if (i === -1) return FLOOR;
  const next = Math.min(LEVELS.length - 1, Math.max(0, i + steps));
  return LEVELS[next];
}

/** A fresh, empty six-level counter vector. */
export function emptyLevels() {
  return LEVELS.reduce((acc, l) => {
    acc[l] = { seen: 0, correct: 0 };
    return acc;
  }, {});
}

/**
 * Normalise whatever the model or the DB handed us into a full six-level
 * vector. Missing levels become zeroes rather than undefined, which is what
 * lets the dashboard and the CSV assume every cell exists.
 */
export function normaliseLevels(levels = {}) {
  const out = emptyLevels();
  for (const l of LEVELS) {
    const seen = Number(levels?.[l]?.seen) || 0;
    const correct = Number(levels?.[l]?.correct) || 0;
    out[l] = { seen, correct: Math.min(correct, seen) };
  }
  return out;
}
