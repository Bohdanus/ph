import React from 'react';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { isLightColor } from '../../../util/color.ts';
import { ICON_BUTTON } from '../buttonStyles.ts';

/**
 * Layout and control classes, copied from `Paint/Paint.tsx:23-26` so the bars read as one
 * row of fields. `PaintBucket.tsx:7` copies the same four for the same reason.
 */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';

/**
 * The swatch box: `ICON_BUTTON` for the border and the light/dark contrast, plus the
 * `h-8 w-8` sizing `DELETE_BUTTON_ICON` in the same file already uses, and `cursor-default`
 * because unlike everything else `ICON_BUTTON` is written for, this box is a readout and
 * does not respond to a hover. The two `chessboard-*` classes are the transparency ground
 * `Paint/Paint.tsx:213-215` puts under its preview.
 */
const SWATCH_CLASS = `${ICON_BUTTON} h-8 w-8 flex-shrink-0 cursor-default`;

/**
 * The Photoshop Eyedropper options bar, which in this build is a readout rather than a set
 * of controls.
 *
 * ## Why there are no controls
 *
 * `EyedropperToolArgs` is `{ toolName: 'eyedropper' }` and nothing else, because the tool
 * is `commit: 'unimplemented'` and `tool-settings.test.ts:390-396` reduces every such tool
 * to exactly its tool name. There is nowhere for a setting to LIVE: `useCurrentTool`'s
 * `patchToolArgs` writes through `saveLastSettings`, and a value that no field of the args
 * can hold is a control that silently does not survive a tool switch. That is a worse
 * options bar than one with no options, so this one has none.
 *
 * The two Photoshop controls this is missing are therefore named rather than faked:
 *
 * - **Sample Size** (Point / 3 by 3 / 5 by 5 / 7 by 7 / 9 by 9 / 11 by 11) needs a
 *   persisted field, and an average over an 11x11 neighbourhood.
 * - **Sample All Layers** needs a persisted field AND a second code path: it samples the
 *   composited document rather than the active layer, and the composite is what
 *   `drawLayersToCanvas` builds for the canvas, not something a layer carries.
 *
 * Adding either means adding a field to `EyedropperToolArgs` and dropping the tool's
 * `commit: 'unimplemented'` registration, which is a registry change and not a bar change.
 *
 * ## What IS here
 *
 * The foreground colour the tool writes, read from the store rather than from the DOM, so
 * it is the same value `e2e/helpers/color-helpers.ts` sets through
 * `[data-testid="foreground-color-input"]` and the same one a sample from the canvas will
 * set through `SET_COLOR`. The swatch deliberately carries NO `data-testid`: those ids
 * belong to the SidebarLeft swatch that the e2e helper targets, and duplicating one would
 * make that helper's `querySelector` match whichever came first in the DOM.
 */
const Eyedropper: React.FC<{}> = () => {
  const [{ color }] = useStore();

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <div>Foreground</div>
          <span className={VALUE_CLASS}>{color}</span>
        </div>
      </div>

      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center ${
          isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
        }`}
      >
        <div className={SWATCH_CLASS} style={{ backgroundColor: color }} />
      </div>

      <div className={FIELD_CLASS}>
        <div>Click the canvas to sample a colour onto the foreground swatch.</div>
        <div className="text-gray-500 dark:text-gray-400">
          No options in this build: Sample Size and Sample All Layers are not implemented.
        </div>
      </div>
    </div>
  );
};

export default Eyedropper;
