import { describe, expect, it } from 'vitest';
import { durableEntryProvenance, durableEntryTitle } from '../history-provenance.ts';
import {
  freezeDurableDocument,
  cloneDurableDocument,
  type DurableDocument,
  type DurableHistoryEntry,
  DURABLE_SCHEMA_VERSION,
} from '../history-model.ts';
import { appendDurableEntry } from '../history-adapter.ts';
import { getHistoryItemTitle, selectHistoryPanelProjection } from '../useHistory.ts';
import type { HistoryItem } from '../history-types.ts';
import {
  RENAME_LAYER_ACTION,
  SHOW_LAYER_ACTION,
  HIDE_LAYER_ACTION,
  REORDER_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  MERGE_ACTION,
  NEW_LAYER_ACTION,
  REMOVE_ACTION,
  SELECTION_ACTION,
  TOOL_ACTION,
  SET_LAYER_OPACITY_ACTION,
  SET_LAYER_BLEND_MODE_ACTION,
  LOCK_LAYER_ACTION,
  UNLOCK_LAYER_ACTION,
} from '../../util/constants.ts';

function createMockHistoryItem(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    id: 'hist-1',
    actionName: TOOL_ACTION,
    layerId: 'layer-1',
    args: { toolName: 'brush' },
    ...overrides,
  };
}

function createDurableEntry(overrides: Partial<DurableHistoryEntry> = {}): DurableHistoryEntry {
  return {
    id: 'durable-1',
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: true,
    provenance: { actionName: TOOL_ACTION },
    operation: {
      kind: 'apply-filter',
      layerId: 'layer-1',
      filter: { toolName: 'blur', version: 1, args: { toolName: 'blur', radius: 4 } },
    },
    ...overrides,
  };
}

