// /api/hub - the Learning Hub's content backbone (Phase 6, decisions H1 to H4).
//
// For accounts only (H1): without Supabase every route here answers 503, as
// every account route does, and a request without a signed-in account's token
// is refused before anything is read. A room phone holding a typed roll number
// has no token, so it never reaches the hub.
//
// Who reaches what is one rule (services/hubAccess.js): a student reaches the
// classes whose owner is their professor and whose roster holds their roll
// number, and only what is approved for them on those (H2); the owner reads and
// writes; an HOD reads the department's and writes nothing (403 on a write to a
// class they may read); anyone else gets the same 404 as for something that
// does not exist, word for word.
//
//   GET    /                                   the caller's hub: a student's classes in full; staff, their classes
//   GET    /classes/:classId                   one class's hub (?view=student: staff preview the student's view)
//   POST   /classes/:classId/units             owner: add a unit { name }
//   PATCH  /classes/:classId/units/:unitId     owner: rename it { name }
//   DELETE /classes/:classId/units/:unitId     owner: remove it; its chapters go to "Other chapters"
//   PUT    /classes/:classId/units/order       owner: reorder { unitIds: every unit, in order }
//   PUT    /classes/:classId/chapters/:contentId   owner: place or move a chapter { unitId: id|null, position? }
//   DELETE /classes/:classId/chapters/:contentId   owner: take a chapter off the class
//   GET    /chapters/:contentId                a chapter's topics (staff: with counts, links and slides)
//   POST   /chapters/:contentId/topics/sync    owner: make or update the chapter's topic records now
//   GET    /topics/:topicId                    a topic, its confirmed chain of prerequisites and what it leads to
//   GET    /links                              staff: prerequisite links (?state=, ?contentId=)
//   POST   /links                              owner: add a link { prerequisiteId, topicId } (confirmed)
//   PATCH  /links/:linkId                      owner: { state: 'confirmed' | 'rejected' }
//   DELETE /links/:linkId                      owner: remove a link
//   POST   /links/propose                      owner: ask the model for direct links { contentIds, runId? }
//   GET    /links/run/:runId                   the proposing run's progress, for its owner
//
// Every write is serialised per class (units and placements) or per professor
// (links), in this process, so two presses at once cannot interleave positions
// or both pass the loop check.

import express from 'express';

import { hasSupabase } from '../config.js';
import { requireAuth, scopeFor } from '../auth.js';
import { getRepo } from '../repo/index.js';
import { isRecordId } from '../ids.js';
import { canWrite, ownerOf, readable } from '../ownership.js';
import { withoutContact } from '../services/roster.js';
import {
  READ_ONLY, assertStaff, hubChapter, hubChapterToEdit, hubClass, hubClassToEdit, hubTopic, notFound, studentClasses, studentReach,
} from '../services/hubAccess.js';
import { syncTopics, syncTopicsQuietly } from '../services/hubTopics.js';
import {
  STUDENT_NOTICE, classSummary, linkViews, staffChapterView, staffClassView, studentChapterView, studentClassView, topicView,
} from '../services/hubViews.js';
import { LINK_STATES, confirmedOnly, loopSentence, wouldLoop } from '../services/hubGraph.js';
import { MAX_PROPOSAL_CHAPTERS, proposeLinks } from '../services/hubProposals.js';
import { failRun, finishRun, getRun, startRun, updateRun } from '../services/runs.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

/** The most units one class may have: far over a semester's syllabus. */
export const MAX_UNITS = 40;
export const MAX_UNIT_NAME = 80;

export const NO_ACCOUNTS = 'The learning hub needs student and staff accounts, and this server has none set up.';

/**
 * The mount's guard: 503 without accounts (H1), then a signed-in account. Not
 * the teacher key: the hub is for accounts only.
 */
export function hubGate(req, res, next) {
  if (!hasSupabase()) return next(fail(NO_ACCOUNTS, 503));
  return requireAuth(req, res, next);
}

