import React, { useMemo, useRef, useState } from 'react';

import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { getSortedLayersArray } from '../../contexts/layer-utils.ts';
import { getHistoryItemTitle, useHistory } from '../../contexts/useHistory.ts';
import { isDocumentGestureOpen } from '../../hooks/document-gesture.ts';
import type { LayerId } from '../../contexts/layer-types.ts';
import { EyeIcon } from '../Icons/EyeIcon.tsx';
import { TrashIcon } from '../Icons/TrashIcon.tsx';
import { RENAME_LAYER_ACTION } from '../../util/constants.ts';
import { useModalA11y } from './useModalA11y.ts';

export interface MobileLayersDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MobileLayersDrawer: React.FC<MobileLayersDrawerProps> = ({ isOpen, onClose }) => {
  const [{ layers, activeLayerId, history, historyIndex, totalSize }] = useStore();
  const { createBlankLayer, toggleVisibility, removeLayer, moveLayerAfter, setActiveLayer, updateLayer } = useLayers();
  const { resetHistoryTo, toggleDisabled } = useHistory();

  const [activeTab, setActiveTab] = useState<'layers' | 'history'>('layers');
  const [editingLayerId, setEditingLayerId] = useState<LayerId | null>(null);
  const [editingName, setEditingName] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);

  useModalA11y(isOpen, onClose, panelRef);

  // Index 0 is the TOP layer: `getSortedLayersArray` is ascending, and the drawer
  // shows the stack the way Photoshop does.
  const sortedLayers = useMemo(() => getSortedLayersArray(layers).reverse(), [layers]);
  const sortedHistory = useMemo(() => [...history].reverse(), [history]);

  if (!isOpen) return null;

  const handleFinishRename = (layerId: LayerId) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== layers[layerId]?.name) {
      updateLayer(layerId, { name: trimmed }, RENAME_LAYER_ACTION);
    }
    setEditingLayerId(null);
  };

  /**
   * `moveLayerAfter(id, target)` places the moved layer immediately ABOVE
   * `target` in ascending `order` (`reorderLayers` sets `order = target.order + 1`
   * after shifting everything above it up by two), and an `undefined` target means
   * "the very bottom" (`order = minOrder - 1`) — see `layer-utils.ts:238`.
   *
   * With index 0 at the top, "up" is therefore anchored on the row *above*
   * (`index - 1`). "Down" is not the mirror: the layer we are moving must end up
   * one row *below* the next one, which means landing on top of the row *two*
   * places down (`index + 2`). The old code used `index - 2` and `index + 1`,
   * which skipped a position in both directions, resolved to `undefined` for the
   * second row's "move up" (silently burying that layer at the bottom), and made
   * the top row's "move down" a no-op.
   */
  const handleMoveUp = (index: number) => {
    if (index <= 0 || index >= sortedLayers.length) return;
    const prevTarget = sortedLayers[index - 1];
    if (!prevTarget) return;
    moveLayerAfter(sortedLayers[index].id, prevTarget.id);
  };

  const handleMoveDown = (index: number) => {
    // The last two rows have no row two places below them, and passing `undefined`
    // would instead bury the layer at the bottom of the stack.
    if (index < 0 || index >= sortedLayers.length - 2) return;
    const targetLayer = sortedLayers[index + 2];
    if (!targetLayer) return;
    moveLayerAfter(sortedLayers[index].id, targetLayer.id);
  };

  // The history tab's three dispatch paths — the row click, the row's Enter/Space,
  // and the row's eye control — all reach `APPLY_HISTORY_REPLAY` through
  // `useHistory`, which is the dispatch the keyboard refuses while a pointer
  // gesture owns the document (`useKeyboardEvents.tsx:134`) and the Undo/Redo
  // buttons now refuse for the same reason (`HistoryControls.tsx`,
  // `MobileHeader.tsx`). The drawer's own tab had no gate on any of them.
  //
  // Inside a gesture's window the replay is destructive. `resetHistoryTo`
  // replays `selections` from the SAME `history` array, so `history.length` never
  // moves and the pending commit's `entries.slice(0, cursor + 1)` truncates the
  // redo tail with no other symptom. `toggleDisabled` is worse in the same window
  // rather than equal: it writes the disabled flag onto entries the pending commit
  // is about to append past.
  //
  // On a touch screen this drawer is the most exposed place in the app: a second
  // finger tapping a history row, or the eye, mid-drag is a two-line repro, and the
  // drawer is reachable with a second finger because it is not pointer-captured.
  //
  // The refusal is at the input layer, not in the writer: no dispatch, so nothing
  // appends, so nothing truncates. `disabled` is not a substitute here either — it
  // is read at render time and the gesture slot raises no re-render, so it cannot
  // see a claim made after the last render, and a row disabled by a mid-gesture
  // render would stay disabled after the release.
  const handleRewind = (index: number) => {
    if (isDocumentGestureOpen()) return;
    resetHistoryTo(index);
  };

  // `stopPropagation` runs first and unconditionally, so a refused eye click still
  // does not travel to the row and rewind behind it.
  const handleToggleDisabled = (event: React.MouseEvent, itemId: string) => {
    event.stopPropagation();
    if (isDocumentGestureOpen()) return;
    toggleDisabled(itemId);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Layers & History Drawer"
      data-testid="mobile-layers-drawer"
    >
      <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onClose} aria-hidden="true" />

      <div
        ref={panelRef}
        tabIndex={-1}
        id="mobile-layers-panel"
        className="safe-area-bottom relative z-10 w-full max-h-[80vh] flex flex-col rounded-t-2xl bg-white dark:bg-gray-900 shadow-2xl border-t border-gray-200 dark:border-gray-800 outline-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('layers')}
              aria-pressed={activeTab === 'layers'}
              data-testid="mobile-tab-layers"
              className={`min-h-11 min-w-11 rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'layers'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              Layers ({sortedLayers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              aria-pressed={activeTab === 'history'}
              data-testid="mobile-tab-history"
              className={`min-h-11 min-w-11 rounded-lg px-3 text-sm font-semibold transition-colors ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              History ({history.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close layers drawer"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            ✕
          </button>
        </div>

        {activeTab === 'layers' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
              <button
                type="button"
                onClick={() => createBlankLayer({ color: '#ffffff', opacity: 1, size: totalSize, isBedrock: true })}
                data-testid="mobile-add-layer-button"
                className="flex min-h-11 min-w-11 items-center gap-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
              >
                <span aria-hidden="true">+</span>
                <span>New Layer</span>
              </button>

              {activeLayerId && sortedLayers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLayer(activeLayerId)}
                  data-testid="mobile-delete-layer-button"
                  className="flex min-h-11 min-w-11 items-center justify-center text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded-lg"
                  aria-label="Delete active layer"
                >
                  <TrashIcon />
                </button>
              )}
            </div>

            {/* There is deliberately no layer-opacity control here. It dispatched
                `updateLayer(id, { opacity }, TOOL_ACTION)`, and `TOOL_ACTION`
                history entries carry no `toolName` in their args, so
                `history-replay.ts` skips them and `getHistoryItemTitle` returns
                `undefined`: every drag step became an untitled, unreplayable
                entry. Desktop has no equivalent control either. */}
            <ul className="flex-1 overflow-y-auto p-3 space-y-1.5 max-h-[45vh]" aria-label="Layers">
              {sortedLayers.map((layer, index) => {
                const isActive = activeLayerId === layer.id;
                const isEditing = editingLayerId === layer.id;

                return (
                  <li key={layer.id}>
                    {/*
                      A plain `div`, NOT `role="button"`.

                      This row contains four real buttons (visibility, rename, move up, move
                      down), and a `role="button"` container makes its descendants
                      presentational: assistive technology announces "button, pressed" and
                      then drops the four controls inside it, leaving rename, reorder and
                      visibility unreachable. Nesting interactive content in a button is
                      invalid ARIA.

                      So the row is a mouse affordance only — `onClick` with no role, no
                      `tabIndex` and no key handler — and the keyboard path is the layer
                      name's own button below, which is a sibling of the other four rather
                      than a child of a fake button. The action buttons stop propagation, so
                      acting on a layer does not also select it.
                    */}
                    <div
                      onClick={() => setActiveLayer(layer.id)}
                      className={`flex items-center justify-between gap-0.5 p-2 rounded-xl border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 shadow-sm'
                          : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                      }`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleVisibility(layer.id);
                          }}
                          aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                          className={`flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                            layer.visible
                              ? 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-800 dark:text-gray-200'
                              : 'bg-transparent border-transparent text-gray-400 opacity-50'
                          }`}
                        >
                          <EyeIcon open={layer.visible} />
                        </button>

                        {isEditing ? (
                          <input
                            type="text"
                            aria-label={`Layer name for ${layer.name}`}
                            value={editingName}
                            onChange={(event) => setEditingName(event.target.value)}
                            onBlur={() => handleFinishRename(layer.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') handleFinishRename(layer.id);
                              if (event.key === 'Escape') setEditingLayerId(null);
                            }}
                            autoFocus
                            className="min-h-11 min-w-0 flex-1 px-2 text-sm rounded border border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                          />
                        ) : (
                          // The row's keyboard-reachable control. `aria-pressed` carries the
                          // active state, which the removed `role="button"` used to carry.
                          <button
                            type="button"
                            aria-pressed={isActive}
                            onClick={(event) => {
                              event.stopPropagation();
                              setActiveLayer(layer.id);
                            }}
                            className="flex min-h-11 min-w-0 flex-1 items-center truncate rounded px-1 text-left"
                          >
                            <span
                              className={`font-medium ${
                                isActive
                                  ? 'text-blue-900 dark:text-blue-200 font-semibold'
                                  : 'text-gray-800 dark:text-gray-200'
                              }`}
                            >
                              {layer.name}
                            </span>
                            {!layer.visible && <span className="ml-2 text-[10px] text-gray-400 italic">(Hidden)</span>}
                          </button>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setEditingLayerId(layer.id);
                            setEditingName(layer.name);
                          }}
                          aria-label={`Rename ${layer.name}`}
                          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-xs text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleMoveUp(index);
                          }}
                          disabled={index === 0}
                          aria-label={`Move ${layer.name} up`}
                          className="flex min-h-11 min-w-11 items-center justify-center text-xs rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-20 text-gray-600 dark:text-gray-400"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleMoveDown(index);
                          }}
                          disabled={index >= sortedLayers.length - 2}
                          aria-label={`Move ${layer.name} down`}
                          className="flex min-h-11 min-w-11 items-center justify-center text-xs rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-20 text-gray-600 dark:text-gray-400"
                        >
                          ▼
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {activeTab === 'history' && (
          <ul className="flex-1 overflow-y-auto p-3 space-y-1 max-h-[50vh]" aria-label="History">
            {sortedHistory.map((item) => {
              const originalIndex = history.indexOf(item);
              const isCurrent = originalIndex === historyIndex;
              const isPast = originalIndex <= historyIndex;
              const title = getHistoryItemTitle(item);

              return (
                <li key={item.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRewind(originalIndex)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      // `preventDefault` stays unconditional once the key matches: it is
                      // what stops Space from scrolling the page, which is a property of
                      // the key and not of the gesture. The gate is inside the dispatch.
                      event.preventDefault();
                      handleRewind(originalIndex);
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer transition-all ${
                      isCurrent
                        ? 'bg-blue-50 dark:bg-blue-900/40 border-blue-500 font-semibold text-blue-900 dark:text-blue-200'
                        : isPast
                          ? 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200'
                          : 'bg-gray-50/50 dark:bg-gray-800/30 border-transparent opacity-40 text-gray-500'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <button
                        type="button"
                        onClick={(event) => handleToggleDisabled(event, item.id)}
                        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center text-gray-500"
                        aria-label={item.disabled ? 'Enable history step' : 'Disable history step'}
                      >
                        <EyeIcon open={!item.disabled} />
                      </button>
                      <span className="truncate text-sm capitalize">{title}</span>
                    </div>

                    {isCurrent && (
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded bg-blue-600 text-white font-medium">
                        Current
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