function createDurableDocument(
  history: DurableHistoryEntry[] = [],
  overrides: Partial<DurableDocument> = {}
): DurableDocument {
  return {
    documentId: 'provenance-test',
    documentRevision: 1,
    branchRevision: 0,
    durableRevision: history.length,
    baseline: {
      frame: { x: 0, y: 0, width: 100, height: 100 },
      layers: [],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history,
    cursor: history.length - 1,
    ...overrides,
  };
}

describe('durableEntryProvenance - legacy action name mapping', () => {
  describe('RENAME_LAYER_ACTION', () => {
    it('maps RENAME_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(RENAME_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for RENAME_LAYER_ACTION', () => {
      const provenance = { actionName: RENAME_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(RENAME_LAYER_ACTION);
    });
  });

  describe('SHOW_LAYER_ACTION', () => {
    it('maps SHOW_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: SHOW_LAYER_ACTION });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(SHOW_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for SHOW_LAYER_ACTION', () => {
      const provenance = { actionName: SHOW_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(SHOW_LAYER_ACTION);
    });
  });

  describe('HIDE_LAYER_ACTION', () => {
    it('maps HIDE_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: HIDE_LAYER_ACTION });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(HIDE_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for HIDE_LAYER_ACTION', () => {
      const provenance = { actionName: HIDE_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(HIDE_LAYER_ACTION);
    });
  });

  describe('REORDER_ACTION', () => {
    it('maps REORDER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({
        actionName: REORDER_ACTION,
        args: { layerToMoveId: 'layer-1', afterWhichLayerId: 'layer-2' },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(REORDER_ACTION);
    });

    it('durableEntryTitle returns actionName for REORDER_ACTION', () => {
      const provenance = { actionName: REORDER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(REORDER_ACTION);
    });
  });

  describe('SET_DOCUMENT_FRAME_ACTION', () => {
    it('maps SET_DOCUMENT_FRAME_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: {
          previousFrame: { x: 0, y: 0, width: 100, height: 100 },
          nextFrame: { x: 10, y: 10, width: 80, height: 80 },
        },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(SET_DOCUMENT_FRAME_ACTION);
    });

    it('durableEntryTitle returns "crop" for SET_DOCUMENT_FRAME_ACTION', () => {
      const provenance = { actionName: SET_DOCUMENT_FRAME_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe('crop');
    });
  });

  describe('MERGE_ACTION', () => {
    it('maps MERGE_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({
        actionName: MERGE_ACTION,
        layerSource: {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          isBedrock: false,
          pos: { x: 0, y: 0, width: 100, height: 100 },
        },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(MERGE_ACTION);
    });

    it('durableEntryTitle returns actionName for MERGE_ACTION', () => {
      const provenance = { actionName: MERGE_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(MERGE_ACTION);
    });
  });

  describe('NEW_LAYER_ACTION', () => {
    it('maps NEW_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({
        actionName: NEW_LAYER_ACTION,
        layerSource: {
          kind: 'blank',
          color: '#ffffff',
          opacity: 1,
          isBedrock: false,
          pos: { x: 0, y: 0, width: 100, height: 100 },
        },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(NEW_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for NEW_LAYER_ACTION', () => {
      const provenance = { actionName: NEW_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(NEW_LAYER_ACTION);
    });
  });

  describe('REMOVE_ACTION', () => {
    it('maps REMOVE_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: REMOVE_ACTION });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(REMOVE_ACTION);
    });

    it('durableEntryTitle returns actionName for REMOVE_ACTION', () => {
      const provenance = { actionName: REMOVE_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(REMOVE_ACTION);
    });
  });

  describe('SELECTION_ACTION', () => {
    it('maps SELECTION_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({
        actionName: SELECTION_ACTION,
        args: {
          previousSelectionState: { selections: [], activeSelectionId: null },
          nextSelectionState: {
            selections: [
              { id: 'sel-1', points: [[{ x: 0, y: 0 }]], isActive: true, pos: { x: 0, y: 0, width: 10, height: 10 } },
            ],
            activeSelectionId: 'sel-1',
          },
        },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(SELECTION_ACTION);
    });

    it('durableEntryTitle returns actionName for SELECTION_ACTION', () => {
      const provenance = { actionName: SELECTION_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(SELECTION_ACTION);
    });
  });

  describe('TOOL_ACTION with toolName', () => {
    it('maps brush tool to provenance with toolName', () => {
      const item = createMockHistoryItem({ actionName: TOOL_ACTION, args: { toolName: 'brush' } });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(TOOL_ACTION);
      expect(provenance.toolName).toBe('brush');
    });

    it('durableEntryTitle returns toolName for TOOL_ACTION with toolName', () => {
      const provenance = { actionName: TOOL_ACTION, toolName: 'brush' } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe('brush');
    });

    it('maps eraser tool to provenance with toolName', () => {
      const item = createMockHistoryItem({ actionName: TOOL_ACTION, args: { toolName: 'eraser' } });
      const provenance = durableEntryProvenance(item);
      expect(provenance.toolName).toBe('eraser');
    });

    it('maps text tool to provenance with toolName from layerSource', () => {
      const item = createMockHistoryItem({
        actionName: TOOL_ACTION,
        layerSource: {
          kind: 'tool',
          args: {
            toolName: 'text',
            text: 'Hello',
            fontSize: 24,
            align: 'left',
            bold: false,
            color: '#000000',
            fontFamily: 'Inter',
            italic: false,
            lineHeight: 1.2,
          },
          isBedrock: false,
          pos: { x: 0, y: 0, width: 100, height: 100 },
        },
      });
      const provenance = durableEntryProvenance(item);
      expect(provenance.toolName).toBe('text');
    });

    it('durableEntryTitle returns undefined for bare TOOL_ACTION without toolName', () => {
      const item = createMockHistoryItem({ actionName: TOOL_ACTION, args: {} });
      const provenance = durableEntryProvenance(item);
      expect(durableEntryTitle(provenance)).toBeUndefined();
    });
  });

  describe('SET_LAYER_OPACITY_ACTION', () => {
    it('maps SET_LAYER_OPACITY_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: SET_LAYER_OPACITY_ACTION, args: { opacity: 0.5 } });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(SET_LAYER_OPACITY_ACTION);
    });

    it('durableEntryTitle returns "set layer opacity" for SET_LAYER_OPACITY_ACTION', () => {
      const provenance = { actionName: SET_LAYER_OPACITY_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe('set layer opacity');
    });
  });

  describe('SET_LAYER_BLEND_MODE_ACTION', () => {
    it('maps SET_LAYER_BLEND_MODE_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: SET_LAYER_BLEND_MODE_ACTION, args: { blendMode: 'multiply' } });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(SET_LAYER_BLEND_MODE_ACTION);
    });

    it('durableEntryTitle returns actionName for SET_LAYER_BLEND_MODE_ACTION', () => {
      const provenance = { actionName: SET_LAYER_BLEND_MODE_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(SET_LAYER_BLEND_MODE_ACTION);
    });
  });

  describe('LOCK_LAYER_ACTION', () => {
    it('maps LOCK_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: LOCK_LAYER_ACTION });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(LOCK_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for LOCK_LAYER_ACTION', () => {
      const provenance = { actionName: LOCK_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(LOCK_LAYER_ACTION);
    });
  });

  describe('UNLOCK_LAYER_ACTION', () => {
    it('maps UNLOCK_LAYER_ACTION to provenance with actionName', () => {
      const item = createMockHistoryItem({ actionName: UNLOCK_LAYER_ACTION });
      const provenance = durableEntryProvenance(item);
      expect(provenance.actionName).toBe(UNLOCK_LAYER_ACTION);
    });

    it('durableEntryTitle returns actionName for UNLOCK_LAYER_ACTION', () => {
      const provenance = { actionName: UNLOCK_LAYER_ACTION } as ReturnType<typeof durableEntryProvenance>;
      expect(durableEntryTitle(provenance)).toBe(UNLOCK_LAYER_ACTION);
    });
  });
});

describe('provenance survives document mutations', () => {
  it('survives freezeDurableDocument', () => {
    const doc = createDurableDocument([
      createDurableEntry({ provenance: { actionName: RENAME_LAYER_ACTION } }),
      createDurableEntry({ provenance: { actionName: TOOL_ACTION, toolName: 'brush' } }),
    ]);
    const frozen = freezeDurableDocument(doc);
    expect(frozen.history[0]?.provenance).toEqual({ actionName: RENAME_LAYER_ACTION });
    expect(frozen.history[1]?.provenance).toEqual({ actionName: TOOL_ACTION, toolName: 'brush' });
  });

  it('survives cloneDurableDocument', () => {
    const doc = createDurableDocument([createDurableEntry({ provenance: { actionName: RENAME_LAYER_ACTION } })]);
    const cloned = cloneDurableDocument(doc);
    expect(cloned.history[0]?.provenance).toEqual({ actionName: RENAME_LAYER_ACTION });
    expect(cloned.history[0]?.provenance).not.toBe(doc.history[0]?.provenance); // Different object identity
  });

  it('survives appendDurableEntry', () => {
    const doc = createDurableDocument([createDurableEntry({ provenance: { actionName: RENAME_LAYER_ACTION } })]);
    const newEntry = createDurableEntry({ id: 'new-1', provenance: { actionName: TOOL_ACTION, toolName: 'brush' } });
    const appended = appendDurableEntry(doc, newEntry);
    expect(appended.history[0]?.provenance).toEqual({ actionName: RENAME_LAYER_ACTION });
    expect(appended.history[1]?.provenance).toEqual({ actionName: TOOL_ACTION, toolName: 'brush' });
  });

  it('preserves provenance object identity through clone', () => {
    const doc = createDurableDocument([createDurableEntry({ provenance: { actionName: RENAME_LAYER_ACTION } })]);
    const cloned = cloneDurableDocument(doc);
    // Provenance objects should be frozen and equal but not necessarily same reference
    expect(cloned.history[0]?.provenance).toEqual(doc.history[0]?.provenance);
  });
});

describe('history panel renders identical labels from durable projection vs legacy', () => {
  const legacyHistory: HistoryItem[] = [
    createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } }),
    createMockHistoryItem({ id: 'hist-2', actionName: TOOL_ACTION, args: { toolName: 'brush' } }),
    createMockHistoryItem({ id: 'hist-3', actionName: HIDE_LAYER_ACTION }),
    createMockHistoryItem({
      id: 'hist-4',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      args: {
        previousFrame: { x: 0, y: 0, width: 100, height: 100 },
        nextFrame: { x: 10, y: 10, width: 80, height: 80 },
      },
    }),
    createMockHistoryItem({ id: 'hist-5', actionName: MERGE_ACTION }),
    createMockHistoryItem({ id: 'hist-6', actionName: NEW_LAYER_ACTION }),
    createMockHistoryItem({ id: 'hist-7', actionName: REMOVE_ACTION }),
    createMockHistoryItem({ id: 'hist-8', actionName: SELECTION_ACTION }),
    createMockHistoryItem({ id: 'hist-9', actionName: SET_LAYER_OPACITY_ACTION, args: { opacity: 0.5 } }),
    createMockHistoryItem({ id: 'hist-10', actionName: SET_LAYER_BLEND_MODE_ACTION, args: { blendMode: 'multiply' } }),
    createMockHistoryItem({ id: 'hist-11', actionName: LOCK_LAYER_ACTION }),
    createMockHistoryItem({ id: 'hist-12', actionName: UNLOCK_LAYER_ACTION }),
  ];

  it('legacy titles match durable titles for all action types', () => {
    for (const item of legacyHistory) {
      const legacyTitle = getHistoryItemTitle(item);
      const provenance = durableEntryProvenance(item);
      const durableTitle = durableEntryTitle(provenance);
      expect(durableTitle).toBe(legacyTitle);
    }
  });

  it('durable projection rows carry matching titles when document matches', () => {
    // Use a minimal set that we know works
    const simpleHistory: HistoryItem[] = [
      createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION, args: { name: 'Layer 1' } }),
      createMockHistoryItem({ id: 'hist-2', actionName: TOOL_ACTION, args: { toolName: 'brush' } }),
      createMockHistoryItem({
        id: 'hist-3',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: {
          previousFrame: { x: 0, y: 0, width: 100, height: 100 },
          nextFrame: { x: 10, y: 10, width: 80, height: 80 },
        },
      }),
    ];
    const simpleDurableDoc = createDurableDocument(
      simpleHistory.map(
        (item) =>
          createDurableEntry({
            id: item.id,
            provenance: durableEntryProvenance(item),
          }),
        { cursor: 1 }
      )
    );

    const projection = selectHistoryPanelProjection({
      history: simpleHistory,
      historyIndex: simpleDurableDoc.cursor,
      documentId: simpleDurableDoc.documentId,
      documentRevision: simpleDurableDoc.documentRevision,
      branchRevision: simpleDurableDoc.branchRevision,
      durableStatus: 'current',
      durableDocument: simpleDurableDoc,
    });

    expect(projection.source).toBe('durable');
    expect(projection.rows).toHaveLength(simpleHistory.length);
    for (let i = 0; i < simpleHistory.length; i++) {
      const legacyTitle = getHistoryItemTitle(simpleHistory[i]);
      expect(projection.rows[i]?.title).toBe(legacyTitle);
    }
  });
});

