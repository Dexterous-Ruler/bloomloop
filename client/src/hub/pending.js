/**
 * The hub's answers, kept on this device until the server has them.
 *
 * Every answer carries an id made on the device (attemptId). It is saved here
 * before it is sent, and dropped only once the server replies 201 (stored) or
 * 200 (a resend of the same id: the stored result). After a network failure or
 * a 5xx it stays and is resent later with the same id and the same body, so it
 * is never stored twice. A 409 is "closed for now" (the question is being asked
 * in class, is on an open self-test, or is the one a Get Ready check is
 * asking; each of those sentences says it "stays closed"): the server stored
 * nothing, so it stays too and is tried again later. Any other refusal is
 * final (a 400, a 404, or a 409 such as an id used for another answer, which
 * would never succeed): dropped, and its sentence shown.
 *
 * localStorage, not IndexedDB: a handful of small items, read synchronously
 * by the screen that shows "N answers waiting to send".
 */

import { useSyncExternalStore } from 'react';

import { http } from '../lib/api.js';

const KEY = 'bloomloop.hubPending';
const listeners = new Set();
let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    cache = Array.isArray(raw) ? raw : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items) {
  cache = items;
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* private mode: kept in memory */ }
  listeners.forEach((fn) => fn());
}

const idOf = (path, body) => `${path}#${body?.attemptId ?? ''}`;

function keep(item) {
  const items = read().filter((i) => i.key !== item.key);
  write([...items, item]);
}

function drop(key) {
  if (read().some((i) => i.key === key)) write(read().filter((i) => i.key !== key));
}

function note(key, sentence) {
  write(read().map((i) => (i.key === key ? { ...i, sentence, tries: (i.tries ?? 0) + 1 } : i)));
}

/** The 409 that means "closed for now"; every other 409 is final. */
const closedNow = (e) => e?.status === 409 && /stays closed/i.test(e.message || '');
/** Kept for later: no reply (offline), a 5xx, or closed for now. */
const keepsAfter = (e) => !e?.status || e.status >= 500 || closedNow(e);

/**
 * POSTs `body` to `path` (after /api), keeping it on the device until the
 * server has it. Resolves with the reply. Rejects with the server's Error, plus
 * `kept: true` when the answer stays on the device to be sent later
 * (`closed: true` for a 409, `offline: true` when nothing came back).
 */
export async function sendKept(path, body) {
  const key = idOf(path, body);
  keep({ key, path, body, at: Date.now() });
  try {
    const reply = await http.post(path, body);
    drop(key);
    return reply;
  } catch (e) {
    if (keepsAfter(e)) {
      note(key, e.message);
      throw Object.assign(e, { kept: true, closed: closedNow(e), offline: !e.status });
    }
    drop(key);
    throw e;
  }
}

/**
 * Tries every kept answer again, oldest first, one at a time. Stops at the
 * first that gets no reply (still offline). Resolves with { sent, left }.
 */
let flushing = null;
export function flushPending() {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (const item of [...read()]) {
      try {
        await http.post(item.path, item.body);
        drop(item.key);
        sent += 1;
      } catch (e) {
        if (!keepsAfter(e)) { drop(item.key); continue; }
        note(item.key, e.message);
        if (!e.status) break;
      }
    }
    return { sent, left: read().length };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** The answers waiting on this device: [{ key, path, body, at, sentence?, tries? }]. */
export function pendingList() {
  return read();
}

/** Forgets one kept answer, when the student chooses to. */
export function discardPending(key) {
  drop(key);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The kept answers, kept up to date. */
export function usePending() {
  return useSyncExternalStore(subscribe, read, read);
}

// Back online: try again.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (read().length) flushPending(); });
}
