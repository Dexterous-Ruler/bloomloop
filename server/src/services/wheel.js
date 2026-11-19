// The wheel (Phase 3, 0017): a fair draw of who answers next, and a record of
// every pick.
//
// The handoff's wheel picked in the browser with Math.random() and kept
// nothing. Here the server draws with crypto randomness BEFORE any wheel turns
// on a screen, and stores the pick, so the spin a class watches is only ever an
// animation of a choice already made, and "who was asked what, and how did they
// do" is kept as evidence.
//
// What the draw is fair over (wheelPool):
//   presentOnly  on: the students present (services/records.js roomPeople: an
//                attendance mark of present or late in a class room; a phone
//                that joined in a room with no class). Off: everyone joined or
//                on the roster.
//   noRepeat     on: students already picked this round are left out, so
//                everyone has a turn before anyone has a second.
//   rounds       "Start new round" begins a new round; earlier picks stay.
// Each student on the wheel has the same chance, 1 / poolSize, and poolSize is
// stored with the pick.
//
// Think time and the names toggle are display-only: the server neither stores
// nor needs them. A pick reaches the projector as a roll number and a first name
// only (pickForProjector), never a status, a score or an observation.

import crypto from 'node:crypto';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** What a picked student is asked (the handoff's ASK list). */
export const ASK_TYPES = [
  { id: 'bank', label: 'Bank', hint: 'A question from the room\'s bank.' },
  { id: 'diagram', label: 'Diagram', hint: 'Ask them to explain the diagram on the projector, one step at a time.' },
  { id: 'demo', label: 'Demo', hint: 'Ask them to work it through on the board while the class follows.' },
];
const ASK_IDS = ASK_TYPES.map((a) => a.id);

/** How the student responded (the handoff's STATUS list). A pick starts pending. */
export const PICK_STATUSES = [
  { id: 'answered', label: 'Answered' },
  { id: 'passed', label: 'Passed to partner' },
  { id: 'help', label: 'Needs help' },
  { id: 'skipped', label: 'Skipped' },
  { id: 'absent', label: 'Absent' },
];
const STATUS_IDS = PICK_STATUSES.map((s) => s.id);
const statusLabel = (id) => (id === 'pending' ? 'Pending' : PICK_STATUSES.find((s) => s.id === id)?.label ?? id);

/** The handoff's own defaults: present students only, no repeats. */
export const DEFAULT_SETTINGS = { presentOnly: true, noRepeat: true };

/**
 * The two round settings off a body, each only if sent; an honest 400 for
 * anything but true or false.
 */
export function settingsFrom(body = {}) {
  const out = {};
  for (const k of ['presentOnly', 'noRepeat']) {
    if (body?.[k] === undefined) continue;
    if (typeof body[k] !== 'boolean') throw fail(`${k} must be true or false.`, 400);
    out[k] = body[k];
  }
  return out;
}

/**
 * Who is on the wheel this draw, and how far the round has got.
 *
 *   base      everyone the settings allow, ignoring repeats: the round's total
 *   eligible  base, less whoever was picked this round when noRepeat is on
 *   picked    how many of base have had a turn this round
 *
 * `people` is roomPeople() (services/records.js), already in roll order, so a
 * given random index always names the same student.
 */
export function wheelPool(people, { presentOnly, noRepeat, pickedThisRound = [] }) {
  const base = presentOnly ? people.filter((p) => p.present) : people;
  const had = new Set(pickedThisRound.map((p) => String(p.rollNo)));
  const eligible = noRepeat ? base.filter((p) => !had.has(p.rollNo)) : base;
  const picked = base.filter((p) => had.has(p.rollNo)).length;
  return {
    base,
    eligible,
    picked,
    total: base.length,
    left: eligible.length,
    summary: `${picked} picked of ${base.length}`,
  };
}

/**
 * One student from the pool, every one equally likely. `rng(n)` must give a
 * whole number from 0 to n - 1; the default is crypto.randomInt, which is
 * uniform (it rejects rather than folds the bytes it cannot use). Tests inject
 * their own. Null for an empty pool.
 */
export function drawFrom(pool, rng = crypto.randomInt) {
  if (!pool.length) return null;
  const i = rng(pool.length);
  if (!Number.isInteger(i) || i < 0 || i >= pool.length) {
    throw new Error(`the draw's random source gave ${i} for a pool of ${pool.length}`);
  }
  return pool[i];
}

/** Why the wheel has nobody on it, in words a professor can act on. */
export function emptyWheelReason({ session, presentOnly, pool }) {
  if (pool.total && !pool.left) {
    return 'Everyone on the wheel has had a turn this round. Start a new round, or turn off no repeats.';
  }
  if (presentOnly) {
    return session?.classId
      ? 'Nobody in this class is marked present, so the wheel is empty. Mark attendance, or turn off present only.'
      : 'No phone has joined this room, and it was opened for no class, so there is nobody to pick.';
  }
  return session?.classId
    ? 'The class has nobody on its roster and no phone has joined, so there is nobody to pick.'
    : 'No phone has joined this room, and it was opened for no class, so there is nobody to pick.';
}

/** The round in force: the latest, or round 1 with the defaults before anything is drawn. */
export function currentRound(rounds = []) {
  const last = rounds.at(-1);
  return last
    ? { ...last, started: true }
    : { round: 1, ...DEFAULT_SETTINGS, startedAt: null, startedBy: null, started: false };
}

/** The ask, and its question, off a body; checks the question is one the room may serve. */
export function askFrom(body, { current, servable = [] }) {
  const out = {};
  if (body?.ask !== undefined) {
    if (!ASK_IDS.includes(body.ask)) throw fail(`ask must be one of ${ASK_IDS.join(', ')}.`, 400);
    out.ask = body.ask;
  }
  const ask = out.ask ?? current.ask ?? 'bank';
  if (body?.questionId !== undefined && body.questionId !== null) {
    if (ask !== 'bank') throw fail('Only a bank ask names a question; a diagram or a demo has none.', 400);
    const id = typeof body.questionId === 'string' ? body.questionId.trim().toLowerCase() : '';
    const q = servable.find((s) => String(s._id).toLowerCase() === id);
    if (!q) throw fail('questionId is not a question this room serves: pick one of its approved questions.', 400);
    out.questionId = String(q._id);
  } else if (body?.questionId === null) {
    out.questionId = null;
  }
  // A diagram or a demo asks no bank question: one chosen earlier goes.
  if (ask !== 'bank' && current.questionId) out.questionId = null;
  return out;
}

/** The response off a body: one of the five; 'pending' is only ever where a pick starts. */
export function pickStatusFrom(raw) {
  if (!STATUS_IDS.includes(raw)) {
    throw fail(`status must be one of ${STATUS_IDS.join(', ')}.`, 400);
  }
  return raw;
}

/**
 * One pick as a teacher's screen gets it. `nameOf` maps a roll number to the
 * name to show; `questions` (id -> question) gives a bank ask its text and level.
 */
export function pickView(p, { nameOf = new Map(), questions = new Map() } = {}) {
  const q = p.questionId ? questions.get(String(p.questionId)) : null;
  return {
    id: String(p._id),
    round: p.round,
    order: p.order,
    rollNo: p.rollNo,
    name: nameOf.get(String(p.rollNo)) ?? '',
    classStudentId: p.classStudentId ?? null,
    poolSize: p.poolSize,
    presentOnly: p.presentOnly,
    noRepeat: p.noRepeat,
    ask: p.ask,
    askLabel: ASK_TYPES.find((a) => a.id === p.ask)?.label ?? p.ask,
    questionId: p.questionId ?? null,
    question: q ? { text: q.text, bloom: q.bloom, kind: q.kind ?? 'mcq' } : null,
    status: p.status,
    statusLabel: statusLabel(p.status),
    pickedAt: p.pickedAt ?? null,
    pickedBy: p.pickedBy ?? null,
    statusAt: p.statusAt ?? null,
    statusBy: p.statusBy ?? null,
  };
}

/**
 * The whole wheel for a teacher's screen: the round in force and its settings,
 * who is on the wheel now and "N picked of M", and every pick in every round,
 * in order.
 */
export function wheelState({ session, rounds = [], picks = [], people = [], questions = new Map() }) {
  const round = currentRound(rounds);
  const thisRound = picks.filter((p) => p.round === round.round);
  const pool = wheelPool(people, { presentOnly: round.presentOnly, noRepeat: round.noRepeat, pickedThisRound: thisRound });
  const nameOf = new Map(people.map((p) => [p.rollNo, p.name]));
  return {
    round: {
      number: round.round,
      started: round.started,
      startedAt: round.startedAt ?? null,
      presentOnly: round.presentOnly,
      noRepeat: round.noRepeat,
      picks: thisRound.length,
    },
    pool: {
      total: pool.total,
      left: pool.left,
      picked: pool.picked,
      summary: pool.summary,
      // Roll numbers and names on the wheel: the teacher's screen draws them.
      onWheel: pool.eligible.map((p) => ({ rollNo: p.rollNo, name: p.name })),
      empty: pool.left ? null : emptyWheelReason({ session, presentOnly: round.presentOnly, pool }),
    },
    rounds: rounds.map((r) => ({ number: r.round, startedAt: r.startedAt ?? null, presentOnly: r.presentOnly, noRepeat: r.noRepeat })),
    picks: picks.map((p) => pickView(p, { nameOf, questions })),
    asks: ASK_TYPES,
    statuses: PICK_STATUSES,
  };
}

/**
 * A pick as the projector may show it: the roll number and the first name, and
 * nothing else (no status, no ask, no score, no observation). For the Modes
 * work to call; the names toggle is its own, display-only, so `showName: false`
 * leaves the name out.
 */
export function pickForProjector(pick, name = '', { showName = true } = {}) {
  const first = String(name ?? '').trim().split(/\s+/)[0] ?? '';
  return { rollNo: pick.rollNo, firstName: showName && first ? first : null };
}
