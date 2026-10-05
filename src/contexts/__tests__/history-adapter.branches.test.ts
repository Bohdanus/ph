import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import type { DocumentFrame } from '../document-frame.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import {
  UnsupportedHistoryFeatureError,
  appendDurableEntry,
  convertLegacyHistory,
  convertLegacyHistorySafely,
  createDurableDocument,
  deriveSetLayerPropertiesEntry,
  isSetLayerPropertiesAction,
  legacyHistoryToDurable,
  setDurableCursor,
  toggleDurableEntry,
} from '../history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  collectDurableAssetIds,
  type DurableDocument,
  type DurableLayerPropertyPatch,
} from '../history-model.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerId, LayerSource } from '../layer-types.ts';
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
import type { TransformToolArgs } from '../../tools/transform.ts';
import type { ActionType } from '../../util/constants.ts';

const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 10, height: 10 },
};

function blankLayer(id: string, order = 0): Layer {
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
    pos: { x: 0, y: 0, width: 100, height: 80 },
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 0, y: 0, width: 100, height: 80 },
    },
    operations: [],
  };
}

function baselineHistory(): HistoryItem[] {
  return [
    {
      id: 'baseline',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      documentSource: {
        layers: { 'layer-1': blankLayer('layer-1') },
        size: initialSize,
        frame: baselineFrame,
      },
    },
  ];
}

/**
 * A History row carrying the document's opening state — the entry
 * `legacyHistoryToDurable` adopts as the durable baseline. `disabled` picks the
 * shape a History-panel toggle produces. The id is a token none of the
 * diagnostic message bodies contain otherwise, so `toContain` on it pins the
 * `${item.id}` interpolation rather than a coincidental word.
 */
function openingEntry(id: string, disabled: boolean): HistoryItem {
  return {
    id,
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: 'layer-1',
    ...(disabled ? { disabled: true } : {}),
    documentSource: {
      layers: { 'layer-1': blankLayer('layer-1') },
      size: initialSize,
      frame: baselineFrame,
    },
  };
}

function convert(items: HistoryItem[], registry: AssetRegistry, options: Record<string, unknown> = {}) {
  return legacyHistoryToDurable([...baselineHistory(), ...items], {
    documentId: 'test-doc',
    registry,
    ...options,
  });
}

function transformArgs(overrides: Partial<TransformToolArgs>): TransformToolArgs {
  return {
    toolName: 'transform',
    rotate: 0,
    mirrorH: false,
    mirrorV: false,
    skewX: 0,
    skewY: 0,
    trapezoid: 0,
    resizeX: 100,
    resizeY: 100,
    ...overrides,
  };
}

