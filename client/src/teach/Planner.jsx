/**
 * Planning a run: how many questions, at which levels, asked how.
 *
 * It is laid out as a mixing desk. Each level is a channel: a tube showing how
 * many questions it will get, a weight you nudge, and the interaction it will
 * be asked as. The tubes are fed by the server's own resolution of the plan, so
 * what you watch rise is exactly what will be written - the preview and the run
 * cannot disagree.
 *
 * The run itself is summarised on the forest panel beside the desk and started
 * from there.
 */

import { useEffect, useMemo, useState } from 'react';

import Tubes from '../fx/Tubes.jsx';
import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { KIND_LABEL } from '../lib/kinds.js';
import { Button, Icon, Level, Note, Num, Panel, Section, Segmented } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';

const HARD_CAP = 200;
const CONFIRM_ABOVE = 120;
const MIN_TOTAL = 1;
const MAX_WEIGHT = 6;

export const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;

/** The size a first plan opens at: six a topic, twelve to seventy-two. */
export const startTotal = (topicCount) => Math.min(72, Math.max(12, (topicCount || 1) * 6));
const weightTotal = (mix) => LEVELS.reduce((n, l) => n + (Number(mix?.[l]) || 0), 0);

/** The interactions each level may be asked as, whatever shape the server sent. */
function readKindSets(res) {
  const raw = res?.kindsForLevel ?? res?.kinds ?? null;
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  LEVELS.forEach((l) => {
    const set = (Array.isArray(raw[l]) ? raw[l] : [])
      .map((k) => (typeof k === 'string' ? k : k?.kind))
      .filter((k) => typeof k === 'string' && k.length > 0);
    if (set.length > 0) out[l] = set;
  });
  return Object.keys(out).length > 0 ? out : null;
}