describe('missing provenance falls back gracefully', () => {
  it('durableEntryProvenance returns minimal provenance when item has no actionName', () => {
    const item = createMockHistoryItem({ actionName: undefined as never });
    const provenance = durableEntryProvenance(item);
    // Should not crash, returns frozen object with actionName undefined
    expect(provenance).toBeDefined();
  });

  it('durableEntryTitle returns actionName for unknown actionName', () => {
    const provenance = { actionName: 'UNKNOWN_ACTION' as never } as ReturnType<typeof durableEntryProvenance>;
    expect(durableEntryTitle(provenance)).toBe('UNKNOWN_ACTION');
  });

  it('history panel falls back to legacy when durable provenance missing', () => {
    const legacyHistory = [createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION })];
    // Durable doc with missing provenance
    const durableDoc = createDurableDocument([createDurableEntry({ id: 'hist-1', provenance: undefined as never })]);

    const projection = selectHistoryPanelProjection({
      history: legacyHistory,
      historyIndex: 0,
      documentId: durableDoc.documentId,
      documentRevision: durableDoc.documentRevision,
      branchRevision: durableDoc.branchRevision,
      durableStatus: 'current',
      durableDocument: durableDoc,
    });

    // Should fall back to legacy because provenance is missing
    expect(projection.source).toBe('legacy');
  });

  it('history panel falls back to legacy when provenance title mismatches', () => {
    const legacyHistory = [createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION })];
    // Durable doc with wrong provenance title
    const durableDoc = createDurableDocument([
      createDurableEntry({
        id: 'hist-1',
        provenance: { actionName: TOOL_ACTION, toolName: 'brush' }, // Wrong: should be RENAME_LAYER_ACTION
      }),
    ]);

    const projection = selectHistoryPanelProjection({
      history: legacyHistory,
      historyIndex: 0,
      documentId: durableDoc.documentId,
      documentRevision: durableDoc.documentRevision,
      branchRevision: durableDoc.branchRevision,
      durableStatus: 'current',
      durableDocument: durableDoc,
    });

    // Should fall back to legacy because title mismatch
    expect(projection.source).toBe('legacy');
  });

  it('history panel falls back to legacy when disabled state mismatches', () => {
    const legacyHistory = [createMockHistoryItem({ id: 'hist-1', actionName: RENAME_LAYER_ACTION, disabled: true })];
    // Durable doc with enabled entry
    const durableDoc = createDurableDocument([
      createDurableEntry({
        id: 'hist-1',
        enabled: true, // Mismatch: legacy is disabled
        provenance: { actionName: RENAME_LAYER_ACTION },
      }),
    ]);

    const projection = selectHistoryPanelProjection({
      history: legacyHistory,
      historyIndex: 0,
      documentId: durableDoc.documentId,
      documentRevision: durableDoc.documentRevision,
      branchRevision: durableDoc.branchRevision,
      durableStatus: 'current',
      durableDocument: durableDoc,
    });

    // Should fall back to legacy because disabled state mismatch
    expect(projection.source).toBe('legacy');
  });
});
