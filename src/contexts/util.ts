import type { Rect, RectXY, Size } from './ImageContext.tsx';

export function sortRect(rect: RectXY): RectXY {
  let { x1, y1, x2, y2 } = rect;

  x1 = Math.min(x1, x2);
  y1 = Math.min(y1, y2);
  x2 = Math.max(x1, x2);
  y2 = Math.max(y1, y2);

  return { x1, y1, x2, y2 };
}

export function trimRect(rect: RectXY /* unsorted */, imageSize: Size): Rect {
  let { x1, y1, x2, y2 } = rect;
  const { width: imageWidth, height: imageHeight } = imageSize;

  x1 = Math.max(0, Math.min(imageWidth, x1));
  y1 = Math.max(0, Math.min(imageHeight, y1));
  x2 = Math.max(0, Math.min(imageWidth, x2));
  y2 = Math.max(0, Math.min(imageHeight, y2));

  const x = Math.round(Math.min(x1, x2));
  const y = Math.round(Math.min(y1, y2));
  const width = Math.round(Math.abs(x1 - x2));
  const height = Math.round(Math.abs(y1 - y2));

  return { x, y, width, height };
}
