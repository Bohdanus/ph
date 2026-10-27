import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RotateViewToolArea } from '../RotateViewToolArea.tsx';
import { getView, resetViewForTest, setFitMetrics, setRotation } from '../../../hooks/document-view.ts';
import { claimDocumentGesture, resetDocumentGestures } from '../../../hooks/document-gesture.ts';
import { defaultSettings } from '../../../tools/settings.ts';
import type { ToolArgs } from '../../../contexts/tool-types.ts';

/**
 * The rotate drag.
 *
 * `document-view` is NOT mocked: the assertions are about the angle the store ends up holding,
 * and a mocked store would assert this test's own idea of rotating. `usePointerPosition` IS
 * mocked, because its job here is capture validity and first-pointer-wins, which it is exercised
 * on directly in `usePointerPosition.test.ts`.
 */

const toolArgs = vi.hoisted(() => ({ current: { toolName: 'rotate-view' } as ToolArgs }));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({ toolArgs: toolArgs.current }),
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      containerRef: { current: null },
      totalSize: { width: 1000, height: 1000 },
    },
  ],
}));

vi.mock('../../../hooks/usePointerPosition.ts', () => ({
  usePointerPosition: () => {
    // Modelled as a GESTURE rather than three independent booleans, because this tool is dragged
    // more than once in a test and a mock whose `down` is consumed for the lifetime of the render
    // would refuse the second drag — which reads as "the tool only works once" rather than as a
    // broken mock. The real hook re-arms on the up, and so does this one.
    let inGesture = false;

    return {
      isPointerDownValid: () => {
        if (inGesture) return false;
        inGesture = true;
        return true;
      },
      isPointerMoveValid: () => inGesture,
      isPointerUpValid: () => {
        const was = inGesture;
        inGesture = false;
        return was;
      },
      releasePointer: () => {
        inGesture = false;
      },
    };
  },
}));

/** 200x200 of container, so `getBoundingClientRect` gives the drag real coordinates to work in. */
const BOX = { x: 0, y: 0, width: 200, height: 200 };

vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
  () => ({ ...BOX, top: 0, left: 0, right: 200, bottom: 200, toJSON: () => ({}) }) as DOMRect
);

const centre = { x: 100, y: 100 };

/** A client point at `degrees` clockwise from east, `radius` px out from the centre. */
const atAngle = (degrees: number, radius = 60) => {
  const radians = (degrees * Math.PI) / 180;
  return { x: centre.x + Math.cos(radians) * radius, y: centre.y + Math.sin(radians) * radius };
};

const pointerEvent = (type: string, clientX: number, clientY: number, shiftKey = false) =>
  new PointerEvent(type, {
    clientX,
    clientY,
    shiftKey,
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    button: 0,
  });

const mount = async () => {
  const { render } = await import('@testing-library/react');
  const utils = render(<RotateViewToolArea className="probe" />);
  return { area: utils.container.querySelector('.probe') as HTMLElement, unmount: utils.unmount };
};

/** Down at `from`, move to `to`, up. The angle is what `to - from` turns through. */
const turn = (area: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, shift = false) => {
  area.dispatchEvent(pointerEvent('pointerdown', from.x, from.y, shift));
  area.dispatchEvent(pointerEvent('pointermove', to.x, to.y, shift));
  area.dispatchEvent(pointerEvent('pointerup', to.x, to.y, shift));
};

beforeEach(() => {
  resetDocumentGestures();
  resetViewForTest();
  setFitMetrics({
    fitScale: 1,
    offsetX: 0,
    offsetY: 0,
    containerWidth: 200,
    containerHeight: 200,
    imageWidth: 1000,
    imageHeight: 1000,
  });
  toolArgs.current = { ...defaultSettings['rotate-view'] };
});

afterEach(() => {
  resetViewForTest();
  resetDocumentGestures();
});

