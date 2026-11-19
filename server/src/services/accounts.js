// The accounts data layer - every read and write of public.accounts goes
// through here, and nothing above this file touches the table directly.
//
// Same two translations as repo/supabaseRepo.js, for the same reason: snake_case
// columns become camelCase fields at this boundary and nowhere else, so the rest
// of the server only ever speaks one shape.
//
// Built on the service role key, which bypasses row level security. The schema
// enables RLS with no policies, so this key is the only way into the table -
// which is exactly why it stays server-side and never reaches client/.
// Authorization is decided by the callers of these functions; this module
// enforces no policy of its own beyond what the database itself guarantees.

import { randomInt } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { normalise as normaliseAccommodations } from '../accommodations.js';

/**
 * Crockford base32: the ten digits plus the alphabet without I, L, O or U.
 * I/L look like 1, O looks like 0, and U is dropped so a random draw cannot
 * spell an obscenity. Codes get read off a projector and typed by hand, so the
 * ambiguity matters more than the four lost characters.
 */
export const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_PREFIX = 'BL-';
export const CODE_LENGTH = 6;

// 32^6 is a billion codes, so a collision is vanishingly unlikely - but it is a
// unique column, and "vanishingly unlikely" is not "impossible" once a
// department has a few thousand rows.
const CODE_RETRIES = 5;

// Postgres SQLSTATEs the caller caused, mapped to the HTTP status a route should
// answer with. The hierarchy trigger raises P0001 with a human-readable message
// ('a student must report to a professor, not hod'), which is worth surfacing
// verbatim rather than flattening into a generic 500.
const STATUS_BY_PGCODE = {
  '23505': 409, // unique_violation - duplicate code, or duplicate roll number in a department
  '23503': 400, // foreign_key_violation - reports_to or id points at nothing
  '23514': 400, // check_violation
  '22P02': 400, // invalid_text_representation - a malformed uuid reached the query
  'P0001': 400, // raise exception, i.e. the hierarchy guard
};

/**
 * Default entropy source. Math.random would do - a code is an identifier, never
 * a secret - but randomInt is unbiased over the full 2^32 range and 32 divides
 * it exactly, so every character of the alphabet is drawn equally often.
 */
const defaultRng = () => randomInt(0, 0x100000000) / 0x100000000;

/**
 * A fresh account code: 'BL-' + 6 Crockford base32 characters.
 *
 * Pure and side-effect free. `rng` is any function returning a number in
 * [0, 1) - pass a seeded one to make a test deterministic.
 */
export function makeCode(rng = defaultRng) {
  let body = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // Clamped rather than trusted: a seeded rng that returns exactly 1 would
    // otherwise index off the end of the alphabet and produce 'undefined'.
    const draw = Number(rng());
    const idx = Math.min(CODE_ALPHABET.length - 1, Math.max(0, Math.floor(draw * CODE_ALPHABET.length)));
    body += CODE_ALPHABET[idx];
  }
  return CODE_PREFIX + body;
}

// ----------------------------------------------------------------- client --

let db_;

/**
 * Built on first use, not at import time. `createClient` throws on an empty
 * url, and test/accounts.test.js imports makeCode from this module with no
 * environment loaded at all.
 */
function db() {
  if (!db_) {
    if (!config.supabase.url || !config.supabase.serviceKey) {
      throw new Error('[accounts] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    }
    db_ = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'bloomloop' } },
    });
  }
  return db_;
}

function fail(op, error) {
  const err = new Error(`[accounts] ${op}: ${error.message ?? error}`);
  err.status = STATUS_BY_PGCODE[error.code] ?? 500;
  err.pgCode = error.code;
  throw err;
}

/**
 * True only for a duplicate *code*. The table also carries a unique index on
 * (department, roll_no), which raises the same 23505 - retrying that one would
 * spin five times and then hide a genuine duplicate roll number behind a
 * confusing message.
 */
const isCodeCollision = (error) =>
  error?.code === '23505' && `${error.message ?? ''} ${error.details ?? ''}`.includes('accounts_code_key');

