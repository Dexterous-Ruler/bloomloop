/**
 * The generation planner: the teacher fixes the size and the shape of the bank
 * before a single question is written.
 *
 * This screen exists because the opposite happened — one deck produced 862
 * questions across six presses of a button, because nothing here let anyone say
 * how many they wanted. Every control maps to one field of the plan spec that
 * server/src/services/plan.js resolves, and the preview shown is that same
 * resolver's answer fetched over /generate/preview, not a client-side guess. So
 * the numbers on this screen are the numbers that get written.
 */

import { useEffect, useMemo, useState } from 'react';

import { api } from '../api.js';
import { LEVELS, LABEL } from '../bloom.js';
import { KIND_LABEL, KIND_TICK } from '../kinds.js';
import Icon from '../ui/Icon.jsx';
import { Card, Stat, TailBars } from '../ui/Shell.jsx';

/**
 * HARD_CAP mirrors server/src/services/plan.js. It is the one number on this
 * screen the server never tells us — /generate/presets returns CONFIRM_ABOVE but
 * not the cap — so the slider's ceiling has to be duplicated here.
 */
const HARD_CAP = 200;
/** Only used until /generate/presets answers with the server's real threshold. */
const CONFIRM_ABOVE = 120;
const MIN_TOTAL = 1;
/** Weights are relative, so a 0-6 range is plenty and keeps the sliders coarse. */
const MAX_WEIGHT = 6;

