import { applyFilter } from './applyFilter.ts';

export type TransformToolType = { rotate: number; mirrorH: boolean; mirrorV: boolean };

export const transform =
  (canvas: HTMLCanvasElement, source: ImageBitmap) =>
  (
    { rotate = 0, mirrorH = false, mirrorV = false }: TransformToolType,
    callback: (newWidth: number, newHeight: number) => void
  ) => {
    return applyFilter(canvas, (ctx: CanvasRenderingContext2D) => {
      const angle = (rotate * Math.PI) / 180;
      const absCos = Math.abs(Math.cos(angle));
      const absSin = Math.abs(Math.sin(angle));

      // image expands if rotated
      const newWidth = Math.round(source.width * absCos + source.height * absSin);
      const newHeight = Math.round(source.width * absSin + source.height * absCos);

      canvas.width = newWidth;
      canvas.height = newHeight;

      ctx.imageSmoothingEnabled = false;
      ctx.translate(newWidth / 2, newHeight / 2);
      ctx.rotate(angle);
      ctx.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1);
      ctx.drawImage(source, -source.width / 2, -source.height / 2);

      callback(newWidth, newHeight);
    });
  };
