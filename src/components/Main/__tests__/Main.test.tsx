import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Main from '../Main.tsx';

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

vi.mock('../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({ drawAllLayers: vi.fn() }),
}));

vi.mock('../../../contexts/ThemeContext.tsx', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Main with no image open', () => {
  it('renders the document surface and keeps every part of it out of reach', () => {
    const { container } = render(<Main />);
    const stack = container.querySelector('main > div') as HTMLElement;

    // PRESENT, not absent — and that is the honest shape of the claim. `Main` returns the same
    // canvas stack in both branches and gates it on `display: none` (`Main.tsx:232`), and
    // `EventHandler` stays `DummyToolArea` because the whole routing table sits inside
    // `if (hasImage)` (`Main.tsx:204`). So "there is no canvas in the document" would be false,
    // and a test asserting it would be pinning a rendering choice rather than the behaviour.
    // What the user can reach is the question that matters, and that IS what is asserted.
    expect(stack).toBeInTheDocument();
    expect(stack.style.display).toBe('none');
    // Four, not three: the marching-ants canvas joins the stack when a polygon selection's border
    // moved off the tool overlay. It is mounted and hidden for the same reason the other three
    // are, and the loop below is what keeps it out of reach — so the count is the assertion.
    expect(container.querySelectorAll('canvas')).toHaveLength(4);

    // `toBeVisible` walks the ancestor chain, so the `display: none` on the stack is what makes
    // every one of these fail — the workspace canvas, the three overlays, and the mounted tool
    // area together. A tool area that were VISIBLE here would be a live pointer surface over an
    // empty document, swallowing every drag aimed at nothing; `SharpToolArea` and
    // `DummyToolArea` are inert precisely because they are the other half of this assertion
    // (`Main.toolAreas.test.tsx`).
    for (const element of stack.querySelectorAll('canvas, div')) {
      expect(element).not.toBeVisible();
    }
    expect(screen.getByTestId('workspace-canvas')).not.toBeVisible();

    // The empty-document affordances are the ONLY reachable content, and they are still the two
    // buttons: a no-image `Main` that rendered nothing at all would fail the `stack` assertions
    // above, and one that rendered the buttons over a live canvas would fail this.
    expect(screen.getByRole('button', { name: 'Open File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'blank image' })).toBeInTheDocument();
    expect(screen.getByTestId('main-open-file-button')).toBe(screen.getByRole('button', { name: 'Open File' }));
    expect(screen.getByTestId('main-blank-image-button')).toBe(screen.getByRole('button', { name: 'blank image' }));
  });
});
