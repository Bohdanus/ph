import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { AssetRegistry } from '../asset-registry.ts';
import { composeDurableDocument, type DurableComposite } from '../durable-compositor.ts';
import { replayDurableAtCursor, type DurableReplayResult } from '../durable-replay.ts';
import { renderExportCanvas } from '../export-canvas.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { createLayerSource } from '../layer-utils.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import type { Size } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { LayersRecord } from '../layer-types.ts';
import { durablePresentationIsRendererIdentical } from '../StoreContext.tsx';
import { useHistory } from '../useHistory.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import {
  installPixelCanvasElement,
  pixelHtmlCanvasContexts,
  filterAssignments,
  PixelContext as PixelContextClass,
  resetFilterAssignments,
  readPixelSource,
  resetUnresolvableDraws,
  stubPixelOffscreenCanvas,
  type PixelContext,
  unresolvableDraws,
} from '../../__tests__/fixtures/pixelCanvas.ts';
import {
  parityFrame,
  paritySize,
  rasterProcessorScenarios,
  replayParityScenarios,
  type ReplayParityScenario,
} from './history-replay.scenarios.ts';

/**
 * # The pixel differential — the load-bearing gate for the history cutover
 *
 * `history-replay.parity.test.ts` proves the two replay MODELS agree on ids, orders, names,
 * booleans and kind labels. It cannot see a colour: it normalises both sides away from pixels
 * and it stubs `applyRasterTool` to identity, so the whole raster half of both authorities is
 * outside its reach. This file is the other half — the same twelve scenarios at the same cursors
 * plus a thirteenth carrying a real raster processor, compared as BYTES.
 *
 * ## WHAT IS COMPARED, PER (SCENARIO, CURSOR)
 *
 * 1. **Runtime.** The legacy presentation `useHistory()` publishes to the visible canvas through
 *    `drawLayersToCanvas()`, against the durable composition `composeDurableDocument()` builds
 *    from `materializeDocument()`. Both are document-frame sized, so they are compared as one
 *    raster.
 * 2. **Export.** `renderExportCanvas()` on the legacy replay, against `renderExportCanvas()` on
 *    records built from the DURABLE side alone — `pos` from `materialized.bounds`, visibility,
 *    opacity, blend mode and order from the durable replay layer's own snapshot, `operations`
 *    empty because the retained presentation is already baked into the bitmap, and size and frame
 *    from the durable replay. An earlier version mounted durable bitmaps into the LEGACY records
 *    instead, and that axis could not fail: the only durable input was a `tmpCanvas` swap, every
 *    other field was the legacy value on both sides, and the accept predicate required
 *    `isEqual(bounds, existing.pos)` — so the bitmap was byte-identical to the legacy record's own
 *    and a 7px durable misplacement left this axis at zero differing bytes. `durableExportRecords()`
 *    is the rewrite, and it no longer depends on which layers
 *    `durablePresentationIsRendererIdentical()` happens to accept.
 *
 * Byte equality, with NO tolerance anywhere. A per-channel epsilon is how a wrong pixel survives
 * a green suite, and this file's whole purpose is to be the place that cannot be green by
 * admitting the wrong colour.
 *
 * ## WHAT IS REAL
 *
 * `useHistory()` is the production hook, not a re-implementation of it, so the legacy side runs
 * the real `replayHistory()`, the real `createLayerSource()`, and the real `applyRasterTool()`
 * closure — `stageProcessorInput()`, `findToolProcessor()`, `operationsRetainedAfterBake()` — that
 * `useHistory.ts` hands the replay. The durable side runs a real `AssetRegistry` (explicit, per
 * document, never the module singleton), the real `toolProcessors`, and the real materializer and
 * compositor. `src/test/setup.ts`'s `createImageBitmap` polyfill is DISABLED for this file: it
 * returns a carrier with `width`, `height` and `close` and no pixels, so with it in place
 * `toOwnedBitmap()` would hand every comparison a colourless bitmap and every axis would pass
 * against nothing. Without it `toOwnedBitmap()` returns the surface itself, which carries pixels.
 *
 * ## WHAT IS NOT REAL, AND THE PINS THAT SAY SO
 *
 * jsdom has no filter pipeline and no glyph rasteriser, so `PixelContext` records `ctx.filter`
 * and every path call without applying them. A comparison across either is a tautology, so those
 * scenarios carry an `it.fails` whose assertion is the thing jsdom cannot do. Every OTHER
 * mismatch — anything not named in one of those pins — is a hard failure.
 *
 * ## THE HISTORY-PANEL AXIS IS ABSENT ON PURPOSE
 *
 * RQ-4 names history-panel state, and there is no differential for it here. `HistoryTab.tsx`
 * reads `history` and `historyIndex` from the store and labels each row with
 * `getHistoryItemTitle()` — a function over a LEGACY `HistoryItem`, with no durable counterpart
 * anywhere in the tree. Deriving one would mean inventing the product's title for each durable
 * operation kind, which is a product decision, not a harness. The axis is therefore absent
 * because there is only one authority for it today, and adding it needs that ruling first.
 */

