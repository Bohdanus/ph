import { trimRect } from '../util/rect.ts';
import type { ProcessorToolParams } from './toolProcessors.ts';
import type { RectXYSorted } from '../contexts/general-types.ts';

export const CROP_OVERLAYS = ['ruleOfThirds', 'grid', 'diagonal', 'triangle', 'goldenRatio', 'goldenSpiral'] as const;
export type CropOverlayType = (typeof CROP_OVERLAYS)[number];
export type CropOverlayOrientation = 'normal' | 'flipped';

export type CropToolArgs = {
  rect?: RectXYSorted | null;
  /**
   * The rect the user had drawn when they first chose a ratio, kept so `Free`/`Original` can put
   * it back.
   *
   * It has to live here, on the args the store holds, rather than in panel state: the panel
   * publishes the refitted rect, so a snapshot taken in the panel goes stale the moment the user
   * drags a new rect with the ratio still set. Holding it on the args means every writer of
   * `rect` — the panel and `CropToolArea`'s `onChangeEnd` — publishes it or drops it with the
   * same spread.
   *
   * `null` is not the same as absent: `null` means "the round trip has been taken and there is
   * nothing left to restore", which is what makes the restore idempotent.
   */
  preRatioRect?: RectXYSorted | null;
  aspectRatio?: number | null;
  overlayType?: CropOverlayType;
  overlayOrientation?: CropOverlayOrientation;

  toolName: 'crop';
};

function hasFiniteRect(rect: RectXYSorted | null | undefined): rect is RectXYSorted {
  return (
    rect !== null &&
    rect !== undefined &&
    [rect.x1, rect.y1, rect.x2, rect.y2].every((value) => typeof value === 'number' && Number.isFinite(value))
  );
}

export const crop =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ rect }: CropToolArgs) => {
    // Crop is a document operation in the live path, but the processor remains part of the
    // registry and can still receive old or hand-edited records during replay. A missing,
    // non-finite, or degenerate rect cannot describe a bitmap and must not manufacture a 0x0
    // canvas or throw from `trimRect`.
    if (!hasFiniteRect(rect)) return [bitmap];

    const { x, y, width, height } = trimRect(rect, size);
    if (width <= 0 || height <= 0) return [bitmap];

    const canvas = new OffscreenCanvas(size.width, size.height);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return [bitmap];
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

    return [canvas, { width, height }];
  };
