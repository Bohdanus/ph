/**
 * The eyedropper has no geometry, no pixel operation and no history. It samples a colour and
 * writes it to the store's foreground, so `ToolArgs` is a settings carrier and nothing else —
 * which is why there is deliberately no `points`, no `pos` and no `size` here, and no entry in
 * `src/tools/toolProcessors.ts` (see `PIXEL_FREE_TOOLS` there).
 */
export type EyedropperSampleSize = 1 | 3 | 5;

export type EyedropperToolArgs = {
  /**
   * Photoshop's Sample Size: the side of the square of pixels averaged into the sampled colour.
   * `1` is a Point Sample. This tranche's Sample Size governs the eyedropper alone; Photoshop also
   * routes the Magic Wand, Magic Eraser and Background Eraser through it, and widening that later
   * needs no data migration because nothing stores the value per tool yet.
   */
  sampleSize: EyedropperSampleSize;
  /**
   * Rendered `disabled` in the options bar: it needs a composite read of every visible layer, and
   * the tool area only has the active layer's pixels. Kept in the type so the disabled control has
   * a real value behind it, and so turning it on is a rendering change rather than a schema change.
   */
  sampleAllLayers: boolean;

  toolName: 'eyedropper';
};

/** The Options bar's three Photoshop options, in Photoshop's order. */
export const EYEDROPPER_SAMPLE_SIZE_OPTIONS: readonly { value: EyedropperSampleSize; label: string }[] = [
  { value: 1, label: 'Point Sample' },
  { value: 3, label: '3 by 3 Average' },
  { value: 5, label: '5 by 5 Average' },
];
