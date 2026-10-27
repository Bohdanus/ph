import { describe, expect, it } from 'vitest';

import {
  DURABLE_SCHEMA_VERSION,
  cloneDurableDocument,
  freezeDurableDocument,
  refreezeDurableDocument,
  type DurableDocument,
  type DurableEntryProvenance,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type DurableLayerSource,
  type PlainObject,
} from '../history-model.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { rotationAffineAroundPoint } from '../affine-transform.ts';
import type { Selection } from '../general-types.ts';
import { RENAME_LAYER_ACTION } from '../../util/constants.ts';
import type { ActionType } from '../../util/constants.ts';

const blankSource: DurableLayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  size: { width: 8, height: 6 },
};

function layer(id: string, overrides: Partial<DurableLayerSnapshot> = {}): DurableLayerSnapshot {
  return {
    id,
    name: id,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { x: 0, y: 0, width: 8, height: 6 },
    source: blankSource,
    ...overrides,
  };
}

function entry(
  id: string,
  operation: DurableHistoryEntry['operation'],
  enabled = true,
  provenance?: DurableEntryProvenance
): DurableHistoryEntry {
  return {
    id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled,
    ...(provenance ? { provenance } : {}),
    operation,
  };
}

function provenance(actionName: ActionType, toolName?: string): DurableEntryProvenance {
  return toolName ? { actionName, toolName } : { actionName };
}

function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    id: 'selection-1',
    points: [[{ x: 1, y: 2 }]],
    isActive: true,
    pos: { x: 0, y: 0, width: 8, height: 6 },
    ...overrides,
  };
}

function document(
  history: DurableHistoryEntry[],
  baselineSelections: Selection[] = [],
  activeSelectionId: string | null = null,
  cursor = history.length - 1
): DurableDocument {
  return {
    documentId: 'document-a',
    documentRevision: 2,
    branchRevision: 4,
    durableRevision: history.length,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [layer('layer-1')],
      selections: { selections: baselineSelections, activeSelectionId },
      activeLayerId: 'layer-1',
    },
    history,
    cursor,
  };
}

describe('cloneDurableDocument selection cloning', () => {
  it('clones selection points, positions and nested metadata', () => {
    const source = selection({
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      metadata: {
        featherRadius: 3,
        magneticLasso: {
          width: 12,
          contrast: 0.5,
          frequency: 1,
          snapStrength: 2,
          smoothing: 3,
          antiAlias: true,
          pathPointCount: 4,
        },
      },
    });

    const frozen = cloneDurableDocument(
      document([entry('noop', { kind: 'remove-layer', layerId: 'ghost' })], [source], 'selection-1')
    );
    const [cloned] = frozen.baseline.selections.selections;

    expect(cloned).toStrictEqual(source);
    expect(cloned).not.toBe(source);
    if (cloned.metadata?.magneticLasso === source.metadata?.magneticLasso) throw new Error('metadata was not cloned');
    expect(cloned.points[0]).not.toBe(source.points[0]);
    expect(cloned.pos).not.toBe(source.pos);
    expect(Object.isFrozen(cloned.metadata)).toBe(true);
    expect(Object.isFrozen(cloned.metadata?.magneticLasso)).toBe(true);
    expect(frozen.baseline.selections.activeSelectionId).toBe('selection-1');
  });

  it('omits the metadata key entirely when the selection carries none', () => {
    const frozen = cloneDurableDocument(document([], [selection()], 'selection-1'));

    expect(frozen.baseline.selections.selections[0]).not.toHaveProperty('metadata');
  });
});

