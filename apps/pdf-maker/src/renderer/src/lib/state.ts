import { DEFAULT_SETTINGS, normalizeRotation } from './layout';
import type { LayoutSettings, PageItem, Source } from './types';

export interface DocumentState {
  sources: Map<string, Source>;
  pages: PageItem[];
  settings: LayoutSettings;
}

export type Action =
  | { type: 'add'; sources: Source[]; pages: PageItem[] }
  | { type: 'remove'; pageId: string }
  | { type: 'rotate'; pageId: string; degrees: number }
  | { type: 'rotateAll'; degrees: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'settings'; settings: Partial<LayoutSettings> }
  | { type: 'clear' };

export const initialState: DocumentState = {
  sources: new Map(),
  pages: [],
  settings: DEFAULT_SETTINGS,
};

export function reducer(state: DocumentState, action: Action): DocumentState {
  switch (action.type) {
    case 'add': {
      const sources = new Map(state.sources);
      for (const source of action.sources) sources.set(source.id, source);
      return { ...state, sources, pages: [...state.pages, ...action.pages] };
    }
    case 'remove': {
      const pages = state.pages.filter((page) => page.id !== action.pageId);
      return { ...state, pages, sources: pruneSources(state.sources, pages) };
    }
    case 'rotate':
      return {
        ...state,
        pages: state.pages.map((page) =>
          page.id === action.pageId
            ? { ...page, rotation: normalizeRotation(page.rotation + action.degrees) }
            : page,
        ),
      };
    case 'rotateAll':
      return {
        ...state,
        pages: state.pages.map((page) => ({
          ...page,
          rotation: normalizeRotation(page.rotation + action.degrees),
        })),
      };
    case 'move':
      return { ...state, pages: moveItem(state.pages, action.from, action.to) };
    case 'settings':
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case 'clear':
      return { ...initialState, settings: state.settings };
  }
}

export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length || to < 0 || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [item] = next.splice(from, 1) as [T];
  next.splice(to, 0, item);
  return next;
}

/** Drops sources no page refers to any more, so their bytes can be freed. */
function pruneSources(sources: Map<string, Source>, pages: PageItem[]): Map<string, Source> {
  const used = new Set(pages.map((page) => page.sourceId));
  if (used.size === sources.size) return sources;
  return new Map([...sources].filter(([id]) => used.has(id)));
}
