// Phase 7 (decision O4): laptop mode's status, and room archives from laptop
// mode imported back into the cloud.
//
//   GET  /api/laptop          is this server a professor's laptop in laptop mode,
//                             and if so: where the room archives are saved, when
//                             last, the addresses phones join on, and what is not
//                             available here. { laptop: false } anywhere else.
//   POST /api/imports/rooms   one room archive saved by laptop mode, made into a
//                             closed room the caller owns (services/roomImport.js).
//   GET  /api/imports/rooms   the imports the caller may read, newest first,
//                             without the archives themselves.
//
// Staff only (requireTeacher: a professor's or HOD's token, or the shared
// teacher key, as every teacher route). An HOD reads the department's imports
// and imports nothing: an imported room is a room, and an HOD opens none.

import express from 'express';

import { getRepo } from '../repo/index.js';
import { requireTeacher } from '../auth.js';
import { readable } from '../ownership.js';
import { lockProfile } from '../sockets/index.js';
import { ARCHIVE_LIMIT_BYTES } from '../services/archive.js';
import { importRoomArchive, importView, NOTHING } from '../services/roomImport.js';
import { activeWriter } from '../services/laptopArchive.js';
import { laptopMode, lanAddresses, linksFor, UNAVAILABLE } from '../laptop.js';
import { allocateCode } from './session.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

// ------------------------------------------------------------ laptop mode --

export const laptopRoutes = express.Router();

laptopRoutes.get('/', requireTeacher, (_req, res) => {
  const mode = laptopMode();
  if (!mode) {
    res.json({ laptop: false });
    return;
  }
  res.json({
    laptop: true,
    run: mode.run,
    startedAt: mode.startedAt,
    // The folder is this laptop's own, shown to its own professor: it is where
    // the files to import are.
    archives: activeWriter()?.status() ?? { folder: mode.archiveDir, intervalSeconds: Math.round(mode.intervalMs / 1000) },
    join: lanAddresses().map((a) => ({ network: a.name, url: linksFor(a.address).join })),
    unavailable: UNAVAILABLE,
  });
});

// ----------------------------------------------------------- room imports --

export const importRoutes = express.Router();

// One import of one laptop room at a time in this process: the second waits and
// then finds the first's record (the store's unique laptop room id is the guard
// across processes). lockProfile is a keyed queue; this key is no room's.
const importLock = (key) => lockProfile('room-imports', key);

importRoutes.post('/', requireTeacher, async (req, res, next) => {
  try {
    if (req.viewer?.role === 'hod') {
      throw fail('An HOD can read the department\'s imported rooms but not import one: the professor who ran the class imports it.', 403);
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.archive === undefined || body.archive === null) {
      throw fail(`Choose the room file laptop mode saved, to import it. ${NOTHING}`, 400);
    }
    const { status, body: out } = await importRoomArchive(getRepo(), req.viewer, {
      archive: body.archive,
      contentId: body.contentId,
      classId: body.classId,
    }, { lock: importLock, drawCode: () => allocateCode(getRepo()) });
    res.status(status).json(out);
  } catch (err) {
    next(err);
  }
});

importRoutes.get('/', requireTeacher, async (req, res, next) => {
  try {
    const imports = await readable(req.viewer, await getRepo().listRoomImports());
    res.json({ imports: imports.map(importView), limitBytes: ARCHIVE_LIMIT_BYTES });
  } catch (err) {
    next(err);
  }
});

/**
 * A body the JSON parser refused on its way to an import: too large or not JSON.
 * Said as a sentence, as every other refusal of a file is. Any other error goes
 * on to the app's own handler.
 */
// eslint-disable-next-line no-unused-vars
export function importBodyRefused(err, _req, res, next) {
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: `This file is over the 1 MB a room archive may be. ${NOTHING}` });
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    res.status(400).json({ error: `This file is not a room archive BloomLoop can import: it is not readable JSON. ${NOTHING}` });
    return;
  }
  next(err);
}

/**
 * Laptop mode only: once a room is closed or deleted, write its archive to the
 * laptop's disk at once rather than at the next interval. On `finish`, so a
 * refused close writes nothing; the writer only writes what changed. Every
 * other server has no writer, and this does nothing there.
 */
export function saveRoomsOnClose(req, res, next) {
  const writer = activeWriter();
  const closing = (req.method === 'POST' && /^\/[^/]+\/close\/?$/.test(req.path))
    || (req.method === 'DELETE' && /^\/[^/]+\/?$/.test(req.path));
  if (writer && closing) {
    res.on('finish', () => {
      if (res.statusCode < 400) writer.flush().catch((err) => console.error(`[laptop] saving after a close failed: ${err.message}`));
    });
  }
  next();
}
