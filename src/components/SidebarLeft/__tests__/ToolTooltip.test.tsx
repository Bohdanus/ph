import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolName } from '../../../contexts/tool-types.ts';
import { toolTooltips } from '../../../tools/descriptions/tooltips.ts';
import ToolTooltip from '../ToolTooltip.tsx';

/**
 * jsdom has no layout engine: every `getBoundingClientRect()` is a zeroed box and every
 * `offsetWidth`/`offsetHeight` is 0, so `AnchoredOverlay`'s placement arithmetic is
 * invisible here unless it is fed boxes. The stubs below are the pattern from
 * `AnchoredOverlay.test.tsx`, and the clipping half of the same subject is pinned in a real
 * browser by `e2e/sidebar-flyout.spec.ts`.
 */
type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

/**
 * The size the overlay wrapper reports. jsdom computes 0 for every `offsetWidth` and
 * `offsetHeight`, and the prototype getters hand back this instead; the wrapper is the
 * element `AnchoredOverlay` measures. It defaults to 0 so every other test in this file
 * measures exactly what jsdom would have measured for it.
 */
let measuredSize: Size = { width: 0, height: 0 };

/**
 * A `position: fixed` box is laid out against `documentElement.clientWidth`, not
 * `window.innerWidth`, and jsdom computes neither. `AnchoredOverlay` reads the former, both
 * for its right-edge flip and for the clamp, so a placement asserted without it would be
 * asserting the viewport padding.
 */
const setViewport = (width: number, height: number): void => {
  Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(document.documentElement, 'clientHeight', { configurable: true, value: height });
};

const anchorBox = (element: HTMLElement, box: Box): void => {
  element.getBoundingClientRect = () =>
    ({
      ...box,
      right: box.left + box.width,
      bottom: box.top + box.height,
      x: box.left,
      y: box.top,
      toJSON: () => box,
    }) as DOMRect;
};

