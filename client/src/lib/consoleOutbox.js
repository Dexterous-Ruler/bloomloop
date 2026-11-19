/**
 * The console's outbox (Phase 7, gap F1): every teacher record and attendance
 * mark, kept on this laptop before it is sent, until the server has it. The
 * phone has its own (lib/outbox.js).
 *
 * One item is one write. It gets a fresh key when it is queued, sent as the
 * Idempotency-Key header on every try. Its path and body are filled in just
 * before its first send and then never change: the server checks the body
 * against the key, so a retry has to be the same request.
 *
 * basedOn, the server's stale check, is filled in at that first send from the
 * stamp this console last had for the record: the one shown when the change
 * was made, or the one in the reply to the item before it on the same record,
 * so two offline taps on one student chain instead of refusing each other.
 * null means "there was none". A record this console never read goes without
 * one, which is the old last-write-wins.
 *
 * Items go one at a time, oldest first. The reply settles an item:
 *   2xx, a replay too     done, and it leaves the outbox
 *   409 with stale: true  something newer is there: kept and shown with the
 *                         record as it stands, to send again (a new item, a new
 *                         key, never the old one) or discard
 *   other 4xx             refused for good: kept and shown until discarded
 *   no reply, 5xx, 408    not now: the same item, key and body go again later
 *   401, 429              not now, and not by itself: on "Try now", a new
 *                         record or reconnecting (a lock-out is never retried)
 * A refusal is also handed to the screen that made it, if it is still waiting,
 * to show beside the control as before. A screen waits at most a few seconds:
 * after that the record is "saved on this device" and its outcome comes later
 * (onSettle).
 *
 * IndexedDB, per account, so a professor never sees or sends another's records
 * on a shared laptop. Where IndexedDB is unavailable the items live as long as
 * the tab, and the sync dialog says so.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { keyedWrite } from './api.js';

const DB = 'bloomloop-console-outbox';
const ITEMS = 'items';
const META = 'meta';
const SEND_TIMEOUT_MS = 12_000;
// How long a screen waits for its own write before it is told "kept".
const PATIENCE_MS = 4_000;
const BACKOFF_S = [2, 5, 10, 20, 30];
const MAX_STAMPS = 1_000;

/* ------------------------------------------------------------- the disk */

let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(ITEMS, { keyPath: 'id' });
          req.result.createObjectStore(META);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return opening;
}

/** One transaction; the request's result, or null on any failure. */
async function tx(store, mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req?.result ?? true);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function save(item) {
  const ok = await tx(ITEMS, 'readwrite', (s) => s.put(item));
  if (!ok && state.disk) { state.disk = false; emit(); }
}

/* ------------------------------------------------------------ the state */

const state = {
  owner: 'key',
  items: [],            // every kept item, every owner
  stamps: new Map(),    // record key -> the last stamp this console had for it
  reach: 'unknown',     // ok | offline | held | unknown
  reason: '',           // the sentence of the last "not now" (a 401's, a 5xx's)
  failures: 0,
  lastSyncAt: null,
  disk: true,
  draining: false,
  sendingId: null,
};

const waiters = new Map();   // id -> resolve, while the screen that made it waits
const settlers = new Map();  // id -> onSettle, for an outcome that comes later
const changeFns = new Set();
const noticeFns = new Set();
const drainedFns = new Set();
let snap = null;
let retryTimer = null;
let stampTimer = null;

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const mine = () => state.items.filter((i) => i.owner === state.owner);
const bySeq = (a, b) => a.seq - b.seq;
const waitingItem = (i) => i.status === 'queued' || i.status === 'sending';
const upper = (code) => String(code ?? '').trim().toUpperCase();

function emit() {
  snap = null;
  changeFns.forEach((fn) => fn());
}

function notice(text) {
  noticeFns.forEach((fn) => fn(text));
}

