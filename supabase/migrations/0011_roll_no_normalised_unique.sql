-- 0011: one student per roll number in a department, however it was typed.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs accounts (0001). Idempotent: a no-op once the index
-- exists. Adds one index; changes no row.
--
-- WHY.
-- accounts_department_roll_no_key (0001) compares roll numbers exactly as typed,
-- so '21CS01' and '21cs01' could both exist in one department. A live room cannot
-- tell them apart: it trims, single-spaces and upper-cases every roll number a
-- phone sends (normaliseRoll in server/src/sockets/index.js), and the server
-- compares account roll numbers the same way (rollKey in services/accounts.js).
-- Two such accounts were one student to every room: findStudentForRoll linked
-- neither, so their answers stayed unlinked, and both read the same room profiles
-- in their own analytics. This index refuses the second account, comparing in the
-- room's form. The server already answers its 23505 as a 409 and does not mistake
-- it for a code collision (services/accounts.js).
--
-- ROWS THAT ALREADY CLASH.
-- A unique index cannot be built over rows that break it, and this migration
-- rewrites and deletes nothing to make room for one. If a department already holds
-- two such accounts, the index is NOT created: a WARNING says how many roll numbers
-- clash, the rest of the set still applies, and running this file again once a
-- person has corrected those accounts creates it. To list them:
--
--   select department, upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')) as roll,
--          count(*) from public.accounts where roll_no is not null group by 1, 2 having count(*) > 1;
--
-- Postgres's \s is ASCII whitespace; JavaScript's also takes Unicode spaces. A
-- roll number holding one would compare equal in the server and not here. The
-- room only ever stores ASCII (ROLL_SHAPE in sockets/index.js), so such an account
-- could never be linked to a room in the first place.

do $$
declare
  clashes integer;
begin
  if to_regclass('public.accounts_department_roll_key') is not null then
    return;
  end if;

  select count(*) into clashes
    from (select 1
            from public.accounts
           where roll_no is not null
           group by department,
                    upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g'))
          having count(*) > 1) as clashing;

  if clashes > 0 then
    raise warning '0011: % roll number(s) are held by more than one account in one department once trimmed, single-spaced and upper-cased, so accounts_department_roll_key was not created. Correct those accounts and run 0011 again.', clashes;
    return;
  end if;

  create unique index accounts_department_roll_key
    on public.accounts (department, upper(regexp_replace(regexp_replace(roll_no, '^\s+|\s+$', '', 'g'), '\s+', ' ', 'g')))
    where roll_no is not null;
end
$$;