describe('legacyHistoryToDurable baseline derivation', () => {
  it('falls back to a 1x1 document when the first entry carries no document source', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable([{ id: 'a', actionName: TOOL_ACTION, layerId: 'x', args: {} }], {
      documentId: 'test-doc',
      registry,
    });

    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(converted.document.baseline.layers).toEqual([]);
    expect(converted.document.baseline.activeLayerId).toBeNull();
    registry.shutdown();
  });

  it('derives an empty document from an empty history', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable([], { documentId: 'test-doc', registry });

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toEqual([]);
    // Zero entries is a real position, not a refusal: the cursor is the empty
    // position and the durable revision starts at zero. A fold that seeded `0`
    // instead of `entries.length - 1` would point at an entry that does not exist.
    expect(converted.document.cursor).toBe(-1);
    expect(converted.document.durableRevision).toBe(0);
    expect(converted.document.baseline.layers).toEqual([]);
    expect(converted.document.baseline.activeLayerId).toBeNull();
    expect(converted.document.baseline.selections).toEqual({ selections: [], activeSelectionId: null });
    // The cursor map is one entry per LEGACY entry, so an empty timeline maps to
    // nothing at all rather than to a `-1` placeholder the store would have to
    // special-case.
    expect(converted.legacyCursorToDurableCursor).toEqual([]);
    registry.shutdown();
  });

  it('prefers the explicit initial frame over a derived size when the first entry has no document source', () => {
    const registry = new AssetRegistry();
    const initialFrame = { x: -5, y: -6, width: 111, height: 222 };
    const history: HistoryItem[] = [{ id: 'a', actionName: REMOVE_ACTION, layerId: 'layer-1' }];

    const fromFrame = legacyHistoryToDurable(history, { documentId: 'test-doc', registry, initialFrame });
    const fromSize = legacyHistoryToDurable(history, {
      documentId: 'test-doc',
      registry,
      initialSize: { width: 7, height: 8 },
    });
    const fromSource = convert([], registry);

    expect(fromFrame.document.baseline.frame).toEqual(initialFrame);
    expect(fromSize.document.baseline.frame).toEqual({ x: 0, y: 0, width: 7, height: 8 });
    // A first entry with a document source always wins over both options.
    expect(fromSource.document.baseline.frame).toEqual(baselineFrame);
    registry.shutdown();
  });

  it('derives the baseline frame from the document source size when it carries no frame', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: { layers: { 'layer-1': blankLayer('layer-1') }, size: { width: 640, height: 480 } },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 640, height: 480 });
    registry.shutdown();
  });

  it('falls back to the topmost baseline layer when the first entry targets no known layer', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'ghost',
          documentSource: {
            layers: { 'layer-a': blankLayer('layer-a', 0), 'layer-b': blankLayer('layer-b', 1) },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.activeLayerId).toBe('layer-b');
    registry.shutdown();
  });

  it('treats a leading document source on a non-open action as the baseline', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-a',
          documentSource: {
            layers: { 'layer-a': blankLayer('layer-a') },
            size: initialSize,
            frame: baselineFrame,
          },
        },
        { id: 'tool', actionName: TOOL_ACTION, layerId: 'layer-a', args: { toolName: 'blur', radius: 2 } },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['tool']);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0]);
    registry.shutdown();
  });

  it('ranks a first bedrock source above the supplied initial frame at cursor -1', () => {
    const registry = new AssetRegistry();
    const bedrockSize = { width: 320, height: 240 };
    const history: HistoryItem[] = [
      {
        id: 'bedrock',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-bedrock',
        layerSource: { ...blankSource, isBedrock: true, size: bedrockSize },
      },
    ];
    const initialFrame = { x: 40, y: 50, width: 640, height: 480 };

    const converted = legacyHistoryToDurable(history, {
      documentId: 'test-doc',
      registry,
      initialFrame,
      initialSize: { width: 1, height: 1 },
    });

    // The first bedrock source establishes the opening document frame; the
    // store's current frame must not outrank it when replaying cursor -1.
    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, ...bedrockSize });
    expect(replayDurableDocument(converted.document, -1).frame).toEqual({ x: 0, y: 0, ...bedrockSize });
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable per-action option branches', () => {
  it('drops a rename whose name is not a string and records one for an unknown layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'rename-number', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 42 } },
        { id: 'rename-missing-arg', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1' },
        { id: 'rename-ghost', actionName: RENAME_LAYER_ACTION, layerId: 'ghost', args: { name: 'Ghost' } },
        { id: 'rename-ok', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Named' } },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    // A non-string name produces no entry at all. A rename for a layer the
    // conversion does not know is still recorded, so replaying the durable
    // document stays a faithful projection of the legacy history.
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['rename-ghost', 'rename-ok']);
    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'set-layer-properties',
      layerId: 'ghost',
      patch: { name: 'Ghost' },
    });
    // A dropped entry maps to the preceding durable cursor, never the tip.
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1, -1, 0, 1]);
    registry.shutdown();
  });

  it('ignores a reorder that names a layer outside the converted layer set', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'reorder-ghost', actionName: REORDER_ACTION, layerId: 'document', args: { layerToMoveId: 'ghost' } },
        { id: 'reorder-no-args', actionName: REORDER_ACTION, layerId: 'document' },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('moves a reordered layer to the top of the durable order when no anchor is named', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: null },
        },
      ],
      registry
    );

    const operation = converted.document.history[1]?.operation;
    expect(operation).toMatchObject({ kind: 'reorder-layers' });
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId).toEqual({ 'layer-1': 0, 'layer-b': 1 });
    registry.shutdown();
  });

  it('records a disabled reorder entry without applying it to the converted layers', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          disabled: true,
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: null },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].order).toBe(0);
    registry.shutdown();
  });

  it('keeps a disabled remove entry in history without removing the layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'remove', actionName: REMOVE_ACTION, layerId: 'layer-1', disabled: true }],
      registry
    );

    expect(converted.document.history[0]).toMatchObject({ enabled: false });
    expect(converted.document.history[0]?.operation).toEqual({ kind: 'remove-layer', layerId: 'layer-1' });
    registry.shutdown();
  });

  /**
   * The provenance invariant of HANDOFF §10: a snapshot names the frame it was
   * authored against, so a frame change is something a consumer can see rather
   * than something a snapshot silently absorbed.
   */
  it('records on every snapshot the frame it was authored against, and replay does not restamp it', () => {
    const registry = new AssetRegistry();
    const croppedFrame = { x: 20, y: 10, width: 200, height: 150 };

    const converted = convert(
      [
        { id: 'frame', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame: croppedFrame } },
        {
          id: 'layer-2',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-2',
          layerSource: {
            kind: 'blank',
            color: '#000000',
            opacity: 1,
            isBedrock: false,
            pos: { x: 20, y: 10, width: 100, height: 80 },
          },
        },
      ],
      registry
    );

    const replayed = replayDurableDocument(converted.document, converted.document.cursor);
    // The baseline layer predates the crop and the new layer follows it, so one
    // document legitimately holds two different provenance frames. Asserting
    // they differ is the whole point: a model that restamped on replay, or that
    // recorded no frame, would show one frame here and could not tell which
    // layer was authored in which.
    expect(replayed.frame).toStrictEqual(croppedFrame);
    expect(replayed.layers['layer-1']?.snapshot.frame).toStrictEqual(baselineFrame);
    expect(replayed.layers['layer-2']?.snapshot.frame).toStrictEqual(croppedFrame);
    // And the frozen baseline snapshot keeps its own frame rather than adopting
    // the document's later one.
    expect(converted.document.baseline.layers[0]?.frame).toStrictEqual(baselineFrame);
    registry.shutdown();
  });

  it('drops a document frame action that carries no next frame and reports the loss', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          // The id must not be the bare word `frame`: the message body says
          // "document frame" twice on its own, so `toContain('frame')` would pass
          // even with the interpolation removed.
          id: 'frame-without-next',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame },
        },
      ],
      registry
    );

    // Still dropped: an action with no usable `nextFrame` has no operation to
    // derive, and fabricating one would assert a frame the user never cropped to.
    expect(converted.document.history).toHaveLength(0);
    // And the drop is REPORTED rather than silent. `replayHistory` drops the
    // same entry (`history-replay.ts:112-117` guards the assignment on
    // `isValidDocumentFrame`), so the shadow was already in parity — but parity
    // is not observability, and the only other evidence of a lost crop is a
    // frame that no longer matches what the user cropped to.
    expect(converted.diagnostics).toHaveLength(1);
    expect(converted.diagnostics[0]).toMatchObject({
      historyId: 'frame-without-next',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      // WARNING, not error: `convertLegacyHistorySafely` withholds the ENTIRE
      // durable document on the first error diagnostic, so an error here would
      // punish every later entry for a defect the legacy timeline tolerates.
      severity: 'warning',
      code: 'invalid-history-entry',
    });
    // The message names the offending entry, so a warning is actionable without
    // the caller having to correlate it back to the cursor map itself. The id is
    // absent from the message body, so this pins the `${item.id}` interpolation.
    expect(converted.diagnostics[0]?.message).toContain('frame-without-next');
    registry.shutdown();
  });

  it('defaults the previous frame of a document frame action to the current frame', () => {
    const registry = new AssetRegistry();
    const nextFrame = { x: 10, y: 10, width: 200, height: 150 };

    const converted = convert(
      [{ id: 'frame', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame } }],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation).toEqual({ kind: 'set-document-frame', previous: baselineFrame, next: nextFrame });
    registry.shutdown();
  });

  it('keeps a disabled document frame entry without advancing the converted frame', () => {
    const registry = new AssetRegistry();
    const nextFrame = { x: 10, y: 10, width: 200, height: 150 };

    const converted = convert(
      [
        {
          id: 'frame',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          disabled: true,
          args: { nextFrame },
        },
        { id: 'frame-2', actionName: SET_DOCUMENT_FRAME_ACTION, layerId: 'document', args: { nextFrame } },
      ],
      registry
    );

    expect(converted.document.history.map((entry) => entry.enabled)).toEqual([false, true]);
    // The second frame operation's `previous` is still the untouched frame.
    expect(converted.document.history[1]?.operation).toMatchObject({ previous: baselineFrame });
    registry.shutdown();
  });

  it('defaults the before and after selection snapshots of a bare selection action', () => {
    const registry = new AssetRegistry();
    const nextSelection = {
      selections: [
        {
          id: 'sel',
          points: [{ x: 1, y: 2 }],
          isActive: true,
          pos: { x: 1, y: 2, width: 3, height: 4 },
          metadata: { featherRadius: 2 },
        },
      ],
      activeSelectionId: 'sel',
    };

    const converted = convert(
      [
        { id: 'sel-1', actionName: SELECTION_ACTION, layerId: 'layer-1', args: { nextSelectionState: nextSelection } },
        { id: 'sel-2', actionName: SELECTION_ACTION, layerId: 'layer-1' },
      ],
      registry
    );

    const [first, second] = converted.document.history.map((entry) => entry.operation);
    expect(first).toMatchObject({ kind: 'set-selection', before: { selections: [], activeSelectionId: null } });
    expect(first?.kind === 'set-selection' && first.after.selections[0].metadata).toEqual({ featherRadius: 2 });
    expect(second?.kind === 'set-selection' && second.before.selections[0].id).toBe('sel');
    expect(second).toMatchObject({ after: { selections: [], activeSelectionId: null } });
    registry.shutdown();
  });

  it('records a disabled selection action without changing the converted selection state', () => {
    const registry = new AssetRegistry();
    const nextSelection = {
      selections: [{ id: 'sel', points: [{ x: 0, y: 0 }], isActive: true, pos: { x: 0, y: 0, width: 1, height: 1 } }],
      activeSelectionId: 'sel',
    };

    const converted = convert(
      [
        {
          id: 'sel',
          actionName: SELECTION_ACTION,
          layerId: 'layer-1',
          disabled: true,
          args: { nextSelectionState: nextSelection },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.selections.selections).toEqual([]);
    registry.shutdown();
  });

  it('keeps a disabled merge entry without collapsing the converted layer set', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'merge', actionName: MERGE_ACTION, layerId: 'merged', layerSource: source, disabled: true },
      ],
      registry
    );

    const operation = converted.document.history[1]?.operation;
    expect(converted.document.history[1]?.enabled).toBe(false);
    expect(operation?.kind === 'merge-document' && operation.removedLayerIds).toEqual(['layer-1', 'layer-b']);
    registry.shutdown();
  });

  it('keeps a disabled reposition entry without moving the converted layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'move',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          disabled: true,
          args: { toolName: 'reposition', move: { x: 90, y: 90 } },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].pos).toEqual({ x: 0, y: 0, width: 100, height: 80 });
    registry.shutdown();
  });
});

/**
 * Every falsifying branch of `isValidDocumentFrame`
 * (`src/contexts/document-frame.ts:16`): the value is not an object, or any of
 * `x`/`y`/`width`/`height` is not a finite number, or `width <= 0`, or
 * `height <= 0`. The origin itself has no range constraint, so a negative
 * origin is valid and appears in the guard set below.
 */
const invalidNextFrames: ReadonlyArray<{ label: string; nextFrame: unknown }> = [
  { label: 'a non-object next frame', nextFrame: '400x300' },
  { label: 'a null next frame', nextFrame: null },
  { label: 'a zero width', nextFrame: { x: 0, y: 0, width: 0, height: 300 } },
  { label: 'a negative width', nextFrame: { x: 0, y: 0, width: -200, height: 300 } },
  { label: 'a zero height', nextFrame: { x: 0, y: 0, width: 400, height: 0 } },
  { label: 'a negative height', nextFrame: { x: 0, y: 0, width: 400, height: -150 } },
  { label: 'a NaN x coordinate', nextFrame: { x: Number.NaN, y: 0, width: 400, height: 300 } },
  { label: 'a NaN width', nextFrame: { x: 0, y: 0, width: Number.NaN, height: 300 } },
  { label: 'an infinite y coordinate', nextFrame: { x: 0, y: Number.POSITIVE_INFINITY, width: 400, height: 300 } },
  { label: 'a missing x coordinate', nextFrame: { y: 0, width: 400, height: 300 } },
  { label: 'a non-numeric width', nextFrame: { x: 0, y: 0, width: '400', height: 300 } },
];

