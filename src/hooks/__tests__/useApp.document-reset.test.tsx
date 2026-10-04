import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreProvider, useStore } from '../../contexts/StoreContext.tsx';
import { useHistory } from '../../contexts/useHistory.ts';
import { useApp } from '../useApp.ts';
import { createHistoryItem } from '../../contexts/history-utils.ts';
import { documentFrameFromSize, documentFrameSize } from '../../contexts/document-frame.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';
import { resizeCanvas } from '../../util/canvas.ts';
import { selectionSnapshot } from '../../contexts/selection-baseline.ts';
import { legacyHistoryToDurable } from '../../contexts/history-adapter.ts';
import { getAssetRegistry } from '../../contexts/asset-registry.ts';
import type { DurableDocument } from '../../contexts/history-model.ts';
import type { Layer, LayersRecord } from '../../contexts/layer-types.ts';
import type { Selection, SelectionClipboard, Size } from '../../contexts/general-types.ts';
import type { NewDocumentBlankParams } from '../../contexts/tool-types.ts';
import type { PsdDocument } from '../../contexts/psd-utils.ts';

/**
 * "Creating or opening a document kills the outgoing document's history and layers."
 *
 * WHAT THIS FILE IS NOT. Two existing suites already prove part of this, and claiming otherwise
 * would send the next session looking for a gap that is already closed:
 * `e2e/history-panel.spec.ts:131` strokes in document 1, proves the timeline is non-empty and undo
 * enabled, then does File > New and asserts 0 draw rows, 1 history row, undo AND redo disabled and
 * the old pixels gone; and `useLayer.creation.test.tsx:162` seeds a stale layer and asserts the blank
 * path leaves exactly one. `e2e/file-roundtrip.spec.ts` asserts pixels only — no undo, redo, or
 * history assertion at all — so the OPEN path is genuinely uncovered.
 *
 * So this file is the unit-level counterpart for what those miss: the open path, every selection
 * field, the clipboard, the durable shadow and its cursor, the `REPLACE_DOCUMENT` fast path, and the
 * two negative controls (a declined import and a failed decode must kill NOTHING — without them an
 * implementation that cleared the document before asking would pass every positive case).
 *
 * `useHistory` publishes a replay to the canvas before it dispatches, so a real
 * draw would be the only thing standing between a green test and an unhandled
 * rejection. Stubbed to a success, the boundary this file pins stays the
 * document's identity, not jsdom's canvas.
 *
 * `vitest.config.ts` sets `clearMocks: true`, which clears CALLS and leaves this
 * implementation in place — verified, because if it were stripped `resetHistoryTo`
 * would silently take its `catch` branch (`useHistory.ts:131-143`) and the tests
 * that drive a replay would assert nothing about replay at all.
 */
const drawLayersToCanvas = vi.hoisted(() => vi.fn(() => true));

vi.mock('../../contexts/layer-renderer.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../contexts/layer-renderer.ts')>();
  return { ...actual, drawLayersToCanvas };
});

const PREVIOUS_SIZE = { width: 800, height: 600 };
const OUTGOING_LAYER_IDS = ['old-1', 'old-2', 'old-3'] as const;
const OUTGOING_DELETED_ID = 'old-4';
const OUTGOING_DOCUMENT_ID = 'outgoing-document';
const OUTGOING_SELECTION_ID = 'old-selection';

function blankSource(width: number, height: number) {
  return {
    kind: 'blank',
    color: '#ffffff',
    opacity: 1,
    pos: { x: 0, y: 0, width, height },
    isBedrock: false,
  } as const;
}

function makeLayer(id: string, order: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: { width: 40, height: 20 } as ImageBitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: 0, y: 0, width: 40, height: 20 },
    operations: [],
    // A typed source whose geometry MATCHES `pos`. A fixture whose durable
    // snapshot contradicted its runtime `pos` would be pinning a shape the real
    // import path cannot produce — the divergence class HANDOFF §91/§92 is about.
    source: blankSource(40, 20),
    ...overrides,
  } as Layer;
}

