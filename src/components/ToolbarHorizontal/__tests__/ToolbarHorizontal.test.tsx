import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ToolbarHorizontal from '../ToolbarHorizontal.tsx';

const storeState = vi.hoisted(() => ({ hasImage: true, toolName: 'draw' as string }));
const dispatch = vi.hoisted(() => vi.fn());

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, dispatch],
}));

vi.mock('../../../tools/toolsMap.ts', () => {
  const Toolbox = () => <div data-testid="toolbox">toolbar</div>;
  return {
    toolsMap: {
      draw: {
        toolboxComponent: Toolbox,
      },
    },
  };
});

beforeEach(() => {
  storeState.hasImage = true;
  storeState.toolName = 'draw';
});

describe('ToolbarHorizontal', () => {
  it('renders the tool toolbox component when image is loaded', () => {
    storeState.hasImage = true;
    storeState.toolName = 'draw';
    render(<ToolbarHorizontal />);

    expect(screen.getByTestId('toolbox')).toBeInTheDocument();
  });

  it('does not render the toolbox when there is no image', () => {
    storeState.hasImage = false;
    storeState.toolName = 'draw';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('does not render the toolbox when toolName is empty', () => {
    storeState.hasImage = true;
    storeState.toolName = '';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('does not render the toolbox when there is neither an image nor a tool', () => {
    storeState.hasImage = false;
    storeState.toolName = '';
    render(<ToolbarHorizontal />);

    expect(screen.queryByTestId('toolbox')).toBeNull();
    expect(screen.queryByText('TODO: unregistered tool placeholder')).toBeNull();
  });

  it('renders a placeholder instead of crashing for a tool that is not registered in the map', () => {
    storeState.hasImage = true;
    storeState.toolName = 'crop';
    render(<ToolbarHorizontal />);

    expect(screen.getByText('TODO: unregistered tool placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('keeps the placeholder and the toolbox mutually exclusive when the tool changes back', () => {
    const { rerender } = render(<ToolbarHorizontal />);
    storeState.toolName = 'draw';
    rerender(<ToolbarHorizontal />);
    expect(screen.getByTestId('toolbox')).toBeInTheDocument();

    storeState.toolName = 'magic-wand';
    rerender(<ToolbarHorizontal />);
    expect(screen.getByText('TODO: unregistered tool placeholder')).toBeInTheDocument();
    expect(screen.queryByTestId('toolbox')).toBeNull();
  });

  it('renders an empty toolbar bar without placeholder copy when the image is missing', () => {
    storeState.hasImage = false;
    storeState.toolName = 'draw';
    const { container } = render(<ToolbarHorizontal />);

    expect(container.firstElementChild).toBeEmptyDOMElement();
    expect(container).toHaveTextContent('');
  });
});

/**
 * The toolbar's overflow is a desktop-correctness property, not a style preference.
 *
 * Tool option panels render popovers that must escape this 50px box. The text tool's font
 * list is the live one: anchored `absolute` inside a toolbar that clips, it renders as an
 * 8px sliver with none of the fourteen fonts visible or clickable. A one-class change to
 * `overflow-visible` cost the text tool its font family entirely, and nothing in the suite
 * could see it — jsdom has no layout engine, and no e2e spec opened the dropdown.
 */
describe('ToolbarHorizontal overflow', () => {
  const toolbar = (container: HTMLElement) => container.firstElementChild as HTMLElement;

  beforeEach(() => {
    storeState.hasImage = true;
    storeState.toolName = 'draw';
  });

  it('stays overflow-visible on desktop, so tool popovers can escape the 50px box', () => {
    const { container } = render(<ToolbarHorizontal />);

    const bar = toolbar(container);
    expect(bar).toHaveClass('overflow-visible');
    // Nothing in the desktop class list may create a scroll container, because a scroll
    // container in either axis clips the popup that `overflow-visible` exists to protect.
    expect(bar).not.toHaveClass('overflow-x-auto');
    expect(bar).not.toHaveClass('overflow-y-hidden');
    expect(bar).not.toHaveClass('overflow-hidden');
  });

  it('adds horizontal scrolling only in the tablet band, where panels are wider than the window', () => {
    const { container } = render(<ToolbarHorizontal />);

    // The widest panel (Transform: six action buttons and seven sliders) is ~1036px. It does
    // not fit in 768–1023px, and its Apply/Clear controls at the far end are otherwise
    // unreachable. `max-lg:` scopes the scroll to that band and leaves desktop untouched.
    expect(toolbar(container)).toHaveClass('max-lg:overflow-x-auto');
  });

  it('keeps the tool panel unshrunk inside the scroll container', () => {
    render(<ToolbarHorizontal />);

    // Without this the panel would be compressed to the toolbar's width instead of
    // overflowing it, and the scroll container would have nothing to scroll.
    const panel = screen.getByTestId('toolbox').parentElement as HTMLElement;
    expect(panel).toHaveClass('min-w-fit');
    expect(panel).toHaveClass('max-lg:min-w-max');
  });

  it('keeps every render branch consistent where it matters', () => {
    // Three different returns: the real panel, the unregistered-tool placeholder, and the
    // empty bar. The first two must both stay `overflow-visible` on desktop, so that a fix
    // to the panel branch cannot leave the placeholder branch clipping a popup instead.
    const withPanel = render(<ToolbarHorizontal />);
    expect(toolbar(withPanel.container)).toHaveClass('overflow-visible');
    expect(toolbar(withPanel.container)).toHaveClass('max-lg:overflow-x-auto');
    withPanel.unmount();

    storeState.toolName = 'crop'; // absent from the mocked toolsMap -> placeholder branch
    const placeholder = render(<ToolbarHorizontal />);
    expect(toolbar(placeholder.container)).toHaveClass('overflow-visible');
    placeholder.unmount();

    storeState.hasImage = false; // empty-bar branch: no content, so no overflow rule at all
    const empty = render(<ToolbarHorizontal />);
    expect(toolbar(empty.container)).not.toHaveClass('overflow-visible');
    expect(toolbar(empty.container)).not.toHaveClass('max-lg:overflow-x-auto');
  });
});