const validNextFrames: ReadonlyArray<{ label: string; nextFrame: DocumentFrame }> = [
  { label: 'a positive origin', nextFrame: { x: 10, y: 20, width: 200, height: 150 } },
  { label: 'a negative origin', nextFrame: { x: -30, y: -40, width: 200, height: 150 } },
  { label: 'a fractional positive size', nextFrame: { x: 0, y: 0, width: 0.5, height: 0.25 } },
];

describe('document frame conversion diagnostics', () => {
  it.each(invalidNextFrames)('omits and reports a document frame change carrying $label', ({ nextFrame }) => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'frame-invalid',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame: nextFrame as DocumentFrame },
        },
      ],
      registry
    );

    // The invalid payload produces no durable operation at all...
    expect(converted.document.history).toHaveLength(0);
    // ...and the omission is reported, so the shadow cannot claim to be a
    // faithful conversion of a frame change it silently dropped.
    expect(converted.diagnostics).toHaveLength(1);
    expect(converted.diagnostics[0]).toMatchObject({
      historyId: 'frame-invalid',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      severity: 'warning',
      code: 'invalid-history-entry',
    });
    expect(converted.diagnostics[0]?.message).toContain('frame-invalid');
    // A skipped entry maps to the preceding durable cursor, never the tip.
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, -1]);
    registry.shutdown();
  });

  it.each(validNextFrames)('converts a document frame change with $label and no diagnostic', ({ nextFrame }) => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'frame-valid',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame },
        },
      ],
      registry
    );

    // The omitted-entry warning is not over-broad: a frame the predicate
    // accepts still converts and still reports nothing.
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(1);
    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'set-document-frame',
      previous: baselineFrame,
      next: nextFrame,
    });
    registry.shutdown();
  });

  it('keeps a rejected frame change from advancing the converted frame', () => {
    const registry = new AssetRegistry();
    const validFrame = { x: 10, y: 10, width: 200, height: 150 };

    const converted = convert(
      [
        {
          id: 'frame-invalid',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame: { x: 0, y: 0, width: 0, height: 300 } as DocumentFrame },
        },
        {
          id: 'frame-valid',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { nextFrame: validFrame },
        },
      ],
      registry
    );

    expect(converted.diagnostics).toHaveLength(1);
    expect(converted.diagnostics[0]?.historyId).toBe('frame-invalid');
    // The rejected frame never became the converted frame, so the next entry
    // still resolves its `previous` against the baseline.
    expect(converted.document.history).toHaveLength(1);
    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'set-document-frame',
      previous: baselineFrame,
      next: validFrame,
    });
    registry.shutdown();
  });

  it('reports the omission through the safe entry point while keeping the shadow available', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');

    const attempt = convertLegacyHistorySafely(
      [
        ...baselineHistory(),
        {
          id: 'frame-invalid',
          actionName: SET_DOCUMENT_FRAME_ACTION,
          layerId: 'document',
          args: { previousFrame: baselineFrame, nextFrame: { x: 0, y: 0, width: 0, height: 300 } as DocumentFrame },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    // A warning omits one entry and nothing else, so the conversion is still
    // committed and still consumable: the omission is surfaced through
    // `diagnostics`, not by withholding the whole shadow.
    expect(attempt.status).toBe('current');
    expect(attempt.document).not.toBeNull();
    expect(attempt.document?.history).toHaveLength(0);
    expect(reconcile).toHaveBeenCalledOnce();
    // The status alone no longer implies faithfulness: the warning is in the
    // same result any consumer reads the status from.
    expect(attempt.diagnostics).toHaveLength(1);
    expect(attempt.diagnostics[0]).toMatchObject({
      historyId: 'frame-invalid',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      severity: 'warning',
      code: 'invalid-history-entry',
    });
    expect(attempt.diagnostics[0]?.message).toContain('frame-invalid');
    registry.shutdown();
  });
});

/**
 * Where the durable shadow and legacy replay genuinely disagree, or where one of
 * them is silent. These pin CURRENT behaviour, including the behaviour that is
 * wrong: a test here is a tripwire that makes a future fix visible, not an
 * endorsement of the divergence.
 */
describe('durable shadow divergences from legacy replay', () => {
  /**
   * NOT a protection for the first test below. Its only entry is a disabled one
   * carrying a `documentSource`, and `replayHistory` skips a disabled item at
   * `history-replay.ts:75` — before it could reach a dependency — and applies a
   * `documentSource` by assignment at `history-replay.ts:79-96`, which also
   * returns before any dependency call. So neither body can run for that
   * fixture, and `expect(legacy.layers).toEqual({})` is the assertion that
   * carries the test; deleting it because these deps "already" throw leaves a
   * green test pinning nothing. They stay as a tripwire against a future replay
   * that starts routing a skipped entry through `createLayer`/`applyRasterTool`.
   */
  const unreachableDependencies: HistoryReplayDependencies = {
    createLayer: () => {
      throw new Error('a disabled history entry must not create a layer');
    },
    applyRasterTool: () => {
      throw new Error('a disabled history entry must not rasterize');
    },
  };

  it('a disabled first entry replays as the empty state legacy replays', () => {
    const registry = new AssetRegistry();
    const disabledOpen = openingEntry('baseline', true);

    const converted = legacyHistoryToDurable([disabledOpen], { documentId: 'test-doc', registry });
    const replayed = replayDurableDocument(converted.document, -1);
    const legacy = replayHistory([disabledOpen], 0, initialSize, unreachableDependencies);

    // `replayHistory` skips a disabled item outright (`history-replay.ts:75`),
    // so the document the USER sees after disabling the first History row is
    // empty. The durable baseline now follows the same rule.
    expect(legacy.layers).toEqual({});
    expect(replayed.layers).toEqual({});
    expect(converted.document.baseline.layers).toEqual([]);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1]);
    expect(converted.diagnostics).toMatchObject([
      {
        historyId: 'baseline',
        actionName: OPEN_DOCUMENT_ACTION,
        severity: 'warning',
        code: 'invalid-history-entry',
      },
    ]);
    registry.shutdown();
  });
});

/**
 * The counterpart of the divergence above, and now an AGREEMENT rather than a
 * divergence: `replayHistory` lets a bedrock source size the document only for the
 * initial entry (`history-replay.ts:104-109`), which is the answer the converter's
 * create-layer arm already gave on its own. Neither side reports anything, so this
 * is the only thing standing between the two documents and a second divergence at
 * the same commit.
 */
describe('bedrock frame authority between durable shadow and legacy replay', () => {
  /**
   * Duplicates the production layer-construction shape (`createLayerSource` in
   * `layer-utils.ts:166`) so `replayHistory` has a `Layer` to insert. Returning a
   * `Layer` at all is load-bearing (the call would throw otherwise); the fields are
   * not, so treat any change here as untested.
   */
  function runtimeLayerFor(layerId: LayerId, source: LayerSource): Layer {
    const size = source.isBedrock ? source.size : { width: source.pos.width, height: source.pos.height };
    return {
      ...blankLayer(layerId),
      isBedrock: !!source.isBedrock,
      pos: source.isBedrock ? { x: 0, y: 0, ...size } : { ...source.pos },
      source,
    };
  }

  it('leaves the durable frame at the pre-add size when a bedrock layer is added mid-history', () => {
    const registry = new AssetRegistry();
    const bedrockSize = { width: 320, height: 240 };
    const bedrockSource: LayerSource = {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: true,
      size: bedrockSize,
    };
    const history: HistoryItem[] = [
      ...baselineHistory(),
      { id: 'bedrock', actionName: NEW_LAYER_ACTION, layerId: 'layer-bedrock', layerSource: bedrockSource },
    ];
    const dependencies: HistoryReplayDependencies = {
      createLayer: ({ layerId, source }) => runtimeLayerFor(layerId, source),
      applyRasterTool: () => {
        throw new Error('a create-layer action must not rasterize');
      },
    };

    const converted = legacyHistoryToDurable(history, { documentId: 'test-doc', registry });
    const legacy = replayHistory(history, 1, initialSize, dependencies);

    // A bedrock source sizes the DOCUMENT, so `replayHistory` lets it establish the
    // frame only for the initial document entry (`history-replay.ts:104-109`) and a
    // later layer commit leaves `documentFrame` alone. That is what the user asked
    // for, and it is the SAME answer the converter already gave.
    expect(legacy.documentFrame).toEqual(baselineFrame);
    expect(legacy.totalSize).toEqual(initialSize);
    // The converter's create-layer arm likewise never touches `currentFrame`, and
    // `replayDurableDocument`'s create-layer case ignores `isBedrock`
    // (`durable-replay.ts:61-67`), so the two AGREE at the pre-add size. The
    // document has exactly ONE durable entry, so -1 and 0 are the only two
    // positions `replayDurableDocument` can return — any larger cursor clamps to 0
    // and would assert the tip twice.
    expect(replayDurableDocument(converted.document, -1).frame).toEqual(baselineFrame);
    expect(replayDurableDocument(converted.document, 0).frame).toEqual(baselineFrame);
    // The layer itself IS still published by both, so neither the frame nor the
    // layer set diverges, and the conversion still reports no diagnostic.
    expect(Object.keys(replayDurableDocument(converted.document, -1).layers)).toEqual(['layer-1']);
    expect(Object.keys(replayDurableDocument(converted.document, 0).layers)).toEqual(['layer-1', 'layer-bedrock']);
    expect(Object.keys(legacy.layers)).toEqual(['layer-1', 'layer-bedrock']);
    expect(converted.diagnostics).toEqual([]);
    registry.shutdown();
  });
});

