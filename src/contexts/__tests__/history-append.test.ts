import { describe, expect, it } from 'vitest';

import {
  createMockHistory,
  createMockHistoryItem,
  createSelectionHistoryItem,
} from '../../__tests__/fixtures/history.ts';
import { AssetRegistry } from '../asset-registry.ts';
import {
  decideDurableAppend,
  deriveReorderLayersEntry,
  durableAppendDiagnostic,
  planHistoryAppend,
  type AppendBoundaryResult,
  type DurableAppendInput,
} from '../history-append.ts';
import {
  deriveSetDocumentFrameEntry,
  deriveSetLayerPropertiesEntry,
  legacyHistoryToDurable,
  toggleDurableEntry,
} from '../history-adapter.ts';
import {
  DURABLE_SCHEMA_VERSION,
  type DurableDocument,
  type DurableHistoryEntry,
  type DurableLayerPropertyPatch,
  type SelectionSnapshot,
} from '../history-model.ts';
import {
  HIDE_LAYER_ACTION,
  OPEN_DOCUMENT_ACTION,
  RENAME_LAYER_ACTION,
  REORDER_ACTION,
  SELECTION_ACTION,
  SET_DOCUMENT_FRAME_ACTION,
  SHOW_LAYER_ACTION,
  TOOL_ACTION,
  type ActionType,
} from '../../util/constants.ts';
import { replayDurableDocument } from '../durable-replay.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import type { Selection } from '../general-types.ts';
import type { LayerId } from '../layer-types.ts';
import { updateHistoryTimeline, type HistoryTimeline } from '../history-timeline.ts';
import type { HistoryItem, NewHistoryItem } from '../history-types.ts';

const baselineFrame: DocumentFrame = { x: 0, y: 0, width: 800, height: 600 };
const croppedFrame: DocumentFrame = { x: 10, y: 20, width: 400, height: 300 };

function selectionState(id: string): SelectionSnapshot {
  return {
    selections: [
      {
        id,
        points: [{ x: 1, y: 2 }],
        isActive: true,
        pos: { x: 1, y: 2, width: 3, height: 4 },
      } satisfies Selection,
    ],
    activeSelectionId: id,
  };
}

const previousSelectionState = selectionState('sel-previous');
const nextSelectionState = selectionState('sel-next');

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

function propertyItem(actionName: ActionType, args?: unknown, layerId = 'layer-1'): NewHistoryItem {
  // `unknown` because the malformed shapes under test include a primitive, which
  // the writer's typed signature excludes but a live caller can still produce.
  return { layerId, actionName, ...(args === undefined ? {} : { args: args as object }) };
}

/**
 * The conversion the plan must agree with. The baseline carries no layer, so a
 * property entry is recorded for an unknown layer: the operation is derived from
 * the item alone, which is exactly the equality under test. The plan's own id is
 * used, so the two entries are comparable without restating it.
 */
function convertedEntryFor(item: HistoryItem): DurableHistoryEntry | undefined {
  const registry = new AssetRegistry();
  try {
    const converted = legacyHistoryToDurable(
      [
        {
          id: 'baseline',
          actionName: OPEN_DOCUMENT_ACTION,
          layerId: 'layer-1',
          documentSource: { layers: {}, size: { width: 800, height: 600 }, frame: baselineFrame },
        },
        item,
      ],
      { documentId: 'parity-doc', registry }
    );

    expect(converted.diagnostics).toEqual([]);
    return converted.document.history.find((candidate) => candidate.id === item.id);
  } finally {
    registry.shutdown();
  }
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

describe('planHistoryAppend: selection translation', () => {
  const plan = (item: NewHistoryItem, currentSelections?: SelectionSnapshot) =>
    planHistoryAppend({
      item,
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
      ...(currentSelections ? { currentSelections } : {}),
    });

  it('translates a well-formed selection change into a set-selection entry', () => {
    const result = plan(createSelectionHistoryItem(previousSelectionState, nextSelectionState));

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry).toEqual({
      id: result.entry.id,
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-selection', before: previousSelectionState, after: nextSelectionState },
    });
  });

  it('falls back to the tracked current selections when the writer observed no previous state', () => {
    const result = plan(createSelectionHistoryItem(undefined, nextSelectionState), previousSelectionState);

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry?.operation).toMatchObject({ kind: 'set-selection', before: previousSelectionState });
  });

  it.each([
    ['an empty object', {}],
    ['a null selections array', { selections: null }],
    ['a bare array', []],
    ['a non-array selections value', { selections: { id: 'sel-next' }, activeSelectionId: 'sel-next' }],
    ['a string', 'selections'],
    ['a number', 7],
  ])('refuses %s as a next selection state instead of fabricating a cleared after', (_label, next) => {
    const result = plan(createSelectionHistoryItem(previousSelectionState, next), previousSelectionState);

    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unsupported-history-feature',
      severity: 'warning',
      historyId: result.entry.id,
      actionName: SELECTION_ACTION,
    });
    expect(result.diagnostics[0].message).toContain('never fabricates a cleared selection');
    // The legacy edit still stands: a durable failure never rejects the append.
    expect(result.entry.actionName).toBe(SELECTION_ACTION);
  });

  it.each([
    ['an absent', undefined],
    ['an explicitly null', null],
  ])('refuses %s next selection state, where the shadow conversion clears instead', (_label, next) => {
    const result = plan(createSelectionHistoryItem(previousSelectionState, next), previousSelectionState);

    // Deliberate asymmetry: the conversion keeps the legacy clear, the boundary
    // has no second authority to stay equal to and reports both shapes.
    expect(result.durableEntry).toBeNull();
    expect(result.diagnostics[0]).toMatchObject({ code: 'unsupported-history-feature', severity: 'warning' });
  });
});

