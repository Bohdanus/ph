/**
 * The eyedropper has no geometry, no pixel operation and no history. It samples a colour and
 * writes it to the store's foreground, so `ToolArgs` is a settings carrier and nothing else —
 * which is why there is deliberately no `points`, no `pos` and no `size` here, and no entry in
 * `src/tools/toolProcessors.ts` (see `PIXEL_FREE_TOOLS` there).
 */
export type EyedropperSampleSize = 1 | 3 | 5 | 11 | 31 | 51 | 101;

export type EyedropperToolArgs = {
  /**
   * Photoshop's Sample Size: the side of the square of pixels averaged into the sampled colour.
   * `1` is a Point Sample. This tranche's Sample Size governs the eyedropper alone; Photoshop also
   * routes the Magic Wand, Magic Eraser and Background Eraser through it, and widening that later
   * needs no data migration because nothing stores the value per tool yet.
   */
  sampleSize: EyedropperSampleSize;
  /**
   * Photoshop's `Sample` dropdown, of which this is the `All Layers` end. There is NO control for
   * it: it needs a composite read of every visible layer, and the tool area only has the active
   * layer's pixels, so a box that cannot be ticked is a promise the app cannot keep. It stays in
   * the type because `settings.ts` still seeds it and the tool area still refuses it loudly, so
   * turning it on is a rendering change rather than a schema change.
   */
  sampleAllLayers: boolean;

  toolName: 'eyedropper';
};

/**
 * The Options bar's Sample Size, in Photoshop's order and with Adobe's own labels: Point Sample
 * plus the 3, 5, 11, 31, 51 and 101 averages.
 * https://helpx.adobe.com/photoshop/using/tool-techniques/eyedropper-tool.html
 */
export const EYEDROPPER_SAMPLE_SIZE_OPTIONS: readonly { value: EyedropperSampleSize; label: string }[] = [
  { value: 1, label: 'Point Sample' },
  { value: 3, label: '3 by 3 Average' },
  { value: 5, label: '5 by 5 Average' },
  { value: 11, label: '11 by 11 Average' },
  { value: 31, label: '31 by 31 Average' },
  { value: 51, label: '51 by 51 Average' },
  { value: 101, label: '101 by 101 Average' },
];
