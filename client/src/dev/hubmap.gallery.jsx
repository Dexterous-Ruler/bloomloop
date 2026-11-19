/**
 * The Learning Hub's class page, a topic's prerequisites, reviews due and the
 * error log, drawn with replies in the server's shapes (hub/samples/map.js),
 * in every state: loaded, empty, loading, and each refusal (503 on a server
 * with no accounts, 401, 403, 404, a failure).
 */

import { useState } from 'react';

import '../styles/hub.css';
import '../styles/hub-map.css';
import { ClassMapView } from '../hub/ClassMap.jsx';
import { ErrorsView } from '../hub/Errors.jsx';
import HubPage from '../hub/HubPage.jsx';
import { PrereqsView } from '../hub/Prereqs.jsx';
import { ReviewView } from '../hub/Review.jsx';
import {
  CLASS_EMPTY_REPLY, CLASS_REPLY, ERRORS_EMPTY_REPLY, ERRORS_MIXED_REPLY, ERRORS_REPLY, NO_ACCOUNTS, NO_CLASS, PROGRESS_FRESH_REPLY,
  PROGRESS_NONE_REPLY, PROGRESS_REPLY, REVIEW_NONE_REPLY, REVIEW_REPLY, REVIEW_SOON_REPLY, SIGNED_OUT, STAFF_HERE, TOPIC_EARLIER_REPLY,
  TOPIC_LONG_REPLY, TOPIC_NONE_REPLY, TOPIC_REPLY, TOPIC_TRAVERSALS_REPLY,
} from '../hub/samples/map.js';

const retry = () => {};
const failed = Object.assign(new Error('The server did not answer.'), { status: 0 });

/** As Topic.jsx holds it: its own card and heading around <Prereqs />. */
function TopicFrame({ reply, states }) {
  return (
    <HubPage crumb="Learning Hub" title={reply.topic.name}>
      <section className="card card-pad" style={{ maxWidth: 800, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ font: '700 17px/1.3 var(--font)' }}>Before this topic</h2>
        <PrereqsView {...reply} states={states} />
      </section>
    </HubPage>
  );
}

/** The error log with its filters working on the sample, as the server would narrow it. */
function ErrorsDemo({ reply = ERRORS_MIXED_REPLY, start = 'open' }) {
  const [status, setStatus] = useState(start);
  const [topicId, setTopicId] = useState('');
  const entries = reply.entries.filter((e) => (status === 'all' || e.status === status) && (!topicId || e.topic?.id === topicId));
  const topics = [...new Map(reply.entries.map((e) => [e.topic.id, { id: e.topic.id, name: e.topic.name }])).values()];
  return (
    <ErrorsView
      data={{ ...reply, entries }}
      status={status}
      topicId={topicId}
      topics={topics}
      onFilter={(f) => { if (f.status !== undefined) setStatus(f.status); if (f.topicId !== undefined) setTopicId(f.topicId); }}
    />
  );
}