describe('planHistoryAppend: layer-property translation', () => {
  const plan = (item: NewHistoryItem) =>
    planHistoryAppend({
      item,
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });

  it.each([
    { label: 'a show', actionName: SHOW_LAYER_ACTION, args: undefined, patch: { visible: true } },
    { label: 'a hide', actionName: HIDE_LAYER_ACTION, args: undefined, patch: { visible: false } },
    { label: 'a rename', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' }, patch: { name: 'Renamed' } },
    { label: 'a rename to an empty name', actionName: RENAME_LAYER_ACTION, args: { name: '' }, patch: { name: '' } },
  ] satisfies ReadonlyArray<{
    label: string;
    actionName: ActionType;
    args?: object;
    patch: DurableLayerPropertyPatch;
  }>)('returns for $label the entry the adapter itself would derive', ({ actionName, args, patch }) => {
    const result = plan(propertyItem(actionName, args));

    expect(result.diagnostics).toEqual([]);
    expect(result.durableEntry).toEqual(deriveSetLayerPropertiesEntry(result.entry));
    expect(result.durableEntry).toEqual({
      id: result.entry.id,
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch },
    });
    const operation = result.durableEntry?.operation;
    const derivedPatch = operation?.kind === 'set-layer-properties' ? operation.patch : null;
    // Frozen at the derivation, so a publisher and the runtime layer that adopts
    // the patch cannot mutate the entry the other one is holding.
    expect(Object.isFrozen(operation)).toBe(true);
    expect(Object.isFrozen(derivedPatch)).toBe(true);
  });

  it('preserves a caller-supplied id so the durable entry can share it', () => {
    const result = planHistoryAppend({
      item: propertyItem(RENAME_LAYER_ACTION, { name: 'Renamed' }),
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
      id: 'stable-rename',
    });

    expect(result.entry.id).toBe('stable-rename');
    expect(result.durableEntry?.id).toBe('stable-rename');
  });

  it.each([
    {
      label: 'a rename',
      actionName: RENAME_LAYER_ACTION,
      args: { name: 'Renamed', visible: false, opacity: 0.25, locked: true },
      patch: { name: 'Renamed' },
    },
    {
      label: 'a hide',
      actionName: HIDE_LAYER_ACTION,
      args: { name: 'Renamed', opacity: 0.25, toolName: 'blur' },
      patch: { visible: false },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    actionName: ActionType;
    args: object;
    patch: DurableLayerPropertyPatch;
  }>)(
    'derives only the action-owned property for $label, never the rest of the args',
    ({ actionName, args, patch }) => {
      const result = plan(propertyItem(actionName, args));

      // A live writer hands the boundary a `Partial<Layer>`, and the runtime layer
      // adopts this patch. Only the property the action owns may survive, or a
      // rename would carry `visible: false` into the durable document and the
      // runtime layer alike.
      const operation = result.durableEntry?.operation;
      expect(operation?.kind === 'set-layer-properties' ? operation.patch : null).toEqual(patch);
      // The legacy entry is the authority for the rest: it keeps every argument.
      expect(result.entry.args).toEqual(args);
    }
  );

  it('derives a patch that cannot be changed through the arguments it was planned from', () => {
    const args = { name: 'Renamed' };
    const result = plan(propertyItem(RENAME_LAYER_ACTION, args));

    args.name = 'Rewritten';

    const operation = result.durableEntry?.operation;
    expect(operation?.kind === 'set-layer-properties' && operation.patch).toEqual({ name: 'Renamed' });
  });

  it.each([
    { label: 'a hide whose args are absent', actionName: HIDE_LAYER_ACTION, args: undefined },
    { label: 'a show whose args are absent', actionName: SHOW_LAYER_ACTION, args: undefined },
    { label: 'a show whose args carry a name', actionName: SHOW_LAYER_ACTION, args: { name: 'Renamed' } },
    { label: 'a hide whose args are a primitive', actionName: HIDE_LAYER_ACTION, args: 42 },
  ] satisfies ReadonlyArray<{ label: string; actionName: ActionType; args?: unknown }>)(
    'translates $label, which never reads a name',
    ({ actionName, args }) => {
      const result = plan(propertyItem(actionName, args));

      expect(result.diagnostics).toEqual([]);
      expect(result.durableEntry).not.toBeNull();
    }
  );

  it.each([
    { label: 'a numeric name', args: { name: 42 } },
    { label: 'a null name', args: { name: null } },
    { label: 'an undefined name', args: { name: undefined } },
    { label: 'a name that is an object', args: { name: { text: 'Renamed' } } },
    { label: 'a name that is an array', args: { name: ['Renamed'] } },
    { label: 'args that carry no name', args: { opacity: 0.5 } },
    { label: 'args that are absent', args: undefined },
    { label: 'args that are a primitive', args: 42 },
  ] satisfies ReadonlyArray<{ label: string; args?: unknown }>)(
    'reports durable-unavailable for a rename with $label instead of deriving a patch',
    ({ args }) => {
      const result = plan(propertyItem(RENAME_LAYER_ACTION, args));

      expect(result.durableEntry).toBeNull();
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'invalid-history-entry',
        severity: 'warning',
        historyId: result.entry.id,
        actionName: RENAME_LAYER_ACTION,
      });
      expect(result.diagnostics[0].message).toContain(RENAME_LAYER_ACTION);
      expect(result.diagnostics[0].message).toContain('layer-property');
      // The legacy edit still stands: a durable failure never rejects the append.
      expect(result.entry.actionName).toBe(RENAME_LAYER_ACTION);
      expect(result.entry.args).toEqual(args);
    }
  );

  it.each([
    { label: 'a show', actionName: SHOW_LAYER_ACTION, args: undefined, patch: { visible: true } },
    { label: 'a hide', actionName: HIDE_LAYER_ACTION, args: undefined, patch: { visible: false } },
    { label: 'a rename', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' }, patch: { name: 'Renamed' } },
    { label: 'a rename to an empty name', actionName: RENAME_LAYER_ACTION, args: { name: '' }, patch: { name: '' } },
    {
      label: 'a rename carrying other layer fields',
      actionName: RENAME_LAYER_ACTION,
      args: { name: 'Renamed', visible: false, opacity: 0.25 },
      patch: { name: 'Renamed' },
    },
    {
      label: 'a hide for a layer the document does not have',
      actionName: HIDE_LAYER_ACTION,
      args: undefined,
      patch: { visible: false },
    },
  ] satisfies ReadonlyArray<{
    label: string;
    actionName: ActionType;
    args?: object;
    patch: DurableLayerPropertyPatch;
  }>)('plans the same entry the conversion records for $label', ({ actionName, args, patch }) => {
    const result = plan(propertyItem(actionName, args, 'ghost'));

    expect(convertedEntryFor(result.entry)).toEqual(result.durableEntry);
    const operation = result.durableEntry?.operation;
    expect(operation?.kind === 'set-layer-properties' ? operation.patch : null).toEqual(patch);
  });

  it.each([
    { label: 'a numeric name', args: { name: 42 } },
    { label: 'a name that is an object', args: { name: { text: 'Renamed' } } },
    { label: 'args that carry no name', args: { opacity: 0.5 } },
    { label: 'args that are absent', args: undefined },
  ] satisfies ReadonlyArray<{ label: string; args?: object }>)(
    'refuses a rename with $label exactly where the conversion records nothing',
    ({ args }) => {
      const result = plan(propertyItem(RENAME_LAYER_ACTION, args));

      expect(result.durableEntry).toBeNull();
      expect(convertedEntryFor(result.entry)).toBeUndefined();
    }
  );
});