/**
 * A real, committed selection in the outgoing document.
 *
 * The seed MUST populate every field the kill assertions demand to be empty. A
 * document seeded with `selections: []` satisfies `expect(store.selections).toEqual([])`
 * before any production code runs, so dropping `selections: []` from either
 * document-creation payload leaves the suite green — the outgoing document's
 * selection would be inherited by the new one, one paste away from depositing the
 * previous document's pixels, and nothing would fail.
 */
const OUTGOING_SELECTION: Selection = {
  id: OUTGOING_SELECTION_ID,
  points: [
    { x: 4, y: 4 },
    { x: 12, y: 4 },
    { x: 12, y: 12 },
  ],
  isActive: true,
  pos: { x: 4, y: 4, width: 8, height: 8 },
  lifecycle: 'committed',
};

const OUTGOING_CLIPBOARD: SelectionClipboard = {
  bitmap: { width: 8, height: 8 } as ImageBitmap,
  copiedAt: 3,
  name: 'Copied selection',
  pos: { x: 4, y: 4, width: 8, height: 8 },
  sourceSelectionId: OUTGOING_SELECTION_ID,
};

/** A fresh object graph per seed, so a production path that mutates a published layer in place cannot corrupt a later test's fixture. */
function makeOutgoingLayers(): LayersRecord {
  return {
    'old-1': makeLayer('old-1', 0),
    'old-2': makeLayer('old-2', 1),
    'old-3': makeLayer('old-3', 2),
  };
}

/**
 * Three history entries, of which the first carries the `documentSource` shape the
 * PSD import writes (`useApp.ts:120-125`) so the seeded document has a real durable
 * baseline rather than an empty one. The `previousSelectionState` below is NOT what
 * carries the seeded selection: `deriveSelectionBaseline` reads it only from
 * `SELECTION_ACTION` entries (`selection-baseline.ts:57`), and this entry is an
 * `OPEN_DOCUMENT_ACTION`, so nothing reads it. It is kept because the durable entry
 * shape carries the field, and the seed re-establishes the selection by dispatch
 * instead — see `seedOutgoingDocument`.
 */
function makeOutgoingHistory(layers: LayersRecord) {
  return [
    createHistoryItem({
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'old-1',
      documentSource: {
        layers,
        size: { ...PREVIOUS_SIZE },
        frame: documentFrameFromSize(PREVIOUS_SIZE),
      },
      args: { previousSelectionState: selectionSnapshot([OUTGOING_SELECTION], OUTGOING_SELECTION_ID) },
    }),
    createHistoryItem({
      actionName: NEW_LAYER_ACTION,
      layerId: 'old-2',
      layerSource: blankSource(40, 20),
    }),
    createHistoryItem({
      actionName: NEW_LAYER_ACTION,
      layerId: 'old-3',
      layerSource: blankSource(40, 20),
    }),
  ];
}

function useDocumentHarness() {
  const [store, dispatch] = useStore();
  return { store, dispatch, app: useApp(), history: useHistory() };
}

type Harness = ReturnType<typeof useDocumentHarness>;
type Result = { current: Harness };

/**
 * The real `StoreProvider`, not a mocked `useStore`.
 *
 * `useApp.image-upload.test.ts` and `useApp.psd.test.ts` mock the store, so every
 * assertion they make is about the SHAPE of a dispatched payload. The provider also
 * owns the `REPLACE_DOCUMENT` fast path (`StoreContext.tsx:1064`), which bypasses the
 * reducer and pre-writes `latestStateRef` — the value the NEXT dispatch in the same
 * batch reads as its `currentState`.
 */
function setup() {
  const { result } = renderHook(useDocumentHarness, { wrapper: StoreProvider });
  act(() => {
    result.current.store.canvasRef.current = document.createElement('canvas');
    result.current.store.toolOverlayRef.current = document.createElement('canvas');
    result.current.store.rectOverlayRef.current = document.createElement('canvas');
  });
  return result;
}

/**
 * An outgoing document that is undoable AND redoable, with a non-zero branch
 * revision, reached only through production paths:
 *
 * - `REPLACE_DOCUMENT` seeds the document with its cursor parked mid-timeline, so the
 *   REDO TAIL is real. A seed with the cursor at the end would pass a kill-history
 *   assertion against an implementation that merely appended — an append truncates
 *   the tail — and would leave the tail itself untested.
 * - `COMMIT_DOCUMENT_EDIT` then makes `branchRevision` non-zero, which is the only way
 *   to observe that a new document RESETS it rather than inheriting it.
 * - `resetHistoryTo` returns the cursor to mid-timeline, so both `canUndo()` and
 *   `canRedo()` are true in the precondition.
 */