// --- the store `useHistory()` reads -------------------------------------------------------------------

const storeStateMock = vi.hoisted(() => ({
  canvasRef: { current: null as HTMLCanvasElement | null },
  history: [] as HistoryItem[],
  historyIndex: -1,
  layers: {} as LayersRecord,
  deletedLayers: {},
  activeLayerId: null as string | null,
  totalSize: { width: 400, height: 300 },
  documentFrame: null as { x: number; y: number; width: number; height: number } | null,
  branchRevision: 0,
  clearPreviewLayers: vi.fn(),
}));

const dispatchMock = vi.hoisted(() => vi.fn());

// `importOriginal` rather than a replacement: `durablePresentationIsRendererIdentical()` is
// exported from this module and is the mount's own accept/refuse rule. A replacement module
// would delete it and leave this file re-deriving the rule the mount uses, which is the one
// thing the mount axis must not do. Only `useStore` is replaced.
vi.mock('../StoreContext.tsx', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../StoreContext.tsx')>()),
  useStore: () => [storeStateMock, dispatchMock],
}));

// --- exact comparison ----------------------------------------------------------------------------------

type Raster = { data: Uint8ClampedArray; width: number; height: number };

type RasterDifference = {
  /** False when the two rasters are not the same shape at all, which is never a tolerance question. */
  comparable: boolean;
  extent: string;
  differing: number;
  firstIndex: number;
};

const compareRasters = (left: Raster, right: Raster): RasterDifference => {
  const extent = `${left.width}x${left.height} against ${right.width}x${right.height}`;
  if (left.width !== right.width || left.height !== right.height) {
    return { comparable: false, extent, differing: -1, firstIndex: -1 };
  }
  let differing = 0;
  let firstIndex = -1;
  for (let index = 0; index < left.data.length; index += 1) {
    if (left.data[index] === right.data[index]) continue;
    differing += 1;
    if (firstIndex < 0) firstIndex = index;
  }
  return { comparable: true, extent, differing, firstIndex };
};

const channelOf = (raster: Raster, index: number) => raster.data[index];
const tupleAt = (raster: Raster, index: number) =>
  [raster.data[index], raster.data[index + 1], raster.data[index + 2], raster.data[index + 3]] as const;

/** Names the first differing BYTE as a pixel coordinate and two RGBA tuples, so a failure is readable. */
const describeDifference = (left: Raster, right: Raster, difference: RasterDifference): string => {
  if (!difference.comparable) return `extents differ: ${difference.extent}`;
  if (difference.firstIndex < 0) return 'rasters are byte-identical';
  const pixel = Math.floor(difference.firstIndex / 4);
  const channel = difference.firstIndex % 4;
  const x = pixel % left.width;
  const y = Math.floor(pixel / left.width);
  return (
    `first difference at (${x}, ${y}) channel ${channel}: ` +
    `${channelOf(left, difference.firstIndex)} against ${channelOf(right, difference.firstIndex)}; ` +
    `legacy rgba ${tupleAt(left, pixel * 4).join(',')} durable rgba ${tupleAt(right, pixel * 4).join(',')}; ` +
    `${difference.differing} of ${left.data.length} bytes differ (${difference.extent})`
  );
};