describe('planHistoryAppend: append-point validation', () => {
  it('withholds the durable entry when the timeline already holds the id, and keeps the legacy entry', () => {
    const existing = createMockHistoryItem({ id: 'duplicate-id' });

    const result = planHistoryAppend({
      item: cropItem(),
      timeline: timeline([existing]),
      currentFrame: baselineFrame,
      id: 'duplicate-id',
    });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'invalid-history-entry',
      severity: 'error',
      historyId: 'duplicate-id',
    });
    expect(result.durableEntry).toBeNull();
    expect(result.entry).toMatchObject({ id: 'duplicate-id', actionName: SET_DOCUMENT_FRAME_ACTION });

    const control = planHistoryAppend({
      item: cropItem(),
      timeline: timeline([createMockHistoryItem({ id: 'other-id' })]),
      currentFrame: baselineFrame,
      id: 'duplicate-id',
    });
    expect(control.diagnostics).toEqual([]);
    expect(control.durableEntry).not.toBeNull();
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
    const item: NewHistoryItem = { layerId: 'layer-1', actionName: TOOL_ACTION, args: { toolName: 'blur', radius: 4 } };
    const result = planHistoryAppend({
      item,
      timeline: timeline(createMockHistory(1), 9),
      currentFrame: baselineFrame,
    });

    expect(result.diagnostics).toHaveLength(2);
    // The two are still reported independently, so neither cause is silently
    // swallowed by the other.
    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['warning', 'error']);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'unsupported-history-feature',
      'invalid-history-entry',
    ]);

    // `durableEntry` is null here for the translation itself — `TOOL_ACTION` has
    // no canonical operation — while the timeline diagnostic is still reported.
    // The control below proves the two diagnostics remain independently observable.
    const control = planHistoryAppend({
      item,
      timeline: timeline(createMockHistory(1)),
      currentFrame: baselineFrame,
    });
    expect(control.durableEntry).toBeNull();
    expect(control.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['unsupported-history-feature']);

    expect(result.durableEntry).toBeNull();
  });

  it('still returns a usable legacy entry when the timeline check fires', () => {
    const existing = createMockHistoryItem({ id: 'duplicate-id' });
    const prior = timeline([existing]);

    const result = planHistoryAppend({
      item: cropItem(),
      timeline: prior,
      currentFrame: baselineFrame,
      id: 'duplicate-id',
    });

    // The planned legacy item is intact and appendable, so the legacy edit is not
    // rejected: this is the property that keeps a withheld durable entry from
    // turning a durable-only failure into a lost edit.
    expect(result.entry).toMatchObject({
      id: 'duplicate-id',
      layerId: 'document',
      actionName: SET_DOCUMENT_FRAME_ACTION,
      args: { previousFrame: baselineFrame, nextFrame: croppedFrame },
    });
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'invalid-history-entry', severity: 'error', historyId: 'duplicate-id' })
    );

    // And the store can still commit it. `updateHistoryTimeline` is the function
    // the store actually calls for this append, so driving it proves the edit
    // lands rather than asserting a hand-built object contains itself.
    //
    // Not driven here: the React wrapper that dispatches `COMMIT_DOCUMENT_EDIT` and
    // reads the result back out of the store. That lives in
    // `useLayer.commit.test.tsx`, which mocks this module, so reproducing the
    // dispatch here would exercise the mock rather than this boundary. What is
    // covered is the real transition plus the real publication decision.
    const next = updateHistoryTimeline(prior, { type: 'append', entry: result.entry });

    // A correct superset of the prior timeline: nothing already committed changed,
    // the planned entry is the new tip, and the cursor and branch revision moved
    // the way the reducer moves them.
    expect(next.entries).toHaveLength(prior.entries.length + 1);
    expect(next.entries[0]).toBe(existing);
    expect(next.entries[1]).toBe(result.entry);
    expect(next.cursor).toBe(next.entries.length - 1);
    expect(next.branchRevision).toBe(prior.branchRevision + 1);
    // The duplicate id is now in the legacy timeline too, which is precisely why
    // the durable side must not be published from a plan for it.
    expect(next.entries.map((entry) => entry.id)).toEqual(['duplicate-id', 'duplicate-id']);
    // The prior timeline is a value the reducer did not touch.
    expect(prior.entries).toEqual([existing]);
    expect(prior.cursor).toBe(0);
    expect(prior.branchRevision).toBe(0);
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
    [
      'a foreign id',
      { ...planned, id: 'elsewhere' },
      'durable entry id elsewhere does not match the legacy entry id crop-1',
    ],
    ['a different schema version', { ...planned, schemaVersion: 99 }, 'durable schema version 99'],
    [
      'a flipped enabled state',
      { ...planned, enabled: false },
      'the durable enabled state does not match the legacy entry',
    ],
    [
      'a different operation kind',
      { ...planned, operation: { kind: 'set-selection' } as never },
      'a document frame change produced a "set-selection" operation',
    ],
    [
      'a rewritten next frame',
      {
        ...planned,
        operation: { kind: 'set-document-frame', previous: baselineFrame, next: { ...croppedFrame, width: 1 } },
      },
      'the durable next frame does not match the legacy entry',
    ],
    [
      'a rewritten previous frame',
      {
        ...planned,
        operation: { kind: 'set-document-frame', previous: { ...baselineFrame, x: 7 }, next: croppedFrame },
      },
      'the durable previous frame does not match the legacy entry',
    ],
  ] as const)('reports a mismatch for %s', (_label, candidate, reason) => {
    const decision = decide({ planned: candidate as DurableHistoryEntry });

    expect(decision.outcome).toBe('mismatch');
    // The reason is the reported contract, so each drift keeps its own string: a
    // converter that answered all six alike would be reporting nothing.
    if (decision.outcome === 'mismatch') expect(decision.reason).toBe(reason);
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

  const selectionPlan = planHistoryAppend({
    item: createSelectionHistoryItem(previousSelectionState, nextSelectionState),
    timeline: prior,
    currentFrame: baselineFrame,
    currentSelections: previousSelectionState,
  });
  const plannedSelection = selectionPlan.durableEntry as DurableHistoryEntry;
  const decideSelection = (candidate: DurableHistoryEntry) =>
    decide({
      entry: selectionPlan.entry,
      next: { entries: [...priorEntries, selectionPlan.entry], cursor: 1, branchRevision: 0 },
      planned: candidate,
    });

  it('publishes the planned set-selection entry the boundary itself derived', () => {
    const decision = decideSelection(plannedSelection);

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history).toHaveLength(2);
    expect(decision.document.history[1].operation).toEqual({
      kind: 'set-selection',
      before: previousSelectionState,
      after: nextSelectionState,
    });
  });

  it('accepts the defaulted before of a selection item that supplies no previous state', () => {
    const bare = planHistoryAppend({
      item: createSelectionHistoryItem(undefined, nextSelectionState),
      timeline: prior,
      currentFrame: baselineFrame,
      currentSelections: previousSelectionState,
    });

    // `before` is only a baseline, so a boundary default is a legitimate answer
    // where the legacy item never recorded one. Rejecting it would defeat every
    // selection writer that creates history without a previous state.
    const decision = decide({
      entry: bare.entry,
      next: { entries: [...priorEntries, bare.entry], cursor: 1, branchRevision: 0 },
      planned: {
        ...(bare.durableEntry as DurableHistoryEntry),
        operation: { kind: 'set-selection', before: selectionState('defaulted'), after: nextSelectionState },
      },
    });

    expect(decision.outcome).toBe('published');
  });

  it.each([
    [
      'a rewritten next selection state',
      { operation: { kind: 'set-selection', before: previousSelectionState, after: selectionState('rewritten') } },
      'the durable next selection state does not match the legacy entry',
    ],
    [
      'a rewritten previous selection state',
      { operation: { kind: 'set-selection', before: selectionState('rewritten'), after: nextSelectionState } },
      'the durable previous selection state does not match the legacy entry',
    ],
    [
      'a document frame operation',
      { operation: { kind: 'set-document-frame', previous: baselineFrame, next: croppedFrame } },
      'a selection change produced a "set-document-frame" operation',
    ],
  ] as const)('reports a mismatch for a selection entry carrying %s', (_label, replacement, reason) => {
    const decision = decideSelection({ ...plannedSelection, ...replacement });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') expect(decision.reason).toBe(reason);
  });

  it('reports a mismatch for a published selection entry whose legacy item has no next state', () => {
    const bare = planHistoryAppend({
      item: createSelectionHistoryItem(undefined, undefined),
      timeline: prior,
      currentFrame: baselineFrame,
      currentSelections: previousSelectionState,
    });
    // The boundary plans nothing here, so only a foreign publisher can reach the
    // guard that refuses a `set-selection` entry the legacy item never described.
    expect(bare.durableEntry).toBeNull();
    const decision = decide({
      entry: bare.entry,
      next: { entries: [...priorEntries, bare.entry], cursor: 1, branchRevision: 0 },
      planned: {
        id: bare.entry.id,
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'set-selection', before: previousSelectionState, after: nextSelectionState },
      },
    });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') expect(decision.reason).toBe('a selection change has no next selection state');
  });

  describe('a duplicate-id append, end to end', () => {
    // Every precondition below holds. The ONE thing standing between this append
    // and a published duplicate is the plan the append boundary is supposed to
    // withhold, and it does not withhold it today — which is the branch
    // `HANDOFF.md` §17 prescribes. These cases therefore PASS against the current
    // boundary and exist to make the prescribed fix's teeth visible: each one goes
    // red the moment the fix lands, and none of them asserts the fixed behaviour
    // before the fix does.
    const registry = new AssetRegistry();
    const existing = createMockHistoryItem({
      id: 'duplicate-id',
      actionName: RENAME_LAYER_ACTION,
      args: { name: 'Renamed' },
    });
    const duplicatePrior = timeline([existing]);
    const plan = planHistoryAppend({
      item: cropItem(),
      timeline: duplicatePrior,
      currentFrame: baselineFrame,
      id: 'duplicate-id',
    });
    const duplicateNext = updateHistoryTimeline(duplicatePrior, { type: 'append', entry: plan.entry });
    // The durable document the store would actually be holding for that legacy
    // timeline — one entry, the one the single pre-existing legacy item converts
    // to — rather than an unrelated base whose id is 'baseline' and which
    // therefore cannot demonstrate a collision at all.
    const mirror = legacyHistoryToDurable(duplicatePrior.entries, {
      documentId: 'doc-1',
      documentRevision: 4,
      registry,
    }).document;

    it('names the duplicate and withholds the plan that would have been published beside it', () => {
      expect(plan.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'invalid-history-entry', severity: 'error', historyId: 'duplicate-id' })
      );
      expect(plan.durableEntry).toBeNull();
      expect(mirror.history.map((entry) => entry.id)).toEqual(['duplicate-id']);
    });

    it('refuses the publication, keeps the legacy edit, and reconciles on the id the conversion published once', () => {
      expect(duplicateNext.entries.map((entry) => entry.id)).toEqual(['duplicate-id', 'duplicate-id']);
      const decision = decideDurableAppend({
        documentId: 'doc-1',
        base: mirror,
        prior: duplicatePrior,
        next: duplicateNext,
        entry: plan.entry,
        planned: plan.durableEntry,
        documentRevision: 4,
      });

      expect(decision.outcome).toBe('preconditions');
      if (decision.outcome === 'published') return;
      expect(decision.reason).toBe('no durable entry was planned for this append');

      const converted = legacyHistoryToDurable(duplicateNext.entries, { documentId: 'doc-1', registry });
      expect(converted.diagnostics).toContainEqual(
        expect.objectContaining({ historyId: 'duplicate-id', severity: 'warning' })
      );
      expect(converted.document.history.map((entry) => entry.id)).toEqual(['duplicate-id']);
      const toggled = toggleDurableEntry(converted.document, 'duplicate-id');
      expect(toggled.history.map((entry) => [entry.operation.kind, entry.enabled])).toEqual([
        ['set-layer-properties', false],
      ]);
    });
  });
});

