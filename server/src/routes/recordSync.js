// Phase 7 - replay keys on the teacher-record writes (gap F1, decision O1 on the
// staff side), under /api/session/:code/...
//
// The console keeps the records a professor makes while the network is down in
// an outbox and sends them again, in order, when it reconnects. A write can then
// arrive twice (a reply lost on the way back, a retry after a timeout), and a
// tally step or a new activity applied twice is a wrong count or a second row.
// So each queued write carries a key (the Idempotency-Key header, a UUID the
// console made for it), and this router, mounted ahead of the routers that do
// the writes, answers a key it has met before with the reply it kept, and
// changes nothing.
//
//   no key     next('route'): the request goes on to its own router untouched,
//              exactly as before this file existed.
//   a key      the same checks as the write itself (teacher, the room's write
//              rule: the one 404 for "not there" and "not yours", 403 for an
//              HOD), then, under a lock of its own for that key:
//                kept, same details   the kept reply, with Idempotent-Replayed
//                kept, other details  409, and nothing is done
//                not kept             the write runs in its own router; a
//                                     success is kept under the key before it
//                                     is answered, so a reply the console saw
//                                     is always one a retry will find
//
// A refusal (a 400, a 404, a stale write's 409) is not kept: the same write sent
// again is checked again, against the room as it is then.
//
// The kept reply is the whole first reply, as the phone's answerId gives back
// the stored result. A replay therefore shows the room as the write left it,
// not as it is now: the console chains the next queued write's basedOn from the
// stamps in it (services/recordSync.js), and a stamp read afresh could carry
// another device's newer change into that chain and let it be overwritten
// unseen. The console reads the room again once its outbox has drained.
//
// No batch route: the console sends its outbox one write at a time. Each write
// takes the room's locks and keeps its key on its own; a batch would need a
// second way into every write, and one long request on a weak network is less
// likely to get through than a few short ones.
//
// One gap, said plainly: a write done whose reply could not then be built (the
// store failing on the read after the write) answers 500 and keeps no key, so a
// retry would do it again. It is the same window every route has today.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { assertCanWrite } from '../ownership.js';
import { lockProfile } from '../sockets/index.js';
import { KEY_HEADER, KEY_REUSED, REPLAYED_HEADER, bodyHash, writeKeyFrom, writerOf } from '../services/recordSync.js';

const router = express.Router();

const fail = (message, status) => Object.assign(new Error(message), { status });
const ok = (status) => status >= 200 && status < 300;

/** Only a write carrying a key is this router's business. */
const carriesKey = (req, _res, next) => next(req.get(KEY_HEADER) === undefined ? 'route' : undefined);

/** A release that may be called from more than one place, and acts once. */
function once(release) {
  let done = false;
  return () => {
    if (!done) { done = true; release(); }
  };
}

/**
 * The key layer for one write route. `route` names it in the key's row;
 * `param` is the path's record id, if any.
 */
function replaySafe({ route, param = null }) {
  return async (req, res, next) => {
    try {
      const repo = getRepo();
      const code = String(req.params.code ?? '').trim().toUpperCase();
      const session = await assertCanWrite(req.viewer, code ? await repo.getSessionByCode(code) : null, 'That room');
      const key = writeKeyFrom(req.get(KEY_HEADER));
      const writer = writerOf(req.viewer);
      const sessionId = String(session._id);
      const target = param ? String(req.params[param] ?? '').trim().toLowerCase() : '';
      const hash = bodyHash(route, target, req.body);

      // One key at a time: a retry arriving while the first try is still being
      // written waits for it, then finds its reply. Other keys go on.
      // '#' is outside a roll number's shape, so this is never a student's lock.
      // Not let go when the console hangs up: the write goes on, and a retry
      // must wait for it rather than run beside it.
      const release = once(await lockProfile(sessionId, `#write:${writer}:${key}`));
      res.on('finish', release);
      let held;
      try {
        held = await repo.getRecordWrite({ sessionId, writer, key });
      } catch (err) {
        release();
        throw err;
      }
      if (held) {
        release();
        if (held.bodyHash !== hash) throw fail(KEY_REUSED, 409);
        return res.status(held.status).set(REPLAYED_HEADER, 'true').json(held.reply);
      }

      // Every answer this request gets goes through res.json, the error
      // handler's included, so this is where the key is kept and let go.
      const send = res.json.bind(res);
      res.json = (body) => {
        res.json = send;
        if (!ok(res.statusCode)) {
          release();
          return send(body);
        }
        (async () => {
          try {
            await repo.addRecordWrite({ sessionId, writer, key, route, target, bodyHash: hash, status: res.statusCode, reply: body });
          } catch (err) {
            // The write is done; say so. Only a later replay of it is unprotected.
            console.error(`[record-writes] the replay key of a ${route} write could not be kept:`, err);
          }
          release();
          send(body);
        })();
        return res;
      };
      next();
    } catch (err) {
      next(err);
    }
  };
}

// Every write of the teacher-record store and attendance. The paths are the
// write routers' own (routes/session.js, routes/records.js).
const WRITES = [
  ['post', '/:code/attendance', { route: 'attendance' }],
  ['post', '/:code/observations', { route: 'observation' }],
  ['patch', '/:code/wheel', { route: 'wheel-settings' }],
  ['post', '/:code/wheel/draw', { route: 'wheel-draw' }],
  ['post', '/:code/wheel/rounds', { route: 'wheel-round' }],
  ['patch', '/:code/wheel/picks/:pickId', { route: 'wheel-pick', param: 'pickId' }],
  ['post', '/:code/tallies', { route: 'tally' }],
  ['patch', '/:code/tallies/:tallyId', { route: 'tally-edit', param: 'tallyId' }],
  ['post', '/:code/tallies/:tallyId/increment', { route: 'tally-increment', param: 'tallyId' }],
  ['post', '/:code/tallies/:tallyId/decrement', { route: 'tally-decrement', param: 'tallyId' }],
  ['post', '/:code/activities', { route: 'activity' }],
  ['patch', '/:code/activities/:activityId', { route: 'activity-edit', param: 'activityId' }],
  ['post', '/:code/insights/actions', { route: 'insight-action' }],
];

for (const [method, path, options] of WRITES) {
  router[method](path, carriesKey, requireTeacher, replaySafe(options));
}

export default router;
