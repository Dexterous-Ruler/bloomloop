// Mongoose models for Batch 8's live-room gaps (supabase/migrations/0034): the
// suggestions the model made in a room (L1, C2) and the questions the wheel drew
// for its picks (W2). Ids are kept as strings, as for the hub's models. The
// uniqueness the Postgres tables have is an index here: one draw per (pick,
// draw order). Append-only is the repository's promise on this store (its
// methods offer no update or delete of either); Postgres also enforces it with
// a trigger.

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };

const teachingMoveSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    purpose: { type: String, enum: ['move', 'prompt'], required: true },
    activityKind: { type: String, enum: ['check', 'think', 'group', 'diagram', 'real'], required: true },
    title: { type: String, default: '', maxlength: 80 },
    body: { type: String, required: true, maxlength: 600 },
    focusLevel: { type: String, default: null },
    topic: { type: String, default: '', maxlength: 200 },
    basis: { type: Schema.Types.Mixed, default: () => ({}) },
    sourceRef: { type: Schema.Types.Mixed, default: null },
    model: { type: String, required: true },
    askedBy: by,
    askedAt: { type: String, default: nowIso },
  },
  { versionKey: false, minimize: false },
);
export const TeachingMove = model('TeachingMove', teachingMoveSchema);

const wheelQuestionDrawSchema = new Schema(
  {
    sessionId: { type: String, required: true, index: true },
    pickId: { type: String, required: true },
    drawOrder: { type: Number, required: true, min: 1 },
    questionId: { type: String, default: null },
    poolSize: { type: Number, required: true, min: 1 },
    drawnAt: { type: String, default: nowIso },
    drawnBy: by,
  },
  { versionKey: false },
);
wheelQuestionDrawSchema.index({ pickId: 1, drawOrder: 1 }, { unique: true });
export const WheelQuestionDraw = model('WheelQuestionDraw', wheelQuestionDrawSchema);
