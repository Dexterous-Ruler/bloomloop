// Mongoose models for the Learning Hub's content backbone (Phase 6,
// supabase/migrations/0025). Ids are kept as strings, as for the roster and the
// course outcomes, so a query by either id needs no cast. The uniqueness the
// Postgres tables have is an index here: one unit name per class (nameKey, the
// name in lower case), one placement per (class, chapter), one topic record per
// (chapter, key), one link per (prerequisite, topic).

import mongoose from 'mongoose';

const { Schema, model } = mongoose;

const nowIso = () => new Date().toISOString();
const by = { type: String, default: null };

const classUnitSchema = new Schema(
  {
    classId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 80 },
    nameKey: { type: String, required: true },
    position: { type: Number, default: 1, min: 1 },
    createdBy: by,
    createdAt: { type: String, default: nowIso },
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
classUnitSchema.index({ classId: 1, nameKey: 1 }, { unique: true });
export const ClassUnit = model('ClassUnit', classUnitSchema);

const classChapterSchema = new Schema(
  {
    classId: { type: String, required: true, index: true },
    contentId: { type: String, required: true },
    unitId: { type: String, default: null },
    position: { type: Number, default: 1, min: 1 },
    addedBy: by,
    addedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
classChapterSchema.index({ classId: 1, contentId: 1 }, { unique: true });
export const ClassChapter = model('ClassChapter', classChapterSchema);

const chapterTopicSchema = new Schema(
  {
    contentId: { type: String, required: true, index: true },
    name: { type: String, required: true, maxlength: 300 },
    key: { type: String, required: true },
    position: { type: Number, default: 1, min: 1 },
    retiredAt: { type: String, default: null },
    createdAt: { type: String, default: nowIso },
    updatedAt: { type: String, default: nowIso },
  },
  { versionKey: false },
);
chapterTopicSchema.index({ contentId: 1, key: 1 }, { unique: true });
export const ChapterTopic = model('ChapterTopic', chapterTopicSchema);

const topicLinkSchema = new Schema(
  {
    ownerId: { type: String, default: null, index: true },
    prerequisiteId: { type: String, required: true },
    topicId: { type: String, required: true, index: true },
    provenance: { type: String, enum: ['ai', 'professor'], required: true },
    state: { type: String, enum: ['proposed', 'confirmed', 'rejected'], default: 'proposed' },
    reason: { type: String, default: '', maxlength: 300 },
    model: { type: String, default: null },
    createdBy: by,
    createdAt: { type: String, default: nowIso },
    decidedAt: { type: String, default: null },
    decidedBy: by,
  },
  { versionKey: false },
);
topicLinkSchema.index({ prerequisiteId: 1, topicId: 1 }, { unique: true });
export const TopicLink = model('TopicLink', topicLinkSchema);