const assertIdentical = (left: Raster, right: Raster, what: string): void => {
  const difference = compareRasters(left, right);
  expect(difference.comparable, `${what}: extents differ — ${difference.extent}`).toBe(true);
  expect(difference.differing, `${what}: ${describeDifference(left, right, difference)}`).toBe(0);
};

const readContext = (context: PixelContext): Raster => ({
  data: new Uint8ClampedArray(context.pixels),
  width: context.width,
  height: context.height,
});

const readElement = (canvas: HTMLCanvasElement, what: string): Raster => {
  const context = pixelHtmlCanvasContexts.get(canvas);
  if (!context) throw new Error(`${what} produced a canvas with no pixel context; the pixel stub is not installed`);
  return readContext(context);
};

const readBitmap = (bitmap: unknown, what: string): Raster => {
  const raster = readPixelSource(bitmap);
  if (!raster) throw new Error(`${what} produced a bitmap carrying no pixels`);
  return raster;
};

// --- refusals ------------------------------------------------------------------------------------------

/** Every `console.error` since the last drain, as one string per call. */
let refusals: string[] = [];

const drainRefusals = (): string[] => refusals.splice(0, refusals.length);

// --- one scenario, one cursor -------------------------------------------------------------------------

type RenderedPair = {
  label: string;
  legacyRuntime: Raster;
  legacyExport: Raster;
  durableRuntime: Raster;
  durableExport: Raster;
  accepted: string[];
  declined: string[];
  filters: string[];
};

/**
 * Builds the export-side layer records FROM THE DURABLE SIDE ALONE.
 *
 * The previous version started from the legacy records and swapped only `tmpCanvas`, which made
 * the export comparison structurally incapable of failing: `renderExportCanvas()` places by
 * `layer.pos`, reads `visible`/`opacity`/`blendMode` and re-evaluates `layer.operations`, and every
 * one of those was still the LEGACY value on both sides. Worse, the mount's own accept rule
 * requires `isEqual(bounds, existing.pos)` and no retained operations, so the bitmap it accepted
 * was a byte-identical copy of the legacy record's own — 30 accepted mounts, 0 differing bytes, on
 * every cursor. A 7px durable misplacement turned the runtime axis red and left the export axis at
 * zero.
 *
 * So nothing here is read off the legacy replay. Position, visibility, opacity, blend mode, order,
 * name and frame all come from the durable composition and the durable replay's own snapshot, and
 * `operations` is empty because the retained presentation is already baked into the bitmap. Two
 * authorities that disagree about placement, ordering or frame now disagree HERE.
 */
const durableExportRecords = (
  replay: DurableReplayResult,
  composite: DurableComposite
): { layers: LayersRecord; size: Size; frame: DocumentFrame; missing: string[] } => {
  const layers: LayersRecord = {};
  const missing: string[] = [];
  for (const [layerId, materialized] of Object.entries(composite.layers)) {
    const replayLayer = replay.layers[layerId];
    if (!replayLayer) {
      missing.push(layerId);
      continue;
    }
    const snapshot = replayLayer.snapshot;
    layers[layerId] = {
      id: layerId,
      name: snapshot.name,
      isBedrock: snapshot.isBedrock,
      // `materialized.bounds` is the DURABLE extent. Using the legacy `pos` here is what made the
      // axis blind: the accept predicate required the two to be equal, so the one value worth
      // comparing was equal by precondition.
      pos: { ...materialized.bounds },
      bitmap: null,
      tmpCanvas: materialized.bitmap,
      visible: snapshot.visible,
      opacity: snapshot.opacity,
      locked: snapshot.locked,
      blendMode: snapshot.blendMode,
      order: snapshot.order,
      operations: [],
    };
  }
  return {
    layers,
    size: documentFrameSize(replay.frame),
    frame: replay.frame,
    missing,
  };
};

