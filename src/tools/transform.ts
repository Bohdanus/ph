import { applyFilter } from './applyFilter.ts';

export type TransformToolType = {
  rotate: number;
  mirrorH: boolean;
  mirrorV: boolean;
  skewX: number;
  skewY: number;
  trapezoid: number;
  resizeX: number;
  resizeY: number;
};

export const transform =
  (canvas: HTMLCanvasElement, source: ImageBitmap) =>
  (
    {
      rotate = 0,
      mirrorH = false,
      mirrorV = false,
      skewX = 0,
      skewY = 0,
      trapezoid = 0,
      resizeX = 100,
      resizeY = 100,
    }: TransformToolType,
    callback: (newWidth: number, newHeight: number) => void
  ) => {
    return applyFilter(canvas, (ctx: CanvasRenderingContext2D) => {
      const angle = (rotate * Math.PI) / 180;
      const sX = (skewX * Math.PI) / 180;
      const sY = (skewY * Math.PI) / 180;
      const scaleX = resizeX / 100;
      const scaleY = resizeY / 100;

      // Calculate bounding box after rotation and skew
      // We can use transform matrix to find corners
      const corners = [
        { x: 0, y: 0 },
        { x: source.width, y: 0 },
        { x: source.width, y: source.height },
        { x: 0, y: source.height },
      ];

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const tanX = Math.tan(sX);
      const tanY = Math.tan(sY);
      const factor = trapezoid / 100;

      const transformedCorners = corners.map((p) => {
        // Apply trapezoid first (non-affine)
        // symmetry: if factor > 0, bottom narrows. if factor < 0, top narrows.
        // we can use: scale = 1 - factor * (progress - offset)
        // where offset is 0 if factor > 0 and 1 if factor < 0
        const progress = p.y / source.height;
        const scale = factor > 0 ? 1 - factor * progress : 1 + factor * (1 - progress);

        // Maximum possible width of the trapezoid is always source.width (at the non-narrowed end)
        const offscreenWidth = source.width;

        const trapX = p.x * scale + (offscreenWidth - source.width * scale) / 2;
        const trapY = p.y;

        // Apply resize scaling before other transforms
        let x = (trapX - offscreenWidth / 2) * scaleX;
        let y = (trapY - source.height / 2) * scaleY;

        // Apply rotation
        let rx = x * cos - y * sin;
        let ry = x * sin + y * cos;

        // Apply skew
        let sx = rx + ry * tanX;
        let sy = ry + rx * tanY;

        return { x: sx, y: sy };
      });

      const minX = Math.min(...transformedCorners.map((p) => p.x));
      const maxX = Math.max(...transformedCorners.map((p) => p.x));
      const minY = Math.min(...transformedCorners.map((p) => p.y));
      const maxY = Math.max(...transformedCorners.map((p) => p.y));

      const newWidth = Math.round(maxX - minX);
      const newHeight = Math.round(maxY - minY);

      canvas.width = newWidth;
      canvas.height = newHeight;

      ctx.imageSmoothingEnabled = true;

      // Create a temporary canvas for the trapezoid effect
      // This is because we need to apply trapezoid to the source before other transforms
      // or at least in a way that doesn't mess up the bounding box calculation
      // For simplicity, we'll draw to an offscreen canvas and then apply rotation/skew
      const offscreen = document.createElement('canvas');

      const offscreenHeight = source.height;
      const offscreenWidth = source.width;

      offscreen.width = offscreenWidth;
      offscreen.height = offscreenHeight;
      const offCtx = offscreen.getContext('2d')!;

      if (trapezoid === 0) {
        offCtx.drawImage(source, 0, 0);
      } else {
        // Apply trapezoid effect by drawing thin strips
        // trapezoid value is from -100 to 100, representing percentage of narrowing
        for (let i = 0; i < source.height; i++) {
          const progress = i / source.height;
          // if factor > 0, bottom is narrower. if factor < 0, top is narrower.
          const scale = factor > 0 ? 1 - factor * progress : 1 + factor * (1 - progress);
          const xOffset = (offscreenWidth - source.width * scale) / 2;
          offCtx.drawImage(source, 0, i, source.width, 1, xOffset, i, source.width * scale, 1);
        }
      }

      ctx.translate(newWidth / 2, newHeight / 2);
      ctx.rotate(angle);
      ctx.transform(1, tanY, tanX, 1, 0, 0);
      ctx.scale(mirrorH ? -scaleX : scaleX, mirrorV ? -scaleY : scaleY);
      ctx.drawImage(offscreen, -offscreenWidth / 2, -offscreenHeight / 2);

      callback(newWidth, newHeight);
    });
  };
