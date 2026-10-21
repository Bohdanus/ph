import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { replayDurableDocument } from '../durable-replay.ts';
import { rotationAffineAroundPoint } from '../affine-transform.ts';
import { durableSourceKindForTool, legacyHistoryToDurable } from '../history-adapter.ts';
import type { DurableOperation } from '../history-model.ts';
import { replayHistory, type HistoryReplayDependencies, type HistoryReplayResult } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import { createLayerSource } from '../layer-utils.ts';
import type { Layer, LayerOperation, LayerSource, LayersRecord } from '../layer-types.ts';
import type { DurableReplayResult } from '../durable-replay.ts';
import type { Selection, Size } from '../general-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { ShapeToolArgs } from '../../tools/shape.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';
import {
  HIDE_LAYER_ACTION,
  LOCK_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  UNLOCK_LAYER_ACTION,
} from '../../util/constants.ts';
import { overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';

const size: Size = { width: 400, height: 300 };
const frame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
const layerA = 'layer-a';
const layerB = 'layer-b';

type BlankSource = Extract<LayerSource, { kind: 'blank' }>;

function blankSource(pos: Layer['pos']): BlankSource {
  return { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos };
}

function runtimeLayer(id: string, order: number, pos = { x: 20, y: 30, width: 120, height: 80 }): Layer {
  const source = blankSource(pos);
  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos,
    presentationBounds: null,
    source,
    operations: [],
  };
}

function baseline(layers: LayersRecord = { [layerA]: runtimeLayer(layerA, 0) }): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: Object.keys(layers)[0] ?? layerA,
    documentSource: { layers, size, frame },
  };
}

function item(id: string, actionName: HistoryItem['actionName'], layerId: string, args?: object): HistoryItem {
  return { id, actionName, layerId, ...(args ? { args } : {}) };
}

function selection(id: string, x: number, y: number, active = true): Selection {
  return {
    id,
    points: [
      { x, y },
      { x: x + 20, y },
      { x: x + 20, y: y + 20 },
    ],
    isActive: active,
    pos: { x, y, width: 20, height: 20 },
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    metadata: { movedAtVersion: x + y },
  };
}

const textArgs: TextToolArgs = {
  toolName: 'text',
  align: 'left',
  bold: false,
  color: '#111111',
  fontFamily: 'Arial',
  fontSize: 18,
  italic: false,
  lineHeight: 1.2,
  text: 'Parity',
  rect: { x1: 10, y1: 15, x2: 140, y2: 55 },
};

const vectorArgs: ShapeToolArgs = {
  toolName: 'shape',
  alpha: 1,
  color: '#0000ff',
  backgroundColor: '#ffffff',
  hasFill: true,
  figure: 'oval',
  lineWidth: 2,
  start: { x: 20, y: 20 },
  end: { x: 100, y: 80 },
};

const transformArgs: TransformToolArgs = {
  toolName: 'transform',
  rotate: 17,
  mirrorH: false,
  mirrorV: false,
  skewX: 0,
  skewY: 0,
  trapezoid: 0,
  resizeX: 125,
  resizeY: 85,
};

