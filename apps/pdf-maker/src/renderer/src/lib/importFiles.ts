import { EncryptedPDFError, PDFDocument } from 'pdf-lib';
import { createId } from './ids';
import { detectKind, exifRotation, jpegInfo, pngInfo } from './imageInfo';
import { normalizeRotation, rotatedSize } from './layout';
import type { ImageFormat, PageItem, Rotation, Source } from './types';

/** Images have no physical size, so treat pixels as 96 DPI (the CSS pixel). */
export const PX_TO_PT = 72 / 96;

export interface InputFile {
  name: string;
  bytes: Uint8Array;
}

export interface ConvertedImage {
  bytes: Uint8Array;
  format: ImageFormat;
  width: number;
  height: number;
}

/**
 * Re-encodes an image pdf-lib can't embed directly (WebP, GIF, BMP, mirrored
 * JPEGs, ...) as PNG or JPEG, with orientation already applied. Supplied by the
 * renderer, which can decode images with the browser.
 */
export type ImageConverter = (file: InputFile) => Promise<ConvertedImage>;

export interface ImportResult {
  sources: Source[];
  pages: PageItem[];
  errors: string[];
}

export async function importFiles(
  files: InputFile[],
  convertImage?: ImageConverter,
): Promise<ImportResult> {
  const result: ImportResult = { sources: [], pages: [], errors: [] };
  for (const file of files) {
    try {
      const imported = await importFile(file, convertImage);
      result.sources.push(imported.source);
      result.pages.push(...imported.pages);
    } catch (error) {
      result.errors.push(describeError(file.name, error));
    }
  }
  return result;
}

async function importFile(file: InputFile, convertImage?: ImageConverter) {
  const kind = detectKind(file.bytes);
  if (kind === 'pdf') return importPdf(file);

  if (kind === 'png' || kind === 'jpg') {
    const info = kind === 'png' ? pngInfo(file.bytes) : jpegInfo(file.bytes);
    const rotation = exifRotation(info.orientation);
    if (rotation !== undefined) {
      return importImage(file.name, file.bytes, kind, info.width, info.height, rotation);
    }
  }

  if (!convertImage) throw new UnsupportedFileError();
  let converted: ConvertedImage;
  try {
    converted = await convertImage(file);
  } catch {
    throw new UnsupportedFileError();
  }
  return importImage(
    file.name,
    converted.bytes,
    converted.format,
    converted.width,
    converted.height,
    0,
  );
}

async function importPdf(file: InputFile) {
  const doc = await PDFDocument.load(file.bytes, { updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error('it has no pages');

  const source: Source = {
    id: createId('src'),
    name: file.name,
    kind: 'pdf',
    bytes: file.bytes,
    pageCount: count,
  };
  const pages = doc.getPages().map((page, pageIndex): PageItem => {
    const crop = page.getCropBox();
    const sourceRotation = normalizeRotation(page.getRotation().angle);
    return {
      id: createId('page'),
      sourceId: source.id,
      pageIndex,
      ...rotatedSize(crop.width, crop.height, sourceRotation),
      sourceRotation,
      rotation: 0,
    };
  });
  return { source, pages };
}

function importImage(
  name: string,
  bytes: Uint8Array,
  format: ImageFormat,
  pixelWidth: number,
  pixelHeight: number,
  sourceRotation: Rotation,
) {
  const source: Source = { id: createId('src'), name, kind: 'image', bytes, format };
  const size = rotatedSize(pixelWidth * PX_TO_PT, pixelHeight * PX_TO_PT, sourceRotation);
  const page: PageItem = {
    id: createId('page'),
    sourceId: source.id,
    pageIndex: 0,
    ...size,
    sourceRotation,
    rotation: 0,
  };
  return { source, pages: [page] };
}

class UnsupportedFileError extends Error {
  constructor() {
    super('it is not a PDF or an image format that can be read');
  }
}

function describeError(name: string, error: unknown): string {
  if (error instanceof EncryptedPDFError) {
    return `Couldn't add ${name}: encrypted or password-protected PDFs aren't supported.`;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return `Couldn't add ${name}: ${reason}.`;
}
