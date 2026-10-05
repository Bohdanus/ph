import type { BitmapSource, Pos, Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableOperation } from './history-model.ts';
import { AssetRegistry, type MaterializationLease } from './asset-registry.ts';
import type { DurableReplayLayer, DurableReplayResult } from './durable-replay.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import type { ToolArgs } from './tool-types.ts';
import { MAX_AFFINE_COORDINATE, MAX_AFFINE_PIXELS } from './affine-transform.ts';
import { isRasterStrokeArgs } from '../util/typeGuards.ts';
import {
  drawEvaluatedPresentation,
  evaluatePresentation,
  scaleVectorArgs,
  type PresentationOperation,
} from './presentation-evaluator.ts';

export type MaterializationRequest = Readonly<{
  documentId: string;
  baselineAssetGeneration: number;
  operationSetRevision: number;
  frame?: DocumentFrame;
  assetRegistry: AssetRegistry;
  signal?: AbortSignal;
}>;

export type MaterializedLayer = Readonly<{
  layerId: string;
  bitmap: BitmapSource;
  bounds: Pos;
  lease: MaterializationLease<Pos>;
}>;

export type MaterializedDocument = Readonly<{
  replay: DurableReplayResult;
  layers: Readonly<Record<string, MaterializedLayer>>;
  release: () => void;
}>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value as object)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])])
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function createCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(safeWidth, safeHeight);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    return canvas;
  }
  throw new Error('No canvas implementation is available for materialization');
}

