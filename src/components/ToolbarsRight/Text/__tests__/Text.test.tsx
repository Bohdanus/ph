import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider } from '../../../../hooks/useKeyboardEvents.tsx';
import Text from '../Text.tsx';
import { useStore } from '../../../../contexts/StoreContext.tsx';
import { useLayers } from '../../../../contexts/useLayer.ts';
import { useCurrentTool } from '../../../../contexts/useCurrentTool.tsx';

const mockCreateLayerFromTool = vi.fn();

const storeState = {
  canvasRef: { current: null },
  color: '#000000',
  currentArgs: { current: null },
  textareaRef: { current: null },
  totalSize: { width: 800, height: 600 },
};

const toolArgs = {
  toolName: 'text',
  text: 'Hello',
  fontSize: 64,
  lineHeight: 1.1,
  rect: { x: 0, y: 0, width: 100, height: 50 },
  bold: false,
  italic: false,
  fontFamily: 'Arial',
  align: 'left',
};

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    createLayerFromTool: mockCreateLayerFromTool,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: vi.fn(),
  }),
}));

const renderWithProvider = (ui: React.ReactElement) => {
  return render(<KeyboardEventsProvider>{ui}</KeyboardEventsProvider>);
};

describe('Text toolbar', () => {
  it('renders text input and controls', () => {
    renderWithProvider(<Text />);

    expect(screen.getByLabelText('Text')).toBeTruthy();
    expect(screen.getByLabelText('Font')).toBeTruthy();
    expect(screen.getByLabelText(/Font Size/)).toBeTruthy();
    expect(screen.getByLabelText(/Line Height/)).toBeTruthy();
    expect(screen.getByLabelText('Align')).toBeTruthy();
  });

  it('has Apply and Clear buttons', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
  });

  it('has Bold and Italic toggle buttons', () => {
    renderWithProvider(<Text />);

    expect(screen.getByRole('button', { name: 'B' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'I' })).toBeTruthy();
  });
});
