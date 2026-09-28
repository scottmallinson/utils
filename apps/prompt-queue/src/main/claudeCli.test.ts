import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executableNames, extraDirs, findExecutable, mergePathLists } from './claudeCli';

describe('mergePathLists', () => {
  it('joins lists, keeping the first of each directory', () => {
    expect(mergePathLists(['/a:/b', undefined, '/b:/c:', ' '], ':')).toBe('/a:/b:/c');
  });
});

describe('findExecutable', () => {
  it('returns the first match in directory order', async () => {
    const existing = new Set([join('/two', 'claude.cmd'), join('/three', 'claude.exe')]);
    const found = await findExecutable(
      ['/one', '/two', '/three'],
      executableNames('win32'),
      async (p) => existing.has(p),
    );
    expect(found).toBe(join('/two', 'claude.cmd'));
    expect(await findExecutable(['/one'], ['claude'], async () => false)).toBeUndefined();
  });
});

describe('extraDirs', () => {
  it('includes the native installer location', () => {
    expect(extraDirs('darwin', '/Users/me', {})).toContain(join('/Users/me', '.local', 'bin'));
    expect(extraDirs('win32', 'C:\\Users\\me', { APPDATA: 'C:\\AppData' })).toContain(
      join('C:\\AppData', 'npm'),
    );
  });
});
