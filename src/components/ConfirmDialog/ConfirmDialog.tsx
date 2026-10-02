import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The app's first generic two-button modal.
 *
 * `SaveDialog`, `NewImageDialog` and `CreateShapeDialog` each carry their own copy of
 * this shell — same `role="dialog"` wrapper, same `z-[1050]` overlay, same
 * `bg-black bg-opacity-25` backdrop, same header/footer grid — and focus ownership is
 * already shared through `useDialogFocusContainment`. This component is that shell with
 * a message instead of a form, so a confirmation reads like the dialogs around it
 * rather than like the browser's own `confirm()`.
 *
 * It replaces six native `window.confirm()` calls. The copy itself is unchanged: the
 * messages are the ones those calls already used, carried over verbatim so the
 * decision the user is being asked to make has not changed along with the widget.
 */
const ConfirmDialog = ({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) => {
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: onCancel });

  return (
    <div
      ref={panelRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      data-testid="confirm-dialog"
    >
      <div className="fixed inset-0 bg-black bg-opacity-25 transition-opacity" onClick={onCancel} />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            {/* `h2`, not `h3`, for the same reason `NewImageDialog` uses it: the shell's
                only heading is the `<h1>` in the header, so an `h3` skips a level and
                axe's `heading-order` rule fails the dialog. */}
            <h2 id="confirm-dialog-title" className="m-0 text-xl font-semibold">
              {title}
            </h2>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onCancel}
              data-testid="confirm-dialog-close-button"
            >
              <span className="relative top-[-7px] block h-6 w-6 text-2xl">×</span>
            </button>
          </div>
          <div className="relative flex-auto p-6">
            {/* `p`, not a heading: this is body copy inside a titled dialog, and an `h3`
                here would both break `heading-order` again and claim a level the
                surrounding dialogs reserve for their own titles. */}
            <p
              id="confirm-dialog-message"
              data-testid="confirm-dialog-message"
              className="m-0 text-sm text-gray-700 dark:text-gray-300"
            >
              {message}
            </p>
          </div>
          <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
            <button
              className={DIALOG_SECONDARY_BUTTON}
              type="button"
              onClick={onCancel}
              data-testid="confirm-dialog-cancel-button"
            >
              Cancel
            </button>
            <button
              className={`${PRIMARY_BUTTON} px-10 ml-3`}
              type="button"
              onClick={onConfirm}
              data-testid="confirm-dialog-confirm-button"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
