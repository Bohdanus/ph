import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Eyedropper from '../Eyedropper.tsx';
import { isLightColor } from '../../../../util/color.ts';
import { defaultSettings } from '../../../../tools/settings.ts';

/**
 * The store's foreground colour is the ONE field this bar reads, and it is the value the tool
 * writes, so a swatch that disagreed with it would be a lie about what the tool did.
 */
const storeState = vi.hoisted(() => ({ color: '#000000' }));

// `useStore` is mocked directly rather than through `StoreProvider`, which is the house
// pattern for every `ToolbarsRight` suite: the provider pulls in the durable
// replay/materialization path, which does not survive jsdom.
vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

function resetState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, { color: '#000000', ...overrides });
}

/** The one swatch box, addressed by the contrast wrapper that holds it. */
const swatch = () => {
  const wrapper = document.querySelector('div.chessboard-dark, div.chessboard-light');
  return wrapper?.firstElementChild as HTMLElement | null;
};

describe('Eyedropper toolbar', () => {
  beforeEach(() => {
    resetState();
  });

  afterEach(() => {
    // Restored in BOTH halves so a test that left a colour in the hoisted store cannot leak
    // it into the next one's `structuredClone`/expectation source.
    resetState();
  });

  it('renders no editable control at all, because the args type has nowhere to put one', () => {
    render(<Eyedropper />);

    // `EyedropperToolArgs` is `{ toolName: 'eyedropper' }` and nothing else, because the tool
    // is `commit: 'unimplemented'` and every such tool reduces to exactly its tool name. A
    // control here would write through `saveLastSettings` into a value no field can hold, so
    // it would not survive a tool switch — a switch that reads as set and does nothing is
    // strictly worse than no switch.
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('input')).toHaveLength(0);
    expect(document.querySelectorAll('select')).toHaveLength(0);
  });

  it('names the two Photoshop controls it is missing rather than faking them', () => {
    render(<Eyedropper />);

    // Sample Size needs a persisted field AND an average over an 11x11 neighbourhood; Sample
    // All Layers needs a persisted field AND a second code path that samples the composited
    // document. Either one is an args field first and a bar control second.
    expect(
      screen.getByText('No options in this build: Sample Size and Sample All Layers are not implemented.')
    ).toBeInTheDocument();
  });

  it('explains how the tool is used, because a bar with no controls still has to say something', () => {
    render(<Eyedropper />);

    expect(screen.getByText('Click the canvas to sample a colour onto the foreground swatch.')).toBeInTheDocument();
  });

  it('reads the store foreground colour rather than any tool args', () => {
    resetState({ color: '#ff0000' });
    render(<Eyedropper />);

    // The store is the same field `e2e/helpers/color-helpers.ts` writes through
    // `[data-testid="foreground-color-input"]` and the same one a sample writes through
    // `SET_COLOR`, so the readout here is the value the tool will actually set.
    expect(screen.getByText('Foreground')).toBeInTheDocument();
    expect(screen.getByText('#ff0000')).toBeInTheDocument();
    expect(swatch()).toHaveStyle({ backgroundColor: '#ff0000' });
  });

  it('paints the swatch from the store colour on every render', () => {
    const { rerender } = render(<Eyedropper />);
    expect(swatch()).toHaveStyle({ backgroundColor: '#000000' });

    resetState({ color: '#0000ff' });
    rerender(<Eyedropper />);

    expect(swatch()).toHaveStyle({ backgroundColor: '#0000ff' });
    expect(screen.getByText('#0000ff')).toBeInTheDocument();
  });

  it.each([
    ['#000000', false, 'chessboard-light'],
    // 0.299*128 + 0.587*128 + 0.114*128 is exactly 128, and the threshold is a strict `> 128`,
    // so the exact midpoint counts as DARK. Pinned because the boundary is the one value a
    // mid-grey swatch lands on and the class is what the assertion turns on.
    ['#808080', false, 'chessboard-light'],
    ['#c0c0c0', true, 'chessboard-dark'],
    ['#ffffff', true, 'chessboard-dark'],
  ])('swaps the contrast backdrop for %s so the swatch stays visible', (color, light, expectedClass) => {
    // `isLightColor` is a relative-luminance test at 128, and the bar INVERTS it: a light
    // swatch needs a dark backdrop and a dark swatch a light one. A near-white swatch on a
    // light backdrop is a swatch nobody can read.
    resetState({ color });
    render(<Eyedropper />);

    expect(isLightColor(color), color).toBe(light);
    expect(swatch()?.parentElement).toHaveClass(expectedClass);
  });

  it('carries no data-testid, so the e2e colour helper cannot match the wrong swatch', () => {
    render(<Eyedropper />);

    // Those ids belong to the SidebarLeft swatch that `color-helpers.ts` targets, and
    // duplicating one would make its `querySelector` match whichever came first in the DOM.
    expect(document.querySelectorAll('[data-testid]')).toHaveLength(0);
  });

  it('reads nothing from the tool args, so the seeded bare args are enough to render it', () => {
    // The whole point of the honesty constraint: the bar has no `useCurrentTool` dependency at
    // all, so there is no args object it could render under a different tool's name.
    expect(Object.keys(defaultSettings.eyedropper)).toEqual(['toolName']);
    expect(defaultSettings.eyedropper.toolName).toBe('eyedropper');
  });
});
