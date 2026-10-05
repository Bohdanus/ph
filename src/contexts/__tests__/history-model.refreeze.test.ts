import { describe, expect, it } from 'vitest';

import {
  DURABLE_SCHEMA_VERSION,
  cloneDurableDocument,
  freezeDurableDocument,
  refreezeDurableDocument,
  type DurableDocument,
  type DurableDocumentRefreeze,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type DurableLayerSource,
} from '../history-model.ts';
import { appendDurableEntry, createDurableDocument, setDurableCursor, toggleDurableEntry } from '../history-adapter.ts';

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
    frame: { x: 0, y: 0, width: 100, height: 100 },
    source: blankSource,
    ...overrides,
  };
}

function entry(id: string, operation: DurableHistoryEntry['operation'], enabled = true): DurableHistoryEntry {
  return { id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled, operation };
}

function blurEntry(id: string, radius: number): DurableHistoryEntry {
  return entry(id, {
    kind: 'apply-filter',
    layerId: 'layer-1',
    filter: { toolName: 'blur', version: 1, args: { radius } },
  });
}

function processorEntry(id: string): DurableHistoryEntry {
  return entry(id, {
    kind: 'apply-raster-processor',
    layerId: 'layer-1',
    processorId: 'blur',
    version: 1,
    args: { strength: 4, kernel: [1, 2, 1], passes: [{ radius: 2 }, { radius: 3 }] },
  });
}

/**
 * The live `args` object of an `apply-filter` operation, so a test can edit it AFTER
 * the document was built. It narrows on the kind instead of casting, so a test that
 * aimed at the wrong operation throws rather than editing nothing and passing.
 */
function filterArgs(operation: DurableHistoryEntry['operation']): { radius: number } {
  if (operation.kind !== 'apply-filter') throw new Error(`expected apply-filter, not ${operation.kind}`);
  return operation.filter.args as { radius: number };
}

/**
 * A document assembled by hand and NOT frozen — the shape a caller that rebuilt
 * one with a spread or read one back from storage has. It is the case the reuse
 * must refuse, and refusing it is invisible in every value assertion below, so the
 * tests that matter for it are the identity and the post-hoc mutation ones.
 */
function plainDocument(history: DurableHistoryEntry[]): DurableDocument {
  return {
    documentId: 'document-a',
    documentRevision: 2,
    branchRevision: 4,
    durableRevision: history.length,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [layer('layer-1')],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: 'layer-1',
    },
    history,
    cursor: history.length - 1,
  };
}

/** A document `history-model.ts` itself froze, which is the only kind it reuses. */
function frozenDocument(history: DurableHistoryEntry[]): DurableDocument {
  return freezeDurableDocument(plainDocument(history));
}

function reachableObjects(root: unknown, found: object[] = []): object[] {
  if (!root || typeof root !== 'object') return found;
  found.push(root);
  for (const value of Object.values(root)) reachableObjects(value, found);
  return found;
}

function expectDeeplyFrozen(root: unknown, minimumObjects = 10): void {
  const objects = reachableObjects(root);
  expect(objects.length).toBeGreaterThan(minimumObjects);
  expect(objects.every((object) => Object.isFrozen(object))).toBe(true);
}

function append(base: DurableDocument, added: DurableHistoryEntry) {
  const history = [...base.history, added];
  return refreezeDurableDocument(base, { history, cursor: history.length - 1 });
}

