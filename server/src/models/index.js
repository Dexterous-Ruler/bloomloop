// Mongoose schemas - exactly the data model in completion.md section 5 and
// chapter 5 of the project report. Do not drift: the report is submitted.

import mongoose from 'mongoose';
import { LEVELS } from '../bloom.js';
import { KINDS } from '../questionTypes.js';

const { Schema, model } = mongoose;

const levelCounter = { seen: { type: Number, default: 0 }, correct: { type: Number, default: 0 } };

const contentSchema = new Schema(
  {
    title: { type: String, required: true },
    kind: { type: String, enum: ['pptx', 'syllabus'], required: true },
    rawText: { type: String, default: '' },
    topics: { type: [String], default: [] },
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
    criterion: { type: String, default: undefined },   // rank - what it is ranked against
    accept: { type: [String], default: undefined },    // blank
    blanks: { type: [{ _id: false, accept: [String] }], default: undefined }, // cloze, one per marker
    value: { type: Number, default: undefined },       // numeric
    tolerance: { type: Number, default: undefined },   // numeric
    unit: { type: String, default: undefined },        // numeric
    rubric: { type: [String], default: undefined },    // open
    bloom: { type: String, enum: LEVELS, required: true },
    status: { type: String, enum: ['active', 'discarded'], default: 'active' },
    // [D] provenance, so the UI can never pass a template item off as an LLM one
    source: { type: String, enum: ['llm', 'fallback'], default: 'llm' },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false } },
);

const sessionSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    contentId: { type: Schema.Types.ObjectId, ref: 'Content', required: true },
    title: { type: String, default: '' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
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

export { levelCounter };
