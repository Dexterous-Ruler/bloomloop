// GET /api/analytics                the list this viewer may analyse
// GET /api/analytics/:id            one of them, in full; ?order=accuracy lists a
//                                   professor's students highest accuracy first
//                                   (roll order otherwise)
// GET /api/analytics/:id/answers    one student's actual answers across rooms,
//                                   ?limit=&offset=&topic=&level=&code=
//
// The role picks the shape and the scope picks the rows. The id in the last two
// routes is checked against the viewer's own subject list, and anything outside
// it answers 404 - the same as an id that does not exist, so the route cannot be
// walked to find out who else is in the database.

import { Router } from 'express';

import { requireAuth, requireTeacher } from '../auth.js';
import { analyticsOverview, analyticsFor, answersFor } from '../services/analytics.js';

const router = Router();

/** An account if there is one, the shared key otherwise - as /api/dashboard. */
function viewerOrKey(req, res, next) {
  requireAuth(req, res, (err) => {
    if (!err) return next();
    requireTeacher(req, res, next);
  });
}

router.get('/', viewerOrKey, async (req, res, next) => {
  try {
    res.json(await analyticsOverview(req.viewer));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', viewerOrKey, async (req, res, next) => {
  try {
    res.json(await analyticsFor(req.viewer, req.params.id, req.query));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/answers', viewerOrKey, async (req, res, next) => {
  try {
    res.json(await answersFor(req.viewer, req.params.id, req.query));
  } catch (err) {
    next(err);
  }
});

export default router;
