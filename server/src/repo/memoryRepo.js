// In-process fallback store. Used when MONGO_URI is absent so a missing
// connection string cannot take the demo down. Same interface as mongoRepo -
// the rest of the server never learns which one it got.
//
// Nothing here survives a restart, and the server says so loudly at boot.

import crypto from 'node:crypto';

const oid = () => crypto.randomBytes(12).toString('hex');
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));

export function createMemoryRepo() {
  const contents = new Map();
  const questions = new Map();
  const sessions = new Map();
  const profiles = new Map(); // key: `${sessionId}:${rollNo}`
  const answers = new Map(); // key: _id
  const answerKeys = new Map(); // `${sessionId}:${answerKey}` -> _id
  const archives = new Map(); // key: _id; one per sessionId
  const reviews = new Map(); // key: _id; append-only, insertion order is review order
  const media = new Map(); // key: _id -> { rec, data }; the bytes apart, since clone() would mangle a Buffer
  const classes = new Map(); // key: _id
  const classStudents = new Map(); // key: _id; never deleted, only removed (removedAt)
  const attendance = new Map(); // key: `${sessionId}:${classStudentId}`, one mark per student per room
  // Teacher records (0017). Observations and insight actions are append-only
  // lists, in the order written; the rest are keyed by _id.
  const observations = [];
  const wheelRounds = new Map();
  const wheelPicks = new Map();
  const tallies = new Map();
  const activities = new Map();
  const insightActions = [];
  const projectorLinks = new Map(); // key: _id (0018); only the token's hash is kept
  // Course outcomes (0019): a class's outcomes, their topic mappings, and its
  // per-question overrides, one per (class, question).
  const outcomes = new Map(); // key: _id
  const outcomeTopics = new Map(); // key: _id
  const overrides = new Map(); // key: `${classId}:${questionId}`
  // Attainment formulas (0020): every saved version, append-only.
  const attainmentConfigs = [];
  // Class questions (0023), keyed by _id.
  const classQuestions = new Map();
  // Question packs (0030, Phase 7): written once, in the order sent.
  const questionPacks = [];
  // Phase 7: rooms imported from laptop mode (0031), keyed by _id. An imported
  // room deleted since reads as naming no room, as 0031's ON DELETE SET NULL has it.
  const roomImports = new Map();
  const importedNow = (rec) => (sessions.has(String(rec.sessionId)) ? rec : { ...rec, sessionId: null });
  // Phase 7 (0032): the replay keys of teacher-record writes, append-only,
  // keyed `${sessionId}\u0000${writer}\u0000${key}`, as the unique constraint is.
  const recordWrites = new Map();
  const writeKeyOf = (d) => `${d.sessionId}\u0000${d.writer}\u0000${d.key}`;
  // Batch 8 (0034): the live room's suggestions and the questions the wheel
  // drew for its picks, both append-only lists in the order written.
  const teachingMoves = [];
  const questionDraws = [];

  // Unique on (classId, code) among outcomes not archived, as Postgres's partial
  // unique index course_outcomes_class_code_key is.
  const codeHeld = (classId, code, exceptId = null) => [...outcomes.values()]
    .some((o) => o.classId === String(classId) && o.code === code && !o.archivedAt && o._id !== exceptId);
  const codeTaken = (code) => Object.assign(new Error(`${code} is already a course outcome of this class.`), { status: 409 });
  // A topic in its chapter, as the unique index on (outcome_id, content_id, lower(topic)) compares it.
  const linkKey = (l) => `${l.contentId}\u0000${String(l.topic).toLowerCase()}`;

  // Unique on (classId, rollNo), as the Postgres constraint and the Mongo index are.
  const rollHeld = (classId, rollNo, exceptId = null) => [...classStudents.values()]
    .some((s) => s.classId === String(classId) && s.rollNo === rollNo && s._id !== exceptId);

  // A row whose place another row of the room already holds is a 409, as the
  // unique constraints on (session_id, round), (session_id, round, pick_order)
  // and (session_id, seq) make it in Postgres.
  const taken = (what) => Object.assign(new Error(`That ${what} was taken by another request. Nothing was changed.`), { status: 409 });
  const ofRoom = (map, sessionId) => [...map.values()].filter((r) => r.sessionId === String(sessionId));
  const update = (map, id, patch, keys) => {
    const rec = map.get(String(id));
    if (!rec) return null;
    for (const k of keys) if (patch[k] !== undefined) rec[k] = clone(patch[k]);
    return clone(rec);
  };

  return {
    kind: 'memory',

    async createContent(doc) {
      const _id = oid();
      const rec = { _id, createdAt: new Date().toISOString(), ...doc };
      contents.set(_id, rec);
      return clone(rec);
    },

    async getContent(id) {
      return clone(contents.get(String(id)) ?? null);
    },

    async listContents() {
      return clone([...contents.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    },

    async updateContent(id, patch) {
      const rec = contents.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async insertQuestions(docs) {
      const made = docs.map((d) => {
        const _id = oid();
        // The 0013 fields default to null, as the Postgres columns and the
        // Mongoose paths do, so a question has one shape whichever store is live.
        const rec = {
          _id,
          status: 'active',
          source: 'llm',
          model: null,
          sourceRef: null,
          checks: null,
          createdBy: null,
          approvedBy: null,
          approvedAt: null,
          // 0022: the active question a regenerated draft would replace.
          replacesId: null,
          // 0024: misconception labels on its wrong options, none by default.
          misconceptions: [],
          // 0035 (Batch 8): shared with the Learning Hub unless the owner keeps it for rooms.
          roomsOnly: false,
          createdAt: new Date().toISOString(),
          ...d,
          contentId: String(d.contentId),
        };
        questions.set(_id, rec);
        return rec;
      });
      return clone(made);
    },

    async listQuestions(contentId, { includeDiscarded = false } = {}) {
      const all = [...questions.values()].filter((q) => q.contentId === String(contentId));
      return clone(includeDiscarded ? all : all.filter((q) => q.status === 'active'));
    },

    async getQuestion(id) {
      return clone(questions.get(String(id)) ?? null);
    },

    async updateQuestion(id, patch) {
      const rec = questions.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async deleteQuestions(contentId) {
      let n = 0;
      for (const [id, q] of questions) {
        if (q.contentId === String(contentId)) {
          questions.delete(id);
          n += 1;
        }
      }
      return n;
    },

    // Active by default: what a room can serve. `status: 'draft'` counts the
    // generated questions still waiting for a professor's approval.
    async countQuestions(contentId, { status = 'active' } = {}) {
      return [...questions.values()].filter(
        (q) => q.contentId === String(contentId) && q.status === status,
      ).length;
    },

    async createSession(doc) {
      const _id = oid();
      const rec = {
        _id,
        status: 'open',
        startedAt: new Date().toISOString(),
        closedAt: null,
        // The room's question set (0015); null serves the whole approved bank,
        // as the Postgres column and the Mongoose path default to.
        questionIds: null,
        // The class the room was opened for (0016); null for none.
        classId: null,
        // How the room runs (0018), defaulting as the Postgres columns do to how
        // every room ran before: phones, adapting, from Understand, no cap or time.
        mode: 'devices',
        adapt: true,
        startLevel: 'understand',
        questionsPerStudent: null,
        timePerQuestion: null,
        ...doc,
        contentId: String(doc.contentId),
      };
      sessions.set(_id, rec);
      return clone(rec);
    },

    async getSession(id) {
      return clone(sessions.get(String(id)) ?? null);
    },

    async getSessionByCode(code) {
      const rec = [...sessions.values()].find((s) => s.code === String(code).toUpperCase());
      return clone(rec ?? null);
    },

    async updateSession(id, patch) {
      const rec = sessions.get(String(id));
      if (!rec) return null;
      Object.assign(rec, patch);
      return clone(rec);
    },

    async deleteSession(id) {
      const key = String(id);
      // Cascades by hand: Postgres does this with ON DELETE CASCADE, and a
      // store that left orphaned profiles behind would report a different
      // student count from the same data.
      for (const [pid, profile] of profiles) {
        if (String(profile.sessionId) === key) profiles.delete(pid);
      }
      for (const [aid, answer] of answers) {
        if (String(answer.sessionId) === key) {
          answers.delete(aid);
          answerKeys.delete(`${key}:${answer.answerKey}`);
        }
      }
      for (const [rid, review] of reviews) {
        if (review.sessionId === key) reviews.delete(rid);
      }
      for (const [k, mark] of attendance) {
        if (mark.sessionId === key) attendance.delete(k);
      }
      for (const list of [observations, insightActions, questionPacks, teachingMoves, questionDraws]) {
        for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].sessionId === key) list.splice(i, 1);
      }
      for (const map of [wheelRounds, wheelPicks, tallies, activities, projectorLinks, classQuestions, recordWrites]) {
        for (const [id, rec] of map) if (rec.sessionId === key) map.delete(id);
      }
      return sessions.delete(key);
    },

    async listSessions() {
      return clone([...sessions.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
    },

    /** Every room on one chapter, newest first, whatever its status. */
    async listSessionsForContent(contentId) {
      return clone([...sessions.values()]
        .filter((s) => s.contentId === String(contentId))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
    },

    /** Every room opened for one class (Phase 3 class analytics), newest first, whatever its status. */
    async listSessionsForClass(classId) {
      return clone([...sessions.values()]
        .filter((s) => s.classId != null && String(s.classId) === String(classId))
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
    },

    async getProfile(sessionId, rollNo) {
      return clone(profiles.get(`${sessionId}:${rollNo}`) ?? null);
    },

    async saveProfile(profile) {
      const key = `${profile.sessionId}:${profile.rollNo}`;
      const existing = profiles.get(key);
      const rec = { _id: existing?._id ?? oid(), ...clone(profile), sessionId: String(profile.sessionId) };
      profiles.set(key, rec);
      return clone(rec);
    },

    async listProfiles(sessionId) {
      return clone(
        [...profiles.values()]
          .filter((p) => p.sessionId === String(sessionId))
          .sort((a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true })),
      );
    },

    // -- answers (append-only evidence) --
    // Same contract as the Postgres table: unique on (sessionId, answerKey), so a
    // resend returns the stored row with `duplicate: true` instead of a second one.
    async recordAnswer(doc) {
      const k = `${doc.sessionId}:${doc.answerKey}`;
      const held = answerKeys.get(k);
      if (held) return { answer: clone(answers.get(held)), duplicate: true };
      const _id = oid();
      const rec = {
        _id,
        attempt: 1,
        final: true,
        correct: null,
        score: null,
        detail: '',
        ungraded: false,
        language: 'en',
        questionSource: 'llm',
        reviewStatus: 'auto',
        autoCorrect: null,
        autoScore: null,
        autoDetail: '',
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: '',
        confidence: null,
        // 0022: sent by a phone signed in as the linked account.
        accountVerified: false,
        // 0023: the class question and round a vote was given in; null for every other answer.
        classQuestionId: null,
        round: null,
        // 0030: when the phone says it was answered; for the record only.
        deviceAnsweredAt: null,
        answeredAt: new Date().toISOString(),
        ...clone(doc),
        sessionId: String(doc.sessionId),
        rollNo: String(doc.rollNo),
      };
      answers.set(_id, rec);
      answerKeys.set(k, _id);
      return { answer: clone(rec), duplicate: false };
    },

    async getAnswerByKey(sessionId, answerKey) {
      const id = answerKeys.get(`${sessionId}:${answerKey}`);
      return clone(id ? answers.get(id) : null);
    },

    async getAnswer(id) {
      return clone(answers.get(String(id)) ?? null);
    },

    // `order: 'desc'` is newest first, for the review queue. Ties are ordered by
    // id, as Postgres and Mongo order them, so pages never overlap.
    //
    // `student: { accountId, rollNo }` is one person across rooms: rows linked to
    // their account, plus rows under their roll number that are linked to no
    // account. A row linked to a DIFFERENT account is that account's answer,
    // whatever roll number it carries, so it is never handed to this one.
    // `student: { accountId, verifiedOnly: true }` is the student reading
    // themself (decision 7, 0022): rows linked to their account AND sent by a
    // phone signed in as it. Never a roll number.
    //
    // `before: { answeredAt, id }` is a page cursor: only rows earlier than it in
    // that same (answeredAt, id) order. The review queue pages by it, newest
    // first, because offsets drift as answers are reviewed out of the queue.
    //
    // `classQuestionId` (0023) is one class question's votes; `classVotes: false`
    // leaves every class question's votes out, for the readers of a student's
    // own work: the ladder's evidence, item statistics, a student's history.
    async listAnswers({
      sessionId, sessionIds, rollNo, accountId, student, topic, bloom, reviewStatus, kind, final, before,
      classQuestionId, classVotes, order = 'asc', limit = 2000, offset = 0,
    } = {}) {
      const ids = Array.isArray(sessionIds) ? new Set(sessionIds.map(String)) : null;
      const isStudents = (a) => (student.verifiedOnly
        ? Boolean(student.accountId) && String(a.accountId ?? '') === String(student.accountId) && a.accountVerified === true
        : (student.accountId && a.accountId && String(a.accountId) === String(student.accountId))
          || (student.rollNo && !a.accountId && a.rollNo === String(student.rollNo)));
      const inOrder = (a, b) => (a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1
        : a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
      const rows = [...answers.values()]
        .filter((a) => (!sessionId || a.sessionId === String(sessionId))
          && (!ids || ids.has(a.sessionId))
          && (!rollNo || a.rollNo === String(rollNo))
          && (!accountId || a.accountId === accountId)
          && (!student || Boolean(isStudents(a)))
          && (!topic || a.topic === topic)
          && (!bloom || a.bloom === bloom)
          && (!reviewStatus || a.reviewStatus === reviewStatus)
          && (!kind || a.kind === kind)
          && (final === undefined || a.final === final)
          && (!classQuestionId || String(a.classQuestionId ?? '') === String(classQuestionId))
          && (classVotes !== false || a.classQuestionId == null)
          && (!before || inOrder(a, { answeredAt: before.answeredAt, _id: before.id }) < 0))
        .sort(inOrder);
      if (order === 'desc') rows.reverse();
      return clone(rows.slice(offset, offset + limit));
    },

    // -- room archives: one JSON document per deleted room --
    // Written before the room's live rows are deleted. One per room: a retried
    // delete replaces the archive it wrote the first time rather than adding a
    // second copy.
    async saveRoomArchive(doc) {
      const existing = [...archives.values()].find((a) => a.sessionId === String(doc.sessionId));
      const _id = existing?._id ?? oid();
      const rec = { ...clone(doc), _id, sessionId: String(doc.sessionId) };
      archives.set(_id, rec);
      const { data, ...meta } = rec;
      return clone(meta);
    },

    /** Newest first, without the data: a list is for choosing one. */
    async listRoomArchives() {
      return clone([...archives.values()]
        .map(({ data, ...meta }) => meta)
        .sort((a, b) => (a.archivedAt < b.archivedAt ? 1 : -1)));
    },

    async getRoomArchive(id) {
      return clone(archives.get(String(id)) ?? null);
    },

    // Review fields only: the response and the automatic assessment never change.
    async updateAnswer(id, patch) {
      const rec = answers.get(String(id));
      if (!rec) return null;
      for (const k of ['correct', 'score', 'reviewStatus', 'reviewedBy', 'reviewedAt', 'reviewNote', 'final']) {
        if (patch[k] !== undefined) rec[k] = patch[k];
      }
      return clone(rec);
    },

    // -- answer reviews: append-only log of professor decisions --
    // Insert only. There is no update or delete: a later decision is a new row,
    // so it never erases an earlier one. Rows go only with their room.
    async addAnswerReview(doc) {
      const _id = oid();
      const rec = {
        _id,
        note: '',
        reviewedBy: null,
        reviewedAt: new Date().toISOString(),
        ...clone(doc),
        answerId: String(doc.answerId),
        sessionId: String(doc.sessionId),
      };
      reviews.set(_id, rec);
      return clone(rec);
    },

    /** Oldest first. Filters are ANDed; at least one is expected. */
    async listAnswerReviews({ answerId, sessionId } = {}) {
      return clone([...reviews.values()]
        .filter((r) => (!answerId || r.answerId === String(answerId))
          && (!sessionId || r.sessionId === String(sessionId)))
        .sort((a, b) => (a.reviewedAt < b.reviewedAt ? -1 : a.reviewedAt > b.reviewedAt ? 1 : 0)));
    },

    // -- media: uploaded images for question stimuli (0014) --
    // Written once and never updated, so a url always names the same bytes and a
    // phone may cache them for good. The id is oid(): 96 random bits, which is
    // what keeps an upload's url from being guessed (services/media.js).
    /** Returns the row without its bytes. */
    async createMedia(doc) {
      const { data, ...meta } = doc;
      const _id = oid();
      const rec = { _id, ownerId: null, createdAt: new Date().toISOString(), ...clone(meta), contentId: String(doc.contentId) };
      media.set(_id, { rec, data: Buffer.from(data) });
      return clone(rec);
    },

    /** The row, with its bytes as a Buffer only when asked: a permission check needs none of them. */
    async getMedia(id, { withData = false } = {}) {
      const held = media.get(String(id));
      if (!held) return null;
      return withData ? { ...clone(held.rec), data: Buffer.from(held.data) } : clone(held.rec);
    },

    // -- classes and rosters (0016) --
    async createClass(doc) {
      const _id = oid();
      const now = new Date().toISOString();
      const rec = { _id, ownerId: null, termLabel: '', createdAt: now, updatedAt: now, ...clone(doc) };
      classes.set(_id, rec);
      return clone(rec);
    },

    async getClass(id) {
      return clone(classes.get(String(id)) ?? null);
    },

    /** Newest first. Who may see which is the route's business (ownership.js). */
    async listClasses() {
      return clone([...classes.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
    },

    async updateClass(id, patch) {
      const rec = classes.get(String(id));
      if (!rec) return null;
      for (const k of ['courseName', 'section', 'termLabel']) if (patch[k] !== undefined) rec[k] = patch[k];
      rec.updatedAt = new Date().toISOString();
      return clone(rec);
    },

    /** The whole roster, removed students included, in roll-number order. */
    async listClassStudents(classId) {
      return clone([...classStudents.values()]
        .filter((s) => s.classId === String(classId))
        .sort((a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true })));
    },

    async getClassStudent(id) {
      return clone(classStudents.get(String(id)) ?? null);
    },

    /**
     * Add roster rows. A roll number the class already holds is skipped, as
     * Postgres's ON CONFLICT DO NOTHING skips it: only the rows actually added
     * come back, so a caller can tell a row that lost a race from one that won.
     */
    async addClassStudents(classId, docs) {
      const made = [];
      for (const d of docs) {
        if (rollHeld(classId, d.rollNo)) continue;
        const _id = oid();
        // under18 (0022): the owner's optional mark, false unless sent.
        const rec = { _id, addedAt: new Date().toISOString(), removedAt: null, ...clone(d), under18: d.under18 === true, classId: String(classId) };
        classStudents.set(_id, rec);
        made.push(rec);
      }
      return clone(made);
    },

    /** Name, roll number, removedAt and under18 only. A roll number another row holds is a 409. */
    async updateClassStudent(id, patch) {
      const rec = classStudents.get(String(id));
      if (!rec) return null;
      if (patch.rollNo !== undefined && rollHeld(rec.classId, patch.rollNo, rec._id)) {
        throw Object.assign(new Error(`Roll number ${patch.rollNo} is already on this class's roster.`), { status: 409 });
      }
      for (const k of ['name', 'rollNo', 'removedAt', 'under18']) if (patch[k] !== undefined) rec[k] = patch[k];
      return clone(rec);
    },

    // -- attendance (0016): one mark per (room, roster student) --
    async listAttendance(sessionId) {
      return clone([...attendance.values()].filter((m) => m.sessionId === String(sessionId)));
    },

    /** Upsert: each mark replaces whatever that student had in that room. */
    async saveAttendance(docs) {
      const out = [];
      for (const d of docs) {
        const k = `${d.sessionId}:${d.classStudentId}`;
        const rec = {
          _id: attendance.get(k)?._id ?? oid(),
          markedBy: null,
          // 0021: the roll number the mark was made under; null before it.
          rollNo: null,
          markedAt: new Date().toISOString(),
          ...clone(d),
          sessionId: String(d.sessionId),
          classStudentId: String(d.classStudentId),
        };
        attendance.set(k, rec);
        out.push(rec);
      }
      return clone(out);
    },

    /** Insert unless that student already has a mark in that room, which is kept. */
    async addAttendanceIfAbsent(doc) {
      const k = `${doc.sessionId}:${doc.classStudentId}`;
      if (attendance.has(k)) return { created: false };
      await this.saveAttendance([doc]);
      return { created: true };
    },

    // -- teacher records (0017; services/records.js, services/wheel.js) --

    /** Append-only: a set or a clear (kind null) is a new row; nothing is updated. */
    async addObservation(doc) {
      const rec = {
        _id: oid(),
        classId: null,
        classStudentId: null,
        kind: null,
        note: '',
        observedBy: null,
        observedAt: new Date().toISOString(),
        ...clone(doc),
        sessionId: String(doc.sessionId),
      };
      observations.push(rec);
      return clone(rec);
    },

    /** Oldest first. Filters are ANDed; at least one is expected. */
    async listObservations({ sessionId, classId, classStudentId, day } = {}) {
      return clone(observations
        .filter((o) => (!sessionId || o.sessionId === String(sessionId))
          && (!classId || o.classId === String(classId))
          && (!classStudentId || o.classStudentId === String(classStudentId))
          && (!day || o.day === day))
        // Stable, so rows written in one millisecond keep the order they were written in.
        .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0)));
    },

    /** Round order. */
    async listWheelRounds(sessionId) {
      return clone(ofRoom(wheelRounds, sessionId).sort((a, b) => a.round - b.round));
    },

    async addWheelRound(doc) {
      if (ofRoom(wheelRounds, doc.sessionId).some((r) => r.round === doc.round)) throw taken('round');
      const rec = { _id: oid(), startedBy: null, startedAt: new Date().toISOString(), ...clone(doc), sessionId: String(doc.sessionId) };
      wheelRounds.set(rec._id, rec);
      return clone(rec);
    },

    /** The two settings only: a round's number and start are written once. */
    async updateWheelRound(id, patch) {
      return update(wheelRounds, id, patch, ['presentOnly', 'noRepeat']);
    },

    /** Round, then place in the round. */
    async listWheelPicks(sessionId) {
      return clone(ofRoom(wheelPicks, sessionId).sort((a, b) => a.round - b.round || a.order - b.order));
    },

    async addWheelPick(doc) {
      if (ofRoom(wheelPicks, doc.sessionId).some((p) => p.round === doc.round && p.order === doc.order)) throw taken('place on the wheel');
      const rec = {
        _id: oid(),
        classStudentId: null,
        ask: 'bank',
        questionId: null,
        status: 'pending',
        pickedBy: null,
        pickedAt: new Date().toISOString(),
        statusAt: null,
        statusBy: null,
        ...clone(doc),
        sessionId: String(doc.sessionId),
      };
      wheelPicks.set(rec._id, rec);
      return clone(rec);
    },

    /** What was asked and how they responded. Who was drawn, and from what, is written once. */
    async updateWheelPick(id, patch) {
      return update(wheelPicks, id, patch, ['ask', 'questionId', 'status', 'statusAt', 'statusBy']);
    },

    /** The order they were asked in. */
    async listTallies(sessionId) {
      return clone(ofRoom(tallies, sessionId).sort((a, b) => a.seq - b.seq));
    },

    async addTally(doc) {
      if (ofRoom(tallies, doc.sessionId).some((t) => t.seq === doc.seq)) throw taken('place in the room\'s questions');
      const now = new Date().toISOString();
      const rec = {
        _id: oid(),
        questionId: null,
        labels: ['', '', '', ''],
        counts: [0, 0, 0, 0],
        revealed: false,
        correct: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        ...clone(doc),
        sessionId: String(doc.sessionId),
      };
      tallies.set(rec._id, rec);
      return clone(rec);
    },

    async updateTally(id, patch) {
      return update(tallies, id, patch, ['questionId', 'text', 'labels', 'counts', 'revealed', 'correct', 'updatedAt']);
    },

    async listActivities(sessionId) {
      return clone(ofRoom(activities, sessionId).sort((a, b) => a.seq - b.seq));
    },

    async addActivity(doc) {
      if (ofRoom(activities, doc.sessionId).some((a) => a.seq === doc.seq)) throw taken('place in the room\'s activities');
      const now = new Date().toISOString();
      const rec = {
        _id: oid(),
        outcome: '',
        groups: [],
        tallyId: null,
        createdBy: null,
        createdAt: now,
        updatedAt: now,
        ...clone(doc),
        sessionId: String(doc.sessionId),
      };
      activities.set(rec._id, rec);
      return clone(rec);
    },

    async updateActivity(id, patch) {
      return update(activities, id, patch, ['outcome', 'groups', 'tallyId', 'updatedAt']);
    },

    /** Append-only: what a professor did about a flag. */
    async addInsightAction(doc) {
      const rec = { _id: oid(), note: '', actedBy: null, actedAt: new Date().toISOString(), ...clone(doc), sessionId: String(doc.sessionId) };
      insightActions.push(rec);
      return clone(rec);
    },

    /** Oldest first. */
    async listInsightActions(sessionId) {
      return clone(insightActions
        .filter((a) => a.sessionId === String(sessionId))
        .sort((a, b) => (a.actedAt < b.actedAt ? -1 : a.actedAt > b.actedAt ? 1 : 0)));
    },

    // -- projector links (0018) --
    // One token per link: a second link with the same hash is refused, as
    // projector_links_token_hash_key refuses it in Postgres.
    async addProjectorLink(doc) {
      if ([...projectorLinks.values()].some((l) => l.tokenHash === doc.tokenHash)) throw taken('projector token');
      const rec = {
        _id: oid(), createdAt: new Date().toISOString(), createdBy: null, revokedAt: null, revokedBy: null,
        ...clone(doc), sessionId: String(doc.sessionId),
      };
      projectorLinks.set(rec._id, rec);
      return clone(rec);
    },

    async getProjectorLinkByHash(tokenHash) {
      return clone([...projectorLinks.values()].find((l) => l.tokenHash === String(tokenHash)) ?? null);
    },

    /** Oldest first. */
    async listProjectorLinks(sessionId) {
      return clone(ofRoom(projectorLinks, sessionId)
        .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)));
    },

    /** Only revokedAt and revokedBy ever change, as 0018's guard allows. */
    async revokeProjectorLink(id, { revokedAt, revokedBy = null }) {
      return update(projectorLinks, id, { revokedAt, revokedBy }, ['revokedAt', 'revokedBy']);
    },

    // -- course outcomes (0019; services/outcomes.js, routes/outcomes.js) --

    /** Every outcome of a class, archived ones included, by position then age. */
    async listOutcomes(classId) {
      return clone([...outcomes.values()]
        .filter((o) => o.classId === String(classId))
        .sort((a, b) => a.position - b.position || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)));
    },

    async getOutcome(id) {
      return clone(outcomes.get(String(id)) ?? null);
    },

    /** A code another outcome of the class holds, not archived, is a 409. */
    async createOutcome(doc) {
      if (codeHeld(doc.classId, doc.code)) throw codeTaken(doc.code);
      const now = new Date().toISOString();
      const rec = {
        _id: oid(), targetLevel: null, position: 1, archivedAt: null, createdAt: now, updatedAt: now,
        ...clone(doc), classId: String(doc.classId),
      };
      outcomes.set(rec._id, rec);
      return clone(rec);
    },

    /** Code, statement, target level, position and archivedAt (null restores). The class never changes. */
    async updateOutcome(id, patch) {
      const rec = outcomes.get(String(id));
      if (!rec) return null;
      const code = patch.code ?? rec.code;
      const active = patch.archivedAt === undefined ? !rec.archivedAt : !patch.archivedAt;
      if (active && (code !== rec.code || (rec.archivedAt && !patch.archivedAt)) && codeHeld(rec.classId, code, rec._id)) {
        throw codeTaken(code);
      }
      for (const k of ['code', 'statement', 'targetLevel', 'position', 'archivedAt']) if (patch[k] !== undefined) rec[k] = patch[k];
      rec.updatedAt = new Date().toISOString();
      return clone(rec);
    },

    /** The outcome and its topic mappings (Postgres's ON DELETE CASCADE). The caller takes it off overrides first. */
    async deleteOutcome(id) {
      const key = String(id);
      for (const [tid, l] of outcomeTopics) if (l.outcomeId === key) outcomeTopics.delete(tid);
      return outcomes.delete(key);
    },

    /** Every topic mapping of a class's outcomes, in the order written. */
    async listOutcomeTopics(classId) {
      return clone([...outcomeTopics.values()].filter((l) => l.classId === String(classId)));
    },

    /**
     * Replace one outcome's topics with `links` ([{ contentId, topic, weight }]):
     * a topic it already had keeps its row (its weight and spelling updated),
     * the rest are added, and topics not in `links` are removed. Returns the
     * outcome's topics now.
     */
    async setOutcomeTopics(outcomeId, classId, links) {
      const oidKey = String(outcomeId);
      const held = new Map([...outcomeTopics.values()].filter((l) => l.outcomeId === oidKey).map((l) => [linkKey(l), l]));
      const wanted = new Set();
      for (const l of links) {
        const doc = { contentId: String(l.contentId), topic: l.topic, weight: Number(l.weight) || 1 };
        const key = linkKey(doc);
        wanted.add(key);
        const prior = held.get(key);
        if (prior) Object.assign(prior, { topic: doc.topic, weight: doc.weight });
        else {
          const rec = { _id: oid(), outcomeId: oidKey, classId: String(classId), ...doc, createdAt: new Date().toISOString() };
          outcomeTopics.set(rec._id, rec);
        }
      }
      for (const [key, l] of held) if (!wanted.has(key)) outcomeTopics.delete(l._id);
      return clone([...outcomeTopics.values()].filter((l) => l.outcomeId === oidKey));
    },

    async listQuestionOverrides(classId) {
      return clone([...overrides.values()].filter((o) => o.classId === String(classId)));
    },

    /** Upsert on (classId, questionId): one override per question per class. */
    async setQuestionOverride(doc) {
      const key = `${doc.classId}:${doc.questionId}`;
      const rec = {
        _id: overrides.get(key)?._id ?? oid(),
        classId: String(doc.classId),
        questionId: String(doc.questionId),
        outcomeIds: doc.excluded ? [] : (doc.outcomeIds ?? []).map(String),
        excluded: doc.excluded === true,
        updatedAt: new Date().toISOString(),
        updatedBy: doc.updatedBy ?? null,
      };
      overrides.set(key, rec);
      return clone(rec);
    },

    async deleteQuestionOverride(classId, questionId) {
      return overrides.delete(`${classId}:${questionId}`);
    },

    // -- attainment formulas (0020; services/attainment.js, routes/attainment.js) --

    /** The version in force: the class's highest, or null when none was saved. */
    async getAttainmentConfig(classId) {
      const mine = attainmentConfigs.filter((c) => c.classId === String(classId));
      return clone(mine.reduce((top, c) => (!top || c.version > top.version ? c : top), null));
    },

    /**
     * Append a version. One per (class, version), as
     * attainment_configs_class_version_key has it: a save that lost a race for
     * the number is a 409, and nothing is written.
     */
    async addAttainmentConfig(doc) {
      if (attainmentConfigs.some((c) => c.classId === String(doc.classId) && c.version === doc.version)) {
        throw Object.assign(new Error('The attainment formula was changed by another request. Nothing was saved: read it again.'), { status: 409 });
      }
      const rec = {
        _id: oid(), createdAt: new Date().toISOString(), createdBy: null,
        ...clone(doc), classId: String(doc.classId),
      };
      attainmentConfigs.push(rec);
      return clone(rec);
    },

    // -- class questions (0023; services/classQuestions.js, routes/classQuestions.js) --

    /**
     * One class question. A room holds at most one that is not closed, and one
     * per seq: a second is a 409, as class_questions_one_running and
     * class_questions_session_seq_key make it in Postgres.
     */
    async addClassQuestion(doc) {
      const mine = ofRoom(classQuestions, doc.sessionId);
      if (mine.some((c) => c.state !== 'closed')) {
        throw Object.assign(new Error('Another class question is still running in this room. Close it first.'), { status: 409 });
      }
      if (mine.some((c) => c.seq === doc.seq)) throw taken('place in the room\'s class questions');
      const rec = {
        _id: oid(), questionId: null, state: 'open', revealed: false, startedAt: new Date().toISOString(), startedBy: null,
        pausedAt: null, revoteAt: null, closedAt: null, closedBy: null,
        ...clone(doc), sessionId: String(doc.sessionId),
      };
      classQuestions.set(rec._id, rec);
      return clone(rec);
    },

    async getClassQuestion(id) {
      return clone(classQuestions.get(String(id)) ?? null);
    },

    /** In the order they were asked. */
    async listClassQuestions(sessionId) {
      return clone(ofRoom(classQuestions, sessionId).sort((a, b) => a.seq - b.seq));
    },

    /** Where it stands, and nothing else: what was asked, in which room and when are written once. */
    async updateClassQuestion(id, patch) {
      return update(classQuestions, id, patch, ['state', 'revealed', 'pausedAt', 'revoteAt', 'closedAt', 'closedBy']);
    },

    // ---- Phase 6: the hub's content backbone (0025; services/hubTopics.js, services/hubAccess.js, routes/hub.js) ----
    // A class's units and the chapters placed on it, each chapter's topic
    // records, prerequisite links between topics, and a deck's per-slide text.
    // The same contract as the Postgres tables: one unit name per class (case
    // ignored), one placement per (class, chapter), one record per (chapter,
    // key), one link per (prerequisite, topic); a removed unit leaves its
    // chapters in no unit, as ON DELETE SET NULL does.
    ...(() => {
      const units = new Map();
      const placements = new Map();
      const topics = new Map();
      const links = new Map();
      const nameTaken = (classId, name, exceptId = null) => [...units.values()].some((u) => u.classId === String(classId)
        && u.name.toLowerCase() === String(name).toLowerCase() && u._id !== exceptId);
      const unitConflict = (name) => Object.assign(new Error(`There is already a unit called "${name}" in this class.`), { status: 409 });
      const inOrder = (a, b) => (a.position - b.position) || String(a.createdAt ?? a.addedAt).localeCompare(String(b.createdAt ?? b.addedAt));
      return {
        /** A class's units by position, then age. */
        async listClassUnits(classId) {
          return clone([...units.values()].filter((u) => u.classId === String(classId)).sort(inOrder));
        },

        async getClassUnit(id) {
          return clone(units.get(String(id)) ?? null);
        },

        async createClassUnit(doc) {
          if (nameTaken(doc.classId, doc.name)) throw unitConflict(doc.name);
          const now = new Date().toISOString();
          const rec = { _id: oid(), position: 1, createdBy: null, createdAt: now, updatedAt: now, ...clone(doc), classId: String(doc.classId) };
          units.set(rec._id, rec);
          return clone(rec);
        },

        /** Name and position only; the class never changes. */
        async updateClassUnit(id, patch) {
          const rec = units.get(String(id));
          if (!rec) return null;
          if (patch.name !== undefined && nameTaken(rec.classId, patch.name, rec._id)) throw unitConflict(patch.name);
          for (const k of ['name', 'position']) if (patch[k] !== undefined) rec[k] = patch[k];
          rec.updatedAt = new Date().toISOString();
          return clone(rec);
        },

        /** The unit goes; its chapters stay on the class, in no unit. */
        async deleteClassUnit(id) {
          const key = String(id);
          for (const p of placements.values()) if (p.unitId === key) p.unitId = null;
          return units.delete(key);
        },

        /** Every chapter placed on a class, in no particular order (the views order them). */
        async listClassChapters(classId) {
          return clone([...placements.values()].filter((p) => p.classId === String(classId)));
        },

        /** A chapter already on the class is a 409, as class_chapters_class_content_key makes it. */
        async placeClassChapter(doc) {
          const held = [...placements.values()].some((p) => p.classId === String(doc.classId) && p.contentId === String(doc.contentId));
          if (held) throw Object.assign(new Error('That chapter is already on this class.'), { status: 409 });
          const rec = {
            _id: oid(), unitId: null, position: 1, addedBy: null, addedAt: new Date().toISOString(),
            ...clone(doc), classId: String(doc.classId), contentId: String(doc.contentId),
          };
          if (rec.unitId != null) rec.unitId = String(rec.unitId);
          placements.set(rec._id, rec);
          return clone(rec);
        },

        /** Its unit (null for none) and position only. */
        async updateClassChapter(id, patch) {
          const rec = placements.get(String(id));
          if (!rec) return null;
          if (patch.unitId !== undefined) rec.unitId = patch.unitId == null ? null : String(patch.unitId);
          if (patch.position !== undefined) rec.position = patch.position;
          return clone(rec);
        },

        async removeClassChapter(classId, contentId) {
          for (const [id, p] of placements) {
            if (p.classId === String(classId) && p.contentId === String(contentId)) return placements.delete(id);
          }
          return false;
        },

        /** A chapter's topic records, retired ones included, by position then age. */
        async listChapterTopics(contentId) {
          return clone([...topics.values()].filter((t) => t.contentId === String(contentId)).sort(inOrder));
        },

        async getChapterTopic(id) {
          return clone(topics.get(String(id)) ?? null);
        },

        async listChapterTopicsByIds(ids = []) {
          return clone(ids.map((id) => topics.get(String(id))).filter(Boolean));
        },

        /** Insert; a key the chapter already holds is skipped (ON CONFLICT DO NOTHING). Returns the rows added. */
        async addChapterTopics(contentId, docs = []) {
          const made = [];
          for (const d of docs) {
            if ([...topics.values()].some((t) => t.contentId === String(contentId) && t.key === d.key)) continue;
            const now = new Date().toISOString();
            const rec = { _id: oid(), position: 1, retiredAt: null, createdAt: now, updatedAt: now, ...clone(d), contentId: String(contentId) };
            topics.set(rec._id, rec);
            made.push(rec);
          }
          return clone(made);
        },

        /** Name, position and retiredAt only (the key follows the name). */
        async updateChapterTopic(id, patch) {
          const rec = topics.get(String(id));
          if (!rec) return null;
          for (const k of ['name', 'position', 'retiredAt']) if (patch[k] !== undefined) rec[k] = patch[k];
          if (patch.name !== undefined) rec.key = String(patch.name).toLowerCase();
          rec.updatedAt = new Date().toISOString();
          return clone(rec);
        },

        /** The record and, as ON DELETE CASCADE does, any link touching it. */
        async deleteChapterTopic(id) {
          const key = String(id);
          for (const [lid, l] of links) if (l.prerequisiteId === key || l.topicId === key) links.delete(lid);
          return topics.delete(key);
        },

        /**
         * `ownerId` (null for the unowned): one professor's links. `topicIds`:
         * only those touching these topics. Oldest first.
         */
        async listTopicLinks(filter = {}) {
          const ids = Array.isArray(filter.topicIds) ? new Set(filter.topicIds.map(String)) : null;
          return clone([...links.values()]
            .filter((l) => (!('ownerId' in filter) || String(l.ownerId ?? '') === String(filter.ownerId ?? ''))
              && (!ids || ids.has(l.prerequisiteId) || ids.has(l.topicId)))
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
        },

        async getTopicLink(id) {
          return clone(links.get(String(id)) ?? null);
        },

        /** One link per (prerequisite, topic): a second is a 409, as topic_links_pair_key makes it. */
        async addTopicLink(doc) {
          const p = String(doc.prerequisiteId);
          const t = String(doc.topicId);
          if ([...links.values()].some((l) => l.prerequisiteId === p && l.topicId === t)) {
            throw Object.assign(new Error('Those two topics are already linked.'), { status: 409 });
          }
          const rec = {
            _id: oid(), ownerId: null, reason: '', model: null, createdBy: null, createdAt: new Date().toISOString(),
            decidedAt: null, decidedBy: null, ...clone(doc), prerequisiteId: p, topicId: t,
          };
          links.set(rec._id, rec);
          return clone(rec);
        },

        /** Its state and who decided it, and when, only: the pair, provenance and reason are written once. */
        async updateTopicLink(id, patch) {
          return update(links, id, patch, ['state', 'decidedAt', 'decidedBy']);
        },

        async deleteTopicLink(id) {
          return links.delete(String(id));
        },

        /** A deck's per-slide text (0025), written once after the upload. */
        async setContentSlideTexts(contentId, slideTexts) {
          const rec = contents.get(String(contentId));
          if (!rec) return null;
          rec.slideTexts = clone(slideTexts);
          return clone(rec);
        },
      };
    })(),

    // ---- Phase 6: practice, mastery, the error log and reviews (0026; services/hubPractice.js, routes/hubPractice.js) ----
    // A student's hub attempts, append-only, one per (account, client attempt
    // id): a resend returns the stored row with `duplicate: true`, never a
    // second one, as hub_attempts_account_attempt_key makes it in Postgres.
    // Nothing here updates or deletes an attempt. And one explanation per
    // question (question_explanations_question_key).
    ...(() => {
      const attempts = new Map(); // key: _id
      const attemptKeys = new Map(); // `${accountId}:${clientAttemptId}` -> _id
      const explanations = new Map(); // key: questionId
      let seq = 0;
      // Server time, then the order written: rows of one millisecond keep it.
      const inOrder = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.seq - b.seq);
      const out = (rec) => {
        if (!rec) return null;
        const { seq: _seq, ...row } = rec;
        return clone(row);
      };
      const listed = (v) => (Array.isArray(v) ? new Set(v.map(String)) : null);
      return {
        async addHubAttempt(doc) {
          const k = `${doc.accountId}:${doc.clientAttemptId}`;
          const held = attemptKeys.get(k);
          if (held) return { attempt: out(attempts.get(held)), duplicate: true };
          const rec = {
            _id: oid(),
            classId: null,
            contentId: null,
            topicId: null,
            topic: '',
            questionId: null,
            kind: 'mcq',
            questionSnapshot: {},
            questionSource: 'llm',
            response: null,
            detail: '',
            reviewStatus: 'auto',
            language: 'en',
            hintsUsed: 0,
            timeTakenMs: null,
            // The Get Ready check or self-test it was given in (0028), or none.
            runId: null,
            // 0036 (Batch 8): kept without proof the hub served the question.
            unproven: false,
            createdAt: new Date().toISOString(),
            ...clone(doc),
            accountId: String(doc.accountId),
            seq: (seq += 1),
          };
          attempts.set(rec._id, rec);
          attemptKeys.set(k, rec._id);
          return { attempt: out(rec), duplicate: false };
        },

        async getHubAttemptByKey(accountId, clientAttemptId) {
          const id = attemptKeys.get(`${accountId}:${clientAttemptId}`);
          return id ? out(attempts.get(id)) : null;
        },

        /**
         * Oldest first (server time, then id). Filters are ANDed: `accountId`,
         * `accountIds`, `topicIds`, `questionIds`, `runIds` (lists; an empty list
         * matches nothing) and `since` (an ISO time, inclusive).
         */
        async listHubAttempts({ accountId, accountIds, topicIds, questionIds, runIds, since } = {}) {
          const accounts = listed(accountIds);
          const topics = listed(topicIds);
          const questions = listed(questionIds);
          const runs = listed(runIds);
          return [...attempts.values()]
            .filter((a) => (!accountId || a.accountId === String(accountId))
              && (!accounts || accounts.has(a.accountId))
              && (!topics || topics.has(String(a.topicId ?? '')))
              && (!questions || questions.has(String(a.questionId ?? '')))
              && (!runs || runs.has(String(a.runId ?? '')))
              && (!since || a.createdAt >= since))
            .sort(inOrder)
            .map(out);
        },

        async getQuestionExplanation(questionId) {
          return clone(explanations.get(String(questionId)) ?? null);
        },

        async listQuestionExplanations(questionIds = []) {
          return clone(questionIds.map((id) => explanations.get(String(id))).filter(Boolean));
        },

        /** Insert only: a question that already has one is a 409, as question_explanations_question_key makes it. */
        async addQuestionExplanation(doc) {
          const key = String(doc.questionId);
          if (explanations.has(key)) {
            throw Object.assign(new Error('That question already has an explanation.'), { status: 409 });
          }
          const now = new Date().toISOString();
          const rec = {
            _id: oid(), model: null, sourceRef: null, createdBy: null, createdAt: now, updatedAt: now,
            approvedBy: null, approvedAt: null, ...clone(doc), questionId: key,
          };
          explanations.set(key, rec);
          return clone(rec);
        },

        /** Its words, who wrote it, whether it is approved and what it cites; the question never changes. */
        async updateQuestionExplanation(questionId, patch) {
          const rec = explanations.get(String(questionId));
          if (!rec) return null;
          for (const k of ['text', 'provenance', 'status', 'model', 'sourceRef', 'approvedBy', 'approvedAt']) {
            if (patch[k] !== undefined) rec[k] = clone(patch[k]);
          }
          rec.updatedAt = new Date().toISOString();
          return clone(rec);
        },

        async deleteQuestionExplanation(questionId) {
          return explanations.delete(String(questionId));
        },
      };
    })(),

    // ---- Phase 6: lessons and languages (0027; services/hubLessons.js, services/hubLanguages.js, routes/hubLessons.js, routes/hubLanguages.js) ----
    // A topic's lessons, one row per version; Hindi and Marathi versions of
    // what a student reads; and each student's chosen language. The same
    // contract as the Postgres tables: a row is written as a draft; its content
    // never changes, except a translation's while it is a draft; only its status
    // moves on (draft -> approved -> superseded, or draft -> discarded), and
    // approving one retires the one approved before it at once, so one is
    // approved per topic, and per item and language. Nothing is deleted.
    ...(() => {
      const lessons = new Map();
      const translations = new Map();
      const choices = new Map();
      const conflict = (message) => Object.assign(new Error(message), { status: 409 });
      const notDraft = (what, rec) => conflict(`Only a draft ${what} can be approved or discarded; this one is ${rec.status}.`);
      const decide = (map, rec, { status, by }) => {
        const now = new Date().toISOString();
        if (status === 'approved') Object.assign(rec, { status, approvedAt: now, approvedBy: by ?? null });
        else Object.assign(rec, { status, retiredAt: now, retiredBy: by ?? null });
        return clone(rec);
      };
      return {
        /** A new version of a topic's lesson, as a draft. A version the topic already has is a 409. */
        async createTopicLesson(doc) {
          const topicId = String(doc.topicId);
          if ([...lessons.values()].some((l) => l.topicId === topicId && l.version === doc.version)) {
            throw conflict('Another version of this lesson was written at the same time. Nothing was changed; try again.');
          }
          const rec = {
            _id: oid(), ownerId: null, model: null, basis: {}, warnings: [], createdBy: null,
            ...clone(doc),
            topicId, contentId: String(doc.contentId), status: 'draft', createdAt: new Date().toISOString(),
            approvedAt: null, approvedBy: null, retiredAt: null, retiredBy: null,
          };
          lessons.set(rec._id, rec);
          return clone(rec);
        },

        async getTopicLesson(id) {
          return clone(lessons.get(String(id)) ?? null);
        },

        /** `topicId` or `contentId`: their lessons, every status, oldest version first. */
        async listTopicLessons(filter = {}) {
          return clone([...lessons.values()]
            .filter((l) => (filter.topicId === undefined || l.topicId === String(filter.topicId))
              && (filter.contentId === undefined || l.contentId === String(filter.contentId)))
            .sort((a, b) => String(a.topicId).localeCompare(String(b.topicId)) || a.version - b.version));
        },

        /** Approve a draft and retire the topic's approved one. Null when there is no such lesson; 409 when it is not a draft. */
        async approveTopicLesson(id, { by = null } = {}) {
          const rec = lessons.get(String(id));
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('lesson', rec);
          for (const l of lessons.values()) if (l.topicId === rec.topicId && l.status === 'approved') decide(lessons, l, { status: 'superseded', by });
          return decide(lessons, rec, { status: 'approved', by });
        },

        /** Discard a draft. Null when there is no such lesson; 409 when it is not a draft. */
        async discardTopicLesson(id, { by = null } = {}) {
          const rec = lessons.get(String(id));
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('lesson', rec);
          return decide(lessons, rec, { status: 'discarded', by });
        },

        /** A translation, as a draft. */
        async addItemTranslation(doc) {
          const now = new Date().toISOString();
          const rec = {
            _id: oid(), ownerId: null, model: null, checks: [], createdBy: null, editedBy: null,
            ...clone(doc),
            itemId: String(doc.itemId), contentId: String(doc.contentId), status: 'draft', createdAt: now, updatedAt: now,
            approvedAt: null, approvedBy: null, retiredAt: null, retiredBy: null,
          };
          translations.set(rec._id, rec);
          return clone(rec);
        },

        async getItemTranslation(id) {
          return clone(translations.get(String(id)) ?? null);
        },

        /**
         * `contentId`, `itemKind`, `itemIds`, `language`, `status` (one, or a
         * list): the translations matching all given, oldest first.
         */
        async listItemTranslations(filter = {}) {
          const ids = Array.isArray(filter.itemIds) ? new Set(filter.itemIds.map((x) => String(x).toLowerCase())) : null;
          const statuses = filter.status === undefined ? null : [].concat(filter.status);
          return clone([...translations.values()]
            .filter((t) => (filter.contentId === undefined || t.contentId === String(filter.contentId))
              && (filter.itemKind === undefined || t.itemKind === filter.itemKind)
              && (!ids || ids.has(t.itemId.toLowerCase()))
              && (filter.language === undefined || t.language === filter.language)
              && (!statuses || statuses.includes(t.status)))
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
        },

        /** A draft's text, the English it is checked against, its checks and who edited it. 409 when it is not a draft. */
        async editItemTranslation(id, patch) {
          const rec = translations.get(String(id));
          if (!rec) return null;
          if (rec.status !== 'draft') throw conflict(`Only a draft translation can be changed; this one is ${rec.status}.`);
          for (const k of ['fields', 'sourceFields', 'sourceHash', 'checks', 'provenance', 'editedBy']) {
            if (patch[k] !== undefined) rec[k] = clone(patch[k]);
          }
          rec.updatedAt = new Date().toISOString();
          return clone(rec);
        },

        /** Approve a draft and retire the approved one of its item and language. Null / 409 as for a lesson. */
        async approveItemTranslation(id, { by = null } = {}) {
          const rec = translations.get(String(id));
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('translation', rec);
          for (const t of translations.values()) {
            if (t.itemKind === rec.itemKind && t.itemId === rec.itemId && t.language === rec.language && t.status === 'approved') {
              decide(translations, t, { status: 'superseded', by });
            }
          }
          return decide(translations, rec, { status: 'approved', by });
        },

        async discardItemTranslation(id, { by = null } = {}) {
          const rec = translations.get(String(id));
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('translation', rec);
          return decide(translations, rec, { status: 'discarded', by });
        },

        /** A student's chosen language, or null when they chose none. */
        async getLanguageChoice(accountId) {
          return choices.get(String(accountId))?.language ?? null;
        },

        async setLanguageChoice(accountId, language) {
          const rec = { accountId: String(accountId), language, updatedAt: new Date().toISOString() };
          choices.set(rec.accountId, rec);
          return clone(rec);
        },
      };
    })(),

    // ---- Phase 6: Get Ready, self-tests and goals (0028; services/hubGetReady.js, services/hubExam.js, services/hubGoals.js, routes/hubPaths.js) ----
    // A student's runs (a Get Ready check or a self-test), one per (account,
    // client run id): a resend returns the stored run with `duplicate: true`,
    // as hub_runs_account_run_key makes it in Postgres. A run is written once
    // and then only ended, once (0028's guard); nothing here deletes one. Its
    // attempts are hub attempts carrying its id (listHubAttempts({ runIds })).
    // And a student's goals, which are theirs to change or remove.
    ...(() => {
      const runs = new Map(); // key: _id
      const runKeys = new Map(); // `${accountId}:${clientRunId}` -> _id
      const goals = new Map();
      let seq = 0;
      const out = (rec) => {
        if (!rec) return null;
        const { seq: _seq, ...row } = rec;
        return clone(row);
      };
      const inOrder = (a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.seq - b.seq);
      return {
        async addHubRun(doc) {
          const k = `${doc.accountId}:${doc.clientRunId}`;
          const held = runKeys.get(k);
          if (held) return { run: out(runs.get(held)), duplicate: true };
          const rec = {
            _id: oid(),
            spec: {},
            timeLimitSeconds: null,
            startedAt: new Date().toISOString(),
            deadlineAt: null,
            endedAt: null,
            endReason: null,
            ...clone(doc),
            accountId: String(doc.accountId),
            seq: (seq += 1),
          };
          runs.set(rec._id, rec);
          runKeys.set(k, rec._id);
          return { run: out(rec), duplicate: false };
        },

        async getHubRun(id) {
          return out(runs.get(String(id)) ?? null);
        },

        async getHubRunByKey(accountId, clientRunId) {
          const id = runKeys.get(`${accountId}:${clientRunId}`);
          return id ? out(runs.get(id)) : null;
        },

        /** Oldest first. Filters are ANDed: `accountId`, `ids` (a list; empty matches nothing), `kind`. */
        async listHubRuns({ accountId, ids, kind } = {}) {
          const wanted = Array.isArray(ids) ? new Set(ids.map(String)) : null;
          return [...runs.values()]
            .filter((r) => (!accountId || r.accountId === String(accountId))
              && (!wanted || wanted.has(r._id))
              && (!kind || r.kind === kind))
            .sort(inOrder)
            .map(out);
        },

        /** Write the run's end, once. A run already ended is returned unchanged; null when there is none. */
        async endHubRun(id, { endedAt, endReason }) {
          const rec = runs.get(String(id));
          if (!rec) return null;
          if (!rec.endedAt) Object.assign(rec, { endedAt, endReason });
          return out(rec);
        },

        /** A student's goals, oldest first. */
        async listHubGoals(accountId) {
          return clone([...goals.values()].filter((g) => g.accountId === String(accountId))
            .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
        },

        async getHubGoal(id) {
          return clone(goals.get(String(id)) ?? null);
        },

        async addHubGoal(doc) {
          const now = new Date().toISOString();
          const rec = { _id: oid(), title: '', createdAt: now, updatedAt: now, ...clone(doc), accountId: String(doc.accountId) };
          goals.set(rec._id, rec);
          return clone(rec);
        },

        /** Its title, exam date and topics; whose it is never changes. */
        async updateHubGoal(id, patch) {
          const rec = goals.get(String(id));
          if (!rec) return null;
          for (const k of ['title', 'examDate', 'topicIds']) if (patch[k] !== undefined) rec[k] = clone(patch[k]);
          rec.updatedAt = new Date().toISOString();
          return clone(rec);
        },

        async deleteHubGoal(id) {
          return goals.delete(String(id));
        },
      };
    })(),

    // ---- Phase 6: the tutor's hints and feedback (0029; services/hubTutor.js, routes/hubTutor.js) ----
    // A question's hint ladder, one row per step (question_hints_question_step_key:
    // a second for one step is a 409); feedback on wrong options, one per
    // (question, option key) (option_feedback_question_option_key); both edited in
    // place, as explanations are. And the hints each student opened, append-only,
    // one per (account, client attempt id, position): a second for one position
    // returns the stored row with `duplicate: true`, as
    // hub_hint_views_attempt_position_key makes it in Postgres. Nothing here
    // updates or deletes a hint view.
    ...(() => {
      const hints = new Map();
      const feedback = new Map();
      const views = new Map();
      const viewKeys = new Map(); // `${accountId}:${clientAttemptId}:${position}` -> _id
      let seq = 0;
      const conflict = (message) => Object.assign(new Error(message), { status: 409 });
      const ofQuestions = (map, questionIds) => {
        const ids = new Set(questionIds.map(String));
        return clone([...map.values()].filter((r) => ids.has(r.questionId))
          .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
      };
      const patchRow = (map, id, patch, allowed) => {
        const rec = map.get(String(id));
        if (!rec) return null;
        for (const k of allowed) if (patch[k] !== undefined) rec[k] = clone(patch[k]);
        rec.updatedAt = new Date().toISOString();
        return clone(rec);
      };
      const EDITABLE = ['text', 'provenance', 'status', 'model', 'sourceRef', 'approvedBy', 'approvedAt'];
      return {
        /** Every hint of these questions, every status, oldest first. */
        async listQuestionHints(questionIds = []) {
          return ofQuestions(hints, questionIds);
        },

        async getQuestionHint(id) {
          return clone(hints.get(String(id)) ?? null);
        },

        /** Insert only: a step the question already has is a 409. */
        async addQuestionHint(doc) {
          const questionId = String(doc.questionId);
          if ([...hints.values()].some((h) => h.questionId === questionId && h.step === doc.step)) {
            throw conflict('That question already has a hint at this step.');
          }
          const now = new Date().toISOString();
          const rec = {
            _id: oid(), model: null, sourceRef: null, createdBy: null, createdAt: now, updatedAt: now, approvedBy: null, approvedAt: null,
            ...clone(doc), questionId,
          };
          hints.set(rec._id, rec);
          return clone(rec);
        },

        /** Its words, who wrote it, whether it is approved and what it cites; the question and step never change. */
        async updateQuestionHint(id, patch) {
          return patchRow(hints, id, patch, EDITABLE);
        },

        async deleteQuestionHint(id) {
          return hints.delete(String(id));
        },

        /** Every feedback row of these questions, every status, oldest first. */
        async listOptionFeedback(questionIds = []) {
          return ofQuestions(feedback, questionIds);
        },

        async getOptionFeedback(id) {
          return clone(feedback.get(String(id)) ?? null);
        },

        /** Insert only: an option (by key) the question already has feedback on is a 409. */
        async addOptionFeedback(doc) {
          const questionId = String(doc.questionId);
          if ([...feedback.values()].some((f) => f.questionId === questionId && f.optionKey === doc.optionKey)) {
            throw conflict('That option already has feedback.');
          }
          const now = new Date().toISOString();
          const rec = {
            _id: oid(), model: null, sourceRef: null, createdBy: null, createdAt: now, updatedAt: now, approvedBy: null, approvedAt: null,
            ...clone(doc), questionId,
          };
          feedback.set(rec._id, rec);
          return clone(rec);
        },

        /** As a hint, and the option's words as they stand now (its key never changes). */
        async updateOptionFeedback(id, patch) {
          return patchRow(feedback, id, patch, ['option', ...EDITABLE]);
        },

        async deleteOptionFeedback(id) {
          return feedback.delete(String(id));
        },

        async addHintView(doc) {
          const k = `${doc.accountId}:${doc.clientAttemptId}:${doc.position}`;
          const held = viewKeys.get(k);
          if (held) {
            const { seq: _s, ...row } = views.get(held);
            return { view: clone(row), duplicate: true };
          }
          const rec = {
            _id: oid(), questionId: null, topicId: null, contentId: null, hintId: null, language: 'en', translationId: null,
            sourceRef: null, plan: {}, createdAt: new Date().toISOString(),
            ...clone(doc), accountId: String(doc.accountId), seq: (seq += 1),
          };
          views.set(rec._id, rec);
          viewKeys.set(k, rec._id);
          const { seq: _s, ...row } = rec;
          return { view: clone(row), duplicate: false };
        },

        /**
         * Oldest first (server time, then the order written). Filters are ANDed:
         * `accountId`, `clientAttemptId`, `questionIds` (a list; an empty list
         * matches nothing).
         */
        async listHintViews({ accountId, clientAttemptId, questionIds } = {}) {
          const qs = Array.isArray(questionIds) ? new Set(questionIds.map(String)) : null;
          return [...views.values()]
            .filter((v) => (!accountId || v.accountId === String(accountId))
              && (!clientAttemptId || v.clientAttemptId === String(clientAttemptId))
              && (!qs || qs.has(String(v.questionId ?? ''))))
            .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.seq - b.seq))
            .map(({ seq: _s, ...row }) => clone(row));
        },
      };
    })(),
    // ---- Phase 7: question packs ----
    // A pack of the questions a phone would be served next, for use while its
    // connection is down (services/offline.js; question_packs, 0030). Written
    // once: a new pack is a new record. Deleted only with its room.

    async addQuestionPack(doc) {
      const ids = (doc.questionIds ?? []).map(String);
      // As 0030's checks refuse them: 1 to 20 questions, an expiry after the issue.
      if (ids.length < 1 || ids.length > 20) {
        throw Object.assign(new Error('A question pack holds 1 to 20 questions.'), { status: 400 });
      }
      const issuedAt = doc.issuedAt ?? new Date().toISOString();
      if (!(Date.parse(doc.expiresAt) > Date.parse(issuedAt))) {
        throw Object.assign(new Error('A question pack expires after it is sent.'), { status: 400 });
      }
      const rec = {
        _id: oid(),
        sessionId: String(doc.sessionId),
        rollNo: String(doc.rollNo),
        questionIds: ids,
        issuedAt,
        expiresAt: doc.expiresAt,
      };
      questionPacks.push(rec);
      return clone(rec);
    },

    /** One phone's packs in one room, oldest first (in the order sent, for one instant). */
    async listQuestionPacks(sessionId, rollNo) {
      return clone(questionPacks
        .filter((p) => p.sessionId === String(sessionId) && p.rollNo === String(rollNo))
        .sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt)));
    },

    // ---- Phase 7: laptop mode and room imports ----
    // A room archive from laptop mode made into a closed room here
    // (services/roomImport.js), and the record of the import (0031): the
    // laptop's room id, unique, and the archive as uploaded.

    /**
     * Make the whole room at once: the session, its class questions, profiles,
     * answers (inserted, never updated), reviews and attendance, then the import
     * record. Each row keeps the times it carries. `ref` on a class question and
     * `classQuestionRef` on a vote are the archive's ids, turned into this
     * store's here; a review names its answer by `answerKey`. A room id or a
     * code already held throws `IMPORT_EXISTS` or `CODE_TAKEN` before anything
     * is written; any later failure removes the room again, as Postgres's
     * cascade does.
     */
    async importRoom({ record, session, classQuestions: asked = [], profiles: students = [], answers: rows = [], reviews: decisions = [], attendance: marks = [] }) {
      const exists = (code, message) => Object.assign(new Error(message), { code });
      if ([...roomImports.values()].some((r) => r.sourceRoomId === String(record.sourceRoomId))) {
        throw exists('IMPORT_EXISTS', 'That room was already imported.');
      }
      if ([...sessions.values()].some((s) => s.code === String(session.code).toUpperCase())) {
        throw exists('CODE_TAKEN', `A room with the code ${session.code} already exists.`);
      }
      const made = await this.createSession(session);
      const sessionId = made._id;
      try {
        const cqIds = new Map();
        for (const { ref, ...doc } of asked) {
          const cq = await this.addClassQuestion({ ...doc, sessionId });
          cqIds.set(String(ref), cq._id);
        }
        for (const p of students) await this.saveProfile({ ...p, sessionId });
        const ids = new Map();
        for (const { classQuestionRef, ...doc } of rows) {
          const { answer } = await this.recordAnswer({
            ...doc, sessionId, classQuestionId: classQuestionRef ? cqIds.get(String(classQuestionRef)) ?? null : null,
          });
          ids.set(answer.answerKey, answer._id);
        }
        for (const { answerKey, ...doc } of decisions) await this.addAnswerReview({ ...doc, answerId: ids.get(answerKey), sessionId });
        if (marks.length) await this.saveAttendance(marks.map((m) => ({ ...m, sessionId })));
        const rec = { _id: oid(), ...clone(record), sessionId };
        roomImports.set(rec._id, rec);
        const { data, ...meta } = rec;
        return { session: clone(sessions.get(sessionId)), record: clone(meta) };
      } catch (err) {
        await this.deleteSession(sessionId);
        throw err;
      }
    },

    /** The import of the laptop room `sourceRoomId`, without its archive, or null. */
    async getRoomImportBySource(sourceRoomId) {
      const rec = [...roomImports.values()].find((r) => r.sourceRoomId === String(sourceRoomId));
      if (!rec) return null;
      const { data, ...meta } = importedNow(rec);
      return clone(meta);
    },

    /** One import with the archive as uploaded. */
    async getRoomImport(id) {
      const rec = roomImports.get(String(id));
      return clone(rec ? importedNow(rec) : null);
    },

    /** Newest first, without the archives. */
    async listRoomImports() {
      return clone([...roomImports.values()]
        .map((rec) => { const { data, ...meta } = importedNow(rec); return meta; })
        .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1)));
    },

    /**
     * The imports that made these rooms, without the archives: one per room at
     * most (0031's unique session_id), in no order. A room no import made is
     * simply absent. Read by room id, never by listing every import: the live
     * loop asks it for one closed room, the staff routes for the rooms they show.
     */
    async listRoomImportsForSessions(sessionIds = []) {
      const ids = new Set(sessionIds.map(String));
      return clone([...roomImports.values()]
        .filter((rec) => ids.has(String(rec.sessionId)) && sessions.has(String(rec.sessionId)))
        .map((rec) => { const { data, ...meta } = rec; return meta; }));
    },

    /** A deleted room's archive by the room's id, without its data, or null. */
    async getRoomArchiveBySession(sessionId) {
      const rec = [...archives.values()].find((a) => a.sessionId === String(sessionId));
      if (!rec) return null;
      const { data, ...meta } = rec;
      return clone(meta);
    },

    // ---- Phase 7: replay-safe teacher records (0032; routes/recordSync.js) ----

    /** The write a key was first used for in a room, by this writer, or null. */
    async getRecordWrite({ sessionId, writer, key }) {
      return clone(recordWrites.get(writeKeyOf({ sessionId: String(sessionId), writer, key })) ?? null);
    },

    /**
     * Keep a key with the write's reply. Append-only, and one per (room, writer,
     * key), as record_writes_session_writer_key_key is: a key already held is
     * not replaced, and comes back with `duplicate: true`, as recordAnswer does.
     */
    async addRecordWrite(doc) {
      const k = writeKeyOf({ ...doc, sessionId: String(doc.sessionId) });
      if (recordWrites.has(k)) return { write: clone(recordWrites.get(k)), duplicate: true };
      const rec = { _id: oid(), target: '', createdAt: new Date().toISOString(), ...clone(doc), sessionId: String(doc.sessionId) };
      recordWrites.set(k, rec);
      return { write: clone(rec), duplicate: false };
    },

    // ---- Batch 8: figures (0033; services/slideImages.js, routes/figures.js) ----

    /**
     * A picture kept from a deck's slide: an upload like any other (createMedia),
     * with the slide it was on (`slideNo`, from 1). Its bytes have already had
     * their metadata taken out.
     */
    async createSlideMedia(doc) {
      const { data, ...meta } = doc;
      const _id = oid();
      const rec = { _id, ownerId: null, createdAt: new Date().toISOString(), ...clone(meta), contentId: String(doc.contentId), slideNo: Number(doc.slideNo) };
      media.set(_id, { rec, data: Buffer.from(data) });
      return clone(rec);
    },

    /** A chapter's slide pictures, without their bytes, in slide order (then upload order). */
    async listSlideMedia(contentId) {
      return [...media.values()].map((h) => h.rec)
        .filter((r) => r.contentId === String(contentId) && Number.isInteger(r.slideNo))
        .sort((a, b) => a.slideNo - b.slideNo || String(a.createdAt).localeCompare(String(b.createdAt)))
        .map(clone);
    },

    /** What a deck upload kept of its pictures ({ kept, skippedType, ... }), written once after the upload. */
    async setContentSlidePictures(contentId, summary) {
      const rec = contents.get(String(contentId));
      if (!rec) return null;
      rec.slidePictures = clone(summary);
      return clone(rec.slidePictures);
    },

    /** That summary, or null for a chapter from before pictures were kept (or a pasted syllabus). */
    async getContentSlidePictures(contentId) {
      return clone(contents.get(String(contentId))?.slidePictures ?? null);
    },

    // ---- Batch 8: the live room's suggestions and the wheel's question draws (0034) ----

    /**
     * Keep one suggestion the model made in a room (services/teachingMoves.js).
     * Append-only, as teaching_moves is: nothing here edits or deletes one; it
     * goes only with its room.
     */
    async addTeachingMove(doc) {
      const rec = {
        _id: oid(),
        title: '',
        focusLevel: null,
        topic: '',
        basis: {},
        sourceRef: null,
        askedBy: null,
        askedAt: new Date().toISOString(),
        ...clone(doc),
        sessionId: String(doc.sessionId),
      };
      teachingMoves.push(rec);
      return clone(rec);
    },

    /** A room's suggestions, oldest first. */
    async listTeachingMoves(sessionId) {
      return clone(teachingMoves.filter((m) => m.sessionId === String(sessionId)));
    },

    /** One suggestion by id, or null. */
    async getTeachingMove(id) {
      return clone(teachingMoves.find((m) => m._id === String(id ?? '').trim().toLowerCase()) ?? null);
    },

    /**
     * Keep one question the server drew for a pick. Append-only, and one per
     * (pick, drawOrder), as wheel_question_draws_pick_order_key is: a place
     * already taken is a 409, as a pick's place on the wheel is.
     */
    async addWheelQuestionDraw(doc) {
      if (questionDraws.some((d) => d.pickId === String(doc.pickId) && d.drawOrder === doc.drawOrder)) {
        throw taken('place in the pick\'s questions');
      }
      const rec = {
        _id: oid(),
        questionId: null,
        drawnBy: null,
        drawnAt: new Date().toISOString(),
        ...clone(doc),
        sessionId: String(doc.sessionId),
        pickId: String(doc.pickId),
      };
      questionDraws.push(rec);
      return clone(rec);
    },

    /** Every question drawn in a room, each pick's in draw order. */
    async listWheelQuestionDraws(sessionId) {
      return clone(questionDraws
        .filter((d) => d.sessionId === String(sessionId))
        .sort((a, b) => (a.pickId < b.pickId ? -1 : a.pickId > b.pickId ? 1 : a.drawOrder - b.drawOrder)));
    },

    // ---- Batch 8: material, the bank and the hub's concept panel (0035; services/bankShare.js, routes/bank.js) ----

    /**
     * Keep a question for rooms only, or share it with the Learning Hub again
     * (questions.rooms_only, 0035). The question, or null when there is none.
     */
    async setQuestionRoomsOnly(id, roomsOnly) {
      const rec = questions.get(String(id));
      if (!rec) return null;
      rec.roomsOnly = roomsOnly === true;
      return clone(rec);
    },

    // ---- Batch 9: exam integrity (0038; services/examGuard.js, routes/examGuard.js) ----

    /**
     * A room's exam mode (sessions.exam_mode, 0038), as services/examGuard.js
     * examModeFrom checked it, or null for none. Set at the opening through
     * createSession, and changed here by the owner while the room is not closed.
     * The room as stored now, or null when there is no such room. Screen
     * pictures are never written to any store: they are held in memory by
     * services/examGuard.js alone.
     */
    async setSessionExamMode(id, examMode) {
      const rec = sessions.get(String(id));
      if (!rec) return null;
      rec.examMode = examMode ? clone(examMode) : null;
      return clone(rec);
    },
  };
}
