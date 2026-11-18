/**
 * How the student's home and analytics phrase what the server measured.
 * Formatting and ordering only: nothing here judges anyone.
 */

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
