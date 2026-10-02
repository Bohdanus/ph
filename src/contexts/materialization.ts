import type { BitmapSource, Pos, Size } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableOperation } from './history-model.ts';
import { AssetRegistry, type MaterializationLease } from './asset-registry.ts';
import type { DurableReplayLayer, DurableReplayResult } from './durable-replay.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import { requireCanvasFilter } from '../util/canvas-filter.ts';
import type { ToolArgs } from './tool-types.ts';
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

async function sourceBitmap(
  layer: DurableReplayLayer,
  request: MaterializationRequest
): Promise<{ bitmap: BitmapSource; release: () => void; size: Size }> {
  const { source } = layer.snapshot;
  if (source.kind === 'raster') {
    const lease = await request.assetRegistry.resolve(source.assetId, request.signal);
    return { bitmap: lease.bitmap, release: lease.release, size: layerSize(layer) };
  }
  if (source.kind === 'legacy-tool') throw new Error(`Legacy source ${source.toolName} requires an explicit adapter`);
  const renderSize = layerSize(layer);
  if (source.kind === 'blank') {
    const canvas = createCanvas(renderSize.width, renderSize.height);
    const ctx = context2d(canvas);
    ctx.fillStyle = source.color;
    ctx.globalAlpha = source.opacity;
    ctx.fillRect(0, 0, renderSize.width, renderSize.height);
    return { bitmap: canvas, release: () => undefined, size: renderSize };
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
    return { bitmap: created, release: () => undefined, size: { width: created.width, height: created.height } };
  }
}

async function toOwnedBitmap(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<BitmapSource> {
  if (globalThis.createImageBitmap) return globalThis.createImageBitmap(canvas);
  return canvas;
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
          const [processed, patch] = processor.imageProcessor({ bitmap, size })(operation.args as ToolArgs);
          if (!processed) throw new Error(`Raster processor ${operation.processorId} produced no raster`);
          replaceOwnedBitmap(processed);
          origin = {
            x: patch?.x ?? origin.x,
            y: patch?.y ?? origin.y,
          };
          size = { width: processed.width, height: processed.height };
        }
        await renderRetainedSegment(retainedOperations, true);
        const presentation = bitmap;
        const presentationIsOwned = ownsBitmap;
        ownsBitmap = false;
        const bounds: Pos = { x: origin.x, y: origin.y, width: size.width, height: size.height };
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
