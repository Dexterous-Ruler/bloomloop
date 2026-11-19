/**
 * Teacher-laptop-as-server (Phase 7, decision O4).
 *
 * The same server, run on the professor's own laptop in a room with no
 * internet: phones join over the laptop's hotspot or a pocket travel router,
 * and the laptop is the whole of BloomLoop for that class.
 *
 *   npm --workspace server run laptop        (from the repository's root)
 *   node server/src/index.js --laptop        (the same thing)
 *
 * What changes in this mode, and nothing changes in any other:
 *
 *   no network services   Supabase, MongoDB, Gemini and Google Classroom are
 *                         switched off whatever server/.env says, before the
 *                         store is chosen, so the laptop never waits on (or
 *                         talks to) a service it cannot reach. The store is the
 *                         in-process one; questions come from the offline
 *                         templates or the professor's own writing.
 *   the network           the server listens on every interface (as always) and
 *                         prints each LAN address with the console and join
 *                         links, and prints a new one when the hotspot or the
 *                         router's network comes up after the server did.
 *   origins               a browser page on this laptop's own network or
 *                         loopback address, on this server's port, is allowed,
 *                         for the API's CORS and for the socket (laptopOrigin
 *                         below). The socket is held to that list instead of
 *                         any origin.
 *   the teacher key       at least LAPTOP_KEY_MIN characters, or drawn long at
 *                         every start; wrong keys are counted per address and
 *                         an address that tries too many is shut out of the
 *                         key for a while (teacherAuth.js).
 *   archives              every room is written to a folder on the laptop's
 *                         disk (services/laptopArchive.js), at every close and
 *                         every LAPTOP_ARCHIVE_SECONDS while it runs, so a crash
 *                         loses at most that interval. Those files are what the
 *                         professor imports once back online.
 *
 * What is unavailable is listed in UNAVAILABLE, printed at start and served to
 * the console. docs/TRAVEL_ROUTER.md is the professor's guide.
 */

import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { config, ROOT } from './config.js';
import { archiveIntervalMs } from './services/laptopArchive.js';

/** Where the archives go unless LAPTOP_ARCHIVE_DIR says otherwise: inside server/.data, which git ignores. */
export const DEFAULT_ARCHIVE_DIR = path.join(ROOT, 'server', '.data', 'laptop-archives');

/** What a professor cannot do on the laptop, in their words. */
export const UNAVAILABLE = Object.freeze([
  'Accounts and signing in: use the console link printed here, which carries the laptop\'s own teacher key.',
  'Generating questions with AI: the offline templates and questions you write yourself work.',
  'Google Classroom.',
  'The student Learning Hub, which needs student accounts.',
  'Anything kept between restarts except the room archives: chapters, questions, classes and rosters made on the laptop '
    + 'are held in its memory and are gone when the server stops.',
]);

const state = { on: false };

/** Was laptop mode asked for: `--laptop` on the command line, or BLOOMLOOP_LAPTOP=1. */
export function laptopRequested({ argv = process.argv, env = process.env } = {}) {
  return argv.includes('--laptop') || String(env.BLOOMLOOP_LAPTOP ?? '').trim() === '1';
}

/**
 * The shortest TEACHER_KEY laptop mode starts with. The key is the console's
 * only guard there, on a Wi-Fi every student has joined: a word "only you know"
 * falls to a word list in minutes. With no TEACHER_KEY the laptop draws one of
 * LAPTOP_KEY_BYTES random bytes, 24 characters, at every start.
 */
export const LAPTOP_KEY_MIN = 16;
const LAPTOP_KEY_BYTES = 12;

/**
 * Switch the server into laptop mode. Called once, before the store is chosen.
 * Throws with a sentence for a bad LAPTOP_ARCHIVE_SECONDS, so a typo stops the
 * start rather than saving every ten hours, and for a TEACHER_KEY shorter than
 * LAPTOP_KEY_MIN.
 */
export function enterLaptopMode({ env = process.env, now = new Date() } = {}) {
  const setKey = String(env.TEACHER_KEY ?? '').trim();
  if (setKey && setKey.length < LAPTOP_KEY_MIN) {
    throw new Error(`TEACHER_KEY is ${setKey.length} characters, and laptop mode needs at least ${LAPTOP_KEY_MIN}: it is the `
      + 'only thing guarding the teacher console on a Wi-Fi every student has joined. Remove TEACHER_KEY from server/.env '
      + 'to have the laptop make a long random key at every start, or set one of 16 or more random characters.');
  }
  // The key the server made at boot (config.js) is 8 characters, for a server
  // whose console is reached over the internet; on the class's own Wi-Fi it is
  // made longer.
  if (!setKey) config.teacherKey = crypto.randomBytes(LAPTOP_KEY_BYTES).toString('hex').toUpperCase();
  // Off whatever .env holds: the laptop has no internet, and a configured
  // service would only make the boot wait for a connection that never comes.
  config.supabase.url = '';
  config.supabase.serviceKey = '';
  config.supabase.anonKey = '';
  config.mongoUri = '';
  config.gemini.apiKey = '';
  config.classroom.clientId = '';
  config.classroom.clientSecret = '';

  const raw = String(env.LAPTOP_ARCHIVE_DIR ?? '').trim();
  Object.assign(state, {
    on: true,
    // Which run of the laptop server wrote an archive: a random tag, not the
    // machine's name, which may carry its owner's.
    run: crypto.randomBytes(4).toString('hex'),
    startedAt: now.toISOString(),
    archiveDir: path.resolve(raw || DEFAULT_ARCHIVE_DIR),
    intervalMs: archiveIntervalMs(env.LAPTOP_ARCHIVE_SECONDS),
  });
  return laptopMode();
}

