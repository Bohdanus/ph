import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NewImageDialog from '../NewImageDialog.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NewImageDialog', () => {
  it('renders dialog with default values', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    expect(screen.getByTestId('new-image-dialog')).toBeInTheDocument();
    expect((screen.getByLabelText('Width (px)') as HTMLInputElement).value).toBe('800');
    expect((screen.getByLabelText('Height (px)') as HTMLInputElement).value).toBe('600');
  });

  it('calls onCreate and onClose when OK is submitted', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 800, height: 600 },
      isBedrock: true,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    fireEvent.click(screen.getByTestId('new-image-dialog-cancel-button'));

    expect(onClose).toHaveBeenCalled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('calls onCreate with custom values when submitted', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    const widthInput = screen.getByTestId('new-image-width-input') as HTMLInputElement;
    const heightInput = screen.getByTestId('new-image-height-input') as HTMLInputElement;

    fireEvent.change(widthInput, { target: { value: '320' } });
    fireEvent.change(heightInput, { target: { value: '240' } });

    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 320, height: 240 },
      isBedrock: true,
    });
    expect(onClose).toHaveBeenCalled();
  });
});

function renderDialog() {
  const onClose = vi.fn();
  const onCreate = vi.fn();
  const view = render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);
  return { onClose, onCreate, ...view };
}

const presetSelect = () => screen.getByTestId('new-image-preset-select') as HTMLSelectElement;
const dpiInput = () => screen.getByTestId('new-image-dpi-input') as HTMLInputElement;
const widthInput = () => screen.getByTestId('new-image-width-input') as HTMLInputElement;
const heightInput = () => screen.getByTestId('new-image-height-input') as HTMLInputElement;
const opacitySlider = () => screen.getByRole('slider') as HTMLInputElement;
const backgroundInput = () => screen.getByLabelText('Background') as HTMLInputElement;

describe('NewImageDialog presets', () => {
  it('offers every preset and the custom entry', () => {
    renderDialog();

    expect(presetSelect().value).toBe('custom');
    expect(Array.from(presetSelect().options).map((option) => option.value)).toEqual([
      'custom',
      'a3',
      'a4',
      'a5',
      'us-letter',
      'us-legal',
      'photo-4x6',
    ]);
  });

  it('hides the DPI field for the pixel based custom preset', () => {
    renderDialog();

    expect(screen.queryByTestId('new-image-dpi-input')).toBeNull();
  });

  it.each([
    ['a4', '2480', '3508'],
    ['a5', '1748', '2480'],
    ['us-letter', '2550', '3300'],
    ['photo-4x6', '1200', '1800'],
  ])('converts the %s preset to pixels at 300 dpi', (preset, width, height) => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: preset } });

    expect(presetSelect().value).toBe(preset);
    expect(widthInput().value).toBe(width);
    expect(heightInput().value).toBe(height);
  });

  it('reveals the DPI field for a physical-unit preset and uses it for later changes', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a4' } });

    expect(dpiInput().value).toBe('300');
    fireEvent.change(dpiInput(), { target: { value: '150' } });
    expect(widthInput().value).toBe('1240');
    expect(heightInput().value).toBe('1754');
  });

  it('reveals the DPI field for an inch based preset as well', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'photo-4x6' } });

    expect(dpiInput().value).toBe('300');
    fireEvent.change(dpiInput(), { target: { value: '72' } });
    expect(widthInput().value).toBe('288');
    expect(heightInput().value).toBe('432');
  });

  it('clamps a preset to the 10000 px maximum when the DPI is huge', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'us-legal' } });
    fireEvent.change(dpiInput(), { target: { value: '2400' } });

    expect(widthInput().value).toBe('10000');
    expect(heightInput().value).toBe('10000');
  });

  it('falls back to 1 dpi when the DPI field is cleared', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a4' } });
    fireEvent.change(dpiInput(), { target: { value: '' } });

    expect(dpiInput().value).toBe('1');
    expect(widthInput().value).toBe('8');
    expect(heightInput().value).toBe('12');
  });

  it('keeps the manual dimensions and hides the DPI field again when Custom is reselected', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a4' } });
    fireEvent.change(presetSelect(), { target: { value: 'custom' } });

    expect(screen.queryByTestId('new-image-dpi-input')).toBeNull();
    expect(widthInput().value).toBe('2480');
    expect(heightInput().value).toBe('3508');
  });

  it('ignores a DPI change once the preset is custom', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a4' } });
    fireEvent.change(presetSelect(), { target: { value: 'custom' } });

    expect(screen.queryByTestId('new-image-dpi-input')).toBeNull();
    expect(widthInput().value).toBe('2480');
  });

  it('submits the preset derived dimensions', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'photo-4x6' } });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 1200, height: 1800 },
      isBedrock: true,
    });
  });
});

describe('NewImageDialog dimension inputs', () => {
  it('switches the preset back to custom as soon as the width is edited', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a4' } });
    expect(presetSelect().value).toBe('a4');

    fireEvent.change(widthInput(), { target: { value: '1024' } });

    expect(presetSelect().value).toBe('custom');
    expect(screen.queryByTestId('new-image-dpi-input')).toBeNull();
    expect(widthInput().value).toBe('1024');
  });

  it('switches the preset back to custom as soon as the height is edited', () => {
    renderDialog();

    fireEvent.change(presetSelect(), { target: { value: 'a3' } });
    fireEvent.change(heightInput(), { target: { value: '768' } });

    expect(presetSelect().value).toBe('custom');
    expect(heightInput().value).toBe('768');
  });

  it('accepts the smallest legal dimensions', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(widthInput(), { target: { value: '1' } });
    fireEvent.change(heightInput(), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 1, height: 1 },
      isBedrock: true,
    });
  });

  it('blocks submission when the width is cleared, because the input is required and bounded', () => {
    const { onCreate, onClose } = renderDialog();

    fireEvent.change(widthInput(), { target: { value: '' } });
    expect(widthInput().value).toBe('0');
    expect(widthInput().validity.valid).toBe(false);
    expect(widthInput().validity.rangeUnderflow).toBe(true);

    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('coerces a cleared height to 0', () => {
    renderDialog();

    fireEvent.change(heightInput(), { target: { value: '' } });

    expect(heightInput().value).toBe('0');
  });

  it('blocks submission for a negative dimension typed past the min attribute', () => {
    const { onCreate, onClose } = renderDialog();

    fireEvent.change(widthInput(), { target: { value: '-5' } });
    expect(widthInput().validity.valid).toBe(false);

    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('performs no clamping of its own, so the browser validation is the only guard', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(widthInput(), { target: { value: '' } });
    fireEvent.submit(screen.getByTestId('new-image-dialog-form'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#ffffff',
      opacity: 1,
      size: { width: 0, height: 600 },
      isBedrock: true,
    });
  });

  it('marks both dimension inputs as required and clamps through min/max attributes', () => {
    renderDialog();

    expect(widthInput().required).toBe(true);
    expect(heightInput().required).toBe(true);
    expect(widthInput().min).toBe('1');
    expect(widthInput().max).toBe('10000');
    expect(heightInput().min).toBe('1');
    expect(heightInput().max).toBe('10000');
  });
});

describe('NewImageDialog background and opacity', () => {
  it('submits the chosen background colour', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(backgroundInput(), { target: { value: '#123456' } });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#123456',
      opacity: 1,
      size: { width: 800, height: 600 },
      isBedrock: true,
    });
  });

  it('submits the chosen opacity', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(opacitySlider(), { target: { value: '0.25' } });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#ffffff',
      opacity: 0.25,
      size: { width: 800, height: 600 },
      isBedrock: true,
    });
  });

  it('disables the background colour input at zero opacity and re-enables it above zero', () => {
    renderDialog();

    expect(backgroundInput().disabled).toBe(false);

    fireEvent.change(opacitySlider(), { target: { value: '0' } });
    expect(backgroundInput().disabled).toBe(true);

    fireEvent.change(opacitySlider(), { target: { value: '0.5' } });
    expect(backgroundInput().disabled).toBe(false);
  });

  it('labels the opacity slider with its percentage', () => {
    renderDialog();

    expect(screen.getByText('Opacity: 100%')).toBeInTheDocument();
    fireEvent.change(opacitySlider(), { target: { value: '0.3' } });
    expect(screen.getByText('Opacity: 30%')).toBeInTheDocument();
  });

  it('submits a fully transparent document with the last chosen background colour', () => {
    const { onCreate } = renderDialog();

    fireEvent.change(backgroundInput(), { target: { value: '#00ff00' } });
    fireEvent.change(opacitySlider(), { target: { value: '0' } });
    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledExactlyOnceWith({
      color: '#00ff00',
      opacity: 0,
      size: { width: 800, height: 600 },
      isBedrock: true,
    });
  });
});

describe('NewImageDialog close paths', () => {
  it('closes from the header close button', () => {
    const { onClose, onCreate } = renderDialog();

    fireEvent.click(screen.getByTestId('new-image-dialog-close-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('closes when the backdrop is clicked', () => {
    const { onClose, onCreate, container } = renderDialog();

    const backdrop = container.querySelector('.fixed.inset-0.bg-black') as HTMLElement;
    fireEvent.click(backdrop);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('closes exactly once when the dialog unmounts', () => {
    const { onClose, unmount } = renderDialog();

    unmount();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the most recent onClose callback when unmounting after a prop change', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const { rerender, unmount } = render(<NewImageDialog onClose={firstClose} onCreate={vi.fn()} />);

    rerender(<NewImageDialog onClose={secondClose} onCreate={vi.fn()} />);
    unmount();

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it('calls onCreate once and onClose once for a submitted dialog', () => {
    const { onClose, onCreate } = renderDialog();

    fireEvent.click(screen.getByTestId('new-image-dialog-submit-button'));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
