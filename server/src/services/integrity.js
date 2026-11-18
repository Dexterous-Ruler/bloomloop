// Integrity signals.
//
// The ask was "make it like the AWS or Azure exams, where the student cannot
// cheat in any way possible". That is not achievable here and it is worth being
// precise about why, because the design follows from it.
//
// Those exams are proctored: a locked-down machine, a camera on the candidate, a
// human watching, and a room the candidate had to physically enter. BloomLoop is
// a web page a student opens on their own phone, in a lecture hall, on their own
// network. From inside a browser tab we cannot see:
//
//   - a second device (the phone beside the laptop) - which is how people
//     actually cheat, and no amount of tab detection touches it
//   - another person in the room
//   - an overlay assistant built to be invisible to the page, and in some cases
//     invisible to screen capture too
//   - anything at all, once a student disables JavaScript or edits our own
//     reporting code in devtools
//
// So this module does not claim to prevent cheating. It records what is honestly
// observable, separates what can be faked from what cannot, and hands a teacher
// evidence with its uncertainty attached. The alternative - a confident-looking
// "CHEATING DETECTED" badge built on a `visibilitychange` listener - would be
// worse than nothing, because a false accusation costs a student far more than a
// missed signal costs anybody.
//
// Two classes, and the line between them is the whole point:
//
//   REPORTED  the browser said it happened. Cheap to fake. Weak on its own,
//             meaningful in volume and in pattern.
//   OBSERVED  the server worked it out from data the student does not control.
//             Slower to trigger, much harder to argue with.

/** What a browser is allowed to tell us about itself. Anything else is dropped. */
export const REPORTED = ['hidden', 'returned', 'blurred', 'fullscreen-exit', 'paste', 'reload'];

/** What the server works out for itself. A client may never claim one of these. */
export const OBSERVED = ['too-fast', 'second-socket', 'level-jump'];

/** Cap per profile. An event list is evidence, not telemetry - it stays readable. */
const MAX_EVENTS = 200;

/**
 * Reading speed used to decide "nobody could have read this yet".
 *
 * 25 chars/second is roughly 300 words per minute - fast for a fluent adult
 * reading unfamiliar technical material, and deliberately generous. The point is
 * to catch an answer that arrived before the question could have been read at
 * all, not to police students who read quickly.
 */
const CHARS_PER_SECOND = 25;

/** Below this, no reading speed is plausible - it is a reflex or a script. */
const FLOOR_MS = 900;

/** How many reported events before the pattern is worth a teacher's attention. */
const NOTABLE = 3;

const now = () => new Date().toISOString();

/**
 * The shortest time in which this question could honestly have been answered.
 * Length-aware, because "10 seconds" is generous for a true/false and absurd for
 * a five-pair matching task.
 */
export function minPlausibleMs(question) {
  const text = String(question?.text ?? '');
  const extra = [
    ...(question?.options ?? []),
    ...(question?.pairs ?? []).flatMap((p) => [p?.left, p?.right]),
    ...(question?.sequence ?? []),
    ...(question?.buckets ?? []).flatMap((b) => [b?.name, ...(b?.items ?? [])]),
  ].join(' ');
  const chars = text.length + extra.length;
  return Math.max(FLOOR_MS, Math.round((chars / CHARS_PER_SECOND) * 1000));
}

/** Append an event, keeping the list bounded and the newest at the end. */
export function record(profile, kind, meta = {}) {
  const list = Array.isArray(profile.integrity) ? profile.integrity : [];
  const next = [...list, { at: now(), kind, ...meta }];
  profile.integrity = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  return profile;
}

/**
 * A browser-reported event. Validated against the allow-list, because this
 * arrives over a socket the student's own devtools can send on.
 * @returns {boolean} whether it was accepted
 */
export function reportFromClient(profile, kind, meta = {}) {
  if (!REPORTED.includes(kind)) return false;
  // Only the fields we understand, and nothing long enough to be a payload.
  const clean = {};
  if (Number.isFinite(Number(meta.awayMs))) clean.awayMs = Math.min(Number(meta.awayMs), 86400000);
  if (typeof meta.questionId === 'string') clean.questionId = meta.questionId.slice(0, 64);
  record(profile, kind, { ...clean, src: 'reported' });
  return true;
}

/**
 * Did this answer arrive faster than the question could be read?
 * `servedAt` comes from the pin the server itself wrote, so the student cannot
 * move it.
 */
export function checkLatency(profile, question, servedAt) {
  if (!servedAt) return null;
  const took = Date.now() - new Date(servedAt).getTime();
  if (!Number.isFinite(took) || took < 0) return null;
  const floor = minPlausibleMs(question);
  if (took >= floor) return null;
  record(profile, 'too-fast', { src: 'observed', tookMs: took, expectedMs: floor, questionId: String(question._id) });
  return { tookMs: took, expectedMs: floor };
}

/**
 * The same roll number answering from two live sockets.
 *
 * This is the strongest thing on the list. It is not a browser self-report, it
 * cannot be turned off from devtools, and its innocent explanation - a phone that
 * dropped and reconnected - is exactly what the presence map already
 * distinguishes, because the old socket is gone in that case and both are
 * present in this one.
 */
export function noteSecondSocket(profile, meta = {}) {
  record(profile, 'second-socket', { src: 'observed', ...meta });
}

/**
 * A summary for the teacher: what happened, how much of it, and how much of it
 * is worth believing. Never a verdict - the wording stays descriptive on purpose.
 */
export function summarise(profile) {
  const events = Array.isArray(profile?.integrity) ? profile.integrity : [];
  const count = (k) => events.filter((e) => e.kind === k).length;

  const away = events.filter((e) => e.kind === 'hidden').length;
  const awayMs = events.reduce((n, e) => n + (Number(e.awayMs) || 0), 0);
  const observed = events.filter((e) => e.src === 'observed');

  const notes = [];
  if (away >= NOTABLE) notes.push(`Left the page ${away} times${awayMs ? ` (about ${Math.round(awayMs / 1000)}s in total)` : ''}.`);
  else if (away > 0) notes.push(`Left the page ${away} time${away === 1 ? '' : 's'}.`);
  if (count('paste')) notes.push(`Pasted into an answer ${count('paste')} time${count('paste') === 1 ? '' : 's'}.`);
  if (count('fullscreen-exit')) notes.push('Left focus mode.');
  if (count('too-fast')) notes.push(`${count('too-fast')} answer${count('too-fast') === 1 ? '' : 's'} arrived faster than the question could be read.`);
  if (count('second-socket')) notes.push('Answered from two connections at once.');

  return {
    events: events.length,
    away,
    awayMs,
    // Split so the UI can show them differently without re-deriving the rule.
    reported: events.length - observed.length,
    observed: observed.length,
    notes,
    // The only three-way judgement this module makes, and it is about ATTENTION,
    // not honesty. 'watch' means a teacher might want to look, never that a
    // student did anything wrong.
    level: observed.length > 0 ? 'watch' : away >= NOTABLE || count('paste') > 0 ? 'note' : 'clear',
  };
}

/** What the product is allowed to claim, in one place, so no screen overstates it. */
export const HONESTY =
  'These are signals, not proof. A browser can see this tab losing focus; it cannot see a ' +
  'second device, another person in the room, or a tool built to stay invisible to the page — ' +
  'and a student who edits the page can suppress the reported ones entirely. Read them as a ' +
  'prompt to look, never as a verdict.';
