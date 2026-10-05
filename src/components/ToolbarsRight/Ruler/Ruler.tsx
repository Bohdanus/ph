import React from 'react';

import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { formatRulerAngle, formatRulerDistance, measureRuler } from '../../../tools/ruler.ts';
import { clearRulerMeasurement, useRulerMeasurement } from '../../../tools/ruler-measurement-store.ts';

const BAR_CLASS = 'flex h-full flex-row items-center gap-5 overflow-x-auto';
const READOUT_CLASS = 'flex min-w-14 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';

/**
 * The box a number is drawn in, and why the dark fill is DARKER than the bar.
 *
 * A recessed field is what Adobe's bar shows and what the light theme already had: `bg-white` on a
 * `bg-gray-100` bar is a hole in the surface. The dark version had it the other way round —
 * `dark:bg-gray-800` on a `dark:bg-gray-800` bar — so the fill was the bar's own colour at 1.00:1
 * and the box existed only as its 1px border, which at `dark:border-gray-600` is 1.94:1. On the
 * dark bar the seven readouts rendered as seven empty outlines with text floating in front of them,
 * which is the screenshot the operator reported.
 *
 * So the fill goes to `dark:bg-gray-900` and the BORDER is what carries the box, at
 * `dark:border-gray-500`: 3.04:1 against the bar, which is the 1.4.11 floor for the boundary of a
 * user-interface component. The fill-vs-bar pair stays low by design and is not a defect — a
 * recessed field is *meant* to be a small step from its surface, and it is the border that tells
 * the user where to click and where a number lives.
 */
const VALUE_CLASS =
  'h-7 rounded border border-gray-300 bg-white px-2 text-xs tabular-nums dark:border-gray-500 dark:bg-gray-900';

/**
 * Adobe's `Clear`, and the one control on this bar that was previously unreadable in the dark theme.
 *
 * `CLEAR_CLASS` carried no text-colour utility and no ancestor in the chain supplies one: neither
 * `ToolbarHorizontal`'s `TOOLBAR_BASE_CLASS`, nor `App`, nor `body`, nor `html` sets `color`, and
 * Tailwind's preflight only sets `color: inherit` on `button`. The button therefore inherited the
 * user agent's initial `canvastext`, which is `#000000` in BOTH themes — **19.08:1** on the light bar
 * (`#f3f4f6`) and **1.43:1** on the dark one (`#1f2937`), where "Clear" was drawn in black on
 * near-black and was invisible.
 * It reads perfectly in light, which is exactly why it survived: the defect is only visible in one
 * theme, and the suite pins light. The replacement, `dark:text-gray-200` on `dark:bg-gray-700`, is
 * 8.33:1.
 *
 * It also had no `disabled:` variant while being `disabled={!measurement}`, so a Clear with nothing
 * to clear was pixel-identical to a live one. `buttonStyles.ts` records the identical omission on
 * `SECONDARY_BUTTON` and why it mattered there, so this repeats that pair deliberately.
 *
 * The vocabulary — fill, border, text, hover, disabled — is `SECONDARY_BUTTON`'s, at this bar's own
 * `h-7` rather than the shared `h-9`, because the bar is 50px tall and a 36px button in it would be
 * the tallest thing on the strip. It is given a FILL as well as a border so it cannot be mistaken
 * for another readout, which is what it looked like: a bare "Clear" in a box the same size and
 * shape as the value boxes beside it, in a bar whose every other control is a readout. There are SEVEN
 * of those — `ruler-d2` is rendered whether or not a protractor has given it a value — so Clear is the
 * eighth box, not the seventh.
 */
const CLEAR_CLASS =
  'h-7 self-end rounded border border-gray-300 bg-white px-3 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-500 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-900';

/**
 * The Ruler's options bar is a readout, not a control panel.
 *
 * Adobe's own page says the numbers live in "the options bar and Info panel", so this bar's whole
 * job is to show what the current measuring line measures. The letters are the labels because the
 * labels ARE the letters in Photoshop's bar, and a row of six identical `Length` labels would tell a
 * user nothing. The order is Adobe's own: "The starting location (X and Y) / The horizontal (W) and
 * vertical (H) distances traveled from the x and y axes / The angle measured relative to the axis
 * (A) / The total length traveled (D1) / The two lengths traveled (D1 and D2), when you use a
 * protractor".
 *
 * The app has no Info panel, so this bar is the only place the readouts exist.
 *
 * There is deliberately no `Use Measurement Scale` control. Adobe's current page does not document
 * one, the scale itself is an `Image ▸ Analysis` menu command this app does not implement, and a
 * checkbox that cannot change anything is the same false promise `Sample All Layers` was.
 */
const Ruler: React.FC<{}> = () => {
  const { getToolArgs } = useCurrentTool();
  const measurement = useRulerMeasurement();

  // The bar belongs to the tool, so it reads as absent for any other one rather than reporting a
  // stale line's numbers under a different tool's name.
  if (!getToolArgs('ruler')) return null;

  const readout = measurement ? measureRuler(measurement) : null;
  const secondLeg = readout?.secondLegLength;
  const cells = [
    { id: 'ruler-x', label: 'X', value: readout ? formatRulerDistance(readout.x) : '' },
    { id: 'ruler-y', label: 'Y', value: readout ? formatRulerDistance(readout.y) : '' },
    { id: 'ruler-w', label: 'W', value: readout ? formatRulerDistance(readout.width) : '' },
    { id: 'ruler-h', label: 'H', value: readout ? formatRulerDistance(readout.height) : '' },
    { id: 'ruler-a', label: 'A', value: readout ? formatRulerAngle(readout.angleDegrees) : '' },
    { id: 'ruler-d1', label: 'D1', value: readout ? formatRulerDistance(readout.length) : '' },
    // Absent, not `0 px`: a second leg of no length is not a second leg, and a zero here would read
    // as a protractor that measured something.
    {
      id: 'ruler-d2',
      label: 'D2',
      value: secondLeg === null || secondLeg === undefined ? '' : formatRulerDistance(secondLeg),
    },
  ];

  return (
    <div className={BAR_CLASS}>
      {cells.map(({ id, label, value }) => (
        <label className={READOUT_CLASS} key={id} htmlFor={id}>
          {label}
          <output className={VALUE_CLASS} id={id} data-testid={id}>
            {value}
          </output>
        </label>
      ))}

      <button
        type="button"
        id="ruler-clear"
        className={CLEAR_CLASS}
        onClick={clearRulerMeasurement}
        disabled={!measurement}
        data-testid="ruler-clear"
      >
        Clear
      </button>
    </div>
  );
};

export default Ruler;
