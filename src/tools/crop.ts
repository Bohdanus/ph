import { applyFilter } from './applyFilter.ts';
import type { RectXYSorted } from '../contexts/ImageContext.tsx';
import { trimRect } from '../util/rect.ts';

export type CropToolType = RectXYSorted;

export const crop =
  (canvas: HTMLCanvasElement, source: ImageBitmap) =>
  (rect: CropToolType, callback: (width: number, height: number) => void) => {
    return applyFilter(canvas, (ctx: CanvasRenderingContext2D) => {
      const imageSize = {
        width: canvas.width,
        height: canvas.height,
      };
      const { x, y, width, height } = trimRect(rect, imageSize);

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(source, x, y, width, height, 0, 0, width, height);

      callback(width, height);
    });
  };
