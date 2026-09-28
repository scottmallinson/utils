import { describe, expect, it } from 'vitest';
import { MAX_PROMPT_LENGTH, mergeSettings, parseCommand } from './commands';
import { DEFAULT_SETTINGS } from './types';

describe('parseCommand', () => {
  const add = {
    type: 'add',
    repoId: 'r-1',
    prompt: '  Fix the bug  ',
    priority: 'high',
    options: { model: 'sonnet', permissionMode: 'plan' },
  };

  it('accepts and cleans valid commands', () => {
    expect(parseCommand(add)).toEqual({ ...add, prompt: 'Fix the bug', atTop: false });
    expect(parseCommand({ type: 'move', itemId: 'a', targetId: 'b' })).toEqual({
      type: 'move',
      itemId: 'a',
      targetId: 'b',
      repoId: undefined,
    });
    expect(parseCommand({ type: 'reply', itemId: 'a', text: 'yes' })).toEqual({
      type: 'reply',
      itemId: 'a',
      text: 'yes',
      options: {},
    });
    expect(parseCommand({ type: 'retry', itemId: 'a', extra: 1 })).toEqual({
      type: 'retry',
      itemId: 'a',
    });
    expect(
      parseCommand({ type: 'setPermissionMode', itemId: 'a', permissionMode: 'plan' }),
    ).toEqual({ type: 'setPermissionMode', itemId: 'a', permissionMode: 'plan' });
    expect(parseCommand({ type: 'setPaused', paused: true })).toEqual({
      type: 'setPaused',
      paused: true,
    });
  });

  it.each([
    null,
    'add',
    { type: 'nope' },
    { ...add, prompt: '   ' },
    { ...add, prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) },
    { ...add, priority: 'urgent' },
    { ...add, repoId: '../etc' },
    { ...add, options: { model: 'opus; rm -rf', permissionMode: 'plan' } },
    { ...add, options: { model: 'opus', permissionMode: 'yolo' } },
    { ...add, options: { model: 'opus' } },
    { type: 'edit', itemId: 'a', prompt: '' },
    { type: 'move', itemId: 'a' },
    { type: 'moveToEnd', itemId: 'a', end: 'middle' },
    { type: 'setPermissionMode', itemId: 'a', permissionMode: 'yolo' },
    { type: 'setPermissionMode', permissionMode: 'plan' },
    { type: 'setPaused', paused: 'yes' },
    { type: 'resumeTool', toolId: 'other' },
    { type: 'updateSettings', settings: [] },
  ])('rejects %j', (value) => {
    expect(parseCommand(value)).toBeUndefined();
  });
});

describe('mergeSettings', () => {
  it('keeps valid fields and clamps numbers', () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, {
        maxConcurrent: 0,
        holdLowAbove: 150,
        holdNormalAbove: 80.4,
        defaultPermissionMode: 'plan',
        defaultModel: ' opus ',
        claudePath: '/usr/local/bin/claude',
        pauseRepoOnFeedback: 'no',
      }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      maxConcurrent: 1,
      holdLowAbove: 100,
      holdNormalAbove: 80,
      defaultPermissionMode: 'plan',
      defaultModel: 'opus',
      claudePath: '/usr/local/bin/claude',
    });
  });

  it('ignores invalid values', () => {
    expect(
      mergeSettings(DEFAULT_SETTINGS, {
        defaultModel: 'a b',
        defaultPermissionMode: 'x',
        maxConcurrent: NaN,
      }),
    ).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, 'nope')).toBe(DEFAULT_SETTINGS);
  });
});
