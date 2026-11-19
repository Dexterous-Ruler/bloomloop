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
    'answer_reviews', 'media', 'classes', 'class_students', 'attendance', ...RECORD_TABLES, 'projector_links',
    ...OUTCOME_TABLES]) {
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
  contents: ['id', 'title', 'kind', 'raw_text', 'topics', 'owner_id', 'created_at', 'topic_slides'],
  questions: ['id', 'content_id', 'topic', 'text', 'kind', 'options', 'answer_idx', 'bloom', 'status',
    'source', 'payload', 'created_at', 'model', 'source_ref', 'checks', 'created_by', 'approved_by', 'approved_at'],
  sessions: ['id', 'code', 'content_id', 'title', 'status', 'owner_id', 'started_at', 'closed_at', 'paused_at',
    'mastery_goal', 'reattempts', 'redemption', 'question_ids', 'class_id', 'mode', 'adapt', 'start_level',
    'questions_per_student', 'time_per_question'],
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
  media: ['id', 'owner_id', 'content_id', 'mime', 'bytes', 'sha256', 'data', 'alt', 'created_at'],
  classes: ['id', 'owner_id', 'course_name', 'section', 'term_label', 'created_at', 'updated_at'],
  class_students: ['id', 'class_id', 'roll_no', 'name', 'added_at', 'removed_at'],
  attendance: ['id', 'session_id', 'class_student_id', 'status', 'source', 'marked_at', 'marked_by', 'roll_no'],
  observations: ['id', 'session_id', 'class_id', 'class_student_id', 'roll_no', 'day', 'kind', 'note', 'observed_by',
    'observed_at'],
  wheel_rounds: ['id', 'session_id', 'round', 'present_only', 'no_repeat', 'started_at', 'started_by'],
  wheel_picks: ['id', 'session_id', 'round', 'pick_order', 'roll_no', 'class_student_id', 'pool_size', 'present_only',
    'no_repeat', 'ask', 'question_id', 'status', 'picked_at', 'picked_by', 'status_at', 'status_by'],
  hand_tallies: ['id', 'session_id', 'seq', 'question_id', 'question_text', 'option_labels', 'counts', 'revealed',
    'correct_option', 'created_at', 'created_by', 'updated_at'],
  room_activities: ['id', 'session_id', 'seq', 'kind', 'outcome', 'groups', 'tally_id', 'created_at', 'created_by',
    'updated_at'],
  insight_actions: ['id', 'session_id', 'flag_id', 'action', 'note', 'acted_by', 'acted_at'],
  projector_links: ['id', 'session_id', 'token_hash', 'created_at', 'created_by', 'revoked_at', 'revoked_by'],
  course_outcomes: ['id', 'class_id', 'code', 'statement', 'target_level', 'position', 'created_at', 'updated_at',
    'archived_at'],
  outcome_topics: ['id', 'outcome_id', 'class_id', 'content_id', 'topic', 'weight', 'created_at'],
  question_outcome_overrides: ['id', 'class_id', 'question_id', 'outcome_ids', 'excluded', 'updated_at', 'updated_by'],
  attainment_configs: ['id', 'class_id', 'version', 'config', 'created_at', 'created_by'],
};

// The course-outcome tables (0019), and the attainment formula's (0020).
const OUTCOME_TABLES = ['course_outcomes', 'outcome_topics', 'question_outcome_overrides', 'attainment_configs'];

// The teacher-record tables (0017), every one a room's record.
const RECORD_TABLES = ['observations', 'wheel_rounds', 'wheel_picks', 'hand_tallies', 'room_activities', 'insight_actions'];

// A roster holds a roll number and a name, and nothing that identifies a person
// any further. A column added to it should be a decision, so this says so.
const ROSTER_COLUMNS = ['id', 'class_id', 'roll_no', 'name', 'added_at', 'removed_at'];

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

section('question provenance and approval (0013)');

