import type { DesktopApi } from './api';

declare global {
  interface Window {
    api: DesktopApi;
  }
}