const mountDurablePresentation = (
  legacyLayers: LayersRecord,
  replay: DurableReplayResult,
  composite: DurableComposite
): { layers: LayersRecord; accepted: string[]; declined: string[] } => {
  const layers: LayersRecord = { ...legacyLayers };
  const accepted: string[] = [];
  const declined: string[] = [];
  for (const [layerId, materialized] of Object.entries(composite.layers)) {
    const existing = layers[layerId];
    const replayLayer = replay.layers[layerId];
    // `publishDurableNavigationPresentation()` refuses the whole composition when a layer is
    // absent from legacy replay; this file declines it instead and records why, so one missing
    // layer cannot hide the rest of the document's comparison.
    if (
      !existing ||
      !replayLayer ||
      !durablePresentationIsRendererIdentical(replayLayer, existing, materialized.bounds)
    ) {
      declined.push(layerId);
      continue;
    }
    layers[layerId] = { ...existing, tmpCanvas: materialized.bitmap };
    accepted.push(layerId);
  }
  return { layers, accepted, declined };
};

const renderPair = async (rawScenario: ReplayParityScenario, cursor: number): Promise<RenderedPair> => {
  const scenario: ReplayParityScenario = { ...rawScenario, history: withProductionBitmaps(rawScenario.history) };
  const label = `${scenario.name} at cursor ${cursor}`;
  storeStateMock.history = [...scenario.history];
  storeStateMock.historyIndex = scenario.history.length - 1;
  storeStateMock.totalSize = paritySize;
  storeStateMock.documentFrame = parityFrame;
  storeStateMock.activeLayerId = null;
  storeStateMock.deletedLayers = {};
  storeStateMock.branchRevision = 0;
  const visibleCanvas = document.createElement('canvas');
  storeStateMock.canvasRef.current = visibleCanvas;
  dispatchMock.mockClear();

  const { result, unmount } = renderHook(() => useHistory());
  try {
    await result.current.resetHistoryTo(cursor);
  } finally {
    unmount();
  }

  const applied = dispatchMock.mock.calls
    .map(([action]) => action as { type?: string; payload?: { updates?: Record<string, unknown> } })
    .find((action) => action?.type === 'APPLY_HISTORY_REPLAY');
  if (!applied?.payload?.updates) {
    throw new Error(`${label} published no replay; console.error refusals: ${JSON.stringify(drainRefusals())}`);
  }
  const updates = applied.payload.updates as {
    layers: LayersRecord;
    totalSize: { width: number; height: number };
    documentFrame: { x: number; y: number; width: number; height: number };
  };

  const legacyRuntime = readElement(visibleCanvas, `legacy runtime for ${label}`);
  const legacyExportCanvas = renderExportCanvas(updates.layers, updates.totalSize, updates.documentFrame);
  const legacyExport = readElement(legacyExportCanvas, `legacy export for ${label}`);

  const documentId = `pixel-parity-${scenario.name}`;
  const assetRegistry = new AssetRegistry();
  const converted = legacyHistoryToDurable(scenario.history, {
    documentId,
    registry: assetRegistry,
    initialSize: paritySize,
    initialFrame: parityFrame,
  });
  if (converted.diagnostics.length > 0) {
    throw new Error(`${label} did not convert cleanly: ${JSON.stringify(converted.diagnostics)}`);
  }
  const durableCursor = converted.legacyCursorToDurableCursor[cursor];
  if (typeof durableCursor !== 'number') throw new Error(`${label} legacy cursor ${cursor} did not map`);

  const replay = replayDurableAtCursor(converted.document, durableCursor);
  const composite = await composeDurableDocument(replay, {
    documentId,
    baselineAssetGeneration: assetRegistry.getDocumentGeneration(documentId),
    operationSetRevision: converted.document.durableRevision,
    assetRegistry,
  });

  const durableRuntime = readBitmap(composite.bitmap, `durable composition for ${label}`);
  const mounted = mountDurablePresentation(updates.layers, replay, composite);
  const durableRecords = durableExportRecords(replay, composite);
  const durableExportCanvas = renderExportCanvas(durableRecords.layers, durableRecords.size, durableRecords.frame);
  const durableExport = readElement(durableExportCanvas, `durable export for ${label}`);

  // Every filter assignment the fixture saw, across EVERY canvas it created — not just the three
  // surfaces this file reads back. `drawLayersToCanvas()` composites into an internal staging canvas
  // and blits the result, so the target surfaces never receive a filter assignment themselves; a
  // collection that read only them was empty and made the pin below fail on its FIRST assertion.
  const filters = [...new Set(filterAssignments())].filter((filter) => filter !== 'none');

  assetRegistry.shutdown();

  return {
    label,
    legacyRuntime,
    legacyExport,
    durableRuntime,
    durableExport,
    accepted: mounted.accepted,
    declined: mounted.declined,
    filters,
  };
};

