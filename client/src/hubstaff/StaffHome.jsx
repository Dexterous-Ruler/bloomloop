/**
 * /hubs: the professor's classes (an HOD's: the department's), each with its
 * units and the chapters placed in them, and the way to the proposed links.
 *
 * GET /api/hub lists the classes with counts; each class's own view
 * (GET /api/hub/classes/:id) supplies its units and chapters. The proposed
 * links' count comes from GET /api/hub/links?state=proposed.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { useViewer } from '../shell/viewer.js';
import { Button, Empty, Icon, Panel } from '../ui/index.jsx';
import { Name, Problem, ReadOnly, STAFF_ONLY, Skeleton, StaffPage, plural, useLoad } from './StaffParts.jsx';

const classPath = (id, tab) => `/hubs/c/${encodeURIComponent(id)}${tab ? `?tab=${tab}` : ''}`;
const chapterPath = (id) => `/hubs/ch/${encodeURIComponent(id)}`;
const liveTopics = (ch) => (ch.topics ?? []).filter((x) => !x.retired).length;

export default function StaffHome() {
  const { account } = useViewer();
  const home = useLoad(() => staffHub.classes(), []);
  const [details, setDetails] = useState({});
  const [proposed, setProposed] = useState(undefined);

  const loadClass = useCallback((id) => {
    setDetails((d) => ({ ...d, [id]: { loading: true } }));
    staffHub.klass(id).then(
      (view) => setDetails((d) => ({ ...d, [id]: { view } })),
      (error) => setDetails((d) => ({ ...d, [id]: { error } })),
    );
  }, []);

  useEffect(() => {
    // GET /hub answers a student with their own hub: nothing more to read.
    if (!home.data || home.data.role === 'student') return undefined;
    let on = true;
    setDetails({});
    home.data.classes.forEach((c) => loadClass(c.id));
    staffHub.links({ state: 'proposed' }).then(
      (r) => { if (on) setProposed(r.counts?.proposed ?? r.links?.length ?? 0); },
      () => { if (on) setProposed(null); },
    );
    return () => { on = false; };
  }, [home.data, loadClass]);

  const role = home.data?.role ?? account?.role;
  return (
    <StaffHomeView
      role={role}
      data={home.data}
      error={home.error}
      loading={home.loading}
      onRetry={home.reload}
      details={details}
      proposed={proposed}
      onRetryClass={loadClass}
    />
  );
}

/**
 * The page, from data.
 *   data      GET /api/hub (staff): { role, classes: [{ id, courseName, section, termLabel, canEdit, units, chapters }] }
 *   details   { [classId]: { view } | { error } | { loading } }: each class's staff view
 *   proposed  the proposed links' count; undefined while it loads, null if it did not
 */
export function StaffHomeView({ role, data, error, loading, onRetry, details = {}, proposed, onRetryClass }) {
  const hod = role === 'hod';
  const title = hod ? 'Your department’s hubs' : 'Your classes’ hubs';
  const sub = 'The units, chapters and topics students see in the Learning Hub, class by class.';
  const actions = (
    <Link className="btn" to="/hubs/links">
      <Icon name="path" />
      Proposed links
      {typeof proposed === 'number' && <span className="hubs-count" aria-label={`${proposed} waiting`}>{proposed}</span>}
    </Link>
  );

  if (error) {
    return (
      <StaffPage trail={[{ label: 'Learning Hub' }]} title={title}>
        <Problem error={error} onRetry={onRetry} back={{ to: '/', label: 'Home' }} />
      </StaffPage>
    );
  }
  if (loading || !data) {
    return (
      <StaffPage trail={[{ label: 'Learning Hub' }]} title={title} sub={sub}>
        <Skeleton rows={5} label="Loading the classes" />
      </StaffPage>
    );
  }

  // GET /api/hub answers a student with their own hub, not a refusal; this page
  // says what the staff routes say to a student.
  if (data.role === 'student') {
    return (
      <StaffPage trail={[{ label: 'Learning Hub' }]} title={title}>
        <Problem error={STAFF_ONLY} />
      </StaffPage>
    );
  }

  const classes = data.classes ?? [];
  const readOnly = classes.length > 0 && classes.every((c) => !c.canEdit);
  const units = classes.reduce((n, c) => n + (c.units ?? 0), 0);
  const chapters = classes.reduce((n, c) => n + (c.chapters ?? 0), 0);

  return (
    <StaffPage trail={[{ label: 'Learning Hub' }]} title={title} sub={sub} actions={actions}>
      {readOnly && <ReadOnly>Read-only. Only the professor who owns a class can change its hub.</ReadOnly>}

      <Panel className="hubs-brief" aria-label="The hub across your classes">
        <div className="hubs-brief-say">
          <span className="tag-mint">Learning Hub</span>
          <p className="hubs-lead">
            {classes.length === 0
              ? 'No class yet.'
              : chapters === 0
                ? `${plural(classes.length, 'class', 'classes')}, and no chapter on any hub yet.`
                : `${plural(chapters, 'chapter')} placed across ${plural(classes.length, 'class', 'classes')}.`}
          </p>
          <p className="hubs-brief-sub">
            {hod
              ? 'Each class’s hub as its professor set it out: units in order, the chapters in each, and the topics students practise.'
              : 'A student sees a class’s hub once they report to you and the roster holds their roll number. Place chapters in units; only confirmed prerequisite links reach them.'}
          </p>
        </div>
        <div className="hubs-tiles">
          <div className="ptile">
            <span>Classes</span>
            <b>{classes.length}</b>
            <small>{hod ? 'in your department' : 'you own'}</small>
          </div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>Chapters placed</span>
            <b>{chapters}</b>
            <small>in {plural(units, 'unit')}</small>
          </div>
          <Link className="ptile hubs-ptile-link" to="/hubs/links" style={{ '--d': '1.2s' }}>
            <span>Proposed links</span>
            <b>{typeof proposed === 'number' ? proposed : '—'}</b>
            <small>{proposed === null ? 'did not load' : 'waiting for a decision'}<i><Icon name="forward" size={13} /></i></small>
          </Link>
        </div>
      </Panel>

      {classes.length === 0 ? (
        <div className="card">
          <Empty icon="classroom" title={hod ? 'No class in your department yet' : 'No class yet'}>
            {hod
              ? 'Once a professor in your department creates a class, its hub is listed here for you to read.'
              : 'Create a class and its roster under Classes; its hub then appears here for you to set out.'}
          </Empty>
          {!hod && <div className="hubs-empty-act"><Link className="btn btn-primary" to="/classes"><Icon name="classroom" />Go to Classes</Link></div>}
        </div>
      ) : (
        <ul className="hubs-classes" aria-label="Classes">
          {classes.map((c) => (
            <li key={c.id}>
              <ClassCard head={c} detail={details[c.id]} onRetry={() => onRetryClass?.(c.id)} />
            </li>
          ))}
        </ul>
      )}
    </StaffPage>
  );
}

