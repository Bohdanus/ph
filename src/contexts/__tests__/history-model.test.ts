import { describe, expect, it } from 'vitest';

import { toLayerSnapshot, type DurableLayerSource } from '../history-model.ts';
import { createHistoryItem } from '../history-utils.ts';
import { updateHistoryTimeline } from '../history-timeline.ts';
import { NEW_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

describe('durable history preparation', () => {
  it('captures immutable layer metadata independently from runtime objects', () => {
    const pos = { x: 4, y: 5, width: 30, height: 20 };
    // A shallow freeze: `sourceSize` stays mutable, which is what makes the copy below
    // observable. `Object.freeze` on the source covers the source object only.
    const sourceSize = { width: 30, height: 20 };
    const source: DurableLayerSource = Object.freeze({
      kind: 'blank',
      color: '#123456',
      opacity: 0.75,
      size: sourceSize,
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
    sourceSize.width = 999;

    expect(snapshot.pos.x).toBe(4);
    expect(snapshot.pos).toStrictEqual({ x: 4, y: 5, width: 30, height: 20 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.pos)).toBe(true);
    // The source is a runtime object too. `cloneLayerSource`'s blank arm copies `size`
    // for the same reason it exists at all, and nothing else pins it: the `pos` claim
    // above is about the layer rectangle, not the source.
    if (snapshot.source.kind !== 'blank') throw new Error('unexpected source kind');
    expect(snapshot.source).not.toBe(source);
    expect(snapshot.source.size).toStrictEqual({ width: 30, height: 20 });
    expect(snapshot.source.size).not.toBe(sourceSize);
    expect(Object.isFrozen(snapshot.source)).toBe(true);
    expect(Object.isFrozen(snapshot.source.size)).toBe(true);
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
    args.end.x = 77;

    const stored = item.args as typeof args;
    expect(item.args).toMatchObject({ lineDash: [2, 4], start: { x: 1, y: 2 } });
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen((item.args as typeof args).start)).toBe(true);
    // `end` is never mutated above, so nothing so far proves it was copied at all: a
    // clone that aliased one nested object would pass on `lineDash` and `start` alone.
    expect(stored.end).toStrictEqual({ x: 20, y: 30 });
    expect(stored.end).not.toBe(args.end);
    // The payload object itself, not only its children. `freezePlainData` recurses
    // before it freezes, so dropping the top-level freeze leaves every child frozen and
    // the record's own payload mutable — a shape no per-child assertion can see.
    expect(stored).not.toBe(args);
    expect(Object.isFrozen(stored)).toBe(true);
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

    if (item.layerSource?.kind !== 'image' || !('pos' in item.layerSource)) {
      throw new Error('expected a positioned image source');
    }
    // The whole payload, not a subset: `pos` is a `Pos`, and a `toMatchObject` over
    // `{ pos: { x: 1 } }` says nothing about `y`, `width` or `height`.
    expect(item.layerSource).toStrictEqual({
      kind: 'image',
      bitmap,
      name: 'Original',
      isBedrock: false,
      pos: { x: 1, y: 2, width: 40, height: 20 },
    });
    // The bitmap is a borrowed live resource, so it is carried by reference; the
    // record around it is a copy. The previous form compared
    // `item.layerSource?.kind === 'image' && item.layerSource.bitmap` against the
    // bitmap, which did fail for a wrong kind — but only because `&&` returns its
    // right operand, so the kind was checked as a side effect of a truthiness
    // expression rather than stated. What it could not check was the rest of the
    // record, which is why the whole payload is asserted above instead.
    expect(item.layerSource.bitmap).toBe(bitmap);
    expect(item.layerSource.pos).not.toBe(source.pos);
    expect(Object.isFrozen(item.layerSource)).toBe(true);
    expect(Object.isFrozen(item.layerSource.pos)).toBe(true);
    expect(Object.isFrozen(bitmap)).toBe(false);
  });

  it('mints a distinct id when the caller passes none', () => {
    const first = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} });
    const second = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} });
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

    // `createHistoryItem`'s default parameter is its only branch no caller in this
    // suite exercises with zero arguments, and the id it produces is load-bearing:
    // a repeated durable entry id is a recorded defect class on this boundary.
    expect(first.id).toMatch(uuidV4);
    expect(second.id).toMatch(uuidV4);
    expect(first.id).not.toBe(second.id);
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
