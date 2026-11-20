// Phase 7 (decision O4): laptop mode's room archives on disk, and the laptop
// mode switch itself (origins, addresses, the banner).
//
// The archive writer: atomic (a temporary file, then a rename; a failure leaves
// the old file and no temporary one), confined to its folder (no file name it
// builds or is handed can land outside it), and on an interval (a running room
// is written without anyone asking, a stopped writer writes no more).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';

import { createMemoryRepo } from '../src/repo/memoryRepo.js';
import { decodeRoomArchive } from '../src/services/archive.js';
import {
  ARCHIVE_EVERY_SECONDS,
  activeWriter,
  archiveFileName,
  archiveIntervalMs,
  confinedPath,
  createArchiveWriter,
  writeAtomic,
} from '../src/services/laptopArchive.js';
import { config } from '../src/config.js';
import {
  UNAVAILABLE,
  enterLaptopMode,
  isLanHost,
  lanAddresses,
  laptopBanner,
  laptopMode,
  laptopOrigin,
  laptopRequested,
  leaveLaptopMode,
} from '../src/laptop.js';
import { KEY_TRIES, KEY_WINDOW_MS, checkTeacherKey, forgetKeyFailures } from '../src/teacherAuth.js';

const made = [];
/** A fresh, empty folder under the system's temporary folder, removed after the file's tests. */
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomloop-laptop-test-'));
  made.push(dir);
  return dir;
}
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SOURCE = { run: 'a1b2c3d4', startedAt: '2026-11-19T08:00:00.000Z' };
const quiet = () => {};

/** A room with one student and `n` answers, on the in-process store. */
async function roomWith(repo, { code = 'LAPT01', n = 1 } = {}) {
  const content = await repo.createContent({ title: 'Cells', kind: 'syllabus', rawText: '', topics: ['Cells'] });
  const [q] = await repo.insertQuestions([{
    contentId: content._id, topic: 'Cells', text: 'Which organelle releases energy?', kind: 'mcq',
    options: ['Nucleus', 'Mitochondrion', 'Ribosome', 'Vacuole'], answerIdx: 1, bloom: 'remember',
  }]);
  const session = await repo.createSession({
    code, contentId: content._id, title: 'Cells quiz', ownerId: null, masteryGoal: 0.8, reattempts: 0, redemption: false,
  });
  for (let i = 0; i < n; i += 1) await answer(repo, session, q, i);
  await repo.saveProfile({ sessionId: session._id, rollNo: '23BIO01', name: 'Asha', history: [], workingLevel: 'understand' });
  return { session, q };
}

