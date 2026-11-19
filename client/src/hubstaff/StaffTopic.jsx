/**
 * /hubs/t/:topicId?tab=links|lessons: one topic for its professor (an HOD
 * reads). The frame loads the topic's staff view (its links in every state)
 * and its chapter's, which says whether this viewer may change it.
 */

import { useParams } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Chip } from '../ui/index.jsx';
import Lessons from './Lessons.jsx';
import TopicLinks from './TopicLinks.jsx';
import { Name, Problem, ReadOnly, STAFF_ONLY, Skeleton, StaffPage, Tabs, useLoad, useTab } from './StaffParts.jsx';

const TABS = [
  { id: 'links', label: 'Prerequisites' },
  { id: 'lessons', label: 'Lessons' },
];
const TAB_IDS = TABS.map((t) => t.id);

export default function StaffTopic() {
  const { topicId } = useParams();
  const [tab, setTab] = useTab(TAB_IDS);
  const load = useLoad(() => staffHub.topic(topicId), [topicId]);
  const chapterId = load.data?.topic?.chapter?.id;
  const chapter = useLoad(() => (chapterId ? staffHub.chapter(chapterId) : null), [chapterId]);
  return (
    <StaffTopicView
      topicId={topicId}
      view={load.data}
      error={load.error}
      loading={load.loading && !load.data}
      onRetry={load.reload}
      onReload={load.reload}
      canEdit={chapter.data?.chapter ? Boolean(chapter.data.chapter.canEdit) : null}
      tab={tab}
      onTab={setTab}
    />
  );
}

/** `canEdit`: true, false, or null while the chapter is still loading (controls stay hidden). */
export function StaffTopicView({ topicId, view, error, loading, onRetry, onReload, canEdit, tab, onTab, children }) {
  const topic = view?.topic;
  const ch = topic?.chapter;
  const trail = [
    { label: 'Learning Hub', to: '/hubs' },
    ...(ch ? [{ label: ch.title || 'Chapter', to: `/hubs/ch/${encodeURIComponent(ch.id)}` }] : []),
    { label: topic?.name || 'Topic' },
  ];
  if (error || (view && !view.links)) {
    return (
      <StaffPage trail={trail} title="Topic">
        <Problem error={error ?? STAFF_ONLY} onRetry={onRetry} />
      </StaffPage>
    );
  }
  if (loading || !view) {
    return (
      <StaffPage trail={trail} title="Topic">
        <Skeleton rows={4} label="Loading the topic" />
      </StaffPage>
    );
  }
  const retired = Boolean(topic.retiredAt || topic.retired);
  return (
    <StaffPage
      trail={trail}
      title={<Name html={topic.nameHtml} text={topic.name} />}
      sub={<>In <Name html={ch?.titleHtml} text={ch?.title} />{retired && <> · <Chip className="hubs-chip-sm">Retired</Chip></>}</>}
    >
      {canEdit === false && <ReadOnly />}
      <Tabs tabs={TABS} value={tab} onChange={onTab} label="Parts of this topic">
        {children ?? (
          tab === 'lessons'
            ? <Lessons topicId={topicId} />
            : <TopicLinks view={view} canEdit={Boolean(canEdit)} onReload={onReload} />
        )}
      </Tabs>
    </StaffPage>
  );
}
