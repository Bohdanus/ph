import type { BitmapSource, Size } from '../contexts/general-types.ts';
import { useStore, type StoreMetadataUpdates } from '../contexts/StoreContext.tsx';
import type { Layer, LayersRecord } from '../contexts/layer-types.ts';
import type { NewDocumentBlankParams, ToolName } from '../contexts/tool-types.ts';
import { useLayers } from '../contexts/useLayer.ts';
import type { ImageSaveResponse, ImageUploadResponse } from '../contexts/file-types.ts';
import { v4 as uuidv4 } from 'uuid';
import { OPEN_DOCUMENT_ACTION } from '../util/constants.ts';
import { resizeCanvas } from '../util/canvas.ts';
import { setRefValue } from '../util/ref.ts';
import { createHistoryItem } from '../contexts/history-utils.ts';
import { documentFrameFromSize } from '../contexts/document-frame.ts';
import { appendSelectionClear } from '../contexts/useSelectionHistory.ts';

export interface UseAppType {
  setBlankImage: (data: NewDocumentBlankParams) => void;
  setImageFromUpload: (data: ImageUploadResponse) => Promise<void>;

  handleImageSave: (data: ImageSaveResponse) => void;

  goToTool: (toolName: ToolName) => void;
}

async function immutableRaster(bitmap: BitmapSource): Promise<BitmapSource> {
  if (typeof (bitmap as { close?: unknown }).close === 'function') return bitmap;
  if (!globalThis.createImageBitmap) {
    throw new Error('createImageBitmap is required to import a mutable raster source');
  }
  return globalThis.createImageBitmap(bitmap as CanvasImageSource);
}

/**
 * Custom hook for accessing and managing application-level state and utilities.

  BASIC UI OPERATIONS

 */
