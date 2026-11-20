/**
 * Exam mode's setting (Batch 9, E5 and E7): the controls a professor turns on
 * when a room opens (teach/Room.jsx) and changes while it runs
 * (teach/ExamRoom.jsx, PATCH /api/session/:code/exam).
 *
 * Each control carries the server's own help line beside it (`examHelp` /
 * `help`), and the honesty line heads the whole setting: no website can stop a
 * screenshot, Google Lens or a photo from another phone, and none can truly lock
 * a tab. Nothing here claims more.
 *
 * Fullscreen, screen sharing and pictures need a room opened for a class (only a
 * class list can mark a student under 18, and nothing that watches is asked of
 * one): without a class they are shown off and cannot be turned on, with the
 * reason. Pictures need screen sharing. A Teacher-led room has no phones, so it
 * is offered nothing. The server checks all of it again and its sentence is
 * shown as given if it refuses.
 *
 *   <ExamSettings draft onDraft help hasClass teacherLed noClass idp />
 *   examModeFrom(draft, { hasClass }) -> { value, why }   what to send, or why not yet
 *   draftFrom(examMode)                                     a stored setting as a draft
 *   examLine(examMode)                                      the setting in a few words
 */

import { Icon, Note, Segmented } from '../ui/index.jsx';

import '../styles/exam.css';

// The server's EXAM_HELP (server/src/services/examGuard.js), for the one place
// it is needed before any room exists: the setting at the opening. Any reply
// that carries the help (opening an exam room, GET or PATCH .../exam) replaces
// this copy on this browser (rememberExamHelp), so the server's words win.
const HELP_COPY = {
  honesty: 'No website can stop screenshots, Google Lens or a photo taken with another phone, and no website can truly lock '
    + 'a tab. Exam mode is a set of deterrents, and of signals for you to look at. A signal is a prompt to look, never proof.',
  copyGuard: 'Always on in exam mode. Turns off copying, cutting, right-click, text selection and dragging on the question, '
    + 'blurs the question when the page loses focus, and shows the student\'s roll number and the room code faintly across '
    + 'it, so a photo of the screen says whose it was. The student\'s own answer box and whiteboard still work, so written '
    + 'and drawn answers can be given.',
  fullscreen: 'Laptops must be in fullscreen to answer, and answering pauses until it is back. Each exit is noted. A phone '
    + 'browser cannot be held in fullscreen. The student\'s own browser enforces this, so a browser someone has changed '
    + 'can skip it without leaving a signal.',
  screenShare: 'Laptops must share the whole screen to answer, and answering pauses if sharing stops; stopping is noted. '
    + 'Phones cannot share their screen, so turn this on only when every student sits the exam on a laptop. The server '
    + 'takes the laptop\'s word that the whole screen is shared, and what a picture shows: a browser someone has changed '
    + 'can claim a share it never started and send pictures of anything.',
  snapshots: 'While a laptop shares its screen, it sends a small picture of it every 30 or 60 seconds. Only the newest per '
    + 'student is kept, only this room\'s staff can see it, and it is deleted two hours after the room closes. It never '
    + 'goes into the archive, the CSV or any report. Screen pictures are personal data: check with your college before '
    + 'you use them.',
  seb: 'Asks for Safe Exam Browser, opened with one of the configurations you list; an ordinary browser is turned away '
    + 'with a sentence saying so. It is a strong deterrent, not a lock: anyone holding the configuration file you give '
    + 'students can work out the value it sends, and a value seen once can be sent again from another browser. Use a '
    + 'fresh configuration for each exam, and list its Browser Exam Key too for a harder check.',
  screenshots: 'A screenshot shortcut on a laptop (PrintScreen, the snipping shortcut or a Mac shortcut) is noted, and on a '
    + 'phone Google Lens or a screenshot tool makes the page lose focus, which is noted too. A phone\'s own screenshot '
    + 'buttons, any screenshot on an iPhone, a screen recording started outside the page and a photo from a second device '
    + 'cannot be seen at all: the faint roll number is the deterrent for those.',
  under18: 'Students the class list marks under 18 are not asked for fullscreen or screen sharing, send no pictures, and have '
    + 'no signals recorded or shown. The copy guard and the faint roll number still apply to them: they record nothing. '
    + 'A room opened without a class has no list to mark anyone, so it cannot ask for fullscreen, screen sharing or '
    + 'pictures.',
};
const HELP_KEY = 'bloomloop.examHelp';

/** The help as the server last gave it on this browser, or the copy above. */
export function examHelpNow() {
  try {
    const kept = JSON.parse(localStorage.getItem(HELP_KEY) || 'null');
    if (kept && typeof kept.honesty === 'string') return { ...HELP_COPY, ...kept };
  } catch { /* private window or a bad entry: the copy */ }
  return HELP_COPY;
}

/** Keep the server's help for the next opening. */
export function rememberExamHelp(help) {
  if (!help || typeof help.honesty !== 'string') return;
  try { localStorage.setItem(HELP_KEY, JSON.stringify(help)); } catch { /* not kept */ }
}

