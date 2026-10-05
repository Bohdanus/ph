import { describe, expect, it } from 'vitest';

import {
  DURABLE_SCHEMA_VERSION,
  cloneDurableDocument,
  cloneSelectionSnapshot,
  freezeDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type DurableLayerSource,
  type DurableOperation,
  type PlainObject,
  type SelectionSnapshot,
} from '../history-model.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import type { Selection } from '../general-types.ts';

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

function entry(id: string, operation: DurableHistoryEntry['operation'], enabled = true): DurableHistoryEntry {
  return { id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled, operation };
}

function selection(overrides: Partial<Selection> = {}): Selection {
  return {
    id: 'selection-1',
    points: [{ x: 1, y: 2 }],
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

function vectorSource(): DurableLayerSource {
  return {
    kind: 'vector',
    toolName: 'ellipse',
    args: { color: '#ff0000', dash: [4, 2] },
    size: { width: 40, height: 20 },
    sourcePos: { x: 1, y: 2, width: 40, height: 20 },
    isBedrock: false,
  };
}

/**
 * Every object-valued node of a literal, with the path that reaches it. The walk is
 * generic on purpose. `cloneOperation` has one arm per `DurableOperation` kind, and a
 * hand-written probe per arm silently stops covering a field added later; walking the
 * input instead means a new nested field is demanded to be both copied and frozen
 * without anyone editing the harness.
 */
function objectNodes(
  root: unknown,
  path: string[] = [],
  found: { path: string[]; value: object }[] = []
): { path: string[]; value: object }[] {
  if (root === null || typeof root !== 'object') return found;
  found.push({ path, value: root });
  for (const [key, value] of Object.entries(root)) objectNodes(value, [...path, key], found);
  return found;
}

function readPath(root: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (node === null || typeof node !== 'object' ? undefined : (node as Record<string, unknown>)[key]),
    root
  );
}

/** In-place corruption of one input node. A copy cannot observe it; an alias does. */
function corruptNode(node: object): void {
  if (Array.isArray(node)) node.push('corrupted-after-clone');
  else (node as Record<string, unknown>).corruptedAfterClone = true;
}

/**
 * The deep-copy claim, asserted by construction rather than field by field:
 *
 *  1. the clone carries the input's value exactly (captured before corruption);
 *  2. no object reachable from the input is reachable from the clone;
 *  3. every one of those objects is frozen in the clone.
 *
 * Step 1 is what makes steps 2 and 3 non-vacuous — without it a clone that dropped a
 * whole subtree would satisfy "not aliased" and "frozen" by having nothing there.
 * The `field` label rides along in the compared object so a failure names the path
 * rather than an index.
 */
function expectDeepCopy(input: object, clone: object): void {
  const expected = JSON.parse(JSON.stringify(input));
  const nodes = objectNodes(input);

  for (const node of nodes) corruptNode(node.value);

  expect(clone).toStrictEqual(expected);
  for (const node of nodes) {
    const field = ['root', ...node.path].join('.');
    const copied = readPath(clone, node.path);
    expect({ field, present: copied !== null && typeof copied === 'object' }).toEqual({ field, present: true });
    expect({ field, aliased: copied === node.value }).toEqual({ field, aliased: false });
    expect({ field, frozen: Object.isFrozen(copied) }).toEqual({ field, frozen: true });
  }
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
 * `cloneSelectionSnapshot` is the single copy of a selection for the durable path —
 * `durable-replay.ts` imports it rather than keeping a second copy, because that
 * second copy omitted `metadata` and a shared mutable object is how that survived.
 * What the function owes its callers is therefore a value-identical, fully
 * disconnected, fully frozen graph, and this asserts the whole graph rather than the
 * three fields the metadata case happens to name.
 */
describe('cloneSelectionSnapshot', () => {
  it('copies and freezes every point, the position and arbitrarily deep metadata', () => {
    const input: SelectionSnapshot = {
      selections: [
        selection({
          id: 'deep',
          // Two points, so a clone that copied only the first would be caught.
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
          metadata: {
            featherRadius: 3,
            magicWand: {
              tolerance: 12,
              smoothing: 2,
              selectedPixelCount: 30,
              boundaryPointCount: 8,
              seed: { x: 5, y: 6 },
              sampleColor: { r: 1, g: 2, b: 3, a: 255 },
            },
          },
        }),
        selection({ id: 'plain' }),
      ],
      activeSelectionId: 'deep',
    };

    const cloned = cloneSelectionSnapshot(input);

    expectDeepCopy(input, cloned);
    expect(cloned.activeSelectionId).toBe('deep');
    expect(cloned.selections.map((item) => item.id)).toEqual(['deep', 'plain']);
    // `magicWand` is a second metadata key beside `featherRadius`/`magneticLasso`. An
    // allow-list rewrite of the metadata copy would keep the two the suite already
    // names and silently drop this one; nothing else asserts the whole key survives.
    expect(cloned.selections[0]?.metadata).toHaveProperty('magicWand');
  });

  it('carries an empty selection list and an active id no selection matches, verbatim', () => {
    const empty: SelectionSnapshot = { selections: [], activeSelectionId: null };
    const dangling: SelectionSnapshot = { selections: [selection({ id: 'present' })], activeSelectionId: 'absent' };

    const clonedEmpty = cloneSelectionSnapshot(empty);
    const clonedDangling = cloneSelectionSnapshot(dangling);

    expect(clonedEmpty.selections).toStrictEqual([]);
    expect(clonedEmpty.activeSelectionId).toBeNull();
    expect(Object.isFrozen(clonedEmpty.selections)).toBe(true);
    // The model does not validate the active id; `durable-replay.ts` is the layer
    // that nulls an id no selection matches. A copy that "cleaned up" a dangling id
    // here would erase the record that replay is deciding from.
    expect(clonedDangling.activeSelectionId).toBe('absent');
    expect(clonedDangling.selections.map((item) => item.id)).toEqual(['present']);
    expectDeepCopy(dangling, clonedDangling);
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

/**
 * One row per `DurableOperation` kind, because `cloneOperation` has one arm per kind
 * and an arm with no row is an arm with no pin: a shallow arm, or one that forgot a
 * nested field, still returns a frozen top-level operation and passes every other
 * shape of test in this file. `expectDeepCopy` walks the input, so a row cannot rot
 * into a partial check.
 *
 * The union is exhaustive over `cloneOperation` by construction — a kind added without
 * an arm makes the switch fall through and `tsc` reject the return type. This table is
 * the other half: the test-side pin, which `tsc` cannot give. A new kind needs a row
 * here, and the rows are deliberately exhaustive rather than illustrative.
 */
const operationArms: { kind: DurableOperation['kind']; operation: () => DurableOperation }[] = [
  {
    kind: 'create-layer',
    operation: () => ({ kind: 'create-layer', layer: layer('layer-created', { source: vectorSource() }) }),
  },
  { kind: 'remove-layer', operation: () => ({ kind: 'remove-layer', layerId: 'layer-1' }) },
  {
    kind: 'set-layer-properties',
    operation: () => ({
      kind: 'set-layer-properties',
      layerId: 'layer-1',
      patch: { name: 'Renamed', opacity: 0.5, pos: { x: 1, y: 2, width: 30, height: 20 } },
    }),
  },
  {
    kind: 'reposition-layer',
    operation: () => ({
      kind: 'reposition-layer',
      layerId: 'layer-1',
      move: { x: 3, y: 4 },
      resize: { x: 5, y: 6, width: 70, height: 80 },
    }),
  },
  {
    kind: 'reorder-layers',
    operation: () => ({ kind: 'reorder-layers', orderByLayerId: { 'layer-1': 0, 'layer-2': 1 } }),
  },
  {
    kind: 'apply-filter',
    operation: () => ({
      kind: 'apply-filter',
      layerId: 'layer-1',
      // An array of objects inside `args`, so a one-level `clonePlainValue` is caught.
      filter: { toolName: 'levels', version: 2, args: { channel: 'rgb', curve: [{ x: 0, y: 0 }] } },
    }),
  },
  {
    kind: 'apply-affine-transform',
    operation: () => ({
      kind: 'apply-affine-transform',
      layerId: 'layer-1',
      transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 34 },
    }),
  },
  {
    kind: 'apply-raster-processor',
    operation: () => ({
      kind: 'apply-raster-processor',
      layerId: 'layer-1',
      processorId: 'dodge',
      version: 4,
      args: { distance: 12, protectTones: ['highlights', 'shadows'] },
    }),
  },
  {
    kind: 'set-document-frame',
    operation: () => ({
      kind: 'set-document-frame',
      previous: { x: 0, y: 0, width: 100, height: 100 },
      next: { x: 10, y: 20, width: 50, height: 40 },
    }),
  },
  {
    kind: 'replace-layer-source',
    operation: () => ({
      kind: 'replace-layer-source',
      layerId: 'layer-1',
      source: {
        kind: 'text',
        toolName: 'text',
        args: { toolName: 'text', text: 'Retyped', fontSize: 18 },
        size: { width: 60, height: 20 },
        sourcePos: { x: 3, y: 4, width: 60, height: 20 },
        isBedrock: false,
      },
      pos: { x: 3, y: 4, width: 60, height: 20 },
    }),
  },
  {
    kind: 'merge-document',
    operation: () => ({
      kind: 'merge-document',
      result: layer('layer-merged', { source: vectorSource() }),
      removedLayerIds: ['layer-2', 'layer-3'],
    }),
  },
  {
    kind: 'set-selection',
    operation: () => ({
      kind: 'set-selection',
      before: { selections: [selection({ id: 'before' })], activeSelectionId: 'before' },
      after: {
        selections: [selection({ id: 'after', metadata: { featherRadius: 2 } })],
        activeSelectionId: 'after',
      },
    }),
  },
];

describe('expectDeepCopy', () => {
  it('rejects a clone that aliases a nested object or drops one, so it cannot rot into a top-level check', () => {
    // Fifteen cases in this file route through `expectDeepCopy` — the twelve arm rows,
    // two selection snapshots and the baseline. A "simplification" that reduced it to
    // the top-level object would leave all fifteen green while checking nothing, so
    // the harness is pinned the way the production code is.
    const input = { pos: { x: 1 }, points: [{ y: 2 }] };

    expect(() => expectDeepCopy(input, { pos: input.pos, points: input.points })).toThrow();
    expect(() => expectDeepCopy(input, { pos: { x: 1 } })).toThrow();
  });

  it('reaches every object node of a literal, through arrays included', () => {
    // `objectNodes` is what makes the walk exhaustive. Returning only the root, or
    // skipping array elements, would leave the per-arm rows checking one object each
    // while still reporting every field as verified. Primitive leaves are absent by
    // design: `Object.isFrozen(1)` and aliasing a number are both meaningless, so a
    // leaf in this list would be a node the assertions cannot say anything about.
    expect(objectNodes({ pos: { x: 1 }, points: [{ y: 2 }, { y: 3 }] }).map((node) => node.path.join('.'))).toEqual([
      '',
      'pos',
      'points',
      'points.0',
      'points.1',
    ]);
    expect(objectNodes('not an object')).toEqual([]);
  });

  it('resolves a path to that exact node, and to undefined when it is absent', () => {
    // A `readPath` that ignored its path and returned the root would satisfy both the
    // `aliased` and the `frozen` assertion for every field, and the `field` label in
    // the failure message would name a node it never looked at.
    const root = { pos: { x: 1 }, points: [{ y: 2 }] };

    expect(readPath(root, [])).toBe(root);
    expect(readPath(root, ['pos'])).toBe(root.pos);
    expect(readPath(root, ['points', '0', 'y'])).toBe(2);
    expect(readPath(root, ['pos', 'x'])).toBe(1);
    expect(readPath(root, ['pos', 'width'])).toBeUndefined();
    expect(readPath(root, ['points', '7'])).toBeUndefined();
  });
});

describe('freezeDurableDocument operation cloning, arm by arm', () => {
  it.each(operationArms)('copies and deep-freezes every field of a $kind operation', ({ kind, operation }) => {
    const input = operation();

    const frozen = freezeDurableDocument(document([entry(kind, input)]));
    const clone = frozen.history[0]?.operation;
    if (!clone) throw new Error('the frozen document has no operation');

    expectDeepCopy(input, clone);
  });
});

describe('freezeDurableDocument baseline copying', () => {
  it('copies the frame and every layer snapshot instead of aliasing the objects it was given', () => {
    // `document()` shares one module-level `blankSource`, and the walk corrupts what
    // it is given, so this baseline is built from local literals on purpose.
    const input: DurableDocument = {
      documentId: 'document-a',
      documentRevision: 2,
      branchRevision: 4,
      durableRevision: 0,
      baseline: {
        frame: { x: 0, y: 0, width: 100, height: 100 },
        layers: [
          layer('layer-1', {
            pos: { x: 2, y: 3, width: 40, height: 20 },
            source: { kind: 'blank', color: '#ffffff', opacity: 1, size: { width: 40, height: 20 } },
          }),
        ],
        selections: { selections: [], activeSelectionId: null },
        activeLayerId: 'layer-1',
      },
      history: [],
      cursor: -1,
    };

    const frozen = freezeDurableDocument(input);

    // Two call sites, not one: `cloneOperation` never sees the baseline, so a shortcut
    // that mapped the baseline layers through identity ("they are already snapshots")
    // would leave every other assertion in this file green.
    expectDeepCopy(input.baseline, frozen.baseline);
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
