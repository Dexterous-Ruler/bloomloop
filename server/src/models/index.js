// Mongoose schemas - exactly the data model in completion.md section 5 and
// chapter 5 of the project report. Do not drift: the report is submitted.

import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { LEVELS } from '../bloom.js';
import { KINDS } from '../questionTypes.js';
import { IMAGE_TYPES } from '../services/media.js';
import { ACTIVITY_KINDS, INSIGHT_ACTIONS, OBSERVATION_KINDS } from '../services/records.js';
import { ASK_TYPES, PICK_STATUSES } from '../services/wheel.js';

const { Schema, model } = mongoose;

const levelCounter = { seen: { type: Number, default: 0 }, correct: { type: Number, default: 0 } };

const contentSchema = new Schema(
  {
    title: { type: String, required: true },
    kind: { type: String, enum: ['pptx', 'syllabus'], required: true },
    rawText: { type: String, default: '' },
    topics: { type: [String], default: [] },
    // Deck only: each topic and the slide numbers it was read from (0013).
    topicSlides: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

const questionSchema = new Schema(
  {
    contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true, index: true },
    topic: { type: String, default: '' },
    text: { type: String, required: true },
    // The interaction is chosen by the bloom level (see questionTypes.js), so a
    // question carries whichever payload its kind needs. Per-kind shape is
    // enforced by invalidReason() before anything is written, not here.
    // Taken from the contract rather than retyped. A hand-listed enum here is
    // how five of the eleven kinds would be silently refused on save, and every
    // payload field this schema does not name is dropped on write - which is
    // the same class of bug that once emptied every non-mcq question in the
    // bank, one layer further down.
    kind: { type: String, enum: KINDS, default: 'mcq' },
    options: { type: [String], default: undefined },   // mcq (4), multi (4-6)
    answerIdx: { type: Number, min: 0, max: 3 },       // mcq
    answerIdxs: { type: [Number], default: undefined }, // multi
    answerBool: { type: Boolean, default: undefined },  // truefalse
    pairs: { type: [{ _id: false, left: String, right: String }], default: undefined }, // match
    buckets: { type: [{ _id: false, name: String, items: [String] }], default: undefined }, // categorise
    sequence: { type: [String], default: undefined },  // order and rank, in correct order
    criterion: { type: String, default: undefined },   // rank, hottext - what it is ranked against / which words to pick
    accept: { type: [String], default: undefined },    // blank
    // cloze gaps carry {accept}, dropdown gaps {options, answerIdx}. Typed as
    // the first shape, Mongoose cast every dropdown gap to {accept: []} on save
    // and dropped its options and answer, so it is Mixed: invalidReason() has
    // already checked the shape for the kind before anything is written.
    blanks: { type: Schema.Types.Mixed, default: undefined },
    value: { type: Number, default: undefined },       // numeric
    tolerance: { type: Number, default: undefined },   // numeric
    unit: { type: String, default: undefined },        // numeric
    rubric: { type: [String], default: undefined },    // open
    // The rest of PAYLOAD_FIELDS. Undeclared, each was silently dropped on
    // write, so a hot text, table or grid saved to Mongo came back with nothing
    // to answer and a stimulus vanished on save.
    tokens: { type: [String], default: undefined },    // hottext, in reading order
    columns: { type: [String], default: undefined },   // table and grid
    rows: { type: Schema.Types.Mixed, default: undefined }, // table: [{header, cells}], grid: [label]
    answers: { type: Schema.Types.Mixed, default: undefined }, // grid: one row of booleans per row
    stimulus: { type: Schema.Types.Mixed, default: undefined }, // passage or image, any kind
    bloom: { type: String, enum: LEVELS, required: true },
    // 'draft': generated and not yet approved, never served (supabase/migrations/0013).
    status: { type: String, enum: ['active', 'discarded', 'draft'], default: 'active' },
    // [D] provenance, so the UI can never pass a template item off as an LLM one
    source: { type: String, enum: ['llm', 'fallback'], default: 'llm' },
    // 0013. Declared because Mongoose drops every path it has no schema for, and
    // a draft that lost its model or its approval on save would be undetectable.
    model: { type: String, default: null },
    sourceRef: { type: Schema.Types.Mixed, default: null },
    checks: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: String, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

const sessionSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    title: { type: String, default: '' },
    // 'paused' (0005) and 'waiting' (0018) as well: a room opened with a waiting
    // room is CREATED waiting, and create() validates the enum where the
    // updates that pause a room never did.
    status: { type: String, enum: ['waiting', 'open', 'paused', 'closed'], default: 'open' },
    startedAt: { type: Date, default: Date.now },
    closedAt: { type: Date, default: null },

    // Phase 7. The three settings the teacher chooses when opening the room.
    // Declared here because Mongoose silently DROPS anything it has no path for,
    // which would leave createSession() reporting a 100% goal back to the screen
    // that asked for it while the room it wrote ran at 80% - the setting would
    // appear to work everywhere except where it counts.
    //
    // Defaults reproduce the behaviour of every room opened before this existed.
    masteryGoal: { type: Number, enum: [0.8, 0.9, 1.0], default: 0.8 },
    reattempts: { type: Number, min: 0, max: 2, default: 0 },
    redemption: { type: Boolean, default: false },

    // Phase 2 (supabase/migrations/0015). The only questions this room may
    // serve; absent means the whole approved bank. Declared for the same reason
    // as the settings above: an undeclared path is dropped on save, and a room
    // the professor limited to two questions would quietly serve all of them.
    // `default: undefined`, because a Mongoose array otherwise defaults to [],
    // which would read as a set of nothing.
    questionIds: { type: [String], default: undefined },

    // Phase 3 (supabase/migrations/0016). The class the room was opened for, or
    // null. Declared for the same reason again: undeclared, a class room would
    // save as a room with no class, and take no attendance.
    classId: { type: String, default: null },

    // Phase 3 (supabase/migrations/0018). How the room runs. Declared for the
    // same reason again, and defaulting to how every room ran before them.
    mode: { type: String, enum: ['devices', 'teacher-led', 'mixed'], default: 'devices' },
    adapt: { type: Boolean, default: true },
    startLevel: { type: String, enum: LEVELS, default: 'understand' },
    questionsPerStudent: { type: Number, min: 1, max: 500, default: null },
    timePerQuestion: { type: Number, min: 10, max: 600, default: null },
  },
  { versionKey: false },
);

const profileSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    rollNo: { type: String, required: true },
    name: { type: String, default: '' },
    levels: {
      type: Object,
      default: () => LEVELS.reduce((a, l) => ({ ...a, [l]: { seen: 0, correct: 0 } }), {}),
    },
    workingLevel: { type: String, enum: LEVELS, default: 'understand' },
    reason: { type: String, default: '' },
    history: {
      type: [
        {
          _id: false,
          questionId: String,
          bloom: { type: String, enum: LEVELS },
          // Phase 0: what the analytics group by, and which kind it was, so a
          // history entry is readable without a join back to a question that
          // may since have been edited or deleted.
          topic: String,
          kind: String,
          // The client's idempotency key for the attempt that settled this
          // entry, so a resend can be recognised as the same answer.
          answerId: String,
          ungraded: Boolean,
          correct: Boolean,
          // Partial credit. A match answered 3-of-4 is not the same evidence as
          // one answered 1-of-4, and without this field Mongoose drops the
          // difference on the floor - every partial answer stored as a bare
          // boolean, and the mastery model reasoning from less than it was given.
          score: Number,
          // Phase 7. How many goes this answer took, written only when it took
          // more than one. "Right on the third try" is different evidence from
          // "right", and a schema with no path for it would flatten the two.
          tries: Number,
          // Redemption's two ends. The failure names the answer that redeemed
          // it; the answer names the failure it paid off. Both are question
          // ids, and both are what makes withdrawnByLevel() derivable from the
          // history rather than kept as a counter that can drift from it.
          redeemedBy: String,
          redeems: String,
          // Phase 1. 'confirmed' or 'overridden' once a professor has reviewed
          // the written answer behind this entry; `correct` and `score` then
          // carry the reviewed mark. Declared so Mongoose does not drop it.
          review: String,
          at: String,
        },
      ],
      default: [],
    },

    // Phase 5. The question this student is currently on, so a closed tab comes
    // back to the SAME item.
    served: {
      type: {
        _id: false,
        questionId: String,
        at: String,
        reason: String,
        // Phase 7. Attempts spent on THIS question, and a hash of the last
        // answer submitted against it so a re-sent submission is one attempt
        // rather than two. Both live on the pin because both die with it.
        tries: Number,
        last: String,
      },
      default: null,
    },

    // Phase 6. Append-only integrity signals.
    integrity: { type: Array, default: [] },

    // The student account this roll number maps to on the room owner's roster.
    accountId: { type: String, default: null },
  },
  { versionKey: false },
);

// One submitted attempt. Append-only evidence: the response and the machine's
// assessment are kept; a professor's review is written beside them.
const answerSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'Session', required: true, index: true },
    answerKey: { type: String, required: true },
    rollNo: { type: String, required: true },
    accountId: { type: String, default: null, index: true },
    questionId: { type: String, default: null, index: true },
    contentId: { type: String, default: null },
    topic: { type: String, default: '' },
    bloom: { type: String, enum: LEVELS, required: true },
    kind: { type: String, default: 'mcq' },
    questionSnapshot: { type: Object, default: {} },
    response: { type: Schema.Types.Mixed, default: null },
    attempt: { type: Number, default: 1 },
    final: { type: Boolean, default: true },
    correct: { type: Boolean, default: null },
    score: { type: Number, default: null },
    detail: { type: String, default: '' },
    ungraded: { type: Boolean, default: false },
    language: { type: String, default: 'en' },
    questionSource: { type: String, default: 'llm' },
    servedAt: { type: String, default: null },
    answeredAt: { type: String, default: () => new Date().toISOString() },
    reviewStatus: { type: String, enum: ['auto', 'provisional', 'confirmed', 'overridden'], default: 'auto' },
    autoCorrect: { type: Boolean, default: null },
    autoScore: { type: Number, default: null },
    autoDetail: { type: String, default: '' },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: String, default: null },
    reviewNote: { type: String, default: '' },
    confidence: { type: String, enum: ['sure', 'think', 'guess', null], default: null },
  },
  { versionKey: false },
);
answerSchema.index({ sessionId: 1, answerKey: 1 }, { unique: true });
answerSchema.index({ sessionId: 1, rollNo: 1 });

// roll number is the identity within a session [F4]
profileSchema.index({ sessionId: 1, rollNo: 1 }, { unique: true });

export const Content = model('Content', contentSchema);
export const Question = model('Question', questionSchema);
export const Session = model('Session', sessionSchema);
export const Profile = model('Profile', profileSchema);
export const Answer = model('Answer', answerSchema);

// A deleted room, kept as one JSON document (services/archive.js). No ref on
// sessionId: the session it names is deleted right after this is written.
const roomArchiveSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true },
    code: { type: String, required: true },
    title: { type: String, default: '' },
    ownerId: { type: String, default: null },
    archivedBy: { type: String, default: null },
    archivedAt: { type: Date, default: Date.now },
    bytes: { type: Number, required: true, min: 1, max: 1024 * 1024 },
    data: { type: Schema.Types.Mixed, required: true },
  },
  { minimize: false },
);
roomArchiveSchema.index({ ownerId: 1, archivedAt: -1 });
export const RoomArchive = model('RoomArchive', roomArchiveSchema);

// One professor decision on an answer (supabase/migrations/0010). Append-only:
// the repository inserts and never updates, so a later decision never erases an
// earlier one. Ids are strings so a query by either id needs no cast.
const answerReviewSchema = new Schema(
  {
    answerId: { type: String, required: true },
    sessionId: { type: String, required: true, index: true },
    decision: { type: String, enum: ['confirm', 'override'], required: true },
    correct: { type: Boolean, required: true },
    score: { type: Number, required: true, min: 0, max: 1 },
    note: { type: String, default: '', maxlength: 1000 },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: String, default: () => new Date().toISOString() },
  },
  { versionKey: false },
);
answerReviewSchema.index({ answerId: 1, reviewedAt: 1 });
export const AnswerReview = model('AnswerReview', answerReviewSchema);

