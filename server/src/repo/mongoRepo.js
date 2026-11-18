// MongoDB Atlas / Mongoose implementation. This is the documented primary
// store (report section 5.6). memoryRepo is the fallback with the same surface.

import { Content, Question, Session, Profile, Answer, RoomArchive, AnswerReview } from '../models/index.js';

const lean = (d) => (d ? JSON.parse(JSON.stringify(d)) : null);

export function createMongoRepo() {
  return {
    kind: 'mongo',

    async createContent(doc) {
      return lean(await Content.create(doc));
    },
    async getContent(id) {
      return lean(await Content.findById(id).lean());
    },
    async listContents() {
      return lean(await Content.find().sort({ createdAt: -1 }).lean());
    },
    async updateContent(id, patch) {
      return lean(await Content.findByIdAndUpdate(id, patch, { new: true }).lean());
    },

    async insertQuestions(docs) {
      return lean(await Question.insertMany(docs));
    },
    async listQuestions(contentId, { includeDiscarded = false } = {}) {
      const q = { contentId };
      if (!includeDiscarded) q.status = 'active';
      return lean(await Question.find(q).lean());
    },
    async getQuestion(id) {
      return lean(await Question.findById(id).lean());
    },
    async updateQuestion(id, patch) {
      return lean(await Question.findByIdAndUpdate(id, patch, { new: true }).lean());
    },
    async deleteQuestions(contentId) {
      const res = await Question.deleteMany({ contentId });
      return res?.deletedCount ?? 0;
    },
    async countQuestions(contentId) {
      return Question.countDocuments({ contentId, status: 'active' });
    },

    async createSession(doc) {
      return lean(await Session.create(doc));
    },
    async getSession(id) {
      return lean(await Session.findById(id).lean());
    },
    async getSessionByCode(code) {
      return lean(await Session.findOne({ code: String(code).toUpperCase() }).lean());
    },
    async updateSession(id, patch) {
      return lean(await Session.findByIdAndUpdate(id, patch, { new: true }).lean());
    },
    async deleteSession(id) {
      // Mongo has no cascade, so the profiles go first - the other way round
      // would leave them unreachable if the second call failed.
      await AnswerReview.deleteMany({ sessionId: String(id) });
      await Answer.deleteMany({ sessionId: id });
      await Profile.deleteMany({ sessionId: id });
      await Session.findByIdAndDelete(id);
      return true;
    },

    async listSessions() {
      return lean(await Session.find().sort({ startedAt: -1 }).lean());
    },

    async getProfile(sessionId, rollNo) {
      return lean(await Profile.findOne({ sessionId, rollNo: String(rollNo) }).lean());
    },
    async saveProfile(profile) {
      const { sessionId, rollNo, ...rest } = profile;
      return lean(
        await Profile.findOneAndUpdate(
          { sessionId, rollNo: String(rollNo) },
          { $set: { ...rest, sessionId, rollNo: String(rollNo) } },
          { new: true, upsert: true, setDefaultsOnInsert: true },
        ).lean(),
      );
    },
    async listProfiles(sessionId) {
      const rows = await Profile.find({ sessionId }).lean();
      return lean(
        rows.sort((a, b) =>
          String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true }),
        ),
      );
    },

    // -- answers (append-only evidence) --
    async recordAnswer(doc) {
      try {
        return { answer: lean(await Answer.create(doc)), duplicate: false };
      } catch (err) {
        if (err?.code === 11000) {
          const existing = await this.getAnswerByKey(doc.sessionId, doc.answerKey);
          if (existing) return { answer: existing, duplicate: true };
        }
        throw err;
      }
    },
    async getAnswerByKey(sessionId, answerKey) {
      return lean(await Answer.findOne({ sessionId, answerKey: String(answerKey) }).lean());
    },
    async getAnswer(id) {
      return lean(await Answer.findById(id).lean());
    },
    // `student` and `before`: see memoryRepo. `accountId: null` also matches a missing field.
    async listAnswers({
      sessionId, sessionIds, rollNo, accountId, student, topic, bloom, reviewStatus, kind, final, before,
      order = 'asc', limit = 2000, offset = 0,
    } = {}) {
      const q = {};
      if (sessionId) q.sessionId = sessionId;
      if (Array.isArray(sessionIds)) q.sessionId = { $in: sessionIds };
      if (rollNo) q.rollNo = String(rollNo);
      if (accountId) q.accountId = accountId;
      const anyOf = [];
      if (student) {
        const either = [];
        if (student.accountId) either.push({ accountId: String(student.accountId) });
        if (student.rollNo) either.push({ rollNo: String(student.rollNo), accountId: null });
        if (!either.length) return [];
        anyOf.push(either);
      }
      if (before) {
        anyOf.push([
          { answeredAt: { $lt: String(before.answeredAt) } },
          { answeredAt: String(before.answeredAt), _id: { $lt: String(before.id) } },
        ]);
      }
      // One $or as it stands; two have to be ANDed, since a second $or key would
      // replace the first.
      if (anyOf.length === 1) q.$or = anyOf[0];
      else if (anyOf.length > 1) q.$and = anyOf.map((either) => ({ $or: either }));
      if (topic) q.topic = topic;
      if (bloom) q.bloom = bloom;
      if (reviewStatus) q.reviewStatus = reviewStatus;
      if (kind) q.kind = kind;
      if (final !== undefined) q.final = final === true;
      const dir = order === 'desc' ? -1 : 1;
      return lean(await Answer.find(q).sort({ answeredAt: dir, _id: dir }).skip(offset).limit(limit).lean());
    },
    // -- room archives (see memoryRepo for the contract) --
    async saveRoomArchive(doc) {
      const rec = await RoomArchive.findOneAndUpdate(
        { sessionId: String(doc.sessionId) },
        { $set: { ...doc, sessionId: String(doc.sessionId) } },
        { upsert: true, new: true, projection: { data: 0 } },
      ).lean();
      return lean(rec);
    },
    async listRoomArchives() {
      return lean(await RoomArchive.find({}, { data: 0 }).sort({ archivedAt: -1 }).lean()) ?? [];
    },
    async getRoomArchive(id) {
      return lean(await RoomArchive.findById(id).lean().catch(() => null));
    },
    async updateAnswer(id, patch) {
      const allowed = ['correct', 'score', 'reviewStatus', 'reviewedBy', 'reviewedAt', 'reviewNote', 'final'];
      const set = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined));
      return lean(await Answer.findByIdAndUpdate(id, { $set: set }, { new: true }).lean());
    },
    // -- answer reviews (append-only; see memoryRepo for the contract) --
    async addAnswerReview(doc) {
      return lean(await AnswerReview.create({
        ...doc, answerId: String(doc.answerId), sessionId: String(doc.sessionId),
      }));
    },
    async listAnswerReviews({ answerId, sessionId } = {}) {
      const q = {};
      if (answerId) q.answerId = String(answerId);
      if (sessionId) q.sessionId = String(sessionId);
      return lean(await AnswerReview.find(q).sort({ reviewedAt: 1, _id: 1 }).lean()) ?? [];
    },
  };
}
