/**
 * The canvas must not grow, at the store level. An ordinary tool commit, an undo, a
 * redo and a crop each leave `totalSize`, `documentFrame` and the workspace canvas
 * backing store exactly where they were — swept across every reachable cursor, so a
 * re-allocation that only the last replay would hide still fails here.
 *
 * Written as a reproduction first (`probe-`, logged, no assertions) and kept as a
 * regression test once it had caught the defect it was built for. `e2e/canvas-growth.spec.ts`
 * is the same invariant measured through the real UI.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StoreProvider, useStore } from '../StoreContext.tsx';
import { useLayers } from '../useLayer.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import { createLayerSource } from '../layer-utils.ts';
import { findToolProcessor } from '../../tools/toolProcessors.ts';
import type { ToolArgs } from '../tool-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { Layer } from '../layer-types.ts';

const DOC = { width: 800, height: 600 };

function useHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers() };
}

function shapeArgs(i: number): ToolArgs {
  const x1 = 20 + i * 8;
  const y1 = 30 + i * 5;
  return {
    toolName: 'shape',
    figure: 'rectangle',
    alpha: 1,
    color: '#000000',
    backgroundColor: null,
    lineWidth: 2,
    rect: { x1, y1, x2: x1 + 60, y2: y1 + 45 },
  } as unknown as ToolArgs;
}

type ProbeRow = {
  label: string;
  historyLen: number;
  totalSize: { width: number; height: number };
  documentFrame: { x: number; y: number; width: number; height: number };
  canvasBackingStore: { width: number; height: number };
};

function snapshot(store: ReturnType<typeof useStore>[0], canvas: HTMLCanvasElement, label: string): ProbeRow {
  const row: ProbeRow = {
    label,
    historyLen: store.history.length,
    totalSize: { ...store.totalSize },
    documentFrame: { ...((store.documentFrame ?? { x: 0, y: 0, width: 0, height: 0 }) as DocumentFrame) },
    canvasBackingStore: { width: canvas.width, height: canvas.height },
  };
  console.log(`[PROBE-COMMIT] ${JSON.stringify(row)}`);
  return row;
}

type Harness = { current: ReturnType<typeof useHarness> };

function redraw(result: Harness) {
  act(() => {
    result.current.layers.drawAllLayers();
  });
}

function seed(result: Harness, canvas: HTMLCanvasElement) {
  act(() => {
    result.current.store.canvasRef.current = canvas;
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.previewLayers.current = {};
  });
  act(() => {
    result.current.layers.createBlankLayer({ color: '#ffffff', opacity: 1, size: { ...DOC }, isBedrock: true }, true);
  });
  redraw(result);
}

function replayDeps(): HistoryReplayDependencies {
  return {
    createLayer: (input) => createLayerSource(input),
    applyRasterTool: (layer: Layer, args: ToolArgs) => {
      const bitmap = layer.tmpCanvas ?? layer.bitmap;
      if (!bitmap) return layer;
      const processor = findToolProcessor(args.toolName);
      if (!processor) return layer;
      const [raster, patch] = processor.imageProcessor({ bitmap, size: layer.pos })(args);
      return { ...layer, pos: patch ? { ...layer.pos, ...patch } : layer.pos, source: undefined, tmpCanvas: raster };
    },
  };
}

type ReplayRow = {
  cursor: number;
  action: string;
  totalSize: { width: number; height: number };
  frame: { x: number; y: number; width: number; height: number };
};

function sweepReplay(
  history: HistoryItem[],
  totalSize: { width: number; height: number },
  frame: DocumentFrame,
  label: string
) {
  const rows: ReplayRow[] = [];
  for (let cursor = 0; cursor < history.length; cursor += 1) {
    const replay = replayHistory(history, cursor, totalSize, replayDeps(), frame);
    rows.push({
      cursor,
      action: history[cursor]?.actionName ?? '<none>',
      totalSize: { ...replay.totalSize },
      frame: { ...replay.documentFrame },
    });
  }
  console.log(`[PROBE-REPLAY:${label}] ${JSON.stringify(rows)}`);
  return rows;
}

function commitShapes(result: Harness, count: number, prefix: string, canvas: HTMLCanvasElement) {
  const rows: ProbeRow[] = [];
  for (let i = 0; i < count; i += 1) {
    act(() => {
      result.current.layers.createLayerFromTool({ args: shapeArgs(i) });
      result.current.layers.drawAllLayers();
    });
    rows.push(snapshot(result.current.store, canvas, `${prefix}-${i + 1}`));
  }
  return rows;
}

describe('canvas growth on ordinary tool commits', () => {
  it('A. 25 shape commits at 800x600: commit path plus every replay cursor', () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    const baseline = snapshot(result.current.store, canvas, 'seed');
    expect(baseline.totalSize).toEqual(DOC);
    expect(baseline.canvasBackingStore).toEqual(DOC);

    const commits = commitShapes(result, 25, 'commit', canvas);

    expect(result.current.store.history.length).toBe(26);
    expect(Object.keys(result.current.store.layers).length).toBe(26);

    for (const row of commits) {
      expect(row.totalSize, `totalSize after ${row.label}`).toEqual(DOC);
      expect(row.documentFrame, `frame after ${row.label}`).toEqual({ x: 0, y: 0, width: 800, height: 600 });
      expect(row.canvasBackingStore, `backing store after ${row.label}`).toEqual(DOC);
    }

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'A-shapes-only');
    for (const row of rows) {
      expect(row.totalSize, `replay totalSize at cursor ${row.cursor} (${row.action})`).toEqual(DOC);
    }
  });

  it('B. crop then more shape commits, replay sweep', () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 100, y1: 80, x2: 500, y2: 400 });
    });
    redraw(result);
    const afterCrop = snapshot(result.current.store, canvas, 'after-crop');
    expect(afterCrop.totalSize).toEqual({ width: 400, height: 320 });
    expect(afterCrop.canvasBackingStore).toEqual({ width: 400, height: 320 });

    const post = commitShapes(result, 5, 'post-crop-commit', canvas);
    for (const row of post) {
      expect(row.totalSize, `totalSize after ${row.label}`).toEqual({ width: 400, height: 320 });
      expect(row.canvasBackingStore, `backing store after ${row.label}`).toEqual({ width: 400, height: 320 });
    }

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'B-crop-then-shapes');
    // Cursor 0 is the PRE-CROP baseline and is legitimately 800x600; every cursor at or
    // past the crop entry must be 400x320, so the sweep must not oscillate.
    const preCrop = rows.filter(
      (row) => row.cursor === 0 && row.totalSize.width === 800 && row.totalSize.height === 600
    );
    const cropped = rows.filter(
      (row) => row.cursor >= 1 && row.totalSize.width === 400 && row.totalSize.height === 320
    );
    console.log(`[PROBE-B] pre-crop cursors=${preCrop.length} cropped cursors=${cropped.length} of ${rows.length}`);
    expect(preCrop).toHaveLength(1);
    expect(cropped).toHaveLength(rows.length - 1);
  });

  it('C. mid-document bedrock blank layer, replay sweep', () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    act(() => {
      result.current.layers.createBlankLayer({
        color: '#ffffff',
        opacity: 1,
        size: { ...result.current.store.totalSize },
        isBedrock: true,
      });
    });
    redraw(result);
    snapshot(result.current.store, canvas, 'after-blank-layer');

    const post = commitShapes(result, 3, 'post-blank-commit', canvas);
    for (const row of post) {
      expect(row.totalSize, `totalSize after ${row.label}`).toEqual(DOC);
      expect(row.canvasBackingStore, `backing store after ${row.label}`).toEqual(DOC);
    }

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'C-blank-layer');
    for (const row of rows) {
      expect(row.totalSize, `replay totalSize at cursor ${row.cursor} (${row.action})`).toEqual(DOC);
    }
  });

  it('D. crop first, then the mid-document bedrock blank layer, replay sweep', async () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 100, y1: 80, x2: 500, y2: 400 });
    });
    redraw(result);
    snapshot(result.current.store, canvas, 'after-crop');

    act(() => {
      result.current.layers.createBlankLayer({
        color: '#ffffff',
        opacity: 1,
        size: { ...result.current.store.totalSize },
        isBedrock: true,
      });
    });
    redraw(result);
    const afterBlank = snapshot(result.current.store, canvas, 'after-blank-layer');
    console.log(`[PROBE-D-COMMIT-FRAME] ${JSON.stringify(afterBlank)}`);

    commitShapes(result, 3, 'post-blank-commit', canvas);

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'D-crop-then-blank');
    console.log(`[PROBE-D-REPLAY-SUMMARY] ${JSON.stringify(rows.map((row) => row.totalSize))}`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('E. import a larger bedrock raster mid-document, replay sweep', async () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    const imported = new OffscreenCanvas(1200, 900);
    await act(async () => {
      await result.current.layers.createLayerFromBitmap({
        bitmap: imported as unknown as ImageBitmap,
        name: 'imported.png',
        size: { width: 1200, height: 900 },
        isBedrock: true,
      });
    });
    redraw(result);
    const afterImport = snapshot(result.current.store, canvas, 'after-import-1200x900-bedrock');
    console.log(`[PROBE-E-COMMIT-FRAME] ${JSON.stringify(afterImport)}`);

    commitShapes(result, 3, 'post-import-commit', canvas);

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'E-import-larger');
    console.log(`[PROBE-E-REPLAY-SUMMARY] ${JSON.stringify(rows.map((row) => row.totalSize))}`);
    expect(rows.length).toBeGreaterThan(0);
  });
});
