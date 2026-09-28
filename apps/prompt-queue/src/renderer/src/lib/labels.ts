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

export const MODEL_SUGGESTIONS = ['sonnet', 'opus', 'haiku'];