router.use(hubGate);

// ------------------------------------------------------------------ locks --

const queues = new Map();

/** Run `fn` after every earlier call with the same key has finished, in this process. */
function withLock(key, fn) {
  const before = queues.get(key) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

// ---------------------------------------------------------------- helpers --

function unitName(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw fail('A unit needs a name, such as "Unit 1: Sets and logic".', 400);
  const name = withoutContact(raw.replace(/\s+/g, ' ').trim(), 'The unit\'s name');
  if (name.length > MAX_UNIT_NAME) throw fail(`A unit's name can be at most ${MAX_UNIT_NAME} characters.`, 400);
  return name;
}

const unitView = (u) => ({ id: String(u._id), name: u.name, position: u.position });

const sameId = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/** A unit of this class, or the one 404. */
async function unitOf(repo, cls, rawUnitId) {
  const id = String(rawUnitId ?? '').trim();
  const unit = isRecordId(id) ? await repo.getClassUnit(id) : null;
  if (!unit || !sameId(unit.classId, cls._id)) throw notFound('unit');
  return unit;
}

/** Positions 1..n in the given order, written only where they differ. */
async function renumber(rows, write) {
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].position !== i + 1) await write(rows[i]._id, { position: i + 1 });
  }
}

const byPlace = (a, b) => (a.position - b.position) || String(a.addedAt ?? '').localeCompare(String(b.addedAt ?? ''));

/** The staff view after a write, so a screen can redraw from one reply. */
const hubAfter = (repo, ctx) => staffClassView(repo, ctx.cls, ctx);

// ------------------------------------------------------------------- home --

router.get('/', async (req, res, next) => {
  try {
    const repo = getRepo();
    const viewer = req.viewer;
    if (viewer.role === 'student') {
      const classes = await studentClasses(repo, viewer);
      res.json({
        role: 'student',
        notice: STUDENT_NOTICE,
        classes: await Promise.all(classes.map((c) => studentClassView(repo, c))),
        ...(classes.length ? {} : {
          empty: 'None of your classes is on the hub yet. Your professor adds you to a class by your roll number.',
        }),
      });
      return;
    }
    assertStaff(viewer);
    const classes = await readable(viewer, await repo.listClasses());
    res.json({
      role: viewer.role,
      classes: await Promise.all(classes.map(async (c) => classSummary(repo, c, await canWrite(viewer, ownerOf(c))))),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------- classes --

router.get('/classes/:classId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClass(repo, req.viewer, req.params.classId);
    if (ctx.access === 'student') {
      res.json({ ...(await studentClassView(repo, ctx.cls)), notice: STUDENT_NOTICE });
      return;
    }
    if (req.query.view === 'student') {
      res.json({ ...(await studentClassView(repo, ctx.cls)), preview: 'This is the class\'s hub as a student on it sees it.' });
      return;
    }
    res.json(await staffClassView(repo, ctx.cls, ctx));
  } catch (err) {
    next(err);
  }
});

router.post('/classes/:classId/units', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const name = unitName(req.body?.name);
    const unit = await withLock(`class:${ctx.cls._id}`, async () => {
      const units = await repo.listClassUnits(ctx.cls._id);
      if (units.length >= MAX_UNITS) throw fail(`A class can have at most ${MAX_UNITS} units.`, 400);
      const last = units.reduce((top, u) => Math.max(top, u.position), 0);
      return repo.createClassUnit({ classId: ctx.cls._id, name, position: last + 1, createdBy: req.viewer.id });
    });
    res.status(201).json({ unit: unitView(unit), hub: await hubAfter(repo, ctx) });
  } catch (err) {
    next(err);
  }
});

// Before /units/:unitId, which would otherwise read "order" as a unit's id.
router.put('/classes/:classId/units/order', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const asked = req.body?.unitIds;
    await withLock(`class:${ctx.cls._id}`, async () => {
      const units = await repo.listClassUnits(ctx.cls._id);
      const ids = Array.isArray(asked) ? asked.map((x) => String(x ?? '').toLowerCase()) : null;
      const everyOnce = ids && ids.length === units.length && new Set(ids).size === ids.length
        && units.every((u) => ids.includes(String(u._id).toLowerCase()));
      if (!everyOnce) throw fail('List every unit of this class once, in the order you want them.', 400);
      const ordered = ids.map((x) => units.find((u) => String(u._id).toLowerCase() === x));
      await renumber(ordered, (id, patch) => repo.updateClassUnit(id, patch));
    });
    res.json({ hub: await hubAfter(repo, ctx) });
  } catch (err) {
    next(err);
  }
});

