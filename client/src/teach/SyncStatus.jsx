/**
 * Where the console's records stand (Phase 7, gap F1): a pill in the header,
 * the "Sync status" dialog it opens, and the offline banner (the older file's
 * #10). The records themselves are lib/consoleOutbox.js's.
 *
 *   Synced 09:52            nothing waiting
 *   Offline · 4 waiting     kept on this device, sent when it reconnects
 *   Syncing · 4 records     going now, oldest first
 *   4 waiting to sync       the server is not taking them just now
 *   1 refused               the server said no: the dialog says why, with
 *                           the record as it stands, to send again or discard
 *
 * A record the screen got an answer for at once never shows here. Only what
 * waited (and anything refused that is still to be decided) does.
 *
 * The views are pure, for the gallery: SyncPill, SyncDialog, SyncBannerView.
 */

import { useEffect, useState } from 'react';

import {
  discard, resend, syncNow, useOutbox, useOutboxNotices,
} from '../lib/consoleOutbox.js';
import { Button, Dialog, Icon, Note } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';

import '../styles/sync.css';

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const clock = (iso) => {
  const at = new Date(iso);
  return iso && !Number.isNaN(at.getTime()) ? CLOCK.format(at) : '';
};
const records = (n) => `${n} ${n === 1 ? 'record' : 'records'}`;

/** What each kind of record is called in the list. */
const KIND = {
  observe: 'Observation',
  attendance: 'Attendance',
  pick: 'Wheel pick',
  draw: 'Wheel draw',
  round: 'New wheel round',
  wheel: 'Wheel setting',
  tallyCreate: 'Question asked aloud',
  tallyEdit: 'Raised hands',
  tallyStep: 'Raised hands',
  activityCreate: 'Activity',
  activityEdit: 'Activity',
  insight: 'Insight card',
};

const ATTENDED = { present: 'Present', late: 'Late', absent: 'Absent', unmarked: 'Unmarked' };

const rowsOf = (body) => (Array.isArray(body) ? body : [...(body?.students ?? []), ...(body?.removed ?? [])]);

/**
 * The record as the server has it now, in a line, from a stale refusal's
 * `current` (and, for attendance, `newer`). Empty when there is nothing to say.
 */
export function describeCurrent(item) {
  const { kind, intent, refusal } = item;
  const cur = refusal?.current;
  const at = (iso) => (clock(iso) ? ` at ${clock(iso)}` : '');
  switch (kind) {
    case 'observe':
      if (!cur) return 'No mark for today.';
      return `${cur.label ?? 'Cleared'}${cur.note ? `: “${cur.note}”` : ''}${at(cur.observedAt)}${cur.room && cur.room !== intent?.code ? `, in room ${cur.room}` : ''}.`;
    case 'attendance': {
      // `newer` names who moved on; the register (`current`) has their roll numbers.
      const rows = rowsOf(cur);
      return rowsOf(refusal?.newer).map((n) => {
        const r = rows.find((x) => x.studentId === n.studentId) ?? n;
        return `${r.rollNo ? `${r.rollNo}${r.name ? ` ${r.name}` : ''}` : 'A student'}: ${ATTENDED[r.status] ?? r.status}${at(r.markedAt)}`;
      }).join('; ');
    }
    case 'pick':
      return cur ? `${cur.status === 'pending' ? 'Not filled in' : cur.statusLabel ?? cur.status}${cur.askLabel ? ` · ${cur.askLabel}` : ''}${at(cur.statusAt)}.` : '';
    case 'tallyEdit':
      return cur?.options ? `${cur.options.map((o) => `${o.key} ${o.count}`).join(', ')}${cur.revealed ? ', answer shown' : ''}${cur.correct ? `, correct ${cur.correct}` : ''}.` : '';
    case 'activityEdit':
      return cur ? `${cur.outcome || 'No outcome written'}${cur.groups?.length ? ` · ${cur.groups.length} groups` : ''}.` : '';
    case 'insight': {
      const last = cur?.lastAction ?? cur;
      return last?.action ? `${last.action === 'dismissed' ? 'Dismissed' : 'Acted on'}${at(last.actedAt)}.` : '';
    }
    default:
      return '';
  }
}

