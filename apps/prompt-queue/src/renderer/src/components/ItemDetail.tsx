import { useEffect, useRef, useState } from 'react';
import { resumeCommand } from '../../../shared/claude/args';
import type { Command } from '../../../shared/commands';
import { describeHold, type HoldReason } from '../../../shared/scheduler';
import {
  PERMISSION_MODES,
  type PermissionMode,
  PRIORITIES,
  type Priority,
  type QueueItem,
  type Repo,
  type Turn,
} from '../../../shared/types';
import { formatAgo, formatCost, formatDuration, formatTime } from '../lib/format';
import { PERMISSION_LABELS, PRIORITY_LABELS } from '../lib/labels';
import { canReply, itemTitle, statusDisplay, totalCost } from '../lib/view';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';

interface Props {
  item: QueueItem;
  repo?: Repo;
  hold?: HoldReason;
  now: number;
  onClose(): void;
  onCommand(command: Command): void;
  onCopy(text: string): void;
}

const TURN_LABELS: Record<Turn['kind'], string> = {
  prompt: 'Prompt',
  reply: 'Your reply',
  continue: 'Continued after a usage limit',
};

export function ItemDetail({ item, repo, hold, now, onClose, onCommand, onCopy }: Props) {
  const display = statusDisplay(item, hold);
  const cost = totalCost(item);
  const scroller = useRef<HTMLDivElement>(null);
  const outputSize = item.turns.reduce((sum, turn) => sum + turn.output.length, 0);

  // Follow new output while the user is at the bottom.
  const pinned = useRef(true);
  useEffect(() => {
    const element = scroller.current;
    if (element && pinned.current && outputSize >= 0) element.scrollTop = element.scrollHeight;
  }, [outputSize]);

  const notice =
    item.status === 'queued' && hold
      ? describeHold(hold, (time) => formatTime(time, now))
      : item.message;

  return (
    <aside className="detail" aria-label="Prompt details">
      <header className="detail-header">
        <StatusBadge display={display} />
        <h2 className="detail-title">{itemTitle(item, 200)}</h2>
        <button type="button" className="icon-button" aria-label="Close details" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      <div className="detail-meta">
        {repo && (
          <span className="tag repo-tag" title={repo.path}>
            {repo.name}
          </span>
        )}
        <label className="inline-field">
          Priority
          <select
            value={item.priority}
            disabled={item.status !== 'queued'}
            onChange={(event) =>
              onCommand({
                type: 'setPriority',
                itemId: item.id,
                priority: event.target.value as Priority,
              })
            }
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <span>{PERMISSION_LABELS[item.options.permissionMode]}</span>
        {item.options.model && <span>{item.options.model}</span>}
        <span>Added {formatAgo(item.createdAt, now)}</span>
        {cost !== undefined && <span>{formatCost(cost)}</span>}
      </div>

      {notice && (
        <div className={`detail-notice tone-${display.tone}`} role="status">
          {notice}
        </div>
      )}

      <div className="detail-actions">
        {item.status === 'queued' && (
          <>
            <button
              type="button"
              className="button"
              onClick={() => onCommand({ type: 'moveToEnd', itemId: item.id, end: 'top' })}
            >
              <Icon name="top" />
              Move to top
            </button>
            <button
              type="button"
              className="button"
              onClick={() => onCommand({ type: 'cancel', itemId: item.id })}
            >
              <Icon name="close" />
              Cancel
            </button>
          </>
        )}
        {item.status === 'running' && (
          <button
            type="button"
            className="button danger"
            onClick={() => onCommand({ type: 'cancel', itemId: item.id })}
          >
            <Icon name="close" />
            Stop
          </button>
        )}
        {item.status === 'needs-feedback' && (
          <button
            type="button"
            className="button"
            onClick={() => onCommand({ type: 'resolve', itemId: item.id })}
          >
            <Icon name="check" />
            Mark done
          </button>
        )}
        {(item.status === 'error' || item.status === 'cancelled') && (
          <button
            type="button"
            className="button"
            onClick={() => onCommand({ type: 'retry', itemId: item.id })}
          >
            <Icon name="retry" />
            Retry
          </button>
        )}
        {item.sessionId && repo && (
          <button
            type="button"
            className="button"
            title="Copy a command that opens this session in Claude Code"
            onClick={() =>
              onCopy(resumeCommand(repo.path, item.sessionId ?? '', window.api.platform))
            }
          >
            <Icon name="terminal" />
            Copy resume command
          </button>
        )}
        {item.status !== 'running' && item.status !== 'queued' && (
          <button
            type="button"
            className="button"
            onClick={() => {
              onCommand({ type: 'remove', itemId: item.id });
              onClose();
            }}
          >
            <Icon name="trash" />
            Remove
          </button>
        )}
      </div>

      <div
        className="turns"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
      >
        {item.turns.map((turn, index) => (
          <TurnView
            key={turn.id}
            turn={turn}
            now={now}
            last={index === item.turns.length - 1}
            editable={item.status === 'queued' && index === item.turns.length - 1}
            onEdit={(prompt) => onCommand({ type: 'edit', itemId: item.id, prompt })}
          />
        ))}
      </div>

      {canReply(item) && (
        <ReplyBox
          key={item.id}
          defaultMode={item.options.permissionMode}
          onSend={(text, permissionMode) =>
            onCommand({ type: 'reply', itemId: item.id, text, options: { permissionMode } })
          }
        />
      )}
    </aside>
  );
}

