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
 *              row points at it by position (`q`).
 *   students   answer and history rows point at their student by position
 *              (`s`) instead of repeating the roll number.
 *   history    a history entry points at the answer it records (`a`), so the
 *              fields the two share are not stored twice.
 *   times      milliseconds after `timeBase`, not ISO strings.
 *
 * A field is only ever left out of a table as a whole column, and only when
 * every row rebuilds it exactly from what it points at; `derived` lists those
 * columns. So decodeRoomArchive() never guesses row by row, and gives back
 * every profile, history entry and answer as it was.
 */

export const ARCHIVE_FORMAT = 'bloomloop.room-archive';
export const ARCHIVE_VERSION = 1;
/** The owner's ceiling. A room that would not fit is refused, never trimmed. */
export const ARCHIVE_LIMIT_BYTES = 1024 * 1024;

const PAGE = 1000;

const ANSWER_TIMES = ['servedAt', 'answeredAt', 'reviewedAt'];
const HISTORY_TIMES = ['at'];
const TIME_FIELDS = new Set([...ANSWER_TIMES, ...HISTORY_TIMES]);

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
export async function buildRoomArchive(repo, session, { archivedBy = null, now = new Date() } = {}) {
  const sessionId = session._id;
  const [profiles, answers] = await Promise.all([repo.listProfiles(sessionId), allAnswers(repo, sessionId)]);

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

  // ------------------------------------------------------------- students --
  const studentIndex = new Map(profiles.map((p, i) => [String(p.rollNo), i]));
  const studentRows = profiles.map(({ _id, sessionId: _s, history, ...rest }) => rest);

  // -------------------------------------------------------------- answers --
  // Not kept: the row id and session id (the archive's own), the account id
  // (on the student's row) and the content id (on the room).
  const answerRows = answers.map((a) => {
    const { _id, sessionId: _s, accountId, contentId, questionSnapshot, ...rest } = a;
    const s = studentIndex.get(String(a.rollNo));
    return { ...rest, q: snapOf(questionSnapshot), ...(s === undefined ? {} : { s }) };
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
      },
    },
    counts: { students: profiles.length, answers: answers.length, history: historyRows.length },
    derived: { answers: answerDerived, history: historyDerived },
    questions,
    students: toTable(studentRows),
    history: toTable(historyRows.map((h) => withTimes(h, HISTORY_TIMES, (v) => toOffset(v, timeBase)))),
    answers: toTable(answerRows.map((a) => withTimes(a, ANSWER_TIMES, (v) => toOffset(v, timeBase)))),
  };

  const json = JSON.stringify(data);
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

/** The archive back to plain records: what the room held when it was deleted. */
export function decodeRoomArchive(data) {
  const base = Date.parse(data.timeBase);
  const questions = data.questions ?? [];
  const derivedAnswers = new Set(data.derived?.answers ?? []);
  const derivedHistory = new Set(data.derived?.history ?? []);
  const studentList = fromTable(data.students);

  const answers = fromTable(data.answers).map((row) => {
    const { q, s, ...rest } = withTimes(row, ANSWER_TIMES, (v) => fromOffset(v, base));
    const snap = questions[q] ?? {};
    const out = { ...rest };
    for (const [field, rebuild] of Object.entries(FROM_QUESTION)) {
      if (derivedAnswers.has(field)) out[field] = rebuild(snap);
    }
    if (derivedAnswers.has('rollNo')) out.rollNo = studentList[s]?.rollNo;
    out.questionSnapshot = snap;
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
  return { room: data.room, students, answers };
}
