// Supabase / Postgres implementation of the repository interface.
//
// Run every file in supabase/migrations/, in order, before using this.
//
// Two translations happen here and nowhere else:
//   snake_case columns  <->  camelCase document fields
//   `id` (uuid)         <->  `_id` (what every caller above this layer reads)
// Everything above the repository keeps speaking the document shape from the
// project report section 5, so swapping the store changed no other file.
//
// Connects with the service role key, which bypasses row level security. The
// schema enables RLS with no policies, so this key is the only way in - which is
// exactly why it must never reach the client bundle.

import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { PAYLOAD_FIELDS } from '../questionTypes.js';

const fail = (op) => (error) => {
  throw new Error(`[supabase] ${op}: ${error.message ?? error}`);
};

/** Throw on a Postgres error, otherwise hand back the rows. */
// Every Supabase id is a uuid. isRecordId() above the repository also accepts a
// 24-character ObjectId (the in-process and Mongo stores' shape), and Postgres
// answers such an id with a cast error - a 500 for what is simply "not found".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id) => UUID_RE.test(String(id ?? '').trim());

function unwrap(op, { data, error }) {
  if (error) fail(op)(error);
  return data;
}

// ---------------------------------------------------------------- mappers --

const outContent = (r) =>
  r && {
    _id: r.id,
    title: r.title,
    kind: r.kind,
    rawText: r.raw_text ?? '',
    topics: Array.isArray(r.topics) ? r.topics : [],
    ownerId: r.owner_id ?? null,
    createdAt: r.created_at,
    topicSlides: r.topic_slides && typeof r.topic_slides === 'object' ? r.topic_slides : {},
    // 0025: each slide's own words, [{ slide, text }]; null before 0025 is
    // applied, for a deck uploaded before it, and for pasted text.
    slideTexts: Array.isArray(r.slide_texts) ? r.slide_texts : null,
  };

const inContent = (d) => ({
  title: d.title,
  kind: d.kind,
  raw_text: d.rawText ?? '',
  topics: Array.isArray(d.topics) ? d.topics : [],
  // null is meaningful: it marks a pre-accounts row, which only the legacy
  // teacher-key path may reach. See ownership.js.
  owner_id: d.ownerId ?? null,
  topic_slides: d.topicSlides && typeof d.topicSlides === 'object' && !Array.isArray(d.topicSlides) ? d.topicSlides : {},
});

// Everything kind-specific lives in one jsonb column and is spread back out on
// read, so the rest of the server only ever sees a flat question document and a
// new kind needs no migration. options/answer_idx stay as real columns because
// mcq and multi use them and the existing rows depend on them.
// Imported, never retyped: a second copy of this list drifting out of date is
// exactly how every match, order, blank and open question once arrived empty.
const PAYLOAD_KEYS = PAYLOAD_FIELDS;

const outQuestion = (r) =>
  r && {
    _id: r.id,
    contentId: r.content_id,
    topic: r.topic ?? '',
    text: r.text,
    kind: r.kind ?? 'mcq',
    options: Array.isArray(r.options) ? r.options : [],
    answerIdx: r.answer_idx,
    bloom: r.bloom,
    status: r.status,
    source: r.source,
    createdAt: r.created_at,
    // 0013: provenance and approval.
    model: r.model ?? null,
    sourceRef: r.source_ref ?? null,
    checks: r.checks ?? null,
    createdBy: r.created_by ?? null,
    approvedBy: r.approved_by ?? null,
    approvedAt: r.approved_at ?? null,
    // 0022: the active question a regenerated draft would replace.
    replacesId: r.replaces_id ?? null,
    // 0024: misconception labels on its wrong options.
    misconceptions: Array.isArray(r.misconceptions) ? r.misconceptions : [],
    // 0035 (Batch 8): kept for rooms only; false on a database without the column.
    roomsOnly: r.rooms_only === true,
    ...(r.payload && typeof r.payload === 'object' ? r.payload : {}),
  };

const inQuestion = (d) => {
  const payload = {};
  for (const k of PAYLOAD_KEYS) if (d[k] !== undefined) payload[k] = d[k];
  return {
    content_id: d.contentId,
    topic: d.topic ?? '',
    text: d.text,
    kind: d.kind ?? 'mcq',
    // Only mcq/multi carry options; the column is nullable for the rest.
    options: Array.isArray(d.options) && d.options.length ? d.options : null,
    answer_idx: Number.isInteger(d.answerIdx) ? d.answerIdx : null,
    bloom: d.bloom,
    status: d.status ?? 'active',
    source: d.source ?? 'llm',
    payload,
    model: d.model ?? null,
    source_ref: d.sourceRef ?? null,
    checks: d.checks ?? null,
    created_by: d.createdBy ?? null,
    approved_by: d.approvedBy ?? null,
    approved_at: d.approvedAt ?? null,
    replaces_id: d.replacesId ?? null,
    misconceptions: Array.isArray(d.misconceptions) ? d.misconceptions : [],
    // 0035 (Batch 8): written only when set, so a database without the column
    // still saves every question made the ordinary way.
    ...(d.roomsOnly === true ? { rooms_only: true } : {}),
  };
};

const outSession = (r) =>
  r && {
    _id: r.id,
    code: r.code,
    contentId: r.content_id,
    title: r.title ?? '',
    status: r.status,
    ownerId: r.owner_id ?? null,
    startedAt: r.started_at,
    closedAt: r.closed_at,
    pausedAt: r.paused_at ?? null,
    // Phase 7 room settings. `mastery_goal` is a Postgres numeric, and PostgREST
    // hands numerics back as STRINGS to keep arbitrary precision - so without
    // this Number() the goal arrives as '0.80', every === against 0.8 is false,
    // and the room silently falls back to the default it was already set to.
    // The one place it would have shown is the one place it matters: a teacher
    // who picked 100% getting an 80% bar.
    masteryGoal: Number(r.mastery_goal),
    reattempts: Number(r.reattempts) || 0,
    redemption: r.redemption === true,
    // uuid[] (0015) arrives as a JSON array of strings; null is the whole bank.
    questionIds: Array.isArray(r.question_ids) ? r.question_ids.map(String) : null,
    // 0016: the class the room was opened for, or null.
    classId: r.class_id ?? null,
    // 0018: how the room runs. smallint comes back as a number, unlike numeric.
    mode: r.mode ?? 'devices',
    adapt: r.adapt !== false,
    startLevel: r.start_level ?? 'understand',
    questionsPerStudent: r.questions_per_student ?? null,
    timePerQuestion: r.time_per_question ?? null,
  };

const outProfile = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    rollNo: r.roll_no,
    name: r.name ?? '',
    levels: r.levels ?? {},
    workingLevel: r.working_level,
    reason: r.reason ?? '',
    history: Array.isArray(r.history) ? r.history : [],
    // Flattened into one object at this boundary, like every other mapping here.
    // `tries` and `last` are part of the pin rather than fields of their own:
    // they describe the attempt in progress on THAT question, and they are
    // meaningless - and must not survive - once the pin is cleared.
    served: r.served_id
      ? {
          questionId: r.served_id,
          at: r.served_at,
          reason: r.served_why ?? '',
          tries: Number(r.served_tries) || 0,
          last: r.served_last ?? '',
        }
      : null,
    // 0030 (Phase 7): every question put on this phone's screen, first time each.
    servedLog: Array.isArray(r.served_log) ? r.served_log : [],
    integrity: Array.isArray(r.integrity) ? r.integrity : [],
    // The student account this room profile is linked to, or null.
    accountId: r.account_id ?? null,
    // 0022 (decision 7): true only for a link the signed-in student's token made.
    accountVerified: r.account_verified === true,
  };

/**
 * One submitted attempt, as stored. Append-only evidence: the response and the
 * machine's original assessment are never overwritten; a professor's review is
 * written beside them (reviewed_by, review_status) rather than over them.
 */
const outAnswer = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    answerKey: r.answer_key,
    rollNo: r.roll_no,
    accountId: r.account_id ?? null,
    questionId: r.question_id ?? null,
    contentId: r.content_id ?? null,
    topic: r.topic ?? '',
    bloom: r.bloom,
    kind: r.kind ?? 'mcq',
    questionSnapshot: r.question_snapshot ?? {},
    response: r.response ?? null,
    attempt: Number(r.attempt) || 1,
    final: r.final !== false,
    correct: r.correct ?? null,
    score: r.score == null ? null : Number(r.score),
    detail: r.detail ?? '',
    ungraded: r.ungraded === true,
    language: r.language ?? 'en',
    questionSource: r.question_source ?? 'llm',
    servedAt: r.served_at ?? null,
    answeredAt: r.answered_at,
    reviewStatus: r.review_status ?? 'auto',
    autoCorrect: r.auto_correct ?? null,
    autoScore: r.auto_score == null ? null : Number(r.auto_score),
    autoDetail: r.auto_detail ?? '',
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at ?? null,
    reviewNote: r.review_note ?? '',
    confidence: r.confidence ?? null,
    // 0022 (decision 7): sent by a phone signed in as the linked account.
    accountVerified: r.account_verified === true,
    // 0023: the class question and round of a vote; null on every other answer.
    classQuestionId: r.class_question_id ?? null,
    round: r.round == null ? null : Number(r.round),
    // 0030: when the phone says it was answered; for the record only.
    deviceAnsweredAt: r.device_answered_at ?? null,
  };

const outArchive = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    code: r.code,
    title: r.title ?? '',
    ownerId: r.owner_id ?? null,
    archivedBy: r.archived_by ?? null,
    archivedAt: r.archived_at,
    bytes: Number(r.bytes),
    ...(r.data !== undefined ? { data: r.data } : {}),
  };
const ARCHIVE_META = 'id, session_id, code, title, owner_id, archived_by, archived_at, bytes';

/** One professor decision on an answer. Append-only: written once, never updated. */
const outReview = (r) =>
  r && {
    _id: r.id,
    answerId: r.answer_id,
    sessionId: r.session_id,
    decision: r.decision,
    correct: r.correct,
    // numeric comes back from PostgREST as a string; see outSession.
    score: Number(r.score),
    note: r.note ?? '',
    reviewedBy: r.reviewed_by ?? null,
    reviewedAt: r.reviewed_at,
  };

/**
 * An uploaded image (0014). `data` is a bytea column, which PostgREST reads and
 * writes as its text form: "\x" and two hex digits a byte. Only selected when
 * asked for, because a permission check needs none of the half megabyte.
 */
const outMedia = (r) =>
  r && {
    _id: r.id,
    ownerId: r.owner_id ?? null,
    contentId: r.content_id,
    mime: r.mime,
    bytes: Number(r.bytes),
    sha256: r.sha256,
    alt: r.alt ?? '',
    createdAt: r.created_at,
    ...(typeof r.data === 'string' ? { data: Buffer.from(r.data.replace(/^\\x/, ''), 'hex') } : {}),
  };
const MEDIA_META = 'id, owner_id, content_id, mime, bytes, sha256, alt, created_at';

// Batch 9 (0037): a student's drawing. Read only by the drawing methods, so a
// database without 0037 still reads every other upload.
const DRAWING_META = `${MEDIA_META}, drawing, session_id, roll_no, account_id, question_id, answer_key`;
const outDrawing = (r) => (r?.drawing
  ? {
    ...outMedia(r),
    drawing: true,
    sessionId: r.session_id ?? null,
    rollNo: r.roll_no ?? null,
    accountId: r.account_id ?? null,
    questionId: r.question_id ?? null,
    answerKey: r.answer_key,
  }
  : null);

// 0016: a class, a roster row and an attendance mark.
const outClass = (r) =>
  r && {
    _id: r.id,
    ownerId: r.owner_id ?? null,
    courseName: r.course_name,
    section: r.section,
    termLabel: r.term_label ?? '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };

const outClassStudent = (r) =>
  r && {
    _id: r.id,
    classId: r.class_id,
    rollNo: r.roll_no,
    name: r.name,
    addedAt: r.added_at,
    removedAt: r.removed_at ?? null,
    // 0022 (decision 8): the owner's optional mark.
    under18: r.under_18 === true,
  };

const outAttendance = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    classStudentId: r.class_student_id,
    status: r.status,
    source: r.source,
    markedAt: r.marked_at,
    markedBy: r.marked_by ?? null,
    rollNo: r.roll_no ?? null,
  };

const inAttendance = (d) => ({
  session_id: d.sessionId,
  class_student_id: d.classStudentId,
  status: d.status,
  source: d.source,
  marked_at: d.markedAt ?? new Date().toISOString(),
  marked_by: d.markedBy ?? null,
  // 0021: the roll number the mark was made under.
  roll_no: d.rollNo ?? null,
});

/** A unique violation as the 409 a route can answer with, rather than a 500. */
const conflict = (message) => Object.assign(new Error(message), { status: 409 });

// 0017: the teacher-record store.
const outObservation = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    classId: r.class_id ?? null,
    classStudentId: r.class_student_id ?? null,
    rollNo: r.roll_no,
    // A Postgres date arrives as 'YYYY-MM-DD', the form the server writes.
    day: r.day,
    kind: r.kind ?? null,
    note: r.note ?? '',
    observedBy: r.observed_by ?? null,
    observedAt: r.observed_at,
  };

const outRound = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    round: Number(r.round),
    presentOnly: r.present_only === true,
    noRepeat: r.no_repeat === true,
    startedAt: r.started_at,
    startedBy: r.started_by ?? null,
  };

const outPick = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    round: Number(r.round),
    order: Number(r.pick_order),
    rollNo: r.roll_no,
    classStudentId: r.class_student_id ?? null,
    poolSize: Number(r.pool_size),
    presentOnly: r.present_only === true,
    noRepeat: r.no_repeat === true,
    ask: r.ask,
    questionId: r.question_id ?? null,
    status: r.status,
    pickedAt: r.picked_at,
    pickedBy: r.picked_by ?? null,
    statusAt: r.status_at ?? null,
    statusBy: r.status_by ?? null,
  };

const outTally = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    seq: Number(r.seq),
    questionId: r.question_id ?? null,
    text: r.question_text,
    // text[] and integer[] arrive as JSON arrays.
    labels: Array.isArray(r.option_labels) ? r.option_labels : ['', '', '', ''],
    counts: Array.isArray(r.counts) ? r.counts.map(Number) : [0, 0, 0, 0],
    revealed: r.revealed === true,
    correct: r.correct_option == null ? null : Number(r.correct_option),
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    updatedAt: r.updated_at,
  };

const outActivity = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    seq: Number(r.seq),
    kind: r.kind,
    outcome: r.outcome ?? '',
    groups: Array.isArray(r.groups) ? r.groups : [],
    tallyId: r.tally_id ?? null,
    // Batch 8 (0034): undefined on a database without the column reads as null.
    suggestionId: r.suggestion_id ?? null,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    updatedAt: r.updated_at,
  };

const outInsightAction = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    flagId: r.flag_id,
    action: r.action,
    note: r.note ?? '',
    actedBy: r.acted_by ?? null,
    actedAt: r.acted_at,
  };

// Phase 7 (0032): a teacher-record write's replay key.
const outRecordWrite = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    writer: r.writer,
    key: r.write_key,
    route: r.route,
    target: r.target ?? '',
    bodyHash: r.body_hash,
    status: Number(r.status),
    reply: r.reply && typeof r.reply === 'object' ? r.reply : {},
    createdAt: r.created_at,
  };

const outProjectorLink = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    tokenHash: r.token_hash,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    revokedAt: r.revoked_at ?? null,
    revokedBy: r.revoked_by ?? null,
  };

