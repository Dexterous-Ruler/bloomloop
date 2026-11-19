/**
 * Laptop mode's room archives on disk (Phase 7, decision O4).
 *
 * On a professor's laptop with no internet the server runs on the in-process
 * store, and the in-process store loses everything when the process stops: a
 * crash, a flat battery, a lid closed into sleep that the operating system
 * turns into a shutdown. So each room is written to a folder on the laptop's
 * own disk as its room archive (services/archive.js, the same JSON a deleted
 * room is kept as, and the format the import route takes back to the cloud):
 *
 *   on every close   the room's final archive, the moment the close is answered
 *                    (and on a delete, the archive the delete wrote);
 *   every interval   every room whose archive changed since it was last
 *                    written, running or closed (a closed room still takes late
 *                    answers from phones replaying their outbox, and those are
 *                    evidence too), so a crash loses at most one interval;
 *   at shutdown      once more, when the server is stopped normally.
 *
 * Each write is atomic: the archive goes to a temporary file in the same
 * folder, is flushed to the disk, and is then renamed over the room's file. A
 * crash part way through leaves the previous complete file, never half of one.
 *
 * Nothing is ever written outside the configured folder: file names are built
 * here from the room's code and id, checked against one pattern, and resolved
 * inside the folder before anything is opened.
 *
 * A room whose archive passes the 1 MB an archive may be is still written (it is
 * evidence, and is never trimmed), with a warning: the import route refuses it,
 * as the cloud's delete refuses to archive one.
 */

import nodeFs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { ARCHIVE_LIMIT_BYTES, buildRoomArchive } from './archive.js';

/** How often a running room is written, unless LAPTOP_ARCHIVE_SECONDS says otherwise. */
export const ARCHIVE_EVERY_SECONDS = 60;
/** The bounds LAPTOP_ARCHIVE_SECONDS is held to: a second (tests), an hour. */
export const ARCHIVE_SECONDS_RANGE = Object.freeze({ min: 1, max: 3600 });

// What a file name may be. Room codes are six of CODE_ALPHABET (routes/session.js)
// and ids are hex or uuids, so a name that fails this was not built from a room.
const SAFE_NAME = /^room-[A-Z0-9]{1,16}-[A-Za-z0-9-]{1,64}\.json$/;

/** The file a room's archive lives in: one per room, whatever its status. */
export function archiveFileName({ code, id }) {
  const name = `room-${String(code ?? '').toUpperCase()}-${String(id ?? '')}.json`;
  if (!SAFE_NAME.test(name)) {
    throw new Error(`refusing to name an archive file after room ${JSON.stringify(code)} / ${JSON.stringify(id)}`);
  }
  return name;
}

/**
 * The absolute path of `name` inside `dir`, or a throw. `dir` must already be
 * absolute (the writer resolves it once, at start). A name with a separator, a
 * parent step or anything else that would land outside the folder is refused.
 */
export function confinedPath(dir, name) {
  if (!path.isAbsolute(dir)) throw new Error('the archive folder must be an absolute path');
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name === '.' || name === '..') {
    throw new Error(`refusing to write ${JSON.stringify(name)}: not a plain file name`);
  }
  const target = path.resolve(dir, name);
  if (path.dirname(target) !== path.resolve(dir)) {
    throw new Error(`refusing to write ${JSON.stringify(name)}: outside the archive folder`);
  }
  return target;
}

/**
 * Write `text` to `dir/name` so that the file is either the old version or the
 * new one, never a mix: a temporary file in the same folder (so the rename stays
 * on one disk), flushed, then renamed over the target. The temporary file is
 * opened exclusively, so an existing file or link of that name is never
 * followed. On any failure the temporary file is removed and the error thrown;
 * the target is left as it was.
 *
 * Readable by the laptop's own user only (FILE_MODE), where the system honours
 * it: a room file holds names, roll numbers, answers and every question's
 * answer key, and a key copied out is out for every later room on the chapter.
 */
export const FILE_MODE = 0o600;
export const FOLDER_MODE = 0o700;

