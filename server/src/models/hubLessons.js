// Mongoose models for the hub's lessons and languages (Phase 6,
// supabase/migrations/0027). Ids are kept as strings, as for the hub's backbone,
// so a query by either id needs no cast. The uniqueness the Postgres tables have
// is an index here: one version number per topic, one approved lesson per topic,
// one approved translation per item and language (partial indexes).

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };
const STATES = ['draft', 'approved', 'superseded', 'discarded'];

const topicLessonSchema = new Schema(
  {
    // Looked up through the (topicId, version) index below.
    topicId: { type: String, required: true },
    contentId: { type: String, required: true, index: true },
    ownerId: by,
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: STATES, default: 'draft' },
    source: { type: String, enum: ['llm', 'slides'], required: true },
    model: { type: String, default: null },
    steps: { type: Schema.Types.Mixed, required: true },
    basis: { type: Schema.Types.Mixed, default: {} },
    warnings: { type: [String], default: [] },
    createdAt: { type: String, default: nowIso },
    createdBy: by,
    approvedAt: { type: String, default: null },
    approvedBy: by,
    retiredAt: { type: String, default: null },
    retiredBy: by,
  },
  { versionKey: false, minimize: false },
);
topicLessonSchema.index({ topicId: 1, version: 1 }, { unique: true });
topicLessonSchema.index({ topicId: 1 }, { unique: true, partialFilterExpression: { status: 'approved' } });
export const TopicLesson = model('TopicLesson', topicLessonSchema);

const itemTranslationSchema = new Schema(
  {
    itemKind: { type: String, enum: ['question', 'lesson', 'explanation', 'hint', 'feedback'], required: true },
    itemId: { type: String, required: true },
    contentId: { type: String, required: true, index: true },
    ownerId: by,
    language: { type: String, enum: ['hi', 'mr'], required: true },
    fields: { type: Schema.Types.Mixed, required: true },
    sourceFields: { type: Schema.Types.Mixed, required: true },
    sourceHash: { type: String, required: true },
    status: { type: String, enum: STATES, default: 'draft' },
    provenance: { type: String, enum: ['ai', 'professor'], required: true },
    model: { type: String, default: null },
    checks: { type: Schema.Types.Mixed, default: [] },
    createdAt: { type: String, default: nowIso },
    createdBy: by,
    updatedAt: { type: String, default: nowIso },
    editedBy: by,
    approvedAt: { type: String, default: null },
    approvedBy: by,
    retiredAt: { type: String, default: null },
    retiredBy: by,
  },
  { versionKey: false, minimize: false },
);
itemTranslationSchema.index({ itemKind: 1, itemId: 1 });
itemTranslationSchema.index(
  { itemKind: 1, itemId: 1, language: 1 },
  { unique: true, partialFilterExpression: { status: 'approved' } },
);
export const ItemTranslation = model('ItemTranslation', itemTranslationSchema);

const languageChoiceSchema = new Schema(
  {
    accountId: { type: String, required: true, unique: true },
    language: { type: String, enum: ['en', 'hi', 'mr'], required: true },
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
export const LanguageChoice = model('LanguageChoice', languageChoiceSchema);
