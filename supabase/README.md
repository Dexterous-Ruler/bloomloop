# Database migrations

`migrations/` is the only source of truth for the BloomLoop database. There are no
other SQL files to run.

## Applying

Run every file in `migrations/`, in number order (`0000`, `0001`, ... `0018`).

`0013` must be in place before the Phase 2 server is deployed: every generated
question is saved with columns it adds, and the server's boot probe falls back to
the in-process store (nothing saved) when they are missing. The same goes for
`0014`: the probe also checks the `media` table that image uploads are kept in. And
for `0015`: every room is opened with `sessions.question_ids`, so the probe checks
that column too. `0015` changes no row; existing rooms keep serving their whole
approved bank. And for `0016` (classes, rosters and attendance): every room is
opened with `sessions.class_id`, and the probe checks it and the three new tables.
`0016` changes no row; existing rooms are opened for no class and behave as before.
And for `0017` (the teacher-record store): the probe checks its six tables. `0017`
changes no row, and from it on the database refuses to edit an observation or an
insight action, to change who a wheel pick drew, and to delete any teacher record
except with its room. And for `0018` (room modes, the waiting room and projector
links): every room is opened with its five new `sessions` columns, so the probe
checks them and the `projector_links` table. `0018` changes no row; existing rooms
get the values that reproduce how they ran (Student devices, adapting, from
Understand, no cap, no time per question), and `sessions.status` now also allows
`waiting`.

`0011` creates its index only if no two accounts in one department hold the same
roll number once trimmed, single-spaced and upper-cased. If some do, it raises a
WARNING, creates nothing and changes nothing; the file has the query that lists
them. Correct those accounts, then run `0011` again.

From `0012` on, the database itself refuses to rewrite an answer's evidence (the
response, the question as asked, the machine's assessment) and to edit or delete a
review decision, from any connection, the service role included. See
`docs/DATABASE_SCHEMA.md`.

**Supabase SQL editor:** SQL Editor, New query, paste one file, Run. Then the next
file, in order.

**psql:**

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f "$f" || break
done
```

`--single-transaction` makes each file all-or-nothing. The connection string comes
from the Supabase dashboard (Project Settings, Database); keep it out of the
repository.

## Every file is safe to re-run

Each file can be run any number of times, against a new project or against the live
one. Nothing in the set drops a table or a column, deletes or rewrites a row, or
narrows a type. On a database that already has a table or column, its `create` /
`add column` is skipped; constraints are dropped by name and added again; functions
and triggers are replaced. So after pulling new migrations, run the whole set again
rather than working out which files are new.

`0005` re-adds `sessions_status_check`, and it lists `'waiting'` (added by `0018`)
as well, so a re-run never narrows the check below what a later file allows. The
migration test re-runs the set with a room left waiting.

The set needs Supabase's `auth.users` table (accounts and invites point at it). On
plain Postgres, create `auth.users (id uuid primary key)` first.

## Checking

```bash
cd server && npm run migrations
```

Builds the set twice in an in-memory Postgres (PGlite), uses the result the way the
server does, re-runs it over data, and upgrades a v1 database. Prints PASS or FAIL
per check and exits non-zero on any failure.

## Adding a migration

Add the next number (`0009_what_it_does.sql`), written to the same rules: `if not
exists` on every create and add, `drop ... if exists` before every constraint or
trigger you add, `create or replace` for functions. Never renumber or edit the
meaning of an applied file. Add any column the server reads or writes to
`COLUMNS_THE_SERVER_USES` in `server/scripts/migrations.mjs`, and to
`docs/DATABASE_SCHEMA.md`.

`0001` was reconstructed from the server code while the live project was
unreachable. See `docs/DATABASE_SCHEMA.md` for what to compare against the live
project.
