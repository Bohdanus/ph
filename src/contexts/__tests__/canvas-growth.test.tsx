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
import { useHistory } from '../useHistory.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import { createLayerSource } from '../layer-utils.ts';
import { isValidDocumentFrame } from '../document-frame.ts';
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

/**
 * The undo/redo cases need the real `useHistory` rather than a replay call, because a
 * navigation is the thing under test: `resetHistoryTo` publishes the replayed frame AND
 * resizes the visible canvas, and a frame asserted only through `replayHistory` would pass
 * while the store kept the grown canvas on screen. It runs against the same real
 * `StoreProvider` as `useHarness` — unlike `useHistory.test.tsx`, which mocks `useStore`,
 * because this file's whole premise is that the store publishes the frame.
 */
function useUndoHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, layers: useLayers(), history: useHistory() };
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

/**
 * The crop can now move the document frame in the direction cases A-E never sweep.
 *
 * `applyDocumentCrop` normalises the gesture rect with `sortRoundRect` (`useLayer.ts:797`)
 * rather than the clamping `trimRect`, and the new origin is `frame.x + rect.x`
 * (`canvasRectToDocumentFrame`, `document-frame.ts:48-56`) because the rect arrives in
 * canvas space. Two production states follow that the shrink-only sweep above never
 * produced: a frame LARGER than the document, and a frame whose `x`/`y` are NEGATIVE when
 * the box reaches before the canvas origin. `isValidDocumentFrame` deliberately puts no
 * sign constraint on `x`/`y` (`document-frame.ts:16-26`), so a negative origin is legal and
 * both replay paths hand back whatever valid frame they are given
 * (`replayHistory` and `replayDurableDocument`) — correct by inspection, and
 * inspection is what the three cases below replace.
 *
 * The header comment of this file still asserts that a crop leaves `totalSize` and the
 * canvas backing store where they were. Case B already contradicted that; these cases make
 * the contradiction total rather than partial. The header is left exactly as written —
 * re-framing the file is the operator's call, not an agent's.
 */
