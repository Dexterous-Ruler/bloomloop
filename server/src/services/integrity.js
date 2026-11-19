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

/*
 * Batch 9 (decision E5, and E7 for screenshot shortcuts): the kinds an exam room
 * adds. Only a room whose `examMode` is on takes them; in any other room a phone
 * sending one is dropped like any unknown kind, so nothing changes there.
 *
 * Reported (the browser says so, cheap to fake, as REPORTED above):
 *   fullscreen_exit         a laptop left fullscreen
 *   copy_attempt            a copy or cut on the question was blocked
 *   context_menu            the right-click or long-press menu was blocked
 *   focus_lost              the window lost focus with the page still showing
 *                           (on a phone: Google Lens, Circle to Search, the
 *                           assistant or the app switcher, among others)
 *   visibility_hidden       the page was hidden (another tab or app)
 *   screenshare_stopped     the shared screen stopped being shared
 *   screenshot_attempt      a screenshot shortcut was pressed, with its method;
 *                           the page sees the key, not whether a picture was taken
 *   screenshare_not_started the student did not start sharing. Recorded once per
 *                           join and nothing more (no level, no mark): it is the
 *                           only record a declined share leaves.
 * Observed (the server worked it out, as OBSERVED above):
 *   snapshot_missing        screen pictures were due and none arrived
 *   second_device           two live connections on one roll number in one room
 *   timing_anomaly          an answer sooner than the question could be read
 *                           (examMinPlausibleMs below says how)
 * In an exam room the server records second_device and timing_anomaly where any
 * other room records second-socket and too-fast, so one event is never counted
 * under two names.
 */
export const EXAM_REPORTED = [
  'fullscreen_exit', 'copy_attempt', 'context_menu', 'focus_lost', 'visibility_hidden',
  'screenshare_stopped', 'screenshot_attempt', 'screenshare_not_started',
];
export const EXAM_OBSERVED = ['snapshot_missing', 'second_device', 'timing_anomaly'];

/** How a screenshot shortcut was seen (E7). Anything else is stored as 'other'. */
export const SCREENSHOT_METHODS = ['printscreen', 'snip_shortcut', 'mac_shortcut'];

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
export function reportFromClient(profile, sent, meta = {}, { exam = false } = {}) {
  const kind = exam ? examKind(sent) : sent;
  if (!reportable(kind, { exam })) return false;
  // Only the fields we understand, and nothing long enough to be a payload.
  const clean = {};
  if (Number.isFinite(Number(meta.awayMs))) clean.awayMs = Math.min(Number(meta.awayMs), 86400000);
  if (typeof meta.questionId === 'string') clean.questionId = meta.questionId.slice(0, 64);
  // E7: which shortcut, from a closed list, so the field can never carry a payload.
  if (kind === 'screenshot_attempt') clean.method = SCREENSHOT_METHODS.includes(meta.method) ? meta.method : 'other';
  record(profile, kind, { ...clean, src: 'reported' });
  return true;
}

/**
 * Would reportFromClient take this kind? Asked before the store is read. A phone
 * may report screenshare_not_started only through its screen event, never here
 * (services/examGuard.js), so the one record a declined share leaves is the
 * server's and is made once.
 */
export const reportable = (kind, { exam = false } = {}) => REPORTED.includes(kind)
  || (exam && EXAM_REPORTED.includes(kind) && kind !== 'screenshare_not_started');

/**
 * The older kinds a phone reports in every room, and the exam kind each one is
 * the same event as. A phone in an exam room may send both for one leave (the
 * room's own listeners, and the exam guard's), and summarise() counts `hidden`
 * and `visibility_hidden` together as time away: so in an exam room the older
 * kind is recorded under the exam name, and the second report of one event is
 * then the same kind inside a second, which the rate drops (SIGNAL_LIMIT).
 */
export const EXAM_ALIAS = Object.freeze({ hidden: 'visibility_hidden', blurred: 'focus_lost', 'fullscreen-exit': 'fullscreen_exit' });

/** The kind an exam room records for what a phone sent: the exam name for an older kind, else as sent. */
export const examKind = (kind) => EXAM_ALIAS[kind] ?? kind;

/**
 * A signal the server records about an exam room's phone from what the phone did
 * on its screen event: the share it stopped, or did not start. Reported, because
 * the phone said so; only these two kinds.
 */
export function noteScreen(profile, kind) {
  if (kind !== 'screenshare_stopped' && kind !== 'screenshare_not_started') return false;
  record(profile, kind, { src: 'reported' });
  return true;
}

