// Electron glue: checks GitHub releases, asks the user, downloads and verifies the update, and
// installs it as the app quits. The decisions live in releases.ts and install.ts.

import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { access, constants, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, type MenuItemConstructorOptions, net, shell } from 'electron';
import {
  installCommand,
  installMethod,
  MAC_SWAP_SCRIPT,
  macAppBundle,
  type PreparedUpdate,
} from './install';
import { parsePrefs, type UpdatePrefs } from './prefs';
import { type Asset, findUpdate, type InstallMethod, parseReleases, type Update } from './releases';

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdaterOptions {
  /** The app's package name, which prefixes its release tags (`<name>-v1.2.3`). */
  name: string;
  /** The GitHub repo that publishes the releases, as `owner/repo`. */
  repo: string;
}

export interface Updater {
  /** "Check for Updates…" and the automatic checks toggle, for the app's menu. */
  menuItems(): MenuItemConstructorOptions[];
  /** Starts automatic checks (if turned on): shortly after launch, then once a day. */
  start(): void;
}

export function createUpdater(options: UpdaterOptions): Updater {
  const prefsFile = join(app.getPath('userData'), 'updates.json');
  const prefs = loadPrefs(prefsFile);
  // Lets the e2e tests serve their own releases; ignored in the packaged app.
  const releasesUrl =
    (!app.isPackaged && process.env.UTILS_UPDATE_RELEASES_URL) ||
    `https://api.github.com/repos/${options.repo}/releases?per_page=100`;

  let checking = false;
  let ready: { version: string; prepared: PreparedUpdate } | undefined;
  let relaunch = false;

  const savePrefs = () => {
    try {
      mkdirSync(dirname(prefsFile), { recursive: true });
      writeFileSync(prefsFile, JSON.stringify(prefs));
    } catch (error) {
      console.warn('Could not save update preferences', error);
    }
  };

  async function check(manual: boolean) {
    if (ready) {
      if (manual) await offerRestart(ready.version);
      return;
    }
    if (checking) return;
    checking = true;
    try {
      const method = await availableMethod();
      const update = findUpdate(parseReleases(await fetchJson(releasesUrl)), {
        name: options.name,
        currentVersion: app.getVersion(),
        method,
        arch: process.arch,
      });
      if (!update) {
        if (manual) {
          await showMessage({
            type: 'info',
            message: 'You’re up to date',
            detail: `${app.name} ${app.getVersion()} is the latest version.`,
          });
        }
        return;
      }
      if (!manual && update.version === prefs.skipVersion) return;
      await offer(update, method);
    } catch (error) {
      if (manual) await showError('Couldn’t check for updates', error);
      else console.warn('Update check failed', error);
    } finally {
      checking = false;
    }
  }

  async function offer(update: Update, method: InstallMethod) {
    const current = `You have ${app.getVersion()}.`;
    const buttons = update.asset
      ? ['Install Update', 'Release Notes', 'Skip This Version', 'Later']
      : ['Open Download Page', 'Skip This Version', 'Later'];
    const { response } = await showMessage({
      type: 'info',
      message: `${app.name} ${update.version} is available`,
      detail: update.asset
        ? `${current} The update downloads in the background and installs when the app restarts.`
        : `${current} Download it from the release page and install it over this copy.`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
    });
    switch (buttons[response]) {
      case 'Install Update':
        if (update.asset && method !== 'manual')
          await install(update.version, update.asset, method);
        break;
      case 'Release Notes':
        void shell.openExternal(update.pageUrl);
        await offer(update, method);
        break;
      case 'Open Download Page':
        void shell.openExternal(update.pageUrl);
        break;
      case 'Skip This Version':
        prefs.skipVersion = update.version;
        savePrefs();
        break;
    }
  }

  async function install(version: string, asset: Asset, method: Exclude<InstallMethod, 'manual'>) {
    const window = parentWindow();
    try {
      const dir = await mkdtemp(join(app.getPath('temp'), `${options.name}-update-`));
      const file = join(dir, asset.name);
      await download(asset, file, (fraction) => window?.setProgressBar(fraction));
      const prepared = await prepare(method, file, dir);
      if (!ready) app.once('will-quit', launchInstaller);
      ready = { version, prepared };
    } catch (error) {
      await showError('Couldn’t download the update', error);
      return;
    } finally {
      window?.setProgressBar(-1);
    }
    await offerRestart(version);
  }

  function launchInstaller() {
    if (!ready) return;
    const { command, args } = installCommand(ready.prepared, process.pid, relaunch);
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', (error) => console.warn('Could not start the update', error));
    child.unref();
  }

  async function offerRestart(version: string) {
    const { response } = await showMessage({
      type: 'info',
      message: `${app.name} ${version} is ready to install`,
      detail: 'Restart now to finish updating, or it will install the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      relaunch = true;
      app.quit();
    }
  }

  return {
    menuItems: () => [
      {
        id: 'check-for-updates',
        label: 'Check for Updates…',
        click: () => void check(true),
      },
      {
        id: 'check-for-updates-automatically',
        label: 'Check for Updates Automatically',
        type: 'checkbox',
        checked: prefs.autoCheck,
        click: (item) => {
          prefs.autoCheck = item.checked;
          savePrefs();
        },
      },
    ],
    start() {
      const automaticCheck = () => {
        if (prefs.autoCheck) void check(false);
      };
      setTimeout(automaticCheck, FIRST_CHECK_DELAY_MS);
      setInterval(automaticCheck, CHECK_INTERVAL_MS);
    },
  };
}

function loadPrefs(file: string): UpdatePrefs {
  try {
    return parsePrefs(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return parsePrefs(undefined);
  }
}

/** The install method, downgraded to manual when the app can't replace its own files. */
async function availableMethod(): Promise<InstallMethod> {
  const method = installMethod({
    platform: process.platform,
    isPackaged: app.isPackaged,
    exePath: process.execPath,
    env: process.env,
  });
  if (method !== 'mac-zip') return method;
  const bundle = macAppBundle(process.execPath);
  if (!bundle) return 'manual';
  try {
    await access(dirname(bundle), constants.W_OK);
    await access(bundle, constants.W_OK);
    return method;
  } catch {
    return 'manual';
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`GitHub replied with HTTP ${response.status}.`);
  return response.json();
}

/** Downloads the asset to `file`, reporting progress, and checks its SHA-256. */
async function download(asset: Asset, file: string, onProgress: (fraction: number) => void) {
  const response = await net.fetch(asset.url);
  if (!response.ok || !response.body) {
    throw new Error(`The download failed with HTTP ${response.status}.`);
  }
  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      received += chunk.length;
      if (asset.size > 0) onProgress(Math.min(received / asset.size, 1));
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    meter,
    createWriteStream(file),
  );
  if (hash.digest('hex') !== asset.sha256) {
    throw new Error('The downloaded file didn’t match its published checksum.');
  }
}

async function prepare(
  method: Exclude<InstallMethod, 'manual'>,
  file: string,
  dir: string,
): Promise<PreparedUpdate> {
  if (method === 'win-nsis') return { method, installer: file };
  const bundle = macAppBundle(process.execPath);
  if (!bundle) throw new Error('The app isn’t running from an application bundle.');
  const extracted = join(dir, 'extracted');
  // ditto keeps the bundle's symlinks, permissions and signature intact.
  await promisify(execFile)('/usr/bin/ditto', ['-x', '-k', file, extracted]);
  const apps = (await readdir(extracted)).filter((entry) => entry.endsWith('.app'));
  if (apps.length !== 1 || !apps[0]) throw new Error('The download doesn’t contain the app.');
  const script = join(dir, 'install.sh');
  await writeFile(script, MAC_SWAP_SCRIPT);
  return { method, script, bundle, newBundle: join(extracted, apps[0]) };
}

function parentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
}

function showMessage(options: Electron.MessageBoxOptions) {
  const window = parentWindow();
  return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);
}

async function showError(message: string, error: unknown) {
  await showMessage({
    type: 'warning',
    message,
    detail: error instanceof Error ? error.message : String(error),
  });
}
