// Phase 3 - live insights and the student card, under /api/session/:code/...
//
//   insights                 GET  every student's band, the sort orders, the three
//                                 insight cards, the KPI tiles with their change
//                                 since the start, the series for sparklines, and
//                                 a Mixed or Teacher-led room's teacher records
//   students/:roll/card      GET  one student: band, level being served, accuracy
//                                 per level, last ten answers, the planned next
//                                 set, and this room's teacher records about them
//
// The same body as `insights` is pushed to the room's teacher screens as
// `teacher:insights` (services/insights.js scheduleInsights), never to a phone
// or the projector.
//
// Mounted at /api/session after the room and records routers (app.js), with
// requireTeacher on every route rather than at the mount, because
// GET /api/session/:code (one segment) is the phones' and stays open. Read rule
// (ownership.js): an HOD reads the department's rooms. A room the caller may not
// read is the same 404 as one that does not exist, word for word. Dismissing or
// acting on a card is POST /:code/insights/actions (routes/records.js).

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead } from '../ownership.js';
import { roomInsights, studentCard } from '../services/insights.js';

const router = express.Router();

/** A room the caller may read, or the one 404 for "not there" and "not yours". */
async function readRoom(rawCode, viewer) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return assertCanRead(viewer, session, 'That room');
}

router.get('/:code/insights', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json(await roomInsights(getRepo(), session));
  } catch (err) {
    next(err);
  }
});

/**
 * One student's card. `:roll` is the roll number as typed (encode it: a roll
 * number may hold a space or a '/'), matched the way the room stores it. A roll
 * number neither joined to the room nor on its class's roster is
 * `That student was not found.` (404), after the room's own 404.
 */
router.get('/:code/students/:roll/card', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json(await studentCard(getRepo(), session, req.params.roll));
  } catch (err) {
    next(err);
  }
});

export default router;
