import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installCommand, installMethod, MAC_SWAP_SCRIPT, macAppBundle } from './install';

describe('macAppBundle', () => {
  it('finds the bundle from the executable path', () => {
    expect(macAppBundle('/Applications/PDF Maker.app/Contents/MacOS/PDF Maker')).toBe(
      '/Applications/PDF Maker.app',
    );
  });

  it('rejects translocated copies and non-bundles', () => {
    expect(
      macAppBundle(
        '/private/var/folders/x/AppTranslocation/1/d/PDF Maker.app/Contents/MacOS/PDF Maker',
      ),
    ).toBeUndefined();
    expect(macAppBundle('/usr/local/bin/electron')).toBeUndefined();
  });
});

describe('installMethod', () => {
  const base = { isPackaged: true, env: {} };

  it('updates installed copies in place', () => {
    expect(
      installMethod({
        ...base,
        platform: 'darwin',
        exePath: '/Applications/A.app/Contents/MacOS/A',
      }),
    ).toBe('mac-zip');
    expect(installMethod({ ...base, platform: 'win32', exePath: 'C:\\A\\A.exe' })).toBe('win-nsis');
  });

  it('falls back to a manual download otherwise', () => {
    const win = { ...base, platform: 'win32', exePath: 'C:\\A.exe' } as const;
    expect(installMethod({ ...win, env: { PORTABLE_EXECUTABLE_FILE: 'C:\\A.exe' } })).toBe(
      'manual',
    );
    expect(installMethod({ ...win, isPackaged: false })).toBe('manual');
    expect(installMethod({ ...base, platform: 'linux', exePath: '/opt/a/a' })).toBe('manual');
  });
});

describe('installCommand', () => {
  it('runs the swap script on macOS', () => {
    const prepared = {
      method: 'mac-zip',
      script: '/tmp/u/install.sh',
      bundle: '/Applications/A.app',
      newBundle: '/tmp/u/extracted/A.app',
    } as const;
    expect(installCommand(prepared, 42, true)).toEqual({
      command: '/bin/sh',
      args: ['/tmp/u/install.sh', '42', '/Applications/A.app', '/tmp/u/extracted/A.app', '1'],
    });
  });

  it('runs the NSIS installer silently on Windows, relaunching only on restart', () => {
    const prepared = { method: 'win-nsis', installer: 'C:\\t\\a.exe' } as const;
    expect(installCommand(prepared, 1, true).args).toEqual(['/S', '--updated', '--force-run']);
    expect(installCommand(prepared, 1, false).args).toEqual(['/S', '--updated']);
  });
});

describe('MAC_SWAP_SCRIPT', () => {
  const run = (args: string[]) =>
    new Promise<number | null>((resolve) =>
      spawn('/bin/sh', args, { stdio: 'ignore' }).on('exit', resolve),
    );

  it('waits for the app to quit, then swaps the bundle', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swap-'));
    const app = join(dir, 'Apps', 'My App.app');
    const next = join(dir, 'update', 'My App.app');
    await mkdir(app, { recursive: true });
    await mkdir(next, { recursive: true });
    await writeFile(join(app, 'version'), 'old');
    await writeFile(join(next, 'version'), 'new');
    const script = join(dir, 'install.sh');
    await writeFile(script, MAC_SWAP_SCRIPT);

    const running = spawn('sleep', ['0.5']);
    const started = Date.now();
    expect(await run([script, String(running.pid), app, next, '0'])).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(await readFile(join(app, 'version'), 'utf8')).toBe('new');
    expect(await readdir(join(dir, 'Apps'))).toEqual(['My App.app']);
  });

  it('keeps the old bundle when the new one is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'swap-'));
    const app = join(dir, 'My App.app');
    await mkdir(app);
    await writeFile(join(app, 'version'), 'old');
    const script = join(dir, 'install.sh');
    await writeFile(script, MAC_SWAP_SCRIPT);

    await run([script, '999999999', app, join(dir, 'missing.app'), '0']);
    expect(await readFile(join(app, 'version'), 'utf8')).toBe('old');
    expect((await readdir(dir)).sort()).toEqual(['My App.app', 'install.sh']);
  });
});
