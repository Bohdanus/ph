import type { DocumentFrame } from '../document-frame.ts';
import type { Selection, Size } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource, LayersRecord } from '../layer-types.ts';
import type { SharpenToolArgs } from '../../tools/sharpen.ts';
import type { TextToolArgs } from '../../tools/text.ts';
import type { TransformToolArgs } from '../../tools/transform.ts';
import {
  HIDE_LAYER_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
} from '../../util/constants.ts';
import { imageDataFrom } from '../../__tests__/fixtures/pixelCanvas.ts';

/**
 * THE ONE SCENARIO LIST, shared by the logical and the pixel differentials.
 *
 * `history-replay.parity.test.ts` — the logical differential — and
 * `history-migration.pixel-parity.test.ts` — the pixel differential — must describe the SAME
 * documents, or "the two models agree" is a statement about two different corpora. So the
 * scenarios live here and each suite supplies only the dependencies that are the subject of its
 * comparison: the logical suite stubs `applyRasterTool` to identity because it compares replay
 * STATE, and the pixel suite passes the real one because it compares replay PIXELS.
 *
 * Nothing in this module imports a canvas or a registry. A scenario is a `HistoryItem[]` plus
 * the frame both models must report at the tip, so the same twelve rows drive both suites.
 */

export const paritySize: Size = { width: 400, height: 300 };
export const parityFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
export const layerA = 'layer-a';
export const layerB = 'layer-b';

type BlankSource = Extract<LayerSource, { kind: 'blank' }>;

export function blankSource(pos: Layer['pos']): BlankSource {
  return { kind: 'blank', color: '#ffffff', opacity: 1, isBedrock: false, pos };
}

export function runtimeLayer(id: string, order: number, pos = { x: 20, y: 30, width: 120, height: 80 }): Layer {
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
    source,
    operations: [],
  };
}

/**
 * A layer whose SOURCE IS PIXELS, not a flat fill.
 *
 * Every other scenario's baseline is a `blank`, and a flat field is fixed under an unsharp mask,
 * a blur and a gradient alike — so a raster processor run against one of them is a no-op and a
 * comparison across it proves nothing. This carries a stepped gradient with a hard edge in it,
 * which is the smallest raster a convolution and a resampler both move.
 *
 * The bitmap is an `ImageBitmap`-shaped carrier WITH `close()`, because that is what
 * `AssetRegistry` — `sourceType()` classifies on it — needs in order to adopt a baseline raster
 * rather than snapshot it through an `OffscreenCanvas` the double does not have to fake.
 */
export function rasterLayer(id: string, order: number, pos: Layer['pos']): Layer {
  const rows: (readonly [number, number, number, number, number])[] = [];
  for (let y = 0; y < pos.height; y += 1) {
    for (let x = 0; x < pos.width; x += 1) {
      rows.push([x, y, x < pos.width / 2 ? 10 : 240, y < pos.height / 2 ? 20 : 200, 30]);
    }
  }
  const imageData = imageDataFrom(pos.width, pos.height, rows);
  const pixels = new Uint8ClampedArray(imageData.data);
  const bitmap = {
    width: pos.width,
    height: pos.height,
    pixels,
    close: () => pixels.fill(0),
  } as unknown as ImageBitmap;
  const source = {
    kind: 'image',
    bitmap,
    name: `${id}.png`,
    isBedrock: false,
    pos,
  } as unknown as Extract<LayerSource, { kind: 'image' }>;

  return {
    id,
    name: id,
    isBedrock: false,
    tmpCanvas: null,
    bitmap,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos,
    source,
    operations: [],
  };
}

export function baselineEntry(layers: LayersRecord = { [layerA]: runtimeLayer(layerA, 0) }): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: Object.keys(layers)[0] ?? layerA,
    documentSource: { layers, size: paritySize, frame: parityFrame },
  };
}

export function historyItem(
  id: string,
  actionName: HistoryItem['actionName'],
  layerId: string,
  args?: object
): HistoryItem {
  return { id, actionName, layerId, ...(args ? { args } : {}) };
}

