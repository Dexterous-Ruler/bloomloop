/**
 * Rooms run in laptop mode and imported later, and the console on the laptop
 * itself (Phase 7, decision O4). Development only.
 *
 * Every sample has the shape docs/API.md "Phase 7: offline-first" captured:
 * GET /api/laptop in laptop mode, POST and GET /api/imports/rooms, a room's
 * `importedFrom`, an imported room's item report and an answer kept and not
 * counted. Nothing here talks to the server.
 */

import { useState } from 'react';

import { ImportRoomsView } from '../account/ImportRooms.jsx';
import { RoomsView } from '../account/Rooms.jsx';
import Gate from '../teach/Gate.jsx';
import {
  ImportedNote, ImportedRoomsNote, ImportedTag, KeptTag, laptopItems, LeaveOutImported,
} from '../teach/imported.jsx';
import { ItemList } from '../teach/ItemStats.jsx';
import { LaptopBanner, NoNetworkWarning } from '../teach/laptop.jsx';
import AccountShell from '../shell/AccountShell.jsx';

const NOW = Date.now();
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const daysAgo = (d, h = 0) => new Date(NOW - d * 86400000 - h * 3600000).toISOString();

const NOTE = 'Imported from a file saved by laptop mode. BloomLoop checked that the file is a room it can read, not that it is '
  + 'unchanged since the laptop saved it: its answers, marks and attendance are as the file gives them.';
const FROM = { importedAt: minsAgo(40), sourceCode: 'Q5B36K', laptop: { run: 'e5ccd514', startedAt: daysAgo(1, 3) }, note: NOTE };
const FROM_RECODED = { importedAt: minsAgo(38), sourceCode: 'HT4M2P', laptop: { run: 'e5ccd514', startedAt: daysAgo(1, 3) }, note: NOTE };

/* ------------------------------------------------------------ GET /api/laptop */

const LAPTOP = {
  laptop: true,
  run: 'e5ccd514',
  startedAt: minsAgo(52),
  archives: {
    folder: 'C:\\BloomLoop\\server\\.data\\laptop-archives',
    intervalSeconds: 60,
    lastWriteAt: minsAgo(1),
    writes: 14,
    rooms: 2,
    lastError: null,
  },
  join: [{ network: 'Wi-Fi', url: 'http://192.168.8.10:5050/join' }],
  unavailable: [
    'Accounts and signing in: use the console link printed here, which carries the laptop\'s own teacher key.',
    'Generating questions with AI: the offline templates and questions you write yourself work.',
    'Google Classroom.',
    'The student Learning Hub, which needs student accounts.',
    'Anything kept between restarts except the room archives: chapters, questions, classes and rosters made on the laptop are held in its memory and are gone when the server stops.',
  ],
};
const LAPTOP_FAILED = { ...LAPTOP, archives: { ...LAPTOP.archives, lastError: 'K7Q42M: EACCES: permission denied, rename \'room-K7Q42M-3aea7553cd0f917fe6ff8831.json.tmp\'' } };
const LAPTOP_FRESH = { ...LAPTOP, archives: { folder: LAPTOP.archives.folder, intervalSeconds: 60 } };

/* ------------------------------------------------------------ GET /api/session */

const settings = (more = {}) => ({ masteryGoal: 0.8, reattempts: 1, redemption: false, mode: 'devices', ...more });
const ROOMS = [
  {
    code: 'W7KQ3N', title: 'Recursion: base cases', status: 'open', contentId: 'c1', settings: settings(), questionIds: null,
    classId: 'cls1', withdrawn: 0, startedAt: minsAgo(25), pausedAt: null, closedAt: null, joined: 38, online: 35, answered: 214,
    banded: 2, accuracy: 0.71, canControl: true,
  },
  {
    code: 'Q5B36K', title: 'Sets', status: 'closed', contentId: 'c2', settings: settings(), questionIds: null, classId: 'cls1',
    withdrawn: 0, startedAt: daysAgo(1, 4), pausedAt: null, closedAt: daysAgo(1, 3), joined: 36, online: 0, answered: 288,
    banded: 0, accuracy: 0.66, canControl: true, importedFrom: FROM,
  },
  {
    code: 'R9VX4C', title: 'Sets, second period', status: 'closed', contentId: 'c2', settings: settings({ mode: 'mixed' }), questionIds: null,
    classId: 'cls1', withdrawn: 0, startedAt: daysAgo(1, 2), pausedAt: null, closedAt: daysAgo(1, 1), joined: 34, online: 0, answered: 251,
    banded: 1, accuracy: 0.62, canControl: true, importedFrom: FROM_RECODED,
  },
  {
    code: 'M2PD8S', title: 'Sorting', status: 'closed', contentId: 'c3', settings: settings(), questionIds: ['a', 'b', 'c', 'd', 'e', 'f'],
    classId: null, withdrawn: 3, startedAt: daysAgo(3, 2), pausedAt: null, closedAt: daysAgo(3, 1), joined: 41, online: 0, answered: 302,
    banded: 0, accuracy: 0.74, canControl: true,
  },
];

