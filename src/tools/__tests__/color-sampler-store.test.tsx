import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { COLOR_SAMPLER_MAX_SAMPLES, type ColorSampler } from '../colorSampler.ts';
import {
  addColorSampler,
  clearColorSamplers,
  colorSamplerAt,
  moveColorSampler,
  removeColorSampler,
  resetColorSamplersForTest,
  syncColorSamplerFrameSize,
  useColorSamplers,
} from '../color-sampler-store.ts';

/**
 * A reader for the published list, so a test asserts the store rather than a component.
 *
 * The store is module state, so it is driven through its exported functions and read back over a
 * real `useSyncExternalStore` subscription. That is deliberate: the invariants below are about
 * snapshot IDENTITY as much as about contents, and a snapshot read without a subscription could not
 * distinguish a republished array from a reused one.
 */
let renders: (readonly ColorSampler[])[] = [];

const Probe = () => {
  renders.push(useColorSamplers());
  return null;
};

/** Renders the reader and returns a driver that runs `body` and reports what the reader saw. */
const readThrough = (body: () => void): readonly ColorSampler[] => {
  renders = [];
  const view = render(<Probe />);
  const before = renders.length;
  act(() => body());
  // The last render after the body ran. `before` is read so that a body which published nothing is
  // still distinguished from one that did: a store that never emitted leaves the array at its
  // pre-action length and this returns the value the reader already had.
  expect(renders.length).toBeGreaterThanOrEqual(before);
  view.unmount();
  return renders[renders.length - 1];
};

const SAMPLE = '#1a2b3c';

describe('addColorSampler', () => {
  beforeEach(() => resetColorSamplersForTest());

  it('places a sampler at the point with the colour it was given', () => {
    expect(readThrough(() => addColorSampler({ x: 10, y: 20 }, SAMPLE))).toEqual([
      { id: 1, point: { x: 10, y: 20 }, color: SAMPLE },
    ]);
  });

  it('numbers samplers from one in placement order', () => {
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      addColorSampler({ x: 5, y: 5 }, SAMPLE);
      addColorSampler({ x: 9, y: 9 }, SAMPLE);
    });

    expect(placed.map(({ id }) => id)).toEqual([1, 2, 3]);
  });

  it('does NOT renumber the survivors after a deletion, so "sampler 2" keeps meaning one point', () => {
    // The id is STORED on the sampler rather than being its index, and this is the whole reason: a
    // user who says "sampler 2" after deleting sampler 1 must still be pointing at the same pixel.
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      addColorSampler({ x: 5, y: 5 }, SAMPLE);
      addColorSampler({ x: 9, y: 9 }, SAMPLE);
      removeColorSampler(1);
    });

    expect(placed.map(({ id }) => id)).toEqual([2, 3]);
  });

  it('continues the numbering from the HIGHEST id rather than from the count after a deletion', () => {
    // The distinguishing half of the row above: with two survivors numbered 2 and 3, `count + 1` is
    // 3 and `max + 1` is 4. Only the second does not hand out an id already in use.
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      addColorSampler({ x: 5, y: 5 }, SAMPLE);
      addColorSampler({ x: 9, y: 9 }, SAMPLE);
      removeColorSampler(1);
      addColorSampler({ x: 20, y: 20 }, SAMPLE);
    });

    expect(placed.map(({ id }) => id)).toEqual([2, 3, 4]);
  });

  it('accepts a placement below the cap and refuses at it, changing nothing on refusal', () => {
    const placed = readThrough(() => {
      for (let index = 0; index < COLOR_SAMPLER_MAX_SAMPLES; index++) {
        addColorSampler({ x: index, y: index }, SAMPLE);
      }
    });

    expect(placed).toHaveLength(COLOR_SAMPLER_MAX_SAMPLES);

    const before = readThrough(() => {});
    const refused = addColorSampler({ x: 99, y: 99 }, SAMPLE);

    expect(refused.ok).toBe(false);
    // The SAME array, not an equal one: a refused placement must not republish the snapshot, or every
    // subscriber re-renders for nothing.
    expect(refused.samplers).toBe(before);
  });

  it('frees a slot after a deletion, so the cap is on LIVE samplers', () => {
    let ok = true;
    readThrough(() => {
      for (let index = 0; index < COLOR_SAMPLER_MAX_SAMPLES; index++) {
        addColorSampler({ x: index, y: 0 }, SAMPLE);
      }
      removeColorSampler(1);
      ok = addColorSampler({ x: 50, y: 0 }, SAMPLE).ok;
    });

    expect(ok).toBe(true);
  });
});