/**
 * `replayDurableDocument` had its own private `cloneSelectionSnapshot`. It copied
 * `points` and `pos` but not `metadata`, so the `...selection` spread aliased the
 * INPUT's metadata object into the result — a shared, mutable object, not a copy.
 * Verified by mutation: reinstating that function at the two replay call sites turns
 * the first test below red on `expect(replayed.metadata).not.toBe(input.metadata)`.
 *
 * The first case feeds the reducer an UNFROZEN document built by hand, which is the
 * only way to reach the copy at all: `replayDurableAtCursor` and `cloneDurableDocument`
 * both hand the reducer input that is already deep-frozen. The frozen case is the
 * companion, and it is deliberately understood to be the weaker one — on frozen input
 * the aliased metadata is already a frozen copy made by `cloneDurableDocument`, so it
 * is a different object from the original and already deep-frozen, and all three
 * assertions hold. It pins that the frozen path is honest; it cannot detect the alias.
 * That asymmetry is the blind spot, not a gap in the assertions.
 */
describe('replayDurableDocument selection metadata', () => {
  const withMetadata = () =>
    selection({
      geometry: 'rectangle',
      sourceTool: 'rectangular-selection',
      metadata: {
        featherRadius: 3,
        magneticLasso: {
          width: 12,
          contrast: 0.5,
          frequency: 1,
          snapStrength: 2,
          smoothing: 3,
          antiAlias: true,
          pathPointCount: 4,
        },
      },
    });

  function replayedSelection(input: Selection) {
    const replay = replayDurableDocument(document([], [input], 'selection-1'));
    const result = replay.selections.selections[0];
    if (!result) throw new Error('the replayed selection is missing');
    return result;
  }

  it('copies metadata out of an unfrozen document and deep-freezes it', () => {
    const input = withMetadata();

    expect(Object.isFrozen(input)).toBe(false);
    const replayed = replayedSelection(input);

    expect(replayed.metadata).toStrictEqual(input.metadata);
    expect(replayed.metadata).not.toBe(input.metadata);
    expect(replayed.metadata?.magneticLasso).not.toBe(input.metadata?.magneticLasso);
    expect(Object.isFrozen(replayed.metadata)).toBe(true);
    expect(Object.isFrozen(replayed.metadata?.magneticLasso)).toBe(true);
  });

  it('copies metadata out of an already-frozen document identically', () => {
    const input = withMetadata();
    const replayed = replayedSelection(
      cloneDurableDocument(document([], [input], 'selection-1')).baseline.selections.selections[0]!
    );

    expect(replayed.metadata).toStrictEqual(input.metadata);
    expect(replayed.metadata).not.toBe(input.metadata);
    expect(Object.isFrozen(replayed.metadata?.magneticLasso)).toBe(true);
  });

  it('omits the metadata key entirely when the replayed selection carries none', () => {
    const replay = replayDurableDocument(document([], [selection()], 'selection-1'));

    expect(replay.selections.selections[0]).not.toHaveProperty('metadata');
  });
});

