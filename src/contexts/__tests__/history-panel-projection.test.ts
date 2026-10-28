import { describe, expect, it } from 'vitest';

import { DURABLE_SCHEMA_VERSION, type DurableDocument, type DurableHistoryEntry } from '../history-model.ts';
import { durableEntryProvenance } from '../history-provenance.ts';
import { selectHistoryPanelProjection } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import { RENAME_LAYER_ACTION, SET_LAYER_OPACITY_ACTION } from '../../util/constants.ts';

const history: HistoryItem[] = [
  { id: 'rename', actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: 'Renamed' } },
  { id: 'opacity', actionName: SET_LAYER_OPACITY_ACTION, layerId: 'layer-1', args: { opacity: 0.5 } },
];

const emptySelection = { selections: [], activeSelectionId: null } as const;

function entry(item: HistoryItem): DurableHistoryEntry {
  return {
    id: item.id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: !item.disabled,
    provenance: durableEntryProvenance(item),
    operation: { kind: 'set-selection', before: emptySelection, after: emptySelection },
  };
}

function documentFor(entries: readonly DurableHistoryEntry[] = history.map(entry), cursor = 1): DurableDocument {
  return {
    documentId: 'document-1',
    documentRevision: 3,
    branchRevision: 4,
    durableRevision: 5,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [],
      selections: emptySelection,
      activeLayerId: null,
    },
    history: entries,
    cursor,
  };
}

function project(
  sourceHistory: readonly HistoryItem[] = history,
  durableDocument: DurableDocument | null = documentFor(),
  historyIndex = 1,
  durableStatus = 'current'
) {
  return selectHistoryPanelProjection({
    history: sourceHistory,
    historyIndex,
    documentId: 'document-1',
    documentRevision: 3,
    branchRevision: 4,
    durableStatus,
    durableDocument,
  });
}

describe('selectHistoryPanelProjection', () => {
  it('admits a complete one-to-one durable timeline', () => {
    const projection = project();

    expect(projection.source).toBe('durable');
    expect(projection.rows.map((row) => row.item.id)).toEqual(['rename', 'opacity']);
    expect(projection.rows[1]?.isCurrent).toBe(true);
  });

  it('falls back when durable provenance is missing', () => {
    const entries = history.map(entry);
    const withoutProvenance = { ...entries[0], provenance: undefined };

    expect(project(history, documentFor([withoutProvenance, entries[1]] as DurableHistoryEntry[])).source).toBe(
      'legacy'
    );
  });

  it('falls back when durable status is partial even with a valid safe-prefix document', () => {
    expect(project(history, documentFor(), 1, 'partial').source).toBe('legacy');
  });

  it('falls back for duplicate legacy or durable ids', () => {
    const duplicateHistory = [history[0]!, { ...history[1]!, id: history[0]!.id }];
    expect(project(duplicateHistory).source).toBe('legacy');

    const entries = history.map(entry);
    expect(project(history, documentFor([entries[0]!, { ...entries[1]!, id: entries[0]!.id }])).source).toBe('legacy');
  });

  it('falls back when the durable cursor does not match the legacy cursor', () => {
    expect(project(history, documentFor(history.map(entry), 0)).source).toBe('legacy');
  });

  it('falls back when the opening baseline row has no durable counterpart', () => {
    const openingRow: HistoryItem = { id: 'opening', actionName: 'open document', layerId: 'layer-1' };
    const legacyHistory = [openingRow, ...history];

    expect(project(legacyHistory, documentFor(history.map(entry))).source).toBe('legacy');
  });
});
