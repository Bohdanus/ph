import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HandToolArea } from '../HandToolArea.tsx';
import { getView, resetViewForTest, setFitMetrics, setZoom } from '../../../hooks/document-view.ts';
import { claimDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';

/**
 * The pan gesture.
 *
 * `document-view` is NOT mocked: the assertions are about the offset the store ends up holding
 * and about the clamp that must apply to it, so a mocked store would assert the test's own idea
 * of panning rather than the shipped one. `usePointerPosition` IS mocked, because its job here
 * is capture validity — first pointer wins, abort routes — and it is exercised directly by
 * `usePointerPosition.test.ts`.
 */

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: null },
      totalSize: { width: 2000, height: 1000 },
    },
  ],
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => {
    const state = {
      down: { current: true },
      move: { current: true },
      up: { current: true },
      released: { current: 0 },
      pointerId: { current: null as number | null },
    };

    return {
      isPointerDownValid: () => {
        if (!state.down.current) return false;
        state.down.current = false;
        return true;
      },
      isPointerMoveValid: () => state.move.current,
      isPointerUpValid: () => state.up.current,
      releasePointer: () => {
        state.released.current += 1;
      },
      __state: state,
    };
  },
}));

/** 2000x1000 of bitmap against a 1000x500 container: pan freedom on both axes, ±500 and ±250. */
const ZOOMED_IN = {
  fitScale: 1,
  offsetX: 0,
  offsetY: 0,
  containerWidth: 1000,
  containerHeight: 500,
  imageWidth: 2000,
  imageHeight: 1000,
};

const pointerEvent = (type: string, clientX: number, clientY: number) =>
  new PointerEvent(type, { clientX, clientY, bubbles: true, cancelable: true, pointerId: 1, button: 0 });

const mount = async () => {
  const { render } = await import('@testing-library/react');
  const utils = render(<HandToolArea className="probe" />);
  const area = utils.container.querySelector('.probe') as HTMLElement;
  return { area, unmount: utils.unmount };
};

/** The drag is expressed in raw client px, so a three-step drag sums to the total delta. */
const drag = (area: HTMLElement, from: [number, number], to: [number, number]) => {
  area.dispatchEvent(pointerEvent('pointerdown', from[0], from[1]));
  area.dispatchEvent(pointerEvent('pointermove', (from[0] + to[0]) / 2, (from[1] + to[1]) / 2));
  area.dispatchEvent(pointerEvent('pointermove', to[0], to[1]));
  area.dispatchEvent(pointerEvent('pointerup', to[0], to[1]));
};

beforeEach(() => {
  resetDocumentGestures();
  resetViewForTest();
  setFitMetrics(ZOOMED_IN);
});

afterEach(() => {
  resetViewForTest();
  resetDocumentGestures();
});

describe('the Hand pans the view', () => {
  it('follows the raw client delta, undivided', async () => {
    const { area } = await mount();

    drag(area, [500, 250], [560, 200]);

    // Not divided by the scale. Dividing would make the document track the pointer at a
    // different rate than it moves, and at high magnification the view would crawl.
    expect(getView()).toEqual({ dx: 60, dy: -50, zoom: 1, rotation: 0 });
  });

  it('sums a multi-step drag to the total movement', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 520, 250));
    area.dispatchEvent(pointerEvent('pointermove', 540, 250));
    area.dispatchEvent(pointerEvent('pointermove', 560, 250));
    area.dispatchEvent(pointerEvent('pointerup', 560, 250));

    expect(getView().dx).toBe(60);
  });

  it("leaves the zoom level untouched, which is the tool's whole point", async () => {
    const { area } = await mount();
    setZoom(4);

    drag(area, [500, 250], [400, 250]);

    expect(getView().zoom).toBe(4);
  });

  it('is never clamped, so a drag takes the image as far as the pointer goes', async () => {
    // Adobe does not hold the image inside the window either. Losing the document off-screen is
    // the accepted cost, and `fitToScreen` is the way back.
    const { area } = await mount();

    drag(area, [500, 250], [5000, 5000]);

    expect(getView()).toEqual({ dx: 4500, dy: 4750, zoom: 1, rotation: 0 });
  });

  it('leaves the image where it was put when the button comes up', async () => {
    // The release contract, asserted directly rather than inferred: `pointerup` clears the drag
    // state and the cursor and nothing else, so the offset the drag reached is the offset that
    // stands. A reset here would make the tool feel like it dropped the image.
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 620, 200));
    const whileDragging = getView();

    area.dispatchEvent(pointerEvent('pointerup', 620, 200));

    expect(whileDragging).toEqual({ dx: 120, dy: -50, zoom: 1, rotation: 0 });
    expect(getView()).toEqual(whileDragging);
  });

  it('does not move on a move that never saw a down', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointermove', 900, 400));

    expect(getView()).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });
  });

  it('stops moving after the up, rather than chasing a stray move', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 600, 250));
    area.dispatchEvent(pointerEvent('pointerup', 600, 250));
    expect(getView().dx).toBe(100);

    area.dispatchEvent(pointerEvent('pointermove', 800, 250));

    expect(getView().dx).toBe(100);
  });

  it('ignores a zero-length step rather than writing a no-op to the store', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 500, 250));
    area.dispatchEvent(pointerEvent('pointerup', 500, 250));

    expect(getView()).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: 0 });
  });
});

