import React, { useEffect, useRef, type ChangeEvent } from 'react';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import type { GradientToolArgs } from '../../../tools/gradient.ts';
import { ICON_BUTTON } from '../buttonStyles.ts';

/** Layout and control classes, copied from `Paint/Paint.tsx:23-26` so the bars read as one row of fields. */
const FIELD_CLASS = 'flex min-w-28 flex-col text-[10px] font-medium text-gray-700 dark:text-gray-300';
const VALUE_CLASS = 'font-bold text-gray-900 dark:text-gray-200';
const SLIDER_CLASS = 'h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700';
const SELECT_CLASS = 'h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800';

/** Photoshop's five gradient types reduced to the two the fixed args shape can hold. */
const GRADIENT_TYPES: readonly { value: GradientToolArgs['type']; label: string }[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'radial', label: 'Radial' },
];

const toPercent = (alpha: number): number => Math.round(alpha * 100);

/**
 * The Photoshop Gradient options bar: Type, Opacity and the two colour stops.
 *
 * ## Why the label text stands alone
 *
 * `<label htmlFor>` carries the control's accessible name, and the value readout is a sibling of
 * the label rather than a child of it. Nesting the readout inside the label — as
 * `Levels/Levels.tsx:105` does — makes the name "Opacity 100%", which changes with every drag;
 * keeping the name to the static word is what lets a test locate the control by role and name
 * and have that lookup keep working. `Contiguous` in `PaintBucket/PaintBucket.tsx` is built the
 * same way, and this is the same deliberate departure from the Levels bar.
 *
 * ## No `data-testid`
 *
 * House rule for the options bars, and the reason the labels above are written the way they are.
 *
 * ## Not rendered
 *
 * Photoshop's gradient picker also has **Angle**, **Reflected**, **Diamond**, a
 * reverse/loop/dither group and per-stop opacity, position and midpoints. None of them has a home
 * in `GradientToolArgs` — it holds exactly `type`, `from`, `to`, `colorA`, `colorB`, `alpha` — and
 * a control that silently drops its value is worse than an absent one. Rendering the two stops
 * this bar does own is the whole of what the args can carry.
 *
 * ## The two stops are args-only, unlike the bucket's single fill colour
 *
 * The store has one foreground colour, not a pair, so a stop cannot be written through it the way
 * the bucket's fill colour is. Both stops live in the tool args and are persisted by
 * `saveLastSettings` like every other tool setting. `from`/`to` are the one setting this bar does
 * not expose: they are the drag, and a gradient's geometry is a gesture rather than a preference,
 * so the last drag's endpoints come back when the tool is reselected and the next drag replaces
 * them.
 */
const Gradient: React.FC<{}> = () => {
  const { getToolArgs, patchToolArgs } = useCurrentTool();

  const args = getToolArgs('gradient');
  const pendingRef = useRef<GradientToolArgs | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  /**
   * One write per frame while a slider is dragged, not one per input event: `patchToolArgs`
   * publishes to React state and to `saveLastSettings`, and a range control emits an event per
   * pointer move. The pending value is kept in a ref so the frame that lands always carries the
   * newest one rather than the value the drag started on.
   */
  const throttledPatch = (patch: Partial<GradientToolArgs>) => {
    if (!args) return;

    pendingRef.current = { ...args, ...patch };
    if (rafIdRef.current !== null) return;

    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (pendingRef.current === null) return;

      patchToolArgs('gradient', pendingRef.current);
      pendingRef.current = null;
    });
  };

  if (!args) return null;

  const handleTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    const type = GRADIENT_TYPES.find((entry) => entry.value === value)?.value;
    if (!type) return;

    patchToolArgs('gradient', { type });
  };

  const handleOpacityChange = (event: ChangeEvent<HTMLInputElement>) => {
    throttledPatch({ alpha: Number(event.target.value) / 100 });
  };

  const handleColorAChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('gradient', { colorA: event.target.value });
  };

  const handleColorBChange = (event: ChangeEvent<HTMLInputElement>) => {
    patchToolArgs('gradient', { colorB: event.target.value });
  };

  return (
    <div className="flex h-full flex-row items-center gap-5 overflow-x-auto">
      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="gradient-type">Type</label>
        </div>
        <select id="gradient-type" className={SELECT_CLASS} value={args.type} onChange={handleTypeChange}>
          {GRADIENT_TYPES.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="gradient-opacity">Opacity</label>
          <span className={VALUE_CLASS}>{toPercent(args.alpha)}%</span>
        </div>
        <input
          id="gradient-opacity"
          className={SLIDER_CLASS}
          max="100"
          min="0"
          step="1"
          type="range"
          value={toPercent(args.alpha)}
          onChange={handleOpacityChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="gradient-color-a">Colour A</label>
        </div>
        <input
          id="gradient-color-a"
          className={ICON_BUTTON}
          type="color"
          value={args.colorA}
          onChange={handleColorAChange}
        />
      </div>

      <div className={FIELD_CLASS}>
        <div className="flex justify-between">
          <label htmlFor="gradient-color-b">Colour B</label>
        </div>
        <input
          id="gradient-color-b"
          className={ICON_BUTTON}
          type="color"
          value={args.colorB}
          onChange={handleColorBChange}
        />
      </div>
    </div>
  );
};

export default Gradient;
