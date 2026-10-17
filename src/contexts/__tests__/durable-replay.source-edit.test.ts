import { describe, expect, it } from 'vitest';

import { planHistoryAppend, decideDurableAppend } from '../history-append.ts';
import { appendDurableEntry } from '../history-adapter.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import {
  DURABLE_SCHEMA_VERSION,
  collectDurableAssetIds,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type EditableDurableLayerSource,
  type PlainObject,
} from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { HistoryTimeline } from '../history-timeline.ts';
import type { ToolArgs } from '../tool-types.ts';
import type { ToolLayerSource } from '../layer-types.ts';
import { TOOL_ACTION } from '../../util/constants.ts';
import type { ActionType } from '../../util/constants.ts';

const layerId = 'layer-1';
const frame = { x: 0, y: 0, width: 400, height: 300 };
const firstBox = { x: 20, y: 30, width: 120, height: 40 };
const secondBox = { x: 20, y: 30, width: 220, height: 40 };

function textSource(args: PlainObject, box = firstBox): EditableDurableLayerSource {
  return {
    kind: 'text',
    toolName: 'text',
    args,
    size: { width: box.width, height: box.height },
    sourcePos: { ...box },
    isBedrock: false,
  };
}

function layer(overrides: Partial<DurableLayerSnapshot> = {}): DurableLayerSnapshot {
  return {
    id: layerId,
    name: layerId,
    isBedrock: false,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos: { ...firstBox },
    source: textSource({ toolName: 'text', text: 'First draft', fontSize: 24 }),
    ...overrides,
  };
}

function entry(id: string, operation: DurableHistoryEntry['operation'], enabled = true): DurableHistoryEntry {
  return { id, schemaVersion: DURABLE_SCHEMA_VERSION, enabled, operation };
}

function document(history: DurableHistoryEntry[], baseline: DurableLayerSnapshot = layer()): DurableDocument {
  return {
    documentId: 'source-edit-replay',
    documentRevision: 0,
    branchRevision: 4,
    durableRevision: history.length,
    baseline: {
      frame,
      layers: [baseline],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: layerId,
    },
    history,
    cursor: history.length - 1,
  };
}

function retype(box = secondBox, enabled = true, text = 'Second draft'): DurableHistoryEntry {
  return entry(
    'retype',
    {
      kind: 'replace-layer-source',
      layerId,
      source: textSource({ toolName: 'text', text, fontSize: 24 }, box),
      pos: { ...box },
    },
    enabled
  );
}

