// Batch 8 - suggestions for the live room (docs/UI_ZIP_AUDIT.md L1 and C2),
// under /api/session/:code/...
//
//   teaching-moves                       GET   every suggestion kept in the room, oldest first, each with
//                                              the activities recorded from it, and whether the model is ready
//   teaching-moves                       POST  { kind?, topic? } ask for one, on the professor's button:
//                                              202 with a request to follow, or 200 and a plain sentence
//                                              when the server has no model (nothing is made up)
//   teaching-moves/requests/:requestId   GET   that request: running, done (with the suggestion) or failed
//
// No kind: a two-minute, no-device move aimed at the level where the class is
// stuck (L1), which needs graded answers. A kind (check, think, group, diagram,
// real): that activity's prompt written for the chapter (C2), which does not.
// "Another idea" is the same press again; "Use it" is the activities route with
// the suggestion's id (routes/records.js). The finished suggestion is also
// pushed to the room's teacher screens as `teacher:teaching-move`.
//
// Mounted at /api/session after the room router (app.js), requireTeacher on
// every route, as the records routes are: GET /api/session/:code (one segment)
// is the phones' and stays open. Reads follow the read rule (an HOD reads the
// department's rooms); the press follows the write rule (an HOD gets 403). A
// room the caller may not read is the same 404 as one that does not exist.
// Staff only: nothing here reaches a phone or the projector.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, assertCanWrite } from '../ownership.js';
import { ACTIVITY_KINDS } from '../services/records.js';
import {
  AI_LABEL, OFFLINE_MESSAGE, STAFF_NOTE, modelReady, moveInput, moveKindFrom, moveRequest, moveView, startMove,
} from '../services/teachingMoves.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });

async function findRoom(rawCode) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  return code ? getRepo().getSessionByCode(code) : null;
}

const ownerKey = (req) => String(req.viewer?.id ?? 'shared-key');

/** Every suggestion of the room, with the ids of the activities run from each. */
async function roomMoves(session) {
  const repo = getRepo();
  const [moves, activities] = await Promise.all([repo.listTeachingMoves(session._id), repo.listActivities(session._id)]);
  const used = new Map();
  for (const a of activities) {
    if (!a.suggestionId) continue;
    const k = String(a.suggestionId).toLowerCase();
    used.set(k, [...(used.get(k) ?? []), String(a._id)]);
  }
  return moves.map((m) => moveView(m, { used: used.get(String(m._id).toLowerCase()) ?? [] }));
}

router.get('/:code/teaching-moves', requireTeacher, async (req, res, next) => {
  try {
    const session = await assertCanRead(req.viewer, await findRoom(req.params.code), 'That room');
    res.json({
      room: { code: session.code, title: session.title ?? '', status: session.status },
      label: AI_LABEL,
      modelReady: modelReady(),
      ...(modelReady() ? {} : { offline: OFFLINE_MESSAGE }),
      kinds: ACTIVITY_KINDS,
      suggestions: await roomMoves(session),
      note: STAFF_NOTE,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/:code/teaching-moves', requireTeacher, async (req, res, next) => {
  try {
    const session = await assertCanWrite(req.viewer, await findRoom(req.params.code), 'That room');
    if (session.status === 'closed') throw fail('That room is closed: suggestions are for a class still running.', 409);
    const kind = moveKindFrom(req.body?.kind);
    // No model: said plainly, and nothing is asked or kept. Never a template
    // dressed up as a suggestion.
    if (!modelReady()) {
      res.json({ state: 'offline', suggestion: null, message: OFFLINE_MESSAGE, label: AI_LABEL });
      return;
    }
    const repo = getRepo();
    const input = await moveInput(repo, session, { kind, topic: req.body?.topic });
    const io = req.app.get('io');
    const started = startMove(repo, {
      session,
      input,
      askedBy: req.viewer?.id ?? null,
      ownerKey: ownerKey(req),
      notify: (event) => io?.to(`teacher:${session.code}`).emit('teacher:teaching-move', {
        code: session.code,
        requestId: event.requestId,
        state: event.state,
        suggestion: event.suggestion ?? null,
        message: event.message ?? null,
      }),
    });
    res.status(202).json({
      state: started.state,
      requestId: started.requestId,
      purpose: input.purpose,
      kind,
      topic: input.topic,
      basis: input.basis,
      label: AI_LABEL,
      note: 'The suggestion is being written from this room\'s counts and the chapter\'s own material. It arrives here when ready.',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:code/teaching-moves/requests/:requestId', requireTeacher, async (req, res, next) => {
  try {
    const session = await assertCanRead(req.viewer, await findRoom(req.params.code), 'That room');
    const r = moveRequest(req.params.requestId, { ownerKey: ownerKey(req), sessionId: String(session._id) });
    // One 404 for "no such request" and "not yours".
    if (!r) throw fail('That request was not found. Its suggestion, if one was made, is in the room\'s list.', 404);
    const kept = r.suggestionId ? await getRepo().getTeachingMove(r.suggestionId) : null;
    res.json({ ...r, suggestion: kept ? moveView(kept) : null, label: AI_LABEL });
  } catch (err) {
    next(err);
  }
});

export default router;