export function writeAtomic(dir, name, text, { fs = nodeFs } = {}) {
  const target = confinedPath(dir, name);
  const temp = confinedPath(dir, `.${name}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(temp, 'wx', FILE_MODE);
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(temp, target);
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already failing */ }
    }
    try { fs.unlinkSync(temp); } catch { /* never made, or already gone */ }
    throw err;
  }
  return target;
}

/** LAPTOP_ARCHIVE_SECONDS as milliseconds, or the default; out of range is refused, not clamped. */
export function archiveIntervalMs(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return ARCHIVE_EVERY_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isInteger(seconds) || seconds < ARCHIVE_SECONDS_RANGE.min || seconds > ARCHIVE_SECONDS_RANGE.max) {
    throw new Error(`LAPTOP_ARCHIVE_SECONDS must be a whole number of seconds from ${ARCHIVE_SECONDS_RANGE.min} `
      + `to ${ARCHIVE_SECONDS_RANGE.max}; it is ${JSON.stringify(String(raw))}.`);
  }
  return seconds * 1000;
}

// What makes two builds of one room the same archive: everything but the
// moment it was built.
const contentHash = (data) => crypto.createHash('sha256')
  .update(JSON.stringify({ ...data, archivedAt: null }))
  .digest('hex');

let active = null;

/** The writer laptop mode started, or null: every other server has none. */
export function activeWriter() {
  return active;
}

/**
 * The writer: `flush()` writes every room that changed now, `start()` runs it
 * every `intervalMs`, `stop()` stops the timer and flushes once more.
 *
 * @param {object} o
 * @param {() => object} o.getRepo   the repository, read at each flush
 * @param {string} o.dir             the folder; made if missing, resolved once
 * @param {number} o.intervalMs
 * @param {{run: string, startedAt: string}} o.source  this laptop server's run,
 *   written into every file as `laptop`, so an import says which run it came from
 */
export function createArchiveWriter({
  getRepo, dir, intervalMs = ARCHIVE_EVERY_SECONDS * 1000, source, log = console.log, fs = nodeFs, now = () => new Date(),
}) {
  // The laptop's own user only, where the system honours it (FILE_MODE says why).
  fs.mkdirSync(dir, { recursive: true, mode: FOLDER_MODE });
  // Resolved once, through any link in the path, so every check after this
  // compares against the folder as it really is.
  const folder = fs.realpathSync(path.resolve(dir));
  const written = new Map(); // room id -> hash of what its file holds
  const archivedRooms = new Set(); // deleted rooms whose final archive is written
  const warnedLarge = new Set();
  const state = { lastWriteAt: null, writes: 0, lastError: null };
  let timer = null;
  let chain = Promise.resolve();

  function save(data) {
    const id = String(data?.room?.id ?? '');
    const name = archiveFileName({ code: data?.room?.code, id });
    const hash = contentHash(data);
    if (written.get(id) === hash) return false;
    const json = JSON.stringify({ ...data, laptop: { run: source.run, startedAt: source.startedAt } });
    const bytes = Buffer.byteLength(json, 'utf8');
    if (bytes > ARCHIVE_LIMIT_BYTES && !warnedLarge.has(id)) {
      warnedLarge.add(id);
      log(`[laptop] WARNING: room ${data.room.code} is ${(bytes / (1024 * 1024)).toFixed(2)} MB, over the 1 MB a room archive may be. `
        + 'It is still saved here, but it cannot be imported online: close it and open a new room for the rest of the class.');
    }
    writeAtomic(folder, name, json, { fs });
    written.set(id, hash);
    state.writes += 1;
    state.lastWriteAt = now().toISOString();
    return true;
  }

  async function writeAll() {
    const repo = getRepo();
    let count = 0;
    for (const session of await repo.listSessions()) {
      try {
        const { doc } = await buildRoomArchive(repo, session, { now: now() });
        if (save(doc.data)) count += 1;
      } catch (err) {
        state.lastError = `${session.code}: ${err.message}`;
        log(`[laptop] could not save room ${session.code}: ${err.message}. It is tried again at the next save.`);
      }
    }
    // A deleted room: the archive its delete wrote is the last word on it.
    for (const meta of await repo.listRoomArchives()) {
      if (archivedRooms.has(String(meta._id))) continue;
      try {
        const archive = await repo.getRoomArchive(meta._id);
        if (archive?.data) {
          if (save(archive.data)) count += 1;
          archivedRooms.add(String(meta._id));
        }
      } catch (err) {
        state.lastError = `${meta.code}: ${err.message}`;
        log(`[laptop] could not save the archive of deleted room ${meta.code}: ${err.message}.`);
      }
    }
    return count;
  }

  const writer = {
    folder,
    intervalMs,
    /** Write every room whose archive changed. One at a time: a flush waits for the one before. */
    flush() {
      chain = chain.then(writeAll, writeAll);
      return chain;
    },
    start() {
      if (!timer) {
        timer = setInterval(() => { writer.flush().catch((err) => log(`[laptop] save failed: ${err.message}`)); }, intervalMs);
        timer.unref?.();
      }
      active = writer;
      return writer;
    },
    /** Stop the timer and write once more. */
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      try {
        await writer.flush();
      } finally {
        if (active === writer) active = null;
      }
    },
    status() {
      return {
        folder,
        intervalSeconds: Math.round(intervalMs / 1000),
        lastWriteAt: state.lastWriteAt,
        writes: state.writes,
        rooms: written.size,
        lastError: state.lastError,
      };
    },
  };
  return writer;
}
