export type FileKind = 'pdf' | 'png' | 'jpg' | 'other';

export function detectKind(bytes: Uint8Array): FileKind {
  // A PDF header may be preceded by junk; the spec allows it within the first 1 KB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  if (head.includes('%PDF-')) return 'pdf';
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return 'other';
}

export interface ImageInfo {
  /** Pixel size as stored in the file (before EXIF orientation). */
  width: number;
  height: number;
  /** EXIF orientation tag (1-8); 1 when absent. */
  orientation: number;
}

export function pngInfo(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Signature (8) + IHDR length (4) + "IHDR" (4), then width and height.
  return { width: view.getUint32(16), height: view.getUint32(20), orientation: 1 };
}

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export function jpegInfo(bytes: Uint8Array): ImageInfo {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset++;
      continue;
    }
    const marker = view.getUint8(offset + 1);
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      orientation = readExifOrientation(view, offset + 4, length - 2) ?? orientation;
    }
    if (SOF_MARKERS.has(marker)) {
      return {
        height: view.getUint16(offset + 5),
        width: view.getUint16(offset + 7),
        orientation,
      };
    }
    offset += 2 + length;
  }
  throw new Error('Could not read JPEG dimensions');
}

function readExifOrientation(view: DataView, start: number, length: number): number | undefined {
  const end = start + length;
  // "Exif\0\0"
  if (end > view.byteLength || view.getUint32(start) !== 0x45786966) return undefined;
  const tiff = start + 6;
  const little = view.getUint16(tiff) === 0x4949;
  const ifd = tiff + view.getUint32(tiff + 4, little);
  if (ifd + 2 > end) return undefined;
  const entries = view.getUint16(ifd, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return undefined;
    if (view.getUint16(entry, little) === 0x0112) {
      const value = view.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : undefined;
    }
  }
  return undefined;
}

/**
 * Clockwise rotation needed to display an image with the given EXIF orientation.
 * Returns undefined for mirrored orientations (2, 4, 5, 7), which need re-encoding.
 */
export function exifRotation(orientation: number): 0 | 90 | 180 | 270 | undefined {
  switch (orientation) {
    case 1:
      return 0;
    case 3:
      return 180;
    case 6:
      return 90;
    case 8:
      return 270;
    default:
      return undefined;
  }
}
