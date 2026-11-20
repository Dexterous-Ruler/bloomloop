/**
 * A room archive from laptop mode, imported into the cloud (Phase 7, decision O4).
 *
 * A professor who ran a class on their laptop (laptop.js) comes back online with
 * one JSON file per room (services/laptopArchive.js). Uploaded here, each becomes
 * a closed room they own: its students, every answer kept as evidence (the
 * append-only guard holds: rows are inserted, never changed), its review log, its
 * attendance and its class questions. The existing reports, attainment and the
 * marks register read it like any room, because it is stored like any room.
 *
 * The rules, in the order they are applied:
 *
 *   malformed      the file must be a room archive (decodeRoomArchive reads it)
 *                  carrying laptop mode's mark, within the archive's own 4 MB,
 *                  and every row must be one the store would take. Anything else
 *                  is refused with a sentence naming the first problem. These
 *                  are checks of shape, not of authenticity: the professor holds
 *                  the laptop and the file, and anyone can write the mark. So an
 *                  imported room is never presented as one this server ran:
 *                  every staff screen and report that shows it says it was
 *                  imported, in IMPORTED_NOTE's words (importedFrom), and an
 *                  attainment report can leave imported rooms out.
 *   whose          an archive naming another teacher as the room's owner is
 *                  refused. A laptop's rooms are owned by nobody (the laptop has
 *                  no accounts), and become the importer's.
 *   once           idempotent by the archive's room id: the same room imported
 *                  again changes nothing and says so (and whether the file
 *                  differs from the one imported then). Never a merge, never an
 *                  overwrite: imported evidence is final.
 *   another source a room id already in this store (a live room, a deleted
 *                  room's archive, or an import the caller may not read) is
 *                  refused with one sentence that says no more than that. A
 *                  room code already in use here is not: the room is imported
 *                  under a code drawn afresh, and the import keeps the laptop's.
 *   where it goes  the chapter its questions belong to, and the class it took
 *                  attendance for, are the caller's own (a chapter and a class
 *                  they may change; the same 404 for "not yours" and "not
 *                  there"). The laptop's own chapter and class are not in the
 *                  cloud, so the professor chooses them; an archive's own ids are
 *                  used only when they name the caller's chapter or class here.
 *
 * What moves across, and how:
 *
 *   questions      every answer keeps the question exactly as it was shown
 *                  (its snapshot, the laptop's question id inside it). The
 *                  answer row's question id is kept only when it names a question
 *                  of the chosen chapter here, which a laptop's never does; every
 *                  reader already falls back to the snapshot's id, as for a
 *                  question deleted after it was answered. The answer is filed
 *                  under the chosen chapter, so its topic is matched to that
 *                  chapter's course outcomes as any answer's is.
 *   late answers   an answer that waited on a phone keeps the phone's own time
 *                  (for the record, never read), and one the laptop kept and did
 *                  not count (after the close, or past the cap) stays kept and
 *                  not counted: its `final` and its detail are as the laptop
 *                  wrote them. Once imported, the room takes no more deliveries
 *                  from phones (isImportedRoom, read by the live loop).
 *   attendance     each mark is tied to the chosen class's roster by its roll
 *                  number (the laptop roster's, then the one it was made under).
 *                  A mark whose roll number the roster does not hold cannot be a
 *                  mark here; it is listed in the reply and kept in the archive
 *                  copy.
 *   class          a class question keeps its place, its question as asked and
 *   questions      its votes; it is closed with the room. Its votes point at its
 *                  new id.
 *   the archive    the file itself is kept with the import record, so nothing in
 *                  it is lost: the teacher records (observations, the wheel,
 *                  tallies, activities, insight actions), which are not made
 *                  into the room's records here, and any mark the roster could
 *                  not take.
 *   under 18       decision 8, as for any archive: no integrity signal of a
 *                  student the chosen class's roster marks under 18 is recorded,
 *                  in the room's profiles or in the kept copy.
 */

import crypto from 'node:crypto';

import { LEVELS } from '../bloom.js';
import { isRecordId } from '../ids.js';
import { canRead, canWrite, assertCanWrite, ownerOf } from '../ownership.js';
import {
  ARCHIVE_FORMAT, ARCHIVE_LIMIT_BYTES, ARCHIVE_VERSION, decodeRoomArchive, fromTable,
} from './archive.js';
import { sessionSettings } from './mastery.js';
import { minorRolls } from './roster.js';
import { rollKey } from './evidence.js';

