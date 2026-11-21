import { describe, expect, it } from 'vitest';

import { DURABLE_SCHEMA_VERSION, type DurableDocument, type DurableHistoryEntry } from '../history-model.ts';
import { durableEntryProvenance } from '../history-provenance.ts';
import { selectHistoryPanelProjection } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import { OPEN_DOCUMENT_ACTION, RENAME_LAYER_ACTION, SET_LAYER_OPACITY_ACTION } from '../../util/constants.ts';

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
    const safePrefix = documentFor([entry(history[0]!)], 0);
    const projection = project(history, safePrefix, 0, 'partial');

    expect(projection.source).toBe('legacy');
    expect(projection.rows.map((row) => row.item.id)).toEqual(history.map((item) => item.id));
    expect(projection.rows.map((row) => row.isCurrent)).toEqual(history.map((_, index) => index === 0));
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

  it('falls back when an aligned durable entry has a different history id', () => {
    const entries = history.map(entry);
    const staleEntry = { ...entries[0]!, id: 'stale-id' };

    expect(project(history, documentFor([staleEntry, entries[1]!])).source).toBe('legacy');
  });

  it('falls back when the opening baseline row has no durable counterpart', () => {
    const openingRow: HistoryItem = { id: 'opening', actionName: OPEN_DOCUMENT_ACTION, layerId: 'layer-1' };
    const legacyHistory = [openingRow, ...history];

    expect(project(legacyHistory, documentFor(history.map(entry))).source).toBe('legacy');
  });

  it('falls back when durableDocument is null', () => {
    expect(project(history, null).source).toBe('legacy');
  });

  it('falls back when documentId mismatches', () => {
    const doc = documentFor();
    const mismatchedDoc = { ...doc, documentId: 'document-2' };
    expect(project(history, mismatchedDoc).source).toBe('legacy');
  });

  it('falls back when documentRevision mismatches', () => {
    const doc = documentFor();
    const mismatchedDoc = { ...doc, documentRevision: 99 };
    expect(project(history, mismatchedDoc).source).toBe('legacy');
  });

  it('falls back when branchRevision mismatches', () => {
    const doc = documentFor();
    const mismatchedDoc = { ...doc, branchRevision: 99 };
    expect(project(history, mismatchedDoc).source).toBe('legacy');
  });

  it('falls back when historyIndex is out of bounds (negative)', () => {
    const historyIndex = -1;
    expect(project(history, documentFor(history.map(entry), historyIndex), historyIndex).source).toBe('legacy');
  });

  it('falls back when historyIndex is out of bounds (past end)', () => {
    const historyIndex = history.length;
    expect(project(history, documentFor(history.map(entry), historyIndex), historyIndex).source).toBe('legacy');
  });

  it('falls back when history is empty and historyIndex is not -1', () => {
    for (const historyIndex of [0, 5]) {
      expect(project([], documentFor([], historyIndex), historyIndex).source).toBe('legacy');
    }
  });

  it('falls back when legacyTitle does not match durableTitle', () => {
    const entries = history.map(entry);
    const mismatchedProvenance: DurableHistoryEntry = {
      ...entries[0],
      provenance: {
        ...entries[0]!.provenance!,
        actionName: SET_LAYER_OPACITY_ACTION,
      },
    };
    expect(project(history, documentFor([mismatchedProvenance, entries[1]])).source).toBe('legacy');
  });

  it('admits disabled legacy rows when the durable enabled state matches', () => {
    const disabledHistory: HistoryItem[] = [{ ...history[0]!, disabled: true }, history[1]!];
    const entries = disabledHistory.map(entry);
    expect(project(disabledHistory, documentFor(entries)).source).toBe('durable');
  });

  it('falls back when item is enabled but entry.enabled is false', () => {
    const entries = history.map(entry);
    const entryWithWrongEnabled = { ...entries[0]!, enabled: false };
    expect(project(history, documentFor([entryWithWrongEnabled, entries[1]])).source).toBe('legacy');
  });
});
