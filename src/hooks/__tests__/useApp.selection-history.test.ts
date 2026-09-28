import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import { SELECTION_ACTION } from '../../util/constants.ts';
import type { Selection } from '../../contexts/general-types.ts';
import type { ToolName } from '../../contexts/tool-types.ts';

/**
 * The tool switch's deselect through the single selection writer.
 *
 * `goToTool` used to build a `SELECTION_ACTION` history item by hand and
 * dispatch it with no `durableEntry`, so every tool switch fell back to a
 * whole-timeline reconversion. These pin that it now supplies the planned
 * durable entry, and that the two early returns are unchanged: switching to the
 * tool already active, and switching with no live selection, still append
 * nothing.
 */
const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  dispatch: vi.fn(),
  layerMocks: {
    createBlankLayer: vi.fn(),
    createLayerFromBitmap: vi.fn(),
    commitDirtyTool: vi.fn(),
  },
}));

vi.mock('../../contexts/StoreContext.tsx', () => ({
  useStore: () => [harness.state, harness.dispatch],
}));

vi.mock('../../contexts/useLayer.ts', () => ({ useLayers: () => harness.layerMocks }));

function createSelection(): Selection {
  return {
    id: 'sel-1',
    isActive: true,
    lifecycle: 'committed',
    geometry: 'rectangle',
    sourceTool: 'rectangular-selection',
    points: [],
    pos: { x: 4, y: 5, width: 10, height: 12 },
  } as Selection;
}

/** A store at the tip of a convertible timeline, so the plan can actually publish. */
function createStoreState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canvasRef: { current: null },
    toolOverlayRef: { current: null },
    rectOverlayRef: { current: null },
    currentArgs: { current: {} },
    clearPreviewLayers: vi.fn(),
    toolName: 'rectangular-selection' as ToolName,
    totalSize: { width: 100, height: 80 },
    documentFrame: { x: 0, y: 0, width: 100, height: 80 },
    history: [{ id: 'open-1', actionName: 'open-document', layerId: 'bedrock' }],
    historyIndex: 0,
    branchRevision: 0,
    selections: [createSelection()],
    activeSelectionId: 'sel-1',
    selectionDraft: { status: 'idle' },
    selectionCleared: null,
    ...overrides,
  };
}

type CommitEdit = { type: string; payload: { historyItem: { id: string; args: unknown }; durableEntry?: unknown } };

function commitEdits(): CommitEdit[] {
  return harness.dispatch.mock.calls
    .map(([action]) => action as CommitEdit)
    .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');
}

describe('goToTool selection history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    harness.state = createStoreState();
  });

  it('appends the tool switch deselect as one edit carrying the planned durable entry', () => {
    useApp().goToTool('blur');

    const edits = commitEdits();
    expect(edits).toHaveLength(1);

    const { historyItem, durableEntry } = edits[0].payload;
    expect(historyItem.args).toEqual(
      expect.objectContaining({
        previousSelectionState: expect.objectContaining({ activeSelectionId: 'sel-1' }),
        nextSelectionState: { selections: [], activeSelectionId: null },
      })
    );
    // The whole point of the fix: the planned entry is published, so the store
    // appends instead of reconverting the timeline.
    expect(durableEntry).toEqual(
      expect.objectContaining({
        id: historyItem.id,
        operation: {
          kind: 'set-selection',
          before: expect.objectContaining({ activeSelectionId: 'sel-1' }),
          after: { selections: [], activeSelectionId: null },
        },
      })
    );
  });

  it('still clears the selection and bumps the repaint marker through the same edit', () => {
    harness.state = createStoreState({ selectionCleared: { status: 'cleared', version: 4 } });

    useApp().goToTool('blur');

    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'COMMIT_DOCUMENT_EDIT',
        payload: expect.objectContaining({
          updates: {
            selections: [],
            activeSelectionId: null,
            selectionDraft: { status: 'idle' },
            selectionCleared: { status: 'cleared', version: 5 },
          },
          historyItem: expect.objectContaining({ actionName: SELECTION_ACTION, layerId: 'selection' }),
        }),
      })
    );
    expect(harness.layerMocks.commitDirtyTool).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenLastCalledWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
  });

  it('appends nothing when the switch has no live selection', () => {
    harness.state = createStoreState({ selections: [], activeSelectionId: null });

    useApp().goToTool('blur');

    expect(commitEdits()).toHaveLength(0);
    // `COMMIT_DOCUMENT_EDIT` always flags unsaved changes, so a no-op switch
    // must not reach it at all or the document would be marked dirty.
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
  });

  it('appends nothing when the target tool is already active', () => {
    harness.state = createStoreState({ toolName: 'blur' as ToolName });

    useApp().goToTool('blur');

    expect(commitEdits()).toHaveLength(0);
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
  });
});
