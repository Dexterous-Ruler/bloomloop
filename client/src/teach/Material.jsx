/**
 * Step one: what are the questions written from.
 *
 * Before a chapter is loaded the screen is one input - a deck or a pasted
 * syllabus - beside the chapters already read. Once one is loaded, the chapter
 * IS the page: its title is the heading, its topics are the list, and the only
 * decision left is which of them to ask about.
 */

import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api.js';
import { Button, Dialog, Empty, Field, Fig, Icon, Note, Segmented, Tick, Tip } from '../ui/index.jsx';

const PER_TOPIC = 6;

const fmtSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

/** The one input: a lesson deck, or syllabus text. Used inline and in a dialog. */
function Source({ busy, onFile, onText }) {
  const [mode, setMode] = useState('deck');
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const fileRef = useRef(null);

  const take = (file) => { if (file) { setPicked({ name: file.name, size: file.size }); onFile(file); } };

  return (
    <div className="stack">
      <Segmented
        label="Source"
        value={mode}
        onChange={setMode}
        options={[{ id: 'deck', label: 'Lesson deck' }, { id: 'text', label: 'Syllabus text' }]}
      />

      {mode === 'deck' ? (
        <div
          className="drop"
          data-over={over ? 'true' : undefined}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files?.[0]); }}
        >
          <span className="drop-ic"><Icon name="deck" size={20} /></span>
          <div className="stack stack-1" style={{ alignItems: 'center' }}>
            <h3>{busy === 'file' ? 'Reading the deck' : 'Drop a .pptx here'}</h3>
            <p className="muted">
              {picked ? `${picked.name} · ${fmtSize(picked.size)}` : 'Slide titles and body text become topics. Image-only slides are read with OCR.'}
            </p>
          </div>
          <Button variant="primary" busy={busy === 'file'} icon="upload" onClick={() => fileRef.current?.click()}>
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
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); onText(title, text); }}>
          <Field label="Title" htmlFor="src-title">
            <input id="src-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Unit III, Transport layer" />
          </Field>
          <Field label="Syllabus text" htmlFor="src-text" hint="A unit outline, a chapter summary, or the syllabus itself. One topic per line reads best.">
            <textarea id="src-text" className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div><Button type="submit" variant="primary" busy={busy === 'text'} disabled={!text.trim()}>Read this text</Button></div>
        </form>
      )}
    </div>
  );
}

