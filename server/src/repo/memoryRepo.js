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
      for (const list of [observations, insightActions]) {
        for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].sessionId === key) list.splice(i, 1);
      }
      for (const map of [wheelRounds, wheelPicks, tallies, activities, projectorLinks, classQuestions]) {
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
  };
}