export const NOTHING = 'Nothing was imported.';
export const ELSEWHERE = 'A room with this archive\'s id or code is already in BloomLoop from somewhere else, so this file '
  + 'was not imported: an import never replaces or joins evidence that is already here. Nothing was imported.';

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const malformed = (why) => fail(400, `This file is not a room archive BloomLoop can import: ${why}. ${NOTHING}`);

const TABLES = ['students', 'answers', 'history', 'reviews', 'attendance', 'classQuestions',
  'observations', 'wheelRounds', 'wheelPicks', 'tallies', 'activities', 'insightActions'];
const RECORD_TABLES = ['observations', 'wheelRounds', 'wheelPicks', 'tallies', 'activities', 'insightActions'];
const DERIVED_FIELDS = {
  answers: new Set(['questionId', 'topic', 'bloom', 'kind', 'rollNo']),
  history: new Set(['questionId', 'bloom', 'topic', 'kind', 'answerId', 'correct', 'score', 'at', 'rollNo']),
};
const ROOM_STATUSES = ['waiting', 'open', 'paused', 'closed'];
const REVIEW_STATUSES = ['auto', 'provisional', 'confirmed', 'overridden'];
const CONFIDENCE = ['sure', 'think', 'guess'];
const CLASS_STATES = ['open', 'paused', 'revote', 'closed'];
const SETTING_KEYS = ['masteryGoal', 'reattempts', 'redemption', 'mode', 'adapt', 'startLevel', 'questionsPerStudent', 'timePerQuestion'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v));
const timeOrNull = (v) => v === null || v === undefined || isTime(v);
const text = (v, max) => typeof v === 'string' && v.length <= max;
const textOrNull = (v, max) => v === null || v === undefined || text(v, max);
const nth = (i) => i + 1;

/** The canonical bytes of an archive as received, and their SHA-256. */
export function archiveDigest(archive) {
  const json = JSON.stringify(archive);
  return { bytes: Buffer.byteLength(json, 'utf8'), sha256: crypto.createHash('sha256').update(json).digest('hex') };
}

/* --------------------------------------------------------------- shape -- */

function checkTable(archive, name, length) {
  const t = archive[name];
  if (t === undefined || t === null) return 0;
  if (!isObject(t) || !Array.isArray(t.cols) || !Array.isArray(t.rows)) throw malformed(`its ${name} list is not a table`);
  if (!t.cols.every((c) => typeof c === 'string' && c.length <= 64) || new Set(t.cols).size !== t.cols.length) {
    throw malformed(`its ${name} list has a bad column`);
  }
  t.rows.forEach((r, i) => {
    if (!Array.isArray(r) || r.length !== t.cols.length) throw malformed(`row ${nth(i)} of its ${name} list does not match its columns`);
  });
  if (length !== undefined && t.rows.length !== length) throw malformed(`its ${name} list does not hold the rows its counts say`);
  return t.rows.length;
}

/** Each `field` of a table's rows must index `size` things (or be null/absent when `optional`). */
function checkPointers(archive, name, field, size, what, { optional = false } = {}) {
  for (const [i, row] of fromTable(archive[name]).entries()) {
    const v = row[field];
    if ((v === null || v === undefined) && optional) continue;
    if (!Number.isInteger(v) || v < 0 || v >= size) throw malformed(`row ${nth(i)} of its ${name} list points at no ${what}`);
  }
}

/**
 * The archive as a whole: format, version, the laptop's mark, the room, the
 * tables and every pointer between them. Throws a 400 or a 413 with a sentence.
 */
