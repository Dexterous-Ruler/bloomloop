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
        const rec = { _id, status: 'active', source: 'llm', createdAt: new Date().toISOString(), ...d, contentId: String(d.contentId) };
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

    async countQuestions(contentId) {
      return [...questions.values()].filter(
        (q) => q.contentId === String(contentId) && q.status === 'active',
      ).length;
    },

    async createSession(doc) {
      const _id = oid();
      const rec = {
        _id,
        status: 'open',
        startedAt: new Date().toISOString(),
        closedAt: null,
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
      return sessions.delete(key);
    },

    async listSessions() {
      return clone([...sessions.values()].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
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
    //
    // `before: { answeredAt, id }` is a page cursor: only rows earlier than it in
    // that same (answeredAt, id) order. The review queue pages by it, newest
    // first, because offsets drift as answers are reviewed out of the queue.
    async listAnswers({
      sessionId, sessionIds, rollNo, accountId, student, topic, bloom, reviewStatus, kind, final, before,
      order = 'asc', limit = 2000, offset = 0,
    } = {}) {
      const ids = Array.isArray(sessionIds) ? new Set(sessionIds.map(String)) : null;
      const isStudents = (a) => (student.accountId && a.accountId && String(a.accountId) === String(student.accountId))
        || (student.rollNo && !a.accountId && a.rollNo === String(student.rollNo));
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
  };
}