describe('refreezeDurableDocument reuse', () => {
  it('carries the baseline and every retained entry across by identity', () => {
    // The optimization itself. Removing the reuse fails this test; keeping it while
    // removing the guarantee it rests on fails `keeps the reused structure frozen`.
    const base = frozenDocument([blurEntry('a', 1), blurEntry('b', 2)]);
    const result = append(base, blurEntry('c', 3));

    expect(result.baseline).toBe(base.baseline);
    expect(result.history[0]).toBe(base.history[0]);
    expect(result.history[1]).toBe(base.history[1]);
    // ...and only what the change ADDS is copied, never aliased.
    expect(result.history[2]).not.toBe(base.history[2]);
  });

  it('copies the entry the change adds, so the caller keeps no handle on it', () => {
    const base = frozenDocument([blurEntry('a', 1)]);
    const added = blurEntry('b', 2);
    const result = append(base, added);

    expect(result.history[1]).not.toBe(added);
    expect(result.history[1]).toEqual(added);
    // Mutation-verified rather than identity-only: a clone that aliased `args` would
    // still fail the `toEqual` above, but this is the edit a user could make next.
    filterArgs(added.operation).radius = 999;
    expect(result.history[1]?.operation).toEqual(blurEntry('b', 2).operation);
  });

  it('keeps the reused structure frozen, so the shared objects cannot be edited', () => {
    const base = frozenDocument([blurEntry('a', 1), processorEntry('b')]);
    const result = append(base, blurEntry('c', 3));

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.history)).toBe(true);
    expect(Object.isFrozen(result.history[0])).toBe(true);
    expect(Object.isFrozen(result.history[0]?.operation)).toBe(true);
    expect(Object.isFrozen(result.baseline)).toBe(true);
    expect(Object.isFrozen(result.baseline.layers[0]?.pos)).toBe(true);
    expect(() => {
      'use strict';
      Object.defineProperty(result.baseline.layers[0]!.pos, 'x', { value: 999 });
    }).toThrow(TypeError);
    expectDeeplyFrozen(result);
  });

  it('deep-copies a caller-rebuilt entry even when it is equal field for field', () => {
    const base = frozenDocument([blurEntry('a', 1)]);
    const rebuilt: DurableHistoryEntry = { ...base.history[0]! };

    const result = refreezeDurableDocument(base, { history: [rebuilt], cursor: 0 });

    expect(result.history[0]).not.toBe(rebuilt);
    expect(result.history[0]?.operation).not.toBe(rebuilt.operation);
    expect(result.history[0]).toEqual(rebuilt);
    expectDeeplyFrozen(result.history[0], 3);
  });

  it('returns the document the full freeze would return', () => {
    // Parity, over the shapes the writers actually produce: an append at the tip, an
    // append that discards a redo tail, and the three cursor clamps.
    const base = frozenDocument([blurEntry('a', 1), blurEntry('b', 2)]);
    const rewound = setDurableCursor(base, 0);

    for (const changes of [
      { history: [...base.history, blurEntry('c', 3)], cursor: 2 },
      { history: [...base.history.slice(0, 1), blurEntry('c', 3)], cursor: 1 },
      { cursor: 1, durableRevision: base.durableRevision + 1 },
      { cursor: 99 },
      { cursor: -99 },
      { cursor: 1.5 },
      { cursor: Number.NaN },
      { cursor: Number.POSITIVE_INFINITY },
    ]) {
      expect(refreezeDurableDocument(base, changes)).toEqual(freezeDurableDocument({ ...base, ...changes }));
    }
    // The rewound base is itself a reuse result, so the truncating append above is
    // also checked against a base that came out of the fast path rather than a freeze.
    expect(refreezeDurableDocument(rewound, { history: [blurEntry('c', 3)], cursor: 0 })).toEqual(
      freezeDurableDocument({ ...rewound, history: [blurEntry('c', 3)], cursor: 0 })
    );
  });

  it('deep-copies when the base is not one of its own frozen copies', () => {
    const handBuilt = plainDocument([blurEntry('a', 1)]);
    const result = refreezeDurableDocument(handBuilt, { cursor: 0 });

    expect(result).not.toBe(handBuilt);
    expect(result.baseline).not.toBe(handBuilt.baseline);
    expect(result.history).not.toBe(handBuilt.history);
    expect(result.history[0]).not.toBe(handBuilt.history[0]);
    expect(result.history[0]?.operation).not.toBe(handBuilt.history[0]?.operation);
    expect(result).toEqual(freezeDurableDocument(handBuilt));
    // And the copy is a copy: editing the hand-built source afterwards reaches nothing.
    filterArgs(handBuilt.history[0]!.operation).radius = 999;
    expect(result.history[0]?.operation).toEqual(blurEntry('a', 1).operation);
  });

  it('treats a spread of a frozen document as an unknown base and copies it again', () => {
    // The load-bearing negative. Membership in `history-model.ts`'s reuse set is
    // identity, so the object literal every writer builds is NOT a reuse candidate.
    // If the reuse were keyed on anything an attacker of the invariant could carry —
    // a property, or "the history array is frozen" — this base would be accepted, its
    // entries would be carried into the result by reference, and the caller that
    // still holds `spread.history` could edit a frozen document.
    const base = frozenDocument([blurEntry('a', 1)]);
    const spread = { ...base, history: [...base.history, blurEntry('b', 2)], cursor: 1 };
    const result = refreezeDurableDocument(spread, { cursor: 1 });

    expect(result.history[0]).not.toBe(base.history[0]);
    expect(result.history[1]).not.toBe(spread.history[1]);
    expect(result.baseline).not.toBe(base.baseline);
    expect(result).toEqual(freezeDurableDocument(spread));
  });

  it('refuses a changes object that replaces history without a cursor', () => {
    // The guarantee this file cannot assert at runtime, because it is a TYPE: relaxing
    // `cursor` back to optional turns `npm run tsc` green again with no test failing and
    // no test name mentioning the contract. `DurableDocumentRefreeze.cursor` is required
    // precisely so a caller that swaps `history` cannot silently keep the base position
    // — a truncated history left at the old cursor is how an undone edit comes back.
    //
    // So the pin is `@ts-expect-error` itself. An unused directive is TS2578, which means
    // `npm run tsc` FAILS if the field is ever relaxed — the tripwire cannot rot into a
    // no-op the way an assertion can. It is written against the type rather than a call,
    // so nothing here mutates a document, and the two `expect`s below are what consume
    // the locals rather than a `void`, because they also pin the values the type allows.
    //
    // The mirror case is the reason `cursor` is required while `history` is not: a cursor
    // move passes no history and must stay allocation-free, so only the history-carrying
    // direction is refused.
    // @ts-expect-error `cursor` is required — replacing `history` must not keep the base position.
    const omittedCursor: DurableDocumentRefreeze = { history: [] };
    const cursorOnly: DurableDocumentRefreeze = { cursor: 0 };

    expect(omittedCursor.history).toEqual([]);
    expect(cursorOnly.cursor).toBe(0);
  });

  it('leaves cloneDurableDocument deep-copying an own frozen copy', () => {
    // The counterweight. `cloneDurableDocument` is the one function whose contract
    // is an INDEPENDENT copy — `replayDurableAtCursor` relies on the copy, not on
    // the document being frozen — so the reuse must not reach it.
    const base = frozenDocument([blurEntry('a', 1)]);
    const cloned = cloneDurableDocument(base);

    expect(cloned.baseline).not.toBe(base.baseline);
    expect(cloned.history[0]).not.toBe(base.history[0]);
    expect(cloned.history[0]?.operation).not.toBe(base.history[0]?.operation);
  });

  it('leaves the source document unchanged while changing the returned positions', () => {
    const base = frozenDocument([blurEntry('a', 1), blurEntry('b', 2)]);
    const historyBefore = base.history;
    const before = JSON.stringify(base);

    const result = refreezeDurableDocument(base, {
      history: [...base.history],
      cursor: 0,
      durableRevision: 99,
    });

    expect(base.cursor).toBe(1);
    expect(base.durableRevision).toBe(2);
    expect(base.history).toBe(historyBefore);
    expect(JSON.stringify(base)).toBe(before);
    expect(result.durableRevision).toBe(99);
    expect(result.cursor).toBe(0);
  });
});