// 0019: course outcomes, their topic mappings and per-question overrides.
const outOutcome = (r) =>
  r && {
    _id: r.id,
    classId: r.class_id,
    code: r.code,
    statement: r.statement,
    targetLevel: r.target_level ?? null,
    position: Number(r.position),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archivedAt: r.archived_at ?? null,
  };

const outOutcomeTopic = (r) =>
  r && {
    _id: r.id,
    outcomeId: r.outcome_id,
    classId: r.class_id,
    contentId: r.content_id,
    topic: r.topic,
    // numeric comes back as a string; see outSession.
    weight: Number(r.weight),
    createdAt: r.created_at,
  };

const outOverride = (r) =>
  r && {
    _id: r.id,
    classId: r.class_id,
    questionId: r.question_id,
    // uuid[] arrives as a JSON array of strings.
    outcomeIds: Array.isArray(r.outcome_ids) ? r.outcome_ids.map(String) : [],
    excluded: r.excluded === true,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by ?? null,
  };

// 0023: a class question, where it stands, and the question as it was asked.
const outClassQuestion = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    seq: Number(r.seq),
    questionId: r.question_id ?? null,
    questionSnapshot: r.question_snapshot ?? {},
    state: r.state,
    revealed: r.revealed === true,
    startedAt: r.started_at,
    startedBy: r.started_by ?? null,
    pausedAt: r.paused_at ?? null,
    revoteAt: r.revote_at ?? null,
    closedAt: r.closed_at ?? null,
    closedBy: r.closed_by ?? null,
  };

// 0030 (Phase 7): a question pack sent to one phone.
const outQuestionPack = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    rollNo: r.roll_no,
    questionIds: Array.isArray(r.question_ids) ? r.question_ids.map(String) : [],
    issuedAt: r.issued_at,
    expiresAt: r.expires_at,
  };

// 0020: a class's attainment formula, one row per saved version.
const outAttainmentConfig = (r) =>
  r && {
    _id: r.id,
    classId: r.class_id,
    version: Number(r.version),
    config: r.config && typeof r.config === 'object' ? r.config : {},
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
  };

/** A record's place in its room already held (23505), as the 409 the routes answer with. */
const placeTaken = (what) => conflict(`That ${what} was taken by another request. Nothing was changed.`);

const inAnswer = (d) => ({
  session_id: d.sessionId,
  answer_key: d.answerKey,
  roll_no: String(d.rollNo),
  account_id: d.accountId ?? null,
  question_id: d.questionId ?? null,
  content_id: d.contentId ?? null,
  topic: d.topic ?? '',
  bloom: d.bloom,
  kind: d.kind ?? 'mcq',
  question_snapshot: d.questionSnapshot ?? {},
  response: d.response ?? null,
  attempt: d.attempt ?? 1,
  final: d.final !== false,
  correct: d.correct ?? null,
  score: d.score ?? null,
  detail: d.detail ?? '',
  ungraded: d.ungraded === true,
  language: d.language ?? 'en',
  question_source: d.questionSource ?? 'llm',
  served_at: d.servedAt ?? null,
  answered_at: d.answeredAt ?? new Date().toISOString(),
  review_status: d.reviewStatus ?? 'auto',
  auto_correct: d.autoCorrect ?? null,
  auto_score: d.autoScore ?? null,
  auto_detail: d.autoDetail ?? '',
  confidence: d.confidence ?? null,
  account_verified: d.accountVerified === true,
  class_question_id: d.classQuestionId ?? null,
  round: d.round ?? null,
  device_answered_at: d.deviceAnsweredAt ?? null,
});

/** Only the fields the caller actually sent, so a PATCH never blanks a column. */
function pick(patch, map) {
  const out = {};
  for (const [from, to] of Object.entries(map)) {
    if (patch[from] !== undefined) out[to] = patch[from];
  }
  return out;
}

/**
 * One value inside a PostgREST `or=(...)` filter. Double quotes make the
 * reserved characters (, . : ( )) literal; a quote or backslash inside the value
 * is escaped with a backslash, which is the grammar's own escape.
 */
const postgrestQuote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ------------------------------------------------------------------- repo --

