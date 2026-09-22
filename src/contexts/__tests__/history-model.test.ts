import { describe, expect, it } from 'vitest';

import { toLayerSnapshot, type DurableLayerSource } from '../history-model.ts';
import { createHistoryItem } from '../history-utils.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';
import { NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

describe('durable history preparation', () => {
  it('captures immutable layer metadata independently from runtime objects', () => {
    const pos = { x: 4, y: 5, width: 30, height: 20 };
    const source: DurableLayerSource = Object.freeze({
      kind: 'blank',
      color: '#123456',
      opacity: 0.75,
      size: { width: 30, height: 20 },
    });
    const snapshot = toLayerSnapshot(
      {
        id: 'layer-1',
        name: 'Shape 1',
        isBedrock: false,
        visible: true,
        opacity: 1,
        locked: false,
        blendMode: 'source-over',
        order: 3,
        pos,
      },
      source
    );

    pos.x = 99;
    expect(snapshot.pos.x).toBe(4);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pos)).toBe(true);
  });

  it('deep-clones tool arguments at the current history boundary', () => {
    const args = {
      toolName: 'shape' as const,
      figure: 'polygon' as const,
      alpha: 1,
      color: '#000000',
      backgroundColor: '#ffffff',
      lineWidth: 2,
      lineDash: [2, 4],
      start: { x: 1, y: 2 },
      end: { x: 20, y: 30 },
    };
    const item = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args }, 'history-1');

    args.lineDash[0] = 99;
    args.start.x = 88;

    expect(item.args).toMatchObject({ lineDash: [2, 4], start: { x: 1, y: 2 } });
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen((item.args as typeof args).start)).toBe(true);
  });

  it('retains external raster identity while cloning source metadata', () => {
    const bitmap = { width: 40, height: 20 } as ImageBitmap;
    const source = {
      kind: 'image' as const,
      bitmap,
      name: 'Original',
      isBedrock: false as const,
      pos: { x: 1, y: 2, width: 40, height: 20 },
    };
    const item = createHistoryItem(
      { actionName: NEW_LAYER_ACTION, layerId: 'layer-1', layerSource: source },
      'history-1'
    );

    source.pos.x = 100;
    source.name = 'Changed';

    expect(item.layerSource).toMatchObject({ name: 'Original', pos: { x: 1 } });
    expect(item.layerSource?.kind === 'image' && item.layerSource.bitmap).toBe(bitmap);
    expect(Object.isFrozen(bitmap)).toBe(false);
  });

  it('truncates redo entries and increments the branch revision on append', () => {
    const first = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'first');
    const discarded = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'discarded');
    const branch = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'branch');

    const result = updateHistoryTimeline(
      { entries: [first, discarded], cursor: 0, branchRevision: 7 },
      { type: 'append', entry: branch }
    );

    expect(result).toEqual({ entries: [first, branch], cursor: 1, branchRevision: 8 });
  });

  it('toggles entries immutably and leaves invalid commands unchanged', () => {
    const entry = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'entry');
    const timeline = { entries: [entry], cursor: 0, branchRevision: 2 } as const;
    const toggled = updateHistoryTimeline(timeline, { type: 'toggle-disabled', entryId: 'entry' });

    expect(toggled.entries[0]).toMatchObject({ id: 'entry', disabled: true });
    expect(toggled.branchRevision).toBe(3);
    expect(timeline.entries[0].disabled).toBeUndefined();
    expect(updateHistoryTimeline(timeline, { type: 'set-cursor', cursor: -1 })).toBe(timeline);
  });
});