/**
 * The other unique index a write to this table can trip: one Google identity
 * backs at most one account (supabase/migrations/0003_student_google_link.sql). Told apart
 * from the code collision above because this one must never be retried - a
 * redraw fixes a code clash, and nothing fixes "somebody else already linked
 * that Google account" except a person.
 */
const isGoogleSubTaken = (error) =>
  error?.code === '23505' &&
  `${error.message ?? ''} ${error.details ?? ''}`.includes('accounts_google_sub_key');

// ---------------------------------------------------------------- mappers --

const outAccount = (r) =>
  r && {
    id: r.id,
    role: r.role,
    fullName: r.full_name ?? '',
    email: r.email ?? null,
    code: r.code,
    department: r.department ?? '',
    reportsTo: r.reports_to ?? null,
    rollNo: r.roll_no ?? null,
    active: r.active !== false,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

// Stored lower-cased because Supabase Auth lower-cases the address it issues the
// JWT for, and getAccountByEmail has to be able to find that row again.
const normaliseEmail = (email) => {
  const s = String(email ?? '').trim().toLowerCase();
  return s || null;
};

// The three text columns are NOT NULL with a '' default, so an absent value has
// to become '' rather than null.
const text = (value) => (value === undefined || value === null ? '' : String(value));

const optionalText = (value) => (value === undefined || value === null || value === '' ? null : String(value));

/**
 * Roster order: by roll number where both sides have one - a professor's
 * students - and by name otherwise. Numeric collation so '2' precedes '10',
 * which a text column will never do on its own.
 */
function byRoster(a, b) {
  if (a.rollNo && b.rollNo) {
    return String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });
  }
  return a.fullName.localeCompare(b.fullName, undefined, { numeric: true, sensitivity: 'base' });
}

/** Only the fields the caller actually sent, so a patch never blanks a column. */
function pick(patch, map) {
  const out = {};
  for (const [from, to] of Object.entries(map)) {
    if (patch[from] !== undefined) out[to] = patch[from];
  }
  return out;
}

// --------------------------------------------------------------- commands --

/**
 * Create the accounts row for an existing auth user.
 *
 * `authUserId` must already exist in auth.users - accounts.id is a foreign key
 * onto it, which is what keeps one identity per person. The one-edge hierarchy
 * (student -> professor -> hod -> null) is enforced by a database trigger; a
 * bad `reportsTo` comes back as a 400 with the trigger's own wording rather
 * than being re-checked here.
 *
 * `googleSub` arrives only from an invite that was issued off an imported
 * Classroom roster - never from the sign-up form, which is a page a stranger can
 * fill in. It is the same claim a student writes by linking their own Google
 * account later, so it goes in the same column; the difference is who asserted
 * it, and that difference is worth remembering when reading it back.
 */
export async function createAccount({
  authUserId,
  role,
  fullName,
  email,
  department,
  reportsTo,
  rollNo,
  googleSub,
} = {}) {
  if (!authUserId) throw Object.assign(new Error('[accounts] createAccount: authUserId is required'), { status: 400 });
  if (!role) throw Object.assign(new Error('[accounts] createAccount: role is required'), { status: 400 });

  const subject = optionalText(googleSub);

  const base = {
    id: authUserId,
    role,
    full_name: text(fullName),
    email: normaliseEmail(email),
    department: text(department),
    reports_to: reportsTo ?? null,
    roll_no: optionalText(rollNo),
    google_sub: subject,
    // Stamped for the same reason linkGoogle() stamps it: a link with no date on
    // it cannot be aged out or audited without guessing when it happened.
    google_linked_at: subject ? new Date().toISOString() : null,
    // 'roster', never 'student'. A professor imported this student from a course
    // they teach; the student themself has not proved anything yet. The two are
    // different qualities of evidence and the column exists so that no screen has
    // to flatten them into one confident tick.
    google_link_source: subject ? 'roster' : null,
  };

  let last;
  for (let attempt = 0; attempt <= CODE_RETRIES; attempt += 1) {
    const { data, error } = await db()
      .from('accounts')
      .insert({ ...base, code: makeCode() })
      .select()
      .single();
    if (!error) return outAccount(data);
    last = error;
    // Never retried, and told apart from a code clash on purpose: a redraw fixes
    // a duplicate code, and nothing this loop can do fixes two people claiming
    // one Google identity. Said in words, because the student reading it is
    // holding an invite and needs to know it is the invite that is wrong.
    if (isGoogleSubTaken(error)) {
      throw Object.assign(
        new Error(
          'The invite you used was issued for a Google Classroom student who already has a '
          + 'BloomLoop account. Ask your professor for a fresh invite.',
        ),
        { status: 409 },
      );
    }
    if (!isCodeCollision(error)) fail('createAccount', error);
  }
  fail('createAccount', last);
}