/* ------------------------------------------------------------- the pill */

/** The header's pill. `sync` is useOutbox()'s snapshot. */
export function SyncPill({ sync, onOpen }) {
  const { mode, waiting, refused, lastSyncAt } = sync;
  let text;
  let icon = null;
  let tone = mode;
  if (mode === 'syncing') text = `Syncing · ${records(waiting)}`;
  else if (mode === 'offline') { text = `Offline · ${waiting} waiting`; icon = 'wifiOff'; }
  else if (mode === 'waiting') { text = `${waiting} waiting to sync`; icon = 'clock'; }
  else if (refused) { text = `${refused} refused`; icon = 'alert'; tone = 'refused'; }
  else { text = lastSyncAt ? `Synced ${clock(lastSyncAt)}` : 'Synced'; icon = 'ok'; }
  // A phone-width header has no room for the words: the count alone, and
  // nothing at all when all is synced (the banner speaks while offline).
  const short = tone === 'synced' ? '' : String(tone === 'refused' ? refused : waiting);
  return (
    <button type="button" className="sync-pill" data-tone={tone} onClick={onOpen} aria-haspopup="dialog" aria-label={`${text}. Sync status`}>
      {mode === 'syncing' ? <span className="spinner sync-spin" aria-hidden="true" /> : <Icon name={icon} size={13} />}
      <span className="sync-pill-t">{text}</span>
      {short && <span className="sync-pill-n mono" aria-hidden="true">{short}</span>}
    </button>
  );
}

/* ------------------------------------------------------------ the dialog */

function Waiting({ item }) {
  return (
    <li className="sync-row">
      <time className="mono sync-time">{clock(item.queuedAt)}</time>
      <span className="sync-what">
        <b>{KIND[item.kind] ?? 'Record'}</b>
        <span className="clip">{item.label}</span>
      </span>
      <span className="sync-state" data-state={item.status}>
        {item.status === 'sending' ? <><span className="spinner sync-spin" aria-hidden="true" />Sending</> : 'Queued'}
      </span>
    </li>
  );
}

function Refused({ item, onResend, onDiscard }) {
  const [sure, setSure] = useState(false);
  const r = item.refusal ?? {};
  const now = r.stale ? describeCurrent(item) : '';
  return (
    <li className="sync-row sync-refused">
      <time className="mono sync-time">{clock(item.queuedAt)}</time>
      <div className="sync-what">
        <b>{KIND[item.kind] ?? 'Record'}</b>
        <span>{item.label}</span>
        <p className="sync-why" role="note"><Icon name="alert" size={13} />{r.error}</p>
        {r.stale && (
          <p className="sync-now">
            <span className="eyebrow">On the server now</span>
            <span>{now || 'It was changed after this record was made.'}</span>
          </p>
        )}
        <p className="sync-hint">
          {r.stale
            ? 'Send again to put yours over it, or discard yours to keep what is there.'
            : 'The server will not take this record as it is. It stays here until you discard it.'}
        </p>
        <div className="cluster sync-acts">
          {r.stale && <Button size="sm" variant="primary" icon="send" onClick={() => onResend?.(item.id)}>Send again</Button>}
          {sure ? (
            <>
              {/* The pressed Discard is gone, so the focus moves to what replaced it. */}
              <Button size="sm" variant="ink" icon="trash" autoFocus onClick={() => onDiscard?.(item.id)}>Discard for good</Button>
              <Button size="sm" variant="ghost" onClick={() => setSure(false)}>Keep it</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setSure(true)}>Discard</Button>
          )}
        </div>
      </div>
    </li>
  );
}

/** One sentence for each state, as the design has them. */
function stateLine(sync) {
  if (sync.mode === 'offline') return 'Saved on this device and sent when you reconnect. Nothing is discarded, even if the app closes.';
  if (sync.mode === 'syncing') return 'Sending what was kept on this device to the school server, oldest first.';
  if (sync.mode === 'waiting') return 'The server is not taking records just now. They stay on this device until it does.';
  if (sync.refused) {
    return `Nothing is waiting. The server would not take ${sync.refused === 1 ? 'the record' : 'the records'} below, so ${sync.refused === 1 ? 'it stays' : 'they stay'} on this device until you decide.`;
  }
  return 'Every record is on the school server.';
}

