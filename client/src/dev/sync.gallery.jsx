/**
 * The console outbox, drawn from sample data. Development only.
 *
 * The pill in the header, the "Sync status" dialog it opens and the offline
 * banner, in each state the outbox can be in (lib/consoleOutbox.js's
 * snapshot), over a room's observations: one class, Computer Networks CS-A,
 * room K7Q2WD, on the morning of 19 November. Nothing here talks to the
 * server or touches the real outbox.
 */

import { useState } from 'react';

import AppShell from '../shell/AppShell.jsx';
import { ObserveView } from '../teach/Observe.jsx';
import { RecordsLayout } from '../teach/Records.jsx';
import { SyncBannerView, SyncDialog, SyncPill } from '../teach/SyncStatus.jsx';
import { Button } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';

/* ------------------------------------------------------------------ sample */

const CODE = 'K7Q2WD';
/** h:m in India's time (UTC+5:30), as an ISO stamp. */
const at = (h, m) => new Date(Date.UTC(2026, 10, 19, h, m) - 330 * 60_000).toISOString();
const PRIVACY = 'Teacher records are for staff only: never shown on a phone or the projector, and they never move a Bloom level.';
const KINDS = [
  { id: 'understood', label: 'Understood' },
  { id: 'participated', label: 'Participated' },
  { id: 'revision', label: 'Needs revision' },
  { id: 'support', label: 'Needs additional support' },
];
const label = (kind) => KINDS.find((k) => k.id === kind)?.label ?? null;

const PEOPLE = [
  ['23CS01', 'Aarav Shah'], ['23CS02', 'Aditi Rao'], ['23CS03', 'Ananya Iyer'], ['23CS04', 'Arjun Patil'],
  ['23CS05', 'Ishaan Kulkarni'], ['23CS06', 'Kavya Nair'], ['23CS07', 'Rohan Deshmukh'], ['23CS08', 'Sneha Joshi'],
];
const sid = (i) => `5e1f${String(i + 1).padStart(20, '0')}`;
const mark = (kind, h, m, extra = {}) => ({ id: `o${h}${m}`, kind, label: label(kind), note: '', observedAt: at(h, m), room: CODE, ...extra });

/** The observations read, with two marks made offline and drawn on this laptop (`local`). */
function observations() {
  const current = {
    '23CS01': mark('understood', 10, 6),
    '23CS02': mark('participated', 10, 7),
    '23CS05': mark('revision', 10, 9, { note: 'Mixed up flow control and congestion control' }),
    '23CS07': { ...mark('understood', 10, 15), local: true },
    '23CS08': { ...mark('participated', 10, 16), local: true },
  };
  const students = PEOPLE.map(([rollNo, name], i) => ({
    studentId: sid(i), rollNo, name, active: true, current: current[rollNo] ?? null,
    history: current[rollNo] && !current[rollNo].local ? [current[rollNo]] : [],
  }));
  const count = (k) => students.filter((s) => s.current?.kind === k).length;
  return {
    room: { code: CODE, title: 'Computer Networks - Unit 4', status: 'open', classId: 'c1' },
    class: { id: 'c1', courseName: 'Computer Networks', section: 'CS-A', termLabel: '' },
    day: '2026-11-19',
    kinds: KINDS,
    students,
    counts: { students: students.length, observed: 3, understood: count('understood'), participated: count('participated'), revision: count('revision'), support: 0 },
    privacy: PRIVACY,
  };
}

const item = (id, kind, text, h, m, extra = {}) => ({
  id, kind, label: text, code: CODE, queuedAt: at(h, m), status: 'queued', refusal: null, deferred: true, intent: { code: CODE }, ...extra,
});

const WAITING = [
  item('w1', 'attendance', '23CS04 Arjun Patil: Late', 10, 14),
  item('w2', 'observe', '23CS07 Rohan Deshmukh: Understood', 10, 15),
  item('w3', 'observe', '23CS08 Sneha Joshi: Participated', 10, 16),
  item('w4', 'tallyStep', 'B one more hand: Which traversal of a binary search tree gives sorted output?', 10, 17),
];