export function checkArchive(archive) {
  if (!isObject(archive)) throw malformed('it is not a JSON object');
  if (archive.format !== ARCHIVE_FORMAT) throw malformed('it is not a BloomLoop room archive');
  if (archive.version !== ARCHIVE_VERSION) throw malformed(`it is version ${JSON.stringify(archive.version)}, and this server reads version ${ARCHIVE_VERSION}`);
  const { bytes } = archiveDigest(archive);
  if (bytes > ARCHIVE_LIMIT_BYTES) {
    throw fail(413, `This archive is ${(bytes / (1024 * 1024)).toFixed(2)} MB, over the 4 MB a room archive may be. ${NOTHING}`);
  }
  // The mark laptop mode puts on what it saves. It says where a file came from;
  // anyone can write it, so it proves nothing, and the sentence does not claim
  // it does (every imported room is shown as imported instead: importedFrom).
  const laptop = archive.laptop;
  if (!isObject(laptop) || !/^[0-9a-f]{8,32}$/.test(String(laptop.run ?? '')) || !isTime(laptop.startedAt)) {
    throw fail(400, 'This file does not carry the mark laptop mode puts on the rooms it saves, so it is not one to import '
      + 'here. The mark says where a file came from, not that it is unchanged, so every imported room is shown as imported. '
      + NOTHING);
  }
  const room = archive.room;
  if (!isObject(room)) throw malformed('it has no room');
  if (!text(room.id, 64) || !/^[A-Za-z0-9-]+$/.test(room.id)) throw malformed('its room has no id');
  if (!text(room.code, 16) || !/^[A-Z0-9]{4,16}$/.test(room.code)) throw malformed('its room has no code');
  if (!textOrNull(room.title, 300)) throw malformed('its room\'s title is not text');
  if (!ROOM_STATUSES.includes(room.status)) throw malformed('its room has no status');
  if (!timeOrNull(room.startedAt) || !timeOrNull(room.closedAt) || !timeOrNull(room.pausedAt)) throw malformed('its room\'s times are not times');
  if (!textOrNull(room.ownerId, 64)) throw malformed('its room\'s owner is not an id');
  if (room.questionIds !== null && room.questionIds !== undefined
    && (!Array.isArray(room.questionIds) || !room.questionIds.every((id) => text(id, 64)))) throw malformed('its room\'s question set is not a list of ids');
  const settings = room.settings ?? {};
  if (!isObject(settings)) throw malformed('its room has no settings');
  const held = sessionSettings(settings);
  for (const key of SETTING_KEYS) {
    if (settings[key] !== undefined && settings[key] !== held[key]) throw malformed(`its room's setting "${key}" is not one BloomLoop allows`);
  }
  if (!isTime(archive.timeBase) || !isTime(archive.archivedAt)) throw malformed('its times are not times');
  if (!Array.isArray(archive.questions) || !archive.questions.every(isObject)) throw malformed('its questions are not a list');
  if (archive.derived !== undefined && archive.derived !== null) {
    if (!isObject(archive.derived)) throw malformed('it does not say which columns it derives');
    for (const [name, list] of Object.entries(archive.derived)) {
      if (!DERIVED_FIELDS[name] || !Array.isArray(list) || !list.every((f) => DERIVED_FIELDS[name].has(f))) {
        throw malformed('it derives a column BloomLoop does not');
      }
    }
  }
  const counts = isObject(archive.counts) ? archive.counts : {};
  const size = {};
  for (const name of TABLES) {
    const expected = Number.isInteger(counts[name]) ? counts[name] : undefined;
    size[name] = checkTable(archive, name, ['students', 'answers', 'reviews'].includes(name) ? expected : undefined);
  }
  const q = archive.questions.length;
  checkPointers(archive, 'answers', 'q', q, 'question');
  checkPointers(archive, 'answers', 's', size.students, 'student', { optional: true });
  checkPointers(archive, 'history', 'a', size.answers, 'answer', { optional: true });
  checkPointers(archive, 'history', 's', size.students, 'student', { optional: true });
  checkPointers(archive, 'reviews', 'a', size.answers, 'answer');
  checkPointers(archive, 'classQuestions', 'q', q, 'question');
  return { bytes };
}

/* ---------------------------------------------------------------- rows -- */

/**
 * The decoded room, row by row: everything the store would refuse, refused
 * here first with a sentence, so an import never stops half way on a check.
 */