describe('replayDurableDocument replace-layer-source', () => {
  it('installs the edited source and re-measures the layer box', () => {
    const replay = replayDurableDocument(document([retype()]));
    const snapshot = replay.layers[layerId]?.snapshot;
    if (!snapshot) throw new Error('the replayed layer is missing');
    if (snapshot.source.kind !== 'text') throw new Error('the installed source is not a text source');

    expect(snapshot.source.args).toStrictEqual({ toolName: 'text', text: 'Second draft', fontSize: 24 });
    expect(snapshot.pos).toStrictEqual(secondBox);
    expect(snapshot.source.sourcePos).toStrictEqual(secondBox);
    expect(snapshot.source.size).toStrictEqual({ width: secondBox.width, height: secondBox.height });
  });

  it('keeps the layer identity and every property the operation does not name', () => {
    const before = layer({ name: 'Headline', opacity: 0.5, order: 3, visible: false });
    const replay = replayDurableDocument(document([retype()], before));
    const snapshot = replay.layers[layerId]?.snapshot;
    if (!snapshot) throw new Error('the replayed layer is missing');

    expect(snapshot).toMatchObject({
      id: layerId,
      name: 'Headline',
      opacity: 0.5,
      order: 3,
      visible: false,
      isBedrock: false,
      locked: false,
      blendMode: 'source-over',
    });
  });

  it('retains the operations already applied to the layer', () => {
    // Photoshop keeps a live filter on a type layer whose text is retyped. The
    // durable equivalent is the retained `operations` list surviving, because
    // `materializeLayer` renders the new source and then applies that list.
    const blur = entry('blur', {
      kind: 'apply-filter',
      layerId,
      filter: { toolName: 'blur', version: 1, args: { toolName: 'blur', amount: 4 } as PlainObject },
    });
    const replay = replayDurableDocument(document([blur, retype()]));

    expect(replay.layers[layerId]?.operations.map((operation) => operation.kind)).toEqual(['apply-filter']);
  });

  it('reverts to the earlier source and box when the cursor walks back', () => {
    const doc = document([retype()]);

    const atTip = replayDurableDocument(doc, doc.cursor);
    const beforeEdit = replayDurableDocument(doc, -1);

    if (atTip.layers[layerId]?.snapshot.source.kind !== 'text') throw new Error('the tip source is not text');
    if (beforeEdit.layers[layerId]?.snapshot.source.kind !== 'text') {
      throw new Error('the baseline source is not text');
    }
    expect(atTip.layers[layerId]?.snapshot.source.args).toMatchObject({ text: 'Second draft' });
    expect(atTip.layers[layerId]?.snapshot.pos).toStrictEqual(secondBox);
    expect(beforeEdit.layers[layerId]?.snapshot.source.args).toMatchObject({ text: 'First draft' });
    expect(beforeEdit.layers[layerId]?.snapshot.pos).toStrictEqual(firstBox);
  });

  it('skips a disabled source edit entirely', () => {
    const replay = replayDurableDocument(document([retype(secondBox, false)]));

    if (replay.layers[layerId]?.snapshot.source.kind !== 'text') throw new Error('the source is not text');
    expect(replay.layers[layerId]?.snapshot.source.args).toMatchObject({ text: 'First draft' });
    expect(replay.layers[layerId]?.snapshot.pos).toStrictEqual(firstBox);
  });

  it('is a no-op for a layer the document does not hold', () => {
    const ghost = entry('ghost', {
      kind: 'replace-layer-source',
      layerId: 'layer-that-never-existed',
      source: textSource({ toolName: 'text', text: 'Nobody' }),
      pos: { ...secondBox },
    });

    const replay = replayDurableDocument(document([ghost]));

    expect(replay.layers['layer-that-never-existed']).toBeUndefined();
    expect(Object.keys(replay.layers)).toEqual([layerId]);
    if (replay.layers[layerId]?.snapshot.source.kind !== 'text') throw new Error('the source is not text');
    expect(replay.layers[layerId]?.snapshot.source.args).toMatchObject({ text: 'First draft' });
  });

  it('does not move the active layer', () => {
    const replay = replayDurableDocument(document([retype()]));

    expect(replay.activeLayerId).toBe(layerId);
  });

  it('copies the payload out rather than aliasing the operation into the snapshot', () => {
    const operation = retype();
    if (operation.operation.kind !== 'replace-layer-source') throw new Error('unexpected operation kind');
    const sourceArgs = operation.operation.source.kind === 'text' ? operation.operation.source.args : null;

    const replay = replayDurableDocument(document([operation]));
    const snapshot = replay.layers[layerId]?.snapshot;
    if (snapshot?.source.kind !== 'text') throw new Error('the installed source is not text');

    expect(snapshot.source.args).not.toBe(sourceArgs);
    expect(snapshot.source.sourcePos).not.toBe(operation.operation.source.sourcePos);
    expect(snapshot.pos).not.toBe(operation.operation.pos);
  });

  it('contributes no asset id, so reconciliation cannot release a live bitmap', () => {
    const rasterBaseline = layer({
      source: {
        kind: 'raster',
        assetId: 'baseline-asset' as never,
        width: firstBox.width,
        height: firstBox.height,
        isBedrock: false,
      },
    });

    expect([...collectDurableAssetIds(document([retype()], rasterBaseline))]).toEqual(['baseline-asset']);
  });

  it('installs a vector source and keeps the scaling rectangle it was authored against', () => {
    const vector = entry('reshape', {
      kind: 'replace-layer-source',
      layerId,
      source: {
        kind: 'vector',
        toolName: 'rectangle',
        args: { toolName: 'rectangle', figure: 'rectangle', color: '#ff0000' } as PlainObject,
        size: { width: secondBox.width, height: secondBox.height },
        sourcePos: { ...secondBox },
        isBedrock: false,
      },
      pos: { ...secondBox },
    });

    const replay = replayDurableDocument(document([vector]));
    const snapshot = replay.layers[layerId]?.snapshot;
    if (snapshot?.source.kind !== 'vector') throw new Error('the installed source is not a vector source');

    expect(snapshot.source.toolName).toBe('rectangle');
    expect(snapshot.source.sourcePos).toStrictEqual(secondBox);
    expect(snapshot.pos).toStrictEqual(secondBox);
  });
});

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

function item(source: ToolLayerSource = toolSource(secondText, secondBox), id = 'retype'): HistoryItem {
  return { id, actionName: REPLACE_LAYER_SOURCE_ACTION, layerId, args: { source } };
}

function timeline(entries: HistoryItem[] = [], cursor = entries.length - 1, branchRevision = 0): HistoryTimeline {
  return { entries, cursor, branchRevision };
}