export function createSupabaseRepo() {
  const db = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'x-application-name': 'bloomloop' } },
  });

  /**
   * Every row of one room-scoped teacher-record read (0017), a page at a time:
   * PostgREST caps one response at its max-rows setting (1000 by default)
   * whatever is asked, and the room archive reads whole rooms through these.
   * Not a repo method: the three repos expose the same methods, and this is
   * only how this one reads.
   */
  const allRecords = async (op, table, filter, order, out) => {
    const PAGE = 1000;
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      let q = filter(db.from(table).select('*'));
      for (const col of order) q = q.order(col, { ascending: true });
      const page = unwrap(op, await q.range(offset, offset + PAGE - 1)) ?? [];
      rows.push(...page.map(out));
      if (page.length < PAGE) return rows;
    }
  };

  return {
    kind: 'supabase',

    // -- content --
    async createContent(doc) {
      const rows = unwrap(
        'createContent',
        await db.from('contents').insert(inContent(doc)).select().single(),
      );
      return outContent(rows);
    },

    async getContent(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('contents').select('*').eq('id', id).maybeSingle();
      if (error) fail('getContent')(error);
      return outContent(data);
    },

    async listContents() {
      const rows = unwrap(
        'listContents',
        await db.from('contents').select('*').order('created_at', { ascending: false }),
      );
      return (rows ?? []).map(outContent);
    },

    async updateContent(id, patch) {
      const set = pick(patch, { title: 'title', rawText: 'raw_text', topics: 'topics' });
      if (Object.keys(set).length === 0) return this.getContent(id);
      const { data, error } = await db.from('contents').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateContent')(error);
      return outContent(data);
    },

    // -- questions --
    async insertQuestions(docs) {
      if (!docs?.length) return [];
      // Chunked: a whole chapter can be a few hundred rows and PostgREST has a
      // request size ceiling.
      const out = [];
      const CHUNK = 200;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const rows = unwrap(
          'insertQuestions',
          await db.from('questions').insert(docs.slice(i, i + CHUNK).map(inQuestion)).select(),
        );
        out.push(...(rows ?? []).map(outQuestion));
      }
      return out;
    },

    async listQuestions(contentId, { includeDiscarded = false } = {}) {
      let q = db.from('questions').select('*').eq('content_id', contentId);
      if (!includeDiscarded) q = q.eq('status', 'active');
      // PostgREST caps rows at 1000 by default; a chapter bank is far under that,
      // but say it explicitly rather than silently truncating a big one.
      const rows = unwrap('listQuestions', await q.limit(2000));
      return (rows ?? []).map(outQuestion);
    },

    async getQuestion(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('questions').select('*').eq('id', id).maybeSingle();
      if (error) fail('getQuestion')(error);
      return outQuestion(data);
    },

    async updateQuestion(id, patch) {
      const set = pick(patch, {
        text: 'text',
        options: 'options',
        answerIdx: 'answer_idx',
        bloom: 'bloom',
        status: 'status',
        topic: 'topic',
        source: 'source',
        kind: 'kind',
        model: 'model',
        sourceRef: 'source_ref',
        checks: 'checks',
        approvedBy: 'approved_by',
        approvedAt: 'approved_at',
        // 0024: its own column, so a label write leaves the payload alone.
        misconceptions: 'misconceptions',
      });
      const payload = {};
      for (const k of PAYLOAD_KEYS) if (patch[k] !== undefined) payload[k] = patch[k];
      if (Object.keys(payload).length) set.payload = payload;
      if (Object.keys(set).length === 0) return this.getQuestion(id);
      const { data, error } = await db.from('questions').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateQuestion')(error);
      return outQuestion(data);
    },

    // Used by a replacing generate. Without it "generate" could only ever add,
    // which is how one deck accumulated 864 questions over six presses.
    async deleteQuestions(contentId) {
      const { error, count } = await db
        .from('questions')
        .delete({ count: 'exact' })
        .eq('content_id', contentId);
      if (error) fail('deleteQuestions')(error);
      return count ?? 0;
    },

    // `status`: see memoryRepo.
    async countQuestions(contentId, { status = 'active' } = {}) {
      const { count, error } = await db
        .from('questions')
        .select('id', { count: 'exact', head: true })
        .eq('content_id', contentId)
        .eq('status', status);
      if (error) fail('countQuestions')(error);
      return count ?? 0;
    },

    // -- sessions --
    async createSession(doc) {
      const rows = unwrap(
        'createSession',
        await db
          .from('sessions')
          .insert({
            code: doc.code,
            content_id: doc.contentId,
            title: doc.title ?? '',
            status: doc.status ?? 'open',
            owner_id: doc.ownerId ?? null,
            // Written once, here, and never patched. updateSession() deliberately
            // has no mapping for these three: they change what an answer MEANS,
            // so changing them mid-room would leave the students who answered
            // before the change and the ones who answered after in one grid,
            // measured differently, with nothing on screen to say so.
            mastery_goal: doc.masteryGoal,
            reattempts: doc.reattempts,
            redemption: doc.redemption,
            // Written once, for the same reason: which questions a room serves
            // is part of what its answers mean.
            question_ids: Array.isArray(doc.questionIds) ? doc.questionIds : null,
            // 0016. Written once too: who the room's attendance is taken against.
            class_id: doc.classId ?? null,
            // 0018. Written once, like the settings above: how the room runs is
            // part of what its answers mean. Each defaults to the column's own
            // default, which is how every room ran before.
            mode: doc.mode ?? 'devices',
            adapt: doc.adapt !== false,
            start_level: doc.startLevel ?? 'understand',
            questions_per_student: doc.questionsPerStudent ?? null,
            time_per_question: doc.timePerQuestion ?? null,
          })
          .select()
          .single(),
      );
      return outSession(rows);
    },

    async getSession(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('sessions').select('*').eq('id', id).maybeSingle();
      if (error) fail('getSession')(error);
      return outSession(data);
    },

    async getSessionByCode(code) {
      const { data, error } = await db
        .from('sessions')
        .select('*')
        .eq('code', String(code).toUpperCase())
        .maybeSingle();
      if (error) fail('getSessionByCode')(error);
      return outSession(data);
    },

    async updateSession(id, patch) {
      const set = pick(patch, { status: 'status', title: 'title', closedAt: 'closed_at', pausedAt: 'paused_at' });
      if (Object.keys(set).length === 0) return this.getSession(id);
      const { data, error } = await db.from('sessions').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateSession')(error);
      return outSession(data);
    },

    async deleteSession(id) {
      const { error } = await db.from('sessions').delete().eq('id', id);
      if (error) fail('deleteSession')(error);
      return true;
    },

    async listSessions() {
      const rows = unwrap(
        'listSessions',
        await db.from('sessions').select('*').order('started_at', { ascending: false }),
      );
      return (rows ?? []).map(outSession);
    },

    // See memoryRepo. Indexed by sessions_content_idx (0014).
    async listSessionsForContent(contentId) {
      if (!isUuid(contentId)) return [];
      const rows = unwrap(
        'listSessionsForContent',
        await db.from('sessions').select('*').eq('content_id', contentId).order('started_at', { ascending: false }),
      );
      return (rows ?? []).map(outSession);
    },

    // See memoryRepo. Indexed by sessions_class_idx (0016).
    async listSessionsForClass(classId) {
      if (!isUuid(classId)) return [];
      const rows = unwrap(
        'listSessionsForClass',
        await db.from('sessions').select('*').eq('class_id', classId).order('started_at', { ascending: false }),
      );
      return (rows ?? []).map(outSession);
    },

    // -- profiles --
    async getProfile(sessionId, rollNo) {
      const { data, error } = await db
        .from('profiles')
        .select('*')
        .eq('session_id', sessionId)
        .eq('roll_no', String(rollNo))
        .maybeSingle();
      if (error) fail('getProfile')(error);
      return outProfile(data);
    },

    async saveProfile(profile) {
      // Upsert on (session_id, roll_no) - the unique constraint in migrations/0000_core_tables.sql is
      // what stops a reconnecting student becoming a second row in the grid.
      const rows = unwrap(
        'saveProfile',
        await db
          .from('profiles')
          .upsert(
            {
              session_id: profile.sessionId,
              roll_no: String(profile.rollNo),
              name: profile.name ?? '',
              levels: profile.levels ?? {},
              working_level: profile.workingLevel,
              reason: profile.reason ?? '',
              history: profile.history ?? [],
              served_id: profile.served?.questionId ?? null,
              served_at: profile.served?.at ?? null,
              served_why: profile.served?.reason ?? null,
              // Zeroed rather than left alone when the pin goes, so the next
              // question a student is served can never inherit the retries the
              // last one had already spent.
              served_tries: profile.served?.tries ?? 0,
              served_last: profile.served?.last || null,
              // 0030 (Phase 7): the pin moves on, the log of serves does not.
              served_log: Array.isArray(profile.servedLog) ? profile.servedLog : [],
              integrity: profile.integrity ?? [],
              account_id: profile.accountId ?? null,
              account_verified: profile.accountVerified === true,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'session_id,roll_no' },
          )
          .select()
          .single(),
      );
      return outProfile(rows);
    },

    async listProfiles(sessionId) {
      const rows = unwrap(
        'listProfiles',
        await db.from('profiles').select('*').eq('session_id', sessionId).limit(500),
      );
      // Sorted in JS so '2' comes before '10', which a text column will not do.
      return (rows ?? [])
        .map(outProfile)
        .sort((a, b) =>
          String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true }),
        );
    },

    // -- answers (append-only evidence) --

    /**
     * Store one attempt. Idempotent on (session_id, answer_key): a resend of an
     * attempt the server already holds returns the stored row with
     * `duplicate: true` instead of a second row.
     */
    async recordAnswer(doc) {
      const { data, error } = await db.from('answers').insert(inAnswer(doc)).select().single();
      if (!error) return { answer: outAnswer(data), duplicate: false };
      if (error.code === '23505') {
        const existing = await this.getAnswerByKey(doc.sessionId, doc.answerKey);
        if (existing) return { answer: existing, duplicate: true };
      }
      return fail('recordAnswer')(error);
    },

    async getAnswerByKey(sessionId, answerKey) {
      const { data, error } = await db
        .from('answers')
        .select('*')
        .eq('session_id', sessionId)
        .eq('answer_key', String(answerKey))
        .maybeSingle();
      if (error) fail('getAnswerByKey')(error);
      return outAnswer(data);
    },

    async getAnswer(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('answers').select('*').eq('id', id).maybeSingle();
      if (error) fail('getAnswer')(error);
      return outAnswer(data);
    },

    /**
     * Oldest first, or newest first with `order: 'desc'`. Filters are ANDed; at least one is expected.
     * `student`: see memoryRepo - account_id = theirs, or their roll number with no account.
     * `before`: see memoryRepo - a page cursor in (answered_at, id) order.
     * `classQuestionId`, `classVotes: false`: see memoryRepo (0023).
     */
    async listAnswers({
      sessionId, sessionIds, rollNo, accountId, student, topic, bloom, reviewStatus, kind, final, before,
      classQuestionId, classVotes, order = 'asc', limit = 2000, offset = 0,
    } = {}) {
      let q = db.from('answers').select('*');
      if (sessionId) q = q.eq('session_id', sessionId);
      if (Array.isArray(sessionIds)) q = q.in('session_id', sessionIds.length ? sessionIds : ['00000000-0000-0000-0000-000000000000']);
      if (rollNo) q = q.eq('roll_no', String(rollNo));
      if (accountId) q = q.eq('account_id', accountId);
      if (student?.verifiedOnly) {
        // The student reading themself (decision 7): linked AND verified, never a roll number.
        if (!student.accountId) return [];
        q = q.eq('account_id', student.accountId).eq('account_verified', true);
      } else if (student) {
        // A PostgREST `or` filter is one string, so both values are quoted: a roll
        // number may hold '.', which the filter grammar reserves.
        const either = [];
        if (student.accountId) either.push(`account_id.eq.${postgrestQuote(student.accountId)}`);
        if (student.rollNo) either.push(`and(roll_no.eq.${postgrestQuote(student.rollNo)},account_id.is.null)`);
        if (!either.length) return [];
        q = q.or(either.join(','));
      }
      if (before) {
        // Sent as a second `or` parameter when `student` is also given; PostgREST
        // ANDs separate filters. No caller combines the two today (the queue
        // pages with `before`, the student lister with offset).
        const at = postgrestQuote(before.answeredAt);
        q = q.or(`answered_at.lt.${at},and(answered_at.eq.${at},id.lt.${postgrestQuote(before.id)})`);
      }
      if (topic) q = q.eq('topic', topic);
      if (bloom) q = q.eq('bloom', bloom);
      if (reviewStatus) q = q.eq('review_status', reviewStatus);
      if (Array.isArray(kind)) q = q.in('kind', kind);
      else if (kind) q = q.eq('kind', kind);
      if (final !== undefined) q = q.eq('final', final === true);
      if (classQuestionId) {
        if (!isUuid(classQuestionId)) return [];
        q = q.eq('class_question_id', classQuestionId);
      } else if (classVotes === false) q = q.is('class_question_id', null);
      // Ordered on id as well, so pages never overlap or skip a row when two
      // answers share a timestamp. PostgREST caps a request at its max-rows
      // setting (1000 by default) whatever `limit` says: page with `offset`.
      const ascending = order !== 'desc';
      const rows = unwrap('listAnswers', await q
        .order('answered_at', { ascending })
        .order('id', { ascending })
        .range(offset, offset + limit - 1));
      return (rows ?? []).map(outAnswer);
    },

    // -- room archives (see memoryRepo for the contract) --
    async saveRoomArchive(doc) {
      const row = unwrap('saveRoomArchive', await db
        .from('room_archives')
        .upsert({
          session_id: doc.sessionId,
          code: doc.code,
          title: doc.title ?? '',
          owner_id: doc.ownerId ?? null,
          archived_by: doc.archivedBy ?? null,
          archived_at: doc.archivedAt,
          bytes: doc.bytes,
          data: doc.data,
        }, { onConflict: 'session_id' })
        .select(ARCHIVE_META)
        .single());
      return outArchive(row);
    },

    async listRoomArchives() {
      const rows = unwrap('listRoomArchives', await db
        .from('room_archives')
        .select(ARCHIVE_META)
        .order('archived_at', { ascending: false })
        .limit(1000));
      return (rows ?? []).map(outArchive);
    },

    async getRoomArchive(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('room_archives').select('*').eq('id', id).maybeSingle();
      if (error) fail('getRoomArchive')(error);
      return outArchive(data);
    },

    /** Review fields only: the response and the automatic assessment are immutable. */
    async updateAnswer(id, patch) {
      const set = pick(patch, {
        correct: 'correct',
        score: 'score',
        reviewStatus: 'review_status',
        reviewedBy: 'reviewed_by',
        reviewedAt: 'reviewed_at',
        reviewNote: 'review_note',
        final: 'final',
      });
      if (Object.keys(set).length === 0) return this.getAnswer(id);
      const { data, error } = await db.from('answers').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateAnswer')(error);
      return outAnswer(data);
    },

    // -- answer reviews (append-only; see memoryRepo for the contract) --
    async addAnswerReview(doc) {
      const row = unwrap('addAnswerReview', await db
        .from('answer_reviews')
        .insert({
          answer_id: doc.answerId,
          session_id: doc.sessionId,
          decision: doc.decision,
          correct: doc.correct,
          score: doc.score,
          note: doc.note ?? '',
          reviewed_by: doc.reviewedBy ?? null,
          reviewed_at: doc.reviewedAt ?? new Date().toISOString(),
        })
        .select()
        .single());
      return outReview(row);
    },

    /**
     * Oldest first, every row. Filters are ANDed; at least one is expected.
     * Paged, because PostgREST caps one response at its max-rows setting (1000
     * by default) whatever the request asks for, and the room archive reads a
     * whole room's log through here: a cap would drop decisions from it silently.
     */
    async listAnswerReviews({ answerId, sessionId } = {}) {
      const PAGE = 1000;
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        let q = db.from('answer_reviews').select('*');
        if (answerId) q = q.eq('answer_id', answerId);
        if (sessionId) q = q.eq('session_id', sessionId);
        const rows = unwrap('listAnswerReviews', await q
          .order('reviewed_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE - 1)) ?? [];
        out.push(...rows.map(outReview));
        if (rows.length < PAGE) return out;
      }
    },

    // -- media (see memoryRepo for the contract) --
    async createMedia(doc) {
      const row = unwrap('createMedia', await db
        .from('media')
        .insert({
          owner_id: doc.ownerId ?? null,
          content_id: doc.contentId,
          mime: doc.mime,
          bytes: doc.bytes,
          sha256: doc.sha256,
          alt: doc.alt,
          data: `\\x${Buffer.from(doc.data).toString('hex')}`,
        })
        .select(MEDIA_META)
        .single());
      return outMedia(row);
    },

    async getMedia(id, { withData = false } = {}) {
      if (!isUuid(id)) return null;
      const { data, error } = await db
        .from('media')
        .select(withData ? `${MEDIA_META}, data` : MEDIA_META)
        .eq('id', id)
        .maybeSingle();
      if (error) fail('getMedia')(error);
      return outMedia(data);
    },

    // -- classes and rosters (0016; see memoryRepo for the contract) --
    async createClass(doc) {
      const row = unwrap('createClass', await db
        .from('classes')
        .insert({
          owner_id: doc.ownerId ?? null,
          course_name: doc.courseName,
          section: doc.section,
          term_label: doc.termLabel ?? '',
        })
        .select()
        .single());
      return outClass(row);
    },

    async getClass(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('classes').select('*').eq('id', id).maybeSingle();
      if (error) fail('getClass')(error);
      return outClass(data);
    },

    async listClasses() {
      const rows = unwrap('listClasses', await db
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000));
      return (rows ?? []).map(outClass);
    },

    async updateClass(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, { courseName: 'course_name', section: 'section', termLabel: 'term_label' });
      if (Object.keys(set).length === 0) return this.getClass(id);
      // No updated_at trigger on the table, so the timestamp is set here.
      set.updated_at = new Date().toISOString();
      const { data, error } = await db.from('classes').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateClass')(error);
      return outClass(data);
    },

    async listClassStudents(classId) {
      if (!isUuid(classId)) return [];
      // A roster is at most MAX_CLASS_SIZE active rows plus the removed ones;
      // asked for explicitly rather than left to PostgREST's 1000-row default.
      const rows = unwrap('listClassStudents', await db
        .from('class_students')
        .select('*')
        .eq('class_id', classId)
        .limit(5000));
      // Sorted in JS so '2' comes before '10', which a text column will not do.
      return (rows ?? []).map(outClassStudent)
        .sort((a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true }));
    },

    async getClassStudent(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('class_students').select('*').eq('id', id).maybeSingle();
      if (error) fail('getClassStudent')(error);
      return outClassStudent(data);
    },

    // ON CONFLICT DO NOTHING on (class_id, roll_no): only the rows added come back.
    async addClassStudents(classId, docs) {
      if (!docs?.length) return [];
      const out = [];
      const CHUNK = 200;
      for (let i = 0; i < docs.length; i += CHUNK) {
        const rows = unwrap('addClassStudents', await db
          .from('class_students')
          .upsert(
            docs.slice(i, i + CHUNK).map((d) => ({ class_id: classId, roll_no: d.rollNo, name: d.name, under_18: d.under18 === true })),
            { onConflict: 'class_id,roll_no', ignoreDuplicates: true },
          )
          .select());
        out.push(...(rows ?? []).map(outClassStudent));
      }
      return out;
    },

    async updateClassStudent(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, { name: 'name', rollNo: 'roll_no', removedAt: 'removed_at', under18: 'under_18' });
      if (Object.keys(set).length === 0) return this.getClassStudent(id);
      const { data, error } = await db.from('class_students').update(set).eq('id', id).select().maybeSingle();
      if (error?.code === '23505') throw conflict(`Roll number ${patch.rollNo} is already on this class's roster.`);
      if (error) fail('updateClassStudent')(error);
      return outClassStudent(data);
    },

    // -- attendance (0016; see memoryRepo for the contract) --
    async listAttendance(sessionId) {
      if (!isUuid(sessionId)) return [];
      const rows = unwrap('listAttendance', await db
        .from('attendance')
        .select('*')
        .eq('session_id', sessionId)
        .limit(5000));
      return (rows ?? []).map(outAttendance);
    },

    // ON CONFLICT (session_id, class_student_id) DO UPDATE: each mark replaces the last.
    async saveAttendance(docs) {
      if (!docs?.length) return [];
      const rows = unwrap('saveAttendance', await db
        .from('attendance')
        .upsert(docs.map(inAttendance), { onConflict: 'session_id,class_student_id' })
        .select());
      return (rows ?? []).map(outAttendance);
    },

    // ON CONFLICT DO NOTHING: a mark already there (a professor's above all) is kept.
    async addAttendanceIfAbsent(doc) {
      const rows = unwrap('addAttendanceIfAbsent', await db
        .from('attendance')
        .upsert(inAttendance(doc), { onConflict: 'session_id,class_student_id', ignoreDuplicates: true })
        .select());
      return { created: (rows ?? []).length > 0 };
    },

    // -- teacher records (0017; see memoryRepo for the contract) --

    // Append-only: no update, and the database refuses one (0017's guard).
    async addObservation(doc) {
      const row = unwrap('addObservation', await db
        .from('observations')
        .insert({
          session_id: doc.sessionId,
          class_id: doc.classId ?? null,
          class_student_id: doc.classStudentId ?? null,
          roll_no: doc.rollNo,
          day: doc.day,
          kind: doc.kind ?? null,
          note: doc.note ?? '',
          observed_by: doc.observedBy ?? null,
          observed_at: doc.observedAt ?? new Date().toISOString(),
        })
        .select()
        .single());
      return outObservation(row);
    },

    async listObservations({ sessionId, classId, classStudentId, day } = {}) {
      if ([sessionId, classId, classStudentId].some((id) => id !== undefined && id !== null && !isUuid(id))) return [];
      return allRecords('listObservations', 'observations', (q) => {
        let f = q;
        if (sessionId) f = f.eq('session_id', sessionId);
        if (classId) f = f.eq('class_id', classId);
        if (classStudentId) f = f.eq('class_student_id', classStudentId);
        if (day) f = f.eq('day', day);
        return f;
      }, ['observed_at', 'id'], outObservation);
    },

    async listWheelRounds(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listWheelRounds', 'wheel_rounds', (q) => q.eq('session_id', sessionId), ['round'], outRound);
    },

    async addWheelRound(doc) {
      const { data, error } = await db.from('wheel_rounds').insert({
        session_id: doc.sessionId,
        round: doc.round,
        present_only: doc.presentOnly,
        no_repeat: doc.noRepeat,
        started_at: doc.startedAt ?? new Date().toISOString(),
        started_by: doc.startedBy ?? null,
      }).select().single();
      if (error?.code === '23505') throw placeTaken('round');
      if (error) fail('addWheelRound')(error);
      return outRound(data);
    },

    async updateWheelRound(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, { presentOnly: 'present_only', noRepeat: 'no_repeat' });
      if (!Object.keys(set).length) return null;
      const { data, error } = await db.from('wheel_rounds').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateWheelRound')(error);
      return outRound(data);
    },

    async listWheelPicks(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listWheelPicks', 'wheel_picks', (q) => q.eq('session_id', sessionId), ['round', 'pick_order'], outPick);
    },

    async addWheelPick(doc) {
      const { data, error } = await db.from('wheel_picks').insert({
        session_id: doc.sessionId,
        round: doc.round,
        pick_order: doc.order,
        roll_no: doc.rollNo,
        class_student_id: doc.classStudentId ?? null,
        pool_size: doc.poolSize,
        present_only: doc.presentOnly,
        no_repeat: doc.noRepeat,
        ask: doc.ask ?? 'bank',
        question_id: doc.questionId ?? null,
        status: doc.status ?? 'pending',
        picked_at: doc.pickedAt ?? new Date().toISOString(),
        picked_by: doc.pickedBy ?? null,
      }).select().single();
      if (error?.code === '23505') throw placeTaken('place on the wheel');
      if (error) fail('addWheelPick')(error);
      return outPick(data);
    },

    async updateWheelPick(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, { ask: 'ask', questionId: 'question_id', status: 'status', statusAt: 'status_at', statusBy: 'status_by' });
      if (!Object.keys(set).length) return null;
      const { data, error } = await db.from('wheel_picks').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateWheelPick')(error);
      return outPick(data);
    },

    async listTallies(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listTallies', 'hand_tallies', (q) => q.eq('session_id', sessionId), ['seq'], outTally);
    },

    async addTally(doc) {
      const now = new Date().toISOString();
      const { data, error } = await db.from('hand_tallies').insert({
        session_id: doc.sessionId,
        seq: doc.seq,
        question_id: doc.questionId ?? null,
        question_text: doc.text,
        option_labels: doc.labels ?? ['', '', '', ''],
        counts: doc.counts ?? [0, 0, 0, 0],
        revealed: doc.revealed === true,
        correct_option: doc.correct ?? null,
        created_at: doc.createdAt ?? now,
        created_by: doc.createdBy ?? null,
        updated_at: doc.updatedAt ?? now,
      }).select().single();
      if (error?.code === '23505') throw placeTaken('place in the room\'s questions');
      if (error) fail('addTally')(error);
      return outTally(data);
    },

    async updateTally(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, {
        questionId: 'question_id', text: 'question_text', labels: 'option_labels', counts: 'counts',
        revealed: 'revealed', correct: 'correct_option', updatedAt: 'updated_at',
      });
      if (!Object.keys(set).length) return null;
      const { data, error } = await db.from('hand_tallies').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateTally')(error);
      return outTally(data);
    },

    async listActivities(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listActivities', 'room_activities', (q) => q.eq('session_id', sessionId), ['seq'], outActivity);
    },

    async addActivity(doc) {
      const now = new Date().toISOString();
      const { data, error } = await db.from('room_activities').insert({
        session_id: doc.sessionId,
        seq: doc.seq,
        kind: doc.kind,
        outcome: doc.outcome ?? '',
        groups: doc.groups ?? [],
        tally_id: doc.tallyId ?? null,
        // Written only for an activity a suggestion became (Batch 8, 0034), so
        // a database without the column still records every other activity.
        ...(doc.suggestionId ? { suggestion_id: doc.suggestionId } : {}),
        created_at: doc.createdAt ?? now,
        created_by: doc.createdBy ?? null,
        updated_at: doc.updatedAt ?? now,
      }).select().single();
      if (error?.code === '23505') throw placeTaken('place in the room\'s activities');
      if (error) fail('addActivity')(error);
      return outActivity(data);
    },

    async updateActivity(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, { outcome: 'outcome', groups: 'groups', tallyId: 'tally_id', updatedAt: 'updated_at' });
      if (!Object.keys(set).length) return null;
      const { data, error } = await db.from('room_activities').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateActivity')(error);
      return outActivity(data);
    },

    // Append-only, like observations.
    async addInsightAction(doc) {
      const row = unwrap('addInsightAction', await db
        .from('insight_actions')
        .insert({
          session_id: doc.sessionId,
          flag_id: doc.flagId,
          action: doc.action,
          note: doc.note ?? '',
          acted_by: doc.actedBy ?? null,
          acted_at: doc.actedAt ?? new Date().toISOString(),
        })
        .select()
        .single());
      return outInsightAction(row);
    },

    async listInsightActions(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listInsightActions', 'insight_actions', (q) => q.eq('session_id', sessionId), ['acted_at', 'id'], outInsightAction);
    },

    // -- projector links (0018; see memoryRepo for the contract) --
    async addProjectorLink(doc) {
      const { data, error } = await db.from('projector_links').insert({
        session_id: doc.sessionId,
        token_hash: doc.tokenHash,
        created_at: doc.createdAt ?? new Date().toISOString(),
        created_by: doc.createdBy ?? null,
      }).select().single();
      if (error?.code === '23505') throw placeTaken('projector token');
      if (error) fail('addProjectorLink')(error);
      return outProjectorLink(data);
    },

    async getProjectorLinkByHash(tokenHash) {
      const { data, error } = await db.from('projector_links').select('*').eq('token_hash', String(tokenHash)).maybeSingle();
      if (error) fail('getProjectorLinkByHash')(error);
      return outProjectorLink(data);
    },

    async listProjectorLinks(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listProjectorLinks', 'projector_links', (q) => q.eq('session_id', sessionId), ['created_at', 'id'], outProjectorLink);
    },

    async revokeProjectorLink(id, { revokedAt, revokedBy = null }) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('projector_links')
        .update({ revoked_at: revokedAt, revoked_by: revokedBy ?? null }).eq('id', id).select().maybeSingle();
      if (error) fail('revokeProjectorLink')(error);
      return outProjectorLink(data);
    },

    // -- course outcomes (0019; see memoryRepo for the contract) --
    async listOutcomes(classId) {
      if (!isUuid(classId)) return [];
      return allRecords('listOutcomes', 'course_outcomes', (q) => q.eq('class_id', classId), ['position', 'created_at', 'id'], outOutcome);
    },

    async getOutcome(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('course_outcomes').select('*').eq('id', id).maybeSingle();
      if (error) fail('getOutcome')(error);
      return outOutcome(data);
    },

    // 23505 on course_outcomes_class_code_key: another outcome of the class, not archived, holds the code.
    async createOutcome(doc) {
      const now = new Date().toISOString();
      const { data, error } = await db.from('course_outcomes').insert({
        class_id: doc.classId,
        code: doc.code,
        statement: doc.statement,
        target_level: doc.targetLevel ?? null,
        position: doc.position ?? 1,
        created_at: now,
        updated_at: now,
      }).select().single();
      if (error?.code === '23505') throw conflict(`${doc.code} is already a course outcome of this class.`);
      if (error) fail('createOutcome')(error);
      return outOutcome(data);
    },

    async updateOutcome(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, {
        code: 'code', statement: 'statement', targetLevel: 'target_level', position: 'position', archivedAt: 'archived_at',
      });
      // No updated_at trigger on the table, as for classes.
      set.updated_at = new Date().toISOString();
      const { data, error } = await db.from('course_outcomes').update(set).eq('id', id).select().maybeSingle();
      if (error?.code === '23505') throw conflict(`${patch.code ?? 'That code'} is already a course outcome of this class.`);
      if (error) fail('updateOutcome')(error);
      return outOutcome(data);
    },

    // Its topics go by ON DELETE CASCADE. An override still naming it is a
    // 23503 (0019's guard): the server takes it off the overrides first.
    async deleteOutcome(id) {
      if (!isUuid(id)) return false;
      const rows = unwrap('deleteOutcome', await db.from('course_outcomes').delete().eq('id', id).select('id'));
      return (rows ?? []).length > 0;
    },

    async listOutcomeTopics(classId) {
      if (!isUuid(classId)) return [];
      return allRecords('listOutcomeTopics', 'outcome_topics', (q) => q.eq('class_id', classId), ['created_at', 'id'], outOutcomeTopic);
    },

    // Not one statement: a topic the outcome keeps keeps its row (weight and
    // spelling updated), new ones are inserted, the rest deleted, in that order,
    // so a failure part way leaves extra mappings, never fewer.
    async setOutcomeTopics(outcomeId, classId, links) {
      if (!isUuid(outcomeId)) return [];
      const key = (l) => `${String(l.contentId ?? l.content_id).toLowerCase()}\u0000${String(l.topic).toLowerCase()}`;
      const current = unwrap('setOutcomeTopics', await db.from('outcome_topics').select('*').eq('outcome_id', outcomeId).limit(1000)) ?? [];
      const held = new Map(current.map((r) => [key(r), r]));
      const fresh = [];
      for (const l of links) {
        const prior = held.get(key(l));
        const weight = Number(l.weight) || 1;
        if (!prior) fresh.push({ outcome_id: outcomeId, class_id: classId, content_id: l.contentId, topic: l.topic, weight });
        else if (prior.topic !== l.topic || Number(prior.weight) !== weight) {
          unwrap('setOutcomeTopics', await db.from('outcome_topics').update({ topic: l.topic, weight }).eq('id', prior.id));
        }
      }
      if (fresh.length) unwrap('setOutcomeTopics', await db.from('outcome_topics').insert(fresh));
      const wanted = new Set(links.map(key));
      const gone = current.filter((r) => !wanted.has(key(r))).map((r) => r.id);
      if (gone.length) unwrap('setOutcomeTopics', await db.from('outcome_topics').delete().in('id', gone));
      const rows = unwrap('setOutcomeTopics', await db.from('outcome_topics').select('*').eq('outcome_id', outcomeId)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1000));
      return (rows ?? []).map(outOutcomeTopic);
    },

    async listQuestionOverrides(classId) {
      if (!isUuid(classId)) return [];
      return allRecords('listQuestionOverrides', 'question_outcome_overrides', (q) => q.eq('class_id', classId), ['id'], outOverride);
    },

    // ON CONFLICT (class_id, question_id) DO UPDATE: one override per question per class.
    async setQuestionOverride(doc) {
      const row = unwrap('setQuestionOverride', await db
        .from('question_outcome_overrides')
        .upsert({
          class_id: doc.classId,
          question_id: doc.questionId,
          outcome_ids: doc.excluded ? [] : (doc.outcomeIds ?? []),
          excluded: doc.excluded === true,
          updated_at: new Date().toISOString(),
          updated_by: doc.updatedBy ?? null,
        }, { onConflict: 'class_id,question_id' })
        .select()
        .single());
      return outOverride(row);
    },

    async deleteQuestionOverride(classId, questionId) {
      if (!isUuid(classId) || !isUuid(questionId)) return false;
      const rows = unwrap('deleteQuestionOverride', await db
        .from('question_outcome_overrides').delete().eq('class_id', classId).eq('question_id', questionId).select('id'));
      return (rows ?? []).length > 0;
    },

    // -- attainment formulas (0020; see memoryRepo for the contract) --
    async getAttainmentConfig(classId) {
      if (!isUuid(classId)) return null;
      const { data, error } = await db.from('attainment_configs').select('*').eq('class_id', classId)
        .order('version', { ascending: false }).limit(1).maybeSingle();
      if (error) fail('getAttainmentConfig')(error);
      return outAttainmentConfig(data);
    },

    // 23505 on attainment_configs_class_version_key: another save took the number first.
    async addAttainmentConfig(doc) {
      const { data, error } = await db.from('attainment_configs').insert({
        class_id: doc.classId,
        version: doc.version,
        config: doc.config,
        created_by: doc.createdBy ?? null,
      }).select().single();
      if (error?.code === '23505') {
        throw conflict('The attainment formula was changed by another request. Nothing was saved: read it again.');
      }
      if (error) fail('addAttainmentConfig')(error);
      return outAttainmentConfig(data);
    },

    // -- class questions (0023; see memoryRepo for the contract) --
    // 23505 on class_questions_one_running (another is not closed) or on
    // class_questions_session_seq_key (another request took the number).
    async addClassQuestion(doc) {
      const { data, error } = await db.from('class_questions').insert({
        session_id: doc.sessionId,
        seq: doc.seq,
        question_id: doc.questionId ?? null,
        question_snapshot: doc.questionSnapshot ?? {},
        state: doc.state ?? 'open',
        started_at: doc.startedAt ?? new Date().toISOString(),
        started_by: doc.startedBy ?? null,
      }).select().single();
      if (error?.code === '23505') {
        throw /one_running/.test(error.message ?? '')
          ? conflict('Another class question is still running in this room. Close it first.')
          : placeTaken('place in the room\'s class questions');
      }
      if (error) fail('addClassQuestion')(error);
      return outClassQuestion(data);
    },

    async getClassQuestion(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('class_questions').select('*').eq('id', id).maybeSingle();
      if (error) fail('getClassQuestion')(error);
      return outClassQuestion(data);
    },

    async listClassQuestions(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listClassQuestions', 'class_questions', (q) => q.eq('session_id', sessionId), ['seq'], outClassQuestion);
    },

    async updateClassQuestion(id, patch) {
      if (!isUuid(id)) return null;
      const set = pick(patch, {
        state: 'state', revealed: 'revealed', pausedAt: 'paused_at', revoteAt: 'revote_at', closedAt: 'closed_at', closedBy: 'closed_by',
      });
      if (Object.keys(set).length === 0) return this.getClassQuestion(id);
      const { data, error } = await db.from('class_questions').update(set).eq('id', id).select().maybeSingle();
      if (error) fail('updateClassQuestion')(error);
      return outClassQuestion(data);
    },

    // ---- Phase 6: the hub's content backbone (0025; see memoryRepo for the contract) ----
    ...(() => {
      const outUnit = (r) => r && {
        _id: r.id, classId: r.class_id, name: r.name, position: r.position,
        createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
      };
      const outPlacement = (r) => r && {
        _id: r.id, classId: r.class_id, contentId: r.content_id, unitId: r.unit_id ?? null, position: r.position,
        addedBy: r.added_by ?? null, addedAt: r.added_at,
      };
      const outTopic = (r) => r && {
        _id: r.id, contentId: r.content_id, name: r.name, key: r.key, position: r.position,
        retiredAt: r.retired_at ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
      };
      const outLink = (r) => r && {
        _id: r.id, ownerId: r.owner_id ?? null, prerequisiteId: r.prerequisite_id, topicId: r.topic_id,
        provenance: r.provenance, state: r.state, reason: r.reason ?? '', model: r.model ?? null,
        createdBy: r.created_by ?? null, createdAt: r.created_at, decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null,
      };
      const one = async (op, table, id, out) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
        if (error) fail(op)(error);
        return out(data);
      };
      const unitTaken = (name) => conflict(`There is already a unit called "${name}" in this class.`);
      return {
        async listClassUnits(classId) {
          if (!isUuid(classId)) return [];
          return allRecords('listClassUnits', 'class_units', (q) => q.eq('class_id', classId), ['position', 'created_at', 'id'], outUnit);
        },
        async getClassUnit(id) {
          return one('getClassUnit', 'class_units', id, outUnit);
        },
        // 23505 on class_units_class_name_key: the class has a unit of that name.
        async createClassUnit(doc) {
          const { data, error } = await db.from('class_units').insert({
            class_id: doc.classId, name: doc.name, position: doc.position ?? 1, created_by: doc.createdBy ?? null,
          }).select().single();
          if (error?.code === '23505') throw unitTaken(doc.name);
          if (error) fail('createClassUnit')(error);
          return outUnit(data);
        },
        async updateClassUnit(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, { name: 'name', position: 'position' });
          set.updated_at = new Date().toISOString();
          const { data, error } = await db.from('class_units').update(set).eq('id', id).select().maybeSingle();
          if (error?.code === '23505') throw unitTaken(patch.name);
          if (error) fail('updateClassUnit')(error);
          return outUnit(data);
        },
        // Its chapters go to no unit by ON DELETE SET NULL.
        async deleteClassUnit(id) {
          if (!isUuid(id)) return false;
          const rows = unwrap('deleteClassUnit', await db.from('class_units').delete().eq('id', id).select('id'));
          return (rows ?? []).length > 0;
        },
        async listClassChapters(classId) {
          if (!isUuid(classId)) return [];
          return allRecords('listClassChapters', 'class_chapters', (q) => q.eq('class_id', classId), ['position', 'added_at', 'id'], outPlacement);
        },
        // 23505 on class_chapters_class_content_key: already on the class.
        async placeClassChapter(doc) {
          const { data, error } = await db.from('class_chapters').insert({
            class_id: doc.classId, content_id: doc.contentId, unit_id: doc.unitId ?? null, position: doc.position ?? 1,
            added_by: doc.addedBy ?? null,
          }).select().single();
          if (error?.code === '23505') throw conflict('That chapter is already on this class.');
          if (error) fail('placeClassChapter')(error);
          return outPlacement(data);
        },
        async updateClassChapter(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, { unitId: 'unit_id', position: 'position' });
          if (Object.keys(set).length === 0) return one('updateClassChapter', 'class_chapters', id, outPlacement);
          const { data, error } = await db.from('class_chapters').update(set).eq('id', id).select().maybeSingle();
          if (error) fail('updateClassChapter')(error);
          return outPlacement(data);
        },
        async removeClassChapter(classId, contentId) {
          if (!isUuid(classId) || !isUuid(contentId)) return false;
          const rows = unwrap('removeClassChapter', await db.from('class_chapters').delete()
            .eq('class_id', classId).eq('content_id', contentId).select('id'));
          return (rows ?? []).length > 0;
        },
        async listChapterTopics(contentId) {
          if (!isUuid(contentId)) return [];
          return allRecords('listChapterTopics', 'chapter_topics', (q) => q.eq('content_id', contentId), ['position', 'created_at', 'id'], outTopic);
        },
        async getChapterTopic(id) {
          return one('getChapterTopic', 'chapter_topics', id, outTopic);
        },
        async listChapterTopicsByIds(ids = []) {
          const wanted = [...new Set(ids.map(String).filter(isUuid))];
          const out = [];
          for (let i = 0; i < wanted.length; i += 200) {
            const rows = unwrap('listChapterTopicsByIds', await db.from('chapter_topics').select('*').in('id', wanted.slice(i, i + 200)));
            out.push(...(rows ?? []).map(outTopic));
          }
          return out;
        },
        // ON CONFLICT (content_id, key) DO NOTHING: only the rows added come back.
        async addChapterTopics(contentId, docs = []) {
          if (!docs.length) return [];
          const rows = unwrap('addChapterTopics', await db.from('chapter_topics').upsert(
            docs.map((d) => ({ content_id: contentId, name: d.name, key: d.key, position: d.position ?? 1 })),
            { onConflict: 'content_id,key', ignoreDuplicates: true },
          ).select());
          return (rows ?? []).map(outTopic);
        },
        async updateChapterTopic(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, { name: 'name', position: 'position', retiredAt: 'retired_at' });
          if (patch.name !== undefined) set.key = String(patch.name).toLowerCase();
          set.updated_at = new Date().toISOString();
          const { data, error } = await db.from('chapter_topics').update(set).eq('id', id).select().maybeSingle();
          if (error) fail('updateChapterTopic')(error);
          return outTopic(data);
        },
        // Its links go by ON DELETE CASCADE; the server deletes only a record nothing hangs off.
        async deleteChapterTopic(id) {
          if (!isUuid(id)) return false;
          const rows = unwrap('deleteChapterTopic', await db.from('chapter_topics').delete().eq('id', id).select('id'));
          return (rows ?? []).length > 0;
        },
        async listTopicLinks(filter = {}) {
          const ids = Array.isArray(filter.topicIds) ? filter.topicIds.map(String).filter(isUuid) : null;
          if (ids && !ids.length) return [];
          return allRecords('listTopicLinks', 'topic_links', (q) => {
            let r = q;
            if ('ownerId' in filter) r = filter.ownerId == null ? r.is('owner_id', null) : r.eq('owner_id', filter.ownerId);
            if (ids) {
              const list = ids.map(postgrestQuote).join(',');
              r = r.or(`prerequisite_id.in.(${list}),topic_id.in.(${list})`);
            }
            return r;
          }, ['created_at', 'id'], outLink);
        },
        async getTopicLink(id) {
          return one('getTopicLink', 'topic_links', id, outLink);
        },
        // 23505 on topic_links_pair_key: those two topics are already linked.
        async addTopicLink(doc) {
          const { data, error } = await db.from('topic_links').insert({
            owner_id: doc.ownerId ?? null,
            prerequisite_id: doc.prerequisiteId,
            topic_id: doc.topicId,
            provenance: doc.provenance,
            state: doc.state,
            reason: doc.reason ?? '',
            model: doc.model ?? null,
            created_by: doc.createdBy ?? null,
            decided_at: doc.decidedAt ?? null,
            decided_by: doc.decidedBy ?? null,
          }).select().single();
          if (error?.code === '23505') throw conflict('Those two topics are already linked.');
          if (error) fail('addTopicLink')(error);
          return outLink(data);
        },
        async updateTopicLink(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, { state: 'state', decidedAt: 'decided_at', decidedBy: 'decided_by' });
          if (Object.keys(set).length === 0) return one('updateTopicLink', 'topic_links', id, outLink);
          const { data, error } = await db.from('topic_links').update(set).eq('id', id).select().maybeSingle();
          if (error) fail('updateTopicLink')(error);
          return outLink(data);
        },
        async deleteTopicLink(id) {
          if (!isUuid(id)) return false;
          const rows = unwrap('deleteTopicLink', await db.from('topic_links').delete().eq('id', id).select('id'));
          return (rows ?? []).length > 0;
        },
        // Its own statement, after the chapter is made: without 0025 this one
        // write fails and the caller carries on (routes/content.js).
        async setContentSlideTexts(contentId, slideTexts) {
          if (!isUuid(contentId)) return null;
          const { data, error } = await db.from('contents').update({ slide_texts: slideTexts }).eq('id', contentId).select().maybeSingle();
          if (error) fail('setContentSlideTexts')(error);
          return outContent(data);
        },
      };
    })(),

    // ---- Phase 6: practice, mastery, the error log and reviews (0026; see memoryRepo for the contract) ----
    ...(() => {
      const outAttempt = (r) => r && {
        _id: r.id,
        accountId: r.account_id,
        clientAttemptId: r.client_attempt_id,
        classId: r.class_id ?? null,
        contentId: r.content_id ?? null,
        topicId: r.topic_id ?? null,
        topic: r.topic ?? '',
        questionId: r.question_id ?? null,
        bloom: r.bloom,
        kind: r.kind ?? 'mcq',
        questionSnapshot: r.question_snapshot ?? {},
        questionSource: r.question_source ?? 'llm',
        response: r.response ?? null,
        // Null only for a drawing (0037), which nobody marks in the hub.
        correct: r.correct == null ? null : r.correct === true,
        score: r.score == null ? null : Number(r.score),
        detail: r.detail ?? '',
        reviewStatus: r.review_status ?? 'auto',
        mode: r.mode,
        language: r.language ?? 'en',
        hintsUsed: Number(r.hints_used) || 0,
        timeTakenMs: r.time_taken_ms == null ? null : Number(r.time_taken_ms),
        // 0028's column; a database without it reads as no run.
        runId: r.run_id ?? null,
        // 0036 (Batch 8): kept without proof the hub served the question. A
        // database without the column reads as proven, as every answer was before.
        unproven: r.unproven === true,
        createdAt: r.created_at,
      };
      const outExplanation = (r) => r && {
        _id: r.id,
        questionId: r.question_id,
        text: r.text,
        provenance: r.provenance,
        status: r.status,
        model: r.model ?? null,
        sourceRef: r.source_ref ?? null,
        createdBy: r.created_by ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        approvedBy: r.approved_by ?? null,
        approvedAt: r.approved_at ?? null,
      };
      // Ids in one `in` filter, at most this many a request: a URL holds only so many.
      const CHUNK = 100;
      const byTime = (a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt))
        || String(a.createdAt).localeCompare(String(b.createdAt)) || String(a._id).localeCompare(String(b._id));
      return {
        // 23505 on hub_attempts_account_attempt_key: the stored row, never a second.
        async addHubAttempt(doc) {
          const { data, error } = await db.from('hub_attempts').insert({
            account_id: doc.accountId,
            client_attempt_id: doc.clientAttemptId,
            class_id: doc.classId ?? null,
            content_id: doc.contentId ?? null,
            topic_id: doc.topicId ?? null,
            topic: doc.topic ?? '',
            question_id: doc.questionId ?? null,
            bloom: doc.bloom,
            kind: doc.kind ?? 'mcq',
            question_snapshot: doc.questionSnapshot ?? {},
            question_source: doc.questionSource ?? 'llm',
            response: doc.response ?? null,
            // Null only for a drawing (0037); every other attempt is marked.
            correct: doc.correct === null && doc.kind === 'drawing' ? null : doc.correct === true,
            score: doc.score,
            detail: doc.detail ?? '',
            review_status: doc.reviewStatus ?? 'auto',
            mode: doc.mode,
            language: doc.language ?? 'en',
            hints_used: doc.hintsUsed ?? 0,
            time_taken_ms: doc.timeTakenMs ?? null,
            // Sent only when there is one, so practice still saves on a database without 0028.
            ...(doc.runId ? { run_id: doc.runId } : {}),
            // Sent only when set, so a proven answer still saves on a database without 0036.
            ...(doc.unproven ? { unproven: true } : {}),
            created_at: doc.createdAt ?? new Date().toISOString(),
          }).select().single();
          if (!error) return { attempt: outAttempt(data), duplicate: false };
          if (error.code === '23505') {
            const held = await this.getHubAttemptByKey(doc.accountId, doc.clientAttemptId);
            if (held) return { attempt: held, duplicate: true };
          }
          return fail('addHubAttempt')(error);
        },
        async getHubAttemptByKey(accountId, clientAttemptId) {
          if (!isUuid(accountId)) return null;
          const { data, error } = await db.from('hub_attempts').select('*')
            .eq('account_id', accountId).eq('client_attempt_id', String(clientAttemptId)).maybeSingle();
          if (error) fail('getHubAttemptByKey')(error);
          return outAttempt(data);
        },
        // The longest id list is sent in chunks and the pages merged in time order.
        async listHubAttempts({ accountId, accountIds, topicIds, questionIds, runIds, since } = {}) {
          const lists = { account_id: accountIds, topic_id: topicIds, question_id: questionIds, run_id: runIds };
          const clean = {};
          for (const [col, v] of Object.entries(lists)) {
            if (!Array.isArray(v)) continue;
            clean[col] = [...new Set(v.map(String).filter(isUuid))];
            if (!clean[col].length) return [];
          }
          if (accountId && !isUuid(accountId)) return [];
          const longest = Object.keys(clean).sort((a, b) => clean[b].length - clean[a].length)[0];
          const parts = [];
          const chunks = longest ? Array.from({ length: Math.ceil(clean[longest].length / CHUNK) },
            (_, i) => clean[longest].slice(i * CHUNK, (i + 1) * CHUNK)) : [null];
          for (const chunk of chunks) {
            parts.push(...await allRecords('listHubAttempts', 'hub_attempts', (q) => {
              let r = q;
              if (accountId) r = r.eq('account_id', accountId);
              for (const [col, ids] of Object.entries(clean)) r = r.in(col, col === longest ? chunk : ids);
              if (since) r = r.gte('created_at', since);
              return r;
            }, ['created_at', 'id'], outAttempt));
          }
          return chunks.length > 1 ? parts.sort(byTime) : parts;
        },
        async getQuestionExplanation(questionId) {
          if (!isUuid(questionId)) return null;
          const { data, error } = await db.from('question_explanations').select('*').eq('question_id', questionId).maybeSingle();
          if (error) fail('getQuestionExplanation')(error);
          return outExplanation(data);
        },
        async listQuestionExplanations(questionIds = []) {
          const ids = [...new Set(questionIds.map(String).filter(isUuid))];
          const out = [];
          for (let i = 0; i < ids.length; i += CHUNK) {
            const rows = unwrap('listQuestionExplanations', await db.from('question_explanations').select('*')
              .in('question_id', ids.slice(i, i + CHUNK)));
            out.push(...(rows ?? []).map(outExplanation));
          }
          return out;
        },
        // 23505 on question_explanations_question_key: it already has one.
        async addQuestionExplanation(doc) {
          const { data, error } = await db.from('question_explanations').insert({
            question_id: doc.questionId,
            text: doc.text,
            provenance: doc.provenance,
            status: doc.status ?? 'draft',
            model: doc.model ?? null,
            source_ref: doc.sourceRef ?? null,
            created_by: doc.createdBy ?? null,
            approved_by: doc.approvedBy ?? null,
            approved_at: doc.approvedAt ?? null,
          }).select().single();
          if (error?.code === '23505') throw conflict('That question already has an explanation.');
          if (error) fail('addQuestionExplanation')(error);
          return outExplanation(data);
        },
        async updateQuestionExplanation(questionId, patch) {
          if (!isUuid(questionId)) return null;
          const set = pick(patch, {
            text: 'text', provenance: 'provenance', status: 'status', model: 'model', sourceRef: 'source_ref',
            approvedBy: 'approved_by', approvedAt: 'approved_at',
          });
          set.updated_at = new Date().toISOString();
          const { data, error } = await db.from('question_explanations').update(set).eq('question_id', questionId).select().maybeSingle();
          if (error) fail('updateQuestionExplanation')(error);
          return outExplanation(data);
        },
        async deleteQuestionExplanation(questionId) {
          if (!isUuid(questionId)) return false;
          const rows = unwrap('deleteQuestionExplanation', await db.from('question_explanations').delete()
            .eq('question_id', questionId).select('id'));
          return (rows ?? []).length > 0;
        },
      };
    })(),

    // ---- Phase 6: lessons and languages (0027; see memoryRepo for the contract) ----
    ...(() => {
      const outLesson = (r) => r && {
        _id: r.id, topicId: r.topic_id, contentId: r.content_id, ownerId: r.owner_id ?? null, version: r.version,
        status: r.status, source: r.source, model: r.model ?? null,
        steps: Array.isArray(r.steps) ? r.steps : [], basis: r.basis ?? {}, warnings: Array.isArray(r.warnings) ? r.warnings : [],
        createdAt: r.created_at, createdBy: r.created_by ?? null, approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null,
        retiredAt: r.retired_at ?? null, retiredBy: r.retired_by ?? null,
        // 0035 (Batch 8): the concept panel's sections, or null (none, or no column yet).
        sections: r.sections && typeof r.sections === 'object' ? r.sections : null,
      };
      const outTranslation = (r) => r && {
        _id: r.id, itemKind: r.item_kind, itemId: r.item_id, contentId: r.content_id, ownerId: r.owner_id ?? null,
        language: r.language, fields: r.fields ?? {}, sourceFields: r.source_fields ?? {}, sourceHash: r.source_hash,
        status: r.status, provenance: r.provenance, model: r.model ?? null, checks: Array.isArray(r.checks) ? r.checks : [],
        createdAt: r.created_at, createdBy: r.created_by ?? null, updatedAt: r.updated_at, editedBy: r.edited_by ?? null,
        approvedAt: r.approved_at ?? null, approvedBy: r.approved_by ?? null, retiredAt: r.retired_at ?? null, retiredBy: r.retired_by ?? null,
      };
      const one = async (op, table, id, out) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
        if (error) fail(op)(error);
        return out(data);
      };
      // 23514 from approve_topic_lesson / approve_item_translation: not a draft.
      const notDraft = (what, error) => {
        const now = / is (\w+)$/.exec(error?.message ?? '')?.[1];
        return conflict(`Only a draft ${what} can be approved or discarded${now ? `; this one is ${now}` : ''}.`);
      };
      // A draft discarded with a plain update, where it is still a draft;
      // null when there is no such row, 409 when it is no longer a draft.
      const discard = async (op, table, id, by, out, what) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table)
          .update({ status: 'discarded', retired_at: new Date().toISOString(), retired_by: by ?? null })
          .eq('id', id).eq('status', 'draft').select().maybeSingle();
        if (error) fail(op)(error);
        if (data) return out(data);
        const now = await one(op, table, id, out);
        if (!now) return null;
        throw conflict(`Only a draft ${what} can be approved or discarded; this one is ${now.status}.`);
      };
      return {
        // 23505 on topic_lessons_topic_version_key: another version took the number.
        async createTopicLesson(doc) {
          const { data, error } = await db.from('topic_lessons').insert({
            topic_id: doc.topicId, content_id: doc.contentId, owner_id: doc.ownerId ?? null, version: doc.version,
            source: doc.source, model: doc.model ?? null, steps: doc.steps, basis: doc.basis ?? {}, warnings: doc.warnings ?? [],
            created_by: doc.createdBy ?? null,
            // 0035 (Batch 8): only when there are sections, so a slides-only lesson
            // saves on a database without the column.
            ...(doc.sections ? { sections: doc.sections } : {}),
          }).select().single();
          if (error?.code === '23505') throw conflict('Another version of this lesson was written at the same time. Nothing was changed; try again.');
          if (error) fail('createTopicLesson')(error);
          return outLesson(data);
        },
        async getTopicLesson(id) {
          return one('getTopicLesson', 'topic_lessons', id, outLesson);
        },
        async listTopicLessons(filter = {}) {
          if (filter.topicId !== undefined && !isUuid(filter.topicId)) return [];
          if (filter.contentId !== undefined && !isUuid(filter.contentId)) return [];
          return allRecords('listTopicLessons', 'topic_lessons', (q) => {
            let r = q;
            if (filter.topicId !== undefined) r = r.eq('topic_id', filter.topicId);
            if (filter.contentId !== undefined) r = r.eq('content_id', filter.contentId);
            return r;
          }, ['topic_id', 'version'], outLesson);
        },
        // One statement (approve_topic_lesson, 0027): the topic is never left with none approved.
        async approveTopicLesson(id, { by = null } = {}) {
          if (!isUuid(id)) return null;
          const { data, error } = await db.rpc('approve_topic_lesson', { p_lesson: id, p_by: by ?? null });
          if (error?.code === '23514') throw notDraft('lesson', error);
          if (error) fail('approveTopicLesson')(error);
          return outLesson(Array.isArray(data) ? data[0] ?? null : data);
        },
        async discardTopicLesson(id, { by = null } = {}) {
          return discard('discardTopicLesson', 'topic_lessons', id, by, outLesson, 'lesson');
        },
        async addItemTranslation(doc) {
          const { data, error } = await db.from('item_translations').insert({
            item_kind: doc.itemKind, item_id: doc.itemId, content_id: doc.contentId, owner_id: doc.ownerId ?? null,
            language: doc.language, fields: doc.fields, source_fields: doc.sourceFields, source_hash: doc.sourceHash,
            provenance: doc.provenance, model: doc.model ?? null, checks: doc.checks ?? [], created_by: doc.createdBy ?? null,
          }).select().single();
          if (error) fail('addItemTranslation')(error);
          return outTranslation(data);
        },
        async getItemTranslation(id) {
          return one('getItemTranslation', 'item_translations', id, outTranslation);
        },
        async listItemTranslations(filter = {}) {
          const ids = Array.isArray(filter.itemIds) ? [...new Set(filter.itemIds.map(String).filter(isUuid))] : null;
          if (ids && !ids.length) return [];
          if (filter.contentId !== undefined && !isUuid(filter.contentId)) return [];
          const statuses = filter.status === undefined ? null : [].concat(filter.status);
          const read = (slice) => allRecords('listItemTranslations', 'item_translations', (q) => {
            let r = q;
            if (filter.contentId !== undefined) r = r.eq('content_id', filter.contentId);
            if (filter.itemKind !== undefined) r = r.eq('item_kind', filter.itemKind);
            if (slice) r = r.in('item_id', slice);
            if (filter.language !== undefined) r = r.eq('language', filter.language);
            if (statuses) r = r.in('status', statuses);
            return r;
          }, ['created_at', 'id'], outTranslation);
          if (!ids) return read(null);
          const out = [];
          for (let i = 0; i < ids.length; i += 200) out.push(...await read(ids.slice(i, i + 200)));
          return out;
        },
        // Where it is still a draft (0027's guard refuses any other).
        async editItemTranslation(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, {
            fields: 'fields', sourceFields: 'source_fields', sourceHash: 'source_hash', checks: 'checks', provenance: 'provenance', editedBy: 'edited_by',
          });
          set.updated_at = new Date().toISOString();
          const { data, error } = await db.from('item_translations').update(set).eq('id', id).eq('status', 'draft').select().maybeSingle();
          if (error) fail('editItemTranslation')(error);
          if (data) return outTranslation(data);
          const now = await one('editItemTranslation', 'item_translations', id, outTranslation);
          if (!now) return null;
          throw conflict(`Only a draft translation can be changed; this one is ${now.status}.`);
        },
        // One statement (approve_item_translation, 0027).
        async approveItemTranslation(id, { by = null } = {}) {
          if (!isUuid(id)) return null;
          const { data, error } = await db.rpc('approve_item_translation', { p_translation: id, p_by: by ?? null });
          if (error?.code === '23514') throw notDraft('translation', error);
          if (error) fail('approveItemTranslation')(error);
          return outTranslation(Array.isArray(data) ? data[0] ?? null : data);
        },
        async discardItemTranslation(id, { by = null } = {}) {
          return discard('discardItemTranslation', 'item_translations', id, by, outTranslation, 'translation');
        },
        async getLanguageChoice(accountId) {
          if (!isUuid(accountId)) return null;
          const { data, error } = await db.from('student_language_choices').select('language').eq('account_id', accountId).maybeSingle();
          if (error) fail('getLanguageChoice')(error);
          return data?.language ?? null;
        },
        async setLanguageChoice(accountId, language) {
          const { data, error } = await db.from('student_language_choices')
            .upsert({ account_id: accountId, language, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
            .select().single();
          if (error) fail('setLanguageChoice')(error);
          return { accountId: data.account_id, language: data.language, updatedAt: data.updated_at };
        },
      };
    })(),

    // ---- Phase 6: Get Ready, self-tests and goals (0028; see memoryRepo for the contract) ----
    ...(() => {
      const outRun = (r) => r && {
        _id: r.id,
        accountId: r.account_id,
        clientRunId: r.client_run_id,
        kind: r.kind,
        spec: r.spec ?? {},
        timeLimitSeconds: r.time_limit_seconds == null ? null : Number(r.time_limit_seconds),
        startedAt: r.started_at,
        deadlineAt: r.deadline_at ?? null,
        endedAt: r.ended_at ?? null,
        endReason: r.end_reason ?? null,
      };
      const outGoal = (r) => r && {
        _id: r.id,
        accountId: r.account_id,
        title: r.title ?? '',
        examDate: r.exam_date,
        topicIds: Array.isArray(r.topic_ids) ? r.topic_ids : [],
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
      const one = async (op, table, id, out) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
        if (error) fail(op)(error);
        return out(data);
      };
      return {
        // 23505 on hub_runs_account_run_key: the stored run, never a second.
        async addHubRun(doc) {
          const { data, error } = await db.from('hub_runs').insert({
            account_id: doc.accountId,
            client_run_id: doc.clientRunId,
            kind: doc.kind,
            spec: doc.spec ?? {},
            time_limit_seconds: doc.timeLimitSeconds ?? null,
            started_at: doc.startedAt ?? new Date().toISOString(),
            deadline_at: doc.deadlineAt ?? null,
            ended_at: doc.endedAt ?? null,
            end_reason: doc.endReason ?? null,
          }).select().single();
          if (!error) return { run: outRun(data), duplicate: false };
          if (error.code === '23505') {
            const held = await this.getHubRunByKey(doc.accountId, doc.clientRunId);
            if (held) return { run: held, duplicate: true };
          }
          return fail('addHubRun')(error);
        },
        async getHubRun(id) {
          return one('getHubRun', 'hub_runs', id, outRun);
        },
        async getHubRunByKey(accountId, clientRunId) {
          if (!isUuid(accountId)) return null;
          const { data, error } = await db.from('hub_runs').select('*')
            .eq('account_id', accountId).eq('client_run_id', String(clientRunId)).maybeSingle();
          if (error) fail('getHubRunByKey')(error);
          return outRun(data);
        },
        async listHubRuns({ accountId, ids, kind } = {}) {
          if (accountId && !isUuid(accountId)) return [];
          const clean = Array.isArray(ids) ? [...new Set(ids.map(String).filter(isUuid))] : null;
          if (clean && !clean.length) return [];
          const read = (slice) => allRecords('listHubRuns', 'hub_runs', (q) => {
            let r = q;
            if (accountId) r = r.eq('account_id', accountId);
            if (slice) r = r.in('id', slice);
            if (kind) r = r.eq('kind', kind);
            return r;
          }, ['started_at', 'id'], outRun);
          if (!clean) return read(null);
          const out = [];
          for (let i = 0; i < clean.length; i += 100) out.push(...await read(clean.slice(i, i + 100)));
          return out.sort((a, b) => (Date.parse(a.startedAt) - Date.parse(b.startedAt)) || String(a._id).localeCompare(String(b._id)));
        },
        // Where it has no end yet (0028's guard refuses any other change), so a
        // second end never overwrites the first; then the run as it stands.
        async endHubRun(id, { endedAt, endReason }) {
          if (!isUuid(id)) return null;
          const { data, error } = await db.from('hub_runs').update({ ended_at: endedAt, end_reason: endReason })
            .eq('id', id).is('ended_at', null).select().maybeSingle();
          if (error) fail('endHubRun')(error);
          return data ? outRun(data) : one('endHubRun', 'hub_runs', id, outRun);
        },
        async listHubGoals(accountId) {
          if (!isUuid(accountId)) return [];
          return allRecords('listHubGoals', 'hub_goals', (q) => q.eq('account_id', accountId), ['created_at', 'id'], outGoal);
        },
        async getHubGoal(id) {
          return one('getHubGoal', 'hub_goals', id, outGoal);
        },
        async addHubGoal(doc) {
          const { data, error } = await db.from('hub_goals').insert({
            account_id: doc.accountId, title: doc.title ?? '', exam_date: doc.examDate, topic_ids: doc.topicIds,
          }).select().single();
          if (error) fail('addHubGoal')(error);
          return outGoal(data);
        },
        async updateHubGoal(id, patch) {
          if (!isUuid(id)) return null;
          const set = pick(patch, { title: 'title', examDate: 'exam_date', topicIds: 'topic_ids' });
          set.updated_at = new Date().toISOString();
          const { data, error } = await db.from('hub_goals').update(set).eq('id', id).select().maybeSingle();
          if (error) fail('updateHubGoal')(error);
          return outGoal(data);
        },
        async deleteHubGoal(id) {
          if (!isUuid(id)) return false;
          const rows = unwrap('deleteHubGoal', await db.from('hub_goals').delete().eq('id', id).select('id'));
          return (rows ?? []).length > 0;
        },
      };
    })(),

    // ---- Phase 6: the tutor's hints and feedback (0029; see memoryRepo for the contract) ----
    ...(() => {
      const approval = (r) => ({
        provenance: r.provenance, status: r.status, model: r.model ?? null, sourceRef: r.source_ref ?? null,
        createdBy: r.created_by ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
        approvedBy: r.approved_by ?? null, approvedAt: r.approved_at ?? null,
      });
      const outHint = (r) => r && { _id: r.id, questionId: r.question_id, step: Number(r.step), text: r.text, ...approval(r) };
      const outFeedback = (r) => r && {
        _id: r.id, questionId: r.question_id, option: r.option, optionKey: r.option_key, text: r.text, ...approval(r),
      };
      const outView = (r) => r && {
        _id: r.id,
        accountId: r.account_id,
        clientAttemptId: r.client_attempt_id,
        questionId: r.question_id ?? null,
        topicId: r.topic_id ?? null,
        contentId: r.content_id ?? null,
        mode: r.mode,
        position: Number(r.position),
        kind: r.kind,
        hintId: r.hint_id ?? null,
        text: r.text,
        provenance: r.provenance,
        language: r.language ?? 'en',
        translationId: r.translation_id ?? null,
        sourceRef: r.source_ref ?? null,
        plan: r.plan ?? {},
        createdAt: r.created_at,
      };
      const APPROVAL_COLS = {
        text: 'text', provenance: 'provenance', status: 'status', model: 'model', sourceRef: 'source_ref',
        approvedBy: 'approved_by', approvedAt: 'approved_at',
      };
      const CHUNK = 100;
      const ofQuestions = async (op, table, questionIds, out) => {
        const ids = [...new Set(questionIds.map(String).filter(isUuid))];
        const rows = [];
        for (let i = 0; i < ids.length; i += CHUNK) {
          rows.push(...(unwrap(op, await db.from(table).select('*').in('question_id', ids.slice(i, i + CHUNK))
            .order('created_at', { ascending: true }).order('id', { ascending: true })) ?? []).map(out));
        }
        return rows;
      };
      const one = async (op, table, id, out) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table).select('*').eq('id', id).maybeSingle();
        if (error) fail(op)(error);
        return out(data);
      };
      const insert = async (op, table, row, out, message) => {
        const { data, error } = await db.from(table).insert(row).select().single();
        if (error?.code === '23505') throw conflict(message);
        if (error) fail(op)(error);
        return out(data);
      };
      const edit = async (op, table, id, set, out) => {
        if (!isUuid(id)) return null;
        const { data, error } = await db.from(table).update({ ...set, updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle();
        if (error) fail(op)(error);
        return out(data);
      };
      const remove = async (op, table, id) => {
        if (!isUuid(id)) return false;
        return (unwrap(op, await db.from(table).delete().eq('id', id).select('id')) ?? []).length > 0;
      };
      const approvalRow = (doc) => ({
        text: doc.text, provenance: doc.provenance, status: doc.status ?? 'draft', model: doc.model ?? null,
        source_ref: doc.sourceRef ?? null, created_by: doc.createdBy ?? null,
        approved_by: doc.approvedBy ?? null, approved_at: doc.approvedAt ?? null,
      });
      return {
        async listQuestionHints(questionIds = []) {
          return ofQuestions('listQuestionHints', 'question_hints', questionIds, outHint);
        },
        async getQuestionHint(id) {
          return one('getQuestionHint', 'question_hints', id, outHint);
        },
        // 23505 on question_hints_question_step_key: the step is taken.
        async addQuestionHint(doc) {
          return insert('addQuestionHint', 'question_hints', { question_id: doc.questionId, step: doc.step, ...approvalRow(doc) }, outHint,
            'That question already has a hint at this step.');
        },
        async updateQuestionHint(id, patch) {
          return edit('updateQuestionHint', 'question_hints', id, pick(patch, APPROVAL_COLS), outHint);
        },
        async deleteQuestionHint(id) {
          return remove('deleteQuestionHint', 'question_hints', id);
        },
        async listOptionFeedback(questionIds = []) {
          return ofQuestions('listOptionFeedback', 'option_feedback', questionIds, outFeedback);
        },
        async getOptionFeedback(id) {
          return one('getOptionFeedback', 'option_feedback', id, outFeedback);
        },
        // 23505 on option_feedback_question_option_key: the option has feedback.
        async addOptionFeedback(doc) {
          return insert('addOptionFeedback', 'option_feedback', {
            question_id: doc.questionId, option: doc.option, option_key: doc.optionKey, ...approvalRow(doc),
          }, outFeedback, 'That option already has feedback.');
        },
        async updateOptionFeedback(id, patch) {
          return edit('updateOptionFeedback', 'option_feedback', id, pick(patch, { option: 'option', ...APPROVAL_COLS }), outFeedback);
        },
        async deleteOptionFeedback(id) {
          return remove('deleteOptionFeedback', 'option_feedback', id);
        },
        // 23505 on hub_hint_views_attempt_position_key: the stored row, never a second.
        async addHintView(doc) {
          const { data, error } = await db.from('hub_hint_views').insert({
            account_id: doc.accountId,
            client_attempt_id: doc.clientAttemptId,
            question_id: doc.questionId ?? null,
            topic_id: doc.topicId ?? null,
            content_id: doc.contentId ?? null,
            mode: doc.mode,
            position: doc.position,
            kind: doc.kind,
            hint_id: doc.hintId ?? null,
            text: doc.text,
            provenance: doc.provenance,
            language: doc.language ?? 'en',
            translation_id: doc.translationId ?? null,
            source_ref: doc.sourceRef ?? null,
            plan: doc.plan ?? {},
          }).select().single();
          if (!error) return { view: outView(data), duplicate: false };
          if (error.code === '23505') {
            const { data: held, error: again } = await db.from('hub_hint_views').select('*')
              .eq('account_id', doc.accountId).eq('client_attempt_id', String(doc.clientAttemptId)).eq('position', doc.position).maybeSingle();
            if (again) fail('addHintView')(again);
            if (held) return { view: outView(held), duplicate: true };
          }
          return fail('addHintView')(error);
        },
        async listHintViews({ accountId, clientAttemptId, questionIds } = {}) {
          if (accountId && !isUuid(accountId)) return [];
          const ids = Array.isArray(questionIds) ? [...new Set(questionIds.map(String).filter(isUuid))] : null;
          if (ids && !ids.length) return [];
          const read = (slice) => allRecords('listHintViews', 'hub_hint_views', (q) => {
            let r = q;
            if (accountId) r = r.eq('account_id', accountId);
            if (clientAttemptId) r = r.eq('client_attempt_id', String(clientAttemptId));
            if (slice) r = r.in('question_id', slice);
            return r;
          }, ['created_at', 'position', 'id'], outView);
          if (!ids) return read(null);
          const out = [];
          for (let i = 0; i < ids.length; i += CHUNK) out.push(...await read(ids.slice(i, i + CHUNK)));
          return ids.length > CHUNK ? out.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)) : out;
        },
      };
    })(),
    // ---- Phase 7: question packs ----
    // See memoryRepo for the contract (question_packs, 0030). Written once: the
    // table's trigger refuses an update, and a delete except with the room.

    async addQuestionPack(doc) {
      const { data, error } = await db.from('question_packs').insert({
        session_id: doc.sessionId,
        roll_no: String(doc.rollNo),
        question_ids: (doc.questionIds ?? []).map(String),
        issued_at: doc.issuedAt ?? new Date().toISOString(),
        expires_at: doc.expiresAt,
      }).select().single();
      // 23514: 0030's checks (1 to 20 questions, none null, an expiry after the issue).
      if (error?.code === '23514') {
        throw Object.assign(new Error('A question pack holds 1 to 20 questions and expires after it is sent.'), { status: 400 });
      }
      if (error) fail('addQuestionPack')(error);
      return outQuestionPack(data);
    },

    async listQuestionPacks(sessionId, rollNo) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listQuestionPacks', 'question_packs',
        (q) => q.eq('session_id', sessionId).eq('roll_no', String(rollNo)), ['issued_at', 'id'], outQuestionPack);
    },

    // ---- Phase 7: laptop mode and room imports ----
    // See memoryRepo for the contract. room_imports is 0031. PostgREST runs no
    // transaction across calls, so the room is written table by table and, on
    // any failure after the session row, deleted again: its rows go with it by
    // ON DELETE CASCADE, which 0012's guards allow.

    async importRoom({ record, session, classQuestions = [], profiles = [], answers = [], reviews = [], attendance = [] }) {
      const exists = (code, message) => Object.assign(new Error(message), { code });
      const CHUNK = 500;
      const chunks = (list) => Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK));
      const { data: made, error } = await db.from('sessions').insert({
        code: session.code,
        content_id: session.contentId,
        title: session.title ?? '',
        status: session.status ?? 'closed',
        owner_id: session.ownerId ?? null,
        started_at: session.startedAt,
        closed_at: session.closedAt ?? null,
        paused_at: session.pausedAt ?? null,
        mastery_goal: session.masteryGoal,
        reattempts: session.reattempts,
        redemption: session.redemption,
        question_ids: Array.isArray(session.questionIds) ? session.questionIds : null,
        class_id: session.classId ?? null,
        mode: session.mode ?? 'devices',
        adapt: session.adapt !== false,
        start_level: session.startLevel ?? 'understand',
        questions_per_student: session.questionsPerStudent ?? null,
        time_per_question: session.timePerQuestion ?? null,
      }).select().single();
      if (error?.code === '23505') throw exists('CODE_TAKEN', `A room with the code ${session.code} already exists.`);
      if (error) fail('importRoom')(error);
      const sessionId = made.id;
      try {
        const cqIds = new Map();
        if (classQuestions.length) {
          const rows = unwrap('importRoom', await db.from('class_questions').insert(classQuestions.map((c) => ({
            session_id: sessionId,
            seq: c.seq,
            question_id: c.questionId ?? null,
            question_snapshot: c.questionSnapshot ?? {},
            state: c.state,
            revealed: c.revealed === true,
            started_at: c.startedAt,
            started_by: c.startedBy ?? null,
            paused_at: c.pausedAt ?? null,
            revote_at: c.revoteAt ?? null,
            closed_at: c.closedAt ?? null,
            closed_by: c.closedBy ?? null,
          }))).select('id, seq')) ?? [];
          const bySeq = new Map(rows.map((r) => [Number(r.seq), r.id]));
          for (const c of classQuestions) cqIds.set(String(c.ref), bySeq.get(c.seq) ?? null);
        }
        for (const part of chunks(profiles)) {
          unwrap('importRoom', await db.from('profiles').insert(part.map((p) => ({
            session_id: sessionId,
            roll_no: String(p.rollNo),
            name: p.name ?? '',
            levels: p.levels ?? {},
            working_level: p.workingLevel,
            reason: p.reason ?? '',
            history: p.history ?? [],
            served_id: p.served?.questionId ?? null,
            served_at: p.served?.at ?? null,
            served_why: p.served?.reason ?? null,
            served_tries: p.served?.tries ?? 0,
            served_last: p.served?.last || null,
            integrity: p.integrity ?? [],
            account_id: p.accountId ?? null,
            account_verified: p.accountVerified === true,
            updated_at: new Date().toISOString(),
          }))));
        }
        const ids = new Map();
        for (const part of chunks(answers)) {
          const rows = unwrap('importRoom', await db.from('answers').insert(part.map(({ classQuestionRef, ...a }) => ({
            ...inAnswer({ ...a, sessionId, classQuestionId: classQuestionRef ? cqIds.get(String(classQuestionRef)) ?? null : null }),
            // A review in force is part of the answer as it was kept: written
            // with the row, as the room's own review route would have.
            reviewed_by: a.reviewedBy ?? null,
            reviewed_at: a.reviewedAt ?? null,
            review_note: a.reviewNote ?? '',
          }))).select('id, answer_key')) ?? [];
          for (const r of rows) ids.set(r.answer_key, r.id);
        }
        for (const part of chunks(reviews)) {
          unwrap('importRoom', await db.from('answer_reviews').insert(part.map((r) => ({
            answer_id: ids.get(r.answerKey),
            session_id: sessionId,
            decision: r.decision,
            correct: r.correct,
            score: r.score,
            note: r.note ?? '',
            reviewed_by: r.reviewedBy ?? null,
            reviewed_at: r.reviewedAt,
          }))));
        }
        for (const part of chunks(attendance)) {
          unwrap('importRoom', await db.from('attendance').insert(part.map((m) => inAttendance({ ...m, sessionId }))));
        }
        const { data: rec, error: recError } = await db.from('room_imports').insert({
          source_room_id: String(record.sourceRoomId),
          source_code: record.sourceCode,
          source: record.source ?? {},
          session_id: sessionId,
          owner_id: record.ownerId ?? null,
          imported_by: record.importedBy ?? null,
          imported_at: record.importedAt,
          archived_at: record.archivedAt ?? null,
          bytes: record.bytes,
          sha256: record.sha256,
          summary: record.summary ?? {},
          data: record.data,
        }).select(ROOM_IMPORT_META).single();
        if (recError?.code === '23505') throw exists('IMPORT_EXISTS', 'That room was already imported.');
        if (recError) fail('importRoom')(recError);
        return { session: outSession(made), record: outRoomImport(rec) };
      } catch (err) {
        const { error: undo } = await db.from('sessions').delete().eq('id', sessionId);
        if (undo) console.error(`[supabase] importRoom: removing the half-made room ${session.code} failed: ${undo.message}`);
        throw err;
      }
    },

    async getRoomImportBySource(sourceRoomId) {
      const { data, error } = await db.from('room_imports').select(ROOM_IMPORT_META)
        .eq('source_room_id', String(sourceRoomId)).maybeSingle();
      if (error) fail('getRoomImportBySource')(error);
      return outRoomImport(data);
    },

    async getRoomImport(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('room_imports').select('*').eq('id', id).maybeSingle();
      if (error) fail('getRoomImport')(error);
      return outRoomImport(data);
    },

    async listRoomImports() {
      const rows = unwrap('listRoomImports', await db.from('room_imports').select(ROOM_IMPORT_META)
        .order('imported_at', { ascending: false }).limit(1000));
      return (rows ?? []).map(outRoomImport);
    },

    // See memoryRepo: by room id (0031's unique session_id is its index), never
    // by listing every import. In pages of 100 ids, so a long list of rooms
    // never makes a request line too long.
    async listRoomImportsForSessions(sessionIds = []) {
      const ids = [...new Set(sessionIds.map(String).filter(isUuid))];
      const out = [];
      for (let i = 0; i < ids.length; i += 100) {
        const rows = unwrap('listRoomImportsForSessions', await db.from('room_imports').select(ROOM_IMPORT_META)
          .in('session_id', ids.slice(i, i + 100)));
        out.push(...(rows ?? []).map(outRoomImport));
      }
      return out;
    },

    async getRoomArchiveBySession(sessionId) {
      if (!isUuid(sessionId)) return null;
      const { data, error } = await db.from('room_archives').select(ARCHIVE_META).eq('session_id', sessionId).maybeSingle();
      if (error) fail('getRoomArchiveBySession')(error);
      return outArchive(data);
    },

    // ---- Phase 7: replay-safe teacher records (0032; see memoryRepo for the contract) ----
    async getRecordWrite({ sessionId, writer, key }) {
      if (!isUuid(sessionId)) return null;
      const { data, error } = await db.from('record_writes').select('*')
        .eq('session_id', sessionId).eq('writer', writer).eq('write_key', key).maybeSingle();
      if (error) fail('getRecordWrite')(error);
      return outRecordWrite(data);
    },

    // 23505 on record_writes_session_writer_key_key: the key is already held.
    async addRecordWrite(doc) {
      const { data, error } = await db.from('record_writes').insert({
        session_id: doc.sessionId,
        writer: doc.writer,
        write_key: doc.key,
        route: doc.route,
        target: doc.target ?? '',
        body_hash: doc.bodyHash,
        status: doc.status,
        reply: doc.reply ?? {},
      }).select().single();
      if (error?.code === '23505') return { write: await this.getRecordWrite(doc), duplicate: true };
      if (error) fail('addRecordWrite')(error);
      return { write: outRecordWrite(data), duplicate: false };
    },

    // ---- Batch 8: figures (0033; see memoryRepo for the contract) ----
    async createSlideMedia(doc) {
      const row = unwrap('createSlideMedia', await db
        .from('media')
        .insert({
          owner_id: doc.ownerId ?? null,
          content_id: doc.contentId,
          mime: doc.mime,
          bytes: doc.bytes,
          sha256: doc.sha256,
          alt: doc.alt,
          slide_no: doc.slideNo,
          data: `\\x${Buffer.from(doc.data).toString('hex')}`,
        })
        .select(`${MEDIA_META}, slide_no`)
        .single());
      return { ...outMedia(row), slideNo: row.slide_no };
    },
    async listSlideMedia(contentId) {
      if (!isUuid(contentId)) return [];
      const { data, error } = await db.from('media').select(`${MEDIA_META}, slide_no`)
        .eq('content_id', contentId).not('slide_no', 'is', null)
        .order('slide_no', { ascending: true }).order('created_at', { ascending: true });
      if (error) fail('listSlideMedia')(error);
      return (data ?? []).map((r) => ({ ...outMedia(r), slideNo: r.slide_no }));
    },
    async setContentSlidePictures(contentId, summary) {
      if (!isUuid(contentId)) return null;
      const { data, error } = await db.from('contents').update({ slide_pictures: summary }).eq('id', contentId)
        .select('slide_pictures').maybeSingle();
      if (error) fail('setContentSlidePictures')(error);
      return data?.slide_pictures ?? null;
    },
    async getContentSlidePictures(contentId) {
      if (!isUuid(contentId)) return null;
      const { data, error } = await db.from('contents').select('slide_pictures').eq('id', contentId).maybeSingle();
      if (error) fail('getContentSlidePictures')(error);
      return data?.slide_pictures ?? null;
    },

    // ---- Batch 8: the live room's suggestions and the wheel's question draws (0034; see memoryRepo for the contract) ----
    async addTeachingMove(doc) {
      return outTeachingMove(unwrap('addTeachingMove', await db.from('teaching_moves').insert({
        session_id: doc.sessionId,
        purpose: doc.purpose,
        activity_kind: doc.activityKind,
        title: doc.title ?? '',
        body: doc.body,
        focus_level: doc.focusLevel ?? null,
        topic: doc.topic ?? '',
        basis: doc.basis ?? {},
        source_ref: doc.sourceRef ?? null,
        model: doc.model,
        asked_by: doc.askedBy ?? null,
        ...(doc.askedAt ? { asked_at: doc.askedAt } : {}),
      }).select().single()));
    },

    async listTeachingMoves(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listTeachingMoves', 'teaching_moves', (q) => q.eq('session_id', sessionId), ['asked_at', 'id'], outTeachingMove);
    },

    async getTeachingMove(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('teaching_moves').select('*').eq('id', String(id).trim()).maybeSingle();
      if (error) fail('getTeachingMove')(error);
      return outTeachingMove(data);
    },

    // 23505 on wheel_question_draws_pick_order_key: the place was taken.
    async addWheelQuestionDraw(doc) {
      const { data, error } = await db.from('wheel_question_draws').insert({
        session_id: doc.sessionId,
        pick_id: doc.pickId,
        draw_order: doc.drawOrder,
        question_id: doc.questionId ?? null,
        pool_size: doc.poolSize,
        drawn_by: doc.drawnBy ?? null,
        ...(doc.drawnAt ? { drawn_at: doc.drawnAt } : {}),
      }).select().single();
      if (error?.code === '23505') throw placeTaken('place in the pick\'s questions');
      if (error) fail('addWheelQuestionDraw')(error);
      return outQuestionDraw(data);
    },

    async listWheelQuestionDraws(sessionId) {
      if (!isUuid(sessionId)) return [];
      return allRecords('listWheelQuestionDraws', 'wheel_question_draws', (q) => q.eq('session_id', sessionId),
        ['pick_id', 'draw_order'], outQuestionDraw);
    },

    // ---- Batch 8: material, the bank and the hub's concept panel (0035; see memoryRepo for the contract) ----
    async setQuestionRoomsOnly(id, roomsOnly) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('questions').update({ rooms_only: roomsOnly === true }).eq('id', id).select().maybeSingle();
      if (error) fail('setQuestionRoomsOnly')(error);
      return outQuestion(data);
    },

    // ---- Batch 9: answer kinds (a student's drawing, 0037; see memoryRepo for the contract) ----
    async createDrawing(doc) {
      const { data, error } = await db.from('media').insert({
        owner_id: null,
        content_id: doc.contentId,
        mime: doc.mime,
        bytes: doc.bytes,
        sha256: doc.sha256,
        alt: doc.alt,
        data: `\\x${Buffer.from(doc.data).toString('hex')}`,
        drawing: true,
        session_id: doc.sessionId ?? null,
        roll_no: doc.sessionId ? String(doc.rollNo) : null,
        account_id: doc.sessionId ? null : doc.accountId,
        question_id: doc.questionId,
        answer_key: doc.answerKey,
      }).select(DRAWING_META).single();
      if (error?.code === '23505') {
        const held = await this.getDrawingByKey(doc);
        if (held) return { media: held, duplicate: true };
      }
      if (error) fail('createDrawing')(error);
      return { media: outDrawing(data), duplicate: false };
    },
    async getDrawing(id) {
      if (!isUuid(id)) return null;
      const { data, error } = await db.from('media').select(DRAWING_META).eq('id', id).eq('drawing', true).maybeSingle();
      if (error) fail('getDrawing')(error);
      return outDrawing(data);
    },
    async getDrawingByKey({ sessionId = null, rollNo = null, accountId = null, answerKey = '' } = {}) {
      let q = db.from('media').select(DRAWING_META).eq('drawing', true).eq('answer_key', String(answerKey));
      if (sessionId) {
        if (!isUuid(sessionId)) return null;
        q = q.eq('session_id', sessionId).eq('roll_no', String(rollNo));
      } else {
        if (!isUuid(accountId)) return null;
        q = q.eq('account_id', accountId);
      }
      const { data, error } = await q.maybeSingle();
      if (error) fail('getDrawingByKey')(error);
      return outDrawing(data);
    },
    async listDrawings({ sessionId = null, rollNo = null, accountId = null, questionId = null } = {}) {
      let q = db.from('media').select(DRAWING_META).eq('drawing', true);
      for (const [col, v] of [['session_id', sessionId], ['account_id', accountId], ['question_id', questionId]]) {
        if (!v) continue;
        if (!isUuid(String(v))) return [];
        q = q.eq(col, String(v).toLowerCase());
      }
      if (rollNo) q = q.eq('roll_no', String(rollNo));
      const { data, error } = await q.order('created_at', { ascending: true });
      if (error) fail('listDrawings')(error);
      return (data ?? []).map(outDrawing);
    },
  };
}

