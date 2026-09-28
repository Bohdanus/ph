import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Crop from '../Crop.tsx';
import { refitRectWidthToAspect } from '../../../../util/rect-aspect.ts';

const RECT = { x1: 10, y1: 20, x2: 110, y2: 220 };
/**
 * The refit expectations are DERIVED from the shared helper rather than written out, so a change
 * to the helper and a change to the panel land in the same place: this suite cannot drift from the
 * overlay's own refit.
 *
 * What derivation cannot do is catch a helper that is itself wrong. `SQUARE_OF_RECT` is computed by
 * calling `refitRectWidthToAspect`, so a helper that inverts the ratio makes the panel and the
 * expectation agree and the suite goes green on the bug. That direction is pinned by the
 * hand-written numbers lower down, and they are the anchors to read first:
 * `refits a wide rect by narrowing it, and leaves the height untouched` writes out
 * `x1: 50, x2: 250` for a 300 × 200 rect fitted to 1:1, and `refits by holding the height,
 * whatever the preset` pins `x2 - x1` to 112.5 — the panel used to publish 355.56 there, the
 * reciprocal of the ratio the user picked, and every other preset was wrong the same way.
 *
 * `refitRectWidthToAspect` holds the height and moves the width to `height * ratio`; RECT is
 * 100x200, so Square (1:1) is a 200x200 centred on x=60: `x1 = 10 - 50`, `x2 = 110 + 50`.
 */
const refit = (rect: typeof RECT, aspectRatio: number) => ({ ...rect, ...refitRectWidthToAspect(rect, aspectRatio) });
const SQUARE_OF_RECT = refit(RECT, 1);

const toolArgs = vi.hoisted(() => ({
  aspectRatio: null as number | null,
  rect: null as { x1: number; y1: number; x2: number; y2: number } | null,
  preRatioRect: null as { x1: number; y1: number; x2: number; y2: number } | null,
  toolName: 'crop' as const,
}));

const mockSetToolArgs = vi.hoisted(() => vi.fn());
const applyDocumentCropResult = vi.hoisted(() => ({ value: true }));
const mockApplyDocumentCrop = vi.hoisted(() => vi.fn());

vi.mock('../../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{}],
}));

vi.mock('../../../../contexts/useLayer.ts', () => ({
  useLayers: () => ({
    applyDocumentCrop: mockApplyDocumentCrop,
  }),
}));

vi.mock('../../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    setToolArgs: mockSetToolArgs,
  }),
}));

const lastToolArgs = () => mockSetToolArgs.mock.lastCall?.[0] as Record<string, unknown>;

/**
 * The store round trip: the panel's published args become the store's, which is what
 * `setToolArgs` -> store -> `useCurrentTool` does in production. Nothing here is hand-written, so
 * the refit and the pre-ratio bookkeeping are in the causal chain: if the panel published the
 * wrong thing, the next assertion reds on the panel's own output.
 */
function publishAndFeedBack(rerender: (ui: React.ReactElement) => void, selectValue: string) {
  fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: selectValue } });
  const published = lastToolArgs();
  Object.assign(toolArgs, published);
  rerender(<Crop />);
  return published;
}

