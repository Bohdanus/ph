import { applyFilter } from './applyFilter.ts';
import type { RectXY } from '../contexts/ImageContext.tsx';
import { TEXT_PADDING } from '../util/constants.ts';

export type TextToolArgs = {
  text: string;
  fontSize: number;
  lineHeight: number;
  fontFamily: string;
  color: string;
  rect: RectXY | null;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
};

export function renderText(ctx: CanvasRenderingContext2D, args: TextToolArgs) {
  const { text, fontSize, lineHeight, fontFamily, color, rect, align, bold, italic } = args;
  if (!text || !rect) return;

  const { x1, y1, x2 } = rect;
  let x;
  switch (align) {
    case 'left':
      x = x1 + TEXT_PADDING;
      break;
    case 'center':
      x = x1 + (x2 - x1) / 2;
      break;
    case 'right':
      x = x2 - TEXT_PADDING;
      break;
  }

  ctx.fillStyle = color;
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y1 + TEXT_PADDING + index * fontSize * lineHeight);
  });
}

export function getTextWidth(ctx: CanvasRenderingContext2D, args: TextToolArgs): number {
  const { fontSize, fontFamily, bold, italic, text } = args;
  ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
  const lines = text.split('\n');

  return Math.max(
    ...lines.map((line) => {
      const metrics = ctx.measureText(line);
      return metrics.width;
    })
  );
}

export const text = (canvas: HTMLCanvasElement, source: ImageBitmap) => (args: TextToolArgs) => {
  return applyFilter(canvas, (ctx) => {
    ctx.drawImage(source, 0, 0);

    renderText(ctx, args);
  });
};
