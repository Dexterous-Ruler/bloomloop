// Phase 7, stage "Next": the question pack and the grace window after a room
// closes (decisions O2 and O3 of 19 Nov 2026, taken under the owner's
// delegation; the evaluation behind them is docs/OFFLINE_SELECTION.md).
//
// A phone that may lose its connection asks, once it has joined, for a pack of
// the few questions it would be served next. Offline it works through them in
// order; its answers wait in its outbox and reach the server later through the
// ordinary student:answer, each with its own answerId. The server, never the
// phone, then marks them and moves the ladder, in the order it RECEIVES them.
//
// What never changes: a key never goes to a device (every packed question is
// sent through forStudent(), as a live one is), so an answer made offline is
// "saved, will be marked when you reconnect", never marked on the phone. A
// device's clock is stored for the record and never read for order or for
// whether an answer counts.
//
// Pure: the live loop (sockets/index.js) reads the store, writes each pack's
// record (question_packs, 0030) and sends what is decided here.

import { createHash } from 'node:crypto';
import { LABEL, LEVELS } from '../bloom.js';
import { forStudent } from '../questionTypes.js';
import { phoneProvenance } from './honesty.js';
import { isSlowLearner } from './mastery.js';
import { reasonForPhone } from './selector.js';

/** How many questions a pack holds at most. Smaller when the room's cap on questions per student leaves fewer. */
export const PACK_SIZE = 5;

/**
 * How long a phone may work from a pack: 6 hours from when it was sent, or until
 * the room closes, whichever is sooner. Six hours covers a day's teaching with
 * the phone off; past that the level the pack was chosen for is stale, and the
 * next request chooses again from where the student stands.
 */
export const PACK_HOURS = 6;
const HOUR_MS = 60 * 60 * 1000;

/**
 * How long after a room closes an answer to a question the server served (or
 * packed) to that phone before the close still counts (O2). A named constant
 * now; a room setting later.
 */
export const GRACE_MINUTES = 10;
export const GRACE_MS = GRACE_MINUTES * 60 * 1000;

/**
 * How a pack of PACK_SIZE is shared between levels (O3: "its working level and
 * one either side"): mostly the working level, where the live selector aims;
 * one a level below, the cheaper mistake; one a level above, so a student the
 * ladder is about to promote has met that level. A level with too few
 * questions leaves its places to the others, the working level first.
 */
export const PACK_SHARE = Object.freeze({ working: 3, below: 1, above: 1 });

/**
 * Written as `detail` on an answer that reached the server after its room
 * closed and does not count: the question was not one the server served or
 * packed to that phone before the close, or it arrived after the grace window.
 * Kept with `final` false, never in a profile, never in a level.
 */
export const AFTER_CLOSE_DETAIL = 'Arrived after the room closed: kept, not counted.';

/**
 * Written as `detail` on an answer that arrived once the student had already
 * answered as many questions as the room asks each student (0018's cap). Before
 * Phase 7 a phone could only get there by sending an id it was never served,
 * and the answer was not stored. A phone's outbox now can, honestly: a pack is
 * sized to the cap when it is sent, and live answers given since can use the
 * rest. Stored like a late one: `final` false, no mark, never counted.
 */
export const OVER_CAP_DETAIL = 'Arrived after the student had answered every question the room asks: kept, not counted.';

/**
 * Written as `detail` on an answer to a question the student had already been
 * marked on, arriving under a new answerId: most often the copy of a packed
 * question still in a phone's outbox after the same question was served and
 * answered live. Before the fix of 19 Nov 2026 it was answered with the earlier
 * mark and not stored; every answer that reaches the server is stored (O1, O2),
 * so it is kept like a late one: `final` false, no mark, never counted.
 */
export const ANSWERED_AGAIN_DETAIL = 'Arrived after the student had already been marked on this question: kept, not counted.';

/** Is this answer row one that arrived after its room closed and does not count? */
export const keptAfterClose = (a) => a?.final === false && a?.detail === AFTER_CLOSE_DETAIL;

/** Is this answer row a second answer to a question already marked, kept and not counted? */
export const keptAnsweredAgain = (a) => a?.final === false && a?.detail === ANSWERED_AGAIN_DETAIL;