export function checkRows(decoded) {
  const rolls = new Set();
  decoded.students.forEach((s, i) => {
    const where = `student ${nth(i)}`;
    if (!text(s.rollNo, 64) || !s.rollNo.trim()) throw malformed(`${where} has no roll number`);
    if (rolls.has(s.rollNo)) throw malformed(`two students share the roll number ${s.rollNo}`);
    rolls.add(s.rollNo);
    if (!textOrNull(s.name, 200)) throw malformed(`${where}'s name is not text`);
    if (s.workingLevel !== undefined && s.workingLevel !== null && !LEVELS.includes(s.workingLevel)) throw malformed(`${where} is at no level`);
    if (s.levels !== undefined && s.levels !== null && !isObject(s.levels)) throw malformed(`${where}'s levels are not a record`);
    if (!Array.isArray(s.history)) throw malformed(`${where}'s history is not a list`);
    if (s.integrity !== undefined && s.integrity !== null && !Array.isArray(s.integrity)) throw malformed(`${where}'s signals are not a list`);
  });
  const classIds = new Set();
  const seqs = new Set();
  decoded.classQuestions.forEach((c, i) => {
    const where = `class question ${nth(i)}`;
    if (!text(c.id, 64) || classIds.has(c.id)) throw malformed(`${where} has no id of its own`);
    classIds.add(c.id);
    if (!Number.isInteger(c.seq) || c.seq < 1 || seqs.has(c.seq)) throw malformed(`${where} has no place of its own`);
    seqs.add(c.seq);
    if (!CLASS_STATES.includes(c.state)) throw malformed(`${where} has no state`);
    if (c.revealed !== undefined && typeof c.revealed !== 'boolean') throw malformed(`${where} does not say whether its key was shown`);
    if (!isTime(c.startedAt) || !timeOrNull(c.pausedAt) || !timeOrNull(c.revoteAt) || !timeOrNull(c.closedAt)) throw malformed(`${where}'s times are not times`);
    if (!isObject(c.questionSnapshot)) throw malformed(`${where} has no question`);
  });
  const keys = new Set();
  decoded.answers.forEach((a, i) => {
    const where = `answer ${nth(i)}`;
    if (!text(a.answerKey, 200) || !a.answerKey) throw malformed(`${where} has no answer key`);
    if (keys.has(a.answerKey)) throw malformed(`two answers share the key ${a.answerKey}`);
    keys.add(a.answerKey);
    if (!text(a.rollNo, 64) || !a.rollNo) throw malformed(`${where} has no roll number`);
    if (!LEVELS.includes(a.bloom)) throw malformed(`${where} is at no level`);
    if (!textOrNull(a.kind, 32) || !textOrNull(a.topic, 300)) throw malformed(`${where}'s kind or topic is not text`);
    if (!isObject(a.questionSnapshot)) throw malformed(`${where} has no question`);
    if (!isTime(a.answeredAt) || !timeOrNull(a.servedAt) || !timeOrNull(a.reviewedAt) || !timeOrNull(a.deviceAnsweredAt)) {
      throw malformed(`${where}'s times are not times`);
    }
    if (a.attempt !== undefined && (!Number.isInteger(a.attempt) || a.attempt < 1 || a.attempt > 32767)) throw malformed(`${where} has no attempt number`);
    for (const f of ['final', 'ungraded']) {
      if (a[f] !== undefined && a[f] !== null && typeof a[f] !== 'boolean') throw malformed(`${where}'s ${f === 'final' ? 'final mark' : 'poll mark'} is not yes or no`);
    }
    for (const f of ['correct', 'autoCorrect']) {
      if (a[f] !== undefined && a[f] !== null && typeof a[f] !== 'boolean') throw malformed(`${where}'s mark is not right or wrong`);
    }
    for (const f of ['score', 'autoScore']) {
      if (a[f] !== undefined && a[f] !== null && !(Number.isFinite(a[f]) && a[f] >= 0 && a[f] <= 1)) throw malformed(`${where}'s score is not from 0 to 1`);
    }
    if (a.reviewStatus !== undefined && !REVIEW_STATUSES.includes(a.reviewStatus)) throw malformed(`${where}'s review is in no state`);
    if (a.confidence !== undefined && a.confidence !== null && !CONFIDENCE.includes(a.confidence)) throw malformed(`${where}'s confidence tap is not one BloomLoop stores`);
    for (const f of ['detail', 'autoDetail', 'reviewNote']) if (!textOrNull(a[f], 4000)) throw malformed(`${where}'s notes are not text`);
    if (!textOrNull(a.language, 16) || !textOrNull(a.questionSource, 32)) throw malformed(`${where}'s language or source is not text`);
    const voted = a.classQuestionId !== undefined && a.classQuestionId !== null;
    const round = a.round === undefined ? null : a.round;
    if (voted !== (round !== null)) throw malformed(`${where} names a class question without a round, or a round without one`);
    if (voted && (![1, 2].includes(round) || !classIds.has(String(a.classQuestionId)))) throw malformed(`${where} is a vote in no class question of the room`);
  });
  decoded.reviews.forEach((r, i) => {
    const where = `review ${nth(i)}`;
    if (!['confirm', 'override'].includes(r.decision)) throw malformed(`${where} is neither a confirm nor an override`);
    if (typeof r.correct !== 'boolean' || !(Number.isFinite(r.score) && r.score >= 0 && r.score <= 1)) throw malformed(`${where}'s mark is not one`);
    if (!textOrNull(r.note, 1000) || !isTime(r.reviewedAt) || !keys.has(r.answerKey)) throw malformed(`${where} is not tied to an answer`);
  });
  decoded.attendance.forEach((m, i) => {
    const where = `attendance mark ${nth(i)}`;
    if (!['present', 'absent', 'late'].includes(m.status) || !['joined', 'teacher'].includes(m.source)) throw malformed(`${where} is not a mark`);
    if (m.source === 'joined' && m.status !== 'present') throw malformed(`${where} says a join marked a student ${m.status}`);
    if (!isTime(m.markedAt)) throw malformed(`${where}'s time is not a time`);
    if (!textOrNull(m.rollNo, 64) || !textOrNull(m.markedRollNo, 64) || !(m.rollNo || m.markedRollNo)) throw malformed(`${where} has no roll number`);
  });
}

