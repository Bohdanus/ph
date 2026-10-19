import { describe, expect, it } from 'vitest';

import { replayDurableAtCursor, replayDurableDocument, type DurableReplayResult } from '../durable-replay.ts';
import {
  DURABLE_SCHEMA_VERSION,
  freezeDurableDocument,
  type DurableDocument,
  type DurableLayerSnapshot,
  type DurableOperation,
} from '../history-model.ts';
import type { DocumentFrame } from '../document-frame.ts';

const baselineFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };

function layer(id: string, order: number, overrides: Partial<DurableLayerSnapshot> = {}): DurableLayerSnapshot {
  return {
    id,
    name: id,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order,
    pos: { x: order * 10, y: 0, width: 100, height: 80 },
    source: { kind: 'blank', color: '#ffffff', opacity: 1, size: { width: 100, height: 80 } },
    ...overrides,
  };
}

function durableDocument(
  layers: DurableLayerSnapshot[],
  history: DurableOperation[] = [],
  options: { activeLayerId?: string | null; cursor?: number } = {}
): DurableDocument {
  return freezeDurableDocument({
    documentId: 'publish-doc',
    documentRevision: 4,
    branchRevision: 2,
    durableRevision: history.length,
    baseline: {
      frame: baselineFrame,
      layers,
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: options.activeLayerId ?? layers.at(-1)?.id ?? null,
    },
    history: history.map((operation, index) => ({
      id: `entry-${index}`,
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation,
    })),
    cursor: options.cursor ?? history.length - 1,
  });
}

/**
 * The publication preconditions a durable replay result must satisfy before a
 * store may adopt it. Every component of the revision identity is checked, so a
 * result built from a different document, document revision, branch, cursor or
 * durable revision is rejected instead of silently replacing the visible one.
 */
type PublicationRejection = { field: string; patch: Partial<DurableReplayResult> };

function publicationMismatch(result: DurableReplayResult, document: DurableDocument): string[] {
  const failures: string[] = [];
  if (result.documentId !== document.documentId) failures.push('documentId');
  if (result.documentRevision !== document.documentRevision) failures.push('documentRevision');
  if (result.branchRevision !== document.branchRevision) failures.push('branchRevision');
  if (result.cursor !== document.cursor) failures.push('cursor');
  if (result.durableRevision !== document.durableRevision) failures.push('durableRevision');
  if (result.cursor < -1 || result.cursor > document.history.length - 1) failures.push('cursor-range');
  const expectedFrame = document.history
    .slice(0, result.cursor + 1)
    .reduce<DocumentFrame>(
      (frame, entry) =>
        entry.enabled &&
        (entry.operation.kind === 'set-document-frame' || entry.operation.kind === 'transform-document')
          ? entry.operation.next
          : frame,
      document.baseline.frame
    );
  if (
    result.frame.x !== expectedFrame.x ||
    result.frame.y !== expectedFrame.y ||
    result.frame.width !== expectedFrame.width ||
    result.frame.height !== expectedFrame.height
  ) {
    failures.push('document-frame');
  }
  return failures;
}

