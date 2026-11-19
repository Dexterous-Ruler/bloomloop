// Single origin in demo mode, Vite proxy in dev mode - either way '/api' works.

import { teacherKey } from './teacherKey.js';

// The key is captured from ?key= in its own module; it is re-exported here so
// every screen keeps importing it from one place.
export { teacherKey };

// A real signed-in session, when there is one. The server prefers the bearer
// token and falls back to the teacher key, so sending both is safe and keeps the
// demo path alive on a build with no accounts configured.
//
// auth.js is imported on first use, not at the top of this file: it carries the
// Supabase client, and nothing that only needs a teacher key - least of all a
// student's phone - should download that just for importing this module.
async function bearer() {
  try {
    const { supabase } = await import('./auth.js');
    if (!supabase) return '';
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || '';
  } catch {
    return ''; // never let a storage or refresh failure take out the whole call
  }
}

/**
 * Credentials for a Socket.io payload. A socket carries no headers, so the
 * teacher grid has to prove who it is inside the message itself — before this,
 * `teacher:watch` accepted anyone who knew the room code.
 */
export async function socketCredentials() {
  return { key: teacherKey.get() || undefined, token: (await bearer()) || undefined };
}

// One request with this browser's credentials, refused with the server's own
// sentence. Returns the raw response, for the one caller that needs its headers.
async function send(path, options = {}) {
  const key = teacherKey.get();
  const headers = { ...(options.headers || {}) };
  if (key) headers['x-teacher-key'] = key;
  const token = await bearer();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (!res.ok) {
    let message = res.statusText;
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      message = (await res.json().catch(() => ({}))).error || message;
    }
    // Carried so the console can tell "you are not unlocked" apart from a
    // genuine failure and show the unlock panel instead of a red error.
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res;
}

async function req(path, options = {}) {
  const res = await send(path, options);
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// The server names the file `attachment; filename="..."`.
function filenameFrom(disposition) {
  const match = /filename="?([^";]+)"?/i.exec(disposition || '');
  return match ? match[1].trim() : '';
}

const json = (method) => (path, body) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** `?a=1&b=2` from an object, leaving out empty values. */
function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

