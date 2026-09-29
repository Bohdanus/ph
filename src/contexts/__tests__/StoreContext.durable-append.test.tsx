import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type StoreData, type StoreDispatch, StoreProvider, useStore } from '../StoreContext.tsx';
import {
  deriveRemoveLayerEntry,
  deriveSetDocumentFrameEntry,
  deriveSetLayerPropertiesEntry,
} from '../history-adapter.ts';
import { getAssetRegistry } from '../asset-registry.ts';
import { decideDurableAppend } from '../history-append.ts';
import type { DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayersRecord } from '../layer-types.ts';
import type { DocumentFrame } from '../document-frame.ts';
import {
  HIDE_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  REMOVE_ACTION,
  RENAME_LAYER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
} from '../../util/constants.ts';
import { createMockLayer } from '../../__tests__/fixtures/layer.ts';

const layerId = 'layer-1';
const initialSize = { width: 400, height: 300 };
const defaultFrame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
const croppedFrame: DocumentFrame = { x: 20, y: 10, width: 200, height: 150 };

function layer(): Layer {
  return {
    ...createMockLayer({ id: layerId, pos: { x: 0, y: 0, width: 400, height: 300 } }),
    source: {
      kind: 'blank',
      color: '#ffffff',
      opacity: 1,
      isBedrock: false,
      pos: { x: 0, y: 0, width: 400, height: 300 },
    },
  };
}

function baselineItem(layers: LayersRecord): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers, size: initialSize, frame: defaultFrame },
  };
}

function cropItem(id = 'crop-1'): HistoryItem {
  return {
    id,
    actionName: SET_DOCUMENT_FRAME_ACTION,
    layerId: 'document',
    args: { previousFrame: defaultFrame, nextFrame: croppedFrame },
  };
}

function renderWithProbe() {
  const probeRef: { current: { store: StoreData; dispatch: StoreDispatch } | null } = { current: null };
  const Probe = () => {
    const [store, dispatch] = useStore();
    useEffect(() => {
      probeRef.current = { store, dispatch };
    }, [store, dispatch]);
    return null;
  };
  const { unmount } = render(
    <StoreProvider>
      <Probe />
    </StoreProvider>
  );
  return {
    unmount,
    store: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.store;
    },
    dispatch: () => {
      if (!probeRef.current) throw new Error('Probe not rendered');
      return probeRef.current.dispatch;
    },
  };
}

function openDocument(documentId = 'doc-1') {
  const { store, dispatch } = renderWithProbe();
  act(() => {
    dispatch()({
      type: 'REPLACE_DOCUMENT',
      payload: {
        documentId,
        history: [baselineItem({ [layerId]: layer() })],
        historyIndex: 0,
        updates: { layers: { [layerId]: layer() }, totalSize: initialSize, documentFrame: defaultFrame },
      },
    });
  });
  return { store, dispatch };
}

function commitCrop(dispatch: StoreDispatch, entry: HistoryItem, planned?: DurableHistoryEntry | null) {
  act(() => {
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { documentFrame: croppedFrame, totalSize: { width: 200, height: 150 } },
        historyItem: entry,
        ...(planned === undefined ? {} : { durableEntry: planned }),
      },
    });
  });
}

const crop = () => cropItem();
const plannedFor = (entry: HistoryItem) => deriveSetDocumentFrameEntry(entry, defaultFrame);

/** The three actions the append boundary translates into `set-layer-properties`. */
const propertyActions = [
  [RENAME_LAYER_ACTION, { name: 'Renamed' }],
  [SHOW_LAYER_ACTION, { visible: true }],
  [HIDE_LAYER_ACTION, { visible: false }],
] as const;

function propertyItem(id: string, actionName: (typeof propertyActions)[number][0], patch: object): HistoryItem {
  return { id, actionName, layerId, args: patch };
}

function commitProperty(
  dispatch: StoreDispatch,
  entry: HistoryItem,
  planned: DurableHistoryEntry | null,
  patch: Partial<Layer> = {}
) {
  act(() => {
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: { layers: { [layerId]: { ...layer(), ...patch } } },
        historyItem: entry,
        durableEntry: planned,
      },
    });
  });
}

