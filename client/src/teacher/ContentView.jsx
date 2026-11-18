import { useEffect, useRef, useState } from 'react';

import { api } from '../api.js';
import Icon from '../ui/Icon.jsx';
import { Card, Empty, PageHead, Stat, TailBars } from '../ui/Shell.jsx';

/* Step one of the teacher flow: a deck or a pasted syllabus goes in, an editable
   topic list comes out, and the teacher ticks the ones worth asking about.

   Both ways in stay on screen after something is loaded. In v1 they vanished the
   moment a deck was read, which meant swapping to a different chapter was only
   possible from the reuse rail — and that rail was hidden below 1100px, so on a
   laptop the teacher had no way back at all. */

const compact = (n) =>
  (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function shorten(name, max = 28) {
  const value = String(name ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* Bar labels come off the END of a title: "Unit III — Transport Layer" -> "TL".
   Teachers name chapters with a shared prefix, so leading initials collide into
   a row of identical labels while trailing ones stay distinct. */
function shortLabel(title) {
  const words = String(title ?? '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean);
  return words.slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';
}

export default function ContentView({ content, selected, onContent, onSelected, onNext }) {
  const fileRef = useRef(null);
  const addRef = useRef(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [editIdx, setEditIdx] = useState(-1);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState('');
  const [saved, setSaved] = useState([]);
  const [picked, setPicked] = useState(null);

  const topics = content?.topics ?? [];

  useEffect(() => {
    let alive = true;
    api.listContents().then((res) => alive && setSaved(res.contents ?? []), () => {});
    return () => { alive = false; };
  }, [content?.contentId]);

  async function takeFile(file) {
    setPicked({ name: file.name, size: file.size });
    if (!/\.pptx$/i.test(file.name)) return setError(`"${file.name}" is not a .pptx file.`);
    setError('');
    setBusy('file');
    try { onContent(await api.uploadPptx(file)); }
    catch (err) { setError(`Upload failed: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function takeText() {
    const body = text.trim();
    if (!body) return setError('Paste some syllabus text first.');
    setError('');
    setBusy('text');
    try { onContent(await api.uploadSyllabus(title.trim() || 'Pasted syllabus', body)); }
    catch (err) { setError(`Could not read that text: ${err.message}`); }
    finally { setBusy(''); }
  }

  async function reuse(id) {
    setError('');
    setBusy('reuse');
    try {
      const res = await api.getContent(id);
      const c = res.content || res;
      onContent({ contentId: c._id, title: c.title, kind: c.kind, topics: c.topics ?? [] });
    } catch (err) { setError(`Could not open that content: ${err.message}`); }
    finally { setBusy(''); }
  }

  // Topic edits persist immediately: generation reads the stored list, so a
  // rename that only lived in React state would silently not take effect.
  async function saveTopics(next, nextSelected) {
    setError('');
    setSaving(true);
    try {
      const res = await api.updateTopics(content.contentId, next);
      const savedTopics = res?.content?.topics ?? next;
      onContent({ ...content, topics: savedTopics });
      onSelected(nextSelected.filter((t) => savedTopics.includes(t)));
    } catch (err) { setError(`Could not save the topic list: ${err.message}`); }
    finally { setSaving(false); }
  }

  function commitEdit(idx) {
    const value = draft.trim();
    const prev = topics[idx];
    setEditIdx(-1);
    if (!value || value === prev) return;
    if (topics.some((t, i) => i !== idx && t === value)) return setError(`"${value}" is already in the list.`);
    const ticked = selected.includes(prev);
    saveTopics(
      topics.map((t, i) => (i === idx ? value : t)),
      selected.filter((t) => t !== prev).concat(ticked ? [value] : []),
    );
  }

  function addTopic() {
    const value = added.trim();
    if (!value) return;
    if (topics.includes(value)) return setError(`"${value}" is already in the list.`);
    setAdded('');
    saveTopics([...topics, value], [...selected, value]);
  }

  const kindLabel = content?.kind === 'syllabus' ? 'Pasted syllabus'
    : content?.kind === 'pptx' ? 'PPTX deck' : '';

  // slideCount and chars only ride on a fresh ingest response. A chapter loaded
  // back out of the library was parsed on some earlier visit and legitimately
  // has neither, so the card says so instead of printing a confident zero.
  const slides = typeof content?.slideCount === 'number' ? content.slideCount : null;
  const chars = typeof content?.chars === 'number' ? content.chars : null;
  const sourceValue = slides !== null ? String(slides) : chars !== null ? compact(chars) : null;
  const sourceUnit = slides !== null ? 'slides' : chars !== null ? 'characters' : '';

  const skipped = Math.max(0, topics.length - selected.length);
  const pct = topics.length ? Math.round((selected.length / topics.length) * 100) : 0;
  // The library listing already carries a per-chapter question count, so "does
  // this content have a bank" costs no extra call.
  const bankCount = saved.find((c) => c._id === content?.contentId)?.questionCount ?? 0;
  const libraryBars = saved.slice(0, 7).map((c) => ({
    label: shortLabel(c.title),
    value: c.topics?.length ?? 0,
    on: c._id === content?.contentId,
  }));

  const topicRows = topics.map((topic, idx) => {
    const on = selected.includes(topic);

    if (editIdx === idx) {
      return (
        <div key={`e-${topic}`} className="topic" style={{ cursor: 'default' }}>
          <input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(idx); if (e.key === 'Escape') setEditIdx(-1); }}
            style={{ height: 36, flex: 1, minWidth: 0 }}
          />
          <button type="button" className="btn xs pri" onClick={() => commitEdit(idx)}>Save</button>
          <button type="button" className="btn xs" onClick={() => setEditIdx(-1)}>Cancel</button>
        </div>
      );
    }

    return (
      <div key={topic} className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <button
          type="button"
          className={`topic ${on ? 'on' : 'off'}`}
          aria-pressed={on}
          onClick={() => onSelected(on ? selected.filter((t) => t !== topic) : [...selected, topic])}
        >
          <span className="box" aria-hidden="true">{on ? '✓' : ''}</span>
          <span className="nm">{topic}</span>
          <span className="sl">{on ? 'asked' : 'skipped'}</span>
        </button>
        <button
          type="button"
          className="iconbtn bordered"
          title="Rename this topic"
          disabled={saving}
          onClick={() => { setEditIdx(idx); setDraft(topic); }}
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          type="button"
          className="iconbtn bordered"
          title="Remove this topic"
          disabled={saving}
          onClick={() => saveTopics(topics.filter((t) => t !== topic), selected.filter((t) => t !== topic))}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    );
  });

  return (
    <>
      <PageHead
        title="Material"
        sub={content
          ? `${content.title} · ${kindLabel} · ${topics.length} topic${topics.length === 1 ? '' : 's'} extracted, ${selected.length} ticked`
          : 'Upload a lesson deck or paste a syllabus. BloomLoop writes questions from what you already teach and never invents teaching content of its own.'}
        actions={
          <button type="button" className="btn pri" onClick={onNext} disabled={selected.length === 0}>
            Generate question bank
            <Icon name="forward" size={13} />
          </button>
        }
      />

      {error && (
        <div className="note bad" style={{ marginBottom: 16 }}>
          <Icon name="alert" size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid auto" style={{ marginBottom: 14 }}>
        <Stat
          label="Topics found"
          icon="layers"
          value={topics.length}
          delta={content ? `Extracted from this ${kindLabel.toLowerCase()}` : 'Nothing read yet'}
          tail={saved.length > 0
            ? <TailBars bars={libraryBars} />
            : <div className="said"><span>Your library builds up here.</span></div>}
        />
        <Stat
          label="Ticked to ask about"
          icon="checkCircle"
          tone={selected.length ? 'ok' : ''}
          value={selected.length}
          unit={topics.length ? `of ${topics.length}` : ''}
          delta={topics.length ? `${pct}% of the extracted list` : 'Tick a topic to aim questions at it'}
          deltaTone={topics.length > 0 && selected.length === topics.length ? 'up' : ''}
          tail={
            <>
              <div className="dist">
                {selected.length > 0 && <i style={{ flex: selected.length, background: 'var(--ink-2)' }} />}
                {(skipped > 0 || topics.length === 0) && (
                  <i style={{ flex: skipped || 1, background: 'var(--line-2)' }} />
                )}
              </div>
              <div className="row" style={{ gap: 10, marginTop: 9 }}>
                <span className="eyebrow">{selected.length} asked</span>
                <span className="eyebrow right">{skipped} skipped</span>
              </div>
            </>
          }
        />
        <Stat
          label={slides !== null ? 'Slides read' : chars !== null ? 'Characters read' : 'Source read'}
          icon={content?.kind === 'syllabus' ? 'file' : 'deck'}
          tone="flat"
          value={sourceValue ?? '—'}
          unit={sourceUnit}
          delta={busy === 'file' || busy === 'text' ? 'Parsing now…'
            : content && sourceValue === null ? 'Parsed when it was first uploaded'
            : content ? `Read straight out of the ${kindLabel.toLowerCase()}`
            : 'A .pptx deck or plain syllabus text'}
          tail={busy === 'file' || busy === 'text' ? (
            <div className="skel" style={{ height: 30 }} />
          ) : (
            <div className="row" style={{ gap: 6 }}>
              <span className={`flag ${content?.kind === 'pptx' ? 'info' : 'neutral'}`}>
                <Icon name="deck" size={11} /> Deck
              </span>
              <span className={`flag ${content?.kind === 'syllabus' ? 'info' : 'neutral'}`}>
                <Icon name="file" size={11} /> Syllabus
              </span>
            </div>
          )}
        />
        <Stat
          label="Question bank"
          icon="sparkle"
          tone={bankCount > 0 ? 'ok' : ''}
          value={bankCount > 0 ? bankCount : '—'}
          unit={bankCount > 0 ? 'questions' : ''}
          delta={bankCount > 0 ? 'Already written — reuse it instead of regenerating'
            : content ? 'Nothing generated for this chapter yet'
            : 'Load a chapter to see whether it has one'}
          tail={
            <button type="button" className="btn sm block" onClick={onNext} disabled={selected.length === 0}>
              {bankCount > 0 ? 'Open the bank' : 'Generate questions'}
              <Icon name="forward" size={11} />
            </button>
          }
        />
      </div>

      <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
        <div className="stack" style={{ flex: '3 1 420px', minWidth: 0 }}>
          {/* Once material is loaded the topic list is what the teacher is
              actually working on, so it climbs above the intake surface. Before
              that, the intake is the whole screen. */}
          <Card style={{ order: content ? 1 : 2 }}>
            <div className="cardhead">
              <h3>Topics</h3>
              {content && <span className="sub">Rename, remove, or add anything the parser missed</span>}
              {saving && <span className="spin" />}
            </div>

            {busy !== '' ? (
              <div className="topics">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skel" style={{ height: 48 }} />)}
              </div>
            ) : !content ? (
              <Empty
                icon="upload"
                title="No material yet"
                action={
                  <button type="button" className="btn pri" onClick={() => fileRef.current?.click()}>
                    <Icon name="upload" size={13} />
                    Upload a lesson deck
                  </button>
                }
              >
                Topics appear here the moment a deck or a syllabus has been read. Nothing is generated
                until you tick the ones worth asking about.
              </Empty>
            ) : (
              <>
                {topics.length === 0 && (
                  <div className="note warn" style={{ marginBottom: 8 }}>
                    <Icon name="alert" size={15} />
                    <span>Nothing usable came out of that file — a deck of images has no text to read. Type the topics in below.</span>
                  </div>
                )}

                <div className="topics">
                  {topicRows}

                  <div className="topic" style={{ cursor: 'default', borderStyle: 'dashed' }}>
                    <span className="box" style={{ borderStyle: 'dashed' }} aria-hidden="true" />
                    <input
                      ref={addRef}
                      value={added}
                      onChange={(e) => setAdded(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTopic()}
                      placeholder="Add a topic the parser missed"
                      style={{ height: 36, flex: 1, minWidth: 0 }}
                    />
                    <button type="button" className="btn xs pri" onClick={addTopic} disabled={saving || !added.trim()}>
                      {saving && <span className="spin" />}
                      Add
                    </button>
                  </div>
                </div>

                <div className="said" style={{ marginTop: 16 }}>
                  <span>Roughly 12 questions per topic, spread across all six levels.</span>
                </div>
              </>
            )}
          </Card>

          <div className="panel" style={{ order: content ? 2 : 1 }}>
            <div className="panel-head">
              <span className="t">Source material</span>
              <span className="panel-sub grow">
                {content
                  ? 'Read another one to swap chapters — the topic list follows the material.'
                  : 'Slide titles and body text become topics. Nothing is sent anywhere until you generate.'}
              </span>
            </div>

            {content && (
              <div className="accent" style={{ marginBottom: 14 }}>
                <div className="k">Loaded chapter</div>
                <h2 style={{ marginTop: 6 }}>{content.title}</h2>
                <div className="k" style={{ marginTop: 7 }}>
                  {kindLabel}
                  {sourceValue !== null && ` · ${sourceValue} ${sourceUnit}`}
                </div>

                <div className="tiles" style={{ marginTop: 18 }}>
                  <div className="accent-tile">
                    <b>{topics.length}</b>
                    <span>Topics extracted</span>
                  </div>
                  <div className="accent-tile">
                    <b>{selected.length}</b>
                    <span>Ticked to ask about</span>
                  </div>
                  <div className="accent-tile">
                    <b>{bankCount > 0 ? bankCount : '—'}</b>
                    <span>Questions banked</span>
                  </div>
                  <button type="button" className="accent-tile dashed" onClick={() => addRef.current?.focus()}>
                    + Add a topic
                  </button>
                </div>
              </div>
            )}

            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(238px, 1fr))' }}>
              <div
                className={`drop${over ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) takeFile(f);
                }}
              >
                <span className="ic"><Icon name="upload" size={22} /></span>
                <div>
                  <h3>Upload a lesson deck</h3>
                  <p className="hint" style={{ maxWidth: 300, margin: '6px 0 0' }}>
                    Drop a <span className="mono">.pptx</span> here, or browse.
                  </p>
                </div>

                {picked && (
                  <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                    <span className="flag neutral" title={picked.name}>
                      <Icon name="file" size={11} />
                      {shorten(picked.name)}
                    </span>
                    <span className="flag neutral">{fmtSize(picked.size)}</span>
                  </div>
                )}

                <input
                  ref={fileRef}
                  type="file"
                  accept=".pptx"
                  style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) takeFile(f); }}
                />
                <button type="button" className="btn pri" onClick={() => fileRef.current?.click()} disabled={busy !== ''}>
                  {busy === 'file' && <span className="spin" />}
                  {busy === 'file' ? 'Reading deck…' : 'Choose file'}
                </button>
              </div>

              <Card style={{ display: 'flex', flexDirection: 'column' }}>
                <h3>Paste syllabus text</h3>
                <p className="hint" style={{ margin: '6px 0 0' }}>
                  Unit outlines, a chapter summary, or the syllabus itself.
                </p>

                <label className="lab" htmlFor="mat-title" style={{ marginTop: 16 }}>Title</label>
                <input
                  id="mat-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Unit III — Transport Layer"
                />

                <label className="lab" htmlFor="mat-text" style={{ marginTop: 14 }}>Syllabus text</label>
                <textarea
                  id="mat-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={'Unit III — Transport Layer\nServices, UDP, TCP, connection establishment…'}
                  style={{ flex: 1 }}
                />

                <button type="button" className="btn" onClick={takeText} disabled={busy !== ''} style={{ marginTop: 14 }}>
                  {busy === 'text' && <span className="spin" />}
                  {busy === 'text' ? 'Reading text…' : 'Read this text'}
                </button>
              </Card>
            </div>
          </div>
        </div>

        <div className="stack" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Card>
            <div className="cardhead">
              <h3>Reuse a chapter</h3>
              {saved.length > 0 && <span className="sub">{saved.length} saved</span>}
              {busy === 'reuse' && <span className="spin" />}
            </div>

            {saved.length === 0 ? (
              <Empty icon="layers" title="Nothing banked yet">
                Every chapter you read stays here, so a second class on the same material costs
                nothing to set up.
              </Empty>
            ) : (
              <>
                <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
                  Load one without regenerating its questions.
                </p>
                <div className="topics">
                  {saved.slice(0, 8).map((c) => {
                    const current = c._id === content?.contentId;
                    return (
                      <button
                        key={c._id}
                        type="button"
                        className={`topic${current ? ' on' : ''}`}
                        aria-pressed={current}
                        title={current ? 'Loaded right now' : `Load ${c.title}`}
                        disabled={busy !== ''}
                        style={{ opacity: busy !== '' ? 0.6 : undefined }}
                        onClick={() => reuse(c._id)}
                      >
                        <span className="box" aria-hidden="true">{current ? '✓' : ''}</span>
                        <span className="nm">
                          {c.title}
                          <span className="hint" style={{ display: 'block', marginTop: 2 }}>
                            {c.topics?.length ?? 0} topics ·{' '}
                            {c.questionCount ? `${c.questionCount} questions` : 'no bank yet'}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