export function SyncDialog({ open, onOpenChange, sync, onResend, onDiscard, onTryNow }) {
  const waiting = sync.items.filter((i) => i.status !== 'refused');
  const refused = sync.items.filter((i) => i.status === 'refused');
  const canTry = sync.mode === 'offline' || sync.mode === 'waiting';
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sync status"
      description={stateLine(sync)}
      footer={(
        <>
          <span className="sync-last grow">
            {sync.lastSyncAt ? <>Last synced <span className="mono">{clock(sync.lastSyncAt)}</span></> : 'Nothing sent from this device yet'}
          </span>
          {canTry && <Button icon="refresh" onClick={onTryNow}>Try now</Button>}
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </>
      )}
    >
      <div className="sync-dlg">
        {sync.mode === 'waiting' && sync.reason && <Note tone="warn">The server said: {sync.reason}</Note>}
        {!sync.disk && (
          <Note tone="warn">
            This browser is not keeping records on disk, so they last only as long as this tab. Keep it open until they are sent.
          </Note>
        )}
        {refused.length > 0 && (
          <section aria-labelledby="sync-refused-h">
            <h3 id="sync-refused-h" className="sync-h">Refused by the server <span className="mono">{refused.length}</span></h3>
            <ul className="sync-list">
              {refused.map((i) => <Refused key={i.id} item={i} onResend={onResend} onDiscard={onDiscard} />)}
            </ul>
          </section>
        )}
        <section aria-labelledby="sync-waiting-h">
          <h3 id="sync-waiting-h" className="sync-h">Waiting to sync <span className="mono">{waiting.length}</span></h3>
          {waiting.length === 0 ? (
            <p className="sync-none"><Icon name="ok" size={15} />Nothing waiting. Every record is on the school server.</p>
          ) : (
            <ul className="sync-list">{waiting.map((i) => <Waiting key={i.id} item={i} />)}</ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ the banner */

/**
 * The older file's offline banner: while the network is gone, and while what
 * waited goes out. Honest about what is here: records made now are kept; a
 * screen not read yet is not.
 */
export function SyncBannerView({ sync, onOpen }) {
  if (!sync.offline && sync.mode !== 'syncing') return null;
  const syncing = !sync.offline;
  return (
    <div className="sync-banner" data-mode={syncing ? 'syncing' : 'offline'} role="status">
      {syncing ? <span className="spinner sync-spin" aria-hidden="true" /> : <Icon name="wifiOff" size={16} />}
      <p className="grow">
        <b>{syncing ? 'Back online' : 'Working offline'}</b>
        {syncing
          ? <span>Sending {records(sync.waiting)} kept on this device, oldest first.</span>
          : <span>Records you make are kept on this device and sent when you reconnect. Nothing is discarded. Anything not read yet waits for the connection.</span>}
      </p>
      <button type="button" className="sync-banner-n mono" onClick={onOpen}>
        {sync.waiting} unsynced{sync.lastSyncAt ? ` · last sync ${clock(sync.lastSyncAt)}` : ''}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ connected */

// The banner's count opens the header's dialog.
const openers = new Set();

/** The pill and its dialog, on the outbox's live state. Mount once, in the console's header. */
export default function SyncStatus() {
  const sync = useOutbox();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const fn = () => setOpen(true);
    openers.add(fn);
    return () => { openers.delete(fn); };
  }, []);
  useOutboxNotices(toast);
  return (
    <>
      <SyncPill sync={sync} onOpen={() => setOpen(true)} />
      <SyncDialog open={open} onOpenChange={setOpen} sync={sync} onResend={resend} onDiscard={discard} onTryNow={syncNow} />
    </>
  );
}

/** The banner on the outbox's live state; its count opens the header's dialog. */
export function SyncBanner() {
  const sync = useOutbox();
  return <SyncBannerView sync={sync} onOpen={() => openers.forEach((fn) => fn())} />;
}
