// Mongoose models for the Learning Hub's practice evidence and explanations
// (Phase 6, supabase/migrations/0026). Ids are kept as strings, as for the
// backbone's models, so a query by either id needs no cast. The uniqueness the
// Postgres tables have is an index here: one attempt per (account, client
// attempt id), one explanation per question. Append-only is the repository's
// promise on this store (the methods offer no update or delete of an attempt);
// Postgres also enforces it with a trigger.

import mongoose from 'mongoose';

import { LEVELS } from '../bloom.js';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };

const hubAttemptSchema = new Schema(
  {
    accountId: { type: String, required: true, index: true },
    clientAttemptId: { type: String, required: true, match: /^[A-Za-z0-9_-]{8,64}$/ },
    classId: { type: String, default: null },
    contentId: { type: String, default: null },
    topicId: { type: String, default: null, index: true },
    topic: { type: String, default: '' },
    questionId: { type: String, default: null },
    bloom: { type: String, enum: LEVELS, required: true },
    kind: { type: String, default: 'mcq' },
    questionSnapshot: { type: Schema.Types.Mixed, default: {} },
    questionSource: { type: String, default: 'llm' },
    response: { type: Schema.Types.Mixed, default: null },
    correct: { type: Boolean, required: true },
    score: { type: Number, required: true, min: 0, max: 1 },
    detail: { type: String, default: '' },
    reviewStatus: { type: String, enum: ['auto', 'provisional'], default: 'auto' },
    mode: { type: String, enum: ['practice', 'exam', 'getready', 'review', 'lesson'], required: true },
    language: { type: String, default: 'en', match: /^[a-z]{2,3}$/ },
    hintsUsed: { type: Number, default: 0, min: 0, max: 3 },
    timeTakenMs: { type: Number, default: null, min: 0, max: 86400000 },
    // The Get Ready check or self-test it was given in (0028), or none.
    runId: { type: String, default: null, index: true },
    createdAt: { type: String, default: nowIso },
  },
  // `minimize: false` keeps an empty snapshot or response object as written.
  { versionKey: false, minimize: false },
);
hubAttemptSchema.index({ accountId: 1, clientAttemptId: 1 }, { unique: true });
export const HubAttempt = model('HubAttempt', hubAttemptSchema);

const questionExplanationSchema = new Schema(
  {
    questionId: { type: String, required: true },
    text: { type: String, required: true, maxlength: 2000 },
    provenance: { type: String, enum: ['ai', 'professor'], required: true },
    status: { type: String, enum: ['draft', 'approved'], default: 'draft' },
    model: { type: String, default: null },
    sourceRef: { type: Schema.Types.Mixed, default: null },
    createdBy: by,
    createdAt: { type: String, default: nowIso },
    updatedAt: { type: String, default: nowIso },
    approvedBy: by,
    approvedAt: { type: String, default: null },
  },
  { versionKey: false },
);
questionExplanationSchema.index({ questionId: 1 }, { unique: true });
export const QuestionExplanation = model('QuestionExplanation', questionExplanationSchema);
