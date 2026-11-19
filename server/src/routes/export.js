// F6 - the tier 1 hand-off. One GET: the teacher clicks Export and gets a sheet.
// Deliberately works on a closed session too, because the realistic moment for
// pulling the results is after the room is shut.
//
// The guard lives ON the route, not on the mount. It used to be a regex in
// app.js matching '/session/:code/export' case-sensitively, in front of an
// Express router that matches case-INsensitively - so GET /api/SESSION/x/EXPORT
// sailed past the guard and handed the whole class's results to anyone who
// could read the room code off the projector.

import { Router } from 'express';

import { getRepo } from '../repo/index.js';
import { profilesToCsv } from '../services/csv.js';
import { minorRolls } from '../services/roster.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead } from '../ownership.js';

const router = Router();

function fileStamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

router.get('/session/:code/export', requireTeacher, async (req, res, next) => {
  try {
    const code = String(req.params.code ?? '').trim().toUpperCase();
    const repo = getRepo();

    const session = await repo.getSessionByCode(code);
    await assertCanRead(req.viewer, session, `No session with code ${code}`);
    if (!session) {
      return next(Object.assign(new Error(`No session with code ${code}`), { status: 404 }));
    }

    // A content row that has been deleted must not cost the teacher their
    // results, so the title falls back to the session's own.
    const [content, profiles, roster, marks] = await Promise.all([
      Promise.resolve(repo.getContent(session.contentId)).catch(() => null),
      repo.listProfiles(session._id),
      session.classId ? repo.listClassStudents(session.classId) : [],
      session.classId ? repo.listAttendance(session._id) : [],
    ]);

    const csv = profilesToCsv(profiles, {
      sessionCode: session.code,
      contentTitle: session.title || content?.title || '',
      // Decision 8: no signal leaves the room for a student marked under 18.
      quiet: minorRolls(roster, marks),
    });

    // The code is [A-Z0-9] by construction, but it arrives from the URL, and a
    // quote or newline in a Content-Disposition header is a header-injection bug.
    const safeCode = code.replace(/[^A-Z0-9]/g, '') || 'SESSION';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bloomloop-${safeCode}-${fileStamp()}.csv"`,
    );
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

export default router;
