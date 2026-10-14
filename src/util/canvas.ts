import type { Ctx2D } from '../contexts/general-types.ts';

const RATIO_ATTR = 'data-hidpi-ratio';

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, ratio = 1) {
  const targetWidth = Math.round(width * ratio);
  const targetHeight = Math.round(height * ratio);

  const needsResize = canvas.width !== targetWidth || canvas.height !== targetHeight;

  if (needsResize) {
    // Setting width/height resets the context transform to identity
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
  }

  // Always ensure the correct transform is applied when ratio > 1.
  // If the canvas was already at the right size but the transform was lost
  // (e.g., external code called setTransform), we need to reapply it.
  if (ratio !== 1) {
    const ctx = canvas.getContext('2d');
    if (ctx && typeof ctx.getTransform === 'function') {
      // Check if the current transform matches the expected scale
      const transform = ctx.getTransform();
      if (transform.a !== ratio || transform.d !== ratio) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
    }
    try {
      canvas.setAttribute?.(RATIO_ATTR, String(ratio));
    } catch {
      // Ignore in test environments
    }
  } else {
    // Ratio is 1: the width/height assignment above already reset the transform
    // to identity. Just remove the HiDPI attribute.
    try {
      canvas.removeAttribute?.(RATIO_ATTR);
    } catch {
      // Ignore in test environments
    }
  }
}

export function resetOverlayAlpha(ctx: Ctx2D) {
  ctx.globalAlpha = 1;
}
