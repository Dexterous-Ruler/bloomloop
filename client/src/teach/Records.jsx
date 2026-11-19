/**
 * Teacher records: what a professor keeps in the room without devices.
 *
 *   Wheel          who answers next, drawn by the server; what they were asked
 *                  and how they responded
 *   Raised hands   a question asked aloud, hands counted per option
 *   Observations   four private marks and a note per student for the day
 *   Activities     the five no-device activities, and what came of each
 *
 * <Records code canControl info rows tab onTab />. `tab` is controlled by the
 * page, so an insight card can open the wheel. `info` is the room's row from
 * the room list ({ code, title, status, classId, contentId, questionIds,
 * settings }); `rows` the live grid, whose length is the signal to read the
 * wheel, the tally and the roster again (somebody joined).
 *
 * All of it is staff only: never on a phone or the projector, never added to
 * accuracy, never a level. Every read carries the server's privacy sentence and
 * each tool shows it. With canControl false (a head of department reading) every
 * control is gone and a line says why.
 */

import { useCallback, useMemo, useState } from 'react';

import { api } from '../lib/api.js';
import { Icon, Note, Segmented } from '../ui/index.jsx';
import Activities from './Activities.jsx';
import Observe from './Observe.jsx';
import Tally from './Tally.jsx';
import Wheel from './Wheel.jsx';

export const RECORD_TABS = [
  { id: 'wheel', label: 'Wheel' },
  { id: 'tally', label: 'Raised hands' },
  { id: 'observe', label: 'Observations' },
  { id: 'activities', label: 'Activities' },
];

/**
 * The questions a bank ask or a tally may name: the room's approved questions,
 * its set's when it has one. A room with a set lists them in its item report;
 * a room on the whole bank lists only answered ones there, so it reads the
 * chapter's bank. Read once, on first need.
 */
function useRoomQuestions(code, info) {
  const [state, setState] = useState({ status: 'idle', list: null, error: '' });
  const hasSet = Array.isArray(info?.questionIds);
  const contentId = info?.contentId;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      let list;
      if (!hasSet && contentId) {
        const bank = await api.getBank(contentId);
        list = (bank.questions ?? [])
          .filter((q) => (q.status ?? 'active') === 'active')
          .map((q) => ({ questionId: String(q._id ?? q.id), text: q.text, bloom: q.bloom, kind: q.kind }));
      } else {
        const report = await api.roomItems(code);
        list = (report.items ?? [])
          .filter((q) => q.status === 'active')
          .map((q) => ({ questionId: q.questionId, text: q.text, bloom: q.bloom, kind: q.kind }));
      }
      setState({ status: 'ready', list, error: '' });
    } catch (err) {
      setState({ status: 'error', list: null, error: err.message });
    }
  }, [code, hasSet, contentId]);

  return useMemo(() => ({ ...state, load }), [state, load]);
}

/** The tabs, the staff-only mark and, for a reader, the read-only line. */
export function RecordsLayout({ tab, onTab, canControl, children }) {
  return (
    <section className="rc" aria-label="Teacher records">
      <div className="rc-bar">
        <Segmented label="Teacher records" value={tab} onChange={(id) => onTab?.(id)} options={RECORD_TABS} />
        <span className="rc-staff"><Icon name="lock" size={13} />Staff only</span>
      </div>
      {!canControl && (
        <Note icon="eye" className="rc-readonly">
          Read only. You can see this room’s records; only the professor who runs it can change them.
        </Note>
      )}
      {children}
    </section>
  );
}

export default function Records({ code, canControl, info, rows, tab, onTab }) {
  const questions = useRoomQuestions(code, info);
  const current = RECORD_TABS.some((t) => t.id === tab) ? tab : 'wheel';
  const signal = Array.isArray(rows) ? rows.length : 0;
  const shared = { code, canControl: Boolean(canControl) };

  return (
    <RecordsLayout tab={current} onTab={onTab} canControl={Boolean(canControl)}>
      {current === 'wheel' && (
        <Wheel {...shared} closed={info?.status === 'closed'} classRoom={Boolean(info?.classId)} signal={signal} questions={questions} />
      )}
      {current === 'tally' && <Tally {...shared} signal={signal} questions={questions} />}
      {current === 'observe' && <Observe {...shared} signal={signal} />}
      {current === 'activities' && <Activities {...shared} onTab={onTab} />}
    </RecordsLayout>
  );
}
