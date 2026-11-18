// F4 - the room. Opening a session, reading it back, and the teacher grid.
//
// `buildGridRow` is exported and is also what ../sockets/index.js broadcasts,
// so the REST grid and the live grid are one code path and cannot drift. That
// is also why this file and the socket file import each other: they are two
// halves of one feature, and the online-presence map has exactly one owner
// (the socket file, which is the only place that learns a socket has dropped).

import express from 'express';
import crypto from 'node:crypto';

import { LEVELS } from '../bloom.js';
import { getRepo } from '../repo/index.js';
import {
  hydrate,
  isSlowLearner,
  totals,
  countedTotals,
  masteredLevels,
  sessionSettings,
  MASTERY_GOALS,
  MAX_REATTEMPTS,
  DEFAULT_MASTERY_GOAL,
  REDEMPTION_RULE,
} from '../services/mastery.js';
import { summarise, HONESTY } from '../services/integrity.js';
import { ARCHIVE_LIMIT_BYTES, buildRoomArchive } from '../services/archive.js';
import { answerItem, pageFrom, rollKey, roomTopics } from '../services/evidence.js';
import { roomItemStats } from '../services/itemStats.js';
import { roomQuestionIds, servableFor } from '../services/selector.js';
import { isRecordId } from '../ids.js';
// The v2 guard, not the v1 key-only one: a professor who signed in properly
// carries a bearer token and no shared key, and the v1 guard 401s her out of
// the console she was just routed to.
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite, canWrite, readable } from '../ownership.js';
import { isOnline, releaseSession, holdRoomForDelete } from '../sockets/index.js';

const router = express.Router();

// No O/0 and no I/1/L. The code is read off a projector at the back of a hall
// and retyped on a phone keyboard; those are the characters students confuse.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 40;

// Under this the adaptive loop has nothing to choose between - the first
// student would empty the bank before the teacher finished talking.
const MIN_BANK = 6;

// A question set is picked by hand, one question at a time; a list longer than
// this is not a pick, it is the bank, and leaving questionIds out says that.
const MAX_SET = 500;

// Ids are uuids on Supabase and 24-char hex on Mongo / in-process; isRecordId
// accepts either. Checking the shape turns a database cast error into an
// honest 400.


const fail = (message, status) => Object.assign(new Error(message), { status });

/**
 * The one and only GridRow builder (CONTRACT section 4). `profile` may be a raw
 * repo document; it is hydrated here so a half-written profile still renders.
 */
export function buildGridRow(profile, { online = false, goal = DEFAULT_MASTERY_GOAL } = {}) {
  const p = hydrate(profile);
  const counted = countedTotals(p);
  const raw = totals(p);
  return {
    rollNo: p.rollNo,
    name: p.name,
    workingLevel: p.workingLevel,
    reason: p.reason,
    slowLearner: isSlowLearner(p),
    levels: p.levels,
    total: raw,
    answered: p.history.length,
    online: Boolean(online),
    // A summary, never the raw event list: the grid is glanceable and the detail
    // belongs on the student panel where there is room for the caveats.
    integrity: summarise(p),

    // Phase 7. `total` above stays the raw record, because that is what every
    // screen already reads and what the export archives. These say what
    // redemption did to it - and they say it as a NUMBER OF ANSWERS rather than
    // as an adjusted percentage, because "6 of 10, and 3 early misses set aside"
    // is a sentence a teacher can repeat to a student, whereas a percentage that
    // silently moved is the thing this feature exists not to be.
    //
    // In a room without redemption `counted` is `total`, exactly, and
    // `withdrawn` is 0 - there is no second code path to disagree with the first.
    counted,
    withdrawn: raw.seen - counted.seen,
    // Levels this student has met the room's goal at. Not the ladder: a student
    // can be working above a level they have not mastered, and the grid showing
    // both is how a teacher sees who is being carried by the cushion level.
    mastered: masteredLevels(p, goal),
    masteryGoal: goal,
  };
}

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/** Keep drawing codes until one is free. 31^6 codes, so this almost never loops. */
async function allocateCode(repo) {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = randomCode();
    if (!(await repo.getSessionByCode(code))) return code;
  }
  throw fail('Could not allocate a free room code - close some old sessions.', 500);
}