async function seedOutgoingDocument(result: Result) {
  const layers = makeOutgoingLayers();
  const history = makeOutgoingHistory(layers);
  act(() => {
    result.current.dispatch({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId: OUTGOING_DOCUMENT_ID,
        history,
        // At the TIP, because the commit below APPENDS: `updateHistoryTimeline`
        // truncates any redo tail first (`history-timeline.ts:31-32`). Seeding the
        // cursor mid-timeline here would have the commit discard entries 1 and 2, and
        // the document would arrive with no redo tail at all.
        historyIndex: history.length - 1,
        updates: {
          layers,
          activeLayerId: 'old-3',
          deletedLayers: { [OUTGOING_DELETED_ID]: makeLayer(OUTGOING_DELETED_ID, 3) },
          totalSize: { ...PREVIOUS_SIZE },
          documentFrame: documentFrameFromSize(PREVIOUS_SIZE),
          hasImage: true,
          hasUnsavedChanges: true,
          fileName: 'outgoing.psd',
          selections: [OUTGOING_SELECTION],
          activeSelectionId: OUTGOING_SELECTION_ID,
          selectionDraft: OUTGOING_DRAFT,
          selectionCleared: OUTGOING_CLEARED,
          selectionClipboard: OUTGOING_CLIPBOARD,
        },
      },
    });
    result.current.dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { hasUnsavedChanges: true },
        historyItem: createHistoryItem({
          actionName: NEW_LAYER_ACTION,
          layerId: 'old-1',
          layerSource: blankSource(40, 20),
        }),
      },
    });
  });
  // A SEPARATE `act`, because `resetHistoryTo` reads `history`/`historyIndex` from
  // the hook's closure: called in the same block as the dispatches it would act on
  // the pre-seed render's state rather than the seeded one.
  await act(async () => {
    await result.current.history.resetHistoryTo(1);
  });
  // The selection fields are re-established AFTER the replay, because
  // `APPLY_HISTORY_REPLAY` replaces them with the timeline's own derivation — and a
  // document whose only selection evidence is a `documentSource` baseline has none.
  // Without this the seed would arrive with `selections: []`, which is the very state
  // the kill assertions demand, and clearing the field in production would go unnoticed.
  act(() => {
    result.current.dispatch({
      type: 'BATCH_UPDATES',
      payload: {
        selections: [OUTGOING_SELECTION],
        activeSelectionId: OUTGOING_SELECTION_ID,
        selectionDraft: OUTGOING_DRAFT,
        selectionCleared: OUTGOING_CLEARED,
        selectionClipboard: OUTGOING_CLIPBOARD,
      },
    });
  });

  // The seeded document's own composition. `drawLayersToCanvas` sizes the workspace canvas to
  // the document frame's extent, and this harness never runs it — so without this the canvas
  // stays at jsdom's default 300x150 whatever the document is, and every canvas assertion in
  // `expectOutgoingDocumentIntact` is red for EVERY implementation, correct or defective.
  // Verified by deleting this line: both cases that call the helper then fail on
  // `{ width: 300, height: 150 }` against the seeded `{ width: 800, height: 600 }`.
  act(() => {
    resizeCanvas(result.current.store.canvasRef.current!, PREVIOUS_SIZE.width, PREVIOUS_SIZE.height);
  });

  const { store, history: nav } = result.current;
  outgoingHistoryIds = store.history.map((item) => item.id);
  outgoingBranchRevision = store.branchRevision;
  outgoingDocumentRevision = store.documentRevision;
  outgoingHistoryIndex = store.historyIndex;
  if (!nav.canUndo() || !nav.canRedo() || store.branchRevision === 0) {
    throw new Error(
      `seed precondition failed: canUndo=${nav.canUndo()} canRedo=${nav.canRedo()} branchRevision=${store.branchRevision}`
    );
  }
}