{
  // The columns the generate, regenerate, write-your-own and approve routes
  // write (server/src/routes/generate.js, bank.js).
  const insertDraft = (q = {}) => db.query(
    `insert into public.questions (content_id, topic, text, kind, options, answer_idx, bloom, status, source, payload,
       model, source_ref, checks, created_by)
     values ($1, 'Sets', $2, 'mcq', '["a","b","c","d"]', 1, 'remember', $3, 'fallback', '{}', $4, $5, $6, $7)
     returning *`,
    [content?.id, q.text ?? 'A draft', given(q, 'status', 'draft'), given(q, 'model', 'offline-template'),
      given(q, 'sourceRef', JSON.stringify({ kind: 'slides', slides: [3, 4] })),
      given(q, 'checks', JSON.stringify([{ id: 'longest-option-is-key', ok: true, message: 'fine' }])),
      given(q, 'createdBy', PROF)],
  );

  const [draft] = (await accepts('a generated question saved as a draft, with its model, slides and checks', () =>
    insertDraft())) ?? [];
  check('the provenance reads back as written',
    draft?.status === 'draft' && draft?.model === 'offline-template' && draft?.source_ref?.slides?.[1] === 4
    && Array.isArray(draft?.checks) && draft?.checks[0]?.ok === true && draft?.created_by === PROF
    && draft?.approved_by === null && draft?.approved_at === null);
  await accepts('a professor\'s own question: active, no model, no slides', () =>
    insertDraft({ status: 'active', model: null, sourceRef: null }));
  await accepts('a draft from the shared key: no creator', () => insertDraft({ createdBy: null }));
  await rejects('a status outside active/discarded/draft', () => insertDraft({ status: 'pending' }),
    { code: '23514', match: /questions_status_check/ });
  await rejects('a source_ref that is not an object', () => insertDraft({ sourceRef: '[3, 4]' }),
    { code: '23514', match: /questions_source_ref_object/ });
  await rejects('checks that are not an array', () => insertDraft({ checks: '{"ok": true}' }),
    { code: '23514', match: /questions_checks_array/ });

  await accepts('approving a draft: active, with who and when', () =>
    db.query(`update public.questions set status = 'active', approved_by = $1, approved_at = now() where id = $2`,
      [PROF, draft?.id]));
  await accepts('approving from the shared key: a time and no account', () =>
    db.query(`update public.questions set approved_by = null, approved_at = now() where id = $1`, [draft?.id]));
  await rejects('an approver with no approval time', () =>
    db.query(`update public.questions set approved_by = $1, approved_at = null where id = $2`, [PROF, draft?.id]),
  { code: '23514', match: /questions_approval_pair/ });
  await rejects('a creator who is not an account', () => insertDraft({ createdBy: randomUUID() }), { code: '23503' });

  // A professor who approved questions and later leaves: the questions stay,
  // unattributed, and stay in rooms.
  const APPROVER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [APPROVER]);
  await insertAccount({ id: APPROVER, role: 'professor', fullName: 'Approver', email: 'appr@example.test',
    code: 'BL-AP0001', reportsTo: HOD });
  const [made] = (await insertDraft({ createdBy: APPROVER })).rows;
  await db.query(`update public.questions set status = 'active', approved_by = $1, approved_at = now() where id = $2`,
    [APPROVER, made.id]);
  await db.query('delete from auth.users where id = $1', [APPROVER]);
  {
    const { rows } = await db.query('select status, created_by, approved_by, approved_at from public.questions where id = $1',
      [made.id]);
    check('deleting the approver\'s account keeps the question active, with created_by and approved_by cleared',
      rows[0]?.status === 'active' && rows[0]?.created_by === null && rows[0]?.approved_by === null
      && rows[0]?.approved_at instanceof Date);
  }

  const idx = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'questions_draft_idx'`);
  check('a bank\'s drafts have their own index', /WHERE \(status = 'draft'::text\)/.test(idx.rows[0]?.indexdef ?? ''),
    idx.rows[0]?.indexdef ?? 'missing');

  const [deck] = (await accepts('a deck with the slides each topic was read from', () =>
    db.query(`insert into public.contents (title, kind, topics, topic_slides, owner_id)
              values ('Deck', 'pptx', '["Sets", "Maps"]', '{"Sets": [2, 3], "Maps": [4]}', $1) returning *`, [PROF]))) ?? [];
  check('topic_slides reads back', deck?.topic_slides?.Sets?.[1] === 3);
  const pasted = await db.query(`insert into public.contents (title, kind) values ('Pasted', 'syllabus') returning topic_slides`);
  check('pasted text gets an empty topic_slides', JSON.stringify(pasted.rows[0]?.topic_slides) === '{}');
  await rejects('topic_slides that is not an object', () =>
    db.query(`insert into public.contents (title, kind, topic_slides) values ('Bad', 'pptx', '[1, 2]')`),
  { code: '23514', match: /contents_topic_slides_object/ });
}

section('uploaded images (0014)');

{
  // A real 1x1 PNG, sent in bytea's text form ("\x" and hex), as the Supabase
  // repo sends it through PostgREST.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const sha = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
  const insertMedia = (m = {}) => db.query(
    `insert into public.media (owner_id, content_id, mime, bytes, sha256, data, alt)
     values ($1, $2, $3, $4, $5, $6::text::bytea, $7)
     returning id, owner_id, content_id, mime, bytes, sha256, alt, created_at, data::text as hex`,
    [given(m, 'ownerId', PROF), given(m, 'contentId', content?.id), given(m, 'mime', 'image/png'),
      given(m, 'bytes', png.length), given(m, 'sha256', sha), given(m, 'data', `\\x${png.toString('hex')}`),
      given(m, 'alt', 'A one-pixel test image')],
  );

  const [image] = (await accepts('an uploaded PNG with its digest, size and alt text', () => insertMedia())) ?? [];
  check('it reads back as written, in the text form the repo decodes',
    image?.mime === 'image/png' && image?.bytes === png.length && image?.sha256 === sha && image?.owner_id === PROF
    && image?.hex === `\\x${png.toString('hex')}` && image?.created_at instanceof Date);
  {
    const { rows } = await db.query('select data from public.media where id = $1', [image?.id]);
    check('the bytes are the image, byte for byte', Buffer.from(rows[0]?.data ?? []).equals(png));
  }
  await accepts('an image from the shared key: no owner', () => insertMedia({ ownerId: null }));
  await rejects('an SVG', () => insertMedia({ mime: 'image/svg+xml' }), { code: '23514', match: /media_mime_check/ });
  await rejects('a size that is not the size of the bytes', () => insertMedia({ bytes: png.length + 1 }),
    { code: '23514', match: /media_bytes_check/ });
  await rejects('a digest that is not the digest of the bytes', () => insertMedia({ sha256: 'a'.repeat(64) }),
    { code: '23514', match: /media_sha256_check/ });
  await rejects('blank alt text', () => insertMedia({ alt: '   ' }), { code: '23514', match: /media_alt_check/ });
  await rejects('no alt text', () => insertMedia({ alt: null }), { code: '23502' });
  await rejects('a chapter that does not exist', () => insertMedia({ contentId: randomUUID() }), { code: '23503' });

  await accepts('its alt text can be corrected', () =>
    db.query(`update public.media set alt = 'A single grey pixel' where id = $1`, [image?.id]));
  const RESTRICT = { code: '23001', match: /upload a new image/ };
  await rejects('its bytes cannot be changed under its url', () =>
    db.query(`update public.media set data = '\\x00', bytes = 1, sha256 = encode(sha256('\\x00'::bytea), 'hex') where id = $1`,
      [image?.id]), RESTRICT);
  await rejects('nor its type', () => db.query(`update public.media set mime = 'image/webp' where id = $1`, [image?.id]), RESTRICT);
  {
    const other = (await db.query(`insert into public.contents (title, kind) values ('Other', 'syllabus') returning id`)).rows[0];
    await rejects('nor moved to another chapter', () =>
      db.query('update public.media set content_id = $1 where id = $2', [other.id, image?.id]), RESTRICT);
  }

  // The uploader leaves: the image stays, unattributed, and keeps its bytes.
  const UPLOADER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [UPLOADER]);
  await insertAccount({ id: UPLOADER, role: 'professor', fullName: 'Uploader', email: 'up@example.test',
    code: 'BL-MD0001', reportsTo: HOD });
  const [theirs] = (await insertMedia({ ownerId: UPLOADER })).rows;
  await db.query('delete from auth.users where id = $1', [UPLOADER]);
  {
    const { rows } = await db.query('select owner_id, bytes from public.media where id = $1', [theirs.id]);
    check('deleting the uploader\'s account keeps the image, with owner_id cleared',
      rows.length === 1 && rows[0].owner_id === null && rows[0].bytes === png.length);
  }

  // A chapter's images go with it.
  const gone = (await db.query(`insert into public.contents (title, kind) values ('Going', 'syllabus') returning id`)).rows[0];
  await insertMedia({ contentId: gone.id });
  await db.query('delete from public.contents where id = $1', [gone.id]);
  {
    const { rows } = await db.query('select count(*)::int as n from public.media where content_id = $1', [gone.id]);
    check('deleting a chapter deletes its images', rows[0].n === 0);
  }

  const idx = await db.query(`select indexname from pg_indexes where schemaname = 'public'
                              and indexname in ('media_content_idx', 'sessions_content_idx')`);
  check('images by chapter and rooms by chapter have their indexes', idx.rows.length === 2,
    idx.rows.map((r) => r.indexname).join(', '));
}

section('a question set per room (0015)');

{
  // The insert createSession() sends (server/src/repo/supabaseRepo.js), with
  // the set as PostgREST hands a JSON array of ids to a uuid[] column.
  const [q1, q2] = [randomUUID(), randomUUID()];
  const openRoom = (code, ids) => db.query(
    `insert into public.sessions (code, content_id, title, status, owner_id, mastery_goal, reattempts, redemption, question_ids)
     values ($1, $2, 'Set room', 'open', $3, 0.80, 0, false, $4::uuid[]) returning *`,
    [code, content?.id, PROF, ids]);

  const [setRoom] = (await accepts('a room limited to two questions', () => openRoom('SET001', [q1, q2]))) ?? [];
  check('its set reads back as the two ids, in order',
    Array.isArray(setRoom?.question_ids) && setRoom.question_ids.length === 2
    && setRoom.question_ids[0] === q1 && setRoom.question_ids[1] === q2, JSON.stringify(setRoom?.question_ids));
  const [whole] = (await accepts('a room with no set (the whole approved bank)', () => openRoom('SET002', null))) ?? [];
  check('reads back null', whole?.question_ids === null);
  {
    const { rows } = await db.query(`insert into public.sessions (code, content_id) values ('SET003', $1) returning question_ids`,
      [content?.id]);
    check('a room opened without naming the column gets null, the whole bank', rows[0]?.question_ids === null);
  }
  const SHAPE = { code: '23514', match: /sessions_question_ids_shape/ };
  await rejects('an empty set (a room that could serve nothing)', () => openRoom('SET004', []), SHAPE);
  await rejects('a set holding a null', () => openRoom('SET005', [q1, null]), SHAPE);
  await rejects('a set of sets', () =>
    db.query(`insert into public.sessions (code, content_id, question_ids) values ('SET006', $1, $2::uuid[])`,
      [content?.id, `{{${q1}},{${q2}}}`]), SHAPE);
  await rejects('an id that is not a uuid', () => openRoom('SET007', ['not-a-uuid']), { code: '22P02' });
  {
    // updateSession() never writes it; the room's other fields still change.
    await db.query(`update public.sessions set status = 'closed', closed_at = now() where id = $1`, [setRoom?.id]);
    const { rows } = await db.query('select status, question_ids from public.sessions where id = $1', [setRoom?.id]);
    check('closing a set room keeps its set', rows[0]?.status === 'closed' && rows[0]?.question_ids?.length === 2);
  }
}

section('classes, rosters and attendance (0016)');

{
  {
    const { rows } = await db.query(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'class_students'`);
    const extra = rows.map((r) => r.column_name).filter((c) => !ROSTER_COLUMNS.includes(c));
    check('a roster row holds a roll number and a name and nothing else about the student', extra.length === 0,
      `extra columns: ${extra.join(', ')}`);
  }

  // The insert createClass() sends (server/src/repo/supabaseRepo.js).
  const insertClass = (c = {}) => db.query(
    `insert into public.classes (owner_id, course_name, section, term_label) values ($1, $2, $3, $4) returning *`,
    [given(c, 'ownerId', PROF), given(c, 'courseName', 'Computer Networks'), given(c, 'section', 'TY-CSF B'),
      given(c, 'termLabel', 'Sem V')]);
  const [cls] = (await accepts('a professor\'s class: course, section and term', () => insertClass())) ?? [];
  check('it reads back as written, with its times filled',
    cls?.course_name === 'Computer Networks' && cls?.section === 'TY-CSF B' && cls?.term_label === 'Sem V'
    && cls?.owner_id === PROF && cls?.created_at instanceof Date && cls?.updated_at instanceof Date);
  const [keyClass] = (await accepts('a class from the shared key: no owner and no term', () =>
    db.query(`insert into public.classes (course_name, section) values ('Discrete Maths', 'FY A') returning *`))) ?? [];
  check('no term reads back as an empty term', keyClass?.term_label === '' && keyClass?.owner_id === null);
  await rejects('a class with a blank course name', () => insertClass({ courseName: '   ' }),
    { code: '23514', match: /classes_course_name_check/ });
  await rejects('a class with no section', () => insertClass({ section: null }), { code: '23502' });
  await rejects('a section over 40 characters', () => insertClass({ section: 'x'.repeat(41) }),
    { code: '23514', match: /classes_section_check/ });
  await rejects('a class owned by an account that does not exist', () => insertClass({ ownerId: randomUUID() }),
    { code: '23503' });

  // The insert addClassStudents() sends: ON CONFLICT DO NOTHING, so only the
  // rows added come back.
  const addStudents = (classId, rows) => db.query(
    `insert into public.class_students (class_id, roll_no, name)
     select $1, r.roll, r.name from jsonb_to_recordset($2::jsonb) as r(roll text, name text)
     on conflict (class_id, roll_no) do nothing returning *`,
    [classId, JSON.stringify(rows)]);
  const added = await accepts('a roster of three, roll numbers in the room\'s form', () => addStudents(cls?.id, [
    { roll: '21CS01', name: 'Asha Rao' }, { roll: '21CS 02', name: 'Bilal Khan' }, { roll: '2/A', name: 'Chitra' }]));
  check('all three are on it and none is removed',
    added?.length === 3 && added.every((r) => r.removed_at === null && r.added_at instanceof Date));
  {
    const again = await addStudents(cls?.id, [{ roll: '21CS01', name: 'Someone else' }, { roll: '21CS04', name: 'Dev' }]);
    check('a roll number the class already holds is skipped, and the rest are added',
      again.rows.length === 1 && again.rows[0].roll_no === '21CS04');
  }
  const SHAPE = { code: '23514', match: /class_students_roll_check/ };
  await rejects('a roll number in lower case (not the room\'s form)', () => addStudents(cls?.id, [{ roll: '21cs05', name: 'E' }]), SHAPE);
  await rejects('a roll number with two spaces', () => addStudents(cls?.id, [{ roll: '21CS  05', name: 'E' }]), SHAPE);
  await rejects('a roll number with a trailing space', () => addStudents(cls?.id, [{ roll: '21CS05 ', name: 'E' }]), SHAPE);
  await rejects('a roll number no phone can send', () => addStudents(cls?.id, [{ roll: '21CS#05', name: 'E' }]), SHAPE);
  await rejects('a roll number over 24 characters', () => addStudents(cls?.id, [{ roll: 'A'.repeat(25), name: 'E' }]), SHAPE);
  await rejects('a blank name', () => addStudents(cls?.id, [{ roll: '21CS05', name: '  ' }]),
    { code: '23514', match: /class_students_name_check/ });
  await rejects('a name over 80 characters', () => addStudents(cls?.id, [{ roll: '21CS05', name: 'n'.repeat(81) }]),
    { code: '23514', match: /class_students_name_check/ });
  await accepts('the same roll number in another class', () => addStudents(keyClass?.id, [{ roll: '21CS01', name: 'Asha Rao' }]));

  const roster = Object.fromEntries((await db.query('select id, roll_no from public.class_students where class_id = $1',
    [cls?.id])).rows.map((r) => [r.roll_no, r.id]));
  const [otherClassStudent] = (await db.query('select id from public.class_students where class_id = $1', [keyClass?.id])).rows;

  // The insert createSession() sends, with the class.
  const openRoom = (code, classId) => db.query(
    `insert into public.sessions (code, content_id, title, status, owner_id, mastery_goal, reattempts, redemption, question_ids, class_id)
     values ($1, $2, 'Class room', 'open', $3, 0.80, 0, false, null, $4) returning *`,
    [code, content?.id, PROF, classId]);
  const [classRoom] = (await accepts('a room opened for the class', () => openRoom('CLS001', cls?.id))) ?? [];
  check('its class reads back', classRoom?.class_id === cls?.id);
  const [plainRoom] = (await accepts('a room opened for no class', () => openRoom('CLS002', null))) ?? [];
  check('reads back with no class', plainRoom?.class_id === null);
  await rejects('a room for a class that does not exist', () => openRoom('CLS003', randomUUID()), { code: '23503' });

  // What the server writes: a join (addAttendanceIfAbsent), and the teacher's
  // marks (saveAttendance, an upsert that replaces).
  const join = (sessionId, studentId) => db.query(
    `insert into public.attendance (session_id, class_student_id, status, source, marked_at, marked_by)
     values ($1, $2, 'present', 'joined', now(), null)
     on conflict (session_id, class_student_id) do nothing returning *`, [sessionId, studentId]);
  const teacherMark = (sessionId, studentId, status, markedBy = PROF) => db.query(
    `insert into public.attendance (session_id, class_student_id, status, source, marked_at, marked_by)
     values ($1, $2, $3, 'teacher', now(), $4)
     on conflict (session_id, class_student_id) do update set
       status = excluded.status, source = excluded.source, marked_at = excluded.marked_at, marked_by = excluded.marked_by
     returning *`, [sessionId, studentId, status, markedBy]);
  const markOf = async (studentId, sessionId = classRoom?.id) => (await db.query(
    'select status, source, marked_by from public.attendance where session_id = $1 and class_student_id = $2',
    [sessionId, studentId])).rows;

  const [joined] = (await accepts('a phone joins with a roster roll number: present, by the join', () =>
    join(classRoom?.id, roster['21CS01']))) ?? [];
  check('the join reads back present, marked by nobody, with a time',
    joined?.status === 'present' && joined?.source === 'joined' && joined?.marked_by === null && joined?.marked_at instanceof Date);
  await accepts('the professor marks a student absent', () => teacherMark(classRoom?.id, roster['21CS 02'], 'absent'));
  await accepts('late, from the shared key: no marker', () => teacherMark(classRoom?.id, roster['2/A'], 'late', null));
  await accepts('the professor overrides the join', () => teacherMark(classRoom?.id, roster['21CS01'], 'absent'));
  {
    const rows = await markOf(roster['21CS01']);
    check('one mark per student: the professor\'s replaced the join',
      rows.length === 1 && rows[0].status === 'absent' && rows[0].source === 'teacher' && rows[0].marked_by === PROF);
    const later = await join(classRoom?.id, roster['21CS01']);
    const after = await markOf(roster['21CS01']);
    check('a later join adds nothing and leaves the professor\'s mark',
      later.rows.length === 0 && after.length === 1 && after[0].status === 'absent' && after[0].source === 'teacher');
  }
  const insertMark = (m) => db.query(
    `insert into public.attendance (session_id, class_student_id, status, source, marked_by) values ($1, $2, $3, $4, $5)`,
    [given(m, 'sessionId', classRoom?.id), given(m, 'studentId', roster['21CS04']), given(m, 'status', 'present'),
      given(m, 'source', 'teacher'), given(m, 'markedBy', null)]);
  await rejects('a status outside present/absent/late', () => insertMark({ status: 'excused' }),
    { code: '23514', match: /attendance_status_check/ });
  await rejects('a source outside joined/teacher', () => insertMark({ source: 'phone' }),
    { code: '23514', match: /attendance_source_check/ });
  await rejects('a join that marks someone absent', () => insertMark({ source: 'joined', status: 'absent' }),
    { code: '23514', match: /attendance_joined_check/ });
  await rejects('a join with a marker', () => insertMark({ source: 'joined', markedBy: PROF }),
    { code: '23514', match: /attendance_joined_check/ });
  await rejects('a mark for a student of another class', () => insertMark({ studentId: otherClassStudent?.id }),
    { code: '23503', match: /not on the roster of the class/ });
  await rejects('a mark in a room opened for no class', () => insertMark({ sessionId: plainRoom?.id }),
    { code: '23503', match: /not on the roster of the class/ });
  await rejects('a second row for one student in one room', () => insertMark({ studentId: roster['21CS 02'] }),
    { code: '23505', match: /attendance_session_student_key/ });
  await rejects('moving a mark onto another class\'s student', () =>
    db.query('update public.attendance set class_student_id = $1 where session_id = $2 and class_student_id = $3',
      [otherClassStudent?.id, classRoom?.id, roster['2/A']]),
  { code: '23503', match: /not on the roster of the class/ });

  // Removed, never deleted.
  await accepts('removing a student from the roster', () =>
    db.query('update public.class_students set removed_at = now() where id = $1', [roster['21CS 02']]));
  check('their attendance stays', (await markOf(roster['21CS 02']))[0]?.status === 'absent');
  await rejects('deleting a roster row that has attendance', () =>
    db.query('delete from public.class_students where id = $1', [roster['21CS 02']]), { code: '23503' });

  // A marker who later leaves: the mark stays, unattributed.
  const MARKER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [MARKER]);
  await insertAccount({ id: MARKER, role: 'professor', fullName: 'Marker', email: 'mark@example.test', code: 'BL-MK0001', reportsTo: HOD });
  await teacherMark(classRoom?.id, roster['21CS04'], 'present', MARKER);
  await db.query('delete from auth.users where id = $1', [MARKER]);
  {
    const rows = await markOf(roster['21CS04']);
    check('deleting the marker\'s account keeps the mark, with marked_by cleared',
      rows.length === 1 && rows[0].status === 'present' && rows[0].marked_by === null);
  }

  // A room's attendance goes with it; the server archives it first.
  await db.query('delete from public.sessions where id = $1', [classRoom?.id]);
  {
    const marks = await db.query('select count(*)::int as n from public.attendance where session_id = $1', [classRoom?.id]);
    const kept = await db.query('select count(*)::int as n from public.class_students where class_id = $1', [cls?.id]);
    check('deleting a room deletes its attendance and leaves the roster', marks.rows[0].n === 0 && kept.rows[0].n === 4);
  }

  const idx = await db.query(`select indexname from pg_indexes where schemaname = 'public'
                              and indexname in ('classes_owner_idx', 'sessions_class_idx', 'attendance_student_idx', 'attendance_marker_idx')`);
  check('classes by owner, rooms by class and marks by student and by marker have their indexes', idx.rows.length === 4,
    idx.rows.map((r) => r.indexname).join(', '));
}