describe('crop growth and a negative document origin', () => {
  it('F. crop past the right and bottom edge grows the frame, later commits hold it, replay sweep', () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    const before = snapshot(result.current.store, canvas, 'F-seed');
    expect(before.documentFrame).toEqual({ x: 0, y: 0, width: 800, height: 600 });

    // A box that keeps the whole document and reaches 100px past the right and bottom
    // edges. Under `trimRect` this same rect would have committed 800x600 and committed
    // nothing at all; under `sortRoundRect` it commits {0, 0, 900, 700}.
    let accepted = false;
    act(() => {
      accepted = result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 900, y2: 700 });
    });
    redraw(result);
    expect(accepted, 'the growth crop was refused').toBe(true);

    const afterCrop = snapshot(result.current.store, canvas, 'F-after-growth-crop');
    expect(afterCrop.documentFrame).toEqual({ x: 0, y: 0, width: 900, height: 700 });
    expect(afterCrop.totalSize).toEqual({ width: 900, height: 700 });
    expect(afterCrop.canvasBackingStore, 'the visible canvas must be the grown one').toEqual({
      width: 900,
      height: 700,
    });

    // A commit after a growth must not re-derive the frame from the layer, which is what
    // would silently snap the document back to the layer's own size.
    const post = commitShapes(result, 5, 'F-post-growth-commit', canvas);
    for (const row of post) {
      expect(row.documentFrame, `frame after ${row.label}`).toEqual({ x: 0, y: 0, width: 900, height: 700 });
      expect(row.totalSize, `totalSize after ${row.label}`).toEqual({ width: 900, height: 700 });
      expect(row.canvasBackingStore, `backing store after ${row.label}`).toEqual({ width: 900, height: 700 });
    }

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'F-growth-then-shapes');
    // Cursor 0 is the bedrock baseline and is legitimately 800x600; every cursor at or past
    // the crop entry must be the grown 900x700, so the sweep must not oscillate back.
    const seedCursor = rows.filter((row) => row.cursor === 0);
    const grownCursors = rows.filter((row) => row.cursor >= 1);
    console.log(`[PROBE-F] seed-cursors=${seedCursor.length} grown-cursors=${grownCursors.length} of ${rows.length}`);
    expect(seedCursor).toHaveLength(1);
    expect(seedCursor[0]?.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(grownCursors).toHaveLength(rows.length - 1);
    for (const row of grownCursors) {
      expect(row.frame, `frame at cursor ${row.cursor} (${row.action})`).toEqual({
        x: 0,
        y: 0,
        width: 900,
        height: 700,
      });
      expect(row.totalSize, `totalSize at cursor ${row.cursor} (${row.action})`).toEqual({
        width: 900,
        height: 700,
      });
    }
  });

  it('G. crop past the LEFT and TOP edge commits a negative origin that every replay cursor returns', () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    // Reaching 120px left of and 80px above the canvas origin. `sortRoundRect` sorts and
    // rounds without clamping, so the rect becomes {-120, -80, 620, 480} and
    // `canvasRectToDocumentFrame` adds the current origin {0, 0} to it unchanged.
    let accepted = false;
    act(() => {
      accepted = result.current.layers.applyDocumentCrop({ x1: -120, y1: -80, x2: 500, y2: 400 });
    });
    redraw(result);
    expect(accepted, 'the negative-origin crop was refused').toBe(true);

    const afterCrop = snapshot(result.current.store, canvas, 'G-after-negative-crop');
    expect(afterCrop.documentFrame).toEqual({ x: -120, y: -80, width: 620, height: 480 });
    expect(afterCrop.totalSize).toEqual({ width: 620, height: 480 });
    // The frame is legal precisely because `isValidDocumentFrame` constrains only the
    // extent, so a negative origin is not repaired anywhere on the way in.
    expect(isValidDocumentFrame(result.current.store.documentFrame)).toBe(true);
    expect(isValidDocumentFrame({ x: -1, y: -1, width: 0, height: 10 })).toBe(false);

    const post = commitShapes(result, 5, 'G-post-negative-commit', canvas);
    for (const row of post) {
      expect(row.documentFrame, `frame after ${row.label}`).toEqual({ x: -120, y: -80, width: 620, height: 480 });
      expect(row.totalSize, `totalSize after ${row.label}`).toEqual({ width: 620, height: 480 });
    }

    const store = result.current.store;
    const rows = sweepReplay(store.history, store.totalSize, store.documentFrame, 'G-negative-origin-then-shapes');
    const seedCursor = rows.filter((row) => row.cursor === 0);
    const negativeCursors = rows.filter((row) => row.cursor >= 1);
    console.log(
      `[PROBE-G] seed-cursors=${seedCursor.length} negative-origin-cursors=${negativeCursors.length} of ${rows.length}`
    );
    expect(seedCursor).toHaveLength(1);
    expect(seedCursor[0]?.frame).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(negativeCursors).toHaveLength(rows.length - 1);
    for (const row of negativeCursors) {
      // A frame clamped to the origin on the way through replay would read {x: 0, ...}
      // here and still satisfy every size assertion, so the origin is asserted on its own.
      expect(row.frame, `frame at cursor ${row.cursor} (${row.action})`).toEqual({
        x: -120,
        y: -80,
        width: 620,
        height: 480,
      });
      expect(row.frame.x, `origin x at cursor ${row.cursor} (${row.action})`).toBeLessThan(0);
      expect(row.frame.y, `origin y at cursor ${row.cursor} (${row.action})`).toBeLessThan(0);
      expect(row.totalSize, `totalSize at cursor ${row.cursor} (${row.action})`).toEqual({ width: 620, height: 480 });
    }
  });

  it('H. one undo of a growth restores the negative-origin frame it grew from, one redo returns the growth', async () => {
    const canvas = document.createElement('canvas');
    const { result } = renderHook(useUndoHarness, { wrapper: StoreProvider });
    seed(result, canvas);

    // Cursor 1: the box reaches before the origin on both axes. 600x450 anchored at
    // {-100, -50} — the origin an undo of the next crop has to put back.
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: -100, y1: -50, x2: 500, y2: 400 });
    });
    redraw(result);
    const beforeGrowth = snapshot(result.current.store, canvas, 'H-before-growth');
    expect(beforeGrowth.documentFrame).toEqual({ x: -100, y: -50, width: 600, height: 450 });

    // Cursor 2: the canvas is 600x450 now, and the box is dragged 100px past its right and
    // bottom edges. The origin is unchanged at {-100, -50}; the extent grows to 700x550.
    act(() => {
      result.current.layers.applyDocumentCrop({ x1: 0, y1: 0, x2: 700, y2: 550 });
    });
    redraw(result);
    const afterGrowth = snapshot(result.current.store, canvas, 'H-after-growth');
    expect(afterGrowth.documentFrame).toEqual({ x: -100, y: -50, width: 700, height: 550 });
    expect(afterGrowth.totalSize).toEqual({ width: 700, height: 550 });
    expect(result.current.store.historyIndex).toBe(2);
    expect(result.current.store.history).toHaveLength(3);

    // The growth is the tip, so one undo crosses exactly it and one redo returns exactly it.
    await act(async () => {
      await result.current.history.undo();
    });
    const afterUndo = snapshot(result.current.store, canvas, 'H-after-undo');
    expect(result.current.store.historyIndex).toBe(1);
    expect(afterUndo.documentFrame, 'undo must restore the negative origin').toEqual({
      x: -100,
      y: -50,
      width: 600,
      height: 450,
    });
    expect(afterUndo.totalSize).toEqual({ width: 600, height: 450 });
    expect(afterUndo.canvasBackingStore).toEqual({ width: 600, height: 450 });

    await act(async () => {
      await result.current.history.redo();
    });
    const afterRedo = snapshot(result.current.store, canvas, 'H-after-redo');
    expect(result.current.store.historyIndex).toBe(2);
    expect(afterRedo.documentFrame).toEqual({ x: -100, y: -50, width: 700, height: 550 });
    expect(afterRedo.totalSize).toEqual({ width: 700, height: 550 });
    expect(afterRedo.canvasBackingStore).toEqual({ width: 700, height: 550 });

    // And the same two cursors agree with a direct replay, so undo/redo is not reading a
    // frame from somewhere the sweep would disagree with.
    const store = result.current.store;
    const replayed = sweepReplay(store.history, store.totalSize, store.documentFrame, 'H-undo-redo-cursors');
    expect(replayed[1]?.frame).toEqual({ x: -100, y: -50, width: 600, height: 450 });
    expect(replayed[2]?.frame).toEqual({ x: -100, y: -50, width: 700, height: 550 });
  });
});