function snapshot() {
  if (snap) return snap;
  const items = mine().sort(bySeq).map((i) => ({
    id: i.id,
    kind: i.kind,
    label: i.label,
    code: i.intent?.code ?? '',
    queuedAt: i.queuedAt,
    status: i.status === 'refused' ? 'refused' : i.id === state.sendingId ? 'sending' : 'queued',
    refusal: i.refusal ?? null,
    deferred: Boolean(i.deferred),
    intent: i.intent,
  }));
  const later = items.filter((i) => i.status !== 'refused' && i.deferred);
  const offline = !online() || state.reach === 'offline';
  snap = {
    items,
    waiting: later.length,
    refused: items.filter((i) => i.status === 'refused').length,
    mode: later.length === 0 ? 'synced' : state.draining && !offline ? 'syncing' : offline ? 'offline' : 'waiting',
    offline,
    reason: state.reach === 'held' ? state.reason : '',
    lastSyncAt: state.lastSyncAt,
    disk: state.disk,
  };
  return snap;
}

/* ----------------------------------------------------------- the stamps */

function saveStampsSoon() {
  clearTimeout(stampTimer);
  stampTimer = setTimeout(() => {
    tx(META, 'readwrite', (s) => s.put({ stamps: [...state.stamps], lastSyncAt: state.lastSyncAt }, 'state'));
  }, 300);
}

function setStamp(key, stamp) {
  state.stamps.delete(key);
  if (stamp === undefined) { saveStampsSoon(); return; }
  state.stamps.set(key, stamp);
  while (state.stamps.size > MAX_STAMPS) state.stamps.delete(state.stamps.keys().next().value);
  saveStampsSoon();
}

/** Is a write to this record still on its way? Then its reply carries the chain. */
function unsettledOn(key) {
  return mine().some((i) => waitingItem(i) && KINDS[i.kind].keys(i.intent).includes(key));
}

/** A read's stamps, unless a write of ours to that record is on its way. */
function seen(pairs) {
  for (const [key, stamp] of pairs) if (!unsettledOn(key)) setStamp(key, stamp);
}

const based = (key) => (state.stamps.has(key) ? { basedOn: state.stamps.get(key) } : {});

/* ------------------------------------------------------------ the kinds */

const enc = encodeURIComponent;
const room = (code) => `/session/${enc(code)}`;

const obsKey = (i) => (i.studentId ? `obs:s:${i.studentId}` : `obs:${i.code}:r:${i.rollNo}`);
const attKey = (code, studentId) => `att:${code}:${studentId}`;
const pickKey = (i) => `pick:${i.code}:${i.pickId}`;
const tallyKey = (i) => `tally:${i.code}:${i.tallyId}`;
const actKey = (i) => `act:${i.code}:${i.activityId}`;
const flagKey = (i) => `flag:${i.code}:${i.flagId}`;

/** basedOn of a pick, a tally and an activity: the fields as the screen shows them. */
export const shownOf = {
  pick: (p) => p && { ask: p.ask ?? null, questionId: p.questionId ?? null, status: p.status ?? null },
  tally: (t) => t && {
    text: t.text ?? '',
    labels: (t.options ?? []).map((o) => o.label ?? ''),
    counts: (t.options ?? []).map((o) => o.count ?? 0),
    revealed: t.revealed === true,
    correct: t.correct ?? null,
  },
  activity: (a) => a && {
    outcome: a.outcome ?? '',
    groups: (a.groups ?? []).map((g) => ({ label: g.label, gotIt: g.gotIt })),
    tallyId: a.tallyId ?? null,
  },
};

/** The attendance rows of a reply or of a refusal's `current`, whatever wraps them. */
const attRows = (body) => {
  if (Array.isArray(body)) return body;
  return [...(body?.students ?? []), ...(body?.removed ?? [])];
};

/**
 * What each kind of write is: the records it touches (keys), its request
 * (build, at the first send), the stamps its reply leaves (after), and the
 * stamps a stale refusal's `current` leaves (fromCurrent), for "Send again".
 */