/**
 * Every layer id the durable shadow names, from its baseline and from every operation
 * arm. Written as an exhaustive `switch` rather than a structural walk so that a NEW
 * `DurableOperation` variant is a type error here instead of a silent gap in coverage.
 */
function durableLayerIds(durable: DurableDocument): string[] {
  const ids = new Set(durable.baseline.layers.map((layer) => layer.id));
  for (const entry of durable.history) {
    const operation = entry.operation;
    switch (operation.kind) {
      case 'create-layer':
        ids.add(operation.layer.id);
        break;
      case 'remove-layer':
      case 'set-layer-properties':
      case 'reposition-layer':
      case 'replace-layer-source':
      case 'apply-filter':
      case 'apply-affine-transform':
      case 'apply-raster-processor':
        ids.add(operation.layerId);
        break;
      case 'merge-document':
        ids.add(operation.result.id);
        for (const removedId of operation.removedLayerIds) ids.add(removedId);
        break;
      case 'reorder-layers':
        for (const layerId of Object.keys(operation.orderByLayerId)) ids.add(layerId);
        break;
      case 'set-document-frame':
      case 'set-selection':
        break;
      default: {
        const exhaustive: never = operation;
        throw new Error(`Unhandled durable operation: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  return [...ids].sort();
}

const OUTGOING_DRAFT = { status: 'draft', sourceTool: 'polygonal-lasso' } as const;
const OUTGOING_CLEARED = { status: 'cleared', version: 7 } as const;

/**
 * Everything the kill assertions compare against, captured by the seed. Comparing to a
 * captured value rather than to a literal is what makes those assertions independent of how
 * the fixture happens to be built: a literal would break four tests if the seed gained a
 * `REPLACE_DOCUMENT`, and `not.toBe(0)` would pass for 1, 2 or 99.
 */
let outgoingHistoryIds: string[] = [];
let outgoingBranchRevision = 0;
let outgoingDocumentRevision = 0;
let outgoingHistoryIndex = 0;

/**
 * The shared kill invariant.
 *
 * `history.length === 1` alone is the weakest form of it: it is equally true of a
 * document whose single entry IS the outgoing baseline, and of one whose cursor still
 * points into a surviving tail. So the surviving ids are checked too — a length
 * assertion cannot tell "one new entry" from "one old entry".
 */
function expectOutgoingDocumentKilled(result: Result) {
  const { store, history } = result.current;

  expect(store.history).toHaveLength(1);
  expect(store.historyIndex).toBe(0);
  expect(history.canUndo()).toBe(false);
  expect(history.canRedo()).toBe(false);
  // A new document is a new branch, not a continuation of the old one.
  expect(store.branchRevision).toBe(0);
  expect(store.documentRevision).toBe(outgoingDocumentRevision + 1);

  const survivingIds = store.history.map((item) => item.id);
  for (const outgoingId of outgoingHistoryIds) {
    expect(survivingIds).not.toContain(outgoingId);
  }

  for (const outgoingId of [...OUTGOING_LAYER_IDS, OUTGOING_DELETED_ID]) {
    expect(store.layers).not.toHaveProperty(outgoingId);
    expect(store.deletedLayers).not.toHaveProperty(outgoingId);
  }
  expect(store.deletedLayers).toEqual({});

  // The new document's OWN layer, not merely "not the outgoing one": a `null` here
  // would mean the replacement left no active layer at all, and a stale id would mean
  // it named a layer the new document does not have. `Object.keys(layers)[0]` is not
  // the answer — key order is insertion order, which is not layer order.
  expect(store.activeLayerId).toBeTruthy();
  expect(store.layers).toHaveProperty(store.activeLayerId as string);
  expect(store.selections).toEqual([]);
  expect(store.activeSelectionId).toBeNull();
  expect(store.selectionDraft).toEqual({ status: 'idle' });
  expect(store.selectionCleared).toBeNull();
  expect(store.selectionClipboard).toBeNull();

  expect(store.documentId).not.toBe(OUTGOING_DOCUMENT_ID);
}

const BLANK: NewDocumentBlankParams = {
  color: '#ffffff',
  opacity: 1,
  size: { width: 320, height: 240 },
  isBedrock: true,
};

const createImage = (width: number, height: number) =>
  ({ complete: true, height, naturalHeight: height, naturalWidth: width, src: '', width }) as HTMLImageElement;

/**
 * A layered import with one raster-backed layer, so the import arm's raster handling
 * and its follow-up raster adoption registration both run — the two steps a
 * single-layer raster open never exercises. `psd-vector`'s source geometry matches
 * its own `pos`, which `makeLayer`'s default would not.
 */
function createPsdDocument(warnings: string[] = []): PsdDocument {
  const raster = makeLayer('psd-raster', 0, {
    bitmap: { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
    pos: { x: 0, y: 0, width: 20, height: 30 },
    source: {
      kind: 'image',
      bitmap: { width: 20, height: 30, close: vi.fn() } as unknown as ImageBitmap,
      pos: { x: 0, y: 0, width: 20, height: 30 },
    },
  });
  const vector = makeLayer('psd-vector', 1, {
    bitmap: { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap,
    pos: { x: 0, y: 0, width: 10, height: 10 },
    source: blankSource(10, 10),
  });
  return {
    size: { width: 200, height: 150 },
    warnings,
    layers: { 'psd-raster': raster, 'psd-vector': vector },
  };
}

beforeEach(() => {
  drawLayersToCanvas.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the outgoing document fixture is one production could really have produced', () => {
  it('publishes a durable presentation cache after navigation without changing logical layers', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await waitFor(() => expect(result.current.store.layers['old-1'].tmpCanvas).not.toBeNull());
    expect(result.current.store.layers['old-1'].pos).toEqual({ x: 0, y: 0, width: 40, height: 20 });
    expect(result.current.store.historyIndex).toBe(1);
  });

  it('replays to every cursor with the same three layers, and starts with a live redo tail', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    outgoingHistoryIds = result.current.store.history.map((item) => item.id);

    // The precondition every kill assertion below rests on.
    expect(result.current.history.canUndo()).toBe(true);
    expect(result.current.history.canRedo()).toBe(true);
    expect(result.current.store.branchRevision).toBe(outgoingBranchRevision);
    expect(Object.keys(result.current.store.layers).sort()).toEqual([...OUTGOING_LAYER_IDS].sort());
    expect(result.current.store.durableDocument?.documentId).toBe(OUTGOING_DOCUMENT_ID);
    // The seeded timeline must convert CLEANLY. A shadow that is merely `'stale'` is
    // reached either way, so without this a timeline that converted with diagnostics
    // would satisfy every assertion in this file.
    expect(result.current.store.durableDiagnostics).toEqual([]);

    // Fixture validity. Every seeded entry must be REPLAYABLE, or the absence
    // assertions in the suites below would be pinning a document shape that cannot
    // occur: an entry the real paths never write would satisfy them for free.
    const entryCount = result.current.store.history.length;
    for (let index = 0; index < entryCount; index += 1) {
      await act(async () => {
        await result.current.history.resetHistoryTo(index);
      });
      // Read through `result.current` INSIDE the loop. `useDocumentHarness` returns a
      // fresh object literal per render and the provider builds a new state object per
      // transition, so a `store` captured before the loop is a frozen pre-loop
      // snapshot — the replays would run and the assertion would never see them.
      const replayed = result.current.store;
      expect(Object.keys(replayed.layers).sort()).toEqual([...OUTGOING_LAYER_IDS].sort());
      expect(replayed.historyIndex).toBe(index);
      // Layer IDS alone cannot tell a replayed entry from a skipped one: entry 0's
      // `documentSource` baseline already names all three layers, and `replayHistory`
      // `continue`s past a malformed entry. So discriminate on something only a
      // SUCCESSFUL replay of entry 1 sets. `replayHistory` CLONES the baseline layers,
      // keeping their `tmpCanvas: null`, whereas re-creating `old-2` through
      // `createLayerSource` allocates a real one (`layer-utils.ts:205-217`). So `old-2`
      // is null-backed at cursor 0 and canvas-backed from cursor 1 on — a `continue`
      // past entry 1 would leave it null at every cursor.
      if (index === 0) {
        expect(replayed.layers['old-2'].tmpCanvas).toBeNull();
      } else {
        expect(replayed.layers['old-2'].tmpCanvas).not.toBeNull();
      }
    }
  });
});

describe('creating a new image kills the outgoing document history and layers', () => {
  it('leaves nothing undoable or redoable and no outgoing state after setBlankImage', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    expect(result.current.history.canUndo()).toBe(true);
    expect(result.current.history.canRedo()).toBe(true);

    // `await act`, not `act`: `createLayerSource` gives a blank layer a real
    // `tmpCanvas`, so `requestPresentation` hands it to `promoteLayerPresentation`
    // and its `PROMOTE_LAYER_PRESENTATIONS` dispatch lands on a later microtask.
    await act(async () => {
      result.current.app.setBlankImage(BLANK);
    });

    expectOutgoingDocumentKilled(result);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.totalSize).toEqual({ width: 320, height: 240 });
    expect(result.current.store.hasImage).toBe(true);
  });

  it('drops the outgoing document frame rather than inheriting its size', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      result.current.app.setBlankImage(BLANK);
    });

    expect(result.current.store.documentFrame).toEqual({ x: 0, y: 0, width: 320, height: 240 });
  });

  it('leaves the store untouched when undo is pressed with nothing to undo', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      result.current.app.setBlankImage(BLANK);
    });

    // The kill lands the cursor at 0, so `undo()` returns at its own guard
    // (`useHistory.ts:51`) without reaching `resetHistoryTo`. What this pins is that
    // the guard is reached: a kill that left `historyIndex > 0` would replay instead.
    await act(async () => {
      await result.current.history.undo();
    });

    expectOutgoingDocumentKilled(result);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
  });

  it('replaces the durable shadow of the outgoing document', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    const outgoingDurable = result.current.store.durableDocument;
    expect(outgoingDurable?.documentId).toBe(OUTGOING_DOCUMENT_ID);
    expect(durableLayerIds(outgoingDurable!)).toEqual(expect.arrayContaining([...OUTGOING_LAYER_IDS]));

    await act(async () => {
      result.current.app.setBlankImage(BLANK);
    });

    const durable = result.current.store.durableDocument;
    expect(durable).not.toBeNull();
    expect(durable?.documentId).toBe(result.current.store.documentId);
    expect(durable?.documentId).not.toBe(OUTGOING_DOCUMENT_ID);
    // The shadow names exactly the new document's layers, and its cursor sits at its
    // own tip, so no outgoing id and no stale cursor position survives in the shadow.
    expect(durableLayerIds(durable!)).toEqual(Object.keys(result.current.store.layers).sort());
    expect(durable?.cursor).toBe(durable!.history.length - 1);
  });

  it('makes the next dispatch in the same batch extend the new document, not the outgoing one', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    const outgoingCount = result.current.store.history.length;

    // An append issued in the SAME `act()` as the replacement must extend the NEW
    // document's single entry. If the replacement published a stale timeline, the append
    // would extend the outgoing one instead and this count would be `outgoingCount + 1`.
    //
    // SCOPE, measured not assumed: this does NOT cover the `REPLACE_DOCUMENT` fast path
    // (`StoreContext.tsx:1085-1097`). That path writes `latestStateRef` and then calls
    // `rawDispatch`, so React state is recomputed by the reducer chain and never reflects
    // the pre-write. Every one of its seven lines — `documentFrame`, `totalSize`,
    // `documentId`, `documentRevision`, `branchRevision`, `history`, `historyIndex` —
    // survives mutating it in isolation; only the asset-disposal check at `:1082` is
    // observable, and `StoreContext.durable-boundary.test.tsx` covers that. Recorded as
    // `HANDOFF.md` §103.
    await act(async () => {
      result.current.app.setBlankImage(BLANK);
      result.current.dispatch({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: {
          updates: {},
          historyItem: createHistoryItem({
            actionName: NEW_LAYER_ACTION,
            layerId: 'after',
            layerSource: blankSource(8, 8),
          }),
        },
      });
    });

    // Appended to the NEW document's single entry, not to the outgoing timeline.
    expect(outgoingCount).toBe(outgoingHistoryIds.length);
    expect(result.current.store.history).toHaveLength(2);
    expect(result.current.store.historyIndex).toBe(1);
    expect(result.current.store.documentId).not.toBe(OUTGOING_DOCUMENT_ID);
    expect(result.current.store.documentRevision).toBe(outgoingDocumentRevision + 1);
    // The fast path also pre-writes `totalSize`/`documentFrame` from `nextFrame`
    // (`StoreContext.tsx:1088-1089`), and the append's `projectPublishedTimeline`
    // publishes them; a drift there is otherwise invisible to every assertion here.
    expect(result.current.store.totalSize).toEqual(BLANK.size);
  });

  it('kills the first new image when a second one is created', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      result.current.app.setBlankImage(BLANK);
    });
    const firstLayerId = result.current.store.activeLayerId as string;
    expect(result.current.store.totalSize).toEqual({ width: 320, height: 240 });

    await act(async () => {
      result.current.app.setBlankImage({ ...BLANK, size: { width: 100, height: 100 } });
    });

    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.activeLayerId).not.toBe(firstLayerId);
    expect(result.current.store.totalSize).toEqual({ width: 100, height: 100 });
  });

  /**
   * The blank arm's half of the ordering `opening an image kills the outgoing document history and
   * layers` pins for the raster arm. Both calls in `setBlankImage` are synchronous, so a resize
   * placed before the layer build is invisible to any event-order assertion — and there is no
   * forward tripwire to write either, because this harness never renders `Main`, so the store's
   * own render never runs and the canvas has exactly one writer. The failure path is therefore the
   * tripwire: `createLayerSource` refuses an extent that is not positive, and it throws from
   * INSIDE `createBlankLayer`. With the resize placed first, `expectOutgoingDocumentIntact`'s canvas
   * assertion sees the incoming extent; with it after, it sees the outgoing one.
   */
  it('leaves the canvas at the outgoing extent when the blank layer cannot be built', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    const intact = { history: [...result.current.store.history], layers: { ...result.current.store.layers } };

    expect(() => result.current.app.setBlankImage({ ...BLANK, size: { width: 0, height: 0 } })).toThrow(
      /width and height must be greater than 0/i
    );

    expectOutgoingDocumentIntact(result, intact);
  });
});

describe('opening an image kills the outgoing document history and layers', () => {
  it('leaves nothing undoable or redoable after opening a raster file', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      await result.current.app.setImageFromUpload({ fileName: 'photo.png', image: createImage(64, 48) });
    });

    expectOutgoingDocumentKilled(result);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
    expect(result.current.store.totalSize).toEqual({ width: 64, height: 48 });
    expect(result.current.store.fileName).toBe('photo.png');
  });

  it('leaves only the imported layers after opening a layered document', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      await result.current.app.setImageFromUpload({ fileName: 'design.psd', document: createPsdDocument() });
    });

    expectOutgoingDocumentKilled(result);
    expect(Object.keys(result.current.store.layers).sort()).toEqual(['psd-raster', 'psd-vector']);
    expect(result.current.store.fileName).toBe('design.psd');
    expect(result.current.store.totalSize).toEqual({ width: 200, height: 150 });
  });

  it('seeds the PSD baseline with the same document as a fresh whole-timeline conversion', async () => {
    const result = setup();

    await act(async () => {
      await result.current.app.setImageFromUpload({ fileName: 'design.psd', document: createPsdDocument() });
    });

    const store = result.current.store;
    const seeded = store.durableDocument;
    expect(seeded).not.toBeNull();

    const converted = legacyHistoryToDurable(store.history, {
      documentId: store.documentId,
      documentRevision: store.documentRevision,
      branchRevision: store.branchRevision,
      durableRevision: seeded!.durableRevision,
      registry: getAssetRegistry(),
    });

    expect(converted.diagnostics).toEqual([]);
    expect(seeded).toEqual(converted.document);
  });

  it('leaves the store untouched when undo is pressed with nothing to undo', async () => {
    const result = setup();
    await seedOutgoingDocument(result);

    await act(async () => {
      await result.current.app.setImageFromUpload({ fileName: 'photo.png', image: createImage(64, 48) });
    });

    await act(async () => {
      await result.current.history.undo();
    });

    expectOutgoingDocumentKilled(result);
    expect(Object.keys(result.current.store.layers)).toHaveLength(1);
  });

  /**
   * The negative control, and the reason the positive cases are worth anything: a
   * declined import must kill NOTHING. Without it, a `setImageFromUpload` that cleared
   * the document up front — before the `window.confirm` at `useApp.ts:86` — would pass
   * every test above while destroying the user's work on a cancellation.
   */
  it('kills nothing when the import limitations are declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const result = setup();
    await seedOutgoingDocument(result);
    const intact = { history: [...result.current.store.history], layers: { ...result.current.store.layers } };

    await act(async () => {
      await result.current.app.setImageFromUpload({
        fileName: 'design.psd',
        document: createPsdDocument(['Masks are unsupported']),
      });
    });

    expect(confirmSpy).toHaveBeenCalledOnce();
    expectOutgoingDocumentIntact(result, intact);
  });

  /**
   * The other negative control: a failure inside the import must also leave the document alone.
   * The raster arm used to resize the canvas BEFORE it built the layer, so this used to pin only
   * the store half of that sequence and name the canvas half as a separate defect. The canvas is
   * now sized after the replacement is published, and `expectOutgoingDocumentIntact` reads its
   * backing store, so this is the assertion that fails if the resize moves back ahead of the
   * layer build.
   */
  it('kills nothing when the import fails before the document is replaced', async () => {
    const result = setup();
    await seedOutgoingDocument(result);
    const intact = { history: [...result.current.store.history], layers: { ...result.current.store.layers } };
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed');
      })
    );

    await act(async () => {
      await expect(
        result.current.app.setImageFromUpload({ fileName: 'broken.png', image: createImage(64, 48) })
      ).rejects.toThrow('decode failed');
    });

    expectOutgoingDocumentIntact(result, intact);
  });
});

/** The inverse assertion for the two negative controls: the outgoing document survives whole. */
function expectOutgoingDocumentIntact(result: Result, snapshot: { history: unknown[]; layers: LayersRecord }) {
  const { store, history } = result.current;
  expect(store.history).toEqual(snapshot.history);
  expect(history.canUndo()).toBe(true);
  expect(history.canRedo()).toBe(true);
  expect(Object.keys(store.layers).sort()).toEqual(Object.keys(snapshot.layers).sort());
  expect(store.deletedLayers).toHaveProperty(OUTGOING_DELETED_ID);
  expect(store.documentId).toBe(OUTGOING_DOCUMENT_ID);
  expect(store.documentRevision).toBe(outgoingDocumentRevision);
  expect(store.branchRevision).toBe(outgoingBranchRevision);
  // A regression that moves the cursor without changing the entries passes a
  // history-equality check, and `resetHistoryTo` is exactly what moves it.
  expect(store.historyIndex).toBe(outgoingHistoryIndex);
  expect(store.selections).toEqual([OUTGOING_SELECTION]);
  expect(store.activeSelectionId).toBe(OUTGOING_SELECTION_ID);
  expect(store.selectionDraft).toEqual(OUTGOING_DRAFT);
  expect(store.selectionCleared).toEqual(OUTGOING_CLEARED);
  // Structural, not by reference: the point is that the document is unchanged, and a
  // future defensive clone in production would fail an identity check spuriously.
  expect(store.selectionClipboard).toEqual(OUTGOING_CLIPBOARD);
  expect(store.totalSize).toEqual(PREVIOUS_SIZE);
  // The canvas is a DOCUMENT surface: its backing store is the document frame's extent, and it
  // is what `drawLayersToCanvas` composes into. An import that fails partway must leave it at the
  // outgoing document's extent — a canvas resized to the incoming file's size is sized for a
  // document that was never adopted, so the retained one renders at the wrong scale while the
  // tool overlays keep the geometry they had. `handleImageCreate` sizes it from `params.size` on
  // the success path and nowhere else.
  expect(canvasExtent(result)).toEqual(documentFrameSize(documentFrameFromSize(PREVIOUS_SIZE)));
}

/** The workspace canvas's own backing-store extent, or `null` when no canvas is mounted. */
function canvasExtent(result: Result): Size | null {
  const canvas = result.current.store.canvasRef.current;
  return canvas ? { width: canvas.width, height: canvas.height } : null;
}
