// What a Get Ready check (services/hubGetReady.js) and a self-test
// (services/hubExam.js) share (Phase 6, decisions H9 and H10, 0028).
//
// A RUN is a stored row (hub_runs) holding what was fixed when it started, and
// its answers are ordinary hub attempts carrying its id, written through the
// practice loop's recordAttempt(), so they are marked and kept exactly as
// practice's are. A run belongs to the student who started it and to nobody
// else: anyone else asking for it, and an id that does not exist, get the same
// 404, word for word. Staff read Get Ready results through the class they may
// read (services/hubGetReady.js), never through a run's id.

import { isRecordId } from '../ids.js';
import { forStudent } from '../questionTypes.js';
import { phoneProvenance } from './honesty.js';
import { phoneRich } from './richText.js';
import { hubSeed } from './hubPractice.js';
import { languageChoice, localiseQuestion, servableTranslations, shownLanguage } from './hubLanguages.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

export const RUN_NOT_FOUND = Object.freeze({
  getready: 'That Get Ready check was not found.',
  exam: 'That self-test was not found.',
});

/** Said wherever a check or a self-test shows a question: neither offers hints (H10). */
export const NO_HINTS = Object.freeze({
  getready: { available: 0, note: 'No hints in a Get Ready check: it finds out what you already know.' },
  exam: { available: 0, note: 'No hints in a self-test.' },
});

const lower = (v) => String(v ?? '').trim().toLowerCase();

/** A client's run id, if it is a plausible one; '' otherwise (the same shape as an attempt id). */
export function cleanRunId(value) {
  const id = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(id) ? id : '';
}

/** FNV-1a: a stable order from a seed, so a reload shows the same thing and two runs differ. */
export function hashOf(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The student's own run of this kind, or the kind's one 404. */
export async function ownRun(repo, account, rawId, kind) {
  const id = String(rawId ?? '').trim();
  const run = isRecordId(id) ? await repo.getHubRun(id) : null;
  if (!run || run.kind !== kind || String(run.accountId) !== String(account?.id)) throw fail(RUN_NOT_FOUND[kind], 404);
  return run;
}

/**
 * Questions as the student is shown them, keyed by id in lower case: through
 * forStudent() with the hub's seed (no key, no rubric, no explanation), in an
 * approved and current translation of the student's language or English with a
 * plain note (H12), with the formulas and code rendered (H15) and who wrote it
 * in a student's words. The same rendering as the practice loop's.
 */
export async function shownQuestions(repo, account, questions = []) {
  const out = new Map();
  if (!questions.length) return out;
  const wanted = await languageChoice(repo, account);
  const translations = await servableTranslations(repo, { kind: 'question', items: questions, language: wanted });
  for (const q of questions) {
    const translation = translations.get(lower(q._id)) ?? null;
    const lang = shownLanguage({ kind: 'question', wanted, translation });
    const shown = localiseQuestion(q, forStudent(q, hubSeed(account.id, q._id)), translation);
    out.set(lower(q._id), {
      question: { ...shown, provenance: phoneProvenance(q), rich: await phoneRich(shown) },
      language: lang.language,
      translationId: lang.translationId,
      languageNote: lang.note,
    });
  }
  return out;
}

export const answersWord = (n) => `${n} answer${n === 1 ? '' : 's'}`;
export const questionsWord = (n) => `${n} question${n === 1 ? '' : 's'}`;