/** Is this answer row one kept and never counted for any reason above? Every report leaves it out. */
export const keptNotCounted = (a) => a?.final === false
  && (a?.detail === AFTER_CLOSE_DETAIL || a?.detail === OVER_CAP_DETAIL || a?.detail === ANSWERED_AGAIN_DETAIL);

/**
 * How many answers kept and not counted one student may have in one room: the
 * three above, and an answer of their own to a question put to the class. Each
 * is evidence and is stored, up to and including the KEPT_LIMIT-th. Past that an
 * answer is refused with a sentence (KEPT_LIMIT_MESSAGE) and nothing more is
 * stored; a resend of one already kept is still answered from its row.
 *
 * Kept rows never enter the ladder, so nothing else bounds them: a phone could
 * send any question of its room again and again under fresh answer ids, each
 * stored, until the room's archive passed the 1 MB it may be and the room could
 * no longer be deleted. An honest phone comes nowhere near this: at each outage
 * its outbox holds the question on its screen and one pack (PACK_SIZE), and
 * each answer in it is stored once.
 */
export const KEPT_LIMIT = 100;

/** Said, as a refusal for good, to an answer past KEPT_LIMIT. Names no field, route or event. */
export const KEPT_LIMIT_MESSAGE = `This room has already saved ${KEPT_LIMIT} of your answers that do not count, which is as `
  + 'many as it keeps for one student, so this one was not taken. It stays on this phone: show it to your teacher if it '
  + 'matters.';

// What a phone is told. Plain sentences, no field or route named.

/** Sent with a pack. */
export const PACK_NOTE = 'Questions to work on if your connection drops. Answers you give offline are saved on this phone '
  + 'and marked when you reconnect.';
/** Sent instead of a pack when there is nothing left to pack. */
export const PACK_EMPTY_NOTE = 'There are no more questions to keep on this phone for now.';
/** Sent instead of a pack when the pack could not be recorded. */
export const PACK_FAILED_NOTE = 'Questions for offline use could not be prepared just now. Your answers are still saved on '
  + 'this phone and sent when you reconnect.';

/** An answer that arrived after the close and counts. */
export const LATE_COUNTED_MESSAGE = 'The room had closed, but you had this question before it closed, so your answer '
  + 'is marked and counts.';
/** An answer that arrived after the close to a question the phone was not given before it. */
export const LATE_NOT_SERVED_MESSAGE = 'This answer reached your teacher after the room closed, and it was not a '
  + 'question you had been given before then, so it is saved but does not count.';
/** An answer that arrived after the grace window. */
export const LATE_TOO_LATE_MESSAGE = `This answer reached your teacher more than ${GRACE_MINUTES} minutes after the room `
  + 'closed, so it is saved but does not count.';
/** A second answer to a question the student had already been marked on. */
export const ANSWERED_AGAIN_MESSAGE = 'You had already answered this question and been marked on it, so this answer is '
  + 'saved but does not count.';
/** An answer to a question that was put to the whole class. */
export const ASKED_KEPT_MESSAGE = 'This question was put to the whole class, so your own answer to it is saved but '
  + 'does not count.';
/** An answer past the room's number of questions per student: `cap` is that number. */
export const overCapMessage = (cap) => `This room asks each student ${cap} question${cap === 1 ? '' : 's'}, and you had `
  + 'answered them all before this one arrived, so it is saved but does not count.';
/**
 * A late answer to a question this room does not ask (another chapter's, a
 * draft, one outside the room's set): not stored, since it would put a question
 * no phone in the room was given into the room's record. Sent as server:refused,
 * so a phone's outbox keeps it and shows it rather than sending it again.
 */
export const NOT_THIS_ROOM_MESSAGE = 'That question is not one this room asks, so the answer was not taken.';

/**
 * Said when a phone rejoins a closed room to send what it saved. At any time
 * while the room exists (O2): inside the grace window an answer to a question
 * it was given counts; after it every answer is stored and counts nowhere.
 */
export const DELIVER_MESSAGE = 'This room has closed. Answers saved on this phone are being sent; there are no new '
  + 'questions.';