const cases: ReadonlyArray<{
  name: string;
  history: readonly HistoryItem[];
  /** The frame BOTH models must report at the last cursor. Absent means "parity only". */
  expectedTipFrame?: DocumentFrame;
}> = [
  {
    name: 'layer properties',
    history: [
      baseline(),
      item('hide', HIDE_LAYER_ACTION, layerA),
      item('show', SHOW_LAYER_ACTION, layerA),
      item('rename', RENAME_LAYER_ACTION, layerA, { name: 'Renamed' }),
      item('opacity', SET_LAYER_OPACITY_ACTION, layerA, { opacity: 0.5 }),
      item('blend-mode', SET_LAYER_BLEND_MODE_ACTION, layerA, { blendMode: 'multiply' }),
      item('lock', LOCK_LAYER_ACTION, layerA, { locked: true }),
      item('unlock', UNLOCK_LAYER_ACTION, layerA, { locked: false }),
    ],
  },
  {
    name: 'create and remove',
    history: [
      baseline(),
      {
        id: 'create',
        actionName: NEW_LAYER_ACTION,
        layerId: 'created',
        layerSource: blankSource({ x: 40, y: 50, width: 80, height: 60 }),
      },
      item('remove', REMOVE_ACTION, 'created'),
    ],
  },
  {
    name: 'reposition and affine transform',
    history: [
      baseline(),
      item('move', TOOL_ACTION, layerA, { toolName: 'reposition', move: { x: 45, y: 55 } }),
      item('transform', TOOL_ACTION, layerA, transformArgs),
    ],
  },
  {
    name: 'reorder',
    history: [
      baseline({ [layerA]: runtimeLayer(layerA, 0), [layerB]: runtimeLayer(layerB, 1) }),
      item('reorder', REORDER_ACTION, layerB, { layerToMoveId: layerB, afterWhichLayerId: null }),
    ],
  },
  {
    name: 'filter chain',
    history: [
      baseline(),
      item('blur', TOOL_ACTION, layerA, { toolName: 'blur', radius: 4 }),
      item('color', TOOL_ACTION, layerA, { toolName: 'color', grayscale: 0.5 }),
      item('levels', TOOL_ACTION, layerA, { toolName: 'levels', inputBlack: 0, inputWhite: 255 }),
    ],
  },
  {
    name: 'document frame crop',
    history: [
      baseline(),
      item('crop', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: frame,
        nextFrame: { x: 10, y: 20, width: 200, height: 150 },
      }),
    ],
  },
  {
    name: 'rotated document crop',
    history: [
      baseline({
        [layerA]: runtimeLayer(layerA, 0),
        [layerB]: runtimeLayer(layerB, 1, { x: 150, y: 100, width: 90, height: 70 }),
      }),
      item('rotated-crop', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: frame,
        nextFrame: { x: 30, y: 25, width: 220, height: 170 },
        transform: rotationAffineAroundPoint(-Math.PI / 5, { x: 140, y: 110 }),
      }),
    ],
    expectedTipFrame: { x: 30, y: 25, width: 220, height: 170 },
  },
  {
    name: 'document frame grow',
    history: [
      baseline(),
      item('grow', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: frame,
        nextFrame: { x: 0, y: 0, width: 560, height: 420 },
      }),
    ],
    expectedTipFrame: { x: 0, y: 0, width: 560, height: 420 },
  },
  {
    name: 'document frame negative origin',
    history: [
      baseline(),
      item('negative-origin', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: frame,
        nextFrame: { x: -60, y: -45, width: 340, height: 260 },
      }),
    ],
    expectedTipFrame: { x: -60, y: -45, width: 340, height: 260 },
  },
  {
    name: 'document frame grow with negative origin',
    history: [
      baseline(),
      item('grow-negative-origin', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: frame,
        nextFrame: { x: -60, y: -45, width: 520, height: 390 },
      }),
    ],
    expectedTipFrame: { x: -60, y: -45, width: 520, height: 390 },
  },
  {
    name: 'merge',
    history: [
      baseline({ [layerA]: runtimeLayer(layerA, 0), [layerB]: runtimeLayer(layerB, 1) }),
      {
        id: 'merge',
        actionName: MERGE_ACTION,
        layerId: 'merged',
        layerSource: blankSource({ x: 0, y: 0, width: 400, height: 300 }),
      },
    ],
  },
  {
    name: 'text source',
    history: [
      baseline(),
      {
        id: 'text',
        actionName: NEW_LAYER_ACTION,
        layerId: 'text-layer',
        layerSource: {
          kind: 'tool',
          args: textArgs,
          isBedrock: false,
          pos: { x: 10, y: 15, width: 130, height: 40 },
        },
      },
    ],
  },
  {
    name: 'vector source',
    history: [
      baseline(),
      {
        id: 'shape',
        actionName: NEW_LAYER_ACTION,
        layerId: 'shape-layer',
        layerSource: {
          kind: 'tool',
          args: vectorArgs,
          isBedrock: false,
          pos: { x: 20, y: 20, width: 80, height: 60 },
        },
      },
    ],
  },
  {
    name: 'selection',
    history: [
      baseline(),
      item('selection-create', SELECTION_ACTION, 'selection', {
        previousSelectionState: { selections: [], activeSelectionId: null },
        nextSelectionState: { selections: [selection('selection-a', 15, 25)], activeSelectionId: 'selection-a' },
      }),
    ],
  },
];

/**
 * The legacy side of the parity oracle, wired to the production rule rather than
 * to a copy of it.
 *
 * `replayHistory` builds a created layer through its `createLayer` dependency, and
 * `useHistory.ts` wires that to `createLayerSource`. This stub used to re-derive the
 * layer instead — the bare kind as `name`, `Object.values(layers).length` as `order`
 * — which is the same second rule the durable converter used to carry, so the oracle
 * agreed with a divergence instead of catching it: three cases here read a name no
 * production path produces. Delegating is what makes the comparison a parity test.
 *
 * `createLayerSource` does rasterise the layer, which is why this was ever stubbed;
 * `beforeAll` enables canvas filter support and the jsdom setup provides
 * `OffscreenCanvas`, so the real factory runs here. `createLayer` is synchronous and
 * `createLayerSource` is too, so the dependency contract is unchanged.
 */
function replayDependencies(): HistoryReplayDependencies {
  return {
    createLayer: ({ layerId, layers, source }) => createLayerSource({ layerId, layers, source }),
    applyRasterTool: (layer) => layer,
  };
}

function sourceKind(source: LayerSource | undefined): string {
  if (!source) return 'materialized';
  if (source.kind === 'image') return 'raster';
  if (source.kind === 'tool') return durableSourceKindForTool(source.args.toolName) ?? 'legacy-tool';
  return source.kind;
}

function durableSourceKind(source: DurableReplayResult['layers'][string]['snapshot']['source']): string {
  return source.kind;
}

type ComparableOperationKind = NonNullable<LayerOperation['kind']> | DurableOperation['kind'] | 'unknown';

