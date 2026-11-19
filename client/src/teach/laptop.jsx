/**
 * Laptop mode, as the console sees it (Phase 7, decision O4): the server runs
 * on the professor's own laptop with no internet, and phones join over its
 * hotspot or a pocket travel router.
 *
 *   useLaptop(enabled)        GET /api/laptop, once per page load. A reply is
 *                             kept for the page; a refusal is not, so a key
 *                             typed again asks again. `blocked` is the 429 a
 *                             device gets after too many wrong keys, with the
 *                             server's sentence in `error`.
 *   <LaptopBanner data />     "Running on this laptop", where rooms are saved,
 *                             the last save, a failed save, what is not here,
 *                             and a warning when the console is not at localhost
 *   isLoopback()              this page was opened at localhost
 *   joinOrigin(data)          where phones join: the laptop's network address
 *                             when the console is at localhost (null: none yet)
 *   wallSearch(data)          the same, for the wall's link
 *   <NoNetworkWarning />      the laptop has no address a phone can reach
 *
 * Nothing here draws the teacher key: the join links the server sends carry
 * none, and the console link it prints is never asked for. Nothing offers to
 * open the console on another device.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Icon, Note, Tip } from '../ui/index.jsx';
import '../styles/imports.css';

const list = (v) => (Array.isArray(v) ? v : []);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const CLOCK = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const stamp = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : CLOCK.format(d); };

/* ------------------------------------------------------------------ the read */

// One reply per page: the mode does not change while the server runs.
let kept = null;
let inFlight = null;

function readLaptop(fresh) {
  if (!fresh && kept) return Promise.resolve(kept);
  if (!fresh && inFlight) return inFlight;
  const p = api.laptop().then((data) => { kept = data; return data; });
  inFlight = p;
  p.finally(() => { if (inFlight === p) inFlight = null; }).catch(() => {});
  return p;
}

/**
 * The laptop's status for this page. `enabled` false sends nothing (no key and
 * no account yet: the route is staff only). A server without Phase 7 answers
 * 404, which reads as "not a laptop".
 */
export function useLaptop(enabled = true) {
  const [s, setS] = useState(() => ({ status: kept ? 'ready' : 'idle', data: kept, error: '', code: 0 }));

  const run = useCallback((fresh) => {
    setS((p) => ({ ...p, status: p.data ? 'ready' : 'loading', reading: true }));
    readLaptop(fresh).then(
      (data) => setS({ status: 'ready', data, error: '', code: 0, reading: false }),
      (err) => setS((p) => ({ status: 'error', data: err.status === 429 || err.status === 401 ? null : p.data, error: err.message, code: err.status ?? 0, reading: false })),
    );
  }, []);

  useEffect(() => { if (enabled) run(false); }, [enabled, run]);

  return {
    ...s,
    laptop: s.data?.laptop === true,
    blocked: s.code === 429,
    refused: s.code === 401,
    retry: () => run(true),
  };
}

/* ----------------------------------------------------------------- the banner */

/**
 * A quiet strip over the page while the console runs on the laptop. Nothing
 * at all on any other server.
 *
 * @param data      the GET /api/laptop reply
 * @param onReread  read it again (the last save moves while a room runs)
 */