/**
 * Said when a phone asks to send what it saved to a room brought online from a
 * teacher's laptop (laptop mode): its phones answered on the laptop, and the
 * laptop's saved file is the whole of its record, so nothing is added to it here.
 */
export const DELIVER_IMPORTED_REASON = 'This room was run on your teacher\'s laptop and has since been brought online '
  + 'from there, so it takes no more answers here. Anything still saved on this phone stays here; show it to your '
  + 'teacher if it matters.';

/** A pack's expiry, from when it was sent. */
export const packExpiry = (issuedAt) => new Date(Date.parse(issuedAt) + PACK_HOURS * HOUR_MS).toISOString();

/**
 * The levels a pack is drawn from, in the order its places are filled.
 *
 *   - Inside the below-40% band: Remember and Understand only (CONTRACT.md
 *     section 6 rule 4, the same ceiling selectNext keeps), alternating, opening
 *     where selectNext would (on Remember for a student whose next question is
 *     an odd one).
 *   - Otherwise: the working level, the level below it, and, in a room that
 *     adapts, the level above it. A room that does not adapt holds every
 *     student at its start level, so nothing above it is packed, as nothing
 *     above it is served live while the levels below have questions.
 *
 * @returns {{ working: string, below: string|null, above: string|null, alternate: string[]|null }}
 */
export function packLevels(profile, { adapt = true } = {}) {
  if (isSlowLearner(profile)) {
    const alternate = profile.history.length % 2 === 0 ? ['remember', 'understand'] : ['understand', 'remember'];
    return { working: alternate[0], below: null, above: null, alternate };
  }
  const i = Math.max(0, LEVELS.indexOf(profile.workingLevel));
  return {
    working: LEVELS[i],
    below: LEVELS[i - 1] ?? null,
    above: adapt ? (LEVELS[i + 1] ?? null) : null,
    alternate: null,
  };
}

/** Every level a pack for this profile may hold. */
export function packableLevels(profile, opts = {}) {
  const l = packLevels(profile, opts);
  return l.alternate ?? [l.working, l.below, l.above].filter(Boolean);
}

/**
 * A stable order for one student's candidates: the same student is offered the
 * same questions on every request (so asking again and again shows no more of
 * the bank), and two students are offered them in different orders (so a row
 * of phones does not hold one identical pack).
 */
const orderKey = (rollNo, id) => createHash('sha256').update(`${rollNo}:${String(id)}`).digest('hex');

/**
 * Choose a pack: questions from `bank` (what the room may serve now, already
 * without anything asked to the class: the live loop's own bank), never one
 * this student has been marked on, never one in `exclude` (the question pinned
 * on their screen, which the phone already holds).
 *
 * `held` are questions the phone already holds from its live pack and keeps:
 * they come first, as they are, and count towards each level's share.
 *
 * @returns {{ question: object, level: string }[]} in the order the phone should work through them
 */
export function choosePack(profile, bank, { size = PACK_SIZE, adapt = true, exclude = [], held = [] } = {}) {
  const out = held.map((q) => ({ question: q, level: q.bloom }));
  const room = Math.max(0, Math.min(PACK_SIZE, size) - out.length);
  if (room === 0) return out.slice(0, Math.max(0, size));

  const levels = packLevels(profile, { adapt });
  const allowed = new Set(packableLevels(profile, { adapt }));
  // Without case, as the answer path compares ids (sameId below).
  const done = new Set([
    ...profile.history.map((h) => h.questionId),
    ...exclude,
    ...held.map((q) => q._id),
  ].map((id) => String(id).toLowerCase()));
  const queues = new Map([...allowed].map((l) => [l, []]));
  for (const q of bank ?? []) {
    if ((q.status ?? 'active') !== 'active' || done.has(String(q._id).toLowerCase()) || !allowed.has(q.bloom)) continue;
    queues.get(q.bloom).push(q);
  }
  const rollNo = String(profile.rollNo ?? '');
  for (const list of queues.values()) list.sort((a, b) => (orderKey(rollNo, a._id) < orderKey(rollNo, b._id) ? -1 : 1));

  const picked = [];
  const take = (level) => {
    const q = level ? queues.get(level)?.shift() : null;
    if (q) picked.push({ question: q, level });
    return Boolean(q);
  };

  if (levels.alternate) {
    // The band: alternate the two levels, as selectNext does; when one runs
    // dry the other carries on.
    for (let i = 0; picked.length < room && i < room * 2; i += 1) {
      if (!take(levels.alternate[i % 2])) take(levels.alternate[(i + 1) % 2]);
    }
    return [...out, ...picked.slice(0, room)];
  }

  const already = (level) => out.filter((h) => h.level === level).length;
  const share = [
    [levels.working, PACK_SHARE.working],
    [levels.below, PACK_SHARE.below],
    [levels.above, PACK_SHARE.above],
  ];
  for (const [level, n] of share) {
    for (let k = already(level); k < n && picked.length < room; k += 1) if (!take(level)) break;
  }
  // Places a level could not fill go to the others, the working level first.
  for (const level of [levels.working, levels.below, levels.above]) {
    while (picked.length < room && take(level));
  }
  return [...out, ...picked];
}

