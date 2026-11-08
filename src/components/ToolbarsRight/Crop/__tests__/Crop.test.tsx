import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Crop from '../Crop.tsx';
import { refitRectWidthToAspect } from '../../../../util/rect-aspect.ts';
import {
  CROP_OVERLAYS,
  type CropOverlayType,
  type CropOverlayVisibility,
  GRID_DIVISIONS_DEFAULT,
  GRID_DIVISIONS_MIN,
  GRID_DIVISIONS_MAX,
} from '../../../../tools/crop.ts';

const RECT = { x1: 10, y1: 20, x2: 110, y2: 220 };
const refit = (rect: typeof RECT, aspectRatio: number) => ({ ...rect, ...refitRectWidthToAspect(rect, aspectRatio) });
const SQUARE_OF_RECT = refit(RECT, 1);

const toolArgs = vi.hoisted(() => ({
  aspectRatio: null as number | null,
  rect: null as { x1: number; y1: number; x2: number; y2: number } | null,
  preRatioRect: null as { x1: number; y1: number; x2: number; y2: number } | null,
  angle: 0,
  overlayType: 'ruleOfThirds' as CropOverlayType,
  overlayOrientation: 0,
  overlayVisibility: 'always' as CropOverlayVisibility,
  gridDivisions: 10,
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

function publishAndFeedBack(rerender: (ui: React.ReactElement) => void, selectValue: string) {
  fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: selectValue } });
  const published = lastToolArgs();
  Object.assign(toolArgs, published);
  rerender(<Crop />);
  return published;
}

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: /Crop settings/i }));
}