/** Patch an account. The route decides which of these a given caller may touch. */
export async function updateAccount(id, patch = {}) {
  const set = pick(patch, {
    role: 'role',
    department: 'department',
    reportsTo: 'reports_to',
    active: 'active',
  });
  if (patch.fullName !== undefined) set.full_name = text(patch.fullName);
  if (patch.email !== undefined) set.email = normaliseEmail(patch.email);
  if (patch.rollNo !== undefined) set.roll_no = optionalText(patch.rollNo);
  if (Object.keys(set).length === 0) return getAccount(id);

  // No updated_at trigger on the table, so the timestamp is set here or not at all.
  set.updated_at = new Date().toISOString();

  const { data, error } = await db().from('accounts').update(set).eq('id', id).select().maybeSingle();
  if (error) fail('updateAccount', error);
  return outAccount(data);
}

/**
 * Deactivate or reinstate an account. Rows are never deleted: contents,
 * sessions and profiles reference them, and a graduated student's results have
 * to survive.
 */
export async function setActive(id, active) {
  return updateAccount(id, { active: Boolean(active) });
}

// ------------------------------------------------------------------ reads --

export async function getAccount(id) {
  if (!id) return null;
  const { data, error } = await db().from('accounts').select('*').eq('id', id).maybeSingle();
  if (error) fail('getAccount', error);
  return outAccount(data);
}

export async function getAccountByCode(code) {
  const wanted = String(code ?? '').trim().toUpperCase();
  if (!wanted) return null;
  const { data, error } = await db().from('accounts').select('*').eq('code', wanted).maybeSingle();
  if (error) fail('getAccountByCode', error);
  return outAccount(data);
}

export async function getAccountByEmail(email) {
  const wanted = normaliseEmail(email);
  if (!wanted) return null;
  const { data, error } = await db().from('accounts').select('*').eq('email', wanted).maybeSingle();
  if (error) fail('getAccountByEmail', error);
  return outAccount(data);
}

/** Roll numbers compare the way the live room stores them: trimmed, single-spaced, upper case. */
export const rollKey = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * The student account a room roll number belongs to, on the room owner's roster.
 *
 * Found only when exactly one active student reporting to `ownerId` carries
 * that roll number. None or several means none: guessing would attach one
 * student's supports to another student's phone.
 *
 * Since decision 7 (19 Nov 2026) the live loop reads only the supports from
 * this: a typed roll number never links a room profile to the account any more.
 * Only the phone presenting that signed-in student's token does
 * (verifyAccountToken in auth.js, at student:join).
 *
 * Returns the id and the stored supports; nothing else about the account leaves.
 *
 * @returns {Promise<{id: string, accommodations: object} | null>}
 */
export async function findStudentForRoll(ownerId, rollNo) {
  const wanted = rollKey(rollNo);
  if (!ownerId || !wanted) return null;
  const { data, error } = await db()
    .from('accounts')
    .select('id, roll_no, accommodations')
    .eq('role', 'student')
    .eq('reports_to', ownerId)
    .eq('active', true)
    .limit(1000);
  if (error) fail('findStudentForRoll', error);
  const matches = (data ?? []).filter((r) => rollKey(r.roll_no) === wanted);
  if (matches.length !== 1) return null;
  return { id: matches[0].id, accommodations: normaliseAccommodations(matches[0].accommodations) };
}

