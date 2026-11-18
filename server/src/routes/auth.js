// /api/auth - sign-up, identity, invites, the department tree, and the one-time
// bootstrap of the first HOD.
//
// The browser sends an email, a password and an invite code, and nothing else it
// says about itself is believed: role, department and reporting line all come
// off the invite row, which was written by someone who already had the authority
// to hand it out. That is the whole reason invites exist rather than a "role"
// field on the sign-up form.
//
// Everything here runs on the service role key by way of services/accounts.js
// and the client below, both of which are server-only.

import express from 'express';
import { randomInt } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

import { config, hasSupabase } from '../config.js';
import { isRecordId } from '../ids.js';
import { requireAuth, requireRole, loadAccount, canSeeAccount, scopeFor } from '../auth.js';
import {
  CODE_ALPHABET,
  buildTree,
  countAccounts,
  createAccount,
  getAccommodations,
  getAccount,
  googleSubLinked,
  setAccommodations,
  updateAccount,
} from '../services/accounts.js';
import { SUPPORTS } from '../accommodations.js';

const router = express.Router();

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// Same alphabet as an account code, but eight characters and single-use. A
// student types this once off a slide or a message, so the ambiguous characters
// are worth dropping here too.
const INVITE_LENGTH = 8;
const INVITE_TTL_DAYS = 14;
const INVITE_RETRIES = 5;

// Supabase Auth enforces six; eight is the shortest that is not embarrassing on
// an account that can open a department's question banks.
const MIN_PASSWORD = 8;

// Deliberately loose. The real check is that Supabase Auth accepts the address;
// this only catches the obvious typo before an auth user gets created.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A Google user id is a run of digits, currently 21 of them. Matched loosely on
// shape and capped on length because the exact format is Google's to change -
// but it is never free text, and this column must not become somewhere a caller
// can park a payload.
const GOOGLE_SUB = /^[0-9]{1,40}$/;

// Who may invite whom. One step down the hierarchy, never sideways or up.
const INVITABLE = { hod: 'professor', professor: 'student' };

const PG_STATUS = { 23505: 409, 23503: 400, 23514: 400, '22P02': 400, P0001: 400 };

// ----------------------------------------------------------------- helpers --

let db_;

/** Built on first use: createClient throws on an empty url. */
function db() {
  if (!db_) {
    if (!hasSupabase()) {
      throw fail(
        'Accounts are unavailable: this server has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.',
        503,
      );
    }
    db_ = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'bloomloop' } },
    });
  }
  return db_;
}

const pgFail = (what, error) => fail(`${what}: ${error.message}`, PG_STATUS[error.code] ?? 500);

const trimmed = (value) => String(value ?? '').trim();
const orNull = (value) => trimmed(value) || null;
const normaliseEmail = (value) => trimmed(value).toLowerCase();
const normaliseCode = (value) => trimmed(value).toUpperCase();

function makeInviteCode() {
  let out = '';
  for (let i = 0; i < INVITE_LENGTH; i += 1) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

const outInvite = (r) => r && { code: r.code, role: r.role, expiresAt: r.expires_at };

function requireCredentials({ email, password, fullName }) {
  if (!EMAIL.test(email)) throw fail('That does not look like an email address.');
  if (password.length < MIN_PASSWORD) {
    throw fail(`Choose a password of at least ${MIN_PASSWORD} characters.`);
  }
  if (!fullName) throw fail('Your full name is required.');
}

async function createAuthUser({ email, password, fullName }) {
  // email_confirm: a classroom demo has no mail server, and the invite is
  // already proof that someone with authority vouched for this person.
  const { data, error } = await db().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) {
    const taken = /already|registered|exists/i.test(error.message ?? '');
    throw fail(
      taken
        ? 'An account already exists for that email address - sign in instead.'
        : `Could not create the sign-in: ${error.message}`,
      taken ? 409 : 400,
    );
  }
  return data.user;
}

/**
 * Undo a half-made sign-up. Best effort and never rethrows: the caller is
 * already reporting a failure and must not have it replaced by this one.
 * accounts.id cascades from auth.users, so this also removes any account row.
 */