function operationKind(kind: LayerOperation['kind'], operation: LayerOperation): ComparableOperationKind {
  if (kind === 'filter') return 'apply-filter';
  if (kind === 'affine-transform') return 'apply-affine-transform';
  if (kind === undefined && 'args' in operation && typeof operation.args.toolName === 'string') {
    return 'apply-filter';
  }
  return 'unknown';
}

function normalizeLegacy(result: HistoryReplayResult) {
  return {
    frame: result.documentFrame,
    totalSize: result.totalSize,
    layers: Object.values(result.layers)
      .sort((left, right) => left.order - right.order)
      .map((layer, order) => ({
        id: layer.id,
        order,
        name: layer.name,
        visible: layer.visible ?? true,
        locked: layer.locked,
        opacity: layer.opacity,
        blendMode: layer.blendMode,
        pos: layer.pos,
        sourceKind: sourceKind(layer.source),
        operations: layer.operations.map((operation) =>
          operation.kind === 'affine-transform'
            ? { kind: operationKind(operation.kind, operation), transform: operation.transform }
            : { kind: operationKind(operation.kind, operation) }
        ),
      })),
    selections: result.selections,
    activeSelectionId: result.activeSelectionId,
  };
}

function normalizeDurable(result: DurableReplayResult) {
  return {
    frame: result.frame,
    totalSize: result.totalSize,
    layers: Object.values(result.layers)
      .sort((left, right) => left.snapshot.order - right.snapshot.order)
      .map(({ snapshot, operations }, order) => ({
        id: snapshot.id,
        order,
        name: snapshot.name,
        visible: snapshot.visible ?? true,
        locked: snapshot.locked,
        opacity: snapshot.opacity,
        blendMode: snapshot.blendMode,
        pos: snapshot.pos,
        sourceKind: durableSourceKind(snapshot.source),
        operations: operations.map((operation) =>
          operation.kind === 'apply-affine-transform'
            ? { kind: operation.kind, transform: operation.transform }
            : { kind: operation.kind }
        ),
      })),
    selections: result.selections.selections,
    activeSelectionId: result.selections.activeSelectionId,
  };
}

function convert(history: readonly HistoryItem[], name: string) {
  return legacyHistoryToDurable(history, { documentId: `parity-${name}` });
}

describe('legacy/durable logical replay parity', () => {
  beforeAll(() => overrideCanvasFilterSupport(true));
  afterAll(() => overrideCanvasFilterSupport(null));

  it.each(cases)('matches at every reachable cursor: $name', ({ name, history, expectedTipFrame }) => {
    const converted = convert(history, name);
    expect(converted.diagnostics).toEqual([]);

    for (let cursor = 0; cursor < history.length; cursor += 1) {
      const legacy = replayHistory(history, cursor, size, replayDependencies(), frame);
      const durableCursor = converted.legacyCursorToDurableCursor[cursor];
      expect(durableCursor, `${name} legacy cursor ${cursor} must map`).toEqual(expect.any(Number));
      const durable = replayDurableDocument(converted.document, durableCursor);
      expect(normalizeDurable(durable), `${name} at cursor ${cursor}`).toEqual(normalizeLegacy(legacy));

      // Parity alone cannot see an origin clamp: a model that floored the frame at 0 would
      // still agree with the other one, and the extent of these cases would not show it
      // either. So a case that declares a tip frame is held to that frame on BOTH sides,
      // sign included, at the only cursor that applied it.
      if (expectedTipFrame && cursor === history.length - 1) {
        expect(legacy.documentFrame, `${name} legacy frame at the tip`).toEqual(expectedTipFrame);
        expect(durable.frame, `${name} durable frame at the tip`).toEqual(expectedTipFrame);
        expect(Math.sign(legacy.documentFrame.x), `${name} legacy origin x sign`).toBe(Math.sign(expectedTipFrame.x));
        expect(Math.sign(durable.frame.x), `${name} durable origin x sign`).toBe(Math.sign(expectedTipFrame.x));
        expect(Math.sign(legacy.documentFrame.y), `${name} legacy origin y sign`).toBe(Math.sign(expectedTipFrame.y));
        expect(Math.sign(durable.frame.y), `${name} durable origin y sign`).toBe(Math.sign(expectedTipFrame.y));
      }
    }
  });

  it('keeps invalid cursor behavior outside the parity oracle', () => {
    const history = cases[0]!.history;
    const converted = convert(history, 'invalid-cursor');
    const legacy = replayHistory(history, -1, size, replayDependencies(), frame);
    const durable = replayDurableDocument(converted.document, -1);

    expect(Object.keys(legacy.layers)).toHaveLength(0);
    expect(Object.keys(durable.layers)).toHaveLength(1);
    expect(durable.cursor).toBe(-1);

    const nanLegacy = replayHistory(history, Number.NaN, size, replayDependencies(), frame);
    const nanDurable = replayDurableDocument(converted.document, Number.NaN);
    expect(Object.keys(nanLegacy.layers)).toHaveLength(0);
    expect(Object.keys(nanDurable.layers)).toHaveLength(1);
    expect(nanDurable.cursor).toBe(-1);
  });
});
