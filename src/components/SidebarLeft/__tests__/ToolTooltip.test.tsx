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
    expect(tooltip).toHaveClass('z-50');
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
    expect(trigger.contains(tooltip)).toBe(false);
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
