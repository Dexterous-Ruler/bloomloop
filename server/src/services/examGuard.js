// Batch 9, decision E5 (and E7): exam integrity, an opt-in room setting.
//
// What this file decides, and nowhere else does:
//   the setting      examMode on a room: what the owner may set, how it is read
//                    back, what a phone is told to enforce and what staff see
//   Safe Exam Browser the Config Key hash check, pure, so it is unit-tested
//   rate             how many signals a phone may send, and how often a picture
//   screen pictures  what a snapshot may be, where it is kept (in memory only),
//                    who may see it, when it is due and when it goes
//   collusion        the staff-only pairs of matching wrong answers
//
// The honesty line is the same as services/integrity.js's, and it is the reason
// for every choice here: a web page cannot stop a screenshot, Google Lens or a
// photo taken with another phone, and it cannot truly lock a tab. Exam mode is a
// set of deterrents and of signals for a professor to look at, never proof, and
// every sentence a professor or a student reads says so.
//
// Screen pictures are personal data (DPDP; decision 8's "lawyer must confirm"
// list). So they are kept in this process's memory and nowhere else: never in a
// table, the room's archive, a CSV, a report or any export. Only the newest per
// student is held, it is shown only to the room's staff, and it is purged two
// hours after the room closes, at once when the room is deleted, and when the
// server restarts. Nothing is kept about a student the class roster marks under
// 18 (decision 8): no signal, no picture, no fullscreen or screen share asked of
// them. The copy guard and the faint watermark still apply to them: they record
// nothing and watch nobody.

import crypto from 'node:crypto';

import { sniffImage, withoutMetadata } from './media.js';
import { toOriginalResponse } from '../questionTypes.js';
import { LEVELS } from '../bloom.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

/* ------------------------------------------------------------ the setting -- */

/** How often a laptop that shares its screen sends a picture: never, every 30 s or every 60 s. */
export const SNAPSHOT_SECONDS = Object.freeze([0, 30, 60]);

/** How many Safe Exam Browser configurations one room may accept. */
export const MAX_SEB_KEYS = 5;

/**
 * A Safe Exam Browser Config Key, as SEB's configuration tool shows it: 64 hex
 * characters, itself a SHA-256 of the configuration's settings. The setting
 * calls them `configKeyHashes`; the server lower-cases them and never sends one
 * to a phone or to the room's open route, because anyone holding one could work
 * out the header SEB sends for any page.
 */
const SEB_KEY = /^[0-9a-f]{64}$/;

/** examMode as stored when the room has none: off, and nothing asked. */
const OFF = Object.freeze({
  on: false, fullscreen: false, screenShare: false, snapshotSeconds: 0, seb: Object.freeze({ required: false, configKeyHashes: Object.freeze([]) }),
});

/**
 * The owner's examMode off a request body, checked, or null when it was left out
 * (the room then has none, and nothing changes: off is the default). Rejected,
 * not clamped, like the room's other settings: a professor who asked for a
 * picture every 45 seconds has a number in mind this product does not offer.
 */
export function examModeFrom(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw fail('examMode must be an object: { on, fullscreen, screenShare, snapshotSeconds, seb }, or left out for none.', 400);
  }
  const bool = (key, value) => {
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') throw fail(`examMode.${key} must be true or false.`, 400);
    return value;
  };
  if (typeof raw.on !== 'boolean') throw fail('examMode.on must be true or false.', 400);
  const fullscreen = bool('fullscreen', raw.fullscreen);
  const screenShare = bool('screenShare', raw.screenShare);
  const snapshotSeconds = raw.snapshotSeconds === undefined || raw.snapshotSeconds === null ? 0 : raw.snapshotSeconds;
  if (!SNAPSHOT_SECONDS.includes(snapshotSeconds)) {
    throw fail(`examMode.snapshotSeconds must be one of ${SNAPSHOT_SECONDS.join(', ')}: no pictures, or one every 30 or 60 seconds.`, 400);
  }
  if (snapshotSeconds && !screenShare) {
    throw fail('Screen pictures need screen sharing: turn examMode.screenShare on, or set examMode.snapshotSeconds to 0.', 400);
  }
  const sebRaw = raw.seb ?? {};
  if (typeof sebRaw !== 'object' || Array.isArray(sebRaw)) throw fail('examMode.seb must be an object: { required, configKeyHashes }.', 400);
  const required = bool('seb.required', sebRaw.required);
  const keyList = (field, what) => {
    const listed = sebRaw[field] ?? [];
    if (!Array.isArray(listed)) throw fail(`examMode.seb.${field} must be a list.`, 400);
    const keys = [...new Set(listed.map((k) => (typeof k === 'string' ? k.trim().toLowerCase() : '')))];
    if (keys.some((k) => !SEB_KEY.test(k))) throw fail(`Each Safe Exam Browser ${what} must be the 64-character key it shows.`, 400);
    if (keys.length > MAX_SEB_KEYS) throw fail(`A room may accept at most ${MAX_SEB_KEYS} Safe Exam Browser ${what}s.`, 400);
    return keys;
  };
  const keys = keyList('configKeyHashes', 'Config Key');
  // Optional: the Browser Exam Key of the Safe Exam Browser build students use.
  // A join must then match one of these too (sebCheck).
  const browserKeys = keyList('browserExamKeys', 'Browser Exam Key');
  if (required && !keys.length) {
    throw fail('Requiring Safe Exam Browser needs at least one Config Key, from the configuration you will give students.', 400);
  }
  return {
    on: raw.on, fullscreen, screenShare, snapshotSeconds,
    seb: { required, configKeyHashes: keys, ...(browserKeys.length ? { browserExamKeys: browserKeys } : {}) },
  };
}

