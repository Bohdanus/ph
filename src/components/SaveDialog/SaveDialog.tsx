import { useState } from 'react';
import type { ImageSaveResponse } from '../../contexts/useFile.tsx';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';
import { DEFAULT_JPEG_QUALITY, IMAGE_FORMATS, PSD_FORMAT } from '../../constants/imageFormats.ts';
import { useDialogFocusContainment } from '../../hooks/useDialogFocusContainment.ts';

interface SaveDialogProps {
  proposedName: string;
  onClose: () => void;
  onSave: (data: ImageSaveResponse) => Promise<void>;
}

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
    } finally {
      setSaving(false);
    }
  };

  // Focus ownership — mount focus, the three containment arms, the Tab wrap and the
  // restore on unmount — lives in one shared hook; see its module comment for why the
  // dialog has to own its keyboard at all.
  const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: onClose });

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