async function answer(repo, session, q, i) {
  const { _id, contentId, createdAt, status, ...rest } = q;
  await repo.recordAnswer({
    sessionId: session._id, answerKey: `k-${i}`, rollNo: '23BIO01', questionId: q._id, contentId,
    topic: q.topic, bloom: q.bloom, kind: q.kind, questionSnapshot: { id: String(_id), ...rest },
    response: 1, correct: true, score: 1,
  });
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const listed = (dir) => fs.readdirSync(dir).sort();

/* ------------------------------------------------------------ file names -- */

describe('archive file names stay inside the folder', () => {
  test('a room\'s file is named from its code and id', () => {
    assert.equal(archiveFileName({ code: 'abc234', id: '0123456789abcdef01234567' }), 'room-ABC234-0123456789abcdef01234567.json');
    assert.equal(archiveFileName({ code: 'ABC234', id: '11111111-2222-4333-8444-555555555555' }),
      'room-ABC234-11111111-2222-4333-8444-555555555555.json');
  });

  test('a code or id that is not a room\'s is refused, never cleaned up into a path', () => {
    for (const bad of [{ code: '../X', id: 'abc' }, { code: 'ABC', id: '../../etc' }, { code: 'A/B', id: 'x' },
      { code: 'ABC', id: 'x\\y' }, { code: '', id: 'x' }, { code: 'ABC', id: '' }, { code: 'ABC', id: 'a.json' }]) {
      assert.throws(() => archiveFileName(bad), /refusing to name an archive file/, JSON.stringify(bad));
    }
  });

  test('confinedPath refuses anything but a plain name in an absolute folder', () => {
    const dir = tempDir();
    assert.equal(confinedPath(dir, 'room-A-1.json'), path.join(dir, 'room-A-1.json'));
    for (const name of ['../x.json', 'sub/x.json', `..${path.sep}x.json`, '/etc/passwd', '.', '..', '', null]) {
      assert.throws(() => confinedPath(dir, name), /refusing to write/, String(name));
    }
    assert.throws(() => confinedPath('relative/folder', 'x.json'), /absolute/);
  });
});

/* ---------------------------------------------------------------- atomic -- */

describe('each write is atomic', () => {
  test('a write replaces the file whole, and leaves no temporary file', () => {
    const dir = tempDir();
    writeAtomic(dir, 'room-A-1.json', '{"v":1}');
    writeAtomic(dir, 'room-A-1.json', '{"v":2}');
    assert.deepEqual(readJson(path.join(dir, 'room-A-1.json')), { v: 2 });
    assert.deepEqual(listed(dir), ['room-A-1.json']);
  });

  test('a failure while writing or renaming leaves the old file as it was, and no temporary file', () => {
    const dir = tempDir();
    writeAtomic(dir, 'room-A-1.json', '{"v":1}');
    for (const step of ['writeSync', 'fsyncSync', 'renameSync']) {
      const broken = { ...fs, [step]: () => { throw Object.assign(new Error(`disk full at ${step}`), { code: 'ENOSPC' }); } };
      assert.throws(() => writeAtomic(dir, 'room-A-1.json', '{"v":2,"half":', { fs: broken }), /disk full/);
      assert.deepEqual(readJson(path.join(dir, 'room-A-1.json')), { v: 1 }, `after a failed ${step}`);
      assert.deepEqual(listed(dir), ['room-A-1.json'], `after a failed ${step}`);
    }
  });

  test('a short write is carried on from where it stopped until every byte is down', () => {
    const dir = tempDir();
    writeAtomic(dir, 'room-A-1.json', '{"v":1}');
    const text = JSON.stringify({ v: 2, note: 'Écrit en entier', answers: Array.from({ length: 60 }, (_, i) => i) });
    // A disk that takes at most 7 bytes a call and says how many, as write(2) may.
    const took = [];
    const short = { ...fs, writeSync: (fd, buf, off, len) => { const n = Math.min(7, len); took.push(n); return fs.writeSync(fd, buf, off, n); } };
    writeAtomic(dir, 'room-A-1.json', text, { fs: short });
    assert.equal(fs.readFileSync(path.join(dir, 'room-A-1.json'), 'utf8'), text);
    assert.equal(took.reduce((a, b) => a + b, 0), Buffer.byteLength(text, 'utf8'));
    assert.ok(took.length > 1, 'it took several writes');
    assert.deepEqual(listed(dir), ['room-A-1.json']);
  });

  test('a write that stops short (the disk filled) fails without renaming: the old file stays whole, no temporary file', () => {
    const dir = tempDir();
    writeAtomic(dir, 'room-A-1.json', '{"v":1}');
    const text = JSON.stringify({ v: 2, answers: Array.from({ length: 60 }, (_, i) => i) });
    // Half the bytes, then none: write(2) on a disk that has just filled.
    let calls = 0;
    const renamed = [];
    const full = {
      ...fs,
      writeSync: (fd, buf, off, len) => { calls += 1; return calls === 1 ? fs.writeSync(fd, buf, off, Math.floor(len / 2)) : 0; },
      renameSync: (from, to) => { renamed.push(to); return fs.renameSync(from, to); },
    };
    assert.throws(() => writeAtomic(dir, 'room-A-1.json', text, { fs: full }), /only \d+ of \d+ bytes could be written/);
    assert.equal(calls, 2);
    assert.deepEqual(renamed, [], 'nothing renamed over the last whole file');
    assert.deepEqual(readJson(path.join(dir, 'room-A-1.json')), { v: 1 });
    assert.deepEqual(listed(dir), ['room-A-1.json']);
  });

  test('the temporary file is opened exclusively, in the same folder', () => {
    const dir = tempDir();
    const opened = [];
    const spy = { ...fs, openSync: (file, flags, mode) => { opened.push({ file, flags, mode }); return fs.openSync(file, flags, mode); } };
    writeAtomic(dir, 'room-A-1.json', '{}', { fs: spy });
    assert.equal(opened.length, 1);
    assert.equal(opened[0].flags, 'wx');
    assert.equal(opened[0].mode, 0o600, 'the laptop\'s own user only: a room file holds every question\'s key');
    assert.equal(path.dirname(opened[0].file), dir);
    assert.match(path.basename(opened[0].file), /^\.room-A-1\.json\.\d+\.[0-9a-f]{8}\.tmp$/);
  });

  test('the folder is made for the laptop\'s own user only', () => {
    const asked = [];
    const spy = { ...fs, mkdirSync: (dir, opts) => { asked.push(opts); return fs.mkdirSync(dir, opts); } };
    const dir = path.join(tempDir(), 'archives');
    createArchiveWriter({ getRepo: () => createMemoryRepo(), dir, source: SOURCE, log: quiet, fs: spy });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].mode, 0o700);
    assert.equal(asked[0].recursive, true);
  });
});

