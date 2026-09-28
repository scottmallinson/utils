import type { CSSProperties, HTMLAttributes } from 'react';
import type { Command } from '../../../shared/commands';
import { describeHold, type HoldReason } from '../../../shared/scheduler';
import type { QueueItem } from '../../../shared/types';
import { formatAgo, formatCost, formatDuration, formatTime } from '../lib/format';
import { PRIORITY_LABELS } from '../lib/labels';
import { itemTitle, latestActivity, statusDisplay, totalCost } from '../lib/view';
import { Icon } from './Icon';
import { StatusBadge } from './StatusBadge';

export interface ItemCardProps {
  item: QueueItem;
  /** Shown when viewing all repos. */
  repoName?: string;
  hold?: HoldReason;
  now: number;
  selected: boolean;
  onSelect(itemId: string): void;
  onCommand(command: Command): void;
  /** For queued items: whether it can move up or down in the list shown. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?(direction: 'up' | 'down'): void;
  /** Drag handle wiring from dnd-kit, for queued items. */
  handleProps?: HTMLAttributes<HTMLButtonElement>;
  cardRef?: (node: HTMLElement | null) => void;
  style?: CSSProperties;
  dragging?: boolean;
}

export function ItemCard({
  item,
  repoName,
  hold,
  now,
  selected,
  onSelect,
  onCommand,
  canMoveUp,
  canMoveDown,
  onMove,
  handleProps,
  cardRef,
  style,
  dragging,
}: ItemCardProps) {
  const title = itemTitle(item);
  const display = statusDisplay(item, hold);
  const meta = metaText(item, hold, now);

  return (
    <article
      ref={cardRef}
      style={style}
      className={`card tone-${display.tone}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`}
      data-status={item.status}
      aria-label={title}
    >
      {handleProps && (
        <button
          type="button"
          className="drag-handle"
          aria-label={`Reorder ${title}`}
          title="Drag to reorder"
          {...handleProps}
        >
          <Icon name="grip" size={14} />
        </button>
      )}
      <StatusBadge display={display} />
      <button
        type="button"
        className="card-open"
        aria-pressed={selected}
        onClick={() => onSelect(item.id)}
      >
        <span className="card-title">{title}</span>
        <span className="card-meta">
          {repoName && <span className="tag repo-tag">{repoName}</span>}
          {item.priority !== 'normal' && (
            <span className={`tag priority-${item.priority}`}>
              {PRIORITY_LABELS[item.priority]}
            </span>
          )}
          {item.turns.length > 1 && <span className="tag">{item.turns.length} turns</span>}
          <span className="meta-text">{meta}</span>
        </span>
      </button>
      <div className="card-actions">
        {item.status === 'queued' && onMove && (
          <>
            <button
              type="button"
              className="icon-button"
              aria-label="Move up"
              title="Move up"
              disabled={!canMoveUp}
              onClick={() => onMove('up')}
            >
              <Icon name="up" size={14} />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Move down"
              title="Move down"
              disabled={!canMoveDown}
              onClick={() => onMove('down')}
            >
              <Icon name="down" size={14} />
            </button>
          </>
        )}
        {(item.status === 'running' || item.status === 'queued') && (
          <button
            type="button"
            className="icon-button"
            aria-label="Cancel"
            title={item.status === 'running' ? 'Stop' : 'Cancel'}
            onClick={() => onCommand({ type: 'cancel', itemId: item.id })}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        {item.status === 'needs-feedback' && (
          <button
            type="button"
            className="icon-button"
            aria-label="Mark done"
            title="Mark done"
            onClick={() => onCommand({ type: 'resolve', itemId: item.id })}
          >
            <Icon name="check" size={14} />
          </button>
        )}
        {(item.status === 'error' || item.status === 'cancelled') && (
          <button
            type="button"
            className="icon-button"
            aria-label="Retry"
            title="Retry"
            onClick={() => onCommand({ type: 'retry', itemId: item.id })}
          >
            <Icon name="retry" size={14} />
          </button>
        )}
        {item.status !== 'running' && item.status !== 'queued' && (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove"
            title="Remove"
            onClick={() => onCommand({ type: 'remove', itemId: item.id })}
          >
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </article>
  );
}

function metaText(item: QueueItem, hold: HoldReason | undefined, now: number): string {
  const turn = item.turns.at(-1);
  switch (item.status) {
    case 'queued': {
      const reason =
        hold?.kind === 'limit'
          ? `Resumes after ${formatTime(hold.until, now)}`
          : hold
            ? describeHold(hold, (time) => formatTime(time, now))
            : 'Starting…';
      return turn?.kind === 'continue' ? `${reason} · will continue where it stopped` : reason;
    }
    case 'running': {
      const elapsed = turn?.startedAt ? formatDuration(now - turn.startedAt) : '';
      const activity = latestActivity(item) ?? 'Starting Claude Code…';
      return [elapsed, activity].filter(Boolean).join(' · ');
    }
    case 'needs-feedback':
    case 'error':
      return item.message ?? '';
    case 'completed': {
      const cost = totalCost(item);
      return [`Finished ${formatAgo(item.updatedAt, now)}`, cost !== undefined && formatCost(cost)]
        .filter(Boolean)
        .join(' · ');
    }
    case 'cancelled':
      return `Cancelled ${formatAgo(item.updatedAt, now)}`;
  }
}