const REFUSED = [
  item('r1', 'observe', '23CS05 Ishaan Kulkarni: Understood', 10, 13, {
    status: 'refused',
    intent: { code: CODE, studentId: sid(4), kind: 'understood' },
    // The shapes and sentences of docs/API.md, "Teacher records sent again".
    refusal: {
      status: 409,
      stale: true,
      error: 'Ishaan Kulkarni\'s mark for this class was set to Needs additional support at 10:18, newer than what this change was made from. Nothing was changed.',
      current: mark('support', 10, 18, { note: 'Asked to stay back after class', room: 'P3XK9A' }),
    },
  }),
  item('r2', 'attendance', '23CS03 Ananya Iyer: Absent', 10, 11, {
    status: 'refused',
    intent: { code: CODE, marks: [{ studentId: sid(2), status: 'absent' }] },
    refusal: {
      status: 409,
      stale: true,
      error: '23CS03 (Ananya Iyer) was marked present at 10:19, newer than what this change was made from. Nothing was changed.',
      newer: [{ studentId: sid(2), status: 'present', markedAt: at(10, 19), markedBy: null }],
      current: {
        room: { code: CODE },
        students: [{ studentId: sid(2), rollNo: '23CS03', name: 'Ananya Iyer', status: 'present', source: 'teacher', markedAt: at(10, 19) }],
        summary: '6 / 8 present',
      },
    },
  }),
  item('r3', 'pick', '23CS06 Kavya Nair: Answered', 10, 12, {
    status: 'refused',
    intent: { code: CODE, pickId: 'p9' },
    refusal: { status: 404, stale: false, error: 'That pick was not found.' },
  }),
];

const snap = (over) => ({
  items: [], waiting: 0, refused: 0, mode: 'synced', offline: false, reason: '', lastSyncAt: at(10, 12), disk: true, ...over,
});

const OFFLINE = snap({ items: WAITING, waiting: 4, mode: 'offline', offline: true });
const SYNCING = snap({ items: WAITING.map((i, n) => (n === 0 ? { ...i, status: 'sending' } : i)), waiting: 4, mode: 'syncing' });
const HELD = snap({ items: WAITING, waiting: 4, mode: 'waiting', reason: 'The server is busy. Try again in a moment.' });
const SYNCED = snap({});
const NEVER = snap({ lastSyncAt: null });
const WITH_REFUSED = snap({ items: [...REFUSED, ...WAITING.slice(0, 1)], waiting: 1, refused: 3, mode: 'offline', offline: true });
const REFUSED_ONLY = snap({ items: REFUSED, refused: 3 });
const NO_DISK = { ...OFFLINE, disk: false };

/* ------------------------------------------------------------------ frame */

const NAV = [
  { id: 'content', label: 'Material', icon: 'material', group: 'prepare' },
  { id: 'bank', label: 'Questions', icon: 'bank', group: 'prepare' },
  { id: 'session', label: 'Room', icon: 'room', group: 'prepare' },
  { id: 'live', label: 'Live class', icon: 'live', group: 'teach', badge: 'Live', tone: 'live' },
];

/** The console with the pill in its header, the banner over the page and the dialog the pill opens. */
function Console({ sync, open: first = false, children }) {
  const [open, setOpen] = useState(first);
  return (
    <AppShell
      crumb={<span className="clip">Live · <span className="mono">{CODE}</span> · Computer Networks CS-A</span>}
      title="In the room"
      sub="Observations. A mark made offline stays as drawn and goes to the server when the laptop reconnects."
      status={<SyncPill sync={sync} onOpen={() => setOpen(true)} />}
      banner={<SyncBannerView sync={sync} onOpen={() => setOpen(true)} />}
      nav={NAV}
      current="live"
      onNav={() => {}}
      width="wide"
    >
      {children ?? (
        <RecordsLayout tab="observe" onTab={() => {}} canControl>
          <ObserveView data={observations()} load={{ status: 'ready' }} code={CODE} canControl onMark={() => {}} onNote={() => true} />
        </RecordsLayout>
      )}
      <SyncDialog open={open} onOpenChange={setOpen} sync={sync} onResend={() => toast('Sent again with a new key')} onDiscard={() => toast('Discarded')} onTryNow={() => {}} />
    </AppShell>
  );
}

