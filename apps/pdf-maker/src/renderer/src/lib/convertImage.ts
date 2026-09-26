import type { ImageConverter } from './importFiles';

/**
 * Decodes any image the browser understands and re-encodes it as PNG (or JPEG
 * for photos), with EXIF orientation applied.
 */
export const convertImage: ImageConverter = async ({ name, bytes }) => {
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas unavailable');
    context.drawImage(bitmap, 0, 0);

    const photo = /\.(jpe?g|avif|heic)$/i.test(name);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, photo ? 'image/jpeg' : 'image/png', 0.92),
    );
    if (!blob) throw new Error('Could not encode image');
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      format: photo ? 'jpg' : 'png',
      width: bitmap.width,
      height: bitmap.height,
    };
  } finally {
    bitmap.close();
  }
};
