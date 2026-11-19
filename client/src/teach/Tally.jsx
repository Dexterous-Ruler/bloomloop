/**
 * Raised hands: a question asked aloud, and the hands counted per option.
 *
 * The professor asks the room, counts the hands for A to D and taps + or -.
 * Each tap is one request, sent in order, and the count shown is the server's
 * plus the taps it has not answered yet. A count never goes below 0: a - at 0
 * comes back `clamped: true` with nothing changed, and the screen says so
 * quietly rather than looking broken.
 *
 * The question may be put on the projector from the Projector view. The hands
 * never go there.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { record, shownOf, useOutbox, useSynced } from '../lib/consoleOutbox.js';
import { Button, Chip, Empty, Field, Icon, Note, Segmented } from '../ui/index.jsx';
import { Privacy, QuestionPicker, ReadFailed, clock } from './Wheel.jsx';

const KEYS = ['A', 'B', 'C', 'D'];

/* ------------------------------------------------------------- compose */

const BLANK = { text: '', labels: ['', '', '', ''], correct: '' };

/** Ask a question aloud: typed here, or one of the room's questions. */
export function TallyComposer({ busy, error, onCreate, questions, initial }) {
  const [source, setSource] = useState(initial?.source ?? 'typed');
  const [draft, setDraft] = useState(initial?.draft ?? BLANK);
  const [questionId, setQuestionId] = useState(initial?.questionId ?? null);

  const ready = source === 'typed' ? draft.text.trim().length > 0 : Boolean(questionId);

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    let body;
    if (source === 'bank') {
      body = { questionId };
    } else {
      const labels = draft.labels.map((l) => l.trim());
      body = {
        text: draft.text.trim(),
        ...(labels.some(Boolean) ? { labels } : {}),
        ...(draft.correct ? { correct: draft.correct } : {}),
      };
    }
    if (await onCreate(body)) {
      setDraft(BLANK);
      setQuestionId(null);
    }
  }

  return (
    <section className="card rc-compose" aria-labelledby="rc-compose-h">
      <header className="rc-card-h">
        <div className="sec">
          <h2 id="rc-compose-h">Ask a question aloud</h2>
          <p>Then count the hands raised for each option.</p>
        </div>
      </header>
      <form className="rc-compose-body" onSubmit={submit}>
        <Segmented
          label="Where the question comes from"
          value={source}
          onChange={setSource}
          options={[{ id: 'typed', label: 'Type it' }, { id: 'bank', label: 'From the bank' }]}
        />
        {source === 'typed' ? (
          <>
            <Field label="Question" htmlFor="rc-t-text">
              <textarea
                id="rc-t-text"
                className="textarea rc-t-text"
                rows={3}
                maxLength={1000}
                value={draft.text}
                placeholder="Which traversal of a binary search tree gives sorted output?"
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              />
            </Field>
            <fieldset className="rc-t-opts">
              <legend className="label">Options <span className="opt">optional</span></legend>
              {KEYS.map((k, i) => (
                <label key={k} className="rc-t-opt">
                  <span className="rc-key mono" aria-hidden="true">{k}</span>
                  <input
                    className="input input-sm"
                    aria-label={`Option ${k}`}
                    maxLength={200}
                    value={draft.labels[i]}
                    onChange={(e) => setDraft({ ...draft, labels: draft.labels.map((l, j) => (j === i ? e.target.value : l)) })}
                  />
                </label>
              ))}
            </fieldset>
            <Field label="Correct option" optional htmlFor="rc-t-correct">
              <select id="rc-t-correct" className="select input-sm" value={draft.correct} onChange={(e) => setDraft({ ...draft, correct: e.target.value })}>
                <option value="">Not set</option>
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
          </>
        ) : (
          <Field label="Question" hint="A choose-one question brings its text, its four options and its key." htmlFor="rc-t-bank">
            <QuestionPicker id="rc-t-bank" questions={questions} value={questionId} onChange={setQuestionId} />
          </Field>
        )}
        {error && <Note tone="bad" role="alert">{error}</Note>}
        <Button type="submit" variant="primary" icon="hand" busy={busy} disabled={!ready}>Start counting</Button>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------- one tally */

function Counter({ tally, option, shown, canControl, onStep }) {
  const label = option.label || `Option ${option.key}`;
  const share = tally.total > 0 ? Math.min(1, shown / Math.max(tally.total, 1)) : 0;
  const keyed = tally.revealed && option.correct;
  return (
    <li className="rc-opt" data-key={keyed ? 'true' : undefined}>
      <span className="rc-key mono" aria-hidden="true">{option.key}</span>
      <div className="rc-opt-main">
        <span className={`rc-opt-t${option.label ? '' : ' is-blank'}`}>
          {label}
          {keyed && <span className="rc-correct"><Icon name="check" size={11} />Correct</span>}
        </span>
        <span className="rc-meter" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>
      </div>
      {canControl ? (
        <span className="rc-step" role="group" aria-label={`Hands for ${option.key}`}>
          <button type="button" aria-label={`One fewer hand for ${option.key}`} onClick={() => onStep(option.key, -1)}><Icon name="minus" /></button>
          <b className="mono" aria-live="polite">{shown}</b>
          <button type="button" aria-label={`One more hand for ${option.key}`} onClick={() => onStep(option.key, 1)}><Icon name="plus" /></button>
        </span>
      ) : (
        <b className="rc-count mono">{shown}</b>
      )}
    </li>
  );
}

export function TallyCard({ tally, pending = {}, canControl, busy, flash, onStep, onPatch }) {
  const count = (o) => Math.max(0, o.count + (pending[`${tally.id}:${o.key}`] ?? 0));
  const working = busy === `patch:${tally.id}`;
  return (
    <section className="card rc-tcard" aria-labelledby={`rc-tc-${tally.id}`}>
      <header className="rc-tcard-h">
        <span className="eyebrow">
          Asked aloud{tally.createdAt ? ` at ${clock(tally.createdAt)}` : ''}
          {tally.questionId && <Chip className="rc-src">From the bank</Chip>}
        </span>
        <h2 id={`rc-tc-${tally.id}`}>{tally.text}</h2>
        <p className="rc-tsum"><Icon name="hand" size={14} />{tally.summary}</p>
      </header>

      <ul className="rc-opts">
        {tally.options.map((o) => (
          <Counter key={o.key} tally={tally} option={o} shown={count(o)} canControl={canControl} onStep={(key, dir) => onStep(tally, key, dir)} />
        ))}
      </ul>

      <p className={`rc-flash${flash?.bad ? ' is-bad' : ''}`} role="status" aria-live="polite">
        {flash?.id === tally.id && flash.text ? <><Icon name={flash.bad ? 'alert' : 'info'} size={14} />{flash.text}</> : null}
      </p>

      <footer className="rc-tcard-f">
        {canControl ? (
          <div className="cluster">
            {tally.correct && (
              <Button size="sm" icon={tally.revealed ? 'eyeOff' : 'eye'} disabled={working} onClick={() => onPatch(tally.id, { revealed: !tally.revealed })}>
                {tally.revealed ? 'Hide answer' : 'Reveal answer'}
              </Button>
            )}
            <label className="rc-inline">
              <span>Correct option</span>
              <select
                className="select input-sm"
                value={tally.correct ?? ''}
                disabled={working}
                onChange={(e) => onPatch(tally.id, { correct: e.target.value || null })}
              >
                <option value="">Not set</option>
                {KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            {working && <span className="spinner" aria-label="Saving" />}
          </div>
        ) : (
          <span className="t-meta">{tally.correct ? `Correct option ${tally.correct}${tally.revealed ? ', revealed' : ''}` : 'No correct option set'}</span>
        )}
        <p className="rc-proj"><Icon name="projector" size={14} /><span>The hands are counted here only. They never go on the projector.</span></p>
      </footer>
    </section>
  );
}

function TallySkeleton() {
  return (
    <div className="rc-tally" aria-busy="true" aria-label="Reading the questions asked aloud">
      <section className="card rc-tcard">
        <div className="rc-tcard-h"><span className="skel" style={{ height: 12, width: 120 }} /><span className="skel" style={{ height: 22, width: '80%' }} /></div>
        <div className="rc-opts">{KEYS.map((k) => <span key={k} className="skel" style={{ height: 40 }} />)}</div>
      </section>
      <section className="card rc-compose"><div className="rc-card-h"><span className="skel" style={{ height: 20, width: 180 }} /></div><div className="rc-compose-body"><span className="skel" style={{ height: 90 }} /></div></section>
    </div>
  );
}

/** The tally screen from its read. Pure, for the gallery. */
export function TallyView({
  data, load, canControl, openId, onOpen, pending, busy = '', error = '', flash, onStep, onPatch, onCreate, onRetry, questions, composer,
  asking = [],
}) {
  if (load?.status === 'error') return <ReadFailed message={load.error} onRetry={onRetry} />;
  if (!data) return <TallySkeleton />;

  const tallies = data.tallies ?? [];
  const open = tallies.find((t) => t.id === openId) ?? tallies.at(-1) ?? null;
  const earlier = tallies.filter((t) => t.id !== open?.id).reverse();

  return (
    <div className={`rc-tally${canControl ? '' : ' is-read'}`}>
      <div className="stack stack-3 rc-tally-main">
        {asking.length > 0 && (
          <Note icon="clock">
            Waiting to be sent: {asking.map((a) => `“${a.label}”`).join(', ')}. The server opens the count, so
            {' '}{asking.length === 1 ? 'it appears' : 'they appear'} here, ready for hands, once this laptop reconnects.
          </Note>
        )}
        {open ? (
          <TallyCard tally={open} pending={pending} canControl={canControl} busy={busy} flash={flash} onStep={onStep} onPatch={onPatch} />
        ) : (
          <section className="card">
            <Empty icon="hand" title="No question asked aloud yet">
              {canControl
                ? 'Ask the room a question, then count the hands raised for each option. The count is kept with the room.'
                : 'Nothing has been counted in this room.'}
            </Empty>
          </section>
        )}

        {earlier.length > 0 && (
          <section className="card rc-earlier" aria-labelledby="rc-earlier-h">
            <header className="rc-card-h"><div className="sec"><h2 id="rc-earlier-h">Asked earlier</h2><p>{earlier.length === 1 ? 'One more question' : `${earlier.length} more questions`} in this room. Choose one to see its count.</p></div></header>
            <ul className="rows">
              {earlier.map((t) => (
                <li key={t.id}>
                  <button type="button" className="rw rc-earlier-row" onClick={() => onOpen(t.id)}>
                    <span className="grow">
                      <span className="clip rc-earlier-t">{t.text}</span>
                      <span className="t-meta">{t.summary}</span>
                    </span>
                    <time className="mono t-meta">{clock(t.createdAt)}</time>
                    <Icon name="chevronRight" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {canControl && <TallyComposer key={composer?.key} busy={busy === 'create'} error={error} onCreate={onCreate} questions={questions} initial={composer} />}

      <Privacy text={data.privacy} />
    </div>
  );
}

export default function Tally({ code, canControl, signal, questions }) {
  const [data, setData] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(null);
  const [pending, setPending] = useState({});

  const read = useCallback(async () => {
    try {
      setData(await api.tallies(code));
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  useEffect(() => { read(); }, [read, signal]);
  // Counts kept on this laptop have reached the server: read them again.
  useSynced(code, read);
  // Questions asked aloud while offline: the server makes them, so they show
  // here as waiting until it has.
  const { items } = useOutbox();
  const asking = items.filter((i) => i.kind === 'tallyCreate' && i.code === String(code).toUpperCase() && i.status !== 'refused');

  const put = (tally) => setData((d) => d && { ...d, tallies: d.tallies.map((t) => (t.id === tally.id ? tally : t)) });

  // Each tap is one record in the console outbox, which sends them one at a
  // time in the order they were made, so a reply never lands on top of a
  // later one. The count shown is the server's plus the taps still on their way.
  function step(tally, key, dir) {
    const slot = `${tally.id}:${key}`;
    setPending((p) => ({ ...p, [slot]: (p[slot] ?? 0) + dir }));
    const settle = (o) => {
      if (o.ok) {
        if (o.reply.tally) put(o.reply.tally);
        setFlash(o.reply.clamped ? { id: tally.id, text: `${key} is already at 0, so nothing changed.` } : null);
      } else if (o.refused) {
        setFlash({ id: tally.id, text: o.error, bad: true });
      }
      if (!o.kept) setPending((p) => ({ ...p, [slot]: (p[slot] ?? 0) - dir }));
    };
    record('tallyStep', { code, tallyId: tally.id, option: key, dir }, {
      label: `${key} ${dir > 0 ? 'one more hand' : 'one fewer hand'}: ${tally.text}`,
      onSettle: settle,
    }).then(settle);
  }

  async function patch(id, body) {
    const tally = data?.tallies?.find((t) => t.id === id);
    setBusy(`patch:${id}`);
    const out = await record('tallyEdit', { code, tallyId: id, patch: body }, {
      label: `${'revealed' in body ? (body.revealed ? 'Answer revealed' : 'Answer hidden') : `Correct option ${body.correct ?? 'cleared'}`}: ${tally?.text ?? ''}`,
      shown: tally && !tally.local ? shownOf.tally(tally) : undefined,
    });
    setBusy('');
    if (out.ok) { if (out.reply.tally) put(out.reply.tally); return; }
    if (out.refused) {
      setFlash({ id, text: out.error, bad: true });
      // Stale: the reply holds the count as it stands.
      if (out.stale && out.current?.id) put(out.current);
      return;
    }
    // Kept on this laptop: drawn now, as the server would.
    if (tally) {
      const next = { ...tally, ...body, local: true };
      if ('correct' in body) next.options = tally.options.map((o) => ({ ...o, correct: body.correct ? o.key === body.correct : null }));
      put(next);
    }
  }

  async function create(body) {
    setBusy('create');
    setError('');
    const out = await record('tallyCreate', { code, body }, {
      label: body.text ?? (questions?.list ?? []).find((q) => q.questionId === body.questionId)?.text ?? 'A question from the bank',
    });
    setBusy('');
    if (out.refused) { setError(out.error); return false; }
    if (out.ok) {
      setData((d) => d && { ...d, tallies: [...d.tallies, out.reply.tally] });
      setOpenId(out.reply.tally.id);
      setFlash(null);
    }
    return true;
  }

  return (
    <TallyView
      data={data}
      load={load}
      canControl={canControl}
      openId={openId}
      onOpen={setOpenId}
      pending={pending}
      busy={busy}
      error={error}
      flash={flash}
      onStep={step}
      onPatch={patch}
      onCreate={create}
      onRetry={read}
      questions={questions}
      asking={asking}
    />
  );
}