/* ------------------------------------------------------------ the draft */

export const EXAM_OFF = { on: false, fullscreen: false, screenShare: false, snapshotSeconds: 0, sebRequired: false, configKeys: '', browserKeys: '' };

// The server's limits (examGuard.js SNAPSHOT_SECONDS, MAX_SEB_KEYS).
const PICTURES = [
  { id: '0', label: 'None' },
  { id: '30', label: 'Every 30 s' },
  { id: '60', label: 'Every 60 s' },
];
const MAX_KEYS = 5;
const HEX64 = /^[0-9a-f]{64}$/;

const keysIn = (text) => [...new Set(String(text ?? '').split(/[\s,;]+/).map((k) => k.trim().toLowerCase()).filter(Boolean))];

function keyProblem(keys, what) {
  const bad = keys.filter((k) => !HEX64.test(k)).length;
  if (bad) return `Each ${what} must be the 64-character key Safe Exam Browser shows: ${bad === 1 ? 'one of these is' : `${bad} of these are`} not.`;
  if (keys.length > MAX_KEYS) return `A room may accept at most ${MAX_KEYS} ${what}s.`;
  return '';
}

/** A stored setting (GET or PATCH .../exam, keys included) as a draft. */
export function draftFrom(m) {
  if (!m?.on) return { ...EXAM_OFF };
  return {
    on: true,
    fullscreen: Boolean(m.fullscreen),
    screenShare: Boolean(m.screenShare),
    snapshotSeconds: Number(m.snapshotSeconds) || 0,
    sebRequired: Boolean(m.seb?.required),
    configKeys: (m.seb?.configKeyHashes ?? []).join('\n'),
    browserKeys: (m.seb?.browserExamKeys ?? []).join('\n'),
  };
}

/**
 * What to send as `examMode`, and why it cannot be sent yet ('' when it can).
 * Off is `{ on: false }`. Without a class the three watching parts go off, and
 * pictures go with screen sharing; Safe Exam Browser's keys only when it is
 * required.
 */