/**
 * What server:pack carries to a phone: the pack's times, the grace window, the
 * room's seconds per question when it set them, and each question exactly as
 * server:question would carry it (forStudent() with the same seed and supports,
 * so a board is the same offline as online, and the phone's own provenance),
 * with the phone's own sentence for why. Nothing a phone could mark with: no
 * key, no rubric, no solution, no level check, no misconception label.
 *
 * @param {{ pack: { issuedAt, expiresAt }, chosen: { question }[], profile, supports?, settings? }} args
 */
export function packPayload({ pack, chosen, profile, supports = null, settings = {} }) {
  return {
    issuedAt: pack.issuedAt,
    expiresAt: pack.expiresAt,
    // How long after the room closes an answer to one of these still counts.
    graceMinutes: GRACE_MINUTES,
    // Seconds per question when the room set them (0018), as server:question
    // carries them: the phone keeps the time offline too, and never enforces it.
    ...(settings.timePerQuestion ? { timePerQuestion: settings.timePerQuestion } : {}),
    // In the order the phone works through them.
    questions: chosen.map(({ question: q }) => ({
      question: { ...forStudent(q, `${profile.rollNo}:${q._id}`, supports), provenance: phoneProvenance(q) },
      reason: packReason(profile, q.bloom),
    })),
    note: PACK_NOTE,
  };
}

/**
 * The phone's own sentence for why a packed question is at its level. At the
 * working level, and inside the below-40% band, it is the live loop's own
 * (reasonForPhone). The one either side gets its own words: the live loop's
 * "no questions are left for you at ..." would be untrue there, since the pack
 * holds them on purpose. Never a band, a percentage or a rank.
 */
export function packReason(profile, level) {
  const step = LEVELS.indexOf(level) - LEVELS.indexOf(profile.workingLevel);
  if (isSlowLearner(profile) || step === 0 || !LABEL[level]) return reasonForPhone(profile, level);
  return step < 0
    ? `This question is at ${LABEL[level]}, the level before the one you are working at.`
    : `This question is at ${LABEL[level]}, the next level up, ready in case your answers move you on.`;
}

/**
 * The pack a phone holds now: the latest one sent to it, while it has not
 * expired. Packs are listed oldest first.
 */
export function livePack(packs = [], now = Date.now()) {
  const latest = packs.at(-1);
  return latest && Date.parse(latest.expiresAt) > now ? latest : null;
}

/**
 * How many pack records one phone may have in one room. A new record is written
 * only when a pack gains a question its live pack did not hold (packRecordNeed),
 * which takes an answer to a packed question or an expiry, so a class never
 * comes near this; it bounds the rows a phone could make, and the rows every
 * answer to a question off its screen reads.
 */
export const PACK_RECORD_LIMIT = 50;

/**
 * Does a pack of `chosen` need a record of its own?
 *
 *   'reuse'   every chosen question is in the live pack, whose record already
 *             says it was given to this phone: send them under that record's
 *             times and write nothing. Asking again, or asking after the
 *             question on the screen moved, lands here.
 *   'write'   a question the live pack does not hold: record a new pack first.
 *   'limit'   the same, but the phone has PACK_RECORD_LIMIT records already:
 *             write nothing, and send only what the live pack still holds.
 *
 * @returns {'reuse'|'write'|'limit'}
 */
