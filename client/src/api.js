// Single origin in demo mode, Vite proxy in dev mode - either way '/api' works.

import { supabase } from './auth.js';

// Teacher-only routes are gated on a key the server prints at boot. The teacher
// opens the console via the printed URL, which carries ?key=...; we stash it and
// strip it back out of the address bar so it is not sitting on the projector.
// Students never have it and never need it.
const KEY_STORAGE = 'bloomloop.teacherKey';

const safeStorage = {
  get(k) {
    try {
      return window.localStorage.getItem(k) || '';
    } catch {
      return ''; // private mode / storage disabled
    }
  },
  set(k, v) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* nothing we can do; the in-memory copy below still covers this tab */
    }
  },
};

let memoryKey = '';

(function captureKeyFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  const key = url.searchParams.get('key');
  if (!key) return;
  memoryKey = key.trim();
  safeStorage.set(KEY_STORAGE, memoryKey);
  url.searchParams.delete('key');
  window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
})();

export const teacherKey = {
  get: () => memoryKey || safeStorage.get(KEY_STORAGE),
  set: (value) => {
    memoryKey = String(value ?? '').trim();
    safeStorage.set(KEY_STORAGE, memoryKey);
  },
};

// A real signed-in session, when there is one. The server prefers the bearer
// token and falls back to the teacher key, so sending both is safe and keeps the
// demo path alive on a build with no accounts configured.
async function bearer() {
  if (!supabase) return '';
  try {
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

async function req(path, options = {}) {
  const key = teacherKey.get();
  const headers = { ...(options.headers || {}) };
  if (key) headers['x-teacher-key'] = key;
  const token = await bearer();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { ...options, headers });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = res.statusText;
    if (ct.includes('application/json')) {
      message = (await res.json().catch(() => ({}))).error || message;
    }
    // Carried so the console can tell "you are not unlocked" apart from a
    // genuine failure and show the unlock panel instead of a red error.
    throw Object.assign(new Error(message), { status: res.status });
  }
  return ct.includes('application/json') ? res.json() : res.text();
}

const json = (method) => (path, body) =>
  req(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
  regenerateQuestion: (id) => json('POST')(`/bank/question/${id}/regenerate`),

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
  createSession: (contentId, title) => json('POST')('/session', { contentId, title }),
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
  deleteSession: (code, confirm) =>
    req(`/session/${code}?confirm=${encodeURIComponent(confirm ?? '')}`, { method: 'DELETE' }),

  // F6
  // A plain <a href> download, so the key rides in the query string - a header
  // is not an option here. The server accepts either.
  exportUrl: (code) => {
    const key = teacherKey.get();
    return `/api/session/${code}/export${key ? `?key=${encodeURIComponent(key)}` : ''}`;
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
};
