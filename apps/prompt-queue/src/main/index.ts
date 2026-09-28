import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  Notification,
  powerSaveBlocker,
  shell,
} from 'electron';
import type { MenuCommand } from '../preload/api';
import { parseCommand } from '../shared/commands';
import type { AppState } from '../shared/types';
import { checkClaude } from './claudeCli';
import { Engine, type Notice } from './engine';
import { startClaudeRun } from './runner';
import { Store } from './store';

const BROADCAST_INTERVAL_MS = 150;

let mainWindow: BrowserWindow | undefined;
let engine: Engine;
let store: Store;
let quitConfirmed = false;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 520,
    show: false,
    title: 'Prompt Queue',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.once('ready-to-show', () => window.show());

  // The app is a single page: never navigate away or open new windows.
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // On Windows and Linux closing the window quits, so check before stopping runs.
  window.on('close', (event) => {
    if (process.platform === 'darwin' || quitConfirmed || !engine.hasRunning()) return;
    event.preventDefault();
    if (confirmStopRuns(window)) {
      quitConfirmed = true;
      window.close();
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

function confirmStopRuns(window?: BrowserWindow): boolean {
  const options: Electron.MessageBoxSyncOptions = {
    type: 'warning',
    buttons: ['Stop and Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Prompts are still running',
    detail:
      'Quitting stops them. You can retry them, or reply to continue their sessions, next time.',
  };
  const choice = window
    ? dialog.showMessageBoxSync(window, options)
    : dialog.showMessageBoxSync(options);
  return choice === 0;
}

function sendMenuCommand(command: MenuCommand) {
  const window = mainWindow ?? createWindow();
  mainWindow = window;
  window.show();
  window.webContents.send('menu:command', command);
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const settings: MenuItemConstructorOptions = {
    label: isMac ? 'Settings…' : 'Settings',
    accelerator: 'CmdOrCtrl+,',
    click: () => sendMenuCommand('settings'),
  };
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            role: 'appMenu',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settings,
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Prompt',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand('new-prompt'),
        },
        {
          label: 'Add Repository…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenuCommand('add-repo'),
        },
        { type: 'separator' },
        {
          label: 'Pause or Resume Queue',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => sendMenuCommand('toggle-pause'),
        },
        ...(isMac ? [] : [{ type: 'separator' } as const, settings]),
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

/** Sends state to the window at most every BROADCAST_INTERVAL_MS, always ending on the latest. */
function createBroadcaster() {
  let latest: AppState | undefined;
  let scheduled = false;
  return (state: AppState) => {
    latest = state;
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      if (latest) mainWindow?.webContents.send('state:changed', latest);
      latest = undefined;
    }, BROADCAST_INTERVAL_MS);
  };
}

/** Keeps the computer awake while prompts run, and shows how many need attention. */
function createStatusUpdater() {
  let blocker: number | undefined;
  return (state: AppState) => {
    const running = state.items.some((item) => item.status === 'running');
    if (running && blocker === undefined) {
      blocker = powerSaveBlocker.start('prevent-app-suspension');
    } else if (!running && blocker !== undefined) {
      powerSaveBlocker.stop(blocker);
      blocker = undefined;
    }
    const attention = state.items.filter(
      (item) => item.status === 'needs-feedback' || item.status === 'error',
    ).length;
    app.setBadgeCount(attention);
  };
}

function showNotice(notice: Notice) {
  if (!engine.getState().settings.notifications || !Notification.isSupported()) return;
  const title = (item: { turns: { prompt: string }[] }) =>
    (item.turns[0]?.prompt.split('\n')[0] ?? '').slice(0, 80);
  let content: { title: string; body: string } | undefined;
  switch (notice.kind) {
    case 'needs-feedback':
      content = { title: 'Waiting for your feedback', body: title(notice.item) };
      break;
    case 'error':
      content = { title: 'Prompt failed', body: title(notice.item) };
      break;
    case 'limited':
      content = { title: 'Usage limit reached', body: `${notice.message}. The queue will resume.` };
      break;
    case 'paused':
      content = { title: 'Queue paused', body: notice.message };
      break;
    case 'drained':
      content = { title: 'Queue finished', body: 'Every queued prompt has run.' };
      break;
    case 'completed':
      return;
  }
  const notification = new Notification({ ...content, silent: false });
  notification.on('click', () => {
    mainWindow ??= createWindow();
    mainWindow.show();
  });
  notification.show();
}

function registerIpc() {
  const fromMainWindow = (event: Electron.IpcMainInvokeEvent) =>
    mainWindow !== undefined && event.sender === mainWindow.webContents;

  ipcMain.handle('state:get', () => engine.getState());

  ipcMain.handle('command', (event, raw: unknown) => {
    if (!fromMainWindow(event)) return;
    const command = parseCommand(raw);
    if (!command) throw new TypeError('Invalid command');
    engine.command(command);
  });

  ipcMain.handle('repo:add', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Add repository',
      buttonLabel: 'Add',
      properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return;
    for (const path of result.filePaths) engine.addRepo(basename(path) || path, path);
  });

  ipcMain.handle('repo:open', (_event, repoId: unknown) => {
    const repo = engine.getState().repos.find((candidate) => candidate.id === repoId);
    if (repo) void shell.openPath(repo.path);
  });

  ipcMain.handle('clipboard:write', (_event, text: unknown) => {
    if (typeof text === 'string' && text.length <= 10_000) clipboard.writeText(text);
  });

  ipcMain.handle('claude:check', () => checkClaude(engine.getState().settings.claudePath));
}

void app.whenReady().then(() => {
  store = new Store(join(app.getPath('userData'), 'state.json'));
  const broadcast = createBroadcaster();
  const updateStatus = createStatusUpdater();
  engine = new Engine({
    state: store.load(),
    startRun: startClaudeRun,
    onChange: (state) => {
      store.save(state);
      broadcast(state);
      updateStatus(state);
    },
    onNotice: showNotice,
  });

  Menu.setApplicationMenu(buildMenu());
  registerIpc();
  mainWindow = createWindow();
  engine.start();

  app.on('activate', () => {
    mainWindow ??= createWindow();
    mainWindow.show();
  });
});

// On macOS the queue keeps running with the window closed, like other Mac apps.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitConfirmed || !engine?.hasRunning()) return;
  event.preventDefault();
  if (confirmStopRuns(mainWindow)) {
    quitConfirmed = true;
    app.quit();
  }
});

app.on('will-quit', () => {
  engine?.dispose();
  store?.flush();
});
