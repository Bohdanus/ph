import { useState, useEffect } from 'react';

interface SaveDialogProps {
  proposedName: string;
  onClose: () => void;
  onSave: (filename: string, format: string) => void;
}

const SaveDialog = ({ proposedName, onClose, onSave }: SaveDialogProps) => {
  const [filename, setFilename] = useState(proposedName);
  const [format, setFormat] = useState('image/png');

  useEffect(() => {
    setFilename(proposedName);
  }, [proposedName]);

  const handleSave = () => {
    onSave(filename, format);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none">
      <div className="fixed inset-0 bg-black bg-opacity-25 transition-opacity" onClick={onClose} />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h3 className="m-0 text-xl font-semibold">Save File As...</h3>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
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
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
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
              </select>
            </div>
          </div>
          <div className="flex items-center justify-end rounded-b border-t border-solid border-gray-200 p-4 dark:border-gray-700">
            <button
              className="mr-2 rounded px-4 py-2 font-bold text-gray-600 hover:bg-gray-100 focus:outline-none dark:text-gray-400 dark:hover:bg-gray-700"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="rounded bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 focus:outline-none"
              type="button"
              onClick={handleSave}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaveDialog;
