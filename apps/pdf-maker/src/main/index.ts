import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  shell,
} from 'electron';
import type { MenuCommand, OpenedFile } from '../preload/api';

const OPEN_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif'];

/** Paths this session saved to; the renderer may only reveal these. */
const savedPaths = new Set<string>();

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'PDF Maker',
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

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

function sendMenuCommand(command: MenuCommand) {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command);
}

function buildMenu(): Menu {
  const isMac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Files…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuCommand('add-files'),
        },
        {
          label: 'Save PDF…',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuCommand('save'),
        },
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

function registerIpc() {
  ipcMain.handle('files:open', async (event): Promise<OpenedFile[]> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Add files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'PDFs and images', extensions: OPEN_EXTENSIONS },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    return Promise.all(
      result.filePaths.map(async (path) => ({
        name: basename(path),
        data: new Uint8Array(await readFile(path)),
      })),
    );
  });

  ipcMain.handle(
    'pdf:save',
    async (event, data: unknown, suggestedName: unknown): Promise<string | null> => {
      if (!(data instanceof Uint8Array)) throw new TypeError('Expected PDF bytes');
      const name =
        typeof suggestedName === 'string' && suggestedName.trim() ? suggestedName : 'Document.pdf';
      const window = BrowserWindow.fromWebContents(event.sender);
      const options: Electron.SaveDialogOptions = {
        title: 'Save PDF',
        defaultPath: join(app.getPath('documents'), basename(name)),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      };
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      await writeFile(result.filePath, data);
      savedPaths.add(result.filePath);
      return result.filePath;
    },
  );

  ipcMain.handle('shell:show-in-folder', (_event, path: unknown) => {
    if (typeof path === 'string' && savedPaths.has(path)) shell.showItemInFolder(path);
  });
}

void app.whenReady().then(() => {
  Menu.setApplicationMenu(buildMenu());
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
