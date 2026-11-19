// Phase 7 - teacher records the console can send again after the network drops
// (gap F1, decision O1 on the staff side). The rules a replayed write is held
// to; routes/recordSync.js applies them at the door and routes/records.js and
// routes/session.js check what a write was made from.
//
// Two things make a record write safe to send twice, or late.
//
//   The key.     The console gives every write it queues a key of its own (a
//                UUID), and sends it again, unchanged, with every retry. The
//                first time the server meets a key in a room it does the write
//                and keeps the reply under it; every later time it answers with
//                that reply and changes nothing. The same key with other details
//                is refused: it cannot be the same change. A write sent without
//                a key is done exactly as before.
//
//   basedOn.     A mark that is last-write-wins (attendance, an observation, a
//                pick's response, an edit of a tally or an activity, what was
//                done about an insight) may say what it was made from: the
//                record as the screen showed it. If that record has since moved
//                on, the write is refused (409) with a sentence naming what is
//                newer and the record as it stands, so the console can show both
//                and the professor decides. Never decided by a device's clock:
//                a time in basedOn is the server's own, echoed back, and is only
//                ever compared for equality, never for order.
//
// The server applies writes in the order they arrive. The console's outbox
// sends them in the order they were made, one at a time, and fills in each
// write's basedOn just before its first send: the stamp the server last gave
// this console for that record, from its last read or from the reply to the
// previous write on the same record in the outbox. Two offline taps on one
// student are then a chain, not a conflict with itself. The body, basedOn
// included, is then fixed: it is part of what the key is kept with.
//
// Per kind of record, what a replayed write meets:
//
//   attendance mark      last write wins, one per student per room. basedOn
//                        per mark: refused (409, all or nothing) when a
//                        professor's mark with another status was made since.
//                        A phone's join never stands in the way.
//   observation          append-only; the latest is the mark in force. Refused
//                        when the mark in force is not the one it was made from.
//                        The same mark again is "nothing changed", never refused.
//   wheel pick response  refused when a field it sets (ask, question, response)
//                        changed since, unless it already holds what is sent.
//   tally edit           the same, field by field (text, options, counts, ...).
//   tally step           a step, not a value: never stale, steps from two
//                        devices add up. The key makes each one count once.
//   activity, new        the key makes it one row. An edit: as a tally edit.
//   insight action       append-only; the latest on a card is in force. Refused
//                        when another action on the card was recorded since,
//                        unless it is this same action.
//   wheel settings,      the key makes each one happen once; settings are last
//   draw, new round      write wins, as a preference, and a draw is the
//                        server's own choice, so neither has a basedOn.
//
// A refused write changes nothing and is not kept under its key: the console
// keeps it, shows the sentence beside the record as it stands (`current`), and
// the professor decides. Evidence already kept is never edited or removed.

import crypto from 'node:crypto';

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The request header a key travels in. */
export const KEY_HEADER = 'Idempotency-Key';

/** Set on an answer that is a kept reply, not a new write. */
export const REPLAYED_HEADER = 'Idempotent-Replayed';

// The phone's answerId shape (sockets/index.js ANSWER_ID): a UUID fits, and so
// does any other random id a client may already make.
export const WRITE_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Said when a key comes back with other details: two changes cannot share one key. */
export const KEY_REUSED = 'This change was already sent once with different details, so it was not done again. '
  + 'Nothing was changed: send it as a new change.';

// What every refusal of a stale write ends with: the server cannot know when the
// change was made (the device's clock is not trusted), only what it was made from.
const NEWER = 'newer than what this change was made from. Nothing was changed.';

/** The key off a request header, or an honest 400. */
export function writeKeyFrom(raw) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!WRITE_KEY.test(key)) {
    throw fail('The replay key must be 8 to 64 letters, digits, hyphens or underscores, such as a UUID.', 400);
  }
  return key;
}

/**
 * Who a key belongs to: the account, or the shared teacher key, which has none.
 * Two professors never share a key, and in practice only a room's owner writes.
 */
export const writerOf = (viewer) => (viewer?.id ? String(viewer.id) : 'shared-key');

/** JSON with every object's keys sorted, so the same details always read the same. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The hash a key is kept with: the route, the record the path names (a pick,
 * a tally, an activity; '' for none) and the body, so a key sent again on
 * another route or for another record is "different details" too.
 */
export function bodyHash(route, target, body) {
  return crypto.createHash('sha256').update(`${route}\n${target}\n${canonical(body ?? {})}`).digest('hex');
}

// ------------------------------------------------------------- basedOn --

/**
 * A time the screen saw on a record, as the server gave it (markedAt,
 * observedAt, actedAt), or null for "there was none". undefined: not sent, and
 * nothing is checked.
 */
export function basedOnTime(raw, field = 'basedOn') {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const t = typeof raw === 'string' ? Date.parse(raw) : NaN;
  if (!Number.isFinite(t)) throw fail(`${field} must be the time the record showed, as the server gave it, or null for none.`, 400);
  return t;
}