const mmss = (t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
const weightTotal = (mix) => LEVELS.reduce((n, l) => n + (Number(mix?.[l]) || 0), 0);

/**
 * The level -> allowed interactions map, exactly as /generate/presets sends it.
 *
 * It is never hard-coded here. Which kinds a level may be asked through is the
 * whole claim this product makes, and a stale copy in the browser would offer a
 * teacher a choice the server then refuses — or worse, quietly accepts. Bare ids
 * and {kind,label} rows both read, so the endpoint can grow a label field later
 * without this control going blank.
 */
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

/** The mix, drawn as the same ramp bar the bank itself is drawn with. */
function MixBar({ mix, height = 6 }) {
  if (!weightTotal(mix)) return null;
  return (
    <span className="dist" style={{ height, marginTop: 8 }}>
      {LEVELS.map((l) => (Number(mix[l]) || 0) > 0 && (
        <i key={l} className={`swatch ${l}`} style={{ flex: Number(mix[l]) }} />
      ))}
    </span>
  );
}

/**
 * `draft` is { total, preset, mix, mode } and lives in the parent on purpose:
 * pressing Generate swaps this whole screen out for the progress rows, so any
 * control state held in here would be thrown away — and a teacher whose run came
 * back 409 would find their numbers reset to the defaults they had just changed.
 */
export default function GeneratePlanner({ contentId, topics, existing, draft, onDraft, onPlan, onRun }) {
  const [presets, setPresets] = useState(null);
  const [presetsError, setPresetsError] = useState('');
  const [confirmAbove, setConfirmAbove] = useState(CONFIRM_ABOVE);
  const [kindSets, setKindSets] = useState(null);

  const { total, preset, mix, mode } = draft;
  // Only the levels the teacher moved. An absent level says "the server's
  // default", which is a different claim from "the teacher picked this one".
  const kinds = draft.kinds ?? {};

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState('');
  const [pending, setPending] = useState(true);

  useEffect(() => {
    let alive = true;
    api.generatePresets().then(
      (res) => {
        if (!alive) return;
        setPresets(res.presets ?? []);
        setKindSets(readKindSets(res));
        if (Number.isFinite(res.confirmAbove)) setConfirmAbove(res.confirmAbove);
      },
      (err) => alive && setPresetsError(err.message),
    );
    return () => { alive = false; };
  }, []);

  // The weights the sliders show: whatever preset is selected, until the teacher
  // drags one — at which point that edited copy becomes the custom mix. Nothing
  // has to be kept in sync, because a preset card is only ever a starting point.
  const presetMix = presets?.find((p) => p.id === preset)?.mix ?? null;
  const activeMix = preset === 'custom' ? mix : presetMix;

  const kindsKey = LEVELS.map((l) => kinds[l] ?? '').join(',');

  const spec = useMemo(
    () => {
      const base = preset === 'custom' && weightTotal(mix) > 0 ? { total, mix } : { total, preset };
      // Sent only once something has actually been chosen, so an untouched
      // planner still asks for each level's default rather than freezing today's
      // default into every run from here on.
      return Object.keys(kinds).length > 0 ? { ...base, kinds } : base;
    },
    [preset, total, mix, kindsKey],
  );

  const topicsKey = topics.join('\u0000');
  const mixKey = LEVELS.map((l) => Number(mix?.[l]) || 0).join(',');

  useEffect(() => {
    if (!contentId || topics.length === 0) return undefined;
    let alive = true;
    setPending(true);
    // 350ms: long enough that dragging the slider does not fire a request per
    // pixel, short enough that the preview still feels attached to the control.
    const timer = setTimeout(() => {
      api.generatePreview(contentId, topics, spec).then(
        (res) => {
          if (!alive) return;
          setPreview(res);
          setPreviewError('');
          setPending(false);
          onPlan(res.plan);
        },
        (err) => {
          if (!alive) return;
          setPreviewError(err.message);
          setPending(false);
        },
      );
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [contentId, topicsKey, total, preset, mixKey, kindsKey]);

  function setWeight(level, value) {
    onDraft({
      mix: { ...(activeMix ?? {}), [level]: Math.max(0, Math.min(MAX_WEIGHT, value)) },
      preset: 'custom',
    });
  }

  /**
   * A level may only ever be swapped between the kinds in its OWN set. There is
   * no path through this control to a kind from another level, because the level
   * is what chooses the interaction — that is the product, not a setting.
   */
  function setKind(level, kind) {
    if (!(kindSets?.[level] ?? []).includes(kind)) return;
    const next = { ...kinds };
    // Choosing the default again drops the entry rather than storing it: the
    // spec should say "you decide" when the teacher has decided nothing.
    if (kind === kindSets[level][0]) delete next[level];
    else next[level] = kind;
    onDraft({ kinds: next });
  }

  const plan = preview?.plan ?? null;
  const banked = preview?.existing ?? existing;
  const after = mode === 'append' ? banked + (plan?.total ?? 0) : (plan?.total ?? 0);
  const covered = plan ? plan.topics.filter((t) => t.count > 0).length : 0;
  const busiest = plan ? Math.max(1, ...LEVELS.map((l) => plan.perLevel[l] ?? 0)) : 1;
  const kindRows = plan
    ? Object.entries(plan.perKind).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
    : [];

  // The thumb is 18px wide, so the track the teacher actually sees runs from 9px
  // in to 9px short of the end. Marking the threshold anywhere else puts the line
  // next to the wrong number at both ends of the slider.
  const markAt = Math.min(1, Math.max(0, (confirmAbove - MIN_TOTAL) / (HARD_CAP - MIN_TOTAL)));
  const markLeft = `calc(9px + (100% - 18px) * ${markAt})`;

  return (
    <>
      {plan ? (
        <div className="grid auto" style={{ marginBottom: 16 }}>
          <Stat
            label="Questions to write"
            icon="sparkle"
            value={plan.total}
            delta={mode === 'append'
              ? `added on top of ${banked} already banked`
              : `replaces ${banked} already banked`}
            tail={(
              <TailBars
                bars={LEVELS.map((l) => ({
                  label: LABEL[l].slice(0, 3),
                  value: plan.perLevel[l] ?? 0,
                  on: (plan.perLevel[l] ?? 0) === busiest,
                }))}
              />
            )}
          />
          <Stat
            label="Topics covered"
            icon="list"
            value={covered}
            unit={`of ${topics.length}`}
            delta="numbered in the order you ticked them"
            tail={(
              <TailBars
                bars={plan.topics.slice(0, 8).map((t, i) => ({
                  label: String(i + 1),
                  value: t.count,
                  on: t.count > 0,
                }))}
              />
            )}
          />
          <Stat
            label="Estimated write time"
            icon="clock"
            value={mmss(plan.estimateSeconds)}
            delta="once, before class — the live session never calls a model"
            tail={kindRows.length > 0 ? (
              <TailBars bars={kindRows.map(([k, n]) => ({ label: KIND_TICK[k] ?? k, value: n, on: true }))} />
            ) : null}
          />
        </div>
      ) : (
        <div className="grid auto" style={{ marginBottom: 16 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel" style={{ height: 186, borderRadius: 'var(--r-card)' }} />
          ))}
        </div>
      )}

      <div className="stack" style={{ marginBottom: 16 }}>
        <Card className="pad-lg">
          <div className="cardhead">
            <h3>How many questions</h3>
            <span className="sub">The server refuses anything past {HARD_CAP}.</span>
          </div>

          <div className="row" style={{ gap: 18, flexWrap: 'nowrap' }}>
            <div className="grow" style={{ position: 'relative', paddingBottom: 20, minWidth: 180 }}>
              <input
                type="range"
                min={MIN_TOTAL}
                max={HARD_CAP}
                step={1}
                value={total}
                aria-label="Total questions"
                onChange={(e) => onDraft({ total: Number(e.target.value) })}
              />
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute', top: 4, left: markLeft, width: 2, height: 18,
                  borderRadius: 'var(--r-pill)', background: 'var(--warn)',
                }}
              />
              <span
                className="hint"
                style={{
                  position: 'absolute', top: 25, left: markLeft, transform: 'translateX(-50%)',
                  margin: 0, whiteSpace: 'nowrap', color: 'var(--warn)', fontWeight: 700,
                }}
              >
                confirm above {confirmAbove}
              </span>
            </div>

            <input
              type="number"
              min={MIN_TOTAL}
              max={HARD_CAP}
              value={total}
              aria-label="Total questions"
              className="num"
              style={{ width: 92, textAlign: 'center', flex: 'none' }}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value));
                onDraft({ total: Number.isFinite(n) ? Math.min(HARD_CAP, Math.max(MIN_TOTAL, n)) : MIN_TOTAL });
              }}
            />
          </div>

          <div className="hint">
            Spread across every ticked topic. One number for the whole bank, so a long topic list
            cannot quietly multiply it.
          </div>
        </Card>

        <Card className="pad-lg">
          <div className="cardhead">
            <h3>Level mix</h3>
            <span className="sub">Relative weights, not counts — the size above decides how many.</span>
          </div>

          {presetsError && (
            <div className="note warn" style={{ marginBottom: 14 }}>
              <Icon name="alert" size={15} />
              <span>
                Could not load the shapes ({presetsError}). The run still works — the server falls back
                to its balanced mix.
              </span>
            </div>
          )}

          {!presets && !presetsError && (
            <div className="grid auto-sm">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skel" style={{ height: 82, borderRadius: 'var(--r-tile)' }} />
              ))}
            </div>
          )}

          {presets && (
            <div className="grid auto-sm">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`topic ${preset === p.id ? 'on' : ''}`}
                  aria-pressed={preset === p.id}
                  // .topic.on only fills the tick box, which is enough in a
                  // vertical list but not across a grid of five cards.
                  style={preset === p.id ? { borderColor: 'var(--brand)' } : undefined}
                  onClick={() => onDraft({ preset: p.id })}
                >
                  <span className="box" aria-hidden="true">{preset === p.id ? '✓' : ''}</span>
                  <span className="nm">
                    {p.label}
                    <span className="muted" style={{ display: 'block', fontSize: 11, fontWeight: 500, lineHeight: 1.35, marginTop: 3 }}>
                      {p.hint}
                    </span>
                    <MixBar mix={p.mix} />
                  </span>
                </button>
              ))}

              <button
                type="button"
                className={`topic ${preset === 'custom' ? 'on' : ''}`}
                aria-pressed={preset === 'custom'}
                style={preset === 'custom' ? { borderColor: 'var(--brand)' } : undefined}
                onClick={() => onDraft({ preset: 'custom' })}
              >
                <span className="box" aria-hidden="true">{preset === 'custom' ? '✓' : ''}</span>
                <span className="nm">
                  Custom
                  <span className="muted" style={{ display: 'block', fontSize: 11, fontWeight: 500, lineHeight: 1.35, marginTop: 3 }}>
                    Whatever you set below
                  </span>
                  <MixBar mix={activeMix} />
                </span>
              </button>
            </div>
          )}

          {activeMix && (
            <div
              style={{
                marginTop: 18, display: 'grid', gap: 14,
                // 296px is the width at which six cells can only ever fall into
                // 3, 2 or 1 columns — never a ragged 4 + 2.
                gridTemplateColumns: 'repeat(auto-fit, minmax(296px, 1fr))',
              }}
            >
              {LEVELS.map((l) => (
                <div className="row" key={l} style={{ gap: 11, flexWrap: 'nowrap' }}>
                  <span className={`tag ${l} sm`} style={{ width: 88, flex: 'none', justifyContent: 'center' }}>
                    {LABEL[l]}
                  </span>
                  <input
                    type="range"
                    className="grow"
                    min={0}
                    max={MAX_WEIGHT}
                    step={1}
                    value={Number(activeMix[l]) || 0}
                    aria-label={`${LABEL[l]} weight`}
                    onChange={(e) => setWeight(l, Number(e.target.value))}
                  />
                  <span className="mono" style={{ width: 14, flex: 'none', textAlign: 'right', fontSize: 12, fontWeight: 700, color: 'var(--ink-3)' }}>
                    {Number(activeMix[l]) || 0}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* No sets, no control. The card is drawn from what the server says a
            level may be asked through, so when that answer has not arrived the
            run silently uses the server's own defaults — which is the same thing
            this control would have asked for. */}
        {kindSets && (
          <Card className="pad-lg">
            <div className="cardhead">
              <h3>Interaction per level</h3>
              <span className="sub">One kind per level for this run — the first is the default.</span>
            </div>

            <div
              style={{
                display: 'grid', gap: 14,
                // 560px is where Apply's three-kind set still sits on one line
                // beside its level tag. Below it the grid drops to a single
                // column rather than wrapping a set across two rows, which reads
                // as two separate choices.
                gridTemplateColumns: 'repeat(auto-fit, minmax(560px, 1fr))',
              }}
            >
              {LEVELS.map((l) => {
                const set = kindSets[l] ?? [];
                const chosen = kinds[l] ?? set[0];
                return (
                  <div className="row" key={l} style={{ gap: 11 }}>
                    <span className={`tag ${l} sm`} style={{ width: 88, flex: 'none', justifyContent: 'center' }}>
                      {LABEL[l]}
                    </span>
                    {set.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="fpill"
                        aria-pressed={chosen === k}
                        aria-label={`${LABEL[l]} as ${KIND_LABEL[k] ?? k}`}
                        onClick={() => setKind(l, k)}
                      >
                        {KIND_LABEL[k] ?? k}
                      </button>
                    ))}
                    {/* A level with one kind is not a choice, and a lone pressed
                        pill would read as one that had lost its alternatives. */}
                    {set.length === 1 && <span className="hint" style={{ margin: 0 }}>the only honest one at this level</span>}
                  </div>
                );
              })}
            </div>

            <div className="hint">
              The choices are limited to each level&rsquo;s own set because the level chooses the
              interaction: everything inside a set demands the same cognitive move, so swapping
              within it changes the surface and not the demand.
            </div>
          </Card>
        )}
      </div>

      {previewError && (
        <div className="note bad" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={15} />
          <span>Could not resolve that plan: {previewError}</span>
        </div>
      )}

      {plan?.warnings?.length > 0 && (
        <div className="stack tight" style={{ marginBottom: 14 }}>
          {plan.warnings.map((w) => (
            <div className="note warn" key={w}>
              <Icon name="alert" size={15} />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <span className="t">Plan preview</span>
          <div className="tabs" role="tablist" aria-label="What this run does to the existing bank">
            <button type="button" role="tab" aria-selected={mode === 'replace'} onClick={() => onDraft({ mode: 'replace' })}>
              Replace
            </button>
            <button type="button" role="tab" aria-selected={mode === 'append'} onClick={() => onDraft({ mode: 'append' })}>
              Append
            </button>
          </div>
          <span className="panel-sub">
            {banked} in the bank now · {after} after this run
          </span>
          {pending && <span className="spin" />}
        </div>

        {plan ? (
          <>
            <div className="dist">
              {LEVELS.map((l) => plan.perLevel[l] > 0 && (
                <i key={l} className={`swatch ${l}`} style={{ flex: plan.perLevel[l] }} />
              ))}
            </div>
            {preview.describe?.levels && (
              <span className="panel-sub" style={{ display: 'block', marginTop: 9 }}>
                {preview.describe.levels}
              </span>
            )}

            <div
              style={{
                marginTop: 14, display: 'grid', alignItems: 'start', gap: 14,
                gridTemplateColumns: 'repeat(auto-fit, minmax(288px, 1fr))',
              }}
            >
              <div className="accent">
                <div className="k">Resolved plan</div>
                <div className="row" style={{ alignItems: 'baseline', gap: 9, marginTop: 7 }}>
                  <span className="num" style={{ fontSize: 38, fontWeight: 800, letterSpacing: '-0.03em' }}>
                    {plan.total}
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>questions</span>
                  {plan.needsConfirm && <span className="flag">needs confirming</span>}
                </div>
                <div style={{ marginTop: 5, fontSize: 12, fontWeight: 600 }}>
                  {covered} of {topics.length} topic{topics.length === 1 ? '' : 's'} · about {mmss(plan.estimateSeconds)} to write
                </div>

                <div className="k" style={{ marginTop: 18, marginBottom: 9 }}>Interactions</div>
                <div className="tiles">
                  {kindRows.map(([k, n]) => (
                    <div className="accent-tile" key={k}>
                      <b>
                        {n}
                        <span style={{ fontSize: 10.5, fontWeight: 700, opacity: 0.65 }}>
                          {Math.round((n / Math.max(1, plan.total)) * 100)}%
                        </span>
                      </b>
                      <span>{KIND_LABEL[k] ?? k}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Card>
                <div className="cardhead" style={{ marginBottom: 12 }}>
                  <h3>Per level</h3>
                  <span className="sub">one interaction each</span>
                </div>
                {/* Scaled against the busiest level, not the total: these rows
                    are a comparison between levels, and the .dist bar above
                    already carries the share of the whole bank. */}
                <div className="stack tight">
                  {LEVELS.map((l) => (
                    <div className="genrow" key={l}>
                      <span className="n">{LABEL[l]}</span>
                      <span className="track">
                        <i
                          className={`swatch ${l}`}
                          style={{ width: `${Math.round(((plan.perLevel[l] ?? 0) / busiest) * 100)}%` }}
                        />
                      </span>
                      <span className="c">{plan.perLevel[l] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        ) : (
          <div className="skel" style={{ height: 188, borderRadius: 'var(--r-card)' }} />
        )}

        <div className="row" style={{ marginTop: 16, gap: 12 }}>
          <span className="panel-sub" style={{ flex: 1, minWidth: 180 }}>
            Nothing is written until you press Generate.
          </span>
          <button
            type="button"
            className="btn on-d solid"
            disabled={!plan || plan.total === 0}
            onClick={() => onRun(spec, { mode })}
          >
            <Icon name="sparkle" size={13} />
            Generate {plan?.total ?? ''} questions
          </button>
        </div>
      </div>
    </>
  );
}
