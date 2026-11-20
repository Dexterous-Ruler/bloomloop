/**
 * Item statistics: how each question did with a class.
 *
 * Every figure here is the server's (GET /api/bank/:contentId/stats and
 * GET /api/session/:code/items, docs/API.md "Phase 2: item statistics"). This
 * file only words them. Nothing is worked out here that the server did not
 * send, so a figure on screen can always be traced to the report.
 *
 * The flag is a reason to look, never a verdict: it says what the numbers show
 * and points at the key, and the teacher decides.
 *
 * Phase 5 adds what each figure rests on (docs/API.md "Phase 5: honest
 * indicators"): `basis.sentence` beside the difficulty, so a band is never
 * shown as firm on too few answers; who wrote the question
 * (`provenance.label`); an uncertain level (`levelCheck`); answers given in
 * another language (`languages.note`, and `languages.warning.text` when two
 * languages' shares right are far apart); and, under each wrong option that
 * has one, its misconception label ("Phase 5: misconception labels"), marked
 * "AI draft" until the professor confirms it. Staff only, like the rest.
 *
 *   useBankStats(contentId, version)  ->  { data, error, loading, byId, reload }
 *   <ItemFigures item />                one quiet line for a question row
 *   <ItemMeta item />                   level, topic, kind, who wrote it, an uncertain level
 *   <ItemDetail item onCheckKey />      the figures in full, and what was chosen
 *   <ItemList items thresholds onCheckKey translation? />   rows that open into ItemDetail
 *   <TranslationLine translation />     the report's `translation`, only when a question has a warning
 *   <StatsView contentId questions? onCheckKey />   the bank's "How it went"
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { labelOf } from '../lib/kinds.js';
import { Button, Chip, Empty, Icon, Level, Note } from '../ui/index.jsx';
import { LAPTOP_QUESTION, laptopItems, useLaptopQuestionIds } from './imported.jsx';

const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const share = (p) => (num(p) === null ? '—' : `${Math.round(p * 100)}%`);
/** A correlation as people write it: two places, a real minus sign, a plus when above 0. */
const signed = (r) => {
  const s = Math.abs(r).toFixed(2);
  if (s === '0.00') return '0.00';
  return `${r < 0 ? '−' : '+'}${s}`;
};

const BAND = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

// The bank's status beside a question, when it is not simply approved.
const STATUS = {
  draft: 'Draft, not approved',
  discarded: 'Discarded',
  rejected: 'Rejected',
  deleted: 'No longer in the bank',
  // Phase 7: asked in a room run in laptop mode and imported (teach/imported.jsx laptopItems).
  laptop: LAPTOP_QUESTION,
};

// Kinds with nothing to choose from, said in words when there is no spread.
const TYPED = ['blank', 'cloze', 'numeric', 'open', 'table'];
const ARRANGED = ['order', 'rank'];
// What one row of the spread is, per kind, when there is more than one.
const PART = {
  categorise: ['item to sort', 'items to sort'],
  match: ['item to match', 'items to match'],
  dropdown: ['gap'],
  grid: ['row'],
};

const flagsOf = (item) => list(item?.flags);
const attemptsOf = (item) => num(item?.attempts) ?? 0;
/** The band only when the answers behind it are enough: never a firm band on a provisional count. */
const bandOf = (item) => (item?.band && item?.basis?.provisional !== true ? item.band : null);
/** A label the model proposed that no professor has confirmed yet. */
const isDraftLabel = (m) => m?.provenance === 'ai' && m?.confirmed !== true;
const warningOf = (item) => item?.languages?.warning ?? null;

/** The quiet mark on a label the model proposed and no professor has confirmed. */
export function DraftTag({ children = 'AI draft', title, className = '' }) {
  return <span className={`it-draft ${className}`} title={title}>{children}</span>;
}

/* ---------------------------------------------------------------- the read */

/**
 * The bank's item report, read again whenever `version` changes (pass the
 * bank's own refresh counter, or anything that moves after an edit). A newer
 * read always wins, and a failed re-read keeps the figures already on screen.
 * `byId` maps a questionId to its item, for the bank's rows.
 */