const KINDS = {
  observe: {
    keys: (i) => [obsKey(i)],
    build: (i) => ({
      method: 'POST',
      path: `${room(i.code)}/observations`,
      body: {
        ...(i.studentId ? { studentId: i.studentId } : { rollNo: i.rollNo }),
        kind: i.kind,
        ...(i.kind && i.note ? { note: i.note } : {}),
        ...based(obsKey(i)),
      },
    }),
    after: (i, r) => [[obsKey(i), r?.current?.observedAt ?? null]],
    fromCurrent: (i, { current }) => [[obsKey(i), current?.observedAt ?? null]],
  },

  attendance: {
    keys: (i) => (i.marks ?? []).map((m) => attKey(i.code, m.studentId)),
    seed: (i, shown) => Object.entries(shown ?? {}).map(([id, at]) => [attKey(i.code, id), at]),
    build: (i) => ({
      method: 'POST',
      path: `${room(i.code)}/attendance`,
      body: i.fromJoins
        ? { fromJoins: true }
        : { marks: i.marks.map((m) => ({ studentId: m.studentId, status: m.status, ...based(attKey(i.code, m.studentId)) })) },
    }),
    after: (i, r) => {
      const rows = attRows(r);
      return (i.marks ?? []).map((m) => [attKey(i.code, m.studentId), rows.find((s) => s.studentId === m.studentId)?.markedAt ?? null]);
    },
    fromCurrent: (i, { current, newer }) => {
      const rows = [...attRows(current), ...attRows(newer)];
      return (i.marks ?? []).map((m) => {
        const row = rows.find((s) => s.studentId === m.studentId);
        return [attKey(i.code, m.studentId), row ? row.markedAt ?? null : undefined];
      });
    },
  },

  // Absent on a pick marks attendance by a separate attendance item (the
  // wheel queues both), so the mark has the attendance stale check, which a
  // pick's own markAttendance does not.
  pick: {
    keys: (i) => [pickKey(i)],
    build: (i) => ({ method: 'PATCH', path: `${room(i.code)}/wheel/picks/${enc(i.pickId)}`, body: { ...i.patch, ...based(pickKey(i)) } }),
    after: (i, r) => [[pickKey(i), shownOf.pick(r?.pick) ?? undefined]],
    fromCurrent: (i, { current }) => [[pickKey(i), shownOf.pick(current) ?? undefined]],
  },

  draw: {
    keys: () => [],
    build: (i) => ({ method: 'POST', path: `${room(i.code)}/wheel/draw`, body: i.settings }),
  },
  round: {
    keys: () => [],
    build: (i) => ({ method: 'POST', path: `${room(i.code)}/wheel/rounds`, body: i.settings }),
  },
  wheel: {
    keys: () => [],
    build: (i) => ({ method: 'PATCH', path: `${room(i.code)}/wheel`, body: i.settings }),
  },

  tallyCreate: {
    keys: () => [],
    build: (i) => ({ method: 'POST', path: `${room(i.code)}/tallies`, body: i.body }),
  },
  tallyEdit: {
    keys: (i) => [tallyKey(i)],
    build: (i) => ({ method: 'PATCH', path: `${room(i.code)}/tallies/${enc(i.tallyId)}`, body: { ...i.patch, ...based(tallyKey(i)) } }),
    after: (i, r) => [[tallyKey(i), shownOf.tally(r?.tally) ?? undefined]],
    fromCurrent: (i, { current }) => [[tallyKey(i), shownOf.tally(current) ?? undefined]],
  },
  // No basedOn, but its reply moves the tally's stamp for an edit queued after it.
  tallyStep: {
    keys: (i) => [tallyKey(i)],
    build: (i) => ({
      method: 'POST',
      path: `${room(i.code)}/tallies/${enc(i.tallyId)}/${i.dir > 0 ? 'increment' : 'decrement'}`,
      body: { option: i.option },
    }),
    after: (i, r) => [[tallyKey(i), shownOf.tally(r?.tally) ?? undefined]],
  },

  activityCreate: {
    keys: () => [],
    build: (i) => ({ method: 'POST', path: `${room(i.code)}/activities`, body: i.body }),
  },
  activityEdit: {
    keys: (i) => [actKey(i)],
    build: (i) => ({ method: 'PATCH', path: `${room(i.code)}/activities/${enc(i.activityId)}`, body: { ...i.patch, ...based(actKey(i)) } }),
    after: (i, r) => [[actKey(i), shownOf.activity(r?.activity) ?? undefined]],
    fromCurrent: (i, { current }) => [[actKey(i), shownOf.activity(current) ?? undefined]],
  },

  insight: {
    keys: (i) => [flagKey(i)],
    build: (i) => ({
      method: 'POST',
      path: `${room(i.code)}/insights/actions`,
      body: { flagId: i.flagId, action: i.action, ...(i.note ? { note: i.note } : {}), ...based(flagKey(i)) },
    }),
    after: (i, r) => [[flagKey(i), r?.action?.actedAt ?? null]],
    fromCurrent: (i, { current }) => [[flagKey(i), current?.actedAt ?? current?.lastAction?.actedAt ?? null]],
  },
};

