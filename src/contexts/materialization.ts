import type { BitmapSource, Pos, Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableOperation } from './history-model.ts';
import { AssetRegistry, type MaterializationLease } from './asset-registry.ts';
import type { DurableReplayLayer, DurableReplayResult } from './durable-replay.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import type { ToolArgs } from './tool-types.ts';
import { MAX_AFFINE_PIXELS } from './affine-transform.ts';
import {
  assertProcessorStagingBudget,
  drawEvaluatedPresentation,
  evaluatePresentation,
  getProcessorRasterSize,
  scaleTextArgs,
  scaleVectorArgs,
  type PresentationOperation,
} from './presentation-evaluator.ts';
import { toOwnedBitmap } from './materialization-bitmap.ts';

export type MaterializationRequest = Readonly<{
  documentId: string;
  baselineAssetGeneration: number;
  operationSetRevision: number;
  frame?: DocumentFrame;
  pixelGridFrame?: DocumentFrame;
  assetRegistry: AssetRegistry;
  signal?: AbortSignal;
}>;

type MaterializationCanvas = OffscreenCanvas | HTMLCanvasElement;

export type ResolvedLayerSourceBitmap = Readonly<{
  bitmap: BitmapSource;
  release: () => void;
  size: Size;
  borrowed: boolean;
}>;