/**
 * Why this room cannot run this exam mode, or null. Fullscreen, screen sharing
 * and screen pictures need a class: only a class list can mark a student under
 * 18 (decision 8), and nothing that watches may be asked of one. A room opened
 * without a class has no such list, so every phone in it would be watched. The
 * copy guard, the watermark and the signals are not monitoring of that kind, and
 * stay open to any room (signals were recorded in a room without a class before
 * exam mode existed). Asked at the opening and on every change.
 */
export function examModeProblem(examMode, { classId = null } = {}) {
  if (!examMode?.on || classId) return null;
  if (examMode.fullscreen || examMode.screenShare || examMode.snapshotSeconds) {
    return 'Fullscreen, screen sharing and screen pictures need a class, so students its list marks under 18 can be left '
      + 'out. Open the room for a class, or turn those three off.';
  }
  return null;
}

/**
 * A room's examMode as the server enforces it, whatever the store held: a room
 * from before 0038, or with none, reads as off. A stored value is re-read
 * through the same rules, so a hand-edited row cannot switch on half a setting,
 * and a room without a class never runs what watches (examModeProblem), even if
 * its row says so.
 */
export function examModeOf(session) {
  const raw = session?.examMode;
  if (!raw || typeof raw !== 'object') return OFF;
  let m;
  try {
    m = examModeFrom(raw) ?? OFF;
  } catch {
    return OFF;
  }
  return examModeProblem(m, { classId: session?.classId ?? null })
    ? { ...m, fullscreen: false, screenShare: false, snapshotSeconds: 0 }
    : m;
}

/**
 * What staff screens show of the setting without the keys (the room list, the
 * live head): on, fullscreen, screen share, the picture interval and whether
 * Safe Exam Browser is required, with how many configurations it accepts.
 */
export function examSummary(session) {
  const m = examModeOf(session);
  return {
    on: m.on, fullscreen: m.fullscreen, screenShare: m.screenShare, snapshotSeconds: m.snapshotSeconds,
    seb: { required: m.seb.required, keys: m.seb.configKeyHashes.length, browserKeys: (m.seb.browserExamKeys ?? []).length },
  };
}

/**
 * The setting's help, for the screen where a professor turns it on. Every line is
 * honest about what a web page can and cannot do (decision E5's "Honesty").
 */
export const EXAM_HELP = Object.freeze({
  honesty: 'No website can stop screenshots, Google Lens or a photo taken with another phone, and no website can truly lock '
    + 'a tab. Exam mode is a set of deterrents, and of signals for you to look at. A signal is a prompt to look, never proof.',
  copyGuard: 'Always on in exam mode. Turns off copying, cutting, right-click, text selection and dragging on the question, '
    + 'blurs the question when the page loses focus, and shows the student\'s roll number and the room code faintly across '
    + 'it, so a photo of the screen says whose it was. The student\'s own answer box and whiteboard still work, so written '
    + 'and drawn answers can be given.',
  fullscreen: 'Laptops must be in fullscreen to answer, and answering pauses until it is back. Each exit is noted. A phone '
    + 'browser cannot be held in fullscreen. The student\'s own browser enforces this, so a browser someone has changed '
    + 'can skip it without leaving a signal.',
  screenShare: 'Laptops must share the whole screen to answer, and answering pauses if sharing stops; stopping is noted. '
    + 'Phones cannot share their screen, so turn this on only when every student sits the exam on a laptop. The server '
    + 'takes the laptop\'s word that the whole screen is shared, and what a picture shows: a browser someone has changed '
    + 'can claim a share it never started and send pictures of anything.',
  snapshots: 'While a laptop shares its screen, it sends a small picture of it every 30 or 60 seconds. Only the newest per '
    + 'student is kept, only this room\'s staff can see it, and it is deleted two hours after the room closes. It never '
    + 'goes into the archive, the CSV or any report. Screen pictures are personal data: check with your college before '
    + 'you use them.',
  seb: 'Asks for Safe Exam Browser, opened with one of the configurations you list; an ordinary browser is turned away '
    + 'with a sentence saying so. It is a strong deterrent, not a lock: anyone holding the configuration file you give '
    + 'students can work out the value it sends, and a value seen once can be sent again from another browser. Use a '
    + 'fresh configuration for each exam, and list its Browser Exam Key too for a harder check.',
  screenshots: 'A screenshot shortcut on a laptop (PrintScreen, the snipping shortcut or a Mac shortcut) is noted, and on a '
    + 'phone Google Lens or a screenshot tool makes the page lose focus, which is noted too. A phone\'s own screenshot '
    + 'buttons, any screenshot on an iPhone, a screen recording started outside the page and a photo from a second device '
    + 'cannot be seen at all: the faint roll number is the deterrent for those.',
  under18: 'Students the class list marks under 18 are not asked for fullscreen or screen sharing, send no pictures, and have '
    + 'no signals recorded or shown. The copy guard and the faint roll number still apply to them: they record nothing. '
    + 'A room opened without a class has no list to mark anyone, so it cannot ask for fullscreen, screen sharing or '
    + 'pictures.',
});

