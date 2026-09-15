import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StoreProvider, useStore } from '../StoreContext.tsx';
import type { Selection } from '../general-types.ts';

const rectangularSelection: Selection = {
  id: 'selection-1',
  geometry: 'rectangle',
  sourceTool: 'rectangular-selection',
  lifecycle: 'committed',
  isActive: true,
  pos: { x: 10, y: 20, width: 30, height: 40 },
  points: [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 40 },
    { x: 0, y: 40 },
  ],
};

const StoreProbe = () => {
  const [{ selections, activeSelectionId, toolName }, dispatch] = useStore();

  return (
    <div>
      <div data-testid="selection-state">{`${selections.length}:${activeSelectionId ?? 'none'}`}</div>
      <div data-testid="tool-name">{toolName}</div>
      <button onClick={() => dispatch({ type: 'COMMIT_SELECTION', payload: rectangularSelection })}>Commit</button>
      <button onClick={() => dispatch({ type: 'SET_TOOL_NAME', payload: 'draw' })}>Switch tool</button>
      <button onClick={() => dispatch({ type: 'CLEAR_SELECTIONS' })}>Clear</button>
    </div>
  );
};

function renderStoreProbe() {
  render(
    <StoreProvider>
      <StoreProbe />
    </StoreProvider>
  );
}

describe('StoreContext selection lifecycle', () => {
  it('clears committed selections and the active selection id only through the clear action', () => {
    renderStoreProbe();

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    expect(screen.getByTestId('selection-state').textContent).toBe('1:selection-1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.getByTestId('selection-state').textContent).toBe('0:none');
  });

  it('keeps committed selections when switching tools', () => {
    renderStoreProbe();

    fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Switch tool' }));

    expect(screen.getByTestId('tool-name').textContent).toBe('draw');
    expect(screen.getByTestId('selection-state').textContent).toBe('1:selection-1');
  });
});
