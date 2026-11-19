/**
 * Step one: what are the questions written from.
 *
 * Before a chapter is loaded the screen is a brief and two ways in - a deck
 * dropped on the page or a syllabus pasted into it - beside the chapters
 * already read. Once one is loaded, the chapter IS the page: where it came
 * from, the topics found in it, and the only decision left, which of them to
 * ask about. Beside the list, what the ticked topics would make.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { LABEL, LEVELS } from '../lib/bloom.js';
import { Button, Dialog, Empty, Field, Icon, Note, Num, Panel, Section, Segmented, Tick, Tip } from '../ui/index.jsx';
import { LevelSpread } from '../ui/viz.jsx';
import { startTotal } from './Planner.jsx';

const fmtSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

const fmtDay = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
};

const KIND_TAG = { pptx: 'PPTX', syllabus: 'TEXT' };

/** A lesson deck, dropped or chosen. */
function DropZone({ busy, onFile }) {
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState(null);
  const fileRef = useRef(null);
  const reading = busy === 'file';

  const take = (file) => { if (file) { setPicked({ name: file.name, size: file.size }); onFile(file); } };

  return (
    <div
      className="tc-drop"
      data-over={over ? 'true' : undefined}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
    >
      <span className="tc-drop-ic">{reading ? <span className="spinner" /> : <Icon name="deck" size={20} />}</span>
      <div className="tc-drop-txt">
        <h3>{reading ? 'Reading the deck' : over ? 'Let go to read it' : 'Drop a .pptx here'}</h3>
        <p>
          {picked
            ? <span className="mono">{picked.name} · {fmtSize(picked.size)}</span>
            : 'Slide titles and body text become topics. Image-only slides are read with OCR.'}
        </p>
      </div>
      <Button variant="primary" busy={reading} icon="upload" onClick={() => fileRef.current?.click()}>
        Choose a file
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        hidden
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}

/*
 * "Use sample": an example unit that shows the shape the text should take,
 * one topic per line. Its title says it is an example, and a note says so
 * beside it until the professor replaces it with their own.
 */
const SAMPLE = {
  title: 'Example: Unit III, Transport layer',
  text: [
    'Transport layer services',
    'Multiplexing and demultiplexing',
    'User Datagram Protocol (UDP)',
    'Transmission Control Protocol (TCP)',
    'The TCP three-way handshake',
    'Flow control and the receive window',
    'Congestion control',
  ].join('\n'),
};

/** Syllabus text, pasted. */
function PasteForm({ busy, onText }) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const sample = title === SAMPLE.title || text === SAMPLE.text;
  return (
    <form className="tc-paste" onSubmit={(e) => { e.preventDefault(); onText(title, text); }}>
      <Field label="Title" htmlFor="src-title">
        <input id="src-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Unit III, Transport layer" />
      </Field>
      <Field label="Syllabus text" htmlFor="src-text" hint="A unit outline, a chapter summary, or the syllabus itself. One topic per line reads best.">
        <textarea id="src-text" className="textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {sample && (
        <p className="tc-sample-note" role="status">
          <Icon name="info" size={14} />
          <span>An example unit, to show the shape: one topic per line. Replace it with your own syllabus before you read it.</span>
        </p>
      )}
      <div className="cluster">
        <Button type="submit" variant="ink" busy={busy === 'text'} disabled={!text.trim()}>Read this text</Button>
        {/* Offered only while there is nothing of the professor's own to overwrite. */}
        {sample ? (
          <Button type="button" variant="ghost" onClick={() => { setTitle(''); setText(''); }}>Clear the example</Button>
        ) : !title.trim() && !text.trim() && (
          <Button type="button" variant="ghost" onClick={() => { setTitle(SAMPLE.title); setText(SAMPLE.text); }}>Use sample</Button>
        )}
      </div>
    </form>
  );
}

