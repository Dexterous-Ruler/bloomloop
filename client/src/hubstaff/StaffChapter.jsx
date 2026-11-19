/**
 * /hubs/ch/:contentId?tab=topics|explanations|hints|translations|languages:
 * one chapter's hub material. The frame loads the chapter's staff view for
 * its head and the topics tab; the review queues load their own.
 */

import { useParams } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import ChapterTopics from './ChapterTopics.jsx';
import Explanations from './Explanations.jsx';
import Hints from './Hints.jsx';
import Languages from './Languages.jsx';
import Translations from './Translations.jsx';
import { Name, Problem, ReadOnly, STAFF_ONLY, Skeleton, StaffPage, Tabs, useLoad, useTab } from './StaffParts.jsx';

const TABS = [
  { id: 'topics', label: 'Topics' },
  { id: 'explanations', label: 'Explanations' },
  { id: 'hints', label: 'Hints and feedback' },
  { id: 'translations', label: 'Translations' },
  { id: 'languages', label: 'By language' },
];
const TAB_IDS = TABS.map((t) => t.id);
const KIND = { pptx: 'Slides', syllabus: 'Pasted text' };

export default function StaffChapter() {
  const { contentId } = useParams();
  const [tab, setTab] = useTab(TAB_IDS);
  const load = useLoad(() => staffHub.chapter(contentId), [contentId]);
  return (
    <StaffChapterView
      contentId={contentId}
      chapter={load.data?.chapter}
      error={load.error}
      loading={load.loading && !load.data}
      onRetry={load.reload}
      onChapter={(chapter) => load.set({ chapter })}
      tab={tab}
      onTab={setTab}
    />
  );
}

/** The frame from data: `chapter` is the staff chapter view. */
export function StaffChapterView({ contentId, chapter, error, loading, onRetry, onChapter, tab, onTab, children }) {
  const trail = [{ label: 'Learning Hub', to: '/hubs' }, { label: chapter?.title || 'Chapter' }];
  if (error || (chapter && !('canEdit' in chapter))) {
    return (
      <StaffPage trail={trail} title="Chapter">
        <Problem error={error ?? STAFF_ONLY} onRetry={onRetry} />
      </StaffPage>
    );
  }
  if (loading || !chapter) {
    return (
      <StaffPage trail={trail} title="Chapter">
        <Skeleton rows={6} label="Loading the chapter" />
      </StaffPage>
    );
  }
  const live = (chapter.topics ?? []).filter((x) => !x.retired).length;
  return (
    <StaffPage
      trail={trail}
      title={<Name html={chapter.titleHtml} text={chapter.title} />}
      sub={`${KIND[chapter.kind] ?? 'Chapter'} · ${live} ${live === 1 ? 'topic' : 'topics'}`}
    >
      {!chapter.canEdit && <ReadOnly />}
      <Tabs tabs={TABS} value={tab} onChange={onTab} label="Parts of this chapter's hub">
        {children ?? (
          tab === 'explanations' ? <Explanations contentId={contentId} />
            : tab === 'hints' ? <Hints contentId={contentId} />
              : tab === 'translations' ? <Translations contentId={contentId} />
                : tab === 'languages' ? <Languages contentId={contentId} />
                  : <ChapterTopics contentId={contentId} chapter={chapter} onChapter={onChapter} />
        )}
      </Tabs>
    </StaffPage>
  );
}