describe('cloneDurableDocument operation cloning', () => {
  it('clones a set-layer-properties position patch without aliasing the operation', () => {
    const pos = { x: 5, y: 6, width: 20, height: 10 };
    const entryInput = entry('move', {
      kind: 'set-layer-properties',
      layerId: 'layer-1',
      patch: { name: 'Renamed', pos },
    });

    const frozen = cloneDurableDocument(document([entryInput]));
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'set-layer-properties') throw new Error('unexpected operation kind');

    expect(operation.patch).toStrictEqual({ name: 'Renamed', pos });
    expect(operation.patch.pos).not.toBe(pos);
    expect(replayDurableDocument(frozen).layers['layer-1']?.snapshot).toMatchObject({ name: 'Renamed', pos });
  });

  it('keeps a name-only patch free of a position key', () => {
    const frozen = cloneDurableDocument(
      document([entry('rename', { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Only name' } })])
    );
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'set-layer-properties') throw new Error('unexpected operation kind');

    expect(operation.patch).not.toHaveProperty('pos');
  });

  it('clones the selection snapshots of a set-selection operation', () => {
    const before = selection({ id: 'before' });
    const after = selection({ id: 'after', metadata: { copiedAtVersion: 3 } });
    const entryInput = entry('select', {
      kind: 'set-selection',
      before: { selections: [before], activeSelectionId: 'before' },
      after: { selections: [after], activeSelectionId: 'after' },
    });

    const frozen = cloneDurableDocument(document([entryInput]));
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'set-selection') throw new Error('unexpected operation kind');

    expect(operation.after.selections[0].id).toBe('after');
    expect(operation.after.selections[0]).not.toBe(after);
    expect(Object.isFrozen(operation.after.selections)).toBe(true);
    expect(replayDurableDocument(frozen).selections.activeSelectionId).toBe('after');
  });

  it('freezes the frames and reorder map of a document operation', () => {
    const next = { x: 10, y: 20, width: 50, height: 40 };
    const orderByLayerId = { 'layer-1': 0 };
    const frozen = cloneDurableDocument(
      document([
        entry('frame', { kind: 'set-document-frame', previous: { x: 0, y: 0, width: 100, height: 100 }, next }),
        entry('reorder', { kind: 'reorder-layers', orderByLayerId }),
      ])
    );
    const frameOperation = frozen.history[0].operation;
    const reorderOperation = frozen.history[1].operation;
    if (frameOperation.kind !== 'set-document-frame' || reorderOperation.kind !== 'reorder-layers') {
      throw new Error('unexpected operation kinds');
    }

    expect(frameOperation.next).not.toBe(next);
    expect(reorderOperation.orderByLayerId).not.toBe(orderByLayerId);
    expect(replayDurableDocument(frozen).frame).toEqual({ x: 10, y: 20, width: 50, height: 40 });
  });

  it('deep-clones the transform matrix and frames of a document-transform operation', () => {
    const previous = { x: 0, y: 0, width: 100, height: 80 };
    const next = { x: 10, y: 12, width: 80, height: 60 };
    const transform = rotationAffineAroundPoint(-Math.PI / 6, { x: 50, y: 42 });
    const frozen = cloneDurableDocument(
      document([entry('transform', { kind: 'transform-document', previous, next, transform })])
    );
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'transform-document') throw new Error('unexpected operation kind');

    expect(operation.transform).not.toBe(transform);
    expect(Object.isFrozen(operation.transform)).toBe(true);
    expect(operation.previous).not.toBe(previous);
    expect(operation.next).not.toBe(next);
    expect(replayDurableDocument(frozen).frame).toEqual(next);
  });
});

/**
 * The source edit is the only operation whose payload is a whole source, so it is
 * the only one where the clone has an object graph rather than a scalar and a
 * pair of boxes. These are the aliasing and immutability properties every other
 * operation clone already has, asserted for it.
 */
