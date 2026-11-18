// Phase 3 - GET /api/dashboard.
//
// One route, three shapes. The viewer's role picks the shape and the viewer's
// scope picks the rows; the browser sends nothing but its token and cannot ask
// for somebody else's dashboard, because there is no parameter to ask with.
//
// That is the whole point of doing it this way. An /api/dashboard?professor=<id>
// would need its own authorization check, and the one it would need is exactly
// the check scopeFor() already performs - so the id never crosses the wire.

import { Router } from 'express';

import { requireAuth, requireTeacher } from '../auth.js';
import { dashboardFor } from '../services/dashboard.js';

const router = Router();

/**
 * An account if there is one, the shared teacher key if there is not.
 *
 * The fallback keeps the v1 demo console alive on a build with no Supabase auth
 * configured: requireTeacher sets a professor viewer with a null id, which
 * scopeFor() resolves to "the rows nobody owns". It grants nothing new - anyone
 * holding the key already has teacher access to those rows.
 */
function viewerOrKey(req, res, next) {
  requireAuth(req, res, (err) => {
    if (!err) return next();
    requireTeacher(req, res, next);
  });
}

router.get('/', viewerOrKey, async (req, res, next) => {
  try {
    res.json(await dashboardFor(req.viewer));
  } catch (err) {
    next(err);
  }
});

export default router;
