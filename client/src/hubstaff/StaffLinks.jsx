/**
 * One prerequisite link as staff see it, in any state, with the professor's
 * three decisions: confirm, reject, remove (PATCH and DELETE
 * /api/hub/links/:id). A refusal (a 409 names the loop) stays on its row,
 * word for word. Used by a topic's links tab and by the proposals queue.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { staffHub } from '../hub/hubApi.js';
import { Button, Chip, Icon } from '../ui/index.jsx';
import { toast } from '../ui/toast.jsx';
import { Name, Refusal } from './StaffParts.jsx';

const topicPath = (id) => `/hubs/t/${encodeURIComponent(id)}`;
const TONE = { proposed: 'warn', confirmed: 'ok', rejected: 'line' };
const MARK = { proposed: 'idea', confirmed: 'check', rejected: 'close' };
const ORDER = { proposed: 0, confirmed: 1, rejected: 2 };

/** Proposed first (they wait for a decision), then confirmed, then rejected. */
export const byDecision = (a, b) => (ORDER[a.state] ?? 3) - (ORDER[b.state] ?? 3);

/** Busy and refused, per link; `onChanged(link, action, reply)` after each write. */
export function useLinkActions(onChanged, api = staffHub) {
  const [busy, setBusy] = useState(null);
  const [errors, setErrors] = useState({});
  const act = async (link, action) => {
    setBusy(`${link.id}:${action}`);
    setErrors((e) => ({ ...e, [link.id]: null }));
    try {
      const reply = action === 'remove' ? await api.removeLink(link.id) : await api.setLink(link.id, action);
      if (action === 'remove' && reply?.message) toast(reply.message);
      onChanged?.(link, action, reply);
    } catch (error) {
      setErrors((e) => ({ ...e, [link.id]: error }));
    } finally {
      setBusy(null);
    }
  };
  const dismiss = (id) => setErrors((e) => ({ ...e, [id]: null }));
  return { busy, errors, act, dismiss };
}

function TopicName({ topic, hereChapterId }) {
  return (
    <span className="hubs-link-topic">
      <Link to={topicPath(topic.id)}><Name html={topic.nameHtml} text={topic.name} /></Link>
      {topic.retired && <Chip className="hubs-chip-sm">Retired</Chip>}
      {topic.chapter && topic.chapter.id !== hereChapterId && (
        <span className="hubs-link-ch">in <Name html={topic.chapter.titleHtml} text={topic.chapter.title} /></span>
      )}
    </span>
  );
}

/**
 * `show`: 'prerequisite' (the topic needed first), 'topic' (the one that
 * needs it) or 'pair' (both, the first one first).
 */
export function LinkRow({ link, show = 'pair', hereChapterId, canEdit, actions }) {
  const busy = actions?.busy;
  const error = actions?.errors?.[link.id];
  const on = (a) => busy === `${link.id}:${a}`;
  const any = typeof busy === 'string' && busy.startsWith(`${link.id}:`);
  return (
    <li className="hubs-link" data-state={link.state}>
      <span className="hubs-link-mark" data-state={link.state} aria-hidden="true"><Icon name={MARK[link.state] ?? 'dot'} size={13} /></span>
      <div className="hubs-link-main">
        <div className="hubs-link-pair">
          {show === 'topic' ? (
            <TopicName topic={link.topic} hereChapterId={hereChapterId} />
          ) : show === 'prerequisite' ? (
            <TopicName topic={link.prerequisite} hereChapterId={hereChapterId} />
          ) : (
            <>
              <TopicName topic={link.prerequisite} hereChapterId={hereChapterId} />
              <span className="hubs-link-arrow"><Icon name="forward" size={13} /><span className="sr-only"> is needed before </span></span>
              <TopicName topic={link.topic} hereChapterId={hereChapterId} />
            </>
          )}
        </div>
        <div className="hubs-link-meta">
          <Chip tone={TONE[link.state]} className="hubs-chip-sm">{link.label}</Chip>
        </div>
        {link.reasonHtml && <Name className="hubs-link-why" html={link.reasonHtml} text={link.reason} />}
        <Refusal error={error} onDismiss={() => actions?.dismiss(link.id)} />
      </div>
      {canEdit && actions && (
        <div className="hubs-link-acts">
          {link.state !== 'confirmed' && (
            <Button size="sm" variant={link.state === 'proposed' ? 'primary' : undefined} icon="check" busy={on('confirmed')} disabled={any} onClick={() => actions.act(link, 'confirmed')}>
              Confirm
            </Button>
          )}
          {link.state !== 'rejected' && (
            <Button size="sm" variant="ghost" busy={on('rejected')} disabled={any} onClick={() => actions.act(link, 'rejected')}>Reject</Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            busy={on('remove')}
            disabled={any}
            aria-label={`Remove the link: ${link.prerequisite.name} before ${link.topic.name}`}
            onClick={() => actions.act(link, 'remove')}
          />
        </div>
      )}
    </li>
  );
}
