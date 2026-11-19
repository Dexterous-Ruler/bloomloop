/**
 * A class's structure tab: its units in the order students see them, the
 * chapters placed in each, "Other chapters", and the owner's chapters not on
 * the class yet.
 *
 * Every write replies with the fresh staff view (`hub`); the screen redraws
 * from that one reply (onHub). Units reorder by drag (the grip) or by keyboard
 * (focus the grip, then the up and down arrow keys); chapters move through
 * their menu. When `hub.class.canEdit` is false (an HOD) every control is gone.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Button, Chip, Icon, Menu, Panel } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { Confirm, Name, Refusal, plural } from './StaffParts.jsx';

const chapterPath = (id) => `/hubs/ch/${encodeURIComponent(id)}`;
const liveTopics = (ch) => (ch.topics ?? []).filter((x) => !x.retired);
const approved = (ch) => (ch.topics ?? []).reduce((n, x) => n + (x.retired ? 0 : x.questions?.active ?? 0), 0);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const KIND = { pptx: { label: 'Slides', icon: 'deck' }, syllabus: { label: 'Pasted text', icon: 'type' } };

export default function ClassStructure({ classId, hub, onHub, api = staffHub }) {
  const canEdit = Boolean(hub?.class?.canEdit);
  const [busy, setBusy] = useState(null);
  const [fault, setFault] = useState(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [asking, setAsking] = useState(null);
  const [order, setOrder] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [said, setSaid] = useState('');
  const inFlight = useRef(0);
  const rows = useRef({});
  const grips = useRef({});
  const drag = useRef(null);
  const howTo = useId();

  const units = hub?.units ?? [];
  const unitIds = units.map((u) => u.id);
  const byId = new Map(units.map((u) => [u.id, u]));
  const shown = (order ?? unitIds).map((id) => byId.get(id)).filter(Boolean);
  const other = hub?.otherChapters ?? { label: 'Other chapters', chapters: [] };
  const available = hub?.available ?? [];
  const placedCount = units.reduce((n, u) => n + u.chapters.length, 0) + other.chapters.length;
  const topicCount = [...units.flatMap((u) => u.chapters), ...other.chapters].reduce((n, ch) => n + liveTopics(ch).length, 0);

  /** One write at a time; its refusal shows where it was asked (`at`). */
  const write = async (at, call, after) => {
    setBusy(at);
    setFault(null);
    try {
      const reply = await call();
      if (reply?.hub) onHub(reply.hub);
      after?.(reply);
      return reply;
    } catch (error) {
      setFault({ at, error });
      return null;
    } finally {
      setBusy(null);
    }
  };

  /* -------------------------------------------------------- unit order -- */

  const sendOrder = async (next, movedId) => {
    if (sameList(next, unitIds) && inFlight.current === 0) { setOrder(null); return; }
    setOrder(next);
    setFault(null);
    const u = byId.get(movedId);
    if (u) setSaid(`"${u.name}" is now unit ${next.indexOf(movedId) + 1} of ${next.length}.`);
    inFlight.current += 1;
    try {
      const reply = await api.orderUnits(classId, next);
      if (reply?.hub) onHub(reply.hub);
    } catch (error) {
      setFault({ at: 'order', error });
      setSaid('The new order was not saved.');
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) setOrder(null);
    }
  };

  const move = (id, delta) => {
    const now = order ?? unitIds;
    const i = now.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= now.length) return;
    const next = [...now];
    next.splice(i, 1);
    next.splice(j, 0, id);
    sendOrder(next, id);
  };

  // A unit moved by keyboard keeps the keyboard on its grip, however the list redraws.
  const keyMoved = useRef(null);
  useEffect(() => {
    const el = keyMoved.current && grips.current[keyMoved.current];
    if (el && document.activeElement !== el) el.focus();
  }, [order, hub]);

  const onGripKey = (e, id) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      keyMoved.current = id;
      move(id, e.key === 'ArrowUp' ? -1 : 1);
    }
  };

  // Drag: the row follows the pointer through the list, and the order is sent
  // on release. The pointer is followed on the window, because redrawing the
  // list moves the row (and its grip) in the page, which ends any capture.
  const onGripDown = (e, id) => {
    if (e.button !== 0 || drag.current) return;
    e.preventDefault();
    keyMoved.current = null;
    const before = unitIds;
    drag.current = order ?? unitIds;
    setOrder(drag.current);
    setDragging(id);
    const follow = (ev) => {
      const now = drag.current;
      if (!now) return;
      const others = now.filter((x) => x !== id);
      let at = 0;
      for (const x of others) {
        const r = rows.current[x]?.getBoundingClientRect();
        if (r && ev.clientY > r.top + r.height / 2) at += 1;
      }
      const next = [...others];
      next.splice(at, 0, id);
      if (!sameList(next, now)) { drag.current = next; setOrder(next); }
    };
    const end = (ev) => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      const next = drag.current;
      drag.current = null;
      setDragging(null);
      if (ev.type === 'pointercancel' || !next || sameList(next, before)) {
        if (inFlight.current === 0) setOrder(null);
        return;
      }
      sendOrder(next, id);
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  /* ------------------------------------------------------------- writes -- */

  const addUnit = (e) => {
    e.preventDefault();
    write('add', () => api.addUnit(classId, newName), () => setNewName(''));
  };
  const rename = (e) => {
    e.preventDefault();
    const { id, draft } = renaming;
    write(`rename:${id}`, () => api.renameUnit(classId, id, draft), () => setRenaming(null));
  };
  const place = (contentId, unitId, position) => {
    const where = unitId ? byId.get(unitId)?.name : other.label;
    return write(`ch:${contentId}`, () => api.placeChapter(classId, contentId, position ? { unitId, position } : { unitId }), (r) => {
      // Only a first placement says more than the redraw does.
      if (!r?.topics) return;
      const made = r.topics.added?.length ?? 0;
      toast(`Placed under "${where}".${made ? ` ${plural(made, 'topic record')} made.` : ''}`);
    });
  };
  const confirmYes = async () => {
    const a = asking;
    const reply = await write(a.kind === 'unit' ? `del:${a.id}` : `off:${a.id}`, () => (a.kind === 'unit'
      ? api.removeUnit(classId, a.id)
      : api.removeChapter(classId, a.id)));
    if (reply) {
      setAsking(null);
      if (reply.message) toast(reply.message);
    }
  };

  const faultAt = (at) => (fault?.at === at ? fault.error : null);
  const clear = () => setFault(null);

  if (!hub) return null;

  return (
    <div className="hubs-structure">
      <Panel className="hubs-brief" aria-label="This class's hub">
        <div className="hubs-brief-say">
          <span className="tag-mint">Structure</span>
          <p className="hubs-lead">
            {placedCount === 0
              ? 'Nothing is on this class’s hub yet.'
              : `${plural(placedCount, 'chapter')} and ${plural(topicCount, 'topic')} on this class’s hub.`}
          </p>
          <p className="hubs-brief-sub">{hub.notes?.students}</p>
        </div>
        <div className="hubs-tiles">
          <div className="ptile">
            <span>Units</span>
            <b>{units.length}</b>
            <small>in the order students see</small>
          </div>
          <div className="ptile" style={{ '--d': '0.6s' }}>
            <span>Chapters</span>
            <b>{placedCount}</b>
            <small>{placedCount === 0 ? 'none placed yet' : other.chapters.length ? `${other.chapters.length} under “${other.label}”` : 'every one in a unit'}</small>
          </div>
          <div className="ptile" style={{ '--d': '1.2s' }}>
            <span>Topics</span>
            <b>{topicCount}</b>
            <small>{canEdit ? `${plural(available.length, 'chapter')} not placed` : 'students can practise'}</small>
          </div>
        </div>
      </Panel>

      <section className="card hubs-units" aria-labelledby="hubs-units-h">
        <div className="hubs-card-head">
          <div className="sec">
            <h2 id="hubs-units-h">Units</h2>
            <p>
              {canEdit
                ? 'Students see the units in this order. Drag a unit by its grip, or focus the grip and use the up and down arrow keys.'
                : 'Students see the units in this order.'}
            </p>
          </div>
        </div>
        {canEdit && shown.length > 1 && <span id={howTo} className="sr-only">Press the up or down arrow key to move this unit.</span>}
        <p className="sr-only" role="status" aria-live="polite">{said}</p>
        <Refusal error={faultAt('order')} onDismiss={clear} />

        {shown.length === 0 && (
          <p className="hubs-quiet hubs-pad">
            {canEdit ? 'No units yet. Add the first below; chapters in no unit stay under “Other chapters”.' : 'No units on this class.'}
          </p>
        )}

        <ol className="hubs-unit-list">
          {shown.map((u, i) => (
            <li
              key={u.id}
              ref={(el) => { rows.current[u.id] = el; }}
              className="hubs-unit"
              data-dragging={dragging === u.id || undefined}
            >
              <div className="hubs-unit-head">
                {canEdit && (
                  <button
                    type="button"
                    className="hubs-grip"
                    ref={(el) => { grips.current[u.id] = el; }}
                    aria-label={`Move "${u.name}", unit ${i + 1} of ${shown.length}`}
                    aria-describedby={shown.length > 1 ? howTo : undefined}
                    onKeyDown={(e) => onGripKey(e, u.id)}
                    onPointerDown={(e) => onGripDown(e, u.id)}
                    onBlur={(e) => { if (e.relatedTarget && keyMoved.current === u.id) keyMoved.current = null; }}
                  >
                    <Icon name="grip" size={16} />
                  </button>
                )}
                <span className="hubs-unit-n" aria-hidden="true">{i + 1}</span>
                {renaming?.id === u.id ? (
                  <form className="hubs-rename" onSubmit={rename}>
                    <label className="sr-only" htmlFor={`hubs-rn-${u.id}`}>New name for {u.name}</label>
                    <input
                      id={`hubs-rn-${u.id}`}
                      className="input input-sm"
                      value={renaming.draft}
                      maxLength={80}
                      autoFocus
                      onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); clear(); } }}
                    />
                    <Button size="sm" variant="primary" type="submit" busy={busy === `rename:${u.id}`}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRenaming(null); clear(); }}>Cancel</Button>
                  </form>
                ) : (
                  <h3 className="hubs-unit-name"><Name html={u.nameHtml} text={u.name} /></h3>
                )}
                <span className="hubs-unit-count">{plural(u.chapters.length, 'chapter')}</span>
                {canEdit && renaming?.id !== u.id && (
                  <Menu
                    trigger={<Button size="sm" variant="ghost" icon="more" aria-label={`Unit actions: ${u.name}`} disabled={Boolean(busy)} />}
                    items={[
                      { id: 'rename', label: 'Rename', icon: 'edit', onSelect: () => { clear(); setRenaming({ id: u.id, draft: u.name }); } },
                      { id: 'up', label: 'Move up', icon: 'up', disabled: i === 0, onSelect: () => move(u.id, -1) },
                      { id: 'down', label: 'Move down', icon: 'down', disabled: i === shown.length - 1, onSelect: () => move(u.id, 1) },
                      'sep',
                      { id: 'del', label: 'Remove the unit', icon: 'trash', danger: true, onSelect: () => { clear(); setAsking({ kind: 'unit', id: u.id, name: u.name, count: u.chapters.length }); } },
                    ]}
                  />
                )}
              </div>
              <Refusal error={faultAt(`rename:${u.id}`)} onDismiss={clear} />
              <ChapterRows
                chapters={u.chapters}
                unitId={u.id}
                units={units}
                other={other}
                canEdit={canEdit}
                busy={busy}
                faultAt={faultAt}
                clear={clear}
                onPlace={place}
                onTakeOff={(ch) => { clear(); setAsking({ kind: 'chapter', id: ch.id, name: ch.title }); }}
                empty="No chapter in this unit yet."
              />
            </li>
          ))}
        </ol>

        <div className="hubs-unit hubs-unit-other">
          <div className="hubs-unit-head">
            <h3 className="hubs-unit-name">{other.label}</h3>
            <span className="hubs-unit-count">{plural(other.chapters.length, 'chapter')}</span>
          </div>
          <p className="hubs-quiet hubs-other-note">{hub.notes?.otherChapters}</p>
          <ChapterRows
            chapters={other.chapters}
            unitId={null}
            units={units}
            other={other}
            canEdit={canEdit}
            busy={busy}
            faultAt={faultAt}
            clear={clear}
            onPlace={place}
            onTakeOff={(ch) => { clear(); setAsking({ kind: 'chapter', id: ch.id, name: ch.title }); }}
            empty={null}
          />
        </div>

        {canEdit && (
          <form className="hubs-add" onSubmit={addUnit}>
            <label className="label" htmlFor="hubs-add-unit">Add a unit</label>
            <div className="hubs-add-row">
              <input
                id="hubs-add-unit"
                className="input"
                placeholder={`Unit ${units.length + 1}: …`}
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Button type="submit" variant="primary" icon="plus" busy={busy === 'add'}>Add unit</Button>
            </div>
            <Refusal error={faultAt('add')} onDismiss={clear} />
          </form>
        )}
      </section>

      {canEdit && (
        <section className="card hubs-available" aria-labelledby="hubs-avail-h">
          <div className="hubs-card-head">
            <div className="sec">
              <h2 id="hubs-avail-h">Your chapters not on this class</h2>
              <p>Nothing reaches a student until it is placed. A chapter placed for the first time gets its topic records.</p>
            </div>
          </div>
          {available.length === 0 ? (
            <p className="hubs-quiet hubs-pad">Every chapter of yours is on this class.</p>
          ) : (
            <ul className="hubs-ch-list">
              {available.map((ch) => (
                <li key={ch.id} className="hubs-ch">
                  <div className="hubs-ch-row">
                    <KindMark kind={ch.kind} />
                    <span className="hubs-ch-title"><Name html={ch.titleHtml} text={ch.title} /></span>
                    <Menu
                      trigger={<Button size="sm" icon="plus" busy={busy === `ch:${ch.id}`} disabled={Boolean(busy)}>Place</Button>}
                      items={[
                        { heading: 'Place under' },
                        ...units.map((u) => ({ id: u.id, label: <Name html={u.nameHtml} text={u.name} />, onSelect: () => place(ch.id, u.id) })),
                        { id: 'other', label: other.label, onSelect: () => place(ch.id, null) },
                      ]}
                    />
                  </div>
                  <Refusal error={faultAt(`ch:${ch.id}`)} onDismiss={clear} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Confirm
        open={Boolean(asking)}
        title={asking?.kind === 'unit' ? `Remove the unit "${asking?.name}"?` : `Take "${asking?.name}" off this class?`}
        yes={asking?.kind === 'unit' ? 'Remove the unit' : 'Take it off'}
        danger
        busy={Boolean(busy) && (busy === `del:${asking?.id}` || busy === `off:${asking?.id}`)}
        error={asking ? faultAt(asking.kind === 'unit' ? `del:${asking.id}` : `off:${asking.id}`) : null}
        onYes={confirmYes}
        onNo={() => { setAsking(null); clear(); }}
      >
        <p>
          {asking?.kind === 'unit'
            ? (asking.count
              ? `Its ${asking.count === 1 ? 'chapter moves' : `${asking.count} chapters move`} to “${other.label}”. Nothing else changes.`
              : 'It holds no chapters. Nothing else changes.')
            : 'Students on this class stop seeing it in the hub. The chapter itself, its questions and its topics stay as they are, and you can place it again.'}
        </p>
      </Confirm>
    </div>
  );
}

function KindMark({ kind }) {
  const k = KIND[kind] ?? { label: kind || 'Chapter', icon: 'book' };
  return <span className="hubs-kind" title={k.label}><Icon name={k.icon} size={14} /><span className="sr-only">{k.label}</span></span>;
}

/** The chapters of one unit (or of "Other chapters"), each with its menu. */
function ChapterRows({ chapters, unitId, units, other, canEdit, busy, faultAt, clear, onPlace, onTakeOff, empty }) {
  if (!chapters.length) return empty ? <p className="hubs-quiet hubs-ch-empty">{empty}</p> : null;
  return (
    <ul className="hubs-ch-list">
      {chapters.map((ch, i) => {
        const live = liveTopics(ch).length;
        const pos = ch.position ?? i + 1;
        const elsewhere = [
          ...units.filter((u) => u.id !== unitId).map((u) => ({ id: u.id, label: <Name html={u.nameHtml} text={u.name} />, onSelect: () => onPlace(ch.id, u.id) })),
          ...(unitId ? [{ id: 'other', label: other.label, onSelect: () => onPlace(ch.id, null) }] : []),
        ];
        return (
          <li key={ch.id} className="hubs-ch">
            <div className="hubs-ch-row">
              <KindMark kind={ch.kind} />
              <Link className="hubs-ch-title" to={chapterPath(ch.id)}><Name html={ch.titleHtml} text={ch.title} /></Link>
              <span className="hubs-ch-meta">
                {plural(live, 'topic')}
                <span aria-hidden="true"> · </span>
                {plural(approved(ch), 'approved question')}
              </span>
              {ch.unsynced?.length > 0 && (
                <Chip tone="warn" className="hubs-chip-sm">{plural(ch.unsynced.length, 'topic')} without a record</Chip>
              )}
              {canEdit && (
                <Menu
                  trigger={<Button size="sm" variant="ghost" icon="more" aria-label={`Chapter actions: ${ch.title}`} busy={busy === `ch:${ch.id}`} disabled={Boolean(busy)} />}
                  items={[
                    { id: 'up', label: 'Move up', icon: 'up', disabled: i === 0, onSelect: () => onPlace(ch.id, unitId, pos - 1) },
                    { id: 'down', label: 'Move down', icon: 'down', disabled: i === chapters.length - 1, onSelect: () => onPlace(ch.id, unitId, pos + 1) },
                    ...(elsewhere.length ? ['sep', { heading: 'Move to' }, ...elsewhere] : []),
                    'sep',
                    { id: 'off', label: 'Take off this class', icon: 'trash', danger: true, onSelect: () => onTakeOff(ch) },
                  ]}
                />
              )}
            </div>
            <Refusal error={faultAt(`ch:${ch.id}`)} onDismiss={clear} />
          </li>
        );
      })}
    </ul>
  );
}
