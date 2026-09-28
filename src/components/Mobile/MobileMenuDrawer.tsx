import React, { useRef } from 'react';
import { flushSync } from 'react-dom';

import { useTheme } from '../../contexts/ThemeContext.tsx';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useFile } from '../../contexts/useFile.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { hasPendingText } from '../../util/typeGuards.ts';
import { useModalA11y } from './useModalA11y.ts';

export interface MobileMenuDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 disabled:opacity-40 disabled:pointer-events-none';

export const MobileMenuDrawer: React.FC<MobileMenuDrawerProps> = ({ isOpen, onClose }) => {
  const [{ canvasRef, currentArgs, fileName, totalSize, hasImage, hasUnsavedChanges, documentFrame }] = useStore();
  const { setBlankImage, setImageFromUpload, handleImageSave } = useApp();
  const { openNewImageDialog, openLoadImageDialog, openSaveImageDialog } = useFile();
  const { commitDirtyTool } = useLayers();
  const { theme, toggleTheme } = useTheme();
  const panelRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, onClose, panelRef);

  if (!isOpen) return null;

  /**
   * The same guard `DesktopHeader` puts on File → New and File → Open
   * (`DesktopHeader.tsx:150` / `:175`). Without it, mobile Open silently
   * discarded a document with unsaved work while the desktop menu refused —
   * and an uncommitted text layer is not in `hasUnsavedChanges` yet, so
   * `hasPendingText(currentArgs.current)` is the half that catches a typed but
   * unplaced text box.
   */
  const isDocumentDirty = hasUnsavedChanges || hasPendingText(currentArgs.current);

  const handleNew = async () => {
    try {
      if (isDocumentDirty && !confirm('Discard unsaved changes and start a new image?')) return;
      onClose();
      const data = await openNewImageDialog();
      if (data) setBlankImage(data);
    } catch (error) {
      window.alert(`Failed to create document: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleOpen = async () => {
    try {
      if (isDocumentDirty && !confirm('Discard unsaved changes and open another file?')) return;
      onClose();
      const data = await openLoadImageDialog();
      if (data) await setImageFromUpload(data);
    } catch (error) {
      window.alert(`Failed to open file: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleSave = async () => {
    onClose();
    try {
      if (!hasImage || !canvasRef.current) return;
      let exportLayers!: ReturnType<typeof commitDirtyTool>;
      // `flushSync` so the commit lands before the dialog reads `layers`.
      flushSync(() => {
        exportLayers = commitDirtyTool();
      });
      const data = await openSaveImageDialog({
        canvas: canvasRef.current,
        fileName,
        layers: exportLayers,
        size: totalSize,
        documentFrame,
      });
      if (data) handleImageSave(data);
    } catch (error) {
      window.alert(`Failed to export image: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Mobile Navigation Menu">
      <div className="fixed inset-0 bg-black/60 transition-opacity" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        id="mobile-menu-panel"
        className="safe-area-top safe-area-bottom relative flex flex-col w-4/5 max-w-xs h-full bg-white dark:bg-gray-900 shadow-2xl z-10 outline-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800">
          <span className="text-base font-bold text-gray-900 dark:text-white">Photo Editor</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            ✕
          </button>
        </div>

        {hasImage && (
          <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-800 text-xs text-gray-600 dark:text-gray-400">
            <p className="truncate font-semibold text-gray-800 dark:text-gray-200">{fileName || 'Untitled'}</p>
            <p className="mt-0.5">
              Canvas: {totalSize.width} × {totalSize.height} px
            </p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <button type="button" onClick={handleNew} data-testid="mobile-menu-new-button" className={ITEM_CLASS}>
            <span aria-hidden="true" className="text-lg">
              📄
            </span>
            <span>New Document...</span>
          </button>

          <button type="button" onClick={handleOpen} data-testid="mobile-menu-open-button" className={ITEM_CLASS}>
            <span aria-hidden="true" className="text-lg">
              📂
            </span>
            <span>Open Image...</span>
          </button>

          <button
            type="button"
            disabled={!hasImage}
            onClick={handleSave}
            data-testid="mobile-menu-save-button"
            className={ITEM_CLASS}
          >
            <span aria-hidden="true" className="text-lg">
              💾
            </span>
            <span>Export / Save Image...</span>
          </button>

          <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
            <button type="button" onClick={toggleTheme} className={ITEM_CLASS} data-testid="mobile-menu-theme-button">
              <span aria-hidden="true" className="text-lg">
                {theme === 'dark' ? '☀️' : '🌙'}
              </span>
              <span className="flex-1">{theme === 'dark' ? 'Light Theme' : 'Dark Theme'}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-700 font-mono capitalize">
                {theme}
              </span>
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-800 text-[11px] text-gray-400 text-center">
          Photo Editor • Mobile Edition
        </div>
      </div>
    </div>
  );
};
