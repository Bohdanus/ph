import type { BitmapSource, Pos, Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableOperation } from './history-model.ts';
import { AssetRegistry, type MaterializationLease } from './asset-registry.ts';
import {
  isDurableFoldOrigin,
  isDurablePixelOperation,
  type DurableReplayLayer,
  type DurableReplayResult,
} from './durable-replay.ts';
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

/**
 * The box the ordered fold starts from, and the one precondition on a retained
 * list that the fold cannot do without.
 *
 * A stroke's `rasterBounds` is ABSOLUTE — the frame the layer was padded into —
 * while the box the source is padded FROM is not: it is the layer's own box at
 * the moment the stroke was recorded, and a reposition recorded afterwards names
 * only the box the layer moved TO. So the box the fold starts at is the one
 * number a reposition cannot restate, and `replayDurableDocument` writes it at
 * the head of the retained list as it folds, for exactly this purpose.
 *
 * Without it, a layer carrying a reposition after a pixel operation is padded
 * from the snapshot's box and the stroke's frame is published with its content
 * offset by the whole move — the frame right, the pixels in it wrong, by the size
 * of the stroke's footprint. A list in that state cannot arrive from the reducer,
 * so it is refused rather than published: this is the loud answer for a retained
 * list assembled outside it, and the two halves of the rule live together here
 * because they are the same rule.
 */
function foldStart(layer: DurableReplayLayer): { origin: { x: number; y: number }; size: Size } {
  const head = layer.operations[0];
  if (isDurableFoldOrigin(head)) {
    const { x, y, width, height } = head.resize;
    return { origin: { x, y }, size: { width, height } };
  }
  let sawPixelOperation = false;
  for (const operation of layer.operations) {
    if (isDurablePixelOperation(operation)) {
      sawPixelOperation = true;
      continue;
    }
    if (sawPixelOperation && operation.kind === 'reposition-layer') {
      throw new Error(
        `Layer ${layer.snapshot.id} retained a reposition after a pixel operation with no fold origin; ` +
          'the box its first pixel operation ran against is unrecoverable, so it is refused rather than published at the wrong origin'
      );
    }
  }
  const { x, y, width, height } = layer.snapshot.pos;
  return { origin: { x, y }, size: { width, height } };
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
  size: Size,
  request: MaterializationRequest
): Promise<{ bitmap: BitmapSource; release: () => void; size: Size; borrowed: boolean }> {
  const { source } = layer.snapshot;
  if (source.kind === 'raster') {
    const lease = await request.assetRegistry.resolve(source.assetId, request.signal);
    return { bitmap: lease.bitmap, release: lease.release, size, borrowed: true };
  }
  if (source.kind === 'legacy-tool') throw new Error(`Legacy source ${source.toolName} requires an explicit adapter`);
  // The size the fold starts at, which is the size the source was rendered at and
  // the size the first pixel operation was recorded against. It differs from the
  // snapshot's once a reposition has followed a pixel operation, and padding a
  // source of one size into a frame sized for the other is the placement this
  // whole fold exists to keep right.
  if (source.kind === 'blank') {
    const canvas = createCanvas(size.width, size.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = source.color;
    ctx.globalAlpha = source.opacity;
    ctx.fillRect(0, 0, size.width, size.height);
    return { bitmap: canvas, release: () => undefined, size, borrowed: false };
  } else {
    const toolName = source.toolName;
    const processor = toolProcessors[toolName as keyof typeof toolProcessors];
    if (!processor?.creator) throw new Error(`Source tool ${toolName} is not a deterministic creator`);
    const sourceRenderSize = source.kind === 'vector' ? size : source.size;
    const args =
      source.kind === 'vector' && source.sourcePos.width > 0 && source.sourcePos.height > 0
        ? (scaleVectorArgs(source.args as unknown as Record<string, unknown>, source.sourcePos, {
            x: 0,
            y: 0,
            ...size,
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
      const start = foldStart(layer);
      const source = await sourceBitmap(layer, start.size, request);
      let bitmap = source.bitmap;
      // Layer.pos is the current logical presentation size. The source size
      // remains intrinsic, while processors and final placement use the
      // current geometry, matching the runtime layer renderer.
      let size = start.size;
      let origin = { x: start.origin.x, y: start.origin.y };
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

      const renderRetainedSegment = async (operations: readonly DurableOperation[], force = false) => {
        if (!force && operations.length === 0) return;
        const evaluation = evaluatePresentation({
          position: { x: origin.x, y: origin.y, width: size.width, height: size.height },
          sourceSize: size,
          operations: presentationOperations(operations),
          mode: 'layer-bounds',
        });
        const output = createCanvas(evaluation.localBounds.width, evaluation.localBounds.height);
        const ctx = context2d(output);
        ctx.save();
        try {
          // The evaluator composes affine operations first, then applies the
          // joined filter string to that presentation.
          drawEvaluatedPresentation(ctx, bitmap, evaluation, { kind: 'bounds' });
        } finally {
          ctx.restore();
        }
        replaceOwnedBitmap(await toOwnedBitmap(output));
        origin = { x: evaluation.bounds.x, y: evaluation.bounds.y };
        size = { width: evaluation.bounds.width, height: evaluation.bounds.height };
      };

      try {
        let retainedOperations: DurableOperation[] = [];
        for (const operation of layer.operations) {
          if (request.signal?.aborted) throw new DOMException('Materialization aborted', 'AbortError');

          if (operation.kind === 'reposition-layer') {
            // A box patch, at the point in the timeline the timeline recorded it, with
            // legacy replay's own precedence (`reposition` commits `resize ?? move`): a
            // resize states the whole box, a move states the origin and leaves the size
            // the fold has reached. It changes no pixel, so nothing is re-rendered — the
            // operations around it read the box at the point they ran, which is the
            // whole reason they are folded here rather than read off the snapshot.
            if (operation.resize) {
              origin = { x: operation.resize.x, y: operation.resize.y };
              size = { width: operation.resize.width, height: operation.resize.height };
            } else if (operation.move) {
              origin = { x: operation.move.x, y: operation.move.y };
            }
            continue;
          }
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
        await renderRetainedSegment(retainedOperations, requiresSurface);
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