/* ------------------------------------------------------------- the keys */

/**
 * A fresh key. crypto.randomUUID needs a secure context, which a laptop
 * reached over plain http on a LAN is not; getRandomValues does not.
 */
export function newKey() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* not a secure context */ }
  const b = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(b); } catch {
    for (let i = 0; i < b.length; i += 1) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let lastSeq = 0;
const nextSeq = () => { lastSeq = Math.max(Date.now(), lastSeq + 1); return lastSeq; };

function make(kind, intent, label, extra = {}) {
  return {
    id: newKey(),
    seq: nextSeq(),
    owner: state.owner,
    kind,
    intent,
    label,
    queuedAt: new Date().toISOString(),
    status: 'queued',
    request: null,
    deferred: false,
    ...extra,
  };
}

/* ------------------------------------------------------------ the sends */

async function attempt(item) {
  if (!item.request) {
    item.request = KINDS[item.kind].build(item.intent);
    item.firstSentAt = new Date().toISOString();
  }
  item.status = 'sending';
  state.sendingId = item.id;
  await save(item);
  emit();
  const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
  const timer = ctl && setTimeout(() => ctl.abort(), SEND_TIMEOUT_MS);
  try {
    const { method, path, body } = item.request;
    return { ok: true, ...(await keyedWrite(method, path, body, item.id, ctl?.signal)) };
  } catch (err) {
    return { ok: false, err };
  } finally {
    clearTimeout(timer);
    state.sendingId = null;
  }
}

async function remove(item) {
  state.items = state.items.filter((x) => x.id !== item.id);
  await tx(ITEMS, 'readwrite', (s) => s.delete(item.id));
}

/** Hand the outcome to whoever is waiting for it: the screen now, or onSettle later. */
function settle(item, outcome) {
  const waiter = waiters.get(item.id);
  const later = settlers.get(item.id);
  waiters.delete(item.id);
  settlers.delete(item.id);
  if (waiter) waiter(outcome);
  else later?.(outcome);
  return Boolean(waiter);
}

/** Every waiting screen is told its record is kept on this device. */
function keepWaiting(ids = [...waiters.keys()]) {
  let told = false;
  for (const id of ids) {
    const resolve = waiters.get(id);
    if (!resolve) continue;
    waiters.delete(id);
    const item = state.items.find((x) => x.id === id);
    if (item) { item.deferred = true; save(item); }
    resolve({ kept: true });
    told = true;
  }
  if (told) { emit(); notice('Saved on this device · will sync'); }
}

const REFUSED = (status) => status >= 400 && status < 500 && ![401, 408, 425, 429].includes(status);

async function drain() {
  if (state.draining) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  state.draining = true;
  await loaded;
  emit();
  const rooms = new Set();
  let sentLater = false;
  try {
    for (;;) {
      const item = mine().sort(bySeq).find(waitingItem);
      if (!item) break;
      const out = await attempt(item);
      const code = upper(item.intent?.code);

      if (out.ok) {
        state.reach = 'ok';
        state.reason = '';
        state.failures = 0;
        state.lastSyncAt = new Date().toISOString();
        for (const [key, stamp] of KINDS[item.kind].after?.(item.intent, out.body) ?? []) setStamp(key, stamp);
        await remove(item);
        if (item.deferred) sentLater = true;
        if (item.deferred || out.replayed) rooms.add(code);
        settle(item, { ok: true, reply: out.body, replayed: out.replayed });
        emit();
        continue;
      }

      const { err } = out;
      if (err?.status && REFUSED(err.status)) {
        state.reach = 'ok';
        const body = err.body ?? {};
        const refusal = {
          status: err.status,
          error: err.message || 'The server refused this record.',
          stale: err.status === 409 && body.stale === true,
          current: body.current ?? null,
          newer: body.newer ?? null,
          at: new Date().toISOString(),
        };
        // Kept and shown, whoever was waiting: never let go of silently.
        item.status = 'refused';
        item.refusal = refusal;
        await save(item);
        if (item.deferred) rooms.add(code);
        settle(item, { refused: true, ...refusal });
        emit();
        continue;
      }

      // Not now: no reply, a 5xx, a 401, a 429. The same item goes again, with
      // its key and body. A 401 or 429 waits for the professor (unlock, "Try
      // now", a new record): a lock-out is never retried by itself.
      state.reach = err?.status ? 'held' : 'offline';
      state.reason = err?.status ? err.message : '';
      state.failures += 1;
      item.status = 'queued';
      await save(item);
      keepWaiting();
      if (![401, 429].includes(err?.status)) {
        const wait = BACKOFF_S[Math.min(state.failures - 1, BACKOFF_S.length - 1)];
        retryTimer = setTimeout(drain, wait * 1000);
      }
      break;
    }
  } finally {
    state.draining = false;
    saveStampsSoon();
    emit();
  }
  if (rooms.size) drainedFns.forEach((fn) => fn(rooms));
  if (sentLater && !mine().some(waitingItem)) notice('All records synced');
}

/* ------------------------------------------------------------ the start */

const loaded = (async () => {
  const [rows, meta] = await Promise.all([
    tx(ITEMS, 'readonly', (s) => s.getAll()),
    tx(META, 'readonly', (s) => s.get('state')),
  ]);
  if (rows === null) state.disk = false;
  // From an earlier visit: sent later, whatever was waiting then.
  state.items = (Array.isArray(rows) ? rows : []).map((i) => ({
    ...i,
    deferred: true,
    status: i.status === 'sending' ? 'queued' : i.status,
  }));
  lastSeq = Math.max(0, ...state.items.map((i) => Math.floor(i.seq)));
  for (const [k, v] of meta?.stamps ?? []) if (!state.stamps.has(k)) state.stamps.set(k, v);
  state.lastSyncAt = state.lastSyncAt ?? meta?.lastSyncAt ?? null;
  emit();
})();

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (state.reach === 'offline') state.reach = 'unknown';
    emit();
    drain();
  });
  window.addEventListener('offline', () => { state.reach = 'offline'; emit(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mine().some(waitingItem) && !retryTimer && state.reach !== 'held') drain();
  });
}