/* -------------------------------------------------------------- interval -- */

describe('the interval', () => {
  test('LAPTOP_ARCHIVE_SECONDS: a minute by default, whole seconds from 1 to 3600, anything else refused with a sentence', () => {
    assert.equal(ARCHIVE_EVERY_SECONDS, 60);
    assert.equal(archiveIntervalMs(undefined), 60000);
    assert.equal(archiveIntervalMs(''), 60000);
    assert.equal(archiveIntervalMs('5'), 5000);
    assert.equal(archiveIntervalMs('3600'), 3600000);
    for (const bad of ['0', '3601', '1.5', 'ten', '-3']) {
      assert.throws(() => archiveIntervalMs(bad), /LAPTOP_ARCHIVE_SECONDS must be a whole number of seconds from 1 to 3600/, bad);
    }
  });
});

/* ---------------------------------------------------------------- writer -- */

describe('the archive writer', () => {
  test('writes each room once per change, as a room archive with the laptop\'s run, inside its folder only', async () => {
    const base = tempDir();
    const dir = path.join(base, 'archives');
    const repo = createMemoryRepo();
    const { session, q } = await roomWith(repo);
    const writer = createArchiveWriter({ getRepo: () => repo, dir, intervalMs: 3600000, source: SOURCE, log: quiet });
    assert.equal(writer.folder, fs.realpathSync(dir), 'the folder is made, and resolved once');

    assert.equal(await writer.flush(), 1);
    const name = `room-LAPT01-${session._id}.json`;
    assert.deepEqual(listed(dir), [name]);
    assert.deepEqual(listed(base), ['archives'], 'nothing beside the folder');
    const data = readJson(path.join(dir, name));
    assert.deepEqual(data.laptop, SOURCE);
    assert.equal(data.room.code, 'LAPT01');
    assert.equal(decodeRoomArchive(data).answers.length, 1);

    assert.equal(await writer.flush(), 0, 'nothing changed, nothing written');
    assert.equal(writer.status().writes, 1);

    await answer(repo, session, q, 1);
    assert.equal(await writer.flush(), 1, 'a new answer is a change');
    assert.equal(decodeRoomArchive(readJson(path.join(dir, name))).answers.length, 2);
    assert.equal(writer.status().rooms, 1);
  });

  test('a deleted room\'s file becomes the archive its delete wrote', async () => {
    const dir = tempDir();
    const repo = createMemoryRepo();
    const { session } = await roomWith(repo);
    const writer = createArchiveWriter({ getRepo: () => repo, dir, intervalMs: 3600000, source: SOURCE, log: quiet });
    await writer.flush();
    const { buildRoomArchive } = await import('../src/services/archive.js');
    const { doc } = await buildRoomArchive(repo, await repo.getSession(session._id), { archivedBy: 'someone' });
    await repo.saveRoomArchive(doc);
    await repo.deleteSession(session._id);
    assert.equal(await writer.flush(), 1);
    const data = readJson(path.join(dir, `room-LAPT01-${session._id}.json`));
    assert.equal(data.archivedBy, 'someone');
    assert.deepEqual(data.laptop, SOURCE);
    assert.equal(await writer.flush(), 0, 'and is not written again');
  });

  test('a room whose code would make a path is not written anywhere, and says why', async () => {
    const base = tempDir();
    const dir = path.join(base, 'archives');
    const repo = createMemoryRepo();
    const content = await repo.createContent({ title: 'x', kind: 'syllabus', rawText: '', topics: [] });
    await repo.createSession({ code: '../../ESCAPE', contentId: content._id, ownerId: null });
    const logged = [];
    const writer = createArchiveWriter({ getRepo: () => repo, dir, intervalMs: 3600000, source: SOURCE, log: (l) => logged.push(l) });
    assert.equal(await writer.flush(), 0);
    assert.deepEqual(listed(dir), []);
    assert.deepEqual(listed(base), ['archives']);
    assert.match(writer.status().lastError, /refusing to name an archive file/);
    assert.ok(logged.some((l) => /could not save room/.test(l)));
  });

  test('a running room is written on the interval without anyone asking; a stopped writer writes once more and then no more', async () => {
    const dir = tempDir();
    const repo = createMemoryRepo();
    const { session, q } = await roomWith(repo);
    const writer = createArchiveWriter({ getRepo: () => repo, dir, intervalMs: 25, source: SOURCE, log: quiet });
    assert.equal(activeWriter(), null);
    writer.start();
    assert.equal(activeWriter(), writer);
    const file = path.join(dir, `room-LAPT01-${session._id}.json`);
    for (let i = 0; i < 40 && !fs.existsSync(file); i += 1) await wait(25);
    assert.ok(fs.existsSync(file), 'written within the interval');

    await answer(repo, session, q, 1);
    for (let i = 0; i < 40 && decodeRoomArchive(readJson(file)).answers.length < 2; i += 1) await wait(25);
    assert.equal(decodeRoomArchive(readJson(file)).answers.length, 2, 'a change is written at the next interval');

    await answer(repo, session, q, 2);
    await writer.stop();
    assert.equal(activeWriter(), null);
    assert.equal(decodeRoomArchive(readJson(file)).answers.length, 3, 'stop writes once more');
    await answer(repo, session, q, 3);
    await wait(120);
    assert.equal(decodeRoomArchive(readJson(file)).answers.length, 3, 'and then nothing more');
  });

  test('a room over the 4 MB an archive may be is still written, with a warning that it cannot be imported', async () => {
    const dir = tempDir();
    const repo = createMemoryRepo();
    const { session } = await roomWith(repo);
    const content = await repo.getContent((await repo.getSession(session._id)).contentId);
    const [big] = await repo.insertQuestions([{
      contentId: content._id, topic: 'Cells', text: 'x'.repeat(4200 * 1024), kind: 'open', bloom: 'create',
    }]);
    await answer(repo, session, big, 9);
    const logged = [];
    const writer = createArchiveWriter({ getRepo: () => repo, dir, intervalMs: 3600000, source: SOURCE, log: (l) => logged.push(l) });
    assert.equal(await writer.flush(), 1);
    assert.ok(fs.statSync(path.join(dir, `room-LAPT01-${session._id}.json`)).size > 4 * 1024 * 1024);
    assert.ok(logged.some((l) => /over the 4 MB/.test(l) && /cannot be imported/.test(l)), logged.join('\n'));
  });
});