/** Every pill and both banners on one page, with the two toasts a button away. */
function Board() {
  const pills = [
    ['Synced', SYNCED, 'Nothing waiting. The time is the last record the server took.'],
    ['Never synced', NEVER, 'A laptop that has sent nothing yet.'],
    ['Offline', OFFLINE, 'Four records kept on this device.'],
    ['Syncing', SYNCING, 'Back online, sending oldest first.'],
    ['Waiting', HELD, 'Online, but the server answered “not now” (a 5xx or a 401).'],
    ['Refused', REFUSED_ONLY, 'Three records the server would not take, still to be decided.'],
  ];
  return (
    <div className="stack stack-4">
      <section className="card" style={{ padding: 20 }}>
        <h2 className="eyebrow" style={{ marginBottom: 12 }}>The pill</h2>
        <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {pills.map(([name, s, line]) => (
            <li key={name} className="cluster cluster-4">
              <span style={{ width: 190 }}><SyncPill sync={s} onOpen={() => {}} /></span>
              <span className="t-meta"><b>{name}.</b> {line}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="card" style={{ padding: 20 }}>
        <h2 className="eyebrow" style={{ marginBottom: 12 }}>The banner</h2>
        <SyncBannerView sync={OFFLINE} onOpen={() => {}} />
        <SyncBannerView sync={SYNCING} onOpen={() => {}} />
        <p className="t-meta">Nothing is drawn when online and synced.</p>
      </section>
      <section className="card" style={{ padding: 20 }}>
        <h2 className="eyebrow" style={{ marginBottom: 12 }}>The toasts</h2>
        <div className="cluster">
          <Button size="sm" onClick={() => toast('Saved on this device · will sync')}>A record kept offline</Button>
          <Button size="sm" onClick={() => toast('All records synced')}>The outbox drained</Button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ entries */

export default [
  {
    id: 'sync-states',
    title: 'Console outbox: every state',
    role: 'professor',
    note: 'The header pill in its six states, the banner offline and syncing, and the two toasts.',
    render: () => <Console sync={SYNCED}><Board /></Console>,
  },
  {
    id: 'sync-offline',
    title: 'Console outbox: working offline',
    role: 'professor',
    note: 'Two marks made offline stay drawn on the roster. The banner says what is kept; its count and the pill open the dialog.',
    render: () => <Console sync={OFFLINE} />,
  },
  {
    id: 'sync-dialog-offline',
    title: 'Sync status: four waiting, offline',
    role: 'professor',
    note: 'Each waiting record with the time it was made and Queued. Try now asks again at once.',
    render: () => <Console sync={OFFLINE} open />,
  },
  {
    id: 'sync-dialog-syncing',
    title: 'Sync status: syncing',
    role: 'professor',
    note: 'Back online: the oldest is Sending, the rest Queued, one at a time in the order they were made.',
    render: () => <Console sync={SYNCING} open />,
  },
  {
    id: 'sync-dialog-held',
    title: 'Sync status: the server says not now',
    role: 'professor',
    note: 'Online, but the server answered 5xx (or 401): the records stay queued, the same key and body go again.',
    render: () => <Console sync={HELD} open />,
  },
  {
    id: 'sync-dialog-refused',
    title: 'Sync status: refused records',
    role: 'professor',
    note: 'Two stale refusals beside the record as it stands (a mark set in another room of the class; a student marked by the join since), each to send again or discard; and a 404, discard only. Discard asks twice.',
    render: () => <Console sync={WITH_REFUSED} open />,
  },
  {
    id: 'sync-dialog-synced',
    title: 'Sync status: nothing waiting',
    role: 'professor',
    render: () => <Console sync={SYNCED} open />,
  },
  {
    id: 'sync-dialog-nodisk',
    title: 'Sync status: no disk',
    role: 'professor',
    note: 'IndexedDB unavailable (a private window, storage switched off): the records last as long as the tab, and the dialog says so.',
    render: () => <Console sync={NO_DISK} open />,
  },
];
