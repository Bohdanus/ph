import type { ProcessorToolParams } from './toolProcessors.ts';

export type MagicWandToolArgs = {
  tolerance: number;
  smoothing: number;
  /**
   * Adobe: "Uncheck Contiguous if you want to select nonadjacent areas of similar color."
   *
   * On is the only behaviour the options bar had before the control existed, so it is seeded on
   * and the default never changes what a click selects.
   */
  contiguous: boolean;
  toolName: 'magic-wand';
};

export type MagicWandToolSettings = MagicWandToolArgs;

export const magicWand =
  ({ bitmap }: ProcessorToolParams) =>
  () => {
    return [bitmap];
  };
