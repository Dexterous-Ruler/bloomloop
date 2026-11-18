// Migrations - the proof that supabase/migrations builds a working database from
// nothing, and can be run again on one that already has it.
//
//   npm run migrations          (from server/)
//
// Runs every file in supabase/migrations, in number order, against an in-memory
// Postgres (PGlite, a dev-only dependency), then runs them all again, then uses
// the result the way the server does: an HOD -> professor -> student chain,
// accounts_below(), a chapter, questions of several kinds, a room with settings,
// a profile, and an answer. A second database starts as a v1 deployment holding
// data and is upgraded, to show the set never touches existing rows.
//
// Supabase provides the auth schema; here a stub auth.users stands in for it.
// No network, no keys, nothing written to disk.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SUPABASE_DIR = fileURLToPath(new URL('../../supabase/', import.meta.url));
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, 'migrations');

// ------------------------------------------------------------------ report --

let passed = 0;
let failed = 0;

function check(label, ok, detail = '') {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? `\n      ${detail}` : ''}`);
  return ok;
}

const section = (title) => console.log(`\n-- ${title}`);

/** The statement must succeed. Returns its rows, or null if it threw. */
async function accepts(label, run) {
  try {
    const result = await run();
    check(label, true);
    return result?.rows ?? [];
  } catch (err) {
    check(label, false, `${err.code ?? ''} ${err.message}`);
    return null;
  }
}

/** The statement must fail with this SQLSTATE (and, optionally, a message). */
async function rejects(label, run, { code, match } = {}) {
  try {
    await run();
    check(label, false, 'the database accepted it');
  } catch (err) {
    const okCode = !code || err.code === code;
    const okMessage = !match || match.test(`${err.message} ${err.detail ?? ''}`);
    check(label, okCode && okMessage, `got ${err.code ?? '?'}: ${err.message}`);
  }
}

// -------------------------------------------------------------- migrations --

async function migrationFiles() {
  const names = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(path.join(MIGRATIONS_DIR, name), 'utf8') })),
  );
}

/** Each file in one go, as the SQL editor or `psql -f` would run it. Stops at the first failure. */
async function applyAll(db, files, pass) {
  for (const { name, sql } of files) {
    try {
      await db.exec(sql);
      check(`apply ${name} (${pass})`, true);
    } catch (err) {
      check(`apply ${name} (${pass})`, false, `${err.code ?? ''} ${err.message}`);
      return false;
    }
  }
  return true;
}

async function freshDatabase() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  // Supabase owns this schema; the migrations only reference auth.users(id).
  await db.exec('create schema if not exists auth; create table if not exists auth.users (id uuid primary key);');
  return db;
}

/**
 * Everything a re-run could duplicate or alter, as sorted text: columns,
 * constraints, indexes, triggers, functions (with their bodies), enum labels and
 * row level security. Two equal snapshots mean a pass changed nothing.
 */
async function snapshot(db) {
  const { rows } = await db.query(`
    select 'column ' || table_name || '.' || column_name || ' ' || data_type || ' '
           || is_nullable || ' ' || coalesce(column_default, '') as line
      from information_schema.columns where table_schema = 'public'
    union all
    select 'constraint ' || conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid)
      from pg_constraint where connamespace = 'public'::regnamespace
    union all
    select 'index ' || indexdef from pg_indexes where schemaname = 'public'
    union all
    select 'trigger ' || tgrelid::regclass::text || '.' || tgname || ' ' || pg_get_triggerdef(oid)
      from pg_trigger where not tgisinternal
    union all
    select 'function ' || p.oid::regprocedure::text || ' ' || pg_get_function_result(p.oid) || ' ' || md5(p.prosrc)
      from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all
    select 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
      from pg_type t join pg_enum e on e.enumtypid = t.oid
     where t.typnamespace = 'public'::regnamespace group by t.typname
    union all
    select 'rls ' || relname || ' ' || relrowsecurity::text
      from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
    order by 1`);
  return rows.map((r) => r.line);
}

function sameSnapshot(label, a, b) {
  const gone = a.filter((line) => !b.includes(line));
  const added = b.filter((line) => !a.includes(line));
  check(label, gone.length === 0 && added.length === 0,
    [...gone.map((l) => `- ${l}`), ...added.map((l) => `+ ${l}`)].slice(0, 12).join('\n      '));
}

async function rowCounts(db) {
  const out = {};
  for (const table of ['contents', 'questions', 'sessions', 'profiles', 'accounts', 'invites', 'answers', 'room_archives',
    'answer_reviews']) {
    const exists = await db.query(`select to_regclass('public.${table}') is not null as ok`);
    if (!exists.rows[0].ok) continue;
    out[table] = Number((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n);
  }
  return out;
}

// Every column server/src/repo/supabaseRepo.js, server/src/services/accounts.js
// and server/src/routes/auth.js read or write. A column added there without a
// migration should be added here too, and this check then says so.
const COLUMNS_THE_SERVER_USES = {
  contents: ['id', 'title', 'kind', 'raw_text', 'topics', 'owner_id', 'created_at'],
  questions: ['id', 'content_id', 'topic', 'text', 'kind', 'options', 'answer_idx', 'bloom', 'status',
    'source', 'payload', 'created_at'],
  sessions: ['id', 'code', 'content_id', 'title', 'status', 'owner_id', 'started_at', 'closed_at', 'paused_at',
    'mastery_goal', 'reattempts', 'redemption'],
  profiles: ['id', 'session_id', 'roll_no', 'name', 'levels', 'working_level', 'reason', 'history', 'served_id',
    'served_at', 'served_why', 'served_tries', 'served_last', 'integrity', 'account_id', 'updated_at'],
  answers: ['id', 'session_id', 'answer_key', 'roll_no', 'account_id', 'question_id', 'content_id', 'topic', 'bloom',
    'kind', 'question_snapshot', 'response', 'attempt', 'final', 'correct', 'score', 'detail', 'ungraded',
    'language', 'question_source', 'served_at', 'answered_at', 'review_status', 'auto_correct', 'auto_score',
    'auto_detail', 'reviewed_by', 'reviewed_at', 'review_note', 'confidence'],
  accounts: ['id', 'role', 'full_name', 'email', 'code', 'department', 'reports_to', 'roll_no', 'active',
    'created_at', 'updated_at', 'google_sub', 'google_email', 'google_linked_at', 'google_link_source',
    'accommodations'],
  invites: ['code', 'role', 'department', 'reports_to', 'created_by', 'email', 'roll_no', 'full_name',
    'expires_at', 'used_by', 'used_at', 'created_at', 'google_sub'],
  room_archives: ['id', 'session_id', 'code', 'title', 'owner_id', 'archived_by', 'archived_at', 'bytes', 'data'],
  answer_reviews: ['id', 'answer_id', 'session_id', 'decision', 'correct', 'score', 'note', 'reviewed_by',
    'reviewed_at'],
};

// The fields outAccount() in services/accounts.js reads off an accounts_below() row.
const OUT_ACCOUNT_FIELDS = ['id', 'role', 'full_name', 'email', 'code', 'department', 'reports_to', 'roll_no',
  'active', 'created_at', 'updated_at'];

// ------------------------------------------------------------------- files --

section('migration files');

const files = await migrationFiles();
check('supabase/migrations holds at least one file', files.length > 0);

const numbers = files.map((f) => /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f.name)?.[1]);
check('every file is named NNNN_name.sql', numbers.every(Boolean), files.map((f) => f.name).join(', '));
check('numbers are unique and run 0000, 0001, ... without gaps',
  numbers.every((n, i) => Number(n) === i), numbers.join(', '));

const loose = (await readdir(SUPABASE_DIR)).filter((n) => n.endsWith('.sql'));
check('no loose .sql files left in supabase/ (one source of truth)', loose.length === 0, loose.join(', '));

// ---------------------------------------------------------- fresh database --

section('fresh database: build, then build again');

const db = await freshDatabase();
if (!(await applyAll(db, files, 'pass 1'))) {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
const afterFirst = await snapshot(db);
await applyAll(db, files, 'pass 2');
sameSnapshot('pass 2 created, dropped or changed nothing', afterFirst, await snapshot(db));

section('every column the server touches exists');

for (const [table, wanted] of Object.entries(COLUMNS_THE_SERVER_USES)) {
  const { rows } = await db.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  );
  const have = new Set(rows.map((r) => r.column_name));
  const missing = wanted.filter((c) => !have.has(c));
  check(`${table}: ${wanted.length} columns present`, missing.length === 0, `missing: ${missing.join(', ')}`);
}

section('row level security');

{
  const { rows } = await db.query(`
    select c.relname, c.relrowsecurity
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'`);
  const off = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
  check(`RLS enabled on all ${rows.length} public tables`, off.length === 0, `off: ${off.join(', ')}`);
  const policies = await db.query(`select count(*)::int as n from pg_policies where schemaname = 'public'`);
  check('no RLS policies anywhere (service role key is the only way in)', policies.rows[0].n === 0);
}