// An image uploaded for a question stimulus (supabase/migrations/0014). The id
// is drawn at random, not left to Mongo: a default ObjectId is a timestamp, a
// per-process constant and a counter, so one upload's url would give away its
// neighbours', and a phone loads an upload by its url alone (services/media.js).
const mediaSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId(crypto.randomBytes(12).toString('hex')) },
    ownerId: { type: String, default: null },
    contentId: { type: String, required: true, index: true },
    mime: { type: String, enum: IMAGE_TYPES, required: true },
    bytes: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    data: { type: Buffer, required: true },
    alt: { type: String, required: true },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false },
);
export const Media = model('Media', mediaSchema);

// A professor's class and its roster (supabase/migrations/0016). Ids are kept as
// strings, as for reviews, so a query by either id needs no cast. A roster row
// holds a roll number and a name and nothing else: Mongoose drops any path it
// has no schema for, so a phone number sent with a row could not be stored here
// even if a route forgot to leave it out.
const classSchema = new Schema(
  {
    ownerId: { type: String, default: null, index: true },
    courseName: { type: String, required: true, maxlength: 120 },
    section: { type: String, required: true, maxlength: 40 },
    termLabel: { type: String, default: '', maxlength: 40 },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' }, versionKey: false },
);
export const Class = model('Class', classSchema);

const classStudentSchema = new Schema(
  {
    classId: { type: String, required: true },
    rollNo: { type: String, required: true },
    name: { type: String, required: true, maxlength: 80 },
    addedAt: { type: String, default: () => new Date().toISOString() },
    // Removed, never deleted: answers and attendance outlive a correction to the list.
    removedAt: { type: String, default: null },
  },
  { versionKey: false },
);
classStudentSchema.index({ classId: 1, rollNo: 1 }, { unique: true });
export const ClassStudent = model('ClassStudent', classStudentSchema);

// One mark per (room, roster student). 'joined' is only ever present and marked
// by nobody; the route and the live loop write nothing else.
const attendanceSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    classStudentId: { type: String, required: true, index: true },
    status: { type: String, enum: ['present', 'absent', 'late'], required: true },
    source: { type: String, enum: ['joined', 'teacher'], required: true },
    markedAt: { type: String, default: () => new Date().toISOString() },
    markedBy: { type: String, default: null },
  },
  { versionKey: false },
);
attendanceSchema.index({ sessionId: 1, classStudentId: 1 }, { unique: true });
export const Attendance = model('Attendance', attendanceSchema);

// The teacher-record store (supabase/migrations/0017). Staff-only, never read by
// the ladder. Ids are strings, as for the roster. Every path is declared:
// Mongoose drops the ones it has no schema for, and a pick that lost its pool
// size or a tally that lost its counts would be a record of nothing.
const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };

