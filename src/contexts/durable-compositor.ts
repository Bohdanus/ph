import type { BitmapSource } from './general-types.ts';
import type { DocumentFrame } from './document-frame.ts';
import type { DurableReplayResult } from './durable-replay.ts';
import { materializeDocument, type MaterializationRequest, type MaterializedLayer } from './materialization.ts';

export type DurableCompositorRequest = Omit<MaterializationRequest, 'frame'> &
  Readonly<{
    frame?: DocumentFrame;
  }>;

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

async function toOwnedBitmap(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<BitmapSource> {
  if (globalThis.createImageBitmap) return globalThis.createImageBitmap(canvas);
  return canvas;
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
 * Composes successful per-layer materializations into one document-frame bitmap.
 * `materializeDocument` deliberately returns only layers that could be rendered;
 * this compositor never substitutes an unfiltered source for a refused layer.
 */
export async function composeDurableDocument(
  replay: DurableReplayResult,
  request: DurableCompositorRequest
): Promise<DurableComposite> {
  const { frame = replay.frame, ...materializationRequest } = request;
  const materialized = await materializeDocument(replay, {
    ...materializationRequest,
    pixelGridFrame: frame,
  });
  let bitmap: BitmapSource;

  try {
    const canvas = createCanvas(frame.width, frame.height);
    const context = context2d(canvas);
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
  } catch (error) {
    materialized.release();
    throw error;
  }

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
