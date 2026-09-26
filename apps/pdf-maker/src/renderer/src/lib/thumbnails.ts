import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Source } from './types';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Longest edge of a rendered thumbnail, in device pixels. */
const THUMBNAIL_SIZE = 360;

const documents = new Map<string, PDFDocumentLoadingTask>();
const thumbnails = new Map<string, Promise<string>>();

// Render one page at a time so large PDFs don't swamp the renderer.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Resolves to an object URL showing the page as the source displays it. */
export function getThumbnail(source: Source, pageIndex: number): Promise<string> {
  const key = `${source.id}:${pageIndex}`;
  let thumbnail = thumbnails.get(key);
  if (!thumbnail) {
    thumbnail =
      source.kind === 'image'
        ? Promise.resolve(
            URL.createObjectURL(
              new Blob([source.bytes as Uint8Array<ArrayBuffer>], {
                type: source.format === 'png' ? 'image/png' : 'image/jpeg',
              }),
            ),
          )
        : enqueue(() => renderPdfPage(source, pageIndex));
    thumbnails.set(key, thumbnail);
  }
  return thumbnail;
}

/** Frees thumbnails and parsed documents for sources no longer in use. */
export function releaseSource(sourceId: string): void {
  for (const [key, thumbnail] of thumbnails) {
    if (key.startsWith(`${sourceId}:`)) {
      thumbnails.delete(key);
      void thumbnail.then(URL.revokeObjectURL, () => undefined);
    }
  }
  const task = documents.get(sourceId);
  if (task) {
    documents.delete(sourceId);
    void task.destroy();
  }
}

function loadDocument(source: Source) {
  let task = documents.get(source.id);
  if (!task) {
    // pdf.js transfers the buffer to its worker, so give it a copy.
    task = getDocument({ data: source.bytes.slice() });
    documents.set(source.id, task);
  }
  return task.promise;
}

async function renderPdfPage(source: Source, pageIndex: number): Promise<string> {
  const page = await (await loadDocument(source)).getPage(pageIndex + 1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: THUMBNAIL_SIZE / Math.max(base.width, base.height),
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not render thumbnail'))),
      'image/png',
    ),
  );
  return URL.createObjectURL(blob);
}
