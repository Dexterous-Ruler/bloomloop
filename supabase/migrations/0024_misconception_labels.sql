-- 0024: misconception labels on a question's wrong options (Phase 5).
--
-- Apply in number order with the rest of supabase/migrations (see
-- supabase/README.md). Needs questions (0000). Idempotent: the column is added
-- only if missing, and its one check is dropped and added again with the same
-- definition. One column with a default, no backfill: no existing row is
-- rewritten, and every question before this file reads as having no labels.
--
-- WHAT IS ADDED, and why (docs/PRODUCT_DECISIONS.md, Phase 5):
--
--   questions.misconceptions   the professor's labels on the question's wrong
--                      options: a JSON array, one object per labelled option,
--                        option      the option's text (a label belongs to what
--                                    the option says, not to its position, so
--                                    reordering options keeps it on the right
--                                    one; on a true/false question, "True" or
--                                    "False")
--                        label       the misunderstanding, at most 120
--                                    characters, no contact details (checked by
--                                    the server, services/misconceptions.js)
--                        provenance  'ai' (proposed by the generator, shown as an
--                                    AI draft) or 'professor' (written, edited or
--                                    confirmed by the professor)
--                        addedAt, changedAt, by   when it was first written and
--                                    last reworded, and who last wrote or
--                                    confirmed it (null for the generator)
--                      Empty for every question without labels. The server
--                      writes it with every question it saves.
--
-- WHAT IS NOT CHANGED. No answer row: a label is read when a report runs and
-- matched to each answer by the option's text in that answer's own snapshot, so
-- nothing about a label is stored on an answer, and 0012's guard is untouched.
-- A label changes no mark, so no score, level, review or attainment figure
-- depends on this column.
--
-- RE-RUNS. No earlier file touches this column or its check, so re-running the
-- whole set never narrows anything added here.
--
-- PRIVACY. RLS is on for questions already (0000), with no policies: only the
-- server's service role reads or writes. Labels are staff-only: the server never
-- sends them to a phone or the projector, and leaves them out of the question
-- snapshot it stores with each answer.

alter table public.questions add column if not exists misconceptions jsonb not null default '[]'::jsonb;

-- An array of objects, each with text for its option and label and one of the
-- two provenances. The length and wording rules are the server's.
alter table public.questions drop constraint if exists questions_misconceptions_check;
alter table public.questions
  add constraint questions_misconceptions_check check (
    jsonb_typeof(misconceptions) = 'array'
    and not jsonb_path_exists(misconceptions,
      '$[*] ? (@.type() != "object" || !exists(@.option) || !exists(@.label) || @.option.type() != "string"
               || @.label.type() != "string" || !(@.provenance == "ai" || @.provenance == "professor"))')
  );

comment on column public.questions.misconceptions is
  'Misconception labels on the question''s wrong options (0024): [{ option, label, provenance: ai|professor, addedAt, changedAt, by }]. Matched to answers by the option''s text. Staff-only; never sent to a phone or the projector; changes no mark.';
