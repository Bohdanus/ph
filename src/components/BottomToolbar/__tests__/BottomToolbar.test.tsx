import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BottomToolbar from '../BottomToolbar.tsx';

describe('BottomToolbar', () => {
  it('renders all three toolbar buttons', () => {
    render(<BottomToolbar />);

    expect(screen.getByRole('button', { name: 'Todo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toolbar' })).toBeInTheDocument();
  });

  it('renders exactly three buttons and no others', () => {
    render(<BottomToolbar />);

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('exposes each button via its data-testid', () => {
    render(<BottomToolbar />);

    expect(screen.getByTestId('bottom-toolbar-todo-button')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-toolbar-mobile-button')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-toolbar-toolbar-button')).toBeInTheDocument();
  });

  it('does not render a button for an unknown action', () => {
    render(<BottomToolbar />);

    expect(screen.queryByRole('button', { name: 'Foo' })).toBeNull();
  });

  it('exposes a semantic mobile toolbar container for assistive tech', () => {
    render(<BottomToolbar />);

    const toolbar = screen.getByRole('toolbar', { name: /mobile toolbar/i });
    expect(toolbar).toBeInTheDocument();
    expect(screen.getAllByRole('button', { hidden: true })).toHaveLength(3);
  });
});
