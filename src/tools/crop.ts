import { applyFilter } from './applyFilter.ts';

export type CropToolType = { x: number; y: number; width: number; height: number };

export const crop =
  (canvas: HTMLCanvasElement, source: ImageBitmap) =>
  ({ x, y, width, height }: CropToolType, callback: (width: number, height: number) => void) => {
    return applyFilter(canvas, (ctx: CanvasRenderingContext2D) => {
      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(source, x, y, width, height, 0, 0, width, height);

      callback(width, height);
    });
  };
