import type { DesktopApi } from './api';

declare global {
  interface Window {
    /** Undefined when the renderer runs in a plain browser (`pnpm dev:web`). */
    api?: DesktopApi;
  }
}
