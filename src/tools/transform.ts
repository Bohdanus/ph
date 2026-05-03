import type { ProcessorToolParams } from './toolsMap.ts';

export type TransformToolArgs = {
  rotate: number;
  mirrorH: boolean;
  mirrorV: boolean;
  skewX: number;
  skewY: number;
  trapezoid: number;
  resizeX: number;
  resizeY: number;

  toolName: 'transform';
};

export const transform =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({
    rotate = 0,
    mirrorH = false,
    mirrorV = false,
    skewX = 0,
    skewY = 0,
    trapezoid = 0,
    resizeX = 100,
    resizeY = 100,
  }: TransformToolArgs) => {
    const initialWidth = size.width;
    const initialHeight = size.height;

    const angle = (rotate * Math.PI) / 180;
    const sX = (skewX * Math.PI) / 180;
    const sY = (skewY * Math.PI) / 180;
    const scaleX = resizeX / 100;
    const scaleY = resizeY / 100;

    // Calculate bounding box after rotation and skew
    // We can use transform matrix to find corners
    const corners = [
      { x: 0, y: 0 },
      { x: initialWidth, y: 0 },
      { x: initialWidth, y: initialHeight },
      { x: 0, y: initialHeight },
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
      const progress = p.y / initialHeight;
      const scale = factor > 0 ? 1 - factor * progress : 1 + factor * (1 - progress);

      const trapX = p.x * scale + (initialWidth - initialWidth * scale) / 2;
      const trapY = p.y;

      // Apply resize scaling before other transforms
      let x = (trapX - initialWidth / 2) * scaleX;
      let y = (trapY - initialHeight / 2) * scaleY;

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

    const canvas = new OffscreenCanvas(newWidth, newHeight);
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;

    // Create a temporary canvas for the trapezoid effect
    // This is because we need to apply trapezoid to the source before other transforms
    // or at least in a way that doesn't mess up the bounding box calculation
    // For simplicity, we'll draw to an offscreen canvas and then apply rotation/skew
    const offscreen = new OffscreenCanvas(initialWidth, initialHeight);
    const offCtx = offscreen.getContext('2d')!;

    if (trapezoid === 0) {
      offCtx.drawImage(bitmap, 0, 0);
    } else {
      // Apply trapezoid effect by drawing thin strips
      // trapezoid value is from -100 to 100, representing percentage of narrowing
      for (let i = 0; i < initialHeight; i++) {
        const progress = i / initialHeight;
        // if factor > 0, bottom is narrower. if factor < 0, top is narrower.
        const scale = factor > 0 ? 1 - factor * progress : 1 + factor * (1 - progress);
        const xOffset = (initialWidth - initialWidth * scale) / 2;
        offCtx.drawImage(bitmap, 0, i, initialWidth, 1, xOffset, i, initialWidth * scale, 1);
      }
    }

    ctx.translate(newWidth / 2, newHeight / 2);
    ctx.rotate(angle);
    ctx.transform(1, tanY, tanX, 1, 0, 0);
    ctx.scale(mirrorH ? -scaleX : scaleX, mirrorV ? -scaleY : scaleY);
    ctx.drawImage(offscreen, -initialWidth / 2, -initialHeight / 2);

    if (initialWidth !== newWidth || initialHeight !== newHeight) {
      return [canvas, { width: newWidth, height: newHeight }];
    }

    return [canvas];
  };