describe('Rotate View turns the view', () => {
  it('applies the change in the pointer angle, as a delta from where the drag began', async () => {
    const { area } = await mount();

    // From due east to due south is a quarter turn, so the drag applies +90.
    turn(area, atAngle(0), atAngle(90));

    expect(getView().rotation).toBeCloseTo(90, 6);
  });

  it('turns clockwise, which is the direction CSS rotate() turns', async () => {
    const { area } = await mount();

    // East to SOUTH is +90 in a screen coordinate system. A sign flip would land on -90 here and
    // is not detectable by the delta test above, which is symmetric in the sign.
    turn(area, atAngle(0), atAngle(90));

    expect(getView().rotation).toBeGreaterThan(0);
  });

  it('is RELATIVE, so a view that is already tilted tilts further rather than jumping', async () => {
    // The reason the drag is not `rotation = atan2(pointer - centre)`: an absolute one would snap
    // the view to point at the cursor the instant the drag starts, discarding whatever angle was
    // already showing — whether from a previous drag, the `Shift` snap, or the typed field.
    setRotation(40);
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(30));

    expect(getView().rotation).toBeCloseTo(70, 6);
  });

  it('continues a second drag from where the first left off', async () => {
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(30));
    expect(getView().rotation).toBeCloseTo(30, 6);

    turn(area, atAngle(90), atAngle(150));

    expect(getView().rotation).toBeCloseTo(90, 6);
  });

  it('leaves the angle standing when the button comes up', async () => {
    // Adobe's contract: the tool changes the angle at which the canvas is VIEWED, and the release
    // commits that view rather than dropping it.
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(45));

    expect(getView().rotation).toBeCloseTo(45, 6);
  });

  it('does nothing on a move that never saw a down', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointermove', 160, 160));

    expect(getView().rotation).toBe(0);
  });

  it('does not turn the document, the pan or the zoom', async () => {
    // Adobe: it "does not rotate or transform the actual image". This is the unit-level half of
    // that claim; the export comparison in `e2e/hand-tool.spec.ts` is the other half.
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(90));

    expect(getView()).toEqual({ dx: 0, dy: 0, zoom: 1, rotation: expect.any(Number) });
  });

  it('snaps to 15° while Shift is held, and to nothing when it is not', async () => {
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(37), true);
    // 37 is nearer 30 than 45, so this also pins which side the tie breaks on.
    expect(getView().rotation).toBe(30);

    // Back to upright first, because the drag is RELATIVE: without this the second turn would
    // compound onto the 30 above and land on 67, which is correct behaviour and the wrong thing to
    // assert here — this case is about the Shift flag, not about relativity.
    setRotation(0);
    turn(area, atAngle(0), atAngle(37), false);
    expect(getView().rotation).toBeCloseTo(37, 6);
  });

  it('reads Shift per move, so it can be pressed and released mid-drag', async () => {
    const { area } = await mount();

    area.dispatchEvent(pointerEvent('pointerdown', atAngle(0).x, atAngle(0).y));
    area.dispatchEvent(pointerEvent('pointermove', atAngle(37).x, atAngle(37).y, true));
    expect(getView().rotation).toBe(30);

    // Same drag, Shift now released: the delta is measured from the DOWN's angle, so the angle
    // continues from where the snapped one left it rather than snapping again from zero.
    area.dispatchEvent(pointerEvent('pointermove', atAngle(53).x, atAngle(53).y, false));
    expect(getView().rotation).toBeCloseTo(53, 6);
  });

  it('is inert when another tool owns the arguments', async () => {
    toolArgs.current = { ...defaultSettings.draw };
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(90));

    expect(getView().rotation).toBe(0);
  });
});

describe('Rotate View claims no document gesture', () => {
  it('leaves the document slot free, because it writes no pixel', async () => {
    // Same argument as the Hand: claiming the single committing-drag slot would make the tool
    // refuse its own gesture and break the "one document owner" invariant for no benefit.
    const { area } = await mount();

    turn(area, atAngle(0), atAngle(90));

    expect(claimDocumentGesture('brush-stroke', 1)).toBe(true);
  });

  it('still turns while another tool holds the document slot', async () => {
    claimDocumentGesture('brush-stroke', 1);

    const { area } = await mount();
    turn(area, atAngle(0), atAngle(90));

    expect(getView().rotation).toBeCloseTo(90, 6);
  });
});