function RoomsDemo() {
  const [importing, setImporting] = useState(false);
  return (
    <>
      <RoomsView
        loading={false}
        error=""
        locked={false}
        rooms={ROOMS}
        archives={{ loading: false, list: [], limitBytes: 1048576, error: '' }}
        onImport={() => setImporting(true)}
        onReload={() => {}}
        onReloadArchives={() => {}}
        onDownload={async () => {}}
      />
      <ImportSheet open={importing} onOpenChange={setImporting} />
    </>
  );
}

/* ------------------------------------------------------- the import sheet */

const CHAPTERS = { status: 'ready', list: [{ id: 'c2', title: 'Sets and relations' }, { id: 'c3', title: 'Sorting' }], error: '' };
const CLASSES = { status: 'ready', list: [{ id: 'cls1', title: 'CS-A · Section A · Odd term 2026' }], error: '' };
const facts = (code, title, students, answers, more = {}) => ({ code, title, startedAt: daysAgo(1, 4), running: false, students, answers, run: 'e5ccd514', ...more });

const FILES = [
  {
    key: 'f1', name: 'room-Q5B36K-3aea7553cd0f917fe6ff8831.json', size: 39370, facts: facts('Q5B36K', 'Sets', 36, 288), state: 'imported',
    message: 'Room Q5B36K was imported as a closed room: 288 answers from 36 students, 36 attendance marks. It is shown as imported wherever it appears: BloomLoop checked that the file is a room it can read, not that it is unchanged since the laptop saved it.',
    sentences: ['The teacher records made on the laptop (observations, the wheel, hands up, activities) are kept in the imported archive, not added to this room\'s records.'],
    room: { code: 'Q5B36K' },
  },
  {
    key: 'f2', name: 'room-HT4M2P-6b1f0c2d9e8a7b6c5d4e3f20.json', size: 35102, facts: facts('HT4M2P', 'Sets, second period', 34, 251), state: 'needs', needs: 'chapter',
    message: 'Choose the chapter in your account that this room\'s questions belong to: the chapter on the laptop is not in your account, and each answer is filed under the chosen chapter\'s topics. Nothing was imported.',
  },
  {
    key: 'f3', name: 'room-K7Q42M-9c8b7a6d5e4f3a2b1c0d9e8f.json', size: 41877, facts: facts('K7Q42M', 'Relations', 35, 240, { running: true }), state: 'needs', needs: 'class', contentId: 'c2',
    message: 'This room took attendance against a class on the laptop. Choose the class in your account it belongs to, so its attendance and answers count in that class\'s reports. Nothing was imported.',
  },
  {
    key: 'f4', name: 'room-Q5B36K-3aea7553cd0f917fe6ff8831 (1).json', size: 40102, facts: facts('Q5B36K', 'Sets', 36, 291), state: 'already', same: false,
    message: 'Room Q5B36K was imported on 2026-11-19, so nothing was changed. This file is not the one imported then (it may have been saved later): an imported room is never overwritten or added to, so nothing in it was used.',
  },
  {
    key: 'f5', name: 'bloomloop-room-archive.json', size: 28811, facts: facts('M2PD8S', 'Sorting', 41, 302, { run: null }), state: 'refused', status: 400,
    message: 'This file does not carry the mark laptop mode puts on the rooms it saves, so it is not one to import here. The mark says where a file came from, not that it is unchanged, so every imported room is shown as imported. Nothing was imported.',
  },
  {
    key: 'f6', name: 'notes.json', size: 812, state: 'unreadable',
    message: 'notes.json is not readable JSON, so it was not sent. Choose the .json file laptop mode saved for the room. Nothing was imported.',
  },
  { key: 'f7', name: 'room-P3ZK9W-1a2b3c4d5e6f7a8b9c0d1e2f.json', size: 22014, facts: facts('P3ZK9W', 'Functions', 30, 140), state: 'sending' },
  { key: 'f8', name: 'room-T8HN4Q-0f1e2d3c4b5a69788796a5b4.json', size: 19820, facts: facts('T8HN4Q', 'Logic', 29, 120), state: 'waiting' },
];
const PAST = {
  status: 'ready',
  error: '',
  list: [{
    id: '2693ad6564fb0c22530e40fe', room: { code: 'Q5B36K', sessionId: '44283a93c475fad18918b228' }, sourceRoomId: '3aea7553cd0f917fe6ff8831',
    laptop: { run: 'e5ccd514', startedAt: daysAgo(1, 3) }, archivedAt: daysAgo(1, 3), importedAt: minsAgo(40), importedBy: 'profA', bytes: 39370,
    summary: { students: 36, answers: 288, reviews: 4, classQuestions: 1, attendance: { imported: 36, notOnRoster: [] }, records: { tallies: 1 }, roomWasRunning: false, questionSetKept: true, sentences: [] },
  }],
};

