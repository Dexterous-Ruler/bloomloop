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
    ...OUTCOME_TABLES, 'class_questions', ...HUB_TABLES, ...LESSON_TABLES, ...PATH_TABLES,
    ...TUTOR_TABLES, 'question_packs', 'room_imports', 'record_writes', ...ZIP_TABLES]) {
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
  contents: ['id', 'title', 'kind', 'raw_text', 'topics', 'owner_id', 'created_at', 'topic_slides', 'slide_texts',
    // Batch 8, what a deck upload kept of its pictures (0033).
    'slide_pictures'],
  questions: ['id', 'content_id', 'topic', 'text', 'kind', 'options', 'answer_idx', 'bloom', 'status',
    'source', 'payload', 'created_at', 'model', 'source_ref', 'checks', 'created_by', 'approved_by', 'approved_at',
    'replaces_id', 'misconceptions',
    // Batch 8, a question kept for rooms only (0035).
    'rooms_only'],
  sessions: ['id', 'code', 'content_id', 'title', 'status', 'owner_id', 'started_at', 'closed_at', 'paused_at',
    'mastery_goal', 'reattempts', 'redemption', 'question_ids', 'class_id', 'mode', 'adapt', 'start_level',
    'questions_per_student', 'time_per_question'],
  profiles: ['id', 'session_id', 'roll_no', 'name', 'levels', 'working_level', 'reason', 'history', 'served_id',
    'served_at', 'served_why', 'served_tries', 'served_last', 'integrity', 'account_id', 'updated_at', 'account_verified',
    'served_log'],
  answers: ['id', 'session_id', 'answer_key', 'roll_no', 'account_id', 'question_id', 'content_id', 'topic', 'bloom',
    'kind', 'question_snapshot', 'response', 'attempt', 'final', 'correct', 'score', 'detail', 'ungraded',
    'language', 'question_source', 'served_at', 'answered_at', 'review_status', 'auto_correct', 'auto_score',
    'auto_detail', 'reviewed_by', 'reviewed_at', 'review_note', 'confidence', 'account_verified', 'class_question_id', 'round',
    'device_answered_at'],
  accounts: ['id', 'role', 'full_name', 'email', 'code', 'department', 'reports_to', 'roll_no', 'active',
    'created_at', 'updated_at', 'google_sub', 'google_email', 'google_linked_at', 'google_link_source',
    'accommodations'],
  invites: ['code', 'role', 'department', 'reports_to', 'created_by', 'email', 'roll_no', 'full_name',
    'expires_at', 'used_by', 'used_at', 'created_at', 'google_sub'],
  room_archives: ['id', 'session_id', 'code', 'title', 'owner_id', 'archived_by', 'archived_at', 'bytes', 'data'],
  answer_reviews: ['id', 'answer_id', 'session_id', 'decision', 'correct', 'score', 'note', 'reviewed_by',
    'reviewed_at'],
  media: ['id', 'owner_id', 'content_id', 'mime', 'bytes', 'sha256', 'data', 'alt', 'created_at',
    // Batch 8, the slide a deck's picture was kept from (0033).
    'slide_no'],
  classes: ['id', 'owner_id', 'course_name', 'section', 'term_label', 'created_at', 'updated_at'],
  class_students: ['id', 'class_id', 'roll_no', 'name', 'added_at', 'removed_at', 'under_18'],
  attendance: ['id', 'session_id', 'class_student_id', 'status', 'source', 'marked_at', 'marked_by', 'roll_no'],
  observations: ['id', 'session_id', 'class_id', 'class_student_id', 'roll_no', 'day', 'kind', 'note', 'observed_by',
    'observed_at'],
  wheel_rounds: ['id', 'session_id', 'round', 'present_only', 'no_repeat', 'started_at', 'started_by'],
  wheel_picks: ['id', 'session_id', 'round', 'pick_order', 'roll_no', 'class_student_id', 'pool_size', 'present_only',
    'no_repeat', 'ask', 'question_id', 'status', 'picked_at', 'picked_by', 'status_at', 'status_by'],
  hand_tallies: ['id', 'session_id', 'seq', 'question_id', 'question_text', 'option_labels', 'counts', 'revealed',
    'correct_option', 'created_at', 'created_by', 'updated_at'],
  room_activities: ['id', 'session_id', 'seq', 'kind', 'outcome', 'groups', 'tally_id', 'created_at', 'created_by',
    'updated_at',
    // Batch 8, the suggestion "Use it" recorded (0034).
    'suggestion_id'],
  insight_actions: ['id', 'session_id', 'flag_id', 'action', 'note', 'acted_by', 'acted_at'],
  projector_links: ['id', 'session_id', 'token_hash', 'created_at', 'created_by', 'revoked_at', 'revoked_by'],
  course_outcomes: ['id', 'class_id', 'code', 'statement', 'target_level', 'position', 'created_at', 'updated_at',
    'archived_at'],
  outcome_topics: ['id', 'outcome_id', 'class_id', 'content_id', 'topic', 'weight', 'created_at'],
  question_outcome_overrides: ['id', 'class_id', 'question_id', 'outcome_ids', 'excluded', 'updated_at', 'updated_by'],
  attainment_configs: ['id', 'class_id', 'version', 'config', 'created_at', 'created_by'],
  class_questions: ['id', 'session_id', 'seq', 'question_id', 'question_snapshot', 'state', 'revealed', 'started_at',
    'started_by', 'paused_at', 'revote_at', 'closed_at', 'closed_by'],
  // Phase 6, the hub's content backbone (0025).
  class_units: ['id', 'class_id', 'name', 'position', 'created_at', 'updated_at', 'created_by'],
  class_chapters: ['id', 'class_id', 'content_id', 'unit_id', 'position', 'added_at', 'added_by'],
  chapter_topics: ['id', 'content_id', 'name', 'key', 'position', 'retired_at', 'created_at', 'updated_at'],
  topic_links: ['id', 'owner_id', 'prerequisite_id', 'topic_id', 'provenance', 'state', 'reason', 'model', 'created_at',
    'created_by', 'decided_at', 'decided_by'],
  // Phase 6, practice in the hub (0026).
  hub_attempts: ['id', 'account_id', 'client_attempt_id', 'class_id', 'content_id', 'topic_id', 'topic', 'question_id', 'bloom',
    'kind', 'question_snapshot', 'question_source', 'response', 'correct', 'score', 'detail', 'review_status', 'mode', 'language',
    'hints_used', 'time_taken_ms', 'created_at',
    // Phase 6, Get Ready and self-tests (0028).
    'run_id'],
  question_explanations: ['id', 'question_id', 'text', 'provenance', 'status', 'model', 'source_ref', 'created_by', 'created_at',
    'updated_at', 'approved_by', 'approved_at'],
  // Phase 6, lessons and languages (0027).
  topic_lessons: ['id', 'topic_id', 'content_id', 'owner_id', 'version', 'status', 'source', 'model', 'steps', 'basis', 'warnings',
    'created_at', 'created_by', 'approved_at', 'approved_by', 'retired_at', 'retired_by',
    // Batch 8, an AI lesson's concept sections (0035).
    'sections'],
  item_translations: ['id', 'item_kind', 'item_id', 'content_id', 'owner_id', 'language', 'fields', 'source_fields', 'source_hash',
    'status', 'provenance', 'model', 'checks', 'created_at', 'created_by', 'updated_at', 'edited_by', 'approved_at', 'approved_by',
    'retired_at', 'retired_by'],
  student_language_choices: ['account_id', 'language', 'updated_at'],
  // Phase 6, Get Ready, self-tests and goals (0028).
  hub_runs: ['id', 'account_id', 'client_run_id', 'kind', 'spec', 'time_limit_seconds', 'started_at', 'deadline_at', 'ended_at',
    'end_reason'],
  hub_goals: ['id', 'account_id', 'title', 'exam_date', 'topic_ids', 'created_at', 'updated_at'],
  // Phase 6, the tutor (0029).
  question_hints: ['id', 'question_id', 'step', 'text', 'provenance', 'status', 'model', 'source_ref', 'created_by', 'created_at',
    'updated_at', 'approved_by', 'approved_at'],
  option_feedback: ['id', 'question_id', 'option', 'option_key', 'text', 'provenance', 'status', 'model', 'source_ref', 'created_by',
    'created_at', 'updated_at', 'approved_by', 'approved_at'],
  hub_hint_views: ['id', 'account_id', 'client_attempt_id', 'question_id', 'topic_id', 'content_id', 'mode', 'position', 'kind', 'hint_id',
    'text', 'provenance', 'language', 'translation_id', 'source_ref', 'plan', 'created_at'],
  question_packs: ['id', 'session_id', 'roll_no', 'question_ids', 'issued_at', 'expires_at'],
  room_imports: ['id', 'source_room_id', 'source_code', 'source', 'session_id', 'owner_id', 'imported_by', 'imported_at',
    'archived_at', 'bytes', 'sha256', 'summary', 'data'],
  record_writes: ['id', 'session_id', 'writer', 'write_key', 'route', 'target', 'body_hash', 'status', 'reply', 'created_at'],
  // Batch 8, the live room's suggestions and the wheel's question draws (0034).
  teaching_moves: ['id', 'session_id', 'purpose', 'activity_kind', 'title', 'body', 'focus_level', 'topic', 'basis', 'source_ref',
    'model', 'asked_by', 'asked_at'],
  wheel_question_draws: ['id', 'session_id', 'pick_id', 'draw_order', 'question_id', 'pool_size', 'drawn_at', 'drawn_by'],
};

// Batch 8: the live room's suggestions and the wheel's question draws (0034).
const ZIP_TABLES = ['teaching_moves', 'wheel_question_draws'];

// The hub's content backbone (0025), and its practice evidence and explanations (0026).
const HUB_TABLES = ['class_units', 'class_chapters', 'chapter_topics', 'topic_links', 'hub_attempts', 'question_explanations'];

// The hub's lessons and languages (0027).
const LESSON_TABLES = ['topic_lessons', 'item_translations', 'student_language_choices'];

// The hub's Get Ready checks, self-tests and goals (0028).
const PATH_TABLES = ['hub_runs', 'hub_goals'];
// The hub's tutor: hints, feedback on wrong options, and the hints each student opened (0029).
const TUTOR_TABLES = ['question_hints', 'option_feedback', 'hub_hint_views'];

// The course-outcome tables (0019), and the attainment formula's (0020).
const OUTCOME_TABLES = ['course_outcomes', 'outcome_topics', 'question_outcome_overrides', 'attainment_configs'];

// The teacher-record tables (0017), every one a room's record.
const RECORD_TABLES = ['observations', 'wheel_rounds', 'wheel_picks', 'hand_tallies', 'room_activities', 'insight_actions'];

// A roster holds a roll number and a name, and nothing that identifies a person
// any further. A column added to it should be a decision, so this says so.
// under_18 was one: the owner's yes-or-no mark (decision 8, 0022), no date of birth.
const ROSTER_COLUMNS = ['id', 'class_id', 'roll_no', 'name', 'added_at', 'removed_at', 'under_18'];

// The fields outAccount() in services/accounts.js reads off an accounts_below() row.
const OUT_ACCOUNT_FIELDS = ['id', 'role', 'full_name', 'email', 'code', 'department', 'reports_to', 'roll_no',
  'active', 'created_at', 'updated_at'];

// ------------------------------------------------------------------- files --

section('migration files');

const files = await migrationFiles();
check('supabase/migrations holds at least one file', files.length > 0);