describe('durable replay result publication identity', () => {
  it('projects every revision component of the source document', () => {
    const document = durableDocument(
      [layer('layer-1', 0)],
      [{ kind: 'apply-affine-transform', layerId: 'layer-1', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } }]
    );

    const result = replayDurableDocument(document);

    expect(publicationMismatch(result, document)).toEqual([]);
    expect(result).toMatchObject({
      documentId: 'publish-doc',
      documentRevision: 4,
      branchRevision: 2,
      durableRevision: 1,
      cursor: 0,
      frame: baselineFrame,
    });
  });

  it.each([
    { field: 'documentId', patch: { documentId: 'other-doc' } },
    { field: 'documentRevision', patch: { documentRevision: 3 } },
    { field: 'branchRevision', patch: { branchRevision: 1 } },
    { field: 'cursor', patch: { cursor: -1 } },
    { field: 'durableRevision', patch: { durableRevision: 0 } },
  ] satisfies PublicationRejection[])(
    'rejects a result whose $field disagrees with the live document',
    ({ field, patch }) => {
      const document = durableDocument(
        [layer('layer-1', 0)],
        [{ kind: 'apply-affine-transform', layerId: 'layer-1', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } }]
      );
      const published = replayDurableDocument(document);

      // A result that drifted in exactly one component must be detectable.
      const drifted: DurableReplayResult = { ...published, ...patch };
      expect(publicationMismatch(drifted, document)).toContain(field);
      expect(publicationMismatch(published, document)).toEqual([]);
    }
  );

  it('rejects a result whose document frame disagrees with an unframed document', () => {
    const document = durableDocument([layer('layer-1', 0)]);
    const published = replayDurableDocument(document);

    const drifted: DurableReplayResult = { ...published, frame: { x: 10, y: 10, width: 100, height: 100 } };

    expect(publicationMismatch(drifted, document)).toEqual(['document-frame']);
  });

  it('rejects a cursor that points outside the durable history', () => {
    const document = durableDocument([layer('layer-1', 0)], [{ kind: 'remove-layer', layerId: 'layer-2' }]);
    const published = replayDurableDocument(document);

    expect(publicationMismatch({ ...published, cursor: 4 }, document)).toEqual(['cursor', 'cursor-range']);
  });

  it('accepts a frame that differs from the baseline once a frame operation is applied', () => {
    const nextFrame: DocumentFrame = { x: 40, y: 25, width: 200, height: 120 };
    const document = durableDocument(
      [layer('layer-1', 0)],
      [{ kind: 'set-document-frame', previous: baselineFrame, next: nextFrame }]
    );

    const published = replayDurableDocument(document);

    expect(published.frame).toEqual(nextFrame);
    expect(publicationMismatch(published, document)).toEqual([]);
  });
});

describe('disabled document frame entries do not corrupt the replayed frame', () => {
  it('keeps the baseline frame while a document frame operation is disabled', () => {
    const nextFrame: DocumentFrame = { x: 40, y: 25, width: 200, height: 120 };
    const document = freezeDurableDocument({
      ...durableDocument(
        [layer('layer-1', 0)],
        [{ kind: 'set-document-frame', previous: baselineFrame, next: nextFrame }]
      ),
      history: Object.freeze([
        {
          id: 'entry-0',
          schemaVersion: DURABLE_SCHEMA_VERSION,
          enabled: false,
          operation: { kind: 'set-document-frame', previous: baselineFrame, next: nextFrame },
        },
      ]),
    });

    const result = replayDurableDocument(document);

    expect(result.frame).toEqual(baselineFrame);
    expect(publicationMismatch(result, document)).toEqual([]);
  });
});

