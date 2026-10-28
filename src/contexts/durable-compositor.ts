import type { BitmapSource } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableReplayResult } from './durable-replay.ts';
import {
  materializeDocument,
  type MaterializationRequest,
  type MaterializedDocument,
  type MaterializedLayer,
} from './materialization.ts';
import { toOwnedBitmap } from './materialization-bitmap.ts';

export type DurableCompositorRequest = Omit<MaterializationRequest, 'frame'> &
  Readonly<{
    frame?: DocumentFrame;
  }>;

export type DurableCompositionRefusalCode = 'materialization-refused' | 'layer-coverage' | 'renderer-incompatible';

export class DurableCompositionRefusal extends Error {
  readonly code: DurableCompositionRefusalCode;
  readonly missingLayerIds: readonly string[];
  readonly unexpectedLayerIds: readonly string[];

  constructor(
    code: DurableCompositionRefusalCode,
    message: string,
    missingLayerIds: readonly string[] = [],
    unexpectedLayerIds: readonly string[] = []
  ) {
    super(message);
    this.name = 'DurableCompositionRefusal';
    this.code = code;
    this.missingLayerIds = Object.freeze([...missingLayerIds]);
    this.unexpectedLayerIds = Object.freeze([...unexpectedLayerIds]);
  }
}

export type DurableComposite = Readonly<{
  bitmap: BitmapSource;
  frame: DocumentFrame;
  layers: Readonly<Record<string, MaterializedLayer>>;
  takeLayers: () => Readonly<{
    layers: Readonly<Record<string, MaterializedLayer>>;
    release: () => void;
  }>;
  release: () => void;
}>;

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
  throw new Error('No canvas implementation is available for durable composition');
}

function context2d(
  canvas: OffscreenCanvas | HTMLCanvasElement
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is required for durable composition');
  return context as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function closeOwnedBitmap(bitmap: BitmapSource): void {
  if (typeof (bitmap as { close?: unknown }).close === 'function') {
    (bitmap as ImageBitmap).close();
  }
}

function orderedLayers(replay: DurableReplayResult): readonly string[] {
  return Object.values(replay.layers)
    .sort((left, right) => left.snapshot.order - right.snapshot.order)
    .map((layer) => layer.snapshot.id);
}

/**
 * A durable presentation is publishable only when every visible replay layer
 * materialized. Callers that adapt a composite into runtime records reuse this
 * check so a partial document can never be staged as durable.
 */
export function requireVisibleLayerCoverage(
  replay: DurableReplayResult,
  materialized: Readonly<Record<string, MaterializedLayer>>
): void {
  const expected = orderedLayers(replay).filter((layerId) => replay.layers[layerId]?.snapshot.visible);
  const actual = Object.keys(materialized);
  const missing = expected.filter((layerId) => !materialized[layerId]);
  const unexpected = actual.filter((layerId) => !replay.layers[layerId]?.snapshot.visible);
  if (missing.length === 0 && unexpected.length === 0 && actual.length === expected.length) return;

  const parts = [
    'Durable composition refused because visible materialization coverage is incomplete',
    missing.length > 0 ? `missing: ${missing.join(', ')}` : '',
    unexpected.length > 0 ? `unexpected: ${unexpected.join(', ')}` : '',
  ].filter(Boolean);
  throw new DurableCompositionRefusal(
    missing.length > 0 ? 'materialization-refused' : 'layer-coverage',
    parts.join('; '),
    missing,
    unexpected
  );
}

/**
 * Composes successful per-layer materializations into one document-frame bitmap.
 * `materializeDocument` deliberately returns only layers that could be rendered;
 * this compositor never substitutes an unfiltered source for a refused layer.
 */
export async function composeDurableDocument(
  replay: DurableReplayResult,
  request: DurableCompositorRequest
): Promise<DurableComposite> {
  const { frame = replay.frame, ...materializationRequest } = request;
  const canvas = createCanvas(frame.width, frame.height);
  const context = context2d(canvas);
  let materialized: MaterializedDocument | undefined;
  let bitmap: BitmapSource;

  try {
    materialized = await materializeDocument(
      replay,
      {
        ...materializationRequest,
        pixelGridFrame: frame,
      },
      canvas
    );
    requireVisibleLayerCoverage(replay, materialized.layers);
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    context.clearRect(0, 0, canvas.width, canvas.height);
    // Match the runtime and retained-presentation draws: fractional layer bounds
    // must not introduce a second filtered resampling pass during composition.
    context.imageSmoothingEnabled = false;
    for (const layerId of orderedLayers(replay)) {
      const replayLayer = replay.layers[layerId];
      const layer = materialized.layers[layerId];
      if (!replayLayer || !replayLayer.snapshot.visible) continue;
      if (!layer) {
        throw new Error(`Unable to compose durable layer ${layerId}: materialization was refused`);
      }
      if (!layer.visible) continue;

      context.save();
      try {
        context.globalAlpha = layer.opacity;
        context.globalCompositeOperation = layer.blendMode;
        context.drawImage(
          layer.bitmap as CanvasImageSource,
          layer.bounds.x - frame.x,
          layer.bounds.y - frame.y,
          layer.bounds.width,
          layer.bounds.height
        );
      } finally {
        context.restore();
      }
    }
    bitmap = await toOwnedBitmap(canvas);
    if (bitmap !== canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  } catch (error) {
    materialized?.release();
    canvas.width = 1;
    canvas.height = 1;
    throw error;
  }
  if (!materialized) throw new Error('Durable composition did not materialize visible layers');

  let released = false;
  let layersDetached = false;
  let layersReleased = false;
  const releaseLayers = () => {
    if (layersReleased) return;
    layersReleased = true;
    materialized.release();
  };
  return {
    bitmap,
    frame,
    layers: materialized.layers,
    takeLayers: () => {
      layersDetached = true;
      return { layers: materialized.layers, release: releaseLayers };
    },
    release: () => {
      if (released) return;
      released = true;
      closeOwnedBitmap(bitmap);
      if (!layersDetached) releaseLayers();
    },
  };
}
