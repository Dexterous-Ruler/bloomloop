// What the Learning Hub's screens are sent (Phase 6, decisions H2, H3, H4, H15).
//
// Two audiences, built field by field, never by spreading a stored row:
//
//   STUDENT   a class's units, its chapters (title only) and their topics that
//             are not retired, in the professor's order; chapters in no unit
//             under "Other chapters"; and, on a topic, its confirmed
//             prerequisites and what it leads to. Nothing else: no slide text,
//             no topic_slides, no question, count or draft, no proposed or
//             rejected link, no retired topic, no other class (H2).
//   STAFF     the same, plus what the professor needs to run it: retired
//             topics (marked), each topic's questions and links counted,
//             whether the chapter kept each slide's words (H4, said in a
//             sentence), topics on the chapter's list that have no record yet,
//             questions under no topic, every link in every state with who
//             proposed it, and the owner's chapters not yet on the class.
//
// Every name and reason carries HTML beside its plain text (`nameHtml`,
// `titleHtml`, `reasonHtml`): maths rendered, everything else escaped
// (services/richText.js, H15).

import { labelHtml } from './richText.js';
import { dependantsOf, prerequisiteChain } from './hubGraph.js';
import { inTopicOrder, slidesNote, slidesOfTopic, topicRecordsFrom, topicUsage } from './hubTopics.js';
import { ownerOf } from '../ownership.js';

export const OTHER_CHAPTERS = 'Other chapters';

/** Said on a student's hub, plainly (H17). */
export const STUDENT_NOTICE = 'Your professor can see your progress in the hub: the topics you practise and how you are doing on them.';

/** Said when a class has nothing placed yet. */
export const EMPTY_CLASS = 'Your professor has not added any chapters to this class yet.';

const byPosition = (a, b) => (a.position - b.position) || String(a.createdAt ?? a.addedAt ?? '').localeCompare(String(b.createdAt ?? b.addedAt ?? ''));

const named = (name) => ({ name, nameHtml: labelHtml(name) });

/** A link's provenance and state in words a professor reads (staff only). */
export function linkLabel(link) {
  if (link.state === 'rejected') return link.provenance === 'ai' ? 'Proposed by AI, rejected' : 'Rejected';
  if (link.provenance === 'professor') return 'Added by the professor';
  return link.state === 'confirmed' ? 'Proposed by AI, confirmed by the professor' : 'AI draft: not used until confirmed';
}

export const classHead = (cls) => ({
  id: String(cls._id),
  courseName: cls.courseName,
  section: cls.section,
  termLabel: cls.termLabel ?? '',
});

/** A class's units and placements, read once and grouped: units in order, each with its placements in order, then the rest. */
async function layoutOf(repo, cls) {
  const [units, placed] = await Promise.all([repo.listClassUnits(cls._id), repo.listClassChapters(cls._id)]);
  const ordered = [...units].sort(byPosition);
  const unitIds = new Set(ordered.map((u) => String(u._id)));
  const inUnit = (u) => placed.filter((p) => String(p.unitId ?? '') === String(u._id)).sort(byPosition);
  const other = placed.filter((p) => !p.unitId || !unitIds.has(String(p.unitId))).sort(byPosition);
  return { units: ordered.map((u) => ({ unit: u, placed: inUnit(u) })), other, placed };
}

/** Chapters by id (lower case), each read once; a chapter that is gone is left out. */
async function chaptersOf(repo, placed) {
  const out = new Map();
  for (const p of placed) {
    const key = String(p.contentId).toLowerCase();
    if (out.has(key)) continue;
    const content = await repo.getContent(p.contentId).catch(() => null);
    if (content) out.set(key, content);
  }
  return out;
}

/* -------------------------------------------------------------- student -- */

async function studentChapter(repo, content) {
  const topics = inTopicOrder(await repo.listChapterTopics(content._id)).filter((t) => !t.retiredAt);
  return {
    id: String(content._id),
    title: content.title ?? '',
    titleHtml: labelHtml(content.title ?? ''),
    topics: topics.map((t) => ({ id: String(t._id), ...named(t.name) })),
  };
}

