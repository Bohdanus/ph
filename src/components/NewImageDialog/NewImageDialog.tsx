import { useEffect, useRef, useState } from 'react';
import { PRESETS, computePixelsFromPreset } from '../../constants/imagePresets';
import type { BlankImageParams } from '../../contexts/tool-types.ts';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

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

// The whole app's shortcut layer is one document-level keydown listener whose only
// suppression test is isEditableTarget, which is true for textarea, contenteditable,
// text-like inputs and select. The dialog therefore has to own its keyboard: focus must
// start on a text-like control, no keydown from inside it may reach document, and focus
// must never end up outside the panel — a keydown from outside is invisible to the
// overlay's own handler, and isEditableTarget is false for body, so both Tab and Cmd+Z
// would escape while the dialog is still up.
const TEXT_LIKE_FOCUSABLE = 'select, textarea, input[type="number"], input[type="text"], input:not([type])';
const ANY_FOCUSABLE = 'select, input, textarea, button, [tabindex]:not([tabindex="-1"])';

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

  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    return () => {
      onCloseRef.current();
    };
  }, []);

  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Focus has to land back on a real control inside the panel, so try the control the
  // user had and fall back to the first that actually accepts focus (the background
  // colour input is disabled at zero opacity and would swallow the call silently).
  const pullFocusIntoPanel = (panel: HTMLElement) => {
    const restoreTo = lastFocusedRef.current;
    if (restoreTo && panel.contains(restoreTo)) {
      restoreTo.focus();
      if (panel.contains(document.activeElement)) return;
    }
    for (const candidate of panel.querySelectorAll<HTMLElement>(ANY_FOCUSABLE)) {
      candidate.focus();
      if (panel.contains(document.activeElement)) return;
    }
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Containment, leg 1: a click on the panel's own non-interactive text (the title,
    // the "Opacity:" label, which has no htmlFor) blurs the focused control and leaves
    // focus on <body>. It dispatches focusout with a null relatedTarget and no focusin
    // at all, so it is this arm, not leg 2, that has to catch it.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && panel.contains(next)) return;
      pullFocusIntoPanel(panel);
    };
    // Containment, leg 2: anything that focuses an element outside the panel, whether
    // a programmatic focus steal or a browser restoring focus, is a containment failure.
    // This is also what records the control the user was on, so a recovery lands back
    // where they were instead of on the first focusable.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) {
        if (target instanceof HTMLElement) lastFocusedRef.current = target;
        return;
      }
      pullFocusIntoPanel(panel);
    };
    // Containment, leg 3: removing the focused control leaves focus on <body> and fires
    // no focus event at all, and a keydown whose target is outside the panel never
    // reaches the overlay's React handler. So the last line is at the document capture
    // phase, above the app's own document and window listeners, which is also where
    // their keydowns have to die for the same reason they die inside the panel.
    const onDocumentKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) return;
      event.stopPropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        pullFocusIntoPanel(panel);
      }
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    panel.addEventListener('focusout', onFocusOut);

    // Taken last, so leg 2 is already watching and the mount focus becomes the
    // recovery target.
    const textLike = panel.querySelector<HTMLElement>(TEXT_LIKE_FOCUSABLE);
    (textLike ?? panel.querySelector<HTMLElement>(ANY_FOCUSABLE))?.focus();

    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onDocumentKeyDown, true);
      panel.removeEventListener('focusout', onFocusOut);
      previouslyFocused?.focus?.();
    };
  }, []);

  const handleTab = (e: React.KeyboardEvent<HTMLDivElement>, forward: boolean) => {
    const panel = panelRef.current;
    const focusables = panel?.querySelectorAll<HTMLElement>(ANY_FOCUSABLE);
    if (!panel || !focusables || focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!panel.contains(document.activeElement)) {
      e.preventDefault();
      pullFocusIntoPanel(panel);
      return;
    }
    if (!forward && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (forward && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Safe here because every app-level keydown listener (document in
    // useKeyboardEvents, window in SidebarLeft, ShapeToolArea and Transform) is an
    // ancestor in the bubble phase, and the dialog is their descendant. Stopping here
    // is what makes the buttons inside the dialog safe too, since a button is not a
    // text-like control and would otherwise re-open the shortcut hole. The only other
    // place a keydown is stopped is onDocumentKeyDown above, for a target that never
    // reaches this handler.
    e.stopPropagation();
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Tab') {
      handleTab(e, !e.shiftKey);
    }
  };

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