describe('durable replay no-op branches on missing layers', () => {
  const operationOn = (operation: DurableOperation): DurableDocument =>
    durableDocument([layer('layer-1', 0)], [operation]);

  it.each([
    { kind: 'set-layer-properties', layerId: 'ghost', patch: { visible: false } },
    { kind: 'reposition-layer', layerId: 'ghost', move: { x: 5, y: 5 } },
    { kind: 'apply-affine-transform', layerId: 'ghost', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
    {
      kind: 'apply-filter',
      layerId: 'ghost',
      filter: { toolName: 'blur', version: 1, args: { radius: 2 } },
    },
    {
      kind: 'apply-raster-processor',
      layerId: 'ghost',
      processorId: 'blur',
      version: 1,
      args: { toolName: 'blur', radius: 2 },
    },
  ] satisfies DurableOperation[])('leaves the layer set untouched for $kind on a missing layer', (operation) => {
    const document = operationOn(operation);

    const result = replayDurableDocument(document);

    expect(Object.keys(result.layers)).toEqual(['layer-1']);
    expect(result.layers['layer-1'].operations).toEqual([]);
  });

  it('reorders only the layers it knows about', () => {
    const document = operationOn({ kind: 'reorder-layers', orderByLayerId: { 'layer-1': 7, ghost: 3 } });

    const result = replayDurableDocument(document);

    expect(result.layers['layer-1'].snapshot.order).toBe(7);
    expect(result.layers.ghost).toBeUndefined();
  });
});

describe('durable replay active layer fallback', () => {
  it('falls back to the topmost layer when the tracked active layer is absent', () => {
    const document = durableDocument([layer('layer-1', 0), layer('layer-2', 1), layer('layer-3', 2)], [], {
      activeLayerId: 'non-existent-layer',
    });

    const result = replayDurableDocument(document);

    expect(result.activeLayerId).toBe('layer-3');
  });

  it('falls back to the topmost remaining layer after the tracked layer is removed', () => {
    const document = durableDocument(
      [layer('layer-1', 0), layer('layer-2', 1)],
      [{ kind: 'remove-layer', layerId: 'layer-2' }]
    );

    const result = replayDurableDocument(document);

    expect(result.activeLayerId).toBe('layer-1');
  });

  it('keeps a lower-order tracked active layer when a different layer is removed', () => {
    const document = durableDocument(
      [layer('layer-1', 0), layer('layer-2', 1), layer('layer-3', 2)],
      [{ kind: 'remove-layer', layerId: 'layer-2' }],
      { activeLayerId: 'layer-1' }
    );

    const beforeRemoval = replayDurableDocument(document, -1);
    expect(beforeRemoval.cursor).toBe(-1);
    expect(Object.keys(beforeRemoval.layers).sort()).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(beforeRemoval.activeLayerId).toBe('layer-1');

    const result = replayDurableDocument(document);

    expect(Object.keys(result.layers).sort()).toEqual(['layer-1', 'layer-3']);
    expect(result.activeLayerId).toBe('layer-1');
  });

  it('reports no active layer when every layer has been removed', () => {
    const document = durableDocument([layer('layer-1', 0)], [{ kind: 'remove-layer', layerId: 'layer-1' }]);

    const result = replayDurableDocument(document);

    expect(result.activeLayerId).toBeNull();
    expect(result.layers).toEqual({});
  });

  it('recomputes the active layer from a different document on every call', () => {
    const first = durableDocument([layer('layer-1', 0), layer('layer-2', 1)], [], { activeLayerId: 'gone' });
    const second = durableDocument([layer('layer-1', 0)], [], { activeLayerId: 'gone' });

    expect(replayDurableDocument(first).activeLayerId).toBe('layer-2');
    expect(replayDurableDocument(second).activeLayerId).toBe('layer-1');
  });
});

describe('replayDurableAtCursor publication readiness', () => {
  it('returns a result detached from the source document for each requested cursor', () => {
    const document = durableDocument(
      [layer('layer-1', 0)],
      [
        { kind: 'apply-affine-transform', layerId: 'layer-1', transform: { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 } },
        { kind: 'set-layer-properties', layerId: 'layer-1', patch: { visible: false } },
      ]
    );

    const atTip = replayDurableAtCursor(document, 1);
    const atStart = replayDurableAtCursor(document, 0);

    expect(atTip.cursor).toBe(1);
    expect(atStart.cursor).toBe(0);
    expect(atStart.layers['layer-1'].snapshot.visible).toBe(true);
    expect(atStart.layers['layer-1'].operations).toHaveLength(1);
    expect(atTip.layers['layer-1'].operations).toHaveLength(1);
    expect(atTip.layers['layer-1'].snapshot.visible).toBe(false);
    expect(document.history).toHaveLength(2);
  });

  it('clamps a requested cursor outside the history to a replayable position', () => {
    const document = durableDocument([layer('layer-1', 0)], [{ kind: 'remove-layer', layerId: 'layer-1' }]);

    expect(replayDurableAtCursor(document, 99).cursor).toBe(document.history.length - 1);
    expect(replayDurableAtCursor(document, -99).cursor).toBe(-1);
    expect(replayDurableAtCursor(document, -99).layers['layer-1']).toBeDefined();
  });
});
