import { useCallback } from 'react';
import { useStore } from '../contexts/StoreContext.tsx';
import { useLayers } from '../contexts/useLayer.ts';
import { stageProcessorInput } from '../contexts/presentation-evaluator.ts';
import { MAX_RASTER_SELECTION_PIXELS } from '../util/selection-mask.ts';
import { getActiveSelection, getSelectionProcessorSnapshot } from '../util/selection.ts';
import type { InvertToolArgs } from '../tools/invert.ts';

/**
 * `Image ▸ Adjustments ▸ Invert`, shared by the `mod+I` shortcut and the menu item so the two
 * cannot drift.
 *
 * One call is one `TOOL_ACTION` through `updateLayerByTool`, which already refuses a locked
 * layer before any history append. The bedrock refusal is this command's, for the reason every
 * raster tool area gives: the bedrock is the document's backing image and no raster edit
 * targets it.
 *
 * A layer holding another tool's uncommitted preview (Levels, Color, Free Transform) is refused
 * too: the inversion would be computed from the stored pixels and overwrite that preview, so the
 * adjustment would vanish from the canvas and never reach history. Switching tools commits it.
 *
 * The active selection is snapshotted into the staged raster's local space, as `FillToolArea`
 * does, so the stored args replay without reading live store state.
 */
export const useInvertLayer = () => {
  const [{ layers, activeLayerId, selections, activeSelectionId, previewLayers }] = useStore();
  const { updateLayerByTool } = useLayers();

  const invertActiveLayer = useCallback(async (): Promise<void> => {
    const layer = activeLayerId ? layers[activeLayerId] : undefined;
    if (!layer || layer.isBedrock || previewLayers.current[layer.id]) return;

    const bitmap = layer.tmpCanvas ?? layer.bitmap;
    if (!bitmap) return;

    const activeSelection = getActiveSelection(selections ?? [], activeSelectionId ?? null);
    let selection: InvertToolArgs['selection'];
    if (activeSelection) {
      let staged: ReturnType<typeof stageProcessorInput>;
      try {
        staged = stageProcessorInput(layer, bitmap, { maxPixelCount: MAX_RASTER_SELECTION_PIXELS });
      } catch (error) {
        console.error(`Invert cannot stage the active layer ${layer.id}`, error);
        return;
      }
      selection = {
        ...getSelectionProcessorSnapshot(activeSelection, staged.bounds),
        featherRadius: activeSelection.metadata?.featherRadius ?? 0,
        antiAlias: activeSelection.metadata?.magneticLasso?.antiAlias ?? true,
      };
    }

    const toolArgs: InvertToolArgs = { toolName: 'invert', ...(selection ? { selection } : {}) };
    await updateLayerByTool({ id: layer.id, toolArgs });
  }, [activeLayerId, activeSelectionId, layers, previewLayers, selections, updateLayerByTool]);

  return { invertActiveLayer };
};