/* ------------------------------------------------------------- targets -- */

/** A chapter the viewer may change, by the id they sent or the archive's own; null when neither names one. */
async function chapterFor(repo, viewer, sent, own) {
  if (sent !== undefined && sent !== null) {
    const id = typeof sent === 'string' ? sent.trim() : '';
    const content = isRecordId(id) ? await repo.getContent(id) : null;
    return assertCanWrite(viewer, content, 'That chapter');
  }
  if (isRecordId(own)) {
    const content = await repo.getContent(own);
    if (content && await canWrite(viewer, ownerOf(content))) return content;
  }
  return null;
}

/** A class the viewer may change (as opening a room for one asks), by the id sent or the archive's own. */
async function classFor(repo, viewer, sent, own) {
  const writable = async (cls) => Boolean(cls) && await canRead(viewer, ownerOf(cls)) && await canWrite(viewer, ownerOf(cls));
  if (sent !== undefined && sent !== null) {
    const id = typeof sent === 'string' ? sent.trim() : '';
    const cls = isRecordId(id) ? await repo.getClass(id) : null;
    if (!(await writable(cls))) throw fail(404, 'That class was not found.');
    return cls;
  }
  if (isRecordId(own)) {
    const cls = await repo.getClass(own);
    if (await writable(cls)) return cls;
  }
  return null;
}

/** The archive's students table with every signal of `rolls` emptied (decision 8). */
function withoutSignals(data, rolls) {
  const table = data?.students;
  const roll = table?.cols?.indexOf('rollNo') ?? -1;
  const signals = table?.cols?.indexOf('integrity') ?? -1;
  if (!rolls.size || roll < 0 || signals < 0) return data;
  return {
    ...data,
    students: { ...table, rows: table.rows.map((r) => (rolls.has(String(r[roll])) ? r.map((v, i) => (i === signals ? [] : v)) : r)) },
  };
}

/**
 * Was this room made by an import? Its phones answered on the laptop, so the
 * live loop lets no phone deliver saved answers to it here. Read by the room's
 * id, one indexed read, never by listing every import. Throws when the store
 * cannot read imports; the caller decides what that means.
 */
export async function isImportedRoom(repo, sessionId) {
  const id = String(sessionId ?? '');
  return Boolean(id) && (await repo.listRoomImportsForSessions([id])).some((r) => String(r.sessionId) === id);
}

/**
 * What a staff screen is told about a room that came from a file laptop mode
 * saved, or nothing for any other room. The file was checked for its shape, and
 * that every row is one the store would take; nothing can check that it is the
 * file the laptop saved, unchanged (the professor holds the laptop and the
 * file). So an imported room is never presented as one this server ran: every
 * screen that shows a room can say where it came from, in these words.
 */
export const IMPORTED_NOTE = 'Imported from a file saved by laptop mode. BloomLoop checked that the file is a room it can '
  + 'read, not that it is unchanged since the laptop saved it: its answers, marks and attendance are as the file gives them.';

/** `{ importedAt, sourceCode, laptop, note }` for an imported room, from its import record. */
export const importedFrom = (rec) => (rec ? {
  importedAt: rec.importedAt ?? null,
  sourceCode: rec.sourceCode ?? null,
  laptop: rec.source ?? null,
  note: IMPORTED_NOTE,
} : null);