async function discardAuthUser(id) {
  try {
    const { error } = await db().auth.admin.deleteUser(id);
    if (error) console.error('[auth] could not remove a half-created sign-in:', error.message);
  } catch (err) {
    console.error('[auth] could not remove a half-created sign-in:', err.message);
  }
}

/**
 * Consume an invite. One UPDATE reads it, stamps it and returns it: Postgres
 * re-evaluates `used_by is null` after taking the row lock, so of two students
 * racing on the same code exactly one gets a row back and the other gets none.
 * Reading first and updating after would let both through.
 */
async function claimInvite(code, userId) {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from('invites')
    .update({ used_by: userId, used_at: now })
    .eq('code', code)
    .is('used_by', null)
    .gt('expires_at', now)
    .select()
    .maybeSingle();
  if (error) throw pgFail('Could not redeem that invite', error);
  return data ?? null;
}

/** Hand an invite back when the sign-up it was claimed for could not finish. */
async function releaseInvite(code) {
  const { error } = await db()
    .from('invites')
    .update({ used_by: null, used_at: null })
    .eq('code', code);
  if (error) console.error('[auth] could not release invite', code, error.message);
}

/** Why the claim failed, in words, once we know it did. */
/**
 * Is this invite worth starting a sign-up for? Returns an error to throw, or
 * null when the invite looks spendable.
 *
 * Deliberately separate from explainInvite(), which is only ever called AFTER a
 * claim has already failed and so always has something to report. Using that one
 * as a pre-check would reject every valid sign-up.
 */