describe('Crop toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, {
      aspectRatio: null,
      rect: { ...RECT },
      preRatioRect: null,
      toolName: 'crop' as const,
    });
    applyDocumentCropResult.value = true;
    mockSetToolArgs.mockClear();
    mockApplyDocumentCrop.mockClear();
    mockApplyDocumentCrop.mockImplementation(() => applyDocumentCropResult.value);
  });

  it('offers every aspect ratio option and reflects the current toolArgs value', () => {
    render(<Crop />);

    const select = screen.getByLabelText('Aspect Ratio') as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.textContent)).toEqual([
      'Free',
      'Square (1:1)',
      '3:4',
      '4:3',
      '16:9',
      '9:16',
    ]);
    // aspectRatio null maps to the empty option (Free).
    expect(select).toHaveValue('');
  });

  it('maps each preset to its numeric ratio in the tool args', async () => {
    render(<Crop />);
    const user = userEvent.setup();
    const select = screen.getByLabelText('Aspect Ratio') as HTMLSelectElement;

    // A preset publishes the refitted rect too, not just the ratio.
    await user.selectOptions(select, '1');
    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: SQUARE_OF_RECT, preRatioRect: RECT, toolName: 'crop' });

    await user.selectOptions(select, '0.75');
    expect(lastToolArgs().aspectRatio).toBe(0.75);

    await user.selectOptions(select, '1.3333333333333333');
    expect(lastToolArgs().aspectRatio).toBeCloseTo(4 / 3, 10);

    await user.selectOptions(select, '1.7777777777777777');
    expect(lastToolArgs().aspectRatio).toBeCloseTo(16 / 9, 10);

    await user.selectOptions(select, '0.5625');
    expect(lastToolArgs().aspectRatio).toBeCloseTo(9 / 16, 10);
  });

  it('converts the Free option back to a null aspect ratio', async () => {
    Object.assign(toolArgs, { aspectRatio: 1 });
    render(<Crop />);
    const user = userEvent.setup();
    const select = screen.getByLabelText('Aspect Ratio') as HTMLSelectElement;

    expect(select).toHaveValue('1');

    await user.selectOptions(select, '');

    // No pre-ratio rect was recorded, so the pending rect is handed back untouched and the
    // round trip is a no-op rather than a loss.
    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: RECT, preRatioRect: null, toolName: 'crop' });
  });

  it('refits the crop rect to the aspect ratio the user just chose', () => {
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: SQUARE_OF_RECT, preRatioRect: RECT, toolName: 'crop' });
  });

  it('refits a wide rect by narrowing it, and leaves the height untouched', () => {
    // 300x200 is wider than 1:1, so fitting Square shrinks the width to 200 about the centre x=150.
    const wide = { x1: 0, y1: 40, x2: 300, y2: 240 };
    Object.assign(toolArgs, { rect: { ...wide } });
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: { x1: 50, y1: 40, x2: 250, y2: 240 },
      preRatioRect: wide,
      toolName: 'crop',
    });
  });

  it('refits by holding the height, whatever the preset', () => {
    // The overlay's refit never moves y1/y2, so neither may the published rect. A narrower
    // preset is just as much a refit as a wider one.
    const wide = { x1: 0, y1: 40, x2: 300, y2: 240 };
    Object.assign(toolArgs, { rect: { ...wide } });
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '0.5625' } });

    // 9:16 on a 200-tall rect narrows it to 200 * 9/16 = 112.5, centred on x=150. It used to
    // WIDEN to `200 / (9/16)` = 355.56, i.e. the panel published the reciprocal of the ratio the
    // user picked, and every other preset was wrong the same way.
    expect(lastToolArgs().rect).toEqual(refit(wide, 9 / 16));
    const { rect } = lastToolArgs() as { rect: { x1: number; y1: number; x2: number; y2: number } };
    expect(rect.y1).toBe(40);
    expect(rect.y2).toBe(240);
    expect(rect.x2 - rect.x1).toBeCloseTo(112.5, 10);
  });

  it('commits the refitted rect when Apply follows a ratio change', () => {
    const { rerender } = render(<Crop />);

    const published = publishAndFeedBack(rerender, '1');

    expect(published.rect).toEqual(SQUARE_OF_RECT);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // The document must be cropped to the square the user was shown, not to the rect that was
    // pending before the ratio change.
    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(SQUARE_OF_RECT);
    // The pre-ratio rect is spent with the commit, so a later Free cannot resurrect a framing
    // for a crop that has already been applied.
    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('restores the rect drawn before the ratio when the ratio is reset to Free', () => {
    // The regression this replaces. Publishing the refitted rect is right — `Apply` hands `rect`
    // to `applyDocumentCrop`, and a panel that kept the pre-ratio rect would crop the document to
    // a region the user was never shown. But it meant the pre-ratio rect was stored NOWHERE, so
    // switching back to Free snapped the display to 16:9 and `Clear` was the only way back. This
    // test used to encode that loss as the contract.
    const { rerender } = render(<Crop />);

    publishAndFeedBack(rerender, '1');
    expect(toolArgs.rect).toEqual(SQUARE_OF_RECT);
    expect(toolArgs.preRatioRect).toEqual(RECT);

    publishAndFeedBack(rerender, '');

    expect(toolArgs.rect).toEqual(RECT);
    expect(toolArgs.preRatioRect).toBeNull();
    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: RECT, preRatioRect: null, toolName: 'crop' });
  });

  it('restores the FIRST pre-ratio rect after cycling through several presets', () => {
    // The snapshot is taken once, on the way into a ratio. Refitting an already-refitted rect
    // would replace it with an intermediate fit the user never drew.
    const { rerender } = render(<Crop />);

    publishAndFeedBack(rerender, '1');
    publishAndFeedBack(rerender, '1.7777777777777777');
    expect(toolArgs.preRatioRect).toEqual(RECT);

    publishAndFeedBack(rerender, '');

    expect(toolArgs.rect).toEqual(RECT);
  });

  it('records no pre-ratio rect when there was no rect to refit', () => {
    Object.assign(toolArgs, { rect: null });
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('drops the pre-ratio rect on Clear, so a cleared crop cannot be resurrected', () => {
    const { rerender } = render(<Crop />);
    publishAndFeedBack(rerender, '1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('applies the pending rect to the document and clears it from the tool args', () => {
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT);
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('keeps the crop rect pending when the document crop is rejected', () => {
    applyDocumentCropResult.value = false;
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT);
    // A rejected crop must not silently drop the user's selection.
    expect(mockSetToolArgs).not.toHaveBeenCalled();
  });

  it('clears the crop rect without touching the document', () => {
    Object.assign(toolArgs, { aspectRatio: 1 });
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockApplyDocumentCrop).not.toHaveBeenCalled();
    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('disables Apply and Clear while no crop rect is pending', () => {
    Object.assign(toolArgs, { rect: null });
    render(<Crop />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(mockApplyDocumentCrop).not.toHaveBeenCalled();
  });

  it('enables Apply and Clear as soon as a crop rect exists', () => {
    render(<Crop />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('applies and clears with the keyboard through the default button activation', async () => {
    render(<Crop />);
    const user = userEvent.setup();

    const applyButton = screen.getByRole('button', { name: 'Apply' });
    applyButton.focus();
    await user.keyboard('{Enter}');
    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT);

    const clearButton = screen.getByRole('button', { name: 'Clear' });
    clearButton.focus();
    await user.keyboard(' ');
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({
      aspectRatio: null,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
    });
  });
});

describe('Crop option label accessibility', () => {
  beforeEach(() => {
    Object.assign(toolArgs, {
      aspectRatio: null,
      rect: { ...RECT },
      preRatioRect: null,
      toolName: 'crop' as const,
    });
    mockSetToolArgs.mockClear();
  });

  it('binds the Aspect Ratio label to the control only through htmlFor (Crop.tsx:28-32)', () => {
    render(<Crop />);

    const select = screen.getByLabelText('Aspect Ratio');
    expect(select).toHaveAttribute('id', 'aspect-ratio');
    expect(select).not.toHaveAttribute('aria-label');
    expect(select).not.toHaveAttribute('aria-labelledby');
  });

  it('derives its accessible name from the visible label text and nothing else (Crop.tsx:28-32)', () => {
    render(<Crop />);

    // `getByLabelText` succeeding is the proof: the name exists only via `htmlFor` + `id` plus
    // the rendered label text. The previous version of this test removed those attributes
    // itself and then asserted they were gone, so it passed with `Crop.tsx` deleted.
    const select = screen.getByLabelText('Aspect Ratio');
    expect(select).toHaveAccessibleName('Aspect Ratio');

    const label = document.querySelector('label[for="aspect-ratio"]');
    expect(label).toHaveTextContent('Aspect Ratio');
  });

  it.fails('keeps an explicit aria-label on the Aspect Ratio select (Crop.tsx:28-32)', () => {
    render(<Crop />);

    expect(screen.getByLabelText('Aspect Ratio')).toHaveAttribute('aria-label', 'Aspect Ratio');
  });
});