// Batch 8 (0034): a suggestion the model made in a room, and a question the wheel drew.
const outTeachingMove = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    purpose: r.purpose,
    activityKind: r.activity_kind,
    title: r.title ?? '',
    body: r.body,
    focusLevel: r.focus_level ?? null,
    topic: r.topic ?? '',
    basis: r.basis ?? {},
    sourceRef: r.source_ref ?? null,
    model: r.model,
    askedBy: r.asked_by ?? null,
    askedAt: r.asked_at,
  };
const outQuestionDraw = (r) =>
  r && {
    _id: r.id,
    sessionId: r.session_id,
    pickId: r.pick_id,
    drawOrder: Number(r.draw_order),
    questionId: r.question_id ?? null,
    poolSize: Number(r.pool_size),
    drawnAt: r.drawn_at,
    drawnBy: r.drawn_by ?? null,
  };

// Phase 7 (0031): one import of a laptop's room archive, the archive itself only when selected.
const outRoomImport = (r) =>
  r && {
    _id: r.id,
    sourceRoomId: r.source_room_id,
    sourceCode: r.source_code,
    source: r.source ?? null,
    sessionId: r.session_id ?? null,
    ownerId: r.owner_id ?? null,
    importedBy: r.imported_by ?? null,
    importedAt: r.imported_at,
    archivedAt: r.archived_at ?? null,
    bytes: Number(r.bytes),
    sha256: r.sha256,
    summary: r.summary ?? {},
    ...(r.data !== undefined ? { data: r.data } : {}),
  };
