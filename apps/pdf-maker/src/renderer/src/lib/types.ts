/** Clockwise rotation in degrees. */
export type Rotation = 0 | 90 | 180 | 270;

export type PageSizeId = 'source' | 'a3' | 'a4' | 'a5' | 'letter' | 'legal';
export type Orientation = 'auto' | 'portrait' | 'landscape';
export type MarginId = 'none' | 'small' | 'medium' | 'large';

export interface LayoutSettings {
  pageSize: PageSizeId;
  orientation: Orientation;
  margin: MarginId;
}

export type ImageFormat = 'png' | 'jpg';

export type Source =
  | { id: string; name: string; kind: 'pdf'; bytes: Uint8Array; pageCount: number }
  | { id: string; name: string; kind: 'image'; bytes: Uint8Array; format: ImageFormat };

/** One page in the output document. */
export interface PageItem {
  id: string;
  sourceId: string;
  /** Page index within a PDF source; always 0 for images. */
  pageIndex: number;
  /** Size in points as the source displays it, before `rotation` is applied. */
  width: number;
  height: number;
  /** Rotation baked into the source (PDF /Rotate or JPEG EXIF orientation). */
  sourceRotation: Rotation;
  /** Rotation applied by the user. */
  rotation: Rotation;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
