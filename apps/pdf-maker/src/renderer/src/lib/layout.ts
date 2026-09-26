import type { Box, LayoutSettings, MarginId, PageItem, PageSizeId, Rotation } from './types';

const MM = 72 / 25.4;

/** Portrait dimensions in PDF points (1/72 inch). */
export const PAGE_SIZES: Record<
  Exclude<PageSizeId, 'source'>,
  { width: number; height: number }
> = {
  a3: { width: 297 * MM, height: 420 * MM },
  a4: { width: 210 * MM, height: 297 * MM },
  a5: { width: 148 * MM, height: 210 * MM },
  letter: { width: 612, height: 792 },
  legal: { width: 612, height: 1008 },
};

export const MARGINS: Record<MarginId, number> = {
  none: 0,
  small: 18,
  medium: 36,
  large: 72,
};

export const DEFAULT_SETTINGS: LayoutSettings = {
  pageSize: 'a4',
  orientation: 'auto',
  margin: 'none',
};

export function normalizeRotation(degrees: number): Rotation {
  const r = (((Math.round(degrees / 90) * 90) % 360) + 360) % 360;
  return r as Rotation;
}

export function isSideways(rotation: Rotation): boolean {
  return rotation === 90 || rotation === 270;
}

export function rotatedSize(width: number, height: number, rotation: Rotation) {
  return isSideways(rotation) ? { width: height, height: width } : { width, height };
}

export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  /** Where the (rotated) content sits on the page, in PDF coordinates (origin bottom-left). */
  box: Box;
}

/** Works out the output page size and where the page content is placed on it. */
export function computeLayout(
  page: Pick<PageItem, 'width' | 'height' | 'rotation'>,
  settings: LayoutSettings,
): PageLayout {
  const content = rotatedSize(page.width, page.height, page.rotation);

  if (settings.pageSize === 'source') {
    return {
      pageWidth: content.width,
      pageHeight: content.height,
      box: { x: 0, y: 0, ...content },
    };
  }

  const base = PAGE_SIZES[settings.pageSize];
  const landscape =
    settings.orientation === 'landscape' ||
    (settings.orientation === 'auto' && content.width > content.height);
  const pageWidth = landscape ? base.height : base.width;
  const pageHeight = landscape ? base.width : base.height;

  const margin = MARGINS[settings.margin];
  const scale = Math.min(
    (pageWidth - 2 * margin) / content.width,
    (pageHeight - 2 * margin) / content.height,
  );
  const width = content.width * scale;
  const height = content.height * scale;

  return {
    pageWidth,
    pageHeight,
    box: { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height },
  };
}

export interface Placement {
  x: number;
  y: number;
  /** Unrotated content size. */
  width: number;
  height: number;
  /** Counter-clockwise degrees about (x, y), as pdf-lib's `rotate` option expects. */
  degrees: number;
}

/**
 * pdf-lib rotates drawn content counter-clockwise about its bottom-left anchor.
 * Returns the anchor and size so that content rotated clockwise by `rotation`
 * exactly fills `box`.
 */
export function placeRotated(box: Box, rotation: Rotation): Placement {
  const sideways = isSideways(rotation);
  const width = sideways ? box.height : box.width;
  const height = sideways ? box.width : box.height;
  switch (rotation) {
    case 0:
      return { x: box.x, y: box.y, width, height, degrees: 0 };
    case 90:
      return { x: box.x, y: box.y + box.height, width, height, degrees: -90 };
    case 180:
      return { x: box.x + box.width, y: box.y + box.height, width, height, degrees: 180 };
    case 270:
      return { x: box.x + box.width, y: box.y, width, height, degrees: 90 };
  }
}
