import React from 'react';

import { ICON_BUTTON, SECONDARY_BUTTON } from '../buttonStyles.ts';
import { fitToScreen, stepZoom } from '../../../hooks/document-view.ts';
import { useDocumentView } from '../../../hooks/useDocumentView.ts';
import { MIN_ZOOM, MAX_ZOOM } from '../../../util/view-transform.ts';

const READOUT_CLASS = 'flex min-w-16 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS =
  'flex h-7 items-center justify-center rounded border border-gray-300 bg-white text-xs tabular-nums text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

/**
 * The Hand tool's options bar.
 *
 * Every control here is a COMMAND over the view store rather than a setting on the tool, which
 * is why `HandToolArgs` carries no fields at all. Fit On Screen is the one control Adobe's own
 * Hand page's neighbourhood names; the zoom readout and the two steppers stand in for the Zoom
 * tool this app does not have, and they are here rather than in a View menu because there is no
 * View menu.
 *
 * The percentage is printed against ACTUAL PIXELS, not against the fit. `zoom` in the store is a
 * multiplier over the contain fit, so a small image at Fit on Screen legitimately reads `25%` —
 * which is what Photoshop shows, and what printing the raw multiplier would get wrong.
 */
const Hand: React.FC<{}> = () => {
  const { zoom, fitScale } = useDocumentView();
  const percent = Math.round(fitScale * zoom * 100);

  return (
    <div className="flex h-full flex-row items-center gap-3 overflow-x-auto px-3">
      <button
        className={SECONDARY_BUTTON}
        data-testid="hand-fit-on-screen"
        onClick={() => fitToScreen()}
        title="Fit On Screen (Cmd+0, or double-click the Hand tool)"
        type="button"
      >
        Fit On Screen
      </button>

      <button
        aria-label="Zoom out"
        className={ICON_BUTTON}
        data-testid="hand-zoom-out"
        disabled={zoom <= MIN_ZOOM}
        onClick={() => stepZoom(-1)}
        title="Zoom Out (Cmd+-)"
        type="button"
      >
        &minus;
      </button>

      <div className={READOUT_CLASS}>
        {/* Not an aria-live region: a pan moves the view sixty times a second and would
            announce on every frame. The label carries the meaning for a screen reader and
            the visible text is the value. */}
        <span aria-label={`Zoom level, ${percent} per cent`} className={VALUE_CLASS} data-testid="hand-zoom-level">
          {percent}%
        </span>
      </div>

      <button
        aria-label="Zoom in"
        className={ICON_BUTTON}
        data-testid="hand-zoom-in"
        disabled={zoom >= MAX_ZOOM}
        onClick={() => stepZoom(1)}
        title="Zoom In (Cmd++)"
        type="button"
      >
        +
      </button>
    </div>
  );
};

export default Hand;
