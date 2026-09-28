import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LandingPage } from '../LandingPage.tsx';

describe('LandingPage', () => {
  it('renders the heading and start button', () => {
    render(<LandingPage onStart={() => {}} />);

    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('calls onStart when the start button is clicked', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('exposes the greeting as the only level one heading', () => {
    render(<LandingPage onStart={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Hello' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  });

  it('does not call onStart before the button is activated', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} />);

    expect(onStart).not.toHaveBeenCalled();
  });

  it('calls onStart once per activation', () => {
    const onStart = vi.fn();
    render(<LandingPage onStart={onStart} />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it('keeps the start button as the single interactive control', () => {
    render(<LandingPage onStart={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByTestId('landing-start-button')).toBe(screen.getByRole('button', { name: 'Start' }));
  });

  it('keeps the start button focusable so it can be reached by keyboard', () => {
    render(<LandingPage onStart={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Start' });
    button.focus();

    expect(document.activeElement).toBe(button);
  });
});
