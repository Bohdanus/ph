import { describe, expect, it } from 'vitest';

import { updateHistoryTimeline, type HistoryTimeline } from '../history-timeline.ts';
import { createHistoryItem } from '../history-utils.ts';
import { RENAME_LAYER_ACTION, TOOL_ACTION } from '../../util/constants.ts';

function entry(id: string) {
  return createHistoryItem({ actionName: RENAME_LAYER_ACTION, layerId: 'layer-1', args: { name: id } }, id);
}

function timeline(overrides: Partial<HistoryTimeline> = {}): HistoryTimeline {
  return { entries: [entry('a'), entry('b'), entry('c')], cursor: 2, branchRevision: 5, ...overrides };
}

describe('updateHistoryTimeline set-cursor', () => {
  it('moves the cursor to an earlier entry without touching the entry list', () => {
    const before = timeline();

    const after = updateHistoryTimeline(before, { type: 'set-cursor', cursor: 0 });

    expect(after).not.toBe(before);
    expect(after.cursor).toBe(0);
    expect(after.branchRevision).toBe(5);
    expect(after.entries).toBe(before.entries);
  });

  it('moves the cursor to the last entry', () => {
    const after = updateHistoryTimeline(timeline({ cursor: 0 }), { type: 'set-cursor', cursor: 2 });

    expect(after.cursor).toBe(2);
    expect(after.entries).toHaveLength(3);
  });

  it('rejects the position before the first entry', () => {
    const before = timeline({ cursor: 0 });

    // The legacy timeline has no representation for "before the first entry",
    // unlike the durable cursor which accepts -1.
    expect(updateHistoryTimeline(before, { type: 'set-cursor', cursor: -1 })).toBe(before);
  });

  it('returns the same timeline for the cursor it already points at', () => {
    const before = timeline();

    expect(updateHistoryTimeline(before, { type: 'set-cursor', cursor: 2 })).toBe(before);
  });

  it.each([-2, 3, 1.5, Number.NaN])('rejects the out-of-range or non-integer cursor %s', (cursor) => {
    const before = timeline();

    expect(updateHistoryTimeline(before, { type: 'set-cursor', cursor })).toBe(before);
  });

  it('rejects a cursor on an empty timeline', () => {
    const empty: HistoryTimeline = { entries: [], cursor: -1, branchRevision: 0 };

    expect(updateHistoryTimeline(empty, { type: 'set-cursor', cursor: 0 })).toBe(empty);
    expect(updateHistoryTimeline(empty, { type: 'set-cursor', cursor: -1 })).toBe(empty);
  });
});

describe('updateHistoryTimeline toggle-disabled', () => {
  it('increments the branch revision so a replay recomputes the derived state', () => {
    const before = timeline();

    const after = updateHistoryTimeline(before, { type: 'toggle-disabled', entryId: 'b' });

    expect(after.entries.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(after.entries[1].disabled).toBe(true);
    expect(after.branchRevision).toBe(6);
    expect(after.cursor).toBe(before.cursor);
    expect(before.entries[1].disabled).toBeUndefined();
  });

  it('re-enables an already disabled entry', () => {
    const disabled = updateHistoryTimeline(timeline(), { type: 'toggle-disabled', entryId: 'a' });

    const reEnabled = updateHistoryTimeline(disabled, { type: 'toggle-disabled', entryId: 'a' });

    expect(reEnabled.entries[0].disabled).toBe(false);
    expect(reEnabled.branchRevision).toBe(7);
  });

  it('returns the same timeline for an unknown entry id', () => {
    const before = timeline();

    expect(updateHistoryTimeline(before, { type: 'toggle-disabled', entryId: 'nope' })).toBe(before);
  });
});

describe('updateHistoryTimeline append', () => {
  it('drops the redo tail, keeps the entries up to the cursor and points the cursor at the new entry', () => {
    const before = timeline({ cursor: 1, branchRevision: 2 });
    const appended = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'appended');

    const after = updateHistoryTimeline(before, { type: 'append', entry: appended });

    expect(after.entries.map((item) => item.id)).toEqual(['a', 'b', 'appended']);
    expect(after.cursor).toBe(2);
    expect(after.branchRevision).toBe(3);
    expect(after.entries).not.toBe(before.entries);
  });

  it('appends after the tip when the cursor already points at the last entry', () => {
    const before = timeline({ cursor: 2 });
    const appended = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'appended');

    const after = updateHistoryTimeline(before, { type: 'append', entry: appended });

    expect(after.entries.map((item) => item.id)).toEqual(['a', 'b', 'c', 'appended']);
    expect(after.cursor).toBe(3);
    expect(after.branchRevision).toBe(6);
  });

  it('appends onto an empty timeline', () => {
    const appended = createHistoryItem({ actionName: TOOL_ACTION, layerId: 'layer-1', args: {} }, 'first');

    const after = updateHistoryTimeline(
      { entries: [], cursor: -1, branchRevision: 0 },
      { type: 'append', entry: appended }
    );

    expect(after.entries).toEqual([appended]);
    expect(after.cursor).toBe(0);
    expect(after.branchRevision).toBe(1);
  });
});