/* ------------------------------------------------------------ the calls */

/**
 * Keep a write and send it. Resolves with the first thing known:
 *   { ok: true, reply, replayed }   the server has it
 *   { refused: true, status, error, stale, current, newer }
 *   { kept: true }                  saved on this device; the outcome comes to onSettle
 *
 * @param kind    observe | attendance | pick | draw | round | wheel | tallyCreate |
 *                tallyEdit | tallyStep | activityCreate | activityEdit | insight
 * @param intent  what to send; `code` is the room's. The kinds above say the rest.
 * @param label   one line for the sync dialog: what this record is
 * @param shown   the record's stamp as the screen showed it (attendance:
 *                { studentId: markedAt }); null for "none"; undefined if unknown
 */
export async function record(kind, intent, { label = '', shown, onSettle } = {}) {
  if (!KINDS[kind]) throw new Error(`No outbox kind "${kind}".`);
  await loaded;
  const it = { ...intent, code: upper(intent.code) };
  const K = KINDS[kind];
  if (shown !== undefined) {
    seen(K.seed ? K.seed(it, shown) : K.keys(it).map((key) => [key, shown]));
  }
  const item = make(kind, it, label);
  const result = new Promise((resolve) => waiters.set(item.id, resolve));
  if (onSettle) settlers.set(item.id, onSettle);
  state.items.push(item);
  await save(item);
  emit();
  // A network known to be down does not keep the screen waiting.
  if (!online() || state.reach === 'offline') keepWaiting([item.id]);
  else setTimeout(() => keepWaiting([item.id]), PATIENCE_MS);
  drain();
  return result;
}

