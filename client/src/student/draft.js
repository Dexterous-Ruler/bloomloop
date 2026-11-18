// The half-written answer, and nothing else.
//
// The server is the record. A student's level, their history, their score and
// the question they are on all live in Postgres and come back on rejoin, which
// is why none of it is in here: a phone that keeps its own copy of a fact the
// server owns is a phone that can disagree with the record, and it is always
// the phone that is wrong.
//
// A draft is the one exception, and it is an exception for a precise reason: it
// has NOT been sent. The server does not have it and cannot get it back. If it
// is not in this browser it is nowhere at all — so this is the one thing whose
// absence from localStorage would actually lose something.
//
// What is stored is only what the student themselves typed or tapped, keyed by
// the question it belongs to. Never the question text, never a result, never a
// solution, never a level.
//
// The tapped positions survive a rejoin because the server shuffles match,
// order, rank and categorise from a seed of roll number + question id, so the
// same student gets the same board back and position 3 is still the same item
// it was before the tab died.

const PREFIX = 'bloomloop:draft:';

// Long enough to outlive a dead tab, a flat battery and a walk across campus;
// short enough that a shared lab machine is not still carrying last night's
// class. Nothing here is worth keeping beyond the session it was typed in.
const MAX_AGE = 12 * 60 * 60 * 1000;

const at = (questionId) => `${PREFIX}${questionId}`;

/** Storage can be off entirely — private mode, a locked-down school build. */
function store() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const ints = (v) => (Array.isArray(v) ? [...new Set(v.filter(Number.isInteger))] : []);

/** {leftIdx: rightPos} and {itemIdx: groupIdx} — integers both sides or dropped. */
function intMap(v) {
  const out = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, n] of Object.entries(v)) {
    if (Number.isInteger(Number(k)) && Number.isInteger(n)) out[k] = n;
  }
  return out;
}

/**
 * One shape for every kind, so the caller never has to ask what is on screen.
 * A restore with nothing behind it is this, which is also exactly what a reset
 * to a fresh question is — the same code path, given nothing.
 */
const blank = () => ({ chosen: [], pairs: {}, seq: [], typed: '', words: [], placed: {} });

/**
 * Shaped on the way out, never trusted as found. This is a string in a store the
 * student can edit, that an older build may have written, and that a browser can
 * hand back truncated. A `seq` that came back as a string would not be a wrong
 * answer, it would be a white screen where the question used to be.
 */
const shape = (d) => ({
  chosen: ints(d?.chosen),
  pairs: intMap(d?.pairs),
  seq: ints(d?.seq),
  typed: typeof d?.typed === 'string' ? d.typed : '',
  // Positions are the blanks, so holes are kept rather than compacted: losing
  // one would slide every later word up into the wrong gap.
  words: Array.isArray(d?.words) ? d.words.map((w) => (typeof w === 'string' ? w : '')) : [],
  placed: intMap(d?.placed),
});

/** Nothing typed and nothing tapped — worth no key of its own. */
const isEmpty = (d) =>
  !String(d.typed ?? '').trim() &&
  d.chosen.length === 0 &&
  d.seq.length === 0 &&
  d.words.every((w) => !String(w ?? '').trim()) &&
  Object.keys(d.pairs).length === 0 &&
  Object.keys(d.placed).length === 0;

/** The draft saved for this question, or blanks. Never throws. */
export function readDraft(questionId) {
  const s = store();
  if (!s || !questionId) return blank();
  try {
    const raw = s.getItem(at(questionId));
    if (!raw) return blank();
    const held = JSON.parse(raw);
    // Old enough that the class it belongs to is over. Dropped on sight rather
    // than left for the sweep, so it cannot be restored even once.
    if (!(Number(held?.at) > Date.now() - MAX_AGE)) {
      s.removeItem(at(questionId));
      return blank();
    }
    return shape(held.d);
  } catch {
    return blank();
  }
}

/**
 * Save, or delete when there is nothing left to save. The delete half matters:
 * a student who clears the box has changed their mind, and without it the text
 * they deliberately deleted would come back on the next reload.
 */
export function saveDraft(questionId, draft) {
  const s = store();
  if (!s || !questionId) return;
  const d = shape(draft);
  try {
    if (isEmpty(d)) s.removeItem(at(questionId));
    else s.setItem(at(questionId), JSON.stringify({ at: Date.now(), d }));
  } catch {
    // Quota, or storage switched off mid-session. The answer on screen is
    // untouched; only its backup is missing, and nothing here is load-bearing.
  }
}

/** Answered and marked. */
export function clearDraft(questionId) {
  const s = store();
  if (!s || !questionId) return;
  try {
    s.removeItem(at(questionId));
  } catch {
    /* storage off */
  }
}

/**
 * Every draft whose question is long past. Without this the store grows by one
 * key per question per class forever, on a phone nobody ever clears, until a
 * write fails for a reason no one can see.
 */
function sweep() {
  const s = store();
  if (!s) return;
  try {
    const cutoff = Date.now() - MAX_AGE;
    const dead = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      let stamp = 0;
      // Unreadable counts as dead: junk under our own prefix is ours to clean up
      // and there is no version of it worth keeping.
      try { stamp = Number(JSON.parse(s.getItem(k))?.at) || 0; } catch { stamp = 0; }
      if (stamp < cutoff) dead.push(k);
    }
    // Removed after the walk, not during it. Deleting renumbers the indices the
    // walk is still using, so every second stale key would be skipped.
    dead.forEach((k) => s.removeItem(k));
  } catch {
    /* storage off */
  }
}

// Once per page load, at import, before any question is on screen.
if (typeof window !== 'undefined') sweep();