describe('preview -> commit -> durable replay round-trip', () => {
  it('plans, commits, and replays a source edit with identical source and position', () => {
    // Preview: plan the source edit using planHistoryAppend
    const plannedResult = planHistoryAppend({
      item: item(),
      timeline: timeline([{ id: 'baseline', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } }]),
      currentFrame: frame,
      id: 'retype',
    });

    expect(plannedResult.diagnostics).toEqual([]);
    expect(plannedResult.durableEntry).not.toBeNull();
    const plannedEntry = plannedResult.durableEntry!;
    expect(plannedEntry.operation.kind).toBe('replace-layer-source');
    if (plannedEntry.operation.kind !== 'replace-layer-source') throw new Error('not a source edit');

    // Verify the planned entry has the expected source and position
    expect(plannedEntry.operation.source.kind).toBe('text');
    expect(plannedEntry.operation.source.args).toMatchObject({ text: 'Second draft', fontSize: 48 });
    expect(plannedEntry.operation.pos).toStrictEqual(secondBox);
    expect(plannedEntry.operation.source.sourcePos).toStrictEqual(secondBox);
    expect(plannedEntry.operation.source.size).toStrictEqual({ width: secondBox.width, height: secondBox.height });

    // Commit: publish the planned entry using decideDurableAppend
    const base: DurableDocument = {
      documentId: 'source-edit-roundtrip',
      documentRevision: 0,
      branchRevision: 0,
      durableRevision: 0,
      baseline: {
        frame,
        layers: [
          {
            id: layerId,
            name: 'Headline',
            isBedrock: false,
            visible: true,
            opacity: 1,
            locked: false,
            blendMode: 'source-over',
            order: 0,
            pos: { ...firstBox },
            source: {
              kind: 'text',
              toolName: 'text',
              args: { toolName: 'text', text: 'First draft', fontSize: 24 },
              size: { width: firstBox.width, height: firstBox.height },
              sourcePos: { ...firstBox },
              isBedrock: false,
            },
          },
        ],
        selections: { selections: [], activeSelectionId: null },
        activeLayerId: layerId,
      },
      history: [],
      cursor: -1,
    };

    const prior = timeline([
      { id: 'baseline', actionName: TOOL_ACTION, layerId, args: { toolName: 'blur', radius: 4 } },
    ]);
    const next = timeline([...prior.entries, plannedResult.entry]);

    const decision = decideDurableAppend({
      documentId: 'source-edit-roundtrip',
      base,
      prior,
      next,
      entry: plannedResult.entry,
      planned: plannedEntry,
      documentRevision: 0,
    });

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') throw new Error('not published');

    const committedDocument = decision.document;
    expect(committedDocument.history).toHaveLength(1);
    expect(committedDocument.history[0]?.id).toBe('retype');
    expect(committedDocument.cursor).toBe(0);

    // Durable replay: replay the committed document
    const replay = replayDurableDocument(committedDocument);
    const snapshot = replay.layers[layerId]?.snapshot;
    if (!snapshot) throw new Error('the replayed layer is missing');
    if (snapshot.source.kind !== 'text') throw new Error('the installed source is not a text source');

    // Verify the replayed snapshot matches the planned entry exactly
    expect(snapshot.source.args).toStrictEqual(plannedEntry.operation.source.args);
    expect(snapshot.pos).toStrictEqual(plannedEntry.operation.pos);
    expect(snapshot.source.sourcePos).toStrictEqual(plannedEntry.operation.source.sourcePos);
    expect(snapshot.source.size).toStrictEqual(plannedEntry.operation.source.size);
  });
});

describe('appendDurableEntry replace-layer-source round trip', () => {
  it('appends, replays, and reverts a replace-layer-source edit', () => {
    const base = document([]);
    const appended = appendDurableEntry(base, retype());

    expect(appended.history).toHaveLength(1);
    expect(appended.history[0]?.id).toBe('retype');
    expect(appended.cursor).toBe(0);

    const atTip = replayDurableDocument(appended);
    const snapshot = atTip.layers[layerId]?.snapshot;
    if (!snapshot || snapshot.source.kind !== 'text') throw new Error('the replayed layer is missing');
    expect(snapshot.source.args).toMatchObject({ text: 'Second draft' });
    expect(snapshot.pos).toStrictEqual(secondBox);
    expect(snapshot.source.sourcePos).toStrictEqual(secondBox);
    expect(snapshot.source.size).toStrictEqual({ width: secondBox.width, height: secondBox.height });

    const beforeEdit = replayDurableDocument(appended, -1);
    const baselineSnapshot = beforeEdit.layers[layerId]?.snapshot;
    if (!baselineSnapshot || baselineSnapshot.source.kind !== 'text') {
      throw new Error('the baseline source is not text');
    }
    expect(baselineSnapshot.source.args).toMatchObject({ text: 'First draft' });
    expect(baselineSnapshot.pos).toStrictEqual(firstBox);
  });
});
