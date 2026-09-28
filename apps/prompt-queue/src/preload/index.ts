import { contextBridge, type IpcRendererEvent, ipcRenderer } from 'electron';
import type { DesktopApi, MenuCommand } from './api';

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: DesktopApi = {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (listener) => subscribe('state:changed', listener),
  send: (command) => ipcRenderer.invoke('command', command),
  addRepo: () => ipcRenderer.invoke('repo:add'),
  openRepo: (repoId) => ipcRenderer.invoke('repo:open', repoId),
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  checkClaude: () => ipcRenderer.invoke('claude:check'),
  onMenuCommand: (listener) => subscribe<MenuCommand>('menu:command', listener),
};

contextBridge.exposeInMainWorld('api', api);
