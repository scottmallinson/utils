import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CliCheck } from '../../preload/api';
import type { Command } from '../../shared/commands';
import { effectiveLimits } from '../../shared/limits';
import { reduce } from '../../shared/queue';
import { planQueue } from '../../shared/scheduler';
import type { AppState, Repo } from '../../shared/types';
import { Composer } from './components/Composer';
import { Icon } from './components/Icon';
import { ItemDetail } from './components/ItemDetail';
import { QueueView } from './components/QueueView';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { repoSummaries, sections } from './lib/view';

/** Commands whose result the UI can show straight away, so dragging doesn't snap back. */
const OPTIMISTIC = new Set<Command['type']>(['move', 'moveToEnd', 'setPriority']);

interface Toast {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

export function App() {
  const [state, setState] = useState<AppState>();
  const [repoId, setRepoId] = useState<string>();
  const [selectedId, setSelectedId] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cli, setCli] = useState<CliCheck>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    void window.api.getState().then((initial) => {
      if (active) setState((current) => current ?? initial);
    });
    const unsubscribe = window.api.onState(setState);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const running = state?.items.some((item) => item.status === 'running') ?? false;
  const now = useNow(running ? 1000 : 15_000);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, text }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const send = useCallback(
    (command: Command) => {
      if (OPTIMISTIC.has(command.type)) {
        setState(
          (current) =>
            current && reduce(current, command, { now: Date.now(), id: () => 'pending' }),
        );
      }
      window.api.send(command).catch((error: unknown) => {
        toast('error', `Couldn’t do that: ${error instanceof Error ? error.message : error}`);
      });
    },
    [toast],
  );

  const checkCli = useCallback(() => {
    setCli(undefined);
    void window.api.checkClaude().then(setCli);
  }, []);
  const claudePath = state?.settings.claudePath;
  useEffect(() => {
    if (claudePath !== undefined) checkCli();
  }, [claudePath, checkCli]);

  const addRepo = useCallback(() => {
    window.api.addRepo().catch((error: unknown) => toast('error', String(error)));
  }, [toast]);

  // Native menu commands.
  const handlers = useRef({ addRepo, send, paused: false });
  handlers.current = { addRepo, send, paused: state?.paused ?? false };
  useEffect(
    () =>
      window.api.onMenuCommand((command) => {
        if (command === 'new-prompt') composer.current?.focus();
        else if (command === 'add-repo') handlers.current.addRepo();
        else if (command === 'settings') setSettingsOpen(true);
        else if (command === 'toggle-pause') {
          handlers.current.send({ type: 'setPaused', paused: !handlers.current.paused });
        }
      }),
    [],
  );

  // Forget a repo filter or selection that no longer exists.
  useEffect(() => {
    if (repoId && state && !state.repos.some((repo) => repo.id === repoId)) setRepoId(undefined);
    if (selectedId && state && !state.items.some((item) => item.id === selectedId)) {
      setSelectedId(undefined);
    }
  }, [state, repoId, selectedId]);

  const plan = useMemo(() => (state ? planQueue(state, now) : undefined), [state, now]);
  const summaries = useMemo(() => (state ? repoSummaries(state) : new Map()), [state]);
  const view = useMemo(() => (state ? sections(state, repoId) : undefined), [state, repoId]);

  if (!state || !plan || !view) return <div className="loading">Loading…</div>;

  const limits = effectiveLimits(state.limits['claude-code'], now);
  const selected = state.items.find((item) => item.id === selectedId);
  const currentRepo = state.repos.find((repo) => repo.id === repoId);

  const removeRepo = (repo: Repo) => {
    const count = state.items.filter((item) => item.repoId === repo.id).length;
    const detail = count > 0 ? ` and its ${count} ${count === 1 ? 'prompt' : 'prompts'}` : '';
    if (window.confirm(`Remove ${repo.name}${detail} from Prompt Queue? Files aren’t touched.`)) {
      send({ type: 'removeRepo', repoId: repo.id });
    }
  };

  return (
    <div className="app">
      <Sidebar
        repos={state.repos}
        summaries={summaries}
        selected={repoId}
        onSelect={setRepoId}
        onAddRepo={addRepo}
        onTogglePause={(repo) =>
          send({ type: 'setRepoPaused', repoId: repo.id, paused: !repo.paused })
        }
        onOpen={(repo) => void window.api.openRepo(repo.id)}
        onRemove={removeRepo}
      />

      <div className="main">
        <TopBar
          limits={limits}
          paused={state.paused}
          now={now}
          onTogglePause={() => send({ type: 'setPaused', paused: !state.paused })}
          onResumeTool={() => send({ type: 'resumeTool', toolId: 'claude-code' })}
          onSettings={() => setSettingsOpen(true)}
        />

        {cli && !cli.ok && (
          <div className="banner" role="alert">
            <Icon name="alert" />
            <span>{cli.error ?? 'Claude Code isn’t working.'}</span>
            <button type="button" className="link-button" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </div>
        )}

        <div className="content">
          <div className="queue-column">
            <div className="view-heading">
              <h1>{currentRepo ? currentRepo.name : 'All repos'}</h1>
              {currentRepo && <span className="view-path">{currentRepo.path}</span>}
              {currentRepo?.paused && <span className="tag">Paused</span>}
            </div>

            {state.repos.length === 0 ? (
              <div className="empty-state">
                <Icon name="repo" size={40} />
                <h2>Add a repository to get started</h2>
                <p>
                  Queue prompts for Claude Code in each of your repos. They run one at a time per
                  repo, in the order you choose, and wait politely when you hit a usage limit.
                </p>
                <button type="button" className="button primary" onClick={addRepo}>
                  <Icon name="plus" />
                  Add repository
                </button>
              </div>
            ) : (
              <>
                <Composer
                  ref={composer}
                  repos={state.repos}
                  repoId={repoId}
                  settings={state.settings}
                  onSubmit={send}
                />
                <QueueView
                  state={state}
                  sections={view}
                  holds={plan.holds}
                  repoId={repoId}
                  now={now}
                  selectedId={selectedId}
                  onSelect={(id) => setSelectedId(id === selectedId ? undefined : id)}
                  onCommand={send}
                />
              </>
            )}
          </div>

          {selected && (
            <ItemDetail
              key={selected.id}
              item={selected}
              repo={state.repos.find((repo) => repo.id === selected.repoId)}
              hold={plan.holds.get(selected.id)}
              now={now}
              onClose={() => setSelectedId(undefined)}
              onCommand={send}
              onCopy={(text) =>
                void window.api.copyText(text).then(() => toast('info', 'Copied to clipboard'))
              }
            />
          )}
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        settings={state.settings}
        cli={cli}
        onChange={(settings) => send({ type: 'updateSettings', settings })}
        onCheckCli={checkCli}
        onClose={() => setSettingsOpen(false)}
      />

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The current time, updated every `interval` ms. */
function useNow(interval: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
