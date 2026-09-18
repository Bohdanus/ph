import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Main from '../Main.tsx';

const setImageFromUpload = vi.fn();
const setBlankImage = vi.fn();
const openLoadImageDialog = vi.fn();
const openNewImageDialog = vi.fn();

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
    setBlankImage,
    setImageFromUpload,
  }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({
    openLoadImageDialog,
    openNewImageDialog,
  }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    drawAllLayers: vi.fn(),
  }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Main', () => {
  beforeEach(() => {
    setBlankImage.mockClear();
    setImageFromUpload.mockClear();
    openLoadImageDialog.mockClear();
    openNewImageDialog.mockClear();
  });

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

  it('opens a dropped image file', async () => {
    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const loadDocumentFile = await import('../../../contexts/image-load-save-utils.ts');
    vi.spyOn(loadDocumentFile, 'loadDocumentFile').mockResolvedValue({ fileName: 'photo.png', image: new Image() });

    render(<Main />);
    const main = screen.getByRole('main');

    fireEvent.dragOver(main, {
      dataTransfer: { types: ['Files'], files: [file] },
    });
    fireEvent.drop(main, {
      dataTransfer: { types: ['Files'], files: [file] },
    });

    expect(loadDocumentFile.loadDocumentFile).toHaveBeenCalledWith(file);
    await vi.waitFor(() => expect(setImageFromUpload).toHaveBeenCalledTimes(1));
  });
});