describe('decideDurableAppend: layer-property entries', () => {
  const priorEntries = [createMockHistoryItem({ id: 'baseline' })];
  const prior = { entries: priorEntries, cursor: 0, branchRevision: 0 };
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

  const decide = (entry: HistoryItem, planned: DurableHistoryEntry | null) =>
    decideDurableAppend({
      documentId: 'doc-1',
      base,
      prior,
      next: { entries: [...priorEntries, entry], cursor: 1, branchRevision: 0 },
      entry,
      planned,
      documentRevision: 4,
    });

  const decidePlan = (plan: AppendBoundaryResult, replacement?: Partial<DurableHistoryEntry>) =>
    decide(
      plan.entry,
      replacement ? { ...(plan.durableEntry as DurableHistoryEntry), ...replacement } : plan.durableEntry
    );

  const renamePlan = planHistoryAppend({
    item: propertyItem(RENAME_LAYER_ACTION, { name: 'Renamed' }),
    timeline: prior,
    currentFrame: baselineFrame,
  });
  const disabledRenameEntry = createMockHistoryItem({
    id: 'rename-disabled',
    actionName: RENAME_LAYER_ACTION,
    layerId: 'layer-1',
    args: { name: 'Renamed' },
    disabled: true,
  });

  it.each([
    { label: 'a show', actionName: SHOW_LAYER_ACTION, args: undefined, patch: { visible: true } },
    { label: 'a hide', actionName: HIDE_LAYER_ACTION, args: undefined, patch: { visible: false } },
    { label: 'a rename', actionName: RENAME_LAYER_ACTION, args: { name: 'Renamed' }, patch: { name: 'Renamed' } },
  ] satisfies ReadonlyArray<{
    label: string;
    actionName: ActionType;
    args?: object;
    patch: DurableLayerPropertyPatch;
  }>)('publishes the planned entry the boundary itself derived for $label', ({ actionName, args, patch }) => {
    const plan = planHistoryAppend({
      item: propertyItem(actionName, args),
      timeline: prior,
      currentFrame: baselineFrame,
    });

    const decision = decidePlan(plan);

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history).toHaveLength(2);
    expect(decision.document.history[1]).toEqual(plan.durableEntry);
    expect(decision.document.history[1].operation).toEqual({
      kind: 'set-layer-properties',
      layerId: 'layer-1',
      patch,
    });
    expect(decision.document.cursor).toBe(1);
    expect(decision.document.durableRevision).toBe(8);
  });

  it('publishes a disabled planned entry for a disabled legacy rename', () => {
    const planned = deriveSetLayerPropertiesEntry(disabledRenameEntry);

    expect(planned?.enabled).toBe(false);
    expect(decide(disabledRenameEntry, planned).outcome).toBe('published');
  });

  it('reports a mismatch when a planned entry claims to be enabled for a disabled legacy rename', () => {
    const decision = decide(disabledRenameEntry, {
      ...(deriveSetLayerPropertiesEntry(disabledRenameEntry) as DurableHistoryEntry),
      enabled: true,
    });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') {
      expect(decision.reason).toBe('the durable enabled state does not match the legacy entry');
    }
  });

  it.each([
    [
      'a rewritten name',
      { operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Other' } } },
      'the durable layer name does not match the legacy entry',
    ],
    [
      'a second property in a rename patch',
      {
        operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed', visible: false } },
      },
      'the durable layer-property operation does not match the legacy entry',
    ],
    [
      'a retargeted layer',
      { operation: { kind: 'set-layer-properties', layerId: 'other', patch: { name: 'Renamed' } } },
      'the durable layer id does not match the legacy entry',
    ],
    [
      'a document frame operation',
      { operation: { kind: 'set-document-frame', previous: baselineFrame, next: croppedFrame } },
      'a layer-property change produced a "set-document-frame" operation',
    ],
    [
      'a no-op patch',
      { operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: {} } },
      'the durable layer-property operation does not match the legacy entry',
    ],
  ] as const)('reports a mismatch for a planned rename carrying %s', (_label, replacement, reason) => {
    const decision = decidePlan(renamePlan, replacement);

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') {
      expect(decision.reason).toBe(reason);
    }
  });

  it('reports a mismatch for a published entry whose legacy rename carries no usable name', () => {
    const plan = planHistoryAppend({
      item: propertyItem(RENAME_LAYER_ACTION, { name: 42 }),
      timeline: prior,
      currentFrame: baselineFrame,
    });

    // The boundary plans nothing here, so only a foreign publisher reaches the
    // guard that refuses a patch the legacy item never described.
    expect(plan.durableEntry).toBeNull();
    const decision = decide(plan.entry, {
      id: plan.entry.id,
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-layer-properties', layerId: 'layer-1', patch: { name: 'Renamed' } },
    });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') expect(decision.reason).toBe('the layer-property value is invalid');
  });

  it('falls back without publishing when nothing was planned for the append', () => {
    const plan = planHistoryAppend({
      item: propertyItem(RENAME_LAYER_ACTION, { name: 42 }),
      timeline: prior,
      currentFrame: baselineFrame,
    });

    expect(decidePlan(plan).outcome).toBe('preconditions');
  });
});

