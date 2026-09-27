import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import { deriveSelectionBaseline, type SelectionHistoryArgs } from '../selection-baseline.ts';
import type { Selection } from '../general-types.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, SELECTION_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const baselineFrame = { x: 0, y: 0, width: 400, height: 300 };

const layerPos = { x: 0, y: 0, width: 100, height: 80 };

const blankSource: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: layerPos,
};

function makeLayer(id: string): Layer {
  return {
    id,
    name: 'Layer',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...layerPos },
    // A durable source, so the very same timeline converts without the layer
    // itself becoming the reason the conversion is unsupported.
    source: { ...blankSource },
    operations: [],
  } satisfies Layer;
}

/**
 * A selection that was created by a gesture, which writes no history entry.
 *
 * Every field the clone in `selection-baseline.ts` touches is populated and
 * differs from the empty snapshot, so an assertion that only checked the shape
 * of the baseline could not tell the seeded state from the empty one. The
 * values are deliberately non-default (`isActive: true`, a non-origin `pos`,
 * a `rectangle` geometry, a feathered `metadata`) so a partially-cloned
 * regression is caught rather than hidden behind matching defaults.
 */
function outOfHistorySelection(id: string): Selection {
  return {
    id,
    points: [
      { x: 12, y: 7 },
      { x: 48, y: 7 },
      { x: 48, y: 33 },
    ],
    isActive: true,
    pos: { x: 12, y: 7, width: 36, height: 26 },
    lifecycle: 'committed',
    geometry: 'rectangle',
    sourceTool: 'rectangular-selection',
    metadata: { featherRadius: 4, movedAtVersion: 3 },
  };
}

function clearedBy(args: SelectionHistoryArgs): SelectionHistoryArgs {
  return { ...args, nextSelectionState: { selections: [], activeSelectionId: null } };
}

function openDocumentItem(): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers: { [layerId]: makeLayer(layerId) }, size: initialSize, frame: baselineFrame },
  };
}

function newLayerItem(): HistoryItem {
  return { id: 'layer-2', actionName: NEW_LAYER_ACTION, layerId: 'layer-2', layerSource: blankSource };
}

function renameItem(id: string): HistoryItem {
  return { id, actionName: RENAME_LAYER_ACTION, layerId, args: { name: id } };
}

function selectionItem(id: string, previous: Selection, disabled = false): HistoryItem {
  return {
    id,
    actionName: SELECTION_ACTION,
    layerId: 'selection',
    ...(disabled ? { disabled: true } : {}),
    args: clearedBy({ previousSelectionState: { selections: [previous], activeSelectionId: previous.id } }),
  };
}

function createDependencies() {
  const createLayer = vi.fn((input: Parameters<HistoryReplayDependencies['createLayer']>[0]) =>
    makeLayer(input.layerId)
  );
  const applyRasterTool = vi.fn((layer: Layer) => layer);
  return { createLayer, applyRasterTool } satisfies HistoryReplayDependencies;
}

/**
 * A timeline whose only selection entry is the tool-switch clear, and whose
 * `previousSelectionState` is the sole record that the selection ever existed.
 */
function timelineWithOutOfHistorySelection(previous: Selection): HistoryItem[] {
  return [openDocumentItem(), newLayerItem(), renameItem('rename'), selectionItem('tool-switch-clear', previous)];
}

function convert(history: readonly HistoryItem[]) {
  const registry = new AssetRegistry();
  try {
    return legacyHistoryToDurable(history, { documentId: 'test-doc', registry }).document;
  } finally {
    registry.shutdown();
  }
}

describe('deriveSelectionBaseline', () => {
  it('seeds the baseline from a non-empty previousSelectionState on the first enabled selection action', () => {
    const previous = outOfHistorySelection('restored');
    const history = [openDocumentItem(), renameItem('rename'), selectionItem('clear', previous)];

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [previous], activeSelectionId: previous.id });
  });

  it('skips a disabled selection action and seeds from the first enabled one', () => {
    const skipped = outOfHistorySelection('skipped');
    const seeded = outOfHistorySelection('restored');
    const history = [
      openDocumentItem(),
      selectionItem('clear-disabled', skipped, true),
      selectionItem('clear-enabled', seeded),
    ];

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [seeded], activeSelectionId: seeded.id });
    expect(convert(history).baseline.selections).toEqual({ selections: [seeded], activeSelectionId: seeded.id });
  });

  it('returns the empty snapshot for a timeline with no enabled selection action', () => {
    const history = [openDocumentItem(), newLayerItem(), renameItem('rename')];

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [], activeSelectionId: null });
  });

  it('looks the supplying selection action up across the whole timeline, not up to a cursor', () => {
    // A selection created by a gesture writes no history entry, so the only
    // record that it existed is the `previousSelectionState` of whatever cleared
    // it later. Bounding the lookup at a replay target would make undoing a
    // tool-switch deselect a silent visual no-op, so this pins the unbounded scan
    // for the helper itself, for legacy replay, and for the durable conversion
    // together: they all seed from an entry the cursor has not reached.
    const previous = outOfHistorySelection('restored');
    const history = timelineWithOutOfHistorySelection(previous);
    const cursorBeforeTheClear = 1;

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [previous], activeSelectionId: previous.id });

    const replayed = replayHistory(history, cursorBeforeTheClear, initialSize, createDependencies());
    expect(replayed.selections).toEqual([previous]);
    expect(replayed.activeSelectionId).toBe(previous.id);

    expect(convert(history).baseline.selections).toEqual({ selections: [previous], activeSelectionId: previous.id });
  });
});

describe('durable selection baseline', () => {
  it('carries a non-empty previousSelectionState into the converted document baseline', () => {
    // The gap this pins: every other fixture supplies an EMPTY
    // `previousSelectionState` on the first selection entry, so reverting the
    // durable baseline to the empty snapshot would still satisfy them. A fixture
    // whose first entry records a real selection is what separates the seeded
    // baseline from the empty one.
    const previous = outOfHistorySelection('restored');
    const document = convert(timelineWithOutOfHistorySelection(previous));

    expect(document.baseline.selections).toEqual({ selections: [previous], activeSelectionId: previous.id });
    expect(document.baseline.selections.selections[0]).toMatchObject({
      id: previous.id,
      isActive: true,
      lifecycle: 'committed',
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      pos: previous.pos,
      points: previous.points,
      metadata: previous.metadata,
    });
  });

  it('seeds legacy replay and the durable conversion identically for the same timeline', () => {
    const previous = outOfHistorySelection('restored');
    const history = timelineWithOutOfHistorySelection(previous);

    // A cursor before the clear entry, so the replayed state is the baseline
    // rather than the cleared state. Both branches must agree there and below.
    const replayed = replayHistory(history, 1, initialSize, createDependencies());
    const baseline = convert(history).baseline.selections;

    expect(baseline).toEqual({ selections: [previous], activeSelectionId: previous.id });
    expect(replayed.selections).toEqual(baseline.selections);
    expect(replayed.activeSelectionId).toBe(baseline.activeSelectionId);
  });
});
