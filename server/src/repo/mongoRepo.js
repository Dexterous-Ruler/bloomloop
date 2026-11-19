// MongoDB Atlas / Mongoose implementation. This is the documented primary
// store (report section 5.6). memoryRepo is the fallback with the same surface.

import {
  Content, Question, Session, Profile, Answer, RoomArchive, AnswerReview, Media, Class, ClassStudent, Attendance,
  Observation, WheelRound, WheelPick, HandTally, RoomActivity, InsightAction, ProjectorLink,
  CourseOutcome, OutcomeTopic, QuestionOutcomeOverride, AttainmentConfig, ClassQuestion, QuestionPack, RoomImport, RecordWrite,
} from '../models/index.js';
// Phase 6: the hub's content backbone (0025).
import { ClassUnit, ClassChapter, ChapterTopic, TopicLink } from '../models/hubBackbone.js';
// Phase 6: practice, mastery, the error log and reviews (0026).
import { HubAttempt, QuestionExplanation } from '../models/hubPractice.js';
// Phase 6: lessons and languages (0027).
import { TopicLesson, ItemTranslation, LanguageChoice } from '../models/hubLessons.js';
// Phase 6: Get Ready, self-tests and goals (0028).
import { HubRun, HubGoal } from '../models/hubPaths.js';
// Phase 6: the tutor's hints and feedback (0029).
import { QuestionHint, OptionFeedback, HintView } from '../models/hubTutor.js';

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
      // Its class questions (0023), archived with it first.
      await ClassQuestion.deleteMany({ sessionId: String(id) });
      // Its question packs (0030), which say what was sent and are not archived:
      // every answer row keeps when its question was served.
      await QuestionPack.deleteMany({ sessionId: String(id) });
      // Its replay keys (Phase 7, 0032): receipts, not records, so not archived.
      await RecordWrite.deleteMany({ sessionId: String(id) });
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
    // `student`, `before`, `classQuestionId` and `classVotes`: see memoryRepo.
    // `accountId: null` also matches a missing field, as `classQuestionId: null` does.
    async listAnswers({
      sessionId, sessionIds, rollNo, accountId, student, topic, bloom, reviewStatus, kind, final, before,
      classQuestionId, classVotes, order = 'asc', limit = 2000, offset = 0,
    } = {}) {
      const q = {};
      if (sessionId) q.sessionId = sessionId;
      if (Array.isArray(sessionIds)) q.sessionId = { $in: sessionIds };
      if (rollNo) q.rollNo = String(rollNo);
      if (accountId) q.accountId = accountId;
      const anyOf = [];
      if (student?.verifiedOnly) {
        // The student reading themself (decision 7): linked AND verified, never a roll number.
        if (!student.accountId) return [];
        anyOf.push([{ accountId: String(student.accountId), accountVerified: true }]);
      } else if (student) {
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
      if (classQuestionId) q.classQuestionId = String(classQuestionId);
      else if (classVotes === false) q.classQuestionId = null;
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
      const allowed = ['name', 'rollNo', 'removedAt', 'under18'];
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

    // -- course outcomes (0019; see memoryRepo for the contract) --
    async listOutcomes(classId) {
      return lean(await CourseOutcome.find({ classId: String(classId) }).sort({ position: 1, createdAt: 1, _id: 1 }).lean()) ?? [];
    },
    async getOutcome(id) {
      return lean(await CourseOutcome.findById(id).lean().catch(() => null));
    },
    async createOutcome(doc) {
      try {
        return lean(await CourseOutcome.create({ ...doc, classId: String(doc.classId) }));
      } catch (err) {
        if (err?.code === 11000) throw Object.assign(new Error(`${doc.code} is already a course outcome of this class.`), { status: 409 });
        throw err;
      }
    },
    async updateOutcome(id, patch) {
      try {
        return await patchOne(CourseOutcome, id, { ...patch, updatedAt: new Date().toISOString() },
          ['code', 'statement', 'targetLevel', 'position', 'archivedAt', 'updatedAt']);
      } catch (err) {
        if (err?.code === 11000) {
          throw Object.assign(new Error(`${patch.code ?? 'That code'} is already a course outcome of this class.`), { status: 409 });
        }
        throw err;
      }
    },
    // The topics first: Mongo has no cascade, and topics left without their
    // outcome would map evidence to nothing.
    async deleteOutcome(id) {
      await OutcomeTopic.deleteMany({ outcomeId: String(id) });
      return Boolean(await CourseOutcome.findByIdAndDelete(id).catch(() => null));
    },
    async listOutcomeTopics(classId) {
      return lean(await OutcomeTopic.find({ classId: String(classId) }, { topicKey: 0 }).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
    },
    async setOutcomeTopics(outcomeId, classId, links) {
      const keep = [];
      for (const l of links) {
        const key = { outcomeId: String(outcomeId), contentId: String(l.contentId), topicKey: String(l.topic).toLowerCase() };
        const rec = await OutcomeTopic.findOneAndUpdate(
          key,
          { $set: { topic: l.topic, weight: Number(l.weight) || 1 }, $setOnInsert: { ...key, classId: String(classId), createdAt: new Date().toISOString() } },
          { upsert: true, new: true, runValidators: true },
        ).lean();
        keep.push(rec._id);
      }
      await OutcomeTopic.deleteMany({ outcomeId: String(outcomeId), _id: { $nin: keep } });
      return lean(await OutcomeTopic.find({ outcomeId: String(outcomeId) }, { topicKey: 0 }).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
    },
    async listQuestionOverrides(classId) {
      return lean(await QuestionOutcomeOverride.find({ classId: String(classId) }).sort({ _id: 1 }).lean()) ?? [];
    },
    async setQuestionOverride(doc) {
      const key = { classId: String(doc.classId), questionId: String(doc.questionId) };
      return lean(await QuestionOutcomeOverride.findOneAndUpdate(
        key,
        {
          $set: {
            ...key,
            excluded: doc.excluded === true,
            outcomeIds: doc.excluded ? [] : (doc.outcomeIds ?? []).map(String),
            updatedAt: new Date().toISOString(),
            updatedBy: doc.updatedBy ?? null,
          },
        },
        { upsert: true, new: true, runValidators: true },
      ).lean());
    },
    async deleteQuestionOverride(classId, questionId) {
      const res = await QuestionOutcomeOverride.deleteOne({ classId: String(classId), questionId: String(questionId) });
      return (res?.deletedCount ?? 0) > 0;
    },

    // -- attainment formulas (0020; see memoryRepo for the contract) --
    async getAttainmentConfig(classId) {
      return lean(await AttainmentConfig.findOne({ classId: String(classId) }).sort({ version: -1 }).lean());
    },
    async addAttainmentConfig(doc) {
      try {
        return lean(await AttainmentConfig.create({ ...doc, classId: String(doc.classId) }));
      } catch (err) {
        if (err?.code === 11000) {
          throw Object.assign(new Error('The attainment formula was changed by another request. Nothing was saved: read it again.'), { status: 409 });
        }
        throw err;
      }
    },

    // -- class questions (0023; see memoryRepo for the contract) --
    async addClassQuestion(doc) {
      if (await ClassQuestion.exists({ sessionId: String(doc.sessionId), state: { $ne: 'closed' } })) {
        throw Object.assign(new Error('Another class question is still running in this room. Close it first.'), { status: 409 });
      }
      return placed('place in the room\'s class questions', () => ClassQuestion.create({ ...doc, sessionId: String(doc.sessionId) }));
    },
    async getClassQuestion(id) {
      return lean(await ClassQuestion.findById(id).lean().catch(() => null));
    },
    async listClassQuestions(sessionId) {
      return lean(await ClassQuestion.find({ sessionId: String(sessionId) }).sort({ seq: 1 }).lean()) ?? [];
    },
    async updateClassQuestion(id, patch) {
      return patchOne(ClassQuestion, id, patch, ['state', 'revealed', 'pausedAt', 'revoteAt', 'closedAt', 'closedBy']);
    },

    // ---- Phase 6: the hub's content backbone (0025; see memoryRepo for the contract) ----
    ...(() => {
      // The lower-case name is the unique index's key, not part of the document.
      const outUnit = (u) => {
        if (!u) return null;
        const { nameKey, ...rest } = u;
        return rest;
      };
      const conflict = (err, message) => {
        if (err?.code === 11000) throw Object.assign(new Error(message), { status: 409 });
        throw err;
      };
      const byPlace = { position: 1, createdAt: 1, _id: 1 };
      return {
        async listClassUnits(classId) {
          return (lean(await ClassUnit.find({ classId: String(classId) }).sort(byPlace).lean()) ?? []).map(outUnit);
        },
        async getClassUnit(id) {
          return outUnit(lean(await ClassUnit.findById(id).lean().catch(() => null)));
        },
        async createClassUnit(doc) {
          try {
            return outUnit(lean(await ClassUnit.create({ ...doc, classId: String(doc.classId), nameKey: String(doc.name).toLowerCase() })));
          } catch (err) {
            return conflict(err, `There is already a unit called "${doc.name}" in this class.`);
          }
        },
        async updateClassUnit(id, patch) {
          const set = { updatedAt: new Date().toISOString() };
          if (patch.name !== undefined) Object.assign(set, { name: patch.name, nameKey: String(patch.name).toLowerCase() });
          if (patch.position !== undefined) set.position = patch.position;
          try {
            return outUnit(await patchOne(ClassUnit, id, set, ['name', 'nameKey', 'position', 'updatedAt']));
          } catch (err) {
            return conflict(err, `There is already a unit called "${patch.name}" in this class.`);
          }
        },
        // Its chapters first, to no unit: Mongo has no ON DELETE SET NULL.
        async deleteClassUnit(id) {
          await ClassChapter.updateMany({ unitId: String(id) }, { $set: { unitId: null } });
          return Boolean(await ClassUnit.findByIdAndDelete(id).catch(() => null));
        },
        async listClassChapters(classId) {
          return lean(await ClassChapter.find({ classId: String(classId) }).lean()) ?? [];
        },
        async placeClassChapter(doc) {
          try {
            return lean(await ClassChapter.create({
              ...doc, classId: String(doc.classId), contentId: String(doc.contentId), unitId: doc.unitId == null ? null : String(doc.unitId),
            }));
          } catch (err) {
            return conflict(err, 'That chapter is already on this class.');
          }
        },
        async updateClassChapter(id, patch) {
          const set = {};
          if (patch.unitId !== undefined) set.unitId = patch.unitId == null ? null : String(patch.unitId);
          if (patch.position !== undefined) set.position = patch.position;
          return patchOne(ClassChapter, id, set, ['unitId', 'position']);
        },
        async removeClassChapter(classId, contentId) {
          const res = await ClassChapter.deleteOne({ classId: String(classId), contentId: String(contentId) });
          return (res?.deletedCount ?? 0) > 0;
        },
        async listChapterTopics(contentId) {
          return lean(await ChapterTopic.find({ contentId: String(contentId) }).sort(byPlace).lean()) ?? [];
        },
        async getChapterTopic(id) {
          return lean(await ChapterTopic.findById(id).lean().catch(() => null));
        },
        async listChapterTopicsByIds(ids = []) {
          const wanted = ids.map(String).filter((x) => /^[0-9a-f]{24}$/i.test(x));
          return wanted.length ? lean(await ChapterTopic.find({ _id: { $in: wanted } }).lean()) ?? [] : [];
        },
        // ON CONFLICT DO NOTHING: a key the chapter holds is skipped, one by one.
        async addChapterTopics(contentId, docs = []) {
          const made = [];
          for (const d of docs) {
            try {
              made.push(lean(await ChapterTopic.create({ ...d, contentId: String(contentId) })));
            } catch (err) {
              if (err?.code !== 11000) throw err;
            }
          }
          return made;
        },
        async updateChapterTopic(id, patch) {
          const set = { updatedAt: new Date().toISOString() };
          for (const k of ['name', 'position', 'retiredAt']) if (patch[k] !== undefined) set[k] = patch[k];
          if (patch.name !== undefined) set.key = String(patch.name).toLowerCase();
          return patchOne(ChapterTopic, id, set, ['name', 'key', 'position', 'retiredAt', 'updatedAt']);
        },
        // Its links first: Mongo has no ON DELETE CASCADE.
        async deleteChapterTopic(id) {
          await TopicLink.deleteMany({ $or: [{ prerequisiteId: String(id) }, { topicId: String(id) }] });
          return Boolean(await ChapterTopic.findByIdAndDelete(id).catch(() => null));
        },
        async listTopicLinks(filter = {}) {
          const q = {};
          if ('ownerId' in filter) q.ownerId = filter.ownerId == null ? null : String(filter.ownerId);
          if (Array.isArray(filter.topicIds)) {
            const ids = filter.topicIds.map(String);
            q.$or = [{ prerequisiteId: { $in: ids } }, { topicId: { $in: ids } }];
          }
          return lean(await TopicLink.find(q).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
        },
        async getTopicLink(id) {
          return lean(await TopicLink.findById(id).lean().catch(() => null));
        },
        async addTopicLink(doc) {
          try {
            return lean(await TopicLink.create({ ...doc, prerequisiteId: String(doc.prerequisiteId), topicId: String(doc.topicId) }));
          } catch (err) {
            return conflict(err, 'Those two topics are already linked.');
          }
        },
        async updateTopicLink(id, patch) {
          return patchOne(TopicLink, id, patch, ['state', 'decidedAt', 'decidedBy']);
        },
        async deleteTopicLink(id) {
          return Boolean(await TopicLink.findByIdAndDelete(id).catch(() => null));
        },
        async setContentSlideTexts(contentId, slideTexts) {
          return lean(await Content.findByIdAndUpdate(contentId, { $set: { slideTexts } }, { new: true }).lean().catch(() => null));
        },
      };
    })(),

    // ---- Phase 6: practice, mastery, the error log and reviews (0026; see memoryRepo for the contract) ----
    ...(() => {
      const inList = (v) => ({ $in: v.map(String) });
      return {
        // The unique index on (accountId, clientAttemptId) is the idempotency gate.
        async addHubAttempt(doc) {
          try {
            const made = await HubAttempt.create({ ...doc, accountId: String(doc.accountId) });
            return { attempt: lean(made), duplicate: false };
          } catch (err) {
            if (err?.code !== 11000) throw err;
            const held = await this.getHubAttemptByKey(doc.accountId, doc.clientAttemptId);
            if (held) return { attempt: held, duplicate: true };
            throw err;
          }
        },
        async getHubAttemptByKey(accountId, clientAttemptId) {
          return lean(await HubAttempt.findOne({ accountId: String(accountId), clientAttemptId: String(clientAttemptId) }).lean());
        },
        async listHubAttempts({ accountId, accountIds, topicIds, questionIds, runIds, since } = {}) {
          for (const v of [accountIds, topicIds, questionIds, runIds]) if (Array.isArray(v) && !v.length) return [];
          const q = {};
          if (Array.isArray(accountIds)) q.accountId = inList(accountIds);
          // Both given: the one account, and only if it is in the list.
          if (accountId) q.accountId = Array.isArray(accountIds) && !accountIds.map(String).includes(String(accountId)) ? '\u0000' : String(accountId);
          if (Array.isArray(topicIds)) q.topicId = inList(topicIds);
          if (Array.isArray(questionIds)) q.questionId = inList(questionIds);
          if (Array.isArray(runIds)) q.runId = inList(runIds);
          if (since) q.createdAt = { $gte: String(since) };
          return lean(await HubAttempt.find(q).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
        },
        async getQuestionExplanation(questionId) {
          return lean(await QuestionExplanation.findOne({ questionId: String(questionId) }).lean());
        },
        async listQuestionExplanations(questionIds = []) {
          if (!questionIds.length) return [];
          return lean(await QuestionExplanation.find({ questionId: inList(questionIds) }).lean()) ?? [];
        },
        async addQuestionExplanation(doc) {
          try {
            return lean(await QuestionExplanation.create({ ...doc, questionId: String(doc.questionId) }));
          } catch (err) {
            if (err?.code === 11000) throw Object.assign(new Error('That question already has an explanation.'), { status: 409 });
            throw err;
          }
        },
        async updateQuestionExplanation(questionId, patch) {
          const set = { updatedAt: new Date().toISOString() };
          for (const k of ['text', 'provenance', 'status', 'model', 'sourceRef', 'approvedBy', 'approvedAt']) {
            if (patch[k] !== undefined) set[k] = patch[k];
          }
          return lean(await QuestionExplanation.findOneAndUpdate({ questionId: String(questionId) }, { $set: set },
            { new: true, runValidators: true }).lean());
        },
        async deleteQuestionExplanation(questionId) {
          const res = await QuestionExplanation.deleteOne({ questionId: String(questionId) });
          return (res?.deletedCount ?? 0) > 0;
        },
      };
    })(),

    // ---- Phase 6: lessons and languages (0027; see memoryRepo for the contract) ----
    ...(() => {
      const conflict = (message) => Object.assign(new Error(message), { status: 409 });
      const notDraft = (what, rec) => conflict(`Only a draft ${what} can be approved or discarded; this one is ${rec.status}.`);
      const find = (Model, id) => Model.findById(id).lean().catch(() => null);
      // Mongo has no transaction here: the server serialises approvals per
      // topic (and per item), and the partial unique index refuses a second
      // approved row should two ever race.
      const decide = async (Model, rec, { status, by }) => {
        const now = new Date().toISOString();
        const set = status === 'approved' ? { status, approvedAt: now, approvedBy: by ?? null } : { status, retiredAt: now, retiredBy: by ?? null };
        return lean(await Model.findOneAndUpdate({ _id: rec._id, status: rec.status }, { $set: set }, { new: true }).lean());
      };
      return {
        async createTopicLesson(doc) {
          try {
            return lean(await TopicLesson.create({
              ...doc, topicId: String(doc.topicId), contentId: String(doc.contentId), status: 'draft',
            }));
          } catch (err) {
            if (err?.code === 11000) throw conflict('Another version of this lesson was written at the same time. Nothing was changed; try again.');
            throw err;
          }
        },
        async getTopicLesson(id) {
          return lean(await find(TopicLesson, id));
        },
        async listTopicLessons(filter = {}) {
          const q = {};
          if (filter.topicId !== undefined) q.topicId = String(filter.topicId);
          if (filter.contentId !== undefined) q.contentId = String(filter.contentId);
          return lean(await TopicLesson.find(q).sort({ topicId: 1, version: 1 }).lean()) ?? [];
        },
        async approveTopicLesson(id, { by = null } = {}) {
          const rec = await find(TopicLesson, id);
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('lesson', rec);
          const now = new Date().toISOString();
          await TopicLesson.updateMany({ topicId: rec.topicId, status: 'approved' },
            { $set: { status: 'superseded', retiredAt: now, retiredBy: by ?? null } });
          return decide(TopicLesson, rec, { status: 'approved', by });
        },
        async discardTopicLesson(id, { by = null } = {}) {
          const rec = await find(TopicLesson, id);
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('lesson', rec);
          return decide(TopicLesson, rec, { status: 'discarded', by });
        },
        async addItemTranslation(doc) {
          return lean(await ItemTranslation.create({
            ...doc, itemId: String(doc.itemId), contentId: String(doc.contentId), status: 'draft',
          }));
        },
        async getItemTranslation(id) {
          return lean(await find(ItemTranslation, id));
        },
        async listItemTranslations(filter = {}) {
          const q = {};
          if (filter.contentId !== undefined) q.contentId = String(filter.contentId);
          if (filter.itemKind !== undefined) q.itemKind = filter.itemKind;
          if (Array.isArray(filter.itemIds)) q.itemId = { $in: filter.itemIds.map(String) };
          if (filter.language !== undefined) q.language = filter.language;
          if (filter.status !== undefined) q.status = { $in: [].concat(filter.status) };
          return lean(await ItemTranslation.find(q).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
        },
        async editItemTranslation(id, patch) {
          const rec = await find(ItemTranslation, id);
          if (!rec) return null;
          if (rec.status !== 'draft') throw conflict(`Only a draft translation can be changed; this one is ${rec.status}.`);
          const set = { updatedAt: new Date().toISOString() };
          for (const k of ['fields', 'sourceFields', 'sourceHash', 'checks', 'provenance', 'editedBy']) if (patch[k] !== undefined) set[k] = patch[k];
          return lean(await ItemTranslation.findOneAndUpdate({ _id: rec._id, status: 'draft' }, { $set: set }, { new: true }).lean());
        },
        async approveItemTranslation(id, { by = null } = {}) {
          const rec = await find(ItemTranslation, id);
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('translation', rec);
          const now = new Date().toISOString();
          await ItemTranslation.updateMany({ itemKind: rec.itemKind, itemId: rec.itemId, language: rec.language, status: 'approved' },
            { $set: { status: 'superseded', retiredAt: now, retiredBy: by ?? null } });
          return decide(ItemTranslation, rec, { status: 'approved', by });
        },
        async discardItemTranslation(id, { by = null } = {}) {
          const rec = await find(ItemTranslation, id);
          if (!rec) return null;
          if (rec.status !== 'draft') throw notDraft('translation', rec);
          return decide(ItemTranslation, rec, { status: 'discarded', by });
        },
        async getLanguageChoice(accountId) {
          return (await LanguageChoice.findOne({ accountId: String(accountId) }).lean())?.language ?? null;
        },
        async setLanguageChoice(accountId, language) {
          const rec = lean(await LanguageChoice.findOneAndUpdate({ accountId: String(accountId) },
            { $set: { language, updatedAt: new Date().toISOString() } }, { new: true, upsert: true }).lean());
          return { accountId: rec.accountId, language: rec.language, updatedAt: rec.updatedAt };
        },
      };
    })(),

    // ---- Phase 6: Get Ready, self-tests and goals (0028; see memoryRepo for the contract) ----
    ...(() => {
      const find = (Model, id) => Model.findById(id).lean().catch(() => null);
      return {
        // The unique index on (accountId, clientRunId) is the idempotency gate.
        async addHubRun(doc) {
          try {
            const made = await HubRun.create({ ...doc, accountId: String(doc.accountId) });
            return { run: lean(made), duplicate: false };
          } catch (err) {
            if (err?.code !== 11000) throw err;
            const held = await this.getHubRunByKey(doc.accountId, doc.clientRunId);
            if (held) return { run: held, duplicate: true };
            throw err;
          }
        },
        async getHubRun(id) {
          return lean(await find(HubRun, id));
        },
        async getHubRunByKey(accountId, clientRunId) {
          return lean(await HubRun.findOne({ accountId: String(accountId), clientRunId: String(clientRunId) }).lean());
        },
        async listHubRuns({ accountId, ids, kind } = {}) {
          if (Array.isArray(ids) && !ids.length) return [];
          const q = {};
          if (accountId) q.accountId = String(accountId);
          // An id that is not an ObjectId matches nothing, rather than failing the cast.
          if (Array.isArray(ids)) q._id = { $in: ids.map(String).filter((x) => /^[0-9a-f]{24}$/i.test(x)) };
          if (kind) q.kind = kind;
          return lean(await HubRun.find(q).sort({ startedAt: 1, _id: 1 }).lean()) ?? [];
        },
        // Only where it has no end yet, so a second end never overwrites the first.
        async endHubRun(id, { endedAt, endReason }) {
          const rec = await find(HubRun, id);
          if (!rec) return null;
          if (rec.endedAt) return lean(rec);
          const done = await HubRun.findOneAndUpdate({ _id: rec._id, endedAt: null }, { $set: { endedAt, endReason } }, { new: true }).lean();
          return lean(done ?? await find(HubRun, id));
        },
        async listHubGoals(accountId) {
          return lean(await HubGoal.find({ accountId: String(accountId) }).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
        },
        async getHubGoal(id) {
          return lean(await find(HubGoal, id));
        },
        async addHubGoal(doc) {
          return lean(await HubGoal.create({ ...doc, accountId: String(doc.accountId) }));
        },
        async updateHubGoal(id, patch) {
          const set = { updatedAt: new Date().toISOString() };
          for (const k of ['title', 'examDate', 'topicIds']) if (patch[k] !== undefined) set[k] = patch[k];
          return lean(await HubGoal.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true }).lean()
            .catch((err) => { if (err?.name === 'CastError') return null; throw err; }));
        },
        async deleteHubGoal(id) {
          const res = await HubGoal.deleteOne({ _id: id }).catch(() => null);
          return (res?.deletedCount ?? 0) > 0;
        },
      };
    })(),

    // ---- Phase 6: the tutor's hints and feedback (0029; see memoryRepo for the contract) ----
    ...(() => {
      const conflict = (message) => Object.assign(new Error(message), { status: 409 });
      const EDITABLE = ['text', 'provenance', 'status', 'model', 'sourceRef', 'approvedBy', 'approvedAt'];
      const ofQuestions = async (Model, questionIds) => (questionIds.length
        ? lean(await Model.find({ questionId: { $in: questionIds.map(String) } }).sort({ createdAt: 1, _id: 1 }).lean()) ?? [] : []);
      const insert = async (Model, doc, message) => {
        try {
          return lean(await Model.create({ ...doc, questionId: String(doc.questionId) }));
        } catch (err) {
          if (err?.code === 11000) throw conflict(message);
          throw err;
        }
      };
      const edit = (Model, id, patch, allowed) => patchOne(Model, id, { ...patch, updatedAt: new Date().toISOString() }, [...allowed, 'updatedAt']);
      const remove = async (Model, id) => Boolean(await Model.findByIdAndDelete(id).catch(() => null));
      return {
        async listQuestionHints(questionIds = []) {
          return ofQuestions(QuestionHint, questionIds);
        },
        async getQuestionHint(id) {
          return lean(await QuestionHint.findById(id).lean().catch(() => null));
        },
        async addQuestionHint(doc) {
          return insert(QuestionHint, doc, 'That question already has a hint at this step.');
        },
        async updateQuestionHint(id, patch) {
          return edit(QuestionHint, id, patch, EDITABLE);
        },
        async deleteQuestionHint(id) {
          return remove(QuestionHint, id);
        },
        async listOptionFeedback(questionIds = []) {
          return ofQuestions(OptionFeedback, questionIds);
        },
        async getOptionFeedback(id) {
          return lean(await OptionFeedback.findById(id).lean().catch(() => null));
        },
        async addOptionFeedback(doc) {
          return insert(OptionFeedback, doc, 'That option already has feedback.');
        },
        async updateOptionFeedback(id, patch) {
          return edit(OptionFeedback, id, patch, ['option', ...EDITABLE]);
        },
        async deleteOptionFeedback(id) {
          return remove(OptionFeedback, id);
        },
        // The unique index on (accountId, clientAttemptId, position) is the gate.
        async addHintView(doc) {
          try {
            return { view: lean(await HintView.create({ ...doc, accountId: String(doc.accountId) })), duplicate: false };
          } catch (err) {
            if (err?.code !== 11000) throw err;
            const held = lean(await HintView.findOne({
              accountId: String(doc.accountId), clientAttemptId: String(doc.clientAttemptId), position: doc.position,
            }).lean());
            if (held) return { view: held, duplicate: true };
            throw err;
          }
        },
        async listHintViews({ accountId, clientAttemptId, questionIds } = {}) {
          if (Array.isArray(questionIds) && !questionIds.length) return [];
          const q = {};
          if (accountId) q.accountId = String(accountId);
          if (clientAttemptId) q.clientAttemptId = String(clientAttemptId);
          if (Array.isArray(questionIds)) q.questionId = { $in: questionIds.map(String) };
          return lean(await HintView.find(q).sort({ createdAt: 1, _id: 1 }).lean()) ?? [];
        },
      };
    })(),
    // ---- Phase 7: question packs ----
    // See memoryRepo for the contract (question_packs, 0030). Written once.

    async addQuestionPack(doc) {
      const issuedAt = doc.issuedAt ?? new Date().toISOString();
      if (!(Date.parse(doc.expiresAt) > Date.parse(issuedAt))) {
        throw Object.assign(new Error('A question pack expires after it is sent.'), { status: 400 });
      }
      try {
        return lean(await QuestionPack.create({
          sessionId: String(doc.sessionId),
          rollNo: String(doc.rollNo),
          questionIds: (doc.questionIds ?? []).map(String),
          issuedAt,
          expiresAt: doc.expiresAt,
        }));
      } catch (err) {
        if (err?.name === 'ValidationError') throw Object.assign(new Error('A question pack holds 1 to 20 questions.'), { status: 400 });
        throw err;
      }
    },
    async listQuestionPacks(sessionId, rollNo) {
      return lean(await QuestionPack.find({ sessionId: String(sessionId), rollNo: String(rollNo) })
        .sort({ issuedAt: 1, _id: 1 }).lean()) ?? [];
    },

    // ---- Phase 7: laptop mode and room imports ----
    // See memoryRepo for the contract. Mongo has no transaction here and no
    // cascade, so the room is written through this repo's own methods and, on
    // any failure after the session, deleted again by deleteSession (which
    // removes every row of a room). The import record is written last; its
    // unique sourceRoomId is the guard against two imports of one room.

    async importRoom({ record, session, classQuestions = [], profiles = [], answers = [], reviews = [], attendance = [] }) {
      const exists = (code, message) => Object.assign(new Error(message), { code });
      if (await RoomImport.exists({ sourceRoomId: String(record.sourceRoomId) })) {
        throw exists('IMPORT_EXISTS', 'That room was already imported.');
      }
      if (await Session.exists({ code: String(session.code).toUpperCase() })) {
        throw exists('CODE_TAKEN', `A room with the code ${session.code} already exists.`);
      }
      let made;
      try {
        made = await this.createSession(session);
      } catch (err) {
        if (err?.code === 11000) throw exists('CODE_TAKEN', `A room with the code ${session.code} already exists.`);
        throw err;
      }
      const sessionId = String(made._id);
      try {
        const cqIds = new Map();
        for (const { ref, ...doc } of classQuestions) {
          const cq = await this.addClassQuestion({ ...doc, sessionId });
          cqIds.set(String(ref), String(cq._id));
        }
        for (const p of profiles) await this.saveProfile({ ...p, sessionId });
        const ids = new Map();
        for (const { classQuestionRef, ...doc } of answers) {
          const { answer } = await this.recordAnswer({
            ...doc, sessionId, classQuestionId: classQuestionRef ? cqIds.get(String(classQuestionRef)) ?? null : null,
          });
          ids.set(answer.answerKey, String(answer._id));
        }
        for (const { answerKey, ...doc } of reviews) await this.addAnswerReview({ ...doc, answerId: ids.get(answerKey), sessionId });
        if (attendance.length) await this.saveAttendance(attendance.map((m) => ({ ...m, sessionId })));
        let rec;
        try {
          rec = (await RoomImport.create({ ...record, sessionId })).toObject();
        } catch (err) {
          if (err?.code === 11000) throw exists('IMPORT_EXISTS', 'That room was already imported.');
          throw err;
        }
        const { data, ...meta } = lean(rec);
        return { session: made, record: meta };
      } catch (err) {
        await this.deleteSession(sessionId);
        throw err;
      }
    },

    async getRoomImportBySource(sourceRoomId) {
      const rec = lean(await RoomImport.findOne({ sourceRoomId: String(sourceRoomId) }, { data: 0 }).lean());
      return rec && withRoomNow(rec);
    },

    async getRoomImport(id) {
      const rec = lean(await RoomImport.findById(id).lean().catch(() => null));
      return rec && withRoomNow(rec);
    },

    async listRoomImports() {
      const rows = lean(await RoomImport.find({}, { data: 0 }).sort({ importedAt: -1 }).limit(1000).lean()) ?? [];
      const live = new Set((await Session.find({ _id: { $in: rows.map((r) => r.sessionId).filter(Boolean) } }, { _id: 1 }).lean())
        .map((s) => String(s._id)));
      return rows.map((r) => (live.has(String(r.sessionId)) ? r : { ...r, sessionId: null }));
    },

    // See memoryRepo: by room id, never by listing every import.
    async listRoomImportsForSessions(sessionIds = []) {
      const ids = [...new Set(sessionIds.map(String))];
      if (!ids.length) return [];
      const rows = lean(await RoomImport.find({ sessionId: { $in: ids } }, { data: 0 }).lean()) ?? [];
      const live = new Set((await Session.find({ _id: { $in: rows.map((r) => r.sessionId) } }, { _id: 1 }).lean())
        .map((s) => String(s._id)));
      return rows.filter((r) => live.has(String(r.sessionId)));
    },

    async getRoomArchiveBySession(sessionId) {
      return lean(await RoomArchive.findOne({ sessionId: String(sessionId) }, { data: 0 }).lean());
    },

    // ---- Phase 7: replay-safe teacher records (0032; see memoryRepo for the contract) ----
    async getRecordWrite({ sessionId, writer, key }) {
      return lean(await RecordWrite.findOne({ sessionId: String(sessionId), writer, key }).lean());
    },
    async addRecordWrite(doc) {
      try {
        return { write: lean(await RecordWrite.create({ ...doc, sessionId: String(doc.sessionId) })), duplicate: false };
      } catch (err) {
        if (err?.code !== 11000) throw err;
        return { write: await this.getRecordWrite(doc), duplicate: true };
      }
    },
  };
}

// Phase 7: an imported room deleted since names no room, as 0031's ON DELETE SET NULL has it.
async function withRoomNow(rec) {
  if (!rec.sessionId) return rec;
  const live = await Session.exists({ _id: rec.sessionId }).catch(() => null);
  return live ? rec : { ...rec, sessionId: null };
}