/**
 * The exam room's reading rule (timing_anomaly), written down because a signal
 * nobody can check is an accusation.
 *
 * The answer arrived, by the server's clock from when the server served the
 * question, sooner than the question could be read: its text, options, pairs,
 * items and, in an exam room, the passage it hangs off, at 25 characters a
 * second (about 300 words a minute, fast for unfamiliar technical material and
 * meant to be generous), and never under 0.9 seconds. The passage counts once
 * per student: only on the first question served to them from it
 * (`passageRead` false). Several questions hang off one passage, and a student
 * who read it for the first does not read it again for the next; counted every
 * time, the rule flagged most of a class on a comprehension exam. First
 * attempts only, and never for an answer kept and not counted. A figure's
 * drawing is not counted as reading, so a question about a picture is held to
 * its words alone, which can only make the rule fire less.
 */
export function examMinPlausibleMs(question, { passageRead = false } = {}) {
  const passage = passageRead ? '' : passageOf(question);
  return minPlausibleMs(question) + Math.round((passage.length / CHARS_PER_SECOND) * 1000);
}

/** The passage a question hangs off, as its text, or '' for none. */
export const passageOf = (question) => (question?.stimulus?.kind === 'passage' ? String(question.stimulus.text ?? '') : '');

/**
 * checkLatency for an exam room: the same check with the passage counted (once:
 * examMinPlausibleMs), recorded as timing_anomaly.
 */
export function checkTiming(profile, question, servedAt, now = Date.now(), { passageRead = false } = {}) {
  if (!servedAt) return null;
  const took = now - new Date(servedAt).getTime();
  if (!Number.isFinite(took) || took < 0) return null;
  const floor = examMinPlausibleMs(question, { passageRead });
  if (took >= floor) return null;
  record(profile, 'timing_anomaly', { src: 'observed', tookMs: took, expectedMs: floor, questionId: String(question._id) });
  return { tookMs: took, expectedMs: floor };
}

/** noteSecondSocket for an exam room. */
export function noteSecondDevice(profile, meta = {}) {
  record(profile, 'second_device', { src: 'observed', ...meta });
}

/** Screen pictures were due and none arrived (the rule: services/examGuard.js snapshotOverdue). */
export function noteSnapshotMissing(profile, meta = {}) {
  record(profile, 'snapshot_missing', { src: 'observed', ...meta });
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

/** How many graded answers make each half of a level-jump comparison. */
export const JUMP_WINDOW = 5;

/**
 * An abrupt swing from struggling to perfect, worked out from the answers alone.
 *
 * Recorded when a student's last JUMP_WINDOW graded answers in this room are all
 * right, straight after JUMP_WINDOW in which at most one was right. That is a
 * pattern a teacher may want to look at, and nothing more: students genuinely
 * turn a corner, and the note says so. It is OBSERVED because it comes from
 * answers the server marked, not from anything the phone reported.
 *
 * Once per swing: it is not recorded again until the window that triggered it
 * has scrolled out, so one good run is one note, not five.
 *
 * Decided in docs/PRODUCT_DECISIONS.md ("Defaults chosen during implementation").
 */
export function checkLevelJump(profile) {
  const graded = (profile.history ?? []).filter((h) => !h.ungraded);
  if (graded.length < JUMP_WINDOW * 2) return null;
  const recent = graded.slice(-JUMP_WINDOW);
  const before = graded.slice(-JUMP_WINDOW * 2, -JUMP_WINDOW);
  if (!recent.every((h) => h.correct)) return null;
  if (before.filter((h) => h.correct).length > 1) return null;

  const lastJump = [...(profile.integrity ?? [])].reverse().find((e) => e.kind === 'level-jump');
  // The answer that opened the current window; a jump already noted inside it is the same swing.
  const windowStart = recent[0]?.at ?? '';
  if (lastJump && String(lastJump.at) >= String(windowStart)) return null;

  const meta = {
    src: 'observed',
    before: before.filter((h) => h.correct).length,
    after: recent.length,
    window: JUMP_WINDOW,
    questionId: String(recent[recent.length - 1].questionId ?? ''),
  };
  record(profile, 'level-jump', meta);
  return meta;
}

/**
 * A summary for the teacher: what happened, how much of it, and how much of it
 * is worth believing. Never a verdict - the wording stays descriptive on purpose.
 */
export function summarise(profile) {
  const events = Array.isArray(profile?.integrity) ? profile.integrity : [];
  const count = (k) => events.filter((e) => e.kind === k).length;

  // An exam room's visibility_hidden is the same absence as `hidden` elsewhere.
  const away = events.filter((e) => e.kind === 'hidden' || e.kind === 'visibility_hidden').length;
  const awayMs = events.reduce((n, e) => n + (Number(e.awayMs) || 0), 0);
  const observed = events.filter((e) => e.src === 'observed');

  const notes = [];
  if (away >= NOTABLE) notes.push(`Left the page ${away} times${awayMs ? ` (about ${Math.round(awayMs / 1000)}s in total)` : ''}.`);
  else if (away > 0) notes.push(`Left the page ${away} time${away === 1 ? '' : 's'}.`);
  if (count('paste')) notes.push(`Pasted into an answer ${count('paste')} time${count('paste') === 1 ? '' : 's'}.`);
  if (count('fullscreen-exit')) notes.push('Left focus mode.');
  if (count('too-fast')) notes.push(`${count('too-fast')} answer${count('too-fast') === 1 ? '' : 's'} arrived faster than the question could be read.`);
  if (count('second-socket')) notes.push('Answered from two connections at once.');
  if (count('level-jump')) {
    notes.push(`${count('level-jump') === 1 ? 'Once' : `${count('level-jump')} times`}, ${JUMP_WINDOW} right in a row straight after a run of mostly wrong answers. Students do turn corners; this is a prompt to look, not a finding.`);
  }
  notes.push(...examNotes(count));

  // Batch 9: the exam kinds that, three or more together, are worth a glance.
  // A screenshot shortcut is a deliberate key combination, so one is enough. A
  // share that was never started raises nothing: declining is the student's
  // choice, and it is recorded and nothing more (decision E5).
  const examReported = ['fullscreen_exit', 'copy_attempt', 'context_menu', 'focus_lost', 'screenshare_stopped']
    .reduce((n, k) => n + count(k), 0);
  const noted = away >= NOTABLE || count('paste') > 0 || count('screenshot_attempt') > 0 || examReported >= NOTABLE;

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
    level: observed.length > 0 ? 'watch' : noted ? 'note' : 'clear',
    // Batch 9: how many of each kind, and the newest event with only the fields
    // a screen needs, so the live console shows counts and the latest signal
    // without the whole trail.
    counts: Object.fromEntries([...new Set(events.map((e) => e.kind))].map((k) => [k, count(k)])),
    latest: latestOf(events),
  };
}

