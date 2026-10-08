import { blendPixel, clampPointToSize, forEachPixelInRect, readRgba } from '../util/pixels.ts';
import type { Point, Pos } from '../contexts/general-types.ts';
import type { ProcessorToolParams, ToolResult } from './toolProcessors.ts';

export type PatchToolArgs = {
  sourceRect: Pos;
  donorPoint: Point;
  diffusion: number;
  toolName: 'patch';
};

const luminance = (red: number, green: number, blue: number): number => 0.299 * red + 0.587 * green + 0.114 * blue;
const clampChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export const patch =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ sourceRect, donorPoint, diffusion }: PatchToolArgs): ToolResult => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    if (
      sourceRect.width <= 0 ||
      sourceRect.height <= 0 ||
      typeof ctx.getImageData !== 'function' ||
      typeof ctx.putImageData !== 'function'
    )
      return [canvas];

    const image = ctx.getImageData(0, 0, size.width, size.height);
    const sourceData = new Uint8ClampedArray(image.data);
    const feather = Math.max(0, Math.min(6, Math.round(diffusion))) / 6;
    const rect = {
      left: Math.round(sourceRect.x),
      top: Math.round(sourceRect.y),
      right: Math.round(sourceRect.x) + Math.max(1, Math.round(sourceRect.width)) - 1,
      bottom: Math.round(sourceRect.y) + Math.max(1, Math.round(sourceRect.height)) - 1,
    };

    forEachPixelInRect(size, rect, (x, y, byteOffset) => {
      const localX = x - rect.left;
      const localY = y - rect.top;
      const donor = clampPointToSize(
        { x: Math.round(donorPoint.x + localX), y: Math.round(donorPoint.y + localY) },
        size
      );
      const source = readRgba(sourceData, donor.x, donor.y, size.width);
      const destination = readRgba(image.data, x, y, size.width);
      // Match the donor's luminance to the target before blending, which keeps a
      // repaired patch from changing the target area's overall brightness.
      const correction =
        luminance(destination.r, destination.g, destination.b) - luminance(source.r, source.g, source.b);
      const weight =
        1 -
        feather *
          Math.min(1, Math.min(localX, localY, rect.right - rect.left - localX, rect.bottom - rect.top - localY) / 4);
      blendPixel(
        image.data,
        byteOffset,
        {
          r: clampChannel(source.r + correction),
          g: clampChannel(source.g + correction),
          b: clampChannel(source.b + correction),
          a: source.a,
        },
        weight
      );
    });
    ctx.putImageData(image, 0, 0);
    return [canvas];
  };