/**
 * A layer removal, in the shape `useLayer.removeLayer` produces it: the layer
 * leaves the record, a bitmapless copy is retained for the presentation
 * boundary, and the append carries the boundary's plan.
 */
function removalItem(id: string, target: string = layerId, overrides: Partial<HistoryItem> = {}): HistoryItem {
  return { id, actionName: REMOVE_ACTION, layerId: target, args: {}, ...overrides };
}

function commitRemoval(
  dispatch: StoreDispatch,
  entry: HistoryItem,
  planned?: DurableHistoryEntry | null,
  target: string = layerId
) {
  act(() => {
    dispatch({
      type: 'COMMIT_DOCUMENT_EDIT',
      payload: {
        updates: {
          layers: {},
          deletedLayers: { [target]: layer() },
          activeLayerId: null,
        },
        historyItem: entry,
        ...(planned === undefined ? {} : { durableEntry: planned }),
      },
    });
  });
}

describe('COMMIT_DOCUMENT_EDIT publishes a planned durable removal', () => {
  it('appends the planned removal and advances the durable cursor by exactly one', () => {
    const { store, dispatch } = openDocument();
    const before = store().durableDocument!;
    expect(before.history).toHaveLength(0);
    expect(before.cursor).toBe(-1);

    const entry = removalItem('remove-1');
    commitRemoval(dispatch(), entry, deriveRemoveLayerEntry(entry));

    const after = store();
    expect(after.layers[layerId]).toBeUndefined();
    expect(after.deletedLayers[layerId]).toBeDefined();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    expect(after.durableDocument!.history).toHaveLength(1);
    expect(after.durableDocument!.history[0]).toMatchObject({
      id: entry.id,
      enabled: true,
      operation: { kind: 'remove-layer', layerId },
    });
    // One append mints one id, so the two models name the same entry.
    expect(after.history).toHaveLength(2);
    expect(after.history[1]).toBe(entry);
    expect(after.durableDocument!.history[0]!.id).toBe(after.history[1]!.id);
    // Exactly one step, and never ahead of the legacy cursor.
    expect(after.durableDocument!.cursor).toBe(0);
    expect(after.durableDocument!.cursor).toBeLessThanOrEqual(after.historyIndex);
    expect(after.durableDocument!.durableRevision).toBe(before.durableRevision + 1);
  });

  it('produces the same document as the full conversion', () => {
    // The single invariant the append boundary exists to hold. A translation that
    // is self-consistent but wrong — a retargeted id, a lost key, a dropped
    // enabled gate — passes every other test in this file and fails here.
    const entry = removalItem('remove-1');

    const { store, dispatch } = openDocument();
    commitRemoval(dispatch(), entry, deriveRemoveLayerEntry(entry));
    const published = store().durableDocument;

    const { store: controlStore, dispatch: controlDispatch } = openDocument();
    commitRemoval(controlDispatch(), removalItem('remove-1'));
    const converted = controlStore().durableDocument;

    // Guard against the comparison passing on two empty documents.
    expect(published!.history).toHaveLength(1);
    expect(converted!.history).toHaveLength(1);
    expect(published).toEqual(converted);
  });

  it('falls back to the conversion and reports a mismatch when a publisher retargets the removal', () => {
    const { store, dispatch } = openDocument();
    const entry = removalItem('remove-1');
    const retargeted = {
      ...(deriveRemoveLayerEntry(entry) as DurableHistoryEntry),
      operation: { kind: 'remove-layer', layerId: 'layer-2' },
    } as DurableHistoryEntry;

    commitRemoval(dispatch(), entry, retargeted);

    const after = store();
    // The edit is published and the rebuilt shadow stays exact, so the sidecar is
    // still current; what the refusal produces is the reported diagnostic.
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument!.history[0]).toMatchObject({
      id: entry.id,
      operation: { kind: 'remove-layer', layerId },
    });
    // A diagnostic CODE, not a message string: the wording is the store's to
    // change, the fact that it refused to publish is the contract.
    expect(after.durableDiagnostics).toHaveLength(1);
    expect(after.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(after.durableDiagnostics[0]).toMatchObject({ severity: 'error', historyId: entry.id });
  });

  it('carries a disabled removal into the published document as disabled', () => {
    const { store, dispatch } = openDocument();
    const entry = removalItem('remove-disabled', layerId, { disabled: true });
    const planned = deriveRemoveLayerEntry(entry);
    expect(planned!.enabled).toBe(false);

    commitRemoval(dispatch(), entry, planned);

    const after = store();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    expect(after.durableDocument!.history[0]).toMatchObject({
      id: entry.id,
      enabled: false,
      operation: { kind: 'remove-layer', layerId },
    });
    expect(after.durableDocument!.cursor).toBe(0);
  });

  it('reports a mismatch when a publisher would re-enable a disabled removal', () => {
    const { store, dispatch } = openDocument();
    const entry = removalItem('remove-disabled', layerId, { disabled: true });
    const reenabled = {
      ...(deriveRemoveLayerEntry(entry) as DurableHistoryEntry),
      enabled: true,
    } as DurableHistoryEntry;

    commitRemoval(dispatch(), entry, reenabled);

    const after = store();
    expect(after.durableDocument!.history[0]).toMatchObject({ id: entry.id, enabled: false });
    expect(after.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
  });

  it('does no asset-registry work when it publishes, and does on the fallback', () => {
    const registry = getAssetRegistry();
    const { store, dispatch } = openDocument();
    // The baseline replacement converts, so the spies go on after it.
    const begin = vi.spyOn(registry, 'beginDocumentAssetTransaction');
    const reconcile = vi.spyOn(registry, 'reconcileDocumentAssets');
    try {
      const published = removalItem('remove-1');
      commitRemoval(dispatch(), published, deriveRemoveLayerEntry(published));

      expect(store().durableStatus).toBe('current');
      // A removal retires no durable asset: the baseline is uncompacted and the
      // replayable history still holds the asset-bearing create entries, so the
      // publication touches neither the transaction nor the reconcile.
      expect(begin).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();

      // Control: the same spies fire on the conversion the refusal falls back to,
      // so the two assertions above are read from a live path.
      const retargeted = removalItem('remove-2');
      commitRemoval(dispatch(), retargeted, {
        ...(deriveRemoveLayerEntry(retargeted) as DurableHistoryEntry),
        operation: { kind: 'remove-layer', layerId: 'layer-2' },
      } as DurableHistoryEntry);

      expect(begin).toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalled();
    } finally {
      begin.mockRestore();
      reconcile.mockRestore();
    }
  });
});

describe('COMMIT_DOCUMENT_EDIT publishes a planned durable entry', () => {
  it('appends the planned entry and advances the durable cursor by exactly one', () => {
    const { store, dispatch } = openDocument();
    const before = store().durableDocument!;
    // The document baseline is not a history entry, so the exact shadow starts empty.
    expect(before.history).toHaveLength(0);
    expect(before.cursor).toBe(-1);

    const entry = crop();
    commitCrop(dispatch(), entry, plannedFor(entry));

    const after = store();
    expect(after.documentFrame).toEqual(croppedFrame);
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument!.history).toHaveLength(1);
    expect(after.durableDocument!.history[0]).toMatchObject({
      id: entry.id,
      enabled: true,
      operation: { kind: 'set-document-frame', previous: defaultFrame, next: croppedFrame },
    });
    // Exactly one step, and never ahead of the legacy cursor.
    expect(after.durableDocument!.cursor).toBe(0);
    expect(after.durableDocument!.cursor).toBeLessThanOrEqual(after.historyIndex);
    expect(after.durableDocument!.durableRevision).toBe(before.durableRevision + 1);
    expect(after.durableDiagnostics).toEqual([]);
  });

  it('produces the same document as the full conversion', () => {
    const entry = crop();

    const { store, dispatch } = openDocument();
    commitCrop(dispatch(), entry, plannedFor(entry));
    const published = store().durableDocument;

    const { store: controlStore, dispatch: controlDispatch } = openDocument();
    commitCrop(controlDispatch(), crop());
    const converted = controlStore().durableDocument;

    expect(published).toEqual(converted);
  });

  it('falls back to the conversion and reports a disagreement', () => {
    const { store, dispatch } = openDocument();
    const entry = crop();
    const mismatched = {
      ...(plannedFor(entry) as DurableHistoryEntry),
      operation: { kind: 'set-document-frame', previous: defaultFrame, next: { ...croppedFrame, width: 1 } },
    } as DurableHistoryEntry;

    commitCrop(dispatch(), entry, mismatched);

    const after = store();
    // The edit is published and the shadow stays exact.
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument!.history[0].operation).toMatchObject({ next: croppedFrame });
    expect(after.durableDiagnostics).toEqual([
      expect.objectContaining({ code: 'durable-append-mismatch', severity: 'error', historyId: entry.id }),
    ]);
  });

  it('falls back silently when the append is not at the tip of the timeline', () => {
    const { store, dispatch } = openDocument();
    // Undo to the baseline, so the next append truncates the redo tail and the
    // store's durable document no longer describes the timeline being appended to.
    act(() => {
      dispatch()({
        type: 'APPLY_HISTORY_REPLAY',
        payload: { updates: {}, timeline: { entries: store().history, cursor: 0, branchRevision: 1 } },
      });
    });
    const entry = crop();
    commitCrop(dispatch(), entry, plannedFor(entry));

    const after = store();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument!.history).toHaveLength(1);
    expect(after.durableDiagnostics).toEqual([]);
  });

  it('falls back when the store has no exact durable document to extend', () => {
    const { store, dispatch } = openDocument();
    // `SET_SIZE` writes `totalSize`, one of the six durable inputs, so it marks
    // the sidecar stale: the stored document no longer describes this store, and
    // the append gate is handed no base to extend.
    act(() => {
      dispatch()({ type: 'SET_SIZE', payload: { width: 640, height: 480 } });
    });
    expect(store().durableStatus).toBe('stale');

    const entry = crop();
    commitCrop(dispatch(), entry, plannedFor(entry));

    expect(store().durableStatus).toBe('current');
    expect(store().durableDocument!.history).toHaveLength(1);
  });

  it('never publishes an entry that disagrees with the legacy entry id', () => {
    const { store, dispatch } = openDocument();
    const entry = crop();
    const foreign = { ...(plannedFor(entry) as DurableHistoryEntry), id: 'somewhere-else' } as DurableHistoryEntry;

    commitCrop(dispatch(), entry, foreign);

    const after = store();
    expect(after.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(after.durableDocument!.history.at(-1)?.id).toBe(entry.id);
    expect(after.durableDocument!.history.at(-1)?.id).not.toBe('somewhere-else');
  });

  it('accepts an entry with no plan at all, as every non-crop writer does', () => {
    const { store, dispatch } = openDocument();

    const entry = crop();
    commitCrop(dispatch(), entry, null);

    expect(store().durableStatus).toBe('current');
    expect(store().durableDiagnostics).toEqual([]);
    expect(store().durableDocument!.history).toHaveLength(1);
  });
});

