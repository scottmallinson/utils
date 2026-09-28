import type { Repo } from '../../../shared/types';
import type { RepoSummary } from '../lib/view';
import { Icon } from './Icon';

interface Props {
  repos: Repo[];
  summaries: Map<string, RepoSummary>;
  selected?: string;
  onSelect(repoId: string | undefined): void;
  onAddRepo(): void;
  onTogglePause(repo: Repo): void;
  onOpen(repo: Repo): void;
  onRemove(repo: Repo): void;
}

export function Sidebar({
  repos,
  summaries,
  selected,
  onSelect,
  onAddRepo,
  onTogglePause,
  onOpen,
  onRemove,
}: Props) {
  const total = { queued: 0, running: 0, attention: 0 };
  for (const summary of summaries.values()) {
    total.queued += summary.queued;
    total.running += summary.running;
    total.attention += summary.attention;
  }

  return (
    <nav className="sidebar" aria-label="Repositories">
      <div className="brand">
        <Icon name="queue" size={18} />
        Prompt Queue
      </div>

      <button
        type="button"
        className={`nav-item${selected === undefined ? ' active' : ''}`}
        aria-current={selected === undefined ? 'page' : undefined}
        onClick={() => onSelect(undefined)}
      >
        <Icon name="layers" />
        <span className="nav-label">All repos</span>
        <Counts summary={total} />
      </button>

      <div className="nav-heading">Repositories</div>
      <ul className="repo-list">
        {repos.map((repo) => {
          const summary = summaries.get(repo.id) ?? { queued: 0, running: 0, attention: 0 };
          return (
            <li key={repo.id} className="repo-row">
              <button
                type="button"
                className={`nav-item${selected === repo.id ? ' active' : ''}`}
                aria-current={selected === repo.id ? 'page' : undefined}
                title={repo.path}
                onClick={() => onSelect(repo.id)}
              >
                <Icon name={repo.paused ? 'pause' : 'repo'} />
                <span className="nav-label">{repo.name}</span>
                <Counts summary={summary} />
              </button>
              <div className="repo-actions">
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`${repo.paused ? 'Resume' : 'Pause'} ${repo.name}`}
                  title={repo.paused ? 'Resume this repo' : 'Pause this repo'}
                  onClick={() => onTogglePause(repo)}
                >
                  <Icon name={repo.paused ? 'play' : 'pause'} size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Open ${repo.name} folder`}
                  title="Open folder"
                  onClick={() => onOpen(repo)}
                >
                  <Icon name="folder" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove ${repo.name}`}
                  title="Remove from Prompt Queue"
                  disabled={summary.running > 0}
                  onClick={() => onRemove(repo)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <button type="button" className="button subtle add-repo" onClick={onAddRepo}>
        <Icon name="plus" />
        Add repository
      </button>
    </nav>
  );
}

function Counts({ summary }: { summary: RepoSummary }) {
  return (
    <span className="counts">
      {summary.running > 0 && (
        <span className="count running" title={`${summary.running} in progress`}>
          <Icon name="spinner" size={12} />
        </span>
      )}
      {summary.attention > 0 && (
        <span className="count attention" title={`${summary.attention} need you`}>
          {summary.attention}
        </span>
      )}
      {summary.queued > 0 && (
        <span className="count" title={`${summary.queued} queued`}>
          {summary.queued}
        </span>
      )}
    </span>
  );
}