router.patch('/classes/:classId/units/:unitId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const unit = await unitOf(repo, ctx.cls, req.params.unitId);
    const name = unitName(req.body?.name);
    const updated = await withLock(`class:${ctx.cls._id}`, () => repo.updateClassUnit(unit._id, { name }));
    if (!updated) throw notFound('unit');
    res.json({ unit: unitView(updated), hub: await hubAfter(repo, ctx) });
  } catch (err) {
    next(err);
  }
});

router.delete('/classes/:classId/units/:unitId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const unit = await unitOf(repo, ctx.cls, req.params.unitId);
    const moved = await withLock(`class:${ctx.cls._id}`, async () => {
      const placed = await repo.listClassChapters(ctx.cls._id);
      const inUnit = placed.filter((p) => sameId(p.unitId, unit._id)).sort(byPlace);
      const other = placed.filter((p) => !p.unitId).sort(byPlace);
      await repo.deleteClassUnit(unit._id);
      // Its chapters follow the ones already in no unit, in their order.
      for (let i = 0; i < inUnit.length; i += 1) {
        await repo.updateClassChapter(inUnit[i]._id, { unitId: null, position: other.length + i + 1 });
      }
      return inUnit.length;
    });
    res.json({
      removed: true,
      message: moved
        ? `The unit was removed. Its ${moved === 1 ? 'chapter is' : `${moved} chapters are`} now under "Other chapters"; nothing else changed.`
        : 'The unit was removed; it held no chapters.',
      hub: await hubAfter(repo, ctx),
    });
  } catch (err) {
    next(err);
  }
});

// --------------------------------------------------------------- chapters --

/** A chapter the class's owner may place: theirs, and the class's professor's. */
async function placeableChapter(repo, viewer, cls, rawContentId) {
  let ctx;
  try {
    ctx = await hubChapterToEdit(repo, viewer, rawContentId);
  } catch (err) {
    // A chapter the owner may not change is not theirs to place: the 404.
    if (err.status === 403) throw notFound('chapter');
    throw err;
  }
  if (String(ownerOf(ctx.content) ?? '') !== String(ownerOf(cls) ?? '')) throw notFound('chapter');
  return ctx.content;
}

