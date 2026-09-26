import { describe, expect, it } from 'vitest';
import { JPEG_4X2_ORIENTATION_6, makePdf, makePng } from './__fixtures__/fixtures';
import { detectKind, exifRotation, jpegInfo, pngInfo } from './imageInfo';

describe('detectKind', () => {
  it('recognises PDFs, PNGs and JPEGs by content', async () => {
    expect(detectKind(await makePdf([[100, 100]]))).toBe('pdf');
    expect(detectKind(makePng(1, 1))).toBe('png');
    expect(detectKind(JPEG_4X2_ORIENTATION_6)).toBe('jpg');
    expect(detectKind(new TextEncoder().encode('hello'))).toBe('other');
  });
});

describe('image headers', () => {
  it('reads PNG dimensions', () => {
    expect(pngInfo(makePng(7, 3))).toEqual({ width: 7, height: 3, orientation: 1 });
  });

  it('reads JPEG dimensions and EXIF orientation', () => {
    expect(jpegInfo(JPEG_4X2_ORIENTATION_6)).toEqual({ width: 4, height: 2, orientation: 6 });
  });

  it('maps EXIF orientation to clockwise rotation', () => {
    expect(exifRotation(1)).toBe(0);
    expect(exifRotation(6)).toBe(90);
    expect(exifRotation(3)).toBe(180);
    expect(exifRotation(8)).toBe(270);
    expect(exifRotation(2)).toBeUndefined();
  });
});
