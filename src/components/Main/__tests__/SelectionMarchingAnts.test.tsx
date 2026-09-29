import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Selection } from '../../../contexts/general-types.ts';
import { createMockCanvasContext } from '../../../test/setup.ts';
import { SelectionMarchingAnts } from '../SelectionMarchingAnts.tsx';

/**
 * The store-to-canvas wiring for the polygon selection border: whatever the store
 * holds is what marches, on the canvas `Main` hands over, and only while the
 * polygon selection tools are up.
 */

const storeState = vi.hoisted(
  () =>
    ({
      selections: [] as Selection[],
      totalSize: { width: 200, height: 120 },
      documentFrame: { x: 0, y: 0, width: 200, height: 120 },
    }) as Record<string, unknown>
);

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

function polygon(overrides: Partial<Selection> = {}): Selection {
  return {
    id: 'sel-1',
    isActive: true,
    lifecycle: 'committed',
    geometry: 'polygon',
    sourceTool: 'polygonal-lasso',
    pos: { x: 10, y: 20, width: 30, height: 40 },
    points: [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 40 },
    ],
    ...overrides,
  };
}

function createRafMocks() {
  const frames: Map<number, FrameRequestCallback> = new Map();
  let nextId = 0;

  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, callback);
    return id;
  });

  const cancelAnimationFrame = vi.fn((id: number) => {
    frames.delete(id);
  });

  return { requestAnimationFrame, cancelAnimationFrame, frames };
}

describe('SelectionMarchingAnts', () => {
  let rafMocks: ReturnType<typeof createRafMocks>;
  let origRaf: typeof requestAnimationFrame;
  let origCancel: typeof cancelAnimationFrame;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;

    rafMocks = createRafMocks();
    globalThis.requestAnimationFrame = rafMocks.requestAnimationFrame;
    globalThis.cancelAnimationFrame = rafMocks.cancelAnimationFrame;

    storeState.selections = [];
    storeState.documentFrame = { x: 0, y: 0, width: 200, height: 120 };
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    vi.restoreAllMocks();
  });

  function frame() {
    const pending = [...rafMocks.frames.values()];
    rafMocks.frames.clear();
    act(() => pending.forEach((callback) => callback(0)));
  }

  function setup(enabled = true) {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    const ctx = createMockCanvasContext(canvas);
    canvas.getContext = vi.fn(() => ctx) as unknown as HTMLCanvasElement['getContext'];

    render(<SelectionMarchingAnts overlayRef={{ current: canvas }} enabled={enabled} />);

    return { ctx };
  }

  it('marches the committed polygon the store holds', () => {
    storeState.selections = [polygon()];
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(1);

    frame();

    expect(ctx.setLineDash).toHaveBeenCalled();
    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(10, 20);
    expect(path.closePath).toHaveBeenCalledOnce();
  });

  it('offsets the border by the store document frame', () => {
    storeState.selections = [polygon()];
    storeState.documentFrame = { x: 100, y: 50, width: 300, height: 300 };
    const { ctx } = setup();

    frame();

    const path = vi.mocked(ctx.stroke).mock.calls.at(-1)![0] as Path2D;
    expect(path.moveTo).toHaveBeenCalledWith(-90, -30);
  });

  it('paints nothing while the polygon selection tools are not up', () => {
    storeState.selections = [polygon()];
    const { ctx } = setup(false);

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('paints nothing when the document holds no selection', () => {
    const { ctx } = setup();

    expect(rafMocks.frames.size).toBe(0);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});
