import { forwardRef, useState } from 'react';
import type { Command } from '../../../shared/commands';
import {
  PERMISSION_MODES,
  type PermissionMode,
  PRIORITIES,
  type Priority,
  type Repo,
  type Settings,
} from '../../../shared/types';
import { PERMISSION_HINT, PERMISSION_LABELS, PRIORITY_LABELS } from '../lib/labels';
import { Icon } from './Icon';
import { ModelSelect } from './ModelSelect';

interface Props {
  repos: Repo[];
  /** The repo being viewed, if any: new prompts go there. */
  repoId?: string;
  settings: Settings;
  onSubmit(command: Command): void;
}

const LAST_REPO_KEY = 'prompt-queue:last-repo';

export const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { repos, repoId, settings, onSubmit },
  ref,
) {
  const [prompt, setPrompt] = useState('');
  const [chosenRepo, setChosenRepo] = useState(() => readLastRepo());
  const [priority, setPriority] = useState<Priority>('normal');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    settings.defaultPermissionMode,
  );
  const [model, setModel] = useState(settings.defaultModel);
  const [atTop, setAtTop] = useState(false);

  const targetRepo =
    repoId ?? (repos.some((repo) => repo.id === chosenRepo) ? chosenRepo : repos[0]?.id);
  const canSubmit = Boolean(prompt.trim() && targetRepo);

  const submit = () => {
    if (!canSubmit || !targetRepo) return;
    onSubmit({
      type: 'add',
      repoId: targetRepo,
      prompt,
      priority,
      options: { model: model.trim(), permissionMode },
      atTop,
    });
    setPrompt('');
    setAtTop(false);
  };

  return (
    <form
      className="composer"
      aria-label="Add a prompt"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        aria-label="New prompt"
        placeholder={
          repos.length === 0
            ? 'Add a repository first'
            : 'What should Claude Code do next? (⌘/Ctrl + Enter to queue)'
        }
        rows={3}
        value={prompt}
        disabled={repos.length === 0}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bar">
        {repoId === undefined && (
          <label className="field">
            <span>Repo</span>
            <select
              value={targetRepo ?? ''}
              onChange={(event) => {
                setChosenRepo(event.target.value);
                writeLastRepo(event.target.value);
              }}
              disabled={repos.length === 0}
            >
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>Priority</span>
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as Priority)}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field" title={PERMISSION_HINT}>
          <span>Permissions</span>
          <select
            value={permissionMode}
            onChange={(event) => setPermissionMode(event.target.value as PermissionMode)}
          >
            {PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PERMISSION_LABELS[mode]}
              </option>
            ))}
          </select>
        </label>
        <label className="field model-field" htmlFor="composer-model">
          <span>Model</span>
          <ModelSelect id="composer-model" value={model} onChange={setModel} />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={atTop} onChange={(e) => setAtTop(e.target.checked)} />
          Add to top
        </label>
        <button type="submit" className="button primary" disabled={!canSubmit}>
          <Icon name="plus" />
          Add to queue
        </button>
      </div>
    </form>
  );
});

function readLastRepo(): string | undefined {
  try {
    return localStorage.getItem(LAST_REPO_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeLastRepo(repoId: string) {
  try {
    localStorage.setItem(LAST_REPO_KEY, repoId);
  } catch {
    // Just won't be remembered.
  }
}