function ImportSheet({ open = true, onOpenChange, files = FILES, past = PAST }) {
  const [list, setList] = useState(files);
  const patch = (key, p) => setList((fs) => fs.map((f) => (f.key === key ? { ...f, ...p } : f)));
  return (
    <ImportRoomsView
      open={open}
      onOpenChange={onOpenChange ?? (() => {})}
      files={list}
      chapters={CHAPTERS}
      classes={CLASSES}
      past={past}
      onFiles={() => {}}
      onChoose={patch}
      onSend={(key) => patch(key, { state: 'sending', message: '' })}
      onRemove={(key) => setList((fs) => fs.filter((f) => f.key !== key))}
      onClearDone={() => setList((fs) => fs.filter((f) => !['imported', 'already', 'refused', 'unreadable'].includes(f.state)))}
    />
  );
}

/* ---------------------------------------------------- an imported room's items */

const prov = (sourceLabel, label, sentence) => ({ source: 'ai', sourceLabel, approval: 'discarded', aiDraft: false, label, sentence });
const ITEMS = [
  {
    questionId: '5f0c1a2b3c4d5e6f7a8b9c0d', text: 'Which of these sets is a subset of every set?', kind: 'mcq', bloom: 'remember', topic: 'Subsets', status: 'deleted',
    provenance: prov('Offline template', 'Offline template, not in use', 'Made by the offline template from the professor\'s material, without a language model. Not in use: rejected, retired or removed.'),
    levelCheck: null, attempts: 34, correct: 29, proportionCorrect: 29 / 34, meanScore: null, band: 'easy',
    basis: { answers: 34, provisional: false, sentence: 'Based on 34 answers.' }, pointBiserial: 0.31, pointBiserialN: 30, pointBiserialNote: null, flags: [],
    distribution: { answers: 34, otherVersions: 0, rows: [{ label: '', select: 'one', unanswered: 0, options: [
      { index: 0, text: 'The empty set', count: 29, key: true }, { index: 1, text: 'The universal set', count: 3, key: false },
      { index: 2, text: 'The set itself', count: 2, key: false },
    ] }] },
    versions: 1, languages: null,
  },
  {
    questionId: '6a1b2c3d4e5f6a7b8c9d0e1f', text: 'A relation that is reflexive, symmetric and transitive is called what?', kind: 'blank', bloom: 'understand', topic: 'Relations', status: 'deleted',
    provenance: prov('Professor', 'Professor, not in use', 'Written by a professor. Not in use: rejected, retired or removed.'),
    levelCheck: null, attempts: 33, correct: 18, proportionCorrect: 18 / 33, meanScore: null, band: 'medium',
    basis: { answers: 33, provisional: false, sentence: 'Based on 33 answers.' }, pointBiserial: -0.12, pointBiserialN: 29, pointBiserialNote: null,
    flags: [{ id: 'negative-point-biserial', message: 'Students who did well elsewhere got this one wrong more often than others. The key may be wrong, or the question unclear.' }],
    distribution: null, versions: 1, languages: null,
  },
];

