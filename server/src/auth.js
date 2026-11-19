// Server-side identity and authorization.
//
// Two questions get answered here and nowhere else: who is making this request,
// and may they see the row they are asking about. The browser never gets a vote
// in either. It sends a Supabase access token; a role in a body, a header or a
// query string is data, not a claim, and is never read.
//
// The token is verified against Supabase Auth using the service role key, which
// exists only on this side of the wire. Row level security is on with no
// policies, so that key is the single way into the tables - which is exactly why
// it must never be imported, referenced or logged anywhere under client/.
//
// The hierarchy questions (canSeeAccount, scopeFor) are answered by the
// accounts_below() SQL function through services/accounts.js. The recursion
// belongs in the database: a tree walked in JavaScript is a tree that drifts
// from the one the trigger enforces.

import { createClient } from '@supabase/supabase-js';

import { config, hasSupabase } from './config.js';
import { getAccount, listBelow } from './services/accounts.js';
import { isTeacher } from './teacherAuth.js';

/**
 * Where a resolved identity is parked for the life of one request. A symbol so
 * it cannot collide with anything another middleware hangs off `req`, and so a
 * route cannot forge it by accident.
 */
const RESOLVED = Symbol('bloomloop.auth.resolved');

const deny = (message, status) => Object.assign(new Error(message), { status });

const TEACHER_ROLES = ['professor', 'hod'];

const ROLE_LABEL = { hod: 'an HOD', professor: 'a professor', student: 'a student' };

const roleList = (roles) => roles.map((r) => ROLE_LABEL[r] ?? `a ${r}`).join(' or ');

/**
 * The actor behind the v1 TEACHER_KEY: a professor with no account, because in
 * v1 there were no accounts at all. Frozen, and never persisted - it exists so
 * that a route reading `req.viewer` gets the same shape whichever door the
 * request came through.
 */
const LEGACY_TEACHER = Object.freeze({
  id: null,
  role: 'professor',
  fullName: 'Teacher (shared key)',
  email: null,
  code: null,
  department: '',
  reportsTo: null,
  rollNo: null,
  active: true,
  legacyKey: true,
});

// ----------------------------------------------------------------- client --

let auth_;

/**
 * Built on first use rather than at import time: createClient throws on an empty
 * url, and this module is imported by routes that must still load on a machine
 * with no Supabase configuration at all (the in-process demo store).
 */
function authApi() {
  if (!auth_) {
    auth_ = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'bloomloop' } },
    }).auth;
  }
  return auth_;
}

function bearerToken(req) {
  const header = String(req.get?.('authorization') ?? req.headers?.authorization ?? '').trim();
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : '';
}

// --------------------------------------------------------------- resolving --

/**
 * Verify the token and load the account behind it. Never called twice for one
 * request - resolve() memoises the answer, including the failure, so a route
 * chaining requireAuth then reading loadAccount() costs one round trip.
 *
 * @returns {Promise<{account: object|null, error: Error|null}>}
 */
async function verify(req) {
  const token = bearerToken(req);
  if (!token) return { account: null, error: deny('Sign in to continue.', 401) };

  if (!hasSupabase()) {
    // A token arrived at a server that cannot check one. Failing closed with a
    // 401 would tell the browser to try again forever; this is our problem.
    return {
      account: null,
      error: deny(
        'Accounts are unavailable: this server has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.',
        503,
      ),
    };
  }

  const { data, error } = await authApi().getUser(token);
  if (error || !data?.user?.id) {
    return { account: null, error: deny('Your session has expired - sign in again.', 401) };
  }

  const account = await getAccount(data.user.id);
  if (!account) {
    return {
      account: null,
      error: deny('This sign-in has no BloomLoop account. Redeem an invite first.', 401),
    };
  }
  if (!account.active) {
    // 403 rather than 401 on purpose: re-authenticating will not help, and the
    // client should stop offering the sign-in form and say why.
    return { account: null, error: deny('This account has been deactivated.', 403) };
  }

  return { account, error: null };
}

/**
 * The same teacher check, for callers that have credentials but no Express
 * request — specifically the Socket.io handshake.
 *
 * `teacher:watch` had no authentication of any kind: a socket that knew the
 * room code, which is projected on a wall, was handed the live grid and
 * subscribed to every update. Sockets do not carry headers the way routes do,
 * so the credentials arrive in the payload and are verified here against
 * exactly the same rules the HTTP guard uses.
 *
 * @returns {Promise<{ok: boolean, role: string|null, accountId: string|null, reason: string}>}
 */
export async function verifyTeacherCredentials({ key = '', token = '' } = {}) {
  if (token) {
    // Reuse verify() by handing it the shape it reads from.
    const shim = { headers: { authorization: `Bearer ${token}` }, get: () => `Bearer ${token}` };
    const { account, error } = await verify(shim);
    if (account && TEACHER_ROLES.includes(account.role)) {
      return { ok: true, role: account.role, accountId: account.id, reason: '' };
    }
    if (account) return { ok: false, role: account.role, accountId: account.id, reason: 'Students cannot watch the grid.' };
    return { ok: false, role: null, accountId: null, reason: error?.message ?? 'Sign in to continue.' };
  }

  if (key) {
    const shim = { get: (h) => (h.toLowerCase() === 'x-teacher-key' ? key : undefined), query: {} };
    if (isTeacher(shim)) return { ok: true, role: 'professor', accountId: null, reason: '' };
  }

  return { ok: false, role: null, accountId: null, reason: 'Teacher credentials required.' };
}

