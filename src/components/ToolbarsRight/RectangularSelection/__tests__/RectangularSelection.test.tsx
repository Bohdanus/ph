import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { Selection } from '../../../../contexts/general-types.ts';
import RectangularSelection from '../RectangularSelection.tsx';

const dispatchMock = vi.hoisted(() => vi.fn());
const sourceCanvas = vi.hoisted(() => document.createElement('canvas'));
const copyActiveSelectionMock = vi.hoisted(() => vi.fn());
const pasteSelectionClipboardMock = vi.hoisted(() => vi.fn());
const hasSelectionClipboard = vi.hoisted(() => ({ current: true }));

const storeState = vi.hoisted((): { selections: Selection[]; activeSelectionId: string | null } => ({
  selections: [],
  activeSelectionId: null,
}));

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: sourceCanvas },
      totalSize: { width: 800, height: 600 },
      selections: storeState.selections,
      activeSelectionId: storeState.activeSelectionId,
    },
    dispatchMock,
  ],
}));

vi.mock('../../../../contexts/useSelectionClipboard.ts', () => ({
  useSelectionClipboard: () => ({
    copyActiveSelection: copyActiveSelectionMock,
    hasSelectionClipboard: hasSelectionClipboard.current,
    pasteSelectionClipboard: pasteSelectionClipboardMock,
  }),
}));

function resetStoreState(overrides: Partial<typeof storeState> = {}) {
  Object.assign(storeState, {
    selections: [],
    activeSelectionId: null,
    ...overrides,
  });
}

describe('RectangularSelection toolbar', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    copyActiveSelectionMock.mockClear();
    pasteSelectionClipboardMock.mockClear();
    hasSelectionClipboard.current = true;
    storeState.activeSelectionId = 'selection-1';
    storeState.selections = [
      {
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
      },
    ];
  });

  it('copies the active committed rectangular selection from store state', async () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => {
      expect(copyActiveSelectionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'selection-1',
          geometry: 'rectangle',
        })
      );
    });
  });

  it('pastes the in-app copied selection as a new layer', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Paste' }));

    expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
  });

  it('clears committed selections through the explicit selection clear action', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
  });

  it('disables Copy when no active selection', () => {
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
  });

  it('disables Paste when clipboard is empty', () => {
    hasSelectionClipboard.current = false;
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
  });

  it('enables Paste when clipboard has data', () => {
    hasSelectionClipboard.current = true;
    render(<RectangularSelection />);

    expect(screen.getByRole('button', { name: 'Paste' })).not.toBeDisabled();
  });

  it('does not call copyActiveSelection when no active selection', () => {
    resetStoreState({ activeSelectionId: null, selections: [] });
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(copyActiveSelectionMock).not.toHaveBeenCalled();
  });

  it('dispatches CLEAR_SELECTIONS when Clear clicked', () => {
    render(<RectangularSelection />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
  });

  describe('keyboard navigation', () => {
    it('allows tab navigation through all focusable elements', async () => {
      const user = userEvent.setup();
      render(<RectangularSelection />);

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      copyButton.focus();
      expect(copyButton).toHaveFocus();

      await user.tab();
      expect(pasteButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);

      await user.tab({ shift: true });
      expect(clearButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(pasteButton).toHaveFocus();

      await user.tab({ shift: true });
      expect(copyButton).toHaveFocus();
    });

    it('allows enter/space to trigger copy, paste, and clear buttons', async () => {
      const user = userEvent.setup();
      render(<RectangularSelection />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      copyButton.focus();
      expect(copyButton).toHaveFocus();
      await user.keyboard('{Enter}');

      pasteButton.focus();
      expect(pasteButton).toHaveFocus();
      await user.keyboard(' ');

      clearButton.focus();
      expect(clearButton).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(copyActiveSelectionMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'selection-1' }));
      expect(pasteSelectionClipboardMock).toHaveBeenCalledTimes(1);
      expect(dispatchMock).toHaveBeenCalledWith({ type: 'CLEAR_SELECTIONS' });
    });

    it('escape key does not close anything (no popovers)', () => {
      render(<RectangularSelection />);
      const copyButton = screen.getByRole('button', { name: 'Copy' });

      copyButton.focus();
      fireEvent.keyDown(copyButton, { key: 'Escape' });
      expect(copyButton).toHaveFocus();
    });

    it('disabled buttons are not focusable via tab when disabled', async () => {
      hasSelectionClipboard.current = false;
      const user = userEvent.setup();
      render(<RectangularSelection />);

      const copyButton = screen.getByRole('button', { name: 'Copy' });
      const pasteButton = screen.getByRole('button', { name: 'Paste' });
      const clearButton = screen.getByRole('button', { name: 'Clear' });

      expect(copyButton).not.toBeDisabled();
      expect(clearButton).not.toBeDisabled();
      expect(pasteButton).toBeDisabled();

      pasteButton.focus();
      expect(pasteButton).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);

      copyButton.focus();
      expect(copyButton).toHaveFocus();

      await user.tab();
      expect(clearButton).toHaveFocus();

      await user.tab();
      expect(document.activeElement).toBe(document.body);

      await user.tab({ shift: true });
      expect(clearButton).toHaveFocus();

      cleanup();
      hasSelectionClipboard.current = false;
      resetStoreState({ activeSelectionId: null, selections: [] });
      render(<RectangularSelection />);

      expect(screen.getByRole('button', { name: 'Copy' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Paste' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

      await user.tab();
      expect(document.activeElement).toBe(document.body);
    });
  });
});