// ------------------------------------------------------------- hierarchy --

section('accounts and the hierarchy');

const HOD = randomUUID();
const PROF = randomUUID();
const STUDENT = randomUUID();
const STUDENT_2 = randomUUID();
const STRANGER = randomUUID(); // has a sign-in, used for the rejected inserts
await db.query('insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)', [HOD, PROF, STUDENT, STUDENT_2, STRANGER]);

const insertAccount = (a) =>
  db.query(
    `insert into public.accounts (id, role, full_name, email, code, department, reports_to, roll_no)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [a.id, a.role, a.fullName ?? '', a.email ?? null, a.code, a.department ?? 'CSE', a.reportsTo ?? null, a.rollNo ?? null],
  );

await accepts('an HOD reporting to nobody', () =>
  insertAccount({ id: HOD, role: 'hod', fullName: 'Head', email: 'hod@example.test', code: 'BL-HD0001' }));
await accepts('a professor reporting to the HOD', () =>
  insertAccount({ id: PROF, role: 'professor', fullName: 'Prof', email: 'prof@example.test', code: 'BL-PR0001', reportsTo: HOD }));
await accepts('a student reporting to the professor', () =>
  insertAccount({ id: STUDENT, role: 'student', fullName: 'Student', email: 'stu@example.test', code: 'BL-ST0001', reportsTo: PROF, rollNo: '07' }));
await accepts('a second student reporting to the professor', () =>
  insertAccount({ id: STUDENT_2, role: 'student', fullName: 'Student Two', email: 'stu2@example.test', code: 'BL-ST0002', reportsTo: PROF, rollNo: '08' }));

{
  const { rows } = await db.query('select * from public.accounts_below($1)', [HOD]);
  const ids = new Set(rows.map((r) => r.id));
  check('accounts_below(HOD) returns the professor and both students, not the HOD',
    rows.length === 3 && ids.has(PROF) && ids.has(STUDENT) && ids.has(STUDENT_2) && !ids.has(HOD),
    JSON.stringify(rows.map((r) => r.code)));
  const missing = OUT_ACCOUNT_FIELDS.filter((f) => !(f in (rows[0] ?? {})));
  check('accounts_below rows carry every field outAccount() reads', missing.length === 0, `missing: ${missing.join(', ')}`);
  const student = rows.find((r) => r.id === STUDENT);
  check('accounts_below row values come back intact (role, reports_to, roll_no, active)',
    student?.role === 'student' && student?.reports_to === PROF && student?.roll_no === '07' && student?.active === true);

  const underProf = await db.query('select id from public.accounts_below($1)', [PROF]);
  check('accounts_below(professor) returns only their students',
    underProf.rows.length === 2 && underProf.rows.every((r) => r.id === STUDENT || r.id === STUDENT_2));
  const underStudent = await db.query('select id from public.accounts_below($1)', [STUDENT]);
  check('accounts_below(student) is empty', underStudent.rows.length === 0);
}

await rejects('a student reporting to an HOD', () =>
  insertAccount({ id: STRANGER, role: 'student', code: 'BL-XX0001', reportsTo: HOD, rollNo: '99' }),
{ code: 'P0001', match: /a student must report to a professor, not hod/ });
await rejects('a professor reporting to nobody', () =>
  insertAccount({ id: STRANGER, role: 'professor', code: 'BL-XX0001' }),
{ code: 'P0001', match: /a professor must report to an hod/ });
await rejects('a professor reporting to a student', () =>
  insertAccount({ id: STRANGER, role: 'professor', code: 'BL-XX0001', reportsTo: STUDENT }),
{ code: 'P0001', match: /not student/ });
await rejects('an HOD reporting to someone', () =>
  insertAccount({ id: STRANGER, role: 'hod', code: 'BL-XX0001', reportsTo: PROF }),
{ code: 'P0001' });
await rejects('moving an existing student under the HOD', () =>
  db.query('update public.accounts set reports_to = $1 where id = $2', [HOD, STUDENT]),
{ code: 'P0001' });
await rejects('reporting to an account that does not exist (foreign key, not the trigger)', () =>
  insertAccount({ id: STRANGER, role: 'student', code: 'BL-XX0001', reportsTo: randomUUID(), rollNo: '98' }),
{ code: '23503' });
await accepts('renaming an account does not re-run the hierarchy check', () =>
  db.query(`update public.accounts set full_name = 'Renamed', updated_at = now() where id = $1`, [STUDENT]));

section('accounts: identity and uniqueness');

await rejects('an account with no matching auth.users row', () =>
  insertAccount({ id: randomUUID(), role: 'hod', code: 'BL-XX0002' }),
{ code: '23503' });
await rejects('a role outside hod/professor/student', () =>
  insertAccount({ id: STRANGER, role: 'admin', code: 'BL-XX0003' }),
{ code: '22P02' });
await rejects('a code that is not BL- plus six Crockford characters', () =>
  insertAccount({ id: STRANGER, role: 'hod', code: 'BL-IL0001' }),
{ code: '23514' });
await rejects('a duplicate code, named accounts_code_key so the server retries it', () =>
  insertAccount({ id: STRANGER, role: 'hod', code: 'BL-HD0001' }),
{ code: '23505', match: /accounts_code_key/ });
await rejects('a duplicate email', () =>
  insertAccount({ id: STRANGER, role: 'hod', code: 'BL-XX0004', email: 'hod@example.test' }),
{ code: '23505', match: /accounts_email_key/ });
{
  let err = null;
  try {
    await insertAccount({ id: STRANGER, role: 'student', code: 'BL-XX0005', reportsTo: PROF, rollNo: '07' });
  } catch (e) {
    err = e;
  }
  check('a duplicate roll number in one department is refused, and not mistaken for a code collision',
    err?.code === '23505' && !/accounts_code_key/.test(`${err.message} ${err.detail ?? ''}`),
    err ? `${err.code}: ${err.message}` : 'the database accepted it');
}
await accepts('the same roll number in another department', () =>
  insertAccount({ id: STRANGER, role: 'student', code: 'BL-XX0006', department: 'ECE', reportsTo: PROF, rollNo: '07' }));
await db.query('delete from public.accounts where id = $1', [STRANGER]);

// 0011: a room trims, single-spaces and upper-cases every roll number, so two
// accounts that differ only in that way are one student to it.
{
  const TWIN = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [TWIN]);
  await accepts('a roll number with letters and a space', () =>
    insertAccount({ id: STRANGER, role: 'student', code: 'BL-XX0007', reportsTo: PROF, rollNo: '21CS 01' }));
  let err = null;
  try {
    await insertAccount({ id: TWIN, role: 'student', code: 'BL-XX0008', reportsTo: PROF, rollNo: ' 21cs  01' });
  } catch (e) {
    err = e;
  }
  check('the same roll number in another case and spacing, in one department, is refused (0011), not taken for a code collision',
    err?.code === '23505' && /accounts_department_roll_key/.test(err.message) && !/accounts_code_key/.test(err.message),
    err ? `${err.code}: ${err.message}` : 'the database accepted it');
  await accepts('and in another department it is a different student', () =>
    insertAccount({ id: TWIN, role: 'student', code: 'BL-XX0008', department: 'ECE', reportsTo: PROF, rollNo: '21cs 01' }));
  await db.query('delete from public.accounts where id = any($1)', [[STRANGER, TWIN]]);
  await db.query('delete from auth.users where id = $1', [TWIN]);
}

await accepts('linking a Google identity', () =>
  db.query(`update public.accounts set google_sub = '1234567890', google_email = 'g@example.test',
            google_linked_at = now(), google_link_source = 'student' where id = $1`, [STUDENT]));
await rejects('the same Google identity on a second account', () =>
  db.query(`update public.accounts set google_sub = '1234567890' where id = $1`, [STUDENT_2]),
{ code: '23505', match: /accounts_google_sub_key/ });
await rejects('a google_link_source other than roster/student', () =>
  db.query(`update public.accounts set google_link_source = 'guess' where id = $1`, [STUDENT]),
{ code: '23514' });
await accepts('accommodations as an object', () =>
  db.query(`update public.accounts set accommodations = '{"largerText": true}' where id = $1`, [STUDENT]));
await rejects('accommodations as an array', () =>
  db.query(`update public.accounts set accommodations = '[]' where id = $1`, [STUDENT]),
{ code: '23514' });

section('invites');

await accepts('a professor invites a student (with a Classroom id)', () =>
  db.query(`insert into public.invites (code, role, department, reports_to, created_by, email, roll_no, full_name, google_sub)
            values ('ABCD2345', 'student', 'CSE', $1, $1, 'new@example.test', '09', 'New Student', '998877')`, [PROF]));
{
  const claim = () =>
    db.query(`update public.invites set used_by = $1, used_at = now()
              where code = 'ABCD2345' and used_by is null and expires_at > now() returning *`, [STRANGER]);
  const first = await claim();
  const second = await claim();
  check('an invite is claimed once by the conditional update, and only once',
    first.rows.length === 1 && second.rows.length === 0 && first.rows[0].google_sub === '998877');
}

// ------------------------------------------------------- content and rooms --

section('content, questions, sessions, profiles, answers');

const [content] = (await accepts('a chapter owned by the professor', () =>
  db.query(`insert into public.contents (title, kind, raw_text, topics, owner_id)
            values ('Chapter 1', 'pptx', 'text', '["Sets"]', $1) returning *`, [PROF]))) ?? [];
await accepts('a pre-accounts chapter with no owner', () =>
  db.query(`insert into public.contents (title, kind) values ('Legacy', 'syllabus')`));

const insertQuestion = (q) =>
  db.query(
    `insert into public.questions (content_id, topic, text, kind, options, answer_idx, bloom, status, source, payload)
     values ($1, 'Sets', $2, $3, $4, $5, $6, 'active', $7, $8) returning *`,
    [content?.id, q.text, q.kind, q.options === null ? null : JSON.stringify(q.options), q.answerIdx ?? null,
      q.bloom, q.source ?? 'llm', JSON.stringify(q.payload ?? {})],
  );

const [mcq] = (await accepts('an mcq: four options and answer_idx', () =>
  insertQuestion({ text: 'Pick one', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 2, bloom: 'remember' }))) ?? [];
await accepts('a multi: six options, answers in the payload', () =>
  insertQuestion({ text: 'Pick all', kind: 'multi', options: ['a', 'b', 'c', 'd', 'e', 'f'], bloom: 'analyse',
    payload: { answerIdxs: [0, 3] } }));
const [match] = (await accepts('a match: no options, no answer_idx, pairs in the payload', () =>
  insertQuestion({ text: 'Pair them', kind: 'match', options: null, bloom: 'understand', source: 'fallback',
    payload: { pairs: [['x', '1'], ['y', '2']], stimulus: { kind: 'passage', text: 'Read this' } } }))) ?? [];
await accepts('an edited question saved with an empty options list', () =>
  db.query(`update public.questions set options = '[]', kind = 'open', payload = '{"rubric": ["a point"]}' where id = $1`, [match?.id]));
{
  const { rows } = await db.query('select kind, payload, options, answer_idx from public.questions where id = $1', [match?.id]);
  check('kind and payload read back as written',
    rows[0]?.kind === 'open' && Array.isArray(rows[0]?.payload?.rubric) && rows[0]?.answer_idx === null);
  const legacy = await db.query(
    `insert into public.questions (content_id, text, options, answer_idx, bloom)
     values ($1, 'v1 insert', '["a","b","c","d"]', 0, 'apply') returning kind, payload`, [content?.id]);
  check('a v1-shaped insert gets kind mcq and an empty payload',
    legacy.rows[0]?.kind === 'mcq' && JSON.stringify(legacy.rows[0]?.payload) === '{}');
}
await rejects('answer_idx outside 0..3', () =>
  insertQuestion({ text: 'Bad', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 4, bloom: 'remember' }),
{ code: '23514' });

const [session] = (await accepts('a room owned by the professor, with mastery settings', () =>
  db.query(`insert into public.sessions (code, content_id, title, status, owner_id, mastery_goal, reattempts, redemption)
            values ('ROOM01', $1, 'Period 3', 'open', $2, 0.90, 1, true) returning *`, [content?.id, PROF]))) ?? [];
check('mastery settings read back', Number(session?.mastery_goal) === 0.9 && session?.reattempts === 1 && session?.redemption === true);
{
  const defaults = await db.query(
    `insert into public.sessions (code, content_id) values ('ROOM02', $1) returning mastery_goal, reattempts, redemption, owner_id`,
    [content?.id]);
  const d = defaults.rows[0];
  check('a room opened without settings gets 0.80, no retries, no redemption, no owner',
    Number(d?.mastery_goal) === 0.8 && d?.reattempts === 0 && d?.redemption === false && d?.owner_id === null);
}
await accepts('pausing a room', () =>
  db.query(`update public.sessions set status = 'paused', paused_at = now() where id = $1`, [session?.id]));
await rejects('a mastery goal of 85%', () =>
  db.query(`insert into public.sessions (code, content_id, mastery_goal) values ('ROOM03', $1, 0.85)`, [content?.id]),
{ code: '23514' });
await rejects('three reattempts', () =>
  db.query(`insert into public.sessions (code, content_id, reattempts) values ('ROOM04', $1, 3)`, [content?.id]),
{ code: '23514' });

// The same upsert saveProfile() sends, twice: one row, the second write wins.
const saveProfile = (tries) =>
  db.query(
    `insert into public.profiles (session_id, roll_no, name, levels, working_level, reason, history,
       served_id, served_at, served_why, served_tries, served_last, integrity, account_id, updated_at)
     values ($1, '07', 'Student', '{"remember": {"n": 1}}', 'apply', 'Promoted', $2,
       $3, now(), 'next up', $4, 'hash', '[{"type": "blur", "at": "2026-11-18T10:00:00Z"}]', $5, now())
     on conflict (session_id, roll_no) do update set
       history = excluded.history, served_tries = excluded.served_tries, account_id = excluded.account_id,
       updated_at = excluded.updated_at
     returning *`,
    [session?.id, JSON.stringify([{ q: mcq?.id, level: 'remember', correct: true, topic: 'Sets' }]), mcq?.id, tries, STUDENT],
  );
await accepts('a profile with history, the pin, integrity and account_id', () => saveProfile(0));
await accepts('the same profile saved again (reconnect)', () => saveProfile(1));
{
  const { rows } = await db.query('select * from public.profiles where session_id = $1', [session?.id]);
  check('the reconnect updated the one row instead of adding a second',
    rows.length === 1 && rows[0].served_tries === 1 && rows[0].account_id === STUDENT
    && Array.isArray(rows[0].integrity) && rows[0].history[0]?.topic === 'Sets');
}

/** a[key] when the caller passed it, null included; otherwise the fallback. */
const given = (a, key, fallback) => (key in a ? a[key] : fallback);

const insertAnswer = (a) =>
  db.query(
    `insert into public.answers (session_id, answer_key, roll_no, account_id, question_id, content_id, topic, bloom,
       kind, question_snapshot, response, attempt, final, correct, score, detail, ungraded, language,
       question_source, served_at, review_status, auto_correct, auto_score, auto_detail, confidence)
     values ($1, $2, '07', $3, $4, $5, 'Sets', $6, 'mcq', $7, $8, $9, $10, $11, $12, 'Right', false, 'en',
       'llm', now(), $13, $11, $12, 'Right', $14) returning *`,
    [a.sessionId ?? session?.id, a.key, STUDENT, a.questionId ?? mcq?.id, content?.id, a.bloom ?? 'remember',
      JSON.stringify({ text: 'Pick one', options: ['a', 'b', 'c', 'd'], answerIdx: 2 }), JSON.stringify({ choice: 2 }),
      given(a, 'attempt', 1), given(a, 'final', true), given(a, 'correct', true), given(a, 'score', 1),
      given(a, 'reviewStatus', 'auto'), given(a, 'confidence', null)],
  );

const [answer] = (await accepts('an answer with its snapshot, response and automatic mark', () =>
  insertAnswer({ key: 'k-1' }))) ?? [];
check('the answer reads back with defaults filled',
  answer?.review_status === 'auto' && Number(answer?.score) === 1 && answer?.response?.choice === 2
  && answer?.question_snapshot?.answerIdx === 2 && answer?.review_note === '' && answer?.answered_at instanceof Date);
await rejects('the same (session_id, answer_key) twice', () => insertAnswer({ key: 'k-1' }),
  { code: '23505', match: /answers_session_answer_key_key/ });
{
  const other = await db.query(`insert into public.sessions (code, content_id) values ('ROOM05', $1) returning id`, [content?.id]);
  await accepts('the same answer_key in another room', () => insertAnswer({ key: 'k-1', sessionId: other.rows[0].id }));
}
await accepts('a wrong first attempt kept with final = false', () =>
  insertAnswer({ key: 'k-2', attempt: 1, final: false, correct: false, score: 0 }));
await accepts('a written answer waiting for review, with a confidence tap', () =>
  insertAnswer({ key: 'k-3', reviewStatus: 'provisional', correct: null, score: null, confidence: 'think' }));
await accepts('a professor overrides the mark beside the automatic one', () =>
  db.query(`update public.answers set correct = false, score = 0, review_status = 'overridden', reviewed_by = $1,
            reviewed_at = now(), review_note = 'Wrong unit' where id = $2`, [PROF, answer?.id]));
{
  const { rows } = await db.query('select auto_correct, auto_score, correct from public.answers where id = $1', [answer?.id]);
  check('the automatic assessment survives the override',
    rows[0]?.auto_correct === true && Number(rows[0]?.auto_score) === 1 && rows[0]?.correct === false);
}
await rejects('a bloom level spelt "analyze"', () => insertAnswer({ key: 'k-4', bloom: 'analyze' }), { code: '23514' });
await rejects('a review_status outside auto/provisional/confirmed/overridden', () =>
  insertAnswer({ key: 'k-5', reviewStatus: 'pending' }), { code: '23514' });
await rejects('a confidence outside sure/think/guess', () => insertAnswer({ key: 'k-6', confidence: 'maybe' }),
  { code: '23514' });
await rejects('a score that does not fit numeric(4,3)', () => insertAnswer({ key: 'k-7', score: 12 }),
  { code: '22003' });

{
  await db.query('delete from public.questions where id = $1', [mcq?.id]);
  const { rows } = await db.query('select question_id, question_snapshot from public.answers where answer_key = $1', ['k-1']);
  check('deleting a question keeps its answers, with question_id cleared and the snapshot intact',
    rows.length === 2 && rows.every((r) => r.question_id === null && r.question_snapshot?.answerIdx === 2));
}

section('room archives');

{
  const archive = (sessionId, bytes, data = { format: 'bloomloop.room-archive', version: 1 }) => db.query(
    `insert into public.room_archives (session_id, code, title, owner_id, bytes, data)
     values ($1, 'ARCH01', 'Archived', $2, $3, $4)
     on conflict (session_id) do update set bytes = excluded.bytes, data = excluded.data
     returning id`,
    [sessionId, PROF, bytes, data],
  );
  const sid = '00000000-0000-4000-8000-0000000000a1';
  await accepts('an archive of a room that no longer exists (no foreign key on session_id)', () => archive(sid, 120));
  await accepts('a second write for the same room replaces the first', () => archive(sid, 240));
  const { rows } = await db.query('select count(*)::int as n, max(bytes) as b from public.room_archives where session_id = $1', [sid]);
  check('one archive per room, holding the latest write', rows[0].n === 1 && Number(rows[0].b) === 240);
  await rejects('an archive over 1 MiB', () => archive('00000000-0000-4000-8000-0000000000a2', 1048577), { code: '23514' });
  await rejects('an archive with no size', () => archive('00000000-0000-4000-8000-0000000000a3', 0), { code: '23514' });
}

section('answer reviews (0010)');

{
  // The written answer stored as provisional above.
  const [written] = (await db.query(`select id from public.answers where answer_key = 'k-3' and session_id = $1`,
    [session?.id])).rows;

  // The columns routes/review.js writes, plus a note only when the case gives one,
  // so the default is exercised too.
  const insertReview = (r) => {
    const cols = ['answer_id', 'session_id', 'decision', 'correct', 'score', 'reviewed_by'];
    const vals = [r.answerId ?? written?.id, r.sessionId ?? session?.id, r.decision ?? 'confirm',
      given(r, 'correct', false), given(r, 'score', 0.5), given(r, 'reviewedBy', PROF)];
    if ('note' in r) { cols.push('note'); vals.push(r.note); }
    return db.query(`insert into public.answer_reviews (${cols.join(', ')})
                     values (${vals.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, vals);
  };

  const [confirmed] = (await accepts('a professor confirms the machine\'s mark on a written answer', () =>
    insertReview({}))) ?? [];
  check('the note defaults to empty and the time is filled',
    confirmed?.note === '' && confirmed?.reviewed_at instanceof Date && Number(confirmed?.score) === 0.5);
  await accepts('a later override from the shared-key path, with no reviewer', () =>
    insertReview({ decision: 'override', correct: true, score: 0.9, reviewedBy: null, note: 'Both points, own words' }));
  {
    const { rows } = await db.query(
      'select decision, correct from public.answer_reviews where answer_id = $1 order by reviewed_at, id', [written?.id]);
    check('both decisions are kept: a later one never erases an earlier one',
      rows.length === 2 && rows.some((r) => r.decision === 'confirm') && rows.some((r) => r.decision === 'override'));
  }
  await rejects('a decision other than confirm/override', () => insertReview({ decision: 'approve' }),
    { code: '23514', match: /answer_reviews_decision_check/ });
  await rejects('a score above 1', () => insertReview({ score: 1.5 }),
    { code: '23514', match: /answer_reviews_score_check/ });
  await rejects('a negative score', () => insertReview({ score: -0.1 }),
    { code: '23514', match: /answer_reviews_score_check/ });
  await rejects('a review with no mark', () => insertReview({ correct: null }), { code: '23502' });
  await rejects('a note over 1000 characters', () => insertReview({ note: 'x'.repeat(1001) }),
    { code: '23514', match: /answer_reviews_note_check/ });
  await rejects('a review of an answer that does not exist', () => insertReview({ answerId: randomUUID() }),
    { code: '23503' });

  // A reviewer whose account is later deleted: the decision stays, unattributed.
  const REVIEWER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [REVIEWER]);
  await insertAccount({ id: REVIEWER, role: 'professor', fullName: 'Reviewer', email: 'rev@example.test',
    code: 'BL-RV0001', reportsTo: HOD });
  const [byReviewer] = (await insertReview({ reviewedBy: REVIEWER })).rows;
  await db.query('delete from auth.users where id = $1', [REVIEWER]);
  {
    const { rows } = await db.query('select reviewed_by from public.answer_reviews where id = $1', [byReviewer?.id]);
    check('deleting the reviewer\'s account keeps the decision, with reviewed_by cleared',
      rows.length === 1 && rows[0].reviewed_by === null);
  }

  // A room's reviews go with its answers. The server archives the room, log
  // included, before it ever sends this delete.
  const room = (await db.query(`insert into public.sessions (code, content_id) values ('ROOM06', $1) returning id`,
    [content?.id])).rows[0];
  const [roomAnswer] = (await insertAnswer({ key: 'k-r1', sessionId: room.id, questionId: match?.id })).rows;
  await insertReview({ answerId: roomAnswer.id, sessionId: room.id });
  await db.query('delete from public.sessions where id = $1', [room.id]);
  {
    const { rows } = await db.query('select count(*)::int as n from public.answer_reviews where session_id = $1', [room.id]);
    check('deleting a room deletes its reviews with its answers', rows[0].n === 0);
  }

  const idx = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'answers_open_queue_idx'`);
  check('the review queue index on final written answers exists',
    /WHERE \(\(kind = 'open'::text\) AND final\)/.test(idx.rows[0]?.indexdef ?? ''), idx.rows[0]?.indexdef ?? 'missing');
}

section('evidence guards (0012)');

{
  // The server only ever writes review fields to an answer and only inserts
  // reviews. These are the writes it never sends, from anywhere else.
  const [written] = (await db.query(`select id from public.answers where answer_key = 'k-3' and session_id = $1`,
    [session?.id])).rows;
  const [first] = (await db.query(`select id from public.answer_reviews where answer_id = $1 order by reviewed_at, id`,
    [written?.id])).rows;
  const RESTRICT = { code: '23001' };
  for (const [label, set] of [
    ['the response', `response = '{"choice": 1}'`],
    ['the question as it was asked', `question_snapshot = '{"text": "edited"}'`],
    ['the machine\'s mark', 'auto_correct = false, auto_score = 0'],
    ['the machine\'s reading in words', `auto_detail = 'edited'`],
    ['whose answer it is', `roll_no = '08'`],
    ['when it was answered', `answered_at = now() - interval '1 day'`],
  ]) {
    await rejects(`an answer's ${label} cannot be rewritten`, () =>
      db.query(`update public.answers set ${set} where id = $1`, [written?.id]), RESTRICT);
  }
  await accepts('what a review writes beside it still can', () =>
    db.query(`update public.answers set correct = true, score = 0.9, review_status = 'overridden', reviewed_by = $1,
              reviewed_at = now(), review_note = 'Both points', final = true where id = $2`, [PROF, written?.id]));

  await rejects('a logged decision cannot be edited', () =>
    db.query(`update public.answer_reviews set note = 'edited' where id = $1`, [first?.id]), RESTRICT);
  await rejects('nor its mark changed', () =>
    db.query('update public.answer_reviews set correct = not correct where id = $1', [first?.id]), RESTRICT);
  await rejects('nor deleted on its own', () =>
    db.query('delete from public.answer_reviews where id = $1', [first?.id]), RESTRICT);
  const other = (await db.query(`select id from public.sessions where code = 'ROOM05'`)).rows[0];
  await rejects('a decision filed under another room than its answer\'s', () =>
    db.query(`insert into public.answer_reviews (answer_id, session_id, decision, correct, score)
              values ($1, $2, 'confirm', false, 0.5)`, [written?.id, other?.id]),
  { code: '23503', match: /is not the room of answer/ });

  // A review goes with its answer: the cascade is still allowed.
  const [loose] = (await insertAnswer({ key: 'k-g1', questionId: match?.id })).rows;
  await db.query(`insert into public.answer_reviews (answer_id, session_id, decision, correct, score)
                  values ($1, $2, 'confirm', true, 1)`, [loose.id, session?.id]);
  await accepts('deleting an answer takes its reviews with it', () =>
    db.query('delete from public.answers where id = $1', [loose.id]));
  const { rows } = await db.query('select count(*)::int as n from public.answer_reviews where answer_id = $1', [loose.id]);
  check('and leaves none behind', rows[0].n === 0);
}