section('teacher records (0017)');

{
  const KEPT = { code: '23001' };
  // A class of two, another class, a room for the class and a room for none.
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Data Structures', 'SY-CS A') returning *`, [PROF])).rows;
  const [otherCls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Signals', 'SY-EC A') returning *`, [PROF])).rows;
  const [asha, bilal] = (await db.query(
    `insert into public.class_students (class_id, roll_no, name) values ($1, '01', 'Asha'), ($1, '02', 'Bilal') returning *`,
    [cls.id])).rows;
  const [outsider] = (await db.query(
    `insert into public.class_students (class_id, roll_no, name) values ($1, '01', 'Gita') returning *`, [otherCls.id])).rows;
  const openRoom = (code, classId) => db.query(
    `insert into public.sessions (code, content_id, owner_id, class_id) values ($1, $2, $3, $4) returning *`,
    [code, content?.id, PROF, classId]);
  const [room] = (await openRoom('REC001', cls.id)).rows;
  const [plain] = (await openRoom('REC002', null)).rows;
  const [question] = (await db.query(
    `insert into public.questions (content_id, text, options, answer_idx, bloom)
     values ($1, 'Which traversal visits the root first?', '["Inorder","Preorder","Postorder","Level-order"]', 1, 'remember')
     returning *`, [content?.id])).rows;

  // -- observations: the insert addObservation() sends. Append-only.
  const observe = (o = {}) => db.query(
    `insert into public.observations (session_id, class_id, class_student_id, roll_no, day, kind, note, observed_by, observed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now()) returning *`,
    [given(o, 'sessionId', room.id), given(o, 'classId', cls.id), given(o, 'studentId', asha.id), given(o, 'rollNo', '01'),
      given(o, 'day', '2026-11-19'), given(o, 'kind', 'understood'), given(o, 'note', ''), given(o, 'by', PROF)]);
  const [first] = (await accepts('a professor marks a roster student understood', () => observe({ note: 'Explained inorder well' }))) ?? [];
  check('it reads back with its day as a date and its note', first?.kind === 'understood' && first?.note === 'Explained inorder well'
    && first?.day instanceof Date && first?.observed_by === PROF);
  await accepts('the day\'s mark replaced: a second row, the first kept', () => observe({ kind: 'revision' }));
  await accepts('the mark cleared: a row with no kind and no note', () => observe({ kind: null }));
  await accepts('in a room opened for no class: keyed by the room and a roll number', () =>
    observe({ sessionId: plain.id, classId: null, studentId: null, rollNo: 'GUEST9', kind: 'participated' }));
  {
    const { rows } = await db.query(
      `select kind from public.observations where class_student_id = $1 and day = '2026-11-19' order by observed_at, id`, [asha.id]);
    check('all three events of the day are kept, in order', JSON.stringify(rows.map((r) => r.kind)) === '["understood","revision",null]');
  }
  await rejects('a kind outside the four', () => observe({ kind: 'excellent' }), { code: '23514', match: /observations_kind_check/ });
  await rejects('a note over 280 characters', () => observe({ note: 'n'.repeat(281) }), { code: '23514', match: /observations_note_check/ });
  await rejects('a cleared mark with a note', () => observe({ kind: null, note: 'gone' }), { code: '23514', match: /observations_note_check/ });
  await rejects('a class with no roster student', () => observe({ studentId: null }), { code: '23514', match: /observations_subject_check/ });
  await rejects('a roll number not in the room\'s form', () => observe({ rollNo: '01 ' }), { code: '23514', match: /observations_roll_check/ });
  await rejects('a student of another class', () => observe({ studentId: outsider.id }), { code: '23503', match: /not on the roster/ });
  await rejects('a class that is not the room\'s', () => observe({ sessionId: plain.id }), { code: '23503', match: /another class or none/ });
  await rejects('no class in a room opened for one', () => observe({ classId: null, studentId: null }), { code: '23503' });
  await rejects('editing an observation', () =>
    db.query(`update public.observations set kind = 'support' where id = $1`, [first?.id]), KEPT);
  await rejects('deleting one', () => db.query('delete from public.observations where id = $1', [first?.id]), KEPT);

  // -- the wheel: the inserts addWheelRound() and addWheelPick() send.
  const startRound = (r = {}) => db.query(
    `insert into public.wheel_rounds (session_id, round, present_only, no_repeat, started_by) values ($1, $2, $3, $4, $5) returning *`,
    [given(r, 'sessionId', room.id), given(r, 'round', 1), given(r, 'presentOnly', true), given(r, 'noRepeat', true), PROF]);
  const [round1] = (await accepts('round 1 of the wheel, present only, no repeats', () => startRound())) ?? [];
  await rejects('round 1 again', () => startRound(), { code: '23505', match: /wheel_rounds_session_round_key/ });
  await rejects('round 0', () => startRound({ round: 0 }), { code: '23514' });
  const draw = (p = {}) => db.query(
    `insert into public.wheel_picks (session_id, round, pick_order, roll_no, class_student_id, pool_size, present_only, no_repeat,
       ask, question_id, status, picked_at, picked_by)
     values ($1, $2, $3, $4, $5, $6, true, true, $7, $8, 'pending', now(), $9) returning *`,
    [given(p, 'sessionId', room.id), given(p, 'round', 1), given(p, 'order', 1), given(p, 'rollNo', '01'),
      given(p, 'studentId', asha.id), given(p, 'poolSize', 2), given(p, 'ask', 'bank'), given(p, 'questionId', null), PROF]);
  const [pick] = (await accepts('a pick: who, the round, the place and the pool', () => draw())) ?? [];
  check('it starts pending, asked from the bank', pick?.status === 'pending' && pick?.ask === 'bank' && pick?.status_at === null);
  await accepts('a phone off the roster picked: no roster student', () => draw({ order: 2, rollNo: 'GUEST9', studentId: null, poolSize: 1 }));
  await rejects('a second pick in the same place', () => draw({ rollNo: '02', studentId: bilal.id }),
    { code: '23505', match: /wheel_picks_session_round_order_key/ });
  await rejects('a pick in a round that was never started', () => draw({ round: 2 }), { code: '23503' });
  await rejects('a pick from an empty wheel', () => draw({ order: 3, poolSize: 0 }), { code: '23514', match: /wheel_picks_order_check/ });
  await rejects('an ask outside bank, diagram and demo', () => draw({ order: 3, ask: 'quiz' }), { code: '23514', match: /wheel_picks_ask_check/ });
  await rejects('a bank question on a diagram ask', () => draw({ order: 3, ask: 'diagram', questionId: question.id }),
    { code: '23514', match: /wheel_picks_ask_check/ });
  await rejects('a student of another class', () => draw({ order: 3, studentId: outsider.id }), { code: '23503', match: /not on the roster/ });
  await accepts('the pick filled in: a bank question, answered', () => db.query(
    `update public.wheel_picks set question_id = $1, status = 'answered', status_at = now(), status_by = $2 where id = $3`,
    [question.id, PROF, pick?.id]));
  await rejects('a response with no time', () =>
    db.query(`update public.wheel_picks set status = 'help', status_at = null where id = $1`, [pick?.id]),
  { code: '23514', match: /wheel_picks_status_check/ });
  await rejects('a status outside the five', () =>
    db.query(`update public.wheel_picks set status = 'late', status_at = now() where id = $1`, [pick?.id]),
  { code: '23514', match: /wheel_picks_status_check/ });
  await rejects('changing who was drawn', () =>
    db.query(`update public.wheel_picks set roll_no = '02', class_student_id = $1 where id = $2`, [bilal.id, pick?.id]), KEPT);
  await rejects('changing how many were on the wheel', () =>
    db.query('update public.wheel_picks set pool_size = 9 where id = $1', [pick?.id]), KEPT);
  await rejects('deleting a pick', () => db.query('delete from public.wheel_picks where id = $1', [pick?.id]), KEPT);
  await accepts('the round\'s settings changed', () =>
    db.query('update public.wheel_rounds set present_only = false where id = $1', [round1?.id]));
  await rejects('the round\'s number changed', () =>
    db.query('update public.wheel_rounds set round = 5 where id = $1', [round1?.id]), KEPT);
  await rejects('a round deleted ("start new round" never deletes)', () =>
    db.query('delete from public.wheel_rounds where id = $1', [round1?.id]), KEPT);

  // -- the raised-hands tally: the insert addTally() sends.
  const tally = (t = {}) => db.query(
    `insert into public.hand_tallies (session_id, seq, question_id, question_text, option_labels, counts, revealed, correct_option, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [given(t, 'sessionId', room.id), given(t, 'seq', 1), given(t, 'questionId', question.id),
      given(t, 'text', 'Which traversal visits the root first?'), given(t, 'labels', ['Inorder', 'Preorder', 'Postorder', 'Level-order']),
      given(t, 'counts', [3, 18, 6, 2]), given(t, 'revealed', false), given(t, 'correct', 1), PROF]);
  const [hands] = (await accepts('a question asked aloud with four options and its hands', () => tally())) ?? [];
  check('its counts and labels read back as four of each',
    JSON.stringify(hands?.counts) === '[3,18,6,2]' && hands?.option_labels?.length === 4 && hands?.correct_option === 1);
  await rejects('a count below 0', () => tally({ seq: 2, counts: [0, -1, 0, 0] }), { code: '23514', match: /hand_tallies_counts_check/ });
  await rejects('three options', () => tally({ seq: 2, counts: [1, 2, 3] }), { code: '23514', match: /hand_tallies_counts_check/ });
  await rejects('a missing count', () => tally({ seq: 2, counts: [1, null, 3, 4] }), { code: '23514', match: /hand_tallies_counts_check/ });
  await rejects('five labels', () => tally({ seq: 2, labels: ['a', 'b', 'c', 'd', 'e'] }), { code: '23514', match: /hand_tallies_labels_check/ });
  await rejects('a correct option past D', () => tally({ seq: 2, correct: 4 }), { code: '23514', match: /hand_tallies_correct_check/ });
  await rejects('no question text', () => tally({ seq: 2, text: '  ' }), { code: '23514', match: /hand_tallies_text_check/ });
  await rejects('a second tally in the same place', () => tally(), { code: '23505', match: /hand_tallies_session_seq_key/ });
  await accepts('a hand more, and the answer revealed', () =>
    db.query(`update public.hand_tallies set counts = '{3,19,6,2}', revealed = true, updated_at = now() where id = $1`, [hands?.id]));
  await rejects('a count taken below 0 by an update', () =>
    db.query(`update public.hand_tallies set counts = '{3,19,-1,2}' where id = $1`, [hands?.id]), { code: '23514' });
  await rejects('its place in the room changed', () => db.query('update public.hand_tallies set seq = 7 where id = $1', [hands?.id]), KEPT);
  await rejects('a tally deleted', () => db.query('delete from public.hand_tallies where id = $1', [hands?.id]), KEPT);

  // -- activities: the insert addActivity() sends.
  const activity = (a = {}) => db.query(
    `insert into public.room_activities (session_id, seq, kind, outcome, groups, tally_id, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [given(a, 'sessionId', room.id), given(a, 'seq', 1), given(a, 'kind', 'group'), given(a, 'outcome', ''),
      JSON.stringify(given(a, 'groups', [])), given(a, 'tallyId', null), PROF]);
  const [challenge] = (await accepts('a group challenge records groups, not students', () => activity({
    outcome: 'Most benches found the postorder', groups: [{ label: 'Bench 3', gotIt: 'yes' }, { label: 'Bench 4', gotIt: 'partly' }] }))) ?? [];
  check('its groups read back', challenge?.groups?.[0]?.label === 'Bench 3' && challenge?.groups?.length === 2);
  await accepts('a quick check pointing at its tally', () => activity({ seq: 2, kind: 'check', tallyId: hands?.id }));
  await rejects('groups on a think-and-explain', () => activity({ seq: 3, kind: 'think', groups: [{ label: 'A', gotIt: 'yes' }] }),
    { code: '23514', match: /room_activities_groups_check/ });
  await rejects('a tally on anything but a quick check', () => activity({ seq: 3, kind: 'think', tallyId: hands?.id }),
    { code: '23514', match: /room_activities_tally_check/ });
  await rejects('an activity outside the five', () => activity({ seq: 3, kind: 'quiz' }), { code: '23514', match: /room_activities_kind_check/ });
  await rejects('an outcome over 280 characters', () => activity({ seq: 3, kind: 'real', outcome: 'o'.repeat(281) }),
    { code: '23514', match: /room_activities_outcome_check/ });
  await rejects('a tally from another room', () => activity({ sessionId: plain.id, seq: 1, kind: 'check', tallyId: hands?.id }),
    { code: '23503', match: /was not asked in room/ });
  await accepts('an outcome written after the class', () =>
    db.query(`update public.room_activities set outcome = 'Bench 4 got it on a second go', updated_at = now() where id = $1`, [challenge?.id]));
  await rejects('an activity deleted', () => db.query('delete from public.room_activities where id = $1', [challenge?.id]), KEPT);

  // -- insight actions: append-only.
  const act = (a = {}) => db.query(
    `insert into public.insight_actions (session_id, flag_id, action, note, acted_by) values ($1, $2, $3, $4, $5) returning *`,
    [given(a, 'sessionId', room.id), given(a, 'flagId', 'focus:analyse'), given(a, 'action', 'acted'),
      given(a, 'note', 'Asked two Analyse questions aloud'), PROF]);
  const [done] = (await accepts('a professor acted on a flag', () => act())) ?? [];
  await accepts('and dismissed another', () => act({ flagId: 'support:02', action: 'dismissed', note: '' }));
  await rejects('an action outside dismissed and acted', () => act({ action: 'snoozed' }), { code: '23514', match: /insight_actions_action_check/ });
  await rejects('a blank flag', () => act({ flagId: ' ' }), { code: '23514', match: /insight_actions_flag_check/ });
  await rejects('a flag with a control character', () => act({ flagId: 'a\nb' }), { code: '23514', match: /insight_actions_flag_check/ });
  await rejects('editing an action', () => db.query(`update public.insight_actions set action = 'dismissed' where id = $1`, [done?.id]), KEPT);
  await rejects('deleting one', () => db.query('delete from public.insight_actions where id = $1', [done?.id]), KEPT);

  // A marker who later leaves: their records stay, unattributed (ON DELETE SET NULL passes the guard).
  const MARKER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [MARKER]);
  await insertAccount({ id: MARKER, role: 'professor', fullName: 'Marker', email: 'mark2@example.test', code: 'BL-MK0002', reportsTo: HOD });
  await observe({ studentId: bilal.id, rollNo: '02', by: MARKER });
  await db.query('insert into public.insight_actions (session_id, flag_id, action, acted_by) values ($1, $2, $3, $4)',
    [room.id, 'by-marker', 'acted', MARKER]);
  await accepts('deleting the marker\'s sign-in', () => db.query('delete from auth.users where id = $1', [MARKER]));
  {
    const o = await db.query('select observed_by from public.observations where class_student_id = $1', [bilal.id]);
    const a = await db.query(`select acted_by from public.insight_actions where flag_id = 'by-marker'`);
    check('their observation and action stay, with the marker cleared',
      o.rows.length === 1 && o.rows[0].observed_by === null && a.rows.length === 1 && a.rows[0].acted_by === null);
  }
  await rejects('a roster student with records cannot be deleted (removed, never deleted)', () =>
    db.query('delete from public.class_students where id = $1', [asha.id]), { code: '23503' });
  {
    await db.query('delete from public.questions where id = $1', [question.id]);
    const t = await db.query('select question_id, question_text from public.hand_tallies where id = $1', [hands?.id]);
    const p = await db.query('select question_id, status from public.wheel_picks where id = $1', [pick?.id]);
    check('deleting a question keeps the tally\'s text and the pick, with the question cleared',
      t.rows[0]?.question_id === null && t.rows[0]?.question_text === 'Which traversal visits the root first?'
      && p.rows[0]?.question_id === null && p.rows[0]?.status === 'answered');
  }

  // A room's records go with it; the server archives them first.
  await accepts('deleting the class room', () => db.query('delete from public.sessions where id = $1', [room.id]));
  await accepts('deleting the room with no class', () => db.query('delete from public.sessions where id = $1', [plain.id]));
  {
    const left = [];
    for (const table of RECORD_TABLES) {
      const { rows } = await db.query(`select count(*)::int as n from public.${table} where session_id = any($1)`, [[room.id, plain.id]]);
      if (rows[0].n) left.push(`${table}: ${rows[0].n}`);
    }
    const kept = await db.query('select count(*)::int as n from public.class_students where class_id = $1', [cls.id]);
    check('deleting a room deletes every record of it and leaves the roster', left.length === 0 && kept.rows[0].n === 2, left.join(', '));
  }

  const idx = await db.query(`select count(*)::int as n from pg_indexes where schemaname = 'public' and tablename = any($1)`, [RECORD_TABLES]);
  // 6 primary keys, 4 unique places, and 15 for rooms, students, days, questions and markers.
  check('the record tables carry their indexes (unique places, rooms, students, days, markers)', idx.rows[0].n === 25, `${idx.rows[0].n} indexes`);
}

section('room modes, the waiting room and projector links (0018)');

{
  const KEPT = { code: '23001' };
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Networks', 'TY-CS B') returning *`, [PROF])).rows;
  // The columns createSession() writes, and only those this room sets.
  const room = (code, cols = {}) => {
    const all = { code, content_id: content?.id, owner_id: PROF, ...cols };
    const names = Object.keys(all);
    return db.query(`insert into public.sessions (${names.join(', ')}) values (${names.map((_, i) => `$${i + 1}`).join(', ')}) returning *`,
      Object.values(all));
  };

  // -- the settings: today's behaviour unless a room asks for something else.
  const [plain] = (await accepts('a room opened as every room was', () => room('MOD001'))) ?? [];
  check('it runs on Student devices, adapting, from Understand, with no cap and no time per question',
    plain?.mode === 'devices' && plain?.adapt === true && plain?.start_level === 'understand'
    && plain?.questions_per_student === null && plain?.time_per_question === null, JSON.stringify(plain));
  const [set] = (await accepts('a mixed room that does not adapt, from Apply, 12 questions of 60 seconds', () =>
    room('MOD002', { mode: 'mixed', adapt: false, start_level: 'apply', questions_per_student: 12, time_per_question: 60 }))) ?? [];
  check('its settings read back', set?.mode === 'mixed' && set?.adapt === false && set?.start_level === 'apply'
    && set?.questions_per_student === 12 && set?.time_per_question === 60);
  await accepts('a teacher-led room for a class', () => room('MOD003', { mode: 'teacher-led', class_id: cls.id }));
  await rejects('a teacher-led room with no class', () => room('MOD004', { mode: 'teacher-led' }), { code: '23514' });
  await rejects('a mode outside devices, teacher-led and mixed', () => room('MOD005', { mode: 'lecture' }), { code: '23514' });
  await rejects('a start level spelt analyze', () => room('MOD006', { start_level: 'analyze' }), { code: '23514' });
  await rejects('a cap of 0 questions', () => room('MOD007', { questions_per_student: 0 }), { code: '23514' });
  await rejects('a cap of 501 questions', () => room('MOD008', { questions_per_student: 501 }), { code: '23514' });
  await rejects('5 seconds per question', () => room('MOD009', { time_per_question: 5 }), { code: '23514' });
  await rejects('601 seconds per question', () => room('MOD010', { time_per_question: 601 }), { code: '23514' });

  // -- the waiting room: a status of its own, started into 'open'.
  const [waiting] = (await accepts('a room opened with a waiting room', () => room('MOD011', { status: 'waiting' }))) ?? [];
  check('its status is waiting', waiting?.status === 'waiting');
  await accepts('starting it', () => db.query(`update public.sessions set status = 'open' where id = $1`, [waiting?.id]));
  await rejects('a status outside waiting, open, paused and closed', () =>
    db.query(`update public.sessions set status = 'started' where id = $1`, [waiting?.id]), { code: '23514' });

  // -- projector links: only the hash of the token is kept.
  const hash = (c) => c.repeat(64);
  const link = (sessionId, tokenHash, by = PROF) => db.query(
    'insert into public.projector_links (session_id, token_hash, created_by) values ($1, $2, $3) returning *',
    [sessionId, tokenHash, by]);
  const [made] = (await accepts('a projector link for a room', () => link(set?.id, hash('a')))) ?? [];
  check('it is not revoked', made?.revoked_at === null && made?.created_by === PROF);
  await rejects('a second link with the same token', () => link(plain?.id, hash('a')), { code: '23505', match: /projector_links_token_hash_key/ });
  await rejects('a token hash that is not 64 lower-case hex characters', () => link(set?.id, 'A'.repeat(64)), { code: '23514' });
  await rejects('revoked_by without revoked_at', () =>
    db.query('update public.projector_links set revoked_by = $1 where id = $2', [PROF, made?.id]), { code: '23514' });
  await accepts('revoking it', () =>
    db.query('update public.projector_links set revoked_at = now(), revoked_by = $1 where id = $2', [PROF, made?.id]));
  await rejects('changing its token', () =>
    db.query('update public.projector_links set token_hash = $1 where id = $2', [hash('b'), made?.id]), KEPT);
  await rejects('moving it to another room', () =>
    db.query('update public.projector_links set session_id = $1 where id = $2', [plain?.id, made?.id]), KEPT);
  await rejects('deleting it on its own', () => db.query('delete from public.projector_links where id = $1', [made?.id]), KEPT);
  await accepts('a second link for the same room', () => link(set?.id, hash('c')));
  await accepts('deleting the room', () => db.query('delete from public.sessions where id = $1', [set?.id]));
  {
    const { rows } = await db.query('select count(*)::int as n from public.projector_links where session_id = $1', [set?.id]);
    check('deleting a room deletes its projector links', rows[0].n === 0);
  }
  const idx = await db.query(`select count(*)::int as n from pg_indexes where schemaname = 'public' and tablename = 'projector_links'`);
  // The primary key, the token, and the room, creator and revoker.
  check('projector_links carries its indexes (token, room, creator, revoker)', idx.rows[0].n === 5, `${idx.rows[0].n} indexes`);
  await db.query('delete from public.sessions where code like $1', ['MOD0%']);
}

section('course outcomes, topic mappings and question overrides (0019)');

{
  const KEPT = { code: '23001' };
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Computer Networks', 'TY-CS A') returning *`, [PROF])).rows;
  const [otherCls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Computer Networks', 'TY-CS B') returning *`, [PROF])).rows;

  // The insert createOutcome() sends (server/src/repo/supabaseRepo.js).
  const outcome = (o = {}) => db.query(
    `insert into public.course_outcomes (class_id, code, statement, target_level, position) values ($1, $2, $3, $4, $5) returning *`,
    [given(o, 'classId', cls.id), given(o, 'code', 'CO1'), given(o, 'statement', 'Explain how TCP recovers from loss.'),
      given(o, 'targetLevel', 'understand'), given(o, 'position', 1)]);
  const [co1] = (await accepts('a course outcome: code, statement, target level, position', () => outcome())) ?? [];
  check('it reads back as written, in use (not archived), with its times filled',
    co1?.code === 'CO1' && co1?.target_level === 'understand' && co1?.position === 1 && co1?.archived_at === null
    && co1?.created_at instanceof Date && co1?.updated_at instanceof Date);
  const [co2] = (await accepts('a second, with no target level', () =>
    outcome({ code: 'CO2', statement: 'Analyse routing tables.', targetLevel: null, position: 2 }))) ?? [];
  const [theirs] = (await accepts('the same code in another class', () => outcome({ classId: otherCls.id }))) ?? [];
  const SHAPE = { code: '23514', match: /course_outcomes_code_check/ };
  await rejects('a code in lower case', () => outcome({ code: 'co9' }), SHAPE);
  await rejects('a code with a trailing space', () => outcome({ code: 'CO9 ' }), SHAPE);
  await rejects('a code with two spaces', () => outcome({ code: 'CO  9' }), SHAPE);
  await rejects('a code over 16 characters', () => outcome({ code: 'C'.repeat(17) }), SHAPE);
  await rejects('a blank statement', () => outcome({ code: 'CO9', statement: '   ' }), { code: '23514', match: /course_outcomes_statement_check/ });
  await rejects('a statement over 300 characters', () => outcome({ code: 'CO9', statement: 's'.repeat(301) }),
    { code: '23514', match: /course_outcomes_statement_check/ });
  await rejects('a target level spelt analyze', () => outcome({ code: 'CO9', targetLevel: 'analyze' }),
    { code: '23514', match: /course_outcomes_target_level_check/ });
  await rejects('a position of 0', () => outcome({ code: 'CO9', position: 0 }), { code: '23514', match: /course_outcomes_position_check/ });
  await rejects('a class that does not exist', () => outcome({ code: 'CO9', classId: randomUUID() }), { code: '23503' });
  await rejects('two outcomes of one class with one code', () => outcome({ code: 'CO1', statement: 'Again.' }),
    { code: '23505', match: /course_outcomes_class_code_key/ });

  // The mappings setOutcomeTopics() writes.
  const link = (l = {}) => db.query(
    `insert into public.outcome_topics (outcome_id, class_id, content_id, topic, weight) values ($1, $2, $3, $4, $5) returning *`,
    [given(l, 'outcomeId', co1?.id), given(l, 'classId', cls.id), given(l, 'contentId', content?.id), given(l, 'topic', 'Congestion control'),
      given(l, 'weight', 2)]);
  const [mapped] = (await accepts('an outcome mapped to a topic of a chapter, weight 2', () => link())) ?? [];
  check('its weight reads back (numeric, as text)', Number(mapped?.weight) === 2);
  await accepts('the same topic mapped to a second outcome', () => link({ outcomeId: co2?.id, weight: 1 }));
  await accepts('a second topic for the first outcome, the default weight', () =>
    db.query(`insert into public.outcome_topics (outcome_id, class_id, content_id, topic) values ($1, $2, $3, 'Flow control')`,
      [co1?.id, cls.id, content?.id]));
  await rejects('one topic twice for one outcome and chapter, in another case', () => link({ topic: 'congestion CONTROL' }),
    { code: '23505', match: /outcome_topics_outcome_topic_key/ });
  await rejects('a weight of 0', () => link({ topic: 'Sliding windows', weight: 0 }), { code: '23514', match: /outcome_topics_weight_check/ });
  await rejects('a weight over 100', () => link({ topic: 'Sliding windows', weight: 100.5 }), { code: '23514', match: /outcome_topics_weight_check/ });
  await rejects('a topic with two spaces in it', () => link({ topic: 'Sliding  windows' }), { code: '23514', match: /outcome_topics_topic_check/ });
  await rejects('a blank topic', () => link({ topic: '' }), { code: '23514', match: /outcome_topics_topic_check/ });
  await rejects('a mapping whose class is not its outcome\'s', () => link({ classId: otherCls.id, topic: 'Sliding windows' }),
    { code: '23503', match: /outcome_topics_outcome_fkey/ });
  await rejects('a chapter that does not exist', () => link({ contentId: randomUUID(), topic: 'Sliding windows' }), { code: '23503' });

  // The overrides setQuestionOverride() upserts.
  const QUESTION = randomUUID(); // no foreign key: a question id that names nothing is still a decision about it
  const override = (o = {}) => db.query(
    `insert into public.question_outcome_overrides (class_id, question_id, outcome_ids, excluded, updated_by)
     values ($1, $2, $3, $4, $5)
     on conflict (class_id, question_id) do update set
       outcome_ids = excluded.outcome_ids, excluded = excluded.excluded, updated_at = now(), updated_by = excluded.updated_by
     returning *`,
    [given(o, 'classId', cls.id), given(o, 'questionId', QUESTION), given(o, 'outcomeIds', [co2?.id]), given(o, 'excluded', false),
      given(o, 'updatedBy', PROF)]);
  const [ov] = (await accepts('a question mapped straight to an outcome, whatever its topic', () => override())) ?? [];
  check('it reads back with its outcome', JSON.stringify(ov?.outcome_ids) === JSON.stringify([co2?.id]) && ov?.excluded === false);
  const [again] = (await accepts('the same question again: the override is replaced, not doubled', () =>
    override({ outcomeIds: [co1?.id, co2?.id] }))) ?? [];
  {
    const { rows } = await db.query('select count(*)::int as n from public.question_outcome_overrides where class_id = $1', [cls.id]);
    check('one override per question per class', rows[0].n === 1 && again?.outcome_ids?.length === 2);
  }
  await accepts('a question excluded from every outcome', () => override({ questionId: randomUUID(), outcomeIds: [], excluded: true }));
  const OV_SHAPE = { code: '23514', match: /question_outcome_overrides_shape/ };
  await rejects('excluded and mapped at once', () => override({ questionId: randomUUID(), excluded: true }), OV_SHAPE);
  await rejects('neither excluded nor mapped', () => override({ questionId: randomUUID(), outcomeIds: [] }), OV_SHAPE);
  await rejects('an outcome id that is null', () => override({ questionId: randomUUID(), outcomeIds: [co1?.id, null] }), OV_SHAPE);
  await rejects('an outcome of another class', () => override({ questionId: randomUUID(), outcomeIds: [theirs?.id] }),
    { code: '23503', match: /not one of class/ });
  await rejects('an outcome that does not exist', () => override({ questionId: randomUUID(), outcomeIds: [randomUUID()] }),
    { code: '23503', match: /not one of class/ });
  await rejects('one outcome named twice', () => override({ questionId: randomUUID(), outcomeIds: [co1?.id, co1?.id] }),
    { code: '23514', match: /twice/ });

  // Archived, not deleted; a code freed for reuse.
  await accepts('archiving an outcome', () => db.query('update public.course_outcomes set archived_at = now() where id = $1', [co2?.id]));
  const [newCo2] = (await accepts('a new outcome with the archived one\'s code', () =>
    outcome({ code: 'CO2', statement: 'Design a subnet plan.', position: 3 }))) ?? [];
  await rejects('restoring the archived one while its code is taken', () =>
    db.query('update public.course_outcomes set archived_at = null where id = $1', [co2?.id]),
  { code: '23505', match: /course_outcomes_class_code_key/ });
  await rejects('moving an outcome to another class', () =>
    db.query('update public.course_outcomes set class_id = $1 where id = $2', [otherCls.id, newCo2?.id]), KEPT);
  await rejects('deleting an outcome an override still names', () =>
    db.query('delete from public.course_outcomes where id = $1', [co2?.id]), { code: '23503', match: /question override/ });
  await accepts('taking it off the override, then deleting it', async () => {
    await db.query(`update public.question_outcome_overrides set outcome_ids = array_remove(outcome_ids, $1::uuid) where question_id = $2`,
      [co2?.id, QUESTION]);
    return db.query('delete from public.course_outcomes where id = $1', [co2?.id]);
  });
  {
    const { rows } = await db.query('select count(*)::int as n from public.outcome_topics where outcome_id = $1', [co2?.id]);
    check('its topic mappings went with it', rows[0].n === 0);
  }

  // Deleting a class takes its outcomes, mappings and overrides with it.
  const [gone] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Signals', 'SY-EC A') returning *`, [PROF])).rows;
  const [goneCo] = (await outcome({ classId: gone.id, code: 'CO1' })).rows;
  await link({ outcomeId: goneCo.id, classId: gone.id });
  await override({ classId: gone.id, outcomeIds: [goneCo.id] });
  await accepts('deleting a class whose outcome an override names', () => db.query('delete from public.classes where id = $1', [gone.id]));
  {
    const left = await Promise.all(OUTCOME_TABLES.map((t) => db.query(`select count(*)::int as n from public.${t} where class_id = $1`, [gone.id])));
    check('its outcomes, mappings and overrides went with it', left.every((r) => r.rows[0].n === 0));
  }
  {
    const [chapter] = (await db.query(
      `insert into public.contents (title, kind, owner_id) values ('Mapped only', 'syllabus', $1) returning id`, [PROF])).rows;
    await link({ contentId: chapter.id, topic: 'Subnetting' });
    await rejects('deleting a chapter an outcome is mapped to', () => db.query('delete from public.contents where id = $1', [chapter.id]),
      { code: '23503', match: /outcome_topics_content_id_fkey/ });
  }

  const idx = await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname in
    ('course_outcomes_class_code_key', 'course_outcomes_class_idx', 'outcome_topics_outcome_topic_key', 'outcome_topics_class_idx',
     'outcome_topics_content_idx', 'question_outcome_overrides_class_question_key', 'question_outcome_overrides_updated_by_idx')`);
  check('outcomes by class and code, mappings by outcome, class and chapter, and overrides by class and editor have their indexes',
    idx.rows.length === 7, idx.rows.map((r) => r.indexname).join(', '));
  // Left in place: the re-run below runs over them.
}

section('attainment formulas, version by version (0020)');

{
  const KEPT = { code: '23001', match: /kept as it was saved/ };
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Operating Systems', 'TY-CS A') returning *`, [PROF])).rows;
  const formula = { studentThreshold: 0.6, minAnswers: 3, levels: [{ level: 1, minShare: 0.5 }], evidence: { digital: true },
    attempts: 'final', roomWeights: [] };
  // The insert addAttainmentConfig() sends (server/src/repo/supabaseRepo.js).
  const save = (c = {}) => db.query(
    `insert into public.attainment_configs (class_id, version, config, created_by) values ($1, $2, $3, $4) returning *`,
    [given(c, 'classId', cls.id), given(c, 'version', 1), given(c, 'config', formula), given(c, 'createdBy', PROF)]);
  const [v1] = (await accepts('a class\'s formula, version 1', () => save())) ?? [];
  check('it reads back as written, its time filled', v1?.version === 1 && v1?.config?.studentThreshold === 0.6
    && v1?.config?.levels?.[0]?.minShare === 0.5 && v1?.created_at instanceof Date && v1?.created_by === PROF);
  await accepts('version 2 beside it', () => save({ version: 2, config: { ...formula, minAnswers: 4 } }));
  {
    // The read getAttainmentConfig() sends: the highest version is in force.
    const { rows } = await db.query('select version, config from public.attainment_configs where class_id = $1 order by version desc limit 1', [cls.id]);
    check('the highest version is the one in force', rows[0]?.version === 2 && rows[0]?.config?.minAnswers === 4);
  }
  await rejects('two saves of one version (a race)', () => save({ version: 2 }), { code: '23505', match: /attainment_configs_class_version_key/ });
  await rejects('version 0', () => save({ version: 0 }), { code: '23514', match: /attainment_configs_version_check/ });
  await rejects('a config that is a list', () => save({ version: 3, config: JSON.stringify([1, 2]) }), { code: '23514', match: /attainment_configs_config_check/ });
  await rejects('a config over 32 KB', () => save({ version: 3, config: { ...formula, note: 'x'.repeat(33000) } }),
    { code: '23514', match: /attainment_configs_config_check/ });
  await rejects('a class that does not exist', () => save({ classId: randomUUID(), version: 1 }), { code: '23503' });
  await rejects('changing a saved version', () =>
    db.query(`update public.attainment_configs set config = '{"studentThreshold": 0.1}' where id = $1`, [v1?.id]), KEPT);
  await rejects('renumbering a saved version', () => db.query('update public.attainment_configs set version = 9 where id = $1', [v1?.id]), KEPT);
  await rejects('deleting a saved version', () => db.query('delete from public.attainment_configs where id = $1', [v1?.id]), KEPT);

  // The saver's account deleted: created_by goes null, the formula stays.
  const SAVER = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [SAVER]);
  await insertAccount({ id: SAVER, role: 'student', code: 'BL-AT0001', reportsTo: PROF, rollNo: '31' });
  await save({ version: 3, createdBy: SAVER });
  await accepts('deleting the account that saved a version', () => db.query('delete from auth.users where id = $1', [SAVER]));
  {
    const { rows } = await db.query('select created_by, config from public.attainment_configs where class_id = $1 and version = 3', [cls.id]);
    check('the version stays, with no one recorded as its saver', rows.length === 1 && rows[0].created_by === null
      && rows[0].config?.studentThreshold === 0.6);
  }

  // Deleting a class takes its versions with it.
  const [gone] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Compilers', 'TY-CS B') returning *`, [PROF])).rows;
  await save({ classId: gone.id, version: 1 });
  await save({ classId: gone.id, version: 2 });
  await accepts('deleting a class with saved formulas', () => db.query('delete from public.classes where id = $1', [gone.id]));
  {
    const { rows } = await db.query('select count(*)::int as n from public.attainment_configs where class_id = $1', [gone.id]);
    check('its formulas went with it', rows[0].n === 0);
  }
  const idx = await db.query(`select indexname from pg_indexes where schemaname = 'public' and indexname in
    ('attainment_configs_class_version_key', 'attainment_configs_created_by_idx')`);
  check('formulas by class and version, and by saver, have their indexes', idx.rows.length === 2, idx.rows.map((r) => r.indexname).join(', '));
  // Left in place: the re-run below runs over them.
}

