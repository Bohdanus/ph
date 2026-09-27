import type { Ctx2D } from '../contexts/general-types.ts';

export function resizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

export function resetOverlayAlpha(ctx: Ctx2D) {
  ctx.globalAlpha = 1;
}
