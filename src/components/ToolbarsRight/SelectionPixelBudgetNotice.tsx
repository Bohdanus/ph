import { useStore } from '../../contexts/StoreContext.tsx';
import { MAX_RASTER_SELECTION_PIXELS } from '../../util/selection-mask.ts';

/** Explain why color-based selection tools do not start on oversized documents. */
export function SelectionPixelBudgetNotice() {
  const [{ totalSize }] = useStore();
  const width = Number.isFinite(totalSize?.width) ? Math.floor(totalSize.width) : 0;
  const height = Number.isFinite(totalSize?.height) ? Math.floor(totalSize.height) : 0;
  const pixelCount = width * height;
  if (width <= 0 || height <= 0 || !Number.isSafeInteger(pixelCount) || pixelCount <= MAX_RASTER_SELECTION_PIXELS) {
    return null;
  }

  return (
    <div
      aria-live="polite"
      className="min-w-60 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
      role="status"
    >
      Color-based selection is unavailable above {MAX_RASTER_SELECTION_PIXELS.toLocaleString()} pixels. This document
      has {pixelCount.toLocaleString()} pixels.
    </div>
  );
}
