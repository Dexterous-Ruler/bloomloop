// Teacher-only routes are gated on a key the server prints at boot. The teacher
// opens the console via the printed URL, which carries ?key=...; we stash it and
// strip it back out of the address bar so it is not sitting on the projector.
// Students never have it and never need it.
//
// Its own module, imported by main.jsx before the router starts, so the key
// leaves the address bar on every route as soon as the page runs - not later,
// when a lazily loaded screen happens to import api.js.
const KEY_STORAGE = 'bloomloop.teacherKey';

const safeStorage = {
  get(k) {
    try {
      return window.localStorage.getItem(k) || '';
    } catch {
      return ''; // private mode / storage disabled
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* nothing we can do; the in-memory copy below still covers this tab */
    }
  },
};

let memoryKey = '';

(function captureKeyFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const key = url.searchParams.get('key');
  if (!key) return;
  memoryKey = key.trim();
  safeStorage.set(KEY_STORAGE, memoryKey);
  url.searchParams.delete('key');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
})();

export const teacherKey = {
  get: () => memoryKey || safeStorage.get(KEY_STORAGE),
  set: (value) => {
    memoryKey = String(value ?? '').trim();
    safeStorage.set(KEY_STORAGE, memoryKey);
  },
};