/**
 * What one phone is told to enforce, in session:accepted (and exam:mode when the
 * owner changes it): null for a room without exam mode, where the phone is told
 * nothing new. `minor`: the class roster marks this roll number under 18, so the
 * phone is asked for nothing that watches (decision 8) and says so.
 *
 * Never the Safe Exam Browser keys, and never a word about why a phone is asked
 * for less: the sentence says what this device is and is not asked for.
 */
export function phoneExamMode(session, { minor = false } = {}) {
  const m = examModeOf(session);
  if (!m.on) return null;
  const watched = !minor;
  const fullscreen = watched && m.fullscreen;
  const screenShare = watched && m.screenShare;
  const snapshotSeconds = screenShare ? m.snapshotSeconds : 0;
  return {
    on: true,
    // Always on with exam mode, for every student: they are deterrents and record nothing.
    copyGuard: true,
    watermark: true,
    fullscreen,
    screenShare,
    snapshotSeconds,
    snapshotMaxBytes: SNAPSHOT_MAX_BYTES,
    sebRequired: m.seb.required,
    // Whether anything about how this device uses the page is recorded.
    watched,
    notice: noticeFor({ watched, fullscreen, screenShare, snapshotSeconds }),
  };
}

/**
 * The room's exam rules for anyone holding its code, before joining (the open
 * room route), so the consent notice can be read before a phone joins. As for a
 * student who is watched; a phone learns at the join if it is asked for less.
 */
export function publicExamMode(session) {
  const phone = phoneExamMode(session);
  if (!phone) return null;
  const { watched: _w, ...rest } = phone;
  return rest;
}

/** The consent notice: what this room watches, in plain words, shown before the first question. */
function noticeFor({ watched, fullscreen, screenShare, snapshotSeconds }) {
  // "On the question": a long answer is edited and a drawing is drawn on the
  // same page (Batch 9, E3 and E4), and the guard must leave both working.
  const lines = ['This room is an exam. Copying, right-click and selecting text are turned off on the question (you can '
    + 'still write and draw your answer), and your roll number and the room code are shown faintly across the screen.'];
  if (!watched) {
    lines.push('This device is not asked for fullscreen or screen sharing, and nothing about how you use the page is recorded.');
    return lines.join(' ');
  }
  if (fullscreen) lines.push('On a laptop you answer in fullscreen; leaving it pauses answering and is noted for your professor.');
  if (screenShare) {
    lines.push('You answer on a laptop with your whole screen shared; if sharing stops, answering pauses and that is noted. '
      + 'If you do not share, you cannot answer here, and the only thing noted is that sharing was not started.');
  }
  if (snapshotSeconds) {
    lines.push(`While you share, a small picture of your screen is sent every ${snapshotSeconds} seconds. Only the newest is `
      + 'kept, only your professor and their department\'s staff can see it, and it is deleted two hours after the room closes.');
  }
  lines.push('Leaving the page, losing focus and trying to copy are noted too. Your professor sees these as signals to look '
    + 'at, not as proof of anything.');
  return lines.join(' ');
}

/** Said to a phone that tries to answer in a screen-share room without sharing. */
export const SCREEN_NEEDED = 'This room asks you to share your whole screen before you answer, so this answer was not taken. '
  + 'Share your screen and send it again. Nothing else is noted: only that sharing has not started.';

/** Said when what was shared is a window or a tab, not the whole screen. */
export const WHOLE_SCREEN = 'Share your whole screen, not a window or a tab, to answer in this room.';

/* --------------------------------------------------------- Safe Exam Browser -- */

/** The header SEB sends with each request (lower case, as Node hands headers over). */
export const SEB_HEADER = 'x-safeexambrowser-configkeyhash';
/** And the one it sends for its Browser Exam Key, worked out the same way. */
export const SEB_BEK_HEADER = 'x-safeexambrowser-requesthash';

