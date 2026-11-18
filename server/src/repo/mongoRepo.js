// MongoDB Atlas / Mongoose implementation. This is the documented primary
// store (report section 5.6). memoryRepo is the fallback with the same surface.

import { Content, Question, Session, Profile } from '../models/index.js';

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
  };
}
