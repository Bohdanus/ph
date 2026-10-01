import React from 'react';
import { flushSync } from 'react-dom';

import { useStore } from '../../contexts/StoreContext.tsx';
import { useHistory } from '../../contexts/useHistory.ts';

import { useFile } from '../../contexts/useFile.tsx';
import { useApp } from '../../hooks/useApp.ts';
import { isDocumentGestureOpen } from '../../hooks/document-gesture.ts';
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
  const { commitDirtyTool } = useLayers();
  const { openSaveImageDialog } = useFile();
  const { handleImageSave } = useApp();

  const activeLayersCount = Object.keys(layers || {}).length;

  // Undo is the timeline and nothing else. The mobile shell originally branched on
  // `isToolDirty` to revert uncommitted tool args first — "an uncommitted tool edit
  // is not on the timeline yet, so `undo` would step past it". That flag had no
  // writer: nothing ever dispatched it true, so the branch was unreachable and the
  // desktop rule it mirrored (`useHistory.undo`) is gone for the same reason. The
  // dead arm is not carried forward, and a real "revert the current tool's args"
  // affordance, if one is ever wanted, needs a real writer first.
  //
  // It is also gated on the document gesture, which the keyboard already gates
  // (`useKeyboardEvents.tsx:134`) and this button did not. A gesture that commits
  // on release holds the document, and `undo` replays `selections` from the SAME
  // `history` array, so `history.length` never moves and the pending commit's
  // `entries.slice(0, cursor + 1)` then truncates the redo tail with no other
  // symptom. On a touch screen a second finger tapping Undo mid-drag is the
  // two-line repro, so this shell is the more exposed of the two.
  //
  // The refusal is at the input layer, not in the writer: no dispatch, so
  // nothing appends, so nothing truncates. `disabled` is not a substitute — it
  // is read at render time and the gesture slot raises no re-render, so it
  // cannot see a claim made after the last render.
  const handleUndo = () => {
    if (isDocumentGestureOpen()) return;
    undo();
  };

  // The same gate as `handleUndo`, for the same reason.
  const handleRedo = () => {
    if (isDocumentGestureOpen()) return;
    redo();
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
      console.error('Failed to save image:', error);
    }
  };

  return (
    <header
      className="safe-area-top [grid-area:header] md:hidden flex h-12 items-center justify-between gap-1 px-2 bg-[#212529] text-white border-b border-gray-800 select-none z-30"
      data-testid="mobile-header"
    >
      {/* The mobile shell's document heading, mirroring `DesktopHeader`. Only one of the
          two headers is in the accessibility tree at any width — each hides the other —
          so this is never a second `<h1>` on screen. */}
      <h1 className="sr-only">Photo App</h1>
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
          disabled={!canUndo()}
          aria-label="Undo"
          data-testid="mobile-undo-button"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-base text-gray-300 hover:text-white hover:bg-gray-800 disabled:opacity-30 disabled:pointer-events-none transition-colors"
        >
          ↩️
        </button>

        <button
          type="button"
          onClick={handleRedo}
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