router.put('/classes/:classId/chapters/:contentId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const content = await placeableChapter(repo, req.viewer, ctx.cls, req.params.contentId);
    const body = req.body ?? {};
    let unit = null;
    if (body.unitId !== undefined && body.unitId !== null) unit = await unitOf(repo, ctx.cls, body.unitId);
    if (body.position !== undefined && !(Number.isInteger(body.position) && body.position >= 1)) {
      throw fail('The position is a whole number from 1: where the chapter goes in its unit.', 400);
    }
    const first = await withLock(`class:${ctx.cls._id}`, async () => {
      const placed = await repo.listClassChapters(ctx.cls._id);
      const held = placed.find((p) => sameId(p.contentId, content._id)) ?? null;
      // Left out, the unit stays as it is (none for a chapter new to the class).
      const unitId = body.unitId === undefined ? (held?.unitId ?? null) : (unit ? String(unit._id) : null);
      const group = placed.filter((p) => p !== held && sameId(p.unitId ?? '', unitId ?? '')).sort(byPlace);
      const at = Math.min(body.position ?? group.length + 1, group.length + 1);
      let row;
      if (held) row = await repo.updateClassChapter(held._id, { unitId, position: at });
      else row = await repo.placeClassChapter({ classId: ctx.cls._id, contentId: content._id, unitId, position: at, addedBy: req.viewer.id });
      group.splice(at - 1, 0, row);
      await renumber(group, (id, patch) => repo.updateClassChapter(id, patch));
      if (held && !sameId(held.unitId ?? '', unitId ?? '')) {
        // The group it left closes up.
        const left = placed.filter((p) => p !== held && sameId(p.unitId ?? '', held.unitId ?? '')).sort(byPlace);
        await renumber(left, (id, patch) => repo.updateClassChapter(id, patch));
      }
      return !held;
    });
    // A chapter from before the hub gets its topic records when it is first
    // placed; a failure here leaves the owner's sync to make them.
    const topics = first ? await syncTopicsQuietly(repo, content) : null;
    res.status(first ? 201 : 200).json({
      placed: true,
      ...(topics ? { topics: { added: topics.added, retired: topics.retired } } : {}),
      hub: await hubAfter(repo, ctx),
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/classes/:classId/chapters/:contentId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubClassToEdit(repo, req.viewer, req.params.classId);
    const id = String(req.params.contentId ?? '').trim();
    if (!isRecordId(id)) throw notFound('chapter');
    await withLock(`class:${ctx.cls._id}`, async () => {
      const placed = await repo.listClassChapters(ctx.cls._id);
      const held = placed.find((p) => sameId(p.contentId, id));
      if (!held) throw notFound('chapter');
      await repo.removeClassChapter(ctx.cls._id, held.contentId);
      const left = placed.filter((p) => p !== held && sameId(p.unitId ?? '', held.unitId ?? '')).sort(byPlace);
      await renumber(left, (rowId, patch) => repo.updateClassChapter(rowId, patch));
    });
    res.json({
      removed: true,
      message: 'The chapter was taken off this class\'s hub. The chapter itself, its questions and its topics are unchanged.',
      hub: await hubAfter(repo, ctx),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/chapters/:contentId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubChapter(repo, req.viewer, req.params.contentId);
    if (ctx.access === 'student') {
      res.json({ chapter: await studentChapterView(repo, ctx.content) });
      return;
    }
    res.json({ chapter: await staffChapterView(repo, ctx.content, ctx) });
  } catch (err) {
    next(err);
  }
});

router.post('/chapters/:contentId/topics/sync', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubChapterToEdit(repo, req.viewer, req.params.contentId);
    const result = await syncTopics(repo, ctx.content);
    res.json({
      added: result.added,
      restored: result.restored,
      retired: result.retired,
      removed: result.removed,
      skipped: result.skipped,
      ...(result.retired.length
        ? { retiredNote: 'A topic that left the chapter\'s list but has questions or links is kept, retired, so they still point at it.' }
        : {}),
      chapter: await staffChapterView(repo, ctx.content, ctx),
    });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------- topics --

router.get('/topics/:topicId', async (req, res, next) => {
  try {
    const repo = getRepo();
    const ctx = await hubTopic(repo, req.viewer, req.params.topicId);
    if (ctx.access === 'student') {
      const { contentIds } = await studentReach(repo, req.viewer);
      res.json(await topicView(repo, ctx, { audience: 'student', reachable: contentIds }));
      return;
    }
    res.json(await topicView(repo, ctx, { audience: 'staff' }));
  } catch (err) {
    next(err);
  }
});

// ------------------------------------------------------------------ links --

/** A link this viewer may read, with its prerequisite topic's context, or the one 404. */
async function readableLink(repo, viewer, rawLinkId) {
  const id = String(rawLinkId ?? '').trim();
  const link = isRecordId(id) ? await repo.getTopicLink(id) : null;
  if (!link) throw notFound('link');
  try {
    const ctx = await hubTopic(repo, viewer, link.prerequisiteId);
    return { link, ctx };
  } catch (err) {
    if (err.status === 404) throw notFound('link');
    throw err;
  }
}

/** The owner's links, a loop check and the sentence, under that owner's lock. */
async function checkLoop(repo, ownerId, prerequisiteId, topicId, exceptId = null) {
  const links = (await repo.listTopicLinks({ ownerId })).filter((l) => !exceptId || String(l._id) !== String(exceptId));
  const path = wouldLoop(confirmedOnly(links), prerequisiteId, topicId);
  if (!path) return;
  const names = new Map((await repo.listChapterTopicsByIds(path.concat([prerequisiteId, topicId])))
    .map((t) => [String(t._id), t.name]));
  throw fail(loopSentence(path, (x) => names.get(x), prerequisiteId, topicId), 409);
}

router.get('/links', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const state = req.query.state;
    if (state !== undefined && !LINK_STATES.includes(String(state))) {
      throw fail('Ask for proposed, confirmed or rejected links, or leave the state out for all of them.', 400);
    }
    let links;
    if (req.query.contentId !== undefined) {
      const ctx = await hubChapter(repo, req.viewer, req.query.contentId);
      const ids = (await repo.listChapterTopics(ctx.content._id)).map((t) => String(t._id));
      links = ids.length ? await repo.listTopicLinks({ ownerId: ownerOf(ctx.content), topicIds: ids }) : [];
    } else {
      // A professor's own; an HOD's department's.
      const owners = req.viewer.role === 'hod' ? (await scopeFor(req.viewer)).ownerIds : [req.viewer.id];
      links = (await Promise.all(owners.map((ownerId) => repo.listTopicLinks({ ownerId })))).flat();
    }
    if (state) links = links.filter((l) => l.state === state);
    const counts = Object.fromEntries(LINK_STATES.map((s) => [s, links.filter((l) => l.state === s).length]));
    res.json({ links: await linkViews(repo, links), counts });
  } catch (err) {
    next(err);
  }
});

router.post('/links/propose', async (req, res, next) => {
  let runId = '';
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const asked = req.body?.contentIds;
    if (!Array.isArray(asked) || !asked.length || asked.length > MAX_PROPOSAL_CHAPTERS) {
      throw fail(`Choose between 1 and ${MAX_PROPOSAL_CHAPTERS} of your chapters to propose links across.`, 400);
    }
    const contents = [];
    for (const raw of new Set(asked.map((x) => String(x ?? '').trim().toLowerCase()))) {
      contents.push((await hubChapterToEdit(repo, req.viewer, raw)).content);
    }
    const ownerId = ownerOf(contents[0]);
    runId = startRun({ id: req.body?.runId, ownerKey: String(req.viewer.id), total: 0, topicsTotal: contents.length });
    const chapters = [];
    for (const content of contents) {
      const synced = await syncTopics(repo, content);
      chapters.push({ content, topics: synced.topics.filter((t) => !t.retiredAt) });
      updateRun(runId, { topicsDone: chapters.length, topic: content.title ?? '' });
    }
    const result = await withLock(`links:${ownerId}`, async () => {
      const links = await repo.listTopicLinks({ ownerId });
      const out = await proposeLinks({ chapters, links });
      const stored = [];
      for (const p of out.proposals) {
        try {
          stored.push(await repo.addTopicLink({
            ownerId,
            prerequisiteId: p.prerequisiteId,
            topicId: p.topicId,
            provenance: 'ai',
            state: 'proposed',
            reason: p.reason,
            model: out.model,
            createdBy: req.viewer.id,
          }));
        } catch (err) {
          if (err.status !== 409) throw err;
        }
      }
      return { ...out, stored };
    });
    finishRun(runId, { written: result.stored.length });
    res.json({
      runId,
      source: result.source,
      note: result.note,
      proposed: await linkViews(repo, result.stored),
      skipped: result.skipped,
      warnings: result.warnings,
      topicsShown: result.topicsShown,
    });
  } catch (err) {
    if (runId) failRun(runId, err.message);
    next(err);
  }
});