export default function Planner({ contentId, topics, existing, draft, held, onDraft, onPlan, onRun, onConfirm, onDismissHeld }) {
  const [presets, setPresets] = useState(null);
  const [presetsError, setPresetsError] = useState('');
  const [confirmAbove, setConfirmAbove] = useState(CONFIRM_ABOVE);
  const [kindSets, setKindSets] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [pending, setPending] = useState(true);

  const { total, preset, mix, mode } = draft;
  const kinds = draft.kinds ?? {};

  useEffect(() => {
    let alive = true;
    api.generatePresets().then(
      (res) => {
        if (!alive) return;
        setPresets(res.presets ?? []);
        setKindSets(readKindSets(res));
        if (Number.isFinite(res.confirmAbove)) setConfirmAbove(res.confirmAbove);
      },
      (err) => { if (alive) setPresetsError(err.message); },
    );
    return () => { alive = false; };
  }, []);

  const presetMix = presets?.find((p) => p.id === preset)?.mix ?? null;
  const activeMix = preset === 'custom' ? mix : presetMix;
  const kindsKey = LEVELS.map((l) => kinds[l] ?? '').join(',');
  const mixKey = LEVELS.map((l) => Number(mix?.[l]) || 0).join(',');
  const topicsKey = topics.join('\u0000');

  const spec = useMemo(() => {
    const base = preset === 'custom' && weightTotal(mix) > 0 ? { total, mix } : { total, preset };
    return Object.keys(kinds).length > 0 ? { ...base, kinds } : base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, total, mixKey, kindsKey]);

  // Ask the server what this plan resolves to. Debounced: a slider being
  // dragged should not send a request per pixel.
  useEffect(() => {
    if (!contentId || topics.length === 0) return undefined;
    let alive = true;
    setPending(true);
    const timer = setTimeout(() => {
      api.generatePreview(contentId, topics, spec).then(
        (res) => {
          if (!alive) return;
          setPreview(res); setPreviewError(''); setPending(false);
          onPlan(res.plan);
        },
        (err) => { if (alive) { setPreviewError(err.message); setPending(false); } },
      );
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, topicsKey, total, preset, mixKey, kindsKey]);

  const setWeight = (level, value) => onDraft({
    mix: { ...(activeMix ?? {}), [level]: Math.max(0, Math.min(MAX_WEIGHT, value)) },
    preset: 'custom',
  });

  function setKind(level, kind) {
    if (!(kindSets?.[level] ?? []).includes(kind)) return;
    const next = { ...kinds };
    // The first in a set is the default, and the default is not sent.
    if (kind === kindSets[level][0]) delete next[level]; else next[level] = kind;
    onDraft({ kinds: next });
  }

  const plan = preview?.plan ?? null;
  const banked = preview?.existing ?? existing;
  const after = mode === 'append' ? banked + (plan?.total ?? 0) : (plan?.total ?? 0);
  const covered = plan ? plan.topics.filter((t) => t.count > 0).length : 0;
  const kindRows = plan ? Object.entries(plan.perKind).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) : [];
  const markAt = Math.min(1, Math.max(0, (confirmAbove - MIN_TOTAL) / (HARD_CAP - MIN_TOTAL)));
  const presetHint = preset === 'custom' ? 'Set each level below.' : presets?.find((p) => p.id === preset)?.hint;

  return (
    <div className="tc-plan">
      <div className="tc-plan-main">
        <section className="card tc-plan-card" aria-label="How many questions">
          <Section title="How many questions" sub="For the whole bank, shared across every ticked topic." />
          <div className="tc-size">
            <input
              type="number"
              className="input input-lg num tc-size-n"
              min={MIN_TOTAL}
              max={HARD_CAP}
              value={total}
              aria-label="Total questions"
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                onDraft({ total: Number.isFinite(n) ? Math.min(HARD_CAP, Math.max(MIN_TOTAL, n)) : MIN_TOTAL });
              }}
            />
            <div className="tc-size-slide">
              <input
                type="range"
                min={MIN_TOTAL}
                max={HARD_CAP}
                step={1}
                value={total}
                aria-label="Total questions"
                onChange={(e) => onDraft({ total: Number(e.target.value) })}
              />
              <span className="tc-size-mark" style={{ left: `calc(8px + (100% - 16px) * ${markAt})` }} aria-hidden="true">
                <i />
                <span>asks first above {confirmAbove}</span>
              </span>
            </div>
          </div>
        </section>

        <section className="card tc-plan-card" aria-label="Level mix">
          <div className="tc-plan-head">
            <Section title="Level mix" sub={presetHint || 'How the questions spread over the six levels.'} />
            {pending && <span className="spinner muted" aria-label="Resolving the plan" />}
          </div>
          {presetsError && (
            <Note>Could not load the preset mixes ({presetsError}). The run still works: the server falls back to its balanced mix.</Note>
          )}
          {!presets && !presetsError && <div className="skel" style={{ height: 32, width: 420, maxWidth: '100%' }} />}
          {presets && (
            <Segmented
              label="Preset mix"
              value={preset}
              onChange={(id) => onDraft({ preset: id })}
              options={[...presets.map((p) => ({ id: p.id, label: p.label })), { id: 'custom', label: 'Custom' }]}
            />
          )}

          {/* The tubes are the server's answer, not the sliders' guess. */}
          <Tubes values={plan?.perLevel ?? {}} height={132} />

          <div className="tc-desk">
            {LEVELS.map((l) => {
              const w = Number(activeMix?.[l]) || 0;
              const set = kindSets?.[l] ?? [];
              const chosen = kinds[l] ?? set[0];
              return (
                <div className="tc-chan" key={l}>
                  <Level level={l} className="tc-chan-name" />
                  <div className="tc-chan-step" role="group" aria-label={`${LABEL[l]} weight`}>
                    <button type="button" aria-label={`Less ${LABEL[l]}`} disabled={!activeMix || w <= 0} onClick={() => setWeight(l, w - 1)}>
                      <Icon name="minus" size={14} />
                    </button>
                    <output>{w}</output>
                    <button type="button" aria-label={`More ${LABEL[l]}`} disabled={!activeMix || w >= MAX_WEIGHT} onClick={() => setWeight(l, w + 1)}>
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                  {set.length > 1 ? (
                    <select
                      className="select input-sm"
                      value={chosen}
                      aria-label={`How ${LABEL[l]} is asked`}
                      onChange={(e) => setKind(l, e.target.value)}
                    >
                      {set.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
                    </select>
                  ) : (
                    <span className="tc-chan-only">{KIND_LABEL[chosen] ?? chosen ?? ''}</span>
                  )}
                </div>
              );
            })}
          </div>

          <p className="hint">
            Weights are relative, not counts. Each level offers only its own interactions, because the level decides how a
            question is asked: swapping within a level changes the surface, not the thinking it demands.
          </p>
        </section>
      </div>

      <Panel as="aside" className="tc-plan-run" aria-label="This run">
        <span className="tag-mint">This run</span>
        {plan ? (
          <>
            <div className="tc-big">
              <b><Num value={plan.total} /></b>
              <span>{plan.total === 1 ? 'question in this run' : 'questions in this run'}</span>
            </div>
            <dl className="tc-pfigs">
              <div><dt>{topics.length === 1 ? 'Topic covered' : 'Topics covered'}</dt><dd>{covered} of {topics.length}</dd></div>
              <div><dt>To write, about</dt><dd className="mono">{mmss(plan.estimateSeconds)}</dd></div>
            </dl>
            <LevelSpread counts={plan.perLevel} />
            {kindRows.length > 0 && (
              <ul className="tc-kv" aria-label="How the questions are asked">
                {kindRows.map(([k, n]) => (
                  <li key={k}><span>{KIND_LABEL[k] ?? k}</span><b>{n}</b></li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="stack stack-3" aria-busy="true">
            <div className="skel" style={{ height: 44, width: 160 }} />
            <div className="skel" style={{ height: 12 }} />
            <div className="skel" style={{ height: 96 }} />
          </div>
        )}

        {existing > 0 && (
          <div className="stack stack-2">
            <Segmented
              label="What this run does to the existing bank"
              value={mode}
              onChange={(id) => onDraft({ mode: id })}
              options={[{ id: 'replace', label: 'Replace the bank' }, { id: 'append', label: 'Add to it' }]}
            />
            <p className="hint">{banked} in the bank now, {after} after this run.</p>
          </div>
        )}

        {previewError && <Note tone="bad">Could not resolve that plan: {previewError}</Note>}
        {plan?.warnings?.map((w) => <Note key={w}>{w}</Note>)}

        {held && plan ? (
          <Note icon="alert">
            <b>{plan.total} questions is a big run.</b> It takes about {mmss(plan.estimateSeconds)} and spends real model
            quota. {held.mode === 'replace'
              ? 'Everything already in this bank, discarded questions included, is deleted first.'
              : `They are added on top of the ${existing} already in this bank.`}
            <div className="cluster" style={{ marginTop: 12 }}>
              <Button variant="accent" size="sm" onClick={onConfirm}>Yes, write {plan.total}</Button>
              <Button variant="ghost" size="sm" onClick={onDismissHeld}>Not now</Button>
            </div>
          </Note>
        ) : (
          <Button variant="accent" size="lg" block icon="write" disabled={!plan || plan.total === 0} onClick={() => onRun(spec, { mode })}>
            Write {plan?.total ?? ''} questions
          </Button>
        )}
        <p className="tc-run-hint">Written once, before class. A live room never calls a model.</p>
      </Panel>
    </div>
  );
}