section('the roll number an attendance mark was made under (0021)');

// Kept by the re-run section below, which checks the mark survives it.
let rollMark = null;
{
  const { rows: cols } = await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'attendance' and column_name = 'roll_no'`);
  check('attendance.roll_no is text, null allowed, with no default (nothing backfilled)',
    cols.length === 1 && cols[0].data_type === 'text' && cols[0].is_nullable === 'YES' && cols[0].column_default === null,
    JSON.stringify(cols));
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Databases', 'TY-CS C') returning *`, [PROF])).rows;
  const students = Object.fromEntries((await db.query(
    `insert into public.class_students (class_id, roll_no, name) values ($1, '21CS01', 'Asha'), ($1, '21CS02', 'Bilal') returning id, roll_no`,
    [cls.id])).rows.map((r) => [r.roll_no, r.id]));
  const contentId = (await db.query('select id from public.contents limit 1')).rows[0]?.id;
  const [room] = (await db.query(
    `insert into public.sessions (code, content_id, title, status, owner_id, class_id) values ('ROLL01', $1, 'R', 'open', $2, $3) returning *`,
    [contentId, PROF, cls.id])).rows;
  // What addAttendanceIfAbsent() and saveAttendance() send (server/src/repo/supabaseRepo.js).
  const join = (studentId, roll) => db.query(
    `insert into public.attendance (session_id, class_student_id, status, source, marked_at, marked_by, roll_no)
     values ($1, $2, 'present', 'joined', now(), null, $3)
     on conflict (session_id, class_student_id) do nothing returning *`, [room.id, studentId, roll]);
  const teacherMark = (studentId, status, roll) => db.query(
    `insert into public.attendance (session_id, class_student_id, status, source, marked_at, marked_by, roll_no)
     values ($1, $2, $3, 'teacher', now(), $4, $5)
     on conflict (session_id, class_student_id) do update set
       status = excluded.status, source = excluded.source, marked_at = excluded.marked_at, marked_by = excluded.marked_by,
       roll_no = excluded.roll_no
     returning *`, [room.id, studentId, status, PROF, roll]);
  const [joined] = (await accepts('a join stores the roll number the phone joined with', () => join(students['21CS01'], '21CS01'))) ?? [];
  check('it reads back with that roll number', joined?.roll_no === '21CS01' && joined?.source === 'joined');
  // The roster row's roll number corrected; the mark keeps the one it was made under.
  await db.query(`update public.class_students set roll_no = '21CS11' where id = $1`, [students['21CS01']]);
  {
    const { rows } = await db.query('select roll_no from public.attendance where session_id = $1 and class_student_id = $2',
      [room.id, students['21CS01']]);
    check('correcting the roster\'s roll number leaves the mark\'s as it was made', rows[0]?.roll_no === '21CS01');
  }
  const [marked] = (await accepts('a teacher mark stores the roll number the server sends', () =>
    teacherMark(students['21CS02'], 'late', '21CS02'))) ?? [];
  check('it reads back with it', marked?.roll_no === '21CS02' && marked?.status === 'late');
  await accepts('a mark with no roll number, as every mark before 0021', () => teacherMark(students['21CS02'], 'absent', null));
  {
    const { rows } = await db.query('select roll_no, status from public.attendance where session_id = $1 and class_student_id = $2',
      [room.id, students['21CS02']]);
    check('reads back with none', rows[0]?.roll_no === null && rows[0]?.status === 'absent');
  }
  await accepts('any text the server accepted: no shape check here', () => teacherMark(students['21CS02'], 'present', '21CS 02'));
  rollMark = { sessionId: room.id, studentId: students['21CS01'] };
  // Left in place: the re-run below runs over them.
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