describe('cloneDurableDocument source-edit cloning', () => {
  const box = { x: 3, y: 4, width: 60, height: 20 };

  function textSource(args: PlainObject, over: Partial<{ width: number; height: number }> = {}) {
    const size = { width: over.width ?? box.width, height: over.height ?? box.height };
    return {
      kind: 'text' as const,
      toolName: 'text',
      args,
      size,
      sourcePos: { ...box, ...size },
      isBedrock: false,
    };
  }

  it('copies the source arguments, the box and the source position out of the operation', () => {
    const args: PlainObject = { toolName: 'text', text: 'First draft', fontSize: 24 };
    const entryInput = entry('retype', {
      kind: 'replace-layer-source',
      layerId: 'layer-1',
      source: textSource(args),
      pos: { ...box },
    });

    const frozen = cloneDurableDocument(document([entryInput]));
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'replace-layer-source') throw new Error('unexpected operation kind');

    expect(operation.source).toStrictEqual(textSource(args));
    expect(operation.source.args).not.toBe(args);
    expect(operation.pos).not.toBe(box);
    expect(operation.source.sourcePos).not.toBe(box);
    expect(operation.source.size).not.toBe(operation.pos);
  });

  it('deep-freezes the source, its arguments, its size and its source position', () => {
    const args: PlainObject = { toolName: 'text', text: 'Draft' };
    const frozen = cloneDurableDocument(
      document([
        entry('retype', {
          kind: 'replace-layer-source',
          layerId: 'layer-1',
          source: textSource(args),
          pos: { ...box },
        }),
      ])
    );
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'replace-layer-source') throw new Error('unexpected operation kind');

    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(operation.source)).toBe(true);
    expect(Object.isFrozen(operation.pos)).toBe(true);
    expect(Object.isFrozen(operation.source.size)).toBe(true);
    expect(Object.isFrozen(operation.source.sourcePos)).toBe(true);
    expect(Object.isFrozen(operation.source.args)).toBe(true);
  });

  it('never carries a bitmap, and names no asset id', () => {
    const frozen = cloneDurableDocument(
      document([
        entry('retype', {
          kind: 'replace-layer-source',
          layerId: 'layer-1',
          source: textSource({ toolName: 'text', text: 'Draft' }),
          pos: { ...box },
        }),
      ])
    );
    const operation = frozen.history[0].operation;

    // RQ-1: pixels are owned by the document-scoped asset registry and addressed
    // by identity, so an operation that duplicates them into the timeline is the
    // defect itself. The payload type excludes `raster`; these assertions say the
    // clone cannot introduce one under any key either.
    if (operation.kind !== 'replace-layer-source') throw new Error('unexpected operation kind');
    expect(operation).not.toHaveProperty('bitmap');
    expect(operation.source.kind).not.toBe('raster');
    expect(operation.source).not.toHaveProperty('assetId');
    expect(operation.source).not.toHaveProperty('bitmap');
  });

  it('leaves DurableLayerPropertyPatch unable to express a source change', () => {
    // The patch type is the correction path's decoy: widening it to carry
    // `source` would let a rename-shaped entry rewrite a layer's arguments, and
    // `derivedLayerPropertyPatch` hands that patch straight to the runtime layer.
    // The source edit is a separate operation for exactly this reason.
    const frozen = cloneDurableDocument(
      document([entry('rename', { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Type' } })])
    );
    const operation = frozen.history[0].operation;
    if (operation.kind !== 'set-layer-properties') throw new Error('unexpected operation kind');

    expect(operation.patch).toStrictEqual({ name: 'Type' });
    expect(operation.patch).not.toHaveProperty('source');
  });
});

describe('freezeDurableDocument cursor clamping', () => {
  it('keeps a cursor that points at the last entry', () => {
    const frozen = freezeDurableDocument(
      document([entry('a', { kind: 'remove-layer', layerId: 'ghost' })], [], null, 0)
    );

    expect(frozen.cursor).toBe(0);
  });

  it('clamps a cursor past the tip to the last entry', () => {
    const frozen = freezeDurableDocument(
      document([entry('a', { kind: 'remove-layer', layerId: 'ghost' })], [], null, 9)
    );

    expect(frozen.cursor).toBe(0);
  });

  it('clamps a cursor below zero to the empty position', () => {
    const frozen = freezeDurableDocument(document([], [], null, -5));

    expect(frozen.cursor).toBe(-1);
  });

  it('keeps the empty position for an empty history', () => {
    const frozen = freezeDurableDocument(document([], [], null, 0));

    expect(frozen.cursor).toBe(-1);
  });
});

describe('freezeDurableDocument provenance', () => {
  it('deep-freezes the provenance object of an entry', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');

    const frozen = freezeDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );

    expect(Object.isFrozen(frozen.history[0].provenance)).toBe(true);
    expect(frozen.history[0].provenance).not.toBe(prov);
    expect(frozen.history[0].provenance).toStrictEqual(prov);
  });

  it('deep-freezes provenance without an optional toolName', () => {
    const prov = provenance(RENAME_LAYER_ACTION);

    const frozen = freezeDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );

    expect(Object.isFrozen(frozen.history[0].provenance)).toBe(true);
    expect(frozen.history[0].provenance).not.toBe(prov);
    expect(frozen.history[0].provenance).toStrictEqual(prov);
    expect(frozen.history[0].provenance).not.toHaveProperty('toolName');
  });

  it('preserves provenance values on the frozen entry', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');

    const frozen = freezeDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );

    expect(frozen.history[0].provenance?.actionName).toBe(RENAME_LAYER_ACTION);
    expect(frozen.history[0].provenance?.toolName).toBe('text');
  });
});

