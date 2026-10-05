import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import {
  decideDurableAppend,
  deriveMergeDocumentEntry,
  validatePlannedDurableEntry,
  type SourceBackedEntryContext,
} from '../history-append.ts';
import { legacyHistoryToDurable } from '../history-adapter.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, LayerSource } from '../layer-types.ts';
import { MERGE_ACTION, NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION } from '../../util/constants.ts';

const documentId = 'merge-append-doc';
const frame: DocumentFrame = { x: 0, y: 0, width: 400, height: 300 };
const source: LayerSource = {
  kind: 'blank',
  color: '#ffffff',
  opacity: 1,
  isBedrock: false,
  pos: { x: 0, y: 0, width: 100, height: 80 },
};

function blankLayer(id: string, order: number): Layer {
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

function baseline(layers: Record<string, Layer>): HistoryItem {
  return {
    id: 'baseline',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId: Object.keys(layers)[0]!,
    documentSource: { layers, size: { width: frame.width, height: frame.height }, frame },
  };
}

function mergeItem(layerId: string, id = 'merge'): HistoryItem {
  return { id, actionName: MERGE_ACTION, layerId, layerSource: source };
}

function preLayers(document: ReturnType<typeof legacyHistoryToDurable>['document']) {
  return new Map(
    Object.entries(replayDurableDocument(document).layers).map(([id, replayLayer]) => [id, replayLayer.snapshot])
  );
}

function mergeContext(registry: AssetRegistry, layers: ReturnType<typeof preLayers>): SourceBackedEntryContext {
  return { documentId, registry, preLayers: layers };
}

describe('history append atomic merge planning', () => {
  it('names every pre-append layer except the merge result', () => {
    const registry = new AssetRegistry();
    try {
      const layerRecord = { 'layer-1': blankLayer('layer-1', 0), 'layer-2': blankLayer('layer-2', 1) };
      const added: HistoryItem = {
        id: 'new-layer-2',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-2',
        layerSource: source,
      };
      const converted = legacyHistoryToDurable([baseline(layerRecord), added], { documentId, registry });
      const before = preLayers(converted.document);
      const item = mergeItem('merged');
      const entry = deriveMergeDocumentEntry(item, mergeContext(registry, before));

      expect(entry?.operation).toMatchObject({ kind: 'merge-document', removedLayerIds: ['layer-1', 'layer-2'] });
      expect(validatePlannedDurableEntry(item, entry!, undefined, before)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('publishes exactly one merge entry and advances durable revision once', () => {
    const registry = new AssetRegistry();
    try {
      const layerRecord = { 'layer-1': blankLayer('layer-1', 0), 'layer-2': blankLayer('layer-2', 1) };
      const added: HistoryItem = {
        id: 'new-layer-2',
        actionName: NEW_LAYER_ACTION,
        layerId: 'layer-2',
        layerSource: source,
      };
      const history = [baseline(layerRecord), added];
      const converted = legacyHistoryToDurable(history, { documentId, registry });
      const before = preLayers(converted.document);
      const item = mergeItem('merged');
      const planned = deriveMergeDocumentEntry(item, mergeContext(registry, before));
      const prior = { entries: history, cursor: 1, branchRevision: 0 };
      const next = { entries: [...history, item], cursor: 2, branchRevision: 0 };
      const decision = decideDurableAppend({
        documentId,
        base: converted.document,
        prior,
        next,
        entry: item,
        planned,
        documentRevision: 0,
        preLayers: before,
      });

      expect(decision.outcome).toBe('published');
      if (decision.outcome !== 'published') return;
      expect(decision.document.history).toHaveLength(converted.document.history.length + 1);
      expect(decision.document.history.at(-1)?.operation.kind).toBe('merge-document');
      expect(decision.document.durableRevision).toBe(converted.document.durableRevision + 1);
    } finally {
      registry.shutdown();
    }
  });

  it('publishes a single-layer merge with an empty removal set as one operation', () => {
    const registry = new AssetRegistry();
    try {
      const layerRecord = { 'layer-1': blankLayer('layer-1', 0) };
      const history = [baseline(layerRecord)];
      const converted = legacyHistoryToDurable(history, { documentId, registry });
      const before = preLayers(converted.document);
      const item = mergeItem('layer-1', 'merge-single');
      const planned = deriveMergeDocumentEntry(item, mergeContext(registry, before));

      expect(planned?.operation).toMatchObject({ kind: 'merge-document', removedLayerIds: [] });
      const decision = decideDurableAppend({
        documentId,
        base: converted.document,
        prior: { entries: history, cursor: 0, branchRevision: 0 },
        next: { entries: [...history, item], cursor: 1, branchRevision: 0 },
        entry: item,
        planned,
        documentRevision: 0,
        preLayers: before,
      });

      expect(decision.outcome).toBe('published');
    } finally {
      registry.shutdown();
    }
  });
});
