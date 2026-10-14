// src/components/SidebarRight/LayersTab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { getSortedLayersArray } from '../../contexts/layer-utils.ts';
import type { Layer, LayerId } from '../../contexts/layer-types.ts';
import { documentFrameFromSize } from '../../contexts/document-frame.ts';
import { textLayerEditTarget } from '../../contexts/text-layer-edit.ts';
import { useApp } from '../../hooks/useApp.ts';
import { lockDragCursor, unlockDragCursor } from '../../hooks/dragCursorLock.ts';
import { TrashIcon } from '../Icons/TrashIcon.tsx';
import { EyeIcon } from '../Icons/EyeIcon.tsx';
import { DragHandleIcon } from '../Icons/DragHandleIcon.tsx';
import { BedrockIcon } from '../Icons/BedrockIcon.tsx';
import { LayerTypeIcon } from '../Icons/LayerTypeIcon.tsx';
import {
  ICON_TOGGLE_BUTTON_VISIBLE,
  ICON_TOGGLE_BUTTON_HIDDEN,
  DELETE_BUTTON_ICON,
} from '../ToolbarsRight/buttonStyles.ts';
import { RENAME_LAYER_ACTION, SET_LAYER_OPACITY_ACTION } from '../../util/constants.ts';
import LayerThumbnail from './LayerThumbnail.tsx';

type LayerOpacityControlProps = {
  layer: Layer;
  updateLayer: ReturnType<typeof useLayers>['updateLayer'];
};

