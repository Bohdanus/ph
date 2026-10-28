import type { RectXYSorted, Size } from '../contexts/general-types.ts';
import { trimRect } from './rect.ts';

type CopyRectToClipboardParams = {
  sourceCanvas: HTMLCanvasElement | null;
  rect: RectXYSorted | null;
  imageSize: Size;
  clipboard?: Pick<Clipboard, 'write'> | null;
  ClipboardItemCtor?: typeof ClipboardItem | null;
};

type ReadImageFromClipboardParams = {
  clipboard?: Pick<Clipboard, 'read'> | null;
  createImageBitmap?: (image: ImageBitmapSource) => Promise<ImageBitmap>;
};

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function copyRectToClipboard({
  sourceCanvas,
  rect,
  imageSize,
  clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
  ClipboardItemCtor = typeof window !== 'undefined' ? window.ClipboardItem : null,
}: CopyRectToClipboardParams): Promise<boolean> {
  if (!sourceCanvas || !rect || !clipboard?.write || !ClipboardItemCtor) return false;

  const { x, y, width, height } = trimRect(rect, imageSize);
  if (width === 0 || height === 0) return false;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.drawImage(sourceCanvas, x, y, width, height, 0, 0, width, height);

  const blob = await canvasToBlob(canvas);
  if (!blob) return false;

  try {
    await clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function readImageFromClipboard({
  clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null,
  createImageBitmap: decode = globalThis.createImageBitmap,
}: ReadImageFromClipboardParams = {}): Promise<{ bitmap: ImageBitmap; mimeType: string } | null> {
  if (!clipboard?.read || !decode) return null;

  try {
    const items = await clipboard.read();
    for (const item of items) {
      const mimeType = item.types.find((type) => type.startsWith('image/'));
      if (!mimeType) continue;

      const bitmap = await decode(await item.getType(mimeType));
      return { bitmap, mimeType };
    }
  } catch {
    // Permission denial and browsers without clipboard-read support are normal fallback cases.
  }

  return null;
}
