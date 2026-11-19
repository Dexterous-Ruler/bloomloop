// Phase 3 - the classroom projector, under /api/session/:code/projector
//
//   projector                   GET, PATCH   what the wall shows; change it
//   projector/links             POST         make a link (its token is in this reply only)
//   projector/links/:linkId     DELETE       revoke a link; its projectors are told and dropped
//
// The projector itself never calls these: it connects over the socket with its
// link's token (projector:watch, services/projector.js) and is sent projector:*
// events only. These are the professor's controls.
//
// Mounted at /api/session after the room router (app.js), with requireTeacher on
// every route rather than at the mount, as for the records: GET
// /api/session/:code is the phones' own route and stays open. Every path here
// is two segments or more.
//
// Who: the read rule (ownership.js) for GET, so an HOD may see what a
// department's projector shows; the write rule for everything else, so an HOD
// gets 403. A room the caller may not read is the same 404 as one that does not
// exist, word for word.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { servableFor } from '../services/selector.js';
import { sessionSettings } from '../services/mastery.js';
import {
  PROJECTOR_MODES,
  PROJECTOR_RULE,
  closeWall,
  linkView,
  newToken,
  projectorPayload,
  pushProjector,
  screenChangeFrom,
  screenOf,
  screenView,
  setScreen,
  tokenHash,
  toProjector,
  watchingCount,
} from '../services/projector.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

async function findRoom(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  return code ? getRepo().getSessionByCode(code) : null;
}

const readRoom = async (code, viewer) => assertCanRead(viewer, await findRoom(code), 'That room');
const writeRoom = async (code, viewer) => assertCanWrite(viewer, await findRoom(code), 'That room');

/** A closed room has no projector: its links stop working the moment it closes. */
function assertOpen(session) {
  if (session.status === 'closed') throw fail('That room is closed, so it has no projector.', 409);
}

/**
 * The professor's view of the wall: the screen as they set it (ids), exactly
 * what a projector is sent for it now (`shows`, through the same whitelist), how
 * many projectors are watching, and every link (never a token).
 */
async function projectorBody(req, session) {
  const repo = getRepo();
  const io = req.app.get('io');
  const [shows, links] = await Promise.all([projectorPayload(repo, session), repo.listProjectorLinks(session._id)]);
  return {
    room: { code: session.code, title: session.title ?? '', status: session.status },
    modes: PROJECTOR_MODES,
    screen: screenView(screenOf(session)),
    shows: toProjector('projector:state', shows),
    watching: watchingCount(io, session),
    links: links.map((link) => linkView(link)),
    rule: PROJECTOR_RULE,
  };
}

/** What the wall shows, and the room's links. Read rule. */
router.get('/:code/projector', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json(await projectorBody(req, session));
  } catch (err) {
    next(err);
  }
});

/**
 * Change what the wall shows: { mode?, question?, revealed?, diagram?,
 * showNames?, showCounts?, pick? } (services/projector.js screenChangeFrom);
 * question may be { classQuestionId } since Phase 5. Every projector
 * watching the room gets the new screen at once. 409, and nothing changed, for
 * a bank question's key (or that of a question asked aloud from the bank) in a
 * room whose phones may still be served it: anything but Teacher-led.
 */
router.patch('/:code/projector', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    assertOpen(session);
    const repo = getRepo();
    const body = req.body ?? {};
    const current = screenOf(session);
    const wantsQuestions = body.question?.questionId !== undefined || (body.diagram !== undefined && body.diagram !== null);
    // The tallies whenever the screen may end up on one: a key the professor
    // reveals is checked against where the tally's question came from.
    const wantsTallies = body.question?.tallyId !== undefined || (body.question === undefined && current.question?.source === 'tally');
    // A class question of this room (Phase 5), when the screen is to show one.
    const wantsClass = body.question?.classQuestionId !== undefined;
    const [servable, tallies, picks, classQuestions] = await Promise.all([
      wantsQuestions ? repo.listQuestions(session.contentId).then((qs) => servableFor(session, qs)) : [],
      wantsTallies ? repo.listTallies(session._id) : [],
      body.pick ? repo.listWheelPicks(session._id) : [],
      wantsClass ? repo.listClassQuestions(session._id) : [],
    ]);
    const { mode } = sessionSettings(session);
    setScreen(session, screenChangeFrom(body, current, { servable, tallies, picks, classQuestions, mode }));
    await pushProjector(req.app.get('io'), repo, session);
    res.json(await projectorBody(req, session));
  } catch (err) {
    next(err);
  }
});

/**
 * Make a projector link: 201 { token, link, ... }. The token is in this reply
 * and nowhere else, ever: only its hash is stored. The professor opens the
 * projector page with it on the classroom machine. It works for
 * PROJECTOR_LINK_HOURS (`link.expiresAt`). Refused for a closed room.
 */
router.post('/:code/projector/links', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    assertOpen(session);
    const token = newToken();
    const link = await getRepo().addProjectorLink({
      sessionId: String(session._id),
      tokenHash: tokenHash(token),
      createdAt: new Date().toISOString(),
      createdBy: req.viewer?.id ?? null,
    });
    res.status(201).json({ token, link: linkView(link), ...(await projectorBody(req, session)) });
  } catch (err) {
    next(err);
  }
});

/**
 * Revoke a link. Its projectors are told (projector:closed) and get nothing
 * more; the link is kept, revoked, so the room can say which links were made.
 * Revoking a revoked link changes nothing. Allowed on a closed room, where it is
 * already dead.
 */
router.delete('/:code/projector/links/:linkId', requireTeacher, async (req, res, next) => {
  try {
    const session = await writeRoom(req.params.code, req.viewer);
    const repo = getRepo();
    const wanted = String(req.params.linkId ?? '').trim().toLowerCase();
    const link = (await repo.listProjectorLinks(session._id)).find((l) => String(l._id).toLowerCase() === wanted);
    if (!link) throw fail('That projector link was not found.', 404);
    const revoked = link.revokedAt
      ? link
      : ((await repo.revokeProjectorLink(link._id, { revokedAt: new Date().toISOString(), revokedBy: req.viewer?.id ?? null })) ?? link);
    closeWall(req.app.get('io'), { session, linkId: link._id, reason: 'This projector link was turned off.' });
    res.json({ link: linkView(revoked), ...(await projectorBody(req, session)) });
  } catch (err) {
    next(err);
  }
});

export default router;