/**
 * The diagnostic that makes the disabled-baseline divergence in the describe
 * above OBSERVABLE. The behaviour it reports is unchanged and still wrong; these
 * tests pin that the divergence is now NAMED, that the warning is scoped to the
 * case where it holds, and that reporting it does not cost the user the document.
 */
describe('disabled durable baseline reporting', () => {
  /**
   * No dependency is reachable for any fixture below: an item carrying a
   * `documentSource` returns at `history-replay.ts:78-84` before either call, and
   * a disabled item is skipped at `history-replay.ts:74` before the loop body.
   * They are tripwires against a future replay that routes either shape through a
   * layer factory, not a protection for the assertions below.
   */
  const unreachableToolDependencies: HistoryReplayDependencies = {
    createLayer: () => {
      throw new Error('a baseline-carrying history entry must not create a layer');
    },
    applyRasterTool: () => {
      throw new Error('a baseline-carrying history entry must not rasterize');
    },
  };

  it('reports nothing for an enabled opening entry, which legacy replay does apply', () => {
    const registry = new AssetRegistry();
    const opened = openingEntry('opening-row', false);

    const converted = legacyHistoryToDurable([opened], { documentId: 'test-doc', registry });
    const legacy = replayHistory([opened], 0, initialSize, unreachableToolDependencies);

    // The guard is the ENABLED state, not "an entry was adopted as the baseline":
    // this row is the baseline and the conversion reports nothing at all, and it
    // converts exactly as it did before the warning existed.
    expect(converted.diagnostics).toEqual([]);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1]);
    expect(converted.document.baseline.frame).toEqual(baselineFrame);
    // And the two models AGREE here, so there would be nothing to report even if
    // a diagnostic could be raised: `replayHistory` skips only a disabled item, so
    // it applies the same opening state the durable baseline holds.
    expect(Object.keys(legacy.layers)).toEqual(['layer-1']);
    expect(Object.keys(replayDurableDocument(converted.document).layers)).toEqual(['layer-1']);
    registry.shutdown();
  });

  it('keeps the shadow available for a disabled opening entry, where an error diagnostic would void it', () => {
    const registry = new AssetRegistry();

    const attempt = convertLegacyHistorySafely([openingEntry('opening-row', true)], {
      documentId: 'test-doc',
      registry,
    });

    // The SEVERITY is what this pins. `convertLegacyHistorySafely` rolls the asset
    // transaction back and returns `status: 'unavailable'` with a NULL document on
    // the first error diagnostic, so an error-severity naming of this divergence
    // would discard every later entry over a defect the legacy timeline already
    // tolerates — a strictly worse outcome than the divergence it reports.
    expect(attempt.diagnostics).toHaveLength(1);
    expect(attempt.diagnostics[0]?.severity).toBe('warning');
    expect(attempt.status).toBe('current');
    expect(attempt.document).not.toBeNull();
    registry.shutdown();
  });

  it('surfaces the disabled opening entry through the safe entry point on a document that still replays', () => {
    const registry = new AssetRegistry();
    const disabledOpen = openingEntry('opening-row', true);

    const attempt = convertLegacyHistorySafely([disabledOpen], { documentId: 'test-doc', registry });

    // The warning is in the SAME result any consumer reads `status` from, so
    // `status: 'current'` is not by itself a claim of faithfulness.
    expect(attempt.diagnostics).toHaveLength(1);
    expect(attempt.diagnostics[0]).toMatchObject({
      historyId: 'opening-row',
      actionName: OPEN_DOCUMENT_ACTION,
      severity: 'warning',
      code: 'invalid-history-entry',
    });
    expect(attempt.diagnostics[0]?.message).toContain('opening-row');
    // The document handed back is still consumable, and it AGREES with what the
    // user sees: `replayHistory` skips a disabled entry, so the baseline is
    // empty rather than the opening state, and the two models say the same thing
    // at this cursor. That is the fix, not the divergence this test used to pin.
    const document = attempt.document as DurableDocument;
    expect(Object.keys(replayDurableDocument(document).layers)).toEqual([]);
    expect(document.baseline.layers).toEqual([]);
    expect(attempt.legacyCursorToDurableCursor).toEqual([-1]);
    registry.shutdown();
  });

  it('counts a nested args.enabled false as a disabled opening entry, which legacy replay still applies', () => {
    const registry = new AssetRegistry();
    const nested: HistoryItem = {
      id: 'nested-row',
      actionName: OPEN_DOCUMENT_ACTION,
      layerId: 'layer-1',
      args: { enabled: false },
      documentSource: {
        layers: { 'layer-1': blankLayer('layer-1') },
        size: initialSize,
        frame: baselineFrame,
      },
    };

    const converted = legacyHistoryToDurable([nested], { documentId: 'test-doc', registry });
    const legacy = replayHistory([nested], 0, initialSize, unreachableToolDependencies);

    // The second half of `isEntryEnabled` (`history-adapter.ts:433-436`): a
    // disabled entry is `item.disabled` OR a nested `args.enabled === false`.
    expect(converted.diagnostics).toHaveLength(1);
    expect(converted.diagnostics[0]).toMatchObject({
      historyId: 'nested-row',
      severity: 'warning',
      code: 'invalid-history-entry',
    });
    expect(converted.diagnostics[0]?.message).toContain('nested-row');
    // `isEntryEnabled` treats a nested `args.enabled === false` as disabled, and
    // the baseline is gated on exactly that predicate — so the durable baseline is
    // empty here.
    //
    // KNOWN OVER-BREADTH, pinned as-is rather than endorsed: `replayHistory` gates
    // on `item.disabled` ALONE (`history-replay.ts:74`), so it APPLIES this
    // document source and the legacy timeline describes a full document. The two
    // models therefore DISAGREE on this row, and the warning is what names it.
    // Whether the guard should be scoped to `item.disabled` is left open; what the
    // code does today is pinned.
    expect(Object.keys(legacy.layers)).toEqual(['layer-1']);
    expect(Object.keys(replayDurableDocument(converted.document).layers)).toEqual([]);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1]);
    registry.shutdown();
  });

  it('reports no opening-state divergence for a timeline whose first entry is not an open document', () => {
    const registry = new AssetRegistry();
    const disabledCreate: HistoryItem = {
      id: 'create-row',
      actionName: NEW_LAYER_ACTION,
      layerId: 'layer-2',
      layerSource: blankSource,
      disabled: true,
    };

    const converted = legacyHistoryToDurable([disabledCreate], { documentId: 'test-doc', registry });
    const legacy = replayHistory([disabledCreate], 0, initialSize, unreachableToolDependencies);

    // No entry carries a document source, so `snapshotFromDocumentSource` finds
    // nothing, the baseline-adoption branch is never entered and the warning is
    // UNREACHABLE. A disabled row that does not carry the opening state reports
    // nothing at all, whatever its disabled shape.
    expect(converted.diagnostics).toEqual([]);
    // The baseline is the derived fallback rather than a document's opening state:
    // with no document source and no options the frame is 1x1 and there are no
    // layers, so nothing claims a document the legacy timeline never described.
    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(converted.document.baseline.layers).toEqual([]);
    // The entry is still PUBLISHED and still disabled, and both models skip it —
    // which is why there is nothing here to report.
    expect(converted.document.history.map((entry) => entry.enabled)).toEqual([false]);
    expect(Object.keys(legacy.layers)).toEqual([]);
    expect(Object.keys(replayDurableDocument(converted.document).layers)).toEqual([]);
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable argument conversion branches', () => {
  it('rejects tool arguments that are an array carrying a tool name', () => {
    const registry = new AssetRegistry();
    const args = Object.assign([], { toolName: 'blur', radius: 2 });

    const converted = convert([{ id: 'array-args', actionName: TOOL_ACTION, layerId: 'layer-1', args }], registry);

    expect(converted.diagnostics).toEqual([
      expect.objectContaining({ code: 'invalid-history-entry', historyId: 'array-args' }),
    ]);
    expect(converted.diagnostics[0]?.message).toBe('Expected object at history:array-args.args');
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('unwraps tool arguments nested under an args property', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'nested',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'blur', args: { toolName: 'levels', brightness: 1, contrast: 2 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[0]?.operation).toMatchObject({
      kind: 'apply-filter',
      filter: { toolName: 'levels' },
    });
    registry.shutdown();
  });

  it('keeps nested array arguments in a durable filter payload', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'dash',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'levels', brightness: 1, contrast: 2, stops: [0, 0.5, 1] },
        },
      ],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation?.kind === 'apply-filter' && operation.filter.args.stops).toEqual([0, 0.5, 1]);
    registry.shutdown();
  });

  it('rejects a non-finite value nested inside an array argument', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'non-finite',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'levels', brightness: 1, contrast: 2, stops: [0, Number.POSITIVE_INFINITY] },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch(/Non-finite value at/);
    registry.shutdown();
  });

  it('drops a non-object tool argument rather than recording a no-op entry', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'primitive', actionName: TOOL_ACTION, layerId: 'layer-1', args: 42 } as unknown as HistoryItem],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('rejects a transform that combines a trapezoid with retained affine values', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'both',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'transform', trapezoid: 20, transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch('A transform cannot combine trapezoid and affine values');
    registry.shutdown();
  });

  it('rejects a retained transform whose values are not finite', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'bad-matrix',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'transform', transform: { a: 1, b: 0, c: 0, d: 1, e: Number.NaN, f: 0 } },
        },
      ],
      registry
    );

    expect(converted.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(converted.diagnostics[0]?.message).toMatch(/invalid or extreme values/);
    registry.shutdown();
  });

  it('rejects a raw trapezoid transform that also carries affine values', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'mixed', actionName: TOOL_ACTION, layerId: 'layer-1', args: transformArgs({ trapezoid: 20, rotate: 5 }) }],
      registry
    );

    expect(converted.diagnostics[0]?.message).toMatch('Mixed trapezoid and affine transform is unsupported');
    registry.shutdown();
  });

  it('rejects a raster transform whose processor replay version no longer matches', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'trapezoid', actionName: TOOL_ACTION, layerId: 'layer-1', args: transformArgs({ trapezoid: 20 }) }],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[0]?.operation).toMatchObject({
      kind: 'apply-raster-processor',
      processorId: 'transform',
      version: 1,
    });
    registry.shutdown();
  });
});

