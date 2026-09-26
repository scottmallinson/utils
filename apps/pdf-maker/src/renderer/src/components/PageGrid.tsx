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
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { KeyboardEvent } from 'react';
import type { LayoutSettings, PageItem, Source } from '../lib/types';
import { Icon } from './Icon';
import { PagePreview } from './PagePreview';

interface Props {
  pages: PageItem[];
  sources: ReadonlyMap<string, Source>;
  settings: LayoutSettings;
  onMove(from: number, to: number): void;
  onRotate(pageId: string, degrees: number): void;
  onRemove(pageId: string): void;
}

export function PageGrid({ pages, sources, settings, onMove, onRotate, onRemove }: Props) {
  const sensors = useSensors(
    // A small threshold keeps clicks on the card's buttons from starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = pages.findIndex((page) => page.id === active.id);
    const to = pages.findIndex((page) => page.id === over.id);
    onMove(from, to);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
        <ol className="page-grid">
          {pages.map((page, index) => {
            const source = sources.get(page.sourceId);
            return source ? (
              <PageCard
                key={page.id}
                page={page}
                index={index}
                source={source}
                settings={settings}
                onRotate={onRotate}
                onRemove={onRemove}
              />
            ) : null;
          })}
        </ol>
      </SortableContext>
    </DndContext>
  );
}

interface CardProps {
  page: PageItem;
  index: number;
  source: Source;
  settings: LayoutSettings;
  onRotate(pageId: string, degrees: number): void;
  onRemove(pageId: string): void;
}

function PageCard({ page, index, source, settings, onRotate, onRemove }: CardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const label =
    source.kind === 'pdf' && source.pageCount > 1
      ? `${source.name} · page ${page.pageIndex + 1}`
      : source.name;

  // Keep Enter/Space on the buttons from also picking the card up.
  const stopKeys = (event: KeyboardEvent) => event.stopPropagation();

  return (
    <li
      ref={setNodeRef}
      className={`page-card${isDragging ? ' is-dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`Page ${index + 1}: ${label}`}
    >
      <PagePreview page={page} source={source} settings={settings} />
      <div className="page-meta">
        <span className="page-number">{index + 1}</span>
        <span className="page-label" title={label}>
          {label}
        </span>
      </div>
      <div className="page-actions">
        <button
          type="button"
          className="icon-button"
          title="Rotate left"
          aria-label={`Rotate page ${index + 1} left`}
          onClick={() => onRotate(page.id, -90)}
          onKeyDown={stopKeys}
        >
          <Icon name="rotateLeft" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          title="Rotate right"
          aria-label={`Rotate page ${index + 1} right`}
          onClick={() => onRotate(page.id, 90)}
          onKeyDown={stopKeys}
        >
          <Icon name="rotateRight" size={16} />
        </button>
        <button
          type="button"
          className="icon-button danger"
          title="Remove page"
          aria-label={`Remove page ${index + 1}`}
          onClick={() => onRemove(page.id)}
          onKeyDown={stopKeys}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
    </li>
  );
}