const ROOM_IMPORT_META = 'id, source_room_id, source_code, source, session_id, owner_id, imported_by, imported_at, archived_at, bytes, sha256, summary';

/*
 * The schema the boot probe checks: every table the server writes, and every
 * column a later file added to a table that already existed, each with the
 * migration file that makes it, so a missing piece is named with the file to
 * apply rather than failing write by write.
 *
 * ROOM_SCHEMA is what rooms need: a join, an answer, a room opening, a question
 * saved. Missing any of it, Supabase is not used at all (the store falls back,
 * and says so), because a room on a half-built database fails mid-class.
 *
 * ROUTE_SCHEMA is what only some routes need. Missing it, Supabase is still used
 * and every room runs; the boot log names each missing piece, the file to apply
 * and what fails until it is. Falling back to the in-process store for these
 * would lose every room's data instead. Since the owner's decisions of 19 Nov
 * 2026 this covers 0019 to 0021, which the probe did not check before: without
 * 0021 every attendance mark failed to save, and nothing at boot said why.
 *
 * Each entry: [table, columns or null for the table itself, migration file, what
 * fails without it (ROUTE_SCHEMA only)].
 */
export const ROOM_SCHEMA = Object.freeze([
  ['contents', null, '0000_core_tables.sql'],
  ['questions', null, '0000_core_tables.sql'],
  ['sessions', null, '0000_core_tables.sql'],
  ['profiles', null, '0000_core_tables.sql'],
  ['accounts', null, '0001_accounts_ownership_question_kinds.sql'],
  ['invites', null, '0002_invites.sql'],
  ['answers', null, '0008_answers.sql'],
  ['room_archives', null, '0009_room_archives.sql'],
  ['answer_reviews', null, '0010_answer_reviews.sql'],
  // Without these every generated question fails to save (no model column),
  // which a table probe would not notice until a professor pressed Generate.
  ['questions', 'model, source_ref, checks, created_by, approved_by, approved_at', '0013_question_provenance_and_approval.sql'],
  ['contents', 'topic_slides', '0013_question_provenance_and_approval.sql'],
  ['media', null, '0014_media.sql'],
  // createSession writes these on every room.
  ['sessions', 'question_ids', '0015_room_question_sets.sql'],
  ['sessions', 'class_id', '0016_classes_roster_attendance.sql'],
  ['classes', null, '0016_classes_roster_attendance.sql'],
  ['class_students', null, '0016_classes_roster_attendance.sql'],
  ['attendance', null, '0016_classes_roster_attendance.sql'],
  ['observations', null, '0017_teacher_records.sql'],
  ['wheel_rounds', null, '0017_teacher_records.sql'],
  ['wheel_picks', null, '0017_teacher_records.sql'],
  ['hand_tallies', null, '0017_teacher_records.sql'],
  ['room_activities', null, '0017_teacher_records.sql'],
  ['insight_actions', null, '0017_teacher_records.sql'],
  ['sessions', 'mode, adapt, start_level, questions_per_student, time_per_question', '0018_room_modes_and_projector.sql'],
  ['projector_links', null, '0018_room_modes_and_projector.sql'],
  // Written on every join (saveProfile) and every answer (recordAnswer), on
  // every question saved (insertQuestions) and every roster row added.
  ['profiles', 'account_verified', '0022_owner_decisions.sql'],
  ['answers', 'account_verified', '0022_owner_decisions.sql'],
  ['questions', 'replaces_id', '0022_owner_decisions.sql'],
  ['class_students', 'under_18', '0022_owner_decisions.sql'],
  // Written on every answer (recordAnswer) and read with every room's bank
  // (the live loop leaves out what was asked to the class): without them every
  // answer fails to save and no room can serve.
  ['answers', 'class_question_id, round', '0023_class_questions.sql'],
  ['class_questions', null, '0023_class_questions.sql'],
  // Written with every question saved (insertQuestions), generated or written
  // by a professor: without it no question can be saved.
  ['questions', 'misconceptions', '0024_misconception_labels.sql'],
  // Phase 7: written on every answer (recordAnswer) and with every question
  // pack a phone takes (addQuestionPack), and read for every answer to a
  // question that is not the one on the phone's screen: without them no answer
  // can be saved at all, and no answer that waited on a phone can be marked.
  ['answers', 'device_answered_at', '0030_offline_packs.sql'],
  ['question_packs', null, '0030_offline_packs.sql'],
  // Phase 7 (the review fixes): written with every profile (saveProfile), on
  // every join and every question served: without it no phone can join.
  ['profiles', 'served_log', '0030_offline_packs.sql'],
]);

