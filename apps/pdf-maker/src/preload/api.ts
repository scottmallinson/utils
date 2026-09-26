export interface OpenedFile {
  name: string;
  data: Uint8Array;
}

export type MenuCommand = 'add-files' | 'save';

/** The API the preload script exposes to the renderer as `window.api`. */
export interface DesktopApi {
  openFiles(): Promise<OpenedFile[]>;
  /** Shows a save dialog and writes the PDF. Resolves to the path, or null if cancelled. */
  savePdf(data: Uint8Array, suggestedName: string): Promise<string | null>;
  showInFolder(path: string): Promise<void>;
  onMenuCommand(listener: (command: MenuCommand) => void): () => void;
}