/**
 * The account behind a bearer token, for a caller with no Express request: the
 * phone's `student:join`, which presents a signed-in student's token so the room
 * profile can be linked to their account (decision 7, 19 Nov 2026). Verified
 * exactly as requireAuth verifies the token on a student's own routes: Supabase
 * Auth says whose it is, and the account must exist and be active. Who may be
 * linked to what is the caller's rule.
 *
 * @returns {Promise<{account: object|null, error: Error|null}>}
 */
export async function verifyAccountToken(token = '') {
  const value = String(token ?? '').trim();
  if (!value) return { account: null, error: deny('Sign in to continue.', 401) };
  return verify({ headers: { authorization: `Bearer ${value}` }, get: () => `Bearer ${value}` });
}

async function resolve(req) {
  if (req[RESOLVED]) return req[RESOLVED];
  const outcome = await verify(req);
  req[RESOLVED] = outcome;
  req.account = outcome.account;
  if (outcome.account) req.viewer = outcome.account;
  return outcome;
}

// -------------------------------------------------------------- middleware --

/** 401 unless a valid bearer token resolves to an active account. */
export async function requireAuth(req, _res, next) {
  try {
    const { account, error } = await resolve(req);
    if (!account) return next(error ?? deny('Sign in to continue.', 401));
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * 403 unless the signed-in account holds one of these roles.
 *
 * Accounts only - the legacy teacher key deliberately does not satisfy this.
 * Anything that has to keep working for the v1 demo is gated on requireTeacher.
 */
export function requireRole(...roles) {
  const allowed = roles.flat().filter(Boolean);
  return async (req, _res, next) => {
    try {
      const { account, error } = await resolve(req);
      if (!account) return next(error ?? deny('Sign in to continue.', 401));
      if (!allowed.includes(account.role)) {
        return next(deny(`This is for ${roleList(allowed)} only.`, 403));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * The v1 shim: a professor or HOD bearer token, or the shared TEACHER_KEY.
 *
 * The token is tried first and the key is the fallback, because the console
 * sends both once a teacher has signed in on a machine that was unlocked by the
 * printed URL. Falling back grants nothing new: whoever holds the key already
 * has v1 teacher access by simply not sending a token.
 *
 * On the key path there is no account, so `req.viewer` is a professor with a
 * null id and loadAccount(req) stays null.
 */
export async function requireTeacher(req, _res, next) {
  try {
    let tokenError = null;

    if (hasSupabase() && bearerToken(req)) {
      const { account, error } = await resolve(req);
      if (account) {
        if (TEACHER_ROLES.includes(account.role)) return next();
        return next(deny('Only a professor or an HOD can use the teacher console.', 403));
      }
      tokenError = error;
    }

    if (isTeacher(req)) {
      req.account = null;
      req.viewer = LEGACY_TEACHER;
      return next();
    }

    next(
      tokenError ??
        deny(
          'Teacher key required. Open the console using the URL printed in the server window.',
          401,
        ),
    );
  } catch (err) {
    next(err);
  }
}

// ------------------------------------------------------------------ lookup --

/**
 * The account behind this request, or null for the guest and legacy-key paths.
 * Cached on the request, so calling it in three routes costs one verification.
 *
 * @returns {Promise<object|null>}
 */
export async function loadAccount(req) {
  const { account } = await resolve(req);
  return account;
}

/**
 * May `viewer` read the account `targetId`? The whole rule set from V2-CONTRACT
 * section 2, which collapses to: yourself always, plus everyone below you.
 *
 * "Below you" is accounts_below() - one recursive query in Postgres - so a
 * professor sees their students, an HOD sees the professors and every student
 * under them, and a student sees nobody but themself.
 *
 * @returns {Promise<boolean>}
 */
export async function canSeeAccount(viewer, targetId) {
  const target = String(targetId ?? '').trim();
  if (!viewer || !target) return false;
  if (viewer.id && viewer.id === target) return true;
  // A student sees self only, and the legacy key has no id to hang a tree off.
  if (viewer.role === 'student' || !viewer.id) return false;

  const below = await listBelow(viewer.id);
  return below.some((account) => account.id === target);
}

/**
 * The professors whose content, sessions and results this viewer may read.
 *
 * `includeUnowned` covers the rows v1 created before accounts existed: their
 * owner_id is null, and they belong to the shared-key teacher rather than to any
 * department, so only that path is allowed to see them.
 *
 * Inactive professors stay in an HOD's scope: deactivating someone must not
 * erase the sessions they already ran from the department's history.
 *
 * @returns {Promise<{ownerIds: string[], includeUnowned: boolean}>}
 */
export async function scopeFor(viewer) {
  if (!viewer) return { ownerIds: [], includeUnowned: false };

  if (viewer.role === 'professor') {
    return viewer.id
      ? { ownerIds: [viewer.id], includeUnowned: false }
      : { ownerIds: [], includeUnowned: true };
  }

  if (viewer.role === 'hod') {
    const below = await listBelow(viewer.id);
    return {
      ownerIds: below.filter((a) => a.role === 'professor').map((a) => a.id),
      includeUnowned: false,
    };
  }

  // Students own no professor data. Their own results are reached by account id,
  // not by owner.
  return { ownerIds: [], includeUnowned: false };
}