describe('decideDurableAppend is what the store uses', () => {
  it('agrees with the store decision for the same inputs', () => {
    const { store, dispatch } = openDocument();
    const entry = crop();
    const planned = plannedFor(entry);
    const prior = {
      entries: store().history,
      cursor: store().historyIndex,
      branchRevision: store().branchRevision,
    };
    const next = {
      entries: [...prior.entries, entry],
      cursor: prior.entries.length,
      branchRevision: prior.branchRevision,
    };

    const decision = decideDurableAppend({
      documentId: store().documentId,
      base: store().durableDocument,
      prior,
      next,
      entry,
      planned,
      documentRevision: store().documentRevision,
    });

    expect(decision.outcome).toBe('published');
    commitCrop(dispatch(), entry, planned);
    expect(store().durableDocument!.history[0]).toEqual(
      decision.outcome === 'published' ? decision.document.history[0] : null
    );
  });

  it('agrees with the store decision for a layer-property entry', () => {
    const { store, dispatch } = openDocument();
    const entry = propertyItem('prop-rename', RENAME_LAYER_ACTION, { name: 'Renamed' });
    const planned = deriveSetLayerPropertiesEntry(entry)!;
    const prior = {
      entries: store().history,
      cursor: store().historyIndex,
      branchRevision: store().branchRevision,
    };
    const next = {
      entries: [...prior.entries, entry],
      cursor: prior.entries.length,
      branchRevision: prior.branchRevision,
    };

    const decision = decideDurableAppend({
      documentId: store().documentId,
      base: store().durableDocument,
      prior,
      next,
      entry,
      planned,
      documentRevision: store().documentRevision,
    });

    expect(decision.outcome).toBe('published');
    commitProperty(dispatch(), entry, planned, { name: 'Renamed' });
    expect(store().durableDocument!.history[0]).toEqual(
      decision.outcome === 'published' ? decision.document.history[0] : null
    );
  });
});

