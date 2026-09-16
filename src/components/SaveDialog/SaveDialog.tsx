import { useState, useEffect } from 'react';
import type { ImageSaveResponse } from '../../contexts/useFile.tsx';
import { PRIMARY_BUTTON, DIALOG_SECONDARY_BUTTON } from '../ToolbarsRight/buttonStyles.ts';

interface SaveDialogProps {
  proposedName: string;
  onClose: () => void;
  onSave: (data: ImageSaveResponse) => Promise<void>;
}

const SaveDialog = ({ proposedName, onClose, onSave }: SaveDialogProps) => {
  const [fileName, setFileName] = useState(proposedName);
  const [format, setFormat] = useState('image/png');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFileName(proposedName);
  }, [proposedName]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ fileName, format });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none">
      <div className="fixed inset-0 bg-black bg-opacity-25 transition-opacity" onClick={saving ? undefined : onClose} />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h3 className="m-0 text-xl font-semibold">Save File As...</h3>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
              disabled={saving}
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
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPEG</option>
                <option value="image/webp">WebP</option>
                <option value="psd">Photoshop PSD (layers)</option>
              </select>
              {format === 'psd' && (
                <p className="mt-2 text-sm">
                  Preserves raster layers. Photoshop groups, editable text, masks, and effects are not exported.
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
            <button className={DIALOG_SECONDARY_BUTTON} type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className={PRIMARY_BUTTON} type="button" onClick={handleSave} disabled={saving || !fileName.trim()}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaveDialog;