section('deleting');

await rejects('deleting the sign-in of a professor who owns material and students', () =>
  db.query('delete from auth.users where id = $1', [PROF]), { code: '23503' });
{
  await db.query('delete from auth.users where id = $1', [STUDENT_2]);
  const { rows } = await db.query('select count(*)::int as n from public.accounts where id = $1', [STUDENT_2]);
  check('deleting a half-made sign-up removes its account row (discardAuthUser)', rows[0].n === 0);
}

// ---------------------------------------------------- re-run over real data --

section('re-run over a database holding data');

const beforeRerun = await rowCounts(db);
const shapeBeforeRerun = await snapshot(db);
await applyAll(db, files, 'pass 3, with data');
const afterRerun = await rowCounts(db);
check('no row was added or removed by the re-run',
  JSON.stringify(beforeRerun) === JSON.stringify(afterRerun),
  `${JSON.stringify(beforeRerun)} -> ${JSON.stringify(afterRerun)}`);
sameSnapshot('the re-run left the schema exactly as it was', shapeBeforeRerun, await snapshot(db));
{
  const { rows } = await db.query('select id from public.accounts_below($1)', [HOD]);
  check('accounts_below still answers after the re-run', rows.length === 2);
  const acc = await db.query('select accommodations from public.accounts where id = $1', [STUDENT]);
  check('stored values survive the re-run', acc.rows[0]?.accommodations?.largerText === true);
}