describe('ToolTooltip', () => {
  // Installed at file scope rather than inside the placement test, because the getters live
  // on the prototype and a file that installs them mid-run leaves them behind. Nothing else
  // in this file reads an offset, so a 0 here changes nothing for the other tests.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => measuredSize.width,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => measuredSize.height,
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    // Back to what jsdom computes, so a test that sets a size measures the next one's
    // overlay too — in whichever order the file is read.
    measuredSize = { width: 0, height: 0 };
  });

  afterAll(() => {
    // The stubs are on the prototype and would otherwise outlive the file; `isolate: true`
    // is the only reason nothing else has noticed.
    delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
  });

  // `toolName` is a real tool rather than a synthetic key, so the tests below can assert
  // against the same description record the component renders from rather than restating
  // its prose — which would make this a second copy of the data to keep in step.
  const renderWithTooltip = (label = 'Test Tool', shortcut?: string, toolName: ToolName = 'brush') => {
    const TestComponent = () => (
      <ToolTooltip label={label} shortcut={shortcut} toolName={toolName}>
        <button data-testid="trigger">Trigger</button>
      </ToolTooltip>
    );
    return render(<TestComponent />);
  };

  const showTooltip = (toolName: ToolName, label = 'Test Tool', shortcut?: string) => {
    renderWithTooltip(label, shortcut, toolName);
    const trigger = screen.getByTestId('trigger');
    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    return screen.getByRole('tooltip');
  };

  it('renders trigger element', () => {
    renderWithTooltip();
    expect(screen.getByTestId('trigger')).toBeInTheDocument();
  });

  it('does not show tooltip initially', () => {
    renderWithTooltip('Test Tool');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on mouse enter after delay', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Test Tool');
  });

  it('hides tooltip on mouse leave', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      fireEvent.mouseLeave(trigger);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows tooltip on focus', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.focus(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('hides tooltip on blur', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.focus(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    act(() => {
      fireEvent.blur(trigger);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('cancels show timer on quick mouse leave', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      fireEvent.mouseLeave(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('clears timer on unmount', () => {
    const { unmount } = renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows shortcut when provided', () => {
    renderWithTooltip('Test Tool', 'Ctrl+T');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Test Tool');
    expect(tooltip).toHaveTextContent('Ctrl+T');
  });

  it('generates unique tooltip ID based on label', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.id).toBe('tool-tooltip-test-tool');
  });

  it('handles special characters in label for ID', () => {
    renderWithTooltip('Test@Tool!');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.id).toBe('tool-tooltip-test-tool-');
  });

  it('passes aria-describedby to child when visible', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    expect(trigger).not.toHaveAttribute('aria-describedby');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(trigger).toHaveAttribute('aria-describedby', 'tool-tooltip-test-tool');

    act(() => {
      fireEvent.mouseLeave(trigger);
    });
    expect(trigger).not.toHaveAttribute('aria-describedby');
  });

  it('applies correct tooltip styling classes', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveClass('pointer-events-none');
    expect(tooltip).toHaveClass('bg-gray-950');
    expect(tooltip).toHaveClass('text-white');
    expect(tooltip).toHaveClass('rounded-md');
    expect(tooltip).toHaveClass('shadow-lg');

    // `z-50` belongs on the portal wrapper, not on this span. Here it was inert: the span is
    // neither a positioned element nor a flex or grid item, so the class had no stacking
    // context to apply to, and the wrapper sat at `z-index: auto` — ordered among body's
    // children by append time. The absence is the half worth pinning, because nothing else
    // stops the class coming back as decoration. The wrapper's own `z-index: 50` is pinned by
    // the test below, which is where that half belongs; asserting it here too would be a
    // second copy of one fact in two files.
    expect(tooltip).not.toHaveClass('z-50');
  });

  it('escapes its container, because the left rail clips anything positioned outside it', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    const wrapper = tooltip.parentElement as HTMLElement;

    // The rail is `overflow-y-auto`, which makes it clip horizontally as well, so an
    // `absolute` tooltip inside it is laid out but never painted. A fixed-position
    // overlay in `document.body` has no clipping ancestor.
    expect(wrapper.style.position).toBe('fixed');
    expect(wrapper.parentElement).toBe(document.body);
    // The trigger's own wrapper is the anchor, and the tooltip is not inside it. (The
    // trigger alone would be vacuous: pre-fix the tooltip was already a sibling of the
    // button, so `trigger.contains(tooltip)` was false then too.)
    expect(trigger.parentElement?.contains(tooltip)).toBe(false);
  });

  it('positions the wrapper, which is what the stacking and hit-testing rules live on', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const wrapper = screen.getByRole('tooltip').parentElement as HTMLElement;

    // The children used to carry `z-50`, which did nothing once they stopped being
    // positioned elements, and the wrapper used to be a hit target: shrink-wrapped to the
    // tooltip with `pointer-events: auto`, it sat on top of whichever overlay was portalled
    // after it. A right-click opens the flyout before the hover tooltip, so the tooltip's
    // box swallowed clicks meant for the first flyout item.
    expect(wrapper.style.zIndex).toBe('50');
    expect(wrapper.style.pointerEvents).toBe('none');
  });

  /**
   * The placement arithmetic, which nothing here asserted before: the suite pinned
   * `position: fixed`, the portal target, the z-index and the hit-testing rule, and never
   * once read `left` or `top`. That gap is not cosmetic, because the tooltip is configured
   * DIFFERENTLY from the flyout — `align="center"` and `gap={12}` against the flyout's
   * `align="start"` and the default gap of 8 — so the two have genuinely different geometry
   * and the flyout's pinned arithmetic says nothing about this one.
   *
   * A tile box, not the trigger's: the measured element is `ToolTooltip`'s own wrapper span,
   * the one carrying `ref={setAnchor}` and handed to `AnchoredOverlay` as `anchor` (it has to
   * be, because the overlay is this component's child and React attaches a parent's ref after
   * its child's layout effects). The button this test renders is a CHILD of that span, so
   * stubbing the button's box would place the tooltip against a box nothing ever reads.
   */
  it('places itself beside the trigger wrapper, centred on it, at its own gap', () => {
    measuredSize = { width: 220, height: 48 };
    setViewport(1280, 720);
    renderWithTooltip('Brush Tool', 'B', 'brush');

    const trigger = screen.getByTestId('trigger');
    const anchor = trigger.parentElement as HTMLElement;
    anchorBox(anchor, { left: 0, top: 200, width: 56, height: 44 });

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const wrapper = screen.getByRole('tooltip').parentElement as HTMLElement;
    // 56 (the anchor's trailing edge) + 12 (the tooltip's own gap) = 68. The flyout's
    // default gap of 8 against the same anchor would read 64, which is the number an
    // inherited flyout expectation would have produced.
    expect(wrapper.style.left).toBe('68px');
    // 200 + (44 - 48) / 2 = 198, so the tooltip starts two pixels ABOVE the tile's top
    // edge: the label line plus a wrapped summary is taller than a 44px tile, and
    // `align="center"` centres the whole box on the tile. The flyout's `align="start"`
    // would read 200, and a tooltip at 220 x 48 at a 1280 x 720 viewport clamps to neither
    // edge — both are inside the 8px viewport padding's range.
    expect(wrapper.style.top).toBe('198px');
  });

  it('handles missing shortcut gracefully', () => {
    renderWithTooltip('Test Tool');
    const trigger = screen.getByTestId('trigger');

    act(() => {
      fireEvent.mouseEnter(trigger);
    });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Test Tool');
    expect(tooltip.querySelector('kbd')).not.toBeInTheDocument();
  });

  describe('the researched description', () => {
    // Looped over every tool rather than spot-checked, and driven off the same record the
    // component reads. Asserting against a literal summary would make this a second copy of
    // the data, and the copy would go stale the first time a family revised its prose — which
    // is exactly the drift this suite exists to prevent.
    const toolNames = Object.keys(toolTooltips) as ToolName[];

    it('shows the summary belonging to the tool it was given, for every tool', () => {
      const mismatched: string[] = [];

      for (const toolName of toolNames) {
        const { unmount } = renderWithTooltip('Test Tool', undefined, toolName);
        const trigger = screen.getByTestId('trigger');
        act(() => {
          fireEvent.mouseEnter(trigger);
        });
        act(() => {
          vi.advanceTimersByTime(250);
        });

        const text = screen.getByRole('tooltip').textContent ?? '';
        if (!text.includes(toolTooltips[toolName].summary)) mismatched.push(toolName);
        unmount();
      }

      expect(mismatched).toEqual([]);
    });

    it('carries a status line for every tool that is not fully implemented, and none for the rest', () => {
      const wrong: string[] = [];

      for (const toolName of toolNames) {
        const { unmount } = renderWithTooltip('Test Tool', undefined, toolName);
        const trigger = screen.getByTestId('trigger');
        act(() => {
          fireEvent.mouseEnter(trigger);
        });
        act(() => {
          vi.advanceTimersByTime(250);
        });

        const note = screen.getByRole('tooltip').querySelector('[data-testid="tool-tooltip-implementation-note"]');
        const shouldHaveNote = toolTooltips[toolName].implementation !== 'implemented';
        if ((note !== null) !== shouldHaveNote) wrong.push(toolName);
        unmount();
      }

      expect(wrong).toEqual([]);
    });

    // The regression this pins: the tooltip was `whitespace-nowrap` because it held a single
    // word, and adding a summary under that class turns a 160-character sentence into one
    // unbounded line that `AnchoredOverlay` then has to clamp at the viewport edge.
    it('lets the summary wrap instead of pinning the tooltip to one line', () => {
      const tooltip = showTooltip('brush');

      expect(tooltip).not.toHaveClass('whitespace-nowrap');
      expect(tooltip).toHaveClass('max-w-64');
      // The label keeps it: a tool's name is never worth a second line.
      const [heading] = Array.from(tooltip.children);
      expect(heading).toHaveClass('whitespace-nowrap');
    });

    it('keeps the shortcut on the heading line rather than in the description', () => {
      const tooltip = showTooltip('brush', 'Brush Tool', 'B');

      const [heading] = Array.from(tooltip.children);
      expect(heading).toHaveTextContent('Brush Tool');
      expect(heading.querySelector('kbd')).toHaveTextContent('B');
    });
  });
});