export function packRecordNeed({ live, chosen = [], count = 0 }) {
  const held = (live?.questionIds ?? []);
  if (live && chosen.every((c) => held.some((id) => sameId(id, c.question._id)))) return 'reuse';
  return count >= PACK_RECORD_LIMIT ? 'limit' : 'write';
}

/** Two record ids, compared as a uuid or an ObjectId is: without case. */
export const sameId = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * How many questions a profile's log of serves keeps (servedLog below). A room's
 * bank is tens to a few hundred questions, and each is logged once, so this is
 * never reached in a real class; it bounds a profile row against a phone asking
 * for question after question for hours.
 */
export const SERVED_LOG_LIMIT = 500;

/**
 * The profile with `questionId` added to its log of serves, at `at`, unless it
 * is there already (the first serve is the one that counts). The log is the
 * durable record of every question the server put on this phone's screen
 * (0030's profiles.served_log): the pin says only what is on the screen NOW,
 * and moves on without the old question being answered (a failed save and
 * "Next question", a pin no longer servable at a rejoin), so an answer to the
 * old question that arrives after the close was taken for one never given.
 * Changes `profile` in place and returns whether it changed.
 */
export function logServed(profile, questionId, at) {
  const log = Array.isArray(profile.servedLog) ? profile.servedLog : [];
  if (!questionId || log.some((e) => sameId(e.questionId, questionId))) return false;
  profile.servedLog = [...log, { questionId: String(questionId), at }].slice(-SERVED_LOG_LIMIT);
  return true;
}

/**
 * When the server first served this question to this phone, or packed it for
 * it: the pin on its profile (the question on its screen), its log of serves
 * (logServed), or the earliest pack that held it, whichever is first. Null when
 * it never did. `before`, when given, is the room's close: only what was served
 * or packed by then counts.
 */
export function servedAtFor({ profile, packs = [], questionId, before = null }) {
  const limit = before ? Date.parse(before) : Infinity;
  const pinAt = sameId(profile?.served?.questionId, questionId) ? profile.served.at : null;
  const logged = (Array.isArray(profile?.servedLog) ? profile.servedLog : []).filter((e) => sameId(e.questionId, questionId));
  const times = [
    ...(pinAt ? [pinAt] : []),
    ...logged.map((e) => e.at),
    ...packs.filter((p) => (p.questionIds ?? []).some((q) => sameId(q, questionId))).map((p) => p.issuedAt),
  ].filter((t) => t && Date.parse(t) <= limit);
  return times.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
}

/**
 * Whether an answer that reached the server after its room closed counts (O2).
 * It counts when the server served or packed the question to that phone before
 * the close (`servedAt`, from servedAtFor with the close as `before`) and the
 * answer arrived within GRACE_MS of the close, the edge included. Arrival is
 * the server's clock (`now`), never the phone's: the moment the answer reached
 * the server, read before it waited for its student's turn (handleAnswer's
 * arrivedAt), not the moment it was marked. So an answer that arrived before
 * the close and was marked after it, having waited behind the answers sent
 * before it, is inside the window too.
 *
 * @returns {{ counted: boolean, message: string }}
 */
export function lateVerdict({ closedAt, servedAt, now = Date.now() }) {
  const closed = Date.parse(closedAt ?? '');
  const inWindow = Number.isFinite(closed) && now - closed <= GRACE_MS;
  if (!servedAt) return { counted: false, message: LATE_NOT_SERVED_MESSAGE };
  if (!inWindow) return { counted: false, message: LATE_TOO_LATE_MESSAGE };
  return { counted: true, message: LATE_COUNTED_MESSAGE };
}

/**
 * The time a phone says its student answered, as an ISO string, or null. Kept
 * on the answer row for the record and read by nothing that marks, orders or
 * counts (O2: a device's clock is not trusted). Anything that is not a date
 * this century is dropped rather than stored.
 */
export function deviceTimeOf(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year >= 2000 && year < 2100 ? new Date(t).toISOString() : null;
}
