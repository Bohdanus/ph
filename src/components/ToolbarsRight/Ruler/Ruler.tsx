import React from 'react';

import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { formatRulerAngle, formatRulerDistance, measureRuler } from '../../../tools/ruler.ts';
import { clearRulerMeasurement, useRulerMeasurement } from '../../../tools/ruler-measurement-store.ts';

const BAR_CLASS = 'flex h-full flex-row items-center gap-5 overflow-x-auto';
const READOUT_CLASS = 'flex min-w-14 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS =
  'h-7 rounded border border-gray-300 bg-white px-2 text-xs tabular-nums dark:border-gray-600 dark:bg-gray-800';
const CLEAR_CLASS =
  'h-7 self-end rounded border border-gray-300 px-3 text-xs dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700';

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