export type MaterializedLayer = Readonly<{
  layerId: string;
  bitmap: BitmapSource;
  bounds: Pos;
  visible: boolean;
  opacity: number;
  blendMode: GlobalCompositeOperation;
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

function alignBoundsToFrame(bounds: Pos, frame: DocumentFrame): Pos {
  const left = Math.floor(bounds.x - frame.x);
  const top = Math.floor(bounds.y - frame.y);
  const right = Math.ceil(bounds.x + bounds.width - frame.x);
  const bottom = Math.ceil(bounds.y + bounds.height - frame.y);
  return {
    x: frame.x + left,
    y: frame.y + top,
    width: right - left,
    height: bottom - top,
  };
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

function assertDocumentGeneration(request: MaterializationRequest): void {
  if (request.assetRegistry.getDocumentGeneration(request.documentId) !== request.baselineAssetGeneration) {
    throw new DOMException('Materialization invalidated by document disposal', 'AbortError');
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const nameGetter = Object.getOwnPropertyDescriptor(DOMException.prototype, 'name')?.get;
  if (!nameGetter) return false;
  try {
    return Reflect.apply(nameGetter, error, []) === 'AbortError';
  } catch {
    return false;
  }
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

function isNoOpColorReplacement(operation: DurableOperation): boolean {
  if (operation.kind !== 'apply-raster-processor' || operation.processorId !== 'color-replacement') return false;
  const opacity = operation.args.alpha;
  return typeof opacity === 'number' && Number.isFinite(opacity) && opacity <= 0;
}

/** Refuse an over-budget first processor before resolving or creating its source raster. */
function preflightFirstRasterProcessor(layer: DurableReplayLayer): void {
  for (let processorIndex = 0; processorIndex < layer.operations.length; processorIndex++) {
    const operation = layer.operations[processorIndex];
    if (!operation || operation.kind !== 'apply-raster-processor') continue;

    const processor = toolProcessors[operation.processorId as keyof typeof toolProcessors];
    if (!processor) throw new Error(`Unknown raster processor ${operation.processorId} v${operation.version}`);
    if (processor.replay.version !== operation.version) {
      throw new Error(`Unsupported raster processor ${operation.processorId} v${operation.version}`);
    }
    if (isNoOpColorReplacement(operation)) continue;
    if (processor.maxStagingPixelCount === undefined) return;

    const evaluation = evaluatePresentation({
      position: layer.snapshot.pos,
      sourceSize: layerSize(layer),
      operations: presentationOperations(layer.operations.slice(0, processorIndex)),
      mode: 'layer-bounds',
    });
    const rasterSize = getProcessorRasterSize(evaluation.localBounds);
    assertProcessorStagingBudget(rasterSize.width, rasterSize.height, processor.maxStagingPixelCount);
    return;
  }
}

/**
 * Resolves the raster a layer starts from, and says whether the caller may
 * publish it as this layer's own result. `borrowed` is true only for the
 * registry's asset, whose bitmap the registry — or the legacy runtime layer
 * behind a borrowed baseline — owns and may close. Every other source is created
 * here, so nothing outside this call can reach it.
 */
export async function resolveLayerSourceBitmap(
  layer: DurableReplayLayer,
  request: MaterializationRequest
): Promise<ResolvedLayerSourceBitmap> {
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
    return {
      bitmap: canvas,
      release: () => undefined,
      size: renderSize,
      borrowed: false,
    };
  } else {
    const toolName = source.toolName;
    const processor = toolProcessors[toolName as keyof typeof toolProcessors];
    if (!processor?.creator) throw new Error(`Source tool ${toolName} is not a deterministic creator`);
    const sourceRenderSize = source.kind === 'vector' || source.kind === 'text' ? renderSize : source.size;
    const args =
      source.kind === 'vector' && source.sourcePos.width > 0 && source.sourcePos.height > 0
        ? (scaleVectorArgs(source.args as unknown as Record<string, unknown>, source.sourcePos, {
            x: 0,
            y: 0,
            ...renderSize,
          }) as unknown as ToolArgs)
        : source.kind === 'text' && source.sourcePos.width > 0 && source.sourcePos.height > 0
          ? (scaleTextArgs(source.args as unknown as Record<string, unknown>, source.sourcePos, {
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
    affineRevision: operations.filter(
      (operation) => (operation as { kind?: string }).kind === 'apply-affine-transform'
    ),
    ...(request.frame ? { frame: request.frame } : {}),
    ...(request.pixelGridFrame ? { pixelGridFrame: request.pixelGridFrame } : {}),
  });
}

export async function materializeLayer(
  layer: DurableReplayLayer,
  request: MaterializationRequest,
  sharedFrameSurface?: MaterializationCanvas
): Promise<MaterializedLayer> {
  if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');
  const key = createMaterializationKey(layer, request);
  const lease = await request.assetRegistry.materialize({
    key,
    documentId: request.documentId,
    expectedDocumentGeneration: request.baselineAssetGeneration,
    producer: async () => {
      // The first processor's presented extent can be computed from the immutable record alone.
      // Check it before sourceBitmap creates a blank/creator raster or resolves a borrowed asset.
      preflightFirstRasterProcessor(layer);
      const source = await resolveLayerSourceBitmap(layer, request);
      let bitmap = source.bitmap;
      // Layer.pos is the current logical presentation size. The source size
      // remains intrinsic, while processors and final placement use the
      // current geometry, matching the runtime layer renderer.
      let size = layerSize(layer);
      let origin = { x: layer.snapshot.pos.x, y: layer.snapshot.pos.y };
      let ownsBitmap = !source.borrowed;
      let frameSurface = sharedFrameSurface;
      let ownedFrameSurface: MaterializationCanvas | undefined;

      const replaceOwnedBitmap = (next: BitmapSource) => {
        const previous = bitmap;
        const previousWasOwned = ownsBitmap;
        if (previousWasOwned && previous !== next) closeOwnedBitmap(previous);
        bitmap = next;
        // A processor may return its input unchanged. Preserve the input's
        // ownership in that case rather than claiming a borrowed source.
        ownsBitmap = previous === next ? previousWasOwned : true;
      };

      const getFrameSurface = (frame: DocumentFrame): MaterializationCanvas => {
        if (!frameSurface) {
          // Preserve the exported materializeLayer() contract for direct callers.
          // materializeDocument() supplies a shared surface so document passes
          // reuse one allocation; a standalone layer owns its local scratch.
          frameSurface = createCanvas(frame.width, frame.height);
          ownedFrameSurface = frameSurface;
        }
        if (
          frameSurface.width !== Math.max(1, Math.ceil(frame.width)) ||
          frameSurface.height !== Math.max(1, Math.ceil(frame.height))
        ) {
          throw new Error('The shared materialization frame surface must match the requested document frame');
        }
        return frameSurface;
      };

      const renderRetainedSegment = async (
        operations: readonly DurableOperation[],
        force = false,
        pixelGridFrame?: MaterializationRequest['pixelGridFrame'],
        maxPixelCount?: number
      ) => {
        if (!force && operations.length === 0) return;
        const evaluation = evaluatePresentation({
          position: { x: origin.x, y: origin.y, width: size.width, height: size.height },
          sourceSize: size,
          operations: presentationOperations(operations),
          mode: 'layer-bounds',
        });
        const pixelGridBounds = pixelGridFrame ? alignBoundsToFrame(evaluation.bounds, pixelGridFrame) : undefined;
        const outputWidth = Math.max(1, Math.ceil(pixelGridBounds?.width ?? evaluation.localBounds.width));
        const outputHeight = Math.max(1, Math.ceil(pixelGridBounds?.height ?? evaluation.localBounds.height));
        assertProcessorStagingBudget(outputWidth, outputHeight, maxPixelCount);
        const output = pixelGridBounds
          ? createCanvas(pixelGridBounds.width, pixelGridBounds.height)
          : createCanvas(evaluation.localBounds.width, evaluation.localBounds.height);
        const ctx = context2d(output);
        ctx.save();
        try {
          if (pixelGridBounds) {
            ctx.translate(evaluation.bounds.x - pixelGridBounds.x, evaluation.bounds.y - pixelGridBounds.y);
          }
          // The evaluator composes affine operations first, then applies the
          // joined filter string to that presentation.
          drawEvaluatedPresentation(ctx, bitmap, evaluation, { kind: 'bounds' });
        } finally {
          ctx.restore();
        }
        if (pixelGridFrame && pixelGridBounds) {
          // Rasterize visible pixels in document coordinates so this tight
          // per-layer bitmap uses the same pixel phase as the legacy renderer.
          // Preserve any off-frame portion from the bounded pass above.
          const rasterizationSurface = getFrameSurface(pixelGridFrame);
          const frameContext = context2d(rasterizationSurface);
          frameContext.save();
          try {
            frameContext.globalAlpha = 1;
            frameContext.globalCompositeOperation = 'source-over';
            frameContext.filter = 'none';
            frameContext.clearRect(0, 0, rasterizationSurface.width, rasterizationSurface.height);
            drawEvaluatedPresentation(frameContext, bitmap, evaluation, {
              kind: 'document',
              frame: pixelGridFrame,
            });
          } finally {
            frameContext.restore();
          }

          const left = Math.max(pixelGridBounds.x, pixelGridFrame.x);
          const top = Math.max(pixelGridBounds.y, pixelGridFrame.y);
          const right = Math.min(pixelGridBounds.x + pixelGridBounds.width, pixelGridFrame.x + pixelGridFrame.width);
          const bottom = Math.min(pixelGridBounds.y + pixelGridBounds.height, pixelGridFrame.y + pixelGridFrame.height);
          if (right > left && bottom > top) {
            const sourceX = left - pixelGridFrame.x;
            const sourceY = top - pixelGridFrame.y;
            const destinationX = left - pixelGridBounds.x;
            const destinationY = top - pixelGridBounds.y;
            const width = right - left;
            const height = bottom - top;
            ctx.save();
            try {
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
              ctx.filter = 'none';
              ctx.imageSmoothingEnabled = false;
              ctx.clearRect(destinationX, destinationY, width, height);
              ctx.drawImage(
                rasterizationSurface as CanvasImageSource,
                sourceX,
                sourceY,
                width,
                height,
                destinationX,
                destinationY,
                width,
                height
              );
            } finally {
              ctx.restore();
            }
          }
        }
        replaceOwnedBitmap(await toOwnedBitmap(output));
        origin = pixelGridBounds
          ? { x: pixelGridBounds.x, y: pixelGridBounds.y }
          : { x: evaluation.bounds.x, y: evaluation.bounds.y };
        size = pixelGridBounds
          ? { width: pixelGridBounds.width, height: pixelGridBounds.height }
          : { width: evaluation.bounds.width, height: evaluation.bounds.height };
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
          const processor = toolProcessors[operation.processorId as keyof typeof toolProcessors];
          if (!processor) throw new Error(`Unknown raster processor ${operation.processorId} v${operation.version}`);
          if (processor.replay.version !== operation.version) {
            throw new Error(`Unsupported raster processor ${operation.processorId} v${operation.version}`);
          }
          // A zero-opacity Color Replacement is an identity operation. Validate
          // its durable processor/version first, then skip full-frame staging.
          if (isNoOpColorReplacement(operation)) continue;
          const logicalRasterSize = getProcessorRasterSize(size);
          const bitmapMatchesLogicalRaster =
            bitmap.width === logicalRasterSize.width && bitmap.height === logicalRasterSize.height;
          // A borrowed source can be reused without resampling only when its pixel
          // grid already matches the logical layer bounds. Copy it first so a
          // processor that mutates its input cannot change the registry asset.
          if (retainedOperations.length === 0 && !ownsBitmap && source.borrowed && bitmapMatchesLogicalRaster) {
            const rasterSize = { width: bitmap.width, height: bitmap.height };
            assertProcessorStagingBudget(rasterSize.width, rasterSize.height, processor.maxStagingPixelCount);
            replaceOwnedBitmap(await copyOwnedBitmap(bitmap, rasterSize));
          } else if (retainedOperations.length > 0 || !bitmapMatchesLogicalRaster || !ownsBitmap) {
            // Bake retained operations and align resized sources or prior processor
            // outputs to the current logical pixel grid before this processor.
            await renderRetainedSegment(retainedOperations, true, undefined, processor.maxStagingPixelCount);
          } else {
            // A matching owned raster can be reused without allocation, but every
            // processor still gets its own staging-budget check below.
          }
          retainedOperations = [];
          const rasterSize = { width: bitmap.width, height: bitmap.height };
          // Check every processor against the raster it actually receives. An
          // empty retained segment can reuse an owned bitmap without allocating,
          // so the pre-allocation check above alone cannot cover that path.
          assertProcessorStagingBudget(rasterSize.width, rasterSize.height, processor.maxStagingPixelCount);
          const [processed, patch] = processor.imageProcessor({ bitmap, size: rasterSize })(operation.args as ToolArgs);
          if (!processed) throw new Error(`Raster processor ${operation.processorId} produced no raster`);
          replaceOwnedBitmap(processed);
          origin = {
            x: patch?.x ?? origin.x,
            y: patch?.y ?? origin.y,
          };
          // Keep logical document bounds fractional while the processor works on
          // the integer-sized bitmap. A processor can explicitly return new
          // document bounds through its patch.
          size = {
            width: patch?.width ?? size.width,
            height: patch?.height ?? size.height,
          };
        }
        const area = size.width * size.height;
        const requiresSurface =
          retainedOperations.length > 0 ||
          !Number.isFinite(area) ||
          size.width <= 0 ||
          size.height <= 0 ||
          (!ownsBitmap && area <= MAX_AFFINE_PIXELS);
        const hasRetainedAffine = retainedOperations.some((operation) => operation.kind === 'apply-affine-transform');
        await renderRetainedSegment(
          retainedOperations,
          requiresSurface,
          hasRetainedAffine ? request.pixelGridFrame : undefined
        );
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
        const presentation = publishesBorrowedSource
          ? await copyOwnedBitmap(bitmap, { width: bitmap.width, height: bitmap.height })
          : bitmap;
        const presentationIsOwned = ownsBitmap || publishesBorrowedSource;
        ownsBitmap = false;
        if (!request.frame) {
          return { bitmap: presentation, metadata: bounds };
        }

        try {
          const frameRenderSurface = createCanvas(request.frame.width, request.frame.height);
          const frameContext = context2d(frameRenderSurface);
          const pixelGridFrame = request.pixelGridFrame;
          const frameAlreadyRasterized = Boolean(
            hasRetainedAffine &&
            pixelGridFrame &&
            pixelGridFrame.x === request.frame.x &&
            pixelGridFrame.y === request.frame.y &&
            pixelGridFrame.width === request.frame.width &&
            pixelGridFrame.height === request.frame.height &&
            frameSurface
          );
          if (frameAlreadyRasterized && frameSurface) {
            // renderRetainedSegment already drew the affine presentation in this
            // exact frame's pixel grid. Copy those pixels without shifting them
            // through a second fractional frame transform.
            frameContext.imageSmoothingEnabled = false;
            frameContext.drawImage(frameSurface as CanvasImageSource, 0, 0);
          } else {
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
          }
          return {
            bitmap: await toOwnedBitmap(frameRenderSurface),
            metadata: {
              x: request.frame.x,
              y: request.frame.y,
              width: request.frame.width,
              height: request.frame.height,
            },
          };
        } finally {
          if (presentationIsOwned) closeOwnedBitmap(presentation);
        }
      } finally {
        source.release();
        if (ownsBitmap) closeOwnedBitmap(bitmap);
        if (ownedFrameSurface) {
          ownedFrameSurface.width = 1;
          ownedFrameSurface.height = 1;
        }
      }
    },
  });
  if (request.signal?.aborted) {
    lease.release();
    throw new DOMException('Materialization aborted', 'AbortError');
  }
  return {
    layerId: layer.snapshot.id,
    bitmap: lease.bitmap,
    bounds: lease.metadata,
    visible: layer.snapshot.visible,
    opacity: layer.snapshot.opacity,
    blendMode: layer.snapshot.blendMode,
    lease,
  };
}

export async function materializeDocument(
  replay: DurableReplayResult,
  request: MaterializationRequest,
  sharedFrameSurface?: MaterializationCanvas
): Promise<MaterializedDocument> {
  const materialized: Record<string, MaterializedLayer> = {};
  const needsFrameSurface = Boolean(
    request.pixelGridFrame &&
    Object.values(replay.layers).some(
      (layer) =>
        layer.snapshot.visible && layer.operations.some((operation) => operation.kind === 'apply-affine-transform')
    )
  );
  const ownsFrameSurface = !sharedFrameSurface && needsFrameSurface;
  let frameSurface = sharedFrameSurface;
  try {
    if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');
    assertDocumentGeneration(request);
    if (ownsFrameSurface && request.pixelGridFrame) {
      // The layer loop below is serial, so one scratch serves every affine pass.
      frameSurface = createCanvas(request.pixelGridFrame.width, request.pixelGridFrame.height);
    }
    for (const layer of Object.values(replay.layers)) {
      if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');
      if (!layer.snapshot.visible) continue;
      try {
        materialized[layer.snapshot.id] = await materializeLayer(layer, request, frameSurface);
      } catch (error) {
        // A refused layer must not be published unfiltered: doing so would make
        // the visible document look successful while durable replay cannot
        // reproduce its pixels. Keep the failure local, report it, and let the
        // compositor continue with the layers that did materialize.
        if (isAbortError(error)) throw error;
        console.error(`Unable to materialize durable layer ${layer.snapshot.id}; skipping layer`, error);
      }
      // Keep replay cooperative even when every operation is synchronous.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');
      assertDocumentGeneration(request);
    }
  } catch (error) {
    for (const layer of Object.values(materialized)) layer.lease.release();
    throw error;
  } finally {
    if (ownsFrameSurface && frameSurface) {
      frameSurface.width = 1;
      frameSurface.height = 1;
    }
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
