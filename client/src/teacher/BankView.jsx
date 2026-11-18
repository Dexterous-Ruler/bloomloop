import { useEffect, useState } from 'react';

import { api } from '../api.js';
import { LEVELS, LABEL } from '../bloom.js';
import { BLANK_MARK, KIND_LABEL, KIND_TICK } from '../kinds.js';
import Icon from '../ui/Icon.jsx';
import { Card, Empty, PageHead, Stat, TailBars } from '../ui/Shell.jsx';
import GeneratePlanner from './GeneratePlanner.jsx';
import QuestionEditor from './QuestionEditor.jsx';

/** Six, not four: a multi-select item is allowed up to six options. */
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/**
 * Everything a teacher might type into the search box and expect to find.
 * Every kind's payload is listed, because a bank where searching "photosynthesis"
 * misses the sorting question whose groups are named after it is a bank the
 * teacher stops trusting the search box on.
 */
const haystack = (q) => [
  q.text,
  q.topic,
  ...(q.options ?? []),
  ...(q.pairs ?? []).flatMap((p) => [p?.left, p?.right]),
  ...(q.buckets ?? []).flatMap((b) => [b?.name, ...(b?.items ?? [])]),
  ...(q.sequence ?? []),
  q.criterion,
  ...(q.accept ?? []),
  ...(q.blanks ?? []).flatMap((b) => b?.accept ?? []),
  q.unit,
  ...(q.rubric ?? []),
].filter(Boolean).join(' ').toLowerCase();

function Missing({ kind }) {
  return (
    <div className="note warn" style={{ marginTop: 14 }}>
      <Icon name="alert" size={15} />
      <span>
        Stored as “{KIND_LABEL[kind] ?? kind}” but it arrived with nothing to answer, so no student
        can be served it. Discard it.
      </span>
    </div>
  );
}

/**
 * The answer key, drawn the way the kind wants to be read. Every kind other than
 * mcq keeps its payload in its own field, so a single options grid renders ten of
 * the eleven as an empty box — which is exactly what this screen used to do.
 *
 * Every branch checks its own payload first and falls to <Missing> when it is not
 * there. An unhandled kind falls through to the same place at the bottom, so a
 * kind added to the contract before it is drawn here says so on the card rather
 * than leaving a teacher to approve a question with no visible answer.
 */