export const ROUTE_SCHEMA = Object.freeze([
  ['course_outcomes', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['outcome_topics', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['question_outcome_overrides', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['attainment_configs', null, '0020_attainment_configs.sql', 'attainment reports and the marks register fail, and no formula can be saved'],
  ['attendance', 'roll_no', '0021_attendance_roll.sql',
    'every attendance mark fails to save: a phone joining a class room marks nobody present, and a professor\'s marks are refused'],
  // Phase 6, the hub's content backbone (0025). Without the column a deck still
  // uploads (the slide texts are written by a statement of their own, and a
  // failure there is logged); without the tables only the hub's routes fail,
  // and an upload or a topic edit still saves.
  ['contents', 'slide_texts', '0025_hub_backbone.sql',
    'a deck uploaded now keeps no per-slide text (its topics still cite their slides by number)'],
  ['class_units', null, '0025_hub_backbone.sql', 'the learning hub\'s units cannot be read or saved'],
  ['class_chapters', null, '0025_hub_backbone.sql', 'no chapter can be placed on a class\'s hub, and no student reaches one'],
  ['chapter_topics', null, '0025_hub_backbone.sql', 'chapters have no topic records, so the hub shows no topics and no link can be made'],
  ['topic_links', null, '0025_hub_backbone.sql', 'prerequisite links cannot be read, proposed or saved'],
  // Phase 6, practice in the hub (0026). Without the attempts table no practice
  // answer is saved, so the hub serves no practice question; without the
  // explanations table a practice answer is still saved and marked, and only
  // the explanation after it is missing. Rooms read neither.
  ['hub_attempts', null, '0026_hub_practice.sql',
    'no practice answer can be saved or read, so practice, mastery, the error log and reviews in the hub fail'],
  ['question_explanations', null, '0026_hub_practice.sql',
    'explanations cannot be written, generated or shown after a practice answer (the answer itself is still saved and marked)'],
  // Phase 6, lessons and languages (0027). Without them only the hub's lesson
  // and language routes fail; a student reads everything else in English, and
  // no room, question or upload is touched.
  ['topic_lessons', null, '0027_lessons_and_languages.sql', 'no lesson can be made, approved or read'],
  ['item_translations', null, '0027_lessons_and_languages.sql',
    'no Hindi or Marathi version can be made, approved or shown, so students read English'],
  ['student_language_choices', null, '0027_lessons_and_languages.sql',
    'a student\'s choice of language cannot be saved, so they read English'],
  // Phase 6, Get Ready, self-tests and goals (0028). Without them only those
  // hub routes fail: practice still saves its answers (an attempt is sent with
  // a run only when it has one), and no room, question or upload is touched.
  ['hub_runs', null, '0028_hub_paths_and_goals.sql',
    'no Get Ready check or self-test can be started or read (the hub home shows the rest, without refresher paths)'],
  ['hub_attempts', 'run_id', '0028_hub_paths_and_goals.sql',
    'no Get Ready or self-test answer can be saved (practice answers still are)'],
  ['hub_goals', null, '0028_hub_paths_and_goals.sql', 'a student\'s goals cannot be set or read (the hub home shows the rest without them)'],
  // Phase 6, the tutor (0029). Without them practice and lessons offer no hints
  // and no feedback on a wrong option; every answer is still saved and marked.
  ['question_hints', null, '0029_hub_tutor.sql',
    'no hint can be written, generated, approved or shown, so practice and lessons offer none (answers are still saved and marked)'],
  ['option_feedback', null, '0029_hub_tutor.sql',
    'no feedback on a wrong option can be written, generated, approved or shown (answers are still saved and marked)'],
  ['hub_hint_views', null, '0029_hub_tutor.sql',
    'a hint cannot be opened, because each one opened must be recorded with the answer'],
  // Phase 7: written only by the import of a laptop's room archive (routes/laptop.js),
  // and read by the live loop when a phone asks to deliver to a closed room, where a
  // missing table is read as "no import" (sockets/index.js), so rooms never need it.
  ['room_imports', null, '0031_room_imports.sql', 'a room archive saved by a laptop in laptop mode cannot be imported'],
  // Batch 8 (0034): written only when a professor asks for a suggestion, draws a
  // question with a pick, or records a suggestion as an activity. Every room,
  // every draw without a question and every other activity work without them.
  // The widened ask check (a verbal question) cannot be probed: without 0034 a
  // pick marked as a verbal question is refused, and says so.
  ['teaching_moves', null, '0034_zip_gaps_live_wheel.sql',
    'no teaching move or activity prompt can be suggested or kept'],
  ['wheel_question_draws', null, '0034_zip_gaps_live_wheel.sql',
    'the wheel cannot draw a question with a student, and "Another" cannot draw the next one'],
  ['room_activities', 'suggestion_id', '0034_zip_gaps_live_wheel.sql',
    'a suggestion cannot be recorded as an activity (every other activity is recorded as before)'],
  // Phase 7: read and written only by a teacher-record write that carries a
  // replay key (routes/recordSync.js); a write without one never touches it.
  ['record_writes', null, '0032_record_write_keys.sql',
    'a teacher-record write sent with a replay key fails, so the console cannot send again what it saved offline; '
      + 'writes sent without one work as before'],
  // Batch 8, figures (0033). Without these a deck still uploads (its pictures are
  // kept by statements of their own, and a failure there is logged) and every
  // figure a question carries is still drawn; only the deck's pictures are not
  // kept, and a lesson cannot hold a figure step.
  ['media', 'slide_no', '0033_figures.sql',
    'a deck uploaded now keeps none of its slide pictures, so none can be attached to a question'],
  ['contents', 'slide_pictures', '0033_figures.sql',
    'a deck uploaded now keeps none of its slide pictures, and a chapter cannot say what its upload kept'],
  // Batch 8 (material, the bank and the hub's concept panel). Without them every
  // question is shared with the hub and no lesson keeps sections; only the
  // rooms-only switch and an AI lesson that has sections fail to save.
  ['questions', 'rooms_only', '0035_bank_share_and_concept_panel.sql',
    'no question can be kept for rooms only, so the Learning Hub may offer every approved question'],
  ['topic_lessons', 'sections', '0035_bank_share_and_concept_panel.sql',
    'a lesson written with AI help cannot be saved when it has an introduction, facts, explanation, code example or common mistakes'],
  // Batch 8, the review's fixes (0036). Without it every practice and lesson
  // answer that carries its serve token saves as before; one without proof the
  // hub served its question cannot be kept, so the phone holds it and sends it
  // again once the file is applied.
  ['hub_attempts', 'unproven', '0036_hub_attempt_proof.sql',
    'a practice or lesson answer sent without proof that the hub served its question is not saved, and the phone keeps it to send again'],
  // Batch 9, whiteboard answers (0037). Without it no drawing can be kept: a
  // phone's drawing for a 'drawing' question is not saved (it keeps it and sends
  // it again), so neither is its answer, and a practice drawing in the hub is
  // refused. Every other kind, upload and answer works as before. The file also
  // lets a hub drawing's attempt carry no mark, which a probe cannot see.
  ['media', 'drawing, session_id, roll_no, account_id, question_id, answer_key', '0037_answer_kinds.sql',
    'no drawing answer can be kept, in a room or in the hub, so drawing questions cannot be answered (every other kind works as before)'],
]);

/** One missing piece, as a sentence naming the file to apply. */
const missingPiece = ([table, cols, file], error) =>
  `${cols ? `${table}.${cols.replace(/,\s*/g, `, ${table}.`)}` : `the ${table} table`} is missing: apply supabase/migrations/${file}`
  + `${error?.message ? ` (${error.message})` : ''}`;

/**
 * Cheap connectivity + schema probe, run once at boot so failures are loud.
 * Throws, naming every missing piece of ROOM_SCHEMA with its file; otherwise
 * returns { warnings }, one sentence per missing piece of ROUTE_SCHEMA, naming
 * the file to apply and what fails until it is.
 *
 * @returns {Promise<{ warnings: string[] }>}
 */
export async function probeSupabase() {
  const db = createClient(config.supabase.url, config.supabase.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // A GET for no rows, not a HEAD: a HEAD response has no body, and the client
  // reads a 404 with an empty body as "no content", so a missing TABLE probed
  // with HEAD came back as no error at all. A GET's 404 carries PostgREST's
  // error, and a missing column is a 400 either way.
  const probe = async ([table, cols]) => (await db.from(table).select(cols ?? '*').limit(0)).error;
  const missing = [];
  for (const entry of ROOM_SCHEMA) {
    const error = await probe(entry);
    if (error) missing.push(missingPiece(entry, error));
  }
  if (missing.length) throw new Error(`not ready - ${missing.join('; ')}`);
  const warnings = [];
  for (const entry of ROUTE_SCHEMA) {
    const error = await probe(entry);
    if (error) warnings.push(`${missingPiece(entry, error)}. Until it is applied, ${entry[3]}.`);
  }
  return { warnings };
}
