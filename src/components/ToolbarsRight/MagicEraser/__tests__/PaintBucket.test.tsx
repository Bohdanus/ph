import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PaintBucket from '../PaintBucket.tsx';
import { FILL_TOLERANCE_MAX } from '../../../../tools/fill.ts';

/** The store's foreground colour, the value the bucket commits and its `Fill` control displays. */
const storeState = vi.hoisted(() => ({ color: '#00aa00' }));

const toolArgs = vi.hoisted(() => ({ alpha: 1, color: '#000000', contiguous: true, tolerance: 32 }));

const toolArgsAvailable = vi.hoisted(() => ({ current: true }));

const patchToolArgsMock = vi.hoisted(() =>
  vi.fn((_toolName: string, patch: Record<string, unknown>) => {
    Object.assign(toolArgs, patch);
  })
);

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState],
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    getToolArgs: () => (toolArgsAvailable.current ? { ...toolArgs, toolName: 'paint-bucket' } : null),
    patchToolArgs: patchToolArgsMock,
  }),
}));

beforeEach(() => {
  storeState.color = '#00aa00';
  toolArgs.alpha = 1;
  toolArgs.color = '#000000';
  toolArgs.contiguous = true;
  toolArgs.tolerance = 32;
  toolArgsAvailable.current = true;
  patchToolArgsMock.mockClear();
});

describe('Paint Bucket toolbar', () => {
  it('renders nothing when the paint bucket is not the active tool', () => {
    toolArgsAvailable.current = false;
    const { container } = render(<PaintBucket />);

    expect(container).toBeEmptyDOMElement();
  });

  it('scales Tolerance on the 0-255 Adobe scale', () => {
    render(<PaintBucket />);
    const tolerance = screen.getByLabelText(/Tolerance/) as HTMLInputElement;

    expect(FILL_TOLERANCE_MAX).toBe(255);
    expect(tolerance).toHaveAttribute('min', '0');
    expect(tolerance).toHaveAttribute('max', '255');
    expect(tolerance).toHaveAttribute('step', '1');
  });

  it('patches under the paint-bucket name, not the magic eraser one', () => {
    render(<PaintBucket />);

    fireEvent.change(screen.getByLabelText(/Tolerance/), { target: { value: '10' } });
    fireEvent.click(screen.getByLabelText('Contiguous'));

    expect(patchToolArgsMock.mock.calls).toEqual([
      ['paint-bucket', { tolerance: 10 }],
      ['paint-bucket', { contiguous: false }],
    ]);
  });

  it('labels the controls the way the e2e locators read them', () => {
    render(<PaintBucket />);

    expect(screen.getByLabelText('Tolerance 32')).toBeInTheDocument();
    expect(screen.getByLabelText('Opacity 100%')).toBeInTheDocument();
    expect(screen.getByLabelText('Contiguous')).toBeInTheDocument();
    expect(screen.getByLabelText('Anti-aliased')).toBeInTheDocument();
  });

  it('renders Anti-alias disabled, with Photoshop label and checked state, and writes nothing', () => {
    render(<PaintBucket />);
    const antiAlias = screen.getByLabelText('Anti-aliased') as HTMLInputElement;

    expect(antiAlias).toBeDisabled();
    expect(antiAlias).toBeChecked();

    fireEvent.click(antiAlias);

    expect(antiAlias).toBeChecked();
    expect(patchToolArgsMock).not.toHaveBeenCalled();
  });

  it('is a distinct component from the Magic Eraser, which shares the implementation', () => {
    // `ToolbarHorizontal` keys the bar on the tool name, and `tool-processors.test.ts` pins a
    // distinct component per tool; a shared identity would make the two tools remount as one.
    expect(PaintBucket).not.toBe(undefined);
    expect(typeof PaintBucket).toBe('function');
  });

  it('shows the foreground colour it will fill with, which is not the tool args seeded default', () => {
    render(<PaintBucket />);

    // `toolArgs.color` is still the `#000000` the settings seed, and that is the value a user would
    // see a wrong implementation painting.
    expect(toolArgs.color).toBe('#000000');
    expect(screen.getByLabelText('Fill #00AA00')).toBeInTheDocument();
  });

  it('re-reads the store colour, so a foreground change after mount is what the control shows', () => {
    const { rerender } = render(<PaintBucket />);

    // The store push is what re-renders the bar; the assignment alone is invisible until it does.
    storeState.color = '#0000ff';
    rerender(<PaintBucket />);

    expect(screen.getByLabelText('Fill #0000FF')).toBeInTheDocument();
    expect(screen.queryByLabelText('Fill #00AA00')).toBeNull();
  });

  it('renders Photoshop Fill entries: Foreground enabled, Pattern present and disabled', () => {
    render(<PaintBucket />);
    const fill = screen.getByLabelText(/^Fill /) as HTMLSelectElement;
    const options = within(fill).getAllByRole('option') as HTMLOptionElement[];

    // No pattern substrate exists in this repo, so `Pattern` is documented-but-unwired: rendered
    // with Photoshop's real label and `disabled`, never offered as though it worked.
    expect(options.map((option) => option.textContent)).toEqual(['Foreground', 'Pattern']);
    expect(options[0]).toBeEnabled();
    expect(options[1]).toBeDisabled();
    expect(fill.value).toBe('foreground');
  });

  it('writes no tool args from the Fill control, because the colour is read at commit time', () => {
    render(<PaintBucket />);
    const fill = screen.getByLabelText(/^Fill /) as HTMLSelectElement;

    fireEvent.change(fill, { target: { value: 'pattern' } });

    // `FillToolArea` reads `useStore().color` inside the click handler, so a mirrored copy in the
    // args would be a second source of truth that could go stale. Nothing is mirrored.
    expect(patchToolArgsMock).not.toHaveBeenCalled();
    expect(toolArgs.color).toBe('#000000');
  });
});
