// Phase 5 - how many students chose each option linked to a misunderstanding.
//
//   GET /api/session/:code/misconceptions            one room (read rule)
//   GET /api/classes/:id/misconceptions?from=&to=&rooms=
//                                                    one class's rooms (read rule)
//
// and, in routes/bank.js, one question across its chapter's rooms and the route
// that adds, edits, confirms and clears the labels themselves.
//
// The counting is services/misconceptions.js (pure) with its readers in
// services/itemStats.js, beside the item report these counts belong to: each
// student's counted answer, the question's current label for the option they
// chose, matched by the option's words in the question as they saw it. Counts of
// students, never names, and never ordered by any student's score.
//
// Staff-only, all of it: requireTeacher on the room route (GET /api/session/:code,
// one segment, is the phones' and stays open, so the gate is per route) and at
// the class mount. Ownership follows the room and the class (ownership.js): the
// owner and their HOD read; anyone else, and a code or id that names nothing,
// the same 404 word for word. Nothing here reaches a phone or the projector.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanRead, readable } from '../ownership.js';
import { readableClass } from './classes.js';
import { roomsWindow } from '../services/attainment.js';
import { classMisconceptions, roomMisconceptions } from '../services/itemStats.js';

const roomRoutes = express.Router();

async function readRoom(rawCode, viewer) {
  const code = String(rawCode ?? '').trim().toUpperCase();
  const session = code ? await getRepo().getSessionByCode(code) : null;
  return assertCanRead(viewer, session, 'That room');
}

const roomOf = (r) => ({ code: r.code, title: r.title ?? '', status: r.status, startedAt: r.startedAt ?? null });

/**
 * Every labelled question answered in the room, and every labelled question of
 * its set, with how many students chose each labelled option.
 */
roomRoutes.get('/:code/misconceptions', requireTeacher, async (req, res, next) => {
  try {
    const session = await readRoom(req.params.code, req.viewer);
    res.json({ room: roomOf(session), ...(await roomMisconceptions(getRepo(), session)) });
  } catch (err) {
    next(err);
  }
});

export const classMisconceptionRoutes = express.Router();

/**
 * The class's rooms the caller may read, narrowed by ?from=&to=&rooms= as the
 * attainment reports narrow them (roomsWindow): a student is a roll number
 * across them. The class's 404 is checked before the query, so an outsider
 * learns nothing from a 400.
 */
classMisconceptionRoutes.get('/:id/misconceptions', async (req, res, next) => {
  try {
    const cls = await readableClass(req.params.id, req.viewer);
    const all = await readable(req.viewer, await getRepo().listSessionsForClass(cls._id));
    const { rooms, window } = roomsWindow(req.query, all);
    res.json({
      class: { id: String(cls._id), courseName: cls.courseName, section: cls.section, termLabel: cls.termLabel ?? '' },
      window,
      rooms: rooms.map(roomOf),
      ...(await classMisconceptions(getRepo(), rooms)),
    });
  } catch (err) {
    next(err);
  }
});

export default roomRoutes;