/**
 * The imported rooms among `sessions`: a Map of room id to importedFrom(...).
 * One read for all of them. A store without the import records (0031) has none.
 */
export async function importedRooms(repo, sessions = []) {
  const ids = sessions.map((s) => String(s?._id ?? '')).filter(Boolean);
  if (!ids.length) return new Map();
  const recs = await repo.listRoomImportsForSessions(ids).catch((err) => {
    console.error('[imports] could not read which rooms were imported:', err?.message ?? err);
    return [];
  });
  return new Map(recs.map((r) => [String(r.sessionId), importedFrom(r)]));
}

/** One import record as a screen gets it: never the archive itself. */
export function importView(rec) {
  return {
    id: String(rec._id),
    room: { code: rec.sourceCode, sessionId: rec.sessionId ? String(rec.sessionId) : null },
    sourceRoomId: rec.sourceRoomId,
    laptop: rec.source ?? null,
    archivedAt: rec.archivedAt ?? null,
    importedAt: rec.importedAt,
    importedBy: rec.importedBy ?? null,
    bytes: rec.bytes,
    summary: rec.summary ?? {},
  };
}

/* -------------------------------------------------------------- import -- */

/**
 * Import one room archive for `viewer`. Returns { created, status, body }:
 * 201 with the room made, or 200 when this room was imported before. Throws a
 * 4xx with a sentence for everything refused.
 *
 * `lock(key)` serialises imports of one room in this process (the store's
 * unique source id is the guard across processes). `drawCode()` draws a room
 * code free in this store, for a room whose laptop code is taken here.
 */
export async function importRoomArchive(repo, viewer, { archive, contentId, classId } = {}, { lock = null, now = new Date(), drawCode = null } = {}) {
  const { bytes } = checkArchive(archive);
  let decoded;
  try {
    decoded = decodeRoomArchive(archive);
  } catch (err) {
    throw malformed(`it could not be read (${String(err?.message ?? err).slice(0, 120)})`);
  }
  checkRows(decoded);

  const room = archive.room;
  if (room.ownerId && room.ownerId !== viewer?.id) {
    throw fail(403, 'This archive records a room another teacher owns, so only they may import it. ' + NOTHING);
  }

  const release = lock ? await lock(`#import:${room.id}`) : null;
  try {
    const { sha256 } = archiveDigest(archive);
    const before = await repo.getRoomImportBySource(room.id);
    if (before) {
      if (!(await canRead(viewer, ownerOf(before)))) throw fail(409, ELSEWHERE);
      const same = before.sha256 === sha256;
      return {
        created: false,
        status: 200,
        body: {
          imported: false,
          alreadyImported: true,
          same,
          import: importView(before),
          message: `Room ${room.code} was imported on ${String(before.importedAt).slice(0, 10)}, so nothing was changed.`
            + (same ? '' : ' This file is not the one imported then (it may have been saved later): an imported room is never '
              + 'overwritten or added to, so nothing in it was used.'),
        },
      };
    }
    if (isRecordId(room.id) && (await repo.getSession(room.id) || await repo.getRoomArchiveBySession(room.id))) {
      throw fail(409, ELSEWHERE);
    }
    // The laptop's code taken here, by any room: the imported room gets a code
    // drawn afresh, and its import record keeps the laptop's (sourceCode).
    // Refused instead, a code read off a colleague's wall let anyone import a
    // file under it first, and the colleague's own room could then never be
    // imported. A code identifies nothing about the room; its id does.
    let code = room.code;
    if (await repo.getSessionByCode(room.code)) {
      if (!drawCode) throw fail(409, ELSEWHERE);
      code = await drawCode();
    }

    const content = await chapterFor(repo, viewer, contentId, room.contentId);
    if (!content) {
      throw fail(400, 'Choose the chapter in your account that this room\'s questions belong to: the chapter on the laptop is '
        + 'not in your account, and each answer is filed under the chosen chapter\'s topics. ' + NOTHING, { needs: 'chapter' });
    }
    const cls = await classFor(repo, viewer, classId, room.classId);
    const settings = sessionSettings(room.settings ?? {});
    if (!cls && (room.classId || settings.mode === 'teacher-led')) {
      throw fail(400, 'This room took attendance against a class on the laptop. Choose the class in your account it belongs '
        + 'to, so its attendance and answers count in that class\'s reports. ' + NOTHING, { needs: 'class' });
    }

    return await build({ repo, viewer, archive, decoded, content, cls, settings, bytes, sha256, now, code });
  } finally {
    release?.();
  }
}