describe('Crop toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, {
      aspectRatio: null,
      rect: { ...RECT },
      preRatioRect: null,
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
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
    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: SQUARE_OF_RECT,
      preRatioRect: RECT,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });

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
    expect(lastToolArgs()).toEqual({
      aspectRatio: null,
      rect: RECT,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  it('refits the crop rect to the aspect ratio the user just chose', () => {
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: SQUARE_OF_RECT,
      preRatioRect: RECT,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
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
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
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
    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(SQUARE_OF_RECT, 0);
    // The pre-ratio rect is spent with the commit, so a later Free cannot resurrect a framing
    // for a crop that has already been applied.
    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
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
    expect(lastToolArgs()).toEqual({
      aspectRatio: null,
      rect: RECT,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
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

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  it('drops the pre-ratio rect on Clear, so a cleared crop cannot be resurrected', () => {
    const { rerender } = render(<Crop />);
    publishAndFeedBack(rerender, '1');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  it('applies the pending rect to the document and clears it from the tool args', () => {
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT, 0);
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(lastToolArgs()).toEqual({
      aspectRatio: null,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  it('keeps the crop rect pending when the document crop is rejected', () => {
    applyDocumentCropResult.value = false;
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT, 0);
    // A rejected crop must not silently drop the user's selection.
    expect(mockSetToolArgs).not.toHaveBeenCalled();
  });

  it('clears the crop rect without touching the document', () => {
    Object.assign(toolArgs, { aspectRatio: 1 });
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(mockApplyDocumentCrop).not.toHaveBeenCalled();
    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
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
    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT, 0);

    const clearButton = screen.getByRole('button', { name: 'Clear' });
    clearButton.focus();
    await user.keyboard(' ');
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({
      aspectRatio: null,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  it('passes a pending crop rotation to the document operation', () => {
    Object.assign(toolArgs, { angle: 37 });
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT, 37);
    expect(lastToolArgs()).toEqual({
      aspectRatio: null,
      rect: null,
      preRatioRect: null,
      toolName: 'crop',
      angle: 0,
      overlayType: 'ruleOfThirds',
      overlayOrientation: 0,
      overlayVisibility: 'always',
      gridDivisions: GRID_DIVISIONS_DEFAULT,
    });
  });

  describe('Crop overlay settings', () => {
    it('cycles through all overlay types and updates toolArgs', () => {
      render(<Crop />);
      const overlaySelect = screen.getByLabelText('Overlay');

      expect(CROP_OVERLAYS).toContain(toolArgs.overlayType);
      expect(overlaySelect).toHaveValue('ruleOfThirds');

      fireEvent.change(overlaySelect, { target: { value: 'grid' } });
      expect(lastToolArgs().overlayType).toBe('grid');

      fireEvent.change(overlaySelect, { target: { value: 'diagonal' } });
      expect(lastToolArgs().overlayType).toBe('diagonal');

      fireEvent.change(overlaySelect, { target: { value: 'triangle' } });
      expect(lastToolArgs().overlayType).toBe('triangle');

      fireEvent.change(overlaySelect, { target: { value: 'goldenRatio' } });
      expect(lastToolArgs().overlayType).toBe('goldenRatio');

      fireEvent.change(overlaySelect, { target: { value: 'goldenSpiral' } });
      expect(lastToolArgs().overlayType).toBe('goldenSpiral');
    });

    it('cycles through overlay orientation options and updates toolArgs when Settings is open', () => {
      const { rerender } = render(<Crop />);

      // Change overlay to triangle first
      fireEvent.change(screen.getByLabelText('Overlay'), { target: { value: 'triangle' } });
      Object.assign(toolArgs, { overlayType: 'triangle', overlayOrientation: 0 });
      rerender(<Crop />);

      // Now open settings menu
      fireEvent.click(screen.getByRole('button', { name: /Crop settings/i }));

      // The menu should show orientation for triangle
      const orientationSelect = screen.getByLabelText('Orientation');

      expect(orientationSelect).toHaveValue('0');

      fireEvent.change(orientationSelect, { target: { value: '1' } });
      expect(lastToolArgs().overlayOrientation).toBe(1);

      fireEvent.change(orientationSelect, { target: { value: '2' } });
      expect(lastToolArgs().overlayOrientation).toBe(2);

      fireEvent.change(orientationSelect, { target: { value: '3' } });
      expect(lastToolArgs().overlayOrientation).toBe(3);
    });

    it('cycles through overlay visibility options and updates toolArgs when Settings is open', () => {
      render(<Crop />);
      openSettings();

      const visibilitySelect = screen.getByLabelText('Overlay visibility');

      expect(visibilitySelect).toHaveValue('always');

      fireEvent.change(visibilitySelect, { target: { value: 'auto' } });
      expect(lastToolArgs().overlayVisibility).toBe('auto');

      fireEvent.change(visibilitySelect, { target: { value: 'never' } });
      expect(lastToolArgs().overlayVisibility).toBe('never');
    });

    it('updates grid divisions and clamps to valid range when Settings is open', () => {
      render(<Crop />);
      fireEvent.click(screen.getByRole('button', { name: /Crop settings/i }));

      const gridInput = screen.getByLabelText('Grid divisions');

      expect(gridInput).toHaveValue(10);

      fireEvent.change(gridInput, { target: { value: '20' } });
      expect(lastToolArgs().gridDivisions).toBe(20);

      fireEvent.change(gridInput, { target: { value: '1' } });
      // Should clamp to GRID_DIVISIONS_MIN (2)
      expect(lastToolArgs().gridDivisions).toBe(GRID_DIVISIONS_MIN);

      fireEvent.change(gridInput, { target: { value: '200' } });
      // Should clamp to GRID_DIVISIONS_MAX (100)
      expect(lastToolArgs().gridDivisions).toBe(GRID_DIVISIONS_MAX);
    });

    it('does NOT reset overlay settings to defaults on Clear (overlay settings persist)', () => {
      Object.assign(toolArgs, {
        overlayType: 'goldenSpiral',
        overlayOrientation: 3,
        overlayVisibility: 'auto',
        gridDivisions: 50,
      });
      render(<Crop />);

      fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

      // Overlay settings are panel state, not cleared by Clear button
      expect(lastToolArgs().overlayType).toBe('goldenSpiral');
      expect(lastToolArgs().overlayOrientation).toBe(3);
      expect(lastToolArgs().overlayVisibility).toBe('auto');
      expect(lastToolArgs().gridDivisions).toBe(50);
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
});