describe('spring-loaded over another tool', () => {
  it('pans without consulting which tool is selected', async () => {
    // The area is MOUNTED because the view says so — `toolName === 'hand'` or `isSpaceHeld()` —
    // and under the spring-loaded route the selected tool is something else by definition. An
    // earlier version guarded on `toolName`, which made holding Space over the Move tool and
    // dragging pan nothing: the guard rejected the very gesture the tool exists for.
    //
    // Nothing in this file can set the selected tool, and that is the assertion: the pan does not
    // depend on it. The store mock has no `toolName` at all.
    const { area } = await mount();

    drag(area, [500, 250], [700, 200]);

    expect(getView()).toEqual({ dx: 200, dy: -50, zoom: 1, rotation: 0 });
  });
});

describe('leaving the gesture', () => {
  it('releases the cursor lock when the drag ends', async () => {
    const lock = vi.spyOn(document.body.classList, 'add');
    const unlock = vi.spyOn(document.body.classList, 'remove');

    const { area } = await mount();
    drag(area, [500, 250], [600, 250]);

    expect(lock).toHaveBeenCalledWith('cursor-grabbing');
    expect(unlock).toHaveBeenCalledWith('cursor-grabbing');

    lock.mockRestore();
    unlock.mockRestore();
  });

  it('releases the capture and the cursor on unmount, for a tool switch mid-drag', async () => {
    // A tool switch while a drag is in flight unmounts this area without a `pointerup`, and a
    // leaked `cursor-grabbing` on `document.body` would apply to the whole app for the rest of
    // the session.
    const unlock = vi.spyOn(document.body.classList, 'remove');

    const { area, unmount } = await mount();
    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 600, 250));

    unmount();

    expect(unlock).toHaveBeenCalledWith('cursor-grabbing');
    unlock.mockRestore();
  });

  it('keeps the offset reached when the pointer is cancelled', async () => {
    // A cancelled pan is still the user having moved the view, and snapping it back would be a
    // correction nobody asked for.
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', 500, 250));
    area.dispatchEvent(pointerEvent('pointermove', 620, 250));

    expect(getView().dx).toBe(120);
  });
});

describe('the Hand claims no document gesture', () => {
  it('leaves the document slot free, because it writes no pixel', async () => {
    // `document-gesture.ts` reserves the single slot for a drag that will mutate the document on
    // release. Claiming it here would make the tool refuse its own gesture and break the "one
    // document owner at a time" invariant for no benefit.
    const { area } = await mount();

    drag(area, [500, 250], [600, 250]);

    // Nothing took it, so a claim taken afterwards still succeeds — that is the proof.
    expect(claimDocumentGesture('brush-stroke', 1)).toBe(true);
  });

  it('pans even while another tool holds the document slot', async () => {
    // The corollary of the above, and the reason the refusal works in the Hand's favour rather
    // than against it.
    claimDocumentGesture('brush-stroke', 1);

    const { area } = await mount();
    drag(area, [500, 250], [600, 250]);

    expect(getView().dx).toBe(100);
  });
});
