import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolName } from '../../../contexts/tool-types.ts';
import { toolTooltips } from '../../../tools/descriptions/tooltips.ts';
import ToolTooltip from '../ToolTooltip.tsx';

describe('ToolTooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