// Append-only: the repository inserts and never updates.
const observationSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    classId: { type: String, default: null },
    classStudentId: { type: String, default: null, index: true },
    rollNo: { type: String, required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    kind: { type: String, enum: OBSERVATION_KINDS.map((k) => k.id), default: null },
    note: { type: String, default: '', maxlength: 280 },
    observedBy: by,
    observedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
observationSchema.index({ classId: 1, day: 1 });
export const Observation = model('Observation', observationSchema);

const wheelRoundSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    round: { type: Number, required: true, min: 1 },
    presentOnly: { type: Boolean, default: true },
    noRepeat: { type: Boolean, default: true },
    startedAt: { type: String, default: nowIso },
    startedBy: by,
  },
  { versionKey: false },
);
wheelRoundSchema.index({ sessionId: 1, round: 1 }, { unique: true });
export const WheelRound = model('WheelRound', wheelRoundSchema);

const wheelPickSchema = new Schema(
  {
    sessionId: { type: String, required: true },
    round: { type: Number, required: true, min: 1 },
    order: { type: Number, required: true, min: 1 },
    rollNo: { type: String, required: true },
    classStudentId: { type: String, default: null },
    poolSize: { type: Number, required: true, min: 1 },
    presentOnly: { type: Boolean, required: true },
    noRepeat: { type: Boolean, required: true },
    ask: { type: String, enum: ASK_TYPES.map((a) => a.id), default: 'bank' },
    questionId: { type: String, default: null },
    status: { type: String, enum: ['pending', ...PICK_STATUSES.map((s) => s.id)], default: 'pending' },
    pickedAt: { type: String, default: nowIso },
    pickedBy: by,
    statusAt: { type: String, default: null },
    statusBy: by,
  },
  { versionKey: false },
);
wheelPickSchema.index({ sessionId: 1, round: 1, order: 1 }, { unique: true });
export const WheelPick = model('WheelPick', wheelPickSchema);

const handTallySchema = new Schema(
  {
    sessionId: { type: String, required: true },
    seq: { type: Number, required: true, min: 1 },
    questionId: { type: String, default: null },
    text: { type: String, required: true, maxlength: 1000 },
    labels: { type: [String], default: () => ['', '', '', ''] },
    // Never below 0: a count is a number of hands.
    counts: { type: [{ type: Number, min: 0 }], default: () => [0, 0, 0, 0] },
    revealed: { type: Boolean, default: false },
    correct: { type: Number, min: 0, max: 3, default: null },
    createdAt: { type: String, default: nowIso },
    createdBy: by,
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
handTallySchema.index({ sessionId: 1, seq: 1 }, { unique: true });
export const HandTally = model('HandTally', handTallySchema);

const roomActivitySchema = new Schema(
  {
    sessionId: { type: String, required: true },
    seq: { type: Number, required: true, min: 1 },
    kind: { type: String, enum: ACTIVITY_KINDS.map((k) => k.id), required: true },
    outcome: { type: String, default: '', maxlength: 280 },
    // Groups, never students: [{ label, gotIt }].
    groups: { type: Schema.Types.Mixed, default: () => [] },
    tallyId: { type: String, default: null },
    createdAt: { type: String, default: nowIso },
    createdBy: by,
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false, minimize: false },
);
roomActivitySchema.index({ sessionId: 1, seq: 1 }, { unique: true });
export const RoomActivity = model('RoomActivity', roomActivitySchema);

// Append-only, like observations.
const insightActionSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    flagId: { type: String, required: true, maxlength: 120 },
    action: { type: String, enum: INSIGHT_ACTIONS, required: true },
    note: { type: String, default: '', maxlength: 280 },
    actedBy: by,
    actedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
export const InsightAction = model('InsightAction', insightActionSchema);

// A classroom projector's link (supabase/migrations/0018). Only the token's
// SHA-256 is kept; the repository changes nothing but the revocation.
const projectorLinkSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, match: /^[0-9a-f]{64}$/ },
    createdAt: { type: String, default: nowIso },
    createdBy: by,
    revokedAt: { type: String, default: null },
    revokedBy: by,
  },
  { versionKey: false },
);
export const ProjectorLink = model('ProjectorLink', projectorLinkSchema);

export { levelCounter };
