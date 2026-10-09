import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import {
  deriveReplaceLayerSourceEntry,
  editableSourceReplacementFromEntry,
  editableDurableSourceKind,
  legacyHistoryToDurable,
} from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { collectDurableAssetIds, type DurableHistoryEntry } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { Layer, ToolLayerSource } from '../layer-types.ts';
import { NEW_LAYER_ACTION, OPEN_DOCUMENT_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { ActionType } from '../../util/constants.ts';
import type { ToolArgs } from '../tool-types.ts';

const documentId = 'source-edit-conversion';
const layerId = 'layer-1';
const firstBox = { x: 20, y: 30, width: 120, height: 40 };
const secondBox = { x: 20, y: 30, width: 220, height: 40 };

/**
 * The action name a source edit needs, and which does not exist yet.
 *
 * `ActionType` is a closed union of the constants in `util/constants.ts`, and no
 * constant there means "replace this layer's source". Naming one is the legacy
 * producer's change, not this slice's: the cast below stands for that missing
 * declaration, and every assertion here is about the durable operation the entry
 * converts to, which is fully determined by the `args.source` carrier and needs
 * no constant to exist.
 */
const REPLACE_LAYER_SOURCE_ACTION = 'edit layer source' as ActionType;

const firstText: ToolArgs = {
  toolName: 'text',
  align: 'left',
  bold: false,
  color: '#000000',
  fontFamily: 'Inter',
  fontSize: 24,
  italic: false,
  lineHeight: 1.2,
  text: 'First draft',
};
const secondText: ToolArgs = { ...firstText, text: 'Second draft', fontSize: 48 };

function toolSource(args: ToolArgs, box = firstBox): ToolLayerSource {
  return { kind: 'tool', args, isBedrock: false, pos: { ...box } };
}

function textLayer(): Layer {
  return {
    id: layerId,
    name: 'text',
    isBedrock: false,
    tmpCanvas: null,
    bitmap: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...firstBox },
    presentationBounds: null,
    source: toolSource(firstText),
    operations: [],
  };
}

function openingEntry(): HistoryItem {
  return {
    id: 'open',
    actionName: OPEN_DOCUMENT_ACTION,
    layerId,
    documentSource: { layers: { [layerId]: textLayer() }, size: { width: 400, height: 300 } },
  };
}

function sourceEdit(source: ToolLayerSource, id = 'retype', layer = layerId): HistoryItem {
  return { id, actionName: REPLACE_LAYER_SOURCE_ACTION, layerId: layer, args: { source } };
}

function convert(registry: AssetRegistry, ...items: HistoryItem[]) {
  return legacyHistoryToDurable([openingEntry(), ...items], { documentId, registry });
}

describe('editableDurableSourceKind', () => {
  it('types the text and vector tools and refuses everything else', () => {
    expect(editableDurableSourceKind('text')).toBe('text');
    for (const toolName of ['shape', 'rectangle', 'ellipse', 'triangle', 'polygon', 'line']) {
      expect(editableDurableSourceKind(toolName)).toBe('vector');
    }
    for (const toolName of ['pencil', 'brush', 'blur', 'transform', 'crop', 'custom-shape']) {
      expect(editableDurableSourceKind(toolName)).toBeNull();
    }
  });
});

describe('editableSourceReplacementFromEntry', () => {
  it('reads the replacement source out of the entry args', () => {
    const source = toolSource(secondText, secondBox);

    expect(editableSourceReplacementFromEntry(sourceEdit(source))).toBe(source);
  });

  it('refuses an entry that carries a creation source of its own', () => {
    const item: HistoryItem = {
      id: 'create',
      actionName: NEW_LAYER_ACTION,
      layerId,
      layerSource: toolSource(secondText, secondBox),
    };

    expect(editableSourceReplacementFromEntry(item)).toBeUndefined();
  });

  it('refuses a bedrock source, whose size is the document', () => {
    const source: ToolLayerSource = {
      kind: 'tool',
      args: secondText,
      isBedrock: true,
      size: { width: 400, height: 300 },
    };

    expect(editableSourceReplacementFromEntry(sourceEdit(source))).toBeUndefined();
  });

  it('refuses a tool with no editable durable source', () => {
    const source = toolSource({ toolName: 'pencil' } as ToolArgs, secondBox);

    expect(editableSourceReplacementFromEntry(sourceEdit(source))).toBeUndefined();
  });

  it('refuses an entry that carries no replacement source at all', () => {
    expect(editableSourceReplacementFromEntry({ id: 'x', actionName: TOOL_ACTION, layerId, args: {} })).toBeUndefined();
  });
});

