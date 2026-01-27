import { applyFilter } from './applyFilter.ts';
import type { RectXY } from '../contexts/ImageContext.tsx';

export type TextToolArgs = {
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  rect: RectXY | null;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
};

const TEXT_PADDING = 6;

export function renderText(ctx: CanvasRenderingContext2D, args: TextToolArgs) {
  const { text, fontSize, fontFamily, color, rect, align, bold, italic } = args;
  if (!text || !rect) return;

  const { x1, y1, x2 } = rect;

  ctx.fillStyle = color;
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  const maxWidth = x2 - x1;
  ctx.fillText(text, x1 + TEXT_PADDING, y1 + TEXT_PADDING, undefined);
}

export const text = (canvas: HTMLCanvasElement, source: ImageBitmap) => (args: TextToolArgs) => {
  return applyFilter(canvas, (ctx) => {
    ctx.drawImage(source, 0, 0);

    renderText(ctx, args);
  });
};
