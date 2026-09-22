// src/components/SidebarRight/LayersTab.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { getSortedLayersArray } from '../../contexts/layer-utils.ts';
import type { LayerId } from '../../contexts/layer-types.ts';
import { TrashIcon } from '../Icons/TrashIcon.tsx';
import { EyeIcon } from '../Icons/EyeIcon.tsx';
import { DragHandleIcon } from '../Icons/DragHandleIcon.tsx';
import PreviewTooltip, { type MaybeBitmap } from '../PreviewTooltip/BmpPreviewTooltip.tsx';
import {
  ICON_TOGGLE_BUTTON_VISIBLE,
  ICON_TOGGLE_BUTTON_HIDDEN,
  DELETE_BUTTON_ICON,
} from '../ToolbarsRight/buttonStyles.ts';
import { RENAME_LAYER_ACTION } from '../../util/constants.ts';

export default function LayersTab() {
  const [{ layers, activeLayerId }] = useStore();
  const { toggleVisibility, removeLayer, moveLayerAfter, setActiveLayer, updateLayer } = useLayers();

  const [draggedLayerId, setDraggedLayerId] = useState<LayerId | null>(null);
  const [dropTargetId, setDropTargetId] = useState<LayerId | null>(null);
  const [isOverBottom, setIsOverBottom] = useState(false);

  const [editingLayerId, setEditingLayerId] = useState<LayerId | null>(null);

  const [animatingLayerId, setAnimatingLayerId] = useState<LayerId | null>(null);
  const [isShrinking, setIsShrinking] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);

  const [hoveredId, setHoveredId] = useState<LayerId | null>(null);
  const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
  const listItemRefs = useRef<Record<LayerId, HTMLLIElement | null>>({});
  const dragImageRef = useRef<HTMLDivElement>(null);
  const dragImageNameRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (draggedLayerId) {
      document.body.classList.add('cursor-grabbing');
    } else {
      document.body.classList.remove('cursor-grabbing');
    }
  }, [draggedLayerId]);

  useEffect(() => {
    return () => {
      document.body.classList.remove('cursor-grabbing');
    };
  }, []);
  /////

  const sortedLayers = useMemo(() => getSortedLayersArray(layers).reverse(), [layers]);

  const hoveredLayer = hoveredId ? layers[hoveredId] : null;
  const hoveredBitmap = (hoveredLayer?.tmpCanvas ?? hoveredLayer?.bitmap) as MaybeBitmap;
  const bitmapPromise = useMemo(() => Promise.resolve(hoveredBitmap), [hoveredBitmap]);

  function animateMove(layerToMoveId: LayerId, layerToPlaceAfterId?: LayerId) {
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

  function handleNameChange(layerId: LayerId, newName: string) {
    const trimmed = newName.trim();
    if (trimmed && trimmed !== layers[layerId]?.name) {
      updateLayer(layerId, { name: trimmed }, RENAME_LAYER_ACTION);
    }
    setEditingLayerId(null);
  }

  return (
    <div className={`flex flex-col gap-2 h-full ${draggedLayerId ? 'is-dragging' : ''}`}>
      <PreviewTooltip
        open={hoveredId !== null && !!hoveredLayer}
        hoveredElement={hoveredElement}
        bitmapPromise={bitmapPromise}
        placement="left"
      />

      {sortedLayers.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-gray-400">No layers yet.</div>
      ) : (
        <ul className="flex flex-col list-none p-0 pt-1 gap-1 overflow-y-auto min-h-0">
          {sortedLayers.map((layer, index) => {
            const isActive = activeLayerId === layer.id;
            const isPickedLayer = draggedLayerId === layer.id;
            const prevLayerId = sortedLayers[index - 1]?.id;
            const isDropTarget =
              dropTargetId === layer.id && dropTargetId !== draggedLayerId && prevLayerId !== draggedLayerId;
            const isEditable = editingLayerId === layer.id;
            const isAnimating = animatingLayerId === layer.id;

            return (
              <li
                key={layer.id}
                ref={(el) => {
                  listItemRefs.current[layer.id] = el;
                }}
                className={`relative transition-all duration-200 ease-in-out  
                  ${isAnimating && isShrinking ? 'h-0 opacity-0' : 'h-10 opacity-100'} 
                  ${isAnimating && isExpanding ? 'animate-height-increase' : ''}`}
                style={{
                  cursor: 'grab',
                  top: isPickedLayer ? undefined : '-3px',
                  opacity: isPickedLayer ? 0.17 : undefined,
                  transform: isPickedLayer ? 'scale(1, 0.95)' : undefined,
                  marginTop: isPickedLayer ? '-6px' : undefined,
                }}
              >
                {isDropTarget && <div className="relative mb-1 h-2 bg-blue-500 rounded" />}

                <div
                  draggable={editingLayerId !== layer.id}
                  onDragStart={(e) => {
                    if (isEditable) {
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
                    setDropTargetId(layer.id);
                    setIsOverBottom(false);
                    e.stopPropagation();
                    if (!draggedLayerId || !isDropTarget) return; // not allowed

                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.stopPropagation();
                    setDraggedLayerId(null);
                    setDropTargetId(null);
                    setIsOverBottom(false);

                    if (!draggedLayerId || !isDropTarget) return;

                    e.preventDefault();
                    animateMove(draggedLayerId, layer.id);
                  }}
                  onClick={() => setActiveLayer(layer.id)}
                  onMouseEnter={(e) => {
                    setHoveredId(layer.id);
                    setHoveredElement(e.currentTarget);
                  }}
                  onMouseLeave={() => {
                    setHoveredId(null);
                    setHoveredElement(null);
                  }}
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

                  <DragHandleIcon disabled={isPickedLayer} />

                  <div className="flex-1 min-w-0" onClick={(e) => isEditable && e.stopPropagation()}>
                    <span
                      contentEditable={isEditable}
                      suppressContentEditableWarning
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
                        handleNameChange(layer.id, e.currentTarget.textContent || '');
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
      <div
        className="flex-1 min-h-[20px]"
        onDragOver={(e) => {
          e.stopPropagation();
          if (!draggedLayerId) return;

          e.preventDefault();
          setIsOverBottom(true);
          setDropTargetId(null);
        }}
        onDrop={(e) => {
          e.stopPropagation();
          setDraggedLayerId(null);
          setDropTargetId(null);
          setIsOverBottom(false);

          if (!draggedLayerId) return;

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