function Page({ children }) {
  return <div className="page" style={{ maxWidth: 920 }}>{children}</div>;
}

/* ----------------------------------------------------------- the entries */

export default [
  {
    id: 'imports-rooms',
    title: 'Rooms with two imported from a laptop',
    role: 'professor',
    note: 'Each imported room carries "Imported from a laptop" (the note, date and run on hover or focus). "Leave out imported rooms" filters them; "Import from a laptop" opens the sheet.',
    render: () => <RoomsDemo />,
  },
  {
    id: 'imports-sheet',
    title: 'The import sheet, every state',
    role: 'professor',
    note: 'Imported (message and summary sentences), a chapter to choose, a class to choose, already imported with a different file, refused, not JSON, sending and waiting, and the imports made before.',
    render: () => (
      <AccountShell current="rooms" title="Rooms">
        <ImportSheet />
      </AccountShell>
    ),
  },
  {
    id: 'imports-sheet-empty',
    title: 'The import sheet, nothing chosen yet',
    role: 'professor',
    render: () => (
      <AccountShell current="rooms" title="Rooms">
        <ImportSheet files={[]} past={{ status: 'ready', list: [], error: '' }} />
      </AccountShell>
    ),
  },
  {
    id: 'imports-laptop',
    title: 'Laptop mode: the banner',
    role: 'professor',
    note: 'GET /api/laptop with laptop: true. Here at localhost, so the warning for a console open at a network address does not show. Then a save that failed, a laptop that has saved nothing yet, and the projector\'s warning when the laptop has no network address.',
    render: () => (
      <Page>
        <LaptopBanner data={LAPTOP} onReread={() => {}} />
        <LaptopBanner data={LAPTOP_FAILED} onReread={() => {}} />
        <LaptopBanner data={LAPTOP_FRESH} />
        <div className="pj on-panel" style={{ position: 'relative', minHeight: 0, padding: 24, borderRadius: 16 }}>
          <NoNetworkWarning />
        </div>
      </Page>
    ),
  },
  {
    id: 'imports-locked',
    title: 'Laptop mode: shut out after too many wrong keys',
    note: 'A 429 on the first staff call, shown as it is. Sign-in is not offered on the laptop.',
    render: () => (
      <Gate
        onUnlock={() => {}}
        laptop
        blocked
        refused="Too many wrong teacher keys were tried from this device. Wait ten minutes, then open the console with the link the laptop printed."
      />
    ),
  },
  {
    id: 'imports-marks',
    title: 'Imported rooms on a room\'s screens and in reports',
    role: 'professor',
    note: 'The note at the top of an imported room (live grid, answers, topics, item statistics, review detail), a report naming its imported rooms or leaving them out, the option that sends imported=leave-out, and an answer kept and not counted.',
    render: () => <Marks />,
  },
  {
    id: 'imports-items',
    title: 'An imported room\'s item statistics',
    role: 'professor',
    note: 'The server lists the laptop\'s questions as deleted and not in use. In an imported room they read "Asked on the laptop, not in this chapter\'s bank", and there is no key to check.',
    render: () => (
      <Page>
        <ImportedNote from={FROM} code="Q5B36K" />
        <div className="card" style={{ padding: 8 }}>
          <ItemList items={laptopItems(ITEMS, FROM)} thresholds={{ minAnswersForBand: 10 }} onCheckKey={() => {}} />
        </div>
      </Page>
    ),
  },
];

function Marks() {
  const [left, setLeft] = useState(false);
  return (
    <Page>
      <ImportedNote from={FROM} code="Q5B36K" />
      <ImportedNote from={FROM_RECODED} code="R9VX4C" />
      <div className="cluster" style={{ gap: 12 }}>
        <ImportedTag from={FROM} code="Q5B36K" />
        <LeaveOutImported value={left} onChange={setLeft} count={2} />
        <KeptTag detail="Arrived after the room closed: kept, not counted." />
      </div>
      <ImportedRoomsNote
        rooms={[{ code: 'Q5B36K', importedFrom: FROM }, { code: 'R9VX4C', importedFrom: FROM_RECODED }, { code: 'M2PD8S' }]}
        window={left ? { imported: 'leave-out' } : {}}
      />
    </Page>
  );
}