/** One class: its head, then its units with their chapters. */
function ClassCard({ head, detail, onRetry }) {
  const view = detail?.view;
  const empty = (head.chapters ?? 0) === 0 && (head.units ?? 0) === 0;
  return (
    <article className="card hubs-class" aria-labelledby={`hubs-c-${head.id}`}>
      <header className="hubs-class-head">
        <div className="grow">
          <h2 id={`hubs-c-${head.id}`}><Link to={classPath(head.id)}>{head.courseName}</Link></h2>
          <p className="t-meta">{[head.section, head.termLabel].filter(Boolean).join(' · ')}</p>
        </div>
        <span className="hubs-class-n">{plural(head.units ?? 0, 'unit')} · {plural(head.chapters ?? 0, 'chapter')}</span>
      </header>

      <div className="hubs-class-body">
        {empty ? (
          <p className="hubs-quiet">
            Nothing placed yet. {head.canEdit ? 'Students on this class see an empty hub until you place a chapter.' : 'Students on this class see an empty hub for now.'}
          </p>
        ) : detail?.error ? (
          <div className="hubs-inline-fail" role="alert">
            <span className="grow">{detail.error.message}</span>
            <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>Try again</Button>
          </div>
        ) : !view ? (
          <div className="hubs-class-skel" role="status" aria-label={`Loading ${head.courseName}`}>
            <div className="skel" style={{ width: '45%', height: 12 }} />
            <div className="skel" style={{ width: '70%', height: 14 }} />
            <div className="skel" style={{ width: '60%', height: 14 }} />
          </div>
        ) : (
          <ol className="hubs-mini">
            {view.units.map((u) => (
              <MiniGroup key={u.id} name={<Name html={u.nameHtml} text={u.name} />} chapters={u.chapters} />
            ))}
            {view.otherChapters?.chapters?.length > 0 && (
              <MiniGroup other name={view.otherChapters.label} chapters={view.otherChapters.chapters} />
            )}
          </ol>
        )}
      </div>

      <footer className="hubs-class-foot">
        <Link className="link" to={classPath(head.id)}>Open the class<Icon name="forward" size={14} /></Link>
        {head.canEdit && empty && <Link className="btn btn-sm btn-primary" to={classPath(head.id, 'structure')}><Icon name="plus" />Place chapters</Link>}
      </footer>
    </article>
  );
}

function MiniGroup({ name, chapters, other }) {
  return (
    <li className="hubs-mini-group" data-other={other || undefined}>
      <span className="hubs-mini-unit">{name}</span>
      {chapters.length === 0 ? (
        <span className="hubs-quiet">No chapter in this unit yet.</span>
      ) : (
        <ul>
          {chapters.map((ch) => (
            <li key={ch.id}>
              <Link to={chapterPath(ch.id)}><Name html={ch.titleHtml} text={ch.title} /></Link>
              <span className="hubs-mini-n">{plural(liveTopics(ch), 'topic')}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
