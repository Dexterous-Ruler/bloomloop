/**
 * Activities: the five things a class can do without a device, and a record of
 * each one run in the room.
 *
 * The kinds and the group results are the server's (labels as it gives them).
 * A quick knowledge check is a raised-hands tally, so it points at one. A group
 * challenge records groups, never students. Each record keeps a short outcome,
 * and stays editable after the class; its kind is what was run and does not
 * change.
 *
 * A quick check's question can be put on the projector from here ("Project to
 * class"): the question and its options, never the hands. Then `onProject`,
 * when the page gives one, takes the professor to the projector.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { record, shownOf, useSynced } from '../lib/consoleOutbox.js';
import { Button, Empty, Field, Icon, Note, Segmented } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { Privacy, ReadFailed, clock } from './Wheel.jsx';

const MAX_OUTCOME = 280;
const MAX_LABEL = 40;

/** What each activity is, in a line, and its glyph. */
const ABOUT = {
  check: { icon: 'hand', line: 'A question asked aloud, answered by raised hands and counted as a tally.' },
  think: { icon: 'idea', line: 'Everyone thinks it through first, then one student explains it to the room.' },
  group: { icon: 'users', line: 'Small groups take on one problem. Record which groups got it, not which students.' },
  diagram: { icon: 'deck', line: 'A student talks the class through a diagram, one step at a time.' },
  real: { icon: 'target', line: 'The class applies the idea to a case from outside the classroom.' },
};

/* ------------------------------------------------------------- compose */

