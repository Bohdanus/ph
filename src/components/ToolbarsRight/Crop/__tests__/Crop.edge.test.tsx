import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Crop from '../Crop.tsx';
import { refitRectWidthToAspect } from '../../../../util/rect-aspect.ts';

const RECT = { x1: 10, y1: 20, x2: 110, y2: 220 };
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

describe('Crop toolbar edge cases', () => {
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

  it('ratio Free preserves the pre-ratio rect and clears the snapshot', () => {
    // Starting from a preset with a recorded pre-ratio rect, Free must hand the original rect
    // back and spend the snapshot, so the restore is idempotent and cannot resurrect a framing
    // after the user has moved on.
    Object.assign(toolArgs, { aspectRatio: 1, rect: { ...SQUARE_OF_RECT }, preRatioRect: { ...RECT } });
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '' } });

    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: RECT, preRatioRect: null, toolName: 'crop' });
  });

  it('ratio Square refits the pending rect to 1:1 and records the pre-ratio rect', () => {
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: SQUARE_OF_RECT, preRatioRect: RECT, toolName: 'crop' });
  });

  it('disables Apply when no crop rect is pending', () => {
    Object.assign(toolArgs, { rect: null });
    render(<Crop />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(mockApplyDocumentCrop).not.toHaveBeenCalled();
  });

  it('hands a zero-width rect straight to applyDocumentCrop without refitting it away', () => {
    // A degenerate rect is still a rect: the panel must not transform it, and Apply must remain
    // available so the user can commit or clear it explicitly.
    const zeroWidth = { x1: 50, y1: 50, x2: 50, y2: 100 };
    Object.assign(toolArgs, { rect: { ...zeroWidth } });
    render(<Crop />);

    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(zeroWidth);
    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: null, preRatioRect: null, toolName: 'crop' });
  });

  it('refits a zero-height rect to a zero-width box centred on the same x', () => {
    // height 0 means wantedWidth 0, so both horizontal edges collapse onto the centre. The
    // convention holds rather than producing a NaN or a negative width.
    const zeroHeight = { x1: 10, y1: 20, x2: 110, y2: 20 };
    Object.assign(toolArgs, { rect: { ...zeroHeight } });
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1,
      rect: { x1: 60, y1: 20, x2: 60, y2: 20 },
      preRatioRect: zeroHeight,
      toolName: 'crop',
    });
  });

  it('accepts a custom width/height ratio typed into the Aspect Ratio select', () => {
    // The select is not limited to the listed presets: whatever numeric string the control
    // reports flows through `Number(val)` and becomes the ratio, refitting the pending rect to
    // that custom proportion. (A `<select>` only surfaces option values, so the custom value is
    // set on the control before the change event fires — the handler itself does not care where
    // the string came from.)
    render(<Crop />);

    const select = screen.getByLabelText('Aspect Ratio') as HTMLSelectElement;
    Object.defineProperty(select, 'value', { value: '1.5', configurable: true });
    fireEvent.change(select, { target: { value: '1.5' } });

    expect(lastToolArgs()).toEqual({
      aspectRatio: 1.5,
      rect: refit(RECT, 1.5),
      preRatioRect: RECT,
      toolName: 'crop',
    });
  });
});