/** Throw the refusal (as the api calls do) or hand back the reply, or { kept }. */
export async function recordOrThrow(kind, intent, opts) {
  const out = await record(kind, intent, opts);
  if (out.refused) throw Object.assign(new Error(out.error), { status: out.status, stale: out.stale, current: out.current, newer: out.newer });
  return out;
}

/** Send again a record refused as stale: a new item with a new key, based on what is there now. */
export async function resend(id) {
  await loaded;
  const old = state.items.find((i) => i.id === id && i.owner === state.owner);
  if (!old || old.status !== 'refused') return;
  const K = KINDS[old.kind];
  await remove(old);
  if (old.refusal?.stale) seen(K.fromCurrent?.(old.intent, old.refusal) ?? []);
  const item = make(old.kind, old.intent, old.label, { deferred: true });
  state.items.push(item);
  await save(item);
  emit();
  drain();
}

/** Let go of a refused record, at the professor's word. */
export async function discard(id) {
  const item = state.items.find((i) => i.id === id && i.owner === state.owner);
  if (!item || item.status !== 'refused') return;
  await remove(item);
  emit();
}

/** Try the waiting records now. */
export function syncNow() {
  if (state.reach === 'offline' && online()) state.reach = 'unknown';
  drain();
}

/** True when the last try found no network: a draw, which only the server makes, waits for it. */
export const offlineNow = () => !online() || state.reach === 'offline';

/** An attendance read's stamps (markedAt), for the attendance a later pick marks. */
export function noteAttendance(code, report) {
  const c = upper(code);
  seen(attRows(report).filter((s) => s.studentId).map((s) => [attKey(c, s.studentId), s.markedAt ?? null]));
}

/* ------------------------------------------------------------ the hooks */

const subscribe = (fn) => { changeFns.add(fn); return () => changeFns.delete(fn); };

/** { items, waiting, refused, mode: synced | syncing | offline | waiting, offline, reason, lastSyncAt, disk } */
export function useOutbox() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Whose records these are: an account id, or 'key' for the console key. */
export function useOutboxOwner(owner) {
  useEffect(() => {
    const next = owner || 'key';
    if (state.owner !== next) { state.owner = next; emit(); }
    drain();
  }, [owner]);
}

/** The outbox's short messages (kept, all synced), for a toast. */
export function useOutboxNotices(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const on = (text) => ref.current?.(text);
    noticeFns.add(on);
    return () => { noticeFns.delete(on); };
  }, []);
}

/**
 * Read again once records of this room sent later (or a replayed reply,
 * which is the stored first one) have settled: what the screen holds may be
 * older than the server's.
 */
export function useSynced(code, read) {
  const ref = useRef(read);
  ref.current = read;
  useEffect(() => {
    const c = upper(code);
    const on = (rooms) => { if (rooms.has(c)) ref.current?.(); };
    drainedFns.add(on);
    return () => { drainedFns.delete(on); };
  }, [code]);
}
