// Teacher/student separation.
//
// There are no accounts anywhere in BloomLoop - that is a deliberate product
// decision, because asking sixty students to make accounts kills a ten-minute
// class activity. But teacher and student are served from the SAME origin, so
// "no accounts" cannot also mean "no boundary": without one, a student who can
// read the room code off the projector can walk the API to the full answer key.
//
// So the student side stays open (code + roll number, exactly as specified) and
// the teacher side - content, generation, the bank, opening sessions, the grid
// and exports - is gated on a single shared key that the teacher's browser
// picks up automatically from the URL printed in the boot banner.

import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { laptopMode } from './laptop.js';

const HEADER = 'x-teacher-key';

export function teacherKeyFrom(req) {
  const fromHeader = req.get(HEADER);
  const fromQuery = typeof req.query?.key === 'string' ? req.query.key : '';
  return String(fromHeader || fromQuery || '').trim();
}

/** Is `key` the teacher key? Nothing else is decided here. */
function keyMatches(key) {
  const supplied = Buffer.from(String(key ?? ''));
  const expected = Buffer.from(config.teacherKey);
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first - and an unequal length is already a definitive answer.
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(supplied, expected);
}

export function isTeacher(req) {
  return keyMatches(teacherKeyFrom(req));
}

/* ------------------------------------------- wrong keys, laptop mode only --
 *
 * In laptop mode (Phase 7, O4) the shared key is the only thing guarding the
 * console, and every student's phone is on the same Wi-Fi as the laptop with
 * nothing in between: 3000 wrong keys were tried in under four seconds. So
 * there, KEY_TRIES different wrong keys from one address within KEY_WINDOW_MS
 * shut that address out of the key for KEY_WINDOW_MS, the right key included
 * (otherwise a guesser learns the right key while shut out, from the one reply
 * that differs). Different keys, because a guesser must try new ones, while a
 * console tab still holding the key of an earlier start sends the same wrong
 * one with every request, and must not shut the laptop out of its own console.
 * A sign-in token is not affected: there is none in laptop mode.
 *
 * Laptop mode only: a deployed server sits behind a proxy and sees one address
 * for everyone (no `trust proxy` is set), so a count there would shut every
 * professor out of the key whenever anyone guessed wrong. In-process, as the
 * profile locks are: one server process owns every request and socket.
 */
export const KEY_TRIES = 10;
export const KEY_WINDOW_MS = 10 * 60 * 1000;
export const KEY_BLOCKED_MESSAGE = 'Too many wrong teacher keys were tried from this device. Wait ten minutes, then open '
  + 'the console with the link the laptop printed.';
const keyFailures = new Map(); // address -> { keys: Set of the wrong keys tried, first, until }

const addressOf = (address) => String(address ?? '').replace(/^::ffff:/, '') || 'unknown';

/**
 * Check a teacher key sent from `address`: 'ok', 'none' (no key sent), 'wrong'
 * or 'blocked'. Outside laptop mode never 'blocked', and nothing is counted.
 */
export function checkTeacherKey(key, address, now = Date.now()) {
  const sent = String(key ?? '').trim();
  if (!sent) return 'none';
  if (!laptopMode()) return keyMatches(sent) ? 'ok' : 'wrong';
  const who = addressOf(address);
  const state = keyFailures.get(who);
  if (state?.until && state.until > now) return 'blocked';
  if (keyMatches(sent)) {
    keyFailures.delete(who);
    return 'ok';
  }
  // A window passed, or a shut-out served: counted afresh.
  const fresh = !state || now - state.first > KEY_WINDOW_MS || (state.until > 0 && state.until <= now);
  const next = fresh ? { keys: new Set(), first: now, until: 0 } : { ...state, until: 0 };
  next.keys.add(sent.slice(0, 128));
  if (next.keys.size >= KEY_TRIES) next.until = now + KEY_WINDOW_MS;
  keyFailures.set(who, next);
  // Addresses that stopped trying drop out, so the map stays small.
  if (keyFailures.size > 1000) {
    for (const [k, s] of keyFailures) if (now - s.first > KEY_WINDOW_MS && !(s.until > now)) keyFailures.delete(k);
  }
  return next.until ? 'blocked' : 'wrong';
}

/** For the tests: forget every wrong key counted. */
export function forgetKeyFailures() {
  keyFailures.clear();
}

/** The key check for a request, by its address (the socket's, as no proxy is trusted). */
export function teacherKeyCheck(req) {
  return checkTeacherKey(teacherKeyFrom(req), req.ip ?? req.socket?.remoteAddress);
}

export function requireTeacher(req, _res, next) {
  if (isTeacher(req)) return next();
  next(
    Object.assign(
      new Error(
        'Teacher key required. Open the console using the URL printed in the server window.',
      ),
      { status: 401 },
    ),
  );
}