/** A student's stored supports, normalised. Empty for an unknown id. */
export async function getAccommodations(id) {
  if (!id) return {};
  const { data, error } = await db().from('accounts').select('accommodations').eq('id', id).maybeSingle();
  if (error) fail('getAccommodations', error);
  return normaliseAccommodations(data?.accommodations);
}

/** Replace a student's supports. Unknown keys and non-true values are dropped by normalise(). */
export async function setAccommodations(id, raw) {
  const value = normaliseAccommodations(raw);
  const { data, error } = await db()
    .from('accounts')
    .update({ accommodations: value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('accommodations')
    .maybeSingle();
  if (error) fail('setAccommodations', error);
  return normaliseAccommodations(data?.accommodations);
}

/** How many accounts exist at all - the gate POST /bootstrap opens exactly once. */
export async function countAccounts() {
  const { count, error } = await db().from('accounts').select('id', { count: 'exact', head: true });
  if (error) fail('countAccounts', error);
  return count ?? 0;
}

// -------------------------------------------------------- google identity --
//
// A student may link their own Google account so a posted grade lands on their
// exact Google user instead of on whoever the roster matcher guessed. Only the
// identifier is kept: the flow that writes it asks for identity scopes alone and
// revokes the access token before it answers, so there is no token in this table
// and nothing here that can be spent.

/** The columns that make up a link, in one place so the three reads cannot drift. */
const LINK_COLUMNS = 'google_sub, google_email, google_linked_at, google_link_source';

/**
 * The link as the browser is allowed to see it: whether, which address, when,
 * and how. `google_sub` deliberately never crosses this boundary - it is the
 * server's join key to Google and a screen has no use for it, so it does not
 * travel anywhere it is not needed.
 */
const outGoogleLink = (r) => ({
  linked: Boolean(r?.google_sub),
  email: r?.google_email ?? null,
  linkedAt: r?.google_linked_at ?? null,
  source: r?.google_link_source ?? null,
});

export async function getGoogleLink(accountId) {
  if (!accountId) return outGoogleLink(null);
  const { data, error } = await db()
    .from('accounts')
    .select(LINK_COLUMNS)
    .eq('id', accountId)
    .maybeSingle();
  if (error) fail('getGoogleLink', error);
  return outGoogleLink(data);
}

/**
 * Attach a Google identity to an account.
 *
 * `sub` comes from an id_token this server fetched from Google itself, never
 * from anything a browser said. The unique index makes the SECOND account to
 * claim an identity fail rather than quietly win, which is why that 23505 is
 * turned into a sentence a student can act on instead of a 500 - "already linked
 * elsewhere" is a fact about the world, not a bug.
 *
 * `source` records how we came to believe it. A student who signed in is not the
 * same quality of evidence as a row off an imported spreadsheet, and grade
 * posting is allowed to say so.
 */
export async function linkGoogle(accountId, { sub, email, source = 'student' } = {}) {
  if (!accountId) throw Object.assign(new Error('[accounts] linkGoogle: an account id is required'), { status: 400 });
  const subject = String(sub ?? '').trim();
  if (!subject) throw Object.assign(new Error('[accounts] linkGoogle: a Google subject is required'), { status: 400 });

  const { data, error } = await db()
    .from('accounts')
    .update({
      google_sub: subject,
      google_email: normaliseEmail(email),
      google_linked_at: new Date().toISOString(),
      google_link_source: source,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .select(LINK_COLUMNS)
    .maybeSingle();

  if (error) {
    if (isGoogleSubTaken(error)) {
      throw Object.assign(
        new Error('That Google account is already linked to a different BloomLoop account.'),
        { status: 409 },
      );
    }
    fail('linkGoogle', error);
  }
  if (!data) throw Object.assign(new Error('That BloomLoop account no longer exists.'), { status: 404 });
  return outGoogleLink(data);
}

/**
 * Drop the link, every column of it.
 *
 * Idempotent: unlinking an account that was never linked is a success, because
 * the state the caller asked for is the state they get. All four columns go
 * together - leaving the address or the timestamp behind would keep a record of
 * an account the student just asked us to forget.
 */
export async function unlinkGoogle(accountId) {
  if (!accountId) return outGoogleLink(null);
  const { data, error } = await db()
    .from('accounts')
    .update({
      google_sub: null,
      google_email: null,
      google_linked_at: null,
      google_link_source: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId)
    .select(LINK_COLUMNS)
    .maybeSingle();
  if (error) fail('unlinkGoogle', error);
  return outGoogleLink(data);
}

/**
 * Every linked student in one department, with the identifier, for the grade
 * poster to index by roll number.
 *
 * Scoped by department because that is where the roll number is actually unique
 * - the table carries a unique index on (department, roll_no) and nothing wider.
 * Asking across departments would reintroduce the collision the caller then has
 * to guard against all over again.
 *
 * Deactivated students are included: `active` governs what an account may do,
 * not who its holder is, and a student deactivated after the session still has
 * to be gradeable for the session they sat.
 */
export async function listLinkedStudents(department) {
  const dept = String(department ?? '').trim();
  if (!dept) return [];
  const { data, error } = await db()
    .from('accounts')
    .select('id, full_name, roll_no, google_sub, google_link_source')
    .eq('department', dept)
    .eq('role', 'student')
    .not('google_sub', 'is', null);
  if (error) fail('listLinkedStudents', error);
  return (data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name ?? '',
    rollNo: r.roll_no ?? null,
    googleSub: r.google_sub,
    linkSource: r.google_link_source ?? null,
  }));
}

/**
 * Does any account already carry this Google identity?
 *
 * A boolean and nothing else. The caller is a professor importing a Classroom
 * roster, and what they need to know is "will this invite be redeemable" - not
 * who the existing account belongs to, which may be a student in a department
 * they cannot see.
 *
 * Deliberately a convenience, never the guard. The unique index on google_sub is
 * the guard; two invites issued for the same student before either is redeemed
 * both pass this check and the second redemption is the one that fails, which is
 * exactly the outcome the index exists to produce.
 */
export async function googleSubLinked(sub) {
  const subject = String(sub ?? '').trim();
  if (!subject) return false;
  const { count, error } = await db()
    .from('accounts')
    .select('id', { count: 'exact', head: true })
    .eq('google_sub', subject);
  if (error) fail('googleSubLinked', error);
  return (count ?? 0) > 0;
}

/**
 * Every descendant of `rootId` at any depth, flat. The recursion is the
 * accounts_below() SQL function, so one round trip covers a whole department
 * however deep it gets - and the root itself is not in the result.
 */
export async function listBelow(rootId) {
  if (!rootId) return [];
  const { data, error } = await db().rpc('accounts_below', { root: rootId });
  if (error) fail('listBelow', error);
  return (data ?? []).map(outAccount).sort(byRoster);
}

/**
 * The same people as listBelow, nested: [{account, children:[…]}].
 *
 * Assembled in JS from the one flat query rather than with a query per level,
 * because a department read happens on every /team load.
 */
export async function buildTree(rootId) {
  const flat = await listBelow(rootId);
  const nodes = new Map(flat.map((account) => [account.id, { account, children: [] }]));

  const roots = [];
  for (const account of flat) {
    const parent = nodes.get(account.reportsTo);
    // No parent in the set means the account hangs directly off the root. An
    // orphan cannot occur - accounts_below only returns reachable rows - but
    // treating it as top level keeps a surprise visible instead of dropping it.
    if (parent && parent.account.id !== account.id) parent.children.push(nodes.get(account.id));
    else roots.push(nodes.get(account.id));
  }
  return roots;
}
