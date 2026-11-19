/**
 * Every Learning Hub call, student and staff, in one place (docs/API.md,
 * "Phase 6: the Learning Hub"). Screens import `hub` or `staffHub` from here and
 * nothing else for data; replies come back exactly as the server sends them.
 *
 * Every call carries the signed-in account's bearer token (lib/api.js). A
 * student screen never calls /api/content, /api/classes or /api/bank.
 *
 * Errors: an Error with the server's sentence as `message`, plus `status` and
 * `body` (the parsed reply). Without Supabase every route is a 503 with its own
 * sentence; with no sign-in, a 401. Show the sentence as it comes.
 *
 * Answers go through pending.js: kept on the device until the server has
 * them (201, or 200 for a resend of the same id), resent with the same id.
 */

import { http } from '../lib/api.js';
import { sendKept } from './pending.js';

/** `?a=1&b=2` from an object, leaving out empty values. */
function query(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * An id made on this device: 8 to 64 of A-Z a-z 0-9 - _ (attemptId,
 * clientRunId, runId). crypto.randomUUID needs a secure context, which a
 * laptop on a LAN over http is not, hence the fallback.
 */
export function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* not a secure context */ }
  const bytes = new Uint8Array(16);
  try { globalThis.crypto.getRandomValues(bytes); } catch {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = encodeURIComponent;

/** A signed-in student's own hub. */
export const hub = {
  // Home, map and progress
  index: () => http.get('/hub'),
  home: () => http.get('/hub/home'),
  progress: () => http.get('/hub/progress'),
  klass: (classId) => http.get(`/hub/classes/${enc(classId)}`),
  chapter: (contentId) => http.get(`/hub/chapters/${enc(contentId)}`),
  topic: (topicId) => http.get(`/hub/topics/${enc(topicId)}`),

  // Language: the server keeps the choice and sends material in it.
  language: () => http.get('/hub/language'),
  setLanguage: (language) => http.put('/hub/language', { language }),

  // Practice and review sets. `topicIds` (an array) for a set across topics.
  nextPractice: ({ topicId, topicIds, mode } = {}) => http.get(`/hub/practice/next${query({ topicId, topicIds, mode })}`),
  /** { attemptId, questionId, topicId, response, mode, timeTakenMs?, shown? } */
  attempt: (body) => sendKept('/hub/practice/attempts', body),
  hintsOpened: ({ attemptId, questionId, topicId }) => http.get(`/hub/practice/hints${query({ attemptId, questionId, topicId })}`),
  /** { attemptId, questionId, topicId, mode, step } */
  hint: (body) => http.post('/hub/practice/hints', body),

  // Lessons
  lesson: (topicId) => http.get(`/hub/topics/${enc(topicId)}/lesson`),
  /** { attemptId, response, shown?, timeMs? } */
  lessonAttempt: (lessonId, questionId, body) =>
    sendKept(`/hub/lessons/${enc(lessonId)}/questions/${enc(questionId)}/attempts`, body),
  lessonHintsOpened: (lessonId, questionId, attemptId) =>
    http.get(`/hub/lessons/${enc(lessonId)}/questions/${enc(questionId)}/hints${query({ attemptId })}`),
  /** { attemptId, step } */
  lessonHint: (lessonId, questionId, body) =>
    http.post(`/hub/lessons/${enc(lessonId)}/questions/${enc(questionId)}/hints`, body),

  // Reviews, the error log, the week, goals
  reviewDue: () => http.get('/hub/review/due'),
  errors: ({ status, topicId } = {}) => http.get(`/hub/errors${query({ status, topicId })}`),
  consistency: ({ weeks } = {}) => http.get(`/hub/consistency${query({ weeks })}`),
  goals: () => http.get('/hub/goals'),
  /** { title?, examDate: 'YYYY-MM-DD', topicIds } */
  addGoal: (body) => http.post('/hub/goals', body),
  editGoal: (goalId, body) => http.patch(`/hub/goals/${enc(goalId)}`, body),
  removeGoal: (goalId) => http.del(`/hub/goals/${enc(goalId)}`),

  // Get Ready ("Skip what I know · short check")
  /** { clientRunId, targetTopicId }: keep the clientRunId, a resend is a 200 */
  readyStart: (body) => http.post('/hub/getready', body),
  readyChecks: ({ topicId } = {}) => http.get(`/hub/getready${query({ topicId })}`),
  readyCheck: (checkId) => http.get(`/hub/getready/${enc(checkId)}`),
  /** { attemptId, questionId, response, timeTakenMs?, shown? } */
  readyAnswer: (checkId, body) => sendKept(`/hub/getready/${enc(checkId)}/answers`, body),

  // Self-tests
  /** { clientRunId, topicIds, levels?, count?, timeLimitMinutes? } */
  examStart: (body) => http.post('/hub/exams', body),
  exams: () => http.get('/hub/exams'),
  exam: (examId) => http.get(`/hub/exams/${enc(examId)}`),
  /** { attemptId, questionId, response, timeTakenMs?, shown? }: every change is a new attemptId */
  examAnswer: (examId, body) => sendKept(`/hub/exams/${enc(examId)}/answers`, body),
  examSubmit: (examId) => http.post(`/hub/exams/${enc(examId)}/submit`, {}),
};

/** A professor's (and, read-only, an HOD's) side of the hub. */
export const staffHub = {
  // Classes, units, chapters (every write replies with the fresh `hub`)
  classes: () => http.get('/hub'),
  klass: (classId, { view } = {}) => http.get(`/hub/classes/${enc(classId)}${query({ view })}`),
  addUnit: (classId, name) => http.post(`/hub/classes/${enc(classId)}/units`, { name }),
  renameUnit: (classId, unitId, name) => http.patch(`/hub/classes/${enc(classId)}/units/${enc(unitId)}`, { name }),
  removeUnit: (classId, unitId) => http.del(`/hub/classes/${enc(classId)}/units/${enc(unitId)}`),
  orderUnits: (classId, unitIds) => http.put(`/hub/classes/${enc(classId)}/units/order`, { unitIds }),
  /** { unitId?: id | null, position?: integer >= 1 } */
  placeChapter: (classId, contentId, body) => http.put(`/hub/classes/${enc(classId)}/chapters/${enc(contentId)}`, body),
  removeChapter: (classId, contentId) => http.del(`/hub/classes/${enc(classId)}/chapters/${enc(contentId)}`),
  chapter: (contentId) => http.get(`/hub/chapters/${enc(contentId)}`),
  syncTopics: (contentId) => http.post(`/hub/chapters/${enc(contentId)}/topics/sync`, {}),
  topic: (topicId) => http.get(`/hub/topics/${enc(topicId)}`),

  // Prerequisite links
  links: ({ state, contentId } = {}) => http.get(`/hub/links${query({ state, contentId })}`),
  addLink: ({ prerequisiteId, topicId }) => http.post('/hub/links', { prerequisiteId, topicId }),
  setLink: (linkId, state) => http.patch(`/hub/links/${enc(linkId)}`, { state }),
  removeLink: (linkId) => http.del(`/hub/links/${enc(linkId)}`),
  /** { contentIds, runId } */
  proposeLinks: (body) => http.post('/hub/links/propose', body),
  linkRun: (runId) => http.get(`/hub/links/run/${enc(runId)}`),
  /** The staff member's own chapters (GET /api/content), for the link pickers. Staff only. */
  ownChapters: () => http.get('/content'),

  // Explanations
  explanations: (contentId) => http.get(`/hub/chapters/${enc(contentId)}/explanations`),
  writeExplanation: (questionId, text) => http.put(`/hub/questions/${enc(questionId)}/explanation`, { text }),
  approveExplanation: (questionId) => http.post(`/hub/questions/${enc(questionId)}/explanation/approve`, {}),
  removeExplanation: (questionId) => http.del(`/hub/questions/${enc(questionId)}/explanation`),
  /** { contentId } or { questionIds }, with runId */
  draftExplanations: (body) => http.post('/hub/explanations/generate', body),
  explanationRun: (runId) => http.get(`/hub/explanations/run/${enc(runId)}`),

  // Hints and option feedback
  hints: (contentId) => http.get(`/hub/chapters/${enc(contentId)}/hints`),
  questionHints: (questionId) => http.get(`/hub/questions/${enc(questionId)}/hints`),
  /** { text, slides? } */
  writeHint: (questionId, step, body) => http.put(`/hub/questions/${enc(questionId)}/hints/${step}`, body),
  removeHint: (questionId, step) => http.del(`/hub/questions/${enc(questionId)}/hints/${step}`),
  writeFeedback: (questionId, option, body) => http.put(`/hub/questions/${enc(questionId)}/feedback/${option}`, body),
  removeFeedback: (questionId, option) => http.del(`/hub/questions/${enc(questionId)}/feedback/${option}`),
  /** { steps?, options? } */
  approveHints: (questionId, body = {}) => http.post(`/hub/questions/${enc(questionId)}/hints/approve`, body),
  /** { questionIds?, runId? } */
  draftHints: (contentId, body = {}) => http.post(`/hub/chapters/${enc(contentId)}/hints/generate`, body),
  hintRun: (runId) => http.get(`/hub/hints/run/${enc(runId)}`),

  // Lessons
  lessons: (topicId) => http.get(`/hub/topics/${enc(topicId)}/lessons`),
  makeLesson: (topicId, body = {}) => http.post(`/hub/topics/${enc(topicId)}/lessons/generate`, body),
  lessonRun: (runId) => http.get(`/hub/lessons/run/${enc(runId)}`),
  lessonById: (lessonId) => http.get(`/hub/lessons/${enc(lessonId)}`),
  approveLesson: (lessonId) => http.post(`/hub/lessons/${enc(lessonId)}/approve`, {}),
  discardLesson: (lessonId) => http.post(`/hub/lessons/${enc(lessonId)}/discard`, {}),
  /** As a student would see it, in en, hi or mr. */
  previewLesson: (topicId, lang) => http.get(`/hub/topics/${enc(topicId)}/lesson${query({ lang })}`),

  // Translations
  translations: (contentId, { language } = {}) => http.get(`/hub/chapters/${enc(contentId)}/translations${query({ language })}`),
  /** { languages?, items? } */
  translate: (contentId, body = {}) => http.post(`/hub/chapters/${enc(contentId)}/translations/generate`, body),
  translationRun: (runId) => http.get(`/hub/translations/run/${enc(runId)}`),
  /** { itemKind, itemId, language, fields } */
  writeTranslation: (body) => http.post('/hub/translations', body),
  editTranslation: (translationId, fields) => http.patch(`/hub/translations/${enc(translationId)}`, { fields }),
  approveTranslation: (translationId, { confirmFlags } = {}) =>
    http.post(`/hub/translations/${enc(translationId)}/approve`, confirmFlags ? { confirmFlags: true } : {}),
  discardTranslation: (translationId) => http.post(`/hub/translations/${enc(translationId)}/discard`, {}),
  languages: (contentId) => http.get(`/hub/chapters/${enc(contentId)}/languages`),

  // Per class and per student (an HOD reads all of it)
  classProgress: (classId) => http.get(`/hub/classes/${enc(classId)}/progress`),
  classStates: (classId) => http.get(`/hub/classes/${enc(classId)}/states`),
  studentProgress: (classId, rosterId) => http.get(`/hub/classes/${enc(classId)}/students/${enc(rosterId)}/progress`),
  studentReady: (classId, rosterId) => http.get(`/hub/classes/${enc(classId)}/students/${enc(rosterId)}/getready`),
};

/**
 * Polls a background run (links, explanations, hints, lessons, translations)
 * until it is no longer running. `read` is one of the *Run calls above.
 * Resolves with the last `run`; `onTick` sees each one.
 */
export async function untilDone(read, runId, { every = 1500, onTick, signal } = {}) {
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('Stopped.'), { aborted: true });
    const { run } = await read(runId);
    onTick?.(run);
    if (!run || run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, every));
  }
}