function Groups({ groups, results, onChange, disabled }) {
  const set = (i, patch) => onChange(groups.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  return (
    <fieldset className="rc-groups" disabled={disabled}>
      <legend className="label">Groups</legend>
      <p className="hint">Name each group by where it sat, such as Bench 3. Groups, never students.</p>
      <ul>
        {groups.map((g, i) => (
          <li key={g.key} className="rc-group">
            <input
              className="input input-sm"
              aria-label={`Group ${i + 1}`}
              placeholder={`Bench ${i + 1}`}
              maxLength={MAX_LABEL}
              value={g.label}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <Segmented
              label={`How group ${i + 1} did`}
              value={g.gotIt}
              onChange={(gotIt) => set(i, { gotIt })}
              options={results.map((r) => ({ id: r.id, label: r.label }))}
            />
            <Button size="sm" variant="ghost" icon="close" aria-label={`Remove group ${i + 1}`} onClick={() => onChange(groups.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <Button size="sm" icon="plus" onClick={() => onChange([...groups, { key: `g${Date.now()}`, label: '', gotIt: null }])}>Add a group</Button>
    </fieldset>
  );
}

/**
 * Record a new run of `kind`, or change `editing`. Groups only for a group
 * challenge; a tally only for a quick check.
 */
function Composer({ kind, kinds, results, editing, tallies, busy, error, onSave, onCancel, onTab, onNeedTallies }) {
  const [outcome, setOutcome] = useState(editing?.outcome ?? '');
  const [groups, setGroups] = useState(
    editing?.groups?.length
      ? editing.groups.map((g, i) => ({ key: `e${i}`, label: g.label, gotIt: g.gotIt }))
      : kind === 'group' ? [{ key: 'g0', label: '', gotIt: null }] : [],
  );
  const [tallyId, setTallyId] = useState(editing?.tallyId ?? '');

  useEffect(() => { if (kind === 'check') onNeedTallies?.(); }, [kind, onNeedTallies]);

  const named = groups.filter((g) => g.label.trim());
  const unrated = named.some((g) => !g.gotIt);
  const label = kinds.find((k) => k.id === kind)?.label ?? kind;
  const id = `rc-act-${editing?.id ?? kind}`;

  function submit(e) {
    e.preventDefault();
    if (busy || unrated) return;
    const body = { outcome: outcome.trim() };
    if (kind === 'group') body.groups = named.map((g) => ({ label: g.label.trim(), gotIt: g.gotIt }));
    if (kind === 'check') body.tallyId = tallyId || null;
    onSave(editing ? body : { kind, ...body });
  }

  return (
    <form className="rc-act-form" onSubmit={submit} aria-label={editing ? `Change ${label}` : `Record ${label}`}>
      <Field label="What happened" optional htmlFor={id}>
        <textarea
          id={id}
          className="textarea rc-act-text"
          rows={2}
          maxLength={MAX_OUTCOME}
          value={outcome}
          placeholder="Most of the room got there after one hint"
          onChange={(e) => setOutcome(e.target.value)}
        />
        <span className="t-meta mono rc-count-under">{outcome.length} / {MAX_OUTCOME}</span>
      </Field>

      {kind === 'check' && (
        <Field label="Raised-hands count" optional htmlFor={`${id}-t`}>
          {tallies?.status === 'error' ? (
            <ReadFailed message={tallies.error} onRetry={onNeedTallies} />
          ) : (
            <select id={`${id}-t`} className="select input-sm" value={tallyId} disabled={tallies?.status !== 'ready'} onChange={(e) => setTallyId(e.target.value)}>
              <option value="">{tallies?.status === 'ready' ? (tallies.list.length ? 'None' : 'No count in this room yet') : 'Reading the counts…'}</option>
              {(tallies?.list ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.text.length > 80 ? `${t.text.slice(0, 79)}…` : t.text} ({t.summary})</option>
              ))}
            </select>
          )}
          <span className="hint">
            Count the hands in Raised hands, then link the count here.
            {onTab && <> <button type="button" className="link rc-linkbtn" onClick={() => onTab('tally')}>Open Raised hands</button></>}
          </span>
        </Field>
      )}

      {kind === 'group' && <Groups groups={groups} results={results} onChange={setGroups} disabled={busy} />}

      {error && <Note tone="bad" role="alert">{error}</Note>}
      {unrated && <p className="hint">Choose how each named group did.</p>}
      <div className="cluster">
        <Button type="submit" variant="primary" size="sm" busy={busy} disabled={unrated}>{editing ? 'Save changes' : 'Record it'}</Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------- the record */

function Outcomes({ groups, results }) {
  if (!groups?.length) return null;
  const tally = results.map((r) => ({ ...r, n: groups.filter((g) => g.gotIt === r.id).length })).filter((r) => r.n);
  return (
    <div className="rc-act-groups">
      <p className="t-meta">{groups.length === 1 ? 'One group' : `${groups.length} groups`}: {tally.map((r) => `${r.n} ${r.label.toLowerCase()}`).join(', ')}</p>
      <ul>
        {groups.map((g) => (
          <li key={g.label} data-got={g.gotIt}>
            <span className="clip">{g.label}</span>
            <span className="rc-got"><i aria-hidden="true" />{g.result}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Recorded({
  activity, kinds, results, tallies, canControl, editing, busy, error, onEdit, onSave, onCancel, onTab, onNeedTallies,
  onProject, projecting, projectError,
}) {
  const about = ABOUT[activity.kind] ?? { icon: 'activity' };
  const linked = activity.tallyId ? tallies?.list?.find((t) => t.id === activity.tallyId) : null;
  const text = linked?.text ?? '';
  return (
    <li className="rc-act" data-editing={editing ? 'true' : undefined}>
      <span className="rc-act-ic"><Icon name={about.icon} size={15} /></span>
      <div className="rc-act-main">
        <div className="rc-act-top">
          <h3>{activity.label}</h3>
          <time className="mono t-meta">{clock(activity.createdAt)}</time>
          {/* Recorded offline: the server gives it its id, so it can be changed once it has it. */}
          {activity.sync === 'new' && <span className="t-meta"><Icon name="clock" size={12} /> Waiting to sync</span>}
          {canControl && !editing && activity.sync !== 'new' && <Button size="sm" variant="ghost" icon="edit" onClick={onEdit} aria-label={`Change ${activity.label} at ${clock(activity.createdAt)}`} />}
        </div>
        {editing ? (
          <Composer
            kind={activity.kind}
            kinds={kinds}
            results={results}
            editing={activity}
            tallies={tallies}
            busy={busy}
            error={error}
            onSave={onSave}
            onCancel={onCancel}
            onTab={onTab}
            onNeedTallies={onNeedTallies}
          />
        ) : (
          <>
            {activity.outcome ? <p className="rc-act-out">{activity.outcome}</p> : <p className="rc-act-out is-none">No outcome written.</p>}
            {activity.tallyId && (
              <div className="rc-act-linkrow">
                <p className="rc-act-link">
                  <Icon name="hand" size={13} />
                  {linked ? <><span className="clip">{linked.text}</span><span className="t-meta">{linked.summary}</span></> : <span className="t-meta">Linked to a raised-hands count.</span>}
                </p>
                {onProject && (
                  <Button
                    size="sm"
                    icon="projector"
                    busy={projecting}
                    onClick={onProject}
                    aria-label={text ? `Project to class: ${text.length > 60 ? `${text.slice(0, 59)}…` : text}` : undefined}
                  >
                    Project to class
                  </Button>
                )}
              </div>
            )}
            {projectError && <Note tone="bad" role="alert">{projectError}</Note>}
            <Outcomes groups={activity.groups} results={results} />
          </>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------- the view */

function ActivitiesSkeleton() {
  return (
    <div className="rc-acts" aria-busy="true" aria-label="Reading the activities">
      <section className="card rc-kinds"><div className="rc-card-h"><span className="skel" style={{ height: 20, width: 180 }} /></div>
        <div className="rc-kind-list">{[0, 1, 2, 3, 4].map((i) => <span key={i} className="skel" style={{ height: 52, margin: '6px 0' }} />)}</div>
      </section>
      <section className="card rc-ran"><div className="rc-card-h"><span className="skel" style={{ height: 20, width: 140 }} /></div></section>
    </div>
  );
}

/** The five kinds and what was run, from the activities read. Pure, for the gallery. */
export function ActivitiesView({
  data, load, canControl, tallies, busy = '', error = { for: '', message: '' },
  onCreate, onUpdate, onRetry, onTab, onNeedTallies, initialDraft = null, initialEdit = null,
  closed = false, onProjectTally,
}) {
  const [draft, setDraft] = useState(initialDraft);   // the kind being recorded
  const [edit, setEdit] = useState(initialEdit);      // the activity id being changed

  if (load?.status === 'error') return <ReadFailed message={load.error} onRetry={onRetry} />;
  if (!data) return <ActivitiesSkeleton />;

  const kinds = data.kinds ?? [];
  const results = data.results ?? [];
  const ran = (data.activities ?? []).slice().reverse();
  // Only the room's owner sets the projector, and a closed room has none.
  const canProject = canControl && !closed && Boolean(onProjectTally);

  async function create(body) {
    if (await onCreate(body)) setDraft(null);
  }
  async function update(id, patch) {
    if (await onUpdate(id, patch)) setEdit(null);
  }

  return (
    <div className={`rc-acts${canControl ? '' : ' is-read'}`}>
      {canControl && (
        <section className="card rc-kinds" aria-labelledby="rc-kinds-h">
          <header className="rc-card-h">
            <div className="sec"><h2 id="rc-kinds-h">Run without devices</h2><p>Record each one as it is run, with what happened.</p></div>
          </header>
          <ul className="rc-kind-list">
            {kinds.map((k) => {
              const about = ABOUT[k.id] ?? { icon: 'activity', line: '' };
              const open = draft === k.id;
              return (
                <li key={k.id} className="rc-kind" data-open={open ? 'true' : undefined}>
                  <div className="rc-kind-row">
                    <span className="rc-act-ic"><Icon name={about.icon} size={15} /></span>
                    <div className="grow">
                      <h3>{k.label}</h3>
                      {about.line && <p>{about.line}</p>}
                    </div>
                    {!open && <Button size="sm" icon="plus" onClick={() => { setDraft(k.id); setEdit(null); }} aria-label={`Record ${k.label}`}>Record</Button>}
                  </div>
                  {open && (
                    <Composer
                      kind={k.id}
                      kinds={kinds}
                      results={results}
                      tallies={tallies}
                      busy={busy === 'create'}
                      error={error.for === 'create' ? error.message : ''}
                      onSave={create}
                      onCancel={() => setDraft(null)}
                      onTab={onTab}
                      onNeedTallies={onNeedTallies}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card rc-ran" aria-labelledby="rc-ran-h">
        <header className="rc-card-h">
          <div className="sec"><h2 id="rc-ran-h">Run in this room</h2><p>{ran.length > 1 ? `${ran.length} activities, newest first.` : ran.length ? 'One activity so far.' : 'Nothing recorded yet.'}</p></div>
        </header>
        {ran.length === 0 ? (
          <Empty icon="activity" title="No activity recorded">
            {canControl ? 'Run one from the list, then record what happened. It stays editable after the class.' : 'Nothing has been recorded in this room.'}
          </Empty>
        ) : (
          <ul className="rc-act-list">
            {ran.map((a) => (
              <Recorded
                key={a.id}
                activity={a}
                kinds={kinds}
                results={results}
                tallies={tallies}
                canControl={canControl}
                editing={edit === a.id}
                busy={busy === `update:${a.id}`}
                error={error.for === a.id ? error.message : ''}
                onEdit={() => { setEdit(a.id); setDraft(null); }}
                onSave={(patch) => update(a.id, patch)}
                onCancel={() => setEdit(null)}
                onTab={onTab}
                onNeedTallies={onNeedTallies}
                onProject={canProject && a.kind === 'check' && a.tallyId ? () => onProjectTally(a.id, a.tallyId) : null}
                projecting={busy === `project:${a.id}`}
                projectError={error.for === `project:${a.id}` ? error.message : ''}
              />
            ))}
          </ul>
        )}
      </section>

      <Privacy text={data.privacy} />
    </div>
  );
}

/* ------------------------------------------------------------- the screen */

export default function Activities({ code, canControl, onTab, closed, onProject }) {
  const [data, setData] = useState(null);
  const [load, setLoad] = useState({ status: 'loading', error: '' });
  const [tallies, setTallies] = useState({ status: 'idle', list: [], error: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState({ for: '', message: '' });

  const read = useCallback(async () => {
    try {
      setData(await api.activities(code));
      setLoad({ status: 'ready', error: '' });
    } catch (err) {
      setLoad({ status: 'error', error: err.message });
    }
  }, [code]);

  const readTallies = useCallback(async () => {
    setTallies((t) => ({ ...t, status: t.status === 'ready' ? 'ready' : 'loading', error: '' }));
    try {
      const body = await api.tallies(code);
      setTallies({ status: 'ready', list: body.tallies ?? [], error: '' });
    } catch (err) {
      setTallies({ status: 'error', list: [], error: err.message });
    }
  }, [code]);

  useEffect(() => { read(); }, [read]);
  // Records kept on this laptop have reached the server: read them again.
  useSynced(code, read);
  // Linked counts are named in the record, so read the tallies once if any is linked.
  useEffect(() => {
    if (tallies.status === 'idle' && data?.activities?.some((a) => a.tallyId)) readTallies();
  }, [data, tallies.status, readTallies]);

  /** An activity as recorded here, before the server has it: groups carry their result's label. */
  const drawn = (a) => ({
    ...a,
    groups: (a.groups ?? []).map((g) => ({ ...g, result: data?.results?.find((r) => r.id === g.gotIt)?.label ?? g.gotIt })),
  });

  // Through the console outbox: kept on this laptop until the server has it.
  async function create(body) {
    setBusy('create');
    setError({ for: '', message: '' });
    const label = data?.kinds?.find((k) => k.id === body.kind)?.label ?? body.kind;
    const out = await record('activityCreate', { code, body }, { label: `${label}${body.outcome ? `: ${body.outcome}` : ''}` });
    setBusy('');
    if (out.refused) { setError({ for: 'create', message: out.error }); return false; }
    const made = out.ok
      ? out.reply.activity
      : drawn({ id: `waiting-${Date.now()}`, kind: body.kind, label, outcome: body.outcome ?? '', groups: body.groups, tallyId: body.tallyId ?? null, createdAt: new Date().toISOString(), sync: 'new' });
    setData((d) => d && { ...d, activities: [...d.activities, made] });
    return true;
  }

  async function update(id, patch) {
    const before = data?.activities?.find((a) => a.id === id);
    setBusy(`update:${id}`);
    setError({ for: '', message: '' });
    const out = await record('activityEdit', { code, activityId: id, patch }, {
      label: `${before?.label ?? 'Activity'} changed${patch.outcome ? `: ${patch.outcome}` : ''}`,
      shown: before && !before.sync ? shownOf.activity(before) : undefined,
    });
    setBusy('');
    if (out.refused) {
      setError({ for: id, message: out.error });
      // Stale: the reply holds the activity as it stands.
      if (out.stale && out.current?.id) setData((d) => d && { ...d, activities: d.activities.map((a) => (a.id === id ? out.current : a)) });
      return false;
    }
    setData((d) => d && {
      ...d,
      activities: d.activities.map((a) => (a.id !== id ? a : out.ok ? out.reply.activity : drawn({ ...a, ...patch, sync: 'edit' }))),
    });
    return true;
  }

  /** The check's question on the wall, as the projector's own control puts a tally up. */
  async function project(activityId, tallyId) {
    setBusy(`project:${activityId}`);
    setError({ for: '', message: '' });
    try {
      await api.setProjector(code, { mode: 'question', question: { tallyId } });
    } catch (err) {
      setError({ for: `project:${activityId}`, message: err.message });
      setBusy('');
      return;
    }
    setBusy('');
    if (onProject) onProject();
    else toast('The question is on the projector.');
  }

  return (
    <ActivitiesView
      data={data}
      load={load}
      canControl={canControl}
      tallies={tallies}
      busy={busy}
      error={error}
      onCreate={create}
      onUpdate={update}
      onRetry={read}
      onTab={onTab}
      onNeedTallies={readTallies}
      closed={closed}
      onProjectTally={project}
    />
  );
}