await db.close();

// --------------------------------------------- upgrading a v1 deployment --

section('upgrading a v1 database that already holds data');

{
  const old = await freshDatabase();
  await old.exec(files[0].sql); // v1 is exactly 0000
  await old.exec(`
    insert into public.contents (id, title, kind) values ('11111111-1111-4111-8111-111111111111', 'v1 deck', 'pptx');
    insert into public.questions (content_id, text, options, answer_idx, bloom)
      values ('11111111-1111-4111-8111-111111111111', 'v1 q', '["a","b","c","d"]', 1, 'remember');
    insert into public.sessions (id, code, content_id, status)
      values ('22222222-2222-4222-8222-222222222222', 'OLD001', '11111111-1111-4111-8111-111111111111', 'closed');
    insert into public.profiles (session_id, roll_no, history)
      values ('22222222-2222-4222-8222-222222222222', '01', '[{"correct": true}]');
  `);
  const before = await rowCounts(old);
  const ok = await applyAll(old, files, 'upgrade');
  if (ok) {
    check('the upgrade kept every v1 row', JSON.stringify(before) === JSON.stringify(
      Object.fromEntries(Object.entries(await rowCounts(old)).filter(([t]) => t in before))));
    const q = await old.query('select kind, payload, options, answer_idx from public.questions');
    check('v1 questions read as mcq with an empty payload and their options untouched',
      q.rows[0]?.kind === 'mcq' && JSON.stringify(q.rows[0]?.payload) === '{}'
      && q.rows[0]?.options?.length === 4 && q.rows[0]?.answer_idx === 1);
    const s = await old.query('select owner_id, mastery_goal, reattempts, redemption, status from public.sessions');
    check('v1 rooms stay unowned and get the settings they were run under',
      s.rows[0]?.owner_id === null && Number(s.rows[0]?.mastery_goal) === 0.8 && s.rows[0]?.reattempts === 0
      && s.rows[0]?.redemption === false && s.rows[0]?.status === 'closed');
    const p = await old.query('select integrity, served_tries, account_id, history from public.profiles');
    check('v1 profiles keep their history and get empty integrity, no pin, no account',
      JSON.stringify(p.rows[0]?.integrity) === '[]' && p.rows[0]?.served_tries === 0 && p.rows[0]?.account_id === null
      && p.rows[0]?.history?.[0]?.correct === true);

    // A hand-applied accounts_below may have declared its columns rather than
    // returning the table's row type. CREATE OR REPLACE cannot change a return
    // type, so the migration must cope with finding that version in place.
    await old.exec(`
      drop function public.accounts_below(uuid);
      create function public.accounts_below(root uuid)
      returns table (id uuid, role public.app_role, full_name text, reports_to uuid)
      language sql stable as $$ select a.id, a.role, a.full_name, a.reports_to from public.accounts a where a.reports_to = root $$;
    `);
    await applyAll(old, files, 'over a differently declared accounts_below');
    const r = await old.query(`select pg_get_function_result('public.accounts_below(uuid)'::regprocedure) as result`);
    check('accounts_below is replaced by the version returning whole account rows', r.rows[0]?.result === 'SETOF accounts');
  }
  await old.close();
}