function Library({ saved, currentId, busy, onOpen }) {
  if (saved.length === 0) {
    return <p className="hint">Every chapter you read is kept here, so a second class on the same material costs nothing to set up.</p>;
  }
  return (
    <ul className="rows">
      {saved.map((c) => (
        <li key={c._id}>
          <button type="button" className="rw" aria-current={c._id === currentId ? 'true' : undefined} disabled={busy === 'reuse'} onClick={() => onOpen(c._id)}>
            <Icon name={c.kind === 'syllabus' ? 'material' : 'deck'} className="muted" />
            <span className="rw-main">
              <span className="strong clip" style={{ display: 'block' }}>{c.title}</span>
              <span className="t-meta">
                {c.topics?.length ?? 0} topics · {c.questionCount ? `${c.questionCount} questions` : 'no questions yet'}
              </span>
            </span>
            {c._id === currentId ? <Icon name="check" className="muted" /> : <Icon name="chevronRight" className="muted" />}
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Material({ content, selected, hasBank, onContent, onSelected, onNext }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(-1);
  const [draft, setDraft] = useState('');
  const [added, setAdded] = useState('');
  const [saved, setSaved] = useState([]);
  const [swap, setSwap] = useState(false);

  const topics = content?.topics ?? [];

  useEffect(() => {
    let alive = true;
    api.listContents().then((res) => { if (alive) setSaved(res.contents ?? []); }, () => {});
    return () => { alive = false; };
  }, [content?.contentId]);

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
        <div className="page-head">
          <div>
            <h1>What are you teaching?</h1>
            <p className="t-lead lead">
              Give BloomLoop a lesson deck or a syllabus. Questions are written only from what is in it.
            </p>
          </div>
        </div>
        {error && <Note tone="bad" style={{ marginBottom: 16 }}>{error}</Note>}
        <div className="split">
          <div className="card card-pad">
            <Source busy={busy} onFile={takeFile} onText={takeText} />
          </div>
          <aside className="stack stack-3">
            <h4>Chapters already read</h4>
            <Library saved={saved} busy={busy} onOpen={reuse} />
          </aside>
        </div>
      </>
    );
  }

  /* ----------------------------------------------------- a chapter open */
  const sourceLine = [
    content.kind === 'syllabus' ? 'Pasted syllabus' : content.kind === 'pptx' ? 'Lesson deck' : null,
    typeof content.slideCount === 'number' ? `${content.slideCount} slides` : null,
    typeof content.chars === 'number' ? `${content.chars.toLocaleString()} characters` : null,
  ].filter(Boolean).join(' · ');
  const allOn = topics.length > 0 && selected.length === topics.length;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <div className="eyebrow">{sourceLine || 'Chapter'}</div>
          <h1 className="wrap-any">{content.title}</h1>
        </div>
        <div className="acts">
          <Button icon="refresh" onClick={() => setSwap(true)}>Read something else</Button>
        </div>
      </div>

      {error && <Note tone="bad" style={{ marginBottom: 16 }}>{error}</Note>}

      <div className="split">
        <section className="card">
          <div className="card-head">
            <h3>Topics</h3>
            <span className="t-meta">{selected.length} of {topics.length} ticked</span>
            {topics.length > 1 && (
              <Button variant="ghost" size="sm" onClick={() => onSelected(allOn ? [] : topics)}>
                {allOn ? 'Untick all' : 'Tick all'}
              </Button>
            )}
          </div>

          {topics.length === 0 ? (
            <Empty icon="checklist" title="No topics were found">
              Nothing usable came out of that source. Add the topics below and questions will be written about those.
            </Empty>
          ) : (
            <ul className="rows" style={{ padding: 8 }}>
              {topics.map((topic, idx) => {
                const on = selected.includes(topic);
                if (editing === idx) {
                  return (
                    <li key={`edit-${topic}`} className="rw">
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
                  <li key={topic} className="rw is-click topic" data-on={on ? 'true' : 'false'}>
                    <button
                      type="button"
                      className="topic-main"
                      aria-pressed={on}
                      onClick={() => onSelected(on ? selected.filter((t) => t !== topic) : [...selected, topic])}
                    >
                      <Tick on={on} />
                      <span className="grow wrap-any">{topic}</span>
                    </button>
                    <span className="rw-acts">
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
          )}

          <form className="card-foot" onSubmit={(e) => { e.preventDefault(); addTopic(); }}>
            <input
              className="input input-sm grow"
              value={added}
              onChange={(e) => setAdded(e.target.value)}
              placeholder="Add a topic the reader missed"
              aria-label="Add a topic"
            />
            <Button type="submit" size="sm" icon="plus" disabled={!added.trim() || saving}>Add</Button>
          </form>
        </section>

        <aside className="stack sticky">
          <div className="card card-pad stack">
            <div className="figs">
              <Fig value={selected.length} label={selected.length === 1 ? 'topic to ask about' : 'topics to ask about'} />
              <Fig value={selected.length * PER_TOPIC} label="questions, about" />
            </div>
            <p className="hint">
              Questions are spread across all six levels for each ticked topic. You set the exact number and the mix on the next step.
            </p>
            <Button variant="primary" size="lg" block disabled={selected.length === 0} onClick={onNext}>
              {hasBank ? 'Open the questions' : 'Plan the questions'}
              <Icon name="forward" />
            </Button>
          </div>

          <div className="stack stack-3">
            <h4>Chapters already read</h4>
            <Library saved={saved} currentId={content.contentId} busy={busy} onOpen={reuse} />
          </div>
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
