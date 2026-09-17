import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Main from '../Main.tsx';
import { useStore } from '../../../contexts/StoreContext.tsx';
import { useApp } from '../../../hooks/useApp.ts';
import { useFile } from '../../../contexts/useFile.tsx';
import { useLayers } from '../../../contexts/useLayer.ts';
import { useTheme } from '../../../contexts/ThemeContext.tsx';

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [
    {
      canvasRef: { current: null },
      containerRef: { current: null },
      toolOverlayRef: { current: null },
      rectOverlayRef: { current: null },
      hasImage: false,
      hasUnsavedChanges: false,
      currentArgs: { current: null },
      layers: {},
      toolName: 'zoom',
      totalSize: { width: 800, height: 600 },
    },
  ],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({
    setBlankImage: vi.fn(),
    setImageFromUpload: vi.fn(),
  }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({
    openLoadImageDialog: vi.fn(),
    openNewImageDialog: vi.fn(),
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    drawAllLayers: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => [{ theme: 'light' }],
}));

describe('Main', () => {
  it('renders Open File and blank image buttons when no image is loaded', () => {
    render(<Main />);

    expect(screen.getByRole('button', { name: 'Open File' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'blank image' })).toBeTruthy();
  });

  it('renders testid buttons when no image is loaded', () => {
    render(<Main />);

    expect(screen.getByTestId('main-open-file-button')).toBeTruthy();
    expect(screen.getByTestId('main-blank-image-button')).toBeTruthy();
  });
});
