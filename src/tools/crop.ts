import type { RectXYSorted } from '../contexts/ImageContext.tsx';
import { trimRect } from '../util/rect.ts';
import type { ResizeCb } from '../components/ToolbarsRight/types.ts';
import type { ImageProcParams } from './toolsMap.ts';

export type CropToolArgs = {
  rect?: RectXYSorted | null;
  aspectRatio?: number | null;
};

export const crop =
  ({ canvas, ctx, bitmap }: ImageProcParams) =>
  ({ rect }: CropToolArgs, callback: ResizeCb) => {
    const imageSize = {
      width: canvas.width,
      height: canvas.height,
    };
    const { x, y, width, height } = trimRect(rect!, imageSize);

    canvas.width = width;
    canvas.height = height;

    ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

    callback(width, height);
  };
