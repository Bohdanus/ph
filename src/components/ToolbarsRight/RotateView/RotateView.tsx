import React, { type ChangeEvent } from 'react';

import { SECONDARY_BUTTON } from '../buttonStyles.ts';
import { setRotation } from '../../../hooks/document-view.ts';
import { useDocumentView } from '../../../hooks/useDocumentView.ts';
import { MAX_ROTATION, MIN_ROTATION } from '../../../util/view-transform.ts';

/**
 * The Rotate View options bar: Adobe's **Rotation Angle** field and **Reset View**.
 *
 * Both are named on Adobe's own page — "enter rotation numerically in the Rotation Angle field in
 * the Options Bar. Select Reset View … to return to normal orientation" — so the bar is those two
 * controls and nothing else. No rotate-by-stepper buttons: Adobe's bar has none, and a tool
 * cloned from Photoshop gains nothing from an invented affordance.
 *
 * **Reset View sets the ANGLE ONLY.** Adobe says "return to normal orientation", which is the
 * rotation and not the framing; a Reset that also re-fitted and re-centred would be a different
 * command wearing its name, and would discard a pan the user had positioned deliberately. That is
 * why this is `setRotation(0)` and not `fitToScreen()`.
 *
 * The field is CONTROLLED, following the Font Size field in `ToolbarsRight/Text/Text.tsx`. An
 * empty field publishes nothing — `Number('')` is `0`, which is finite, so a bare
 * `Number.isFinite` guard lets a cleared field through and the view would jump as the user
 * selects the value to retype. That file's comment records the same trap and the same limitation
 * this one inherits: a value typed from scratch passes through intermediate states, so typing
 * `3` then `7` can publish `3` and rewrite the field before the second digit lands. Fixing that
 * properly needs a local draft state and is a change to both fields at once.
 */
const RotateView: React.FC<{}> = () => {
  const { rotation } = useDocumentView();

  const handleAngleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;
    if (raw.trim() === '') return;

    const requested = Number(raw);
    if (!Number.isFinite(requested)) return;

    setRotation(Math.min(MAX_ROTATION, Math.max(MIN_ROTATION, requested)));
  };

  return (
    <div className="flex h-full flex-row items-center gap-3 overflow-x-auto px-3">
      <button
        className={SECONDARY_BUTTON}
        data-testid="rotate-view-reset"
        onClick={() => setRotation(0)}
        title="Reset View — the angle only; the pan and zoom are untouched"
        type="button"
      >
        Reset View
      </button>

      <label
        className="flex flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300"
        htmlFor="rotate-view-angle"
      >
        Rotation Angle
        <input
          aria-label="Rotation Angle"
          className="h-7 w-20 rounded border border-gray-300 bg-white px-1 text-xs tabular-nums text-gray-900 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          data-testid="rotate-view-angle"
          id="rotate-view-angle"
          max={MAX_ROTATION}
          min={MIN_ROTATION}
          onChange={handleAngleChange}
          // `any`, for the reason the Font Size field gives: per the HTML step algorithm the base
          // is `min`, so `step={1}` over a negative `min` puts the rungs off-grid.
          step="any"
          type="number"
          value={Math.round(rotation * 10) / 10}
        />
      </label>
    </div>
  );
};

export default RotateView;
