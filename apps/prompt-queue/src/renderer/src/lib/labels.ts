import type { PermissionMode, Priority } from '../../../shared/types';

export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'High',
  normal: 'Normal',
  low: 'Low',
};

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  default: 'Default',
  acceptEdits: 'Accept edits',
  plan: 'Plan only',
  auto: 'Auto',
  bypassPermissions: 'Bypass (risky)',
};

/** Unattended runs can't answer permission prompts, so this is what each mode means here. */
export const PERMISSION_HINT =
  'Prompts run unattended, so anything Claude Code would normally ask about is denied and the ' +
  'prompt waits for your feedback. “Default” allows only what your Claude Code settings already ' +
  'allow; “Accept edits” also lets it edit files; “Plan only” makes no changes; “Bypass” allows ' +
  'everything, including commands, so use it only in repos you’re happy for it to change freely.';

export interface ModelOption {
  /** Passed to `claude --model`; empty for the tool's default. */
  value: string;
  label: string;
}

export interface ModelGroup {
  label: string;
  options: ModelOption[];
}

/** Aliases follow the latest release; the pinned versions stay on one model. */
export const MODEL_GROUPS: ModelGroup[] = [
  {
    label: 'Latest',
    options: [
      { value: 'fable', label: 'Fable' },
      { value: 'opus', label: 'Opus' },
      { value: 'sonnet', label: 'Sonnet' },
      { value: 'haiku', label: 'Haiku' },
    ],
  },
  {
    label: 'Extended context and planning',
    options: [
      { value: 'opus[1m]', label: 'Opus (1M context)' },
      { value: 'sonnet[1m]', label: 'Sonnet (1M context)' },
      { value: 'opusplan', label: 'Opus plans, Sonnet builds' },
    ],
  },
  {
    label: 'Specific versions',
    options: [
      { value: 'claude-fable-5-1', label: 'Fable 5.1' },
      { value: 'claude-opus-5-5', label: 'Opus 5.5' },
      { value: 'claude-sonnet-5', label: 'Sonnet 5' },
      { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
  },
];

export const DEFAULT_MODEL_LABEL = 'Default (Claude Code’s choice)';

/**
 * The groups to offer for a select whose current value is `current`. A model saved earlier (or
 * typed before this was a select) that isn't listed is added so it isn't silently replaced.
 */
export function modelGroups(current: string): ModelGroup[] {
  const known = MODEL_GROUPS.some((group) => group.options.some((o) => o.value === current));
  if (current === '' || known) return MODEL_GROUPS;
  return [{ label: 'Current', options: [{ value: current, label: current }] }, ...MODEL_GROUPS];
}
