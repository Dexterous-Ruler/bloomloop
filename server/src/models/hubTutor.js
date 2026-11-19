// Mongoose models for the hub's tutor (Phase 6, decision H13,
// supabase/migrations/0029). Ids are kept as strings, as for the other hub
// models, so a query by either id needs no cast. The uniqueness the Postgres
// tables have is an index here: one hint per (question, step), one feedback per
// (question, option key), one hint view per (account, attempt id, position).
// Append-only is the repository's promise on this store for hint views (the
// methods offer no update or delete of one); Postgres also enforces it with a
// trigger.

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };

const approval = {
  provenance: { type: String, enum: ['ai', 'professor'], required: true },
  status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
  model: { type: String, default: null },
  sourceRef: { type: Schema.Types.Mixed, default: null },
  createdBy: by,
  createdAt: { type: String, default: nowIso },
  updatedAt: { type: String, default: nowIso },
  approvedBy: by,
  approvedAt: { type: String, default: null },
};

const questionHintSchema = new Schema(
  {
    questionId: { type: String, required: true, index: true },
    step: { type: Number, required: true, min: 1, max: 3 },
    text: { type: String, required: true, maxlength: 600 },
    ...approval,
  },
  { versionKey: false },
);
questionHintSchema.index({ questionId: 1, step: 1 }, { unique: true });
export const QuestionHint = model('QuestionHint', questionHintSchema);

const optionFeedbackSchema = new Schema(
  {
    questionId: { type: String, required: true, index: true },
    option: { type: String, required: true, maxlength: 1000 },
    optionKey: { type: String, required: true, maxlength: 1000 },
    text: { type: String, required: true, maxlength: 600 },
    ...approval,
  },
  { versionKey: false },
);
optionFeedbackSchema.index({ questionId: 1, optionKey: 1 }, { unique: true });
export const OptionFeedback = model('OptionFeedback', optionFeedbackSchema);

const hintViewSchema = new Schema(
  {
    accountId: { type: String, required: true },
    clientAttemptId: { type: String, required: true, match: /^[A-Za-z0-9_-]{8,64}$/ },
    questionId: { type: String, default: null, index: true },
    topicId: { type: String, default: null },
    contentId: { type: String, default: null },
    mode: { type: String, enum: ['practice', 'review', 'lesson'], required: true },
    position: { type: Number, required: true, min: 1, max: 3 },
    kind: { type: String, enum: ['feedback', 'nudge', 'strategy', 'worked'], required: true },
    hintId: { type: String, default: null },
    text: { type: String, required: true, maxlength: 4000 },
    provenance: { type: String, enum: ['ai', 'professor'], required: true },
    language: { type: String, default: 'en', match: /^[a-z]{2,3}$/ },
    translationId: { type: String, default: null },
    sourceRef: { type: Schema.Types.Mixed, default: null },
    plan: { type: Schema.Types.Mixed, default: {} },
    createdAt: { type: String, default: nowIso },
  },
  // `minimize: false` keeps an empty plan object as written.
  { versionKey: false, minimize: false },
);
hintViewSchema.index({ accountId: 1, clientAttemptId: 1, position: 1 }, { unique: true });
export const HintView = model('HintView', hintViewSchema);