/**
 * The reorder decisions. A reorder is the only published action whose
 * correctness depends on the whole layer set rather than on one property of one
 * layer, so it is also the only one the decision has to prove something extra
 * about before it publishes. The store-level behaviour is covered in
 * `StoreContext.reorder.test.tsx`; what is pinned here is that each refusal is
 * reachable, and is a `preconditions` outcome rather than a reported error.
 */
describe('decideDurableAppend: reorder entries', () => {
  const preOrder: LayerId[] = ['bottom', 'middle', 'top'];
  const priorEntries = [createMockHistoryItem({ id: 'baseline' })];
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

  const reorderEntry = (overrides: { id?: string; afterWhichLayerId?: LayerId | null } = {}) => {
    const args: { layerToMoveId: LayerId; afterWhichLayerId?: LayerId | null } =
      'afterWhichLayerId' in overrides
        ? { layerToMoveId: 'bottom', afterWhichLayerId: overrides.afterWhichLayerId }
        : { layerToMoveId: 'bottom', afterWhichLayerId: 'top' };
    return createMockHistoryItem({
      id: overrides.id ?? 'reorder-1',
      actionName: REORDER_ACTION,
      layerId: 'bottom',
      args,
    });
  };

  const decide = (entry: ReturnType<typeof reorderEntry>, overrides: Partial<DurableAppendInput> = {}) => {
    const next = { entries: [...priorEntries, entry], cursor: 1, branchRevision: 0 };
    return decideDurableAppend({
      documentId: 'doc-1',
      base,
      prior: { entries: priorEntries, cursor: 0, branchRevision: 0 },
      next,
      entry,
      planned: deriveReorderLayersEntry(entry, preOrder),
      documentRevision: 4,
      preLayerOrder: preOrder,
      durableLayerOrder: [...preOrder],
      ...overrides,
    });
  };

  it('publishes a reorder planned from the store order', () => {
    const entry = reorderEntry();
    const decision = decide(entry);

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history).toHaveLength(2);
    expect(decision.document.history[1]!.operation).toEqual({
      kind: 'reorder-layers',
      orderByLayerId: { middle: 0, top: 1, bottom: 2 },
    });
    expect(decision.document.history[1]!.id).toBe(entry.id);
    expect(decision.document.durableRevision).toBe(8);
  });

  it.each([
    ['no store order at all', { preLayerOrder: null }],
    ['a durable order that is not supplied', { durableLayerOrder: null }],
    ['a durable order of the wrong length', { durableLayerOrder: ['bottom', 'middle'] }],
    ['a durable order with a layer the store does not hold', { durableLayerOrder: [...preOrder, 'ghost'] }],
    ['a durable order missing a layer the store holds', { durableLayerOrder: ['bottom', 'top'] }],
    // Same length, same members, different sequence. This is the case a
    // membership check cannot see, and it is the one that matters: a published
    // map is a fresh normalisation of the order, so publishing while the models
    // disagree about the order launders the disagreement into a document no
    // reconversion will reproduce.
    [
      'a durable order that is the same set in a different sequence',
      { durableLayerOrder: ['top', 'middle', 'bottom'] },
    ],
  ] as const)('refuses to publish for %s', (_label, overrides) => {
    const decision = decide(reorderEntry(), overrides as Partial<DurableAppendInput>);

    expect(decision.outcome).toBe('preconditions');
  });

  it('refuses a plan whose map disagrees with the store order', () => {
    const entry = reorderEntry();

    // A map that is a valid reorder, of a different reorder. Only the store's
    // own order can tell them apart, which is the whole reason it is supplied.
    const decision = decide(entry, {
      planned: {
        id: entry.id,
        schemaVersion: DURABLE_SCHEMA_VERSION,
        enabled: true,
        operation: { kind: 'reorder-layers', orderByLayerId: { bottom: 0, middle: 1, top: 2 } },
      } as DurableHistoryEntry,
    });

    expect(decision.outcome).toBe('mismatch');
    if (decision.outcome === 'mismatch') expect(decision.reason).toContain('order');
  });

  it.each([
    ['no anchor', undefined, { bottom: 0, middle: 1, top: 2 }],
    ['an explicit null anchor', null, { bottom: 0, middle: 1, top: 2 }],
  ] as const)('plans a move to the bottom for %s', (_label, afterWhichLayerId, expected) => {
    const entry = reorderEntry({ afterWhichLayerId });
    const decision = decide(entry);

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history[1]!.operation).toEqual({ kind: 'reorder-layers', orderByLayerId: expected });
  });
});

