// Mongoose models for the Learning Hub's Get Ready checks, self-tests and goals
// (Phase 6, supabase/migrations/0028). Ids are kept as strings, as for the other
// hub models. One run per (account, client run id) is an index here, as the
// unique constraint is in Postgres; that a run is written once and then only
// ended, once, is the repository's promise on this store (its methods offer
// nothing else); Postgres also enforces it with a trigger.

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();

const hubRunSchema = new Schema(
  {
    accountId: { type: String, required: true, index: true },
    clientRunId: { type: String, required: true, match: /^[A-Za-z0-9_-]{8,64}$/ },
    kind: { type: String, enum: ['getready', 'exam'], required: true },
    spec: { type: Schema.Types.Mixed, default: {} },
    timeLimitSeconds: { type: Number, default: null, min: 60, max: 10800 },
    startedAt: { type: String, default: nowIso },
    deadlineAt: { type: String, default: null },
    endedAt: { type: String, default: null },
    endReason: { type: String, enum: ['submitted', 'timed-out', 'complete', null], default: null },
  },
  { versionKey: false, minimize: false },
);
hubRunSchema.index({ accountId: 1, clientRunId: 1 }, { unique: true });
export const HubRun = model('HubRun', hubRunSchema);

const hubGoalSchema = new Schema(
  {
    accountId: { type: String, required: true, index: true },
    title: { type: String, default: '', maxlength: 80 },
    examDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    topicIds: { type: [String], required: true },
    createdAt: { type: String, default: nowIso },
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
export const HubGoal = model('HubGoal', hubGoalSchema);
