import { describe, expect, it } from 'vitest';
import { parsePrefs } from './prefs';

describe('parsePrefs', () => {
  it('defaults to automatic checks', () => {
    expect(parsePrefs(undefined)).toEqual({ autoCheck: true });
    expect(parsePrefs({ autoCheck: 'no' })).toEqual({ autoCheck: true });
  });

  it('keeps saved choices', () => {
    expect(parsePrefs({ autoCheck: false, skipVersion: '0.2.0' })).toEqual({
      autoCheck: false,
      skipVersion: '0.2.0',
    });
  });
});