function context2d(
  canvas: OffscreenCanvas | HTMLCanvasElement
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required for materialization');
  return context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function layerSize(layer: DurableReplayLayer): Size {
  return {
    width: layer.snapshot.pos.width,
    height: layer.snapshot.pos.height,
  };
}

function presentationOperations(operations: readonly DurableOperation[]): PresentationOperation[] {
  const normalized: PresentationOperation[] = [];
  for (const operation of operations) {
    if (operation.kind === 'apply-affine-transform') {
      normalized.push({ kind: 'affine-transform', transform: operation.transform });
      continue;
    }
    if (operation.kind !== 'apply-filter') continue;

    const processor = toolProcessors[operation.filter.toolName];
    if (!processor || processor.replay.version !== operation.filter.version) {
      throw new Error(`Unsupported filter ${operation.filter.toolName} v${operation.filter.version}`);
    }
    // Version gating remains durable-record-specific. The shared evaluator only
    // receives the normalized, versionless filter needed to render it.
    if (processor.requiresCanvasFilter) requireCanvasFilter(operation.filter.toolName);
    normalized.push({
      kind: 'filter',
      toolName: operation.filter.toolName,
      args: operation.filter.args,
    });
  }
  return normalized;
}

/**
 * Resolves the raster a layer starts from, and says whether the caller may
 * publish it as this layer's own result. `borrowed` is true only for the
 * registry's asset, whose bitmap the registry — or the legacy runtime layer
 * behind a borrowed baseline — owns and may close. Every other source is created
 * here, so nothing outside this call can reach it.
 */
async function sourceBitmap(
  layer: DurableReplayLayer,
  request: MaterializationRequest
): Promise<{ bitmap: BitmapSource; release: () => void; size: Size; borrowed: boolean }> {
  const { source } = layer.snapshot;
  if (source.kind === 'raster') {
    const lease = await request.assetRegistry.resolve(source.assetId, request.signal);
    return { bitmap: lease.bitmap, release: lease.release, size: layerSize(layer), borrowed: true };
  }
  if (source.kind === 'legacy-tool') throw new Error(`Legacy source ${source.toolName} requires an explicit adapter`);
  const renderSize = layerSize(layer);
  if (source.kind === 'blank') {
    const canvas = createCanvas(renderSize.width, renderSize.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = source.color;
    ctx.globalAlpha = source.opacity;
    ctx.fillRect(0, 0, renderSize.width, renderSize.height);
    return { bitmap: canvas, release: () => undefined, size: renderSize, borrowed: false };
  } else {
    const toolName = source.toolName;
    const processor = toolProcessors[toolName as keyof typeof toolProcessors];
    if (!processor?.creator) throw new Error(`Source tool ${toolName} is not a deterministic creator`);
    const sourceRenderSize = source.kind === 'vector' ? renderSize : source.size;
    const args =
      source.kind === 'vector' && source.sourcePos.width > 0 && source.sourcePos.height > 0
        ? (scaleVectorArgs(source.args as unknown as Record<string, unknown>, source.sourcePos, {
            x: 0,
            y: 0,
            ...renderSize,
          }) as unknown as ToolArgs)
        : (source.args as ToolArgs);
    const [created] = processor.imageProcessor({ size: sourceRenderSize })(args);
    if (!created) throw new Error(`Source tool ${toolName} produced no raster`);
    return {
      bitmap: created,
      release: () => undefined,
      size: { width: created.width, height: created.height },
      borrowed: false,
    };
  }
}

async function toOwnedBitmap(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<BitmapSource> {
  if (globalThis.createImageBitmap) return globalThis.createImageBitmap(canvas);
  return canvas;
}

/**
 * An unevaluated copy of `bitmap` at `size`, owned by the caller.
 *
 * Deliberately a plain blit rather than a retained-segment render: it must not
 * evaluate the presentation, because the one caller that needs it is the
 * presentation whose extent the affine raster caps refuse.
 */
async function copyOwnedBitmap(bitmap: BitmapSource, size: Size): Promise<BitmapSource> {
  const copy = createCanvas(size.width, size.height);
  context2d(copy).drawImage(bitmap as CanvasImageSource, 0, 0, size.width, size.height);
  return toOwnedBitmap(copy);
}

function closeOwnedBitmap(bitmap: BitmapSource) {
  if (typeof (bitmap as { close?: unknown }).close === 'function') {
    (bitmap as ImageBitmap).close();
  }
}

export function createMaterializationKey(layer: DurableReplayLayer, request: MaterializationRequest): string {
  const operations = layer.operations.map((operation) => stableValue(operation));
  const sourceGeneration =
    layer.snapshot.source.kind === 'raster'
      ? (request.assetRegistry.getRecord(layer.snapshot.source.assetId)?.generation ?? -1)
      : 0;
  return stableStringify({
    documentId: request.documentId,
    baselineAssetGeneration: request.baselineAssetGeneration,
    source: stableValue(layer.snapshot.source),
    sourceGeneration,
    operationSetRevision: request.operationSetRevision,
    operations,
    pos: layer.snapshot.pos,
    opacity: layer.snapshot.opacity,
    blendMode: layer.snapshot.blendMode,
    visible: layer.snapshot.visible,
    affineRevision: operations.filter(
      (operation) => (operation as { kind?: string }).kind === 'apply-affine-transform'
    ),
    ...(request.frame ? { frame: request.frame } : {}),
  });
}

export async function materializeLayer(
  layer: DurableReplayLayer,
  request: MaterializationRequest
): Promise<MaterializedLayer> {
  const key = createMaterializationKey(layer, request);
  const lease = await request.assetRegistry.materialize({
    key,
    documentId: request.documentId,
    producer: async () => {
      const source = await sourceBitmap(layer, request);
      let bitmap = source.bitmap;
      // Layer.pos is the current logical presentation size. The source size
      // remains intrinsic, while processors and final placement use the
      // current geometry, matching the runtime layer renderer.
      let size = layerSize(layer);
      let origin = { x: layer.snapshot.pos.x, y: layer.snapshot.pos.y };
      let ownsBitmap = false;

      const replaceOwnedBitmap = (next: BitmapSource) => {
        const previous = bitmap;
        const previousWasOwned = ownsBitmap;
        if (previousWasOwned && previous !== next) closeOwnedBitmap(previous);
        bitmap = next;
        // A processor may return its input unchanged. Preserve the input's
        // ownership in that case rather than claiming a borrowed source.
        ownsBitmap = previous === next ? previousWasOwned : true;
      };

      /**
       * Bakes the retained operations collected so far into a surface, and leaves `origin`
       * and `size` describing THAT surface.
       *
       * A published surface is BLITTED into the document — `composeDurableDocument()` and the
       * frame path below both place it with `drawImage(bitmap, x, y, width, height)` — and a
       * blit quantizes its destination. Two numbers therefore have to be the surface's own:
       *
       * 1. THE STAMP SIZE. `drawImage` with four numbers scales the source by
       *    `width / source.width`, so stamping an evaluated un-rounded extent rescales a raster
       *    that was already resampled into it. The legacy renderer draws the same retained
       *    affine in ONE resample straight into the document; a stamped scale factor is a
       *    second, and the two authorities then disagree on the pixels. `size` is read back off
       *    the allocated surface, so the stamp is 1:1 by construction.
       * 2. THE SURFACE ORIGIN. A destination pixel samples the surface at
       *    `floor(x + k + 0.5)`, so a surface published at a fractional origin is not placed
       *    where its ink is, and the resampled pixels it carries sit on a grid that is not the
       *    document's — a sub-pixel phase shift on every edge, which `PixelContext` samples as a
       *    whole source pixel. So a PUBLISHED surface starts on a whole document pixel, grows to
       *    cover the presentation, and carries the sub-pixel remainder inside itself as
       *    `surfaceOffset`.
       *
       * `placedOnDocumentGrid` is therefore set only for the segment this function PUBLISHES.
       * The segment handed to a raster processor is not blitted; it is consumed at its own
       * extent by `applyRasterTool`, whose legacy counterpart is `stageProcessorInput()` and
       * which stages at the UN-snapped `evaluatePresentation` extent. Snapping that one would
       * make the durable processor input a pixel wider than the legacy one, and a processor
       * returns a raster the size of its input, so the two layers would land apart.
       *
       * The snap is a property of the layer alone, never of the frame this raster will be
       * placed into: a document frame origin is a whole number of pixels (`documentFrameFromSize()`
       * seeds `0, 0` and every crop edge is `Math.round`ed by `trimRect()`), so a whole-pixel
       * surface origin lands on the document's grid for every frame a document can have.
       */
      const renderRetainedSegment = async (
        operations: readonly DurableOperation[],
        force = false,
        placedOnDocumentGrid = false
      ) => {
        if (!force && operations.length === 0) return;
        const evaluation = evaluatePresentation({
          position: { x: origin.x, y: origin.y, width: size.width, height: size.height },
          sourceSize: size,
          operations: presentationOperations(operations),
          mode: 'layer-bounds',
        });
        // The presentation's extent in document space, which is what a blit places.
        const extentX = origin.x + evaluation.localBounds.x;
        const extentY = origin.y + evaluation.localBounds.y;
        // Flooring keeps the offset non-negative and the surface a superset of the ink, so a
        // blurred edge inside `localBounds` is never clipped by the surface it is baked into.
        const surfaceX = placedOnDocumentGrid ? Math.floor(extentX) : extentX;
        const surfaceY = placedOnDocumentGrid ? Math.floor(extentY) : extentY;
        const surfaceOffsetX = extentX - surfaceX;
        const surfaceOffsetY = extentY - surfaceY;
        const output = createCanvas(
          evaluation.localBounds.width + surfaceOffsetX,
          evaluation.localBounds.height + surfaceOffsetY
        );
        const ctx = context2d(output);
        ctx.save();
        try {
          // The evaluator composes affine operations first, then applies the
          // joined filter string to that presentation.
          drawEvaluatedPresentation(ctx, bitmap, evaluation, {
            kind: 'bounds',
            surfaceOffset: { x: surfaceOffsetX, y: surfaceOffsetY },
          });
        } finally {
          ctx.restore();
        }
        replaceOwnedBitmap(await toOwnedBitmap(output));
        origin = { x: surfaceX, y: surfaceY };
        size = { width: output.width, height: output.height };
      };

      try {
        let retainedOperations: DurableOperation[] = [];
        for (const operation of layer.operations) {
          if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');

          if (operation.kind === 'apply-affine-transform' || operation.kind === 'apply-filter') {
            retainedOperations.push(operation);
            continue;
          }
          if (operation.kind !== 'apply-raster-processor') continue;

          // A raster processor consumes the exact presentation produced by all
          // preceding retained operations. It cannot be moved before them.
          // Always draw into a private surface before a pixel processor. Some
          // processors mutate their input canvas, while registry assets and
          // source-local rasters are borrowed for this operation.
          await renderRetainedSegment(retainedOperations, true);
          retainedOperations = [];
          const processor = toolProcessors[operation.processorId as keyof typeof toolProcessors];
          if (!processor) throw new Error(`Unknown raster processor ${operation.processorId} v${operation.version}`);
          if (processor.replay.version !== operation.version) {
            throw new Error(`Unsupported raster processor ${operation.processorId} v${operation.version}`);
          }
          const toolArgs = operation.args as ToolArgs;
          // A tight legacy layer is widened only for this raster operation. The frame is part of
          // the stroke args, so durable materialization uses the same origin and transparent
          // padding as runtime replay instead of silently clipping an outward stroke.
          if (isRasterStrokeArgs(toolArgs)) {
            const requested = toolArgs.rasterBounds;
            // The same cap the live staging path applies, for the same reason: a frame is sized
            // from a stroke's extent, and an unallocatable one must be refused rather than
            // allocated here as well. Both paths then decline the same edit, which is the only
            // way their pixels stay in agreement.
            const allocatable =
              Number.isFinite(requested.width) &&
              Number.isFinite(requested.height) &&
              Math.ceil(requested.width) >= 1 &&
              Math.ceil(requested.height) >= 1 &&
              Math.abs(requested.x) <= MAX_AFFINE_COORDINATE &&
              Math.abs(requested.y) <= MAX_AFFINE_COORDINATE &&
              requested.width <= MAX_AFFINE_COORDINATE &&
              requested.height <= MAX_AFFINE_COORDINATE &&
              requested.width * requested.height <= MAX_AFFINE_PIXELS;
            if (
              allocatable &&
              (requested.x !== origin.x ||
                requested.y !== origin.y ||
                requested.width !== size.width ||
                requested.height !== size.height)
            ) {
              const widened = createCanvas(requested.width, requested.height);
              context2d(widened).drawImage(bitmap, origin.x - requested.x, origin.y - requested.y);
              replaceOwnedBitmap(await toOwnedBitmap(widened));
              origin = { x: requested.x, y: requested.y };
              size = { width: requested.width, height: requested.height };
            }
          }
          const [processed, patch] = processor.imageProcessor({ bitmap, size })(toolArgs);
          if (!processed) throw new Error(`Raster processor ${operation.processorId} produced no raster`);
          replaceOwnedBitmap(processed);
          origin = {
            x: patch?.x ?? origin.x,
            y: patch?.y ?? origin.y,
          };
          size = { width: processed.width, height: processed.height };
        }
        const area = size.width * size.height;
        const requiresSurface =
          retainedOperations.length > 0 ||
          request.frame !== undefined ||
          !Number.isFinite(area) ||
          size.width <= 0 ||
          size.height <= 0 ||
          area <= MAX_AFFINE_PIXELS;
        // The segment this layer is PUBLISHED at: its raster is the one a blit places, so it is
        // the one that has to be snapped and sized from its own surface. See
        // `renderRetainedSegment()`.
        await renderRetainedSegment(retainedOperations, requiresSurface, true);
        const bounds: Pos = { x: origin.x, y: origin.y, width: size.width, height: size.height };
        // The materialization cache owns every bitmap it publishes, and it
        // outlives this producer's lease on the source. Skipping the final
        // surface — which a presentation too large for the affine budget MUST
        // skip, because evaluating it would refuse the layer — otherwise leaves
        // the registry's borrowed bitmap as the result, and either the registry
        // or the legacy runtime layer behind a borrowed baseline may close that
        // bitmap while this entry is still live. So an unrendered borrowed
        // source is copied into one the cache owns; a bitmap created here (a
        // blank or creator source) and anything an operation already replaced
        // are published as they are.
        const publishesBorrowedSource = !ownsBitmap && source.borrowed;
        const presentation = publishesBorrowedSource ? await copyOwnedBitmap(bitmap, size) : bitmap;
        const presentationIsOwned = ownsBitmap || publishesBorrowedSource;
        ownsBitmap = false;
        if (!request.frame) {
          return { bitmap: presentation, metadata: bounds };
        }

        const frameSurface = createCanvas(request.frame.width, request.frame.height);
        const frameContext = context2d(frameSurface);
        const frameEvaluation = evaluatePresentation({
          position: bounds,
          sourceSize: { width: bounds.width, height: bounds.height },
          operations: [],
          frame: request.frame,
          mode: 'frame-bounds',
        });
        drawEvaluatedPresentation(frameContext, presentation, frameEvaluation, {
          kind: 'document',
          frame: request.frame,
        });
        if (presentationIsOwned) closeOwnedBitmap(presentation);
        return {
          bitmap: await toOwnedBitmap(frameSurface),
          metadata: {
            x: request.frame.x,
            y: request.frame.y,
            width: request.frame.width,
            height: request.frame.height,
          },
        };
      } finally {
        source.release();
        if (ownsBitmap) closeOwnedBitmap(bitmap);
      }
    },
  });
  return {
    layerId: layer.snapshot.id,
    bitmap: lease.bitmap,
    bounds: lease.metadata,
    lease,
  };
}

export async function materializeDocument(
  replay: DurableReplayResult,
  request: MaterializationRequest
): Promise<MaterializedDocument> {
  const materialized: Record<string, MaterializedLayer> = {};
  try {
    for (const layer of Object.values(replay.layers)) {
      if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');
      if (!layer.snapshot.visible) continue;
      try {
        materialized[layer.snapshot.id] = await materializeLayer(layer, request);
      } catch (error) {
        // A refused layer must not be published unfiltered: doing so would make
        // the visible document look successful while durable replay cannot
        // reproduce its pixels. Keep the failure local, report it, and let the
        // compositor continue with the layers that did materialize.
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        console.error(`Unable to materialize durable layer ${layer.snapshot.id}; skipping layer`, error);
      }
      // Keep replay cooperative even when every operation is synchronous.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  } catch (error) {
    for (const layer of Object.values(materialized)) layer.lease.release();
    throw error;
  }
  let released = false;
  return {
    replay,
    layers: Object.freeze(materialized),
    release: () => {
      if (released) return;
      released = true;
      for (const layer of Object.values(materialized)) layer.lease.release();
    },
  };
}
