/**
 * /hubs/c/:classId?tab=structure|progress|states: one class's hub for its
 * professor (an HOD reads). The frame loads the class's staff view for its
 * head and the structure tab; Progress and States load their own data.
 */

import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Button } from '../ui/index.jsx';
import ClassProgress from './ClassProgress.jsx';
import ClassStates from './ClassStates.jsx';
import ClassStructure from './ClassStructure.jsx';
import StaffPreview from './StaffPreview.jsx';
import { Problem, ReadOnly, STAFF_ONLY, Skeleton, StaffPage, Tabs, useLoad, useTab } from './StaffParts.jsx';

const TABS = [
  { id: 'structure', label: 'Structure' },
  { id: 'progress', label: 'Progress' },
  { id: 'states', label: 'Students by state' },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function StaffClass() {
  const { classId } = useParams();
  const [tab, setTab] = useTab(TAB_IDS);
  const load = useLoad(() => staffHub.klass(classId), [classId]);
  const [preview, setPreview] = useState(false);
  return (
    <>
      <StaffClassView
        classId={classId}
        hub={load.data}
        error={load.error}
        loading={load.loading && !load.data}
        onRetry={load.reload}
        onHub={load.set}
        tab={tab}
        onTab={setTab}
        onPreview={() => setPreview(true)}
      />
      <StaffPreview classId={classId} open={preview} onOpenChange={setPreview} />
    </>
  );
}

/** The frame from data: `hub` is the class's staff view. */
export function StaffClassView({ classId, hub, error, loading, onRetry, onHub, tab, onTab, onPreview, children }) {
  const cls = hub?.class;
  const name = cls ? [cls.courseName, cls.section].filter(Boolean).join(' · ') : 'Class';
  const trail = [{ label: 'Learning Hub', to: '/hubs' }, { label: name }];

  if (error || (cls && !('canEdit' in cls))) {
    return (
      <StaffPage trail={trail} title="Class">
        <Problem error={error ?? STAFF_ONLY} onRetry={onRetry} />
      </StaffPage>
    );
  }
  if (loading || !hub) {
    return (
      <StaffPage trail={trail} title="Class">
        <Skeleton rows={6} label="Loading the class" />
      </StaffPage>
    );
  }

  return (
    <StaffPage
      trail={trail}
      title={cls.courseName}
      sub={[cls.section, cls.termLabel].filter(Boolean).join(' · ') || undefined}
      actions={<Button icon="eye" onClick={onPreview}>Preview as a student</Button>}
    >
      {!cls.canEdit && <ReadOnly />}
      <Tabs tabs={TABS} value={tab} onChange={onTab} label="Parts of this class's hub">
        {children ?? (
          tab === 'progress' ? <ClassProgress classId={classId} />
            : tab === 'states' ? <ClassStates classId={classId} />
              : <ClassStructure classId={classId} hub={hub} onHub={onHub} />
        )}
      </Tabs>
    </StaffPage>
  );
}