describe('cloneDurableDocument provenance', () => {
  it('deep-freezes and copies provenance', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');

    const cloned = cloneDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );

    expect(Object.isFrozen(cloned.history[0].provenance)).toBe(true);
    expect(cloned.history[0].provenance).not.toBe(prov);
    expect(cloned.history[0].provenance).toStrictEqual(prov);
  });

  it('preserves provenance values through the clone', () => {
    const prov = provenance(RENAME_LAYER_ACTION);

    const cloned = cloneDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );

    expect(cloned.history[0].provenance?.actionName).toBe(RENAME_LAYER_ACTION);
    expect(cloned.history[0].provenance).not.toHaveProperty('toolName');
  });
});

describe('refreezeDurableDocument provenance', () => {
  it('preserves provenance by identity when reusing own-frozen entries on a cursor move', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');

    const frozen = freezeDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );
    const frozenProvenance = frozen.history[0].provenance;

    const refrozen = refreezeDurableDocument(frozen, { cursor: 0 });

    expect(refrozen.history[0].provenance).toBe(frozenProvenance);
    expect(Object.isFrozen(refrozen.history[0].provenance)).toBe(true);
  });

  it('copies new entries and preserves provenance by identity on retained ones', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');

    const frozen = freezeDurableDocument(
      document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)])
    );
    const retainedProvenance = frozen.history[0].provenance;

    const newProv = provenance(RENAME_LAYER_ACTION, 'brush');
    const newEntry = entry('e2', { kind: 'remove-layer', layerId: 'layer-1' }, true, newProv);
    const refrozen = refreezeDurableDocument(frozen, { history: [frozen.history[0], newEntry] });

    expect(refrozen.history[0].provenance).toBe(retainedProvenance);
    expect(Object.isFrozen(refrozen.history[0].provenance)).toBe(true);
    expect(refrozen.history[1].provenance).not.toBe(newProv);
    expect(Object.isFrozen(refrozen.history[1].provenance)).toBe(true);
    expect(refrozen.history[1].provenance).toStrictEqual(newProv);
  });

  it('falls back to a deep freeze when the base is not an own frozen copy', () => {
    const prov = provenance(RENAME_LAYER_ACTION, 'text');
    const unfrozen = document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' }, true, prov)]);

    const refrozen = refreezeDurableDocument(unfrozen, { cursor: 0 });

    expect(Object.isFrozen(refrozen.history[0].provenance)).toBe(true);
    expect(refrozen.history[0].provenance).not.toBe(prov);
    expect(refrozen.history[0].provenance).toStrictEqual(prov);
  });
});

describe('provenance optionality', () => {
  it('freezes an entry without provenance to an object that carries no provenance key', () => {
    const frozen = freezeDurableDocument(document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' })]));

    expect(frozen.history[0]).not.toHaveProperty('provenance');
  });

  it('clones an entry without provenance to an object that carries no provenance key', () => {
    const cloned = cloneDurableDocument(document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' })]));

    expect(cloned.history[0]).not.toHaveProperty('provenance');
  });

  it('refreezes an entry without provenance with no provenance key', () => {
    const frozen = freezeDurableDocument(document([entry('e1', { kind: 'remove-layer', layerId: 'ghost' })]));
    const refrozen = refreezeDurableDocument(frozen, { cursor: 0 });

    expect(refrozen.history[0]).not.toHaveProperty('provenance');
  });
});
