import { createSelectionAlphaMask } from '../util/selection.ts';
import type { ToolArgs } from '../contexts/tool-types.ts';
import type { PositionedRasterSelectionMask, SelectionPointPaths } from '../contexts/general-types.ts';
import type { CreatorToolParams, ProcessorToolParams, ToolResult } from './toolProcessors.ts';

/**
 * `Image ▸ Adjustments ▸ Invert` (`Ctrl+I` / `Cmd+I`): a command, not a tool, so it has no
 * options bar and nothing to configure. It commits destructively, as Adobe documents the menu
 * command — "this method makes direct adjustments to the image layer and discards image
 * information" — rather than as a retained adjustment layer.
 */
export type InvertToolArgs = {
  toolName: 'invert';
  /**
   * The active selection, rebased into the staged raster's local coordinates exactly as
   * `FillToolArgs.selection` is, so replay builds the same mask from the stored args alone.
   * Absent, the whole layer is inverted.
   */
  selection?: {
    points: SelectionPointPaths;
    rasterMask?: PositionedRasterSelectionMask;
    featherRadius: number;
    antiAlias: boolean;
  };
};

/**
 * Invert RGB in place, leaving alpha untouched: Adobe's "a pixel … with a value of 255 is changed
 * to 0, and a pixel with a value of 5 is changed to 250", per channel.
 *
 * With a mask, each pixel moves toward its inverse by its selection coverage, so a feathered or
 * anti-aliased edge blends instead of stepping.
 */
export const invertPixels = (data: Uint8ClampedArray, selectionMask: Uint8Array | null): void => {
  for (let pixel = 0, offset = 0; offset < data.length; pixel++, offset += 4) {
    const coverage = selectionMask ? selectionMask[pixel] / 255 : 1;
    if (coverage === 0) continue;

    for (let channel = offset; channel < offset + 3; channel++) {
      const value = data[channel];
      data[channel] = value + (255 - 2 * value) * coverage;
    }
  }
};

export const invert =
  (params: ProcessorToolParams | CreatorToolParams) =>
  (args: ToolArgs): ToolResult => {
    const { size } = params;
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    if (!('bitmap' in params)) return [canvas];

    ctx.drawImage(params.bitmap, 0, 0, size.width, size.height);
    const imageData = ctx.getImageData(0, 0, size.width, size.height);

    const { selection } = args as unknown as InvertToolArgs;
    const selectionMask = selection ? createSelectionAlphaMask(selection, size, selection) : null;

    invertPixels(imageData.data, selectionMask);
    ctx.putImageData(imageData, 0, 0);

    return [canvas];
  };
