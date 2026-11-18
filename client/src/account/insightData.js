/**
 * How the student's home and analytics phrase what the server measured.
 * Formatting, ordering and arithmetic on the server's own figures only:
 * nothing here judges anyone, and nothing here invents a number.
 */

import { LEVELS } from '../lib/bloom.js';

/* The band the server brands a session with, and the number of answers it
   wants before it will judge anything (server/src/services/mastery.js). Quoted
   here only to phrase a sentence. */
export const BAND = 0.4;
export const MIN_EVIDENCE = 3;

/** Server accuracies are 0..1, and null means there is nothing to average. */
export const asPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const THIS_YEAR = new Date().getFullYear();

/** A date someone recognises, or '' - a seeded room can have none. */
export function day(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', ...(d.getFullYear() === THIS_YEAR ? {} : { year: 'numeric' }),
  });
}

export function dayTime(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return `${day(iso)}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** 1 for Remember up to 6 for Create; 0 for no level. */
export const levelN = (level) => LEVELS.indexOf(level) + 1;

const sum = (xs) => xs.reduce((n, x) => n + x, 0);
export const mean = (xs) => (xs.length ? sum(xs) / xs.length : null);

/**
 * The list a viewer picks from, and who is open.
 *
 * Most answers first: the list arrives in roster order, and the row at the top
 * is the one that opens by default, so it should be the one with the most
 * evidence behind it. Nothing picked, or a pick that has left the list, falls
 * back to that top row.
 */
export function arrange(data, pickedId) {
  const subjects = [...(data?.subjects ?? [])].sort(
    (a, b) => (b.counts?.answered ?? 0) - (a.counts?.answered ?? 0)
      || String(a.name ?? '').localeCompare(String(b.name ?? '')),
  );
  const sel = subjects.find((s) => String(s.id) === String(pickedId)) ?? subjects[0] ?? null;
  return { subjects, sel };
}

/**
 * Accuracies in five bands of twenty points, and how many had nothing to put
 * in a band. A null is "no answers", which is not 0% and is never drawn as it.
 */
export function bands(values) {
  const counts = [0, 0, 0, 0, 0];
  let none = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) none += 1;
    else counts[Math.min(4, Math.floor(v * 5))] += 1;
  }
  return { counts, none };
}

/**
 * One session's own level tally, read off its answer trail.
 *
 * The server keeps only the last 40 answers of a session on the trail, so this
 * is null whenever the trail is not the whole session: a tally from part of a
 * session would be a different number wearing the same label.
 */
export function trailTally(session) {
  const history = Array.isArray(session?.history) ? session.history : [];
  const graded = history.filter((h) => !h.ungraded && LEVELS.includes(h.bloom));
  if (!graded.length || graded.length !== (session.answered ?? -1)) return null;
  const tally = Object.fromEntries(LEVELS.map((l) => [l, { seen: 0, correct: 0 }]));
  for (const h of graded) {
    tally[h.bloom].seen += 1;
    if (h.correct) tally[h.bloom].correct += 1;
  }
  return tally;
}

/**
 * Accuracy at each level before the latest session: the all-time tally less
 * that session's own. Null when it cannot be worked out exactly.
 */
export function before(bloom, latest) {
  const mine = trailTally(latest);
  if (!mine || !Array.isArray(bloom)) return null;
  return Object.fromEntries(bloom.map((r) => {
    const seen = (r.seen ?? 0) - mine[r.level].seen;
    const correct = (r.correct ?? 0) - mine[r.level].correct;
    return [r.level, seen > 0 && correct >= 0 ? correct / seen : null];
  }));
}

/** The highest level a question was ever aimed at, from a six-row report. */
export function highest(bloom) {
  const reached = (bloom ?? []).filter((r) => (r.seen ?? 0) > 0).map((r) => r.level);
  return reached.length ? reached[reached.length - 1] : null;
}

/**
 * Topics, hardest first. Only a topic with MIN_EVIDENCE answers can be called
 * hard: the topic met twice at 0% is not the biggest problem on the page, it
 * is the least known thing on it. Those come after, flagged as thin, in the
 * server's order (most answered first).
 */
export function hardest(topics) {
  const all = topics ?? [];
  const judged = all
    .filter((t) => t.seen >= MIN_EVIDENCE && t.accuracy != null)
    .sort((a, b) => a.accuracy - b.accuracy || b.seen - a.seen);
  const thin = all.filter((t) => !(t.seen >= MIN_EVIDENCE && t.accuracy != null));
  return { judged, thin };
}

/** How much of a record's timeline the trend shows. Sessions, not days: a class meets when it meets. */
export const RANGES = [
  { id: 'all', label: 'All sessions', n: Infinity },
  { id: '10', label: 'Last 10', n: 10 },
  { id: '5', label: 'Last 5', n: 5 },
];

/**
 * The sessions a range keeps (oldest first, as the server sends them) and the
 * same number before them, which the trend draws dashed for comparison.
 */
export function scope(timeline, rangeId) {
  const rows = timeline ?? [];
  const n = RANGES.find((r) => r.id === rangeId)?.n ?? Infinity;
  if (!Number.isFinite(n) || n >= rows.length) return { shown: rows, previous: [] };
  return { shown: rows.slice(-n), previous: rows.slice(Math.max(0, rows.length - 2 * n), rows.length - n) };
}

/**
 * The level named weakest most often across a list, with how many name it.
 * Only rows where the server says the comparison holds are counted, and one
 * row is not a pattern, so it needs two.
 */
export function commonWeakest(subjects) {
  const tally = {};
  for (const s of subjects ?? []) {
    if (s.confident && s.weakest) tally[s.weakest] = (tally[s.weakest] ?? 0) + 1;
  }
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1] || levelN(a[0]) - levelN(b[0]))[0];
  return top && top[1] >= 2 ? { level: top[0], count: top[1] } : null;
}