async function requireSession(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  if (!code) throw fail('Room code is required', 400);
  const session = await getRepo().getSessionByCode(code);
  if (!session) throw fail(`No session with code ${code}`, 404);
  return session;
}

async function gridFor(session) {
  const profiles = await getRepo().listProfiles(session._id);
  const { masteryGoal } = sessionSettings(session);
  return profiles.map((p) =>
    buildGridRow(p, { online: isOnline(session.code, p.rollNo), goal: masteryGoal }));
}

/**
 * The three settings, off the request body, or an honest 400.
 *
 * Rejected rather than clamped. A teacher who sends 95% has a number in their
 * head that this product does not offer, and quietly running their class at 90%
 * while the screen agrees with them is the failure that only shows up weeks
 * later in a mark nobody can account for. The same goes for three retries: the
 * cap exists for a reason, and silently honouring two of the three would produce
 * a room that does not do what it was asked to do.
 */
function settingsFrom(body = {}) {
  const out = { masteryGoal: DEFAULT_MASTERY_GOAL, reattempts: 0, redemption: false };

  if (body.masteryGoal !== undefined && body.masteryGoal !== null) {
    const goal = Number(body.masteryGoal);
    if (!MASTERY_GOALS.includes(goal)) {
      throw fail(
        `masteryGoal must be one of ${MASTERY_GOALS.map((g) => `${g * 100}%`).join(', ')}.`,
        400,
      );
    }
    out.masteryGoal = goal;
  }

  if (body.reattempts !== undefined && body.reattempts !== null) {
    const tries = Number(body.reattempts);
    if (!Number.isInteger(tries) || tries < 0 || tries > MAX_REATTEMPTS) {
      throw fail(`reattempts must be a whole number from 0 to ${MAX_REATTEMPTS}.`, 400);
    }
    out.reattempts = tries;
  }

  if (body.redemption !== undefined && body.redemption !== null) {
    if (typeof body.redemption !== 'boolean') throw fail('redemption must be true or false.', 400);
    out.redemption = body.redemption;
  }

  return out;
}

/**
 * The room's question set, from a `questionIds` the caller did send (left out
 * or null means the whole approved bank, and never reaches here). Every id must
 * be an ACTIVE question of this chapter, or an honest 400.
 *
 * A draft, a rejected question, another chapter's question, another teacher's
 * and an id that names nothing are refused in one sentence, so a set cannot be
 * used to ask which ids exist. Stored as the bank spells the ids, each once, in
 * the order given.
 *
 * No MIN_BANK floor here: that floor protects a room from a bank too thin to
 * adapt over, and a professor who picks two questions has decided the room is
 * those two.
 */
function questionSetFrom(raw, bank, title) {
  if (!Array.isArray(raw)) {
    throw fail('questionIds must be a list of question ids, or left out to use every approved question.', 400);
  }
  if (!raw.length) {
    throw fail('questionIds is empty. Pick at least one question, or leave questionIds out to use every approved question.', 400);
  }
  // Any case: a uuid may be typed either way. A non-string is no id at all.
  const ids = [...new Set(raw.map((id) => (typeof id === 'string' ? id.trim().toLowerCase() : '')))];
  if (ids.length > MAX_SET) throw fail(`questionIds names ${ids.length} questions; ${MAX_SET} is the most a set may hold.`, 400);
  const approved = new Map(bank.filter((q) => (q.status ?? 'active') === 'active')
    .map((q) => [String(q._id).toLowerCase(), String(q._id)]));
  const outside = ids.filter((id) => !approved.has(id));
  if (outside.length) {
    throw fail(
      `${outside.length} of the ${ids.length} questions picked ${outside.length === 1 ? 'is' : 'are'} not an approved question of "${title}". `
        + 'A room may only use approved questions of its own chapter: approve them in the question bank first, or leave them out.',
      400,
    );
  }
  return ids.map((id) => approved.get(id));
}