/** The one input, in a dialog: a lesson deck, or syllabus text. */
function Source({ busy, onFile, onText }) {
  const [mode, setMode] = useState('deck');
  return (
    <div className="stack">
      <Segmented
        label="Source"
        value={mode}
        onChange={setMode}
        options={[{ id: 'deck', label: 'Lesson deck' }, { id: 'text', label: 'Syllabus text' }]}
      />
      {mode === 'deck' ? <DropZone busy={busy} onFile={onFile} /> : <PasteForm busy={busy} onText={onText} />}
    </div>
  );
}

function Library({ saved, loaded, currentId, busy, onOpen }) {
  return (
    <section className="card tc-lib" aria-label="Reuse a chapter">
      <div className="tc-lib-head">
        <Section title="Reuse a chapter" sub="Every chapter you read is kept with its questions, so a second class costs nothing to set up." />
      </div>
      {!loaded ? (
        <div className="tc-lib-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="tc-lib-skel"><div className="skel" /><div className="skel" /></div>
          ))}
        </div>
      ) : saved.length === 0 ? (
        <div className="tc-lib-empty">
          <span className="tc-pages" aria-hidden="true"><i /><i /><i /></span>
          <p>Nothing read yet. The first chapter you read lands here.</p>
        </div>
      ) : (
        <ul className="tc-lib-list">
          {saved.map((c) => {
            const here = c._id === currentId;
            return (
              <li key={c._id} className="tc-lib-row" aria-current={here ? 'true' : undefined}>
                <span className="tc-kind">{KIND_TAG[c.kind] ?? 'DOC'}</span>
                <span className="tc-lib-main">
                  <b>{c.title}</b>
                  <small>
                    {[
                      fmtDay(c.createdAt),
                      `${c.topics?.length ?? 0} topics`,
                      c.questionCount ? `${c.questionCount} approved` : null,
                      c.draftCount ? `${c.draftCount} draft${c.draftCount === 1 ? '' : 's'} to review` : null,
                      !c.questionCount && !c.draftCount ? 'no questions yet' : null,
                    ]
                      .filter(Boolean).join(' · ')}
                  </small>
                </span>
                {here ? (
                  <span className="tc-lib-here"><Icon name="check" size={13} />Open</span>
                ) : (
                  <Button size="sm" disabled={busy === 'reuse'} onClick={() => onOpen(c._id)} aria-label={`Reuse ${c.title}`}>Reuse</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Six tiny bars: how many questions a topic gets at each level. */
function LevelTicks({ mix, peak }) {
  const said = mix ? LEVELS.map((l) => `${LABEL[l]} ${mix[l] ?? 0}`).join(', ') : 'Not asked';
  return (
    <span className="tc-ticks" role="img" aria-label={said} title={said}>
      {LEVELS.map((l) => {
        const n = mix?.[l] ?? 0;
        return <i key={l} data-level={l} data-n={n > 0 ? 'true' : undefined} style={{ '--h': n > 0 ? n / peak : 0 }} />;
      })}
    </span>
  );
}

export default function Material({ content, selected, bank, hasBank, drafts = 0, onContent, onSelected, onNext }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(-1);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState('');
  const [saved, setSaved] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [swap, setSwap] = useState(false);
  // What the ticked topics resolve to at the size the planner opens with.
  const [plan, setPlan] = useState(null);

  const topics = content?.topics ?? [];

  useEffect(() => {
    let alive = true;
    api.listContents().then(
      (res) => { if (alive) { setSaved(res.contents ?? []); setLoaded(true); } },
      () => { if (alive) setLoaded(true); },
    );
    return () => { alive = false; };
  }, [content?.contentId]);

  // Before a bank exists, ask the server what the first plan would write: the
  // same topics and the same opening size the planner starts from, so the
  // numbers here are the ones the next step shows. Writes nothing.
  const selectedKey = selected.join('\u0000');
  useEffect(() => {
    if (!content?.contentId || hasBank || selected.length === 0) { setPlan(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api.generatePreview(content.contentId, selected, { total: startTotal(selected.length), preset: 'balanced' }).then(
        (res) => { if (alive) setPlan(res.plan ?? null); },
        () => { if (alive) setPlan(null); },
      );
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content?.contentId, hasBank, selectedKey]);

  // Once a bank exists, the counts are the bank's own.
  const inBank = useMemo(() => (bank?.questions ?? []).filter((q) => q.status !== 'discarded'), [bank]);
  const byTopic = useMemo(() => {
    const out = {};
    if (hasBank) {
      inBank.forEach((q) => {
        const row = (out[q.topic] ??= { count: 0, mix: {} });
        row.count += 1;
        row.mix[q.bloom] = (row.mix[q.bloom] ?? 0) + 1;
      });
    } else {
      (plan?.topics ?? []).forEach((t) => { out[t.topic] = { count: t.count, mix: t.mix }; });
    }
    return out;
  }, [hasBank, inBank, plan]);

  async function takeFile(file) {
    if (!/\.pptx$/i.test(file.name)) { setError(`"${file.name}" is not a .pptx file.`); return; }
    setError(''); setBusy('file');
    try { onContent(await api.uploadPptx(file)); setSwap(false); }
    catch (err) { setError(`Upload failed: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function takeText(title, text) {
    const body = text.trim();
    if (!body) { setError('Paste some syllabus text first.'); return; }
    setError(''); setBusy('text');
    try { onContent(await api.uploadSyllabus(title.trim() || 'Pasted syllabus', body)); setSwap(false); }
    catch (err) { setError(`Could not read that text: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function reuse(id) {
    setError(''); setBusy('reuse');
    try {
      const res = await api.getContent(id);
      const c = res.content || res;
      onContent({ contentId: c._id, title: c.title, kind: c.kind, topics: c.topics ?? [] });
      setSwap(false);
    } catch (err) { setError(`Could not open that chapter: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function saveTopics(next, nextSelected) {
    setError(''); setSaving(true);
    try {
      const res = await api.updateTopics(content.contentId, next);
      const kept = res?.content?.topics ?? next;
      onContent({ ...content, topics: kept });
      onSelected(nextSelected.filter((t) => kept.includes(t)));
    } catch (err) { setError(`Could not save the topic list: ${err.message}`); }
    finally { setSaving(false); }
  }

  function commitEdit(idx) {
    const value = draft.trim();
    const prev = topics[idx];
    setEditing(-1);
    if (!value || value === prev) return;
    if (topics.some((t, i) => i !== idx && t === value)) { setError(`"${value}" is already in the list.`); return; }
    const ticked = selected.includes(prev);
    saveTopics(topics.map((t, i) => (i === idx ? value : t)), selected.filter((t) => t !== prev).concat(ticked ? [value] : []));
  }

  function addTopic() {
    const value = added.trim();
    if (!value) return;
    if (topics.includes(value)) { setError(`"${value}" is already in the list.`); return; }
    setAdded('');
    saveTopics([...topics, value], [...selected, value]);
  }

  /* ------------------------------------------------ nothing loaded yet */
  if (!content) {
    return (
      <>
        {error && <Note tone="bad">{error}</Note>}
        <div className="tc-start">
          <Panel className="tc-hero">
            <div className="tc-hero-txt">
              <span className="tag-mint">Material · Step 1</span>
              <h2>Start from what you already teach.</h2>
              <p>
                Give BloomLoop the deck you teach from, or paste the syllabus. It reads the topics out of it, you
                choose which ones this class is asked about, and every question is written from that text and
                nothing else.
              </p>
            </div>
            {/* What each topic becomes: questions at six levels, climbing. */}
            <figure className="tc-hero-ladder" aria-label="Every topic is asked at six levels, from Remember to Create">
              <div className="tc-hero-bars" aria-hidden="true">
                {LEVELS.map((l, i) => (
                  <div key={l} data-level={l}><i /><span>{i + 1}</span></div>
                ))}
              </div>
              <figcaption>Six levels per topic</figcaption>
            </figure>
          </Panel>

          <div className="tc-ways">
            <DropZone busy={busy} onFile={takeFile} />
            <section className="card tc-paste-card" aria-labelledby="tc-paste-h">
              <div className="tc-paste-head">
                <h3 id="tc-paste-h">Paste a syllabus</h3>
                <span className="tc-kind">TEXT</span>
              </div>
              <PasteForm busy={busy} onText={takeText} />
            </section>
            <Library saved={saved} loaded={loaded} busy={busy} onOpen={reuse} />
          </div>
        </div>
      </>
    );
  }

  /* ----------------------------------------------------- a chapter open */
  const sourceLine = [
    content.kind === 'syllabus' ? 'Pasted syllabus' : content.kind === 'pptx' ? 'Lesson deck' : null,
    typeof content.slideCount === 'number' ? `${content.slideCount} slides` : null,
    typeof content.chars === 'number' ? `${content.chars.toLocaleString()} characters` : null,
    content.readBy === 'ocr' ? 'read from the slide images' : null,
  ].filter(Boolean).join(' · ');
  const allOn = topics.length > 0 && selected.length === topics.length;
  const peak = Math.max(1, ...Object.values(byTopic).flatMap((r) => LEVELS.map((l) => r.mix?.[l] ?? 0)));

  const yieldCounts = hasBank
    ? LEVELS.reduce((a, l) => ({ ...a, [l]: inBank.filter((q) => q.bloom === l).length }), {})
    : plan?.perLevel ?? null;
  const yieldTotal = hasBank ? inBank.length : plan?.total ?? null;
  const bankTopics = new Set(inBank.map((q) => q.topic).filter(Boolean)).size;

  return (
    <>
      {error && <Note tone="bad">{error}</Note>}

      <div className="tc-chap">
        <section className="card tc-chap-main" aria-label="Topics found">
          <div className="tc-src">
            <span className="tc-kind">{KIND_TAG[content.kind] ?? 'DOC'}</span>
            <div className="tc-src-main">
              <b>{content.title}</b>
              <small>{sourceLine || 'Chapter'}</small>
            </div>
            <Button size="sm" icon="refresh" onClick={() => setSwap(true)}>Replace</Button>
          </div>

          <div className="tc-topics-head">
            <Section title="Topics found" sub={`${selected.length} of ${topics.length} ticked. Rename anything the reader got wrong.`} />
            {topics.length > 1 && (
              <div className="cluster cluster-1">
                <Button variant="ghost" size="sm" disabled={allOn} onClick={() => onSelected(topics)}>Tick all</Button>
                <Button variant="ghost" size="sm" disabled={selected.length === 0} onClick={() => onSelected([])}>Clear</Button>
              </div>
            )}
          </div>

          {topics.length === 0 ? (
            <Empty icon="checklist" title="No topics were found">
              Nothing usable came out of that source. Add the topics below and questions will be written about those.
            </Empty>
          ) : (
            <>
              <div className="tc-trow tc-thead" aria-hidden="true">
                <span />
                <span>#</span>
                <span>Topic</span>
                <span className="tc-lvnums">
                  {LEVELS.map((l, i) => <span key={l} title={LABEL[l]}>{i + 1}</span>)}
                </span>
                <span className="r">{hasBank ? 'In bank' : 'About'}</span>
              </div>
              <ul className="tc-tlist">
                {topics.map((topic, idx) => {
                  const on = selected.includes(topic);
                  const row = byTopic[topic];
                  if (editing === idx) {
                    return (
                      <li key={`edit-${topic}`} className="tc-topic-edit">
                        <input
                          className="input input-sm grow"
                          value={draft}
                          autoFocus
                          aria-label="Topic name"
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(idx); if (e.key === 'Escape') setEditing(-1); }}
                        />
                        <Button variant="primary" size="sm" onClick={() => commitEdit(idx)}>Save</Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(-1)}>Cancel</Button>
                      </li>
                    );
                  }
                  return (
                    <li key={topic} className="tc-topic" data-on={on ? 'true' : 'false'}>
                      <button
                        type="button"
                        className="tc-trow tc-topic-hit"
                        aria-pressed={on}
                        onClick={() => onSelected(on ? selected.filter((t) => t !== topic) : [...selected, topic])}
                      >
                        <Tick on={on} />
                        <span className="tc-ref">{String(idx + 1).padStart(2, '0')}</span>
                        <span className="tc-topic-name">{topic}</span>
                        <LevelTicks mix={on || hasBank ? row?.mix : null} peak={peak} />
                        <span className="tc-est">
                          {row && (on || hasBank) ? `${hasBank ? '' : '~'}${row.count}` : '—'}
                        </span>
                      </button>
                      <span className="tc-topic-acts">
                        <Tip label="Rename">
                          <Button variant="ghost" size="sm" icon="edit" aria-label={`Rename ${topic}`} disabled={saving} onClick={() => { setEditing(idx); setDraft(topic); }} />
                        </Tip>
                        <Tip label="Remove">
                          <Button variant="ghost" size="sm" icon="trash" aria-label={`Remove ${topic}`} disabled={saving} onClick={() => saveTopics(topics.filter((t) => t !== topic), selected.filter((t) => t !== topic))} />
                        </Tip>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <form className="tc-addtopic" onSubmit={(e) => { e.preventDefault(); addTopic(); }}>
            <Icon name="plus" className="muted" />
            <input
              value={added}
              onChange={(e) => setAdded(e.target.value)}
              placeholder="Add a topic the reader missed"
              aria-label="Add a topic"
            />
            <Button type="submit" size="sm" disabled={!added.trim() || saving}>Add</Button>
          </form>
        </section>

        <aside className="tc-chap-side">
          <Panel className="tc-yield" aria-label={hasBank ? 'In the bank' : 'What the ticked topics make'}>
            <span className="tag-mint">{hasBank ? 'In the bank' : 'First plan'}</span>
            <div className="tc-big">
              <b>{yieldTotal == null ? '—' : <>{hasBank ? '' : '~'}<Num value={yieldTotal} /></>}</b>
              <span>
                {hasBank
                  ? `questions${drafts > 0 ? `, ${drafts} still drafts,` : ' approved'} over ${bankTopics} topic${bankTopics === 1 ? '' : 's'}`
                  : selected.length === 0
                    ? 'Tick a topic to see what it makes'
                    : `questions from ${selected.length} ticked topic${selected.length === 1 ? '' : 's'}`}
              </span>
            </div>
            {yieldCounts && yieldTotal > 0 && <LevelSpread counts={yieldCounts} />}
            <Button variant="accent" size="lg" block disabled={selected.length === 0} onClick={onNext}>
              {hasBank ? 'Open the question bank' : 'Generate question bank'}
              <Icon name="forward" />
            </Button>
            <p className="tc-yield-note">
              {hasBank && drafts > 0
                ? 'Drafts reach a room only once you approve them. Review them in the question bank.'
                : hasBank
                ? 'Plan another run from the question bank to add to it or replace it.'
                : 'You set the exact number and the mix of levels on the next step. Nothing is written until then.'}
            </p>
          </Panel>

          <Library saved={saved} loaded={loaded} currentId={content.contentId} busy={busy} onOpen={reuse} />
        </aside>
      </div>

      <Dialog
        open={swap}
        onOpenChange={setSwap}
        title="Read something else"
        description="The topic list follows the material. The chapter you have open stays in your library with its questions."
        locked={Boolean(busy)}
      >
        <Source busy={busy} onFile={takeFile} onText={takeText} />
      </Dialog>
    </>
  );
}
