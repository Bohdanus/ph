import type { ProcessorToolParams } from './toolsMap.ts';

export type MagicWandToolArgs = {
  tolerance: number;
  smoothing: number;
  toolName: 'magic-wand';
};

export type MagicWandToolSettings = MagicWandToolArgs;

export const magicWand =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
