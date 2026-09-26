import { useEffect, useState } from 'react';
import { computeLayout, isSideways } from '../lib/layout';
import { getThumbnail } from '../lib/thumbnails';
import type { LayoutSettings, PageItem, Source } from '../lib/types';

/** Longest edge of the preview frame, in CSS pixels. */
const FRAME_SIZE = 150;

interface Props {
  page: PageItem;
  source: Source;
  settings: LayoutSettings;
}

/** A miniature of the output page: the page frame with the content placed as it will be saved. */
export function PagePreview({ page, source, settings }: Props) {
  const url = useThumbnail(source, page.pageIndex);
  const { pageWidth, pageHeight, box } = computeLayout(page, settings);
  const scale = FRAME_SIZE / Math.max(pageWidth, pageHeight);
  const sideways = isSideways(page.rotation);

  return (
    <div className="preview-slot">
      <div
        className="preview-frame"
        style={{ width: pageWidth * scale, height: pageHeight * scale }}
      >
        <div
          className="preview-content"
          style={{
            left: box.x * scale,
            // PDF coordinates start at the bottom; CSS at the top.
            top: (pageHeight - box.y - box.height) * scale,
            width: box.width * scale,
            height: box.height * scale,
          }}
        >
          {url ? (
            <img
              src={url}
              alt=""
              draggable={false}
              style={{
                width: (sideways ? box.height : box.width) * scale,
                height: (sideways ? box.width : box.height) * scale,
                transform: `translate(-50%, -50%) rotate(${page.rotation}deg)`,
              }}
            />
          ) : (
            <div className="preview-loading" />
          )}
        </div>
      </div>
    </div>
  );
}

function useThumbnail(source: Source, pageIndex: number): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let cancelled = false;
    getThumbnail(source, pageIndex).then(
      (next) => !cancelled && setUrl(next),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [source, pageIndex]);
  return url;
}