export function examModeFrom(d, { hasClass }) {
  if (!d?.on) return { value: { on: false }, why: '' };
  const screenShare = hasClass && d.screenShare;
  const value = {
    on: true,
    fullscreen: hasClass && d.fullscreen,
    screenShare,
    snapshotSeconds: screenShare ? Number(d.snapshotSeconds) || 0 : 0,
    seb: { required: false, configKeyHashes: [] },
  };
  if (!d.sebRequired) return { value, why: '' };
  const keys = keysIn(d.configKeys);
  const browser = keysIn(d.browserKeys);
  value.seb = { required: true, configKeyHashes: keys, ...(browser.length ? { browserExamKeys: browser } : {}) };
  const why = keyProblem(keys, 'Config Key') || keyProblem(browser, 'Browser Exam Key')
    || (keys.length ? '' : 'Requiring Safe Exam Browser needs at least one Config Key, from the configuration you will give students.');
  return { value, why };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The setting in a few words, from a stored one or the room list's summary
 * (which counts the keys and never carries one).
 */
export function examLine(m) {
  if (!m?.on) return '';
  const keys = m.seb?.keys ?? m.seb?.configKeyHashes?.length ?? 0;
  return [
    'the copy guard and the faint roll number',
    m.fullscreen && 'fullscreen on laptops',
    m.screenShare && 'the whole screen shared',
    m.snapshotSeconds > 0 && `a screen picture every ${m.snapshotSeconds} seconds`,
    m.seb?.required && `Safe Exam Browser${keys ? ` (${plural(keys, 'configuration')})` : ''}`,
  ].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1');
}

/* ---------------------------------------------------------- the controls */

/** An on/off switch with its help tied to it (ui's Switch takes no description). */
function ExSwitch({ id, label, checked, onChange, disabled, describedBy }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

/** One control and its help line. `why` says why the control cannot be used. */
function Row({ id, title, help, more, why, children, sub }) {
  return (
    <div className="tc-rule ex-row" data-sub={sub ? 'true' : undefined}>
      <div className="tc-rule-txt">
        <b id={`${id}-t`}>{title}</b>
        {help && <p id={`${id}-h`}>{help}</p>}
        {more && <p id={`${id}-m`}>{more}</p>}
        {why && <p className="ex-why" id={`${id}-w`}>{why}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * @param draft     the setting being edited (EXAM_OFF's shape)
 * @param onDraft   (next) => void
 * @param help      the server's help lines (examHelpNow() before a room exists)
 * @param hasClass  the room is (to be) opened for a class
 * @param teacherLed  a Teacher-led room: nothing is offered
 * @param noClass   why the watching parts are off without a class, for this screen
 * @param idp       an id prefix, unique on the page
 * @param why       why the draft cannot be sent yet (examModeFrom), shown under the keys
 */
export default function ExamSettings({
  draft, onDraft, help = examHelpNow(), hasClass, teacherLed = false, noClass, idp = 'ex', why = '',
}) {
  const set = (patch) => onDraft({ ...draft, ...patch });
  const id = (s) => `${idp}-${s}`;

  if (teacherLed) {
    return (
      <div className="ex-set">
        <Row id={id('on')} title="Exam mode" help="Exam mode needs phones, and no phone joins a Teacher-led room." />
      </div>
    );
  }

  // Shown as they will run: off without a class, pictures off without sharing.
  const fullscreen = hasClass && draft.fullscreen;
  const screenShare = hasClass && draft.screenShare;
  const pictures = screenShare ? String(draft.snapshotSeconds || 0) : '0';
  const classWhy = hasClass ? '' : (noClass ?? 'Fullscreen, screen sharing and pictures need a class, so students its list marks under 18 can be left out. Choose a class above to offer them.');
  const picturesWhy = !hasClass ? '' : !screenShare ? 'Pictures need screen sharing: turn it on above to offer them.' : '';
  const describe = (s, w) => [`${id(s)}-h`, w ? `${id(s)}-w` : ''].filter(Boolean).join(' ');

  return (
    <div className="ex-set">
      <p className="ex-honest"><Icon name="info" size={15} /><span>{help.honesty}</span></p>

      <Row id={id('on')} title="Exam mode" help={help.copyGuard} more={help.screenshots}>
        <ExSwitch label="Exam mode" checked={draft.on} onChange={(on) => set({ on })} describedBy={`${id('on')}-h ${id('on')}-m`} />
      </Row>

      {draft.on && (
        <div className="ex-parts" role="group" aria-label="What exam mode asks of each laptop">
          {!hasClass && <Note tone="warn" className="ex-noclass" id={id('nc')}>{classWhy}</Note>}
          <Row id={id('fs')} title="Fullscreen on laptops" help={help.fullscreen} sub>
            <ExSwitch
              label="Fullscreen on laptops"
              checked={fullscreen}
              disabled={!hasClass}
              onChange={(v) => set({ fullscreen: v })}
              describedBy={[describe('fs'), hasClass ? '' : id('nc')].filter(Boolean).join(' ')}
            />
          </Row>
          <Row id={id('ss')} title="Whole screen shared" help={help.screenShare} sub>
            <ExSwitch
              label="Whole screen shared"
              checked={screenShare}
              disabled={!hasClass}
              onChange={(v) => set({ screenShare: v, ...(v ? {} : { snapshotSeconds: 0 }) })}
              describedBy={[describe('ss'), hasClass ? '' : id('nc')].filter(Boolean).join(' ')}
            />
          </Row>
          <Row id={id('pic')} title="Screen pictures" help={help.snapshots} why={picturesWhy} sub>
            <div
              className="ex-seg"
              role="group"
              aria-labelledby={`${id('pic')}-t`}
              aria-describedby={[describe('pic', picturesWhy), hasClass ? '' : id('nc')].filter(Boolean).join(' ')}
            >
              <Segmented
                label="Screen pictures"
                value={pictures}
                onChange={(v) => set({ snapshotSeconds: Number(v) })}
                options={PICTURES.map((p) => ({ ...p, disabled: !screenShare }))}
              />
            </div>
          </Row>
          <Row id={id('seb')} title="Safe Exam Browser" help={help.seb} sub>
            <ExSwitch label="Require Safe Exam Browser" checked={draft.sebRequired} onChange={(v) => set({ sebRequired: v })} describedBy={describe('seb')} />
          </Row>
          {draft.sebRequired && (
            <div className="ex-keys">
              <label className="ex-key" htmlFor={id('ck')}>
                <b>Config Keys</b>
                <span>The Config Key of each configuration you give students, as Safe Exam Browser’s configuration tool shows it: 64 characters, one per line, up to {MAX_KEYS}.</span>
                <textarea
                  id={id('ck')}
                  className="textarea mono"
                  rows={2}
                  spellCheck={false}
                  autoComplete="off"
                  value={draft.configKeys}
                  onChange={(e) => set({ configKeys: e.target.value })}
                  aria-invalid={why ? 'true' : undefined}
                  aria-describedby={why ? id('kw') : undefined}
                />
              </label>
              <label className="ex-key" htmlFor={id('bk')}>
                <b>Browser Exam Keys <span className="ro-opt">optional</span></b>
                <span>For a harder check: the Browser Exam Key of the Safe Exam Browser build students use. A join must then match one of these too.</span>
                <textarea
                  id={id('bk')}
                  className="textarea mono"
                  rows={1}
                  spellCheck={false}
                  autoComplete="off"
                  value={draft.browserKeys}
                  onChange={(e) => set({ browserKeys: e.target.value })}
                />
              </label>
              {why && <p className="ex-why" id={id('kw')} role="alert">{why}</p>}
            </div>
          )}
          <Row id={id('u18')} title="Students under 18" help={help.under18} sub />
        </div>
      )}
    </div>
  );
}
