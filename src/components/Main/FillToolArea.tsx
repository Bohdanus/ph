import { type PointerEvent } from 'react';
import { usePointerPosition } from '../../hooks/usePointerPosition.ts';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useLayers } from '../../contexts/useLayer.ts';
import { useCurrentTool } from '../../contexts/useCurrentTool.tsx';
import { createFloodFillMask } from '../../util/floodFill.ts';
import type { FillToolArgs, FillToolName } from '../../tools/fill.ts';
import type { BitmapSource, Point, Size } from '../../contexts/general-types.ts';
import type { Layer } from '../../contexts/layer-types.ts';
import { stageProcessorInput, type ProcessorStaging } from '../../contexts/presentation-evaluator.ts';
import { documentPointToLayerLocal } from '../../util/layer-space.ts';
import { getActiveSelection, getSelectionAbsolutePoints } from '../../util/selection.ts';
import { canvasToDocumentPoint, documentFrameFromSize } from '../../contexts/document-frame.ts';

type FillToolAreaProps = {
  className?: string;
};

/** The two names this area serves. Both are one-click, ACTIVE-LAYER, one-history-state tools. */
const FILL_TOOL_NAMES: readonly FillToolName[] = ['paint-bucket', 'magic-eraser'];

const isFillToolName = (toolName: string): toolName is FillToolName =>
  FILL_TOOL_NAMES.includes(toolName as FillToolName);

/**
 * Refusal reasons, named and exported so a test pins the exact string rather than "some console
 * error". The contract they protect is constraint 3 of `.kilo/plans/ps-research/RESEARCH-BRIEF.md`:
 * a tool that cannot read its own destination must fail LOUDLY and write NO history, because the
 * alternative — a commit that silently changed nothing — is a tool that looks alive and is not.
 *
 * `src/test/setup.ts:327` documents that the global mock deliberately omits `getImageData` from the
 * globally installed canvas context
 * precisely because production code branches on `typeof ctx.getImageData === 'function'`; that
 * guard is what these two names hang off.
 */
export const FILL_TOOL_READBACK_UNAVAILABLE = 'fill-tool-readback-unavailable';
export const FILL_TOOL_NO_LAYER_PIXELS = 'fill-tool-no-layer-pixels';
export const FILL_TOOL_PRESENTATION_UNAVAILABLE = 'fill-tool-presentation-unavailable';

/**
 * Stages the PRESENTED raster the fill processor will be handed, or `null` when it cannot be
 * staged at all — a degenerate or over-cap presentation, or no 2D context.
 *
 * `null` is a refusal rather than a throw because this runs inside a pointer handler, and it is
 * loud for the same reason the two names above are: the decision this gate protects is "does this
 * click replace anything", and a tool that cannot ask must not write a history row that changed
 * nothing.
 */
const stageLayerPresentation = (layer: Layer, bitmap: NonNullable<Layer['bitmap']>): ProcessorStaging | null => {
  try {
    return stageProcessorInput(layer, bitmap);
  } catch (error) {
    console.error(
      FILL_TOOL_PRESENTATION_UNAVAILABLE,
      `the active layer ${layer.id} cannot be staged for a fill`,
      error
    );
    return null;
  }
};

/**
 * Reads the active layer back at its own size, the same read `src/tools/fill.ts:75` performs
 * inside the processor. Returns null when the environment cannot supply pixels, which is the
 * read-back refusal rather than an error: the caller turns null into a loud no-commit.
 */
const readLayerPixels = (bitmap: BitmapSource, size: Size): ImageData | null => {
  if (size.width <= 0 || size.height <= 0) return null;

  const scratch = new OffscreenCanvas(size.width, size.height);
  const ctx = scratch.getContext('2d');
  if (!ctx || typeof ctx.getImageData !== 'function') return null;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, size.width, size.height);

  return ctx.getImageData(0, 0, size.width, size.height);
};

/**
 * The Paint Bucket and the Magic Eraser: one click, one atomic commit, on the ACTIVE layer.
 *
 * The two differ only in what their processor writes into the flood-fill mask — the bucket writes
 * the foreground colour at the mask, the magic eraser subtracts alpha at it — and both scale the
 * per-pixel alpha by `Opacity`, so `alpha < 1` is a partial fill and a partial erase rather than an
 * all-or-nothing one. None of that is re-implemented here: `updateLayerByTool` routes to
 * `paintBucket`/`magicEraser` (`src/tools/toolProcessors.ts:227-236`), which read the same bitmap at
 * the same size and composite from the mask.
 *
 * What this area does own is the decision to commit at all, and that decision cannot be delegated:
 * `createFloodFillMask` returns null both for a seed outside the image and for a region that
 * matched nothing, and in the second case the processor redraws the layer unchanged. Committing it
 * anyway would write a `TOOL_ACTION` that changed nothing, so the mask is computed HERE first, on
 * the same bitmap, with the same `tolerance` and `contiguous`, and a null result ends the gesture
 * with no history entry whatsoever. The computation is pure, so the predicate and the commit's own
 * fill cannot disagree about whether a region exists.
 */
