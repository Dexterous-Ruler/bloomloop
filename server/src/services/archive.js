/**
 * A deleted room, kept as one small JSON document.
 *
 * Deleting a room removes its live rows (the session, every student's profile
 * and every stored answer) so the room stops appearing anywhere. What the
 * students actually answered is not thrown away with them: before anything is
 * deleted, the whole room is written here, and the delete only goes ahead once
 * that write has succeeded. The owner's rule (18 Nov 2026): "just save the room
 * and other data in the form of json format so it is less than even 1mb".
 *
 * Small, because it is evidence kept for good. What keeps it small:
 *
 *   tables     every list is { cols, rows }: field names once, then one array
 *              per record. A column with no value in any record is left out.
 *   questions  the question as the student saw it is stored once; an answer
 *              row points at it by position (`q`). A fewer-choices student's
 *              shorter list (`shownOptions`) differs per student, so it sits on
 *              the answer row and is put back into the snapshot on decode. Added
 *              after v1 shipped; an archive without the column had none.
 *   students   answer and history rows point at their student by position
 *              (`s`) instead of repeating the roll number.
 *   history    a history entry points at the answer it records (`a`), so the
 *              fields the two share are not stored twice.
 *   reviews    each professor decision from answer_reviews points at the answer
 *              it was made on (`a`). Added after v1 shipped; an archive without
 *              this table simply had no reviews, so the version is unchanged.
 *   attendance a room opened for a class (Phase 3, 0016) keeps its class's id on
 *              the room and every attendance mark, each with the roll number and
 *              the name its roster row held when the room was deleted (the roster
 *              lives on and may change), and the roll number the mark was made
 *              under (`markedRollNo`, 0021; null for a mark from before it or an
 *              archive from before it). Only in a class room's archive; any
 *              other has none, and an archive from before Phase 3 decodes with
 *              `classId: null` and no marks, so the version is unchanged.
 *   records    the room's teacher records (Phase 3, 0017): every observation
 *              event (sets and clears, the log included), wheel round and pick,
 *              raised-hands tally, activity and insight action, each table only
 *              when the room has any. A roster student's name is copied in, as
 *              for attendance. An archive without them had none, so the version
 *              is unchanged. They count towards the 1 MiB like everything else.
 *   class      the room's class questions (Phase 5, 0023), each with where it
 *   questions  ended, whether its key was revealed and its times, pointing at
 *              the question as it was asked by position (`q`), like an answer.
 *              Their votes are answer rows like any other, each keeping its
 *              class question's id and its round, and every one of them is kept:
 *              changed votes and late ones included. Only when the room has
 *              any; an archive without the table had none, so the version is
 *              unchanged.
 *   times      milliseconds after `timeBase`, not ISO strings.
 *
 * Not archived with a room: course outcomes and their mappings (Phase 4, 0019).
 * They belong to the class and outlive any one room, and no answer stores an
 * outcome: an answer is traced to its outcomes when a report runs, from the
 * question id, chapter and topic it already carries (services/outcomes.js). So
 * deleting a room leaves the class's outcomes as they were, and an archived
 * answer can still be traced, from those same fields, against them.
 *
 * Figures (Batch 8): a question snapshot keeps its figure's spec, and `figures`
 * keeps each figure drawn as the phones saw it ({ type, title, svg, description,
 * table }), by the hash of its spec, so the archive shows the picture without
 * the server that drew it. Only when it fits the 1 MiB; otherwise
 * `figuresLeftOut` counts them, and each can be drawn again from its spec. An
 * archive without either had no figures, so the version is unchanged.
 *
 * Drawings (Batch 9, E4): a whiteboard answer's row keeps its response as it was
 * given, { mediaId, text }, and nothing else of the picture. The picture's bytes
 * are not copied in: a room of drawings would pass the 1 MiB on its own, and
 * deleting the room deletes its drawings with it. `drawings` then says how many
 * answers named one and that their pictures are not kept here (DRAWINGS_NOTE).
 * Only when the room has any; an archive without it had none, so the version is
 * unchanged.
 *
 * A field is only ever left out of a table as a whole column, and only when
 * every row rebuilds it exactly from what it points at; `derived` lists those
 * columns. So decodeRoomArchive() never guesses row by row, and gives back
 * every profile, history entry and answer as it was.
 */

import { sessionSettings } from './mastery.js';
import { minorRolls } from './roster.js';
import { figureForStudent, specHash, normaliseSpec } from '../figures/index.js';