describe('legacyHistoryToDurable source helpers', () => {
  it('rejects a legacy source whose kind is not a known layer source', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'odd-source',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-2',
          args: { kind: 'vector', toolName: 'shape' },
        },
      ],
      registry
    );

    // The unknown kind is not treated as a layer source, so the action is an
    // unsupported legacy action rather than a create-layer.
    expect(converted.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(converted.diagnostics[0]?.message).toMatch('Unsupported legacy action');
    registry.shutdown();
  });

  it.each([
    {
      label: 'a non-bedrock image source carried in args',
      args: {
        kind: 'image',
        bitmap: { width: 12, height: 9 },
        name: 'In-args',
        isBedrock: false,
        pos: { x: 1, y: 2, width: 12, height: 9 },
      },
      expectedSource: { kind: 'raster', width: 12, height: 9, isBedrock: false, name: 'In-args' },
    },
    {
      label: 'a bedrock image source carried in args',
      args: {
        kind: 'image',
        bitmap: { width: 12, height: 9 },
        isBedrock: true,
        size: { width: 12, height: 9 },
      },
      expectedSource: { kind: 'raster', width: 12, height: 9, isBedrock: true },
    },
  ])('creates a layer from $label', ({ args, expectedSource }) => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'image-source', actionName: NEW_LAYER_ACTION, layerId: 'layer-2', args } as unknown as HistoryItem],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(converted.diagnostics).toEqual([]);
    expect(operation).toMatchObject({ kind: 'create-layer', layer: { id: 'layer-2' } });
    expect(operation?.kind === 'create-layer' && operation.layer.source).toMatchObject(expectedSource);
    registry.shutdown();
  });

  it('derives a bedrock tool source size from the recorded size rather than the position', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'bedrock-tool',
          actionName: NEW_LAYER_ACTION,
          layerId: 'layer-bedrock',
          layerSource: {
            kind: 'tool',
            args: { toolName: 'shape', figure: 'rectangle' },
            isBedrock: true,
            size: { width: 320, height: 240 },
          },
        } as unknown as HistoryItem,
      ],
      registry
    );

    const operation = converted.document.history[0]?.operation;
    expect(operation?.kind === 'create-layer' && operation.layer.source).toMatchObject({
      kind: 'vector',
      size: { width: 320, height: 240 },
      isBedrock: true,
    });
    expect(operation?.kind === 'create-layer' && operation.layer.pos).toEqual({ x: 0, y: 0, width: 320, height: 240 });
    registry.shutdown();
  });

  it('a blank snapshot carries layer opacity 1 and source opacity unchanged', () => {
    const registry = new AssetRegistry();
    const source: LayerSource = {
      ...blankSource,
      opacity: 0.35,
      pos: { x: 4, y: 5, width: 100, height: 80 },
    };

    const converted = convert(
      [{ id: 'translucent-blank', actionName: NEW_LAYER_ACTION, layerId: 'blank', layerSource: source }],
      registry
    );
    const operation = converted.document.history[0]?.operation;

    expect(operation?.kind).toBe('create-layer');
    if (operation?.kind === 'create-layer') {
      expect(operation.layer.opacity).toBe(1);
      expect(operation.layer.source).toMatchObject({ kind: 'blank', opacity: 0.35 });
    }
    registry.shutdown();
  });

  it('derives a paint tool blend mode from the source args', () => {
    const registry = new AssetRegistry();
    const source: LayerSource = {
      kind: 'tool',
      args: { toolName: 'brush', blendMode: 'multiply' } as never,
      isBedrock: false,
      pos: { x: 0, y: 0, width: 20, height: 20 },
    };

    const converted = convert(
      [{ id: 'multiply-brush', actionName: NEW_LAYER_ACTION, layerId: 'brush', layerSource: source }],
      registry
    );
    const operation = converted.document.history[0]?.operation;

    expect(operation?.kind).toBe('create-layer');
    if (operation?.kind === 'create-layer') expect(operation.layer.blendMode).toBe('multiply');
    registry.shutdown();
  });
});