export const FillToolArea = ({ className }: FillToolAreaProps) => {
  // The state object is kept whole as well as destructured, because the foreground colour is read
  // off it INSIDE the click handler rather than captured here — see the commit below.
  const [store] = useStore();
  const {
    containerRef,
    layers,
    activeLayerId,
    totalSize,
    documentFrame: currentFrame,
    selections,
    activeSelectionId,
  } = store;
  const documentFrame = currentFrame ?? documentFrameFromSize(totalSize);
  const { updateLayerByTool } = useLayers();
  const { toolArgs } = useCurrentTool();

  const args = toolArgs as FillToolArgs;

  const { getLocalCoords } = usePointerPosition({
    ref: containerRef,
    imageSize: totalSize,
  });

  function isPointInsideImage(point: Point): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < totalSize.width && point.y < totalSize.height;
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (!isFillToolName(args.toolName)) return;

    event.preventDefault();

    const seed = getLocalCoords(event);
    if (!isPointInsideImage(seed)) return;

    const layer = activeLayerId ? layers[activeLayerId] : undefined;
    if (!layer) return;

    // A raster edit to the BEDROCK layer is wrong: it is the document's own backing image and the
    // floor every other layer composites over, and there is nothing beneath it to fill from or
    // restore. `MoveToolArea.tsx:35` refuses the same operation on the same flag, as do the other
    // tools that commit a raster (`SmudgeToolArea`, `DodgeToolArea`, `CloneStampToolArea`).
    if (layer.isBedrock) return;

    const bitmap = layer.tmpCanvas ?? layer.bitmap;
    if (!bitmap) {
      console.error(FILL_TOOL_NO_LAYER_PIXELS, `the active layer ${layer.id} has no bitmap to fill`);
      return;
    }

    // The PRESENTED raster, because that is what the processor is handed: a layer carrying a
    // transform or a filter is staged at its evaluated extent first, so a mask computed from the
    // raw pixels would be both the wrong pixels and the wrong size, and it would disagree with the
    // commit that follows it about whether the gesture replaced anything.
    const staged = stageLayerPresentation(layer, bitmap);
    if (!staged) return;

    const size = { width: staged.bounds.width, height: staged.bounds.height };
    const imageData = readLayerPixels(staged.bitmap, size);
    if (!imageData) {
      console.error(FILL_TOOL_READBACK_UNAVAILABLE, `${args.toolName} cannot read the active layer's pixels`);
      return;
    }

    // The processor receives the layer's own local coordinates, so the click is converted out of
    // canvas space and into the raster it will write. `commit: 'raster'` replaces the layer's
    // pixels with a canvas of the size it was handed, drawn back at the origin, which is what makes
    // this the right space and not the document's.
    const documentSeed = canvasToDocumentPoint(seed, documentFrame);
    const layerSeed = documentPointToLayerLocal(documentSeed, staged.bounds);

    const region = createFloodFillMask(imageData, layerSeed, {
      tolerance: args.tolerance,
      contiguous: args.contiguous,
    });

    // Nothing matched: a legitimate no-op. No `updateLayerByTool`, so no `TOOL_ACTION`, so the
    // gesture leaves no history entry that changed nothing.
    if (!region) return;

    const selectionSnapshot = snapshotSelection(staged.bounds);

    // Photoshop's bucket fills the foreground colour AS IT IS AT THE MOMENT OF THE CLICK, so the
    // read belongs here and not in the options bar: the user can change the foreground while the
    // bucket stays selected, and a value mirrored into the tool args when a bar mounted would fill
    // the colour that was current when the tool was picked. It is read off the live store object
    // rather than off a destructured copy for the same reason.
    //
    // `paint-bucket` ONLY. `magicEraser` subtracts alpha and never reads `color`
    // (`src/tools/fill.ts:158-173`), so writing the foreground into its committed args would put a
    // fill colour into a history entry describing an erase — a value the pixels could never honour.
    // `FillToolArgs.color` is carried for both names only so the pair shares one type, and it
    // travels unchanged for the eraser.
    //
    // No `size` beside `pos`: both processors learn the geometry from the curried
    // `ProcessorToolParams`, so an args-level `size` was a second, unread source of it that the
    // durable replay path could not honour. `FillToolArgs` no longer declares the field.
    const commitArgs =
      args.toolName === 'paint-bucket'
        ? {
            ...args,
            color: store.color,
            pos: layerSeed,
            ...(selectionSnapshot ? { selection: selectionSnapshot } : {}),
          }
        : { ...args, pos: layerSeed, ...(selectionSnapshot ? { selection: selectionSnapshot } : {}) };

    updateLayerByTool({ toolArgs: commitArgs });
  };

  /**
   * Snapshots the active selection into the same local-raster coordinate space as the staged fill
   * bitmap, following `EraserToolArea`'s `selectionSnapshotRef` pattern.
   *
   * The points are rebased by `presentationBounds` — the origin of the staged raster in document
   * space, exactly the same offset `documentPointToLayerLocal` applies to the click seed. This
   * makes the snapshot durable/replayable: the processor builds its mask from this snapshot and
   * never reads live store state. `featherRadius` and `antiAlias` ride along so fractional edge
   * alpha composes correctly under replay.
   */
  const snapshotSelection = (presentationBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): FillToolArgs['selection'] => {
    const activeSelection = getActiveSelection(selections ?? [], activeSelectionId ?? null);
    if (!activeSelection) return undefined;

    return {
      points: getSelectionAbsolutePoints(activeSelection).map((point) =>
        documentPointToLayerLocal(point, presentationBounds)
      ),
      featherRadius: activeSelection.metadata?.featherRadius ?? 0,
      antiAlias: activeSelection.metadata?.magneticLasso?.antiAlias ?? true,
    };
  };

  // No drag and no preview overlay: Photoshop commits the fill on the click itself, so a
  // drag-to-adjust gesture would add a second history state the product does not have.
  return (
    <div className={`${className} cursor-crosshair`} onPointerDown={handlePointerDown} style={{ userSelect: 'none' }} />
  );
};
