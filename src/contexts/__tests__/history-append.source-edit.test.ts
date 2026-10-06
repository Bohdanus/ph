import { describe, expect, it } from 'vitest';

import { AssetRegistry } from '../asset-registry.ts';
import { decideDurableAppend, planHistoryAppend, validatePlannedDurableEntry } from '../history-append.ts';
import { deriveReplaceLayerSourceEntry } from '../history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerSnapshot,
  type PlainObject,
  type ReplaceLayerSourceOperation,
} from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ToolLayerSource } from '../layer-types.ts';
import type { ToolArgs } from '../tool-types.ts';
import type { ActionType } from '../../util/constants.ts';
import { TOOL_ACTION } from '../../util/constants.ts';

const layerId = 'layer-1';
const box = { x: 20, y: 30, width: 220, height: 40 };

/** The action constant the legacy producer still owes; see the adapter test. */
const REPLACE_LAYER_SOURCE_ACTION = 'edit layer source' as ActionType;

const text: ToolArgs = {
  toolName: 'text',
  align: 'left',
  bold: false,
  color: '#000000',
  fontFamily: 'Inter',
  fontSize: 48,
  italic: false,
  lineHeight: 1.2,
  text: 'Second draft',
};

function source(over: Partial<{ width: number; height: number }> = {}): ToolLayerSource {
  return {
    kind: 'tool',
    args: text,
    isBedrock: false,
    pos: { ...box, width: over.width ?? box.width, height: over.height ?? box.height },
  };
}

function item(replacement: ToolLayerSource = source()): HistoryItem {
  return { id: 'retype', actionName: REPLACE_LAYER_SOURCE_ACTION, layerId, args: { source: replacement } };
}

function planned(entry: HistoryItem = item()): DurableHistoryEntry<ReplaceLayerSourceOperation> {
  const derived = deriveReplaceLayerSourceEntry(entry);
  if (!derived || derived.operation.kind !== 'replace-layer-source') {
    throw new Error('the plan under test is not a source edit');
  }
  return derived;
}

/** The same plan with one field changed, so each assertion grades a named defect. */
function tamper(
  operation: Partial<ReplaceLayerSourceOperation> | ((source: ReplaceLayerSourceOperation['source']) => object)
): DurableHistoryEntry {
  const base = planned();
  const next: ReplaceLayerSourceOperation = {
    ...base.operation,
    ...(typeof operation === 'function' ? {} : operation),
    source:
      typeof operation === 'function'
        ? ({
            ...base.operation.source,
            ...(operation(base.operation.source) as object),
          } as ReplaceLayerSourceOperation['source'])
        : (operation?.source ?? base.operation.source),
  };
  return { ...base, operation: next };
}

