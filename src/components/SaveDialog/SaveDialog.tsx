import { useEffect, useRef, useState } from 'react';
import type { ImageSaveResponse } from '../../contexts/useFile.tsx';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { DEFAULT_JPEG_QUALITY, IMAGE_FORMATS, PSD_FORMAT } from '../../constants/imageFormats.ts';

interface SaveDialogProps {
  proposedName: string;
  onClose: () => void;
  onSave: (data: ImageSaveResponse) => Promise<void>;
}

// The whole app's shortcut layer is one document-level keydown listener whose only
// suppression test is isEditableTarget, which is true for textarea, contenteditable,
// text-like inputs and select. A button is not text-like, and <body> is not either, so
// the dialog has to own its keyboard: focus must start on a text-like control, no keydown
// from inside it may reach document, and focus must never end up outside the panel — a
// keydown from outside is invisible to the overlay's own handler, so both Tab and Cmd+Z
// would escape while the dialog is still up.
const TEXT_LIKE_FOCUSABLE = 'select, textarea, input[type="number"], input[type="text"], input:not([type])';
const ANY_FOCUSABLE = 'select, input, textarea, button, [tabindex]:not([tabindex="-1"])';

const SaveDialog = ({ proposedName, onClose, onSave }: SaveDialogProps) => {
  const [fileName, setFileName] = useState(() => proposedName);
  const [format, setFormat] = useState('image/png');
  const [jpegQuality, setJpegQuality] = useState(DEFAULT_JPEG_QUALITY);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(format === 'image/jpeg' ? { fileName, format, quality: jpegQuality } : { fileName, format });
    } catch (error) {
      console.error('Failed to save file:', error);
      window.alert(`Failed to save file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  const panelRef = useRef<HTMLDivElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  // The mount effect runs once, so it cannot close over a live `onClose` without
  // capturing the first one the parent passed. The ref is synced after every render,
  // in an effect rather than during render, which is the rule: writing a ref during
  // render is a side effect, and a concurrent render that is thrown away would have
  // left the committed one holding a callback from a render that never happened.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus has to land back on a real control inside the panel, so every candidate is
  // checked rather than assumed to accept it. A disabled control swallows focus()
  // silently, and this dialog disables three of its five controls — the header close,
  // Cancel and Save are all off while a save is in flight, and Save is off whenever the
  // filename is blank — so focusing the first candidate and returning unconditionally
  // would strand the dialog on a control that cannot be typed into or activated.
  const pullFocusIntoPanel = (panel: HTMLElement) => {
    const restoreTo = lastFocusedRef.current;
    if (restoreTo && panel.contains(restoreTo)) {
      restoreTo.focus();
      if (panel.contains(document.activeElement)) return;
    }
    for (const candidate of panel.querySelectorAll<HTMLElement>(ANY_FOCUSABLE)) {
      if (candidate.hasAttribute('disabled')) continue;
      candidate.focus();
      if (panel.contains(document.activeElement)) return;
    }
  };

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Containment, leg 1: a click on the panel's own non-interactive text (the title)
    // blurs the focused control and leaves focus on <body>. It dispatches focusout with a
    // null relatedTarget and no focusin at all, so it is this arm, not leg 2, that has to
    // catch it.
    const onFocusOut = (event: FocusEvent) => {
      const next = event.relatedTarget;
      if (next instanceof Node && panel.contains(next)) return;
      pullFocusIntoPanel(panel);
    };
    // Containment, leg 2: anything that focuses an element outside the panel, whether a
    // programmatic focus steal or a browser restoring focus, is a containment failure.
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
      // Only Tab is swallowed here. Every other key is still suppressed against the
      // app's own listeners — that is the point of the capture phase — but Escape
      // has to be dispatched from the document too, because a keydown whose target
      // is <body> never reaches the React handler, and a dialog that cannot be
      // closed by keyboard is a trap.
      //
      // This arm is NOT reachable through this dialog's own UI, and there is
      // deliberately no test for it: the focusout arm below recovers focus from
      // <body> before any subsequent keydown can be body-targeted, so a test would
      // have to disable containment to reach the state, and then it would only prove
      // the fix against a sabotage. It stays because the alternative is a document
      // listener that suppresses Escape and dispatches nothing, which is the trap
      // waiting for the next control this dialog learns to remove.
      if (event.key === 'Tab') {
        event.stopPropagation();
        event.preventDefault();
        pullFocusIntoPanel(panel);
        return;
      }
      event.stopPropagation();
      if (event.key === 'Escape') onCloseRef.current?.();
    };

    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    panel.addEventListener('focusout', onFocusOut);

    // Taken last, so leg 2 is already watching and the mount focus becomes the
    // recovery target. Two selectors, because the first focusable in document order is
    // the header close button and autofocusing that would re-open the very hole the
    // focus move closes.
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
    // Re-queried per keystroke: the JPEG quality slider appears and disappears with the
    // format, so the wrap points move while the dialog is open.
    // Filtered to controls that accept focus. A wrap endpoint has to accept it: the
    // Save button is disabled whenever the filename is blank, and `focus()` on a
    // disabled control is a no-op, so wrapping to it would eat the keystroke AND
    // leave focus where it was — which strands the dialog with no forward or
    // backward route to the filename field, the format select, or Cancel.
    const focusables = panel
      ? [...panel.querySelectorAll<HTMLElement>(ANY_FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'))
      : [];
    if (!panel || focusables.length === 0) return;
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
    // ancestor in the bubble phase, and the dialog is their descendant. Stopping here is
    // what makes the buttons inside the dialog safe too, since a button is not a text-like
    // control and would otherwise re-open the shortcut hole. The only other place a
    // keydown is stopped is onDocumentKeyDown above, for a target that never reaches this
    // handler.
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
      aria-labelledby="save-dialog-title"
      data-testid="save-dialog"
    >
      <div
        className="fixed inset-0 bg-black bg-opacity-25 transition-opacity"
        onClick={saving ? undefined : onClose}
        data-testid="save-dialog-backdrop"
      />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h3 id="save-dialog-title" className="m-0 text-xl font-semibold">
              Save File As...
            </h3>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
              disabled={saving}
              data-testid="save-dialog-close-button"
            >
              <span className="block h-6 w-6 text-2xl">×</span>
            </button>
          </div>
          <div className="relative flex-auto p-6">
            <div className="mb-4">
              <label htmlFor="filenameInput" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                Filename
              </label>
              <input
                type="text"
                className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                id="filenameInput"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                data-testid="save-dialog-filename-input"
              />
            </div>
            <div className="mb-4">
              <label htmlFor="formatSelect" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-300">
                Format
              </label>
              <select
                className="w-full rounded border px-3 py-2 leading-tight text-gray-700 shadow focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                id="formatSelect"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                data-testid="save-dialog-format-select"
              >
                {IMAGE_FORMATS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
                <option value={PSD_FORMAT.value}>{PSD_FORMAT.label}</option>
              </select>
              {format === 'image/jpeg' && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-sm font-bold text-gray-700 dark:text-gray-300">
                    <label htmlFor="jpegQuality">JPEG quality</label>
                    <span>{Math.round(jpegQuality * 100)}%</span>
                  </div>
                  <input
                    id="jpegQuality"
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.01"
                    value={jpegQuality}
                    onChange={(e) => setJpegQuality(Number(e.target.value))}
                    disabled={saving}
                    className="w-full"
                    data-testid="save-dialog-jpeg-quality"
                  />
                </div>
              )}
              {format === 'psd' && (
                <p className="mt-2 text-sm">
                  Preserves raster layers. Photoshop groups, editable text, masks, and effects are not exported.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
            <button
              className={DIALOG_SECONDARY_BUTTON}
              type="button"
              onClick={onClose}
              disabled={saving}
              data-testid="save-dialog-cancel-button"
            >
              Cancel
            </button>
            <button
              className={PRIMARY_BUTTON}
              type="button"
              onClick={handleSave}
              disabled={saving || !fileName.trim()}
              data-testid="save-dialog-submit-button"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaveDialog;
