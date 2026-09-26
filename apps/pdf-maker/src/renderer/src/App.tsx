import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Icon } from './components/Icon';
import { PageGrid } from './components/PageGrid';
import { Toolbar } from './components/Toolbar';
import { buildPdf } from './lib/buildPdf';
import { convertImage } from './lib/convertImage';
import { type InputFile, importFiles } from './lib/importFiles';
import { DEFAULT_SETTINGS, MARGINS, PAGE_SIZES } from './lib/layout';
import { pickFiles, readFiles, savePdf } from './lib/platform';
import { initialState, reducer } from './lib/state';
import { releaseSource } from './lib/thumbnails';
import type { LayoutSettings, MarginId, PageSizeId } from './lib/types';

const SETTINGS_KEY = 'pdf-maker:settings';

interface Notice {
  id: number;
  kind: 'error' | 'success';
  text: string;
  savedPath?: string;
}

export function App() {
  const [state, dispatch] = useReducer(reducer, initialState, (init) => ({
    ...init,
    settings: loadSettings(),
  }));
  const [busy, setBusy] = useState<string>();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dragging, setDragging] = useState(false);

  const notify = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = Date.now() + Math.random();
    setNotices((current) => [...current, { ...notice, id }]);
    if (notice.kind === 'success') {
      setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), 8000);
    }
  }, []);

  const addFiles = useCallback(
    async (files: InputFile[]) => {
      if (files.length === 0) return;
      setBusy(`Adding ${files.length === 1 ? files[0]?.name : `${files.length} files`}…`);
      try {
        const result = await importFiles(files, convertImage);
        dispatch({ type: 'add', sources: result.sources, pages: result.pages });
        for (const text of result.errors) notify({ kind: 'error', text });
      } finally {
        setBusy(undefined);
      }
    },
    [notify],
  );

  const handleAddFiles = useCallback(async () => {
    try {
      await addFiles(await pickFiles());
    } catch (error) {
      notify({ kind: 'error', text: `Couldn't open files: ${errorMessage(error)}` });
    }
  }, [addFiles, notify]);

  const handleSave = useCallback(async () => {
    if (state.pages.length === 0 || busy) return;
    setBusy('Creating PDF…');
    try {
      const name = suggestedName([...state.sources.values()].map((s) => s.name));
      const bytes = await buildPdf(state.pages, state.sources, state.settings, {
        title: name.replace(/\.pdf$/i, ''),
      });
      const savedPath = await savePdf(bytes, name);
      if (savedPath) notify({ kind: 'success', text: `Saved ${baseName(savedPath)}`, savedPath });
    } catch (error) {
      notify({ kind: 'error', text: `Couldn't save the PDF: ${errorMessage(error)}` });
    } finally {
      setBusy(undefined);
    }
  }, [state, busy, notify]);

  // Keep the latest handlers reachable from long-lived listeners.
  const handlers = useRef({ handleAddFiles, handleSave, addFiles });
  handlers.current = { handleAddFiles, handleSave, addFiles };

  // Native menu commands (Electron) or keyboard shortcuts (browser).
  useEffect(() => {
    if (window.api) {
      return window.api.onMenuCommand((command) => {
        if (command === 'add-files') void handlers.current.handleAddFiles();
        if (command === 'save') void handlers.current.handleSave();
      });
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'o') void handlers.current.handleAddFiles();
      else if (key === 's') void handlers.current.handleSave();
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Files can be dropped anywhere in the window. Without preventDefault the
  // browser would navigate to the dropped file.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth++;
      setDragging(true);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = hasFiles(event) ? 'copy' : 'none';
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = event.dataTransfer?.files;
      if (files?.length) void readFiles(files).then(handlers.current.addFiles);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // Free thumbnails for sources that no page uses any more.
  const previousSources = useRef(state.sources);
  useEffect(() => {
    for (const id of previousSources.current.keys()) {
      if (!state.sources.has(id)) releaseSource(id);
    }
    previousSources.current = state.sources;
  }, [state.sources]);

  useEffect(() => saveSettings(state.settings), [state.settings]);

  const handleClear = () => {
    if (window.confirm('Remove all pages?')) dispatch({ type: 'clear' });
  };

  const pageCount = state.pages.length;
  const fileCount = state.sources.size;

  return (
    <div className="app">
      <Toolbar
        settings={state.settings}
        hasPages={pageCount > 0}
        busy={Boolean(busy)}
        onSettingsChange={(settings) => dispatch({ type: 'settings', settings })}
        onAddFiles={handleAddFiles}
        onRotateAll={(degrees) => dispatch({ type: 'rotateAll', degrees })}
        onClear={handleClear}
        onSave={handleSave}
      />

      <main className="workspace">
        {pageCount === 0 ? (
          <div className="empty-state">
            <Icon name="file" size={48} />
            <h1>Drop PDFs or images here</h1>
            <p>Arrange the pages, choose a layout, then save them as a single PDF.</p>
            <button type="button" className="button primary" onClick={handleAddFiles}>
              <Icon name="plus" />
              Add files
            </button>
          </div>
        ) : (
          <PageGrid
            pages={state.pages}
            sources={state.sources}
            settings={state.settings}
            onMove={(from, to) => dispatch({ type: 'move', from, to })}
            onRotate={(pageId, degrees) => dispatch({ type: 'rotate', pageId, degrees })}
            onRemove={(pageId) => dispatch({ type: 'remove', pageId })}
          />
        )}
      </main>

      <footer className="status-bar">
        <span>
          {pageCount} {pageCount === 1 ? 'page' : 'pages'}
          {fileCount > 0 && ` from ${fileCount} ${fileCount === 1 ? 'file' : 'files'}`}
        </span>
        {pageCount > 0 && <span className="hint">Drag pages to reorder</span>}
        {busy && (
          <span className="busy" role="status">
            {busy}
          </span>
        )}
      </footer>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div>Drop to add files</div>
        </div>
      )}

      <div className="notices" aria-live="polite">
        {notices.map((notice) => (
          <div key={notice.id} className={`notice ${notice.kind}`}>
            <span className="notice-text">{notice.text}</span>
            {notice.savedPath && window.api && (
              <button
                type="button"
                className="link-button"
                onClick={() => notice.savedPath && window.api?.showInFolder(notice.savedPath)}
              >
                Show in folder
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss"
              onClick={() => setNotices((current) => current.filter((n) => n.id !== notice.id))}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function suggestedName(sourceNames: string[]): string {
  const [first] = sourceNames;
  if (sourceNames.length === 1 && first) return `${first.replace(/\.[^.]+$/, '')}.pdf`;
  return 'Combined.pdf';
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadSettings(): LayoutSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
      allowed.includes(value as T) ? (value as T) : fallback;
    return {
      pageSize: pick(
        stored.pageSize,
        ['source', ...Object.keys(PAGE_SIZES)] as PageSizeId[],
        DEFAULT_SETTINGS.pageSize,
      ),
      orientation: pick(
        stored.orientation,
        ['auto', 'portrait', 'landscape'],
        DEFAULT_SETTINGS.orientation,
      ),
      margin: pick(stored.margin, Object.keys(MARGINS) as MarginId[], DEFAULT_SETTINGS.margin),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: LayoutSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Settings just won't persist.
  }
}