/** What an archive says about its drawings (Batch 9): the references are kept, the pictures are not. */
export const DRAWINGS_NOTE = 'The answers that are drawings keep the id of their picture and the student\'s words. '
  + 'The pictures themselves are not in this archive (each one is up to 400 KB, and the archive holds at most 1 MiB), '
  + 'and they were deleted with the room.';
/** The same, in a copy of a room that still exists (laptop mode's files): its pictures were not deleted. */
export const DRAWINGS_KEPT_NOTE = 'The answers that are drawings keep the id of their picture and the student\'s words. '
  + 'The pictures themselves are not in this file (each one is up to 400 KB, and the file holds at most 1 MiB); they '
  + 'stay with the server that ran the room.';

/**
 * The figures in a room's question snapshots, drawn as a phone was shown them,
 * by the hash of their spec: { [hash]: { type, title, svg, description, table } }.
 */
function figuresOf(questions) {
  const out = {};
  for (const q of questions) {
    if (q?.stimulus?.kind !== 'figure') continue;
    const { spec } = normaliseSpec(q.stimulus.spec);
    if (!spec) continue;
    const hash = specHash(spec);
    if (out[hash]) continue;
    const { kind: _k, ...shown } = figureForStudent(spec);
    if (shown.svg) out[hash] = shown;
  }
  return out;
}

export const ARCHIVE_FORMAT = 'bloomloop.room-archive';
export const ARCHIVE_VERSION = 1;
/** The owner's ceiling. A room that would not fit is refused, never trimmed. */
export const ARCHIVE_LIMIT_BYTES = 1024 * 1024;

const PAGE = 1000;

// deviceAnsweredAt (0030, Phase 7): the phone's own time, kept as an offset like
// the rest; empty on every answer that did not wait on a phone, so absent then.
const ANSWER_TIMES = ['servedAt', 'answeredAt', 'reviewedAt', 'deviceAnsweredAt'];
const HISTORY_TIMES = ['at'];
const REVIEW_TIMES = ['reviewedAt'];
const ATTENDANCE_TIMES = ['markedAt'];
const CLASS_TIMES = ['startedAt', 'pausedAt', 'revoteAt', 'closedAt'];
const TIME_FIELDS = new Set([...ANSWER_TIMES, ...HISTORY_TIMES, ...REVIEW_TIMES, ...ATTENDANCE_TIMES]);

// The teacher-record tables (0017): the repo read behind each, and its times.
// Only times move to offsets; an observation's `day` is a date and stays one.
const RECORDS = {
  observations: { read: (repo, id) => repo.listObservations({ sessionId: id }), times: ['observedAt'] },
  wheelRounds: { read: (repo, id) => repo.listWheelRounds(id), times: ['startedAt'] },
  wheelPicks: { read: (repo, id) => repo.listWheelPicks(id), times: ['pickedAt', 'statusAt'] },
  tallies: { read: (repo, id) => repo.listTallies(id), times: ['createdAt', 'updatedAt'] },
  activities: { read: (repo, id) => repo.listActivities(id), times: ['createdAt', 'updatedAt'] },
  insightActions: { read: (repo, id) => repo.listInsightActions(id), times: ['actedAt'] },
};

// What an answer row can rebuild from the question it points at.
const FROM_QUESTION = {
  questionId: (snap) => snap.id,
  topic: (snap) => snap.topic ?? '',
  bloom: (snap) => snap.bloom,
  kind: (snap) => snap.kind ?? 'mcq',
};

// What a history entry can rebuild from the answer it points at.
const FROM_ANSWER = {
  questionId: (a) => a.questionId,
  bloom: (a) => a.bloom,
  topic: (a) => a.topic,
  kind: (a) => a.kind,
  answerId: (a) => a.answerKey,
  correct: (a) => a.correct,
  score: (a) => a.score,
  at: (a) => a.answeredAt,
};

const blank = (v) => v === undefined || v === null || v === '';

/** Equal for the archive's purpose: times by the instant, the rest exactly. */
function same(field, a, b) {
  if (TIME_FIELDS.has(field) && typeof a === 'string' && typeof b === 'string') {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb;
  }
  return a === b;
}

