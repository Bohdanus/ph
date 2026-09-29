import { TEXT_PADDING } from '../util/constants.ts';
import { resetOverlayAlpha } from '../util/canvas.ts';
import type { CreatorToolParams } from './toolProcessors.ts';
import type { Ctx2D, RectXYSorted } from '../contexts/general-types.ts';

export type TextToolArgs = {
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
  fontFamily: string;
  fontSize: number;
  italic: boolean;
  lineHeight: number;
  text?: string;
  rect?: RectXYSorted | null;

  toolName: 'text';
};

/**
 * `color` is a setting, not a derivation. It used to be omitted because the bar mirrored the store's
 * foreground into the args on every render, so the value was never the tool's to keep; it is the
 * tool's own swatch now, and `saveLastSettings` already persists it (`src/util/settings.ts` omits
 * only `text` and `rect`), so this type has to say the same thing.
 */
export type TextToolSettings = Omit<TextToolArgs, 'text' | 'rect'>;

export function renderText(ctx: Ctx2D, args: TextToolArgs) {
  const { text, fontSize, lineHeight, fontFamily, color, rect, align, bold, italic } = args;
  if (!text || !rect) return;

  resetOverlayAlpha(ctx);

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
  const lines = (text ?? '').split('\n');

  return Math.max(
    ...lines.map((line) => {
      const metrics = ctx.measureText(line);
      return metrics.width;
    })
  );
}

export const text =
  ({ size }: CreatorToolParams) =>
  (args: TextToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    renderText(ctx, args);

    return [canvas];
  };
