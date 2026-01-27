import { useState } from 'react';

interface NewImageDialogProps {
  onClose: () => void;
  onCreate: (width: number, height: number) => void;
}

const NewImageDialog = ({ onClose, onCreate }: NewImageDialogProps) => {
  const [width, setWidth] = useState(800);
  const [height, setHeight] = useState(600);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate(width, height);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[1050] flex items-center justify-center overflow-y-auto overflow-x-hidden outline-none focus:outline-none">
      <div className="fixed inset-0 bg-black bg-opacity-25 transition-opacity" onClick={onClose} />
      <div className="relative mx-auto my-6 w-full max-w-lg px-4">
        <div className="relative flex w-full flex-col rounded-lg border-0 bg-white shadow-lg outline-none focus:outline-none dark:bg-gray-800 dark:text-gray-100">
          <div className="flex items-center justify-between rounded-t border-b border-solid border-gray-200 p-4 dark:border-gray-700">
            <h3 className="m-0 text-xl font-semibold">New Image</h3>
            <button
              className="ml-auto border-0 bg-transparent p-1 text-3xl font-semibold leading-none text-black opacity-50 outline-none hover:opacity-100 focus:outline-none dark:text-white"
              onClick={onClose}
            >
              <span className="block h-6 w-6 text-2xl">×</span>
            </button>
          </div>
          <form onSubmit={handleCreate}>
            <div className="relative flex-auto p-6">
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
                  onChange={(e) => setWidth(parseInt(e.target.value) || 0)}
                  required
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
                  onChange={(e) => setHeight(parseInt(e.target.value) || 0)}
                  required
                />
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
                type="submit"
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