/** One class's hub as its student sees it (H2). */
export async function studentClassView(repo, cls) {
  const { units, other, placed } = await layoutOf(repo, cls);
  const contents = await chaptersOf(repo, placed);
  const chapter = async (p) => {
    const content = contents.get(String(p.contentId).toLowerCase());
    return content ? studentChapter(repo, content) : null;
  };
  const list = async (rows) => (await Promise.all(rows.map(chapter))).filter(Boolean);
  return {
    class: classHead(cls),
    units: await Promise.all(units.map(async ({ unit, placed: rows }) => ({
      id: String(unit._id),
      ...named(unit.name),
      chapters: await list(rows),
    }))),
    otherChapters: { label: OTHER_CHAPTERS, chapters: await list(other) },
    ...(placed.length ? {} : { empty: EMPTY_CLASS }),
  };
}

/** A chapter as its student sees it: its title and its topics. */
export const studentChapterView = (repo, content) => studentChapter(repo, content);

/* ---------------------------------------------------------------- staff -- */

/** Each chapter's records, questions and the owner's links, for the staff views. */
async function staffChapter(repo, content, links) {
  const [records, questions] = await Promise.all([
    repo.listChapterTopics(content._id),
    repo.listQuestions(content._id, { includeDiscarded: true }),
  ]);
  const ordered = inTopicOrder(records).sort((a, b) => Number(Boolean(a.retiredAt)) - Number(Boolean(b.retiredAt)));
  const usage = topicUsage(ordered, questions, links);
  const held = new Set(records.map((r) => r.key));
  const unsynced = topicRecordsFrom(content.topics).wanted.filter((w) => !held.has(w.key)).map((w) => w.name);
  return {
    id: String(content._id),
    title: content.title ?? '',
    titleHtml: labelHtml(content.title ?? ''),
    kind: content.kind,
    slides: slidesNote(content),
    topics: ordered.map((t) => {
      const u = usage.get(String(t._id));
      return {
        id: String(t._id),
        ...named(t.name),
        position: t.position,
        retired: Boolean(t.retiredAt),
        retiredAt: t.retiredAt ?? null,
        // The slide numbers the topic came from (topic_slides), staff-only.
        slides: slidesOfTopic(content, t.name),
        questions: { active: u.questions.active, draft: u.questions.draft },
        links: { prerequisites: u.links.prerequisites, dependants: u.links.dependants, proposed: u.links.proposed },
      };
    }),
    // On the chapter's topic list with no record yet: a chapter from before the
    // hub that has not been synced. The owner's sync makes them.
    unsynced,
    // Questions whose topic matches no record of the chapter (a topic renamed
    // on the list after they were written keeps its record, retired, so these
    // are questions written under a name the list never held).
    unmatchedQuestions: usage.unmatched,
  };
}

/** One class's hub as its owner (canEdit) or an HOD sees it. */
export async function staffClassView(repo, cls, { canEdit = false, access = 'reader' } = {}) {
  const { units, other, placed } = await layoutOf(repo, cls);
  const contents = await chaptersOf(repo, placed);
  const links = await repo.listTopicLinks({ ownerId: ownerOf(cls) });
  const built = new Map();
  for (const [key, content] of contents) built.set(key, await staffChapter(repo, content, links));
  const chapter = (p) => {
    const view = built.get(String(p.contentId).toLowerCase());
    return view ? { ...view, position: p.position, addedAt: p.addedAt ?? null } : null;
  };
  let available = [];
  if (canEdit) {
    const placedIds = new Set([...contents.keys()]);
    available = (await repo.listContents())
      .filter((c) => String(ownerOf(c) ?? '') === String(ownerOf(cls) ?? '') && ownerOf(c) != null)
      .filter((c) => !placedIds.has(String(c._id).toLowerCase()))
      .map((c) => ({ id: String(c._id), title: c.title ?? '', titleHtml: labelHtml(c.title ?? ''), kind: c.kind }));
  }
  return {
    class: { ...classHead(cls), canEdit, access },
    units: units.map(({ unit, placed: rows }) => ({
      id: String(unit._id),
      ...named(unit.name),
      position: unit.position,
      chapters: rows.map(chapter).filter(Boolean),
    })),
    otherChapters: { label: OTHER_CHAPTERS, chapters: other.map(chapter).filter(Boolean) },
    // The owner's chapters that are not on this class yet, to place.
    available,
    notes: {
      otherChapters: 'Chapters in no unit are shown to students under "Other chapters".',
      students: 'A student sees this class\'s hub when they report to you and the roster holds their roll number. '
        + 'They see the units, chapters and topics, and no question, slide or draft.',
    },
  };
}

/** A class in a staff list: its head and how much its hub holds. */
export async function classSummary(repo, cls, canEdit) {
  const [units, placed] = await Promise.all([repo.listClassUnits(cls._id), repo.listClassChapters(cls._id)]);
  return { ...classHead(cls), canEdit, units: units.length, chapters: placed.length };
}

