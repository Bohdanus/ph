import type { ToolbarRightComponent } from '../types.ts';
import { createFillToolbar } from './MagicEraser.tsx';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

/** The shared fill bar's own class constants (`MagicEraser.tsx:6-8`), which are module-private. */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SELECT_CLASS =
  'rounded border border-gray-300 bg-white px-3 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white';

/**
 * The bucket's half of the shared bar: Tolerance, Contiguous, Anti-aliased and Opacity. A fresh
 * closure, so the bucket keeps its own component identity from the Magic Eraser's.
 */
const BucketBar = createFillToolbar('paint-bucket');

/**
 * The Paint Bucket's options bar: the shared fill controls plus Photoshop's `Fill` control, which
 * this tool alone has. The Magic Eraser has no `Fill` in Photoshop either — it subtracts alpha and
 * has nothing to fill with — so this lives here and not in the shared `createFillToolbar`.
 *
 * `Pattern` renders DISABLED rather than absent, which is this tranche's rule for a control that is
 * Photoshop-documented but has no substrate here: there is no pattern registry, no pattern tile and
 * no processor branch that could read one, so offering it as enabled would be offering a control
 * that silently does nothing. `Foreground` is enabled and is the only fill the bucket can perform;
 * its value text carries the exact colour `FillToolArea` will commit, so a user can see what the
 * click will paint without leaving the document.
 *
 * The control writes nothing. The colour is read off the store at COMMIT time by `FillToolArea`,
 * not mirrored into the tool args here, so a bar that mounted before a foreground change would
 * still show — and the bar being a snapshot of a live store value is what the label has to
 * re-render on.
 */
const PaintBucket: ToolbarRightComponent = () => {
  const [{ color }] = useStore();
  const { getToolArgs } = useCurrentTool();

  // The same gate the shared bar applies, and for the same reason: this component identity is
  // mounted as a toolbox for the bucket only, and renders nothing at all when another tool is
  // active. Both hooks run before the early return, so neither is conditional.
  if (!getToolArgs('paint-bucket')) return null;

  return (
    <div className="flex h-full flex-row items-center gap-5">
      <label htmlFor="paint-bucket-fill" className={FIELD_CLASS}>
        {/* `toUpperCase` is presentation only: the store's hex is lowercase, and a stable label
            keeps the readout identical whichever case a colour source wrote it in. The value
            passed to the processor is the store's own string, untouched. */}
        Fill <span className={VALUE_CLASS}>{color.toUpperCase()}</span>
        <select id="paint-bucket-fill" className={SELECT_CLASS} defaultValue="foreground">
          <option value="foreground">Foreground</option>
          <option value="pattern" disabled>
            Pattern
          </option>
        </select>
      </label>

      <BucketBar />
    </div>
  );
};

export default PaintBucket;