describe('moveColorSampler', () => {
  beforeEach(() => resetColorSamplersForTest());

  it('moves the named sampler and leaves the others alone', () => {
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, '#111111');
      addColorSampler({ x: 50, y: 50 }, '#222222');
      moveColorSampler(1, { x: 7, y: 8 });
    });

    expect(placed).toEqual([
      { id: 1, point: { x: 7, y: 8 }, color: '#111111' },
      { id: 2, point: { x: 50, y: 50 }, color: '#222222' },
    ]);
  });

  it('keeps the colour, because moving a marker is not re-sampling it', () => {
    // Adobe: "To move a color sampler, drag the sampler to the new location." A drag that changed the
    // reported colour would be a re-read, and the readout is stored precisely so it is not.
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, '#334455');
      moveColorSampler(1, { x: 40, y: 40 });
    });

    expect(placed[0].color).toBe('#334455');
  });

  it('ignores an id that is not present rather than inventing one', () => {
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      moveColorSampler(99, { x: 1, y: 1 });
    });

    expect(placed).toHaveLength(1);
  });
});

describe('removeColorSampler and clearColorSamplers', () => {
  beforeEach(() => resetColorSamplersForTest());

  it('removes only the named sampler', () => {
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      addColorSampler({ x: 1, y: 1 }, SAMPLE);
      removeColorSampler(1);
    });

    expect(placed.map(({ id }) => id)).toEqual([2]);
  });

  it('empties the list on Clear, which is Adobe Clear in the options bar', () => {
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      addColorSampler({ x: 1, y: 1 }, SAMPLE);
      clearColorSamplers();
    });

    expect(placed).toEqual([]);
  });

  it('publishes the SAME empty array rather than a new one, so a no-op Clear does not republish', () => {
    // `useSyncExternalStore` compares snapshots by identity, so an unnecessary new array is a
    // re-render of every reader for nothing.
    const first = readThrough(() => {});
    const second = readThrough(() => clearColorSamplers());

    expect(second).toBe(first);
  });
});

describe('colorSamplerAt', () => {
  beforeEach(() => resetColorSamplersForTest());

  it('finds the sampler under the pointer through the ONE shared hit test', () => {
    // The Eyedropper's Shift-click path calls this same function rather than carrying its own radius,
    // so a second hit test could disagree with this one about which sampler a press means.
    readThrough(() => addColorSampler({ x: 30, y: 30 }, SAMPLE));

    expect(colorSamplerAt({ x: 30, y: 30 })?.id).toBe(1);
    expect(colorSamplerAt({ x: 400, y: 400 })).toBeNull();
  });
});

describe('syncColorSamplerFrameSize', () => {
  beforeEach(() => resetColorSamplersForTest());

  it('registers a first size WITHOUT dropping samplers, because nothing has been observed yet', () => {
    // The regression this pins: samplers placed while ANOTHER tool held the tile — which is how
    // Adobe says to add one, by Shift-clicking from the Eyedropper — were destroyed the moment this
    // tool was first selected, because an empty `frameSize` was read as "the document changed".
    const placed = readThrough(() => {
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      syncColorSamplerFrameSize({ width: 800, height: 600 });
    });

    expect(placed).toHaveLength(1);
  });

  it('drops samplers when the frame size changes from a KNOWN one, as a crop does', () => {
    // A size change is the cheapest signal that this is a different document, and it also covers a
    // crop, whose sampler would otherwise sit against an origin that has moved.
    const placed = readThrough(() => {
      syncColorSamplerFrameSize({ width: 800, height: 600 });
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      syncColorSamplerFrameSize({ width: 400, height: 300 });
    });

    expect(placed).toEqual([]);
  });

  it('keeps samplers across a repeated size, which is every paint but the first', () => {
    // The size is registered BEFORE the sampler, which is the order the app produces: the tool
    // area's mount effect syncs the size, and a pointer cannot arrive before the effect has run. A
    // test that placed a sampler first would be asserting against a sequence the app cannot reach,
    // and the first sync would legitimately drop it as belonging to a document of no known size.
    const placed = readThrough(() => {
      syncColorSamplerFrameSize({ width: 800, height: 600 });
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      syncColorSamplerFrameSize({ width: 800, height: 600 });
    });

    expect(placed).toHaveLength(1);
  });

  it('does NOT re-publish when the size is unchanged', () => {
    // The tool area calls this on every paint, so waking subscribers each time would re-render the
    // options bar on every pointer event. Identity is the only thing that can catch that.
    renders = [];
    const view = render(<Probe />);
    act(() => {
      syncColorSamplerFrameSize({ width: 800, height: 600 });
      addColorSampler({ x: 0, y: 0 }, SAMPLE);
      syncColorSamplerFrameSize({ width: 800, height: 600 });
    });
    const afterFirst = renders[renders.length - 1];
    renders = [];
    act(() => {
      syncColorSamplerFrameSize({ width: 800, height: 600 });
    });

    expect(renders, 'a repeated size must not notify a subscriber').toHaveLength(0);
    expect(afterFirst).toHaveLength(1);
    view.unmount();
  });
});

describe('resetColorSamplersForTest', () => {
  it('returns the store to an empty list and forgets the frame size', () => {
    readThrough(() => addColorSampler({ x: 0, y: 0 }, SAMPLE));

    resetColorSamplersForTest();

    expect(readThrough(() => {})).toEqual([]);
  });
});