export const api = {
  health: () => req('/health'),

  // F1
  listContents: () => req('/content'),
  getContent: (id) => req(`/content/${id}`),
  uploadPptx: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return req('/content', { method: 'POST', body: fd });
  },
  uploadSyllabus: (title, text) => json('POST')('/content', { title, text }),
  updateTopics: (id, topics) => json('PATCH')(`/content/${id}`, { topics }),

  // F2. The teacher decides the size and shape of the bank, not the model:
  // presets -> preview (writes nothing) -> generate. `mode` defaults to
  // 'replace' server-side, and a plan over the confirm threshold comes back 409
  // until `confirm` is set, so a 900-question run can never happen by accident.
  generatePresets: () => req('/generate/presets'),
  generatePreview: (contentId, topics, plan) =>
    json('POST')('/generate/preview', { contentId, topics, plan }),
  generate: (contentId, topics, plan, opts = {}) =>
    json('POST')('/generate', {
      contentId,
      topics,
      plan,
      mode: opts.mode ?? 'replace',
      confirm: opts.confirm ?? false,
      // Sent up front so the console can poll progress while this call is still
      // open. A run that takes ninety seconds and reports nothing looks hung.
      runId: opts.runId,
    }),
  generateRun: (runId) => req(`/generate/run/${encodeURIComponent(runId)}`),
  getBank: (contentId) => req(`/bank/${contentId}`),
  discardQuestion: (id) => json('PATCH')(`/bank/question/${id}`, { status: 'discarded' }),
  restoreQuestion: (id) => json('PATCH')(`/bank/question/${id}`, { status: 'active' }),
  // With no direction: a same-level replacement, written as a draft, and the
  // old one discarded (`warnings` says so when the old one was in use).
  // 'harder' / 'easier': a new draft one level up or down; the original stays.
  regenerateQuestion: (id, direction) =>
    json('POST')(`/bank/question/${id}/regenerate`, direction ? { direction } : undefined),

  // Phase 2: the approval gate. Generated questions arrive as drafts, which no
  // room serves. None of these takes a body; each answers with the failed
  // checks so an approval never hides a flag.
  approveQuestion: (id) => json('POST')(`/bank/question/${encodeURIComponent(id)}/approve`),
  rejectQuestion: (id) => json('POST')(`/bank/question/${encodeURIComponent(id)}/reject`),
  approveAll: (contentId) => json('POST')(`/bank/${encodeURIComponent(contentId)}/approve-all`),
  // Write your own: created active, model null. A 400 carries the validator's sentence.
  createQuestion: (contentId, body) => json('POST')(`/bank/${encodeURIComponent(contentId)}/questions`, body),
  // One stimulus (or null to take it off) on many questions at once.
  bulkStimulus: (ids, stimulus) => json('POST')('/bank/bulk', { ids, action: 'stimulus', stimulus }),
  // Item statistics across every room run on this chapter.
  bankStats: (contentId) => req(`/bank/${encodeURIComponent(contentId)}/stats`),
  // An image for a stimulus: PNG, JPEG or WebP, at most 500 KB, with alt text.
  uploadMedia: (file, contentId, alt) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('contentId', contentId);
    fd.append('alt', alt);
    return req('/media', { method: 'POST', body: fd });
  },
  // An <img> sends no bearer token, so a console preview fetches the bytes with
  // this browser's credentials and shows them from a blob url. The caller
  // revokes the url when it is done with it.
  mediaBlobUrl: async (url) => {
    const path = String(url).replace(/^(https?:\/\/[^/]+)?\/api/, '');
    const res = await send(path);
    return URL.createObjectURL(await res.blob());
  },

  // The editor. `patch` is the whole question as the teacher left it — text,
  // level, kind and that kind's payload — because the server validates the
  // merged result as one item and a half-sent edit is a half-valid question.
  // A rejection comes back as the validator's own sentence and is shown as-is.
  editQuestion: (id, patch) => json('PATCH')(`/bank/question/${id}`, patch),
  splitQuestion: (id) => json('POST')(`/bank/question/${id}/split`),
  mergeQuestions: (ids) => json('POST')('/bank/merge', { ids }),
  // One action over a selection. Every id is authorized exactly as a single
  // edit is, and the answer names the ones it refused rather than failing all.
  bulkQuestions: (ids, action, bloom) => json('POST')('/bank/bulk', { ids, action, bloom }),

  // F4
  // settings: { masteryGoal, reattempts, redemption }; the server validates
  // each one and applies its own default to any left out.
  // `questionIds` (optional): approved ids of this chapter; the room serves
  // only those, fixed once it opens. Left out, it serves the whole approved bank.
  createSession: (contentId, title, settings = {}) => json('POST')('/session', { contentId, title, ...settings }),
  // Item statistics for one room.
  roomItems: (code) => req(`/session/${encodeURIComponent(code)}/items`),
  getSession: (code) => req(`/session/${code}`),
  getGrid: (code) => req(`/session/${code}/grid`),
  closeSession: (code) => json('POST')(`/session/${code}/close`),

  // The room manager. GET /session lists every room the caller may *see*, and
  // each row carries its own `canControl` — an HOD reads the department's rooms
  // and may act on none of them. That flag is the server's, not a guess made
  // here from the role.
  listSessions: () => req('/session'),
  pauseSession: (code) => json('POST')(`/session/${code}/pause`),
  resumeSession: (code) => json('POST')(`/session/${code}/resume`),
  // `confirm` is passed in rather than filled from `code`, because the whole
  // point of it is that a human typed the code back. Defaulting it here would
  // turn the server's safety catch into a formality.
  // Answers { ok, code, deletedProfiles, archive: { id, bytes, archivedAt } }:
  // the room is written to a JSON archive (under 1 MB) before it is deleted,
  // and nothing is deleted if that write fails or the room would not fit (413).
  deleteSession: (code, confirm) =>
    req(`/session/${code}?confirm=${encodeURIComponent(confirm ?? '')}`, { method: 'DELETE' }),
  // Deleted rooms the caller may read, newest first, without their data:
  // { archives: [{ _id, code, title, ownerId, archivedBy, archivedAt, bytes }], limitBytes }.
  listRoomArchives: () => req('/session/archives'),
  // One deleted room as its .json file, saved under the server's file name.
  downloadRoomArchive: async (id) => {
    const res = await send(`/session/archives/${encodeURIComponent(id)}`);
    const name = filenameFrom(res.headers.get('content-disposition')) || 'bloomloop-room-archive.json';
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  // F6
  // A plain <a href> download, so the key rides in the query string - a header
  // is not an option here. The server accepts either.
  //
  // Kept for old callers only: a link cannot carry a bearer token, so it fails
  // for a professor who signed in with an account. Use downloadExport.
  exportUrl: (code) => {
    const key = teacherKey.get();
    return `/api/session/${code}/export${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  },
  // The CSV, fetched with the same key and token every other call sends, then
  // handed to the browser as a file under the name the server gave it. A
  // refusal throws the server's sentence with its status, like every call here.
  downloadExport: async (code) => {
    const res = await send(`/session/${encodeURIComponent(code)}/export`);
    const name = filenameFrom(res.headers.get('content-disposition')) || `bloomloop-${String(code).toUpperCase()}.csv`;
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    // Not revoked at once: some browsers start reading the blob only after the
    // click has returned.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  // The full signal trail for one student. The answer carries its own `honesty`
  // caveat, which the console renders verbatim: the wording lives on the server
  // in one place precisely so that no screen can quietly drop it or reword it
  // into something that claims more than the signals support.
  integrity: (code, rollNo) => req(`/session/${code}/integrity/${encodeURIComponent(rollNo)}`),

  classroomStatus: () => req('/classroom/status'),
  // Fetched, not navigated to. A new tab pointed at /api/classroom/auth sends
  // neither the teacher key header nor a bearer token, so the server refused it
  // with "Teacher key required" however the teacher had signed in.
  classroomAuthUrl: () => req('/classroom/auth-url'),
  classroomCourses: () => req('/classroom/courses'),
  // Phase 7. The roster of one course, so a professor can invite their class
  // instead of typing forty roll numbers. Each student carries the Google userId
  // that rides onto the invite and then onto the account, plus `linked` - true
  // when somebody in this department already holds that id, which is the one
  // case where issuing an invite would produce a code nobody can redeem.
  classroomCourseStudents: (courseId) =>
    req(`/classroom/course/${encodeURIComponent(courseId)}/students`),
  classroomPost: (code, courseId) => json('POST')('/classroom/post', { code, courseId }),

  // Phase 7, the student's own half. A student links their personal Google
  // account so a posted mark lands on that exact Google user instead of on
  // whoever the roster matcher guessed from their name.
  //
  // Three routes, all gated on a signed-in account rather than a teacher key -
  // the entire point is that a student can do this themselves. The status answer
  // carries `purpose` and `optional`, the two sentences the screen renders
  // verbatim: they live on the server so a screen cannot reword what a student
  // is agreeing to into something that claims more than the flow does.
  googleLink: () => req('/classroom/link'),
  // Fetched rather than navigated to, same as the teacher's auth-url above: a
  // navigation carries no bearer token, and this route has to know who is asking.
  googleLinkUrl: () => req('/classroom/link/auth-url'),
  googleUnlink: () => req('/classroom/link', { method: 'DELETE' }),

  // Phase 3. One route, three shapes. There is deliberately no id to pass: the
  // role picks the shape and the token picks the rows, so a browser cannot ask
  // for somebody else's dashboard however it phrases the request.
  dashboard: () => req('/dashboard'),

  // Analytics. The list is shaped by the role - an HOD gets professors, a
  // professor gets students, a student gets themselves - and the id in the
  // second call is checked against that same list server-side. A subject outside
  // it answers 404, identically to one that does not exist, so this pair cannot
  // be walked to find out who else is in the database.
  analytics: () => req('/analytics'),
  analyticsFor: (id) => req(`/analytics/${encodeURIComponent(id)}`),

  // Phase 1: the evidence behind the numbers. Every list is paged; the review
  // queue by cursor (`before`), the others by offset. Empty params are left
  // out so the server's defaults apply.
  studentAnswers: (id, params = {}) => req(`/analytics/${encodeURIComponent(id)}/answers${query(params)}`),
  roomAnswers: (code, params = {}) => req(`/session/${encodeURIComponent(code)}/answers${query(params)}`),
  roomTopics: (code) => req(`/session/${encodeURIComponent(code)}/topics`),
  reviewQueue: (params = {}) => req(`/review${query(params)}`),
  reviewItem: (answerId) => req(`/review/${encodeURIComponent(answerId)}`),
  // decision: 'confirm' | 'override'; an override carries `correct` and/or
  // `score`. The note is shown to the student.
  review: (answerId, { decision, correct, score, note } = {}) =>
    json('POST')(`/review/${encodeURIComponent(answerId)}`, { decision, correct, score, note }),

  // Who may invite whom is decided from the caller's own role - an HOD gets a
  // professor, a professor gets a student - so `role` here is a statement of
  // intent that the server refuses if it disagrees, never a grant.
  //
  // `rollNo` is the only field on this body with teeth. `fullName` and `email`
  // are a label on the invite row; the account takes the name and address the
  // student types when they redeem it.
  //
  // `googleSub` is set only by the Classroom roster import, and only ever to a
  // userId that came back from Google in the same breath - never to anything a
  // person typed. The server refuses one that is already on an account, so a
  // duplicate import fails here rather than days later in a student's face.
  invite: (body) => json('POST')('/auth/invite', body),

  // A student's supports (accommodations). Only their own professor may read or
  // set them; anyone else gets the same 404 as a student who does not exist.
  // The GET also returns the server's list of supports, so the labels shown are
  // the server's and a support it does not know cannot be offered.
  studentAccommodations: (id) => req(`/auth/students/${encodeURIComponent(id)}/accommodations`),
  setStudentAccommodations: (id, accommodations) =>
    json('PUT')(`/auth/students/${encodeURIComponent(id)}/accommodations`, { accommodations }),
};
