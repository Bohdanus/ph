import React, { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { savedArgsPerFigure } from '../../../tools/settings.ts';
import { usePointerPosition } from '../../../hooks/usePointerPosition.ts';
import { useDevicePixelRatio } from '../../../hooks/useDevicePixelRatio.ts';
import {
  shape,
  DEFAULT_POLYGON_SIDES,
  MAX_POLYGON_SIDES,
  MIN_POLYGON_SIDES,
  polygonSides,
  type ShapeLineCap,
  type ShapeToolArgs,
  type ShapeToolMode,
} from '../../../tools/shape.ts';
import { isLightColor } from '../../../util/color.ts';
import { useCurrentTool } from '../../../contexts/useCurrentTool.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';

const PREVIEW_WIDTH = 96;
const PREVIEW_HEIGHT = 48;

/**
 * The tool names this panel is mounted under: `toolsMap` routes all six to it —
 * `shape` itself plus the five named figure tools — and `defaultSettings` seeds
 * each of the six with its own entry, so each arrives with its own `toolName`.
 *
 * Kept HERE, beside its one consumer, rather than exported from `src/tools/shape.ts`.
 * A sibling spec mocks that module with an explicit key list, so a shape export
 * consumed here would break a test file this change does not own, and the list has
 * exactly one production reader. It is duplicated in `toolsMap`, `Main`'s
 * interaction-mode dispatch and the two tool-selection surfaces, and folding them
 * all onto one exported constant is a separate change.
 *
 * `figure` and `toolName` are NOT the same vocabulary, and the difference is a
 * spelling trap rather than a synonym: the Ellipse TOOL is `ellipse` while its
 * FIGURE is `oval`, so neither list can be derived from the other.
 */
const SHAPE_FAMILY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'shape',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'line',
]);

/**
 * Whether args naming `toolName` belong to a tool this panel serves. `unknown`
 * rather than `string` because the args under a panel are whatever the current
 * tool carries, so a panel can be mounted with a seventh tool's arguments.
 */
const isShapeFamilyToolName = (toolName: unknown): toolName is string =>
  typeof toolName === 'string' && SHAPE_FAMILY_TOOL_NAMES.has(toolName);

const figureLabel = (figure: ShapeToolArgs['figure']) => {
  if (figure === 'oval') return 'Ellipse Tool';
  if (figure === 'triangle') return 'Triangle Tool';
  if (figure === 'polygon') return 'Polygon Tool';
  if (figure === 'line') return 'Line Tool';
  return 'Rectangle Tool';
};