export default [
  {
    id: 'hubmap-class', title: 'A class, with your states', role: 'student',
    note: 'asha, live from the harness: GET /hub/classes/:id beside GET /hub/progress. Units (one with a formula in its name), chapters, topics and Other chapters, each with its mark, state, N, sentence and review; the review due leads the hero.',
    render: () => <ClassMapView klass={CLASS_REPLY} progress={PROGRESS_REPLY} />,
  },
  {
    id: 'hubmap-class-going', title: 'A class, nothing due', role: 'student',
    note: 'asha right after a harness restart: topics under way, the next one to continue.',
    render: () => <ClassMapView klass={CLASS_REPLY} progress={PROGRESS_FRESH_REPLY} />,
  },
  {
    id: 'hubmap-class-fresh', title: 'A class, nothing practised', role: 'student',
    note: 'cara: every topic not started; the hero says where to start.',
    render: () => <ClassMapView klass={CLASS_REPLY} progress={PROGRESS_NONE_REPLY} />,
  },
  {
    id: 'hubmap-class-nostates', title: 'A class, states did not load', role: 'student',
    note: 'The class read worked and the progress read failed: the layout stays, with the sentence and Try again.',
    render: () => <ClassMapView klass={CLASS_REPLY} statesError="The server did not answer." onRetry={retry} />,
  },
  {
    id: 'hubmap-class-empty', title: 'A class with nothing placed', role: 'student',
    note: 'The server’s `empty` sentence.',
    render: () => <ClassMapView klass={CLASS_EMPTY_REPLY} progress={PROGRESS_REPLY} />,
  },
  {
    id: 'hubmap-class-loading', title: 'A class, loading', role: 'student',
    render: () => <ClassMapView klass={null} busy />,
  },
  {
    id: 'hubmap-class-503', title: 'No accounts on this server (503)', role: 'student',
    note: 'What the memory server answers for every hub route: a calm page with the sentence.',
    render: () => <ClassMapView klass={null} error={NO_ACCOUNTS} />,
  },
  {
    id: 'hubmap-class-401', title: 'Signed out (401)', role: 'student',
    render: () => <ClassMapView klass={null} error={SIGNED_OUT} />,
  },
  {
    id: 'hubmap-class-403', title: 'A staff account here (403)', role: 'professor',
    render: () => <ClassMapView klass={null} error={STAFF_HERE} />,
  },
  {
    id: 'hubmap-class-404', title: 'Not found (404)', role: 'student',
    render: () => <ClassMapView klass={null} error={NO_CLASS} />,
  },
  {
    id: 'hubmap-class-failed', title: 'A class, did not load', role: 'student',
    render: () => <ClassMapView klass={null} error={failed} onRetry={retry} />,
  },
  {
    id: 'hubmap-prereqs', title: 'Prerequisites: a chain', role: 'student',
    note: 'asha on Recursion trees, inside a stand-in for the topic screen’s card: the chain from `via`, two at depth 2, Loops from earlier material, and the list nearest first.',
    render: () => <TopicFrame reply={TOPIC_REPLY} states={PROGRESS_REPLY.topics} />,
  },
  {
    id: 'hubmap-prereqs-long', title: 'Prerequisites: the longest chain', role: 'student',
    note: 'asha on Memoisation: six topics, five layers.',
    render: () => <TopicFrame reply={TOPIC_LONG_REPLY} states={PROGRESS_REPLY.topics} />,
  },
  {
    id: 'hubmap-prereqs-two', title: 'Prerequisites: two roots', role: 'student',
    note: 'asha on Traversals: two direct prerequisites from two units.',
    render: () => <TopicFrame reply={TOPIC_TRAVERSALS_REPLY} states={PROGRESS_REPLY.topics} />,
  },
  {
    id: 'hubmap-prereqs-earlier', title: 'Prerequisites: one, from earlier material', role: 'student',
    note: 'asha on Functions: Loops is on none of her classes (onYourClasses false): marked, not linked. One prerequisite: the list alone.',
    render: () => <TopicFrame reply={TOPIC_EARLIER_REPLY} states={PROGRESS_REPLY.topics} />,
  },
  {
    id: 'hubmap-prereqs-none', title: 'Prerequisites: none', role: 'student',
    note: 'asha on Binary trees: nothing comes first; what it leads to.',
    render: () => <TopicFrame reply={TOPIC_NONE_REPLY} states={PROGRESS_REPLY.topics} />,
  },
  {
    id: 'hubmap-prereqs-nostates', title: 'Prerequisites, states did not load', role: 'student',
    render: () => (
      <HubPage crumb="Learning Hub" title={TOPIC_REPLY.topic.name}>
        <section className="card card-pad" style={{ maxWidth: 800 }}><PrereqsView {...TOPIC_REPLY} statesError="The server did not answer." /></section>
      </HubPage>
    ),
  },
  {
    id: 'hubmap-review', title: 'Reviews due', role: 'student',
    note: 'asha, live: one due now, four coming up within minutes; a set of setSize; the rule.',
    render: () => <ReviewView data={REVIEW_REPLY} />,
  },
  {
    id: 'hubmap-review-soon', title: 'Reviews, coming up within minutes', role: 'student',
    note: 'asha just after a restart: nothing due yet, the next one named.',
    render: () => <ReviewView data={REVIEW_SOON_REPLY} />,
  },
  {
    id: 'hubmap-review-none', title: 'Reviews, nothing due', role: 'student',
    note: 'cara: the server’s `empty` sentence, nothing coming up.',
    render: () => <ReviewView data={REVIEW_NONE_REPLY} />,
  },
  {
    id: 'hubmap-review-loading', title: 'Reviews, loading', role: 'student',
    render: () => <ReviewView data={null} busy />,
  },
  {
    id: 'hubmap-review-503', title: 'Reviews, no accounts (503)', role: 'student',
    render: () => <ReviewView data={null} error={NO_ACCOUNTS} />,
  },
  {
    id: 'hubmap-errors', title: 'Error log', role: 'student',
    note: 'asha’s log plus two built entries (a held "From class" key, an order question in words); filters by status and topic.',
    render: () => <ErrorsDemo />,
  },
  {
    id: 'hubmap-errors-all', title: 'Error log, all entries', role: 'student',
    note: 'asha’s real log, every entry: mcq, numeric, multi and true or false, open and cleared.',
    render: () => <ErrorsDemo reply={ERRORS_REPLY} start="all" />,
  },
  {
    id: 'hubmap-errors-empty', title: 'Error log, empty', role: 'student',
    render: () => <ErrorsView data={ERRORS_EMPTY_REPLY} />,
  },
  {
    id: 'hubmap-errors-loading', title: 'Error log, loading', role: 'student',
    render: () => <ErrorsView data={null} busy />,
  },
  {
    id: 'hubmap-errors-503', title: 'Error log, no accounts (503)', role: 'student',
    render: () => <ErrorsView data={null} error={NO_ACCOUNTS} />,
  },
];