/** Said to a phone turned away because it is not in Safe Exam Browser. */
export const SEB_REFUSED = 'This exam must be taken in Safe Exam Browser, opened with the settings your professor gave you. '
  + 'Open it from the link or file they shared, then join again.';

/**
 * The value SEB sends for one page with one configuration, from SEB's own
 * specification of the Config Key ("SEB Config Key", safeexambrowser.org
 * developer documentation):
 *
 *   hex( SHA-256( absolute URL of the request, without its #fragment
 *                 + the Config Key as 64 lower-case hex characters ) )
 *
 * SEB sends it in the X-SafeExamBrowser-ConfigKeyHash header of each request it
 * makes, and its JavaScript API offers the same value for the page's own URL as
 * SafeExamBrowser.security.configKey. The URL is part of the hash so a value
 * seen on one page is not the value for another.
 */
export function sebConfigKeyHash(url, configKey) {
  return crypto.createHash('sha256').update(`${withoutFragment(url)}${configKey}`, 'utf8').digest('hex');
}

const withoutFragment = (url) => String(url ?? '').split('#')[0];

/** Equal, in time that does not depend on where two hex strings first differ. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * The origin a configured public address names (PUBLIC_ORIGIN: "https://host"),
 * or null when it is unset or not an http(s) origin.
 */
