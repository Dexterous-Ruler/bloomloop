// The browser half of BloomLoop v2 identity (V2-CONTRACT section 5).
//
// Everything here runs on the anon key. The service-role key bypasses row level
// security, so it exists only in the server process and must never be imported,
// referenced or logged anywhere under client/.
//
// The browser holds a session and nothing else: it never decides what role it
// has. Roles, the reporting line and every permission come back from the server
// on GET /api/auth/me, which is the only thing this module trusts.

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { createClient } from '@supabase/supabase-js';

// Build-time first, then whatever the server injected into the page shell.
//
// Vite inlines import.meta.env when the bundle is compiled, so a value the build
// machine did not have can never appear in it. The deployed image is built
// without any .env file and configured by the platform at run time, so the
// injected object is the only route those values have - without this fallback,
// accounts work locally and are silently dead in production.
const boot = (typeof window !== 'undefined' && window.__BLOOMLOOP__) || {};
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || boot.supabaseUrl || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || boot.supabaseAnonKey || '';

// A pasted service-role key would hand full database access to everyone who
// opens devtools. We cannot un-ship it — Vite inlines the literal at build time
// — but we can refuse to use it and say so loudly, which is the difference
// between a bad build and a bad build that also works.
function looksSecret(key) {
  if (key.startsWith('sb_secret_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return claims.role === 'service_role';
  } catch {
    return false; // not a JWT we can read; the prefix test above is all we have
  }
}

function build() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (looksSecret(SUPABASE_ANON_KEY)) {
    console.error(
      'VITE_SUPABASE_ANON_KEY holds a secret key. Accounts are disabled. ' +
      'Put the anon / publishable key in client/.env and rotate the secret one.',
    );
    return null;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Email and password only — no magic links or OAuth redirects, so there is
      // never a token in the address bar and nothing to strip back out of it.
      detectSessionInUrl: false,
    },
  });
}

/** The browser client, or null when the env vars are absent. Anon key only. */
export const supabase = build();

/* ------------------------------------------------------------------ account */

const SIGNED_OUT = { account: null, canSee: null, loading: false, error: '' };

// Without a client there is no session to load and never will be, so the very
// first render already knows the answer: nobody. That keeps the teacher-key demo
// path from flashing a spinner it can never resolve.
let state = supabase ? { account: null, canSee: null, loading: true, error: '' } : SIGNED_OUT;

const listeners = new Set();
let pending = null;
let loaded = false;
let generation = 0;

function publish(next) {
  state = next;
  listeners.forEach((fn) => fn());
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot() {
  return state;
}

async function run() {
  const gen = ++generation;
  if (!supabase) {
    publish(SIGNED_OUT);
    loaded = true;
    return null;
  }
  try {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    if (!token) {
      if (gen === generation) {
        publish(SIGNED_OUT);
        loaded = true;
      }
      return null;
    }
    const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
    const account = body.account ?? null;
    if (gen === generation) {
      publish({ account, canSee: body.canSee ?? null, loading: false, error: '' });
      loaded = true;
    }
    return account;
  } catch (err) {
    if (gen === generation) {
      publish({ account: null, canSee: null, loading: false, error: err.message });
      // Marked loaded on failure too: a mounting component must not turn a dead
      // server into a request per screen.
      loaded = true;
    }
    return null;
  }
}

// One request for the whole page. The account does not change under us, and /me
// sits in front of the first render of every signed-in screen.
function load() {
  if (loaded) return Promise.resolve(state.account);
  if (!pending) pending = run().finally(() => { pending = null; });
  return pending;
}

function reload() {
  loaded = false;
  pending = null;
  return load();
}

if (supabase) {
  load();
  supabase.auth.onAuthStateChange((event) => {
    // TOKEN_REFRESHED is the same account with a longer-lived token, and
    // INITIAL_SESSION is the load() above.
    if (event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED') return;
    // Deferred by a tick: gotrue holds an internal lock while it runs these
    // callbacks and calling back into supabase.auth from inside one deadlocks.
    setTimeout(() => {
      if (!pending) reload();
    }, 0);
  });
}

/* -------------------------------------------------------------------- verbs */

/**
 * Sign in with email and password.
 * @returns {Promise<object|null>} the server's account record
 */
export async function signIn(email, password) {
  if (!supabase) throw new Error('Accounts are not configured in this build.');
  const { error } = await supabase.auth.signInWithPassword({
    email: String(email ?? '').trim(),
    password: String(password ?? ''),
  });
  if (error) throw new Error(error.message);
  // Callers route on the role, so hand it back rather than making them wait for
  // the hook to catch up on a later render.
  return reload();
}

/**
 * Redeem an invite and create an account.
 * @param {{email:string, password:string, fullName:string, inviteCode:string}} payload
 * @returns {Promise<object|null>} the server's account record
 */
export async function signUp(payload) {
  const email = String(payload?.email ?? '').trim();
  const password = String(payload?.password ?? '');
  const fullName = String(payload?.fullName ?? '').trim();
  const inviteCode = String(payload?.inviteCode ?? '').trim().toUpperCase();

  // The server owns this end to end: it consumes the invite, takes the role,
  // department and reporting line from it and creates the auth user. Nothing
  // the browser could say about who it is would be believed anyway.
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, fullName, inviteCode }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });

  if (!supabase) return body.account ?? null;
  try {
    return await signIn(email, password);
  } catch (err) {
    // The account exists at this point; saying "sign-up failed" would send them
    // back to redeem an invite that has already been spent.
    throw Object.assign(
      new Error(`Your account was created, but signing you in failed: ${err.message}`),
      { accountCreated: true },
    );
  }
}

/** Ends the session and clears the cached account. */
export async function signOut() {
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) throw new Error(error.message);
  }
  generation += 1; // strand any in-flight /me so it cannot repopulate the cache
  pending = null;
  loaded = true;
  publish(SIGNED_OUT);
}

/**
 * Subscribe to Supabase auth events.
 * @param {(event: string, session: object|null) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, session));
  return () => data.subscription.unsubscribe();
}

/**
 * The signed-in account, shared by every component that asks.
 * @returns {{account: object|null, canSee: object|null, loading: boolean, error: string, refresh: () => Promise<object|null>}}
 */
export function useAccount() {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const refresh = useCallback(() => reload(), []);
  // A no-op once the page-level load has settled; it only matters if a screen
  // mounts before this module's own kick-off has run.
  useEffect(() => { load(); }, []);
  return {
    account: current.account,
    canSee: current.canSee,
    loading: current.loading,
    error: current.error,
    refresh,
  };
}
