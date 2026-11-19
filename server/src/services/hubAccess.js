// Who reaches what in the Learning Hub (Phase 6, decisions H1 and H2). ONE rule,
// used by every hub route, and imported by every later hub builder.
//
// The hub is for accounts only: rooms stay account-free (decision 7), and a
// room phone holding a typed roll number never reaches anything here.
//
//   A STUDENT reaches a class when all three hold (studentOnClass):
//     - the class's owner is the professor the account reports to
//       (accounts.reports_to), and
//     - the class roster holds the account's roll number (rollKey, the rule a
//       room's roll numbers and the roster already share), and
//     - that roster row is not removed.
//   Through a class they reach its placed chapters, those chapters' topic
//   records that are not retired, and confirmed prerequisite links. Nothing
//   else of the professor's: no other class, chapter, draft, slide text, answer
//   key, misconception label or proposed link (H2).
//
//   STAFF read by the rule every class and chapter already follows
//   (ownership.js): the owner reads and writes; an HOD reads the department's
//   and writes nothing; anyone else is refused.
//
// "Not yours" and "not there" are one 404, word for word (NOT_FOUND), so no id
// can be probed: a student of another professor, a student removed from the
// roster, and a class that does not exist all read "That class was not found."
// An HOD who may read a class and asks to change it gets 403: they know it exists.

import { isRecordId } from '../ids.js';
import { canRead, canWrite, ownerOf } from '../ownership.js';
import { rollKey } from './accounts.js';

/** The one 404 per kind of thing, for "not there" and "not yours" alike. */
export const NOT_FOUND = Object.freeze({
  class: 'That class was not found.',
  unit: 'That unit was not found.',
  chapter: 'That chapter was not found.',
  topic: 'That topic was not found.',
  link: 'That link was not found.',
});

export const STAFF_ONLY = 'This is for a professor or an HOD only.';
export const READ_ONLY = 'You can read this class\'s hub but not change it: only the professor who owns it can.';

const fail = (message, status) => Object.assign(new Error(message), { status });
export const notFound = (what) => fail(NOT_FOUND[what], 404);

const isStudent = (viewer) => viewer?.role === 'student';
export const isStaff = (viewer) => viewer?.role === 'professor' || viewer?.role === 'hod';

/** 403 before any lookup for a student on a staff route, so nothing is learnt from it. */
export function assertStaff(viewer) {
  if (!isStaff(viewer)) throw fail(STAFF_ONLY, 403);
}

/**
 * THE RULE (H1), pure: does this student account reach this class, given the
 * class's whole roster? False for anyone who is not an active student.
 */
export function studentOnClass(account, cls, roster = []) {
  if (!account || account.role !== 'student' || account.active === false) return false;
  if (!cls?.ownerId || !account.reportsTo || String(cls.ownerId) !== String(account.reportsTo)) return false;
  const roll = rollKey(account.rollNo);
  if (!roll) return false;
  return roster.some((s) => !s.removedAt && rollKey(s.rollNo) === roll);
}

/** studentOnClass() reading the roster itself. */
export async function studentReachesClass(repo, account, cls) {
  if (!cls || !account || account.role !== 'student') return false;
  if (!cls.ownerId || String(cls.ownerId) !== String(account.reportsTo ?? '')) return false;
  return studentOnClass(account, cls, await repo.listClassStudents(cls._id));
}

/** Every class a student reaches, newest first (the store's order). */
export async function studentClasses(repo, account) {
  if (!account || account.role !== 'student' || !account.reportsTo) return [];
  const theirs = (await repo.listClasses()).filter((c) => c.ownerId && String(c.ownerId) === String(account.reportsTo));
  const out = [];
  for (const cls of theirs) if (await studentReachesClass(repo, account, cls)) out.push(cls);
  return out;
}

/**
 * Everything a student reaches: their classes, and per class its placed
 * chapters. `contentIds` is every chapter placed on any of them.
 *
 * @returns {Promise<{ classes: object[], placements: Map<string, object[]>, contentIds: Set<string> }>}
 */
