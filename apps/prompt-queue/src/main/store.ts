import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadState } from '../shared/persist';
import { type AppState, createInitialState } from '../shared/types';

const SAVE_DELAY_MS = 500;

/** Keeps the app state in a JSON file, written atomically and at most twice a second. */
export class Store {
  private pending?: AppState;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly file: string) {}

  load(): AppState {
    let text: string;
    try {
      text = readFileSync(this.file, 'utf8');
    } catch {
      return createInitialState();
    }
    try {
      return loadState(JSON.parse(text));
    } catch {
      // Keep the unreadable file for inspection rather than overwriting it.
      try {
        renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        // Nothing more to do.
      }
      return createInitialState();
    }
  }

  save(state: AppState) {
    this.pending = state;
    this.timer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const state = this.pending;
    this.pending = undefined;
    if (!state) return;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(state));
    renameSync(temp, this.file);
  }
}
