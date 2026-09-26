import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { DesktopApi, MenuCommand } from './api';

const api: DesktopApi = {
  openFiles: () => ipcRenderer.invoke('files:open'),
  savePdf: (data, suggestedName) => ipcRenderer.invoke('pdf:save', data, suggestedName),
  showInFolder: (path) => ipcRenderer.invoke('shell:show-in-folder', path),
  onMenuCommand: (listener) => {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on('menu:command', handler);
    return () => {
      ipcRenderer.removeListener('menu:command', handler);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