describe('legacyHistoryToDurable source edit', () => {
  it('converts the entry into a source-edit operation the shadow replays', () => {
    const registry = new AssetRegistry();
    try {
      const { document, diagnostics } = convert(registry, sourceEdit(toolSource(secondText, secondBox)));

      expect(diagnostics).toEqual([]);
      const [entry] = document.history;
      if (entry.operation.kind !== 'replace-layer-source') throw new Error('unexpected operation kind');

      expect(entry.id).toBe('retype');
      expect(entry.enabled).toBe(true);
      expect(entry.operation.layerId).toBe(layerId);
      expect(entry.operation.pos).toStrictEqual(secondBox);
      expect(entry.operation.source.kind).toBe('text');
      expect(entry.operation.source.sourcePos).toStrictEqual(secondBox);
      expect(entry.operation.source.size).toStrictEqual({ width: secondBox.width, height: secondBox.height });

      const replay = replayDurableDocument(document);
      const snapshot = replay.layers[layerId]?.snapshot;
      if (snapshot?.source.kind !== 'text') throw new Error('the replayed source is not text');
      expect(snapshot.source.args).toMatchObject({ text: 'Second draft', fontSize: 48 });
      expect(snapshot.pos).toStrictEqual(secondBox);
    } finally {
      registry.shutdown();
    }
  });

  it('keeps one durable entry per legacy entry, so the cursor map does not drift', () => {
    const registry = new AssetRegistry();
    try {
      const { document, legacyCursorToDurableCursor } = convert(
        registry,
        sourceEdit(toolSource(secondText, secondBox)),
        sourceEdit(toolSource(firstText, firstBox), 'retype-back')
      );

      expect(document.history).toHaveLength(2);
      expect(document.history.map((entry) => entry.id)).toEqual(['retype', 'retype-back']);
      expect(legacyCursorToDurableCursor).toEqual([-1, 0, 1]);
    } finally {
      registry.shutdown();
    }
  });

  it('leaves the original source in place at the cursor before the edit', () => {
    const registry = new AssetRegistry();
    try {
      const { document } = convert(registry, sourceEdit(toolSource(secondText, secondBox)));

      const before = replayDurableDocument(document, -1);
      const snapshot = before.layers[layerId]?.snapshot;
      if (snapshot?.source.kind !== 'text') throw new Error('the baseline source is not text');

      expect(snapshot.source.args).toMatchObject({ text: 'First draft', fontSize: 24 });
      expect(snapshot.pos).toStrictEqual(firstBox);
    } finally {
      registry.shutdown();
    }
  });

  it('records nothing the asset registry has to keep alive', () => {
    const registry = new AssetRegistry();
    try {
      const { document } = convert(registry, sourceEdit(toolSource(secondText, secondBox)));

      expect([...collectDurableAssetIds(document)]).toEqual([]);
    } finally {
      registry.shutdown();
    }
  });

  it('keeps converting the layer for a later tool entry, which reads its box', () => {
    const registry = new AssetRegistry();
    try {
      const blur: HistoryItem = {
        id: 'blur',
        actionName: TOOL_ACTION,
        layerId,
        args: { toolName: 'blur', radius: 4 } as ToolArgs,
      };
      const { document, diagnostics } = convert(registry, sourceEdit(toolSource(secondText, secondBox)), blur);

      expect(diagnostics).toEqual([]);
      expect(document.history.map((entry) => entry.operation.kind)).toEqual(['replace-layer-source', 'apply-filter']);
    } finally {
      registry.shutdown();
    }
  });

  it('still reports an action that carries no replacement source', () => {
    const registry = new AssetRegistry();
    try {
      const { document, diagnostics } = convert(registry, {
        id: 'mystery',
        actionName: REPLACE_LAYER_SOURCE_ACTION,
        layerId,
        args: {},
      });

      expect(document.history).toHaveLength(0);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          historyId: 'mystery',
          severity: 'error',
          code: 'unsupported-history-feature',
          message: expect.stringContaining('Unsupported legacy action'),
        }),
      ]);
    } finally {
      registry.shutdown();
    }
  });

  it('publishes a disabled source edit as a disabled entry', () => {
    const registry = new AssetRegistry();
    try {
      const item = { ...sourceEdit(toolSource(secondText, secondBox)), disabled: true };
      const { document } = convert(registry, item);
      const [entry] = document.history;

      expect(entry.enabled).toBe(false);
      const snapshot = replayDurableDocument(document).layers[layerId]?.snapshot;
      if (snapshot?.source.kind !== 'text') throw new Error('the replayed source is not text');
      expect(snapshot.source.args).toMatchObject({ text: 'First draft' });
    } finally {
      registry.shutdown();
    }
  });

  it('converts a source edit for a layer the document does not hold as a replay no-op', () => {
    const registry = new AssetRegistry();
    try {
      const { document, diagnostics } = convert(
        registry,
        sourceEdit(toolSource(secondText, secondBox), 'retype-ghost', 'layer-that-never-existed')
      );

      expect(diagnostics).toEqual([]);
      const replay = replayDurableDocument(document);
      expect(Object.keys(replay.layers)).toEqual([layerId]);
    } finally {
      registry.shutdown();
    }
  });

  it('fails closed on a source whose arguments are not plain data', () => {
    const registry = new AssetRegistry();
    try {
      // A measured timestamp is exactly the kind of value a text source could
      // carry and `plainValue` refuses: the durable model stores tool arguments
      // as JSON, so an object that is not plain data has no representation.
      const args = { toolName: 'text', text: 'x', fontSize: 1, measuredAt: new Date(0) } as unknown as ToolArgs;
      const { document, diagnostics } = convert(registry, {
        id: 'retype',
        actionName: REPLACE_LAYER_SOURCE_ACTION,
        layerId,
        args: { source: toolSource(args, secondBox) },
      });

      // An unreadable source is withheld as an error, and
      // `convertLegacyHistorySafely` voids the whole document over it rather than
      // publishing one holding a source the model cannot read.
      expect(document.history).toHaveLength(0);
      expect(diagnostics[0]?.severity).toBe('error');
      expect(diagnostics[0]?.code).toBe('invalid-history-entry');
    } finally {
      registry.shutdown();
    }
  });
});

