import { describe, expect, it } from 'vitest';
import { computeLayout, normalizeRotation, PAGE_SIZES, placeRotated } from './layout';
import type { Box, LayoutSettings, Rotation } from './types';

const settings = (overrides: Partial<LayoutSettings> = {}): LayoutSettings => ({
  pageSize: 'source',
  orientation: 'auto',
  margin: 'none',
  ...overrides,
});

describe('normalizeRotation', () => {
  it.each([
    [0, 0],
    [90, 90],
    [360, 0],
    [450, 90],
    [-90, 270],
    [-180, 180],
  ])('%i -> %i', (input, expected) => {
    expect(normalizeRotation(input)).toBe(expected);
  });
});

describe('computeLayout', () => {
  it('matches the source size and swaps it when rotated', () => {
    expect(computeLayout({ width: 200, height: 100, rotation: 0 }, settings())).toEqual({
      pageWidth: 200,
      pageHeight: 100,
      box: { x: 0, y: 0, width: 200, height: 100 },
    });
    expect(computeLayout({ width: 200, height: 100, rotation: 90 }, settings())).toMatchObject({
      pageWidth: 100,
      pageHeight: 200,
    });
  });

  it('picks orientation from the content when set to auto', () => {
    const wide = computeLayout(
      { width: 400, height: 300, rotation: 0 },
      settings({ pageSize: 'a4' }),
    );
    expect(wide.pageWidth).toBeCloseTo(PAGE_SIZES.a4.height);
    expect(wide.pageHeight).toBeCloseTo(PAGE_SIZES.a4.width);

    const tall = computeLayout(
      { width: 400, height: 300, rotation: 90 },
      settings({ pageSize: 'a4' }),
    );
    expect(tall.pageWidth).toBeCloseTo(PAGE_SIZES.a4.width);
  });

  it('forces orientation and fits content within the margins, centred', () => {
    const layout = computeLayout(
      { width: 400, height: 300, rotation: 0 },
      settings({ pageSize: 'letter', orientation: 'portrait', margin: 'large' }),
    );
    expect(layout.pageWidth).toBe(612);
    expect(layout.pageHeight).toBe(792);
    // Width-limited: 612 - 2 * 72 = 468 wide, keeping the 4:3 ratio.
    expect(layout.box.width).toBeCloseTo(468);
    expect(layout.box.height).toBeCloseTo(351);
    expect(layout.box.x).toBeCloseTo(72);
    expect(layout.box.y).toBeCloseTo((792 - 351) / 2);
  });
});

describe('placeRotated', () => {
  /** Bounding box of a w x h rectangle rotated counter-clockwise about (x, y). */
  function boundsAfterRotation(p: ReturnType<typeof placeRotated>): Box {
    const rad = (p.degrees * Math.PI) / 180;
    const corners = [
      [0, 0],
      [p.width, 0],
      [0, p.height],
      [p.width, p.height],
    ].map(([cx = 0, cy = 0]) => [
      p.x + cx * Math.cos(rad) - cy * Math.sin(rad),
      p.y + cx * Math.sin(rad) + cy * Math.cos(rad),
    ]);
    const xs = corners.map(([x = 0]) => x);
    const ys = corners.map(([, y = 0]) => y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }

  it.each([0, 90, 180, 270] as Rotation[])('fills the box at %i°', (rotation) => {
    const box = { x: 10, y: 20, width: 300, height: 200 };
    const placement = placeRotated(box, rotation);
    const bounds = boundsAfterRotation(placement);
    expect(bounds.x).toBeCloseTo(box.x);
    expect(bounds.y).toBeCloseTo(box.y);
    expect(bounds.width).toBeCloseTo(box.width);
    expect(bounds.height).toBeCloseTo(box.height);
  });

  it('rotates clockwise, so the content top edge ends up on the right at 90°', () => {
    const placement = placeRotated({ x: 0, y: 0, width: 200, height: 300 }, 90);
    // The content's top-left corner (0, h) should land at the box's top-right.
    const rad = (placement.degrees * Math.PI) / 180;
    const x = placement.x - placement.height * Math.sin(rad);
    const y = placement.y + placement.height * Math.cos(rad);
    expect(x).toBeCloseTo(200);
    expect(y).toBeCloseTo(300);
  });
});