const allScenarios: readonly ReplayParityScenario[] = [...replayParityScenarios, ...rasterProcessorScenarios];

/**
 * Puts real pixels on a scenario's baseline layers, through the production creator.
 *
 * `runtimeLayer()` — the shared scenario helper — is a REPLAY-STATE record: it carries
 * `bitmap: null` and `tmpCanvas: null` because the logical differential compares ids, orders and
 * booleans and never reads a colour. Production baseline records are the opposite: the
 * `OPEN_DOCUMENT` entry carries layers that were rasterized when the document opened, so
 * `getLayerBitmap()` finds one and `drawLayerSource()` draws them. Without this, every scenario
 * renders an empty document and the axes compare two transparent rectangles.
 *
 * `createLayerSource()` also derives `name` and `order` from the layer set it is handed. Those
 * are replay STATE, which is the logical differential's subject and not this file's, so only the
 * two bitmap slots are taken from the created layer and every other field is the record's own.
 * The SAME history then goes to both sides, so the two authorities are handed the same document.
 */
const withProductionBitmaps = (history: readonly HistoryItem[]): HistoryItem[] =>
  history.map((item) => {
    const documentSource = item.documentSource;
    if (!documentSource) return item;
    const layers = Object.fromEntries(
      Object.entries(documentSource.layers).map(([layerId, layer]) => {
        if (layer.tmpCanvas || layer.bitmap || !layer.source) return [layerId, layer];
        const created = createLayerSource({ layerId, layers: documentSource.layers, source: layer.source });
        return [layerId, { ...layer, bitmap: created.bitmap, tmpCanvas: created.tmpCanvas }];
      })
    );
    return { ...item, documentSource: { ...documentSource, layers } };
  });

beforeAll(() => overrideCanvasFilterSupport(true));
afterAll(() => overrideCanvasFilterSupport(null));

beforeEach(() => {
  stubPixelOffscreenCanvas();
  // The setup polyfill answers with a colourless carrier, which would make `toOwnedBitmap()`
  // hand every durable surface to the comparator with no pixels in it.
  vi.stubGlobal('createImageBitmap', undefined);
  installPixelCanvasElement();
  refusals = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    refusals.push(args.map((argument) => String(argument)).join(' '));
  });
});