describe('deriveReplaceLayerSourceEntry', () => {
  it('derives the entry conversion would have derived, byte for byte', () => {
    const registry = new AssetRegistry();
    try {
      const item = sourceEdit(toolSource(secondText, secondBox));
      const derived = deriveReplaceLayerSourceEntry(item);
      const [converted] = convert(registry, item).document.history;

      expect(derived).toStrictEqual(converted as DurableHistoryEntry);
    } finally {
      registry.shutdown();
    }
  });

  it('needs no document id and no registry, because it registers nothing', () => {
    // The append boundary's `translate()` sees no store, so this is what makes a
    // source edit appendable rather than conversion-only. Asserted by calling it
    // with nothing: a signature demanding a registry would not compile here.
    expect(deriveReplaceLayerSourceEntry(sourceEdit(toolSource(secondText, secondBox)))).not.toBeNull();
  });

  it('carries the legacy enabled gate', () => {
    const derived = deriveReplaceLayerSourceEntry({
      ...sourceEdit(toolSource(secondText, secondBox)),
      args: { enabled: false, source: toolSource(secondText, secondBox) },
    });

    expect(derived?.enabled).toBe(false);
  });

  it('declines an entry that carries no installable replacement source', () => {
    expect(deriveReplaceLayerSourceEntry({ id: 'x', actionName: TOOL_ACTION, layerId, args: {} })).toBeNull();
    expect(
      deriveReplaceLayerSourceEntry({
        id: 'x',
        actionName: REPLACE_LAYER_SOURCE_ACTION,
        layerId,
        args: { source: toolSource({ toolName: 'pencil' } as ToolArgs) },
      })
    ).toBeNull();
  });
});