export function useBankStats(contentId, version) {
  const [state, setState] = useState({ for: null, data: null, error: '', loading: false });
  const req = useRef(0);

  const load = useCallback(() => {
    const id = ++req.current;
    if (!contentId) { setState({ for: null, data: null, error: '', loading: false }); return; }
    setState((s) => (s.for === contentId ? { ...s, loading: true, error: '' } : { for: contentId, data: null, error: '', loading: true }));
    api.bankStats(contentId).then(
      (data) => { if (req.current === id) setState({ for: contentId, data, error: '', loading: false }); },
      (err) => { if (req.current === id) setState((s) => ({ ...s, error: err.message, loading: false })); },
    );
  }, [contentId]);

  useEffect(() => { load(); }, [load, version]);

  const data = state.for === contentId ? state.data : null;
  const byId = useMemo(() => new Map(list(data?.items).map((i) => [i.questionId, i])), [data]);
  return { data, error: state.for === contentId ? state.error : '', loading: Boolean(contentId) && (state.for !== contentId || state.loading), byId, reload: load };
}

/* ------------------------------------------------------------ one line */

/**
 * One quiet line for a question row: answers, share correct, the band. A warn
 * chip when the server flagged it. Nothing at all before anyone has answered.
 */
export function ItemFigures({ item, className = '' }) {
  const attempts = attemptsOf(item);
  if (!item || attempts === 0) return null;
  const flags = flagsOf(item);
  const band = bandOf(item);
  const warning = warningOf(item);
  return (
    <span className={`it-figs ${className}`}>
      <span><b className="mono">{attempts}</b> {plural(attempts, 'answer')}</span>
      <span><b className="mono">{share(item.proportionCorrect)}</b> correct</span>
      <span title={item.basis?.sentence || undefined}>
        {band ? <>{(BAND[band] ?? band).toLowerCase()} for this class</> : 'too few answers for a band'}
      </span>
      {flags.length > 0 && (
        <Chip tone="warn" icon="flag" title={flags.map((f) => f.message).join(' ')}>
          Worth a look
          <span className="sr-only">: {flags.map((f) => f.message).join(' ')}</span>
        </Chip>
      )}
      {warning?.text && (
        <Chip tone="warn" icon="alert" title={warning.text}>
          Check the translation
          <span className="sr-only">: {warning.text}</span>
        </Chip>
      )}
    </span>
  );
}

/**
 * The row's quiet first line: the level (with an uncertain mark when the
 * server says so), topic, kind, who wrote it and, when not simply approved,
 * the bank's status. `provenance.sentence` and `levelCheck.sentence` are on
 * hover here and in full in ItemDetail.
 */
export function ItemMeta({ item, className = '' }) {
  if (!item) return null;
  const prov = item.provenance;
  const check = item.levelCheck;
  return (
    <span className={`it-item-meta ${className}`}>
      <Level level={item.bloom} />
      {check?.uncertain && (
        <span className="it-unsure" title={check.sentence || undefined}>
          <Icon name="help" size={12} />Level uncertain
        </span>
      )}
      {item.topic && <span className="it-topic clip">{item.topic}</span>}
      <i className="it-dot" aria-hidden="true" />
      <span>{labelOf(item)}</span>
      {prov?.label && (
        prov.aiDraft
          ? <DraftTag title={prov.sentence || undefined}>{prov.label}</DraftTag>
          : <><i className="it-dot" aria-hidden="true" /><span className="it-prov" title={prov.sentence || undefined}>{prov.label}</span></>
      )}
      <StatusTag status={item.status} />
    </span>
  );
}

/* ------------------------------------------------------------ in full */