// ------------------------------------- 0011 over accounts that already clash --

section('0011 on a department that already holds two spellings of one roll number');

{
  const clash = await freshDatabase();
  await applyAll(clash, files.filter((f) => f.name < '0011'), 'up to 0010');
  const [H, P, S1, S2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await clash.query('insert into auth.users (id) values ($1), ($2), ($3), ($4)', [H, P, S1, S2]);
  const add = (id, role, code, reportsTo, rollNo) => clash.query(
    `insert into public.accounts (id, role, code, department, reports_to, roll_no) values ($1, $2, $3, 'CSE', $4, $5)`,
    [id, role, code, reportsTo, rollNo]);
  await add(H, 'hod', 'BL-HD0002', null, null);
  await add(P, 'professor', 'BL-PR0002', H, null);
  await add(S1, 'student', 'BL-ST0003', P, '21CS01');
  await add(S2, 'student', 'BL-ST0004', P, '21cs01');
  const indexed = async () =>
    (await clash.query(`select to_regclass('public.accounts_department_roll_key') is not null as ok`)).rows[0].ok;
  const counts = await rowCounts(clash);
  const ok = await applyAll(clash, files.filter((f) => f.name >= '0011'), 'over the clash');
  check('the rest of the set still applies, and no row is changed or removed',
    ok && JSON.stringify(counts) === JSON.stringify(await rowCounts(clash)));
  check('the index is left uncreated rather than forced over the clash', (await indexed()) === false);
  await clash.query(`update public.accounts set roll_no = '21CS02' where id = $1`, [S2]);
  await applyAll(clash, files.filter((f) => f.name.startsWith('0011')), 'once corrected');
  check('once a person corrects the accounts, running 0011 again creates it', (await indexed()) === true);
  await clash.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