describe('the writers that refreeze instead of re-freezing', () => {
  it('appends without re-copying the retained prefix and without aliasing the new entry', () => {
    const base = createDurableDocument(plainDocument([blurEntry('a', 1)]));
    const added = blurEntry('b', 2);

    const result = appendDurableEntry(base, added);

    expect(result.history).toHaveLength(2);
    expect(result.cursor).toBe(1);
    expect(result.branchRevision).toBe(base.branchRevision + 1);
    expect(result.durableRevision).toBe(base.durableRevision + 1);
    expect(result.baseline).toBe(base.baseline);
    expect(result.history[0]).toBe(base.history[0]);
    expect(result.history[1]).not.toBe(added);
    filterArgs(added.operation).radius = 999;
    expect(result.history[1]?.operation).toEqual(blurEntry('b', 2).operation);
  });

  it('discards the redo tail on an append and reuses only what it retains', () => {
    const base = createDurableDocument(plainDocument([blurEntry('a', 1), blurEntry('b', 2)]));
    const rewound = setDurableCursor(base, 0);

    const result = appendDurableEntry(rewound, blurEntry('c', 3));

    expect(result.history.map((retained) => retained.id)).toEqual(['a', 'c']);
    expect(result.history[0]).toBe(base.history[0]);
  });

  it('appends onto a hand-built document by deep copy, exactly as before', () => {
    const handBuilt = plainDocument([blurEntry('a', 1)]);
    const added = blurEntry('b', 2);

    const result = appendDurableEntry(handBuilt, added);

    expect(result.history[0]).not.toBe(handBuilt.history[0]);
    expect(result.history[0]?.operation).not.toBe(handBuilt.history[0]?.operation);
    expect(result.history[1]).not.toBe(added);
    expect(result).toEqual(
      freezeDurableDocument({
        ...handBuilt,
        history: [...handBuilt.history, added],
        cursor: 1,
        branchRevision: handBuilt.branchRevision + 1,
        durableRevision: handBuilt.durableRevision + 1,
      })
    );
  });

  it('moves the cursor without rebuilding the timeline', () => {
    const base = createDurableDocument(plainDocument([blurEntry('a', 1), blurEntry('b', 2)]));

    const moved = setDurableCursor(base, 0);

    expect(moved.cursor).toBe(0);
    expect(moved.branchRevision).toBe(base.branchRevision);
    expect(moved.durableRevision).toBe(base.durableRevision + 1);
    expect(moved.baseline).toBe(base.baseline);
    // The whole frozen array, not a rebuilt copy of it: a cursor move allocates
    // nothing proportional to the timeline, and it cannot because the entries it
    // would copy are the ones it is already holding.
    expect(moved.history).toBe(base.history);
    expect(moved.history[0]).toBe(base.history[0]);
  });

  it('toggles one entry and reuses the ones it did not touch', () => {
    const base = createDurableDocument(plainDocument([blurEntry('a', 1), blurEntry('b', 2)]));

    const toggled = toggleDurableEntry(base, 'a');

    expect(toggled.history.map((toggledEntry) => [toggledEntry.id, toggledEntry.enabled])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    expect(toggled.baseline).toBe(base.baseline);
    expect(toggled.history[1]).toBe(base.history[1]);
    // The toggled entry is a NEW object, so it takes the copy path even though its
    // operation is the frozen one the base already holds.
    expect(toggled.history[0]).not.toBe(base.history[0]);
    expect(toggled.history[0]?.operation).not.toBe(base.history[0]?.operation);
  });
});
