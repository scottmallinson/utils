import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { type ReactNode, useState } from 'react';
import type { Command } from '../../../shared/commands';
import type { HoldReason } from '../../../shared/scheduler';
import type { AppState, QueueItem } from '../../../shared/types';
import type { Sections } from '../lib/view';
import { ItemCard, type ItemCardProps } from './ItemCard';

interface Props {
  state: AppState;
  sections: Sections;
  holds: Map<string, HoldReason>;
  /** The repo being viewed, if any. */
  repoId?: string;
  now: number;
  selectedId?: string;
  onSelect(itemId: string): void;
  onCommand(command: Command): void;
}

const DONE_PREVIEW = 10;

export function QueueView({
  state,
  sections,
  holds,
  repoId,
  now,
  selectedId,
  onSelect,
  onCommand,
}: Props) {
  const [showAllDone, setShowAllDone] = useState(false);
  const repoNames = new Map(state.repos.map((repo) => [repo.id, repo.name]));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const cardProps = (item: QueueItem): ItemCardProps => ({
    item,
    repoName: repoId === undefined ? repoNames.get(item.repoId) : undefined,
    hold: holds.get(item.id),
    now,
    selected: item.id === selectedId,
    onSelect,
    onCommand,
  });

  const move = (itemId: string, targetId: string) =>
    onCommand({ type: 'move', itemId, targetId, repoId });

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) move(String(active.id), String(over.id));
  };

  const { attention, running, queued, done } = sections;
  const visibleDone = showAllDone ? done : done.slice(0, DONE_PREVIEW);

  return (
    <div className="queue">
      {attention.length > 0 && (
        <Section title="Needs you" count={attention.length} tone="attention">
          {attention.map((item) => (
            <ItemCard key={item.id} {...cardProps(item)} />
          ))}
        </Section>
      )}

      {running.length > 0 && (
        <Section title="In progress" count={running.length} tone="active">
          {running.map((item) => (
            <ItemCard key={item.id} {...cardProps(item)} />
          ))}
        </Section>
      )}

      <Section title="Queue" count={queued.length}>
        {queued.length === 0 ? (
          <p className="section-empty">
            Nothing queued. Prompts you add run in order as limits allow.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={queued.map((item) => item.id)}
              strategy={verticalListSortingStrategy}
            >
              {queued.map((item, index) => (
                <SortableCard
                  key={item.id}
                  {...cardProps(item)}
                  canMoveUp={index > 0}
                  canMoveDown={index < queued.length - 1}
                  onMove={(direction) => {
                    const target = queued[direction === 'up' ? index - 1 : index + 1];
                    if (target) move(item.id, target.id);
                  }}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </Section>

      {done.length > 0 && (
        <Section
          title="Done"
          count={done.length}
          action={
            <button
              type="button"
              className="link-button"
              onClick={() => onCommand({ type: 'clearFinished', repoId })}
            >
              Clear
            </button>
          }
        >
          {visibleDone.map((item) => (
            <ItemCard key={item.id} {...cardProps(item)} />
          ))}
          {done.length > DONE_PREVIEW && (
            <button
              type="button"
              className="link-button show-more"
              onClick={() => setShowAllDone(!showAllDone)}
            >
              {showAllDone ? 'Show fewer' : `Show all ${done.length}`}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  tone,
  action,
  children,
}: {
  title: string;
  count: number;
  tone?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={`section${tone ? ` section-${tone}` : ''}`} aria-label={title}>
      <h2 className="section-title">
        {title}
        <span className="section-count">{count}</span>
        {action && <span className="section-action">{action}</span>}
      </h2>
      <div className="section-items">{children}</div>
    </section>
  );
}

function SortableCard(props: ItemCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
  });
  return (
    <ItemCard
      {...props}
      cardRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      handleProps={{ ...attributes, ...listeners }}
    />
  );
}
