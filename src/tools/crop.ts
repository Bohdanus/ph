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

export const crop =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ rect }: CropToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);

    const { x, y, width, height } = trimRect(rect!, size);

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

    return [canvas, { width, height }];
  };
