import type { InputFile } from './importFiles';

/** Opens a file picker: the native dialog in Electron, a file input in a browser. */
export async function pickFiles(): Promise<InputFile[]> {
  if (window.api) {
    const files = await window.api.openFiles();
    return files.map(({ name, data }) => ({ name, bytes: data }));
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'application/pdf,image/*';
  const files = await new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
  return files ? readFiles(files) : [];
}

export function readFiles(files: FileList | File[]): Promise<InputFile[]> {
  return Promise.all(
    Array.from(files).map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

/** Saves the PDF. Resolves to where it was saved, or null if the user cancelled. */
export async function savePdf(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
  if (window.api) return window.api.savePdf(bytes, suggestedName);
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return suggestedName;
}
