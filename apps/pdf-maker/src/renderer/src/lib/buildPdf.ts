import { degrees, PDFDocument, type PDFEmbeddedPage, type PDFImage } from 'pdf-lib';
import { computeLayout, normalizeRotation, placeRotated } from './layout';
import type { LayoutSettings, PageItem, Source } from './types';

export interface BuildOptions {
  title?: string;
}

/** Assembles the pages, in order, into a new PDF and returns its bytes. */
export async function buildPdf(
  pages: PageItem[],
  sources: ReadonlyMap<string, Source>,
  settings: LayoutSettings,
  options: BuildOptions = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const pdfs = new Map<string, PDFDocument>();
  const images = new Map<string, PDFImage>();
  // null marks a source page with no content stream (a blank page).
  const embeddedPages = new Map<string, PDFEmbeddedPage | null>();

  const loadPdf = async (source: Source) => {
    let pdf = pdfs.get(source.id);
    if (!pdf) {
      pdf = await PDFDocument.load(source.bytes, { updateMetadata: false });
      pdfs.set(source.id, pdf);
    }
    return pdf;
  };

  for (const page of pages) {
    const source = sources.get(page.sourceId);
    if (!source) throw new Error(`Missing source for page ${page.id}`);

    const layout = computeLayout(page, settings);
    const output = doc.addPage([layout.pageWidth, layout.pageHeight]);
    const placement = placeRotated(
      layout.box,
      normalizeRotation(page.sourceRotation + page.rotation),
    );
    const drawOptions = {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      rotate: degrees(placement.degrees),
    };

    if (source.kind === 'pdf') {
      const key = `${source.id}:${page.pageIndex}`;
      let embedded = embeddedPages.get(key);
      if (embedded === undefined) {
        const sourcePage = (await loadPdf(source)).getPage(page.pageIndex);
        const crop = sourcePage.getCropBox();
        embedded = sourcePage.node.Contents()
          ? await doc.embedPage(sourcePage, {
              left: crop.x,
              bottom: crop.y,
              right: crop.x + crop.width,
              top: crop.y + crop.height,
            })
          : null;
        embeddedPages.set(key, embedded);
      }
      if (embedded) output.drawPage(embedded, drawOptions);
    } else {
      let image = images.get(source.id);
      if (!image) {
        image =
          source.format === 'png'
            ? await doc.embedPng(source.bytes)
            : await doc.embedJpg(source.bytes);
        images.set(source.id, image);
      }
      output.drawImage(image, drawOptions);
    }
  }

  if (options.title) doc.setTitle(options.title);
  doc.setCreator('PDF Maker');
  doc.setProducer('PDF Maker (pdf-lib)');
  return doc.save();
}
