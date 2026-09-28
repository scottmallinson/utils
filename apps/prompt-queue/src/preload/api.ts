import type { Command } from '../shared/commands';
import type { AppState } from '../shared/types';

export type MenuCommand = 'new-prompt' | 'add-repo' | 'settings' | 'toggle-pause';

export interface CliCheck {
  ok: boolean;
  path?: string;
  version?: string;
  error?: string;
}

/** The API the preload script exposes to the renderer as `window.api`. */
export interface DesktopApi {
  platform: string;
  getState(): Promise<AppState>;
  onState(listener: (state: AppState) => void): () => void;
  send(command: Command): Promise<void>;
  /** Shows a folder picker and adds the chosen repo. */
  addRepo(): Promise<void>;
  /** Opens the repo's folder in the file manager. */
  openRepo(repoId: string): Promise<void>;
  copyText(text: string): Promise<void>;
  checkClaude(): Promise<CliCheck>;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
}