/** A chapter as staff see it in the hub, with its classes' placements left to the class view. */
export async function staffChapterView(repo, content, { canEdit = false } = {}) {
  const links = await repo.listTopicLinks({ ownerId: ownerOf(content) });
  return { ...(await staffChapter(repo, content, links)), canEdit };
}

/* --------------------------------------------------------------- topics -- */

/** Topic records and their chapters by id, read once for a set of ids. */
async function topicIndex(repo, ids) {
  const topics = await repo.listChapterTopicsByIds([...new Set(ids.map(String))]);
  const contents = new Map();
  for (const t of topics) {
    const key = String(t.contentId).toLowerCase();
    if (!contents.has(key)) contents.set(key, await repo.getContent(t.contentId).catch(() => null));
  }
  return { topics: new Map(topics.map((t) => [String(t._id), t])), contents };
}

const topicRef = (t, contents) => {
  const content = contents.get(String(t.contentId).toLowerCase());
  return {
    id: String(t._id),
    ...named(t.name),
    chapter: { id: String(t.contentId), title: content?.title ?? '', titleHtml: labelHtml(content?.title ?? '') },
    ...(t.retiredAt ? { retired: true } : {}),
  };
};

/** Links as a staff screen gets them, each end named. Links whose topics are gone are left out. */
export async function linkViews(repo, links = []) {
  const { topics, contents } = await topicIndex(repo, links.flatMap((l) => [l.prerequisiteId, l.topicId]));
  return links
    .filter((l) => topics.has(String(l.prerequisiteId)) && topics.has(String(l.topicId)))
    .map((l) => ({
      id: String(l._id),
      prerequisite: topicRef(topics.get(String(l.prerequisiteId)), contents),
      topic: topicRef(topics.get(String(l.topicId)), contents),
      provenance: l.provenance,
      state: l.state,
      label: linkLabel(l),
      reason: l.reason ?? '',
      reasonHtml: labelHtml(l.reason ?? ''),
      createdAt: l.createdAt ?? null,
      decidedAt: l.decidedAt ?? null,
    }));
}

/**
 * One topic with its confirmed chain (nearest first) and what it leads to.
 * `audience` 'student' leaves out retired topics from the lists (the chain still
 * runs through them) and every link that is not confirmed; staff also get the
 * topic's direct links in every state.
 *
 * A confirmed prerequisite may sit in a chapter of the professor's that is on
 * none of the student's classes (an earlier semester's, H3). Its name and
 * chapter title are shown, as the professor confirmed it, marked by
 * `onYourClasses` (from `reachable`, the student's placed chapter ids, lower
 * case), so a screen can say it is from earlier material. Nothing else of that
 * chapter is sent.
 */
export async function topicView(repo, { topic, content }, { audience = 'student', reachable = null } = {}) {
  const links = await repo.listTopicLinks({ ownerId: ownerOf(content) });
  const chain = prerequisiteChain(topic._id, links);
  const after = dependantsOf(topic._id, links);
  const { topics, contents } = await topicIndex(repo, [...chain, ...after].map((e) => e.topicId));
  contents.set(String(content._id).toLowerCase(), content);
  const entry = (e) => {
    const t = topics.get(e.topicId);
    if (!t || (audience === 'student' && t.retiredAt)) return null;
    return {
      ...topicRef(t, contents),
      depth: e.depth,
      via: e.via,
      ...(reachable ? { onYourClasses: reachable.has(String(t.contentId).toLowerCase()) } : {}),
    };
  };
  const out = {
    topic: {
      ...topicRef(topic, contents),
      ...(audience === 'staff' ? { position: topic.position, retiredAt: topic.retiredAt ?? null } : {}),
    },
    prerequisites: chain.map(entry).filter(Boolean),
    leadsTo: after.map(entry).filter(Boolean),
    note: 'Prerequisites are the topics your professor confirmed are needed first, nearest first.',
  };
  if (audience === 'staff') {
    const mine = links.filter((l) => String(l.topicId) === String(topic._id) || String(l.prerequisiteId) === String(topic._id));
    const views = await linkViews(repo, mine);
    out.links = {
      prerequisites: views.filter((v) => v.topic.id === String(topic._id)),
      dependants: views.filter((v) => v.prerequisite.id === String(topic._id)),
    };
    out.note = 'Only confirmed links make the chains. Proposed links are AI drafts until you confirm them.';
  }
  return out;
}