describe('conversion entry points', () => {
  it('passes a durable document straight through without re-converting it', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const converted = convertLegacyHistory(document, { registry });

    expect(converted.diagnostics).toEqual([]);
    expect(converted.legacyCursorToDurableCursor).toEqual([]);
    expect(converted.document).toEqual(document);
    expect(converted.document).not.toBe(document);
    registry.shutdown();
  });

  it('accepts a durable document through the safe conversion entry point', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const attempt = convertLegacyHistorySafely(document, { registry });

    expect(attempt.status).toBe('current');
    expect(attempt.document?.documentId).toBe('test-doc');
    registry.shutdown();
  });

  it('honours the document id of a durable document when none is supplied', () => {
    const registry = new AssetRegistry();
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    const attempt = convertLegacyHistorySafely(document, { registry });

    expect(attempt.document?.documentId).toBe('test-doc');
    expect(attempt.legacyCursorToDurableCursor).toEqual([]);
    registry.shutdown();
  });

  it('exposes legacyHistoryToDurable under the compatibility alias', () => {
    const registry = new AssetRegistry();

    expect(convertLegacyHistory).toBe(legacyHistoryToDurable);
    expect(convertLegacyHistory(baselineHistory(), { documentId: 'test-doc', registry }).document.documentId).toBe(
      'test-doc'
    );
    registry.shutdown();
  });

  it('reconciles assets once for a durable document that was handed in directly', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    const document = legacyHistoryToDurable(baselineHistory(), { documentId: 'test-doc', registry }).document;

    convertLegacyHistorySafely(document, { registry });

    // The pass-through branch reconciles exactly like the array branch: a document handed in
    // directly is still the current reachable set for its document id, so skipping the
    // reconcile would leave assets unreachable by a document that never lost them.
    expect(reconcile).toHaveBeenCalledOnce();
    // And it reconciles with THIS document's own ids, which for a blank-only
    // baseline is the empty set. `expect.any(Set)` also accepted a set carrying
    // some other document's stray asset ids, which `reconcileDocumentAssets` would
    // read as "this document no longer reaches them" and release.
    expect(reconcile).toHaveBeenCalledWith('test-doc', new Set());
    registry.shutdown();
  });

  it('carries the store revisions the conversion was given into the published document', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry,
      { documentRevision: 7, branchRevision: 3, durableRevision: 41 }
    );

    // The store is the only caller that supplies these three — the
    // `convertLegacyHistorySafely` call in `StoreContext.tsx` — and it compares revisions to
    // detect a stale append, so the plumbing is load-bearing and otherwise unpinned: every other
    // conversion in this suite converts into a document that starts at zero, so
    // replacing `options.branchRevision ?? 0` with a literal `0` — or recomputing
    // `durableRevision` as `entries.length` and discarding the store's — would
    // pass every other test here and break the boundary silently.
    expect(converted.document.history).toHaveLength(1);
    expect(converted.document.documentRevision).toBe(7);
    expect(converted.document.branchRevision).toBe(3);
    expect(converted.document.durableRevision).toBe(41);
    registry.shutdown();
  });

  it('defaults the durable revision of a converted document to its own entry count', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    // One entry means revision 1, not revision 0: the store appends the next entry
    // at `durableRevision + 1`, so a literal-0 default would hand every converted
    // document a revision indistinguishable from one that had never been appended
    // to. The relative `+ 1` assertions elsewhere cannot see this, because they
    // compare against whatever the conversion produced.
    expect(converted.document.history).toHaveLength(1);
    expect(converted.document.durableRevision).toBe(1);
    expect(converted.document.documentRevision).toBe(0);
    expect(converted.document.branchRevision).toBe(0);
    registry.shutdown();
  });

  it('does not reconcile assets for a conversion that was rejected', () => {
    const registry = new AssetRegistry();
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');

    const attempt = convertLegacyHistorySafely(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: {
              'layer-1': { ...blankLayer('layer-1'), source: undefined, bitmap: null },
            },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    // This is the genuinely non-reconciling path. A rejected conversion never became the
    // document, so its partial asset set is not the reachable set: reconciling against it
    // would release assets the surviving legacy document still references.
    expect(attempt.status).toBe('unavailable');
    expect(reconcile).not.toHaveBeenCalled();
    registry.shutdown();
  });
});

describe('deriveSetLayerPropertiesEntry', () => {
  it.each([
    { label: 'show', actionName: SHOW_LAYER_ACTION },
    { label: 'hide', actionName: HIDE_LAYER_ACTION },
    { label: 'rename', actionName: RENAME_LAYER_ACTION },
  ] satisfies ReadonlyArray<{ label: string; actionName: ActionType }>)('accepts $label', ({ actionName }) => {
    expect(isSetLayerPropertiesAction(actionName)).toBe(true);
  });

  it.each([
    { label: 'a tool action', actionName: TOOL_ACTION },
    { label: 'a new layer', actionName: NEW_LAYER_ACTION },
    { label: 'a removal', actionName: REMOVE_ACTION },
    { label: 'a merge', actionName: MERGE_ACTION },
    { label: 'a reorder', actionName: REORDER_ACTION },
    { label: 'a selection change', actionName: SELECTION_ACTION },
    { label: 'a document frame change', actionName: SET_DOCUMENT_FRAME_ACTION },
    { label: 'a document open', actionName: OPEN_DOCUMENT_ACTION },
  ] satisfies ReadonlyArray<{ label: string; actionName: ActionType }>)('refuses $label', ({ actionName }) => {
    // The whitelist is what stops a writer from turning an arbitrary action into
    // a durable patch, so it is closed in both directions.
    expect(isSetLayerPropertiesAction(actionName)).toBe(false);
    expect(
      deriveSetLayerPropertiesEntry({ id: 'x', actionName, layerId: 'layer-1', args: { name: 'Renamed' } })
    ).toBeNull();
  });

  it.each([
    { label: 'show', actionName: SHOW_LAYER_ACTION, patch: { visible: true } },
    { label: 'hide', actionName: HIDE_LAYER_ACTION, patch: { visible: false } },
    { label: 'a rename', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' }, patch: { name: 'Renamed' } },
    { label: 'a rename to an empty name', actionName: RENAME_LAYER_ACTION, args: { name: '' }, patch: { name: '' } },
  ] satisfies ReadonlyArray<{
    label: string;
    actionName: ActionType;
    args?: object;
    patch: DurableLayerPropertyPatch;
  }>)('derives $label as the one property the action owns', ({ actionName, args, patch }) => {
    const derived = deriveSetLayerPropertiesEntry({
      id: 'prop-1',
      actionName,
      layerId: 'layer-1',
      ...(args ? { args } : {}),
    });

    expect(derived).toEqual({
      id: 'prop-1',
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch },
    });
    const operation = derived?.operation;
    const derivedPatch = operation?.kind === 'set-layer-properties' ? operation.patch : null;
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(derivedPatch)).toBe(true);
  });

  it('derives nothing from a rename that carries no string name', () => {
    const derive = (args?: object) =>
      deriveSetLayerPropertiesEntry({
        id: 'rename',
        actionName: RENAME_LAYER_ACTION,
        layerId: 'layer-1',
        ...(args ? { args } : {}),
      });

    expect(derive({ name: null })).toBeNull();
    expect(derive({ name: ['Renamed'] })).toBeNull();
    expect(derive({ name: { text: 'Renamed' } })).toBeNull();
    expect(derive({ opacity: 1 })).toBeNull();
    expect(derive()).toBeNull();
  });

  it('carries the disabled state of the legacy item onto the derived entry', () => {
    const derived = deriveSetLayerPropertiesEntry({
      id: 'hide-disabled',
      actionName: HIDE_LAYER_ACTION,
      layerId: 'layer-1',
      disabled: true,
    });

    expect(derived).toMatchObject({ id: 'hide-disabled', enabled: false });
    expect(derived?.operation).toEqual({ kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: false } });
  });
});