router.post('/', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const contentId = String(req.body?.contentId ?? '').trim();
    if (!contentId) throw fail('contentId is required', 400);
    if (!isRecordId(contentId)) throw fail('contentId is not a valid id', 400);

    const content = await repo.getContent(contentId);
    // You may only open a room over material you are allowed to touch.
    await assertCanWrite(req.viewer, content, 'That content');

    // Checked before the bank floor, and before a code is drawn, so a bad set is
    // a 400 that names the set rather than the size of the bank.
    const asked = req.body?.questionIds;
    const questionIds = asked === undefined || asked === null
      ? null
      : questionSetFrom(asked, await repo.listQuestions(contentId), content.title);

    const bankCount = questionIds ? questionIds.length : await repo.countQuestions(contentId);
    if (!questionIds && bankCount < MIN_BANK) {
      // A room serves approved questions only. A bank that is mostly drafts has
      // questions, just none a professor has let in yet - "generate first" would
      // send them to make a second bank and replace the one waiting for review.
      const drafts = await repo.countQuestions(contentId, { status: 'draft' });
      if (drafts > 0) {
        throw fail(
          `"${content.title}" has ${drafts} generated question${drafts === 1 ? '' : 's'} waiting for your approval ` +
            `and ${bankCount} approved. A room serves approved questions only and needs at least ${MIN_BANK}: ` +
            'approve them in the question bank first.',
          409,
        );
      }
      throw fail(
        `Only ${bankCount} active question${bankCount === 1 ? '' : 's'} in the bank for "${content.title}". ` +
          `Generate questions first - a session needs at least ${MIN_BANK}.`,
        400,
      );
    }

    const code = await allocateCode(repo);
    const title = String(req.body?.title ?? '').trim() || content.title;
    // Validated before the code is spent. A 400 after allocateCode() would burn
    // a room code on a request that never opened a room.
    const settings = settingsFrom(req.body);
    const session = await repo.createSession({
      code,
      contentId,
      title,
      status: 'open',
      ownerId: req.viewer?.id ?? null,
      ...settings,
      questionIds,
    });

    // Read back off the stored row rather than echoed from the request, so the
    // screen shows what the room will actually run under. If a store ever drops
    // one of these on write - which is precisely what an undeclared Mongoose
    // path does - the teacher sees it here instead of finding out from a mark.
    res.json({
      code: session.code,
      sessionId: String(session._id),
      bankCount,
      settings: sessionSettings(session),
      questionIds: session.questionIds ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Deleted rooms, newest first: who, when and how big, without the data. Only
 * archives of rooms the caller could read are listed, by the same ownership
 * rule as live rooms, so a professor never sees another professor's.
 *
 * Declared before GET /:code, which would otherwise take "archives" as a code.
 */
router.get('/archives', requireTeacher, async (req, res, next) => {
  try {
    const archives = await readable(req.viewer, await getRepo().listRoomArchives());
    res.json({ archives, limitBytes: ARCHIVE_LIMIT_BYTES });
  } catch (err) {
    next(err);
  }
});

/** One deleted room as its JSON file. Same answer for "not yours" and "not there". */
router.get('/archives/:id', requireTeacher, async (req, res, next) => {
  try {
    const id = String(req.params.id ?? '');
    const archive = isRecordId(id) ? await getRepo().getRoomArchive(id) : null;
    await assertCanRead(req.viewer, archive, 'That archive');
    const day = String(archive.archivedAt ?? '').slice(0, 10) || 'undated';
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bloomloop-${archive.code}-archive-${day}.json"`);
    res.send(JSON.stringify(archive.data));
  } catch (err) {
    next(err);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const repo = getRepo();
    const session = await requireSession(req.params.code);
    // What this room serves: its set's approved questions when it has a set,
    // the same number the phone is told on joining. The set itself stays off
    // this route: it is open to anyone holding the code, and a list of question
    // ids is a list of things to try answering.
    const [content, bankCount, profiles] = await Promise.all([
      repo.getContent(session.contentId),
      roomQuestionIds(session)
        ? repo.listQuestions(session.contentId).then((qs) => servableFor(session, qs).length)
        : repo.countQuestions(session.contentId),
      repo.listProfiles(session._id),
    ]);
    // Deliberately NOT the raw session document. It carries contentId, which is
    // the only thing standing between a student on the hotspot and
    // GET /api/bank/<contentId> - the whole answer key. Students legitimately
    // need this route, so it returns the minimum that is safe to publish.
    res.json({
      session: {
        code: session.code,
        title: session.title ?? '',
        status: session.status,
        startedAt: session.startedAt,
        closedAt: session.closedAt ?? null,
        // Safe to publish, and it has to be: these three change what a student's
        // answers are worth, and a rule a student is measured under but not told
        // is the version of this feature that cannot be defended. The rest of
        // the document still stays behind - contentId in particular, which is
        // the whole answer key.
        settings: sessionSettings(session),
      },
      // The rule in the words the student will be shown, travelling with the
      // setting it describes so no screen can display the one without the other.
      redemptionRule: REDEMPTION_RULE,
      content: { title: content?.title ?? session.title ?? '' },
      bankCount,
      studentCount: profiles.length,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:code/grid', requireTeacher, async (req, res, next) => {
  try {
    const session = await requireSession(req.params.code);
    // An HOD may read any session in their department; a professor only theirs.
    await assertCanRead(req.viewer, session, 'That session');
    res.json({ rows: await gridFor(session), levels: LEVELS });
  } catch (err) {
    next(err);
  }
});

/**
 * A room this viewer may read, by code. "No such code" and "not a room you may
 * read" are one 404 with one message, so a code cannot be probed by comparing
 * replies (requireSession names the code, which is why it is not used here).
 */
async function readableRoom(rawCode, viewer) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return assertCanRead(viewer, session, 'That room');
}

/*
 * The room's evidence, for teachers. Both routes are two segments deep, so
 * GET /:code (one segment, and open to students) can never answer them; and a
 * room code is six characters, so it can never be "archives" and fall into
 * /archives/:id, which is declared earlier.
 */

/**
 * Every stored attempt in the room, newest first, one page, each with the full
 * snapshot (answer key included) and the machine's reading beside the mark in
 * force. Final answers, retried attempts and polls alike: this is the record,
 * not a report. ?rollNo= narrows to one student, matched as the room stored it.
 */
router.get('/:code/answers', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    const { limit, offset } = pageFrom(req.query);
    const rollNo = rollKey(req.query.rollNo);

    const repo = getRepo();
    const rows = await repo.listAnswers({
      sessionId: session._id,
      ...(rollNo ? { rollNo } : {}),
      order: 'desc',
      limit: limit + 1,
      offset,
    });
    const names = new Map((await repo.listProfiles(session._id)).map((p) => [String(p.rollNo), p.name ?? '']));

    res.json({
      room: { code: session.code, title: session.title ?? '', startedAt: session.startedAt ?? null, status: session.status },
      rollNo: rollNo || null,
      items: rows.slice(0, limit).map((a) => answerItem(a, session, { name: names.get(String(a.rollNo)) ?? '' })),
      limit,
      offset,
      hasMore: rows.length > limit,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Per topic, per level: seen, correct and accuracy, and how many students each
 * topic covers. Final, graded answers only. A room run before the evidence store
 * existed is read from its profiles' history instead, and `source` says which
 * was used (services/evidence.js topicReport).
 */
router.get('/:code/topics', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    res.json({
      room: { code: session.code, title: session.title ?? '', startedAt: session.startedAt ?? null, status: session.status },
      ...(await roomTopics(getRepo(), session)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * How each question did in this room (services/itemStats.js): attempts,
 * proportion correct, how many chose each option, mean score, a band for the
 * class, the point-biserial against each student's other answers here, and its
 * flag. Every question answered in the room is listed, and every question of its
 * set, answered or not. Two segments deep, like /answers and /topics, with the
 * same read rule and the same 404.
 */
router.get('/:code/items', requireTeacher, async (req, res, next) => {
  try {
    const session = await readableRoom(req.params.code, req.viewer);
    res.json({
      room: { code: session.code, title: session.title ?? '', startedAt: session.startedAt ?? null, status: session.status },
      questionIds: session.questionIds ?? null,
      ...(await roomItemStats(getRepo(), session)),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Every room this viewer may see, newest first, for the management screen.
 *
 * Mounted at GET /api/session, which used to be nothing: rooms could be opened
 * and closed but never listed, so a teacher who lost the tab had no way back to
 * a room that was still running except to remember its code.
 */
router.get('/', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const rooms = await readable(req.viewer, await repo.listSessions());

    const rows = await Promise.all(
      rooms.map(async (session) => {
        const profiles = (await repo.listProfiles(session._id)).map(hydrate);
        let accSum = 0;
        let accN = 0;
        let banded = 0;
        let answered = 0;
        let withdrawn = 0;
        for (const profile of profiles) {
          const t = totals(profile);
          const c = countedTotals(profile);
          answered += t.seen;
          withdrawn += t.seen - c.seen;
          // The counted figure, so the accuracy this screen shows is the one the
          // room was actually run under. `answered` stays raw: it is a count of
          // work done, and redemption withdraws answers from an average, never
          // from the record of having given them.
          if (c.seen) { accSum += c.correct / c.seen; accN += 1; }
          if (isSlowLearner(profile)) banded += 1;
        }
        return {
          code: session.code,
          title: session.title ?? '',
          status: session.status,
          contentId: session.contentId,
          settings: sessionSettings(session),
          // The room's question set, or null for its whole approved bank.
          questionIds: session.questionIds ?? null,
          // Non-zero only in a room running redemption, and listed beside the
          // accuracy it moved so the two are never read apart.
          withdrawn,
          startedAt: session.startedAt ?? null,
          pausedAt: session.pausedAt ?? null,
          closedAt: session.closedAt ?? null,
          joined: profiles.length,
          online: profiles.filter((p) => isOnline(session.code, p.rollNo)).length,
          answered,
          banded,
          accuracy: accN ? accSum / accN : null,
          // An HOD sees the whole department's rooms but may not act on them,
          // so the buttons are driven by the same rule the routes enforce.
          canControl: await canWrite(req.viewer, session.ownerId ?? null),
        };
      }),
    );

    res.json({ rooms: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * Pause and resume. The distinction that matters: a paused room keeps every
 * student connected and every profile intact, and answering picks up exactly
 * where it stopped. Closing is final. Before this the only way to interrupt a
 * class was to end it.
 */
async function setPaused(req, res, next, paused) {
  try {
    const session = await requireSession(req.params.code);
    await assertCanWrite(req.viewer, session, 'That session');
    if (session.status === 'closed') throw fail('That room is closed - it cannot be reopened.', 409);

    const updated = await getRepo().updateSession(session._id, {
      status: paused ? 'paused' : 'open',
      pausedAt: paused ? new Date().toISOString() : null,
    });

    // The socket layer caches only OPEN sessions, so the cached copy has to go
    // either way: on pause so the loop stops serving, and on resume so the next
    // read picks up the new status rather than the stale paused one.
    releaseSession({ sessionId: session._id, code: session.code });

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${session.code}`).emit(paused ? 'session:paused' : 'session:resumed', {
        code: session.code,
      });
      // The teacher's own screens watch a different room; without this the Live
      // screen never learned the class had been paused from elsewhere.
      io.to(`teacher:${session.code}`).emit('teacher:status', {
        code: session.code,
        status: paused ? 'paused' : 'open',
      });
    }

    res.json({ session: updated ?? session });
  } catch (err) {
    next(err);
  }
}

router.post('/:code/pause', requireTeacher, (req, res, next) => setPaused(req, res, next, true));
router.post('/:code/resume', requireTeacher, (req, res, next) => setPaused(req, res, next, false));

/**
 * Delete a room, keeping everything recorded in it as a JSON archive.
 *
 * The room, its profiles and its answers leave the live tables, so it is gone
 * from every list and dashboard. Before any of that, the whole room is written
 * to one compact JSON document (services/archive.js) and the delete only goes
 * ahead once that write has succeeded: if the archive cannot be written, or
 * would be over the 1 MB ceiling, nothing is deleted.
 *
 * Still asks for ?confirm=CODE - the teacher types the room code back - because
 * the room does disappear from the live screens for good.
 */
router.delete('/:code', requireTeacher, async (req, res, next) => {
  try {
    const session = await requireSession(req.params.code);
    await assertCanWrite(req.viewer, session, 'That session');

    const typed = String(req.query.confirm ?? '').trim().toUpperCase();
    if (typed !== session.code) {
      throw fail(
        `Deleting ${session.code} removes it from your rooms; what was recorded in it is kept as a JSON archive. Send ?confirm=${session.code} to go ahead.`,
        400,
      );
    }

    const repo = getRepo();
    // Nothing may be written into the room between the archive reading it and
    // the delete removing it: a review or an answer landing there was answered
    // as saved and then lost for good. Held from here until the room is gone.
    let profiles = [];
    const lift = await holdRoomForDelete(session._id, async () => {
      profiles = await repo.listProfiles(session._id);
      return profiles.map((p) => p.rollNo);
    });
    let archive;
    try {
      // Archive first. A failure here throws before anything is deleted.
      const { doc, bytes } = await buildRoomArchive(repo, session, { archivedBy: req.viewer?.id ?? null });
      if (bytes > ARCHIVE_LIMIT_BYTES) {
        throw fail(
          `${session.code} was not deleted: its archive would be ${(bytes / (1024 * 1024)).toFixed(2)} MB, over the 1 MB limit. `
            + 'Nothing was changed. Export the results as CSV and close the room instead.',
          413,
        );
      }
      archive = await repo.saveRoomArchive(doc);
      await repo.deleteSession(session._id);
      releaseSession({ sessionId: session._id, code: session.code });
    } finally {
      lift();
    }

    const io = req.app.get('io');
    if (io) io.to(`session:${session.code}`).emit('session:closed', {});

    res.json({
      ok: true,
      code: session.code,
      deletedProfiles: profiles.length,
      archive: { id: archive._id, bytes: archive.bytes, archivedAt: archive.archivedAt },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * The full signal trail for one student, with the caveat attached.
 *
 * HONESTY travels with the payload rather than being written into the screen, so
 * every surface that shows these events shows the same limits alongside them and
 * none of them can quietly drop the qualification.
 */
router.get('/:code/integrity/:rollNo', requireTeacher, async (req, res, next) => {
  try {
    const session = await requireSession(req.params.code);
    await assertCanRead(req.viewer, session, 'That session');
    const stored = await getRepo().getProfile(session._id, String(req.params.rollNo));
    if (!stored) throw fail('No such student in this room.', 404);
    const profile = hydrate(stored);
    res.json({
      rollNo: profile.rollNo,
      name: profile.name,
      summary: summarise(profile),
      events: profile.integrity ?? [],
      honesty: HONESTY,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:code/close', requireTeacher, async (req, res, next) => {
  try {
    const session = await requireSession(req.params.code);
    // Ending someone else's live class is a write, and an HOD does not get it.
    await assertCanWrite(req.viewer, session, 'That session');
    const updated =
      session.status === 'closed'
        ? session
        : await getRepo().updateSession(session._id, {
            status: 'closed',
            closedAt: new Date().toISOString(),
          });

    // Drop the cached bank and session doc so the live loop stops serving items.
    releaseSession({ sessionId: session._id, code: session.code });

    const io = req.app.get('io');
    if (io) {
      io.to(`session:${session.code}`).emit('session:closed', {});
      io.to(`teacher:${session.code}`).emit('teacher:status', { code: session.code, status: 'closed' });
    }

    res.json({ session: updated ?? session });
  } catch (err) {
    next(err);
  }
});

export default router;