/** What the class chose, option by option, the key marked in words and a tick. */
function Spread({ item }) {
  const d = item.distribution;
  const kind = item.kind;
  if (!d) {
    return (
      <p className="it-none">
        {TYPED.includes(kind)
          ? 'A typed answer has no options to count, so there is no spread of choices for this question.'
          : ARRANGED.includes(kind)
            ? 'An arrangement has no single option to count, so there is no spread of choices for this question.'
            : 'There is no spread of choices for this question.'}
      </p>
    );
  }
  const answers = num(d.answers) ?? 0;
  const rows = list(d.rows);
  const many = rows.length > 1;
  const other = num(d.otherVersions) ?? 0;
  return (
    <div className="it-spread">
      <div className="it-sub-h">
        <h4>What the class chose</h4>
        <span className="t-meta">
          {answers} {plural(answers, 'answer')} counted{many ? `, ${rows.length} ${plural(rows.length, ...(PART[kind] ?? ['part']))}` : ''}
        </span>
      </div>
      {other > 0 && (
        <p className="it-aside">
          {other} {plural(other, 'answer was', 'answers were')} given to an earlier version with different options, so {other === 1 ? 'it is' : 'they are'} left
          out of these counts. {other === 1 ? 'It still counts' : 'They still count'} in the answers above.
        </p>
      )}
      <div className={`it-rows${many ? ' it-rows-many' : ''}`}>
        {rows.map((row, ri) => {
          const opts = list(row.options);
          const unanswered = num(row.unanswered) ?? 0;
          return (
            <div key={ri} className="it-row-set">
              {row.label != null && row.label !== '' && <h5 className="it-row-label clip" title={row.label}>{row.label}</h5>}
              {row.select === 'many' && (
                <p className="it-aside">Every tick is counted, so these add up to more than the {answers} {plural(answers, 'answer')}.</p>
              )}
              <ul className="it-opts" aria-label={row.label ? `Chosen for ${row.label}` : 'Chosen'}>
                {opts.map((o) => {
                  const count = num(o.count) ?? 0;
                  const of = answers > 0 ? count / answers : 0;
                  // A wrong option's misconception label (Phase 5), never on the key.
                  const mc = !o.key && o.misconception?.label ? o.misconception : null;
                  const draft = isDraftLabel(mc);
                  return (
                    <li key={o.index} className="it-opt" data-key={o.key ? 'true' : undefined} data-mc={mc ? 'true' : undefined}>
                      <span className="it-opt-t">
                        <span className="clip" title={o.text}>{o.text || `Option ${Number(o.index) + 1}`}</span>
                        {o.key && <span className="it-key"><Icon name="check" size={12} />key</span>}
                      </span>
                      <span className="it-opt-n">
                        <b className="mono">{count}</b>
                        <span className="mono">{answers > 0 ? share(of) : '—'}</span>
                      </span>
                      <span className="it-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, of * 100)}%` }} /></span>
                      {mc && (
                        <span className="it-mc" data-draft={draft ? 'true' : undefined}>
                          <span className="it-mc-k">Misconception<span className="sr-only">: </span></span>
                          <span className="it-mc-l">{mc.label}</span>
                          {draft && <DraftTag>{mc.provenanceLabel || 'AI draft'}</DraftTag>}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              {unanswered > 0 && (
                <p className="it-unans">{unanswered} chose nothing{many || row.label ? ' here' : ''}.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Everything the report says about one question. `thresholds` is optional:
 * given it, "too few answers" says how many a band needs.
 */
export function ItemDetail({ item, onCheckKey, thresholds }) {
  if (!item) return null;
  const attempts = attemptsOf(item);
  const flags = flagsOf(item);
  const pb = num(item.pointBiserial);
  const pbN = num(item.pointBiserialN);
  const versions = num(item.versions) ?? 1;
  const meanScore = num(item.meanScore);
  const needs = num(thresholds?.minAnswersForBand);
  const gone = item.status === 'deleted' || item.status === 'laptop';
  const band = bandOf(item);
  const basis = item.basis?.sentence || '';
  const warning = warningOf(item);
  const unsure = item.levelCheck?.uncertain ? item.levelCheck.sentence : '';

  // Who wrote it, and answers in another language: quiet lines at the foot.
  const about = (item.provenance?.sentence || item.languages?.note) && (
    <ul className="it-about">
      {item.provenance?.sentence && (
        <li><Icon name="edit" size={14} /><span>{item.provenance.sentence}</span></li>
      )}
      {item.languages?.note && <li><Icon name="info" size={14} /><span>{item.languages.note}</span></li>}
    </ul>
  );
  const levelLine = unsure && (
    <p className="it-level-check"><Icon name="help" size={15} /><span>{unsure}</span></p>
  );

  if (attempts === 0) {
    return (
      <div className="it-detail">
        <p className="it-none">Nobody has answered this question yet, so there is nothing to count.</p>
        {levelLine}
        {about}
      </div>
    );
  }

  return (
    <div className="it-detail">
      {warning?.text && (
        <Note tone="warn" icon="alert" role="note">{warning.text}</Note>
      )}
      {flags.map((f) => (
        <div key={f.id} className="it-flag" role="note">
          <Icon name="flag" />
          <div className="grow">
            <b>Worth a look.</b> {f.message}
            {gone && (
              <span className="it-flag-gone">
                {item.status === 'laptop'
                  ? ' This question was asked on the laptop and is not in this chapter’s bank, so there is no key here to change.'
                  : ' This question is no longer in the bank, so there is no key left to change.'}
              </span>
            )}
          </div>
          {onCheckKey && !gone && (
            <Button size="sm" icon="key" onClick={() => onCheckKey(item.questionId)}>Check the key</Button>
          )}
        </div>
      ))}

      {levelLine}

      <dl className="it-nums">
        <div><dt>Answers</dt><dd className="mono">{attempts}</dd></div>
        <div><dt>Correct</dt><dd className="mono">{num(item.correct) ?? '—'}</dd></div>
        <div><dt>Share correct</dt><dd className="mono">{share(item.proportionCorrect)}</dd></div>
        {meanScore !== null && <div><dt>Mean score</dt><dd className="mono">{share(meanScore)}</dd></div>}
        <div className="it-band">
          <dt>Band</dt>
          <dd>
            {band ? BAND[band] ?? band : 'None yet'}
            {band ? <small>for this class</small> : !basis && <small>{needs !== null ? `needs ${needs} answers` : 'too few answers'}</small>}
          </dd>
          {basis && <dd className="it-basis">{basis}</dd>}
        </div>
        <div>
          <dt>Point-biserial</dt>
          <dd>
            {pb !== null ? <span className="mono">{signed(pb)}</span> : 'Not worked out'}
            {pbN !== null && <small>from {pbN} {plural(pbN, 'student')}</small>}
          </dd>
        </div>
      </dl>

      <p className="it-explain">
        {pb === null && item.pointBiserialNote ? <><b>{item.pointBiserialNote}</b> </> : null}
        The point-biserial asks whether students who did well on their other answers also got this one right: above 0 they did more
        often, below 0 less often.
      </p>

      {versions > 1 && (
        <Note icon="history">
          <b>Edited while in use.</b> These answers were given to {versions} different versions of this question. The options and the key shown are
          the last version answered.
        </Note>
      )}

      <Spread item={item} />
      {about}
    </div>
  );
}

/* ------------------------------------------------------------ the rows */

/** The bank's status, in words, for anything that is not simply approved. */
export function StatusTag({ status }) {
  if (!status || status === 'active') return null;
  return <Chip className="chip-line it-status" data-status={status}>{STATUS[status] ?? status}</Chip>;
}

/**
 * The report's `translation`, said only when it matters: when at least one
 * question has a gap between languages worth a warning. Quiet (nothing drawn)
 * while every answer is in one language.
 */
export function TranslationLine({ translation, className = '' }) {
  const n = num(translation?.warnings) ?? 0;
  if (!n) return null;
  const gap = num(translation.gapAbovePoints);
  return (
    <p className={`it-trans ${className}`} role="note">
      <Icon name="alert" size={15} />
      <span>
        <b>
          {n} {plural(n, 'question has', 'questions have')} a gap between languages
          {gap !== null ? ` above ${gap} points` : ''}.
        </b>{' '}
        {translation.note}
      </span>
    </p>
  );
}

/**
 * Rows that open into ItemDetail, in the order given (the server sends flagged
 * first). Questions nobody has answered are folded away at the end.
 * `translation` (the report's, optional) draws TranslationLine above the rows.
 */
export function ItemList({ items, thresholds, onCheckKey, translation, className = '' }) {
  const [open, setOpen] = useState(() => new Set());
  const [showIdle, setShowIdle] = useState(false);
  const base = useId();
  const all = list(items);
  const answered = all.filter((i) => attemptsOf(i) > 0);
  const idle = all.filter((i) => attemptsOf(i) === 0);
  const toggle = (id) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const row = (item) => {
    const isOpen = open.has(item.questionId);
    const panel = `${base}-${item.questionId}`;
    return (
      <li key={item.questionId} className="it-item" data-flag={flagsOf(item).length ? 'true' : undefined} data-open={isOpen ? 'true' : undefined}>
        <button type="button" className="it-item-main" aria-expanded={isOpen} aria-controls={panel} onClick={() => toggle(item.questionId)}>
          <span className="it-item-body">
            <ItemMeta item={item} />
            <span className="it-item-text">{item.text || 'Question text not stored'}</span>
            {attemptsOf(item) > 0 ? <ItemFigures item={item} /> : <span className="it-figs"><span>Not answered yet</span></span>}
          </span>
          <Icon name="chevron" className="it-chev" />
        </button>
        {isOpen && <div id={panel} className="it-item-open"><ItemDetail item={item} onCheckKey={onCheckKey} thresholds={thresholds} /></div>}
      </li>
    );
  };

  return (
    <div className={`it-list ${className}`}>
      <TranslationLine translation={translation} className="it-trans-list" />
      <ul className="it-items">{answered.map(row)}</ul>
      {idle.length > 0 && (
        <div className="it-idle">
          <button type="button" className="it-idle-btn" aria-expanded={showIdle} onClick={() => setShowIdle((v) => !v)}>
            <Icon name={showIdle ? 'chevronUp' : 'chevron'} size={14} />
            {idle.length} {plural(idle.length, 'question')} nobody has answered yet
          </button>
          {showIdle && <ul className="it-items">{idle.map(row)}</ul>}
        </div>
      )}
    </div>
  );
}

/** The thresholds, said plainly, from the report itself. */
export function Thresholds({ thresholds, className = '' }) {
  const t = thresholds ?? {};
  const easy = num(t.easyAt);
  const hard = num(t.hardBelow);
  const band = num(t.minAnswersForBand);
  const pb = num(t.minStudentsForPointBiserial);
  const parts = [];
  if (easy !== null && hard !== null) parts.push(`Easy means ${share(easy)} correct or more, hard means under ${share(hard)}, and both are for this class only.`);
  if (band !== null) parts.push(`A question gets a band after ${band} answers.`);
  if (pb !== null) parts.push(`The point-biserial needs ${pb} students who also answered other questions.`);
  if (!parts.length) return null;
  return <p className={`it-rules ${className}`}>{parts.join(' ')}</p>;
}

/* ------------------------------------------------------------ the tab */

function Skeleton() {
  return (
    <div className="it-skel" aria-busy="true" aria-label="Counting how each question did">
      <div className="it-skel-figs">{[0, 1, 2].map((i) => <span key={i} className="skel" />)}</div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="it-skel-row"><span className="skel" /><span className="skel" /><span className="skel" /></div>
      ))}
    </div>
  );
}

/**
 * The bank's "How it went": every question across the rooms run on this
 * chapter, flagged first, each opening into its figures.
 *
 * Reads the report itself, or takes `stats` (what useBankStats returned) so a
 * bank that already reads it for its rows does not read it twice. `questions`
 * (the bank's own, optional) puts each question's wording, level, topic and
 * status as they stand now over the report's, which may be a read behind.
 */
export function StatsView({ contentId, questions, onCheckKey, stats, version }) {
  const own = useBankStats(stats ? null : contentId, version);
  const { data, error, loading, reload } = stats ?? own;
  const bank = useMemo(() => new Map(list(questions).map((q) => [q._id, q])), [questions]);
  // Phase 7: the questions this chapter's imported rooms asked on the laptop.
  const laptopIds = useLaptopQuestionIds(contentId);
  const items = useMemo(() => laptopItems(data?.items, null, laptopIds).map((i) => {
    const q = bank.get(i.questionId);
    return q ? {
      ...i, text: q.text ?? i.text, bloom: q.bloom ?? i.bloom, topic: q.topic ?? i.topic, status: q.status ?? i.status,
      provenance: q.provenance ?? i.provenance, levelCheck: q.levelCheck ?? i.levelCheck,
    } : i;
  }), [data, bank, laptopIds]);

  if (!data) {
    return (
      <section className="card it-view" aria-labelledby="it-view-h">
        <div className="it-view-head"><div className="sec"><h2 id="it-view-h">How each question did</h2><p>Reading the answers from every room on this chapter.</p></div></div>
        {error ? (
          <div className="it-pad">
            <Note tone="bad">
              Could not read how the questions did: {error}
              {reload && <div style={{ marginTop: 8 }}><Button size="sm" icon="refresh" onClick={reload}>Try again</Button></div>}
            </Note>
          </div>
        ) : loading ? <Skeleton /> : null}
      </section>
    );
  }

  const counted = data.counted ?? {};
  const answers = num(counted.answers) ?? 0;
  const students = num(counted.students) ?? 0;
  const rooms = list(data.rooms);
  const flagged = items.filter((i) => flagsOf(i).length > 0).length;
  const shownRooms = rooms.slice(0, 4);

  if (answers === 0) {
    return (
      <section className="card it-view" aria-labelledby="it-view-h">
        <h2 id="it-view-h" className="sr-only">How each question did</h2>
        <Empty icon="analytics" title={rooms.length ? 'No marked answer yet' : 'No room has run on this chapter yet'}>
          {rooms.length
            ? `${rooms.length} ${plural(rooms.length, 'room has', 'rooms have')} opened on this chapter, but no final, marked answer is stored yet. Each question's figures appear here as answers are marked.`
            : 'Once a room on this chapter has answers, each question shows here: how many answered, how many got it right, what they chose, and whether the key is worth a second look.'}
        </Empty>
      </section>
    );
  }

  return (
    <section className="card it-view" aria-labelledby="it-view-h" aria-busy={loading || undefined}>
      <div className="it-view-head">
        <div className="sec">
          <h2 id="it-view-h">How each question did</h2>
          <p>From final, marked answers in every room on this chapter you can read. Flagged questions come first.</p>
        </div>
        {reload && (
          <Button size="sm" variant="ghost" icon="refresh" busy={loading} onClick={reload}>Read again</Button>
        )}
      </div>

      <div className="it-sum">
        <div className="it-fig"><b>{answers}</b><span>{plural(answers, 'answer')} counted</span></div>
        <div className="it-fig">
          <b>{students}</b>
          <span title="A student is a roll number in one room: the same roll number in two rooms is two students.">{plural(students, 'student')}</span>
        </div>
        <div className="it-fig">
          <b>{rooms.length}</b>
          <span>
            {plural(rooms.length, 'room')}
            {shownRooms.length > 0 && (
              <span className="it-codes">
                {shownRooms.map((r) => <span key={r.code} className="mono" title={r.title || undefined}>{r.code}</span>)}
                {rooms.length > shownRooms.length && <span>+{rooms.length - shownRooms.length}</span>}
              </span>
            )}
          </span>
        </div>
        <div className="it-fig" data-tone={flagged ? 'warn' : undefined}>
          <b>{flagged}</b>
          <span>worth a look</span>
        </div>
      </div>

      <Thresholds thresholds={data.thresholds} className="it-pad-x" />
      {error && <p className="it-stale">Could not read the figures again just now ({error}). These were read earlier.</p>}

      <ItemList items={items} thresholds={data.thresholds} onCheckKey={onCheckKey} translation={data.translation} />
    </section>
  );
}

export default StatsView;
