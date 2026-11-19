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
 * Batch 8: practice and lesson answers carry the question's serveToken in the
 * body, so a kept answer keeps its token. A 409 saying the answer was "not sent
 * with the question" or was given "too long ago" (the token is missing or has
 * run out) is kept as well, marked `reopen`, with the sentence: it is never
 * resent as it is (it would be refused again), and the student is offered the
 * question again. A newer answer to the same question replaces it.
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

function note(key, sentence, reopen = false) {
  write(read().map((i) => (i.key === key ? { ...i, sentence, tries: (i.tries ?? 0) + 1, ...(reopen ? { reopen: true } : {}) } : i)));
}

/** The 409 that means "closed for now"; every other 409 is final. */
const closedNow = (e) => e?.status === 409 && /stays closed/i.test(e.message || '');
/** Batch 8: the 409 for an answer without its question's serve token, or with one run out. */
const needsReopen = (e) => e?.status === 409 && /not sent with the question|too long ago/i.test(e.message || '');
/** Kept: no reply (offline), a 5xx, closed for now, or waiting for its question to be opened again. */
const keepsAfter = (e) => !e?.status || e.status >= 500 || closedNow(e) || needsReopen(e);

/** The same question on the same route: a kept answer refused for its token is replaced by a newer one. */
const sameQuestion = (i, path, body) => i.path === path && String(i.body?.questionId ?? '') === String(body?.questionId ?? '');

/**
 * POSTs `body` to `path` (after /api), keeping it on the device until the
 * server has it. Resolves with the reply. Rejects with the server's Error, plus
 * `kept: true` when the answer stays on the device (`closed: true` for a 409
 * closed for now, `offline: true` when nothing came back, `reopen: true` when
 * it waits for its question to be opened again). `to` is the screen that opens
 * the question again, kept with the answer.
 */
export async function sendKept(path, body, { to = null } = {}) {
  const key = idOf(path, body);
  const stale = read().filter((i) => i.reopen && i.key !== key && sameQuestion(i, path, body));
  if (stale.length) write(read().filter((i) => !stale.includes(i)));
  keep({ key, path, body, at: Date.now(), ...(to ? { to } : {}) });
  try {
    const reply = await http.post(path, body);
    drop(key);
    return reply;
  } catch (e) {
    if (keepsAfter(e)) {
      note(key, e.message, needsReopen(e));
      throw Object.assign(e, { kept: true, closed: closedNow(e), offline: !e.status, reopen: needsReopen(e) });
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
      // Refused for its serve token: resending it as it is would be refused again.
      if (item.reopen) continue;
      try {
        await http.post(item.path, item.body);
        drop(item.key);
        sent += 1;
      } catch (e) {
        if (!keepsAfter(e)) { drop(item.key); continue; }
        note(item.key, e.message, needsReopen(e));
        if (!e.status) break;
      }
    }
    return { sent, left: read().length };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** The answers waiting on this device: [{ key, path, body, at, to?, sentence?, tries?, reopen? }]. */
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