describe('legacyHistoryToDurable layer bookkeeping actions', () => {
  it.each([
    { label: 'show', actionName: SHOW_LAYER_ACTION, expectedVisible: true },
    { label: 'hide', actionName: HIDE_LAYER_ACTION, expectedVisible: false },
  ] satisfies ReadonlyArray<{ label: string; actionName: ActionType; expectedVisible: boolean }>)(
    'records a $label action as a durable visibility patch',
    ({ actionName, expectedVisible }) => {
      const registry = new AssetRegistry();

      const converted = convert(
        [
          { id: 'ghost', actionName, layerId: 'ghost' },
          { id: 'layer-1', actionName, layerId: 'layer-1' },
        ],
        registry
      );

      expect(converted.diagnostics).toEqual([]);
      expect(converted.document.history.map((entry) => entry.operation)).toEqual([
        { kind: 'set-layer-properties', layerId: 'ghost', patch: { visible: expectedVisible } },
        { kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: expectedVisible } },
      ]);
      registry.shutdown();
    }
  );

  it('keeps a disabled visibility patch from changing the converted layer', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [{ id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1', disabled: true }],
      registry
    );

    expect(converted.document.history[0]?.enabled).toBe(false);
    expect(converted.document.baseline.layers[0].visible).toBe(true);
    registry.shutdown();
  });

  it('records a disabled rename without applying it to the running layer set', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'rename',
          actionName: RENAME_LAYER_ACTION,
          layerId: 'layer-1',
          args: { name: 'Renamed' },
          disabled: true,
        },
      ],
      registry
    );

    // The entry is still recorded, so an undo that re-enables it replays the name
    // the legacy timeline describes. `enabled` is the only gate on it, and the
    // running layer set is left alone.
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[0]).toMatchObject({
      enabled: false,
      operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed' } },
    });
    expect(converted.document.baseline.layers[0].name).toBe('layer-1');
    registry.shutdown();
  });

  it('records exactly one property per entry and leaves the pre-history baseline alone', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1' },
        { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Renamed' } },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    // One property per entry: a hide that also renamed, or a rename that also
    // hid, would move a property the legacy item never described.
    expect(converted.document.history.map((entry) => entry.operation)).toEqual([
      { kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: false } },
      { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed' } },
    ]);
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0, 1]);
    // The baseline is the state those entries replay from, so it holds the
    // pre-history layer rather than the renamed and hidden one.
    expect(converted.document.baseline.layers[0]).toMatchObject({
      name: 'layer-1',
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      pos: { x: 0, y: 0, width: 100, height: 80 },
    });
    registry.shutdown();
  });

  it('keeps recording a property action for a layer an earlier entry removed', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'remove', actionName: REMOVE_ACTION, layerId: 'layer-1' },
        { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1' },
        { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Renamed' } },
      ],
      registry
    );

    // A property action resolves no layer, so it must not turn a rename of a
    // removed layer into the `Layer is unavailable` failure that voids the whole
    // conversion: the legacy timeline replays all three.
    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history.map((entry) => entry.operation)).toEqual([
      { kind: 'remove-layer', layerId: 'layer-1' },
      { kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: false } },
      { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed' } },
    ]);
    registry.shutdown();
  });

  it('resolves the layer for a tool action that follows a property action', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        { id: 'hide', actionName: HIDE_LAYER_ACTION, layerId: 'layer-1' },
        { id: 'blur', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history[1]?.operation).toMatchObject({ kind: 'apply-filter' });
    registry.shutdown();
  });

  it('reorders a layer after an explicit anchor', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'new-c', actionName: NEW_LAYER_ACTION, layerId: 'layer-c', layerSource: source },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-c' },
        },
      ],
      registry
    );

    const operation = converted.document.history[2]?.operation;
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId).toEqual({
      'layer-b': 0,
      'layer-c': 1,
      'layer-1': 2,
    });
    registry.shutdown();
  });

  it('records no operation for a reorder whose named anchor is absent, as legacy replay skips it', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'new-c', actionName: NEW_LAYER_ACTION, layerId: 'layer-c', layerSource: source },
        {
          id: 'reorder-ghost-anchor',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-c', afterWhichLayerId: 'ghost' },
        },
      ],
      registry
    );

    expect(converted.diagnostics).toEqual([]);
    // `replayHistory` `continue`s on a named-but-absent anchor
    // (`history-replay.ts:148`), so the shadow records no entry at all. The
    // tolerated alternative would be a fabricated move to index 0, which the
    // document never performs.
    expect(converted.document.history.map((entry) => entry.id)).toEqual(['new-b', 'new-c']);
    expect(converted.document.history.map((entry) => entry.operation.kind)).toEqual(['create-layer', 'create-layer']);
    // Before the fix this recorded a move of layer-c to index 0. The converted
    // order must still be the one replay leaves in place.
    const replayed = replayDurableDocument(converted.document);
    const ordered = Object.values(replayed.layers)
      .sort((left, right) => left.snapshot.order - right.snapshot.order)
      .map((layer) => layer.snapshot.id);
    expect(ordered).toEqual(['layer-1', 'layer-b', 'layer-c']);
    registry.shutdown();
  });

  it('maps a reorder skipped for an absent anchor to the preceding durable cursor', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        {
          id: 'reorder-ghost-anchor',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'ghost' },
        },
        {
          id: 'reorder-real-anchor',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-b' },
        },
      ],
      registry
    );

    expect(converted.document.history.map((entry) => entry.id)).toEqual(['new-b', 'reorder-real-anchor']);
    // Legacy cursors: [baseline(0), new-b(1), skipped reorder(2), reorder(3)].
    // The baseline seeds the document, so it maps to -1. `new-b` and the
    // surviving reorder own durable entries 0 and 1. The skipped reorder owns
    // none, so it maps to the durable entry that precedes it — 0, the same rule
    // a dropped rename uses — and never to the tip (1) it does not own.
    expect(converted.legacyCursorToDurableCursor).toEqual([-1, 0, 0, 1]);
    registry.shutdown();
  });

  it.each([
    {
      label: 'moves a layer to the bottom when no anchor is named',
      afterWhichLayerId: null,
      expectedOrder: { 'layer-1': 0, 'layer-b': 1 },
    },
    {
      label: 'places a layer directly after a present anchor',
      afterWhichLayerId: 'layer-b',
      expectedOrder: { 'layer-b': 0, 'layer-1': 1 },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    afterWhichLayerId: LayerId | null;
    expectedOrder: Record<LayerId, number>;
  }>)('$label', ({ afterWhichLayerId, expectedOrder }) => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        {
          id: 'reorder',
          actionName: REORDER_ACTION,
          layerId: 'document',
          args: { layerToMoveId: 'layer-1', afterWhichLayerId },
        },
      ],
      registry
    );

    const operation = converted.document.history[1]?.operation;
    expect(operation?.kind === 'reorder-layers' && operation.orderByLayerId).toEqual(expectedOrder);
    registry.shutdown();
  });

  it('collapses the converted layer set for an enabled merge', () => {
    const registry = new AssetRegistry();
    const source = blankSource;

    const converted = convert(
      [
        { id: 'new-b', actionName: NEW_LAYER_ACTION, layerId: 'layer-b', layerSource: source },
        { id: 'merge', actionName: MERGE_ACTION, layerId: 'merged', layerSource: source },
        { id: 'after-merge', actionName: TOOL_ACTION, layerId: 'layer-b', args: { toolName: 'blur', radius: 1 } },
      ],
      registry
    );

    const merge = converted.document.history[1]?.operation;
    expect(merge).toMatchObject({ kind: 'merge-document', removedLayerIds: ['layer-1', 'layer-b'] });
    // `layer-b` was folded into the merge, so a later tool action for it is
    // rejected rather than silently retargeted.
    expect(converted.diagnostics.at(-1)?.message).toMatch('Layer layer-b is unavailable');
    registry.shutdown();
  });

  it('applies an enabled reposition to the converted layer position', () => {
    const registry = new AssetRegistry();

    const converted = convert(
      [
        {
          id: 'move',
          actionName: TOOL_ACTION,
          layerId: 'layer-1',
          args: { toolName: 'reposition', move: { x: 7, y: 9 } },
        },
      ],
      registry
    );

    expect(converted.document.history[0]?.operation).toEqual({
      kind: 'reposition-layer',
      layerId: 'layer-1',
      move: { x: 7, y: 9 },
    });
    expect(converted.diagnostics).toEqual([]);
    registry.shutdown();
  });

  it('records a resize-only reposition without a move key', () => {
    const registry = new AssetRegistry();
    const resize = { x: 1, y: 2, width: 30, height: 20 };

    const converted = convert(
      [{ id: 'resize', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'reposition', resize } }],
      registry
    );

    expect(converted.document.history[0]?.operation).toEqual({ kind: 'reposition-layer', layerId: 'layer-1', resize });
    expect(converted.diagnostics).toEqual([]);
    registry.shutdown();
  });

  it.each([
    { label: 'an empty reposition', args: { toolName: 'reposition' } },
    {
      label: 'a reposition with no move or resize',
      args: { toolName: 'reposition', move: undefined, resize: undefined },
    },
  ])('drops $label instead of recording a no-op entry', ({ args }) => {
    const registry = new AssetRegistry();

    const converted = convert([{ id: 'noop', actionName: TOOL_ACTION, layerId: 'layer-1', args }], registry);

    expect(converted.diagnostics).toEqual([]);
    expect(converted.document.history).toHaveLength(0);
    registry.shutdown();
  });

  it('derives a degenerate baseline frame from a document source that has neither frame nor size', () => {
    const registry = new AssetRegistry();
    const initialFrame = { x: 1, y: 2, width: 33, height: 44 };

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: { 'layer-1': blankLayer('layer-1') },
            size: undefined as unknown as { width: number; height: number },
          },
        },
      ],
      { documentId: 'test-doc', registry, initialFrame }
    );

    // A leading document source is always authoritative: the caller-supplied
    // `initialFrame` and `initialSize` never reach the baseline derivation, so a
    // document source without a frame and without a size yields a 0x0 frame.
    expect(converted.document.baseline.frame).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    registry.shutdown();
  });

  it('records a null baseline active layer for a document source with no layers', () => {
    const registry = new AssetRegistry();

    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: { layers: {}, size: initialSize, frame: baselineFrame },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(converted.document.baseline.activeLayerId).toBeNull();
    expect(converted.document.baseline.layers).toEqual([]);
    registry.shutdown();
  });
});

