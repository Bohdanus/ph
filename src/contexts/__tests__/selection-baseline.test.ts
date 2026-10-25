import { describe, expect, it, vi } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import { replayHistory, type HistoryReplayDependencies } from '../history-replay.ts';
import {
  deriveSelectionBaseline,
  isValidSelectionSnapshot,
  selectionSnapshot,
  type SelectionHistoryArgs,
} from '../selection-baseline.ts';
import type { Selection, SelectionMetadata } from '../general-types.ts';
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
    presentationBounds: null,
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
      [
        { x: 12, y: 7 },
        { x: 48, y: 7 },
        { x: 48, y: 33 },
      ],
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

/**
 * A selection whose every field `cloneSelection` touches is populated and
 * non-default, and whose `metadata` nests one level deep.
 *
 * A shallow copy of this fixture is value-identical to a deep one — every
 * `toEqual` in this file passes either way. Only reference identity can tell
 * them apart, which is why the assertions below are `not.toBe` and not `toEqual`.
 */
function snapshotFixture(id: string): Selection {
  const metadata: SelectionMetadata = {
    featherRadius: 4,
    movedAtVersion: 3,
    magneticLasso: {
      width: 12,
      contrast: 22,
      frequency: 7,
      snapStrength: 9,
      smoothing: 5,
      antiAlias: true,
      pathPointCount: 4,
    },
  };

  return {
    id,
    points: [
      [
        { x: 12, y: 7 },
        { x: 48, y: 7 },
        { x: 48, y: 33 },
      ],
    ],
    isActive: true,
    pos: { x: 12, y: 7, width: 36, height: 26 },
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'feather-magnetic-lasso',
    metadata,
  };
}