afterEach(() => {
  drainRefusals();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// --- the cursor matrix, and the divergences in it ------------------------------------------------------

type CursorCase = { label: string; scenario: ReplayParityScenario; cursor: number };

const everyCursorCase: readonly CursorCase[] = allScenarios.flatMap((scenario) =>
  scenario.history.map((_entry, cursor) => ({
    label: `${scenario.name} at cursor ${cursor}`,
    scenario,
    cursor,
  }))
);

/**
 * The named, MEASURED divergences — every (scenario, cursor) whose pixels do not agree today.
 *
 * Each one is an `it.fails` below rather than a skipped case, and each carries the reason it is
 * a pin instead of a fix. A cursor that is neither in this list nor in the hard matrix is a
 * coverage hole, and the matrix test below fails on one.
 *
 * `reposition and affine transform` at the transform cursor: the two authorities resample the
 * transformed layer a different number of times. `drawLayerSource()` draws the retained affine
 * straight into the document surface, ONE `drawImage` with the matrix applied. `materializeLayer()`
 * — `renderRetainedSegment()` — draws it into a surface sized `Math.ceil(localBounds)` and the
 * compositor then stamps THAT surface at `bounds.width`/`bounds.height`, which are the
 * un-rounded `getAffineBounds()` numbers. So the durable side runs a second resample with a
 * fractional scale factor and the legacy side runs none. Measured here: 764 of 480000 bytes
 * differ, first at (45, 41) where the legacy presentation is opaque white and the durable one is
 * transparent. The two-step composition is the durable model's own arrangement and the
 * un-rounded bounds are its own output, so the difference is structural rather than a defect of
 * this double — a browser's filtered resample would differ too, by different amounts. Which of
 * the two is right is S3's question; until it is answered the honest record is a pin.
 */
const DECLARED_DIVERGENCES: ReadonlyArray<{ scenario: string; cursor: number; reason: string }> = [
  {
    scenario: 'reposition and affine transform',
    cursor: 2,
    reason:
      'the durable composition stamps its intermediate surface at un-rounded bounds while the legacy renderer draws the retained affine once, so the transformed layer is resampled twice on one side and once on the other',
  },
];

const declaredDivergenceFor = (cursorCase: CursorCase) =>
  DECLARED_DIVERGENCES.find(
    (declared) => declared.scenario === cursorCase.scenario.name && declared.cursor === cursorCase.cursor
  );

const hardCursorCases = everyCursorCase.filter((cursorCase) => !declaredDivergenceFor(cursorCase));

const assertPixelParity = async (cursorCase: CursorCase, note = ''): Promise<void> => {
  resetUnresolvableDraws();
  resetFilterAssignments();
  const pair = await renderPair(cursorCase.scenario, cursorCase.cursor);
  const suffix = note ? ` [${note}]` : '';
  const reported = drainRefusals();
  expect(reported, `${pair.label}: console.error refusals`).toEqual([]);
  // A comparison over two blank surfaces is EQUAL with zero bytes examined, which is the one way this
  // harness could report success while the product is wrong. The mechanism is a source the fixture
  // cannot resolve: `src/test/setup.ts`'s `createImageBitmap` polyfill is `{ width, height, close }`
  // with no pixels, and `materialization.ts` — `toOwnedBitmap()` runs it inside every retained
  // operation. Assert nothing was dropped.
  //
  // Deliberately NOT "a surface painted something": a hidden layer legitimately paints nothing
  // (`layer properties` at the cursor that hides it), so that assertion would be wrong rather than
  // strict. The check that would be right needs to know what the document SHOULD paint, which is a
  // separate derivation.
  const unresolvable = unresolvableDraws();
  expect(unresolvable, `${pair.label}: drawImage sources the fixture could not resolve`).toEqual([]);
  assertIdentical(pair.legacyRuntime, pair.durableRuntime, `${pair.label} runtime presentation${suffix}`);
  assertIdentical(pair.legacyExport, pair.durableExport, `${pair.label} export bytes${suffix}`);
};

describe('legacy/durable pixel parity', () => {
  it('covers every reachable cursor exactly once across the hard axes and the declared pins', () => {
    // The matrix is derived from the scenario list, so a new scenario cannot be forgotten — but
    // a pin whose scenario or cursor does not exist is a pin asserting nothing, and a reason that
    // reads as a placeholder is a pin with no evidence behind it.
    for (const declared of DECLARED_DIVERGENCES) {
      const match = everyCursorCase.find(
        (cursorCase) => cursorCase.scenario.name === declared.scenario && cursorCase.cursor === declared.cursor
      );
      expect(
        match,
        `declared divergence "${declared.scenario}" at cursor ${declared.cursor} names no cursor`
      ).toBeDefined();
      expect(
        declared.reason.trim().length,
        `declared divergence "${declared.scenario}" must name a reason`
      ).toBeGreaterThan(40);
    }
    expect(hardCursorCases.length + DECLARED_DIVERGENCES.length).toBe(everyCursorCase.length);
  });

  it.each(hardCursorCases)(
    'compares rendered pixels and export bytes: $label',
    async (cursorCase) => {
      await assertPixelParity(cursorCase);
    },
    120_000
  );

  // One pin per DECLARED_DIVERGENCES row, generated from the same list the coverage test reads,
  // so a row cannot be declared and left unasserted.
  for (const declared of DECLARED_DIVERGENCES) {
    const cursorCase = everyCursorCase.find(
      (candidate) => candidate.scenario.name === declared.scenario && candidate.cursor === declared.cursor
    );
    if (!cursorCase) continue;
    it.fails(
      `diverges today: ${cursorCase.label} — ${declared.reason}`,
      async () => {
        await assertPixelParity(cursorCase, `declared divergence: ${declared.reason}`);
      },
      120_000
    );
  }

  it('reports a drawImage source it could not resolve, so a blank comparison cannot pass as agreement', () => {
    // The guard the parity matrix relies on, proved sharp. `src/test/setup.ts` polyfills
    // `createImageBitmap` to exactly this shape, and `materialization.ts` — `toOwnedBitmap()` feeds
    // it to `drawImage` inside every retained operation, so a draw that silently contributed
    // nothing would make both authorities blank and the comparison EQUAL over zero bytes.
    resetUnresolvableDraws();
    expect(unresolvableDraws()).toEqual([]);

    const context = new PixelContextClass(4, 4);
    // A resolvable carrier contributes, and records nothing.
    context.drawImage({ width: 2, height: 2, pixels: new Uint8ClampedArray(16).fill(255) }, 0, 0, 2, 2);
    expect(unresolvableDraws()).toEqual([]);
    expect(context.getImageData(0, 0, 4, 4).data.some((byte) => byte !== 0)).toBe(true);

    // The polyfill's shape resolves to nothing, draws nothing, and is RECORDED.
    const before = context.getImageData(0, 0, 4, 4).data.join(',');
    context.drawImage({ width: 2, height: 2, close: () => undefined }, 0, 0, 2, 2);
    expect(unresolvableDraws()).toHaveLength(1);
    expect(context.getImageData(0, 0, 4, 4).data.join(',')).toBe(before);

    resetUnresolvableDraws();
    expect(unresolvableDraws()).toEqual([]);
  });

  it('detects a one-pixel perturbation of a surface it compared', async () => {
    const scenario = rasterProcessorScenarios[0]!;
    const pair = await renderPair(scenario, scenario.history.length - 1);
    expect(drainRefusals()).toEqual([]);

    const perturbed: Raster = {
      data: new Uint8ClampedArray(pair.legacyExport.data),
      width: pair.legacyExport.width,
      height: pair.legacyExport.height,
    };
    // One channel of one pixel, by one.
    perturbed.data[0] = (perturbed.data[0] + 1) % 256;

    const difference = compareRasters(pair.legacyExport, perturbed);
    expect(difference.comparable, 'a same-shape perturbation is comparable').toBe(true);
    expect(difference.differing, 'one perturbed byte is one differing byte').toBe(1);
    expect(difference.firstIndex, 'the perturbation is located').toBe(0);
    expect(() => assertIdentical(pair.legacyExport, perturbed, 'negative control')).toThrow(
      /first difference at \(0, 0\) channel 0/
    );

    const wrongExtent = compareRasters(pair.legacyExport, {
      data: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
    });
    expect(wrongExtent.comparable, 'a different extent is never a tolerance question').toBe(false);
    expect(() =>
      assertIdentical(pair.legacyExport, { data: new Uint8ClampedArray(4), width: 2, height: 2 }, 'x')
    ).toThrow(/extents differ/);
  });

  it.fails(
    'sees the pixels a filter chain produces — jsdom applies no ctx.filter, so both authorities draw unfiltered',
    async () => {
      const scenario = replayParityScenarios.find((entry) => entry.name === 'filter chain')!;
      const cursor = scenario.history.length - 1;
      const pair = await renderPair(scenario, cursor);
      expect(drainRefusals()).toEqual([]);

      // PASSES today: the filter reached a canvas context, which is the most this environment can
      // prove about a filter. It lands on the renderer's INTERNAL staging canvas as the whole
      // composed chain rather than as the bare `blur(4px)`, because `drawLayersToCanvas()`
      // composites into staging and blits — so the assertion is that some assignment CONTAINS the
      // blur, not that the array holds it as an element.
      expect(
        pair.filters.some((filter) => filter.includes('blur(4px)')),
        `the filter chain reached a canvas context: ${JSON.stringify(pair.filters)}`
      ).toBe(true);

      // FAILS today, and is the whole reason this is a pin: `PixelContext` records `ctx.filter`
      // and cannot apply it, so the blurred document is byte-identical to the unfiltered one and
      // the runtime axis above proves nothing about filter pixels. It passes the day a host
      // applies the filter, and the pin goes with it.
      const baseline = await renderPair({ name: 'filter chain baseline', history: scenario.history.slice(0, 1) }, 0);
      expect(
        compareRasters(baseline.durableRuntime, pair.durableRuntime).differing,
        'a blurred composition must differ from the unfiltered one it was blurred from'
      ).toBeGreaterThan(0);
    },
    120_000
  );

  it.fails(
    'sees the pixels a text source produces — jsdom rasterizes no glyph, so both authorities draw an empty surface',
    async () => {
      const scenario = replayParityScenarios.find((entry) => entry.name === 'text source')!;
      const pair = await renderPair(scenario, scenario.history.length - 1);
      expect(drainRefusals()).toEqual([]);

      // FAILS today: `text` reaches `PixelContext.fillText()`, which is recorded and rasterizes
      // nothing, so the glyphs a text layer is made of contribute no pixel. Both authorities
      // agree on that absence, which is why the runtime axis above is green here and is worth
      // nothing about text. It passes on a host with a glyph rasteriser.
      const untexted = await renderPair({ name: 'text source baseline', history: scenario.history.slice(0, 1) }, 0);
      expect(
        compareRasters(untexted.durableRuntime, pair.durableRuntime).differing,
        'the text layer composited at least one pixel the untexted document does not carry'
      ).toBeGreaterThan(0);
    },
    120_000
  );

  it.fails(
    'mounts every composed layer — durablePresentationIsRendererIdentical() accepts only the unfiltered raster/blank subset',
    async () => {
      const declined: string[] = [];
      for (const scenario of allScenarios) {
        for (let cursor = 0; cursor < scenario.history.length; cursor += 1) {
          const pair = await renderPair(scenario, cursor);
          expect(drainRefusals(), `${pair.label}: console.error refusals`).toEqual([]);
          declined.push(...pair.declined.map((layerId) => `${scenario.name}@${cursor}:${layerId}`));
        }
      }
      // FAILS today, and it is the divergence list S1 exists to produce: the mount's own rule is
      // "no retained operations, matching bounds, and a raster or blank source", so every
      // filtered, transformed and text layer composes correctly on the durable side and is then
      // refused by the mount — leaving the export axis comparing the legacy presentation against
      // itself for exactly the layers worth comparing. `reposition and affine transform` and
      // `filter chain` are declined here, and so is any layer carrying a retained operation.
      expect(declined, `durable mount declined: ${JSON.stringify(declined, null, 2)}`).toEqual([]);
    },
    300_000
  );
});

// --- what this file cannot compare, and why ------------------------------------------------------------

/**
 * NOT AN `it.fails`, because it is not a divergence: it is an axis that does not exist.
 *
 * RQ-4 names history-panel state. `HistoryTab.tsx` renders `useStore()`'s `history` array and
 * labels each row with `getHistoryItemTitle()` — a pure function of a LEGACY `HistoryItem`, and
 * the only title mapping in the tree. The durable document carries operations, not titles, and
 * nothing derives one, so the panel has exactly one authority today and a differential has
 * nothing to compare.
 *
 * The assertion below is the fact that limitation rests on: the converted document carries no
 * title projection at all. Inventing one for the test would make every assertion about the
 * invention rather than about the two models, which is a product decision and not a harness, so
 * it is recorded here and raised in the S1 report instead.
 */
describe('history-panel state', () => {
  it('has one authority today: the durable document carries no title to difference', () => {
    const { document, diagnostics } = legacyHistoryToDurable(replayParityScenarios[0]!.history, {
      documentId: 'history-panel-axis',
    });
    expect(diagnostics).toEqual([]);
    expect(Object.keys(document)).not.toContain('title');
    expect(document.history.flatMap((entry) => Object.keys(entry).concat(Object.keys(entry.operation)))).not.toContain(
      'title'
    );
  });
});
