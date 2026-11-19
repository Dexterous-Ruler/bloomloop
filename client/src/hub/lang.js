/**
 * The language a student reads the hub in: English, हिन्दी or मराठी.
 *
 * The server keeps the choice (GET and PUT /api/hub/language) and sends every
 * lesson, question, hint and explanation in it when a reviewed translation
 * exists, English with a note otherwise. So a change here means: save it, then
 * reload what is open. Screens put `version` in their effects' dependencies and
 * fetch again when it moves.
 *
 *   const { language, choices, note, version, set, busy, error } = useHubLanguage();
 *
 * Translated text carries lang="hi" / lang="mr" (see langAttr).
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useViewer } from '../shell/viewer.js';
import { hub } from './hubApi.js';

// `owner`: the account the cached choice belongs to, so signing in as someone
// else in the same tab reads theirs instead of showing the last one's.
let state = { language: 'en', choices: [], note: '', version: 0, loaded: false, busy: false, error: '', owner: undefined };
let loading = null;
const listeners = new Set();

function publish(next) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

function load(owner) {
  if (owner !== state.owner) {
    loading = null;
    publish({ owner, loaded: false, error: '', language: 'en', choices: [], note: '' });
  }
  if (loading || state.loaded) return loading;
  loading = hub.language()
    .then((r) => { if (state.owner === owner) publish({ language: r.language ?? 'en', choices: r.choices ?? [], note: r.note ?? '', loaded: true, error: '' }); })
    .catch((e) => { if (state.owner === owner) publish({ loaded: true, error: e.message }); })
    .finally(() => { if (state.owner === owner) loading = null; });
  return loading;
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => state;

export function useHubLanguage() {
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);
  const owner = useViewer().account?.id ?? null;
  useEffect(() => { load(owner); }, [owner]);
  const set = useCallback(async (language) => {
    if (language === state.language || state.busy) return;
    publish({ busy: true, error: '' });
    try {
      const r = await hub.setLanguage(language);
      publish({ language: r.language ?? language, choices: r.choices ?? state.choices, busy: false, version: state.version + 1 });
    } catch (e) {
      publish({ busy: false, error: e.message });
    }
  }, []);
  return { ...s, set };
}

/** The lang attribute for text in `language`: 'hi' and 'mr' only (English is the page's own). */
export const langAttr = (language) => (language === 'hi' || language === 'mr' ? language : undefined);
