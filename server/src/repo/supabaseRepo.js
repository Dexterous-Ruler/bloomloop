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
      if (kind) q = q.eq('kind', kind);
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
  };
}

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
]);

export const ROUTE_SCHEMA = Object.freeze([
  ['course_outcomes', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['outcome_topics', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['question_outcome_overrides', null, '0019_course_outcomes.sql', 'course outcomes and their mappings cannot be read or saved'],
  ['attainment_configs', null, '0020_attainment_configs.sql', 'attainment reports and the marks register fail, and no formula can be saved'],
  ['attendance', 'roll_no', '0021_attendance_roll.sql',
    'every attendance mark fails to save: a phone joining a class room marks nobody present, and a professor\'s marks are refused'],
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