function TurnView({
  turn,
  now,
  last,
  editable,
  onEdit,
}: {
  turn: Turn;
  now: number;
  last: boolean;
  editable: boolean;
  onEdit(prompt: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(turn.prompt);
  const running = turn.startedAt !== undefined && turn.finishedAt === undefined;
  const stats = [
    turn.durationMs !== undefined && formatDuration(turn.durationMs),
    turn.numTurns !== undefined && `${turn.numTurns} ${turn.numTurns === 1 ? 'turn' : 'turns'}`,
    turn.costUsd !== undefined && formatCost(turn.costUsd),
  ].filter(Boolean);

  return (
    <section className="turn" aria-label={TURN_LABELS[turn.kind]}>
      <div className="turn-heading">
        <span>{TURN_LABELS[turn.kind]}</span>
        <span className="turn-time">{formatAgo(turn.createdAt, now)}</span>
        {editable && !editing && (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDraft(turn.prompt);
              setEditing(true);
            }}
          >
            <Icon name="edit" size={13} />
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="edit-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim()) onEdit(draft);
            setEditing(false);
          }}
        >
          <textarea
            aria-label="Edit prompt"
            value={draft}
            rows={5}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="edit-actions">
            <button type="button" className="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="button primary" disabled={!draft.trim()}>
              Save
            </button>
          </div>
        </form>
      ) : (
        <div className="bubble user">{turn.prompt}</div>
      )}

      {turn.output.length > 0 && (
        <details className="activity" open={last}>
          <summary>
            Activity ({turn.output.length} {turn.output.length === 1 ? 'step' : 'steps'})
          </summary>
          <ol className="activity-list">
            {turn.output.map((entry, index) => (
              <li
                // Output only grows, so the index is a stable key.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                key={index}
                className={`activity-${entry.kind}`}
              >
                {entry.kind === 'tool' && <Icon name="tool" size={12} />}
                <span>{entry.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {running && (
        <div className="working">
          <Icon name="spinner" size={14} />
          Working… {turn.startedAt !== undefined && formatDuration(now - turn.startedAt)}
        </div>
      )}
      {turn.result && <div className="bubble agent">{turn.result}</div>}
      {stats.length > 0 && <div className="turn-stats">{stats.join(' · ')}</div>}
    </section>
  );
}

function ReplyBox({
  defaultMode,
  onSend,
}: {
  defaultMode: PermissionMode;
  onSend(text: string, mode: PermissionMode): void;
}) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState(defaultMode);
  const send = () => {
    if (!text.trim()) return;
    onSend(text, mode);
    setText('');
  };
  return (
    <form
      className="reply"
      aria-label="Reply"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        aria-label="Reply to Claude"
        placeholder="Reply to continue this session (⌘/Ctrl + Enter)"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            send();
          }
        }}
      />
      <div className="reply-bar">
        <label className="inline-field">
          Permissions
          <select value={mode} onChange={(event) => setMode(event.target.value as PermissionMode)}>
            {PERMISSION_MODES.map((value) => (
              <option key={value} value={value}>
                {PERMISSION_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="button primary" disabled={!text.trim()}>
          <Icon name="send" />
          Queue reply
        </button>
      </div>
    </form>
  );
}
