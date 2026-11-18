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
import { isRecordId } from '../ids.js';
// The v2 guard, not the v1 key-only one: a professor who signed in properly
// carries a bearer token and no shared key, and the v1 guard 401s her out of
// the console she was just routed to.
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite, canWrite, readable } from '../ownership.js';
import { isOnline, releaseSession } from '../sockets/index.js';

const router = express.Router();

// No O/0 and no I/1/L. The code is read off a projector at the back of a hall
// and retyped on a phone keyboard; those are the characters students confuse.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 40;

// Under this the adaptive loop has nothing to choose between - the first
// student would empty the bank before the teacher finished talking.
const MIN_BANK = 6;

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

router.post('/', requireTeacher, async (req, res, next) => {
  try {
    const repo = getRepo();
    const contentId = String(req.body?.contentId ?? '').trim();
    if (!contentId) throw fail('contentId is required', 400);
    if (!isRecordId(contentId)) throw fail('contentId is not a valid id', 400);

    const content = await repo.getContent(contentId);
    // You may only open a room over material you are allowed to touch.
    await assertCanWrite(req.viewer, content, 'That content');

    const bankCount = await repo.countQuestions(contentId);
    if (bankCount < MIN_BANK) {
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
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:code', async (req, res, next) => {
  try {
    const repo = getRepo();
    const session = await requireSession(req.params.code);
    const [content, bankCount, profiles] = await Promise.all([
      repo.getContent(session.contentId),
      repo.countQuestions(session.contentId),
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
    }

    res.json({ session: updated ?? session });
  } catch (err) {
    next(err);
  }
}

router.post('/:code/pause', requireTeacher, (req, res, next) => setPaused(req, res, next, true));
router.post('/:code/resume', requireTeacher, (req, res, next) => setPaused(req, res, next, false));

/**
 * Delete a room and everything recorded in it.
 *
 * Irreversible and it takes the students' results with it, so it demands
 * ?confirm=CODE - the teacher has to type the room code back. A single click
 * that silently destroys a class's marks is not a button worth having.
 */
router.delete('/:code', requireTeacher, async (req, res, next) => {
  try {
    const session = await requireSession(req.params.code);
    await assertCanWrite(req.viewer, session, 'That session');

    const typed = String(req.query.confirm ?? '').trim().toUpperCase();
    if (typed !== session.code) {
      throw fail(
        `Deleting ${session.code} also deletes every result recorded in it. Send ?confirm=${session.code} to go ahead.`,
        400,
      );
    }

    const profiles = await getRepo().listProfiles(session._id);
    await getRepo().deleteSession(session._id);
    releaseSession({ sessionId: session._id, code: session.code });

    const io = req.app.get('io');
    if (io) io.to(`session:${session.code}`).emit('session:closed', {});

    res.json({ ok: true, code: session.code, deletedProfiles: profiles.length });
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
    if (io) io.to(`session:${session.code}`).emit('session:closed', {});

    res.json({ session: updated ?? session });
  } catch (err) {
    next(err);
  }
});

export default router;