function Payload({ q }) {
  const kind = q.kind ?? 'mcq';

  if (kind === 'mcq' || kind === 'multi') {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length === 0) return <Missing kind={kind} />;
    const right = new Set(
      kind === 'multi' ? (q.answerIdxs ?? []).map(Number) : [Number(q.answerIdx)],
    );
    return (
      <div className="qopts">
        {options.map((o, i) => (
          <div key={i} className={`qopt${right.has(i) ? ' right' : ''}`}>
            <span className="k">{KEYS[i] ?? i + 1}</span>
            <span className="t">{o}</span>
            {right.has(i) && <span className="tick">correct</span>}
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'truefalse') {
    // A boolean, checked as a boolean: a missing answerBool arriving as undefined
    // must not quietly render as "False", which is a real answer half the time.
    if (typeof q.answerBool !== 'boolean') return <Missing kind={kind} />;
    // Both sides are drawn, with one marked. The statement is above this block,
    // and a lone word "True" under it never says whether that is the answer or
    // the thing being claimed.
    return (
      <div className="qopts">
        {[true, false].map((v) => (
          <div key={String(v)} className={`qopt${v === q.answerBool ? ' right' : ''}`}>
            <span className="k">{v ? 'T' : 'F'}</span>
            <span className="t">{v ? 'True' : 'False'}</span>
            {v === q.answerBool && <span className="tick">correct</span>}
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'match') {
    const pairs = Array.isArray(q.pairs) ? q.pairs : [];
    if (pairs.length === 0) return <Missing kind={kind} />;
    // One pair per row, never side by side: a term and its definition are two
    // pieces of prose, and packing them into an options grid is what pushed the
    // definitions outside their cards.
    return (
      <div className="qopts one">
        {pairs.map((p, i) => (
          <div key={i} className="qpair">
            <span className="l">{p.left}</span>
            <span className="j"><Icon name="forward" size={13} /></span>
            <span className="r">{p.right}</span>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'categorise') {
    const buckets = Array.isArray(q.buckets) ? q.buckets : [];
    if (buckets.length === 0) return <Missing kind={kind} />;
    // Columns, not rows. In this kind the grouping IS the answer, and a group
    // name set beside its first item reads as a matched pair — which is the one
    // thing a sorting question must not look like on a screen that also shows
    // match questions.
    return (
      <div className="qopts">
        {buckets.map((b, i) => (
          <div key={i} className="qopt right qgroup">
            <span className="g">{b?.name}</span>
            <ul>
              {(Array.isArray(b?.items) ? b.items : []).map((it, j) => <li key={j}>{it}</li>)}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'order') {
    const sequence = Array.isArray(q.sequence) ? q.sequence : [];
    if (sequence.length === 0) return <Missing kind={kind} />;
    // `sequence` is stored in its CORRECT order; the phone shuffles it per student.
    return (
      <div className="qopts one">
        {sequence.map((t, i) => (
          <div key={i} className="qopt right">
            <span className="k">{i + 1}</span>
            <span className="t">{t}</span>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'rank') {
    const sequence = Array.isArray(q.sequence) ? q.sequence : [];
    const criterion = String(q.criterion ?? '').trim();
    // A ranking with no criterion is ordered by *what*? It is unanswerable, the
    // server's validator refuses to write one, and anything that reached the bank
    // without it is broken in the same way as an item with no items — so it is
    // reported the same way rather than drawn as a confident-looking list.
    if (sequence.length === 0 || !criterion) return <Missing kind={kind} />;
    return (
      <div className="qopts one">
        {/* The criterion first, unmarked: it is the question, not the answer. */}
        <div className="qopt">
          <span className="k">ranked by</span>
          <span className="t">{criterion}</span>
        </div>
        {sequence.map((t, i) => (
          <div key={i} className="qopt right">
            <span className="k">{i + 1}</span>
            <span className="t">{t}</span>
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'blank') {
    const accept = Array.isArray(q.accept) ? q.accept : [];
    if (accept.length === 0) return <Missing kind={kind} />;
    return (
      <div className="qopts">
        {accept.map((a, i) => (
          <div key={i} className="qopt right">
            <span className="k">{i === 0 ? '=' : 'or'}</span>
            <span className="t">{a}</span>
            {i === 0 && <span className="tick">accepted</span>}
          </div>
        ))}
      </div>
    );
  }

  if (kind === 'cloze') {
    const blanks = Array.isArray(q.blanks) ? q.blanks : [];
    // Splitting on the marker gives n+1 pieces of prose around n gaps, so the
    // two only line up when the passage really does carry a marker per blank.
    const parts = String(q.text ?? '').split(BLANK_MARK);
    if (blanks.length === 0 || parts.length - 1 !== blanks.length) return <Missing kind={kind} />;
    // Filled in place rather than listed beside the passage: a teacher checks a
    // cloze by reading the finished sentence, and a numbered list of answers
    // makes them count gaps to work out which one belongs where.
    return (
      <div className="qopts one">
        <div className="qopt">
          <span className="t qcloze">
            {parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < parts.length - 1 && <b>{blanks[i]?.accept?.[0]}</b>}
              </span>
            ))}
          </span>
        </div>
      </div>
    );
  }

  if (kind === 'numeric') {
    // Number(), not a truthiness check: a correct answer of 0 is a real value and
    // used to fall through to "nothing to answer".
    const value = Number(q.value);
    if (!Number.isFinite(value)) return <Missing kind={kind} />;
    const tol = Number(q.tolerance);
    const spread = Number.isFinite(tol) && tol > 0 ? tol : 0;
    const unit = String(q.unit ?? '').trim();
    return (
      <div className="qopts">
        <div className="qopt right">
          <span className="k">=</span>
          {/* The tolerance sits with the value because it is part of the answer —
              a teacher reading "3000" alone cannot tell how close is close. */}
          <span className="t">
            {value}{spread ? ` ± ${spread}` : ''}{unit ? ` ${unit}` : ''}
          </span>
          <span className="tick">{spread ? 'accepted' : 'exact'}</span>
        </div>
      </div>
    );
  }

  if (kind === 'open') {
    const rubric = Array.isArray(q.rubric) ? q.rubric : [];
    if (rubric.length === 0) return <Missing kind={kind} />;
    // Rubric points are not answers, so they are not marked correct — they are
    // the phrases the server's word-overlap scorer looks for.
    return (
      <div className="qopts one">
        {rubric.map((r, i) => (
          <div key={i} className="qopt">
            <span className="k">{i + 1}</span>
            <span className="t">{r}</span>
          </div>
        ))}
      </div>
    );
  }

  return <Missing kind={kind} />;
}

export default function BankView({ content, selected, bank, onBank, onNext }) {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState('');
  const [progress, setProgress] = useState(null);
  const [tookSecs, setTookSecs] = useState(null);
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [filter, setFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [working, setWorking] = useState('');
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState(null);
  // Which question is open in the editor, by id rather than by value: the row
  // is re-fetched after every write, and holding the object would leave the
  // editor showing the version from before the save that just succeeded.
  const [editing, setEditing] = useState('');
  // The selection, and what the last action over it did. A bulk action can
  // refuse some of what it was given and do the rest, so the answer is kept
  // and shown rather than collapsing to "done" or "failed".
  const [picked, setPicked] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);
  const [retagTo, setRetagTo] = useState('');
  // The run the server answered 409 on: held so the confirm button can re-send
  // exactly what was refused, rather than whatever the controls say by then.
  const [held, setHeld] = useState(null);
  // What the planner's controls are set to. It lives here rather than in the
  // planner because generating unmounts that screen, and a teacher who came back
  // from a refused run to find their numbers reset would never trust the number.
  // Six per topic keeps every level represented without asking for a coffee break.
  const [draft, setDraft] = useState(() => ({
    total: Math.min(72, Math.max(12, (selected.length || 1) * 6)),
    preset: 'balanced',
    mix: null,
    // Only the levels the teacher moved off the default. An empty object means
    // "whatever the server picks", which is the honest thing to send: the default
    // interaction for a level is the server's to decide, not this screen's.
    kinds: {},
    mode: 'replace',
  }));

  // The claim on the poster is "40+ questions in under two minutes", so the
  // clock is on screen while it happens rather than asserted afterwards.
  useEffect(() => {
    if (!busy) return undefined;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(t);
  }, [busy]);

  // Generation is a single POST that answers once, a minute or two later, so the
  // only way to say anything true about it while it runs is to ask. Polled, not
  // pushed: a socket for a screen that exists for ninety seconds is not worth
  // the reconnect logic.
  useEffect(() => {
    if (!busy || !runId) return undefined;
    let alive = true;
    const tick = () => {
      api.generateRun(runId).then(
        (res) => { if (alive && res?.run) setProgress(res.run); },
        // A 404 means the run has not been registered yet, which is normal for
        // the first poll. Nothing to report and nothing to say about it.
        () => {},
      );
    };
    tick();
    const t = setInterval(tick, 900);
    return () => { alive = false; clearInterval(t); };
  }, [busy, runId]);

  async function refresh() {
    const res = await api.getBank(content.contentId);
    onBank(res);
  }

  async function run(spec, opts) {
    setError('');
    setWarnings([]);
    setHeld(null);
    setBusy(true);
    setElapsed(0);
    setProgress(null);
    // Minted here, not by the server: the POST does not answer until the run is
    // over, so the id has to exist before the call in order to poll it during.
    const id = (crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    setRunId(id);
    const started = Date.now();
    try {
      const res = await api.generate(content.contentId, topics, spec, { ...opts, runId: id });
      setWarnings(res.warnings ?? []);
      setTookSecs(Math.round((Date.now() - started) / 1000));
      setPlanning(false);
      await refresh();
    } catch (err) {
      // 409 is the server refusing a big run until the teacher has seen the
      // number. That is a question, not a failure, so it gets a panel and a
      // button rather than a red box.
      if (err.status === 409) setHeld({ spec, mode: opts.mode, total: plan?.total ?? null });
      else setError(`Generation failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(id, what, fn) {
    setWorking(`${id}:${what}`);
    setError('');
    try { await fn(); await refresh(); }
    catch (err) { setError(err.message); }
    finally { setWorking(''); }
  }

  function toggle(id) {
    setBulk(null);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /**
   * One action across the selection. The server answers with what it changed
   * AND what it refused, and both are reported: a retag that could not honestly
   * move four of thirty items has to say which four and why, or the teacher is
   * left believing the bank is something it is not.
   */
  async function runBulk(what, fn) {
    setWorking(`bulk:${what}`);
    setError('');
    setBulk(null);
    try {
      const res = await fn([...picked]);
      await refresh();
      // Merge answers with the one question it made; the bulk route answers
      // with a count and a refusal list. Normalised here so the report below
      // reads the same shape whichever was pressed.
      setBulk({
        what,
        changed: res.changed ?? (res.question ? 1 : 0),
        refused: res.refused ?? [],
        level: res.level ?? '',
      });
      // Only what actually moved leaves the selection, so a refusal stays
      // ticked and can be opened and fixed.
      const refusedIds = new Set((res.refused ?? []).map((r) => String(r.id)));
      setPicked((prev) => new Set([...prev].filter((id) => refusedIds.has(String(id)))));
    } catch (err) {
      // Reported where the selection is, not in the page-level error box at the
      // top: the button that was pressed is at the bottom of a long list, and an
      // answer a screen and a half away from it is an answer nobody reads.
      setBulk({ what, changed: 0, refused: [{ id: 'all', reason: err.message }], level: '' });
    } finally {
      setWorking('');
    }
  }

  if (!content) {
    return (
      <Empty icon="deck" title="No material loaded">
        Open a chapter on Material first — the bank is written from what you already teach, so there
        is nothing to write from until then.
      </Empty>
    );
  }

  // Nothing ticked is not an error: the server falls back to the chapter title as
  // a single topic, so resolve it here too and the preview cannot promise a
  // different bank from the one the run produces.
  const topics = selected.length > 0 ? selected : [content.title];

  const questions = bank?.questions ?? [];
  const active = questions.filter((q) => q.status !== 'discarded');
  const discarded = questions.filter((q) => q.status === 'discarded');
  const dist = LEVELS.reduce((a, l) => ({ ...a, [l]: active.filter((q) => q.bloom === l).length }), {});
  const fallbacks = active.filter((q) => q.source === 'fallback').length;

  /* --- generating ------------------------------------------------------- */
  if (busy) {
    return (
      <>
        <PageHead
          title="Writing the bank"
          sub={`${plan?.total ?? ''} questions across ${topics.length} topic${topics.length === 1 ? '' : 's'}, from ${content.title}.`}
        />

        <Card className="pad-lg">
          <div className="row" style={{ alignItems: 'flex-end', gap: 24 }}>
            <div>
              <div className="eyebrow">Elapsed</div>
              <div
                className="mono"
                style={{ marginTop: 12, fontSize: 56, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.03em' }}
              >
                {mmss(elapsed)}
              </div>
            </div>
            <span className="grow" />
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
                {progress ? `${progress.written} of ${progress.planned}` : `${plan?.total ?? '—'} planned`}
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {progress?.topicsTotal
                  ? `topic ${Math.min(progress.topicsDone + 1, progress.topicsTotal)} of ${progress.topicsTotal}${progress.topic ? ` · ${progress.topic}` : ''}`
                  : plan ? `about ${mmss(plan.estimateSeconds)} expected` : 'resolving the plan'}
              </div>
            </div>
          </div>

          {/* Real counts, polled from the run while it is still open. These bars
              used to be hard-coded to 100% width, so a healthy ninety-second run
              looked like a finished one that had produced nothing. */}
          <div className="stack" style={{ marginTop: 30, gap: 13 }}>
            {LEVELS.map((l, i) => {
              const want = plan?.perLevel?.[l] ?? 0;
              const got = progress?.perLevelDone?.[l] ?? 0;
              // Before the first topic lands there is nothing to measure, so the
              // bar sits at a sliver and shimmers rather than claiming a share.
              const pct = want > 0 ? Math.min(100, Math.round((got / want) * 100)) : 0;
              return (
                <div className="genrow" key={l}>
                  <span className="n">{LABEL[l]}</span>
                  <span className="track">
                    <i
                      className={`swatch ${l}`}
                      style={
                        progress
                          ? { width: `${Math.max(pct, want ? 2 : 0)}%` }
                          : { width: '18%', animation: `bl-pulse 1.6s ease-in-out ${i * 0.12}s infinite` }
                      }
                    />
                  </span>
                  <span className="c">{want ? `${got}/${want}` : '—'}</span>
                </div>
              );
            })}
          </div>

          <div className="said" style={{ marginTop: 28 }}>
            <span>
              Every item is tagged to exactly one level as it is written. Nothing is tagged
              afterwards, so nothing lands untagged.
            </span>
          </div>
        </Card>

        <div className="stack" style={{ marginTop: 14 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 138, borderRadius: 'var(--r-card)' }} />
          ))}
        </div>
      </>
    );
  }

  /* --- the planner ------------------------------------------------------- */
  if (planning || active.length === 0) {
    return (
      <>
        <PageHead
          title={active.length === 0 ? 'Plan the question bank' : 'Plan another run'}
          sub={`${content.title} · ${topics.length} topic${topics.length === 1 ? '' : 's'}. It happens once, before class — the live session never calls a model.`}
          actions={active.length > 0 && (
            <button type="button" className="btn" onClick={() => setPlanning(false)}>
              <Icon name="back" size={13} />
              Back to the bank
            </button>
          )}
        />

        {error && (
          <div className="note bad" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </div>
        )}

        {selected.length === 0 && (
          <div className="note info" style={{ marginBottom: 14 }}>
            <Icon name="info" size={15} />
            <span>
              No topics are ticked, so the whole chapter counts as one topic — the same fallback the
              server applies. Tick topics on Material for a wider spread.
            </span>
          </div>
        )}

        {held && plan && (
          <div className="note warn" style={{ marginBottom: 14 }}>
            <Icon name="alert" size={15} />
            <div>
              <b style={{ display: 'block', fontWeight: 800 }}>{plan.total} questions is a big run.</b>
              <span style={{ display: 'block', marginTop: 4 }}>
                It takes about {mmss(plan.estimateSeconds)} and spends real model quota.{' '}
                {held.mode === 'replace'
                  ? 'Everything already in this bank, discarded items included, is deleted first.'
                  : `They are added on top of the ${active.length} already in this bank.`}
              </span>
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
                <button
                  type="button"
                  className="btn pri sm"
                  onClick={() => run(held.spec, { mode: held.mode, confirm: true })}
                >
                  <Icon name="check" size={12} />
                  Yes, write {plan.total} questions
                </button>
                <button type="button" className="btn ghost sm" onClick={() => setHeld(null)}>
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        <GeneratePlanner
          contentId={content.contentId}
          topics={topics}
          // Active only, because that is what /generate/preview counts back.
          existing={active.length}
          draft={draft}
          onDraft={(patch) => {
            setDraft((d) => ({ ...d, ...patch }));
            // Switching replace/append does not move the total, so nothing else
            // would clear a refusal that no longer describes what is about to run.
            if (patch.mode) setHeld(null);
          }}
          // A refused run stops being refused the moment the teacher changes the
          // number — but not when the planner simply re-resolves the same plan
          // after remounting, or the confirm panel would vanish as it appeared.
          onPlan={(next) => {
            setPlan(next);
            setHeld((h) => (h && h.total !== next.total ? null : h));
          }}
          onRun={run}
        />
      </>
    );
  }

  /* --- one question, open ------------------------------------------------ */
  // Looked up rather than held: every write refreshes the bank, and an editor
  // rendering the copy it was opened with would show the question as it was
  // before the save that just went through.
  const open = editing ? questions.find((q) => q._id === editing) : null;
  if (open) {
    return (
      <QuestionEditor
        question={open}
        // Which kinds this level may be asked through comes from the server
        // with the bank. The editor never works it out from a table of its own.
        kinds={bank?.kinds}
        onClose={() => setEditing('')}
        onDone={async () => { await refresh(); setEditing(''); }}
      />
    );
  }

  /* --- the bank ---------------------------------------------------------- */
  const bankTopics = [...new Set(active.map((q) => q.topic).filter(Boolean))];
  const knownTopics = content.topics?.length || topics.length;
  const kindCounts = active.reduce((a, q) => {
    const k = q.kind ?? 'mcq';
    return { ...a, [k]: (a[k] ?? 0) + 1 };
  }, {});
  const kindRows = Object.entries(kindCounts).sort((a, b) => b[1] - a[1]);
  // Which interactions a level got is a property of the bank in front of us, not
  // something the client is allowed to assume. A level offers a SET, so one bank
  // can honestly hold two kinds at a single level — naming only the first one
  // written would hide half of what the class is about to be asked.
  const kindsOf = LEVELS.reduce((a, l) => ({
    ...a,
    [l]: [...new Set(active.filter((q) => q.bloom === l).map((q) => q.kind ?? 'mcq'))],
  }), {});

  const pills = [
    { id: 'All', label: 'All', n: active.length },
    ...LEVELS.map((l) => ({ id: l, label: LABEL[l], n: dist[l] })),
    { id: 'discarded', label: 'Discarded', n: discarded.length },
  ];

  const pool = filter === 'discarded'
    ? discarded
    : filter === 'All' ? active : active.filter((q) => q.bloom === filter);
  const needle = query.trim().toLowerCase();
  const shown = needle ? pool.filter((q) => haystack(q).includes(needle)) : pool;

  // What the last action over the selection actually did. "Nothing changed" is
  // said out loud rather than left to be inferred from a bank that looks the
  // same as it did before the press.
  const many = (n) => `${n} question${n === 1 ? '' : 's'}`;
  const bulkSaid = !bulk ? '' : bulk.changed === 0 ? 'Nothing changed'
    : bulk.what === 'merge' ? 'Two questions merged into one — both originals are in the discarded pile'
      : bulk.what === 'bloom' ? `${many(bulk.changed)} retagged${bulk.level ? ` to ${bulk.level}` : ''}`
        : `${many(bulk.changed)} ${bulk.what === 'discard' ? 'discarded' : 'restored'}`;

  return (
    <>
      <PageHead
        title="Question bank"
        sub={`${active.length} active · ${bankTopics.length} topic${bankTopics.length === 1 ? '' : 's'} · written from ${content.title}${tookSecs != null ? ` in ${mmss(tookSecs)}` : ''}`}
        actions={(
          <>
            <button type="button" className="btn" onClick={() => setPlanning(true)}>
              <Icon name="wand" size={13} />
              Plan another run
            </button>
            <button type="button" className="btn pri" onClick={onNext}>
              Start a session
              <Icon name="forward" size={13} />
            </button>
          </>
        )}
      />

      {error && (
        <div className="note bad" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="note warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>
            {warnings.length} item{warnings.length === 1 ? '' : 's'} were rejected by the schema and
            retried: {warnings.slice(0, 3).join(' · ')}
          </span>
        </div>
      )}
      {fallbacks > 0 && (
        <div className="note warn" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>
            {fallbacks} of these came from the offline template writer, not the language model. They
            are labelled here and on every student phone — do not present them as AI-generated.
          </span>
        </div>
      )}

      <div className="grid auto" style={{ marginBottom: 16 }}>
        <Stat
          label="Active questions"
          icon="layers"
          value={active.length}
          delta={discarded.length > 0 ? `${discarded.length} discarded` : 'nothing discarded yet'}
          tail={<TailBars bars={LEVELS.map((l) => ({ label: LABEL[l].slice(0, 3), value: dist[l], on: filter === l }))} />}
        />
        <Stat
          label="Topics covered"
          icon="list"
          value={bankTopics.length}
          unit={`of ${knownTopics}`}
          delta="numbered in the order they were written"
          tail={(
            <TailBars
              bars={bankTopics.slice(0, 8).map((t, i) => ({
                label: String(i + 1),
                value: active.filter((q) => q.topic === t).length,
                on: true,
              }))}
            />
          )}
        />
        <Stat
          label="Interactions"
          icon="grid"
          value={kindRows.length}
          unit="kinds"
          delta="chosen by the Bloom level, never by the question"
          tail={kindRows.length > 0
            ? <TailBars bars={kindRows.map(([k, n]) => ({ label: KIND_TICK[k] ?? k, value: n, on: true }))} />
            : null}
        />
        {fallbacks > 0 && (
          <Stat
            label="Offline templates"
            icon="alert"
            tone="warn"
            value={fallbacks}
            unit={`of ${active.length}`}
            delta="not model output — say so if you show them"
            tail={(
              <TailBars
                bars={LEVELS.map((l) => ({
                  label: LABEL[l].slice(0, 3),
                  value: active.filter((q) => q.bloom === l && q.source === 'fallback').length,
                  on: false,
                }))}
              />
            )}
          />
        )}
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-head">
          <span className="t">Bank shape</span>
          <span className="panel-sub">Each level carries its own set of interactions — that pairing is the point.</span>
          <span className="grow" />
          <button type="button" className="btn on-d" onClick={() => setPlanning(true)}>
            <Icon name="wand" size={13} />
            Change the mix
          </button>
        </div>

        <div className="dist">
          {LEVELS.map((l) => dist[l] > 0 && <i key={l} className={`swatch ${l}`} style={{ flex: dist[l] }} />)}
        </div>

        <div className="accent" style={{ marginTop: 14 }}>
          <div className="k">Across the six levels</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 9, marginTop: 7 }}>
            <span className="num" style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em' }}>
              {active.length}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>tagged questions</span>
            {discarded.length > 0 && <span className="flag neutral">{discarded.length} discarded</span>}
          </div>

          <div className="tiles" style={{ marginTop: 16 }}>
            {LEVELS.map((l) => (
              <div className="accent-tile" key={l}>
                <b>
                  {dist[l]}
                  <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.65 }}>
                    {Math.round((dist[l] / Math.max(1, active.length)) * 100)}%
                  </span>
                </b>
                <span>
                  {LABEL[l]} · {kindsOf[l].length
                    ? kindsOf[l].map((k) => KIND_LABEL[k] ?? k).join(' + ')
                    : 'none written'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        {pills.map((p) => (
          <button
            key={p.id}
            type="button"
            className="fpill"
            aria-pressed={filter === p.id}
            onClick={() => setFilter(p.id)}
          >
            {p.label}
            <b>{p.n}</b>
          </button>
        ))}
        <span className="grow" />
        <label className="search" style={{ width: 236 }}>
          <Icon name="search" size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions and topics"
            aria-label="Search the bank"
          />
        </label>
      </div>

      {bulk && (
        <div className={`note ${bulk.refused.length ? 'warn' : 'ok'}`} style={{ marginBottom: 14 }}>
          <Icon name={bulk.refused.length ? 'alert' : 'checkCircle'} size={15} />
          <div>
            <b style={{ display: 'block', fontWeight: 800 }}>
              {bulkSaid}
              {bulk.changed > 0 && bulk.refused.length > 0 && `, ${bulk.refused.length} refused`}
            </b>
            {/* Every refusal, in the server's own words. A count on its own
                tells a teacher something went wrong and nothing they can act on. */}
            {bulk.refused.map((r) => (
              <span key={r.id} style={{ display: 'block', marginTop: 5 }}>{r.reason}</span>
            ))}
            {/* The refused ones are the ones still ticked, so the reasons above
                and the cards below are the same list read two ways. */}
            {bulk.refused.length > 0 && picked.size > 0 && (
              <span style={{ display: 'block', marginTop: 7, fontWeight: 700 }}>
                Still ticked below, so you can open {picked.size === 1 ? 'it' : 'them'} and fix{' '}
                {picked.size === 1 ? 'it' : 'them'}.
              </span>
            )}
          </div>
        </div>
      )}

      {picked.size > 0 && (
        <Card style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 9 }}>
            <span className="flag info">{picked.size} picked</span>
            <button type="button" className="btn ghost sm" onClick={() => { setPicked(new Set()); setBulk(null); }}>
              Clear
            </button>
            <span className="grow" />

            <select
              aria-label="Retag the picked questions"
              value={retagTo}
              style={{ width: 176, height: 32, fontSize: 12 }}
              onChange={(e) => setRetagTo(e.target.value)}
            >
              <option value="">Retag to…</option>
              {LEVELS.map((l) => <option key={l} value={l}>{LABEL[l]}</option>)}
            </select>
            <button
              type="button"
              className="btn sm"
              disabled={!retagTo || Boolean(working)}
              onClick={() => runBulk('bloom', (ids) => api.bulkQuestions(ids, 'bloom', retagTo))}
            >
              {working === 'bulk:bloom' ? <><span className="spin" />Retagging…</> : <>Retag</>}
            </button>

            <button
              type="button"
              className="btn sm"
              // Two, exactly: a merge produces one question out of one pair, and
              // three at a time would be a different operation with a different
              // answer key.
              disabled={picked.size !== 2 || Boolean(working)}
              title={picked.size === 2 ? 'Combine these two into one question' : 'Pick exactly two questions to merge'}
              onClick={() => runBulk('merge', (ids) => api.mergeQuestions(ids))}
            >
              {working === 'bulk:merge' ? <><span className="spin" />Merging…</> : <><Icon name="merge" size={12} />Merge two</>}
            </button>

            <button
              type="button"
              className="btn sm"
              disabled={Boolean(working)}
              onClick={() => runBulk('restore', (ids) => api.bulkQuestions(ids, 'restore'))}
            >
              {working === 'bulk:restore' ? <><span className="spin" />Restoring…</> : <><Icon name="refresh" size={12} />Restore</>}
            </button>
            <button
              type="button"
              className="btn sm danger"
              disabled={Boolean(working)}
              onClick={() => runBulk('discard', (ids) => api.bulkQuestions(ids, 'discard'))}
            >
              {working === 'bulk:discard' ? <><span className="spin" />Discarding…</> : <><Icon name="trash" size={12} />Discard</>}
            </button>
          </div>
        </Card>
      )}

      {shown.length === 0 ? (
        <Card>
          <Empty
            icon="search"
            title="Nothing here"
            action={(
              <button type="button" className="btn" onClick={() => { setFilter('All'); setQuery(''); }}>
                Clear the filter
              </button>
            )}
          >
            {needle
              ? `Nothing in the bank mentions “${query.trim()}”.`
              : 'No questions at that level yet. Plan another run weighted towards it, or pick a different filter.'}
          </Empty>
        </Card>
      ) : (
        <div className="stack">
          {shown.map((q) => {
            const kind = q.kind ?? 'mcq';
            const rowBusy = working.startsWith(`${q._id}:`);
            return (
              <article
                key={q._id}
                className={`qcard${q.status === 'discarded' ? ' off' : ''}`}
                aria-selected={picked.has(q._id)}
              >
                <div className="row" style={{ gap: 9 }}>
                  {/* Its own hit area, not the card's: picking a question and
                      opening one are two different intentions, and a card that
                      does both on one click does the wrong one half the time. */}
                  <label className="qpick" title="Pick this question">
                    <input
                      type="checkbox"
                      checked={picked.has(q._id)}
                      onChange={() => toggle(q._id)}
                      aria-label={`Pick: ${q.text}`}
                    />
                  </label>
                  <span className={`tag ${q.bloom}`}>{LABEL[q.bloom] ?? q.bloom}</span>
                  <span className="flag neutral">{KIND_LABEL[kind] ?? kind}</span>
                  <span className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{q.topic}</span>
                  {q.source === 'fallback' && <span className="flag">offline template</span>}
                  <span className="grow" />

                  {q.status === 'discarded' ? (
                    <button
                      type="button"
                      className="btn sm"
                      disabled={rowBusy}
                      onClick={() => act(q._id, 'restore', () => api.restoreQuestion(q._id))}
                    >
                      {working === `${q._id}:restore`
                        ? <><span className="spin" />Restoring…</>
                        : <><Icon name="refresh" size={12} />Restore</>}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={rowBusy}
                        onClick={() => setEditing(q._id)}
                      >
                        <Icon name="edit" size={12} />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn sm"
                        disabled={rowBusy}
                        onClick={() => act(q._id, 'regen', () => api.regenerateQuestion(q._id))}
                      >
                        {working === `${q._id}:regen`
                          ? <><span className="spin" />Rewriting…</>
                          : <><Icon name="wand" size={12} />Regenerate</>}
                      </button>
                      <button
                        type="button"
                        className="btn sm danger"
                        disabled={rowBusy}
                        onClick={() => act(q._id, 'discard', () => api.discardQuestion(q._id))}
                      >
                        {working === `${q._id}:discard`
                          ? <><span className="spin" />Discarding…</>
                          : <><Icon name="trash" size={12} />Discard</>}
                      </button>
                    </>
                  )}
                </div>

                {/* The question itself is the way into the editor. A teacher
                    reaching for a question reaches for its words, not for a
                    control beside them. */}
                <button
                  type="button"
                  className="qt"
                  title="Open this question"
                  onClick={() => setEditing(q._id)}
                >
                  {q.text}
                </button>
                <Payload q={q} />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
