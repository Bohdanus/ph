import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';
import type { AutosaveMetadata } from '../../contexts/autosave-storage.ts';

interface AutoSaveRecoveryBannerProps {
  metadata: AutosaveMetadata;
  recovering: boolean;
  onRecover: () => Promise<void>;
  onDismiss: () => Promise<void>;
}

const AutoSaveRecoveryBanner = ({ metadata, recovering, onRecover, onDismiss }: AutoSaveRecoveryBannerProps) => {
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: onDismiss });

  const formattedTime = new Date(metadata.savedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      ref={panelRef}
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="autosave-recovery-title"
      data-testid="autosave-recovery-banner"
    >
      <div className="fixed inset-0 bg-black bg-opacity-25" />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h2 id="autosave-recovery-title" className="m-0 text-xl font-semibold">
              Recovery Available
            </h2>
          </div>
          <div className="relative flex-auto p-6">
            <p className="m-0 mb-3 text-sm text-gray-700 dark:text-gray-300">
              AutoSave found a recovery copy of your previous document.
            </p>
            <p className="m-0 text-xs text-gray-500 dark:text-gray-400">Saved at {formattedTime}</p>
          </div>
          <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
            <button
              className={DIALOG_SECONDARY_BUTTON}
              type="button"
              onClick={onDismiss}
              disabled={recovering}
              data-testid="autosave-recovery-dismiss-button"
            >
              Dismiss
            </button>
            <button
              className={`${PRIMARY_BUTTON} px-10 ml-3`}
              type="button"
              onClick={onRecover}
              disabled={recovering}
              data-testid="autosave-recovery-recover-button"
            >
              {recovering ? 'Recovering...' : 'Recover'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutoSaveRecoveryBanner;
