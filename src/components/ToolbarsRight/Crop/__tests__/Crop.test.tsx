import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Crop from '../Crop.tsx';

const RECT = { x1: 10, y1: 20, x2: 110, y2: 220 };

const toolArgs = vi.hoisted(() => ({
  aspectRatio: null as number | null,
  rect: null as { x1: number; y1: number; x2: number; y2: number } | null,
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

describe('Crop toolbar', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { aspectRatio: null, rect: { ...RECT }, toolName: 'crop' as const });
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

    await user.selectOptions(select, '1');
    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: RECT, toolName: 'crop' });

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

    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: RECT, toolName: 'crop' });
  });

  it('preserves the crop rect when the aspect ratio changes', async () => {
    render(<Crop />);

    fireEvent.change(screen.getByLabelText('Aspect Ratio'), { target: { value: '1' } });

    expect(lastToolArgs().rect).toEqual(RECT);
  });

  it('applies the pending rect to the document and clears it from the tool args', () => {
    render(<Crop />);

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(mockApplyDocumentCrop).toHaveBeenCalledWith(RECT);
    expect(mockSetToolArgs).toHaveBeenCalledTimes(1);
    expect(lastToolArgs()).toEqual({ aspectRatio: null, rect: null, toolName: 'crop' });
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
    expect(lastToolArgs()).toEqual({ aspectRatio: 1, rect: null, toolName: 'crop' });
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
    expect(mockSetToolArgs).toHaveBeenLastCalledWith({ aspectRatio: null, rect: null, toolName: 'crop' });
  });
});

describe('Crop option label accessibility', () => {
  beforeEach(() => {
    Object.assign(toolArgs, { aspectRatio: null, rect: { ...RECT }, toolName: 'crop' as const });
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