// A room in its waiting room while the whole set is re-run: 0005 re-adds the
// status check, and must not narrow it below what 0018 allows.
{
  const content = (await db.query('select id from public.contents limit 1')).rows[0];
  await accepts('a room left waiting before the re-run', () =>
    db.query(`insert into public.sessions (code, content_id, status) values ('WAIT01', $1, 'waiting')`, [content?.id]));
}

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
  // No earlier file's re-run (0016 re-adds attendance's checks) narrows what 0021 allows.
  const mark = await db.query('select roll_no from public.attendance where session_id = $1 and class_student_id = $2',
    [rollMark?.sessionId, rollMark?.studentId]);
  check('a mark\'s roll number survives the re-run (0021)', mark.rows[0]?.roll_no === '21CS01', JSON.stringify(mark.rows));
  await accepts('and a mark carrying a roll number is still accepted after it', () => db.query(
    `update public.attendance set roll_no = '21CS 01', source = 'teacher', status = 'late', marked_by = $3
      where session_id = $1 and class_student_id = $2`, [rollMark?.sessionId, rollMark?.studentId, PROF]));
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
    const p13 = await old.query(
      'select status, model, source_ref, checks, created_by, approved_by, approved_at from public.questions');
    check('v1 questions stay active, with no model, slides, checks or approval recorded (0013)',
      p13.rows[0]?.status === 'active' && p13.rows[0]?.model === null && p13.rows[0]?.source_ref === null
      && p13.rows[0]?.checks === null && p13.rows[0]?.created_by === null && p13.rows[0]?.approved_by === null
      && p13.rows[0]?.approved_at === null);
    const c13 = await old.query('select topic_slides from public.contents');
    check('v1 contents get an empty topic_slides', JSON.stringify(c13.rows[0]?.topic_slides) === '{}');
    const s = await old.query('select owner_id, mastery_goal, reattempts, redemption, status, question_ids from public.sessions');
    check('v1 rooms stay unowned and get the settings they were run under',
      s.rows[0]?.owner_id === null && Number(s.rows[0]?.mastery_goal) === 0.8 && s.rows[0]?.reattempts === 0
      && s.rows[0]?.redemption === false && s.rows[0]?.status === 'closed');
    check('v1 rooms get no question set: they go on serving the whole bank (0015)', s.rows[0]?.question_ids === null);
    const c16 = await old.query('select class_id from public.sessions');
    check('v1 rooms are opened for no class (0016)', c16.rows.length === 1 && c16.rows[0]?.class_id === null);
    const m18 = await old.query(
      'select mode, adapt, start_level, questions_per_student, time_per_question, status from public.sessions');
    check('v1 rooms run as they ran: Student devices, adapting, from Understand, no cap, no time, status kept (0018)',
      m18.rows[0]?.mode === 'devices' && m18.rows[0]?.adapt === true && m18.rows[0]?.start_level === 'understand'
      && m18.rows[0]?.questions_per_student === null && m18.rows[0]?.time_per_question === null
      && m18.rows[0]?.status === 'closed', JSON.stringify(m18.rows[0]));
    const records = await rowCounts(old);
    check('v1 rooms have no teacher records, and the tables are there to take them (0017)',
      RECORD_TABLES.every((t) => records[t] === 0), JSON.stringify(records));
    check('a v1 database has no course outcomes or attainment formulas, and the tables are there to take them (0019, 0020)',
      OUTCOME_TABLES.every((t) => records[t] === 0), JSON.stringify(records));
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