/** The mode as it stands, or null when the server is not in laptop mode. */
export function laptopMode() {
  if (!state.on) return null;
  const { run, startedAt, archiveDir, intervalMs } = state;
  return { run, startedAt, archiveDir, intervalMs };
}

/** For the tests: leave laptop mode (config is not restored). */
export function leaveLaptopMode() {
  state.on = false;
}

const PRIVATE_V4 = [
  [10, 0, 0, 0, 8],
  [172, 16, 0, 0, 12],
  [192, 168, 0, 0, 16],
  [169, 254, 0, 0, 16], // link-local: a laptop hotspot with no DHCP hands these out
];

function v4Parts(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

const asInt = (p) => ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];

/** Is this an address only a local network or this machine can have? */
export function isLanHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1') return true;
  const p = v4Parts(h);
  if (!p) return false;
  if (p[0] === 127) return true;
  return PRIVATE_V4.some(([a, b, c, d, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((asInt(p) & mask) >>> 0) === ((asInt([a, b, c, d]) & mask) >>> 0);
  });
}

/**
 * May a browser page from `origin` call this server in laptop mode? Always
 * false outside laptop mode, where the CORS allow-list and the socket's own
 * setting stand as they were.
 *
 *   no Origin        a same-origin GET, a script, a test: nothing to decide
 *   same origin      the page came from the address the request was sent to
 *                    (`host`, the request's Host header), whatever that address
 *                    is: a phone always reaches the laptop this way
 *   this laptop      http or https, on this server's own port, at loopback
 *                    (or localhost) or one of this laptop's own network
 *                    addresses (`addresses`, read from its adapters when not
 *                    given, so a hotspot turned on later is included)
 *
 * Anything else is not: another device's address on the hotspot, even on this
 * port, serves pages that are not this server's. Any private address used to
 * pass, which let a page a student's own device served on port 5050 in.
 */
export function laptopOrigin(origin, host = null, { addresses = null } = {}) {
  if (!state.on) return false;
  if (!origin) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (host && url.host.toLowerCase() === String(host).toLowerCase()) return true;
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  if (port !== String(config.port)) return false;
  const name = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(name)) return true;
  return (addresses ?? lanAddresses().map((a) => a.address)).includes(name);
}

/** The socket's options in laptop mode: LAN origins only, by the same rule as the API. */
export function laptopSocketOptions() {
  return {
    pingTimeout: 20000,
    cors: { origin: (origin, cb) => cb(null, laptopOrigin(origin)) },
    // CORS is not consulted for a WebSocket upgrade; this is, for every
    // handshake, and it has the Host header to tell a same-origin page.
    allowRequest: (req, cb) => cb(null, laptopOrigin(req.headers.origin, req.headers.host)),
  };
}

/**
 * Every IPv4 address a phone could reach this laptop on, private ones first:
 * the hotspot's or the router's is among them, and a VPN or virtual adapter's
 * comes after. With the adapter's name, which tells the professor which is which.
 */
export function lanAddresses(interfaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push({ address: ni.address, name });
    }
  }
  const rank = (a) => (a.address.startsWith('169.254.') ? 2 : isLanHost(a.address) ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** The links for one address: the console (with the key) and the page phones open. */
export function linksFor(address, { port = config.port, key = config.teacherKey } = {}) {
  const origin = `http://${address}:${port}`;
  return { console: `${origin}/?key=${key}`, join: `${origin}/join` };
}

/** The start banner in laptop mode. Lines only; the caller prints them. */
export function laptopBanner({ mode = laptopMode(), addresses = lanAddresses(), clientBuilt = true } = {}) {
  const bar = '='.repeat(64);
  const lines = [bar, '  BloomLoop - LAPTOP MODE: this laptop is the server, no internet needed', bar];
  if (addresses.length) {
    const first = linksFor(addresses[0].address);
    lines.push(`  Teacher console : ${first.console}`);
    lines.push('                    ^ open THIS link on this laptop (the wall\'s QR code shows the address you open it on)');
    lines.push('  Students join   : (open the one on the hotspot or router\'s network)');
    for (const a of addresses) lines.push(`                    ${linksFor(a.address).join}   <- ${a.name}`);
  } else {
    lines.push(`  Teacher console : http://localhost:${config.port}/?key=${config.teacherKey}`);
    lines.push('  Students join   : NO NETWORK YET. Turn on the hotspot or join the travel router\'s Wi-Fi;');
    lines.push('                    the address phones need is printed here as soon as it appears.');
  }
  lines.push('');
  lines.push(`  Room archives   : ${mode.archiveDir}`);
  lines.push(`                    saved at every close and every ${Math.round(mode.intervalMs / 1000)} s while a room runs`);
  lines.push(`  This run        : ${mode.run} (started ${mode.startedAt})`);
  lines.push('  Not available here:');
  for (const u of UNAVAILABLE) lines.push(`    - ${u}`);
  if (!clientBuilt) {
    lines.push('');
    lines.push('  NOTE: client/dist is not built, so phones have no page to open. Run `npm run build` while you');
    lines.push('        still have internet, then start laptop mode again.');
  }
  lines.push(bar);
  return lines;
}

/**
 * Print each address that appears after the start (the hotspot turned on late,
 * the router joined), checking every `everyMs`. Returns the stop function.
 */
export function watchAddresses({ everyMs = 10000, log = console.log } = {}) {
  let known = new Set(lanAddresses().map((a) => a.address));
  const timer = setInterval(() => {
    const now = lanAddresses();
    for (const a of now) {
      if (!known.has(a.address)) log(`[laptop] new network address (${a.name}): phones join at ${linksFor(a.address).join}`);
    }
    known = new Set(now.map((a) => a.address));
  }, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
