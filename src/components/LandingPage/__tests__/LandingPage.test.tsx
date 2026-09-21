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
});
