import type { BitmapSource, Pos, Size } from './general-types.ts';
import {
  getAffineBounds,
  IDENTITY_AFFINE_TRANSFORM,
  multiplyAffineTransforms,
  type AffineTransform,
} from './affine-transform.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableFilter, DurableLayerSource, DurableOperation } from './history-model.ts';
import { AssetRegistry, type MaterializationLease } from './asset-registry.ts';
import type { DurableReplayLayer, DurableReplayResult } from './durable-replay.ts';
import { toolProcessors } from '../tools/toolProcessors.ts';
import type { ToolArgs } from './tool-types.ts';
import { buildColorsFilter, buildLevelsFilter } from '../tools/functions.ts';

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

function filterForOperation(filter: DurableFilter): string {
  switch (filter.toolName) {
    case 'blur':
      return `blur(${Number(filter.args.radius ?? 0)}px)`;
    case 'color':
      return buildColorsFilter({
        grayscale: Number(filter.args.grayscale ?? 0),
        sepia: Number(filter.args.sepia ?? 0),
        saturation: Number(filter.args.saturation ?? 0),
      });
    case 'levels':
      return buildLevelsFilter({
        brightness: Number(filter.args.brightness ?? 0),
        contrast: Number(filter.args.contrast ?? 0),
      });
  }
}

function operationFilter(operations: readonly DurableOperation[]): string {
  return (
    operations
      .filter(
        (operation): operation is Extract<DurableOperation, { kind: 'apply-filter' }> =>
          operation.kind === 'apply-filter'
      )
      .map((operation) => {
        const processor = toolProcessors[operation.filter.toolName];
        if (!processor || processor.replay.version !== operation.filter.version) {
          throw new Error(`Unsupported filter ${operation.filter.toolName} v${operation.filter.version}`);
        }
        return filterForOperation(operation.filter);
      })
      .join(' ') || 'none'
  );
}

function operationAffine(operations: readonly DurableOperation[]): AffineTransform {
  let transform = IDENTITY_AFFINE_TRANSFORM;
  for (const operation of operations) {
    if (operation.kind !== 'apply-affine-transform') continue;
    transform = multiplyAffineTransforms(operation.transform, transform);
  }
  return transform;
}

function layerSize(layer: DurableReplayLayer): Size {
  return {
    width: layer.snapshot.pos.width,
    height: layer.snapshot.pos.height,
  };
}

function vectorArgsForSize(source: Extract<DurableLayerSource, { kind: 'vector' }>, size: Size): ToolArgs {
  const sourceWidth = source.sourcePos.width;
  const sourceHeight = source.sourcePos.height;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return source.args as ToolArgs;

  const scaleX = size.width / sourceWidth;
  const scaleY = size.height / sourceHeight;
  const args = source.args as ToolArgs & {
    start?: { x: number; y: number };
    end?: { x: number; y: number };
    lineWidth?: number;
  };
  if (!args.start || !args.end) return args;

  return {
    ...args,
    start: { x: args.start.x * scaleX, y: args.start.y * scaleY },
    end: { x: args.end.x * scaleX, y: args.end.y * scaleY },
    ...(typeof args.lineWidth === 'number' ? { lineWidth: args.lineWidth * Math.sqrt(Math.abs(scaleX * scaleY)) } : {}),
  } as ToolArgs;
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
    const toolName = 'toolName' in source ? source.toolName : 'text';
    const processor = toolProcessors[toolName as keyof typeof toolProcessors];
    if (!processor?.creator) throw new Error(`Source tool ${toolName} is not a deterministic creator`);
    const sourceRenderSize = source.kind === 'vector' ? renderSize : source.size;
    const args = source.kind === 'vector' ? vectorArgsForSize(source, renderSize) : (source.args as ToolArgs);
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
        const affine = operationAffine(operations);
        const bounds = getAffineBounds(affine, size);
        const output = createCanvas(bounds.width, bounds.height);
        const ctx = context2d(output);
        ctx.save();
        try {
          // Retained operations use the documented product rule: affine
          // operations compose first, then filters apply to that presentation.
          ctx.filter = operationFilter(operations);
          ctx.translate(-bounds.x, -bounds.y);
          ctx.transform(affine.a, affine.b, affine.c, affine.d, affine.e, affine.f);
          ctx.drawImage(bitmap, 0, 0, size.width, size.height);
        } finally {
          ctx.restore();
        }
        replaceOwnedBitmap(await toOwnedBitmap(output));
        origin = { x: origin.x + bounds.x, y: origin.y + bounds.y };
        size = { width: bounds.width, height: bounds.height };
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
        frameContext.drawImage(
          presentation,
          bounds.x - request.frame.x,
          bounds.y - request.frame.y,
          bounds.width,
          bounds.height
        );
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
      materialized[layer.snapshot.id] = await materializeLayer(layer, request);
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