export function originOf(raw) {
  try {
    const u = new URL(String(raw ?? '').trim());
    return /^https?:$/.test(u.protocol) ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The absolute URL of the socket's opening request, as SEB hashed it: a scheme
 * and host, and the path and query the server received. The scheme and host
 * come from, in order:
 *   publicOrigin   the server's own public address, when it is configured,
 *                  never from anything the request says
 *   trustProxy     the proxy's forwarded headers (the first value of each), only
 *                  when the server is told a proxy it trusts sets them: any
 *                  client can send those headers itself
 *   else           the connection and its Host header
 */
export function handshakeUrl(handshake = {}, { publicOrigin = null, trustProxy = false } = {}) {
  const h = handshake.headers ?? {};
  const path = handshake.url ?? '/';
  const pinned = originOf(publicOrigin);
  if (pinned) return `${pinned}${path}`;
  const first = (v) => String(Array.isArray(v) ? v[0] : v ?? '').split(',')[0].trim();
  const proto = (trustProxy && first(h['x-forwarded-proto'])) || (handshake.secure ? 'https' : 'http');
  const host = (trustProxy && first(h['x-forwarded-host'])) || first(h.host);
  if (!host) return null;
  return `${proto}://${host}${path}`;
}

/**
 * Is this the room's own join page: /join, or /join/<this room's code>, on the
 * server's own origin, with no other room's code in its query? The page SEB's
 * JavaScript API hashes must be this one, so a value worked out for any page a
 * client likes is not taken, and a value seen on one room's join link does not
 * open another room.
 */
export function joinPageOk(pageUrl, { origin, code = '' } = {}) {
  let page;
  try {
    page = new URL(String(pageUrl ?? ''));
  } catch {
    return false;
  }
  if (!/^https?:$/.test(page.protocol) || !origin || page.origin !== origin) return false;
  const want = String(code ?? '').trim().toUpperCase();
  const m = /^\/join(?:\/([^/]+))?\/?$/i.exec(page.pathname);
  if (!m) return false;
  let named = m[1] ?? null;
  try {
    named = named === null ? null : decodeURIComponent(named);
  } catch {
    return false;
  }
  if (named !== null && named.trim().toUpperCase() !== want) return false;
  const asked = page.searchParams.get('code');
  return asked === null || asked.trim().toUpperCase() === want;
}

/**
 * Does this join come from Safe Exam Browser with one of the room's
 * configurations? Pure: the evidence is handed in.
 *
 *   header  the X-SafeExamBrowser-ConfigKeyHash header of the socket's opening
 *           request, checked against that request's own URL (handshakeUrl), and,
 *           when the room lists Browser Exam Keys, X-SafeExamBrowser-RequestHash
 *           against the same URL
 *   api     { url, configKeyHash, browserExamKeyHash? } a join may carry, read
 *           from SEB's JavaScript API on the page (its location without the
 *           fragment, SafeExamBrowser.security.configKey and browserExamKey).
 *           The URL must be this room's join page on the server's own origin
 *           (joinPageOk, against the origin of the request URL), and on the
 *           origin the opening request named, when it named one.
 *
 * Either way, matching one key of each list the room has is enough. A room that
 * does not require SEB is always ok. What this cannot do, said plainly in the
 * setting's help: SEB's values are worked out from the URL and a key alone, so
 * anyone holding the configuration file can work one out, and a value seen once
 * can be sent again for the same page from another browser. SEB's own design
 * has the same limit; a fresh configuration per exam, and a Browser Exam Key,
 * narrow it.
 *
 * @returns {{ ok: boolean, via: 'off'|'header'|'api'|null }}
 */
export function sebCheck(examMode, {
  headerHash = null, bekHeaderHash = null, requestUrl = null, origin = null, api = null, code = '',
} = {}) {
  const m = examMode ?? OFF;
  if (!m.on || !m.seb?.required) return { ok: true, via: 'off' };
  const keys = m.seb.configKeyHashes ?? [];
  const browserKeys = m.seb.browserExamKeys ?? [];
  const matches = (list, url, hash) => {
    const sent = typeof hash === 'string' ? hash.trim().toLowerCase() : '';
    if (!/^[0-9a-f]{64}$/.test(sent) || !url) return false;
    return list.some((key) => sameHex(sebConfigKeyHash(url, key), sent));
  };
  const both = (url, configHash, bekHash) => matches(keys, url, configHash)
    && (!browserKeys.length || matches(browserKeys, url, bekHash));
  if (requestUrl && both(requestUrl, headerHash, bekHeaderHash)) return { ok: true, via: 'header' };
  if (api && typeof api === 'object' && typeof api.url === 'string' && api.url.length <= 2048) {
    let pageOrigin = null;
    try {
      pageOrigin = requestUrl ? new URL(requestUrl).origin : null;
    } catch {
      pageOrigin = null;
    }
    const page = withoutFragment(api.url);
    const named = !origin || String(origin) === pageOrigin;
    if (named && joinPageOk(page, { origin: pageOrigin, code }) && both(page, api.configKeyHash, api.browserExamKeyHash)) {
      return { ok: true, via: 'api' };
    }
  }
  return { ok: false, via: null };
}

/* ------------------------------------------------------------------- rate -- */

/**
 * What one student may send as signals in an exam room: 30 in any minute in all,
 * and one of each kind a second. Past that a signal is dropped without a word, as
 * every signal is answered. A burst that reads like a pattern is the failure:
 * a stuck key or a looping script should not become sixty events on a
 * professor's screen.
 */
export const SIGNAL_LIMIT = Object.freeze({ perMinute: 30, sameKindMs: 1000 });

/**
 * May one more signal of this kind go through now? `state` is the student's own
 * ({} to start), changed in place. Pure apart from that: the clock is handed in.
 *
 * The minute slides: it is the 60 seconds before `now`, whenever `now` is. A
 * fixed minute let 30 signals in at its end and 30 more at the start of the
 * next, sixty inside a second.
 */
export function allowSignal(state, kind, now, limit = SIGNAL_LIMIT) {
  state.times = (state.times ?? []).filter((t) => now - t < 60000);
  state.last = state.last ?? {};
  if (state.times.length >= limit.perMinute) return false;
  if (state.last[kind] !== undefined && now - state.last[kind] < limit.sameKindMs) return false;
  state.times.push(now);
  state.last[kind] = now;
  state.seen = now;
  return true;
}

/* -------------------------------------------------------- screen pictures -- */

/** The most a picture may be, as sent: about 80 KB. A low-resolution JPEG of a screen is well under. */
export const SNAPSHOT_MAX_BYTES = 80 * 1024;

/**
 * How early a picture may come: the interval less 2 seconds, because a laptop's
 * timer drifts and one that arrived at 29.9 seconds and was turned away would
 * leave a 60-second gap. The cap is still one per interval.
 */
export const SNAPSHOT_SLACK_MS = 2000;

/** How long a closed room's pictures are kept: two hours (decision E5). */
export const SNAPSHOT_KEEP_MS = 2 * 60 * 60 * 1000;

/**
 * How late pictures may run before snapshot_missing: two whole intervals and 10
 * seconds more, counted from the newest of the last picture, the moment sharing
 * started and the moment the room was last seen open. One late picture is a slow
 * connection; two in a row is worth a note, and the note says a dropped
 * connection or a sleeping laptop does the same.
 */
export const SNAPSHOT_GRACE_MS = 10000;

/**
 * The most all pictures together may hold in memory, and the most one room's
 * may: about 300 students' newest at SNAPSHOT_MAX_BYTES. Past either, a new
 * picture is not kept (one replacing the student's own older one still is, when
 * it is no bigger), and nothing kept is pushed out: one room's pictures never
 * make room by dropping another's. A picture not kept still counts as arrived
 * (lastAt), so nobody is noted for a picture their laptop did send.
 */
export const SNAPSHOT_STORE_BYTES = 64 * 1024 * 1024;
export const SNAPSHOT_ROOM_BYTES = 24 * 1024 * 1024;

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Is this a whole JPEG: a start, a frame header, a scan and an end, with nothing
 * after the end? Walked segment by segment without decoding, as media.js walks
 * one. A file that only starts like a JPEG is not a picture.
 */
export function wholeJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return false;
  let i = 2;
  let frame = false;
  let scan = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return false;
    let m = i + 1;
    while (m < buf.length && buf[m] === 0xff) m += 1;
    if (m >= buf.length) return false;
    const marker = buf[m];
    if (marker === 0xd9) return frame && scan && m + 1 === buf.length;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i = m + 1; continue; }
    if (marker === 0x00 || marker === 0xd8 || m + 3 > buf.length) return false;
    const end = m + 1 + buf.readUInt16BE(m + 1);
    if (end < m + 3 || end > buf.length) return false;
    if (SOF.has(marker)) frame = true;
    if (marker === 0xda) {
      scan = true;
      let j = end;
      while (j < buf.length) {
        if (buf[j] === 0xff && j + 1 < buf.length) {
          const next = buf[j + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) { j += 2; continue; }
          if (next === 0xff) { j += 1; continue; }
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    i = end;
  }
  return false;
}

/** Bytes off a socket: a Buffer, any byte array, or base64 (a data URL's too). */
function bytesOf(raw) {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof raw === 'string') {
    // Measured before decoding: a long string is refused without the work.
    if (raw.length > Math.ceil((SNAPSHOT_MAX_BYTES * 4) / 3) + 64) return 'size';
    const body = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
    if (!/^[A-Za-z0-9+/=\s]*$/.test(body)) return null;
    return Buffer.from(body, 'base64');
  }
  return null;
}

/**
 * A picture a phone sent, checked: at most SNAPSHOT_MAX_BYTES, a JPEG by its own
 * bytes (never by what the phone called it), a whole one, with every piece of
 * metadata taken out (media.js withoutMetadata: Exif, XMP, comments and anything
 * after the end). The reason is a word for the phone's acknowledgement.
 *
 * @returns {{ ok: true, jpeg: Buffer } | { ok: false, reason: 'size'|'type'|'shape' }}
 */
export function snapshotFrom(raw) {
  const buf = bytesOf(raw);
  if (buf === 'size') return { ok: false, reason: 'size' };
  if (!buf || !buf.length) return { ok: false, reason: 'shape' };
  if (buf.length > SNAPSHOT_MAX_BYTES) return { ok: false, reason: 'size' };
  if (sniffImage(buf) !== 'image/jpeg') return { ok: false, reason: 'type' };
  const jpeg = withoutMetadata(Buffer.from(buf), 'image/jpeg');
  if (!wholeJpeg(jpeg)) return { ok: false, reason: 'shape' };
  return { ok: true, jpeg };
}

/**
 * Has a closed room kept its pictures long enough? `room` is the room as stored
 * now, or null when it is gone (deleted), which purges at once.
 */
export function snapshotExpired(room, now) {
  if (!room) return true;
  if (room.status !== 'closed') return false;
  const closed = Date.parse(room.closedAt ?? '');
  return !Number.isFinite(closed) || now - closed >= SNAPSHOT_KEEP_MS;
}

/**
 * Were pictures due and did none arrive? `since` is the newest of the last
 * picture, the start of sharing and the room last seen open (ms).
 */
export function snapshotOverdue({ everySeconds, since, now }) {
  if (!everySeconds || !Number.isFinite(since)) return false;
  return now - since > 2 * everySeconds * 1000 + SNAPSHOT_GRACE_MS;
}

/**
 * The pictures, in memory: the newest per student per room, with the room, the
 * roll number and when it arrived. Nothing else holds them. Apart from the
 * pictures, when each student's last picture arrived (`lastAt`), whether or not
 * it was kept: what the overdue rule reads, so a picture the store had no room
 * for never reads as one the laptop failed to send.
 */
export function createSnapshotStore({ capBytes = SNAPSHOT_STORE_BYTES, roomCapBytes = SNAPSHOT_ROOM_BYTES } = {}) {
  const shots = new Map(); // `${sessionId}|${rollNo}` -> { sessionId, rollNo, jpeg, at }
  const arrived = new Map(); // `${sessionId}|${rollNo}` -> { sessionId, at }
  const roomBytes = new Map(); // sessionId -> bytes held
  let bytes = 0;
  const keyOf = (sessionId, rollNo) => `${String(sessionId)}|${String(rollNo)}`;
  const addRoom = (id, n) => {
    const left = (roomBytes.get(id) ?? 0) + n;
    if (left > 0) roomBytes.set(id, left); else roomBytes.delete(id);
  };
  const drop = (k) => {
    const had = shots.get(k);
    if (had) { bytes -= had.jpeg.length; addRoom(had.sessionId, -had.jpeg.length); shots.delete(k); }
    return Boolean(had);
  };

  return {
    /** May this student's next picture be taken now (one per interval, less the slack)? */
    accepts(sessionId, rollNo, everySeconds, now) {
      const last = arrived.get(keyOf(sessionId, rollNo))?.at;
      return last === undefined || now - last >= everySeconds * 1000 - SNAPSHOT_SLACK_MS;
    },
    /**
     * A picture arrived: noted as arrived, and kept as the student's newest (the
     * one before it goes) when the caps allow. Never pushes another picture out.
     * @returns {boolean} whether it was kept
     */
    put(sessionId, rollNo, jpeg, now) {
      const id = String(sessionId);
      const k = keyOf(id, rollNo);
      arrived.set(k, { sessionId: id, at: now });
      const before = shots.get(k)?.jpeg.length ?? 0;
      const grow = jpeg.length - before;
      if (grow > 0 && (bytes + grow > capBytes || (roomBytes.get(id) ?? 0) + grow > roomCapBytes)) return false;
      drop(k);
      shots.set(k, { sessionId: id, rollNo: String(rollNo), jpeg, at: now });
      bytes += jpeg.length;
      addRoom(id, jpeg.length);
      return true;
    },
    latest(sessionId, rollNo) {
      return shots.get(keyOf(sessionId, rollNo)) ?? null;
    },
    /** When this student's last picture arrived (ms), kept or not; null for none. */
    lastAt(sessionId, rollNo) {
      return arrived.get(keyOf(sessionId, rollNo))?.at ?? null;
    },
    /** When each student's newest picture arrived, without the pictures. */
    room(sessionId) {
      return [...shots.values()].filter((s) => s.sessionId === String(sessionId)).map((s) => ({ rollNo: s.rollNo, at: s.at }));
    },
    forget(sessionId, rollNo) {
      arrived.delete(keyOf(sessionId, rollNo));
      return drop(keyOf(sessionId, rollNo));
    },
    /** Every picture of a room: at its delete, and by the sweep. */
    purgeRoom(sessionId) {
      let n = 0;
      for (const [k, s] of [...arrived.entries()]) if (s.sessionId === String(sessionId)) arrived.delete(k);
      for (const [k, s] of [...shots.entries()]) if (s.sessionId === String(sessionId) && drop(k)) n += 1;
      return n;
    },
    /**
     * Purge the pictures of every room closed two hours ago or more, or gone;
     * and, whatever its room's state, every picture that arrived two hours ago
     * or more. Rooms never close by themselves, so a room left open, waiting or
     * paused would otherwise hold each student's last picture until the server
     * restarted; a laptop still sharing replaces its picture every minute, so
     * only a picture nobody is sending any more is old. `roomOf(sessionId)`
     * reads the room as stored now (null when deleted); a read that fails keeps
     * the room's pictures for the next sweep rather than guess (the age rule
     * still applies).
     */
    async sweep(now, roomOf) {
      let n = 0;
      for (const [k, s] of [...shots.entries()]) if (now - s.at >= SNAPSHOT_KEEP_MS && drop(k)) n += 1;
      for (const [k, s] of [...arrived.entries()]) if (now - s.at >= SNAPSHOT_KEEP_MS) arrived.delete(k);
      for (const id of new Set([...shots.values()].map((s) => s.sessionId))) {
        let room;
        try {
          room = await roomOf(id);
        } catch {
          continue;
        }
        if (snapshotExpired(room, now)) n += this.purgeRoom(id);
      }
      return n;
    },
    get size() { return shots.size; },
    get bytes() { return bytes; },
  };
}

/** The one store the live loop writes and the staff route reads. */
export const snapshots = createSnapshotStore();

/* -------------------------------------------------------------- collusion -- */

/**
 * The collusion check's rule, written down because it names pairs of students.
 *
 *   minMatches    a pair is listed when, on at least 3 questions, both gave the
 *                 SAME WRONG answer
 *   closeSeconds  and, for each of those 3, their answers arrived within 60
 *                 seconds of each other
 *   commonShare / commonFloor
 *                 a wrong answer that half or more of the students who got the
 *                 question wrong gave, when at least 5 did, is a common
 *                 misconception, not a shared source, and is not counted
 *
 * Final, graded answers of the room only: never a poll, a vote on a question put
 * to the class (everyone answers those together), an answer kept and not
 * counted, or a right answer (agreeing on the right answer is what teaching is
 * for). Answers are compared as the question's own options (toOriginalResponse,
 * so two students shown the options in different orders are compared fairly), or
 * as the typed text, trimmed, in lower case, with spaces run together. An
 * arrangement (order, rank) has no shared order to compare, and is left out.
 */
export const COLLUSION = Object.freeze({ minMatches: 3, closeSeconds: 60, commonShare: 0.5, commonFloor: 5 });

export const COLLUSION_NOTE = 'Signals worth a look, not proof. Students who sit together, revise together or share a '
  + 'misunderstanding can give the same wrong answers at the same time. Talk to them before you conclude anything.';

export const COLLUSION_RULE = 'Listed when two students gave the same wrong answer to at least 3 of the same questions, each '
  + 'pair of answers within 60 seconds of each other. A wrong answer that half or more of the students who got that '
  + 'question wrong also gave (when at least 5 did) is a common misunderstanding and is not counted. Students the class '
  + 'list marks under 18 are left out.';

const byRoll = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** One wrong answer as something two students can share, or null. */
function sharedFormOf(answer) {
  const snap = { ...(answer.questionSnapshot ?? {}), kind: answer.kind ?? answer.questionSnapshot?.kind ?? 'mcq' };
  const qid = String(snap.id || answer.questionId || '');
  const keep = Array.isArray(snap.shownOptions) ? snap.shownOptions : null;
  let orig = null;
  try {
    orig = toOriginalResponse(snap, answer.response, `${answer.rollNo}:${qid}`, keep);
  } catch {
    orig = null;
  }
  if (orig !== null && orig !== undefined) return `o:${JSON.stringify(orig)}`;
  const r = answer.response;
  if (typeof r === 'string' || typeof r === 'number') {
    const text = String(r).trim().toLowerCase().replace(/\s+/g, ' ');
    return text ? `t:${text}` : null;
  }
  return null;
}

/**
 * When an answer was given, for the close-timing test: the earlier of when the
 * server received it and when the phone says it was answered (Phase 7). An
 * outbox flushes its answers together when the network returns, so arrival
 * alone made two students who answered twenty minutes apart look simultaneous.
 * The phone's time can only move an answer earlier than its arrival, never
 * later, and a phone that lies about it can only hide a pair, never make one
 * of two others: it is the one compared, and it is a signal, not proof.
 */
function givenAt(answer) {
  const arrived = Date.parse(answer.answeredAt ?? '');
  const device = Date.parse(answer.deviceAnsweredAt ?? '');
  if (!Number.isFinite(device)) return arrived;
  return Number.isFinite(arrived) ? Math.min(arrived, device) : device;
}

/**
 * Pairs of students whose wrong answers match, by COLLUSION's rule, in roll
 * order (the first roll number of each pair, then the second), never ranked.
 * `answers` are the room's rows, oldest first; `exclude` the roll numbers left
 * out (under 18); `names` roll number -> name to show.
 */
export function collusionPairs({ answers = [], exclude = new Set(), names = new Map(), rule = COLLUSION } = {}) {
  // The answer in force per student per question: the latest final row.
  const final = new Map();
  for (const a of answers) {
    if (!a || a.final === false || a.ungraded || a.classQuestionId || !LEVELS.includes(a.bloom)) continue;
    const roll = String(a.rollNo ?? '');
    const qid = String(a.questionId ?? '').toLowerCase();
    if (!roll || !qid || exclude.has(roll)) continue;
    final.set(`${roll}|${qid}`, a);
  }
  // Per question: every wrong answer, grouped by what was given.
  const byQuestion = new Map();
  for (const a of final.values()) {
    if (a.correct !== false) continue;
    const form = sharedFormOf(a);
    if (!form) continue;
    const qid = String(a.questionId).toLowerCase();
    const q = byQuestion.get(qid) ?? { wrong: 0, forms: new Map(), topic: a.topic ?? '', bloom: a.bloom };
    q.wrong += 1;
    const group = q.forms.get(form) ?? [];
    group.push({ rollNo: String(a.rollNo), at: givenAt(a) });
    q.forms.set(form, group);
    byQuestion.set(qid, q);
  }
  const pairs = new Map(); // `${a}|${b}` -> { matches: [], sameWrong }
  for (const [qid, q] of byQuestion) {
    for (const group of q.forms.values()) {
      if (group.length < 2) continue;
      if (q.wrong >= rule.commonFloor && group.length / q.wrong >= rule.commonShare) continue;
      const sorted = [...group].sort((x, y) => byRoll(x.rollNo, y.rollNo));
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const [x, y] = [sorted[i], sorted[j]];
          const k = `${x.rollNo}|${y.rollNo}`;
          const pair = pairs.get(k) ?? { a: x.rollNo, b: y.rollNo, matches: [], sameWrong: 0 };
          pair.sameWrong += 1;
          const gap = Math.abs(x.at - y.at);
          if (Number.isFinite(gap) && gap <= rule.closeSeconds * 1000) {
            pair.matches.push({ questionId: qid, topic: q.topic, bloom: q.bloom, gapSeconds: Math.round(gap / 1000) });
          }
          pairs.set(k, pair);
        }
      }
    }
  }
  return [...pairs.values()]
    .filter((p) => p.matches.length >= rule.minMatches)
    .sort((p, q) => byRoll(p.a, q.a) || byRoll(p.b, q.b))
    .map((p) => ({
      students: [p.a, p.b].map((rollNo) => ({ rollNo, name: names.get(rollNo) ?? '' })),
      matches: p.matches.length,
      // Same wrong answers at any time apart, the close ones included.
      sameWrong: p.sameWrong,
      questions: p.matches,
    }));
}

/* ---------------------------------------------------------- staff privacy -- */

export const EXAM_PRIVACY = 'Staff only: never shown on a phone or the projector, and screen pictures never go into the '
  + 'archive, the CSV or any report.';
