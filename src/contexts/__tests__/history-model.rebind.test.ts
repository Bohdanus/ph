import { describe, expect, it } from 'vitest';

import {
  DURABLE_SCHEMA_VERSION,
  freezeDurableDocument,
  rebindDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type DurableLayerSource,
  type DurableOperation,
} from '../history-model.ts';
import type { Selection } from '../general-types.ts';

/**
 * The pin on `rebindDurableDocument`, which is the reason it exists: a cursor
 * move and an incremental append are POSITION changes, and copying the whole
 * document to perform one is work that grows with the timeline for a result
 * nobody can observe. Every identity assertion below fails the moment the
 * adoption is replaced by a whole-document deep clone again, which is the point
 * — the saving is only free while the frozen-ness it trades for is real.
 */

const blankSource: DurableLayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  size: { width: 8, height: 6 },
};

function layer(id: string): DurableLayerSnapshot {
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
  };
}

/** The deepest payload the model has: a selection with points, a box and metadata. */
function selectionOperation(id: string): DurableOperation {
  return {
    kind: 'set-selection',
    before: { selections: [], activeSelectionId: null },
    after: {
      selections: [
        {
          id,
          points: [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
          ],
          isActive: true,
          geometry: 'rectangle',
          sourceTool: 'rectangular-selection',
          pos: { x: 0, y: 0, width: 8, height: 6 },
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
        },
      ],
      activeSelectionId: id,
    },
  };
}

/** A nested-args payload, the shape a tool append carries. */
function processorOperation(): DurableOperation {
  return {
    kind: 'apply-raster-processor',
    layerId: 'layer-1',
    processorId: 'blur',
    version: 1,
    args: { strength: 4, kernel: [1, 2, 1], passes: [{ radius: 2 }, { radius: 3 }] },
  };
}

function unfrozenEntry(id: string, operation: DurableOperation): DurableHistoryEntry {
  return { id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled: true, operation };
}

function document(history: DurableHistoryEntry[]): DurableDocument {
  return {
    documentId: 'document-a',
    documentRevision: 2,
    branchRevision: 4,
    durableRevision: history.length,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [layer('layer-1')],
      selections: {
        selections: [
          {
            id: 'baseline-selection',
            points: [{ x: 0, y: 0 }],
            isActive: true,
            pos: { x: 0, y: 0, width: 8, height: 6 },
            metadata: { featherRadius: 1 },
          },
        ] as Selection[],
        activeSelectionId: 'baseline-selection',
      },
      activeLayerId: 'layer-1',
    },
    history,
    cursor: history.length - 1,
  };
}

/** The document the store holds: converted, so deep-cloned and frozen. */
function frozenDocument(history: DurableHistoryEntry[]): DurableDocument {
  return freezeDurableDocument(document(history));
}

/**
 * Every object reachable from `root`, so a claim about deep-frozen-ness can be
 * checked against the whole graph instead of the top object. `Object.isFrozen`
 * on a document proves nothing below it, which is exactly what the adoption
 * below depends on.
 */
function reachableObjects(root: unknown, found: object[] = []): object[] {
  if (!root || typeof root !== 'object') return found;
  found.push(root);
  for (const value of Object.values(root)) reachableObjects(value, found);
  return found;
}

function expectDeeplyFrozen(root: unknown, expectedObjects = 5) {
  const objects = reachableObjects(root);
  // The floor is what keeps the walk from passing vacuously: a walk that reached
  // nothing would have frozen nothing.
  expect(objects.length).toBeGreaterThanOrEqual(expectedObjects);
  for (const object of objects) {
    if (!Object.isFrozen(object)) throw new Error(`an adopted object is not frozen: ${JSON.stringify(object)}`);
  }
}