const Shape: React.FC = () => {
  const [{ containerRef, color, backgroundColor, totalSize }] = useStore();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const previewRef = useRef<HTMLCanvasElement | null>(null);

  const args = toolArgs as ShapeToolArgs;
  const [brushScale, setBrushScale] = useState<number>(0);
  const dpr = useDevicePixelRatio();
  const savedLineDashRef = useRef<ShapeToolArgs['lineDash']>(args.lineDash);

  usePointerPosition({ ref: containerRef, imageSize: totalSize, onResize: ({ scale }) => setBrushScale(scale) });

  /**
   * The store-colour mirror, which every one of the six shape-family tool names
   * runs — each of the six mounts THIS panel, and each carries its own
   * `defaultSettings` entry seeded at the hardcoded black. The membership test is
   * what admits all six rather than the one that opened the panel: a
   * `toolName === 'shape'` guard returned for the other five, so their args kept
   * the seeded colour forever and the committed layer was black however the
   * foreground swatch was set — while the preview, which reads the store colour
   * directly, showed the right one. Membership rather than "always mirror",
   * because the args under a panel are the current tool's whatever that tool is,
   * and a panel mounted with a seventh tool's arguments must not rewrite them.
   *
   * Both swatches are mirrored, stroke and background alike, which is what the
   * `shape` entry has always done and what `setShapeCtx` fills with. A dedicated
   * Fill swatch is a separate product decision and not this effect's business.
   */
  useEffect(() => {
    if (!isShapeFamilyToolName(args.toolName)) return;
    if (args.color === color && args.backgroundColor === backgroundColor) return;
    setToolArgs({ ...args, color, backgroundColor });
  }, [args, backgroundColor, color, setToolArgs]);

  const handleChange = (newArgs: ShapeToolArgs) => {
    savedArgsPerFigure[newArgs.figure] = {
      alpha: newArgs.alpha,
      lineWidth: newArgs.lineWidth,
      lineDash: newArgs.lineDash,
      lineCap: newArgs.lineCap,
      cornerRadius: newArgs.cornerRadius,
      sides: newArgs.sides,
      toolMode: newArgs.toolMode,
    };
    setToolArgs(newArgs);
  };

  const handleSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const lineWidth = Number(event.target.value);
    handleChange({ ...args, lineWidth });
  };

  const handleFillToggle = () => {
    const hasFill = !args.hasFill;
    handleChange({ ...args, hasFill });
  };

  const handleDashToggle = (event: ChangeEvent<HTMLInputElement>) => {
    const isDashed = event.target.checked;
    if (args.lineDash) {
      savedLineDashRef.current = args.lineDash;
    }
    const lineDash = isDashed ? (savedLineDashRef.current ?? [10, 10]) : null;
    handleChange({ ...args, lineDash });
  };

  const handleDashChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const gap = args.lineDash?.[1] ?? 10;
    const newArgs = { ...args, lineDash: [value, gap] };
    handleChange(newArgs);
  };

  const handleGapChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const dash = args.lineDash?.[0] ?? 10;
    const newArgs = { ...args, lineDash: [dash, value] };
    handleChange(newArgs);
  };

  const handleAlphaChange = (event: ChangeEvent<HTMLInputElement>) => {
    const alpha = Number(event.target.value);
    handleChange({ ...args, alpha });
  };

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    handleChange({ ...args, toolMode: event.target.value as ShapeToolMode });
  };

  const handleRadiusChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleChange({ ...args, cornerRadius: Number(event.target.value) });
  };

  /**
   * The user's in-progress text, or `null` when they are not editing.
   *
   * `null` is load-bearing rather than a convenience: it is how the input knows to
   * show the STORED count instead of a draft, so a figure switch or any other
   * external change to `sides` repaints the field correctly, and how a commit is
   * skipped entirely when there is nothing to commit.
   */
  const [sidesDraft, setSidesDraft] = useState<string | null>(null);

  const handleSidesCommit = () => {
    // Commit, not keystroke. Clamping on every `onChange` makes the field
    // unusable for the number it exists to accept: the box reads 5, the user types
    // `1`, `polygonSides(1)` is 3, the controlled value repaints as 3, and the next
    // keystroke `2` lands in a field already showing 3 — so `12` produces a 32-gon
    // and every two-digit count starting with 1 or 2 is unreachable. Nothing on
    // screen says a keystroke was discarded, and the wrong count is what gets
    // stored, persisted and drawn.
    //
    // So the draft is the user's string while they are typing and the stored value
    // only once they commit, which is also how Photoshop's own field behaves: the
    // count applies when you commit it, not as you cross a threshold on the way.
    if (sidesDraft === null) return;
    const trimmed = sidesDraft.trim();
    const sides = trimmed === '' ? DEFAULT_POLYGON_SIDES : polygonSides(Number(trimmed));
    setSidesDraft(null);
    handleChange({ ...args, sides });
  };

  const handleSidesChange = (event: ChangeEvent<HTMLInputElement>) => {
    // RAW, unclamped, and that is the whole point — see `handleSidesCommit`. The
    // empty string is kept as-is rather than resolved here, because resolving it
    // here is what repaints the field out from under the cursor mid-edit.
    setSidesDraft(event.target.value);
  };

  const handleSidesKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSidesCommit();
    } else if (event.key === 'Escape') {
      // Abandon the edit and leave the stored count exactly as it was. This is
      // also why the draft is local state and not an early `handleChange`.
      event.preventDefault();
      setSidesDraft(null);
    }
  };

  const handleCapChange = (event: ChangeEvent<HTMLSelectElement>) => {
    handleChange({ ...args, lineCap: event.target.value as ShapeLineCap });
  };

  // `hasFill` defaults to false, and the default is load-bearing rather than tidy.
  // Without it the Filled checkbox renders `checked={undefined}` on a tool whose
  // args were never set, which is an UNCONTROLLED input; the first click then makes
  // it controlled and React logs "A component is changing an uncontrolled input to
  // be controlled". `e2e/shape-tools.spec.ts` saw that on every run and could not
  // report it, because nothing in `e2e/` attached a console listener until
  // `ConsolePolice` (e2e/helpers/console-police.ts).
  const {
    alpha,
    hasFill = false,
    lineWidth,
    figure,
    lineDash,
    cornerRadius = 0,
    sides = DEFAULT_POLYGON_SIDES,
    lineCap = 'butt',
    toolMode = 'shape',
  } = args;

  useEffect(() => {
    if (!previewRef.current || !brushScale) return;

    const canvas = previewRef.current;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low'; // For better performance and sharpness
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // `brushScale` is the workspace contain fit (CSS px per document px), so the thumbnail is a
    // miniature of the stroke at the size it will actually have on the canvas. `dpr` multiplies
    // every length below: the raster is rendered at DEVICE resolution and then drawn 1:1 into a
    // dpr-sized backing store. Drawing it scaled instead would put back exactly the softness this
    // removes, because the source would be a low-resolution bitmap blown up.
    const scaledWidth = (PREVIEW_WIDTH * dpr) / brushScale;
    const scaledHeight = (PREVIEW_HEIGHT * dpr) / brushScale;

    // Always the unconstrained base shape: Circle and Square are Shift-drag
    // outcomes, not separate tools, so the preview must not imply otherwise.
    const margin = ((2.5 + Math.sqrt(lineWidth)) * dpr) / brushScale;
    const start = { x: margin, y: margin };
    const end = { x: scaledWidth - margin, y: scaledHeight - margin };
    const previewArgs = { ...args, color, start, end, lineWidth: lineWidth * dpr };

    const [toolCanvas] = shape({ size: { width: scaledWidth, height: scaledHeight } })(previewArgs);

    // 1:1, because `scaledWidth`/`scaledHeight` were already multiplied by `dpr` above.
    ctx.drawImage(toolCanvas, 0, 0, PREVIEW_WIDTH * dpr, PREVIEW_HEIGHT * dpr);
  }, [args, brushScale, color, figure, lineWidth, dpr]);

  return (
    <div className="flex flex-row flex-wrap items-center gap-4 h-full">
      <label className="flex flex-col gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300">
        Tool mode
        <select
          aria-label="Tool mode"
          value={toolMode}
          onChange={handleModeChange}
          className="h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800"
        >
          <option value="shape">Shape</option>
          <option value="path">Path</option>
          <option value="pixels">Pixels</option>
        </select>
      </label>
      <div className="flex items-center gap-2" aria-label="Current shape">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{figureLabel(figure)}</span>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Choose a shape from the left toolbar</span>
      </div>

      <div className="flex flex-col">
        <label
          htmlFor="thickness-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Thickness
          <span className="font-bold text-gray-900 dark:text-gray-200">{lineWidth}px</span>
        </label>
        <input
          id="thickness-slider"
          type="range"
          min="0.5"
          max="500"
          step="0.5"
          value={lineWidth}
          onChange={handleSizeChange}
          className="h-1.5 w-38 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      {figure === 'rectangle' && (
        <div className="flex flex-col">
          <label
            htmlFor="corner-radius-slider"
            className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
          >
            Radius <span className="font-bold text-gray-900 dark:text-gray-200">{cornerRadius}px</span>
          </label>
          <input
            id="corner-radius-slider"
            aria-label="Radius"
            type="range"
            min="0"
            max="250"
            value={cornerRadius}
            onChange={handleRadiusChange}
            className="h-1.5 w-28 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        </div>
      )}

      {/*
        Sides is a number, not a slider, and deliberately so. A range input
        cannot express "any integer from 3 to 100" without becoming unusable —
        97 steps across a 28px track — and Photoshop's own field is a text entry
        that commits a typed count. `type="number"` with step 1 and min/max is
        that control.
        *
        * The attributes are NOT what bounds the value. On a `type="number"` they
        * are constraint-validation metadata: the browser marks an out-of-range or
        * off-step entry invalid and dispatches `onChange` anyway, which is why the
        * bound lives in `polygonSides` at commit and is tested there.
      */}
      {figure === 'polygon' && (
        <div className="flex flex-col">
          <label
            htmlFor="polygon-sides-input"
            className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
          >
            Sides{' '}
            <span className="font-bold text-gray-900 dark:text-gray-200">
              {sidesDraft === null ? sides : polygonSides(Number(sidesDraft)) || DEFAULT_POLYGON_SIDES}
            </span>
          </label>
          <input
            id="polygon-sides-input"
            aria-label="Sides"
            type="number"
            min={MIN_POLYGON_SIDES}
            max={MAX_POLYGON_SIDES}
            step={1}
            value={sidesDraft ?? String(sides)}
            onChange={handleSidesChange}
            onBlur={handleSidesCommit}
            onKeyDown={handleSidesKeyDown}
            className="h-7 w-20 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800"
          />
        </div>
      )}

      {figure === 'line' && (
        <label className="flex flex-col gap-1 text-[10px] font-medium text-gray-700 dark:text-gray-300">
          Cap
          <select
            aria-label="Line cap"
            value={lineCap}
            onChange={handleCapChange}
            className="h-7 rounded border border-gray-300 bg-white px-2 text-xs dark:border-gray-600 dark:bg-gray-800"
          >
            <option value="butt">Butt</option>
            <option value="round">Round</option>
            <option value="square">Square</option>
          </select>
        </label>
      )}

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <input
            id="filled-toggle"
            type="checkbox"
            checked={hasFill}
            onChange={handleFillToggle}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="filled-toggle" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
            Filled
          </label>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="flex items-center gap-2">
          <input
            id="dash-toggle"
            type="checkbox"
            checked={!!lineDash}
            onChange={handleDashToggle}
            className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="dash-toggle" className="text-[10px] font-medium text-gray-700 dark:text-gray-300">
            Dashed
          </label>
        </div>
      </div>

      {lineDash && (
        <>
          <div className="flex flex-col ml-[-13px]">
            <label
              htmlFor="dash-slider"
              className="flex justify-between mb-2 text-[10px] font-medium text-gray-700 dark:text-gray-300"
            >
              Dash
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[0]}px</span>
            </label>
            <input
              id="dash-slider"
              type="range"
              min="1"
              max="100"
              value={lineDash[0]}
              onChange={handleDashChange}
              title={`Dash: ${lineDash[0]}px`}
              className="h-1 w-17 mb-1 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>

          <div className="flex flex-col ml-[-15px]">
            <label
              htmlFor="gap-slider"
              className="flex justify-between mb-2 text-[10px] font-medium text-gray-700 dark:text-gray-300"
            >
              Gap
              <span className="font-bold text-gray-900 dark:text-gray-200">{lineDash[1]}px</span>
            </label>
            <input
              id="gap-slider"
              type="range"
              min="1"
              max="100"
              value={lineDash[1]}
              onChange={handleGapChange}
              title={`Gap: ${lineDash[1]}px`}
              className="h-1 w-17 mb-1 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
            />
          </div>
        </>
      )}

      <div className="flex flex-col">
        <label
          htmlFor="alpha-slider"
          className="flex justify-between mb-1 text-[10px] font-medium text-gray-700 dark:text-gray-300"
        >
          Opacity
          <span className="font-bold text-gray-900 dark:text-gray-200">{Math.round(alpha * 100)}%</span>
        </label>
        <input
          id="alpha-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={handleAlphaChange}
          className="h-1.5 w-30 cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700"
        />
      </div>

      <div
        className={`flex h-12 w-24 items-center justify-center flex-shrink-0 ${
          isLightColor(color) ? 'chessboard-dark' : 'chessboard-light'
        }`}
      >
        <canvas ref={previewRef} width={PREVIEW_WIDTH * dpr} height={PREVIEW_HEIGHT * dpr} className="h-12 w-24" />
      </div>
    </div>
  );
};

export default Shape;