export async function studentReach(repo, account) {
  const classes = await studentClasses(repo, account);
  const placements = new Map();
  const contentIds = new Set();
  for (const cls of classes) {
    const placed = await repo.listClassChapters(cls._id);
    placements.set(String(cls._id), placed);
    for (const p of placed) contentIds.add(String(p.contentId).toLowerCase());
  }
  return { classes, placements, contentIds };
}

/**
 * A class as the hub sees it for this viewer, or the one 404.
 *
 * @returns {Promise<{ cls, access: 'student'|'owner'|'reader', canEdit: boolean }>}
 *   `owner` may write (the professor who owns it); `reader` may only read (an HOD
 *   of the department); `student` is on its roster by the rule above.
 */
export async function hubClass(repo, viewer, rawClassId) {
  const id = String(rawClassId ?? '').trim();
  const cls = isRecordId(id) ? await repo.getClass(id) : null;
  if (!cls) throw notFound('class');
  if (isStudent(viewer)) {
    if (!(await studentReachesClass(repo, viewer, cls))) throw notFound('class');
    return { cls, access: 'student', canEdit: false };
  }
  if (!isStaff(viewer) || !(await canRead(viewer, ownerOf(cls)))) throw notFound('class');
  const canEdit = await canWrite(viewer, ownerOf(cls));
  return { cls, access: canEdit ? 'owner' : 'reader', canEdit };
}

/** The class's owner only: 404 for anyone who may not read it, 403 for one who may only read it. */
export async function hubClassToEdit(repo, viewer, rawClassId) {
  assertStaff(viewer);
  const ctx = await hubClass(repo, viewer, rawClassId);
  if (!ctx.canEdit) throw fail(READ_ONLY, 403);
  return ctx;
}

/**
 * A chapter as the hub sees it for this viewer, or the one 404. A student
 * reaches a chapter only while it is placed on one of their classes; staff by
 * the chapter's own read rule.
 *
 * @returns {Promise<{ content, access: 'student'|'owner'|'reader', canEdit: boolean, classIds: string[] }>}
 *   `classIds`: for a student, the classes of theirs it is placed on.
 */
export async function hubChapter(repo, viewer, rawContentId) {
  const id = String(rawContentId ?? '').trim();
  const content = isRecordId(id) ? await repo.getContent(id).catch(() => null) : null;
  if (!content) throw notFound('chapter');
  if (isStudent(viewer)) {
    const { classes, placements } = await studentReach(repo, viewer);
    const key = String(content._id).toLowerCase();
    const classIds = classes
      .filter((c) => (placements.get(String(c._id)) ?? []).some((p) => String(p.contentId).toLowerCase() === key))
      .map((c) => String(c._id));
    if (!classIds.length) throw notFound('chapter');
    return { content, access: 'student', canEdit: false, classIds };
  }
  if (!isStaff(viewer) || !(await canRead(viewer, ownerOf(content)))) throw notFound('chapter');
  const canEdit = await canWrite(viewer, ownerOf(content));
  return { content, access: canEdit ? 'owner' : 'reader', canEdit, classIds: [] };
}

/** The chapter's owner only: 404 / 403 as for a class. */
export async function hubChapterToEdit(repo, viewer, rawContentId) {
  assertStaff(viewer);
  const ctx = await hubChapter(repo, viewer, rawContentId);
  if (!ctx.canEdit) throw fail(READ_ONLY, 403);
  return ctx;
}

/**
 * A topic record as the hub sees it for this viewer, or the one 404: through its
 * chapter (hubChapter). A retired topic is staff-only.
 *
 * @returns {Promise<{ topic, content, access, canEdit, classIds }>}
 */
export async function hubTopic(repo, viewer, rawTopicId) {
  const id = String(rawTopicId ?? '').trim();
  const topic = isRecordId(id) ? await repo.getChapterTopic(id) : null;
  if (!topic) throw notFound('topic');
  let ctx;
  try {
    ctx = await hubChapter(repo, viewer, topic.contentId);
  } catch (err) {
    if (err.status === 404) throw notFound('topic');
    throw err;
  }
  if (ctx.access === 'student' && topic.retiredAt) throw notFound('topic');
  return { topic, ...ctx };
}