describe('rebindDurableDocument', () => {
  it('adopts the frozen baseline and every inherited entry rather than copying them', () => {
    const base = frozenDocument([unfrozenEntry('selection-1', selectionOperation('selection-1'))]);

    const rebound = rebindDurableDocument(base, { cursor: -1 });

    expect(rebound).not.toBe(base);
    expect(Object.isFrozen(rebound)).toBe(true);
    // The whole saving. A deep clone makes each of these a fresh object, and
    // they are frozen either way, so nothing a caller can observe differs.
    expect(rebound.baseline).toBe(base.baseline);
    expect(rebound.history[0]).toBe(base.history[0]);
    // The array itself is new, because the timeline is part of what the rebind
    // may change and an old array is the one place a second writer could look.
    expect(rebound.history).not.toBe(base.history);
  });

  it('keeps the baseline and the entries it adopted frozen all the way down', () => {
    const base = frozenDocument([
      unfrozenEntry('selection-1', selectionOperation('selection-1')),
      unfrozenEntry('blur-1', processorOperation()),
    ]);

    const rebound = rebindDurableDocument(base, { history: [...base.history], cursor: 1 });

    expectDeeplyFrozen(rebound.baseline);
    expectDeeplyFrozen(rebound.history, 21);
    expect(rebound.baseline).toBe(base.baseline);
    expect(rebound.history[0]).toBe(base.history[0]);
    expect(rebound.history[1]).toBe(base.history[1]);
  });

  it('deep-copies an in-flight entry the document does not already hold', () => {
    // The shape an append boundary actually plans: the wrapper frozen, the
    // operation's payload parts not. `deriveSetDocumentFrameEntry`'s `previous`
    // and `next`, `deriveSetSelectionEntry`'s `before` and `after` down to the
    // nested `points`, the conversion's reorder map and merge removal ids, and
    // every `source.size` all reach the store this way, so an entry handed
    // straight to a rebind must not be trusted to be frozen.
    const inFlight = Object.freeze({
      ...unfrozenEntry('selection-2', selectionOperation('selection-2')),
    });
    const base = frozenDocument([unfrozenEntry('selection-1', selectionOperation('selection-1'))]);

    const rebound = rebindDurableDocument(base, { history: [...base.history, inFlight], cursor: 1 });

    expect(rebound.history[0]).toBe(base.history[0]);
    expect(rebound.history[1]).not.toBe(inFlight);
    expect(rebound.history[1].operation).not.toBe(inFlight.operation);
    expect(rebound.history[1]).toEqual(inFlight);
    expectDeeplyFrozen(rebound);
  });

  it('deep-copies an entry the caller rebuilt, even one equal field for field', () => {
    const base = frozenDocument([unfrozenEntry('selection-1', selectionOperation('selection-1'))]);
    const rebuilt: DurableHistoryEntry = { ...base.history[0] };

    const rebound = rebindDurableDocument(base, { history: [rebuilt], cursor: 0 });

    // The membership test is on object identity, not on shape, so a rebuilt
    // entry is copied down to its operation rather than adopted.
    expect(rebound.history[0]).not.toBe(rebuilt);
    expect(rebound.history[0].operation).not.toBe(rebuilt.operation);
    expect(rebound.history[0]).toEqual(rebuilt);
    expectDeeplyFrozen(rebound.history[0]);
  });

  it('copies and freezes a document it did not freeze itself', () => {
    // A hand-built document — a test fixture, a structured clone out of storage —
    // is not this module's output, so nothing about its graph is known. The
    // rebind takes the full deep clone there, which is what keeps the reuse an
    // optimization rather than a precondition its callers have to satisfy.
    const handmade = document([unfrozenEntry('selection-1', selectionOperation('selection-1'))]);

    const rebound = rebindDurableDocument(handmade, { cursor: 0 });

    expect(rebound.baseline).not.toBe(handmade.baseline);
    expect(rebound.history).not.toBe(handmade.history);
    expect(rebound.history[0]).not.toBe(handmade.history[0]);
    expectDeeplyFrozen(rebound);
  });

  it.each([
    ['a cursor past the tip', 9, 1],
    ['a cursor below the empty position', -4, -1],
    // A non-integer has no position in the timeline, so all three of these
    // refuse to `-1` rather than clamping — the rule `freezeDurableDocument`
    // states and the one this rebind copies.
    ['a fractional cursor', 0.5, -1],
    ['a NaN cursor', Number.NaN, -1],
    ['an infinite cursor', Number.POSITIVE_INFINITY, -1],
  ])('clamps %s exactly as freezeDurableDocument does', (_label, cursor, expected) => {
    const base = frozenDocument([
      unfrozenEntry('selection-1', selectionOperation('selection-1')),
      unfrozenEntry('blur-1', processorOperation()),
    ]);

    const rebound = rebindDurableDocument(base, { cursor });
    const frozen = freezeDurableDocument({ ...base, cursor });

    expect(rebound.cursor).toBe(expected);
    expect(rebound.cursor).toBe(frozen.cursor);
  });

  it('leaves the source document, its history array and its cursor alone', () => {
    const base = frozenDocument([
      unfrozenEntry('selection-1', selectionOperation('selection-1')),
      unfrozenEntry('blur-1', processorOperation()),
    ]);
    const historyBefore = base.history;
    const before = JSON.stringify(base);

    const rebound = rebindDurableDocument(base, { history: [...base.history], cursor: 0, durableRevision: 99 });

    expect(base.cursor).toBe(1);
    expect(base.durableRevision).toBe(2);
    expect(base.history).toBe(historyBefore);
    expect(JSON.stringify(base)).toBe(before);
    expect(rebound.durableRevision).toBe(99);
    expect(rebound.cursor).toBe(0);
  });
});
