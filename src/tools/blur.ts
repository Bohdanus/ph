import type { ImageProcParams } from './toolsMap.ts';

export type BlurToolArgs = { radius: number };

export const blur =
  ({ ctx, bitmap }: ImageProcParams) =>
  ({ radius }: BlurToolArgs) => {
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(bitmap, 0, 0);
  };
