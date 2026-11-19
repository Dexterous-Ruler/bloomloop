// The Learning Hub's topic records and slide texts (Phase 6, decisions H3, H4).
//
// A chapter's topics have been a list of strings on the chapter
// (contents.topics) and a free string on each question (questions.topic). The
// hub needs to point at a topic: a unit lists them, a prerequisite link joins
// two of them, and later a student's practice and review hang off one. So each
// chapter's topics become records (chapter_topics, 0025): an id, the name, the
// chapter's order.
//
// Kept in step with contents.topics by syncTopics(), which runs whenever a
// chapter's topics are written (an upload, a professor's edit of the list), when
// a chapter is placed in a class, and on the owner's request for a chapter made
// before 0025. Reads never write. A topic that leaves the list is deleted only
// if nothing hangs off it; one that has questions or prerequisite links is
// RETIRED instead (retired_at), so its questions and links keep a record to
// point at, and it comes back, with its id, if the name returns to the list.
//
// Questions are matched to a record by name within their chapter, ignoring case
// and runs of spaces (topicKey, the rule course outcomes already use), or by the
// name as the generator clips it onto a long topic (questionTopicFor). No
// question row is ever rewritten. A renamed topic is a new record: the old one
// is retired with its questions, as course outcomes treat a renamed topic.
//
// Per-slide text (H4): a deck uploaded from Phase 6 on keeps each slide's own
// words (contents.slide_texts). A chapter uploaded before then keeps only the
// slide numbers each topic came from (topic_slides), and its slide words are
// gone with the deck; slidesNote() says so wherever that shows. Slide text is
// staff material: it reaches a student only inside an approved lesson (H2).

import { cleanTopic, topicKey } from './outcomes.js';
import { questionTopicFor } from './generate.js';

export { topicKey };

/** The longest topic name kept as a record. Longer names (a pasted paragraph) are skipped and named back. */
export const MAX_TOPIC_NAME = 300;

/** Per-slide text kept for one deck: at most this many slides, each cut to this many characters. */
export const MAX_SLIDES = 400;
export const MAX_SLIDE_TEXT = 4000;

/**
 * A chapter's topic list as the records it should have, in its order: cleaned,
 * one per name (by topicKey), each at most MAX_TOPIC_NAME characters.
 *
 * @returns {{ wanted: {name, key, position}[], skipped: string[] }}
 */
export function topicRecordsFrom(topics = []) {
  const wanted = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of Array.isArray(topics) ? topics : []) {
    if (typeof raw !== 'string') continue;
    const name = cleanTopic(raw);
    if (!name) continue;
    if (name.length > MAX_TOPIC_NAME) { skipped.push(name); continue; }
    const key = topicKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push({ name, key, position: wanted.length + 1 });
  }
  return { wanted, skipped };
}

/** Records in the chapter's order: position, then age. Retired ones too; callers filter. */
export const inTopicOrder = (records = []) => [...records].sort((a, b) => (a.position - b.position)
  || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));

/**
 * Which record a question's topic belongs to, within one chapter: the record of
 * the same name (topicKey), else the one whose name the generator clips to it
 * (questionTopicFor). An active record wins over a retired one of the same
 * name; then the chapter's order. Null when none matches.
 *
 * @returns {(topic: string) => object|null}
 */
export function topicMatcher(records = []) {
  const ordered = inTopicOrder(records).sort((a, b) => Number(Boolean(a.retiredAt)) - Number(Boolean(b.retiredAt)));
  const exact = new Map();
  const clipped = new Map();
  for (const r of ordered) {
    if (!exact.has(r.key ?? topicKey(r.name))) exact.set(r.key ?? topicKey(r.name), r);
    const short = topicKey(questionTopicFor(r.name));
    if (!clipped.has(short)) clipped.set(short, r);
  }
  return (topic) => {
    const key = topicKey(topic);
    if (!key) return null;
    return exact.get(key) ?? clipped.get(key) ?? null;
  };
}

/**
 * How much hangs off each record: its questions by status and its prerequisite
 * links by state. `questions` are the chapter's, discarded included; `links`
 * any set that includes those touching these records.
 *
 * @returns {Map<string, { questions: {active, draft, discarded}, links: {prerequisites, dependants, proposed, rejected} }>}
 */
export function topicUsage(records = [], questions = [], links = []) {
  const out = new Map(records.map((r) => [String(r._id), {
    questions: { active: 0, draft: 0, discarded: 0 },
    links: { prerequisites: 0, dependants: 0, proposed: 0, rejected: 0 },
  }]));
  const match = topicMatcher(records);
  let unmatched = 0;
  for (const q of questions) {
    const r = match(q.topic);
    if (!r) { unmatched += 1; continue; }
    const u = out.get(String(r._id));
    const status = ['active', 'draft'].includes(q.status) ? q.status : 'discarded';
    u.questions[status] += 1;
  }
  for (const l of links) {
    const to = out.get(String(l.topicId));
    const from = out.get(String(l.prerequisiteId));
    for (const [u, side] of [[to, 'prerequisites'], [from, 'dependants']]) {
      if (!u) continue;
      if (l.state === 'confirmed') u.links[side] += 1;
      else if (l.state === 'proposed') u.links.proposed += 1;
      else u.links.rejected += 1;
    }
  }
  return Object.assign(out, { unmatched });
}

const isUsed = (u) => u && (u.questions.active + u.questions.draft + u.questions.discarded > 0
  || u.links.prerequisites + u.links.dependants + u.links.proposed + u.links.rejected > 0);