/** Objects to { cols, rows }. Columns empty in every record are dropped. */
export function toTable(objects) {
  const seen = new Set();
  const cols = [];
  for (const o of objects) {
    for (const k of Object.keys(o ?? {})) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  const used = cols.filter((c) => objects.some((o) => !blank(o?.[c])));
  return { cols: used, rows: objects.map((o) => used.map((c) => (o?.[c] === undefined ? null : o[c]))) };
}

/** { cols, rows } back to objects. */
export function fromTable(table) {
  const cols = table?.cols ?? [];
  return (table?.rows ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

/**
 * Drop each column in `rules` that every row rebuilds exactly from `source(row)`.
 * Returns the names dropped. A row with no source keeps the column for all.
 */
function dropDerivable(rows, rules, source) {
  const dropped = [];
  for (const [field, rebuild] of Object.entries(rules)) {
    const all = rows.every((r) => {
      const from = source(r);
      return from !== undefined && from !== null && same(field, r[field], rebuild(from));
    });
    if (all && rows.length) {
      for (const r of rows) delete r[field];
      dropped.push(field);
    }
  }
  return dropped;
}

function toOffset(value, base) {
  if (blank(value)) return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t - base : value;
}

function fromOffset(value, base) {
  return typeof value === 'number' ? new Date(base + value).toISOString() : value;
}

const withTimes = (record, fields, fn) => {
  const out = { ...record };
  for (const f of fields) if (f in out) out[f] = fn(out[f]);
  return out;
};

/**
 * How the room ran (0018): mode, adapt, start level, questions per student and
 * time per question, each only where the room changed it from how every room
 * ran before. A room left on those defaults archives exactly as it did before
 * the settings existed, and an archive without a field ran on its default
 * (sessionSettings in services/mastery.js reads one back that way).
 */
function changedRoomOptions(session) {
  const now = sessionSettings(session);
  const before = sessionSettings({});
  const out = {};
  for (const key of ['mode', 'adapt', 'startLevel', 'questionsPerStudent', 'timePerQuestion']) {
    if (now[key] !== before[key]) out[key] = now[key];
  }
  return out;
}

async function allAnswers(repo, sessionId) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await repo.listAnswers({ sessionId, limit: PAGE, offset });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/**
 * Read everything recorded in a room and encode it.
 *
 * @returns {{ doc, json, bytes }} doc is what the repository stores (metadata
 *   plus `data`, the archive object); json is `data` as it will be served.
 */
export async function buildRoomArchive(repo, session, { archivedBy = null, now = new Date(), deleting = true } = {}) {
  const sessionId = session._id;
  const [profiles, answers, reviews, marks, roster, classQuestions, ...recordLists] = await Promise.all([
    repo.listProfiles(sessionId),
    allAnswers(repo, sessionId),
    repo.listAnswerReviews({ sessionId }),
    session.classId ? repo.listAttendance(sessionId) : [],
    session.classId ? repo.listClassStudents(session.classId) : [],
    repo.listClassQuestions(sessionId),
    ...Object.values(RECORDS).map((r) => r.read(repo, sessionId)),
  ]);

  const started = Date.parse(session.startedAt);
  const timeBase = Number.isFinite(started) ? started : now.getTime();

  // ------------------------------------------------------------ questions --
  const snapIndex = new Map();
  const questions = [];
  const snapOf = (snapshot) => {
    const key = JSON.stringify(snapshot ?? {});
    if (!snapIndex.has(key)) { snapIndex.set(key, questions.length); questions.push(snapshot ?? {}); }
    return snapIndex.get(key);
  };

  // A room from before the evidence store has history but no answer rows; its
  // questions come from the bank, so the archive still says what was asked.
  const answered = new Set(answers.map((a) => String(a.questionId)));
  const historyOnly = new Set();
  for (const p of profiles) {
    for (const h of p.history ?? []) {
      if (h.questionId && !answered.has(String(h.questionId))) historyOnly.add(String(h.questionId));
    }
  }
  if (historyOnly.size && session.contentId) {
    const bank = await repo.listQuestions(session.contentId, { includeDiscarded: true });
    for (const q of bank) {
      if (historyOnly.has(String(q._id))) {
        const { _id, contentId, createdAt, status, ...rest } = q;
        snapOf({ id: String(_id), ...rest });
      }
    }
  }

  // ------------------------------------------------------ class questions --
  // Not kept: the session id (the archive's own). The row id is: every vote
  // names its class question by it. The question as asked goes in `questions`.
  const classRows = classQuestions.map(({ _id, sessionId: _s, questionSnapshot, ...rest }) => withTimes({
    id: String(_id),
    ...rest,
    q: snapOf(questionSnapshot ?? {}),
  }, CLASS_TIMES, (v) => toOffset(v, timeBase)));

  // ------------------------------------------------------------- students --
  const studentIndex = new Map(profiles.map((p, i) => [String(p.rollNo), i]));
  // Decision 8: a student their class roster marks under 18 leaves no signal in
  // the archive either, even one recorded before the mark was set.
  const minors = minorRolls(roster, marks);
  // The log of what each phone was given (servedLog, Phase 7) is left out: it
  // decides only whether an answer arriving after the close counts, and no
  // answer can reach a room once it is archived; kept, it would fill the 1 MB
  // an archive may be for nothing.
  const studentRows = profiles.map(({ _id, sessionId: _s, history, servedLog: _log, ...rest }) => (
    minors.has(String(rest.rollNo)) ? { ...rest, integrity: [] } : rest));

  // -------------------------------------------------------------- answers --
  // Not kept: the row id and session id (the archive's own), the account id
  // (on the student's row) and the content id (on the room).
  const answerRows = answers.map((a) => {
    const { _id, sessionId: _s, accountId, contentId, questionSnapshot, ...rest } = a;
    // Which options a fewer-choices student was left with is theirs, not the
    // question's, and differs per student: left in the snapshot it made one
    // copy of the question per such student. Kept on the answer row instead.
    const { shownOptions, ...asked } = questionSnapshot ?? {};
    const s = studentIndex.get(String(a.rollNo));
    return { ...rest, q: snapOf(asked), ...(shownOptions ? { shownOptions } : {}), ...(s === undefined ? {} : { s }) };
  });
  const answerDerived = [
    ...dropDerivable(answerRows, FROM_QUESTION, (r) => questions[r.q]),
    ...dropDerivable(answerRows, { rollNo: (st) => st.rollNo }, (r) => profiles[r.s]),
  ];

  // -------------------------------------------------------------- history --
  // The final attempt is the one a history entry records.
  const byKey = new Map();
  answers.forEach((a, i) => { if (a.final !== false) byKey.set(a.answerKey, i); });
  const historyRows = [];
  for (const p of profiles) {
    for (const h of p.history ?? []) {
      const a = h.answerId ? byKey.get(h.answerId) : undefined;
      historyRows.push({ ...h, rollNo: p.rollNo, s: studentIndex.get(String(p.rollNo)), ...(a === undefined ? {} : { a }) });
    }
  }
  const historyDerived = [
    ...dropDerivable(historyRows, FROM_ANSWER, (r) => (r.a === undefined ? undefined : answers[r.a])),
    ...dropDerivable(historyRows, { rollNo: (st) => st.rollNo }, (r) => profiles[r.s]),
  ];

  // -------------------------------------------------------------- reviews --
  // Every professor decision, oldest first. The answer row already carries the
  // decision in force; these keep the ones before it. Not kept: the row id and
  // session id (the archive's own), and the answer id, replaced by its position.
  const answerIndex = new Map(answers.map((a, i) => [String(a._id), i]));
  const reviewRows = reviews.map(({ _id, sessionId: _s, answerId, ...rest }) => ({
    ...rest,
    a: answerIndex.get(String(answerId)) ?? null,
  }));

  // ----------------------------------------------------------- attendance --
  // Not kept: the row id and session id (the archive's own). The roster row's
  // roll number and name are copied in, since it outlives the room and may be
  // corrected later; its id stays, so a mark can still be traced to it. The
  // roll number the mark itself was made under (0021) is `markedRollNo`, so the
  // room's answers, given under it, can still be tied to the student.
  const onRoster = new Map(roster.map((s) => [String(s._id), s]));
  const attendanceRows = marks.map(({ _id, sessionId: _s, rollNo: markedRollNo, ...rest }) => ({
    ...rest,
    rollNo: onRoster.get(String(rest.classStudentId))?.rollNo ?? null,
    name: onRoster.get(String(rest.classStudentId))?.name ?? null,
    markedRollNo: markedRollNo ?? null,
  }));

  // ------------------------------------------------------ teacher records --
  // Not kept: the session id (the archive's own). The row id is: a quick check
  // names its tally by it. A roster student's name is copied in, since the
  // roster outlives the room; the row's own roll number is the one at the time.
  const recordTables = {};
  Object.keys(RECORDS).forEach((name, i) => {
    const rows = recordLists[i] ?? [];
    if (!rows.length) return;
    recordTables[name] = toTable(rows.map(({ _id, sessionId: _s, ...rest }) => withTimes({
      id: String(_id),
      ...rest,
      ...(rest.classStudentId ? { name: onRoster.get(String(rest.classStudentId))?.name ?? null } : {}),
    }, RECORDS[name].times, (v) => toOffset(v, timeBase))));
  });

  const data = {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    archivedAt: now.toISOString(),
    archivedBy,
    timeBase: new Date(timeBase).toISOString(),
    room: {
      id: String(sessionId),
      code: session.code,
      title: session.title ?? '',
      contentId: session.contentId ? String(session.contentId) : null,
      ownerId: session.ownerId ?? null,
      status: session.status,
      startedAt: session.startedAt ?? null,
      pausedAt: session.pausedAt ?? null,
      closedAt: session.closedAt ?? null,
      settings: {
        masteryGoal: session.masteryGoal,
        reattempts: session.reattempts,
        redemption: session.redemption,
        ...changedRoomOptions(session),
      },
      // The question set (0015), null for the whole bank: what the room could serve.
      questionIds: session.questionIds ?? null,
      // The class the room was opened for (0016). Only when it has one, so a
      // room opened for no class archives byte for byte as before 0016;
      // decodeRoomArchive reads a missing classId as null.
      ...(session.classId ? { classId: String(session.classId) } : {}),
    },
    counts: {
      students: profiles.length,
      answers: answers.length,
      history: historyRows.length,
      reviews: reviews.length,
      ...(session.classId ? { attendance: attendanceRows.length } : {}),
      ...Object.fromEntries(Object.entries(recordTables).map(([name, t]) => [name, t.rows.length])),
      ...(classRows.length ? { classQuestions: classRows.length } : {}),
    },
    derived: { answers: answerDerived, history: historyDerived },
    questions,
    students: toTable(studentRows),
    history: toTable(historyRows.map((h) => withTimes(h, HISTORY_TIMES, (v) => toOffset(v, timeBase)))),
    answers: toTable(answerRows.map((a) => withTimes(a, ANSWER_TIMES, (v) => toOffset(v, timeBase)))),
    reviews: toTable(reviewRows.map((r) => withTimes(r, REVIEW_TIMES, (v) => toOffset(v, timeBase)))),
    ...(session.classId
      ? { attendance: toTable(attendanceRows.map((m) => withTimes(m, ATTENDANCE_TIMES, (v) => toOffset(v, timeBase)))) }
      : {}),
    ...recordTables,
    ...(classRows.length ? { classQuestions: toTable(classRows) } : {}),
  };

  // Batch 9: the room's drawing answers keep { mediaId, text } and no bytes; the
  // archive says so, and how many there are.
  const drawingAnswers = answers.filter((a) => a?.kind === 'drawing' && typeof a?.response?.mediaId === 'string').length;
  // The note says what happened to the pictures: deleted with the room, or, in
  // a copy of a room that still runs (laptop mode), still where the room is.
  if (drawingAnswers) data.drawings = { answers: drawingAnswers, picturesKept: false, note: deleting ? DRAWINGS_NOTE : DRAWINGS_KEPT_NOTE };

  // Batch 8: each figure the room's questions showed, drawn once as the phones
  // saw it, keyed by its spec's hash (the snapshot keeps the spec itself). Only
  // when it fits: the 1 MiB is for evidence first, and a figure left out can be
  // drawn again from its spec, so the archive then says how many were left out.
  const drawn = figuresOf(questions);
  let json = JSON.stringify(data);
  if (Object.keys(drawn).length) {
    const withFigures = JSON.stringify({ ...data, figures: drawn });
    if (Buffer.byteLength(withFigures, 'utf8') <= ARCHIVE_LIMIT_BYTES) {
      data.figures = drawn;
      json = withFigures;
    } else {
      data.figuresLeftOut = Object.keys(drawn).length;
      json = JSON.stringify(data);
    }
  }
  const bytes = Buffer.byteLength(json, 'utf8');
  return {
    json,
    bytes,
    doc: {
      sessionId: String(sessionId),
      code: session.code,
      title: session.title ?? '',
      ownerId: session.ownerId ?? null,
      archivedBy,
      archivedAt: data.archivedAt,
      bytes,
      data,
    },
  };
}

/**
 * An archive as it is served (decision 8): no integrity signal of a student the
 * class's roster marks under 18 NOW. buildRoomArchive leaves out the signals of
 * a student marked when the room is deleted; a student marked afterwards, or an
 * archive written before 0022, still held theirs. Read from the roster as it
 * stands and the archive's own attendance marks (the roll number each was made
 * under, and the roster's at the time), as minorRolls reads a live room. The
 * stored archive is not rewritten: what was recorded stays recorded, and is
 * shown nowhere.
 */
export function servedArchive(data, roster = []) {
  const table = data?.students;
  if (!data?.room?.classId || !table?.cols) return data;
  const marks = fromTable(data.attendance).flatMap((m) => [
    { rollNo: m.markedRollNo, classStudentId: m.classStudentId },
    { rollNo: m.rollNo, classStudentId: m.classStudentId },
  ]);
  const minors = minorRolls(roster, marks);
  const roll = table.cols.indexOf('rollNo');
  const signals = table.cols.indexOf('integrity');
  if (!minors.size || roll < 0 || signals < 0) return data;
  return {
    ...data,
    students: {
      ...table,
      rows: table.rows.map((r) => (minors.has(String(r[roll])) ? r.map((v, i) => (i === signals ? [] : v)) : r)),
    },
  };
}

/** The archive back to plain records: what the room held when it was deleted. */
export function decodeRoomArchive(data) {
  const base = Date.parse(data.timeBase);
  const questions = data.questions ?? [];
  const derivedAnswers = new Set(data.derived?.answers ?? []);
  const derivedHistory = new Set(data.derived?.history ?? []);
  const studentList = fromTable(data.students);

  const answers = fromTable(data.answers).map((row) => {
    const { q, s, shownOptions, ...rest } = withTimes(row, ANSWER_TIMES, (v) => fromOffset(v, base));
    const snap = questions[q] ?? {};
    const out = { ...rest };
    for (const [field, rebuild] of Object.entries(FROM_QUESTION)) {
      if (derivedAnswers.has(field)) out[field] = rebuild(snap);
    }
    if (derivedAnswers.has('rollNo')) out.rollNo = studentList[s]?.rollNo;
    // Back where the live loop wrote it. An archive from before this column, or
    // a student shown the full list, has none.
    out.questionSnapshot = Array.isArray(shownOptions) ? { ...snap, shownOptions } : snap;
    return out;
  });

  const history = fromTable(data.history).map((row) => {
    const { a, s, ...rest } = withTimes(row, HISTORY_TIMES, (v) => fromOffset(v, base));
    const out = { ...rest };
    const from = a === null || a === undefined ? null : answers[a];
    for (const [field, rebuild] of Object.entries(FROM_ANSWER)) {
      if (derivedHistory.has(field) && from) out[field] = rebuild(from);
    }
    if (derivedHistory.has('rollNo')) out.rollNo = studentList[s]?.rollNo;
    return out;
  });

  const students = studentList.map((st) => ({
    ...st,
    history: history.filter((h) => h.rollNo === st.rollNo).map(({ rollNo, ...h }) => h),
  }));

  // An archive written before reviews existed has no table: no reviews.
  // answerKey is the answer's handle here, since archived answers keep no id.
  const reviews = fromTable(data.reviews).map((row) => {
    const { a, ...rest } = withTimes(row, REVIEW_TIMES, (v) => fromOffset(v, base));
    return { ...rest, answerKey: answers[a]?.answerKey ?? null };
  });

  // A room opened for no class, or archived before Phase 3, has no marks. A
  // mark archived before 0021, or made before it, has no markedRollNo: null.
  const attendance = fromTable(data.attendance).map((row) => ({
    ...withTimes(row, ATTENDANCE_TIMES, (v) => fromOffset(v, base)), markedRollNo: row.markedRollNo ?? null,
  }));
  // A room with no teacher records, or archived before them, has empty lists.
  const records = Object.fromEntries(Object.entries(RECORDS).map(([name, { times }]) => [
    name,
    fromTable(data[name]).map((row) => withTimes(row, times, (v) => fromOffset(v, base))),
  ]));
  // A room with no class question, or archived before them, has none.
  const classQuestions = fromTable(data.classQuestions).map((row) => {
    const { q, ...rest } = withTimes(row, CLASS_TIMES, (v) => fromOffset(v, base));
    return { ...rest, questionSnapshot: questions[q] ?? {} };
  });
  return {
    room: { ...data.room, classId: data.room?.classId ?? null }, students, answers, reviews, attendance, ...records, classQuestions,
  };
}