/* ----------------------------------------------------------- laptop mode -- */

describe('laptop mode', () => {
  test('is asked for with --laptop or BLOOMLOOP_LAPTOP=1, and nothing else', () => {
    assert.equal(laptopRequested({ argv: ['node', 'index.js', '--laptop'], env: {} }), true);
    assert.equal(laptopRequested({ argv: ['node', 'index.js'], env: { BLOOMLOOP_LAPTOP: '1' } }), true);
    assert.equal(laptopRequested({ argv: ['node', 'index.js'], env: {} }), false);
    assert.equal(laptopRequested({ argv: ['node', 'index.js'], env: { BLOOMLOOP_LAPTOP: 'yes' } }), false);
  });

  test('LAN, link-local and loopback addresses, and nothing public', () => {
    for (const h of ['192.168.137.1', '10.0.0.5', '172.16.0.1', '172.31.255.254', '169.254.10.20', '127.0.0.1', 'localhost', '[::1]']) {
      assert.equal(isLanHost(h), true, h);
    }
    for (const h of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', 'example.com', '300.1.1.1', '', null]) {
      assert.equal(isLanHost(h), false, String(h));
    }
  });

  test('switches every network service off, and allows its own addresses on its own port only while on', () => {
    const saved = JSON.parse(JSON.stringify(config));
    try {
      config.supabase.url = 'http://supabase.invalid';
      config.supabase.serviceKey = 'k';
      config.gemini.apiKey = 'g';
      config.mongoUri = 'mongodb://nowhere.invalid';
      config.port = 5099;
      assert.equal(laptopOrigin('http://192.168.1.4:5099'), false, 'off: nothing new is allowed');
      assert.equal(laptopMode(), null);

      const dir = tempDir();
      const mode = enterLaptopMode({ env: { LAPTOP_ARCHIVE_DIR: dir, LAPTOP_ARCHIVE_SECONDS: '15' }, now: new Date('2026-11-20T03:30:00Z') });
      assert.equal(config.supabase.url, '');
      assert.equal(config.supabase.serviceKey, '');
      assert.equal(config.gemini.apiKey, '');
      assert.equal(config.mongoUri, '');
      assert.equal(mode.archiveDir, path.resolve(dir));
      assert.equal(mode.intervalMs, 15000);
      assert.match(mode.run, /^[0-9a-f]{8}$/);
      assert.equal(mode.startedAt, '2026-11-20T03:30:00.000Z');

      // This laptop's own addresses, as its adapters would list them.
      const own = { addresses: ['192.168.1.4', '10.0.0.2'] };
      assert.equal(laptopOrigin(undefined), true, 'no Origin: nothing to decide');
      assert.equal(laptopOrigin('http://192.168.1.4:5099', null, own), true);
      assert.equal(laptopOrigin('https://10.0.0.2:5099', null, own), true);
      assert.equal(laptopOrigin('http://localhost:5099', null, own), true);
      assert.equal(laptopOrigin('http://127.0.0.1:5099', null, own), true);
      assert.equal(laptopOrigin('http://192.168.1.4:5173', null, own), false, 'another port on the LAN is another server');
      assert.equal(laptopOrigin('http://192.168.1.77:5099', null, own), false,
        'another device on the hotspot, on this port: its pages are not this server\'s');
      assert.equal(laptopOrigin('http://192.168.137.77:5099'), false, 'read from the adapters when not given: never another device');
      assert.equal(laptopOrigin('http://8.8.8.8:5099', null, own), false);
      assert.equal(laptopOrigin('http://evil.example:5099', null, own), false);
      assert.equal(laptopOrigin('file://x', null, own), false);
      assert.equal(laptopOrigin('not a url', null, own), false);
      assert.equal(laptopOrigin('http://bloomloop.local:5099', 'bloomloop.local:5099'), true, 'the page came from the address it calls');
      assert.ok(config.teacherKey.length >= 24, 'no TEACHER_KEY: the laptop draws a long random key');

      const lines = laptopBanner({ addresses: [{ address: '192.168.137.1', name: 'Wi-Fi hotspot' }], clientBuilt: false }).join('\n');
      assert.match(lines, /LAPTOP MODE/);
      assert.match(lines, /http:\/\/192\.168\.137\.1:5099\/join {3}<- Wi-Fi hotspot/);
      assert.ok(lines.includes(path.resolve(dir)), 'says where the archives are');
      assert.match(lines, /every 15 s/);
      for (const u of UNAVAILABLE) assert.ok(lines.includes(u));
      assert.match(lines, /client\/dist is not built/);
      assert.match(laptopBanner({ addresses: [] }).join('\n'), /NO NETWORK YET/);

      assert.throws(() => enterLaptopMode({ env: { LAPTOP_ARCHIVE_SECONDS: '0' } }), /LAPTOP_ARCHIVE_SECONDS/);
      // A short TEACHER_KEY stops the start, with a sentence that says what to do.
      assert.throws(() => enterLaptopMode({ env: { TEACHER_KEY: 'mango' } }), /TEACHER_KEY is 5 characters.*at least 16/);
      assert.throws(() => enterLaptopMode({ env: { TEACHER_KEY: 'fifteen-chars-x' } }), /at least 16/);
      enterLaptopMode({ env: { TEACHER_KEY: 'sixteen-chars-xy' } });
    } finally {
      leaveLaptopMode();
      Object.assign(config.supabase, saved.supabase);
      Object.assign(config.gemini, saved.gemini);
      config.mongoUri = saved.mongoUri;
      config.port = saved.port;
    }
    assert.equal(laptopOrigin('http://192.168.1.4:5099', null, { addresses: ['192.168.1.4'] }), false, 'and nothing once left');
  });

  test('wrong teacher keys: ten different ones from one address shut it out of the key for ten minutes, right key included; laptop mode only', () => {
    const saved = config.teacherKey;
    const t0 = Date.parse('2026-11-19T10:00:00Z');
    try {
      config.teacherKey = 'RIGHT-KEY-0123456789';
      forgetKeyFailures();
      // Off: nothing is counted, a deployed server behind its proxy sees one address for all.
      for (let i = 0; i < 50; i += 1) assert.equal(checkTeacherKey('wrong', '10.0.0.9', t0 + i), 'wrong');
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '10.0.0.9', t0 + 60), 'ok');

      enterLaptopMode({ env: { LAPTOP_ARCHIVE_DIR: tempDir(), TEACHER_KEY: 'RIGHT-KEY-0123456789' } });
      config.teacherKey = 'RIGHT-KEY-0123456789';
      assert.equal(checkTeacherKey('', '10.0.0.9', t0), 'none', 'no key sent is not a wrong key');
      for (let i = 0; i < KEY_TRIES - 1; i += 1) assert.equal(checkTeacherKey(`guess${i}`, '10.0.0.9', t0 + i), 'wrong');
      assert.equal(checkTeacherKey('guess-last', '::ffff:10.0.0.9', t0 + 20), 'blocked', 'the tenth, the same address however written');
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '10.0.0.9', t0 + 30), 'blocked', 'the right key too, while shut out');
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '10.0.0.8', t0 + 30), 'ok', 'another address is not shut out');
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '10.0.0.9', t0 + 20 + KEY_WINDOW_MS + 1), 'ok', 'ten minutes later');
      // Fewer than ten in the window, spread out: never shut out; a right key clears the count.
      for (let i = 0; i < 30; i += 1) {
        assert.notEqual(checkTeacherKey(`slow-guess-${i}`, '10.0.0.7', t0 + i * (KEY_WINDOW_MS / 5)), 'blocked');
      }
      for (let i = 0; i < KEY_TRIES - 1; i += 1) checkTeacherKey(`typo${i}`, '10.0.0.6', t0 + i);
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '10.0.0.6', t0 + 10), 'ok');
      assert.equal(checkTeacherKey('typo-again', '10.0.0.6', t0 + 11), 'wrong', 'counted afresh after a right key');
      // A console tab still holding an earlier start's key sends that one wrong
      // key with every request: one key, however often, never shuts it out.
      for (let i = 0; i < 100; i += 1) assert.equal(checkTeacherKey('OLD-KEY-FROM-YESTERDAY', '127.0.0.1', t0 + i), 'wrong');
      assert.equal(checkTeacherKey('RIGHT-KEY-0123456789', '127.0.0.1', t0 + 200), 'ok', 'the new link still opens the console');
    } finally {
      leaveLaptopMode();
      forgetKeyFailures();
      config.teacherKey = saved;
    }
  });

  test('lists IPv4 addresses phones could reach, private first, link-local last, never loopback', () => {
    const list = lanAddresses({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      vpn: [{ family: 'IPv4', internal: false, address: '100.64.0.2' }],
      apipa: [{ family: 'IPv4', internal: false, address: '169.254.3.4' }],
      hotspot: [{ family: 'IPv4', internal: false, address: '192.168.137.1' }, { family: 'IPv6', internal: false, address: 'fe80::1' }],
    });
    assert.deepEqual(list.map((a) => a.address), ['192.168.137.1', '100.64.0.2', '169.254.3.4']);
    assert.equal(list[0].name, 'hotspot');
  });
});