describe('COMMIT_DOCUMENT_EDIT publishes a planned layer-property entry', () => {
  it.each(propertyActions)('appends the planned %s entry under the legacy id', (actionName, patch) => {
    const { store, dispatch } = openDocument();
    const before = store().durableDocument!;
    expect(before.history).toHaveLength(0);

    const entry = propertyItem('prop-1', actionName, patch);
    const planned = deriveSetLayerPropertiesEntry(entry);
    expect(planned).not.toBeNull();
    commitProperty(dispatch(), entry, planned, patch);

    const after = store();
    expect(after.layers[layerId]).toMatchObject(patch);
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    expect(after.durableDocument!.history).toHaveLength(1);
    expect(after.durableDocument!.history[0]).toMatchObject({
      id: entry.id,
      enabled: true,
      operation: { kind: 'set-layer-properties', layerId, patch },
    });
    // One append mints one id, so the legacy timeline and the durable shadow name
    // the same entry and the cursor map cannot drift.
    expect(after.history).toHaveLength(2);
    expect(after.history[1]).toBe(entry);
    expect(after.durableDocument!.history[0]!.id).toBe(after.history[1]!.id);
    // Exactly one step, and never ahead of the legacy cursor.
    expect(after.durableDocument!.cursor).toBe(0);
    expect(after.durableDocument!.cursor).toBeLessThanOrEqual(after.historyIndex);
    expect(after.durableDocument!.durableRevision).toBe(before.durableRevision + 1);
  });

  it.each(propertyActions)(
    'produces the same document for a planned %s as the full conversion',
    (actionName, patch) => {
      const entry = propertyItem('prop-1', actionName, patch);

      const { store, dispatch } = openDocument();
      commitProperty(dispatch(), entry, deriveSetLayerPropertiesEntry(entry), patch);
      const published = store().durableDocument;

      const { store: controlStore, dispatch: controlDispatch } = openDocument();
      commitProperty(controlDispatch(), entry, null, patch);
      const converted = controlStore().durableDocument;

      expect(published).toEqual(converted);
    }
  );

  it.each(propertyActions)('publishes a second %s entry onto the first', (actionName, patch) => {
    const { store, dispatch } = openDocument();
    const first = propertyItem('prop-first', actionName, patch);
    commitProperty(dispatch(), first, deriveSetLayerPropertiesEntry(first), patch);
    const second = propertyItem('prop-second', actionName, patch);
    commitProperty(dispatch(), second, deriveSetLayerPropertiesEntry(second), patch);

    const after = store();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    expect(after.durableDocument!.history.map((published) => published.id)).toEqual([first.id, second.id]);
    expect(after.durableDocument!.cursor).toBe(1);
    expect(after.history).toHaveLength(3);
  });

  it('falls back to the conversion and reports the disagreement when the planned patch differs', () => {
    const { store, dispatch } = openDocument();
    const entry = propertyItem('prop-rename', RENAME_LAYER_ACTION, { name: 'Renamed' });
    const mismatched = {
      ...(deriveSetLayerPropertiesEntry(entry) as DurableHistoryEntry),
      operation: { kind: 'set-layer-properties', layerId, patch: { name: 'Something else' } },
    } as DurableHistoryEntry;

    commitProperty(dispatch(), entry, mismatched, { name: 'Renamed' });

    const after = store();
    // The edit is published and the shadow stays exact.
    expect(after.durableStatus).toBe('current');
    expect(after.durableDocument!.history[0].operation).toMatchObject({ patch: { name: 'Renamed' } });
    expect(after.durableDiagnostics).toEqual([
      expect.objectContaining({ code: 'durable-append-mismatch', severity: 'error', historyId: entry.id }),
    ]);
  });

  it('never publishes a layer-property entry that disagrees with the legacy entry id', () => {
    const { store, dispatch } = openDocument();
    const entry = propertyItem('prop-rename', RENAME_LAYER_ACTION, { name: 'Renamed' });
    const foreign = {
      ...(deriveSetLayerPropertiesEntry(entry) as DurableHistoryEntry),
      id: 'somewhere-else',
    } as DurableHistoryEntry;

    commitProperty(dispatch(), entry, foreign, { name: 'Renamed' });

    const after = store();
    expect(after.durableDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(['durable-append-mismatch']);
    expect(after.durableDocument!.history.at(-1)?.id).toBe(entry.id);
    expect(after.durableDocument!.history.at(-1)?.id).not.toBe('somewhere-else');
  });

  it('carries a disabled layer-property entry into the published document as disabled', () => {
    const { store, dispatch } = openDocument();
    const entry: HistoryItem = {
      ...propertyItem('prop-disabled', RENAME_LAYER_ACTION, { name: 'Renamed' }),
      disabled: true,
    };
    const planned = deriveSetLayerPropertiesEntry(entry);
    expect(planned!.enabled).toBe(false);

    commitProperty(dispatch(), entry, planned, { name: 'Renamed' });

    const after = store();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    expect(after.durableDocument!.history[0]).toMatchObject({ id: entry.id, enabled: false });
  });

  it('reports a mismatch when a publisher would re-enable a disabled layer-property entry', () => {
    const { store, dispatch } = openDocument();
    const entry: HistoryItem = {
      ...propertyItem('prop-disabled', RENAME_LAYER_ACTION, { name: 'Renamed' }),
      disabled: true,
    };
    const reenabled = {
      ...(deriveSetLayerPropertiesEntry(entry) as DurableHistoryEntry),
      enabled: true,
    } as DurableHistoryEntry;

    commitProperty(dispatch(), entry, reenabled, { name: 'Renamed' });

    const after = store();
    expect(after.durableDocument!.history[0]).toMatchObject({ id: entry.id, enabled: false });
    expect(after.durableDiagnostics).toEqual([
      expect.objectContaining({ code: 'durable-append-mismatch', severity: 'error', historyId: entry.id }),
    ]);
  });

  it('falls back when the store has no exact durable document to extend', () => {
    const { store, dispatch } = openDocument();
    // `totalSize` is the conversion's `initialSize`, so a genuinely different size
    // is the one transition outside the document writers that invalidates the
    // sidecar. `UPDATE_LAYERS` was the previous way to arrange this state and was
    // deleted: a public action with a hand-written reducer branch, zero
    // production callers and no guard against moving durable layer state.
    act(() => {
      dispatch()({
        type: 'SET_SIZE',
        payload: { width: store().totalSize.width + 1, height: store().totalSize.height },
      });
    });
    expect(store().durableStatus).toBe('stale');

    const entry = propertyItem('prop-rename', RENAME_LAYER_ACTION, { name: 'Renamed' });
    commitProperty(dispatch(), entry, deriveSetLayerPropertiesEntry(entry), { name: 'Renamed' });

    expect(store().durableStatus).toBe('current');
    expect(store().durableDocument!.history).toHaveLength(1);
  });

  it('refuses a rename whose value is unreadable rather than manufacturing a durable no-op', () => {
    const { store, dispatch } = openDocument();
    const entry = propertyItem('prop-bad-rename', RENAME_LAYER_ACTION, { name: 42 });
    expect(deriveSetLayerPropertiesEntry(entry)).toBeNull();

    commitProperty(dispatch(), entry, null, { name: 42 as unknown as string });

    const after = store();
    expect(after.durableStatus).toBe('current');
    expect(after.durableDiagnostics).toEqual([]);
    // No operation is invented for a property the boundary cannot read: the
    // durable cursor stays on the baseline instead of advancing over a no-op,
    // while the legacy timeline keeps the entry as the replay authority.
    expect(after.durableDocument!.history).toHaveLength(0);
    expect(after.durableDocument!.cursor).toBe(-1);
    expect(after.history).toHaveLength(2);
    expect(after.history[1]).toBe(entry);
    expect(after.historyIndex).toBe(1);
  });
});
