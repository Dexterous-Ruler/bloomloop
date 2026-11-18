-- 0012: the database itself keeps the evidence and the review log as written.
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs answers (0008) and answer_reviews (0010).
-- Idempotent: the functions are replaced and the triggers dropped and recreated
-- with the same definitions. Adds three functions and three triggers; changes no
-- row.
--
-- WHY.
-- Until now only server code kept these rules: the short list of fields
-- updateAnswer may set, and a repo with no way to update or delete a review. RLS
-- with no policies does not restrain the service role the server connects as, so
-- an UPDATE from the SQL editor, a one-off script or a future bug could rewrite a
-- student's response or the machine's first reading, or edit or remove a
-- professor's decision, and nothing would notice. Now the database refuses it,
-- whoever asks.
--
-- WHAT IS REFUSED (SQLSTATE 23001 restrict_violation, unless said otherwise).
--   answers          an UPDATE that changes anything but what a review writes
--                    beside the evidence (correct, score, review_status,
--                    reviewed_by, reviewed_at, review_note, final) and the two
--                    links the database itself clears or a link may later set
--                    (question_id, account_id). The response, the question as
--                    asked, auto_correct/auto_score/auto_detail, the room, the
--                    student, the key and the time are written once.
--                    A list of what may change, not of what may not: a column
--                    added later is protected until somebody allows it here.
--   answer_reviews   any UPDATE, except reviewed_by cleared when the reviewer's
--                    account is deleted. A DELETE, except the cascade from
--                    deleting its answer or its room. An INSERT whose session_id
--                    is not its answer's room (23503, like the foreign key it
--                    extends).
--
-- WHAT STILL WORKS.
-- Deleting a room: sessions cascades to answers and answer_reviews, after the
-- server has archived the room (0009). A cascade runs inside the foreign key's
-- own trigger, so pg_trigger_depth() is above 1 when this guard sees it, and 1
-- for a DELETE sent directly. Deleting a question or an account clears
-- question_id, account_id and reviewed_by, as before. An answer row can still be
-- deleted directly; whether that should ever be allowed belongs with the erasure
-- rules still waiting on legal review (PRODUCT_DECISIONS.md, decisions 8 and 9).
-- Correcting a row by hand now means disabling the trigger first: a deliberate
-- act by the table's owner, never a slip.

-- ------------------------------------------------------------------ answers --

create or replace function public.answers_keep_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  reviewable constant text[] := array[
    'correct', 'score', 'review_status', 'reviewed_by', 'reviewed_at', 'review_note', 'final',
    'question_id', 'account_id'];
begin
  if (to_jsonb(new) - reviewable) is distinct from (to_jsonb(old) - reviewable) then
    raise exception 'answers % is evidence: only correct, score, review_status, reviewed_by, reviewed_at, review_note, final, question_id and account_id may change once it is written', old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists answers_evidence_written_once on public.answers;
create trigger answers_evidence_written_once
  before update on public.answers
  for each row execute function public.answers_keep_evidence();

-- ----------------------------------------------------------- answer_reviews --

create or replace function public.answer_reviews_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- pg_trigger_depth() is 1 for a statement sent directly, and above 1 inside a
  -- foreign key's own action: the cascade from an answer or a room, or the
  -- reviewer's account being deleted.
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'answer_reviews is append-only: review % goes only with its answer or its room', old.id
      using errcode = 'restrict_violation';
  end if;
  -- The one update the log takes: reviewed_by cleared by "on delete set null"
  -- when the reviewer's account goes. The decision itself stays.
  if pg_trigger_depth() > 1 and new.reviewed_by is null
     and (to_jsonb(new) - 'reviewed_by') = (to_jsonb(old) - 'reviewed_by') then
    return new;
  end if;
  raise exception 'answer_reviews is append-only: a later decision is a new row, never an edit of review %', old.id
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists answer_reviews_append_only on public.answer_reviews;
create trigger answer_reviews_append_only
  before update or delete on public.answer_reviews
  for each row execute function public.answer_reviews_append_only();

-- A review row names its room so a room's log can be archived without a join;
-- it must name the right one. An answer that does not exist at all is left to
-- the foreign key on answer_id.
create or replace function public.answer_reviews_same_room()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.answers a where a.id = new.answer_id and a.session_id <> new.session_id) then
    raise exception 'answer_reviews: session_id % is not the room of answer %', new.session_id, new.answer_id
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists answer_reviews_same_room on public.answer_reviews;
create trigger answer_reviews_same_room
  before insert on public.answer_reviews
  for each row execute function public.answer_reviews_same_room();
