import { describe, expect, it } from 'vitest';
import { isValidModel } from '../../../shared/claude/args';
import { MODEL_GROUPS, modelGroups } from './labels';

const values = (current: string) =>
  modelGroups(current).flatMap((group) => group.options.map((o) => o.value));

describe('MODEL_GROUPS', () => {
  it('only offers values the command validator accepts, without duplicates', () => {
    const all = MODEL_GROUPS.flatMap((group) => group.options.map((o) => o.value));
    expect(all.every((value) => value !== '' && isValidModel(value))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('modelGroups', () => {
  it('returns the standard list for the default and for listed models', () => {
    expect(modelGroups('')).toBe(MODEL_GROUPS);
    expect(modelGroups('opus')).toBe(MODEL_GROUPS);
  });

  it('keeps an unlisted model selectable', () => {
    expect(values('claude-sonnet-4-5')[0]).toBe('claude-sonnet-4-5');
    expect(values('claude-sonnet-4-5')).toContain('opus');
  });
});