/**
 * Bring a chapter's topic records in step with its topic list (see the header).
 * Safe to run twice at once: a record the other run added is skipped by the
 * store (one per chapter and name), and every step is idempotent.
 *
 * @returns {Promise<{ topics: object[], added: string[], restored: string[], retired: string[], removed: string[], skipped: string[] }>}
 *   `topics` is every record of the chapter after the sync, retired included,
 *   in the chapter's order; the rest are names, for a reply to say what changed.
 */
export async function syncTopics(repo, content, { now = new Date() } = {}) {
  const contentId = String(content._id);
  const { wanted, skipped } = topicRecordsFrom(content.topics);
  const held = await repo.listChapterTopics(contentId);
  const byKey = new Map(held.map((t) => [t.key, t]));
  const wantedKeys = new Set(wanted.map((w) => w.key));
  const report = { added: [], restored: [], retired: [], removed: [], skipped };

  const fresh = [];
  for (const w of wanted) {
    const h = byKey.get(w.key);
    if (!h) { fresh.push({ contentId, name: w.name, key: w.key, position: w.position }); continue; }
    if (h.name !== w.name || h.position !== w.position || h.retiredAt) {
      if (h.retiredAt) report.restored.push(w.name);
      await repo.updateChapterTopic(h._id, { name: w.name, position: w.position, retiredAt: null });
    }
  }
  if (fresh.length) {
    const made = await repo.addChapterTopics(contentId, fresh);
    report.added.push(...made.map((t) => t.name));
  }

  const gone = held.filter((h) => !wantedKeys.has(h.key) && !h.retiredAt);
  if (gone.length) {
    const [questions, links] = await Promise.all([
      repo.listQuestions(contentId, { includeDiscarded: true }),
      repo.listTopicLinks({ ownerId: content.ownerId ?? null }),
    ]);
    // Matched against every record, so a question is counted for the one
    // record it belongs to and no other.
    const usage = topicUsage(held, questions, links);
    for (const h of gone) {
      if (isUsed(usage.get(String(h._id)))) {
        await repo.updateChapterTopic(h._id, { retiredAt: now.toISOString() });
        report.retired.push(h.name);
        continue;
      }
      try {
        await repo.deleteChapterTopic(h._id);
        report.removed.push(h.name);
      } catch {
        // Something the checks above do not see still points at it (a later
        // table's row): keep it, retired, rather than lose what points at it.
        await repo.updateChapterTopic(h._id, { retiredAt: now.toISOString() });
        report.retired.push(h.name);
      }
    }
  }

  return { topics: inTopicOrder(await repo.listChapterTopics(contentId)), ...report };
}

/**
 * syncTopics() where a failure must not fail the request it rides on (an
 * upload, a topic edit): logged, and the next write tries again.
 */
export async function syncTopicsQuietly(repo, content) {
  try {
    return await syncTopics(repo, content);
  } catch (err) {
    console.error('[hub] a chapter\'s topic records could not be kept in step:', err.message);
    return null;
  }
}

/* ---------------------------------------------------------- slide texts -- */

/**
 * Each slide's own words off an extracted deck (extractFromPptx's `slides`), as
 * stored on the chapter (contents.slide_texts): [{ slide, text }], slide numbers
 * as the deck numbers them, empty slides left out, capped (MAX_SLIDES,
 * MAX_SLIDE_TEXT).
 */
export function slideTextsFrom(slides = []) {
  return (Array.isArray(slides) ? slides : [])
    .filter((s) => Number.isInteger(s?.n) && s.n > 0 && typeof s.text === 'string' && s.text.trim())
    .slice(0, MAX_SLIDES)
    .map((s) => ({ slide: s.n, text: s.text.trim().slice(0, MAX_SLIDE_TEXT) }));
}

/**
 * What a staff screen says about a chapter's slides (H4): whether each slide's
 * own words were kept, and if not, why not.
 *
 * @returns {{ perSlideText: boolean, slides: number|null, note: string }}
 */
export function slidesNote(content) {
  const texts = Array.isArray(content?.slideTexts) ? content.slideTexts : null;
  if (texts) {
    return {
      perSlideText: true,
      slides: texts.length,
      note: 'Each slide\'s own words were kept when this deck was uploaded.',
    };
  }
  if (content?.kind === 'pptx') {
    return {
      perSlideText: false,
      slides: null,
      note: 'This deck was uploaded before each slide\'s words were kept. Its topics still cite the slides they came from by '
        + 'number; upload the deck again to keep the words.',
    };
  }
  return { perSlideText: false, slides: null, note: 'This chapter was pasted as text, so it has no slides.' };
}

/**
 * The slide numbers a topic came from (topic_slides), matched by name as a
 * question's citation is. Empty when the chapter has none for it.
 */
export function slidesOfTopic(content, name) {
  const map = content?.topicSlides;
  if (!map || typeof map !== 'object') return [];
  const want = topicKey(name);
  for (const [topic, slides] of Object.entries(map)) {
    if (topicKey(topic) !== want) continue;
    return [...new Set((Array.isArray(slides) ? slides : []).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
  }
  return [];
}

/**
 * A topic's own slide words, at most `max` characters: the kept text of its
 * slides when the deck kept them, else null (the caller falls back to the
 * chapter's text). Staff and model input only; never sent to a student (H2).
 */
export function topicSlideText(content, name, max = 600) {
  const texts = Array.isArray(content?.slideTexts) ? content.slideTexts : null;
  if (!texts) return null;
  const wanted = new Set(slidesOfTopic(content, name));
  if (!wanted.size) return null;
  const text = texts.filter((s) => wanted.has(s.slide)).map((s) => s.text).join('\n').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}