export const useApp = (): UseAppType => {
  const [
    {
      canvasRef,
      currentArgs: currentArgsRef,
      toolOverlayRef,
      rectOverlayRef,
      toolName,
      activeSelectionId,
      selections,
      selectionCleared,
      totalSize,
      documentFrame: currentFrame,
      history,
      historyIndex,
      branchRevision = 0,
      clearPreviewLayers,
      adoptLayerBitmaps,
    },
    dispatch,
  ] = useStore();
  const { createBlankLayer, createLayerFromBitmap, commitDirtyTool } = useLayers();
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);

  function handleImageCreate(size: Size) {
    if (canvasRef.current) {
      resizeCanvas(canvasRef.current, size.width, size.height);
    }
  }

  function handleImageSave({ fileName }: ImageSaveResponse) {
    // Save state is the only thing a batch is allowed to carry.
    const metadata: StoreMetadataUpdates = { fileName, hasUnsavedChanges: false };
    dispatch({ type: 'BATCH_UPDATES', payload: metadata });
  }

  function _setFileName(fileName: string) {
    dispatch({ type: 'SET_FILE_NAME', payload: fileName });
  }

  function setBlankImage(params: NewDocumentBlankParams) {
    // Same ordering as `setImageFromUpload`'s raster arm, and for the same reason. A blank document's
    // layer is built synchronously, so there is no microtask boundary here — but
    // `createBlankLayer` throws from `createLayerSource` when either extent is ZERO, and a canvas
    // already resized to that extent is a document-sized canvas around a document that was never
    // adopted. Sizing the canvas after the layer exists cannot be wrong in the other direction:
    // nothing between the two reads it.
    //
    // That zero is a CONTRACT guard rather than a live user path, and worth saying so plainly: no
    // current caller PRODUCES a zero. `NewImageDialog` clamps its preset and DPI inputs with
    // `Math.min(10000, Math.max(1, n)) || 1` and submits through a real `<form>` whose `min="1"`
    // blocks zero — but its `onChange` is `setWidth(parseInt(value) || 0)`, so clearing the field DOES
    // put zero into state and only native constraint validation stands between that and this throw.
    // Change that submit to `type="button"` and the path opens. `DEFAULT_BLANK_IMAGE` is a fourth
    // producer that does not clamp at all; it holds by VALUE rather than by mechanism.
    createBlankLayer({ ...params }, true);
    handleImageCreate(params.size);
  }

  async function setImageFromUpload(data: ImageUploadResponse) {
    const { fileName } = data;
    if ('document' in data) {
      const { size, layers, warnings } = data.document;
      if (warnings.length && !window.confirm(`PSD import limitations:\n\n${warnings.join('\n')}\n\nOpen anyway?`))
        return;
      const immutableLayers = Object.fromEntries(
        await Promise.all(
          Object.entries(layers).map(async ([id, layer]): Promise<[string, Layer]> => {
            if (layer.source?.kind !== 'image') return [id, layer];
            const bitmap = await immutableRaster(layer.source.bitmap);
            return [
              id,
              {
                ...layer,
                bitmap,
                tmpCanvas: null,
                source: { ...layer.source, bitmap },
              },
            ];
          })
        )
      ) as LayersRecord;
      const activeLayerId = Object.values(immutableLayers).sort((a, b) => b.order - a.order)[0]?.id ?? null;
      const baseline = Object.fromEntries(
        Object.values(immutableLayers).map((layer) => [layer.id, { ...layer, pos: { ...layer.pos } }])
      );
      setRefValue(currentArgsRef, {} as typeof currentArgsRef.current);
      clearPreviewLayers?.();
      dispatch({
        type: 'REPLACE_DOCUMENT',
        payload: {
          documentId: uuidv4(),
          history: [
            createHistoryItem({
              actionName: OPEN_DOCUMENT_ACTION,
              layerId: activeLayerId ?? '',
              documentSource: { layers: baseline, size: { ...size }, frame: documentFrameFromSize(size) },
            }),
          ],
          updates: {
            fileName,
            totalSize: size,
            documentFrame: documentFrameFromSize(size),
            layers: immutableLayers,
            activeLayerId,
            deletedLayers: {},
            hasImage: true,
            hasUnsavedChanges: false,
            toolName: 'reposition',
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: null,
            selectionClipboard: null,
          },
        },
      });
      // Every raster this import produced is adopted into the store's presentation
      // scope, exactly as `useLayers().createLayerFromBitmap` does for a single-image
      // import. Called AFTER `REPLACE_DOCUMENT`: the scope is keyed by the owning
      // document, so a registration published before the replacement would be filed
      // under the outgoing document id and closed by its release.
      adoptLayerBitmaps(
        Object.values(immutableLayers)
          .map((layer) => (layer.source?.kind === 'image' ? layer.source.bitmap : null))
          .filter((bitmap): bitmap is BitmapSource => bitmap !== null)
      );
      // The three surfaces take the imported size only AFTER the replacement is published, which is
      // the same rule the raster arm below follows. Resizing before the dispatch would leave all
      // three at the incoming file's extent with nothing published if either the dispatch or the
      // bitmap adoption threw.
      //
      // Scoped deliberately: this covers those TWO throw sites and not every one. `resizeCanvas` can
      // itself throw — assigning `canvas.width` past the browser's maximum canvas size raises
      // `IndexSizeError`, and nothing upstream caps a PSD's extent (`useLayer`'s `MAX_DOCUMENT_FRAME_SIDE`
      // says so outright). Under this order that throw leaves the document PUBLISHED with the three
      // surfaces still at the outgoing extent, where the old order left them at the incoming extent
      // with nothing published. The class is reshaped rather than removed: `Main` resizes both
      // overlays from the published `totalSize` on its next pass, so the store and the document agree
      // and only the workspace canvas lags. Untested, because provoking it needs a PSD past the
      // browser's ceiling.
      for (const ref of [canvasRef, toolOverlayRef, rectOverlayRef]) {
        if (ref.current) {
          resizeCanvas(ref.current, size.width, size.height);
        }
      }
      return;
    }
    const { image } = data;
    const size = { width: image.width, height: image.height };
    // The canvas takes the image's size only AFTER the replacement has been published.
    // `createLayerFromBitmap` awaits `immutableRaster` before it dispatches, so a decode failure
    // rejects there with nothing published — and a canvas already resized to the incoming file's
    // geometry is a document-sized canvas wrapped around the outgoing document, which then renders
    // at the wrong extent until something redraws it. That FAILURE PATH is the whole reason, and
    // it is what the tests here prove.
    //
    // It is deliberately NOT justified by a visible wrong-extent frame on the success path. That
    // was measured headlessly, per frame, by comparing the canvas backing store against the
    // published `data-fit-document-*` while opening a 4000x3000 PNG: the current order disagrees on
    // one frame, the old order on two, and neither is sustained long enough to be worth a paint.
    // `immutableRaster`'s `createImageBitmap` on an already-decoded `HTMLImageElement` resolves
    // inside the same frame. The PSD arm above now orders it the same way, and for the same reason:
    // it resolves every `immutableRaster` first and sizes all three surfaces only after
    // `REPLACE_DOCUMENT` and `adoptLayerBitmaps` have both run.
    await createLayerFromBitmap({ bitmap: image, name: fileName, size, isBedrock: true }, true);
    handleImageCreate(size);
    _setFileName(fileName);
  }

  function goToTool(nextToolName: ToolName) {
    // commit any dirty tool changes before switching
    commitDirtyTool();

    if (nextToolName !== toolName && activeSelectionId) {
      // The same single writer the Clear/Deselect controls use, so this deselect
      // gains the durable `set-selection` plan and the shadow-failure fallback
      // instead of appending a hand-built entry with no `durableEntry` — which
      // left the store reconverting the whole timeline on every tool switch.
      // `appendSelectionClear` rather than `useSelectionHistory`'s
      // `clearSelections`, because `goToTool` runs from a click handler and a
      // keyboard shortcut through a plain function, and that hook's
      // `useCallback` throws outside a component render.
      //
      // The predicate above is deliberately unchanged: a switch to the tool
      // already active, or a switch with no active selection, still appends
      // nothing and still leaves the document clean.
      appendSelectionClear({
        selections,
        activeSelectionId,
        selectionCleared,
        history,
        historyIndex,
        branchRevision,
        documentFrame,
        dispatch,
      });
    }

    dispatch({ type: 'SET_TOOL_NAME', payload: nextToolName });
  }

  return {
    setBlankImage,
    setImageFromUpload,
    handleImageSave,

    goToTool,
  };
};
