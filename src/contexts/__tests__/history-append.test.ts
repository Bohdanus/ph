import { describe, expect, it } from 'vitest';

import { createMockHistory, createMockHistoryItem } from '../../__tests__/fixtures/history.ts';
import {
  decideDurableAppend,
  durableAppendDiagnostic,
  planHistoryAppend,
  type DurableAppendInput,
} from '../history-append.ts';
import { deriveSetDocumentFrameEntry } from '../history-adapter.ts';
import { DURABLE_SCHEMA_VERSION, type DurableDocument, type DurableHistoryEntry } from '../history-model.ts';
import { SET_DOCUMENT_FRAME_ACTION, TOOL_ACTION } from '../../util/constants.ts';
import type { DocumentFrame } from '../document-frame.ts';
import type { HistoryTimeline } from '../history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from '../history-types.ts';

const baselineFrame: DocumentFrame = { x: 0, y: 0, width: 800, height: 600 };
const croppedFrame: DocumentFrame = { x: 10, y: 20, width: 400, height: 300 };

function createFrameEntry(id: string): DurableHistoryEntry {
  return {
    id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: true,
    operation: { kind: 'set-document-frame', previous: baselineFrame, next: croppedFrame },
  };
}

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

describe('decideDurableAppend', () => {
  const priorEntries = [createMockHistoryItem({ id: 'baseline' })];
  const redoTail = createMockHistoryItem({ id: 'redo-tail' });
  const cropEntry = createMockHistoryItem({
    id: 'crop-1',
    actionName: SET_DOCUMENT_FRAME_ACTION,
    layerId: 'document',
    args: { previousFrame: baselineFrame, nextFrame: croppedFrame },
  });
  const nextEntries = [...priorEntries, cropEntry];
  const prior = { entries: priorEntries, cursor: 0, branchRevision: 0 };
  const next = { entries: nextEntries, cursor: 1, branchRevision: 0 };
  const base = {
    documentId: 'doc-1',
    documentRevision: 4,
    branchRevision: 0,
    durableRevision: 7,
    baseline: {
      frame: baselineFrame,
      layers: [],
      selections: { selections: [], activeSelectionId: null },
      activeLayerId: null,
    },
    history: [createFrameEntry('baseline')],
    cursor: 0,
  } as unknown as DurableDocument;
  const planned = deriveSetDocumentFrameEntry(cropEntry, baselineFrame) as DurableHistoryEntry;

  const decide = (overrides: Partial<DurableAppendInput> = {}) =>
    decideDurableAppend({
      documentId: 'doc-1',
      base,
      prior,
      next,
      entry: cropEntry,
      planned,
      documentRevision: 4,
      ...overrides,
    });

  it('publishes the planned entry onto the current durable document', () => {
    const decision = decide();

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history).toHaveLength(2);
    // The model clones and freezes every entry, so identity is not preserved.
    expect(decision.document.history[1]).toEqual(planned);
    expect(decision.document.history[0]).toEqual(base.history[0]);
    expect(decision.document.cursor).toBe(1);
    expect(decision.document.durableRevision).toBe(8);
    expect(decision.document.documentRevision).toBe(4);
    expect(decision.document.branchRevision).toBe(0);
    expect(decision.document.baseline.frame).toEqual(baselineFrame);
  });

  it.each([
    ['no planned entry', { planned: null }, 'preconditions'],
    ['no durable document', { base: null }, 'preconditions'],
    ['another document', { documentId: 'doc-2' }, 'preconditions'],
    ['another document revision', { documentRevision: 9 }, 'preconditions'],
    ['a branch the base was not built for', { prior: { ...prior, branchRevision: 3 } }, 'preconditions'],
    [
      'an append below the tip',
      {
        prior: { entries: [priorEntries[0], redoTail, redoTail], cursor: 0, branchRevision: 0 },
        next: { entries: [priorEntries[0], redoTail, cropEntry], cursor: 2, branchRevision: 0 },
      },
      'preconditions',
    ],
    ['a truncated timeline', { next: { ...next, entries: [cropEntry] } }, 'preconditions'],
    ['a cursor that is not the tip', { next: { ...next, cursor: 0 } }, 'preconditions'],
    ['an entry other than the planned one', { entry: createMockHistoryItem({ id: 'other' }) }, 'preconditions'],
  ] as const)('falls back without a diagnostic for %s', (_label, overrides, outcome) => {
    const decision = decide(overrides as Partial<DurableAppendInput>);

    expect(decision.outcome).toBe(outcome);
  });

  it.each([
    ['a foreign id', { ...cropEntry, id: 'elsewhere' }],
    ['a different schema version', { ...planned, schemaVersion: 99 }],
    ['a flipped enabled state', { ...planned, enabled: false }],
    ['a different operation kind', { ...planned, operation: { kind: 'set-selection' } as never }],
    [
      'a rewritten next frame',
      {
        ...planned,
        operation: { kind: 'set-document-frame', previous: baselineFrame, next: { ...croppedFrame, width: 1 } },
      },
    ],
    [
      'a rewritten previous frame',
      {
        ...planned,
        operation: { kind: 'set-document-frame', previous: { ...baselineFrame, x: 7 }, next: croppedFrame },
      },
    ],
  ])('reports a mismatch for %s', (_label, candidate) => {
    const decision = decide({ planned: candidate as DurableHistoryEntry });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') expect(decision.reason).toBeTruthy();
  });

  it('reports a mismatch for an action with no published translation', () => {
    const toolEntry = createMockHistoryItem({
      id: 'tool-1',
      actionName: TOOL_ACTION,
      layerId: 'layer-1',
      args: { toolName: 'blur', radius: 2 },
    });
    const decision = decide({
      entry: toolEntry,
      next: { entries: [...priorEntries, toolEntry], cursor: 1, branchRevision: 0 },
      planned: {
        id: 'tool-1',
        schemaVersion: 1,
        enabled: true,
        operation: { kind: 'remove-layer', layerId: 'layer-1' },
      } as DurableHistoryEntry,
    });

    expect(decision.outcome).toBe('mismatch');
  });

  it('never lets the durable cursor lead the legacy cursor', () => {
    const decision = decide({
      base: {
        ...base,
        history: [createFrameEntry('baseline'), createFrameEntry('extra')],
      } as unknown as DurableDocument,
    });

    // Two durable entries cannot map to a legacy cursor of 1.
    expect(decision.outcome).toBe('preconditions');
  });

  it('describes the fallback for the caller to report', () => {
    const diagnostic = durableAppendDiagnostic(cropEntry, 'the durable next frame does not match the legacy entry');

    expect(diagnostic).toMatchObject({
      code: 'durable-append-mismatch',
      severity: 'error',
      historyId: 'crop-1',
      actionName: SET_DOCUMENT_FRAME_ACTION,
    });
    expect(diagnostic.message).toContain('rebuilt from the legacy timeline');
  });
});
