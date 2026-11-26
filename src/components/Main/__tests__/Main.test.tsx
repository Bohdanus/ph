import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Main from '../Main.tsx';
import { UnsavedChangesProvider } from '../../../contexts/UnsavedChangesContext.tsx';

/**
 * `Main`'s own no-image branch, and nothing else.
 *
 * The three tests this file used to hold were `toBeInTheDocument()` on elements `Main` renders
 * unconditionally in that branch: the two no-image buttons and the workspace canvas. All of them
 * would pass if the whole render function returned `null`, because `render` puts its container in
 * `document.body` whether or not anything landed in it — so none of them could fail on a defect.
 * They are replaced by the one assertion `Main` is uniquely placed to make, and the drop test is
 * gone because `Main.toolAreas.test.tsx` covers it strictly harder, branches included (see the
 * `Main file drop` describe there: the happy path, the `hasUnsavedChanges` and pending-text
 * confirmations, and the decode-failure `console.error`).
 *
 * Every module below is mocked because `Main` calls it during render, not because any test
 * asserts on it: with no image open nothing here reaches a file dialog, a layer publish or a
 * tool area. The mocks keep the import graph out of the real providers.
 *
 * `UnsavedChangesProvider` is the ONE module here that is deliberately NOT mocked. `Main` calls
 * `useUnsavedChanges()` on every drop, and the real provider reads `useStore` — which this file
 * already mocks — so the genuine guard runs. It cannot prompt in this file: `hasImage` is false,
 * `hasDiscardableWork` returns false on that alone, and `confirmDiscard` resolves `true` without a
 * widget. That is what makes the empty-state assertions below hold unchanged.
 */
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
      viewStateRef: {
        current: { panX: 0, panY: 0, zoom: 1, fitScaleCompensation: 1, rotation: 0, fitToScreen: true },
      },
      // A REF, because `previewLayers` is read as `previewLayers.current` by
      // `UnsavedChangesProvider`. A plain `{}` here would throw inside the guard's own
      // predicate rather than describe the document, so the shape is the contract.
      previewLayers: { current: {} },
      layers: {},
      selections: [],
      toolName: 'zoom',
      totalSize: { width: 800, height: 600 },
    },
  ],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ setBlankImage: vi.fn(), setImageFromUpload: vi.fn() }),
}));

vi.mock('../../../contexts/useFile.tsx', () => ({
  useFile: () => ({ openLoadImageDialog: vi.fn(), openNewImageDialog: vi.fn() }),
}));

vi.mock('../../../contexts/AutoSaveContext.tsx', () => ({
  useAutoSave: () => ({ isCheckingAutosave: false }),
}));

vi.mock('../../../contexts/useLayer.ts', () => ({
  MAX_DOCUMENT_FRAME_SIDE: 4096,
  useLayers: () => ({ drawAllLayers: vi.fn() }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Main with no image open', () => {
  it('shows canvas presets and file actions without exposing the checkerboard', () => {
    const { container } = render(
      <UnsavedChangesProvider>
        <Main />
      </UnsavedChangesProvider>
    );

    expect(screen.getByTestId('start-page')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Create a new image' })).toBeInTheDocument();
    expect(screen.getByText('1920 × 1080 px')).toBeInTheDocument();
    expect(screen.getByText('1080 × 1080 px')).toBeInTheDocument();
    expect(screen.getByText('1080 × 1350 px')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom size…' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open image' })).toBeInTheDocument();
    expect(screen.queryByText(/previous files/i)).toBeNull();
    expect(container.querySelector('.chessboard-light')).not.toBeVisible();
    expect(screen.getByTestId('workspace-canvas')).not.toBeVisible();
  });
});