describe('selectionSnapshot', () => {
  it('returns the empty snapshot when called with no arguments', () => {
    expect(selectionSnapshot()).toEqual({ selections: [], activeSelectionId: null });
  });

  it('matches the source by value while sharing no object reference with it', () => {
    const source = snapshotFixture('clone-me');
    const snapshot = selectionSnapshot([source], source.id);

    // The value half. A deep copy and a shallow copy are indistinguishable here,
    // which is exactly why the reference half below is not optional.
    expect(snapshot).toEqual({ selections: [source], activeSelectionId: source.id });
    expect(snapshot.selections[0]).toEqual(source);

    // The reference half, at every level the documented contract names:
    // `points`, `pos` and `metadata` are deep-copied, and `metadata` is
    // deep-copied through its nested `magneticLasso` too. Deleting any one of
    // the three clone lines in `cloneSelection` (`selection-baseline.ts:20`,
    // `:21`, `:22`) fails here; no other assertion in this file would notice.
    const copied = snapshot.selections[0]!;
    expect(copied.points).not.toBe(source.points);
    expect(copied.points[0]).not.toBe(source.points[0]);
    expect(copied.pos).not.toBe(source.pos);
    expect(copied.metadata).not.toBe(source.metadata);
    expect(copied.metadata?.magneticLasso).not.toBe(source.metadata?.magneticLasso);
    // The wrapper element is rebuilt too, not carried over.
    expect(copied).not.toBe(source);
  });

  it('infers the unique active selection ID from a key-absent legacy snapshot', () => {
    const source = snapshotFixture('legacy-active');

    expect(selectionSnapshot([source], undefined)).toEqual({ selections: [source], activeSelectionId: source.id });
  });

  it('copies the packed mask object so later metadata writes cannot rewrite the snapshot', () => {
    const source: Selection = {
      ...snapshotFixture('raster-clone-me'),
      points: [],
      pos: { x: 8, y: 4, width: 2, height: 2 },
      rasterMask: { width: 2, height: 2, data: 'AQ==' },
    };
    const snapshot = selectionSnapshot([source], source.id);
    const copied = snapshot.selections[0]!;

    expect(copied.rasterMask).toEqual(source.rasterMask);
    expect(copied.rasterMask).not.toBe(source.rasterMask);
    source.rasterMask!.data = 'Ag==';
    expect(copied.rasterMask?.data).toBe('AQ==');
  });

  it('accepts only canonical masks that fit their committed selection bounds', () => {
    const canonical: Selection = {
      ...snapshotFixture('validated-raster'),
      points: [],
      geometry: 'polygon',
      sourceTool: 'magic-wand',
      pos: { x: 8, y: 4, width: 2, height: 2 },
      rasterMask: { width: 2, height: 2, data: 'AQ==' },
    };

    expect(isValidSelectionSnapshot({ selections: [canonical], activeSelectionId: canonical.id })).toBe(true);
    expect(
      isValidSelectionSnapshot({
        selections: [{ ...canonical, pos: { ...canonical.pos, width: 3 } }],
        activeSelectionId: canonical.id,
      })
    ).toBe(false);
    expect(
      isValidSelectionSnapshot({
        selections: [{ ...canonical, rasterMask: { ...canonical.rasterMask!, data: 'AAAA' } }],
        activeSelectionId: canonical.id,
      })
    ).toBe(false);
    expect(
      isValidSelectionSnapshot({
        selections: [{ ...canonical, geometry: 'rectangle' }],
        activeSelectionId: canonical.id,
      })
    ).toBe(false);
    expect(
      isValidSelectionSnapshot({
        selections: [{ ...canonical, sourceTool: 'polygonal-lasso' }],
        activeSelectionId: canonical.id,
      })
    ).toBe(false);
  });

  it('rejects dangling, inactive, and contradicting active selection IDs', () => {
    const active = snapshotFixture('active');
    const inactive = { ...active, isActive: false };

    expect(isValidSelectionSnapshot({ selections: [active], activeSelectionId: 'missing' })).toBe(false);
    expect(isValidSelectionSnapshot({ selections: [inactive], activeSelectionId: inactive.id })).toBe(false);
    expect(isValidSelectionSnapshot({ selections: [active], activeSelectionId: null })).toBe(false);
    expect(isValidSelectionSnapshot({ selections: [active], activeSelectionId: active.id })).toBe(true);
    expect(isValidSelectionSnapshot({ selections: [inactive], activeSelectionId: null })).toBe(true);
  });

  it('rejects an ambiguous key-absent legacy snapshot with multiple active selections', () => {
    const active = snapshotFixture('legacy-active-one');
    const alsoActive = snapshotFixture('legacy-active-two');

    expect(isValidSelectionSnapshot({ selections: [active, alsoActive] })).toBe(false);
    expect(() => selectionSnapshot([active, alsoActive], undefined)).toThrow(
      'A selection snapshot without an active ID cannot contain multiple active selections.'
    );
  });

  it('accepts both the legacy Magic Wand boundary count and the current edge count', () => {
    const common = {
      tolerance: 12,
      smoothing: 1,
      selectedPixelCount: 9,
      seed: { x: 2, y: 3 },
      sampleColor: { r: 4, g: 5, b: 6, a: 255 },
    };
    const legacy = {
      ...snapshotFixture('legacy-wand-metadata'),
      metadata: { magicWand: { ...common, boundaryPointCount: 12 } },
    } satisfies Selection;
    const current = {
      ...snapshotFixture('current-wand-metadata'),
      metadata: { magicWand: { ...common, boundaryEdgeCount: 12 } },
    } satisfies Selection;

    expect(isValidSelectionSnapshot({ selections: [legacy], activeSelectionId: legacy.id })).toBe(true);
    expect(deriveSelectionBaseline([openDocumentItem(), selectionItem('legacy-wand-baseline', legacy)])).toEqual({
      selections: [legacy],
      activeSelectionId: legacy.id,
    });
    expect(isValidSelectionSnapshot({ selections: [current], activeSelectionId: current.id })).toBe(true);
    expect(
      isValidSelectionSnapshot({
        selections: [
          {
            ...legacy,
            metadata: {
              magicWand: { ...common, boundaryPointCount: 12, boundaryEdgeCount: 12 },
            },
          },
        ],
        activeSelectionId: legacy.id,
      })
    ).toBe(false);
    expect(
      isValidSelectionSnapshot({
        selections: [{ ...legacy, metadata: { magicWand: common } as never }],
        activeSelectionId: legacy.id,
      })
    ).toBe(false);
  });

  it('freezes the snapshot and its selections array', () => {
    const snapshot = selectionSnapshot([snapshotFixture('frozen')], 'frozen');

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.selections)).toBe(true);
  });
});