/** Does a record's time (or its absence) match what the screen saw? Equality only. */
export function sameMoment(stamp, basedOn) {
  const t = stamp ? Date.parse(stamp) : null;
  return t === basedOn;
}

/** The fields of a record as the screen showed them, keeping only those this kind of write can change. */
export function basedOnFields(raw, allowed) {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail(`basedOn must be the record as it was shown: ${allowed.join(', ')}.`, 400);
  }
  return Object.fromEntries(allowed.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
}

/**
 * The fields this write would overwrite that changed since the screen saw them.
 * A field the write does not change is left out, and so is one that already
 * holds what the write wants: nothing newer would be lost.
 */
export function movedFields(basedOn, current, wanted) {
  if (!basedOn) return [];
  const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
  return Object.keys(wanted).filter((k) => k in basedOn && !same(basedOn[k], current[k]) && !same(wanted[k], current[k]));
}

// The time of day in India, for a sentence: the professor's own clock.
const CLOCK = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "10:42", or '' for no time. */
export function clockOf(stamp) {
  const t = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(t) ? CLOCK.format(new Date(t)) : '';
}

const at = (stamp) => (clockOf(stamp) ? ` at ${clockOf(stamp)}` : '');

/** The 409 a stale write gets: the sentence, and the record as it stands. */
export const staleReply = (error, current, extra = {}) => ({ error, stale: true, ...extra, current });

// --------------------------------------------------------------- per kind --

/**
 * Attendance (last write wins, one mark per student per room). The marks of a
 * request that would replace a professor's mark made since the screen saw it
 * (`basedOn` on each mark: its markedAt, or null for unmarked), with a status
 * other than the one sent. A mark from a phone's join never stands in the way:
 * the professor's mark always replaces a join, as it always has.
 */
export function newerMarks(raw, wanted, marks) {
  const basedOn = new Map();
  (Array.isArray(raw) ? raw : []).forEach((m, i) => {
    if (m?.basedOn === undefined) return;
    const id = typeof m?.studentId === 'string' ? m.studentId.trim().toLowerCase() : '';
    basedOn.set(id, basedOnTime(m.basedOn, `marks[${i}].basedOn`));
  });
  if (!basedOn.size) return [];
  const held = new Map(marks.map((m) => [String(m.classStudentId).toLowerCase(), m]));
  return wanted
    .filter((w) => {
      const id = String(w.classStudentId).toLowerCase();
      const now = held.get(id);
      return basedOn.has(id) && now?.source === 'teacher' && now.status !== w.status && !sameMoment(now.markedAt, basedOn.get(id));
    })
    .map((w) => held.get(String(w.classStudentId).toLowerCase()));
}

/** "21CS04 (Asha Rao) was marked late at 10:42, newer than ..." for one or more. */
export function newerMarksSentence(newer, roster = []) {
  const who = (m) => {
    const s = roster.find((r) => String(r._id) === String(m.classStudentId));
    const roll = s?.rollNo ?? m.rollNo ?? 'A student';
    return s?.name ? `${roll} (${s.name})` : roll;
  };
  if (newer.length === 1) return `${who(newer[0])} was marked ${newer[0].status}${at(newer[0].markedAt)}, ${NEWER}`;
  const list = newer.map((m) => `${who(m)} ${m.status}${at(m.markedAt)}`).join('; ');
  return `${newer.length} students were marked again (${list}), ${NEWER}`;
}

/**
 * An observation (append-only, and the latest is the mark in force). Stale when
 * the mark in force is not the one the screen showed (`basedOn`: its
 * observedAt, or null for none). `latest` is the day's last event, a clear
 * included, for the sentence.
 */
export function observationStale(before, basedOn) {
  return basedOn !== undefined && !sameMoment(before?.observedAt ?? null, basedOn);
}

export function observationSentence(name, before, latest, labelOf) {
  const whose = name ? `${name}'s mark for this class` : 'This student\'s mark for this class';
  if (!before) return `${whose} was cleared${at(latest?.observedAt)}, ${NEWER}`;
  return `${whose} was set to ${labelOf(before.kind)}${at(before.observedAt)}, ${NEWER}`;
}

/** A pick's response, a tally or an activity: the record changed since it was shown. */
export const changedSentence = (what, stamp, now = '') => `${what} was changed${at(stamp)}${now ? ` (now: ${now})` : ''}, ${NEWER}`;

/**
 * What was done about an insight (append-only; the latest action on a card is
 * in force). Stale when another action on the card was recorded since the
 * screen showed its last one (`basedOn`: that action's actedAt, or null for
 * none), and it was not this same action.
 */
export function insightStale(last, basedOn, action) {
  return basedOn !== undefined && Boolean(last) && !sameMoment(last.actedAt, basedOn) && last.action !== action;
}

export const insightSentence = (last) =>
  `This card was ${last.action === 'dismissed' ? 'dismissed' : 'marked as acted on'}${at(last.actedAt)}, ${NEWER}`;
