import type { ProcessorToolParams } from './toolsMap.ts';

export type BlurToolArgs = { radius: number };

export const blur =
  ({ bitmap, size }: ProcessorToolParams) =>
  ({ radius }: BlurToolArgs) => {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;

    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(bitmap, 0, 0);

    return [canvas];
  };