describe('validatePlannedDurableEntry source edit', () => {
  it('accepts the plan the derivation produces', () => {
    expect(validatePlannedDurableEntry(item(), planned())).toBeNull();
  });

  it('keeps the canonical schema and enabled gate', () => {
    const entry = planned();

    expect(entry).toMatchObject({ id: 'retype', schemaVersion: DURABLE_SCHEMA_VERSION, enabled: true });
    expect(Object.isFrozen(entry.operation)).toBe(true);
  });

  it('refuses a plan that is not a source edit', () => {
    const base = planned();

    expect(
      validatePlannedDurableEntry(item(), {
        ...base,
        operation: { kind: 'set-layer-properties', layerId, patch: { name: 'Renamed' } },
      })
    ).toBe('a source edit produced a "set-layer-properties" operation');
  });

  it('refuses a plan naming another layer', () => {
    expect(validatePlannedDurableEntry(item(), tamper({ layerId: 'layer-2' }))).toBe(
      'the durable layer id does not match the legacy entry'
    );
  });

  it('refuses a plan carrying a field the operation does not have', () => {
    const base = planned();
    const smuggled = {
      ...base,
      operation: { ...base.operation, bitmap: { width: 4, height: 4 } },
    } as unknown as DurableHistoryEntry;

    expect(validatePlannedDurableEntry(item(), smuggled)).toBe(
      'the durable replace-layer-source operation does not have the canonical shape'
    );
  });

  it('refuses a plan whose source aliases a bitmap', () => {
    // The guarantee is in the payload type; this is the second line, for a plan
    // built outside it. `bitmap` or `assetId` on the source would put a copy of
    // the pixels in the timeline and name an asset id nothing here can resolve.
    const base = planned();
    const aliased = {
      ...base,
      operation: {
        ...base.operation,
        source: { ...base.operation.source, assetId: 'never-registered' },
      },
    } as unknown as DurableHistoryEntry;

    expect(validatePlannedDurableEntry(item(), aliased)).toBe(
      'the durable replacement source does not have the canonical shape'
    );
  });

  it('refuses a plan installing a raster source', () => {
    const base = planned();
    const raster = {
      ...base,
      operation: {
        ...base.operation,
        source: { kind: 'raster', assetId: 'asset-1', width: 220, height: 40 },
      },
    } as unknown as DurableHistoryEntry;

    expect(validatePlannedDurableEntry(item(), raster)).toBe('the durable source edit installs a "raster" source');
  });

  it('refuses a plan declaring a bedrock source', () => {
    expect(
      validatePlannedDurableEntry(item(), tamper({ source: { ...planned().operation.source, isBedrock: true } }))
    ).toBe('the durable replacement source declares a bedrock source');
  });

  it('refuses a plan whose arguments are not the legacy arguments', () => {
    const edited = tamper((installed) => ({
      args: { ...(installed as { args: PlainObject }).args, text: 'Something else' },
    }));

    expect(validatePlannedDurableEntry(item(), edited)).toBe(
      'the durable replacement source arguments do not match the legacy entry'
    );
  });

  it('refuses a plan naming another tool', () => {
    const edited = tamper({ source: { ...planned().operation.source, toolName: 'rectangle' } } as never);

    expect(validatePlannedDurableEntry(item(), edited)).toBe(
      'the durable replacement source tool name does not match the legacy entry'
    );
  });

  it('refuses a plan whose layer box is not the legacy box', () => {
    const edited = tamper({ pos: { ...box, width: box.width + 1 } });

    expect(validatePlannedDurableEntry(item(), edited)).toBe(
      'the durable layer position does not match the legacy entry'
    );
  });

  it('refuses a plan whose source size contradicts the box', () => {
    const base = planned();
    const edited = {
      ...base,
      operation: {
        ...base.operation,
        source: { ...base.operation.source, size: { width: box.width, height: box.height + 1 } },
      },
    } as unknown as DurableHistoryEntry;

    expect(validatePlannedDurableEntry(item(), edited)).toBe(
      'the durable replacement source size does not match the legacy layer box'
    );
  });

  it('refuses a plan whose source was authored against a stale rectangle', () => {
    // Materialization scales a vector source from `sourcePos` to the rendered
    // box, so a `sourcePos` that is not the box renders the shape against a
    // rectangle the edit never produced.
    const base = planned();
    const edited = {
      ...base,
      operation: {
        ...base.operation,
        source: { ...base.operation.source, sourcePos: { ...box, width: box.width - 10 } },
      },
    } as unknown as DurableHistoryEntry;

    expect(validatePlannedDurableEntry(item(), edited)).toBe(
      'the durable replacement source position does not match the legacy layer box'
    );
  });

  it('reports no translation for an action whose replacement source is not installable', () => {
    const pencil = item({ kind: 'tool', args: { toolName: 'pencil' } as ToolArgs, isBedrock: false, pos: { ...box } });

    expect(validatePlannedDurableEntry(pencil, planned())).toBe(
      `no durable translation is published for "${pencil.actionName}" yet`
    );
  });

  it('reports the entry id and enabled gate as the first two facts it grades', () => {
    // Both are checked before the operation, so a plan that is not the entry this
    // item appended is refused on identity rather than on its payload.
    const base = planned();

    expect(validatePlannedDurableEntry(item(), { ...base, id: 'other' })).toBe(
      'durable entry id other does not match the legacy entry id retype'
    );
    expect(validatePlannedDurableEntry(item(), { ...base, enabled: false })).toBe(
      'the durable enabled state does not match the legacy entry'
    );
  });
});

/**
 * The three preconditions the other source-backed arms need and this one does
 * not. `create-layer` and `merge-document` are graded against a whole layer
 * snapshot, against the pre-append layer set, and against the registry; a source
 * edit states the layer's source outright, so it needs none of them. These say
 * that absence is deliberate rather than forgotten.
 */