/**
 * Three known gaps in the publication preconditions, pinned exactly as the
 * boundary behaves today.
 *
 * Each test asserts what the code DOES and names, in its own comment, the
 * precondition it does not have. They are tripwires, not endorsements: a fix
 * adds the named precondition, and the pin is deleted rather than relaxed. A
 * green run here is not evidence the boundary is safe — it is evidence the
 * defect has not been fixed yet.
 */
describe('decideDurableAppend: known gaps in the publication preconditions', () => {
  const undoneFrame: DocumentFrame = { x: 0, y: 0, width: 640, height: 480 };
  const appendedFrame: DocumentFrame = { x: 0, y: 0, width: 200, height: 150 };
  const zeroFrame: DocumentFrame = { x: 0, y: 0, width: 0, height: 0 };

  const frameEntryAt = (id: string, previous: DocumentFrame, next: DocumentFrame): DurableHistoryEntry => ({
    id,
    schemaVersion: DURABLE_SCHEMA_VERSION,
    enabled: true,
    operation: { kind: 'set-document-frame', previous, next },
  });

  // Typed by the return annotation rather than cast, so a new REQUIRED field on
  // `DurableDocument` is a compile error here instead of a fixture that silently
  // omits it. Nothing in the boundary mutates its base, so the literal needs no
  // freeze to be honest.
  const durableBase = (history: readonly DurableHistoryEntry[], cursor: number): DurableDocument => ({
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
    history,
    cursor,
  });

  const gapPriorEntries = [createMockHistoryItem({ id: 'legacy-0' }), createMockHistoryItem({ id: 'legacy-1' })];
  const gapPrior: HistoryTimeline = {
    entries: gapPriorEntries,
    cursor: gapPriorEntries.length - 1,
    branchRevision: 0,
  };

  const cropEntryWith = (id: string, nextFrame: DocumentFrame) =>
    createMockHistoryItem({
      id,
      actionName: SET_DOCUMENT_FRAME_ACTION,
      layerId: 'document',
      args: { previousFrame: baselineFrame, nextFrame },
    });

  const decideCrop = (base: DurableDocument, entry: HistoryItem, planned: DurableHistoryEntry | null) =>
    decideDurableAppend({
      documentId: 'doc-1',
      base,
      prior: gapPrior,
      next: { entries: [...gapPriorEntries, entry], cursor: gapPriorEntries.length, branchRevision: 0 },
      entry,
      planned,
      documentRevision: 4,
    });

  /** The route the boundary falls back to, run over the same legacy items. */
  const convertedBy = (items: readonly HistoryItem[]) => {
    const registry = new AssetRegistry();
    try {
      return legacyHistoryToDurable(items, { documentId: 'parity-doc', registry, initialFrame: baselineFrame });
    } finally {
      registry.shutdown();
    }
  };

  // KNOWN GAP 1 — missing precondition: the base's own cursor. The guard list
  // (`history-append.ts:590-610`) proves `documentId`, both revisions, the legacy
  // tip, the length delta, the legacy cursor and the entry identity; it never
  // proves that `base.cursor === base.history.length - 1`. The only cursor guard
  // runs the wrong way for it — `cursor > next.cursor` (`history-append.ts:647`)
  // catches a base that has too MANY entries, and a base that has too few slips
  // through, because the published cursor is `base.history.length`
  // (`history-append.ts:644`), not `base.cursor + 1`.
  //
  // User-visible failure: an entry the durable document had not reached (its own
  // cursor sat below it — an undone edit) is inside the published cursor, so the
  // published shadow replays an edit the user undid, and the redo-only state the
  // base described is gone. Latent in the store today, because a mid-timeline
  // base is only produced by a rebuild that maps the legacy cursor
  // (`StoreContext.tsx:659-696`) and therefore arrives with a legacy prior that
  // is not at its tip, which `history-append.ts:599` refuses first. Nothing in
  // the boundary enforces the invariant; only that accident does.
  it('publishes onto a base that is not at its own tip, turning a redo-only entry into an applied one', () => {
    const entry = cropEntryWith('crop-1', appendedFrame);
    const base = durableBase(
      [
        frameEntryAt('baseline-0', baselineFrame, baselineFrame),
        frameEntryAt('undone-crop', baselineFrame, undoneFrame),
      ],
      0
    );

    // Precondition for the pin: for this base, the crop at index 1 is redo-only.
    expect(base.cursor).toBe(0);
    expect(replayDurableDocument(base).frame).toEqual(baselineFrame);

    const decision = decideCrop(base, entry, deriveSetDocumentFrameEntry(entry, baselineFrame));

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(decision.document.history.map((candidate) => candidate.id)).toEqual(['baseline-0', 'undone-crop', 'crop-1']);
    // The cursor advanced by TWO, from a base that was one behind its own history,
    // and the entry the base had not reached is now below that cursor.
    expect(decision.document.cursor).toBe(2);
    expect(replayDurableDocument(decision.document, 1).frame).toEqual(undoneFrame);
  });

  // KNOWN GAP 2 — missing precondition: `isValidDocumentFrame` on the planned
  // `next`. The frame branch of `validatePlannedDurableEntry`
  // (`history-append.ts:486-498`) proves only that `planned.operation.next` equals
  // `args.nextFrame` structurally (`sameFrame`, `history-append.ts:492`); it never
  // asks whether either is a document frame. Every derivation that BUILDS such an
  // entry refuses one (`history-adapter.ts:260`, which the plan calls at
  // `history-append.ts:133`), so only a supplied entry reaches the gap.
  //
  // User-visible failure: durable replay applies `next` unvalidated
  // (`durable-replay.ts:129-131`) and `documentFrameSize` clamps to a 1x1 minimum
  // (`document-frame.ts:9-14`), so a published 0x0 crop makes the shadow describe
  // a 1x1 document. The conversion route for the same item publishes nothing and
  // reports the loss as a warning (`history-adapter.ts:662`), so the two routes
  // now disagree about one legacy item and only one of them says so.
  it('publishes a planned frame whose next frame is not a document frame, and the shadow replays it anyway', () => {
    const entry = cropEntryWith('crop-zero', zeroFrame);
    const planned: DurableHistoryEntry = {
      id: entry.id,
      schemaVersion: DURABLE_SCHEMA_VERSION,
      enabled: true,
      operation: { kind: 'set-document-frame', previous: baselineFrame, next: zeroFrame },
    };
    const base = durableBase([frameEntryAt('baseline-0', baselineFrame, baselineFrame)], 0);

    const decision = decideCrop(base, entry, planned);

    expect(decision.outcome).toBe('published');
    if (decision.outcome !== 'published') return;
    expect(replayDurableDocument(decision.document).frame).toEqual(zeroFrame);
    // Every size the application reads off that frame is clamped, so the loss is
    // not visible as a zero — it is visible as a document one pixel square.
    expect(documentFrameSize(replayDurableDocument(decision.document).frame)).toEqual({ width: 1, height: 1 });

    // The same item on the other two routes, which is what makes this a divergence.
    expect(deriveSetDocumentFrameEntry(entry, baselineFrame)).toBeNull();
    const plan = planHistoryAppend({
      item: {
        layerId: 'document',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: { previousFrame: baselineFrame, nextFrame: zeroFrame },
      },
      timeline: gapPrior,
      currentFrame: baselineFrame,
    });
    expect(plan.durableEntry).toBeNull();
    const conversion = convertedBy([entry]);
    expect(conversion.document.history.filter((candidate) => candidate.id === entry.id)).toHaveLength(0);
    expect(conversion.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ historyId: entry.id, severity: 'warning' })])
    );
  });

  // Entry-id uniqueness is closed at the plan boundary. The conversion route
  // still reports a repeated id and keeps one durable entry; the decision-level
  // uniqueness guard remains a separate handoff item.
  it('routes a repeated entry id to conversion, so the durable document cannot hold it twice', () => {
    const entry = cropEntryWith('crop-1', appendedFrame);
    const base = durableBase(
      [frameEntryAt('baseline-0', baselineFrame, baselineFrame), frameEntryAt('crop-1', baselineFrame, croppedFrame)],
      1
    );

    const collidingPlan = planHistoryAppend({
      item: {
        layerId: 'document',
        actionName: SET_DOCUMENT_FRAME_ACTION,
        args: { previousFrame: baselineFrame, nextFrame: appendedFrame },
      },
      timeline: { entries: [...gapPriorEntries, entry], cursor: gapPriorEntries.length, branchRevision: 0 },
      currentFrame: baselineFrame,
      id: 'crop-1',
    });
    expect(collidingPlan.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ historyId: 'crop-1', severity: 'error' })])
    );
    expect(collidingPlan.durableEntry).toBeNull();
    expect(collidingPlan.entry).toMatchObject({ id: 'crop-1', actionName: SET_DOCUMENT_FRAME_ACTION });

    const decision = decideCrop(base, collidingPlan.entry, collidingPlan.durableEntry);
    expect(decision.outcome).toBe('preconditions');
    if (decision.outcome === 'published') return;
    expect(decision.reason).toBe('no durable entry was planned for this append');

    const conversion = convertedBy([entry, entry]);
    expect(conversion.document.history.filter((candidate) => candidate.id === 'crop-1')).toHaveLength(1);
    expect(conversion.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ historyId: 'crop-1', severity: 'warning' })])
    );
  });
});
