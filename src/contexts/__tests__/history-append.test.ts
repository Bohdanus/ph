import { describe, expect, it } from 'vitest';

import { createMockHistory, createMockHistoryItem } from '../../__tests__/fixtures/history.ts';
import { planHistoryAppend } from '../history-append.ts';
import { deriveSetDocumentFrameEntry } from '../history-adapter.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryTimeline } from '../history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from '../history-types.ts';

const baselineFrame: DocumentFrame = { x: 0, y: 0, width: 800, height: 600 };
const croppedFrame: DocumentFrame = { x: 10, y: 20, width: 400, height: 300 };

function timeline(entries: HistoryItem[], cursor = entries.length - 1): HistoryTimeline {
  return { entries, cursor, branchRevision: 0 };
}

function cropItem(nextFrame: DocumentFrame = croppedFrame): NewHistoryItem {
  return {
    layerId: 'document',
    actionName: SET_DOCUMENT_FRAME_ACTION,
    args: { previousFrame: baselineFrame, nextFrame },
  };
}

describe('planHistoryAppend: one entry per append', () => {
  it('mints a single entry with a fresh id and the caller args', () => {
    const before = createMockHistory(2).map((entry) => entry.id);

    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline(createMockHistory(2)),
      currentFrame: baselineFrame,
    });

    expect(result.entry.actionName).toBe(SET_DOCUMENT_FRAME_ACTION);
    expect(result.entry.layerId).toBe('document');
    expect(before).not.toContain(result.entry.id);
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves a caller-supplied id so the durable entry can share it', () => {
    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
      id: 'stable-id',
    });

    expect(result.entry.id).toBe('stable-id');
    expect(result.durableEntry?.id).toBe('stable-id');
  });

  it('never mutates the legacy arguments it is given', () => {
    const nextFrame = { ...croppedFrame };
    const result = planHistoryAppend({
      item: cropItem(nextFrame),
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    nextFrame.width = 1;

    const args = result.entry.args as { nextFrame: DocumentFrame };
    expect(args.nextFrame.width).toBe(croppedFrame.width);
  });
});

describe('planHistoryAppend: durable translation', () => {
  it('returns the entry the adapter itself would derive, enabled and unfrozen-aliased', () => {
    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    const expected = deriveSetDocumentFrameEntry(result.entry, baselineFrame);
    expect(result.durableEntry).toEqual(expected);
    expect(result.durableEntry?.enabled).toBe(true);
    expect(result.durableEntry?.operation).toMatchObject({
      kind: 'set-document-frame',
      previous: baselineFrame,
      next: croppedFrame,
    });
  });

  it('falls back to the current durable frame when the writer observed none', () => {
    const result = planHistoryAppend({
      item: { layerId: 'document', actionName: SET_DOCUMENT_FRAME_ACTION, args: { nextFrame: croppedFrame } },
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    expect(result.durableEntry?.operation).toMatchObject({ previous: baselineFrame });
  });

  it('reports durable-unavailable for an invalid next frame instead of a zero-size entry', () => {
    const result = planHistoryAppend({
      item: cropItem({ x: 0, y: 0, width: 0, height: 0 }),
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'invalid-history-entry',
      severity: 'warning',
      historyId: result.entry.id,
    });
    // The legacy edit still stands: a durable failure never rejects the append.
    expect(result.entry.actionName).toBe(SET_DOCUMENT_FRAME_ACTION);
    expect(result.entry.args).toMatchObject({ nextFrame: { width: 0, height: 0 } });
  });

  it('refuses a frame change that also carries a document replacement', () => {
    const result = planHistoryAppend({
      item: {
        ...cropItem(),
        documentSource: { layers: {}, size: { width: 800, height: 600 } },
      },
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: 'document-replacement' });
  });

  it('reports durable-unavailable for an action with no canonical operation yet', () => {
    const result = planHistoryAppend({
      item: { layerId: 'layer-1', actionName: TOOL_ACTION, args: { toolName: 'blur', radius: 4 } },
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: 'unsupported-history-feature', severity: 'warning' });
    expect(result.diagnostics[0].message).toContain(TOOL_ACTION);
    // No manufactured `unsupported` operation: the durable branch simply has none.
    expect(result.entry.actionName).toBe(TOOL_ACTION);
  });
});

describe('planHistoryAppend: append-point validation', () => {
  it('reports a duplicate entry id without changing the entry', () => {
    const existing = createMockHistoryItem({ id: 'duplicate-id' });

    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline([existing]),
      currentFrame: baselineFrame,
      id: 'duplicate-id',
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: 'invalid-history-entry', severity: 'error' });
    // The planned entry is still returned: reporting never blocks the append.
    expect(result.durableEntry).not.toBeNull();
  });

  it.each([
    ['before the first entry', -1],
    ['past the last entry', 4],
    ['on a fractional index', 1.5],
  ])('reports an append point %s', (_label, cursor) => {
    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline(createMockHistory(4), cursor),
      currentFrame: baselineFrame,
    });

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'invalid-history-entry')).toBe(true);
    expect(result.entry.actionName).toBe(SET_DOCUMENT_FRAME_ACTION);
  });

  it('accumulates a translation diagnostic and a timeline diagnostic', () => {
    const result = planHistoryAppend({
      item: { layerId: 'layer-1', actionName: TOOL_ACTION, args: { toolName: 'blur', radius: 4 } },
      timeline: timeline(createMockHistory(1), 9),
      currentFrame: baselineFrame,
    });

    expect(result.diagnostics).toHaveLength(2);
    expect(result.durableEntry).toBeNull();
  });
});