describe('durable document editing helpers', () => {
  function baseDocument(): DurableDocument {
    const registry = new AssetRegistry();
    const document = createDurableDocument({
      documentId: 'test-doc',
      documentRevision: 0,
      branchRevision: 0,
      baseline: {
        frame: baselineFrame,
        layers: [],
        selections: { selections: [], activeSelectionId: null },
        activeLayerId: null,
      },
      history: [],
      cursor: -1,
    });
    registry.shutdown();
    return document;
  }

  it('defaults the durable revision to zero', () => {
    expect(
      createDurableDocument({
        documentId: 'test-doc',
        documentRevision: 0,
        branchRevision: 0,
        baseline: {
          frame: baselineFrame,
          layers: [],
          selections: { selections: [], activeSelectionId: null },
          activeLayerId: null,
        },
        history: [],
        cursor: -1,
      }).durableRevision
    ).toBe(0);
  });

  it('keeps an explicit durable revision', () => {
    const document = baseDocument();
    expect(createDurableDocument({ ...document, durableRevision: 12 }).durableRevision).toBe(12);
  });

  it('appends an entry, truncating the redo tail and advancing both revisions', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );
    const undone = setDurableCursor(converted.document, 0);

    const appended = appendDurableEntry(undone, {
      id: 'c',
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'remove-layer', layerId: 'layer-1' },
    });

    expect(appended.history.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(appended.cursor).toBe(1);
    expect(appended.branchRevision).toBe(undone.branchRevision + 1);
    expect(appended.durableRevision).toBe(undone.durableRevision + 1);
    expect(undone.history.map((entry) => entry.id)).toEqual(['a', 'b']);
    registry.shutdown();
  });

  it.each([
    { label: 'a negative cursor below the empty position', cursor: -2 },
    { label: 'a cursor past the tip', cursor: 5 },
    { label: 'a non-integer cursor', cursor: 1.5 },
    { label: 'a non-finite cursor', cursor: Number.NaN },
  ])('returns the same document for $label', ({ cursor }) => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    expect(setDurableCursor(converted.document, cursor)).toBe(converted.document);
    registry.shutdown();
  });

  it('returns the same document for the cursor it already points at', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    expect(setDurableCursor(converted.document, converted.document.cursor)).toBe(converted.document);
    registry.shutdown();
  });

  it('moves the cursor down to the empty position below a non-empty history', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [{ id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } }],
      registry
    );

    const moved = setDurableCursor(converted.document, -1);

    // `-1` is the empty POSITION, not a refusal: it is the only cursor that
    // replays no entry at all, so it is the state the user is in before the first
    // edit. The refusal table above pins `-2`; a guard reading `cursor < 0` would
    // refuse this one too and leave the pre-history document unreachable.
    expect(moved).not.toBe(converted.document);
    expect(moved.cursor).toBe(-1);
    expect(moved.history.map((entry) => entry.id)).toEqual(['a']);
    // Moving the cursor is not a branch: only the durable revision moves.
    expect(moved.branchRevision).toBe(converted.document.branchRevision);
    expect(moved.durableRevision).toBe(converted.document.durableRevision + 1);
    registry.shutdown();
  });

  it('moves the cursor without disturbing the entry list and advances the durable revision', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );

    const moved = setDurableCursor(converted.document, 0);

    expect(moved.cursor).toBe(0);
    expect(moved.branchRevision).toBe(converted.document.branchRevision);
    expect(moved.durableRevision).toBe(converted.document.durableRevision + 1);
    expect(moved.history).toHaveLength(2);
    registry.shutdown();
  });

  it('leaves the branch revision alone when only the cursor moves', () => {
    const registry = new AssetRegistry();
    const converted = convert(
      [
        { id: 'a', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 1 } },
        { id: 'b', actionName: TOOL_ACTION, layerId: 'layer-1', args: { toolName: 'blur', radius: 2 } },
      ],
      registry
    );

    expect(toggleDurableEntry(converted.document, converted.document.history[0].id).branchRevision).toBe(
      converted.document.branchRevision + 1
    );
    expect(setDurableCursor(converted.document, 0).branchRevision).toBe(converted.document.branchRevision);
    registry.shutdown();
  });
});

describe('UnsupportedHistoryFeatureError construction', () => {
  it('keeps a stable code and name with an optional history id', () => {
    const withId = new UnsupportedHistoryFeatureError('nope', 'entry-1');
    const withoutId = new UnsupportedHistoryFeatureError('nope');

    expect(withId.code).toBe('unsupported-history-feature');
    expect(withId.name).toBe('UnsupportedHistoryFeatureError');
    expect(withId.historyId).toBe('entry-1');
    expect(withoutId.historyId).toBeUndefined();
    expect(withId).toBeInstanceOf(Error);
  });
});

describe('asset reachability of a rejected conversion', () => {
  it('leaves no asset registered for a conversion that never produced a durable document', () => {
    const registry = new AssetRegistry();
    // The handle is substituted wholesale, because which of the two the adapter
    // calls IS the assertion: `beginDocumentAssetTransaction` belongs to the
    // registry, and the decision to settle it with `rollback` belongs to the
    // adapter. `vi.spyOn` alone would record the call but leave the handle's two
    // closures unobservable.
    const commit = vi.fn();
    const rollback = vi.fn();
    const transaction = vi.spyOn(registry, 'beginDocumentAssetTransaction').mockReturnValue({ commit, rollback });
    const attempt = convertLegacyHistorySafely(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: {
              'layer-1': { ...blankLayer('layer-1'), source: undefined, bitmap: null },
            },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    expect(attempt.status).toBe('unavailable');
    expect(attempt.document).toBeNull();
    expect(attempt.diagnostics[0]?.code).toBe('unsupported-history-feature');
    expect(attempt.legacyCursorToDurableCursor).toEqual([]);
    // The claim in the title is the transaction, so assert the transaction. This
    // fixture registers nothing at all — `convertLayer` throws on a layer with
    // neither a source nor a raster to register — so a window left open is the
    // only thing here that can strand an asset. A `commit` on the rejected path (or
    // a settlement skipped entirely) passes every assertion above.
    expect(transaction).toHaveBeenCalledOnce();
    expect(transaction).toHaveBeenCalledWith('test-doc');
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    registry.shutdown();
  });

  it('registers exactly one asset per distinct source bitmap in a committed conversion', () => {
    const registry = new AssetRegistry();
    const bitmap = { width: 8, height: 8 } as unknown as ImageBitmap;
    const attempt = convertLegacyHistorySafely(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: {
            layers: {
              'layer-1': {
                ...blankLayer('layer-1'),
                source: {
                  kind: 'image',
                  bitmap,
                  name: 'Shared',
                  isBedrock: false,
                  pos: { x: 0, y: 0, width: 8, height: 8 },
                },
              },
              'layer-2': {
                ...blankLayer('layer-2'),
                source: {
                  kind: 'image',
                  bitmap,
                  name: 'Shared',
                  isBedrock: false,
                  pos: { x: 0, y: 0, width: 8, height: 8 },
                },
              },
            },
            size: initialSize,
            frame: baselineFrame,
          },
        },
      ],
      { documentId: 'test-doc', registry }
    );

    const assetIds = [...collectDurableAssetIds(attempt.document as DurableDocument)];
    expect(attempt.status).toBe('current');
    expect(assetIds).toHaveLength(1);
    // Both layers published the SAME id, read off the published snapshots rather
    // than through the collector alone: `toHaveLength(1)` also passes if the
    // converter published two DIFFERENT ids and the collector deduplicated them,
    // which would mean two registrations for one bitmap — the exact thing the
    // rollback window exists to prevent.
    const publishedIds = attempt.document!.baseline.layers.map((layer) =>
      layer.source.kind === 'raster' ? layer.source.assetId : null
    );
    expect(publishedIds).toEqual([assetIds[0], assetIds[0]]);
    // And the published id is the one the registry actually holds, for this
    // document: a document carrying an id nothing registered would resolve to
    // nothing on the first materialization.
    expect(registry.getRecord(assetIds[0]!)?.documentId).toBe('test-doc');
    registry.shutdown();
  });
});
