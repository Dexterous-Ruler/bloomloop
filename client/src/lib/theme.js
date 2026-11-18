/**
 * Light or dark. The system setting decides until the person picks one; a pick
 * is remembered in this browser only, because it is a preference about this
 * screen and not a fact about the account.
 */

import { useCallback, useSyncExternalStore } from 'react';

const KEY = 'bloomloop.theme';
const listeners = new Set();

const read = () => {
  try { return window.localStorage.getItem(KEY); } catch { return null; }
};
// Held in memory as well, so a pick still applies for the visit in a private
// window where storage throws.
let chosen = typeof window === 'undefined' ? null : read();

const system = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const picked = () => (chosen === 'dark' || chosen === 'light' ? chosen : null);
const current = () => picked() ?? system();

function apply() {
  if (picked()) document.documentElement.dataset.theme = picked();
  else delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', current() === 'dark' ? '#0E0E10' : '#F6F6F7');
}

if (typeof window !== 'undefined') {
  apply();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    apply();
    listeners.forEach((fn) => fn());
  });
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light');
  const toggle = useCallback(() => {
    chosen = current() === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(KEY, chosen); } catch { /* private window: this visit only */ }
    apply();
    listeners.forEach((fn) => fn());
  }, []);
  return { theme, toggle };
}

/** The live value of a colour token, for anything drawn on a canvas. */
export const token = (name, el = document.documentElement) => getComputedStyle(el).getPropertyValue(name).trim();

/** Re-run `fn` whenever the theme flips, so a canvas can repaint in the new colours. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