function LayerOpacityControl({ layer, updateLayer }: LayerOpacityControlProps) {
  const [draftPercent, setDraftPercent] = useState<number | null>(null);
  const opacityPercent = draftPercent ?? Math.round(layer.opacity * 100);

  function finishGesture() {
    const opacity = draftPercent;
    setDraftPercent(null);
    if (layer.locked || opacity === null) return;
    const nextOpacity = opacity / 100;
    if (layer.opacity !== nextOpacity) {
      updateLayer(layer.id, { opacity: nextOpacity }, SET_LAYER_OPACITY_ACTION);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2 px-1">
      <span className="text-xs text-gray-600 dark:text-white">Opacity:</span>
      <details className="relative">
        <summary className="list-none cursor-pointer rounded px-2 py-1 text-sm text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700">
          {opacityPercent}%
        </summary>
        <div className="absolute right-0 top-full z-20 mt-1 flex min-w-48 items-center gap-2 rounded border bg-white p-3 shadow dark:border-gray-600 dark:bg-gray-800">
          <input
            aria-label="Layer opacity"
            type="range"
            min="0"
            max="100"
            step="1"
            value={opacityPercent}
            disabled={layer.locked}
            onChange={(event) => {
              if (!layer.locked) setDraftPercent(Number(event.currentTarget.value));
            }}
            onPointerUp={finishGesture}
            onPointerCancel={() => setDraftPercent(null)}
            onKeyUp={finishGesture}
            onBlur={finishGesture}
            className="min-w-0 flex-1"
          />
          <output aria-live="polite" className="text-gray-800 dark:text-white">
            {opacityPercent}%
          </output>
        </div>
      </details>
    </div>
  );
}

export default function LayersTab() {
  const [{ layers, activeLayerId, documentFrame, totalSize, previewLayers }] = useStore();
  const {
    toggleVisibility,
    removeLayer,
    moveLayerAfter,
    setActiveLayer,
    updateLayer,
    convertBedrockLayer,
    beginTextLayerEdit,
  } = useLayers();
  const { toolArgs, setToolArgs } = useCurrentTool();
  const { goToTool } = useApp();

  const isMovableLayer = (layerId: LayerId | null): layerId is LayerId => {
    const layer = layerId ? layers[layerId] : null;
    return Boolean(layer && !layer.isBedrock && !layer.locked);
  };

  const [draggedLayerId, setDraggedLayerId] = useState<LayerId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<LayerId | null>(null);
  const [isOverBottom, setIsOverBottom] = useState(false);

  const [editingLayerId, setEditingLayerId] = useState<LayerId | null>(null);

  // Touch and pen input do not start HTML5 drag events, so keep a separate pointer-capture
  // gesture while leaving the desktop data-transfer path unchanged.
  const pointerDragRef = useRef<{
    pointerId: number;
    layerId: LayerId;
    startX: number;
    startY: number;
    active: boolean;
    targetId: LayerId | null;
    overBottom: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const LAYER_REORDER_DRAG_THRESHOLD = 3;

  const [animatingLayerId, setAnimatingLayerId] = useState<LayerId | null>(null);
  const [isShrinking, setIsShrinking] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  const selectLayer = (id: LayerId) => {
    setActiveLayer(id);
    const source = layers[id]?.source;
    if (source?.kind === 'tool' && source.args.toolName === toolArgs.toolName) {
      if (source.args.toolName === 'text') {
        const target = textLayerEditTarget(layers[id], documentFrame ?? documentFrameFromSize(totalSize));
        if (target) {
          beginTextLayerEdit(target.layerId);
          setToolArgs(target.args);
        }
      } else {
        setToolArgs(source.args);
      }
    }
  };

  const enterTextLayer = (id: LayerId) => {
    const layer = layers[id];
    if (!layer) return;
    const target = textLayerEditTarget(layer, documentFrame ?? documentFrameFromSize(totalSize));
    if (!target) return;
    if (toolArgs.toolName !== 'text') goToTool('text');
    setActiveLayer(id);
    beginTextLayerEdit(target.layerId);
    setToolArgs(target.args);
  };

  const listItemRefs = useRef<Record<LayerId, HTMLLIElement | null>>({});
  const dragImageRef = useRef<HTMLDivElement>(null);
  const dragImageNameRef = useRef<HTMLSpanElement>(null);

  // The shared drag lock, not a direct write to `document.body`. A layer drag that ended while a
  // dock gesture was still running used to remove the grabbing cursor and the selection lock
  // from under it, because this wrote the class itself and knew nothing about the other writer.
  // `lockedRef` makes the effect idempotent: a re-render with the same `draggedLayerId` must not
  // take a second lock it will never release.
  const lockedRef = useRef(false);
  useEffect(() => {
    if (draggedLayerId && !lockedRef.current) {
      lockedRef.current = true;
      lockDragCursor();
    } else if (!draggedLayerId && lockedRef.current) {
      lockedRef.current = false;
      unlockDragCursor();
    }
  }, [draggedLayerId]);

  useEffect(() => {
    return () => {
      // Unmounting mid-drag happens whenever the dock crosses the label threshold under a live
      // column resize, which unmounts this whole tab.
      if (lockedRef.current) {
        lockedRef.current = false;
        unlockDragCursor();
      }
    };
  }, []);

  useEffect(() => {
    const cancelPointerDrag = () => {
      if (!pointerDragRef.current) return;
      pointerDragRef.current = null;
      suppressClickRef.current = false;
      setDraggedLayerId(null);
      setDropTargetId(null);
      setIsOverBottom(false);
    };
    window.addEventListener('blur', cancelPointerDrag);
    document.addEventListener('visibilitychange', cancelPointerDrag);
    return () => {
      window.removeEventListener('blur', cancelPointerDrag);
      document.removeEventListener('visibilitychange', cancelPointerDrag);
    };
  }, []);
  /////

  const sortedLayers = useMemo(() => getSortedLayersArray(layers).reverse(), [layers]);
  const activeLayer = activeLayerId ? layers[activeLayerId] : null;
  // The same two conditions `convertBedrockLayer()` refuses on, kept in step so the
  // control is never present for an action that would be a no-op. The second one is
  // the backing layer being the whole stack: a conversion above any other layer
  // would stack an opaque copy of the frame over it.
  const canConvertBackground = Boolean(activeLayer?.isBedrock && Object.keys(layers).length === 1);

  function handleConvertBackground(layerId: LayerId) {
    // `createImageBitmap` is the only step that can reject, and it rejects out of
    // an async function, so the refusal is reported rather than left as an
    // unhandled rejection.
    convertBedrockLayer(layerId).catch((error) => {
      console.error('Unable to convert the backing layer into an editable layer', error);
    });
  }

  function animateMove(layerToMoveId: LayerId, layerToPlaceAfterId?: LayerId) {
    if (!isMovableLayer(layerToMoveId)) return;

    // Start shrinking layerToMove
    setAnimatingLayerId(layerToMoveId);
    setIsShrinking(true);

    setTimeout(() => {
      // Perform actual move
      moveLayerAfter(layerToMoveId, layerToPlaceAfterId); // put the layer at the bottom
      setIsShrinking(false);
      setIsExpanding(true);

      setTimeout(() => {
        // Cleanup
        setAnimatingLayerId(null);
        setIsExpanding(false);
      }, 200);
    }, 200);
  }

  function handleConfirmRemove(layerId: LayerId) {
    // todo: draw a "undo" button that disappears in few seconds
    removeLayer(layerId);
  }

  function handleNameChange(layerId: LayerId, newName: string, labelNode: HTMLElement) {
    const trimmed = newName.trim();
    const committed = Boolean(trimmed && trimmed !== layers[layerId]?.name);
    if (committed) {
      updateLayer(layerId, { name: trimmed }, RENAME_LAYER_ACTION);
    } else {
      // A refused rename leaves the stored name untouched, so React re-renders with the very
      // same text child and writes nothing — the blank text node the browser left behind would
      // survive and the row would show a nameless layer. Writing the stored name back, the way
      // the Escape branch does, has to happen before edit mode ends.
      labelNode.textContent = layers[layerId]?.name ?? '';
    }
    // Ending edit mode re-renders with the same text child, so the write-back must land first.
    setEditingLayerId(null);
  }

  function clearPointerDrag(event?: React.PointerEvent<HTMLDivElement>) {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag) return;
    if (event && event.pointerId !== pointerDrag.pointerId) return;
    try {
      event?.currentTarget.releasePointerCapture(pointerDrag.pointerId);
    } catch {
      // Capture may already have been released before pointerup/pointercancel arrives.
    }
    pointerDragRef.current = null;
    setDraggedLayerId(null);
    setDropTargetId(null);
    setIsOverBottom(false);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>, layerId: LayerId) {
    if (event.pointerType === 'mouse' || editingLayerId === layerId || !isMovableLayer(layerId)) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      layerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      targetId: null,
      overBottom: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    if (!pointerDrag.active) {
      const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
      if (distance < LAYER_REORDER_DRAG_THRESHOLD) return;
      pointerDrag.active = true;
      suppressClickRef.current = true;
      setDraggedLayerId(pointerDrag.layerId);
    }

    const pointed = document.elementFromPoint(event.clientX, event.clientY);
    const target = pointed?.closest<HTMLElement>('[data-testid="layer-row"]');
    const overBottom = Boolean(!target && pointed?.closest<HTMLElement>('[data-testid="layers-bottom-drop-target"]'));
    const targetId = (target?.dataset.layerId as LayerId | undefined) ?? null;
    const targetIndex = targetId ? sortedLayers.findIndex((layer) => layer.id === targetId) : -1;
    const sourceIsImmediatelyAboveTarget = targetIndex > 0 && sortedLayers[targetIndex - 1]?.id === pointerDrag.layerId;
    pointerDrag.targetId =
      targetId && targetId !== pointerDrag.layerId && !sourceIsImmediatelyAboveTarget && layers[targetId]
        ? targetId
        : null;
    pointerDrag.overBottom = overBottom;
    setDropTargetId(pointerDrag.targetId);
    setIsOverBottom(overBottom);
    event.preventDefault();
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    const pointerDrag = pointerDragRef.current;
    if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
    const { active, layerId, targetId, overBottom } = pointerDrag;
    clearPointerDrag(event);
    if (active && isMovableLayer(layerId) && (targetId || overBottom)) animateMove(layerId, targetId ?? undefined);
  }

  return (
    <div className={`flex flex-col gap-2 h-full ${draggedLayerId ? 'is-dragging' : ''}`}>
      {activeLayer && <LayerOpacityControl key={activeLayer.id} layer={activeLayer} updateLayer={updateLayer} />}
      {sortedLayers.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No layers yet.</div>
      ) : (
        <ul data-testid="layers-list" className="flex flex-col list-none p-0 pt-1 gap-1 overflow-y-auto min-h-0">
          {sortedLayers.map((layer, index) => {
            const isActive = activeLayerId === layer.id;
            const isPickedLayer = draggedLayerId === layer.id;
            const prevLayerId = sortedLayers[index - 1]?.id;
            const isDropTarget =
              isMovableLayer(draggedLayerId) &&
              dropTargetId === layer.id &&
              dropTargetId !== draggedLayerId &&
              prevLayerId !== draggedLayerId;
            const isEditable = editingLayerId === layer.id;
            const isAnimating = animatingLayerId === layer.id;
            const previewLayer = previewLayers?.current[layer.id]?.layer ?? layer;

            return (
              <li
                key={layer.id}
                data-testid="layer-row"
                data-layer-id={layer.id}
                ref={(el) => {
                  listItemRefs.current[layer.id] = el;
                }}
                className={`relative transition-all duration-200 ease-in-out  
                  ${isAnimating && isShrinking ? 'h-0 opacity-0' : 'h-10 opacity-100'} 
                  ${isAnimating && isExpanding ? 'animate-height-increase' : ''}`}
                style={{
                  cursor: layer.isBedrock ? 'default' : 'grab',
                  top: isPickedLayer ? undefined : '-3px',
                  opacity: isPickedLayer ? 0.17 : undefined,
                  transform: isPickedLayer ? 'scale(1, 0.95)' : undefined,
                  marginTop: isPickedLayer ? '-6px' : undefined,
                }}
              >
                {isDropTarget && <div className="relative mb-1 h-2 bg-blue-500 rounded" />}

                <div
                  data-testid="layer-row-content"
                  draggable={!layer.isBedrock && !layer.locked && editingLayerId !== layer.id}
                  onDragStart={(e) => {
                    if (isEditable || !isMovableLayer(layer.id)) {
                      e.preventDefault();
                      return;
                    }

                    setDraggedLayerId(layer.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('application/x-layer-id', layer.id);

                    if (dragImageRef.current && dragImageNameRef.current) {
                      dragImageNameRef.current.textContent = layer.name;
                      e.dataTransfer.setDragImage(dragImageRef.current, 0, 0);
                    }
                  }}
                  onDragEnd={() => {
                    setDraggedLayerId(null);
                    setDropTargetId(null);
                    setIsOverBottom(false);
                  }}
                  onDragOver={(e) => {
                    e.stopPropagation();
                    if (!isMovableLayer(draggedLayerId)) return;

                    setDropTargetId(layer.id);
                    setIsOverBottom(false);
                    if (!draggedLayerId || !isDropTarget) return; // not allowed

                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    setDraggedLayerId(null);
                    setDropTargetId(null);
                    setIsOverBottom(false);

                    if (!isMovableLayer(draggedLayerId) || !isDropTarget) return;

                    e.preventDefault();
                    animateMove(draggedLayerId, layer.id);
                  }}
                  onPointerDown={(event) => handlePointerDown(event, layer.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={(event) => {
                    clearPointerDrag(event);
                    suppressClickRef.current = false;
                  }}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    selectLayer(layer.id);
                  }}
                  onDoubleClick={() => enterTextLayer(layer.id)}
                  className={[
                    'flex items-center gap-2 rounded px-2 py-1 select-none',
                    'border border-transparent',
                    'hover:bg-white/70 dark:hover:bg-gray-700/40',
                    isActive ? 'bg-white dark:bg-gray-700/60 border-gray-200 dark:border-gray-600' : 'bg-transparent',
                  ].join(' ')}
                  title="Drag to reorder"
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleVisibility(layer.id);
                    }}
                    className={[
                      'h-6 w-6 grid place-items-center rounded border',
                      layer.visible ? ICON_TOGGLE_BUTTON_VISIBLE : ICON_TOGGLE_BUTTON_HIDDEN,
                    ].join(' ')}
                    aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
                    title={layer.visible ? 'Hide layer' : 'Show layer'}
                  >
                    <EyeIcon open={layer.visible} />
                  </button>

                  <LayerThumbnail layer={previewLayer} />

                  {layer.isBedrock ? <BedrockIcon /> : <LayerTypeIcon source={layer.source} />}

                  <DragHandleIcon disabled={isPickedLayer || layer.isBedrock || layer.locked} />

                  <div className="flex-1 min-w-0" onClick={(e) => isEditable && e.stopPropagation()}>
                    <span
                      data-testid="layer-name"
                      contentEditable={isEditable}
                      suppressContentEditableWarning
                      onPointerDown={(e) => {
                        if (e.pointerType === 'mouse') return;
                        e.stopPropagation();
                        if (!isEditable) setEditingLayerId(layer.id);
                      }}
                      onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
                        e.stopPropagation();
                        if (isEditable) return;
                        setEditingLayerId(layer.id);
                      }}
                      onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                        // prevent row selection when clicking while editing
                        e.stopPropagation();
                      }}
                      onBlur={(e) => {
                        handleNameChange(layer.id, e.currentTarget.textContent || '', e.currentTarget);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.currentTarget.blur();
                        } else if (e.key === 'Escape') {
                          e.currentTarget.textContent = layer.name;
                          setEditingLayerId(null);
                          e.currentTarget.blur();
                        }
                      }}
                      className={[
                        'text-sm text-gray-800 dark:text-gray-100 truncate outline-none',
                        isEditable ? 'bg-blue-50 dark:bg-blue-900/20' : '',
                      ].join(' ')}
                      style={{
                        background: isEditable ? '#fff' : undefined,
                        outline: isEditable ? '5px solid #fff' : undefined,
                        color: isEditable ? 'black' : undefined,
                        boxShadow: isEditable ? '0 0 0 7px #222' : undefined,
                        cursor: 'text',
                        userSelect: 'text',
                        maxWidth: '111px',
                        textOverflow: 'ellipsis',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        display: 'inline-block',
                        verticalAlign: 'baseline',
                        lineHeight: 1,
                        marginLeft: '3px',
                      }}
                    >
                      {layer.name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleConfirmRemove(layer.id);
                    }}
                    className={DELETE_BUTTON_ICON}
                    aria-label="Remove layer"
                    title="Remove layer"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {isOverBottom && draggedLayerId && <div className="relative -top-1 mx-2 h-2 bg-blue-500 rounded" />}
      {canConvertBackground && activeLayer && (
        <button
          type="button"
          data-testid="layers-convert-background-button"
          className="mx-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          // Adobe's own command label. `Background` is not a model field here —
          // `isBedrock` is the document's backing image — so the control does not
          // claim to be a Background row.
          aria-label="Layer from Background"
          title="Layer from Background"
          onClick={() => handleConvertBackground(activeLayer.id)}
        >
          Layer from Background
        </button>
      )}
      <div
        data-testid="layers-bottom-drop-target"
        className="flex-1 min-h-[20px]"
        onDragOver={(e) => {
          e.stopPropagation();
          if (!isMovableLayer(draggedLayerId)) return;

          e.preventDefault();
          setIsOverBottom(true);
          setDropTargetId(null);
        }}
        onDrop={(e) => {
          e.stopPropagation();
          setDraggedLayerId(null);
          setDropTargetId(null);
          setIsOverBottom(false);

          if (!isMovableLayer(draggedLayerId)) return;

          e.preventDefault();
          animateMove(draggedLayerId);
        }}
      />

      {/* Ghost element for custom drag image */}
      <div
        ref={dragImageRef}
        style={{
          position: 'fixed',
          top: '-1000px',
          left: '-1000px',
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        <div
          style={{
            width: '120px',
            padding: '6px 10px',
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            color: '#6b7280',
            fontSize: '12px',
            fontWeight: 500,
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
            opacity: 0.8,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <DragHandleIcon />
          <span ref={dragImageNameRef} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Dragging...
          </span>
        </div>
      </div>
    </div>
  );
}