describe('deriveSelectionBaseline', () => {
  it('seeds the baseline from a non-empty previousSelectionState on the first enabled selection action', () => {
    const previous = outOfHistorySelection('restored');
    const history = [openDocumentItem(), renameItem('rename'), selectionItem('clear', previous)];

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [previous], activeSelectionId: previous.id });
  });

  it('normalizes a key-absent active legacy baseline to its unique active ID', () => {
    const previous = outOfHistorySelection('legacy-active');
    const history: HistoryItem[] = [
      openDocumentItem(),
      {
        ...selectionItem('clear-legacy-active', previous),
        args: { previousSelectionState: { selections: [previous] } },
      },
    ];

    expect(deriveSelectionBaseline(history)).toEqual({ selections: [previous], activeSelectionId: previous.id });
    expect(isValidSelectionSnapshot(deriveSelectionBaseline(history))).toBe(true);
  });

  it('normalizes a key-absent active selection transition during legacy replay', () => {
    const selection = outOfHistorySelection('legacy-active-transition');
    const history: HistoryItem[] = [
      openDocumentItem(),
      {
        id: 'select-legacy-active',
        actionName: SELECTION_ACTION,
        layerId: 'selection',
        args: {
          nextSelectionState: { selections: [selection] } as unknown as SelectionHistoryArgs['nextSelectionState'],
        },
      },
    ];

    const replayed = replayHistory(history, 1, initialSize, createDependencies());

    expect(replayed.selections).toEqual([selection]);
    expect(replayed.activeSelectionId).toBe(selection.id);
  });

  it('refuses a malformed active selection ID during legacy replay without replacing the prior state', () => {
    const currentSelection = outOfHistorySelection('current-selection');
    const malformedSelection = outOfHistorySelection('malformed-selection');
    const history: HistoryItem[] = [
      openDocumentItem(),
      {
        id: 'select-current',
        actionName: SELECTION_ACTION,
        layerId: 'selection',
        args: {
          nextSelectionState: {
            selections: [currentSelection],
            activeSelectionId: currentSelection.id,
          },
        },
      },
      {
        id: 'select-malformed',
        actionName: SELECTION_ACTION,
        layerId: 'selection',
        args: {
          nextSelectionState: {
            selections: [malformedSelection],
            activeSelectionId: 7,
          } as unknown as SelectionHistoryArgs['nextSelectionState'],
        },
      },
    ];

    const replayed = replayHistory(history, 2, initialSize, createDependencies());

    expect(replayed.selections).toEqual([currentSelection]);
    expect(replayed.activeSelectionId).toBe(currentSelection.id);
    expect(replayed.diagnostics).toHaveLength(1);
    expect(replayed.diagnostics[0]).toMatchObject({
      historyId: 'select-malformed',
      actionName: SELECTION_ACTION,
      code: 'invalid-selection-snapshot',
    });
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

  it('passes the whole timeline to the baseline lookup, and only the replay assertion sits at a cursor', () => {
    // The clear entry that supplies the selection is at index 3 and the replay
    // cursor is 1, so all three assertions below read a supplying entry the
    // cursor has not reached. Which of them could detect a bound on that lookup
    // — the change HANDOFF item 31 proposes making it actionable — is not the
    // same thing:
    //
    // - `deriveSelectionBaseline(history)` takes the timeline and nothing else
    //   (`selection-baseline.ts:56`), and so does `convert`, because
    //   `legacyHistoryToDurable` takes `history: readonly HistoryItem[]` as its
    //   first parameter (`history-adapter.ts:538`) and hands that straight to
    //   `deriveSelectionBaseline(legacyHistory)` (`history-adapter.ts:559`).
    //   Neither call site has a cursor to pass, so neither can fail by being
    //   bounded at a replay target: bounding the lookup means changing those
    //   signatures, and these two assertions are tripwires on the signatures,
    //   not on cursor behaviour.
    // - `replayHistory(history, 1, …)` is the only cursor-sensitive call here. It
    //   seeds from the FULL timeline via `deriveSelectionBaseline(history)` and then replays
    //   entries 0 and 1, so a lookup bounded at the target would seed an empty
    //   baseline and `replayed.selections` below would fail. That pair of
    //   assertions is the only part of this test a bound can break.
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
