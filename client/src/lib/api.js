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

/** A response saved as a file, under the name the server gave it. */
async function saveResponse(res, fallback) {
  const name = filenameFrom(res.headers.get('content-disposition')) || fallback;
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
  return name;
}

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
    await saveResponse(res, 'bloomloop-room-archive.json');
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
    await saveResponse(res, `bloomloop-${String(code).toUpperCase()}.csv`);
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

  // ── Phase 3 ─────────────────────────────────────────────────────────────
  // Every route below is teacher-only. An HOD may read but gets 403 on each
  // write, so edit controls follow the reply's `canEdit` (classes) or
  // `canControl` (rooms), never the role. "Not yours" and "not there" are one
  // 404 sentence; screens show it as it comes.

  // Classes and rosters. A roster holds a roll number and a name, nothing else:
  // other fields are dropped by the server and named in `ignoredFields`.
  listClasses: () => req('/classes'),
  createClass: (body) => json('POST')('/classes', body),
  getClass: (id) => req(`/classes/${encodeURIComponent(id)}`),
  updateClass: (id, patch) => json('PATCH')(`/classes/${encodeURIComponent(id)}`, patch),
  // students: [{ roll, name }]. Answers { added, refused[{ index, roll, name, reason }], ignoredFields, note, size }.
  addStudents: (id, students) => json('POST')(`/classes/${encodeURIComponent(id)}/students`, { students }),
  // patch: { name } | { rollNo } | { active }. `active: true` restores a removed student.
  updateStudent: (id, studentId, patch) =>
    json('PATCH')(`/classes/${encodeURIComponent(id)}/students/${encodeURIComponent(studentId)}`, patch),
  // A soft removal: the row, answers and marks stay. Show the reply's message.
  removeStudent: (id, studentId) =>
    req(`/classes/${encodeURIComponent(id)}/students/${encodeURIComponent(studentId)}`, { method: 'DELETE' }),
  studentObservations: (id, studentId) =>
    req(`/classes/${encodeURIComponent(id)}/students/${encodeURIComponent(studentId)}/observations`),
  // last: 4 | 8.
  classAnalytics: (id, last = 4) => req(`/classes/${encodeURIComponent(id)}/analytics${query({ last })}`),

  // A waiting room (opened with `lobby: true`) starts here. 409s carry the reason.
  startSession: (code) => json('POST')(`/session/${encodeURIComponent(code)}/start`),

  // Attendance against the room's class. marks: [{ studentId, status }] with
  // status present | absent | late (a student nobody has marked reads back as
  // `unmarked`, which is not something to send); or { fromJoins: true }.
  attendance: (code) => req(`/session/${encodeURIComponent(code)}/attendance`),
  markAttendance: (code, body) => json('POST')(`/session/${encodeURIComponent(code)}/attendance`, body),

  // Teacher records: staff only, never on a phone or the projector.
  observations: (code) => req(`/session/${encodeURIComponent(code)}/observations`),
  // body: { studentId | rollNo, kind: understood|participated|revision|support|null, note? (≤280) }
  observe: (code, body) => json('POST')(`/session/${encodeURIComponent(code)}/observations`, body),

  // The wheel. The server draws; the screen only animates the pick it returns.
  wheel: (code) => req(`/session/${encodeURIComponent(code)}/wheel`),
  wheelSettings: (code, patch) => json('PATCH')(`/session/${encodeURIComponent(code)}/wheel`, patch),
  wheelDraw: (code) => json('POST')(`/session/${encodeURIComponent(code)}/wheel/draw`),
  wheelNewRound: (code) => json('POST')(`/session/${encodeURIComponent(code)}/wheel/rounds`),
  // patch: { ask: bank|diagram|demo, questionId, status: answered|passed|help|skipped|absent, markAttendance }
  wheelPick: (code, pickId, patch) =>
    json('PATCH')(`/session/${encodeURIComponent(code)}/wheel/picks/${encodeURIComponent(pickId)}`, patch),

  // The raised-hands tally. Its hands never go on the projector.
  tallies: (code) => req(`/session/${encodeURIComponent(code)}/tallies`),
  // body: { text | questionId, labels, correct }
  createTally: (code, body) => json('POST')(`/session/${encodeURIComponent(code)}/tallies`, body),
  updateTally: (code, tallyId, patch) =>
    json('PATCH')(`/session/${encodeURIComponent(code)}/tallies/${encodeURIComponent(tallyId)}`, patch),
  tallyUp: (code, tallyId, option) =>
    json('POST')(`/session/${encodeURIComponent(code)}/tallies/${encodeURIComponent(tallyId)}/increment`, { option }),
  // At 0 the reply is `clamped: true` and nothing changes.
  tallyDown: (code, tallyId, option) =>
    json('POST')(`/session/${encodeURIComponent(code)}/tallies/${encodeURIComponent(tallyId)}/decrement`, { option }),

  // The five no-device activities (check, think, group, diagram, real). A group
  // challenge records groups, never students.
  activities: (code) => req(`/session/${encodeURIComponent(code)}/activities`),
  createActivity: (code, body) => json('POST')(`/session/${encodeURIComponent(code)}/activities`, body),
  updateActivity: (code, activityId, patch) =>
    json('PATCH')(`/session/${encodeURIComponent(code)}/activities/${encodeURIComponent(activityId)}`, patch),

  // Live insights. `teacher:insights` pushes the same body over the socket.
  insights: (code) => req(`/session/${encodeURIComponent(code)}/insights`),
  insightActions: (code) => req(`/session/${encodeURIComponent(code)}/insights/actions`),
  // action: dismissed | acted. Append-only.
  insightAction: (code, flagId, action, note) =>
    json('POST')(`/session/${encodeURIComponent(code)}/insights/actions`, { flagId, action, note }),
  studentCard: (code, roll) =>
    req(`/session/${encodeURIComponent(code)}/students/${encodeURIComponent(roll)}/card`),

  // The projector. A link's token is in the create reply only: it goes straight
  // into the projector page's URL hash and is never stored or logged.
  projector: (code) => req(`/session/${encodeURIComponent(code)}/projector`),
  // patch: { mode, question, revealed, diagram, showNames, pick }. The reply's
  // `shows` is exactly what the wall gets.
  setProjector: (code, patch) => json('PATCH')(`/session/${encodeURIComponent(code)}/projector`, patch),
  createProjectorLink: (code) => json('POST')(`/session/${encodeURIComponent(code)}/projector/links`),
  revokeProjectorLink: (code, linkId) =>
    req(`/session/${encodeURIComponent(code)}/projector/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' }),

  // -- Phase 5 ---------------------------------------------------------------
  // Class questions (pause, discuss, re-vote) and confidence taps. Staff only.
  // Every body is counts: no roll number or name. Writes are the room owner's
  // (an HOD reads and gets 403). `teacher:class-question` pushes the same body.

  // { room, kinds, running, classQuestions: [...], confidenceChoices, note }
  classQuestions: (code) => req(`/session/${encodeURIComponent(code)}/class-questions`),
  classQuestion: (code, id) =>
    req(`/session/${encodeURIComponent(code)}/class-questions/${encodeURIComponent(id)}`),
  // An approved mcq, truefalse, poll or multi question of the room. 201.
  askClass: (code, questionId) => json('POST')(`/session/${encodeURIComponent(code)}/class-questions`, { questionId }),
  pauseClassQuestion: (code, id) =>
    json('POST')(`/session/${encodeURIComponent(code)}/class-questions/${encodeURIComponent(id)}/pause`),
  revoteClassQuestion: (code, id) =>
    json('POST')(`/session/${encodeURIComponent(code)}/class-questions/${encodeURIComponent(id)}/revote`),
  // reveal: true shows the key (never on a poll).
  closeClassQuestion: (code, id, reveal = false) =>
    json('POST')(`/session/${encodeURIComponent(code)}/class-questions/${encodeURIComponent(id)}/close`, { reveal }),
  // The room's confidence taps, by tap and by right and wrong. Counts only.
  roomConfidence: (code) => req(`/session/${encodeURIComponent(code)}/confidence`),

  // Misconception labels on wrong options (mcq, multi, truefalse). Staff only;
  // never sent to a phone or the projector. Counts only, never names.
  // A question's labels, which options take one, canEdit, and its counts.
  questionMisconceptions: (id) => req(`/bank/question/${encodeURIComponent(id)}/misconceptions`),
  // changes: [{ option, label } | { option, label: null } | { option, confirm: true }],
  // option = the option's index as the question stands. All or nothing; the
  // question's status is untouched (no re-approval).
  setMisconceptions: (id, changes) =>
    json('PATCH')(`/bank/question/${encodeURIComponent(id)}/misconceptions`, { misconceptions: changes }),
  roomMisconceptions: (code) => req(`/session/${encodeURIComponent(code)}/misconceptions`),
  // params: { from, to, rooms } as the attainment reports (windowParams).
  classMisconceptions: (id, params = {}) => req(`/classes/${encodeURIComponent(id)}/misconceptions${query(params)}`),

  // -- Phase 4 ---------------------------------------------------------------
  // Course outcomes, attainment, the marks register and their files. Staff
  // only: nothing here is called from /join, the projector or the wall. Writes
  // follow the reply's `canEdit` (an HOD reads only and gets 403).

  // Course outcomes. Every write answers the whole list again, with the one
  // written as `outcome`.
  outcomes: (id) => req(`/classes/${encodeURIComponent(id)}/outcomes`),
  // body: { code, statement, targetLevel? }
  createOutcome: (id, body) => json('POST')(`/classes/${encodeURIComponent(id)}/outcomes`, body),
  // patch: any of code, statement, targetLevel; { archived: false } restores.
  updateOutcome: (id, outcomeId, patch) =>
    json('PATCH')(`/classes/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}`, patch),
  // ids: every outcome in use, in the new order.
  reorderOutcomes: (id, ids) => json('POST')(`/classes/${encodeURIComponent(id)}/outcomes/reorder`, { ids }),
  // Archived when a counted answer reaches it, deleted otherwise: the reply's
  // `removed` says which, and its `message` is shown.
  removeOutcome: (id, outcomeId) =>
    req(`/classes/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}`, { method: 'DELETE' }),
  // topics: [{ contentId, topic, weight? }], the outcome's whole set.
  mapOutcomeTopics: (id, outcomeId, topics) =>
    json('PUT')(`/classes/${encodeURIComponent(id)}/outcomes/${encodeURIComponent(outcomeId)}/topics`, { topics }),
  // body: { outcomeIds } or { exclude: true }, for one question in this class.
  overrideQuestion: (id, questionId, body) =>
    json('PUT')(`/classes/${encodeURIComponent(id)}/outcomes/questions/${encodeURIComponent(questionId)}`, body),
  // The question follows its topic again.
  clearOverride: (id, questionId) =>
    req(`/classes/${encodeURIComponent(id)}/outcomes/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE' }),
  copyOutcomes: (id, fromClassId) => json('POST')(`/classes/${encodeURIComponent(id)}/outcomes/copy`, { fromClassId }),
  outcomeCoverage: (id) => req(`/classes/${encodeURIComponent(id)}/outcomes/coverage`),

  // A roster from a CSV file's text. With dryRun nothing is written and the
  // reply says what would be. Values in ignored columns are never echoed.
  // Sent as text/csv, not JSON: the app's JSON limit would refuse a large
  // file before the import route could answer with its own 1 MB sentence.
  importRoster: (id, csv, dryRun = false) =>
    req(`/classes/${encodeURIComponent(id)}/students/import${dryRun ? '?dryRun=true' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    }),

  // The attainment formula: example presets, and the class's formula in force.
  attainmentPresets: () => req('/attainment/presets'),
  attainmentConfig: (id) => req(`/classes/${encodeURIComponent(id)}/attainment/config`),
  // body: { preset }, { config } (only the fields named) or both. A 409 is a
  // version race: read again and retry.
  saveAttainmentConfig: (id, body) => json('PUT')(`/classes/${encodeURIComponent(id)}/attainment/config`, body),

  // The reports. params: { from, to, rooms } with dates as YYYY-MM-DD and
  // rooms as a comma-separated list of codes; empty ones are left out.
  attainment: (id, params = {}) => req(`/classes/${encodeURIComponent(id)}/attainment${query(params)}`),
  studentAttainment: (id, studentId, params = {}) =>
    req(`/classes/${encodeURIComponent(id)}/attainment/students/${encodeURIComponent(studentId)}${query(params)}`),
  register: (id, params = {}) => req(`/classes/${encodeURIComponent(id)}/register${query(params)}`),

  // Files. `path` is a report path above without /api, such as
  // `/classes/${id}/register`. Fetched with this browser's credentials in
  // headers, never as a link or with ?key= in a url: a link carries no token,
  // and a key in a url would be printed in a page's footer. File names come
  // from the server and carry no student name.
  //
  // A CSV, saved as a file. params as for the report, plus `sheet` on
  // /attainment ('bloom' for the Bloom sheet). Answers the file name.
  downloadCsv: async (path, params = {}) => {
    const res = await send(`${path}${query({ ...params, format: 'csv' })}`);
    return saveResponse(res, 'bloomloop-report.csv');
  },
  // A printable page, opened in a new tab from a blob url. The tab is opened
  // before the request (or the browser blocks it as a popup) and pointed at
  // the page when it arrives; the page runs no script of its own.
  openReport: async (path, params = {}) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const res = await send(`${path}${query({ ...params, format: 'html' })}`);
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      if (tab) tab.location.href = url; else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (err) {
      if (tab) tab.close();
      throw err;
    }
  },
};