describe('validatePlannedDurableEntry source edit preconditions', () => {
  it('grades the same plan with and without a registry probe', () => {
    const entry = item();
    const registry = new AssetRegistry();
    try {
      expect(validatePlannedDurableEntry(entry, planned(entry), null, null, registry)).toBeNull();
      expect(validatePlannedDurableEntry(entry, planned(entry), null, null, null)).toBeNull();
    } finally {
      registry.shutdown();
    }
  });

  it('grades a plan with no pre-append layer map at all', () => {
    expect(validatePlannedDurableEntry(item(), planned(), null, null, null)).toBeNull();
  });

  it('takes the edited source from the legacy item, not from the layer it replaces', () => {
    // A grading that compared the plan against the pre-append snapshot would
    // refuse this: the snapshot still holds the first draft and the old box. The
    // whole point of a source edit is that the item states the layer's source
    // after the edit, so the previous state is not evidence about it.
    const before: DurableLayerSnapshot = {
      id: layerId,
      name: 'Headline',
      isBedrock: false,
      visible: true,
      opacity: 1,
      locked: false,
      blendMode: 'source-over',
      order: 0,
      pos: { ...box, width: 120 },
      source: {
        kind: 'text',
        toolName: 'text',
        args: { toolName: 'text', text: 'First draft' },
        size: { width: 120, height: 40 },
        sourcePos: { ...box, width: 120 },
        isBedrock: false,
      },
    };

    expect(validatePlannedDurableEntry(item(), planned(), null, new Map([[layerId, before]]), null)).toBeNull();
  });
});

/**
 * The appendability gate, and the reason the derivation takes no store context.
 *
 * `create-layer` and `merge-document` are planned at the store boundary because
 * they register an asset, so `planHistoryAppend` cannot plan them and a caller
 * that only has the entry falls back to a full reconversion. A source edit
 * registers nothing, so this is the one source-backed action the boundary itself
 * translates: if it still fell through to the terminal refusal, RQ-2's source
 * edit would be conversion-only and the single-writer path would never publish it.
 */
describe('planHistoryAppend source edit', () => {
  const baseline: HistoryItem = {
    id: 'baseline',
    actionName: TOOL_ACTION,
    layerId,
    args: { toolName: 'blur', radius: 4 },
  };
  const frame = { x: 0, y: 0, width: 400, height: 300 };

  function plan(replacement: ToolLayerSource = source()) {
    return planHistoryAppend({
      item: { actionName: REPLACE_LAYER_SOURCE_ACTION, layerId, args: { source: replacement } },
      timeline: { entries: [baseline], cursor: 0, branchRevision: 0 },
      currentFrame: frame,
      id: 'retype',
    });
  }

  it('plans the entry with no store in reach at all', () => {
    const result = plan();

    expect(result.diagnostics).toEqual([]);
    expect(result.entry.id).toBe('retype');
    expect(result.durableEntry?.operation.kind).toBe('replace-layer-source');
    // The plan is the derivation's, byte for byte, which is the property the
    // publication path depends on: `decideDurableAppend` grades the entry the
    // store holds against the entry conversion would have produced.
    expect(result.durableEntry).toStrictEqual(deriveReplaceLayerSourceEntry(result.entry));
  });

  it('publishes the planned entry against a matching durable document', () => {
    const result = plan();
    const plannedEntry = result.durableEntry;
    const base: DurableDocument = {
      documentId: 'source-edit-append',
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
            pos: { ...box, width: 120 },
            source: {
              kind: 'text',
              toolName: 'text',
              args: { toolName: 'text', text: 'First draft' },
              size: { width: 120, height: 40 },
              sourcePos: { ...box, width: 120 },
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

    const decision = decideDurableAppend({
      documentId: 'source-edit-append',
      base,
      prior: { entries: [baseline], cursor: 0, branchRevision: 0 },
      next: { entries: [baseline, result.entry], cursor: 1, branchRevision: 0 },
      entry: result.entry,
      planned: plannedEntry,
      documentRevision: 0,
    });

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history).toHaveLength(1);
    expect(decision.document.history[0]?.id).toBe('retype');
    // No asset precondition was demanded and none was needed: the published
    // document names no asset id, so there was nothing whose liveness to prove.
    expect(decision.document.history[0]?.operation).not.toHaveProperty('bitmap');
  });

  it('still falls through to the terminal refusal for a source it cannot install', () => {
    const pencil = plan({ kind: 'tool', args: { toolName: 'pencil' } as ToolArgs, isBedrock: false, pos: { ...box } });

    expect(pencil.durableEntry).toBeNull();
    expect(pencil.diagnostics).toEqual([
      expect.objectContaining({
        code: 'unsupported-history-feature',
        message: expect.stringContaining('does not translate'),
      }),
    ]);
  });

  it('refuses a bedrock replacement at the boundary rather than planning it', () => {
    const bedrock = plan({
      kind: 'tool',
      args: text,
      isBedrock: true,
      size: { width: 400, height: 300 },
    });

    expect(bedrock.durableEntry).toBeNull();
    expect(bedrock.diagnostics[0]?.message).toContain('does not translate');
  });
});
