// Progress for a generation run, so the console can show what is actually
// happening instead of a spinner and a promise.
//
// Generation is one POST that takes a minute or two. Until now the screen showed
// an elapsed clock and six full-width bars, which read as "finished, and empty" -
// the single most alarming thing it could have said while the run was going
// perfectly. The fix is to report real per-level counts as topics land.
//
// In memory, on purpose. A run is meaningful for the ninety seconds it takes and
// worthless afterwards; persisting it would mean a table, a migration and a
// cleanup job to tell a teacher something they can already see on the screen in
// front of them. A server restart mid-run loses the progress, not the questions -
// the POST is still in flight and still answers.

import { randomUUID } from 'node:crypto';

/** Long enough to survive a slow poll, short enough that nothing accumulates. */
const TTL_MS = 10 * 60 * 1000;

/** A runaway client cannot make this grow without bound. */
const MAX_RUNS = 200;

const runs = new Map();

function sweep() {
  const now = Date.now();
  for (const [id, run] of runs) {
    if (now - run.touchedAt > TTL_MS) runs.delete(id);
  }
  // Still too many after the sweep: drop the oldest. Losing progress for an
  // abandoned run costs nothing; the POST it belongs to is unaffected.
  if (runs.size > MAX_RUNS) {
    const oldest = [...runs.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (const [id] of oldest.slice(0, runs.size - MAX_RUNS)) runs.delete(id);
  }
}

/** A client-supplied id, if it is a plausible one. Never trusted as a secret. */
export function cleanRunId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

/**
 * Open a run. `ownerKey` is whatever identifies the caller - an account id, or
 * the shared teacher key's stand-in. It is checked on every read, so guessing a
 * run id does not hand you somebody else's progress.
 */
export function startRun({ id, ownerKey, total = 0, topicsTotal = 0, perLevel = {} }) {
  sweep();
  const runId = cleanRunId(id) || randomUUID();
  runs.set(runId, {
    id: runId,
    ownerKey: String(ownerKey ?? ''),
    startedAt: Date.now(),
    touchedAt: Date.now(),
    state: 'running',
    planned: total,
    perLevelPlanned: perLevel,
    perLevelDone: {},
    written: 0,
    topicsDone: 0,
    topicsTotal,
    topic: '',
    error: '',
  });
  return runId;
}

export function updateRun(id, patch) {
  const run = runs.get(id);
  if (!run) return null;
  Object.assign(run, patch, { touchedAt: Date.now() });
  return run;
}

export function finishRun(id, patch = {}) {
  return updateRun(id, { state: 'done', ...patch });
}

export function failRun(id, message) {
  return updateRun(id, { state: 'failed', error: String(message ?? 'Generation failed.') });
}

/**
 * Read a run, or null if it does not exist or belongs to somebody else.
 * Same null for both, so this cannot be used to probe which ids are live.
 */
export function getRun(id, ownerKey) {
  const run = runs.get(cleanRunId(id));
  if (!run) return null;
  if (run.ownerKey !== String(ownerKey ?? '')) return null;
  return {
    id: run.id,
    state: run.state,
    planned: run.planned,
    written: run.written,
    perLevelPlanned: run.perLevelPlanned,
    perLevelDone: run.perLevelDone,
    topicsDone: run.topicsDone,
    topicsTotal: run.topicsTotal,
    topic: run.topic,
    elapsedMs: Date.now() - run.startedAt,
    error: run.error,
  };
}