async function build({ repo, viewer, archive, decoded, content, cls, settings, bytes, sha256, now, code = archive.room.code }) {
  const room = archive.room;
  const contentId = String(content._id);
  const bank = new Set((await repo.listQuestions(contentId, { includeDiscarded: true })).map((q) => String(q._id)));
  const inChapter = (id) => (id !== null && id !== undefined && bank.has(String(id)) ? String(id) : null);

  // A room saved while it ran (a crash, or a file copied mid-class) is closed as
  // of the moment it was saved: that is the last moment it is known to hold.
  const running = room.status !== 'closed';
  const closedAt = room.closedAt ?? archive.archivedAt;
  const startedAt = room.startedAt ?? archive.timeBase;

  // The room's question set, only when every question of it is in the chapter.
  const set = Array.isArray(room.questionIds) ? room.questionIds.map(inChapter) : null;
  const questionIds = set && set.every(Boolean) ? set : null;

  // ---------------------------------------------------------- attendance --
  const roster = cls ? await repo.listClassStudents(cls._id) : [];
  const onRoster = new Map(roster.map((s) => [rollKey(s.rollNo), s]));
  const marks = [];
  const notOnRoster = [];
  const marked = new Set();
  for (const m of decoded.attendance) {
    const s = onRoster.get(rollKey(m.rollNo)) ?? onRoster.get(rollKey(m.markedRollNo));
    if (!s || marked.has(String(s._id))) {
      notOnRoster.push(m.rollNo ?? m.markedRollNo);
      continue;
    }
    marked.add(String(s._id));
    marks.push({
      classStudentId: String(s._id),
      status: m.status,
      source: m.source,
      markedAt: m.markedAt,
      markedBy: null,
      rollNo: m.markedRollNo ?? null,
    });
  }
  const minors = minorRolls(roster, marks);

  // ------------------------------------------------------------- the rows --
  const profiles = decoded.students.map((s) => ({
    rollNo: s.rollNo,
    name: s.name ?? '',
    levels: s.levels ?? {},
    workingLevel: s.workingLevel ?? 'understand',
    reason: s.reason ?? '',
    history: s.history,
    served: s.served ?? null,
    integrity: minors.has(String(s.rollNo)) ? [] : (s.integrity ?? []),
    accountId: null,
    accountVerified: false,
  }));
  const classQuestions = decoded.classQuestions.map((c) => ({
    ref: String(c.id),
    seq: c.seq,
    questionId: inChapter(c.questionId),
    questionSnapshot: c.questionSnapshot,
    // Closed with the room: no vote can come any more.
    state: 'closed',
    revealed: c.state === 'closed' && c.revealed === true,
    startedAt: c.startedAt,
    startedBy: null,
    pausedAt: c.pausedAt ?? null,
    revoteAt: c.revoteAt ?? null,
    closedAt: c.closedAt ?? closedAt,
    closedBy: null,
  }));
  const answers = decoded.answers.map((a) => ({
    answerKey: a.answerKey,
    rollNo: a.rollNo,
    accountId: null,
    accountVerified: false,
    questionId: inChapter(a.questionId),
    contentId,
    topic: a.topic ?? '',
    bloom: a.bloom,
    kind: a.kind ?? 'mcq',
    questionSnapshot: a.questionSnapshot,
    response: a.response ?? null,
    attempt: a.attempt ?? 1,
    final: a.final !== false,
    correct: a.correct ?? null,
    score: a.score ?? null,
    detail: a.detail ?? '',
    ungraded: a.ungraded === true,
    language: a.language ?? 'en',
    questionSource: a.questionSource ?? 'llm',
    servedAt: a.servedAt ?? null,
    answeredAt: a.answeredAt,
    // When the phone says it was answered, for an answer that waited on a phone
    // (Phase 7, 0030): kept for the record as the laptop kept it, never read.
    deviceAnsweredAt: a.deviceAnsweredAt ?? null,
    reviewStatus: a.reviewStatus ?? 'auto',
    autoCorrect: a.autoCorrect ?? null,
    autoScore: a.autoScore ?? null,
    autoDetail: a.autoDetail ?? '',
    reviewedBy: null,
    reviewedAt: a.reviewedAt ?? null,
    reviewNote: a.reviewNote ?? '',
    confidence: a.confidence ?? null,
    classQuestionRef: a.classQuestionId ? String(a.classQuestionId) : null,
    round: a.round ?? null,
  }));
  const reviews = decoded.reviews.map((r) => ({
    answerKey: r.answerKey,
    decision: r.decision,
    correct: r.correct,
    score: r.score,
    note: r.note ?? '',
    reviewedBy: null,
    reviewedAt: r.reviewedAt,
  }));

  const records = Object.fromEntries(RECORD_TABLES
    .map((name) => [name, archive[name]?.rows?.length ?? 0])
    .filter(([, n]) => n > 0));
  const summary = {
    students: profiles.length,
    answers: answers.length,
    reviews: reviews.length,
    classQuestions: classQuestions.length,
    attendance: { imported: marks.length, notOnRoster },
    // Kept in the imported archive, not made into the room's own records.
    records,
    roomWasRunning: running,
    questionSetKept: questionIds !== null || !Array.isArray(room.questionIds),
    sentences: [
      running ? `The laptop saved this room while it was still running, so it holds what was recorded up to ${closedAt}; it is closed as of then.` : null,
      notOnRoster.length
        ? `${notOnRoster.length} attendance mark${notOnRoster.length === 1 ? ' is' : 's are'} for a roll number the class's roster does not hold `
          + `(${notOnRoster.join(', ')}), so ${notOnRoster.length === 1 ? 'it is' : 'they are'} kept in the imported archive only.`
        : null,
      Object.keys(records).length
        ? 'The teacher records made on the laptop (observations, the wheel, hands up, activities) are kept in the imported archive, '
          + 'not added to this room\'s records.'
        : null,
      Array.isArray(room.questionIds) && questionIds === null
        ? 'The room served a chosen set of the laptop\'s questions; those are not in your chapter, so the imported room lists no set.'
        : null,
      minors.size ? 'No integrity signal is kept for a student the class roster marks under 18.' : null,
    ].filter(Boolean),
  };

  const session = {
    code,
    contentId,
    title: room.title ?? '',
    status: 'closed',
    ownerId: viewer?.id ?? null,
    startedAt,
    closedAt,
    pausedAt: null,
    ...settings,
    questionIds,
    classId: cls ? String(cls._id) : null,
  };
  const record = {
    sourceRoomId: room.id,
    sourceCode: room.code,
    source: { run: archive.laptop.run, startedAt: archive.laptop.startedAt },
    ownerId: viewer?.id ?? null,
    importedBy: viewer?.id ?? null,
    importedAt: now.toISOString(),
    archivedAt: archive.archivedAt,
    bytes,
    sha256,
    summary,
    data: withoutSignals(archive, minors),
  };

  let made;
  try {
    made = await repo.importRoom({ record, session, classQuestions, profiles, answers, reviews, attendance: marks });
  } catch (err) {
    // Two imports of one room from two processes: the second finds the first's.
    if (err?.code === 'IMPORT_EXISTS' || err?.code === 'CODE_TAKEN') throw fail(409, ELSEWHERE);
    throw err;
  }

  return {
    created: true,
    status: 201,
    body: {
      imported: true,
      alreadyImported: false,
      room: {
        code: made.session.code,
        sessionId: String(made.session._id),
        title: made.session.title ?? '',
        status: made.session.status,
        contentId,
        classId: made.session.classId ?? null,
        startedAt: made.session.startedAt ?? null,
        closedAt: made.session.closedAt ?? null,
      },
      import: importView(made.record),
      importedFrom: importedFrom(made.record),
      message: `Room ${room.code} was imported as a closed room`
        + `${made.session.code !== room.code ? ` with the code ${made.session.code}, since ${room.code} is another room's here` : ''}`
        + `: ${answers.length} answer${answers.length === 1 ? '' : 's'} `
        + `from ${profiles.length} student${profiles.length === 1 ? '' : 's'}`
        + `${cls ? `, ${marks.length} attendance mark${marks.length === 1 ? '' : 's'}` : ''}. `
        + 'It is shown as imported wherever it appears: BloomLoop checked that the file is a room it can read, not that it '
        + 'is unchanged since the laptop saved it.',
    },
  };
}
