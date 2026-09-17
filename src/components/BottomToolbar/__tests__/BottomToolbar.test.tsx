import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BottomToolbar from '../BottomToolbar.tsx';

describe('BottomToolbar', () => {
  it('renders all three toolbar buttons', () => {
    render(<BottomToolbar />);

    expect(screen.getByRole('button', { name: 'Todo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mobile' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Toolbar' })).toBeTruthy();
  });
});
