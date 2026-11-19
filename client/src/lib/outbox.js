// The phone's outbox: every answer and vote, kept on this phone before it is
// sent, until the server has said it has it (Phase 7, "First").
//
// Append-only. An item is written once under its answerId and then only has its
// status moved on: queued -> sent (the server has it) or marked (and marked it),
// or refused (the server will never take it: kept and shown, never retried).
// Nothing unsent is ever deleted. A confirmed item goes only once its room is
// gone (dropConfirmed).
//
// What is kept is what the student sent and nothing the server knows: no key,
// no verdict, no level. Items are scoped by room code and roll number, so a
// shared phone never shows or sends one student's answers as another's.
//
// IndexedDB, wrapped so that every way it can fail - private mode, storage
// switched off, a browser that blocks it - is a quiet null. The session's own
// copy in memory then carries the outbox for the life of the tab.

const DB = 'bloomloop-outbox';
const STORE = 'items';

let opening = null;

function open() {
  if (!opening) {
    opening = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'answerId' }).createIndex('scope', 'scope');
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

/** One transaction; resolves with the request's result, or null on any failure. */
async function run(mode, fn) {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result ?? true);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export const scopeOf = (code, rollNo) => `${String(code ?? '').toUpperCase()}:${String(rollNo ?? '').toUpperCase()}`;

/** Write an item (new, or its status moved on). Resolves true when it is on disk. */
export const keep = (item) => run('readwrite', (s) => s.put(item)).then(Boolean);

/** This room and roll number's items, oldest first. */
export const listFor = (scope) => run('readonly', (s) => s.index('scope').getAll(scope))
  .then((rows) => (Array.isArray(rows) ? rows.sort((a, b) => a.seq - b.seq) : []));

/** The room is gone: its confirmed items go. Unsent and refused ones stay. */
export const dropConfirmed = (scope) => run('readwrite', (s) => {
  const req = s.index('scope').openCursor(scope);
  req.onsuccess = () => {
    const c = req.result;
    if (!c) return;
    if (c.value.status === 'sent' || c.value.status === 'marked') c.delete();
    c.continue();
  };
  return null;
});