const times = (n) => `${n} time${n === 1 ? '' : 's'}`;

/** The exam kinds in words: what was seen, never what it means (decision E5). */
function examNotes(count) {
  const notes = [];
  const add = (kind, sentence) => { if (count(kind)) notes.push(sentence(count(kind))); };
  add('focus_lost', (n) => `The window lost focus ${times(n)} with the page still showing.`);
  if (count('visibility_hidden') || count('focus_lost')) {
    notes.push('Page left: possibly Google Lens, a screenshot tool or another app. A notification or a message does the same.');
  }
  add('fullscreen_exit', (n) => `Left fullscreen ${times(n)}.`);
  add('copy_attempt', (n) => `Copying was blocked ${times(n)}.`);
  add('context_menu', (n) => `The right-click or long-press menu was blocked ${times(n)}.`);
  add('screenshot_attempt', (n) => `A screenshot shortcut was pressed ${times(n)}. The page sees the key, not whether a picture was taken.`);
  add('screenshare_stopped', (n) => `Screen sharing stopped ${times(n)}.`);
  add('screenshare_not_started', () => 'Screen sharing was not started.');
  add('snapshot_missing', (n) => `${n} expected screen picture${n === 1 ? '' : 's'} did not arrive. A dropped connection or a laptop going to sleep does the same.`);
  add('second_device', (n) => `Joined from a second connection while the first was still live, ${times(n)}.`);
  add('timing_anomaly', (n) => `${n} answer${n === 1 ? '' : 's'} arrived faster than the question could be read.`);
  return notes;
}

/** The newest event, with only what a screen shows: never another socket's id or a payload. */
function latestOf(events) {
  const e = events.at(-1);
  if (!e) return null;
  return {
    kind: e.kind,
    at: e.at ?? null,
    src: e.src ?? null,
    ...(e.method ? { method: e.method } : {}),
    ...(e.questionId ? { questionId: e.questionId } : {}),
  };
}

/** What the product is allowed to claim, in one place, so no screen overstates it. */
export const HONESTY =
  'These are signals, not proof. A browser can see this tab losing focus; it cannot see a ' +
  'second device, another person in the room, or a tool built to stay invisible to the page — ' +
  'and a student who edits the page can suppress the reported ones entirely. Read them as a ' +
  'prompt to look, never as a verdict.';
