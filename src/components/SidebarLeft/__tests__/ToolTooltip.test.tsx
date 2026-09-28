import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ToolTooltip from '../ToolTooltip.tsx';

describe('ToolTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const renderWithTooltip = (label = 'Test Tool', shortcut?: string) => {
    const TestComponent = () => (
      <ToolTooltip label={label} shortcut={shortcut}>
        <button data-testid="trigger">Trigger</button>
      </ToolTooltip>
    );
    return render(<TestComponent />);
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
});
