import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { JPEG_4X2_ORIENTATION_6, makePdf, makePng } from './__fixtures__/fixtures';
import { buildPdf } from './buildPdf';
import { importFiles, PX_TO_PT } from './importFiles';
import { PAGE_SIZES } from './layout';
import { initialState, reducer } from './state';
import type { LayoutSettings } from './types';

const sourceSettings: LayoutSettings = { pageSize: 'source', orientation: 'auto', margin: 'none' };

async function pageSizes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return [Math.round(width), Math.round(height)];
  });
}

describe('importFiles', () => {
  it('creates a page per PDF page, applying /Rotate to the displayed size', async () => {
    const pdf = await makePdf([
      [100, 200],
      [300, 400, 90],
    ]);
    const result = await importFiles([{ name: 'doc.pdf', bytes: pdf }]);
    expect(result.errors).toEqual([]);
    expect(result.sources).toHaveLength(1);
    expect(result.pages.map((p) => [p.pageIndex, p.width, p.height, p.sourceRotation])).toEqual([
      [0, 100, 200, 0],
      [1, 400, 300, 90],
    ]);
  });

  it('sizes images at 96 DPI and honours EXIF rotation', async () => {
    const result = await importFiles([
      { name: 'a.png', bytes: makePng(40, 20) },
      { name: 'b.jpg', bytes: JPEG_4X2_ORIENTATION_6 },
    ]);
    expect(result.errors).toEqual([]);
    const [png, jpg] = result.pages;
    expect([png?.width, png?.height]).toEqual([40 * PX_TO_PT, 20 * PX_TO_PT]);
    expect([jpg?.width, jpg?.height, jpg?.sourceRotation]).toEqual([
      2 * PX_TO_PT,
      4 * PX_TO_PT,
      90,
    ]);
  });

  it('reports unsupported files without failing the rest', async () => {
    const result = await importFiles([
      { name: 'notes.txt', bytes: new TextEncoder().encode('hi') },
      { name: 'a.png', bytes: makePng(2, 2) },
    ]);
    expect(result.pages).toHaveLength(1);
    expect(result.errors).toEqual([
      "Couldn't add notes.txt: it is not a PDF or an image format that can be read.",
    ]);
  });

  it('uses the converter for formats it cannot embed directly', async () => {
    const png = makePng(8, 4);
    const result = await importFiles(
      [{ name: 'x.webp', bytes: new Uint8Array([1, 2, 3]) }],
      async () => ({
        bytes: png,
        format: 'png',
        width: 8,
        height: 4,
      }),
    );
    expect(result.errors).toEqual([]);
    expect(result.sources[0]).toMatchObject({ kind: 'image', format: 'png', bytes: png });
  });
});

describe('buildPdf', () => {
  it('combines PDFs and images in page order', async () => {
    const imported = await importFiles([
      {
        name: 'doc.pdf',
        bytes: await makePdf([
          [100, 200],
          [300, 400],
        ]),
      },
      { name: 'a.png', bytes: makePng(40, 20) },
    ]);
    let state = reducer(initialState, { type: 'add', ...imported });
    state = reducer(state, { type: 'move', from: 2, to: 0 });

    const output = await buildPdf(state.pages, state.sources, sourceSettings);
    expect(await pageSizes(output)).toEqual([
      [30, 15],
      [100, 200],
      [300, 400],
    ]);
  });

  it('applies user and source rotation to the output page size', async () => {
    const imported = await importFiles([
      { name: 'doc.pdf', bytes: await makePdf([[100, 200, 90]]) },
      { name: 'b.jpg', bytes: JPEG_4X2_ORIENTATION_6 },
    ]);
    let state = reducer(initialState, { type: 'add', ...imported });
    state = reducer(state, { type: 'rotate', pageId: state.pages[0]?.id ?? '', degrees: 90 });

    const output = await buildPdf(state.pages, state.sources, sourceSettings);
    // /Rotate 90 + user 90 = 180: back to the unrotated 100 x 200.
    // The JPEG is 4 x 2 px displayed as 2 x 4 px = 1.5 x 3 pt.
    expect(await pageSizes(output)).toEqual([
      [100, 200],
      [2, 3],
    ]);
    const doc = await PDFDocument.load(output);
    // Rotation is baked into the content, not left as /Rotate.
    expect(doc.getPage(0).getRotation().angle).toBe(0);
  });

  it('keeps blank source pages, which have no content stream', async () => {
    const imported = await importFiles([
      { name: 'blank.pdf', bytes: await makePdf([[100, 200]], { blank: true }) },
    ]);
    const state = reducer(initialState, { type: 'add', ...imported });
    const output = await buildPdf(state.pages, state.sources, sourceSettings);
    expect(await pageSizes(output)).toEqual([[100, 200]]);
  });

  it('uses a fixed page size with automatic orientation', async () => {
    const imported = await importFiles([
      {
        name: 'doc.pdf',
        bytes: await makePdf([
          [100, 200],
          [300, 200],
        ]),
      },
    ]);
    const state = reducer(initialState, { type: 'add', ...imported });
    const output = await buildPdf(state.pages, state.sources, {
      pageSize: 'a4',
      orientation: 'auto',
      margin: 'medium',
    });
    const a4 = [Math.round(PAGE_SIZES.a4.width), Math.round(PAGE_SIZES.a4.height)];
    expect(await pageSizes(output)).toEqual([a4, [a4[1], a4[0]]]);
  });
});

describe('reducer', () => {
  it('drops sources once none of their pages remain', async () => {
    const imported = await importFiles([{ name: 'a.png', bytes: makePng(2, 2) }]);
    let state = reducer(initialState, { type: 'add', ...imported });
    expect(state.sources.size).toBe(1);
    state = reducer(state, { type: 'remove', pageId: state.pages[0]?.id ?? '' });
    expect(state.pages).toEqual([]);
    expect(state.sources.size).toBe(0);
  });
});
