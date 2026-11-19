// MongoDB Atlas / Mongoose implementation. This is the documented primary
// store (report section 5.6). memoryRepo is the fallback with the same surface.

import {
  Content, Question, Session, Profile, Answer, RoomArchive, AnswerReview, Media, Class, ClassStudent, Attendance,
  Observation, WheelRound, WheelPick, HandTally, RoomActivity, InsightAction, ProjectorLink,
} from '../models/index.js';

const lean = (d) => (d ? JSON.parse(JSON.stringify(d)) : null);

/** A duplicate key on a record's place in its room, as the 409 Postgres's unique constraint gives. */
async function placed(what, write) {
  try {
    return lean(await write());
  } catch (err) {
    if (err?.code === 11000) {
      throw Object.assign(new Error(`That ${what} was taken by another request. Nothing was changed.`), { status: 409 });
    }
    throw err;
  }
}

/** Only the named fields the caller sent; a malformed id is "not found". */
async function patchOne(Model, id, patch, allowed) {
  const set = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined));
  return lean(await Model.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean()
    .catch((err) => { if (err?.name === 'CastError') return null; throw err; }));
}

const byRollNo = (a, b) => String(a.rollNo).localeCompare(String(b.rollNo), undefined, { numeric: true });

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
    // `status`: see memoryRepo.
    async countQuestions(contentId, { status = 'active' } = {}) {
      return Question.countDocuments({ contentId, status });
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
      await Attendance.deleteMany({ sessionId: String(id) });
      // The room's teacher records (0017), archived with it first.
      for (const M of [Observation, WheelPick, WheelRound, HandTally, RoomActivity, InsightAction]) {
        await M.deleteMany({ sessionId: String(id) });
      }
      // Its projector links (0018), which are not evidence and are not archived.
      await ProjectorLink.deleteMany({ sessionId: String(id) });
      await Answer.deleteMany({ sessionId: id });
      await Profile.deleteMany({ sessionId: id });
      await Session.findByIdAndDelete(id);
      return true;
    },

    async listSessions() {
      return lean(await Session.find().sort({ startedAt: -1 }).lean());
    },
    // See memoryRepo.
    async listSessionsForContent(contentId) {
      return lean(await Session.find({ contentId }).sort({ startedAt: -1 }).lean()) ?? [];
    },
    // See memoryRepo.
    async listSessionsForClass(classId) {
      return lean(await Session.find({ classId: String(classId) }).sort({ startedAt: -1 }).lean()) ?? [];
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
    // -- media (see memoryRepo for the contract) --
    async createMedia(doc) {
      const { data, ...meta } = (await Media.create({ ...doc, contentId: String(doc.contentId) })).toObject();
      return lean(meta);
    },
    async getMedia(id, { withData = false } = {}) {
      // Hydrated rather than lean when the bytes are wanted, so they arrive as a
      // Buffer and not as a driver Binary. A uuid is a CastError here: not found.
      if (withData) {
        const doc = await Media.findById(id).catch(() => null);
        if (!doc) return null;
        const { data, ...meta } = doc.toObject();
        return { ...lean(meta), data: Buffer.from(doc.data) };
      }
      return lean(await Media.findById(id).select('-data').lean().catch(() => null));
    },

    // -- classes and rosters (0016; see memoryRepo for the contract) --
    // A malformed id is a CastError here: not found, as for archives and media.
    async createClass(doc) {
      return lean(await Class.create(doc));
    },
    async getClass(id) {
      return lean(await Class.findById(id).lean().catch(() => null));
    },
    async listClasses() {
      return lean(await Class.find().sort({ createdAt: -1 }).lean()) ?? [];
    },
    async updateClass(id, patch) {
      const allowed = ['courseName', 'section', 'termLabel'];
      const set = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined));
      return lean(await Class.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean()
        .catch((err) => { if (err?.name === 'CastError') return null; throw err; }));
    },
    async listClassStudents(classId) {
      return (lean(await ClassStudent.find({ classId: String(classId) }).lean()) ?? []).sort(byRollNo);
    },
    async getClassStudent(id) {
      return lean(await ClassStudent.findById(id).lean().catch(() => null));
    },
    // One at a time, skipping a duplicate key, so only the rows added come back
    // (Postgres's ON CONFLICT DO NOTHING). A roster is a few hundred rows at most.
    async addClassStudents(classId, docs) {
      const made = [];
      for (const d of docs) {
        try {
          made.push(lean(await ClassStudent.create({ ...d, classId: String(classId) })));
        } catch (err) {
          if (err?.code !== 11000) throw err;
        }
      }
      return made;
    },
    async updateClassStudent(id, patch) {
      const allowed = ['name', 'rollNo', 'removedAt'];
      const set = Object.fromEntries(Object.entries(patch).filter(([k, v]) => allowed.includes(k) && v !== undefined));
      try {
        return lean(await ClassStudent.findByIdAndUpdate(id, { $set: set }, { new: true }).lean());
      } catch (err) {
        if (err?.code === 11000) {
          throw Object.assign(new Error(`Roll number ${patch.rollNo} is already on this class's roster.`), { status: 409 });
        }
        if (err?.name === 'CastError') return null;
        throw err;
      }
    },

    // -- attendance (0016; see memoryRepo for the contract) --
    async listAttendance(sessionId) {
      return lean(await Attendance.find({ sessionId: String(sessionId) }).lean()) ?? [];
    },
    async saveAttendance(docs) {
      const out = [];
      for (const d of docs) {
        const key = { sessionId: String(d.sessionId), classStudentId: String(d.classStudentId) };
        out.push(lean(await Attendance.findOneAndUpdate(
          key,
          { $set: { ...d, ...key, markedBy: d.markedBy ?? null } },
          { upsert: true, new: true, runValidators: true },
        ).lean()));
      }
      return out;
    },
    async addAttendanceIfAbsent(doc) {
      try {
        await Attendance.create({ ...doc, sessionId: String(doc.sessionId), classStudentId: String(doc.classStudentId) });
        return { created: true };
      } catch (err) {
        if (err?.code === 11000) return { created: false };
        throw err;
      }
    },

    // -- teacher records (0017; see memoryRepo for the contract) --
    // _id breaks a tie on time: an ObjectId grows with the order rows were made.
    async addObservation(doc) {
      return lean(await Observation.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async listObservations({ sessionId, classId, classStudentId, day } = {}) {
      const q = {};
      if (sessionId) q.sessionId = String(sessionId);
      if (classId) q.classId = String(classId);
      if (classStudentId) q.classStudentId = String(classStudentId);
      if (day) q.day = day;
      return lean(await Observation.find(q).sort({ observedAt: 1, _id: 1 }).lean()) ?? [];
    },
    async listWheelRounds(sessionId) {
      return lean(await WheelRound.find({ sessionId: String(sessionId) }).sort({ round: 1 }).lean()) ?? [];
    },
    async addWheelRound(doc) {
      return placed('round', () => WheelRound.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async updateWheelRound(id, patch) {
      return patchOne(WheelRound, id, patch, ['presentOnly', 'noRepeat']);
    },
    async listWheelPicks(sessionId) {
      return lean(await WheelPick.find({ sessionId: String(sessionId) }).sort({ round: 1, order: 1 }).lean()) ?? [];
    },
    async addWheelPick(doc) {
      return placed('place on the wheel', () => WheelPick.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async updateWheelPick(id, patch) {
      return patchOne(WheelPick, id, patch, ['ask', 'questionId', 'status', 'statusAt', 'statusBy']);
    },
    async listTallies(sessionId) {
      return lean(await HandTally.find({ sessionId: String(sessionId) }).sort({ seq: 1 }).lean()) ?? [];
    },
    async addTally(doc) {
      return placed('place in the room\'s questions', () => HandTally.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async updateTally(id, patch) {
      return patchOne(HandTally, id, patch, ['questionId', 'text', 'labels', 'counts', 'revealed', 'correct', 'updatedAt']);
    },
    async listActivities(sessionId) {
      return lean(await RoomActivity.find({ sessionId: String(sessionId) }).sort({ seq: 1 }).lean()) ?? [];
    },
    async addActivity(doc) {
      return placed('place in the room\'s activities', () => RoomActivity.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async updateActivity(id, patch) {
      return patchOne(RoomActivity, id, patch, ['outcome', 'groups', 'tallyId', 'updatedAt']);
    },
    async addInsightAction(doc) {
      return lean(await InsightAction.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async listInsightActions(sessionId) {
      return lean(await InsightAction.find({ sessionId: String(sessionId) }).sort({ actedAt: 1, _id: 1 }).lean()) ?? [];
    },

    // -- projector links (0018; see memoryRepo for the contract) --
    async addProjectorLink(doc) {
      return placed('projector token', () => ProjectorLink.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async getProjectorLinkByHash(tokenHash) {
      return lean(await ProjectorLink.findOne({ tokenHash: String(tokenHash) }).lean());
    },
    async listProjectorLinks(sessionId) {
      return lean(await ProjectorLink.find({ sessionId: String(sessionId) }).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
    },
    async revokeProjectorLink(id, { revokedAt, revokedBy = null }) {
      return patchOne(ProjectorLink, id, { revokedAt, revokedBy }, ['revokedAt', 'revokedBy']);
    },
  };
}
