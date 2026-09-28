import { useEffect, useRef, useState } from 'react';
import type { CliCheck } from '../../../preload/api';
import type { Settings } from '../../../shared/types';
import { MAX_CONCURRENT, PERMISSION_MODES, type PermissionMode } from '../../../shared/types';
import { MODEL_SUGGESTIONS, PERMISSION_HINT, PERMISSION_LABELS } from '../lib/labels';

interface Props {
  open: boolean;
  settings: Settings;
  cli?: CliCheck;
  onChange(settings: Partial<Settings>): void;
  onCheckCli(): void;
  onClose(): void;
}

export function SettingsDialog({ open, settings, cli, onChange, onCheckCli, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [claudePath, setClaudePath] = useState(settings.claudePath);
  const [model, setModel] = useState(settings.defaultModel);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setClaudePath(settings.claudePath);
      setModel(settings.defaultModel);
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, settings.claudePath, settings.defaultModel]);

  const number = (value: string) => (value === '' ? Number.NaN : Number(value));

  return (
    <dialog ref={dialog} className="settings" aria-labelledby="settings-title" onClose={onClose}>
      <form
        method="dialog"
        onSubmit={() => {
          onChange({ claudePath, defaultModel: model });
        }}
      >
        <h2 id="settings-title">Settings</h2>

        <fieldset>
          <legend>Claude Code</legend>
          <label className="stacked">
            <span>Path to claude</span>
            <input
              value={claudePath}
              placeholder="Found automatically"
              spellCheck={false}
              onChange={(event) => setClaudePath(event.target.value)}
              onBlur={() => onChange({ claudePath })}
            />
          </label>
          <div className="cli-status" role="status">
            {cli === undefined
              ? 'Checking…'
              : cli.ok
                ? `✓ ${cli.version ?? 'Found'} at ${cli.path}`
                : `✗ ${cli.error ?? 'Not found'}`}
            <button type="button" className="link-button" onClick={onCheckCli}>
              Check again
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Running</legend>
          <label className="row">
            <span>Prompts running at once (one per repo)</span>
            <input
              type="number"
              min={1}
              max={MAX_CONCURRENT}
              value={settings.maxConcurrent}
              onChange={(event) => onChange({ maxConcurrent: number(event.target.value) })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.pauseRepoOnFeedback}
              onChange={(event) => onChange({ pauseRepoOnFeedback: event.target.checked })}
            />
            Hold a repo’s queue while a prompt there waits for feedback
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.questionsNeedFeedback}
              onChange={(event) => onChange({ questionsNeedFeedback: event.target.checked })}
            />
            Treat a final message ending in a question as waiting for feedback
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(event) => onChange({ notifications: event.target.checked })}
            />
            Notify me when a prompt needs me, fails, or the queue finishes
          </label>
        </fieldset>

        <fieldset>
          <legend>Usage limits</legend>
          <p className="hint">
            When Claude Code reports a limit window (5-hour or weekly) is this full, lower-priority
            prompts wait so there’s room for more important ones. High priority prompts run until a
            limit is reached. Use 100 to turn a hold off.
          </p>
          <label className="row">
            <span>Hold low priority at</span>
            <span className="suffix">
              <input
                type="number"
                min={0}
                max={100}
                value={settings.holdLowAbove}
                onChange={(event) => onChange({ holdLowAbove: number(event.target.value) })}
              />
              %
            </span>
          </label>
          <label className="row">
            <span>Hold normal priority at</span>
            <span className="suffix">
              <input
                type="number"
                min={0}
                max={100}
                value={settings.holdNormalAbove}
                onChange={(event) => onChange({ holdNormalAbove: number(event.target.value) })}
              />
              %
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>New prompts</legend>
          <p className="hint">{PERMISSION_HINT}</p>
          <label className="row">
            <span>Permissions</span>
            <select
              value={settings.defaultPermissionMode}
              onChange={(event) =>
                onChange({ defaultPermissionMode: event.target.value as PermissionMode })
              }
            >
              {PERMISSION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {PERMISSION_LABELS[mode]}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            <span>Model</span>
            <input
              list="settings-models"
              value={model}
              placeholder="Default"
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
              onBlur={() => onChange({ defaultModel: model })}
            />
            <datalist id="settings-models">
              {MODEL_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
          </label>
        </fieldset>

        <p className="hint">
          Prompt Queue runs your own Claude Code install, signed in as you, exactly as you would in
          a terminal. It never sees your credentials, runs one prompt per repo at a time, and waits
          for limits to reset rather than working around them.
        </p>

        <div className="dialog-actions">
          <button type="submit" className="button primary">
            Done
          </button>
        </div>
      </form>
    </dialog>
  );
}