export function selectionRecord(id: string, x: number, y: number, active = true): Selection {
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

export const textArgs: TextToolArgs = {
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

export const transformArgs: TransformToolArgs = {
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

const sharpenArgs: SharpenToolArgs = { toolName: 'sharpen', amount: 120, radius: 1 };

export type ReplayParityScenario = Readonly<{
  name: string;
  history: readonly HistoryItem[];
  /** The frame BOTH models must report at the last cursor. Absent means "parity only". */
  expectedTipFrame?: DocumentFrame;
}>;

/**
 * The twelve scenarios, in the order the logical differential has always asserted them.
 */
export const replayParityScenarios: readonly ReplayParityScenario[] = [
  {
    name: 'layer properties',
    history: [
      baselineEntry(),
      historyItem('hide', HIDE_LAYER_ACTION, layerA),
      historyItem('show', SHOW_LAYER_ACTION, layerA),
      historyItem('rename', RENAME_LAYER_ACTION, layerA, { name: 'Renamed' }),
    ],
  },
  {
    name: 'create and remove',
    history: [
      baselineEntry(),
      {
        id: 'create',
        actionName: NEW_LAYER_ACTION,
        layerId: 'created',
        layerSource: blankSource({ x: 40, y: 50, width: 80, height: 60 }),
      },
      historyItem('remove', REMOVE_ACTION, 'created'),
    ],
  },
  {
    name: 'reposition and affine transform',
    history: [
      baselineEntry(),
      historyItem('move', TOOL_ACTION, layerA, { toolName: 'reposition', move: { x: 45, y: 55 } }),
      historyItem('transform', TOOL_ACTION, layerA, transformArgs),
    ],
  },
  {
    name: 'reorder',
    history: [
      baselineEntry({ [layerA]: runtimeLayer(layerA, 0), [layerB]: runtimeLayer(layerB, 1) }),
      historyItem('reorder', REORDER_ACTION, layerB, { layerToMoveId: layerB, afterWhichLayerId: null }),
    ],
  },
  {
    name: 'filter chain',
    history: [
      baselineEntry(),
      historyItem('blur', TOOL_ACTION, layerA, { toolName: 'blur', radius: 4 }),
      historyItem('color', TOOL_ACTION, layerA, { toolName: 'color', grayscale: 0.5 }),
      historyItem('levels', TOOL_ACTION, layerA, { toolName: 'levels', inputBlack: 0, inputWhite: 255 }),
    ],
  },
  {
    name: 'document frame crop',
    history: [
      baselineEntry(),
      historyItem('crop', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: parityFrame,
        nextFrame: { x: 10, y: 20, width: 200, height: 150 },
      }),
    ],
  },
  {
    name: 'document frame grow',
    history: [
      baselineEntry(),
      historyItem('grow', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: parityFrame,
        nextFrame: { x: 0, y: 0, width: 560, height: 420 },
      }),
    ],
    expectedTipFrame: { x: 0, y: 0, width: 560, height: 420 },
  },
  {
    name: 'document frame negative origin',
    history: [
      baselineEntry(),
      historyItem('negative-origin', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: parityFrame,
        nextFrame: { x: -60, y: -45, width: 340, height: 260 },
      }),
    ],
    expectedTipFrame: { x: -60, y: -45, width: 340, height: 260 },
  },
  {
    name: 'document frame grow with negative origin',
    history: [
      baselineEntry(),
      historyItem('grow-negative-origin', SET_DOCUMENT_FRAME_ACTION, 'document', {
        previousFrame: parityFrame,
        nextFrame: { x: -60, y: -45, width: 520, height: 390 },
      }),
    ],
    expectedTipFrame: { x: -60, y: -45, width: 520, height: 390 },
  },
  {
    name: 'merge',
    history: [
      baselineEntry({ [layerA]: runtimeLayer(layerA, 0), [layerB]: runtimeLayer(layerB, 1) }),
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
      baselineEntry(),
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
    name: 'selection',
    history: [
      baselineEntry(),
      historyItem('selection-create', SELECTION_ACTION, 'selection', {
        previousSelectionState: { selections: [], activeSelectionId: null },
        nextSelectionState: { selections: [selectionRecord('selection-a', 15, 25)], activeSelectionId: 'selection-a' },
      }),
    ],
  },
];

/**
 * The one scenario the PIXEL differential adds, and the logical differential does not run.
 *
 * WHY IT IS SEPARATE. It exercises `commit: 'raster'`, the arm `history-adapter.ts` converts
 * into an `apply-raster-processor` operation and `replayHistory()` routes through
 * `dependencies.applyRasterTool` — the one dependency the logical suite stubs to identity, and
 * the one path where a REAL processor runs on both sides. None of the twelve carries a
 * `commit: 'raster'` tool, so without this row the whole raster-processor axis would be wired
 * and never entered.
 *
 * It is NOT in the logical list because the logical list is the existing gate: adding a row to
 * it changes what `history-replay.parity.test.ts` asserts, and S1 changes no production
 * behaviour. `selection-replay.parity.test.ts` covers selection; this row belongs beside the
 * pixel axis until a later step widens the logical corpus deliberately.
 */
export const rasterProcessorScenarios: readonly ReplayParityScenario[] = [
  {
    name: 'raster processor on a non-flat baseline',
    history: [
      baselineEntry({ [layerA]: rasterLayer(layerA, 0, { x: 20, y: 30, width: 120, height: 80 }) }),
      historyItem('sharpen', TOOL_ACTION, layerA, sharpenArgs),
    ],
  },
];