const numbers = files.map((f) => /^(\d{4})_[a-z0-9_]+\.sql$/.exec(f.name)?.[1]);
check('every file is named NNNN_name.sql', numbers.every(Boolean), files.map((f) => f.name).join(', '));
{
  const want = numbers.map((_, n) => String(n).padStart(4, '0'));
  check('numbers are unique and run 0000, 0001, ... without gaps',
    numbers.join(',') === want.join(','), numbers.join(', '));
}

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
    check('a roster row holds a roll number, a name and the under-18 mark (0022), and nothing else about the student', extra.length === 0,
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
  // 6 primary keys, 4 unique places, and 15 for rooms, students, days, questions and markers;
  // and 0034's one for the suggestion an activity came from.
  check('the record tables carry their indexes (unique places, rooms, students, days, markers)', idx.rows[0].n === 26, `${idx.rows[0].n} indexes`);
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

section('the owner\'s decisions of 19 Nov 2026 (0022)');

// Kept by the re-run section below, which checks each survives it.
const kept22 = {};
{
  const shape = async (table, column) => (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = $1 and column_name = $2`, [table, column])).rows[0] ?? null;
  for (const [table, column] of [['profiles', 'account_verified'], ['answers', 'account_verified'], ['class_students', 'under_18']]) {
    const s = await shape(table, column);
    check(`${table}.${column} is boolean, never null, default false`,
      s?.data_type === 'boolean' && s?.is_nullable === 'NO' && s?.column_default === 'false', JSON.stringify(s));
  }
  const r = await shape('questions', 'replaces_id');
  check('questions.replaces_id is a uuid, null allowed, with no default', r?.data_type === 'uuid' && r?.is_nullable === 'YES'
    && r?.column_default === null, JSON.stringify(r));

  // Decision 7. The profile saved above (saveProfile, linked to STUDENT) never
  // said it was verified: a link without the flag reads as unverified.
  {
    const { rows } = await db.query('select account_id, account_verified from public.profiles where session_id = $1', [session?.id]);
    check('a profile linked without saying so reads back unverified', rows[0]?.account_id === STUDENT && rows[0]?.account_verified === false);
  }
  await accepts('saveProfile\'s upsert with account_verified, as a signed-in phone\'s join sends it', () => db.query(
    `insert into public.profiles (session_id, roll_no, account_id, account_verified, updated_at) values ($1, '07', $2, true, now())
     on conflict (session_id, roll_no) do update set account_id = excluded.account_id, account_verified = excluded.account_verified,
       updated_at = excluded.updated_at`, [session?.id, STUDENT]));
  {
    const { rows } = await db.query('select account_verified from public.profiles where session_id = $1', [session?.id]);
    check('and it reads back verified', rows.length === 1 && rows[0].account_verified === true);
  }
  const [unflagged] = (await insertAnswer({ key: 'k-22a', questionId: match?.id })).rows;
  check('an answer written without the flag is unverified', unflagged?.account_verified === false);
  const [flagged] = (await accepts('an answer sent by a signed-in phone, as recordAnswer writes it', () => db.query(
    `insert into public.answers (session_id, answer_key, roll_no, account_id, bloom, account_verified)
     values ($1, 'k-22b', '07', $2, 'apply', true) returning *`, [session?.id, STUDENT]))) ?? [];
  check('reads back verified', flagged?.account_verified === true);
  await rejects('an answer\'s account_verified is written once (0012\'s guard covers it as it covers every new column)', () =>
    db.query('update public.answers set account_verified = true where id = $1', [unflagged?.id]), { code: '23001' });
  kept22.answer = flagged?.id;

  // Decision 8.
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Biology', 'FY-A') returning id`, [PROF])).rows;
  const [plain] = (await accepts('a roster row as every add before 0022 sent it: no mark', () => db.query(
    `insert into public.class_students (class_id, roll_no, name) values ($1, '24BIO01', 'Asha') returning *`, [cls.id]))) ?? [];
  check('is not under 18', plain?.under_18 === false);
  const [minor] = (await accepts('a roster row marked under 18, as addClassStudents sends it', () => db.query(
    `insert into public.class_students (class_id, roll_no, name, under_18) values ($1, '24BIO02', 'Bilal', true) returning *`,
    [cls.id]))) ?? [];
  check('reads back under 18', minor?.under_18 === true);
  await accepts('the mark is changed on its own, as updateClassStudent sends it', () =>
    db.query('update public.class_students set under_18 = true where id = $1', [plain?.id]));
  kept22.minor = minor?.id;

  // A professor's own question, and a regenerated draft that replaces an active one.
  const [own] = (await accepts('a question a professor wrote: source teacher', () =>
    insertQuestion({ text: 'Own question', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember', source: 'teacher' }))) ?? [];
  await accepts('llm and fallback are still accepted', async () => {
    await insertQuestion({ text: 'Model', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember', source: 'llm' });
    return insertQuestion({ text: 'Template', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember', source: 'fallback' });
  });
  await rejects('a source outside llm, fallback and teacher', () =>
    insertQuestion({ text: 'Bad', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember', source: 'human' }),
  { code: '23514', match: /questions_source_check/ });
  {
    // 0000's inline check is named questions_source_check by Postgres, which is
    // the name 0022 drops: so one check, the wide one, not two side by side.
    const { rows } = await db.query(`select conname, pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.questions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%(source = %'`);
    check('one check limits questions.source: 0000\'s inline one was replaced, not left beside it',
      rows.length === 1 && rows[0].conname === 'questions_source_check' && /'teacher'/.test(rows[0].def), JSON.stringify(rows));
  }
  const [draft] = (await accepts('a regenerated draft naming the active question it replaces', () => db.query(
    `insert into public.questions (content_id, topic, text, kind, options, answer_idx, bloom, status, source, payload, model, replaces_id)
     values ($1, 'Sets', 'Replacement', 'mcq', '["a","b","c","d"]', 2, 'remember', 'draft', 'llm', '{}', 'm', $2) returning *`,
    [content?.id, own?.id]))) ?? [];
  check('it reads back with the link', draft?.replaces_id === own?.id);
  await rejects('a link to a question that does not exist', () => db.query(
    `insert into public.questions (content_id, text, options, answer_idx, bloom, replaces_id) values ($1, 'x', '["a","b","c","d"]', 0, 'apply', $2)`,
    [content?.id, randomUUID()]), { code: '23503' });
  await db.query('delete from public.questions where id = $1', [own?.id]);
  {
    const { rows } = await db.query('select replaces_id, status from public.questions where id = $1', [draft?.id]);
    check('deleting the replaced question (a replacing generate) keeps the draft and clears its link',
      rows[0]?.status === 'draft' && rows[0]?.replaces_id === null);
  }
  const idx = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'questions_replaces_idx'`);
  check('drafts that replace a question have their own index', /WHERE \(replaces_id IS NOT NULL\)/.test(idx.rows[0]?.indexdef ?? ''),
    idx.rows[0]?.indexdef ?? 'missing');
  // Left in place: the re-run below runs over them.
}

section('class questions and their votes (0023)');

// Kept by the re-run section below, which checks each survives it.
const kept23 = {};
{
  const KEPT = { code: '23001' };
  const [room] = (await db.query(
    `insert into public.sessions (code, content_id, owner_id) values ('CQ0001', $1, $2) returning *`, [content?.id, PROF])).rows;
  const snap = { id: match?.id, text: 'Pick one', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 2, bloom: 'remember', topic: 'Sets' };
  // The columns addClassQuestion() writes.
  const ask = (seq, cols = {}) => db.query(
    `insert into public.class_questions (session_id, seq, question_id, question_snapshot, state, started_at, started_by)
     values ($1, $2, $3, $4, $5, now(), $6) returning *`,
    [cols.sessionId ?? room.id, seq, cols.questionId ?? match?.id, JSON.stringify(snap), cols.state ?? 'open', PROF]);
  const [cq] = (await accepts('a class question, as addClassQuestion writes it', () => ask(1))) ?? [];
  check('it opens in round 1, not revealed, with no pause, re-vote or close yet',
    cq?.state === 'open' && cq?.revealed === false && cq?.paused_at === null && cq?.revote_at === null && cq?.closed_at === null
    && cq?.question_snapshot?.answerIdx === 2, JSON.stringify(cq));
  await rejects('a second class question running in the same room', () => ask(2), { code: '23505', match: /class_questions_one_running/ });
  await rejects('a state outside open, paused, revote and closed', () =>
    db.query(`update public.class_questions set state = 'voting' where id = $1`, [cq?.id]), { code: '23514' });
  await rejects('a key revealed before it closes', () =>
    db.query('update public.class_questions set revealed = true where id = $1', [cq?.id]), { code: '23514', match: /class_questions_revealed_check/ });
  await accepts('pausing round 1, as updateClassQuestion writes it', () =>
    db.query(`update public.class_questions set state = 'paused', paused_at = now() where id = $1`, [cq?.id]));

  // A vote is an answers row with the class question's id and its round.
  const vote = (key, cols = {}) => db.query(
    `insert into public.answers (session_id, answer_key, roll_no, question_id, content_id, topic, bloom, kind, question_snapshot,
       response, attempt, final, correct, score, class_question_id, round, confidence)
     values ($1, $2, '07', $3, $4, 'Sets', 'remember', 'mcq', $5, '2', $6, $7, true, 1, $8, $9, $10) returning *`,
    [room.id, key, match?.id, content?.id, JSON.stringify(snap), cols.attempt ?? 1, cols.final ?? true,
      'classQuestionId' in cols ? cols.classQuestionId : cq?.id, 'round' in cols ? cols.round : 1, cols.confidence ?? null]);
  const [v1] = (await accepts('a round 1 vote with a confidence tap, as handleVote writes it', () => vote('cq-1', { confidence: 'sure' }))) ?? [];
  check('it reads back with its class question and round', v1?.class_question_id === cq?.id && v1?.round === 1 && v1?.confidence === 'sure');
  await accepts('a round 2 vote, the re-vote after discussion', () => vote('cq-2', { round: 2, confidence: 'guess' }));
  await rejects('a round 3', () => vote('cq-3', { round: 3 }), { code: '23514', match: /answers_round_check/ });
  await rejects('a round with no class question', () => vote('cq-4', { classQuestionId: null, round: 1 }), { code: '23514' });
  await rejects('a class question with no round', () => vote('cq-5', { round: null }), { code: '23514' });
  await accepts('a vote the phone changed, kept with final = false (the one update a vote takes)', () =>
    db.query('update public.answers set final = false where id = $1', [v1?.id]));
  await rejects('a vote\'s class question is written once (0012\'s guard)', () =>
    db.query('update public.answers set class_question_id = null, round = null where id = $1', [v1?.id]), KEPT);
  await rejects('a vote\'s round is written once', () => db.query('update public.answers set round = 2 where id = $1', [v1?.id]), KEPT);
  // The taps are stored in 0008's own spellings (services/confidence.js): no check was widened.
  await rejects('a confidence spelt the way the phone sends it, think_so, is not a stored value', () =>
    vote('cq-6', { confidence: 'think_so' }), { code: '23514', match: /answers_confidence_check/ });
  {
    const { rows } = await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint
      where conrelid = 'public.answers'::regclass and conname = 'answers_confidence_check'`);
    check('answers_confidence_check is 0008\'s, unchanged: sure, think and guess', rows.length === 1
      && /'sure'/.test(rows[0].def) && /'think'/.test(rows[0].def) && /'guess'/.test(rows[0].def) && !/think_so/.test(rows[0].def),
      JSON.stringify(rows));
  }
  {
    const [plain] = (await insertAnswer({ key: 'k-23a', questionId: match?.id })).rows;
    check('every other answer has no class question and no round', plain?.class_question_id === null && plain?.round === null);
  }
  await accepts('closing it with the key revealed', () => db.query(
    `update public.class_questions set state = 'closed', closed_at = now(), closed_by = $2, revealed = true where id = $1`, [cq?.id, PROF]));
  const [next] = (await accepts('another class question once the first is closed', () => ask(2))) ?? [];
  await rejects('the same place twice in one room', () => ask(2, { state: 'closed' }), { code: '23505', match: /class_questions_session_seq_key/ });
  await accepts('a closed class question in the same room, whatever else is running', () => ask(3, { state: 'closed' }));
  await rejects('a class question in a room that does not exist', () => ask(1, { sessionId: randomUUID() }), { code: '23503' });
  {
    const idx = await db.query(`select indexname, indexdef from pg_indexes where schemaname = 'public'
      and (tablename = 'class_questions' or indexname = 'answers_class_question_idx')`);
    const by = Object.fromEntries(idx.rows.map((r) => [r.indexname, r.indexdef]));
    check('one running class question per room is an index of its own, and a vote is found by its class question',
      /UNIQUE INDEX class_questions_one_running .*WHERE \(state <> 'closed'::text\)/.test(by.class_questions_one_running ?? '')
      && /WHERE \(class_question_id IS NOT NULL\)/.test(by.answers_class_question_idx ?? ''), JSON.stringify(by));
  }
  kept23.room = room.id;
  kept23.next = next?.id;
  {
    // Deleting a room takes its class questions and their votes with it.
    const [gone] = (await db.query(
      `insert into public.sessions (code, content_id, owner_id) values ('CQ0002', $1, $2) returning id`, [content?.id, PROF])).rows;
    const [c] = (await ask(1, { sessionId: gone.id })).rows;
    await db.query(`insert into public.answers (session_id, answer_key, roll_no, bloom, class_question_id, round)
      values ($1, 'cq-gone', '07', 'remember', $2, 1)`, [gone.id, c.id]);
    await accepts('deleting a room that asked the class a question', () => db.query('delete from public.sessions where id = $1', [gone.id]));
    const left = await db.query(`select (select count(*) from public.class_questions where session_id = $1)::int as cq,
      (select count(*) from public.answers where session_id = $1)::int as votes`, [gone.id]);
    check('its class questions and their votes go with it', left.rows[0].cq === 0 && left.rows[0].votes === 0, JSON.stringify(left.rows[0]));
  }
  // Left in place: the re-run below runs over them.
}

section('misconception labels on wrong options (0024)');

// Kept by the re-run section below, which checks it survives it.
const kept24 = {};
{
  const s = (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'questions' and column_name = 'misconceptions'`)).rows[0] ?? null;
  check('questions.misconceptions is jsonb, never null, an empty list by default',
    s?.data_type === 'jsonb' && s?.is_nullable === 'NO' && /^'\[\]'::jsonb$/.test(s?.column_default ?? ''), JSON.stringify(s));
  const [plain] = (await accepts('a question saved as every save before 0024 sent it: no labels', () =>
    insertQuestion({ text: 'Which is a set?', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 2, bloom: 'remember' }))) ?? [];
  check('has none', JSON.stringify(plain?.misconceptions) === '[]', JSON.stringify(plain?.misconceptions));
  // As insertQuestions and updateQuestion write it (services/misconceptions.js).
  const at = '2026-11-19T09:00:00.000Z';
  const labels = [
    { option: 'a', label: 'Thinks a set holds repeats', provenance: 'ai', addedAt: at, changedAt: at, by: null },
    { option: 'b', label: 'Reads union as intersection', provenance: 'professor', addedAt: at, changedAt: at, by: PROF },
  ];
  const label = async (value) => {
    const result = await db.query('update public.questions set misconceptions = $2 where id = $1 returning misconceptions',
      [plain?.id, JSON.stringify(value)]);
    // An update that matched no row would pass every refusal below for nothing.
    if (result.rows.length !== 1) throw new Error('the question to label is missing');
    return result;
  };
  const [saved] = (await accepts('labels from the generator and from the professor, as the label route writes them',
    () => label(labels))) ?? [];
  // jsonb keeps no key order, so each entry is compared key by key.
  const sorted = (list) => JSON.stringify((list ?? []).map((l) => Object.fromEntries(Object.entries(l).sort())));
  check('they read back as written', sorted(saved?.misconceptions) === sorted(labels), JSON.stringify(saved));
  await accepts('a question\'s labels cleared', () => label([]));
  await rejects('labels that are not a list', () => label({ option: 'a', label: 'x', provenance: 'ai' }),
    { code: '23514', match: /questions_misconceptions_check/ });
  await rejects('a label from neither the generator nor the professor', () =>
    label([{ option: 'a', label: 'x', provenance: 'human' }]), { code: '23514', match: /questions_misconceptions_check/ });
  await rejects('a label with no provenance', () => label([{ option: 'a', label: 'x' }]), { code: '23514' });
  await rejects('a label with no option', () => label([{ label: 'x', provenance: 'ai' }]), { code: '23514' });
  await rejects('a label that is not text', () => label([{ option: 'a', label: 7, provenance: 'ai' }]), { code: '23514' });
  await rejects('an entry that is not an object', () => label(['Thinks a set holds repeats']), { code: '23514' });
  const [inserted] = (await accepts('a generated question saved with its proposed labels, as insertQuestions sends it', () => db.query(
    `insert into public.questions (content_id, topic, text, kind, options, answer_idx, bloom, status, source, payload, model, misconceptions)
     values ($1, 'Sets', 'Which is a set?', 'mcq', '["a","b","c","d"]', 2, 'remember', 'draft', 'llm', '{}', 'm', $2) returning *`,
    [content?.id, JSON.stringify(labels.slice(0, 1))]))) ?? [];
  check('it reads back with them', inserted?.misconceptions?.[0]?.provenance === 'ai');
  await accepts('the labels are changed on their own, leaving the question\'s status and payload alone', () =>
    db.query('update public.questions set misconceptions = $2 where id = $1', [inserted?.id, JSON.stringify(labels)]));
  {
    const { rows } = await db.query('select status, payload, misconceptions from public.questions where id = $1', [inserted?.id]);
    check('a draft stays a draft with its labels changed', rows[0]?.status === 'draft' && JSON.stringify(rows[0]?.payload) === '{}'
      && rows[0]?.misconceptions?.length === 2, JSON.stringify(rows[0]));
  }
  kept24.question = inserted?.id;
  // Left in place: the re-run below runs over it.
}

section('the hub\'s content backbone: units, chapters, topic records, prerequisite links and slide texts (0025)');

// Kept by the re-run section below, which checks each survives it.
const kept25 = {};
{
  const KEPT = { code: '23514' };
  const legacy = (await db.query(`select id from public.contents where title = 'Legacy'`)).rows[0];

  // contents.slide_texts, as setContentSlideTexts writes it.
  const s25 = (await db.query(`select data_type, is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'contents' and column_name = 'slide_texts'`)).rows[0] ?? null;
  check('contents.slide_texts is jsonb and may be null (decks before 0025, pasted text)', s25?.data_type === 'jsonb' && s25?.is_nullable === 'YES');
  {
    const { rows } = await db.query('select slide_texts from public.contents where id = $1', [content?.id]);
    check('a chapter made before it has none', rows[0]?.slide_texts === null);
  }
  const slides = (value) => db.query('update public.contents set slide_texts = $2 where id = $1 returning slide_texts', [content?.id, value]);
  const [withSlides] = (await accepts('each slide\'s own words, as setContentSlideTexts writes them',
    () => slides(JSON.stringify([{ slide: 1, text: 'Sets are collections' }, { slide: 3, text: 'Union' }])))) ?? [];
  check('they read back as written', withSlides?.slide_texts?.[1]?.slide === 3 && withSlides?.slide_texts?.[1]?.text === 'Union');
  await rejects('slide texts that are not a list', () => slides(JSON.stringify({ slide: 1, text: 'x' })), { ...KEPT, match: /contents_slide_texts_check/ });
  await rejects('a slide with no text', () => slides(JSON.stringify([{ slide: 1 }])), KEPT);
  await rejects('a slide numbered by text', () => slides(JSON.stringify([{ slide: '1', text: 'x' }])), KEPT);

  // A class of the professor's, for the units and placements.
  const [cls] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Discrete Maths', 'SY B') returning *`, [PROF])).rows;
  const [otherClass] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Discrete Maths', 'SY C') returning *`, [PROF])).rows;
  const unit = (name, classId = cls.id, position = 1) => db.query(
    `insert into public.class_units (class_id, name, position, created_by) values ($1, $2, $3, $4) returning *`, [classId, name, position, PROF]);
  const [u1] = (await accepts('a unit, as createClassUnit writes it', () => unit('Unit 1: Sets'))) ?? [];
  await accepts('a second unit', () => unit('Unit 2', cls.id, 2));
  await rejects('a unit of the same name in the class, in another case', () => unit('UNIT 1: SETS'), { code: '23505', match: /class_units_class_name_key/ });
  await accepts('the same name in another class', () => unit('Unit 1: Sets', otherClass.id));
  await rejects('a blank unit name', () => unit('   '), { ...KEPT, match: /class_units_name_check/ });
  await rejects('a unit name with a double space', () => unit('Unit  3'), KEPT);
  await rejects('a unit at position 0', () => unit('Unit 9', cls.id, 0), { ...KEPT, match: /class_units_position_check/ });
  const [otherUnit] = (await db.query('select id from public.class_units where class_id = $1', [otherClass.id])).rows;

  const place = (cols = {}) => db.query(
    `insert into public.class_chapters (class_id, content_id, unit_id, position, added_by) values ($1, $2, $3, $4, $5) returning *`,
    [cols.classId ?? cls.id, cols.contentId ?? content?.id, 'unitId' in cols ? cols.unitId : u1?.id, cols.position ?? 1, PROF]);
  const [placed] = (await accepts('a chapter placed in a unit, as placeClassChapter writes it', () => place())) ?? [];
  await rejects('the same chapter twice on a class', () => place({ unitId: null }), { code: '23505', match: /class_chapters_class_content_key/ });
  await rejects('a chapter in a unit of another class', () => place({ classId: otherClass.id, unitId: u1?.id }), { code: '23503' });
  await rejects('a chapter placed on a class of another owner (here, a chapter nobody owns)', () =>
    place({ contentId: legacy?.id, unitId: null }), { ...KEPT, match: /professor who owns it/ });
  await accepts('the same chapter on another class of the professor\'s, in no unit', () =>
    place({ classId: otherClass.id, unitId: null }));
  await rejects('moving it into a unit of another class', () =>
    db.query('update public.class_chapters set unit_id = $2 where id = $1', [placed?.id, otherUnit?.id]), { code: '23503' });
  await accepts('removing the unit', () => db.query('delete from public.class_units where id = $1', [u1?.id]));
  {
    const { rows } = await db.query('select unit_id, content_id from public.class_chapters where id = $1', [placed?.id]);
    check('its chapter stays on the class, in no unit ("Other chapters")', rows[0]?.unit_id === null && rows[0]?.content_id === content?.id);
  }

  // Topic records, as addChapterTopics and syncTopics write them.
  const topic = (name, key = name.toLowerCase(), contentId = content?.id, position = 1) => db.query(
    `insert into public.chapter_topics (content_id, name, key, position) values ($1, $2, $3, $4)
     on conflict (content_id, key) do nothing returning *`, [contentId, name, key, position]);
  const [sets] = (await accepts('a topic record', () => topic('Sets'))) ?? [];
  const [relations] = (await accepts('a second topic record', () => topic('Relations', 'relations', content?.id, 2))) ?? [];
  const [functions] = (await accepts('a third', () => topic('Functions', 'functions', content?.id, 3))) ?? [];
  {
    const again = await topic('SETS', 'sets');
    check('the same key again in the chapter is skipped, as addChapterTopics asks (ON CONFLICT DO NOTHING)', again.rows.length === 0);
  }
  await rejects('the same key twice, without the skip', () => db.query(
    `insert into public.chapter_topics (content_id, name, key) values ($1, 'Sets', 'sets')`, [content?.id]), { code: '23505', match: /chapter_topics_content_key_key/ });
  await rejects('a topic name with spaces round it', () => topic(' Groups ', 'groups'), { ...KEPT, match: /chapter_topics_name_check/ });
  await rejects('a topic name over 300 characters', () => topic('x'.repeat(301), 'x'), KEPT);
  await accepts('retiring a topic, as syncTopics does when questions hang off it', () =>
    db.query('update public.chapter_topics set retired_at = now() where id = $1', [functions?.id]));
  await accepts('and bringing it back', () => db.query('update public.chapter_topics set retired_at = null where id = $1', [functions?.id]));
  const [legacyTopic] = (await topic('Old', 'old', legacy?.id)).rows;

  // Prerequisite links, as addTopicLink and updateTopicLink write them.
  const link = (p, t, cols = {}) => db.query(
    `insert into public.topic_links (owner_id, prerequisite_id, topic_id, provenance, state, reason, model, created_by, decided_at, decided_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    ['ownerId' in cols ? cols.ownerId : PROF, p, t, cols.provenance ?? 'professor', cols.state ?? 'confirmed', cols.reason ?? '',
      cols.model ?? null, PROF, 'decidedAt' in cols ? cols.decidedAt : new Date().toISOString(), PROF]);
  const [l1] = (await accepts('a professor\'s link: Sets before Relations, confirmed at once', () => link(sets?.id, relations?.id))) ?? [];
  await accepts('Relations before Functions', () => link(relations?.id, functions?.id));
  await rejects('the same pair twice', () => link(sets?.id, relations?.id, { provenance: 'ai', state: 'proposed', decidedAt: null, model: 'm' }),
    { code: '23505', match: /topic_links_pair_key/ });
  await rejects('a topic before itself', () => link(sets?.id, sets?.id), { ...KEPT, match: /topic_links_not_self/ });
  await rejects('a confirmed link that closes a loop (Functions before Sets)', () => link(functions?.id, sets?.id), { ...KEPT, match: /loop/ });
  const [proposal] = (await accepts('the same loop as an AI proposal: proposals are drafts and close nothing', () =>
    link(functions?.id, sets?.id, { provenance: 'ai', state: 'proposed', decidedAt: null, model: 'm', reason: 'One line.' }))) ?? [];
  await rejects('confirming it', () => db.query(
    `update public.topic_links set state = 'confirmed', decided_at = now(), decided_by = $2 where id = $1`, [proposal?.id, PROF]),
  { ...KEPT, match: /loop/ });
  await accepts('rejecting it', () => db.query(
    `update public.topic_links set state = 'rejected', decided_at = now(), decided_by = $2 where id = $1`, [proposal?.id, PROF]));
  await rejects('a professor\'s link left proposed', () => link(sets?.id, functions?.id, { state: 'proposed', decidedAt: null }),
    { ...KEPT, match: /topic_links_state_check/ });
  await rejects('a proposal with a decision time', () => link(sets?.id, functions?.id, { provenance: 'ai', state: 'proposed', model: 'm' }),
    { ...KEPT, match: /topic_links_state_check/ });
  await rejects('a decision with no decision time', () => link(sets?.id, functions?.id, { decidedAt: null }), KEPT);
  await rejects('a model on a professor\'s link', () => link(sets?.id, functions?.id, { model: 'm' }), { ...KEPT, match: /topic_links_model_check/ });
  await rejects('a provenance outside ai and professor', () => link(sets?.id, functions?.id, { provenance: 'teacher' }), KEPT);
  await rejects('a reason over 300 characters', () => link(sets?.id, functions?.id, { reason: 'x'.repeat(301) }), KEPT);
  await rejects('a link to a topic of a chapter of another owner', () => link(sets?.id, legacyTopic?.id), { ...KEPT, match: /own professor/ });
  await rejects('a link owned by someone other than the chapters\' owner', () => link(sets?.id, functions?.id, { ownerId: null }), KEPT);
  {
    // Deleting a topic takes its links with it (the server deletes only a record nothing hangs off).
    const [spare] = (await topic('Spare', 'spare', content?.id, 4)).rows;
    await link(spare.id, functions?.id);
    await accepts('deleting a topic record', () => db.query('delete from public.chapter_topics where id = $1', [spare.id]));
    const { rows } = await db.query('select count(*)::int as n from public.topic_links where prerequisite_id = $1', [spare.id]);
    check('its links go with it', rows[0].n === 0);
  }
  kept25.link = l1?.id;
  kept25.sets = sets?.id;
  kept25.functions = functions?.id;
  kept25.placed = placed?.id;
  // Left in place: the re-run below runs over them.
}

section('the hub\'s practice evidence and explanations: hub attempts, append-only, and one explanation per question (0026)');

// Kept by the re-run section below, which checks each survives it.
const kept26 = {};
{
  const KEPT = { code: '23514' };
  const GUARD = { code: '23001', match: /hub_attempts/ };
  const [cls26] = (await db.query(
    `insert into public.classes (owner_id, course_name, section) values ($1, 'Discrete Maths', 'SY D') returning *`, [PROF])).rows;
  const [q26] = (await insertQuestion({ text: 'Practise me', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'apply', source: 'teacher' })).rows;
  const [temp] = (await db.query(
    `insert into public.chapter_topics (content_id, name, key, position) values ($1, 'Temp', 'temp', 9) returning *`, [content?.id])).rows;

  // As addHubAttempt writes it.
  const attempt = (cols = {}) => db.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, class_id, content_id, topic_id, topic, question_id, bloom, kind,
       question_snapshot, question_source, response, correct, score, detail, review_status, mode, language, hints_used, time_taken_ms, created_at)
     values ($1, $2, $3, $4, $5, 'Sets', $6, $7, $8, $9, 'teacher', $10, $11, $12, '', $13, $14, $15, $16, $17, $18) returning *`,
    [cols.accountId ?? STUDENT, cols.key ?? 'attempt-0001', cls26?.id, content?.id, 'topicId' in cols ? cols.topicId : kept25.sets,
      'questionId' in cols ? cols.questionId : q26?.id, cols.bloom ?? 'apply', cols.kind ?? 'mcq',
      JSON.stringify({ id: q26?.id, text: 'Practise me', options: ['a', 'b', 'c', 'd'], answerIdx: 1 }), JSON.stringify(cols.response ?? 1),
      cols.correct ?? true, cols.score ?? 1, cols.reviewStatus ?? 'auto', cols.mode ?? 'practice', cols.language ?? 'en',
      cols.hints ?? 0, 'time' in cols ? cols.time : 4200, cols.createdAt ?? new Date().toISOString()]);
  const [first] = (await accepts('a hub attempt, as addHubAttempt writes it', () => attempt())) ?? [];
  check('it reads back with its snapshot, response and mark', first?.question_snapshot?.answerIdx === 1 && first?.response === 1
    && first?.correct === true && Number(first?.score) === 1 && first?.mode === 'practice' && first?.language === 'en' && first?.hints_used === 0
    && first?.time_taken_ms === 4200);
  {
    const { rows } = await db.query(
      `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode) values ($1, 'attempt-0002', 'remember', false, 0, 'review')
       returning class_id, topic, kind, question_snapshot, review_status, language, hints_used, time_taken_ms, created_at`, [STUDENT]);
    const r = rows[0];
    check('an attempt sent with only what it needs gets the defaults: no links, en, no hints, the server\'s time',
      r?.class_id === null && r?.topic === '' && r?.kind === 'mcq' && JSON.stringify(r?.question_snapshot) === '{}' && r?.review_status === 'auto'
      && r?.language === 'en' && r?.hints_used === 0 && r?.time_taken_ms === null && r?.created_at instanceof Date);
  }
  await rejects('the same client attempt id twice for one student', () => attempt(),
    { code: '23505', match: /hub_attempts_account_attempt_key/ });
  await accepts('the same client attempt id for another student', () => attempt({ accountId: STUDENT_2 }));
  await accepts('a written answer\'s provisional machine mark', () => attempt({ key: 'attempt-open', kind: 'open', reviewStatus: 'provisional', score: 0.5, correct: false }));
  await accepts('each of the five modes', async () => {
    for (const mode of ['exam', 'getready', 'review', 'lesson']) await attempt({ key: `attempt-${mode}`, mode });
  });
  await rejects('a client attempt id that is too short', () => attempt({ key: 'short' }), { ...KEPT, match: /hub_attempts_client_attempt_id_check/ });
  await rejects('a client attempt id with a space', () => attempt({ key: 'two words here' }), KEPT);
  await rejects('a level spelt "analyze"', () => attempt({ key: 'attempt-0003', bloom: 'analyze' }), { ...KEPT, match: /hub_attempts_bloom_check/ });
  await rejects('a poll', () => attempt({ key: 'attempt-0004', kind: 'poll' }), { ...KEPT, match: /hub_attempts_kind_check/ });
  await rejects('a score over 1', () => attempt({ key: 'attempt-0005', score: 1.5 }), { ...KEPT, match: /hub_attempts_score_check/ });
  await rejects('a review status a hub attempt never has', () => attempt({ key: 'attempt-0006', reviewStatus: 'confirmed' }), { ...KEPT, match: /review_status/ });
  await rejects('a mode outside the five', () => attempt({ key: 'attempt-0007', mode: 'homework' }), { ...KEPT, match: /hub_attempts_mode_check/ });
  await rejects('a language that is not a short code', () => attempt({ key: 'attempt-0008', language: 'english' }), { ...KEPT, match: /hub_attempts_language_check/ });
  await rejects('four hints (the ladder has three steps)', () => attempt({ key: 'attempt-0009', hints: 4 }), { ...KEPT, match: /hub_attempts_hints_used_check/ });
  await rejects('a negative time taken', () => attempt({ key: 'attempt-0010', time: -1 }), { ...KEPT, match: /hub_attempts_time_taken_check/ });
  await accepts('no time taken at all', () => attempt({ key: 'attempt-0011', time: null }));

  // Append-only (the guard): nothing changes, nothing goes, except through a foreign key.
  await rejects('changing a hub attempt\'s response', () => db.query(`update public.hub_attempts set response = '2' where id = $1`, [first?.id]), GUARD);
  await rejects('changing its mark', () => db.query('update public.hub_attempts set correct = false, score = 0 where id = $1', [first?.id]), GUARD);
  await rejects('clearing its question by hand', () => db.query('update public.hub_attempts set question_id = null where id = $1', [first?.id]), GUARD);
  await rejects('deleting it', () => db.query('delete from public.hub_attempts where id = $1', [first?.id]), GUARD);
  {
    const [moved] = (await attempt({ key: 'attempt-temp', topicId: temp?.id })).rows;
    await accepts('deleting a topic record a hub attempt points at', () => db.query('delete from public.chapter_topics where id = $1', [temp?.id]));
    const { rows } = await db.query('select topic_id, topic, question_snapshot from public.hub_attempts where id = $1', [moved?.id]);
    check('the attempt stays, its topic link cleared and its topic name and snapshot kept',
      rows.length === 1 && rows[0].topic_id === null && rows[0].topic === 'Sets' && rows[0].question_snapshot?.answerIdx === 1);
  }
  {
    // A student account deleted: their attempts go with it (the cascade the guard allows).
    const gone = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [gone]);
    await insertAccount({ id: gone, role: 'student', fullName: 'Leaving', email: 'leaving@example.test', code: 'BL-ST2601', reportsTo: PROF, rollNo: '26' });
    await attempt({ accountId: gone, key: 'attempt-gone' });
    await accepts('deleting a student\'s sign-in, which deletes their account', () => db.query('delete from auth.users where id = $1', [gone]));
    const { rows } = await db.query('select count(*)::int as n from public.hub_attempts where account_id = $1', [gone]);
    check('their hub attempts go with their account', rows[0].n === 0);
  }

  // Explanations, as addQuestionExplanation and updateQuestionExplanation write them.
  const explain = (cols = {}) => db.query(
    `insert into public.question_explanations (question_id, text, provenance, status, model, source_ref, created_by, approved_by, approved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [cols.questionId ?? q26?.id, cols.text ?? 'B is right because the slide says so.', cols.provenance ?? 'ai', cols.status ?? 'draft',
      'model' in cols ? cols.model : 'm', 'sourceRef' in cols ? cols.sourceRef : JSON.stringify({ kind: 'slides', slides: [2] }), PROF,
      cols.approvedBy ?? null, 'approvedAt' in cols ? cols.approvedAt : null]);
  const [draft] = (await accepts('an AI draft explanation, citing its slide', () => explain())) ?? [];
  check('it reads back a draft, with its model and slides', draft?.status === 'draft' && draft?.model === 'm' && draft?.source_ref?.slides?.[0] === 2);
  await rejects('a second explanation for the same question', () => explain(), { code: '23505', match: /question_explanations_question_key/ });
  await accepts('the professor approves it', () => db.query(
    `update public.question_explanations set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() where id = $1`, [draft?.id, PROF]));
  await accepts('the professor rewrites it: theirs now, approved, no model', () => db.query(
    `update public.question_explanations set text = 'In my words.', provenance = 'professor', model = null where id = $1`, [draft?.id]));
  const [other26] = (await insertQuestion({ text: 'Explain me', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember' })).rows;
  const on = (cols) => explain({ questionId: other26?.id, ...cols });
  await rejects('a professor\'s explanation left as a draft', () => on({ provenance: 'professor', model: null }), { ...KEPT, match: /question_explanations_status_check/ });
  await rejects('an approved one with no approval time', () => on({ status: 'approved' }), { ...KEPT, match: /question_explanations_status_check/ });
  await rejects('a draft with an approval time', () => on({ approvedAt: new Date().toISOString() }), KEPT);
  await rejects('a model on a professor\'s explanation', () => on({ provenance: 'professor', status: 'approved', approvedAt: new Date().toISOString() }),
    { ...KEPT, match: /question_explanations_model_check/ });
  await rejects('a blank text', () => on({ text: '   ' }), { ...KEPT, match: /question_explanations_text_check/ });
  await rejects('a text over 2000 characters', () => on({ text: 'x'.repeat(2001) }), KEPT);
  await rejects('a provenance outside ai and professor', () => on({ provenance: 'teacher', model: null, status: 'approved', approvedAt: new Date().toISOString() }),
    { ...KEPT, match: /question_explanations_provenance_check/ });
  await rejects('a source_ref that is not an object', () => on({ sourceRef: JSON.stringify([2]) }), { ...KEPT, match: /question_explanations_source_ref_check/ });
  await accepts('a professor\'s own, approved as written', () => on({ provenance: 'professor', status: 'approved', model: null, approvedAt: new Date().toISOString() }));
  {
    await accepts('deleting a question with an explanation and a hub attempt', async () => {
      await attempt({ key: 'attempt-q-gone', questionId: other26?.id });
      return db.query('delete from public.questions where id = $1', [other26?.id]);
    });
    const e = await db.query('select count(*)::int as n from public.question_explanations where question_id = $1', [other26?.id]);
    const a = await db.query(`select question_id, question_snapshot from public.hub_attempts where client_attempt_id = 'attempt-q-gone'`);
    check('its explanation goes with it; the attempt stays, its question cleared and its snapshot kept',
      e.rows[0].n === 0 && a.rows.length === 1 && a.rows[0].question_id === null && a.rows[0].question_snapshot?.answerIdx === 1);
  }
  kept26.attempt = first?.id;
  kept26.explanation = draft?.id;
  // Left in place: the re-run below runs over them.
}

section('lessons and languages: topic lessons, translations and a student\'s language (0027)');

// Kept by the re-run section below, which checks each survives it.
const kept27 = {};
{
  const KEPT = { code: '23514' };
  const RESTRICT = { code: '23001' };
  const legacy = (await db.query(`select id from public.contents where title = 'Legacy'`)).rows[0];
  const STEPS = [
    { type: 'chunk', slides: [1], text: 'Sets are collections' },
    { type: 'example', slides: [1], problem: 'Is {1, 1} a set of two?', steps: ['Repeats count once.'], answer: 'No.' },
    { type: 'questions', slides: [1], questionIds: [] },
  ];

  // Lessons, as createTopicLesson writes them.
  const lesson = (cols = {}) => db.query(
    `insert into public.topic_lessons (topic_id, content_id, owner_id, version, status, source, model, steps, basis, warnings, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [cols.topicId ?? kept25.sets, cols.contentId ?? content?.id, 'ownerId' in cols ? cols.ownerId : PROF, cols.version ?? 1,
      cols.status ?? 'draft', cols.source ?? 'llm', 'model' in cols ? cols.model : 'gemini-2.5-flash', JSON.stringify(cols.steps ?? STEPS),
      JSON.stringify({ from: 'slides', perSlideText: true, slides: [1], note: 'n' }), JSON.stringify([]), PROF]);
  const [v1] = (await accepts('a lesson, as createTopicLesson writes it: a draft', () => lesson())) ?? [];
  check('it reads back a draft, with nothing approved or retired', v1?.status === 'draft' && v1.approved_at === null && v1.retired_at === null
    && v1.steps?.[1]?.type === 'example');
  const [v2] = (await accepts('a slides-only version 2, with no model', () => lesson({ version: 2, source: 'slides', model: null }))) ?? [];
  const [v3] = (await accepts('and a version 3', () => lesson({ version: 3 }))) ?? [];
  await rejects('a version number taken twice', () => lesson({ version: 2, source: 'slides', model: null }),
    { code: '23505', match: /topic_lessons_topic_version_key/ });
  await rejects('a lesson written as approved', () => lesson({ version: 9, status: 'approved' }), { ...KEPT, match: /written as a draft/ });
  await rejects('a source outside llm and slides', () => lesson({ version: 9, source: 'web' }), { ...KEPT, match: /topic_lessons_source_check/ });
  await rejects('an AI lesson with no model', () => lesson({ version: 9, model: null }), { ...KEPT, match: /topic_lessons_source_check/ });
  await rejects('a slides-only lesson naming a model', () => lesson({ version: 9, source: 'slides' }), KEPT);
  await rejects('a version below 1', () => lesson({ version: 0 }), { ...KEPT, match: /topic_lessons_version_check/ });
  await rejects('a lesson with no steps', () => lesson({ version: 9, steps: [] }), { ...KEPT, match: /topic_lessons_steps_check/ });
  await rejects('a step of another type', () => lesson({ version: 9, steps: [{ type: 'video' }] }), { ...KEPT, match: /topic_lessons_steps_check/ });
  await rejects('a lesson whose topic is not one of its chapter\'s', () => lesson({ version: 9, contentId: legacy?.id, ownerId: null }),
    { code: '23503', match: /one of its chapter's topics/ });
  await rejects('a lesson of another owner than its chapter\'s', () => lesson({ version: 9, ownerId: null }), { ...KEPT, match: /owns its chapter/ });

  const approveLesson = (id, by = PROF) => db.query('select * from public.approve_topic_lesson($1, $2)', [id, by]);
  const [a1] = (await accepts('approving version 1, as approveTopicLesson does (approve_topic_lesson)', () => approveLesson(v1?.id))) ?? [];
  check('it is approved, with who and when', a1?.status === 'approved' && a1.approved_by === PROF && a1.approved_at !== null);
  await rejects('approving it again', () => approveLesson(v1?.id), { ...KEPT, match: /only a draft lesson can be approved/ });
  await accepts('approving version 2', () => approveLesson(v2?.id));
  {
    const { rows } = await db.query(`select version, status, approved_at is not null as approved, retired_at is not null as retired
      from public.topic_lessons where topic_id = $1 and version < 3 order by version`, [kept25.sets]);
    check('version 1 is retired by the same statement, keeping when it was approved; version 2 serves', JSON.stringify(rows)
      === JSON.stringify([{ version: 1, status: 'superseded', approved: true, retired: true }, { version: 2, status: 'approved', approved: true, retired: false }]),
    JSON.stringify(rows));
  }
  check('approving no such lesson returns no row', (await approveLesson(randomUUID())).rows.length === 0);
  await rejects('a second approved lesson for a topic, written directly', () => db.query(
    `update public.topic_lessons set status = 'approved', approved_at = now(), approved_by = $2 where id = $1`, [v3?.id, PROF]),
  { code: '23505', match: /topic_lessons_one_approved/ });
  await rejects('a retired lesson brought back', () => db.query(
    `update public.topic_lessons set status = 'approved', retired_at = null, retired_by = null where id = $1`, [v1?.id]),
  { ...KEPT, match: /not from superseded to approved/ });
  await rejects('changing an approved lesson\'s steps', () => db.query(
    `update public.topic_lessons set steps = '[{"type": "chunk", "text": "changed"}]' where id = $1`, [v2?.id]), { ...RESTRICT, match: /written once/ });
  await rejects('changing a draft\'s steps too: what was written is kept', () => db.query(
    `update public.topic_lessons set steps = '[{"type": "chunk", "text": "changed"}]' where id = $1`, [v3?.id]), RESTRICT);
  await rejects('changing who approved it', () => db.query(`update public.topic_lessons set approved_by = $2 where id = $1`, [v2?.id, HOD]),
    { ...RESTRICT, match: /written once/ });
  await rejects('deleting a lesson', () => db.query('delete from public.topic_lessons where id = $1', [v1?.id]),
    { ...RESTRICT, match: /goes only with its topic or its chapter/ });
  await accepts('discarding a draft, as discardTopicLesson does', () => db.query(
    `update public.topic_lessons set status = 'discarded', retired_at = now(), retired_by = $2 where id = $1 and status = 'draft'`, [v3?.id, PROF]));
  await rejects('a discarded draft brought back', () => db.query(
    `update public.topic_lessons set status = 'draft', retired_at = null, retired_by = null where id = $1`, [v3?.id]), KEPT);
  await rejects('approving a discarded draft', () => approveLesson(v3?.id), { ...KEPT, match: /only a draft lesson/ });

  // Translations, as addItemTranslation and editItemTranslation write them.
  const HASH = 'a'.repeat(64);
  const translation = (cols = {}) => db.query(
    `insert into public.item_translations (item_kind, item_id, content_id, owner_id, language, fields, source_fields, source_hash,
       status, provenance, model, checks, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning *`,
    [cols.itemKind ?? 'question', cols.itemId ?? mcq?.id, cols.contentId ?? content?.id, 'ownerId' in cols ? cols.ownerId : PROF,
      cols.language ?? 'hi', JSON.stringify(cols.fields ?? { text: 'एक चुनें', options: ['a', 'b', 'c', 'd'] }),
      JSON.stringify(cols.sourceFields ?? { text: 'Pick one', options: ['a', 'b', 'c', 'd'] }), cols.sourceHash ?? HASH,
      cols.status ?? 'draft', cols.provenance ?? 'ai', 'model' in cols ? cols.model : 'gemini-2.5-flash',
      JSON.stringify(cols.checks ?? [{ field: 'text', id: 'numbers', blocking: false, message: 'm' }]), cols.createdBy ?? PROF]);
  const [t1] = (await accepts('a Hindi translation of a question, a draft', () => translation())) ?? [];
  const [t2] = (await accepts('a second draft of it', () => translation())) ?? [];
  await accepts('a Marathi one written by the professor, with no model', () => translation({ language: 'mr', provenance: 'professor', model: null }));
  await accepts('a lesson\'s translation, in the same shape', () => translation({ itemKind: 'lesson', itemId: v2?.id,
    fields: { 'steps.0.text': 'Sets संग्रह हैं' }, sourceFields: { 'steps.0.text': 'Sets are collections' } }));
  await accepts('the kinds kept for the tutor\'s hints and explanations', () => translation({ itemKind: 'hint', itemId: randomUUID(),
    fields: { text: 'संकेत' }, sourceFields: { text: 'A nudge' } }));
  await rejects('a kind outside the list', () => translation({ itemKind: 'slide' }), { ...KEPT, match: /item_translations_kind_check/ });
  await rejects('a language outside Hindi and Marathi', () => translation({ language: 'en' }), { ...KEPT, match: /item_translations_language_check/ });
  await rejects('fields that are not an object', () => translation({ fields: ['x'] }), { ...KEPT, match: /item_translations_shape_check/ });
  await rejects('a source hash that is not 64 hex digits', () => translation({ sourceHash: 'abc' }), { ...KEPT, match: /item_translations_shape_check/ });
  await rejects('a provenance outside ai and professor', () => translation({ provenance: 'teacher' }), { ...KEPT, match: /item_translations_provenance_check/ });
  await rejects('a translation written as approved', () => translation({ status: 'approved' }), { ...KEPT, match: /written as a draft/ });
  await rejects('a translation of another owner than its chapter\'s', () => translation({ ownerId: null }), { ...KEPT, match: /owns its chapter/ });
  await accepts('editing a draft\'s text, as editItemTranslation does', () => db.query(
    `update public.item_translations set fields = '{"text": "एक चुनिए", "options": ["a", "b", "c", "d"]}', provenance = 'professor',
       edited_by = $2, updated_at = now(), checks = '[]' where id = $1`, [t1?.id, PROF]));
  const approveTranslation = (id, by = PROF) => db.query('select * from public.approve_item_translation($1, $2)', [id, by]);
  await accepts('approving it (approve_item_translation)', () => approveTranslation(t1?.id));
  await accepts('approving the second draft', () => approveTranslation(t2?.id));
  {
    const { rows } = await db.query(`select id, status from public.item_translations where item_kind = 'question' and item_id = $1 and language = 'hi'
      order by created_at, id`, [mcq?.id]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    check('the first is retired by the same statement; one approved per item and language', by[t1?.id] === 'superseded' && by[t2?.id] === 'approved',
      JSON.stringify(rows));
  }
  await rejects('editing an approved translation\'s text', () => db.query(
    `update public.item_translations set fields = '{"text": "x"}' where id = $1`, [t2?.id]), { ...RESTRICT, match: /only while it is a draft/ });
  await rejects('changing which item a translation is of', () => db.query(
    `update public.item_translations set item_id = $2 where id = $1`, [t1?.id, randomUUID()]), { ...RESTRICT, match: /written once/ });
  await rejects('approving a retired translation again', () => approveTranslation(t1?.id), { ...KEPT, match: /only a draft translation/ });
  await rejects('deleting a translation', () => db.query('delete from public.item_translations where id = $1', [t2?.id]),
    { ...RESTRICT, match: /goes only with its chapter/ });

  // Who decided is cleared when that account goes (ON DELETE SET NULL), and nothing else changes.
  const HOD2 = randomUUID();
  await db.query('insert into auth.users (id) values ($1)', [HOD2]);
  await insertAccount({ id: HOD2, role: 'hod', fullName: 'Head 2', email: 'hod2@example.test', code: 'BL-HD0027', department: 'MECH' });
  const [t3] = (await translation({ language: 'mr' })).rows;
  await approveTranslation(t3.id, HOD2);
  await accepts('deleting the sign-in of the account that approved a translation', () => db.query('delete from auth.users where id = $1', [HOD2]));
  {
    const { rows } = await db.query('select status, approved_by, approved_at is not null as approved from public.item_translations where id = $1', [t3.id]);
    check('the translation stays approved, with who approved it cleared', rows[0]?.status === 'approved' && rows[0].approved_by === null && rows[0].approved,
      JSON.stringify(rows));
  }

  // A student's language, as setLanguageChoice writes it (an upsert on the account).
  const choose = (language) => db.query(`insert into public.student_language_choices (account_id, language) values ($1, $2)
    on conflict (account_id) do update set language = excluded.language, updated_at = now() returning *`, [STUDENT, language]);
  await accepts('a student chooses Hindi', () => choose('hi'));
  await accepts('and then Marathi', () => choose('mr'));
  {
    const { rows } = await db.query('select language from public.student_language_choices where account_id = $1', [STUDENT]);
    check('one row per student, the latest choice', rows.length === 1 && rows[0].language === 'mr');
  }
  await rejects('a language outside English, Hindi and Marathi', () => choose('ta'), { ...KEPT, match: /student_language_choices_language_check/ });

  kept27.topic = kept25.sets;
  kept27.lesson = v2?.id;
  kept27.translation = t2?.id;
  // Left in place: the re-run below runs over them.
}

section('Get Ready checks, self-tests and goals: runs written once, answers filed under their own run, goals (0028)');

// Kept by the re-run section below, which checks each survives it.
const kept28 = {};
{
  const KEPT = { code: '23514' };
  const GUARD = { code: '23001', match: /hub_runs/ };
  const STARTED = '2026-11-19T04:30:00.000Z';
  // As addHubRun writes it.
  const run = (cols = {}) => db.query(
    `insert into public.hub_runs (account_id, client_run_id, kind, spec, time_limit_seconds, started_at, deadline_at, ended_at, end_reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [cols.accountId ?? STUDENT, cols.key ?? 'run-0001', cols.kind ?? 'getready',
      JSON.stringify(cols.spec ?? { targetTopicId: kept25.sets, prerequisites: [] }), cols.limit ?? null, cols.startedAt ?? STARTED,
      cols.deadline ?? null, cols.endedAt ?? null, cols.endReason ?? null]);
  const [gr] = (await accepts('a Get Ready check, as addHubRun writes it', () => run())) ?? [];
  check('it reads back open, with its spec', gr?.ended_at === null && gr?.end_reason === null && gr?.spec?.targetTopicId === kept25.sets);
  const [exam] = (await accepts('a timed self-test: its deadline is its start plus the limit', () => run({
    key: 'run-0002', kind: 'exam', spec: { questions: [] }, limit: 600, deadline: '2026-11-19T04:40:00.000Z',
  }))) ?? [];
  await rejects('the same client run id twice for one student', () => run(), { code: '23505', match: /hub_runs_account_run_key/ });
  await accepts('the same client run id for another student', () => run({ accountId: STUDENT_2 }));
  await rejects('a client run id that is too short', () => run({ key: 'short' }), { ...KEPT, match: /hub_runs_client_run_id_check/ });
  await rejects('a kind outside getready and exam', () => run({ key: 'run-0003', kind: 'quiz' }), { ...KEPT, match: /hub_runs_kind_check/ });
  await rejects('a spec that is not an object', () => run({ key: 'run-0004', spec: [] }), { ...KEPT, match: /hub_runs_spec_check/ });
  await rejects('a time limit on a Get Ready check', () => run({ key: 'run-0005', limit: 600, deadline: '2026-11-19T04:40:00.000Z' }),
    { ...KEPT, match: /hub_runs_time_limit_check/ });
  await rejects('a deadline that is not the start plus the limit', () => run({
    key: 'run-0006', kind: 'exam', limit: 600, deadline: '2026-11-19T05:40:00.000Z',
  }), { ...KEPT, match: /hub_runs_time_limit_check/ });
  await rejects('a time limit over three hours', () => run({ key: 'run-0007', kind: 'exam', limit: 10860, deadline: '2026-11-19T07:31:00.000Z' }), KEPT);
  await rejects('an end with no reason', () => run({ key: 'run-0008', endedAt: STARTED }), { ...KEPT, match: /hub_runs_end_check/ });
  await rejects('a check handed in like a self-test', () => run({ key: 'run-0009', endedAt: STARTED, endReason: 'submitted' }),
    { ...KEPT, match: /hub_runs_end_check/ });
  await rejects('a self-test timed out with no time limit', () => run({ key: 'run-0010', kind: 'exam', spec: {}, endedAt: STARTED, endReason: 'timed-out' }), KEPT);
  await rejects('an end before the start', () => run({ key: 'run-0011', endedAt: '2026-11-19T04:00:00.000Z', endReason: 'complete' }), KEPT);
  await accepts('a check complete when it starts (nothing to ask)', () => run({ key: 'run-0012', endedAt: STARTED, endReason: 'complete' }));

  // Answers filed under a run, as addHubAttempt writes them with a run.
  const filed = (cols = {}) => db.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode, run_id)
     values ($1, $2, 'apply', true, 1, $3, $4) returning *`,
    [cols.accountId ?? STUDENT, cols.key, cols.mode ?? 'getready', 'runId' in cols ? cols.runId : gr?.id]);
  const [a1] = (await accepts('a Get Ready answer filed under its check', () => filed({ key: 'run-attempt-01' }))) ?? [];
  check('it reads back with its run', a1?.run_id === gr?.id);
  await accepts('a self-test answer filed under its self-test', () => filed({ key: 'run-attempt-02', mode: 'exam', runId: exam?.id }));
  await accepts('a practice answer with no run, as before', () => filed({ key: 'run-attempt-00', mode: 'practice', runId: null }));
  await rejects('an answer filed under another student\'s run', () => filed({ key: 'run-attempt-03', accountId: STUDENT_2 }),
    { ...KEPT, match: /own student's run/ });
  await rejects('a practice answer filed under a check', () => filed({ key: 'run-attempt-04', mode: 'practice' }), { ...KEPT, match: /must have that mode/ });
  await rejects('a self-test answer filed under a check', () => filed({ key: 'run-attempt-05', mode: 'exam' }), { ...KEPT, match: /must have that mode/ });
  await rejects('an answer filed under a run that does not exist', () => filed({ key: 'run-attempt-06', runId: randomUUID() }), KEPT);
  await rejects('moving an answer to another run', () => db.query('update public.hub_attempts set run_id = $2 where id = $1', [a1?.id, exam?.id]),
    { code: '23001', match: /hub_attempts/ });

  // Written once, then ended once.
  await accepts('ending the check, as endHubRun does (only where it has no end yet)', () => db.query(
    `update public.hub_runs set ended_at = $2, end_reason = 'complete' where id = $1 and ended_at is null`, [gr?.id, '2026-11-19T04:35:00.000Z']));
  await rejects('ending it again', () => db.query(`update public.hub_runs set ended_at = now(), end_reason = 'complete' where id = $1`, [gr?.id]),
    { ...GUARD, match: /written once/ });
  await rejects('changing a self-test\'s list', () => db.query(`update public.hub_runs set spec = '{}' where id = $1`, [exam?.id]), GUARD);
  await rejects('stretching a self-test\'s time', () => db.query(
    `update public.hub_runs set time_limit_seconds = 1200, deadline_at = started_at + interval '20 minutes' where id = $1`, [exam?.id]), GUARD);
  await rejects('ending a self-test while stretching its time', () => db.query(
    `update public.hub_runs set ended_at = now(), end_reason = 'timed-out', deadline_at = started_at + interval '600 seconds' + interval '1 minute' where id = $1`,
    [exam?.id]), GUARD);
  await rejects('deleting a run', () => db.query('delete from public.hub_runs where id = $1', [exam?.id]), { ...GUARD, match: /goes only with its student/ });
  await accepts('handing the self-test in', () => db.query(
    `update public.hub_runs set ended_at = $2, end_reason = 'submitted' where id = $1 and ended_at is null`, [exam?.id, '2026-11-19T04:38:00.000Z']));
  {
    // A student account deleted: their runs, the answers filed under them and their goals go together.
    const gone = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [gone]);
    await insertAccount({ id: gone, role: 'student', fullName: 'Leaving', email: 'leaving28@example.test', code: 'BL-ST2801', reportsTo: PROF, rollNo: '28' });
    const [r] = (await run({ accountId: gone, key: 'run-gone-01', kind: 'exam', spec: {} })).rows;
    await filed({ accountId: gone, key: 'run-gone-a1', mode: 'exam', runId: r.id });
    await db.query(`insert into public.hub_goals (account_id, exam_date, topic_ids) values ($1, '2026-12-01', $2)`, [gone, JSON.stringify([kept25.sets])]);
    await accepts('deleting a student\'s sign-in with a run, an answer filed under it and a goal', () => db.query('delete from auth.users where id = $1', [gone]));
    const { rows } = await db.query(`select (select count(*) from public.hub_runs where account_id = $1)::int as r,
      (select count(*) from public.hub_attempts where account_id = $1)::int as a, (select count(*) from public.hub_goals where account_id = $1)::int as g`, [gone]);
    check('their runs, answers and goals go with their account', JSON.stringify(rows[0]) === '{"r":0,"a":0,"g":0}', JSON.stringify(rows[0]));
  }

  // Goals, as addHubGoal and updateHubGoal write them.
  const goal = (cols = {}) => db.query(
    `insert into public.hub_goals (account_id, title, exam_date, topic_ids) values ($1, $2, $3, $4) returning *, exam_date::text as day`,
    [STUDENT, cols.title ?? 'Mid-semester', cols.date ?? '2026-12-01', JSON.stringify(cols.topics ?? [kept25.sets])]);
  const [g1] = (await accepts('a goal: an exam date and its topics', () => goal())) ?? [];
  check('it reads back with its day and topics', g1?.day === '2026-12-01' && JSON.stringify(g1?.topic_ids) === JSON.stringify([kept25.sets]) && g1?.title === 'Mid-semester');
  await rejects('a title over 80 characters', () => goal({ title: 'x'.repeat(81) }), { ...KEPT, match: /hub_goals_title_check/ });
  await rejects('a goal with no topics', () => goal({ topics: [] }), { ...KEPT, match: /hub_goals_topic_ids_check/ });
  await rejects('topics that are not a list', () => goal({ topics: { a: 1 } }), { ...KEPT, match: /hub_goals_topic_ids_check/ });
  await rejects('61 topics', () => goal({ topics: Array.from({ length: 61 }, () => randomUUID()) }), KEPT);
  await rejects('a day that does not exist', () => goal({ date: '2026-02-30' }));
  await accepts('changing and removing a goal (the student\'s own plan, not evidence)', async () => {
    await db.query(`update public.hub_goals set title = 'Finals', updated_at = now() where id = $1`, [g1?.id]);
    return db.query('delete from public.hub_goals where id = $1', [g1?.id]);
  });
  const [g2] = (await goal({ title: 'Kept' })).rows;
  kept28.check = gr?.id;
  kept28.exam = exam?.id;
  kept28.attempt = a1?.id;
  kept28.goal = g2?.id;
  // Left in place: the re-run below runs over them.
}

section('the tutor: hint ladders, feedback on wrong options and the hints each student opened (0029)');

// Kept by the re-run section below, which checks each survives it.
const kept29 = {};
{
  const KEPT = { code: '23514' };
  const GUARD = { code: '23001', match: /hub_hint_views/ };
  const [q29] = (await insertQuestion({ text: 'Hint me', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 1, bloom: 'remember', source: 'teacher' })).rows;
  const now = new Date().toISOString();

  // Hints, as addQuestionHint and updateQuestionHint write them.
  const hint = (cols = {}) => db.query(
    `insert into public.question_hints (question_id, step, text, provenance, status, model, source_ref, created_by, approved_by, approved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [cols.questionId ?? q29?.id, cols.step ?? 1, cols.text ?? 'What does slide 2 say about sets?', cols.provenance ?? 'ai', cols.status ?? 'draft',
      'model' in cols ? cols.model : 'm', 'sourceRef' in cols ? cols.sourceRef : JSON.stringify({ kind: 'slides', slides: [2] }), PROF,
      cols.approvedBy ?? null, 'approvedAt' in cols ? cols.approvedAt : null]);
  const [h1] = (await accepts('an AI draft hint, step 1, citing its slide', () => hint())) ?? [];
  check('it reads back a draft, with its model and slides', h1?.status === 'draft' && h1?.model === 'm' && h1?.source_ref?.slides?.[0] === 2
    && Number(h1?.step) === 1);
  await rejects('a second hint at the same step', () => hint(), { code: '23505', match: /question_hints_question_step_key/ });
  await accepts('the professor\'s own step 2, approved as written', () => hint({ step: 2, provenance: 'professor', status: 'approved', model: null, approvedAt: now }));
  await accepts('the professor approves the draft', () => db.query(
    `update public.question_hints set status = 'approved', approved_by = $2, approved_at = now(), updated_at = now() where id = $1`, [h1?.id, PROF]));
  await rejects('a step 4 (the ladder has three)', () => hint({ step: 4 }), { ...KEPT, match: /question_hints_step_check/ });
  await rejects('a step 0', () => hint({ step: 0 }), { ...KEPT, match: /question_hints_step_check/ });
  await rejects('a blank text', () => hint({ step: 3, text: '  ' }), { ...KEPT, match: /question_hints_text_check/ });
  await rejects('a text over 600 characters', () => hint({ step: 3, text: 'x'.repeat(601) }), { ...KEPT, match: /question_hints_text_check/ });
  await rejects('a professor\'s hint left as a draft', () => hint({ step: 3, provenance: 'professor', model: null }), { ...KEPT, match: /question_hints_status_check/ });
  await rejects('an approved hint with no approval time', () => hint({ step: 3, status: 'approved' }), { ...KEPT, match: /question_hints_status_check/ });
  await rejects('a model on a professor\'s hint', () => hint({ step: 3, provenance: 'professor', status: 'approved', approvedAt: now }),
    { ...KEPT, match: /question_hints_model_check/ });
  await rejects('a provenance outside ai and professor', () => hint({ step: 3, provenance: 'teacher', model: null, status: 'approved', approvedAt: now }),
    { ...KEPT, match: /question_hints_provenance_check/ });
  await rejects('a source_ref that is not an object', () => hint({ step: 3, sourceRef: JSON.stringify([2]) }), { ...KEPT, match: /question_hints_source_ref_check/ });

  // Feedback on wrong options, as addOptionFeedback writes it.
  const feedback = (cols = {}) => db.query(
    `insert into public.option_feedback (question_id, option, option_key, text, provenance, status, model, source_ref, created_by, approved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [cols.questionId ?? q29?.id, cols.option ?? 'C', cols.optionKey ?? 'c', cols.text ?? 'c mixes up the two definitions.', cols.provenance ?? 'ai',
      cols.status ?? 'draft', 'model' in cols ? cols.model : 'm', null, PROF, 'approvedAt' in cols ? cols.approvedAt : null]);
  const [f1] = (await accepts('AI draft feedback on a wrong option, keyed by its words', () => feedback())) ?? [];
  await rejects('a second feedback on the same option', () => feedback({ option: 'c ' }), { code: '23505', match: /option_feedback_question_option_key/ });
  await accepts('the professor\'s own feedback on another option', () => feedback({ option: 'D', optionKey: 'd', provenance: 'professor', model: null,
    status: 'approved', approvedAt: now }));
  await rejects('a blank option', () => feedback({ option: ' ', optionKey: ' ' }), { ...KEPT, match: /option_feedback_option_check/ });
  await rejects('a text over 600 characters', () => feedback({ option: 'A', optionKey: 'a', text: 'x'.repeat(601) }), { ...KEPT, match: /option_feedback_text_check/ });
  await rejects('a professor\'s feedback left as a draft', () => feedback({ option: 'A', optionKey: 'a', provenance: 'professor', model: null }),
    { ...KEPT, match: /option_feedback_status_check/ });

  // The hints a student opened, as addHintView writes them.
  const view = (cols = {}) => db.query(
    `insert into public.hub_hint_views (account_id, client_attempt_id, question_id, topic_id, content_id, mode, position, kind, hint_id, text,
       provenance, language, translation_id, source_ref, plan)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning *`,
    [cols.accountId ?? STUDENT, cols.key ?? 'hint-attempt-01', 'questionId' in cols ? cols.questionId : q29?.id, kept25.sets, content?.id,
      cols.mode ?? 'practice', cols.position ?? 1, cols.kind ?? 'nudge', h1?.id, cols.text ?? 'What does slide 2 say about sets?',
      cols.provenance ?? 'ai', cols.language ?? 'en', null, JSON.stringify({ kind: 'slides', slides: [2] }),
      JSON.stringify(cols.plan ?? { items: [{ kind: 'nudge', step: 1 }, { kind: 'strategy', step: 2 }], why: 'w' })]);
  const [v1] = (await accepts('a hint opened in practice, as addHintView writes it', () => view())) ?? [];
  check('it reads back with its plan, the words shown and the server\'s time', v1?.plan?.items?.length === 2 && v1?.text?.startsWith('What')
    && v1?.created_at instanceof Date);
  await rejects('the same position twice for one attempt', () => view(), { code: '23505', match: /hub_hint_views_attempt_position_key/ });
  await accepts('position 2 of the same attempt, and hints opened in a lesson and a review set', async () => {
    await view({ position: 2, kind: 'strategy' });
    await view({ key: 'hint-attempt-02', mode: 'lesson' });
    await view({ key: 'hint-attempt-03', mode: 'review', kind: 'feedback' });
  });
  await rejects('a hint opened in a self-test', () => view({ key: 'hint-attempt-04', mode: 'exam' }), { ...KEPT, match: /hub_hint_views_mode_check/ });
  await rejects('a hint opened in Get Ready', () => view({ key: 'hint-attempt-05', mode: 'getready' }), { ...KEPT, match: /hub_hint_views_mode_check/ });
  await rejects('a fourth hint', () => view({ position: 4 }), { ...KEPT, match: /hub_hint_views_position_check/ });
  await rejects('a kind outside the four', () => view({ key: 'hint-attempt-06', kind: 'answer' }), { ...KEPT, match: /hub_hint_views_kind_check/ });
  await rejects('a short attempt id', () => view({ key: 'short' }), { ...KEPT, match: /hub_hint_views_client_attempt_id_check/ });
  await rejects('a plan that is not an object', () => view({ key: 'hint-attempt-07', plan: [] }), { ...KEPT, match: /hub_hint_views_shape_check/ });
  await rejects('a provenance outside ai and professor', () => view({ key: 'hint-attempt-08', provenance: 'model' }),
    { ...KEPT, match: /hub_hint_views_provenance_check/ });
  // Append-only (the guard): nothing changes, nothing goes, except through a foreign key.
  await rejects('changing the words shown', () => db.query(`update public.hub_hint_views set text = 'other' where id = $1`, [v1?.id]), GUARD);
  await rejects('clearing its question by hand', () => db.query('update public.hub_hint_views set question_id = null where id = $1', [v1?.id]), GUARD);
  await rejects('deleting it', () => db.query('delete from public.hub_hint_views where id = $1', [v1?.id]), GUARD);

  // hub_attempts: no hints on an attempt in a self-test or Get Ready.
  const attempt = (key, mode, hints) => db.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode, hints_used)
     values ($1, $2, 'remember', true, 1, $3, $4)`, [STUDENT, key, mode, hints]);
  await accepts('an attempt with two hints in practice, and one in a lesson', async () => {
    await attempt('hint-attempt-01', 'practice', 2);
    await attempt('hint-attempt-02', 'lesson', 1);
  });
  await accepts('attempts with no hints in a self-test and in Get Ready', async () => {
    await attempt('exam-attempt-01', 'exam', 0);
    await attempt('ready-attempt-01', 'getready', 0);
  });
  await rejects('hints on a self-test attempt', () => attempt('exam-attempt-02', 'exam', 1), { ...KEPT, match: /hub_attempts_hints_mode_check/ });
  await rejects('hints on a Get Ready attempt', () => attempt('ready-attempt-02', 'getready', 2), { ...KEPT, match: /hub_attempts_hints_mode_check/ });

  {
    // A question deleted: its hints and feedback go with it; the view stays, its link cleared and its words kept.
    const [gone] = (await insertQuestion({ text: 'Delete me', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember' })).rows;
    await hint({ questionId: gone?.id });
    await feedback({ questionId: gone?.id, option: 'b', optionKey: 'b' });
    await view({ key: 'hint-attempt-09', questionId: gone?.id });
    await accepts('deleting a question with hints, feedback and a hint view', () => db.query('delete from public.questions where id = $1', [gone?.id]));
    const left = await db.query(`select (select count(*) from public.question_hints where question_id = $1)::int as h,
      (select count(*) from public.option_feedback where question_id = $1)::int as f`, [gone?.id]);
    const v = await db.query(`select question_id, text from public.hub_hint_views where client_attempt_id = 'hint-attempt-09'`);
    check('its hints and feedback go with it; the view stays, its question cleared and its words kept',
      left.rows[0].h === 0 && left.rows[0].f === 0 && v.rows.length === 1 && v.rows[0].question_id === null && v.rows[0].text.startsWith('What'),
      JSON.stringify({ left: left.rows, v: v.rows }));
  }
  {
    // A student account deleted: their hint views go with it, as their hub attempts do.
    const leaving = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [leaving]);
    await insertAccount({ id: leaving, role: 'student', fullName: 'Leaving', email: 'leaving29@example.test', code: 'BL-ST2901', reportsTo: PROF, rollNo: '29' });
    await view({ accountId: leaving, key: 'hint-attempt-10' });
    await accepts('deleting a student\'s sign-in, which deletes their account', () => db.query('delete from auth.users where id = $1', [leaving]));
    const { rows } = await db.query('select count(*)::int as n from public.hub_hint_views where account_id = $1', [leaving]);
    check('their hint views go with their account', rows[0].n === 0);
  }
  kept29.hint = h1?.id;
  kept29.feedback = f1?.id;
  kept29.view = v1?.id;
  // Left in place: the re-run below runs over them.
}

section('question packs and the phone\'s own answer time (0030)');

// Kept by the re-run section below, which checks each survives it.
const kept30 = {};
{
  const KEPT = { code: '23001' };
  const s = (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'answers' and column_name = 'device_answered_at'`)).rows[0] ?? null;
  check('answers.device_answered_at is a timestamp with time zone, empty unless a phone sent one, with no default',
    s?.data_type === 'timestamp with time zone' && s?.is_nullable === 'YES' && s?.column_default === null, JSON.stringify(s));
  const [plain] = (await insertAnswer({ key: 'k-30-plain', questionId: match?.id })).rows;
  check('an answer saved as every save before 0030 sent it has no phone time', plain?.device_answered_at === null,
    JSON.stringify(plain?.device_answered_at));
  // As recordAnswer writes an answer that waited on a phone (sockets/index.js).
  const [timed] = (await accepts('an answer with the time the phone says it was answered, as recordAnswer writes it', () => db.query(
    `insert into public.answers (session_id, answer_key, roll_no, bloom, answered_at, device_answered_at)
     values ($1, 'k-30-timed', '07', 'remember', '2026-11-19T10:40:00Z', '2026-11-19T10:02:00Z') returning *`,
    [session?.id]))) ?? [];
  check('it reads back beside the time the server received it, the two apart',
    new Date(timed?.device_answered_at).toISOString() === '2026-11-19T10:02:00.000Z'
    && new Date(timed?.answered_at).toISOString() === '2026-11-19T10:40:00.000Z', JSON.stringify(timed));
  await rejects('the phone\'s time is written once (0012\'s guard)', () =>
    db.query('update public.answers set device_answered_at = now() where id = $1', [timed?.id]), KEPT);
  await rejects('and cannot be given to an answer afterwards', () =>
    db.query('update public.answers set device_answered_at = now() where id = $1', [plain?.id]), KEPT);
  await accepts('a kept-after-close answer, final false with its detail, as the live loop writes it', () => db.query(
    `insert into public.answers (session_id, answer_key, roll_no, bloom, final, correct, score, detail, auto_correct, auto_score)
     values ($1, 'k-30-late', '07', 'remember', false, null, null, 'Arrived after the room closed: kept, not counted.', true, 1)`,
    [session?.id]));

  // A pack, as addQuestionPack writes it: question ids only.
  const arr = (ids) => `{${ids.join(',')}}`;
  const five = [mcq?.id, match?.id, randomUUID(), randomUUID(), randomUUID()];
  const pack = (ids, cols = {}) => db.query(
    `insert into public.question_packs (session_id, roll_no, question_ids, issued_at, expires_at)
     values ($1, '07', $2::uuid[], $3, $4) returning *`,
    [cols.sessionId ?? session?.id, ids, cols.issuedAt ?? '2026-11-19T09:00:00Z', cols.expiresAt ?? '2026-11-19T15:00:00Z']);
  const [p1] = (await accepts('a pack of five questions for one phone, as addQuestionPack writes it', () => pack(arr(five)))) ?? [];
  check('it reads back with its questions in order, its roll number and its times',
    JSON.stringify(p1?.question_ids) === JSON.stringify(five) && p1?.roll_no === '07'
    && new Date(p1?.expires_at).getTime() - new Date(p1?.issued_at).getTime() === 6 * 3600 * 1000, JSON.stringify(p1));
  await rejects('an empty pack', () => pack('{}'), { code: '23514', match: /question_packs_questions_check/ });
  await rejects('a pack of 21', () => pack(arr(Array.from({ length: 21 }, () => randomUUID()))),
    { code: '23514', match: /question_packs_questions_check/ });
  await rejects('a pack with a missing question in it', () => pack(`{${mcq?.id},NULL}`), { code: '23514', match: /question_packs_questions_check/ });
  await rejects('a pack that is not a plain list', () => pack(`{{${mcq?.id}},{${match?.id}}}`), { code: '23514' });
  await rejects('a pack that expires when it is sent', () => pack(arr(five), { expiresAt: '2026-11-19T09:00:00Z' }),
    { code: '23514', match: /question_packs_expiry_check/ });
  await rejects('a pack for a room that does not exist', () => pack(arr(five), { sessionId: randomUUID() }), { code: '23503' });
  await rejects('a pack is written once: no change', () =>
    db.query(`update public.question_packs set question_ids = $2::uuid[] where id = $1`, [p1?.id, arr(five.slice(0, 2))]), KEPT);
  await rejects('nor a later expiry', () =>
    db.query(`update public.question_packs set expires_at = expires_at + interval '1 day' where id = $1`, [p1?.id]), KEPT);
  await rejects('and no delete but with its room', () => db.query('delete from public.question_packs where id = $1', [p1?.id]), KEPT);
  await accepts('a second pack for the same phone is a new row', () => pack(arr(five.slice(0, 3)), { issuedAt: '2026-11-19T09:30:00Z',
    expiresAt: '2026-11-19T15:30:00Z' }));
  {
    const idx = await db.query(`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'question_packs_room_roll_idx'`);
    check('a phone\'s packs are found by room and roll number, oldest first, through an index',
      /\(session_id, roll_no, issued_at\)/.test(idx.rows[0]?.indexdef ?? ''), idx.rows[0]?.indexdef ?? 'missing');
  }
  {
    // Deleting a room takes its packs with it: the guard lets the cascade through.
    const [gone] = (await db.query(
      `insert into public.sessions (code, content_id, owner_id) values ('QP0001', $1, $2) returning id`, [content?.id, PROF])).rows;
    await pack(arr(five), { sessionId: gone.id });
    await accepts('deleting a room whose phones took packs', () => db.query('delete from public.sessions where id = $1', [gone.id]));
    const left = await db.query('select count(*)::int as n from public.question_packs where session_id = $1', [gone.id]);
    check('its packs go with it', left.rows[0].n === 0, JSON.stringify(left.rows[0]));
  }
  // The log of serves (the review fixes of 19 Nov 2026): every question the
  // server put on a phone's screen, written with the pin by saveProfile.
  {
    const c = (await db.query(`select data_type, is_nullable, column_default from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'served_log'`)).rows[0] ?? null;
    check('profiles.served_log is a JSON value, never empty, an empty list unless a serve was logged',
      c?.data_type === 'jsonb' && c?.is_nullable === 'NO' && /'\[\]'::jsonb/.test(c?.column_default ?? ''), JSON.stringify(c));
    const log = [{ questionId: mcq?.id, at: '2026-11-19T09:00:00.000Z' }, { questionId: match?.id, at: '2026-11-19T09:02:00.000Z' }];
    const [saved] = (await accepts('a profile saved with its log of serves, as saveProfile writes it', () => db.query(
      `insert into public.profiles (session_id, roll_no, served_id, served_at, served_log)
       values ($1, '30', $2, '2026-11-19T09:02:00Z', $3) returning *`,
      [session?.id, match?.id, JSON.stringify(log)]))) ?? [];
    // jsonb keeps a list's order, not the order of an object's keys.
    const pairs = (list) => JSON.stringify((list ?? []).map((e) => [e.questionId, e.at]));
    check('it reads back as it was written, in the order served', pairs(saved?.served_log) === pairs(log),
      JSON.stringify(saved?.served_log));
    const [bare] = (await accepts('a profile saved as every save before this column sent it', () => db.query(
      `insert into public.profiles (session_id, roll_no) values ($1, '31') returning *`, [session?.id]))) ?? [];
    check('has an empty log', JSON.stringify(bare?.served_log) === '[]', JSON.stringify(bare?.served_log));
    await accepts('the log grows as the pin moves on (an update, as every profile save is)', () => db.query(
      `update public.profiles set served_log = served_log || $2::jsonb where id = $1`,
      [saved?.id, JSON.stringify([{ questionId: randomUUID(), at: '2026-11-19T09:05:00.000Z' }])]));
    await rejects('a log that is not a list', () => db.query(
      `update public.profiles set served_log = '{"questionId": "x"}' where id = $1`, [saved?.id]),
    { code: '23514', match: /profiles_served_log_check/ });
    await rejects('a log of more than 1000 serves', () => db.query(
      `update public.profiles set served_log = (select jsonb_agg(jsonb_build_object('questionId', g)) from generate_series(1, 1001) g)
       where id = $1`, [saved?.id]), { code: '23514', match: /profiles_served_log_check/ });
    await rejects('a profile with no log at all', () => db.query(
      `update public.profiles set served_log = null where id = $1`, [saved?.id]), { code: '23502' });
    kept30.profile = saved?.id;
  }
  kept30.pack = p1?.id;
  kept30.answer = timed?.id;
  // Left in place: the re-run below runs over them.
}

section('rooms imported from laptop mode (0031)');

// Kept by the re-run section below, which checks it survives it.
const kept31 = {};
{
  const [room] = (await db.query(
    `insert into public.sessions (code, content_id, owner_id, status, closed_at) values ('LPT031', $1, $2, 'closed', now()) returning *`,
    [content?.id, PROF])).rows;
  const sha = 'a'.repeat(64);
  // The columns importRoom() writes, last, once the room's rows are in.
  const record = (cols = {}) => db.query(
    `insert into public.room_imports (source_room_id, source_code, source, session_id, owner_id, imported_by, imported_at,
       archived_at, bytes, sha256, summary, data)
     values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9, $10, $11) returning *`,
    [cols.sourceRoomId ?? '0123456789abcdef01234567', cols.sourceCode ?? 'LPT031', JSON.stringify(cols.source ?? { run: 'c0ffee12', startedAt: '2026-11-19T04:00:00.000Z' }),
      'sessionId' in cols ? cols.sessionId : room.id, 'ownerId' in cols ? cols.ownerId : PROF, 'importedBy' in cols ? cols.importedBy : PROF,
      '2026-11-19T05:00:00.000Z', cols.bytes ?? 2048, cols.sha256 ?? sha, JSON.stringify(cols.summary ?? { answers: 3 }),
      JSON.stringify(cols.data ?? { format: 'bloomloop.room-archive', version: 1, laptop: { run: 'c0ffee12' } })]);
  const [rec] = (await accepts('an import, as importRoom writes it', () => record())) ?? [];
  check('it reads back with the laptop\'s run and the room it became',
    rec?.source?.run === 'c0ffee12' && rec?.session_id === room.id && rec?.owner_id === PROF && rec?.bytes === 2048
    && rec?.data?.laptop?.run === 'c0ffee12', JSON.stringify(rec));
  await rejects('the same laptop room imported twice', () => record({ sessionId: null }), { code: '23505', match: /room_imports_source_room_id_key/ });
  await rejects('two imports becoming one room', () => record({ sourceRoomId: 'other-room' }), { code: '23505', match: /room_imports_session_id_key/ });
  await rejects('an empty file', () => record({ sourceRoomId: 'r-empty', sessionId: null, bytes: 0 }), { code: '23514', match: /room_imports_bytes_check/ });
  await rejects('a file over the 1 MiB an archive may be', () =>
    record({ sourceRoomId: 'r-big', sessionId: null, bytes: 1048577 }), { code: '23514', match: /room_imports_bytes_check/ });
  await rejects('a hash that is not one', () => record({ sourceRoomId: 'r-hash', sessionId: null, sha256: 'xyz' }), { code: '23514', match: /room_imports_sha256_check/ });
  await rejects('a laptop room id that could be a path', () => record({ sourceRoomId: '../etc', sessionId: null }), { code: '23514', match: /room_imports_source_check/ });
  await rejects('a room code that is not one', () => record({ sourceRoomId: 'r-code', sourceCode: 'lpt 31', sessionId: null }), { code: '23514' });
  await rejects('an archive that is not an object', () => record({ sourceRoomId: 'r-list', sessionId: null, data: [1, 2] }), { code: '23514' });
  await rejects('a room that does not exist', () => record({ sourceRoomId: 'r-none', sessionId: randomUUID() }), { code: '23503' });
  // Written once: no column changes by hand.
  const KEPT = { code: '23001', match: /never edited/ };
  await rejects('the archive kept with an import is never edited', () =>
    db.query(`update public.room_imports set data = '{"edited": true}' where id = $1`, [rec?.id]), KEPT);
  await rejects('nor when or by whom it was imported', () =>
    db.query('update public.room_imports set imported_at = now() - interval \'1 day\', imported_by = null where id = $1', [rec?.id]), KEPT);
  await rejects('nor the room it became, by hand', () => db.query('update public.room_imports set session_id = null where id = $1', [rec?.id]), KEPT);
  {
    // A deleted room and a deleted account set theirs to null, through their foreign keys; the record stays.
    const LEAVER = randomUUID();
    await db.query('insert into auth.users (id) values ($1)', [LEAVER]);
    await insertAccount({ id: LEAVER, role: 'professor', code: 'BL-PR0031', reportsTo: HOD });
    const [gone] = (await db.query(
      `insert into public.sessions (code, content_id, owner_id) values ('LPT032', $1, $2) returning id`, [content?.id, LEAVER])).rows;
    const [theirs] = (await record({ sourceRoomId: 'r-leaver', sourceCode: 'LPT032', sessionId: gone.id, ownerId: LEAVER, importedBy: LEAVER })).rows;
    await accepts('deleting an imported room', () => db.query('delete from public.sessions where id = $1', [gone.id]));
    await accepts('deleting the account that imported it', () => db.query('delete from auth.users where id = $1', [LEAVER]));
    const { rows } = await db.query('select session_id, owner_id, imported_by, data, sha256 from public.room_imports where id = $1', [theirs?.id]);
    check('the import record stays, naming no room and no account, its file as it was',
      rows.length === 1 && rows[0].session_id === null && rows[0].owner_id === null && rows[0].imported_by === null
      && rows[0].data?.laptop?.run === 'c0ffee12' && rows[0].sha256 === sha, JSON.stringify(rows));
    await accepts('the record can be deleted (erasure)', () => db.query('delete from public.room_imports where id = $1', [theirs?.id]));
  }
  kept31.import = rec?.id;
  // Left in place: the re-run below runs over it.
}

section('replay keys of teacher-record writes (0032)');

// Kept by the re-run section below, which checks it survives it.
const kept32 = {};
{
  const KEPT = { code: '23001' };
  const [room] = (await db.query(
    `insert into public.sessions (code, content_id, owner_id) values ('RW0001', $1, $2) returning *`, [content?.id, PROF])).rows;
  const HASH = 'a'.repeat(64);
  // The insert addRecordWrite() sends.
  const keep = (w = {}) => db.query(
    `insert into public.record_writes (session_id, writer, write_key, route, target, body_hash, status, reply)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [given(w, 'sessionId', room.id), given(w, 'writer', PROF), given(w, 'key', '7f9c2a10-4b1e-4c3a-9d2e-0a1b2c3d4e5f'),
      given(w, 'route', 'tally-increment'), given(w, 'target', 'some-tally-id'), given(w, 'hash', HASH), given(w, 'status', 200),
      JSON.stringify(given(w, 'reply', { tally: { counts: [1, 0, 0, 0] }, clamped: false }))]);
  const [row] = (await accepts('a write\'s key with its reply, as addRecordWrite writes it', () => keep())) ?? [];
  check('it reads back with its reply whole, and the time it was first met', row?.reply?.tally?.counts?.[0] === 1
    && row?.reply?.clamped === false && row?.created_at instanceof Date && row?.target === 'some-tally-id', JSON.stringify(row));
  await rejects('the same key from the same writer in the same room again', () => keep({ hash: 'b'.repeat(64) }),
    { code: '23505', match: /record_writes_session_writer_key_key/ });
  await accepts('the same key from another writer (the shared teacher key)', () => keep({ writer: 'shared-key' }));
  await accepts('a write that names no record: target empty', () => keep({ key: 'activity-key-0001', route: 'activity', target: '' }));
  await rejects('a key that is not one', () => keep({ key: 'short' }), { code: '23514', match: /record_writes_key_check/ });
  await rejects('a route outside the shape', () => keep({ key: 'route-key-00001', route: 'Tally Increment' }),
    { code: '23514', match: /record_writes_route_check/ });
  await rejects('a hash that is not one', () => keep({ key: 'hash-key-000001', hash: 'xyz' }), { code: '23514', match: /record_writes_hash_check/ });
  await rejects('a refusal kept: only a success is', () => keep({ key: 'status-key-0001', status: 409 }),
    { code: '23514', match: /record_writes_status_check/ });
  await rejects('a reply that is not an object', () => keep({ key: 'reply-key-00001', reply: [1, 2] }),
    { code: '23514', match: /record_writes_reply_check/ });
  await rejects('no writer', () => keep({ key: 'writer-key-0001', writer: '' }), { code: '23514', match: /record_writes_writer_check/ });
  await rejects('a room that does not exist', () => keep({ key: 'room-key-000001', sessionId: randomUUID() }), { code: '23503' });
  await rejects('a kept key is never edited', () =>
    db.query(`update public.record_writes set reply = '{}' where id = $1`, [row?.id]), KEPT);
  await rejects('nor deleted on its own', () => db.query('delete from public.record_writes where id = $1', [row?.id]), KEPT);
  {
    // Deleting the room takes its keys with it.
    const [gone] = (await db.query(
      `insert into public.sessions (code, content_id, owner_id) values ('RW0002', $1, $2) returning id`, [content?.id, PROF])).rows;
    await keep({ sessionId: gone.id, key: 'gone-key-000001' });
    await accepts('deleting a room whose writes were sent with keys', () => db.query('delete from public.sessions where id = $1', [gone.id]));
    const left = await db.query('select count(*)::int as n from public.record_writes where session_id = $1', [gone.id]);
    check('its keys go with it', left.rows[0].n === 0);
  }
  kept32.room = room.id;
  // Left in place: the re-run below runs over them.
}

section('figures: slide pictures, and a figure in a lesson (0033)');

// Kept by the re-run section below, which checks they survive it.
const kept33 = {};
{
  const KEPT = { code: '23514' };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const sha = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
  // The insert createSlideMedia() sends.
  const slideMedia = (m = {}) => db.query(
    `insert into public.media (owner_id, content_id, mime, bytes, sha256, data, alt, slide_no)
     values ($1, $2, 'image/png', $3, $4, $5::text::bytea, $6, $7) returning id, slide_no, alt`,
    [PROF, content?.id, png.length, sha, `\\x${png.toString('hex')}`, given(m, 'alt', 'Picture from slide 3 (not yet described)'), given(m, 'slideNo', 3)]);
  const [pic] = (await accepts('a picture kept from slide 3, as createSlideMedia writes it', () => slideMedia())) ?? [];
  check('it reads back with its slide', pic?.slide_no === 3, JSON.stringify(pic));
  await accepts('an upload of its own, with no slide', () => slideMedia({ slideNo: null, alt: 'An own upload' }));
  await rejects('a slide numbered below 1', () => slideMedia({ slideNo: 0 }), { ...KEPT, match: /media_slide_no_check/ });
  const listed = await db.query(`select slide_no from public.media where content_id = $1 and slide_no is not null order by slide_no`, [content?.id]);
  check('a chapter\'s slide pictures are listed by slide, as listSlideMedia reads them', listed.rows.length >= 1 && listed.rows.every((r) => r.slide_no >= 1));

  // What the upload kept, as setContentSlidePictures writes it.
  await accepts('what a deck upload kept of its pictures', () => db.query(
    `update public.contents set slide_pictures = $2 where id = $1`,
    [content?.id, JSON.stringify({ kept: 1, skippedType: 2, skippedLarge: 0, skippedOver: 0, slides: [3] })]));
  await rejects('a summary that is not an object', () => db.query(
    `update public.contents set slide_pictures = '[1, 2]' where id = $1`, [content?.id]), { ...KEPT, match: /contents_slide_pictures_check/ });

  // A lesson version with a figure, as the lesson figure route writes it: a chunk carrying it (0027 already allows that).
  const STEPS = [
    { type: 'chunk', slides: [1], text: 'A function that calls itself' },
    { type: 'chunk', slides: [], text: 'The call stack', figure: { type: 'stack', frames: [{ id: 'main', label: 'main' }] } },
  ];
  // A topic of its own, so the lessons 0027's checks count are left as they are.
  const [topic33] = (await db.query(
    `insert into public.chapter_topics (content_id, name, key, position) values ($1, 'Recursion', 'recursion-0033', 33) returning id`, [content?.id])).rows;
  const [lesson] = (await accepts('a lesson with a figure on a chunk step, as the lesson figure route writes it', () => db.query(
    `insert into public.topic_lessons (topic_id, content_id, owner_id, version, status, source, model, steps, basis, warnings, created_by)
     values ($1, $2, $3, 1, 'draft', 'slides', null, $4, '{}', '[]', $3) returning *`,
    [topic33?.id, content?.id, PROF, JSON.stringify(STEPS)]))) ?? [];
  check('it reads back with its figure, a chunk step 0027 already allows', lesson?.steps?.[1]?.type === 'chunk' && lesson.steps[1].figure?.type === 'stack');
  await rejects('a step of any other type is still refused', () => db.query(
    `insert into public.topic_lessons (topic_id, content_id, owner_id, version, status, source, model, steps, basis, warnings, created_by)
     values ($1, $2, $3, 2, 'draft', 'slides', null, '[{"type": "video"}]', '{}', '[]', $3)`,
    [topic33?.id, content?.id, PROF]), { ...KEPT, match: /topic_lessons_steps_check/ });
  kept33.media = pic?.id;
  kept33.lesson = lesson?.id;
  kept33.content = content?.id;
  // Left in place: the re-run below runs over them.
}

section('the live room\'s suggestions, the wheel\'s question draws and verbal asks (0034)');

// Kept by the re-run section below, which checks they survive it.
const kept34 = {};
{
  const KEPT = { code: '23001' };
  const openRoom = (code) => db.query(
    `insert into public.sessions (code, content_id, owner_id) values ($1, $2, $3) returning *`, [code, content?.id, PROF]);
  const [room] = (await openRoom('ZG0001')).rows;
  const [other] = (await openRoom('ZG0002')).rows;
  const [question] = (await db.query(
    `insert into public.questions (content_id, text, options, answer_idx, bloom)
     values ($1, 'Which traversal visits the root last?', '["Inorder","Preorder","Postorder","Level-order"]', 2, 'understand')
     returning *`, [content?.id])).rows;
  await db.query('insert into public.wheel_rounds (session_id, round) values ($1, 1), ($2, 1)', [room.id, other.id]);

  // -- the wheel: the insert addWheelPick() sends, now with a verbal ask.
  const pick = (p = {}) => db.query(
    `insert into public.wheel_picks (session_id, round, pick_order, roll_no, pool_size, present_only, no_repeat, ask, question_id, picked_by)
     values ($1, 1, $2, $3, 4, true, true, $4, $5, $6) returning *`,
    [given(p, 'sessionId', room.id), given(p, 'order', 1), given(p, 'rollNo', '01'), given(p, 'ask', 'bank'),
      given(p, 'questionId', null), PROF]);
  const [verbal] = (await accepts('a pick asked a verbal question, as addWheelPick writes it', () => pick({ ask: 'verbal' }))) ?? [];
  await rejects('a verbal ask naming a bank question', () => pick({ order: 2, ask: 'verbal', questionId: question.id }),
    { code: '23514', match: /wheel_picks_ask_check/ });
  await rejects('an ask outside the four', () => pick({ order: 2, ask: 'sing' }), { code: '23514', match: /wheel_picks_ask_check/ });
  const [banked] = (await accepts('a bank pick with the question the server drew', () =>
    pick({ order: 2, rollNo: '02', questionId: question.id }))) ?? [];
  const [elsewhere] = (await pick({ sessionId: other.id, order: 1 })).rows;

  // -- question draws: the insert addWheelQuestionDraw() sends. Append-only.
  const draw = (d = {}) => db.query(
    `insert into public.wheel_question_draws (session_id, pick_id, draw_order, question_id, pool_size, drawn_by)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [given(d, 'sessionId', room.id), given(d, 'pickId', banked?.id), given(d, 'order', 1), given(d, 'questionId', question.id),
      given(d, 'pool', 5), PROF]);
  const [first] = (await accepts('the question drawn with the pick', () => draw())) ?? [];
  check('it reads back with its pool and time', first?.pool_size === 5 && first?.drawn_at instanceof Date && first?.drawn_by === PROF);
  await accepts('"Another": the next draw for the same pick', () => draw({ order: 2, pool: 4 }));
  await rejects('a second draw in the same place', () => draw({ order: 2 }), { code: '23505', match: /wheel_question_draws_pick_order_key/ });
  await rejects('a draw in place 0', () => draw({ order: 0 }), { code: '23514', match: /wheel_question_draws_order_check/ });
  await rejects('a draw from no questions at all', () => draw({ order: 3, pool: 0 }), { code: '23514', match: /wheel_question_draws_order_check/ });
  await rejects('a draw filed under another room than its pick\'s', () => draw({ order: 3, sessionId: other.id }), { code: '23503' });
  await rejects('a draw for a pick that does not exist', () => draw({ order: 3, pickId: randomUUID() }), { code: '23503' });
  await accepts('another room\'s pick draws in its own room', () => draw({ sessionId: other.id, pickId: elsewhere.id }));
  await rejects('a draw is never edited', () =>
    db.query('update public.wheel_question_draws set question_id = null where id = $1', [first?.id]), KEPT);
  await rejects('nor deleted on its own', () => db.query('delete from public.wheel_question_draws where id = $1', [first?.id]), KEPT);
  await accepts('"Another" moves the pick on to its next question (the pick\'s own guard allows it)', () =>
    db.query('update public.wheel_picks set question_id = $1 where id = $2', [question.id, banked?.id]));

  // -- teaching moves: the insert addTeachingMove() sends. Append-only.
  const BASIS = { present: 30, graded: 24, notAnswered: 4, support: { count: 6, banded: 22 },
    levels: [{ level: 'apply', working: 14, answers: 40, correct: 15 }] };
  const move = (m = {}) => db.query(
    `insert into public.teaching_moves (session_id, purpose, activity_kind, title, body, focus_level, topic, basis, source_ref, model, asked_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
    [given(m, 'sessionId', room.id), given(m, 'purpose', 'move'), given(m, 'kind', 'group'), given(m, 'title', 'Benches trace it'),
      given(m, 'body', 'Benches of four write the postorder sequence of the tree on slide 6 on paper.'), given(m, 'level', 'apply'),
      given(m, 'topic', 'Tree traversals'), JSON.stringify(given(m, 'basis', BASIS)),
      // null as SQL null, as the client library sends a missing reference.
      ((ref) => (ref === null ? null : JSON.stringify(ref)))(given(m, 'sourceRef', { kind: 'slides', slides: [6] })),
      given(m, 'model', 'gemini-test'), PROF]);
  const [suggested] = (await accepts('a suggested move with the figures it rests on', () => move())) ?? [];
  check('it reads back with its basis and the slide it cites', suggested?.basis?.support?.count === 6
    && JSON.stringify(suggested?.source_ref?.slides) === '[6]' && suggested?.asked_at instanceof Date, JSON.stringify(suggested));
  await accepts('a prompt for one activity kind, asked before any answer: no level', () =>
    move({ purpose: 'prompt', kind: 'real', level: null, sourceRef: null }));
  await rejects('a move aimed at no level', () => move({ level: null }), { code: '23514', match: /teaching_moves_move_level_check/ });
  await rejects('a purpose outside the two', () => move({ purpose: 'tip' }), { code: '23514', match: /teaching_moves_purpose_check/ });
  await rejects('an activity kind outside the five', () => move({ kind: 'quiz' }), { code: '23514', match: /teaching_moves_kind_check/ });
  await rejects('a level outside the six', () => move({ level: 'analyze' }), { code: '23514', match: /teaching_moves_level_check/ });
  await rejects('an empty suggestion', () => move({ body: '' }), { code: '23514', match: /teaching_moves_text_check/ });
  await rejects('a suggestion over 600 characters', () => move({ body: 'b'.repeat(601) }), { code: '23514', match: /teaching_moves_text_check/ });
  await rejects('a title over 80 characters', () => move({ title: 't'.repeat(81) }), { code: '23514', match: /teaching_moves_text_check/ });
  await rejects('a basis that is not an object', () => move({ basis: [1, 2] }), { code: '23514', match: /teaching_moves_basis_check/ });
  await rejects('no model named', () => move({ model: '' }), { code: '23514', match: /teaching_moves_model_check/ });
  await rejects('a room that does not exist', () => move({ sessionId: randomUUID() }), { code: '23503' });
  await rejects('a suggestion is never edited', () =>
    db.query(`update public.teaching_moves set body = 'changed' where id = $1`, [suggested?.id]), KEPT);
  await rejects('nor deleted on its own', () => db.query('delete from public.teaching_moves where id = $1', [suggested?.id]), KEPT);

  // -- "Use it": the insert addActivity() sends with a suggestion.
  const act = (a = {}) => db.query(
    `insert into public.room_activities (session_id, seq, kind, outcome, suggestion_id) values ($1, $2, $3, $4, $5) returning *`,
    [given(a, 'sessionId', room.id), given(a, 'seq', 1), given(a, 'kind', 'group'), given(a, 'outcome', ''),
      given(a, 'suggestionId', suggested?.id)]);
  const [used] = (await accepts('"Use it": an activity that points at its suggestion', () => act())) ?? [];
  await rejects('an activity pointing at another room\'s suggestion', () => act({ sessionId: other.id }),
    { code: '23503', match: /room_activities_suggestion_fkey/ });
  await rejects('an activity pointing at a suggestion that does not exist', () => act({ seq: 2, suggestionId: randomUUID() }),
    { code: '23503', match: /room_activities_suggestion_fkey/ });
  await accepts('an activity with no suggestion, as before', () => act({ seq: 2, suggestionId: null }));
  await rejects('the suggestion an activity came from is never changed', () =>
    db.query('update public.room_activities set suggestion_id = null where id = $1', [used?.id]), KEPT);
  await accepts('its outcome is still filled in afterwards', () =>
    db.query(`update public.room_activities set outcome = 'Most benches got it', updated_at = now() where id = $1`, [used?.id]));

  {
    // Deleting the room takes its suggestions, draws and activities with it.
    const [gone] = (await openRoom('ZG0003')).rows;
    await db.query('insert into public.wheel_rounds (session_id, round) values ($1, 1)', [gone.id]);
    const [p] = (await pick({ sessionId: gone.id, questionId: question.id })).rows;
    await draw({ sessionId: gone.id, pickId: p.id });
    const [m] = (await move({ sessionId: gone.id })).rows;
    await act({ sessionId: gone.id, suggestionId: m.id });
    await accepts('deleting a room with suggestions, draws and an activity that used one', () =>
      db.query('delete from public.sessions where id = $1', [gone.id]));
    const left = await db.query(`
      select (select count(*)::int from public.teaching_moves where session_id = $1)
           + (select count(*)::int from public.wheel_question_draws where session_id = $1)
           + (select count(*)::int from public.room_activities where session_id = $1) as n`, [gone.id]);
    check('they go with it', left.rows[0].n === 0);
  }
  Object.assign(kept34, { room: room.id, verbal: verbal?.id, banked: banked?.id, move: suggested?.id, activity: used?.id });
  // Left in place: the re-run below runs over them.
}

// ---- Batch 8: material, the bank and the hub's concept panel (0035) ----
section('rooms-only questions, a lesson\'s concept sections and a Get Ready check ended early (0035)');

// Kept by the re-run section below, which checks they survive it.
const kept35 = {};
{
  const KEPT = { code: '23514' };
  // A question saved the ordinary way: shared with the hub.
  const [q] = (await accepts('a question saved as insertQuestions writes it, naming no rooms_only', () => db.query(
    `insert into public.questions (content_id, topic, text, options, answer_idx, bloom, status, source, payload)
     values ($1, 'Sets', 'Kept for rooms?', '["a","b","c","d"]', 0, 'remember', 'active', 'teacher', '{}') returning *`, [content?.id]))) ?? [];
  check('it is shared with the hub by default (rooms_only false)', q?.rooms_only === false, JSON.stringify(q?.rooms_only));
  const [kept] = (await accepts('the owner keeps it for rooms (setQuestionRoomsOnly)', () => db.query(
    'update public.questions set rooms_only = true where id = $1 returning rooms_only', [q?.id]))) ?? [];
  check('and it reads back kept for rooms', kept?.rooms_only === true);
  await rejects('rooms_only cannot be null', () => db.query('update public.questions set rooms_only = null where id = $1', [q?.id]), { code: '23502' });

  // Lessons with sections, as createTopicLesson writes them now.
  const SECTIONS = {
    intro: { text: 'Sets collect distinct objects.', parts: ['C1'], slides: [1] },
    facts: [{ kind: 'why', label: 'Why it matters', text: 'Everything else builds on them.', parts: ['C1'], slides: [1] }],
    steps: [], example: null, mistakes: [],
  };
  // A topic of its own, so the lessons of 0027's section are left as they are.
  const [topic35] = (await db.query(
    `insert into public.chapter_topics (content_id, name, key, position) values ($1, 'Bank35', 'bank35', 35) returning id`, [content?.id])).rows;
  const lesson = (cols = {}) => db.query(
    `insert into public.topic_lessons (topic_id, content_id, owner_id, version, status, source, model, steps, sections, created_by)
     values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $3) returning *`,
    [topic35?.id, content?.id, PROF, cols.version ?? 35, cols.source ?? 'llm', 'model' in cols ? cols.model : 'gemini-2.5-flash',
      JSON.stringify([{ type: 'chunk', slides: [1], text: 'Sets are collections' }]),
      'sections' in cols ? (cols.sections === null ? null : JSON.stringify(cols.sections)) : JSON.stringify(SECTIONS)]);
  const [l35] = (await accepts('an AI lesson with its concept sections', () => lesson())) ?? [];
  check('its sections read back whole', l35?.sections?.facts?.[0]?.kind === 'why' && l35?.sections?.intro?.slides?.[0] === 1,
    JSON.stringify(l35?.sections));
  await accepts('a lesson with no sections (null), as every lesson before 0035', () => lesson({ version: 36, sections: null }));
  await rejects('sections on a slides-only lesson: only a lesson the model wrote has them', () =>
    lesson({ version: 37, source: 'slides', model: null }), { ...KEPT, match: /topic_lessons_sections_check/ });
  await rejects('sections that are not an object', () => lesson({ version: 38, sections: [1, 2] }), { ...KEPT, match: /topic_lessons_sections_check/ });
  await rejects('a lesson\'s sections are written once, like the rest of it', () => db.query(
    `update public.topic_lessons set sections = '{}' where id = $1`, [l35?.id]), { code: '23001' });

  // A Get Ready check ended early.
  const run = (cols = {}) => db.query(
    `insert into public.hub_runs (account_id, client_run_id, kind, spec, started_at) values ($1, $2, $3, $4, '2026-11-19T05:00:00Z') returning *`,
    [STUDENT, cols.key, cols.kind ?? 'getready', JSON.stringify(cols.spec ?? { targetTopicId: kept25.sets, prerequisites: [] })]);
  const [early] = (await accepts('an open Get Ready check', () => run({ key: 'run-0035-early' }))) ?? [];
  await accepts('the student ends it early: end_reason \'ended\'', () => db.query(
    `update public.hub_runs set ended_at = '2026-11-19T05:05:00Z', end_reason = 'ended' where id = $1`, [early?.id]));
  await rejects('and it ends only once', () => db.query(
    `update public.hub_runs set end_reason = 'complete' where id = $1`, [early?.id]), { code: '23001', match: /hub_runs/ });
  const [exam] = (await accepts('an open self-test', () => run({ key: 'run-0035-exam', kind: 'exam', spec: { questions: [] } }))) ?? [];
  await rejects('a self-test cannot end \'ended\': it is handed in or timed out', () => db.query(
    `update public.hub_runs set ended_at = '2026-11-19T05:05:00Z', end_reason = 'ended' where id = $1`, [exam?.id]),
  { ...KEPT, match: /hub_runs_end_check/ });
  await accepts('a Get Ready check still ends complete', () => db.query(
    `insert into public.hub_runs (account_id, client_run_id, kind, spec, started_at, ended_at, end_reason)
     values ($1, 'run-0035-done', 'getready', '{}', '2026-11-19T05:00:00Z', '2026-11-19T05:00:00Z', 'complete')`, [STUDENT]));
  kept35.question = q?.id;
  kept35.lesson = l35?.id;
  kept35.run = early?.id;
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
  // 0022: the values survive, and no earlier file's re-run (0000 creates
  // questions with the narrower inline check, if the table is missing) narrows
  // what 0022 allows.
  const a22 = await db.query('select account_verified from public.answers where id = $1', [kept22.answer]);
  const m22 = await db.query('select under_18 from public.class_students where id = $1', [kept22.minor]);
  check('a verified answer and an under-18 mark survive the re-run (0022)',
    a22.rows[0]?.account_verified === true && m22.rows[0]?.under_18 === true);
  await accepts('and a professor\'s question (source teacher) is still accepted after it', () =>
    insertQuestion({ text: 'Own, after the re-run', kind: 'mcq', options: ['a', 'b', 'c', 'd'], answerIdx: 0, bloom: 'remember', source: 'teacher' }));
  // 0023: the class questions and their votes survive, and a round 2 vote is still accepted after it.
  const c23 = await db.query('select state, revealed, seq from public.class_questions where session_id = $1 order by seq', [kept23.room]);
  const v23 = await db.query('select round, final, confidence from public.answers where session_id = $1 and class_question_id is not null order by answer_key', [kept23.room]);
  check('class questions and their votes survive the re-run (0023)',
    JSON.stringify(c23.rows.map((r) => [r.seq, r.state, r.revealed])) === JSON.stringify([[1, 'closed', true], [2, 'open', false], [3, 'closed', false]])
    && JSON.stringify(v23.rows.map((r) => [r.round, r.final, r.confidence])) === JSON.stringify([[1, false, 'sure'], [2, true, 'guess']]),
    JSON.stringify({ c: c23.rows, v: v23.rows }));
  await accepts('and a re-vote is still accepted after it', () => db.query(
    `insert into public.answers (session_id, answer_key, roll_no, bloom, class_question_id, round) values ($1, 'cq-after', '08', 'remember', $2, 2)`,
    [kept23.room, kept23.next]));
  // 0024: the labels survive, and a label is still accepted after it.
  const l24 = await db.query('select misconceptions from public.questions where id = $1', [kept24.question]);
  check('a question\'s misconception labels survive the re-run (0024)',
    JSON.stringify(l24.rows[0]?.misconceptions?.map((l) => [l.option, l.provenance])) === JSON.stringify([['a', 'ai'], ['b', 'professor']]),
    JSON.stringify(l24.rows));
  await accepts('and a label is still accepted after it', () => db.query(
    `update public.questions set misconceptions = '[{"option": "c", "label": "after", "provenance": "professor"}]' where id = $1`,
    [kept24.question]));
  // 0025: the hub's rows survive, and its loop guard still refuses after it.
  const l25 = await db.query('select state, provenance from public.topic_links where id = $1', [kept25.link]);
  const p25 = await db.query('select unit_id from public.class_chapters where id = $1', [kept25.placed]);
  const s25 = await db.query(`select slide_texts from public.contents where slide_texts is not null`);
  check('the hub\'s links, placements and slide texts survive the re-run (0025)',
    l25.rows[0]?.state === 'confirmed' && l25.rows[0]?.provenance === 'professor' && p25.rows.length === 1 && p25.rows[0].unit_id === null
    && s25.rows.length === 1, JSON.stringify({ l: l25.rows, p: p25.rows }));
  await rejects('and a confirmed loop is still refused after it', () => db.query(
    `insert into public.topic_links (owner_id, prerequisite_id, topic_id, provenance, state, decided_at)
     select owner_id, $1, $2, 'professor', 'confirmed', now() from public.topic_links where id = $3`,
    [kept25.functions, kept25.sets, kept25.link]), { code: '23514', match: /loop/ });
  // 0026: the attempts and explanations survive, and the guard still refuses after it.
  const a26 = await db.query('select response, correct, mode from public.hub_attempts where id = $1', [kept26.attempt]);
  const e26 = await db.query('select provenance, status, text from public.question_explanations where id = $1', [kept26.explanation]);
  check('hub attempts and explanations survive the re-run (0026)',
    a26.rows[0]?.response === 1 && a26.rows[0]?.correct === true && a26.rows[0]?.mode === 'practice'
    && e26.rows[0]?.provenance === 'professor' && e26.rows[0]?.status === 'approved' && e26.rows[0]?.text === 'In my words.',
    JSON.stringify({ a: a26.rows, e: e26.rows }));
  await rejects('and a hub attempt is still written once after it', () => db.query(
    `update public.hub_attempts set correct = false where id = $1`, [kept26.attempt]), { code: '23001', match: /hub_attempts/ });
  // 0027: the lessons, translations and a student's language survive, and the guards still hold after it.
  const l27 = await db.query('select version, status from public.topic_lessons where topic_id = $1 order by version', [kept27.topic]);
  const t27 = await db.query('select status, fields from public.item_translations where id = $1', [kept27.translation]);
  const c27 = await db.query('select language from public.student_language_choices where account_id = $1', [STUDENT]);
  check('the lessons, translations and a student\'s language survive the re-run (0027)',
    JSON.stringify(l27.rows.map((r) => [r.version, r.status])) === JSON.stringify([[1, 'superseded'], [2, 'approved'], [3, 'discarded']])
    && t27.rows[0]?.status === 'approved' && t27.rows[0]?.fields?.text === 'एक चुनें' && c27.rows[0]?.language === 'mr',
    JSON.stringify({ l: l27.rows, t: t27.rows, c: c27.rows }));
  await rejects('and an approved lesson\'s steps are still refused a change after it', () => db.query(
    `update public.topic_lessons set steps = '[{"type": "chunk", "text": "changed"}]' where id = $1`, [kept27.lesson]), { code: '23001' });
  // 0028: the runs, the answers filed under them and goals survive, and the guards still hold after it.
  const r28 = await db.query('select kind, end_reason from public.hub_runs where id = any($1) order by kind', [[kept28.check, kept28.exam]]);
  const a28 = await db.query('select run_id from public.hub_attempts where id = $1', [kept28.attempt]);
  const g28 = await db.query('select title from public.hub_goals where id = $1', [kept28.goal]);
  check('Get Ready checks, self-tests, the answers filed under them and goals survive the re-run (0028)',
    JSON.stringify(r28.rows) === JSON.stringify([{ kind: 'exam', end_reason: 'submitted' }, { kind: 'getready', end_reason: 'complete' }])
    && a28.rows[0]?.run_id === kept28.check && g28.rows[0]?.title === 'Kept',
    JSON.stringify({ r: r28.rows, a: a28.rows, g: g28.rows }));
  await rejects('and a run is still ended only once after it', () => db.query(
    `update public.hub_runs set end_reason = 'timed-out' where id = $1`, [kept28.exam]), { code: '23001', match: /hub_runs/ });
  await rejects('and an answer is still filed only in its run\'s mode after it', () => db.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode, run_id) values ($1, 'after-rerun-01', 'apply', true, 1, 'practice', $2)`,
    [STUDENT, kept28.check]), { code: '23514', match: /must have that mode/ });
  // 0029: the hints, feedback and hints opened survive, and the guards still hold after it.
  const h29 = await db.query('select status, step from public.question_hints where id = $1', [kept29.hint]);
  const f29 = await db.query('select status, option_key from public.option_feedback where id = $1', [kept29.feedback]);
  const v29 = await db.query('select kind, plan from public.hub_hint_views where id = $1', [kept29.view]);
  check('hints, feedback and the hints opened survive the re-run (0029)',
    h29.rows[0]?.status === 'approved' && Number(h29.rows[0]?.step) === 1 && f29.rows[0]?.option_key === 'c' && v29.rows[0]?.kind === 'nudge'
    && v29.rows[0]?.plan?.items?.length === 2, JSON.stringify({ h: h29.rows, f: f29.rows, v: v29.rows }));
  await rejects('and a hint view is still written once after it', () => db.query(
    `update public.hub_hint_views set text = 'x' where id = $1`, [kept29.view]), { code: '23001', match: /hub_hint_views/ });
  await rejects('and hints on a self-test attempt are still refused after it', () => db.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode, hints_used)
     values ($1, 'exam-after-rerun', 'remember', true, 1, 'exam', 1)`, [STUDENT]), { code: '23514', match: /hub_attempts_hints_mode_check/ });
  // 0030: a pack and a phone's time survive, a pack is still written once, and a
  // new one is still accepted after it.
  const p30 = await db.query('select cardinality(question_ids) as n, roll_no from public.question_packs where id = $1', [kept30.pack]);
  const a30 = await db.query('select device_answered_at from public.answers where id = $1', [kept30.answer]);
  check('a question pack and a phone\'s own answer time survive the re-run (0030)',
    p30.rows[0]?.n === 5 && p30.rows[0]?.roll_no === '07'
    && new Date(a30.rows[0]?.device_answered_at).toISOString() === '2026-11-19T10:02:00.000Z', JSON.stringify({ p: p30.rows, a: a30.rows }));
  await rejects('and a pack is still written once after it', () =>
    db.query(`update public.question_packs set roll_no = '08' where id = $1`, [kept30.pack]), { code: '23001' });
  await accepts('and a new pack is still accepted after it', () => db.query(
    `insert into public.question_packs (session_id, roll_no, question_ids, expires_at)
     select session_id, '08', question_ids, now() + interval '6 hours' from public.question_packs where id = $1`, [kept30.pack]));
  const l30 = await db.query('select served_log from public.profiles where id = $1', [kept30.profile]);
  check('a profile\'s log of serves survives the re-run (0030)', l30.rows[0]?.served_log?.length === 3, JSON.stringify(l30.rows));
  await rejects('and its check still holds after it', () => db.query(
    `update public.profiles set served_log = '"not a list"' where id = $1`, [kept30.profile]), { code: '23514' });
  // 0031: the import record survives, and an import is still accepted after it.
  const r31 = await db.query('select source_code, source, bytes, data from public.room_imports where id = $1', [kept31.import]);
  check('an import record and its file survive the re-run (0031)',
    r31.rows[0]?.source_code === 'LPT031' && r31.rows[0]?.source?.run === 'c0ffee12' && r31.rows[0]?.data?.laptop?.run === 'c0ffee12',
    JSON.stringify(r31.rows));
  await accepts('and another import is still accepted after it', () => db.query(
    `insert into public.room_imports (source_room_id, source_code, bytes, sha256, data) values ('after-rerun', 'AFT031', 10, $1, '{}')`,
    ['b'.repeat(64)]));
  // 0032: the kept keys survive, and a key is still accepted after it.
  const k32 = await db.query('select writer, write_key, status, reply from public.record_writes where session_id = $1 order by writer, write_key',
    [kept32.room]);
  check('a room\'s replay keys and their replies survive the re-run (0032)', k32.rows.length === 3
    && k32.rows.every((r) => r.status === 200) && k32.rows.some((r) => r.reply?.tally?.counts?.[0] === 1), JSON.stringify(k32.rows));
  await accepts('and a key is still accepted after it', () => db.query(
    `insert into public.record_writes (session_id, writer, write_key, route, body_hash, status, reply)
     values ($1, 'shared-key', 'after-rerun-0001', 'observation', $2, 200, '{"changed": true}')`, [kept32.room, 'c'.repeat(64)]));
  // 0033: a slide picture, the chapter's summary and a lesson's figure step survive, and the checks still hold.
  const m33 = await db.query('select slide_no from public.media where id = $1', [kept33.media]);
  const c33 = await db.query('select slide_pictures from public.contents where id = $1', [kept33.content]);
  const l33 = await db.query('select steps from public.topic_lessons where id = $1', [kept33.lesson]);
  check('a slide picture, its chapter\'s summary and a lesson\'s figure step survive the re-run (0033)',
    m33.rows[0]?.slide_no === 3 && c33.rows[0]?.slide_pictures?.kept === 1 && l33.rows[0]?.steps?.[1]?.figure?.type === 'stack',
    JSON.stringify({ m: m33.rows, c: c33.rows, l: l33.rows }));
  await rejects('and a slide below 1 is still refused after it', () => db.query(
    'update public.media set slide_no = 0 where id = $1', [kept33.media]), { code: '23514' });
  // 0034: the suggestions, draws, a verbal pick and a used suggestion survive,
  // and no earlier file's re-run (0017 re-adds the ask check) narrows what 0034 allows.
  const m34 = await db.query('select purpose, activity_kind, basis from public.teaching_moves where id = $1', [kept34.move]);
  const d34 = await db.query('select draw_order from public.wheel_question_draws where pick_id = $1 order by draw_order', [kept34.banked]);
  const v34 = await db.query('select ask from public.wheel_picks where id = $1', [kept34.verbal]);
  const a34 = await db.query('select suggestion_id from public.room_activities where id = $1', [kept34.activity]);
  check('suggestions, question draws, a verbal pick and a used suggestion survive the re-run (0034)',
    m34.rows[0]?.purpose === 'move' && m34.rows[0]?.basis?.support?.count === 6
    && JSON.stringify(d34.rows.map((r) => r.draw_order)) === '[1,2]' && v34.rows[0]?.ask === 'verbal'
    && a34.rows[0]?.suggestion_id === kept34.move, JSON.stringify({ m: m34.rows, d: d34.rows, v: v34.rows, a: a34.rows }));
  await accepts('and a verbal ask is still accepted after it', () => db.query(
    `insert into public.wheel_picks (session_id, round, pick_order, roll_no, pool_size, present_only, no_repeat, ask)
     values ($1, 1, 9, '09', 3, true, true, 'verbal')`, [kept34.room]));
  await rejects('and a suggestion is still never edited after it', () => db.query(
    `update public.teaching_moves set body = 'changed' where id = $1`, [kept34.move]), { code: '23001' });
  // 0035 (Batch 8): a question kept for rooms, a lesson's sections and a check
  // ended early survive, and the checks still hold after it.
  const q35 = await db.query('select rooms_only from public.questions where id = $1', [kept35.question]);
  const l35 = await db.query('select sections from public.topic_lessons where id = $1', [kept35.lesson]);
  const r35 = await db.query('select end_reason from public.hub_runs where id = $1', [kept35.run]);
  check('a rooms-only question, a lesson\'s sections and a check ended early survive the re-run (0035)',
    q35.rows[0]?.rooms_only === true && l35.rows[0]?.sections?.facts?.[0]?.kind === 'why' && r35.rows[0]?.end_reason === 'ended',
    JSON.stringify({ q: q35.rows, l: l35.rows, r: r35.rows }));
  await rejects('and a self-test still cannot end \'ended\' after it', () => db.query(
    `insert into public.hub_runs (account_id, client_run_id, kind, spec, started_at, ended_at, end_reason)
     values ($1, 'run-0035-after', 'exam', '{}', '2026-11-19T05:00:00Z', '2026-11-19T05:01:00Z', 'ended')`, [STUDENT]),
  { code: '23514', match: /hub_runs_end_check/ });
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
    // A table a later file creates (class_questions, 0023) is no row changed.
    ok && JSON.stringify(counts) === JSON.stringify(
      Object.fromEntries(Object.entries(await rowCounts(before21)).filter(([t]) => t in counts)))
    && rows.length === 1 && rows[0].status === 'present' && rows[0].source === 'joined' && rows[0].roll_no === null,
    JSON.stringify(rows));
  await before21.close();
}

// ------------------------------- 0022 over links, rosters and questions --

section('0022 on a database that already holds links, a roster and a professor\'s question');

{
  const before22 = await freshDatabase();
  await applyAll(before22, files.filter((f) => f.name < '0022'), 'up to 0021');
  const [H, P, S] = [randomUUID(), randomUUID(), randomUUID()];
  await before22.query('insert into auth.users (id) values ($1), ($2), ($3)', [H, P, S]);
  const add = (id, role, code, reportsTo, rollNo) => before22.query(
    `insert into public.accounts (id, role, code, department, reports_to, roll_no) values ($1, $2, $3, 'CSE', $4, $5)`,
    [id, role, code, reportsTo, rollNo]);
  await add(H, 'hod', 'BL-HD0022', null, null);
  await add(P, 'professor', 'BL-PR0022', H, null);
  await add(S, 'student', 'BL-ST0022', P, '21CS01');
  await before22.exec(`
    insert into public.contents (id, title, kind, owner_id) values ('41111111-1111-4111-8111-111111111111', 'deck', 'pptx', '${P}');
    insert into public.questions (id, content_id, text, options, answer_idx, bloom, source, created_by)
      values ('42222222-2222-4222-8222-222222222222', '41111111-1111-4111-8111-111111111111', 'Own', '["a","b","c","d"]', 1,
              'remember', 'fallback', '${P}');
    insert into public.sessions (id, code, content_id, status, owner_id)
      values ('43333333-3333-4333-8333-333333333333', 'OLD022', '41111111-1111-4111-8111-111111111111', 'closed', '${P}');
    insert into public.profiles (session_id, roll_no, account_id)
      values ('43333333-3333-4333-8333-333333333333', '21CS01', '${S}');
    insert into public.answers (session_id, answer_key, roll_no, account_id, bloom)
      values ('43333333-3333-4333-8333-333333333333', 'k-old', '21CS01', '${S}', 'remember');
    insert into public.classes (id, course_name, section) values ('44444444-4444-4444-8444-444444444444', 'Networks', 'A');
    insert into public.class_students (class_id, roll_no, name) values ('44444444-4444-4444-8444-444444444444', '21CS01', 'Asha');
  `);
  const counts = await rowCounts(before22);
  const ok = await applyAll(before22, files.filter((f) => f.name >= '0022'), 'over existing rows');
  const read = async (sql) => (await before22.query(sql)).rows[0] ?? {};
  const p = await read('select account_id, account_verified from public.profiles');
  const a = await read('select account_id, account_verified from public.answers');
  const r = await read('select under_18, name from public.class_students');
  const q = await read('select source, replaces_id, created_by from public.questions');
  // Tables a later file creates (class_questions, 0023) are left out of the
  // comparison, as in the 0011 section: a new empty table is no row changed.
  check('0022 applies over existing rows, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before22)).filter(([t]) => t in counts))));
  check('a link made before it is kept, and reads back unverified, on the profile and on the answer',
    p.account_id === S && p.account_verified === false && a.account_id === S && a.account_verified === false,
    JSON.stringify({ p, a }));
  check('a roster row reads back not under 18; a professor\'s question stays fallback (not rewritten), with no link',
    r.under_18 === false && r.name === 'Asha' && q.source === 'fallback' && q.replaces_id === null && q.created_by === P,
    JSON.stringify({ r, q }));
  await before22.close();
}

// --------------------------------------------- 0023 over answers already given --

section('0023 on a database that already holds answers');

{
  const before23 = await freshDatabase();
  await applyAll(before23, files.filter((f) => f.name < '0023'), 'up to 0022');
  await before23.exec(`
    insert into public.contents (id, title, kind) values ('51111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.sessions (id, code, content_id, status)
      values ('53333333-3333-4333-8333-333333333333', 'OLD023', '51111111-1111-4111-8111-111111111111', 'open');
    insert into public.answers (session_id, answer_key, roll_no, bloom, confidence)
      values ('53333333-3333-4333-8333-333333333333', 'k-old-1', '21CS01', 'remember', null),
             ('53333333-3333-4333-8333-333333333333', 'k-old-2', '21CS02', 'apply', 'think');
  `);
  const counts = await rowCounts(before23);
  const ok = await applyAll(before23, files.filter((f) => f.name >= '0023'), 'over existing answers');
  const after = Object.fromEntries(Object.entries(await rowCounts(before23)).filter(([t]) => t in counts));
  check('0023 applies over existing answers, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(after),
    `${JSON.stringify(counts)} -> ${JSON.stringify(after)}`);
  const { rows } = await before23.query('select answer_key, class_question_id, round, confidence from public.answers order by answer_key');
  check('every answer given before it is an ordinary answer: no class question, no round, its tap as it was',
    JSON.stringify(rows.map((r) => [r.answer_key, r.class_question_id, r.round, r.confidence]))
      === JSON.stringify([['k-old-1', null, null, null], ['k-old-2', null, null, 'think']]), JSON.stringify(rows));
  const t = await before23.query(`select count(*)::int as n from public.class_questions`);
  check('and the room has no class question', t.rows[0].n === 0);
  await before23.close();
}

// ------------------------------------------ 0024 over questions already saved --

section('0024 on a database that already holds questions and answers');

{
  const before24 = await freshDatabase();
  await applyAll(before24, files.filter((f) => f.name < '0024'), 'up to 0023');
  await before24.exec(`
    insert into public.contents (id, title, kind) values ('61111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.questions (id, content_id, text, options, answer_idx, bloom, status, source, payload)
      values ('62222222-2222-4222-8222-222222222222', '61111111-1111-4111-8111-111111111111', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'teacher', '{}'),
             ('62222222-2222-4222-8222-222222222223', '61111111-1111-4111-8111-111111111111', 'Pick all', '["a","b","c","d"]', null,
              'analyse', 'draft', 'llm', '{"answerIdxs": [0, 1]}');
    insert into public.sessions (id, code, content_id, status)
      values ('63333333-3333-4333-8333-333333333333', 'OLD024', '61111111-1111-4111-8111-111111111111', 'closed');
    insert into public.answers (session_id, answer_key, roll_no, question_id, bloom, kind, response, question_snapshot)
      values ('63333333-3333-4333-8333-333333333333', 'k-24', '21CS01', '62222222-2222-4222-8222-222222222222', 'remember', 'mcq', '0',
              '{"text": "Pick one", "options": ["a","b","c","d"], "answerIdx": 1}');
  `);
  const counts = await rowCounts(before24);
  const shape = async () => (await before24.query(
    `select id, text, options, answer_idx, status, source, payload from public.questions order by id`)).rows;
  const answersBefore = (await before24.query('select * from public.answers')).rows;
  const questionsBefore = await shape();
  const ok = await applyAll(before24, files.filter((f) => f.name >= '0024'), 'over existing questions');
  check('0024 applies over existing questions and answers, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before24)).filter(([t]) => t in counts))));
  const { rows } = await before24.query('select misconceptions from public.questions order by id');
  check('every question saved before it has no labels, and is otherwise as it was',
    rows.length === 2 && rows.every((r) => JSON.stringify(r.misconceptions) === '[]')
    && JSON.stringify(await shape()) === JSON.stringify(questionsBefore), JSON.stringify(rows));
  // A column a later file adds to every answer (device_answered_at, 0030) is
  // empty on each of them: no answer touched, so it is left out of the comparison.
  const answersAfter = (await before24.query('select * from public.answers')).rows;
  check('no answer is touched', answersAfter.every((r) => (r.device_answered_at ?? null) === null)
    && JSON.stringify(answersAfter.map(({ device_answered_at: _d, ...rest }) => rest)) === JSON.stringify(answersBefore));
  await before24.close();
}

// A later migration may add a column (0030 adds answers.device_answered_at, null on
// every row it finds). The "nothing touched" checks below compare only the columns a
// row had before, so they keep testing what they were written for.
const asBefore = (after, before) => JSON.stringify(after.map((row, i) => Object.fromEntries(
  Object.keys(before[i] ?? row).map((k) => [k, row[k]]))));
// ------------------------------- 0025 over chapters, classes and questions --

section('0025 on a database that already holds chapters, classes, questions and answers');

{
  const before25 = await freshDatabase();
  await applyAll(before25, files.filter((f) => f.name < '0025'), 'up to 0024');
  await before25.exec(`
    insert into public.contents (id, title, kind, topics, topic_slides) values
      ('71111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets", "Relations"]', '{"Sets": [2, 3]}');
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('72222222-2222-4222-8222-222222222222', '71111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'llm', '{}');
    insert into public.classes (id, course_name, section) values ('73333333-3333-4333-8333-333333333333', 'Maths', 'A');
    insert into public.sessions (id, code, content_id, status, class_id)
      values ('74444444-4444-4444-8444-444444444444', 'OLD025', '71111111-1111-4111-8111-111111111111', 'closed',
              '73333333-3333-4333-8333-333333333333');
    insert into public.answers (session_id, answer_key, roll_no, question_id, bloom, topic)
      values ('74444444-4444-4444-8444-444444444444', 'k-25', '21CS01', '72222222-2222-4222-8222-222222222222', 'remember', 'Sets');
  `);
  const counts = await rowCounts(before25);
  const questionsBefore = (await before25.query('select * from public.questions')).rows;
  const answersBefore = (await before25.query('select * from public.answers')).rows;
  const ok = await applyAll(before25, files.filter((f) => f.name >= '0025'), 'over existing chapters');
  check('0025 applies over existing chapters, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before25)).filter(([t]) => t in counts))));
  const { rows } = await before25.query('select slide_texts, topics, topic_slides from public.contents');
  check('a chapter made before it has no slide texts, and keeps its topics and slide numbers',
    rows[0]?.slide_texts === null && rows[0]?.topics?.length === 2 && rows[0]?.topic_slides?.Sets?.[1] === 3, JSON.stringify(rows));
  check('no question and no answer is touched', asBefore((await before25.query('select * from public.questions')).rows, questionsBefore) === JSON.stringify(questionsBefore)
    && asBefore((await before25.query('select * from public.answers')).rows, answersBefore) === JSON.stringify(answersBefore));
  const hub = await before25.query(`select (select count(*) from public.class_units)::int as u, (select count(*) from public.class_chapters)::int as c,
    (select count(*) from public.chapter_topics)::int as t, (select count(*) from public.topic_links)::int as l`);
  check('and the hub starts empty: no unit, placement, topic record or link is made by the migration', JSON.stringify(hub.rows[0]) === '{"u":0,"c":0,"t":0,"l":0}',
    JSON.stringify(hub.rows[0]));
  await before25.close();
}

// ------------------------- 0026 over a hub that already holds topics and answers --

section('0026 on a database that already holds topic records, links, questions and room answers');

{
  const before26 = await freshDatabase();
  await applyAll(before26, files.filter((f) => f.name < '0026'), 'up to 0025');
  await before26.exec(`
    insert into public.contents (id, title, kind, topics) values ('81111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets", "Relations"]');
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('82222222-2222-4222-8222-222222222222', '81111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'llm', '{}');
    insert into public.sessions (id, code, content_id, status) values ('84444444-4444-4444-8444-444444444444', 'OLD026',
              '81111111-1111-4111-8111-111111111111', 'closed');
    insert into public.answers (session_id, answer_key, roll_no, question_id, bloom, topic)
      values ('84444444-4444-4444-8444-444444444444', 'k-26', '21CS01', '82222222-2222-4222-8222-222222222222', 'remember', 'Sets');
    insert into public.chapter_topics (id, content_id, name, key, position) values
      ('85555555-5555-4555-8555-555555555555', '81111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1),
      ('86666666-6666-4666-8666-666666666666', '81111111-1111-4111-8111-111111111111', 'Relations', 'relations', 2);
    insert into public.topic_links (prerequisite_id, topic_id, provenance, state, decided_at)
      values ('85555555-5555-4555-8555-555555555555', '86666666-6666-4666-8666-666666666666', 'professor', 'confirmed', now());
  `);
  const counts = await rowCounts(before26);
  const tables26 = ['questions', 'answers', 'chapter_topics', 'topic_links'];
  const rows26 = async () => Promise.all(tables26.map(async (t) => (await before26.query(`select * from public.${t} order by id`)).rows));
  const before26Rows = await rows26();
  const rowsBefore = JSON.stringify(before26Rows);
  const kept = async () => JSON.stringify((await rows26()).map((r, i) => JSON.parse(asBefore(r, before26Rows[i]))));
  const ok = await applyAll(before26, files.filter((f) => f.name >= '0026'), 'over an existing hub');
  check('0026 applies over an existing hub, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before26)).filter(([t]) => t in counts))));
  check('no question, answer, topic record or link is touched', (await kept()) === rowsBefore);
  const empty = await before26.query(`select (select count(*) from public.hub_attempts)::int as a, (select count(*) from public.question_explanations)::int as e`);
  check('and practice starts empty: no attempt or explanation is made by the migration', JSON.stringify(empty.rows[0]) === '{"a":0,"e":0}',
    JSON.stringify(empty.rows[0]));
  await before26.close();
}

// ------------------------- 0027 over chapters, topic records and questions --

section('0027 on a database that already holds chapters, topic records, questions and answers');

{
  const before27 = await freshDatabase();
  await applyAll(before27, files.filter((f) => f.name < '0027'), 'before 0027');
  await before27.exec(`
    insert into public.contents (id, title, kind, topics, topic_slides, slide_texts) values
      ('81111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets"]', '{"Sets": [1]}', '[{"slide": 1, "text": "Sets"}]');
    insert into public.chapter_topics (id, content_id, name, key, position)
      values ('85555555-5555-4555-8555-555555555555', '81111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1);
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('82222222-2222-4222-8222-222222222222', '81111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'llm', '{}');
    insert into public.sessions (id, code, content_id, status)
      values ('84444444-4444-4444-8444-444444444444', 'OLD027', '81111111-1111-4111-8111-111111111111', 'closed');
    insert into public.answers (session_id, answer_key, roll_no, question_id, bloom, topic, language)
      values ('84444444-4444-4444-8444-444444444444', 'k-27', '21CS01', '82222222-2222-4222-8222-222222222222', 'remember', 'Sets', 'en');
  `);
  const counts = await rowCounts(before27);
  const read = async (table) => (await before27.query(`select * from public.${table} order by id`)).rows;
  const kept = { questions: await read('questions'), answers: await read('answers'), chapter_topics: await read('chapter_topics'), contents: await read('contents') };
  const ok = await applyAll(before27, files.filter((f) => f.name >= '0027'), 'over existing chapters');
  check('0027 applies over existing chapters, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before27)).filter(([t]) => t in counts))));
  const same = [];
  for (const table of Object.keys(kept)) if (asBefore(await read(table), kept[table]) !== JSON.stringify(kept[table])) same.push(table);
  check('no chapter, topic record, question or answer is touched', same.length === 0, same.join(', '));
  const made = await before27.query(`select (select count(*) from public.topic_lessons)::int as l, (select count(*) from public.item_translations)::int as t,
    (select count(*) from public.student_language_choices)::int as c`);
  check('and nothing is made by the migration: no lesson, translation or choice of language', JSON.stringify(made.rows[0]) === '{"l":0,"t":0,"c":0}',
    JSON.stringify(made.rows[0]));
  await before27.close();
}

// ------------------------------------------- 0028 over hub attempts already kept --

section('0028 on a database that already holds hub attempts, topic records, questions and links');

{
  const before28 = await freshDatabase();
  await applyAll(before28, files.filter((f) => f.name < '0028'), 'before 0028');
  const [H, P, S] = [randomUUID(), randomUUID(), randomUUID()];
  await before28.query('insert into auth.users (id) values ($1), ($2), ($3)', [H, P, S]);
  const add = (id, role, code, reportsTo, rollNo) => before28.query(
    `insert into public.accounts (id, role, code, department, reports_to, roll_no) values ($1, $2, $3, 'CSE', $4, $5)`,
    [id, role, code, reportsTo, rollNo]);
  await add(H, 'hod', 'BL-HD2802', null, null);
  await add(P, 'professor', 'BL-PR2802', H, null);
  await add(S, 'student', 'BL-ST2802', P, '21CS01');
  await before28.exec(`
    insert into public.contents (id, title, kind, topics, owner_id) values
      ('81111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets", "Relations"]', '${P}');
    insert into public.chapter_topics (id, content_id, name, key, position) values
      ('85555555-5555-4555-8555-555555555555', '81111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1),
      ('86666666-6666-4666-8666-666666666666', '81111111-1111-4111-8111-111111111111', 'Relations', 'relations', 2);
    insert into public.topic_links (owner_id, prerequisite_id, topic_id, provenance, state, decided_at)
      values ('${P}', '85555555-5555-4555-8555-555555555555', '86666666-6666-4666-8666-666666666666', 'professor', 'confirmed', now());
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('82222222-2222-4222-8222-222222222222', '81111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'teacher', '{}');
    insert into public.hub_attempts (account_id, client_attempt_id, topic_id, question_id, bloom, correct, score, mode) values
      ('${S}', 'before-28-01', '85555555-5555-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'remember', true, 1, 'practice'),
      ('${S}', 'before-28-02', '85555555-5555-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'remember', false, 0, 'exam');
  `);
  const counts = await rowCounts(before28);
  const read = async (table) => (await before28.query(`select * from public.${table} order by id`)).rows;
  const kept = { hub_attempts: await read('hub_attempts'), questions: await read('questions'), chapter_topics: await read('chapter_topics'), topic_links: await read('topic_links') };
  const ok = await applyAll(before28, files.filter((f) => f.name >= '0028'), 'over existing hub attempts');
  check('0028 applies over existing hub attempts, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before28)).filter(([t]) => t in counts))));
  const changed = [];
  for (const table of Object.keys(kept)) {
    // The new column aside, every value is as it was (and 0035's rooms_only, a later file's).
    const now = (await read(table)).map(({ run_id: _run, rooms_only: _r35, ...rest }) => rest);
    if (JSON.stringify(now) !== JSON.stringify(kept[table])) changed.push(table);
  }
  check('no hub attempt, question, topic record or link is touched', changed.length === 0, changed.join(', '));
  const runs = await before28.query('select run_id from public.hub_attempts');
  check('every attempt kept before reads as one with no run, an exam-mode one included', runs.rows.length === 2 && runs.rows.every((r) => r.run_id === null));
  const made = await before28.query(`select (select count(*) from public.hub_runs)::int as r, (select count(*) from public.hub_goals)::int as g`);
  check('and nothing is made by the migration: no run and no goal', JSON.stringify(made.rows[0]) === '{"r":0,"g":0}', JSON.stringify(made.rows[0]));
  await before28.close();
}

// ----------------------- 0029 over hub attempts in every mode, questions and translations --

section('0029 on a database that already holds hub attempts in every mode, questions and translations');

{
  const before29 = await freshDatabase();
  await applyAll(before29, files.filter((f) => f.name < '0029'), 'before 0029');
  const [H, P, S] = ['81111111-0000-4000-8000-000000000001', '81111111-0000-4000-8000-000000000002', '81111111-0000-4000-8000-000000000003'];
  await before29.query('insert into auth.users (id) values ($1), ($2), ($3)', [H, P, S]);
  const add = (id, role, code, reportsTo, rollNo) => before29.query(
    `insert into public.accounts (id, role, code, department, reports_to, roll_no) values ($1, $2, $3, 'CSE', $4, $5)`, [id, role, code, reportsTo, rollNo]);
  await add(H, 'hod', 'BL-HD0029', null, null);
  await add(P, 'professor', 'BL-PR0029', H, null);
  await add(S, 'student', 'BL-ST0029', P, '21CS29');
  await before29.exec(`
    insert into public.contents (id, title, kind, topics, topic_slides) values
      ('81111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets"]', '{"Sets": [1]}');
    insert into public.chapter_topics (id, content_id, name, key, position)
      values ('85555555-5555-4555-8555-555555555555', '81111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1);
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('82222222-2222-4222-8222-222222222222', '81111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'llm', '{}');
    insert into public.hub_attempts (account_id, client_attempt_id, topic_id, question_id, bloom, correct, score, mode, hints_used) values
      ('${S}', 'before-0029-01', '85555555-5555-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'remember', true, 1, 'practice', 0),
      ('${S}', 'before-0029-02', '85555555-5555-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'remember', false, 0, 'exam', 0),
      ('${S}', 'before-0029-03', '85555555-5555-4555-8555-555555555555', '82222222-2222-4222-8222-222222222222', 'remember', false, 0, 'exam', 1);
    insert into public.item_translations (item_kind, item_id, content_id, language, fields, source_fields, source_hash, provenance)
      values ('hint', '86666666-6666-4666-8666-666666666666', '81111111-1111-4111-8111-111111111111', 'hi', '{"hint": "x"}', '{"hint": "y"}',
              '${'b'.repeat(64)}', 'professor');
  `);
  const counts = await rowCounts(before29);
  const read = async (table) => (await before29.query(`select * from public.${table} order by id`)).rows;
  const kept = { questions: await read('questions'), hub_attempts: await read('hub_attempts'), item_translations: await read('item_translations') };
  const ok = await applyAll(before29, files.filter((f) => f.name >= '0029'), 'over existing hub attempts');
  check('0029 applies over hub attempts in every mode, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before29)).filter(([t]) => t in counts))));
  const same = [];
  // 0035's rooms_only is a later file's column: every value read before is compared.
  for (const table of Object.keys(kept)) if (asBefore(await read(table), kept[table]) !== JSON.stringify(kept[table])) same.push(table);
  check('no question, hub attempt or translation is touched (an older self-test attempt holding a hint is left as it was)', same.length === 0, same.join(', '));
  await rejects('while a new self-test attempt with hints is refused', () => before29.query(
    `insert into public.hub_attempts (account_id, client_attempt_id, bloom, correct, score, mode, hints_used) values ($1, 'after-0029-01', 'remember', true, 1, 'exam', 1)`,
    [S]), { code: '23514', match: /hub_attempts_hints_mode_check/ });
  const made = await before29.query(`select (select count(*) from public.question_hints)::int as h, (select count(*) from public.option_feedback)::int as f,
    (select count(*) from public.hub_hint_views)::int as v`);
  check('and the tutor starts empty: no hint, feedback or hint view is made by the migration', JSON.stringify(made.rows[0]) === '{"h":0,"f":0,"v":0}',
    JSON.stringify(made.rows[0]));
  await before29.close();
}

// -------------------------------------------- 0030 over answers already given --

section('0030 on a database that already holds rooms, profiles and answers');

{
  const before30 = await freshDatabase();
  await applyAll(before30, files.filter((f) => f.name < '0030'), 'up to the file before 0030');
  await before30.exec(`
    insert into public.contents (id, title, kind) values ('71111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.sessions (id, code, content_id, status, closed_at)
      values ('73333333-3333-4333-8333-333333333333', 'OLD030', '71111111-1111-4111-8111-111111111111', 'closed', now());
    insert into public.profiles (session_id, roll_no, served_id, served_at)
      values ('73333333-3333-4333-8333-333333333333', '21CS01', '72222222-2222-4222-8222-222222222222', now());
    insert into public.answers (session_id, answer_key, roll_no, bloom, final, correct, score, served_at)
      values ('73333333-3333-4333-8333-333333333333', 'k-30-a', '21CS01', 'remember', true, true, 1, now()),
             ('73333333-3333-4333-8333-333333333333', 'k-30-b', '21CS01', 'apply', false, false, 0, now());
  `);
  const counts = await rowCounts(before30);
  const without = (rows) => JSON.stringify(rows.map(({ device_answered_at: _d, ...rest }) => rest));
  const answersBefore = (await before30.query('select * from public.answers order by answer_key')).rows;
  const profilesBefore = (await before30.query('select * from public.profiles')).rows;
  const ok = await applyAll(before30, files.filter((f) => f.name >= '0030'), 'over existing answers');
  const after = Object.fromEntries(Object.entries(await rowCounts(before30)).filter(([t]) => t in counts));
  check('0030 applies over existing rooms, profiles and answers, adding and removing none',
    ok && JSON.stringify(counts) === JSON.stringify(after), `${JSON.stringify(counts)} -> ${JSON.stringify(after)}`);
  const answersAfter = (await before30.query('select * from public.answers order by answer_key')).rows;
  check('every answer given before it reads back as one whose phone sent no time, and is otherwise as it was',
    answersAfter.every((r) => r.device_answered_at === null) && without(answersAfter) === without(answersBefore),
    JSON.stringify(answersAfter.map((r) => [r.answer_key, r.device_answered_at])));
  // served_log is new on every profile: an empty list, read from the column's
  // default, so it is left out of the comparison and checked on its own.
  const profilesAfter = (await before30.query('select * from public.profiles')).rows;
  check('no profile is touched (the phone\'s place, its pin, is as it was), and each reads as one with no serves logged',
    JSON.stringify(profilesAfter.map(({ served_log: _l, ...rest }) => rest)) === JSON.stringify(profilesBefore)
    && profilesAfter.every((p) => JSON.stringify(p.served_log) === '[]'), JSON.stringify(profilesAfter.map((p) => p.served_log)));
  const t = await before30.query('select count(*)::int as n from public.question_packs');
  check('and no phone holds a pack', t.rows[0].n === 0);
  await before30.close();
}

// ------------------------------- 0031 over rooms and answers already kept --

section('0031 on a database that already holds rooms, answers and archives');

{
  const before31 = await freshDatabase();
  await applyAll(before31, files.filter((f) => f.name < '0031'), 'up to the file before 0031');
  await before31.exec(`
    insert into public.contents (id, title, kind) values ('71111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.sessions (id, code, content_id, status)
      values ('73333333-3333-4333-8333-333333333333', 'OLD031', '71111111-1111-4111-8111-111111111111', 'closed');
    insert into public.answers (session_id, answer_key, roll_no, bloom, kind, response, question_snapshot)
      values ('73333333-3333-4333-8333-333333333333', 'k-31', '21CS01', 'remember', 'mcq', '0', '{"text": "Pick one"}');
    insert into public.room_archives (session_id, code, bytes, data)
      values ('74444444-4444-4444-8444-444444444444', 'GONE31', 10, '{"format": "bloomloop.room-archive"}');
  `);
  const counts = await rowCounts(before31);
  const kept = async () => JSON.stringify([
    (await before31.query('select * from public.sessions order by id')).rows,
    (await before31.query('select * from public.answers order by id')).rows,
    (await before31.query('select * from public.room_archives order by id')).rows,
  ]);
  const rowsBefore = await kept();
  const ok = await applyAll(before31, files.filter((f) => f.name >= '0031'), 'over existing rooms');
  check('0031 applies over existing rooms, answers and archives, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before31)).filter(([t]) => t in counts))));
  check('no room, answer or archive is touched', (await kept()) === rowsBefore);
  const { rows } = await before31.query('select count(*)::int as n from public.room_imports');
  check('and there is no import yet', rows[0].n === 0);
  await before31.close();
}

// ------------------------------------- 0032 over teacher records already kept --

section('0032 on a database that already holds attendance and teacher records');

{
  const before32 = await freshDatabase();
  await applyAll(before32, files.filter((f) => f.name < '0032'), 'up to 0031');
  await before32.exec(`
    insert into public.contents (id, title, kind) values ('71111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.classes (id, course_name, section) values ('72222222-2222-4222-8222-222222222222', 'Networks', 'A');
    insert into public.class_students (id, class_id, roll_no, name)
      values ('73333333-3333-4333-8333-333333333333', '72222222-2222-4222-8222-222222222222', '21CS01', 'Asha');
    insert into public.sessions (id, code, content_id, status, class_id)
      values ('74444444-4444-4444-8444-444444444444', 'OLD032', '71111111-1111-4111-8111-111111111111', 'open',
              '72222222-2222-4222-8222-222222222222');
    insert into public.attendance (session_id, class_student_id, status, source)
      values ('74444444-4444-4444-8444-444444444444', '73333333-3333-4333-8333-333333333333', 'late', 'teacher');
    insert into public.observations (session_id, class_id, class_student_id, roll_no, day, kind, note)
      values ('74444444-4444-4444-8444-444444444444', '72222222-2222-4222-8222-222222222222',
              '73333333-3333-4333-8333-333333333333', '21CS01', '2026-11-19', 'understood', 'before 0032');
    insert into public.hand_tallies (session_id, seq, question_text, counts)
      values ('74444444-4444-4444-8444-444444444444', 1, 'Which layer routes?', '{3,1,0,0}');
    insert into public.room_activities (session_id, seq, kind, outcome)
      values ('74444444-4444-4444-8444-444444444444', 1, 'check', 'Most got it');
  `);
  const counts = await rowCounts(before32);
  const read = async () => JSON.stringify((await before32.query(`
    select (select json_agg(json_build_object('s', status, 'src', source, 'at', marked_at)) from public.attendance) as a,
           (select json_agg(json_build_object('k', kind, 'n', note, 'at', observed_at)) from public.observations) as o,
           (select json_agg(json_build_object('c', counts, 'at', updated_at)) from public.hand_tallies) as t,
           (select json_agg(json_build_object('o', outcome, 'at', updated_at)) from public.room_activities) as r`)).rows[0]);
  const recordsBefore = await read();
  const ok = await applyAll(before32, files.filter((f) => f.name >= '0032'), 'over existing records');
  check('0032 applies over existing attendance and records, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before32)).filter(([t]) => t in counts))));
  check('every mark and record reads back exactly as it was', (await read()) === recordsBefore);
  const k = await before32.query('select count(*)::int as n from public.record_writes');
  check('and no write has a key: the table starts empty', k.rows[0].n === 0);
  await before32.close();
}

// ------------------------------ 0034 over picks and activities already kept --

section('0034 on a database that already holds wheel picks and activities');

{
  const before34 = await freshDatabase();
  await applyAll(before34, files.filter((f) => f.name < '0034'), 'up to the file before 0034');
  await before34.exec(`
    insert into public.contents (id, title, kind) values ('81111111-1111-4111-8111-111111111111', 'deck', 'pptx');
    insert into public.questions (id, content_id, text, options, answer_idx, bloom)
      values ('82222222-2222-4222-8222-222222222222', '81111111-1111-4111-8111-111111111111', 'Which?', '["a","b","c","d"]', 0, 'remember');
    insert into public.sessions (id, code, content_id, status)
      values ('83333333-3333-4333-8333-333333333333', 'OLD034', '81111111-1111-4111-8111-111111111111', 'open');
    insert into public.wheel_rounds (session_id, round) values ('83333333-3333-4333-8333-333333333333', 1);
    insert into public.wheel_picks (session_id, round, pick_order, roll_no, pool_size, present_only, no_repeat, ask, question_id, status, status_at)
      values ('83333333-3333-4333-8333-333333333333', 1, 1, '01', 3, true, true, 'bank', '82222222-2222-4222-8222-222222222222', 'answered', now()),
             ('83333333-3333-4333-8333-333333333333', 1, 2, '02', 2, true, true, 'diagram', null, 'help', now()),
             ('83333333-3333-4333-8333-333333333333', 1, 3, '03', 1, true, true, 'demo', null, 'pending', null);
    insert into public.room_activities (session_id, seq, kind, outcome)
      values ('83333333-3333-4333-8333-333333333333', 1, 'think', 'Pairs explained it');
  `);
  const counts = await rowCounts(before34);
  const read = async () => JSON.stringify((await before34.query(`
    select (select json_agg(json_build_object('o', pick_order, 'a', ask, 'q', question_id, 's', status) order by pick_order)
              from public.wheel_picks) as p,
           (select json_agg(json_build_object('k', kind, 'o', outcome, 'at', updated_at)) from public.room_activities) as r`)).rows[0]);
  const recordsBefore = await read();
  const ok = await applyAll(before34, files.filter((f) => f.name >= '0034'), 'over existing picks and activities');
  check('0034 applies over existing picks and activities, adding and removing none', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before34)).filter(([t]) => t in counts))));
  check('every pick and activity reads back exactly as it was', (await read()) === recordsBefore);
  const after = await before34.query(`
    select (select count(*)::int from public.teaching_moves) as moves,
           (select count(*)::int from public.wheel_question_draws) as draws,
           (select count(*)::int from public.room_activities where suggestion_id is not null) as used`);
  check('no suggestion, no draw, and no activity pointing at one: the new tables start empty',
    after.rows[0].moves === 0 && after.rows[0].draws === 0 && after.rows[0].used === 0, JSON.stringify(after.rows));
  await before34.close();
}

// ------------------------------- 0035 over questions, lessons and checks already kept --

section('0035 on a database that already holds questions, lessons and Get Ready checks');

{
  const before35 = await freshDatabase();
  await applyAll(before35, files.filter((f) => f.name < '0035'), 'up to the file before 0035');
  const [H, P, S] = [randomUUID(), randomUUID(), randomUUID()];
  await before35.query('insert into auth.users (id) values ($1), ($2), ($3)', [H, P, S]);
  const add = (id, role, code, reportsTo, rollNo) => before35.query(
    `insert into public.accounts (id, role, code, department, reports_to, roll_no) values ($1, $2, $3, 'CSE', $4, $5)`,
    [id, role, code, reportsTo, rollNo]);
  await add(H, 'hod', 'BL-HD3502', null, null);
  await add(P, 'professor', 'BL-PR3502', H, null);
  await add(S, 'student', 'BL-ST3502', P, '21CS01');
  await before35.exec(`
    insert into public.contents (id, title, kind, topics, owner_id) values
      ('91111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets"]', '${P}');
    insert into public.chapter_topics (id, content_id, name, key, position)
      values ('95555555-5555-4555-8555-555555555555', '91111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1);
    insert into public.questions (id, content_id, topic, text, options, answer_idx, bloom, status, source, payload)
      values ('92222222-2222-4222-8222-222222222222', '91111111-1111-4111-8111-111111111111', 'Sets', 'Pick one', '["a","b","c","d"]', 1,
              'remember', 'active', 'llm', '{}');
    insert into public.topic_lessons (topic_id, content_id, owner_id, version, source, model, steps)
      values ('95555555-5555-4555-8555-555555555555', '91111111-1111-4111-8111-111111111111', '${P}', 1, 'llm', 'gemini-2.5-flash',
              '[{"type": "chunk", "slides": [1], "text": "Sets"}]');
    insert into public.hub_runs (account_id, client_run_id, kind, spec, started_at, ended_at, end_reason)
      values ('${S}', 'run-before-35', 'getready', '{}', '2026-11-19T05:00:00Z', '2026-11-19T05:02:00Z', 'complete');
  `);
  const counts = await rowCounts(before35);
  const read = async (table) => (await before35.query(`select * from public.${table} order by id`)).rows;
  const kept = { questions: await read('questions'), topic_lessons: await read('topic_lessons'), hub_runs: await read('hub_runs') };
  const ok = await applyAll(before35, files.filter((f) => f.name >= '0035'), 'over existing questions, lessons and checks');
  check('0035 applies over existing questions, lessons and checks, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before35)).filter(([t]) => t in counts))));
  const now = { questions: await read('questions'), topic_lessons: await read('topic_lessons'), hub_runs: await read('hub_runs') };
  const without = (rows, col) => rows.map(({ [col]: _drop, ...rest }) => rest);
  check('every question is still shared (rooms_only false), and nothing else on it changed',
    now.questions.every((r) => r.rooms_only === false)
    && asBefore(without(now.questions, 'rooms_only'), kept.questions) === JSON.stringify(kept.questions));
  check('every lesson has no sections (null), and nothing else on it changed',
    now.topic_lessons.every((r) => r.sections === null)
    && asBefore(without(now.topic_lessons, 'sections'), kept.topic_lessons) === JSON.stringify(kept.topic_lessons));
  check('every check ended as it was', asBefore(now.hub_runs, kept.hub_runs) === JSON.stringify(kept.hub_runs));
  await before35.close();
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

// ---------------------------- 0033 over uploads and lessons already kept --

section('0033 on a database that already holds uploads, chapters and lessons');

{
  const before33 = await freshDatabase();
  await applyAll(before33, files.filter((f) => f.name < '0033'), 'up to the file before 0033');
  const P = randomUUID();
  const H = randomUUID();
  await before33.query('insert into auth.users (id) values ($1), ($2)', [H, P]);
  await before33.query(`insert into public.accounts (id, role, code, department) values ($1, 'hod', 'BL-HD3301', 'CSE')`, [H]);
  await before33.query(`insert into public.accounts (id, role, code, department, reports_to) values ($1, 'professor', 'BL-PR3301', 'CSE', $2)`, [P, H]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const sha = (await import('node:crypto')).createHash('sha256').update(png).digest('hex');
  await before33.query(`insert into public.contents (id, title, kind, topics, owner_id, slide_texts) values
    ('91111111-1111-4111-8111-111111111111', 'deck', 'pptx', '["Sets"]', $1, '[{"slide": 1, "text": "Sets"}]')`, [P]);
  await before33.query(`insert into public.chapter_topics (id, content_id, name, key, position)
    values ('95555555-5555-4555-8555-555555555555', '91111111-1111-4111-8111-111111111111', 'Sets', 'sets', 1)`);
  await before33.query(`insert into public.media (owner_id, content_id, mime, bytes, sha256, data, alt)
    values ($1, '91111111-1111-4111-8111-111111111111', 'image/png', $2, $3, $4::text::bytea, 'A leaf')`, [P, png.length, sha, `\\x${png.toString('hex')}`]);
  await before33.query(`insert into public.topic_lessons (topic_id, content_id, owner_id, version, status, source, model, steps, basis, warnings, created_by)
    values ('95555555-5555-4555-8555-555555555555', '91111111-1111-4111-8111-111111111111', $1, 1, 'draft', 'slides', null,
            '[{"type": "chunk", "slides": [1], "text": "Sets are collections"}]', '{}', '[]', $1)`, [P]);
  const counts = await rowCounts(before33);
  const read = async (table, cols = '*') => (await before33.query(`select ${cols} from public.${table} order by id`)).rows;
  const kept = {
    media: await read('media', 'id, owner_id, content_id, mime, bytes, sha256, alt, created_at'),
    contents: await read('contents'),
    topic_lessons: await read('topic_lessons'),
  };
  const ok = await applyAll(before33, files.filter((f) => f.name >= '0033'), 'over existing uploads and lessons');
  check('0033 applies over existing uploads, chapters and lessons, adding and removing no row', ok && JSON.stringify(counts) === JSON.stringify(
    Object.fromEntries(Object.entries(await rowCounts(before33)).filter(([t]) => t in counts))));
  const media = await read('media', 'id, owner_id, content_id, mime, bytes, sha256, alt, created_at');
  const contents = (await read('contents')).map(({ slide_pictures: _s, ...rest }) => rest);
  const lessons = await read('topic_lessons');
  check('every upload, chapter and lesson reads back as it was',
    asBefore(media, kept.media) === JSON.stringify(kept.media)
    && asBefore(contents, kept.contents) === JSON.stringify(kept.contents)
    && asBefore(lessons, kept.topic_lessons) === JSON.stringify(kept.topic_lessons));
  const fresh = await before33.query(`select (select count(*) from public.media where slide_no is not null)::int as m,
    (select count(*) from public.contents where slide_pictures is not null)::int as c`);
  check('an old upload has no slide, and an old chapter says it kept no pictures (both null)', JSON.stringify(fresh.rows[0]) === '{"m":0,"c":0}',
    JSON.stringify(fresh.rows[0]));
  const again = await applyAll(before33, files.filter((f) => f.name >= '0033'), 'a second time');
  check('and running it again changes nothing', again && asBefore(await read('topic_lessons'), kept.topic_lessons) === JSON.stringify(kept.topic_lessons));
  await before33.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
