// Mirror of the level names and labels in server/src/bloom.js. Labels and
// formatting only - all taxonomy logic lives on the server and is never
// duplicated here. Deliberately contains no JSX so it stays a plain .js module.

export const LEVELS = ['remember', 'understand', 'apply', 'analyse', 'evaluate', 'create'];

export const LABEL = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyse: 'Analyse',
  evaluate: 'Evaluate',
  create: 'Create',
};

/** <span className={tagClass(level)}>{LABEL[level]}</span> */
export const tagClass = (level) => `tag ${level}`;

/** Accuracy -> the .cell class used by the teacher grid. */
export function cellClass(seen, correct) {
  if (!seen) return 'cell none';
  const a = correct / seen;
  if (a >= 0.7) return 'cell hi';
  if (a >= 0.4) return 'cell mid';
  return 'cell lo';
}

export const pct = (seen, correct) => (seen ? `${Math.round((correct / seen) * 100)}%` : '—');