// ------------------------------------------ 0021 over marks already taken --

section('0021 on a database that already holds attendance');

{
  const before21 = await freshDatabase();
  await applyAll(before21, files.filter((f) => f.name < '0021'), 'up to 0020');
  await before21.exec(`
    insert into public.contents (id, title, kind) values ('31111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.classes (id, course_name, section) values ('32222222-2222-4222-8222-222222222222', 'Networks', 'A');
    insert into public.class_students (id, class_id, roll_no, name)
      values ('33333333-3333-4333-8333-333333333333', '32222222-2222-4222-8222-222222222222', '21CS01', 'Asha');
    insert into public.sessions (id, code, content_id, status, class_id)
      values ('34444444-4444-4444-8444-444444444444', 'OLD021', '31111111-1111-4111-8111-111111111111', 'closed',
              '32222222-2222-4222-8222-222222222222');
    insert into public.attendance (session_id, class_student_id, status, source)
      values ('34444444-4444-4444-8444-444444444444', '33333333-3333-4333-8333-333333333333', 'present', 'joined');
  `);
  const counts = await rowCounts(before21);
  const ok = await applyAll(before21, files.filter((f) => f.name >= '0021'), 'over existing marks');
  const { rows } = await before21.query('select status, source, roll_no from public.attendance');
  check('0021 applies over existing marks, changing no row: each reads back with no roll number',
    ok && JSON.stringify(counts) === JSON.stringify(await rowCounts(before21))
    && rows.length === 1 && rows[0].status === 'present' && rows[0].source === 'joined' && rows[0].roll_no === null,
    JSON.stringify(rows));
  await before21.close();
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
  // Tables the later files create (media, 0014) are left out of the comparison:
  // a new empty table is not a row changed or removed.
  check('the rest of the set still applies, and no row is changed or removed',
    ok && JSON.stringify(counts) === JSON.stringify(
      Object.fromEntries(Object.entries(await rowCounts(clash)).filter(([t]) => t in counts))));
  check('the index is left uncreated rather than forced over the clash', (await indexed()) === false);
  await clash.query(`update public.accounts set roll_no = '21CS02' where id = $1`, [S2]);
  await applyAll(clash, files.filter((f) => f.name.startsWith('0011')), 'once corrected');
  check('once a person corrects the accounts, running 0011 again creates it', (await indexed()) === true);
  await clash.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
