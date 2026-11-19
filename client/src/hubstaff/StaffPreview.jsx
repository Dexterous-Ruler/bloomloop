/**
 * "Preview as a student": the class's hub exactly as a student on it is sent
 * it (GET /api/hub/classes/:id?view=student), in a side sheet. Units,
 * chapters and topics only: no question, slide, draft or count.
 */

import { useEffect, useState } from 'react';

import { staffHub } from '../hub/hubApi.js';
import { Button, Dialog, Note } from '../ui/index.jsx';
import { Name, plural } from './StaffParts.jsx';

export default function StaffPreview({ classId, open, onOpenChange }) {
  const [state, setState] = useState({ data: null, error: null });
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (!open) return undefined;
    let on = true;
    setState({ data: null, error: null });
    staffHub.klass(classId, { view: 'student' }).then(
      (data) => { if (on) setState({ data, error: null }); },
      (error) => { if (on) setState({ data: null, error }); },
    );
    return () => { on = false; };
  }, [open, classId, turn]);

  return (
    <Dialog sheet open={open} onOpenChange={onOpenChange} title="Preview as a student" description="What a student on this class sees in the hub.">
      <PreviewView data={state.data} error={state.error} onRetry={() => setTurn((n) => n + 1)} />
    </Dialog>
  );
}

/** The student shape, drawn plainly. */
export function PreviewView({ data, error, onRetry }) {
  if (error) {
    return (
      <div className="hubs-inline-fail" role="alert">
        <span className="grow">{error.message}</span>
        {onRetry && <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>Try again</Button>}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="hubs-class-skel" role="status" aria-label="Loading the preview">
        <div className="skel" style={{ width: '50%', height: 14 }} />
        <div className="skel" style={{ width: '80%', height: 14 }} />
        <div className="skel" style={{ width: '70%', height: 14 }} />
      </div>
    );
  }
  const groups = [
    ...data.units.map((u) => ({ id: u.id, name: <Name html={u.nameHtml} text={u.name} />, chapters: u.chapters })),
    ...(data.otherChapters?.chapters?.length ? [{ id: 'other', name: data.otherChapters.label, chapters: data.otherChapters.chapters }] : []),
  ];
  return (
    <div className="hubs-preview">
      {data.preview && <Note icon="eye">{data.preview}</Note>}
      <div className="hubs-preview-class">
        <b>{data.class?.courseName}</b>
        <span className="t-meta">{[data.class?.section, data.class?.termLabel].filter(Boolean).join(' · ')}</span>
      </div>
      {data.empty && <p className="hubs-quiet">{data.empty}</p>}
      {groups.map((g) => (
        <section key={g.id} className="hubs-preview-unit" aria-label={typeof g.name === 'string' ? g.name : undefined}>
          <h3>{g.name}</h3>
          {g.chapters.length === 0 ? (
            <p className="hubs-quiet">No chapters here.</p>
          ) : g.chapters.map((ch) => (
            <div key={ch.id} className="hubs-preview-ch">
              <span className="hubs-preview-ch-title"><Name html={ch.titleHtml} text={ch.title} /></span>
              <span className="t-meta">{plural(ch.topics.length, 'topic')}</span>
              <ul>
                {ch.topics.map((tp) => <li key={tp.id}><Name html={tp.nameHtml} text={tp.name} /></li>)}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
