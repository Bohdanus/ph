import { useState } from 'react';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';
import type { FigureType } from '../../tools/shape.ts';

/**
 * The `Create <Figure>` dialog, which is what a bare click on the canvas opens.
 *
 * Adobe documents the dialog for the figure tools and names its fields per figure. The
 * only contract that is CURRENTLY documented is one sentence, for the Rectangle:
 * "Click on the canvas to bring up the Create Rectangle dialog" — manally set "the
 * dimensions, corner radii of your rectangle, and choose to align from centre"
 * (https://helpx.adobe.com/photoshop/using/modify-shapes.html). The Triangle adds
 * Corner Radius, Equilateral and From Center
 * (https://helpx.adobe.com/photoshop/using/tool-techniques/triangle-tool.html). The
 * Line has NO click dialog at all — Adobe documents drag and release only
 * (https://helpx.adobe.com/photoshop/using/tool-techniques/line-tool.html), so
 * `ShapeToolArea` never opens this for it.
 *
 * The field set here is deliberately the INTERSECTION of what Adobe documents and what
 * the renderer implements:
 *
 * - Width and Height — every documented figure.
 * - From Center — every documented figure.
 * - Corner Radius — the Rectangle and the Triangle per Adobe, but `drawShape` reads
 *   `args.cornerRadius` in its rectangle branch ONLY (`src/tools/shape.ts:339`), so the
 *   field is gated to the rectangle. Offering it on a triangle would be a control that
 *   accepts a value and does nothing, which is the defect, not the feature.
 *
 * Polygon is the one figure whose full field list Adobe published and then stopped
 * publishing: a January 2021 archive of `drawing-shapes.html` names Width & Height,
 * Symmetric, Number of Sides, Corner Radius, Star Ratio, Smooth Star Indents and From
 * Center, and a 2025 capture of the same URL does not contain it. The renderer hardcodes
 * five sides and reads no star or indent argument (`src/tools/shape.ts:305`), so those
 * fields would all be inert; HANDOFF.md carries them as the gap rather than this dialog
 * pretending to offer them.
 *
 * Defaults are not documented by Adobe. 100 px seeds both fields because it is the value
 * the `window.prompt` pair this dialog replaces used (`ShapeToolArea`'s bare-click path
 * before commit c8c27619), so the seed is a continuity choice and not an Adobe claim.
 */

const DIALOG_DEFAULTS = { width: 100, height: 100 };

/** The figures Adobe opens a click dialog for. The Line is excluded by contract, not by taste. */
export type CreateShapeFigure = Exclude<FigureType, 'line'>;

const figureDialogTitle: Record<CreateShapeFigure, string> = {
  rectangle: 'Create Rectangle',
  oval: 'Create Ellipse',
  triangle: 'Create Triangle',
  polygon: 'Create Polygon',
  star: 'Create Star',
};

export interface CreateShapeParams {
  width: number;
  height: number;
  fromCenter: boolean;
  cornerRadius?: number;
}

interface CreateShapeDialogProps {
  figure: CreateShapeFigure;
  /** Seeds the Corner Radius field, and is the rectangle bar's live radius. */
  cornerRadius?: number;
  /**
   * Seeds the From Center checkbox from the Alt/Option held at the press.
   *
   * A seed and not a lock: the checkbox is editable, because once the dialog is up the dialog
   * owns From Center and a user who held Alt by habit must be able to turn it off. Adobe does
   * not document what a modifier held at the click does to the dialog, so the honest reading
   * is that it does nothing at all — this is the app's own drag-time Alt behaviour offered as
   * a default, and the test that asserts the checkbox can be cleared is what keeps it a seed.
   */
  initialFromCenter?: boolean;
  onClose: () => void;
  onCreate: (params: CreateShapeParams) => void;
}

const CreateShapeDialog = ({
  figure,
  cornerRadius = 0,
  initialFromCenter = false,
  onClose,
  onCreate,
}: CreateShapeDialogProps) => {
  const [width, setWidth] = useState(DIALOG_DEFAULTS.width);
  const [height, setHeight] = useState(DIALOG_DEFAULTS.height);
  const [fromCenter, setFromCenter] = useState(initialFromCenter);
  const [radius, setRadius] = useState(cornerRadius);

  // A field that cannot describe a drawable shape is not a field. `min="1"` on the inputs
  // is the browser's half of this; this is the half that also covers an emptied input,
  // whose value arrives as NaN rather than as 0.
  const isDrawable = Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1;

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isDrawable) return;
    onCreate({
      width,
      height,
      fromCenter,
      ...(figure === 'rectangle' ? { cornerRadius: radius } : {}),
    });
    onClose();
  };

  // Focus ownership — mount focus, the containment arms, the Tab wrap and the restore on
  // unmount — is the shared hook's; see its module comment for why a dialog has to own its
  // keyboard. It opens focus on the first `input[type="number"]`, which is Width, matching
  // the tab order a user expects in a dialog whose only job is a size.
  //
  // Unlike `NewImageDialog`, this dialog does NOT close on unmount: the caller is a tool
  // area whose mount is not tied to the dialog's, and `ShapeToolArea` decides the dialog's
  // lifetime through its own state. Closing here as well would fire `onClose` twice.
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: onClose });

  return (
    <div
      ref={panelRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-shape-dialog-title"
      data-testid="create-shape-dialog"
    >
      <div
        className="fixed inset-0 bg-black bg-opacity-25 transition-opacity"
        onClick={onClose}
        data-testid="create-shape-dialog-backdrop"
      />
      <div className="relative mx-auto my-6 w-full max-w-md px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h2 id="create-shape-dialog-title" className="m-0 text-xl font-semibold">
              {figureDialogTitle[figure]}
            </h2>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
              data-testid="create-shape-dialog-close-button"
            >
              <span className="relative top-[-7px] block h-6 w-6 text-2xl">×</span>
            </button>
          </div>
          <form onSubmit={handleCreate} data-testid="create-shape-dialog-form">
            <div className="relative flex-auto p-6">
              <div className="mb-4">
                <label
                  htmlFor="create-shape-width"
                  className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300"
                >
                  Width (px)
                </label>
                <input
                  type="number"
                  id="create-shape-width"
                  min="1"
                  step="1"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  data-testid="create-shape-width-input"
                />
              </div>
              <div className="mb-4">
                <label
                  htmlFor="create-shape-height"
                  className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300"
                >
                  Height (px)
                </label>
                <input
                  type="number"
                  id="create-shape-height"
                  min="1"
                  step="1"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  data-testid="create-shape-height-input"
                />
              </div>
              {figure === 'rectangle' && (
                <div className="mb-4">
                  <label
                    htmlFor="create-shape-radius"
                    className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300"
                  >
                    Corner Radius (px)
                  </label>
                  <input
                    type="number"
                    id="create-shape-radius"
                    min="0"
                    step="1"
                    value={radius}
                    onChange={(e) => setRadius(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                    data-testid="create-shape-radius-input"
                  />
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={fromCenter}
                  onChange={(e) => setFromCenter(e.target.checked)}
                  data-testid="create-shape-from-center"
                />
                From Center
              </label>
            </div>
            <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
              <button
                className={DIALOG_SECONDARY_BUTTON}
                type="button"
                onClick={onClose}
                data-testid="create-shape-dialog-cancel-button"
              >
                Cancel
              </button>
              <button
                className={`${PRIMARY_BUTTON} px-10 ml-3`}
                type="submit"
                disabled={!isDrawable}
                data-testid="create-shape-dialog-submit-button"
              >
                OK
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CreateShapeDialog;