export function LaptopBanner({ data, onReread, reading = false }) {
  if (!data?.laptop) return null;
  const a = data.archives ?? {};
  const every = Number(a.intervalSeconds);
  const unavailable = list(data.unavailable).filter(Boolean);
  const saved = Number(a.rooms) || 0;

  return (
    <section className="lp-bar" aria-label="Laptop mode">
      <span className="lp-ic" aria-hidden="true"><Icon name="laptop" size={16} /></span>
      <div className="lp-main">
        <p className="lp-say">
          <b>Running on this laptop.</b>{' '}
          Rooms are saved to <span className="lp-path">{a.folder || 'the laptop’s archive folder'}</span>
          {Number.isFinite(every) && every > 0 ? ` every ${every} s` : ''} and when closed.
        </p>
        <p className="lp-meta">
          {a.lastWriteAt
            ? <>Last saved <time dateTime={a.lastWriteAt}>{stamp(a.lastWriteAt)}</time>{saved ? `, ${plural(saved, 'room')} on disk` : ''}</>
            : 'Nothing saved yet: a room is saved once it has something to keep'}
          {data.run && <> · this run <span className="mono">{data.run}</span></>}
        </p>
        {!isLoopback() && (
          <p className="lp-warn" role="note">
            <Icon name="shield" size={14} />
            <span>
              This console is open at {typeof window === 'undefined' ? 'a network address' : window.location.host}, which every
              device on this Wi-Fi can reach. Use it on this laptop only, and lock the console before you step away.
            </span>
          </p>
        )}
        {a.lastError && (
          <p className="lp-err" role="alert">
            <Icon name="alert" size={14} />
            <span>A save failed: {a.lastError}. The laptop tries again at the next save.</span>
          </p>
        )}
        {unavailable.length > 0 && (
          <details className="lp-more">
            <summary>Not available on the laptop <span className="lp-n">{unavailable.length}</span></summary>
            <ul>{unavailable.map((u) => <li key={u}>{u}</li>)}</ul>
          </details>
        )}
      </div>
      {onReread && (
        <Tip label="Read the laptop’s status again">
          <Button variant="ghost" size="sm" icon="refresh" busy={reading} aria-label="Read the laptop’s status again" onClick={onReread} />
        </Tip>
      )}
    </section>
  );
}

/* ------------------------------------------------- where phones reach the laptop */

/** Is this page open at an address only this machine can reach? */
export function isLoopback(host = typeof window === 'undefined' ? '' : window.location.hostname) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '');
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

/**
 * The origin phones join on. Normally this page's own. On the laptop with the
 * console at localhost, the laptop's first network address from GET
 * /api/laptop's `join`, so the projector's link and QR work on a phone; null
 * when the laptop has no network address yet (nothing a phone can reach).
 */
export function joinOrigin(data) {
  const here = typeof window === 'undefined' ? '' : window.location.origin;
  if (!data?.laptop || !isLoopback()) return here;
  const links = joinChoices(data);
  return (links.find((j) => j.origin === chosen) ?? links[0])?.origin ?? null;
}

/** The laptop's network addresses as { network, origin }, in the server's order. */
export function joinChoices(data) {
  const out = [];
  for (const j of list(data?.join)) {
    try { out.push({ network: j.network || '', origin: new URL(j.url).origin }); } catch { /* not a link */ }
  }
  return out;
}

// The network the professor picked on the projector, for this page: a laptop
// can have several (the hotspot, a router, a virtual adapter), and only one of
// them is the class's. The wall's link follows it.
let chosen = '';
export function chooseJoin(origin) { chosen = origin; }

/**
 * What the console adds to the wall's link on the laptop at localhost: the
 * address phones join on (`?join=`), or `?laptop=1` when there is none yet,
 * so the wall can say so. Nothing on any other server. Never the key.
 */
export function wallSearch(data) {
  if (!data?.laptop || !isLoopback()) return '';
  const origin = joinOrigin(data);
  return origin ? `?join=${encodeURIComponent(origin)}` : '?laptop=1';
}

/**
 * On the projector, on the laptop at localhost, when the laptop has no network
 * address: a phone cannot reach localhost, so there is no link to give yet.
 */
export function NoNetworkWarning({ className = '' }) {
  return (
    <Note tone="warn" icon="alert" className={`lp-local ${className}`} role="alert">
      <b>Phones cannot reach this laptop yet.</b>{' '}
      It has no network address, and {typeof window === 'undefined' ? 'localhost' : window.location.host} is an address only
      this laptop can open. Turn on the hotspot or join the travel router’s Wi-Fi; the address phones need then shows here.
    </Note>
  );
}