router.get('/links/run/:runId', (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const run = getRun(req.params.runId, String(req.viewer.id));
    // One 404 for "no such run" and "not yours".
    if (!run) throw fail('No such run.', 404);
    res.json({ run });
  } catch (err) {
    next(err);
  }
});

router.post('/links', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const p = await hubTopic(repo, req.viewer, req.body?.prerequisiteId);
    const t = await hubTopic(repo, req.viewer, req.body?.topicId);
    if (!p.canEdit || !t.canEdit) throw fail(READ_ONLY, 403);
    if (String(ownerOf(p.content) ?? '') !== String(ownerOf(t.content) ?? '')) throw notFound('topic');
    if (p.topic.retiredAt || t.topic.retiredAt) {
      throw fail('One of these topics is no longer on its chapter\'s list. Links join topics in use.', 400);
    }
    const ownerId = ownerOf(p.content);
    const pid = String(p.topic._id);
    const tid = String(t.topic._id);
    const now = new Date().toISOString();
    const { link, created } = await withLock(`links:${ownerId}`, async () => {
      const held = (await repo.listTopicLinks({ ownerId, topicIds: [pid] }))
        .find((l) => String(l.prerequisiteId) === pid && String(l.topicId) === tid);
      if (held?.state === 'confirmed') return { link: held, created: false };
      await checkLoop(repo, ownerId, pid, tid, held?._id);
      if (held) {
        // The same link, proposed or rejected before: adding it by hand confirms it.
        return { link: await repo.updateTopicLink(held._id, { state: 'confirmed', decidedAt: now, decidedBy: req.viewer.id }), created: false };
      }
      return {
        link: await repo.addTopicLink({
          ownerId, prerequisiteId: pid, topicId: tid, provenance: 'professor', state: 'confirmed', reason: '',
          createdBy: req.viewer.id, decidedAt: now, decidedBy: req.viewer.id,
        }),
        created: true,
      };
    });
    const [view] = await linkViews(repo, [link]);
    res.status(created ? 201 : 200).json({ link: view });
  } catch (err) {
    next(err);
  }
});

