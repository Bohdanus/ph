import { describe, expect, it } from 'vitest';

import { SET_DOCUMENT_FRAME_ACTION, SET_LAYER_OPACITY_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import { durableEntryProvenance, durableEntryTitle } from '../history-provenance.ts';
import type { DurableEntryProvenance } from '../history-model.ts';
import type { HistoryItem } from '../history-types.ts';
import type { ToolArgs } from '../tool-types.ts';

function makeHistoryItem(overrides: Partial<HistoryItem>): HistoryItem {
  return {
    id: 'hr-1',
    actionName: TOOL_ACTION,
    layerId: 'layer-1',
    ...overrides,
  };
}

// Persisted tool-layer metadata can be malformed or stale even though the current type is stricter.
function makeToolLayerSource(args: unknown): NonNullable<HistoryItem['layerSource']> {
  return {
    kind: 'tool',
    args: args as ToolArgs,
    isBedrock: false,
    pos: { x: 0, y: 0, width: 0, height: 0 },
  };
}

describe('durableEntryProvenance', () => {
  it('returns the action name for a plain tool action', () => {
    const item = makeHistoryItem({ actionName: TOOL_ACTION, args: { toolName: 'brush' } });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe(TOOL_ACTION);
    expect(result.toolName).toBe('brush');
  });

  it('extracts toolName from args when actionName is TOOL_ACTION', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 'shape', figure: 'rectangle' },
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBe('shape');
  });

  it('extracts toolName from layerSource.args when layerSource.kind is "tool"', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: makeToolLayerSource({ toolName: 'eraser' }),
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBe('eraser');
    expect(result.actionName).toBe('new layer');
  });

  it('prefers layerSource.toolName when both layerSource and TOOL_ACTION args have toolName', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 'from-args' },
      layerSource: makeToolLayerSource({ toolName: 'from-source' }),
    });

    const result = durableEntryProvenance(item);

    // The source branch is checked first, so layerSource wins.
    expect(result.toolName).toBe('from-source');
  });

  it('does not read toolName from layerSource when kind is not "tool"', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 'from-args' },
      layerSource: {
        kind: 'blank',
        color: '#fff',
        opacity: 1,
        isBedrock: false,
        pos: { x: 0, y: 0, width: 0, height: 0 },
      },
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBe('from-args');
  });

  it('returns provenance without toolName when TOOL_ACTION args lack toolName', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { someOtherField: 42 },
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe(TOOL_ACTION);
    expect(result.toolName).toBeUndefined();
  });

  it('returns provenance without toolName when layerSource args lack toolName', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: makeToolLayerSource({ someOtherField: 42 }),
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
    expect(result.actionName).toBe('new layer');
  });

  it('returns provenance without toolName when layerSource.args.toolName is non-string', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: makeToolLayerSource({ toolName: 123 }),
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
  });

  it('returns provenance without toolName when layerSource.args.toolName is null', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: makeToolLayerSource({ toolName: null }),
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
  });

  it('returns provenance without toolName when layerSource.args.toolName is undefined', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: makeToolLayerSource({}),
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
  });

  it('does not read toolName from args when layerSource.kind is not "tool" and args.toolName is non-string', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 123 },
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
  });

  it('handles an unknown actionName with no tool info', () => {
    const item = makeHistoryItem({
      actionName: 'some-unregistered-action' as unknown as HistoryItem['actionName'],
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe('some-unregistered-action');
    expect(result.toolName).toBeUndefined();
  });

  it('handles a non-string actionName gracefully (passes through)', () => {
    const item = makeHistoryItem({
      actionName: 42 as unknown as HistoryItem['actionName'],
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe(42);
  });

  it('handles null layerSource', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 'brush' },
      layerSource: null as unknown as HistoryItem['layerSource'],
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe(TOOL_ACTION);
    // layerSource?.kind short-circuits on null, so args.toolName is read.
    expect(result.toolName).toBe('brush');
  });

  it('handles undefined layerSource', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
      layerSource: undefined,
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe('new layer');
    expect(result.toolName).toBeUndefined();
  });

  it('handles null args', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: null as unknown as HistoryItem['args'],
    });

    const result = durableEntryProvenance(item);

    expect(result.actionName).toBe(TOOL_ACTION);
    expect(result.toolName).toBeUndefined();
  });

  it('handles undefined args', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      layerSource: undefined,
      args: undefined,
    });

    const result = durableEntryProvenance(item);

    expect(result.toolName).toBeUndefined();
  });

  it('freezes the returned provenance object', () => {
    const item = makeHistoryItem({
      actionName: TOOL_ACTION,
      args: { toolName: 'brush' },
    });

    const result = durableEntryProvenance(item);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('freezes the provenance object even when toolName is omitted', () => {
    const item = makeHistoryItem({
      actionName: 'new layer',
    });

    const result = durableEntryProvenance(item);

    expect(Object.isFrozen(result)).toBe(true);
  });

  it('produces an object with exactly actionName when no toolName is derivable', () => {
    const item = makeHistoryItem({
      actionName: 'open document',
    });

    const result = durableEntryProvenance(item);

    expect(Object.keys(result).sort()).toEqual(['actionName']);
  });
});

describe('durableEntryTitle', () => {
  function makeProvenance(overrides: Partial<DurableEntryProvenance>): DurableEntryProvenance {
    return { actionName: 'open document', ...overrides };
  }

  it('returns the toolName when it is present', () => {
    const provenance = makeProvenance({ toolName: 'brush' });

    expect(durableEntryTitle(provenance)).toBe('brush');
  });

  it('returns undefined for a bare TOOL_ACTION without a toolName', () => {
    const provenance = makeProvenance({ actionName: TOOL_ACTION });

    expect(durableEntryTitle(provenance)).toBeUndefined();
  });

  it('still returns toolName even when actionName is TOOL_ACTION, because toolName wins', () => {
    const provenance = makeProvenance({ actionName: TOOL_ACTION, toolName: 'eraser' });

    expect(durableEntryTitle(provenance)).toBe('eraser');
  });

  it('returns "crop" for SET_DOCUMENT_FRAME_ACTION', () => {
    const provenance = makeProvenance({ actionName: SET_DOCUMENT_FRAME_ACTION });

    expect(durableEntryTitle(provenance)).toBe('crop');
  });

  it('returns "set layer opacity" for SET_LAYER_OPACITY_ACTION', () => {
    const provenance = makeProvenance({ actionName: SET_LAYER_OPACITY_ACTION });

    expect(durableEntryTitle(provenance)).toBe('set layer opacity');
  });

  it('returns the literal actionName for any other action', () => {
    const provenance = makeProvenance({ actionName: 'merge layers' });

    expect(durableEntryTitle(provenance)).toBe('merge layers');
  });

  it('returns the actionName for an unknown/unregistered action string', () => {
    const provenance = makeProvenance({
      actionName: 'some-custom-action' as unknown as DurableEntryProvenance['actionName'],
    });

    expect(durableEntryTitle(provenance)).toBe('some-custom-action');
  });

  it('returns empty string when actionName is an empty string', () => {
    const provenance = makeProvenance({ actionName: '' as unknown as DurableEntryProvenance['actionName'] });

    expect(durableEntryTitle(provenance)).toBe('');
  });

  it('returns "crop" even when toolName is present and actionName is SET_DOCUMENT_FRAME_ACTION', () => {
    const provenance = makeProvenance({ actionName: SET_DOCUMENT_FRAME_ACTION, toolName: 'crop' });

    expect(durableEntryTitle(provenance)).toBe('crop');
  });
});
