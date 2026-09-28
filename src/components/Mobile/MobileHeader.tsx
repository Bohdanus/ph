import React from 'react';
import { flushSync } from 'react-dom';

import { useStore } from '../../contexts/StoreContext.tsx';
import { useHistory } from '../../contexts/useHistory.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { useFile } from '../../contexts/useFile.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { useLayers } from '../../contexts/useLayer.ts';

export interface MobileHeaderProps {
  onToggleLayers: () => void;
  isLayersOpen: boolean;
  /** Opens the navigation drawer. It lives in `MobileShell`, which renders the drawer last in DOM order. */
  onOpenMenu: () => void;
  isMenuOpen?: boolean;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({
  onToggleLayers,
  isLayersOpen,
  onOpenMenu,
  isMenuOpen = false,
}) => {
  const [{ canvasRef, fileName, hasImage, layers, totalSize, documentFrame }] = useStore();
  const { canUndo, undo, canRedo, redo } = useHistory();
  const { isToolDirty, resetToLastSavedArgs } = useCurrentTool();
  const { commitDirtyTool } = useLayers();
  const { openSaveImageDialog } = useFile();
  const { handleImageSave } = useApp();

  const activeLayersCount = Object.keys(layers || {}).length;

  // An uncommitted tool edit is not on the timeline yet, so `undo` would step past
  // it and discard the layer edit the user is looking at. Reverting the tool args
  // is the mobile equivalent of the desktop rule in `useHistory.undo`.
  const handleUndo = () => {
    if (isToolDirty) {
      resetToLastSavedArgs();
    } else {
      undo();
    }
  };

  const handleExport = async () => {
    try {
      if (!hasImage || !canvasRef.current) return;
      let exportLayers!: ReturnType<typeof commitDirtyTool>;
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
      window.alert(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <header
      className="safe-area-top [grid-area:header] md:hidden flex h-12 items-center justify-between gap-1 px-2 bg-[#212529] text-white border-b border-gray-800 select-none z-30"
      data-testid="mobile-header"
    >
      {/* Left: Menu toggle & File Name */}
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Open navigation menu"
          aria-haspopup="dialog"
          aria-expanded={isMenuOpen}
          aria-controls="mobile-menu-panel"
          data-testid="mobile-menu-button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="truncate text-sm font-medium text-gray-200 max-w-[100px] sm:max-w-[180px]">
          {fileName || 'Untitled'}
        </span>
      </div>

      {/* Right: Quick actions cluster */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleUndo}
          disabled={!canUndo() && !isToolDirty}
          aria-label="Undo"
          data-testid="mobile-undo-button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-base text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          ↩️
        </button>

        <button
          type="button"
          onClick={redo}
          disabled={!canRedo()}
          aria-label="Redo"
          data-testid="mobile-redo-button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-base text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          ↪️
        </button>

        <button
          type="button"
          onClick={onToggleLayers}
          aria-label="Toggle layers panel"
          aria-haspopup="dialog"
          aria-expanded={isLayersOpen}
          aria-controls="mobile-layers-panel"
          data-testid="mobile-layers-toggle-button"
          className={`relative flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sm transition-colors ${
            isLayersOpen ? 'bg-blue-600 text-white' : 'text-gray-300 hover:text-white hover:bg-gray-800'
          }`}
        >
          <span aria-hidden="true">📑</span>
          {activeLayersCount > 1 && (
            <span
              aria-hidden="true"
              className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-blue-500 text-[10px] font-bold text-white"
            >
              {activeLayersCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={handleExport}
          disabled={!hasImage}
          aria-label="Export image"
          data-testid="mobile-export-button"
          className="flex min-h-11 items-center justify-center rounded-lg px-3 text-xs font-semibold text-white shadow transition-colors bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:pointer-events-none"
        >
          Export
        </button>
      </div>
    </header>
  );
};