router.patch('/links/:linkId', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const { link, ctx } = await readableLink(repo, req.viewer, req.params.linkId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    const state = req.body?.state;
    if (state !== 'confirmed' && state !== 'rejected') throw fail('A link can be confirmed or rejected.', 400);
    const ownerId = link.ownerId ?? null;
    const updated = await withLock(`links:${ownerId}`, async () => {
      const now = await repo.getTopicLink(link._id);
      if (!now) throw notFound('link');
      if (now.state === state) return now;
      if (state === 'confirmed') await checkLoop(repo, ownerId, now.prerequisiteId, now.topicId, now._id);
      return repo.updateTopicLink(now._id, { state, decidedAt: new Date().toISOString(), decidedBy: req.viewer.id });
    });
    const [view] = await linkViews(repo, [updated]);
    res.json({ link: view });
  } catch (err) {
    next(err);
  }
});

router.delete('/links/:linkId', async (req, res, next) => {
  try {
    assertStaff(req.viewer);
    const repo = getRepo();
    const { link, ctx } = await readableLink(repo, req.viewer, req.params.linkId);
    if (!ctx.canEdit) throw fail(READ_ONLY, 403);
    await withLock(`links:${link.ownerId ?? null}`, () => repo.deleteTopicLink(link._id));
    res.json({ removed: true, message: 'The link was removed. No chain uses it any more.' });
  } catch (err) {
    next(err);
  }
});

export default router;