async function checkInviteUsable(code) {
  const { data, error } = await db()
    .from('invites')
    .select('used_by, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return fail('That invite code is not valid.', 400);
  if (data.used_by) return fail('That invite has already been used.', 409);
  if (new Date(data.expires_at) <= new Date()) return fail('That invite has expired.', 410);
  return null;
}

async function explainInvite(code) {
  const { data, error } = await db()
    .from('invites')
    .select('used_by, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error || !data) return fail('That invite code is not valid.', 400);
  if (data.used_by) return fail('That invite has already been used.', 409);
  if (new Date(data.expires_at) <= new Date()) return fail('That invite has expired.', 410);
  // Neither used nor expired, yet the claim matched nothing: someone took it
  // between the two statements.
  return fail('That invite was just used by someone else.', 409);
}

// ------------------------------------------------------------------ routes --

/**
 * Public. The invite is the only thing that decides role, department and
 * reporting line - none of them are read from the request body.
 */
router.post('/signup', async (req, res, next) => {
  let user = null;
  let claimed = null;
  try {
    const email = normaliseEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const fullName = trimmed(req.body?.fullName);
    const inviteCode = normaliseCode(req.body?.inviteCode);

    if (!inviteCode) throw fail('An invite code is required to create an account.');
    requireCredentials({ email, password, fullName });

    // Look the invite over BEFORE touching Supabase Auth. Creating the auth user
    // first meant a stranger with a junk invite code could tell which email
    // addresses already had accounts, purely from whether the response was
    // "email taken" or "bad invite" - and every probe churned a real
    // createUser/deleteUser pair against Auth.
    const preflight = await checkInviteUsable(inviteCode);
    if (preflight) throw preflight;

    user = await createAuthUser({ email, password, fullName });

    // Still claimed atomically after the user exists: the pre-check is a filter
    // for the common case, not the race guard. This conditional update is.
    claimed = await claimInvite(inviteCode, user.id);
    if (!claimed) throw await explainInvite(inviteCode);

    const account = await createAccount({
      authUserId: user.id,
      role: claimed.role,
      fullName,
      email,
      department: claimed.department ?? '',
      reportsTo: claimed.reports_to ?? null,
      rollNo: claimed.role === 'student' ? claimed.roll_no : null,
      // Off the invite, exactly like the role and the reporting line, and for the
      // same reason: the browser is not believed about any of them. This is the
      // step that makes the roster import worth doing - without it the Google id
      // a professor imported dies on the invite row and grade posting is back to
      // comparing normalised names.
      googleSub: claimed.role === 'student' ? claimed.google_sub : null,
    });

    res.status(201).json({ account });
  } catch (err) {
    // Roll back in reverse order so a failed sign-up leaves neither a stranded
    // sign-in nor an invite that nobody can spend.
    if (claimed) await releaseInvite(claimed.code);
    if (user) await discardAuthUser(user.id);
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const account = await loadAccount(req);
    res.json({ account, canSee: await canSeeFor(account) });
  } catch (err) {
    next(err);
  }
});

/**
 * An HOD invites professors, a professor invites students. The invite carries
 * the inviter's department and points its reporting line back at them, which is
 * what makes the one-edge hierarchy hold without the sign-up form knowing it
 * exists.
 *
 * `googleSub` is the one field here that did not come off a form. It is set only
 * by the Google Classroom roster import on the professor's home screen, where it
 * is Google's own userId for a student in a course the professor teaches - which
 * is what turns grade posting from a comparison of normalised names into an
 * equality test. Optional in every sense: the manual invite path sends nothing
 * and behaves exactly as it always has.
 */
router.post('/invite', requireRole('hod', 'professor'), async (req, res, next) => {
  try {
    const inviter = await loadAccount(req);
    const role = trimmed(req.body?.role).toLowerCase();
    const allowed = INVITABLE[inviter.role];

    if (!role) throw fail('Say which role this invite is for.');
    if (role !== allowed) throw fail(`You may only invite a ${allowed}.`, 403);

    const rollNo = role === 'student' ? orNull(req.body?.rollNo) : null;
    const googleSub = role === 'student' ? orNull(req.body?.googleSub) : null;
    if (googleSub && !GOOGLE_SUB.test(googleSub)) {
      throw fail('That is not a Google Classroom user id.');
    }

    // Refused here rather than at redemption, because the professor is the one
    // who can fix it and they are standing here now. Left to the unique index,
    // the failure would surface days later to a student holding an invite they
    // did nothing wrong with. This is a courtesy check and not the guard - two
    // invites issued for one student before either is spent still both pass, and
    // the index still refuses the second sign-up.
    if (googleSub && (await googleSubLinked(googleSub))) {
      throw fail(
        'That Google Classroom student already has a BloomLoop account, so this invite could '
        + 'never be redeemed. They are already on your roster.',
        409,
      );
    }

    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString();

    const invite = await insertInvite({
      role,
      department: inviter.department ?? '',
      reports_to: inviter.id,
      created_by: inviter.id,
      email: orNull(req.body?.email)?.toLowerCase() ?? null,
      roll_no: rollNo,
      google_sub: googleSub,
      full_name: trimmed(req.body?.fullName),
      expires_at: expiresAt,
    });

    res.status(201).json({ invite: outInvite(invite) });
  } catch (err) {
    next(err);
  }
});

router.get('/team', requireRole('hod', 'professor'), async (req, res, next) => {
  try {
    const viewer = await loadAccount(req);
    res.json({ tree: await buildTree(viewer.id) });
  } catch (err) {
    next(err);
  }
});

/**
 * An HOD edits anyone in their department; anyone edits their own name. Nobody
 * edits their own `active` flag, which keeps an HOD from locking themselves out
 * and a student from reinstating themself.
 */
router.patch('/account/:id', requireAuth, async (req, res, next) => {
  try {
    const viewer = await loadAccount(req);
    const targetId = trimmed(req.params.id);
    if (!isRecordId(targetId)) throw fail('That is not a valid account id.');

    const patch = {};
    if (req.body?.fullName !== undefined) {
      const fullName = trimmed(req.body.fullName);
      if (!fullName) throw fail('A name cannot be empty.');
      patch.fullName = fullName;
    }

    if (targetId === viewer.id) {
      for (const field of ['active', 'rollNo']) {
        if (req.body?.[field] !== undefined) throw fail('Only an HOD can change that.', 403);
      }
    } else {
      if (viewer.role !== 'hod') throw fail('Only an HOD can edit another account.', 403);
      if (!(await canSeeAccount(viewer, targetId))) {
        throw fail('That account is not in your department.', 403);
      }
      if (req.body?.active !== undefined) patch.active = Boolean(req.body.active);
      if (req.body?.rollNo !== undefined) patch.rollNo = orNull(req.body.rollNo);
    }

    if (Object.keys(patch).length === 0) throw fail('Nothing to change.');

    const account = await updateAccount(targetId, patch);
    if (!account) throw fail('No such account.', 404);
    res.json({ account });
  } catch (err) {
    next(err);
  }
});

/**
 * A student's supports: read and set by the professor they report to.
 *
 * Only that professor, and only for their own students: an HOD can see the
 * account but the supports are a teaching decision made by the person in the
 * room. The body is normalised server-side, so unknown keys and anything other
 * than `true` are dropped before they reach the column.
 */
async function ownStudent(req) {
  const viewer = await loadAccount(req);
  const targetId = trimmed(req.params.id);
  if (!isRecordId(targetId)) throw fail('That is not a valid account id.');
  const target = await getAccount(targetId);
  if (!target || target.role !== 'student' || target.reportsTo !== viewer.id) {
    throw fail('That student is not on your roster.', 404);
  }
  return target;
}

router.get('/students/:id/accommodations', requireRole('professor'), async (req, res, next) => {
  try {
    const target = await ownStudent(req);
    res.json({ accommodations: await getAccommodations(target.id), supports: SUPPORTS });
  } catch (err) {
    next(err);
  }
});

router.put('/students/:id/accommodations', requireRole('professor'), async (req, res, next) => {
  try {
    const target = await ownStudent(req);
    const accommodations = await setAccommodations(target.id, req.body?.accommodations);
    res.json({ accommodations });
  } catch (err) {
    next(err);
  }
});

/**
 * The first HOD, once, on an empty table. After that the only way in is an
 * invite - which is why this refuses on any non-empty accounts table rather
 * than on a flag someone could flip back.
 */
router.post('/bootstrap', async (req, res, next) => {
  let user = null;
  try {
    if ((await countAccounts()) > 0) {
      throw fail('Bootstrap is closed - this deployment already has accounts.', 403);
    }

    const email = normaliseEmail(req.body?.email);
    const password = String(req.body?.password ?? '');
    const fullName = trimmed(req.body?.fullName);
    const department = trimmed(req.body?.department);

    requireCredentials({ email, password, fullName });
    if (!department) throw fail('A department is required for the first HOD.');

    user = await createAuthUser({ email, password, fullName });

    const account = await createAccount({
      authUserId: user.id,
      role: 'hod',
      fullName,
      email,
      department,
      reportsTo: null,
      rollNo: null,
    });

    // Two bootstraps fired at the same instant would both have seen an empty
    // table. Whoever finds company undoes itself; a retry then hits the closed
    // gate above and gets a clear answer instead of a second silent HOD.
    if ((await countAccounts()) > 1) {
      throw fail('Another administrator was created at the same moment - sign in instead.', 409);
    }

    user = null;
    res.status(201).json({ account });
  } catch (err) {
    if (user) await discardAuthUser(user.id);
    next(err);
  }
});

// ------------------------------------------------------------ route bodies --

/**
 * The permission table from V2-CONTRACT section 2, resolved for one account, so
 * the client can hide what it must not offer. It is a mirror of the server's
 * decisions and never the basis for one: every route re-checks.
 */
async function canSeeFor(account) {
  const { ownerIds, includeUnowned } = await scopeFor(account);
  const byRole = {
    hod: {
      team: 'department',
      content: 'read-department',
      sessions: 'department',
      liveGrid: 'department',
      runSessions: false,
      takeSessions: false,
      exports: 'department',
      invite: 'professor',
    },
    professor: {
      team: 'own-students',
      content: 'crud-own',
      sessions: 'own',
      liveGrid: 'own',
      runSessions: true,
      takeSessions: false,
      exports: 'own',
      invite: 'student',
    },
    student: {
      team: 'self',
      content: 'none',
      sessions: 'none',
      liveGrid: 'none',
      runSessions: false,
      takeSessions: true,
      exports: 'self',
      invite: null,
    },
  };
  return { ...byRole[account.role], department: account.department ?? '', ownerIds, includeUnowned };
}

/** Insert with a fresh code, retrying only the one error a redraw can fix. */
async function insertInvite(row) {
  let last;
  for (let attempt = 0; attempt < INVITE_RETRIES; attempt += 1) {
    const { data, error } = await db()
      .from('invites')
      .insert({ ...row, code: makeInviteCode() })
      .select()
      .single();
    if (!error) return data;
    last = error;
    if (error.code !== '23505') throw pgFail('Could not create the invite', error);
  }
  throw pgFail('Could not allocate a free invite code', last);
}

export default router;
