/**
 * "Suggest prerequisites": the professor picks some of their chapters and the
 * server asks the model for direct links between their topics
 * (POST /api/hub/links/propose with a device-made runId; its progress from
 * GET /api/hub/links/run/:runId while the reply is on its way). Every
 * proposal is an AI draft, not used until confirmed. Offline it proposes
 * none, and its `note` says why.
 */

import { useEffect, useRef, useState } from 'react';

import { newId, staffHub } from '../hub/hubApi.js';
import { Button, Chip, Dialog, Icon, Meter, Note } from '../ui/index.jsx';
import { Name, Refusal, plural } from './StaffParts.jsx';

const MAX_CHAPTERS = 10;

/** One proposing run: start it, watch it, keep its reply. */
export function useSuggest(api = staffHub) {
  const [state, setState] = useState({ running: false, run: null, result: null, error: null });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const start = async (contentIds) => {
    const runId = newId();
    let done = false;
    setState({ running: true, run: null, result: null, error: null });
    // The run is read while the reply is on its way; a read before the
    // server has it is a 404, which only means "not yet".
    (async () => {
      while (!done && alive.current) {
        await new Promise((r) => setTimeout(r, 1200));
        if (done || !alive.current) return;
        try {
          const { run } = await api.linkRun(runId);
          if (!done && alive.current) setState((s) => ({ ...s, run }));
        } catch { /* not started yet, or gone */ }
      }
    })();
    try {
      const result = await api.proposeLinks({ contentIds, runId });
      done = true;
      if (alive.current) setState({ running: false, run: null, result, error: null });
      return result;
    } catch (error) {
      done = true;
      if (alive.current) setState({ running: false, run: null, result: null, error });
      return null;
    }
  };
  const reset = () => setState({ running: false, run: null, result: null, error: null });
  return { ...state, start, reset };
}

export function SuggestProgress({ run }) {
  const total = run?.topicsTotal || 0;
  const done = run?.topicsDone || 0;
  return (
    <div className="hubs-run" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <div className="grow">
        <p>
          {run && total
            ? done < total
              ? `Reading chapter ${done + 1} of ${total}${run.topic ? `: ${run.topic}` : ''}.`
              : 'Asking the model for links between the topics.'
            : 'Starting.'}
        </p>
        {total > 0 && <Meter value={done} max={total} />}
      </div>
    </div>
  );
}

/** The reply: the note, each proposal as an AI draft, what was left out and why, warnings. */
export function SuggestResult({ result }) {
  if (!result) return null;
  const proposed = result.proposed ?? [];
  return (
    <div className="hubs-suggested">
      <Note tone={result.source === 'offline' ? undefined : proposed.length ? 'warn' : undefined} icon="idea">
        {result.note}
        {typeof result.topicsShown === 'number' && <span className="hubs-quiet"> {plural(result.topicsShown, 'topic')} read.</span>}
      </Note>
      {result.warnings?.length > 0 && (
        <Note tone="warn">
          <ul className="hubs-plain">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Note>
      )}
      {proposed.length > 0 && (
        <section aria-label="Proposed links">
          <h3 className="hubs-h3">{plural(proposed.length, 'proposed link')}</h3>
          <ul className="hubs-links">
            {proposed.map((l) => (
              <li key={l.id} className="hubs-link" data-state={l.state}>
                <div className="hubs-link-pair">
                  <Name html={l.prerequisite.nameHtml} text={l.prerequisite.name} />
                  <Icon name="forward" size={14} />
                  <Name html={l.topic.nameHtml} text={l.topic.name} />
                </div>
                <Chip tone="warn" className="hubs-chip-sm">{l.label}</Chip>
                {l.reasonHtml && <Name className="hubs-link-why" html={l.reasonHtml} text={l.reason} />}
              </li>
            ))}
          </ul>
        </section>
      )}
      {result.skipped?.length > 0 && (
        <details className="hubs-skipped">
          <summary>{plural(result.skipped.length, 'suggestion')} left out</summary>
          <ul className="hubs-plain">
            {result.skipped.map((s, i) => (
              <li key={`${s.prerequisite}:${s.topic}:${i}`}>
                <b>{s.prerequisite}</b> before <b>{s.topic}</b>: {s.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The dialog: choose up to ten chapters, start, watch, read the reply.
 * `preset` ticks chapters to begin with; `onDone` hears the reply.
 */
export function SuggestDialog({ open, onOpenChange, preset = [], onDone, api = staffHub }) {
  const [chapters, setChapters] = useState({ list: null, error: null });
  const [picked, setPicked] = useState(preset);
  const s = useSuggest(api);

  useEffect(() => {
    if (!open) return undefined;
    let on = true;
    setPicked(preset);
    s.reset();
    setChapters({ list: null, error: null });
    api.ownChapters().then(
      (r) => { if (on) setChapters({ list: r.contents ?? [], error: null }); },
      (error) => { if (on) setChapters({ list: null, error }); },
    );
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_CHAPTERS ? p : [...p, id]));
  const go = async () => {
    const result = await s.start(picked);
    if (result) onDone?.(result);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Suggest prerequisites"
      description="The AI reads the topics of the chapters you choose and proposes which come first. Nothing it proposes is used until you confirm it."
      wide
      locked={s.running}
      footer={s.result ? (
        <Button variant="primary" onClick={() => onOpenChange(false)}>Done</Button>
      ) : (
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={s.running}>Cancel</Button>
          <Button variant="primary" icon="idea" busy={s.running} disabled={!picked.length} onClick={go}>Suggest</Button>
        </>
      )}
    >
      {s.result ? (
        <SuggestResult result={s.result} />
      ) : s.running ? (
        <SuggestProgress run={s.run} />
      ) : (
        <div className="stack">
          {chapters.error ? (
            <Refusal error={chapters.error} />
          ) : !chapters.list ? (
            <div className="hubs-class-skel" role="status" aria-label="Loading your chapters">
              <div className="skel" style={{ width: '60%', height: 14 }} />
              <div className="skel" style={{ width: '50%', height: 14 }} />
            </div>
          ) : chapters.list.length === 0 ? (
            <p className="hubs-quiet">You have no chapters yet.</p>
          ) : (
            <fieldset className="hubs-pick">
              <legend className="label">Chapters, up to {MAX_CHAPTERS} ({picked.length} chosen)</legend>
              {chapters.list.map((c) => {
                const id = String(c._id ?? c.id);
                const on = picked.includes(id);
                return (
                  <label key={id} className="hubs-pick-row" data-on={on || undefined}>
                    <input type="checkbox" checked={on} disabled={!on && picked.length >= MAX_CHAPTERS} onChange={() => toggle(id)} />
                    <span className="grow">{c.title}</span>
                  </label>
                );
              })}
            </fieldset>
          )}
          <Refusal error={s.error} />
        </div>
      )}
    </Dialog>
  );
}
