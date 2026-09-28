import { useEffect, useRef, useState } from 'react';
import { PRESETS, computePixelsFromPreset } from '../../constants/imagePresets';
import type { BlankImageParams } from '../../contexts/tool-types.ts';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';

interface NewImageDialogProps {
  onClose: () => void;
  // The payload is `BlankImageParams` and nothing else: a pixel `size`, a `color` that is
  // always sent and required by the type, and `opacity` -- the last parameter, which says
  // whether the background is opaque, false leaving it transparent.
  //
  // There is deliberately no `dpi` here, and none on the type. DPI is a one-shot
  // physical-to-pixel conversion: it is applied to the width/height inputs by
  // `computePixelsFromPreset` and is spent by the time the form submits, so the created
  // document carries the correct pixel size and no provenance. Recording it would mean a
  // `dpi` field on `BlankImageParams` that `history-adapter.ts:153` then silently drops --
  // that case is an explicit whitelist -- and a new field on `DurableLayerSource`'s blank
  // arm (`history-model.ts:13`) under `DURABLE_SCHEMA_VERSION = 1`, for metadata no
  // surface displays. The user asked for a pixel size, and got one.
  //
  // The control is coherent because `PRESETS.custom` carries neither `widthMm` nor
  // `widthIn` (`imagePresets.ts:17`): the field is hidden for pixel-unit presets, editing
  // either dimension forces the preset back to `custom`, and so DPI exists only for the six
  // physical presets, where it has a physical size to convert.
  onCreate: (params: BlankImageParams) => void;
}

const NewImageDialog = ({ onClose, onCreate }: NewImageDialogProps) => {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);
  const [presetId, setPresetId] = useState<string>('custom');
  const [dpi, setDpi] = useState<number>(300);
  const [background, setBackground] = useState<string>('#ffffff');
  const [opacity, setOpacity] = useState<number>(1);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({ color: background, opacity, size: { width, height }, isBedrock: true });
    onClose();
  };

  // Closing on unmount is this dialog's own lifecycle decision, not part of focus
  // ownership, so it stays here rather than moving into the shared hook: the hook
  // dispatches Escape and nothing else, because `SaveDialog` must not close itself when
  // it unmounts — its `onSave` resolves and the CALLER closes it. The ref exists only so
  // this mount-once effect does not close over the first `onClose` the parent passed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    return () => {
      onCloseRef.current();
    };
  }, []);

  // Focus ownership — mount focus, the three containment arms, the Tab wrap and the
  // restore on unmount — is the shared hook's; see its module comment for why a dialog
  // has to own its keyboard at all. Called after the unmount-close effect above so the
  // focus restore still runs second, as it did while both lived in this file.
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: onClose });

  return (
    <div
      ref={panelRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-image-dialog-title"
      data-testid="new-image-dialog"
    >
      <div className="fixed inset-0 bg-black bg-opacity-25 transition-opacity" onClick={onClose} />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h3 id="new-image-dialog-title" className="m-0 text-xl font-semibold">
              New Image
            </h3>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
              data-testid="new-image-dialog-close-button"
            >
              <span className="relative top-[-7px] block h-6 w-6 text-2xl">×</span>
            </button>
          </div>
          <form onSubmit={handleCreate} data-testid="new-image-dialog-form">
            <div className="relative flex-auto p-6">
              <div className={`mb-4 grid gap-3 ${PRESETS[presetId]?.unit !== 'px' ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div>
                  <label
                    htmlFor="presetSelect"
                    className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300"
                  >
                    Preset
                  </label>
                  <select
                    id="presetSelect"
                    value={presetId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setPresetId(id);
                      if (id !== 'custom') {
                        const preset = PRESETS[id];
                        if (preset) {
                          const { width: w, height: h } = computePixelsFromPreset({ ...preset, id }, dpi);
                          // clamp
                          setWidth(Math.min(10000, Math.max(1, w)) || 1);
                          setHeight(Math.min(10000, Math.max(1, h)) || 1);
                        }
                      }
                    }}
                    className="w-full rounded border px-3 py-2 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                    data-testid="new-image-preset-select"
                  >
                    {Object.entries(PRESETS).map(([id, p]) => (
                      <option key={id} value={id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                {PRESETS[presetId]?.unit !== 'px' && (
                  <div>
                    <label htmlFor="dpiInput" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                      DPI
                    </label>
                    <input
                      id="dpiInput"
                      type="number"
                      min={1}
                      max={2400}
                      value={dpi}
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 1;
                        setDpi(v);
                        if (presetId !== 'custom') {
                          const preset = PRESETS[presetId];
                          if (preset) {
                            const { width: w, height: h } = computePixelsFromPreset({ ...preset, id: presetId }, v);
                            setWidth(Math.min(10000, Math.max(1, w)) || 1);
                            setHeight(Math.min(10000, Math.max(1, h)) || 1);
                          }
                        }
                      }}
                      className="w-full rounded border px-3 py-2 text-gray-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                      data-testid="new-image-dpi-input"
                    />
                  </div>
                )}{' '}
                <div>
                  <label
                    htmlFor="bgColorInput"
                    className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300"
                  >
                    Background
                  </label>
                  <input
                    id="bgColorInput"
                    type="color"
                    value={background}
                    onChange={(e) => setBackground(e.target.value)}
                    className="h-10 w-full rounded border px-3 py-2 text-gray-700 dark:border-gray-600 dark:bg-gray-700"
                    disabled={opacity === 0}
                  />
                  <label className="mt-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                    Opacity: {(opacity * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={opacity}
                    onChange={(e) => setOpacity(parseFloat(e.target.value))}
                    className="mt-2 w-full"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label htmlFor="widthInput" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                  Width (px)
                </label>
                <input
                  type="number"
                  className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  id="widthInput"
                  min="1"
                  max="10000"
                  value={width}
                  onChange={(e) => {
                    setWidth(parseInt(e.target.value) || 0);
                    setPresetId('custom');
                  }}
                  required
                  data-testid="new-image-width-input"
                />
              </div>
              <div className="mb-4">
                <label htmlFor="heightInput" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                  Height (px)
                </label>
                <input
                  type="number"
                  className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                  id="heightInput"
                  min="1"
                  max="10000"
                  value={height}
                  onChange={(e) => {
                    setHeight(parseInt(e.target.value) || 0);
                    setPresetId('custom');
                  }}
                  required
                  data-testid="new-image-height-input"
                />
              </div>
            </div>
            <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
              <button
                className={DIALOG_SECONDARY_BUTTON}
                type="button"
                onClick={onClose}
                data-testid="new-image-dialog-cancel-button"
              >
                Cancel
              </button>
              <button
                className={`${PRIMARY_BUTTON} px-10 ml-3`}
                type="submit"
                data-testid="new-image-dialog-submit-button"
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

export default NewImageDialog;
