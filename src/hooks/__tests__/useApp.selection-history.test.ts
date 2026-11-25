import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApp } from '../useApp.ts';
import type { Selection } from '../../contexts/general-types.ts';
import type { ToolName } from '../../contexts/tool-types.ts';
import { claimDocumentGesture, resetDocumentGestures } from '../document-gesture.ts';

/**
 * A committed selection is document state and remains available after switching tools. Deselect
 * is an explicit selection command, not a side effect of choosing a raster tool.
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

type CommitEdit = {
  type: string;
  payload: {
    historyItem: { id: string; args: unknown };
    durableEntry?: unknown;
    updates?: Record<string, unknown>;
  };
};

function commitEdits(): CommitEdit[] {
  return harness.dispatch.mock.calls
    .map(([action]) => action as CommitEdit)
    .filter((action) => action.type === 'COMMIT_DOCUMENT_EDIT');
}

describe('goToTool selection persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDocumentGestures();
    harness.state = createStoreState();
  });

  it('preserves the committed selection when switching to a selection-aware raster operation', () => {
    useApp().goToTool('paint-bucket');

    expect(commitEdits()).toHaveLength(0);
    expect(harness.state.selections).toEqual([createSelection()]);
    expect(harness.state.activeSelectionId).toBe('sel-1');
    expect(harness.layerMocks.commitDirtyTool).toHaveBeenCalledOnce();
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_TOOL_NAME', payload: 'paint-bucket' });
  });

  it('records an explicit clear before switching to a pixel tool that ignores selection coverage', () => {
    const marker = { status: 'cleared', version: 4 };
    harness.state = createStoreState({ selectionCleared: marker });

    useApp().goToTool('blur');

    const edits = commitEdits();
    expect(edits).toHaveLength(1);
    expect(edits[0].payload.historyItem.args).toEqual(
      expect.objectContaining({
        previousSelectionState: expect.objectContaining({ activeSelectionId: 'sel-1' }),
        nextSelectionState: { selections: [], activeSelectionId: null },
      })
    );
    expect(edits[0].payload.durableEntry).toEqual(
      expect.objectContaining({
        operation: expect.objectContaining({
          kind: 'set-selection',
          after: { selections: [], activeSelectionId: null },
        }),
      })
    );
    expect(edits[0].payload.updates).toEqual(
      expect.objectContaining({
        selections: [],
        activeSelectionId: null,
        selectionCleared: { status: 'cleared', version: 5 },
      })
    );
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

  it('keeps the current tool when its pending text edit cannot be committed', () => {
    harness.layerMocks.commitDirtyTool.mockReturnValueOnce(null);

    expect(useApp().goToTool('blur')).toBe(false);

    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it('switches tools without committing a preview owned by a live document gesture', () => {
    harness.state = createStoreState({ selections: [], activeSelectionId: null });
    expect(claimDocumentGesture('paint-stroke', 7)).toBe(true);

    expect(useApp().goToTool('blur')).toBe(true);

    expect(harness.layerMocks.commitDirtyTool).not.toHaveBeenCalled();
    expect(commitEdits()).toHaveLength(0);
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
  });

  it('does not append a selection clear while cancelling a live document gesture', () => {
    expect(claimDocumentGesture('layer-transform', 7)).toBe(true);

    expect(useApp().goToTool('blur')).toBe(true);

    expect(harness.layerMocks.commitDirtyTool).not.toHaveBeenCalled();
    expect(commitEdits()).toHaveLength(0);
    expect(harness.dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'SET_TOOL_NAME', payload: 'blur' });
  });
});
