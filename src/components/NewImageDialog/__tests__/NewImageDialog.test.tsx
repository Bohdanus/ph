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

    expect(screen.getByTestId('new-image-dialog')).toBeTruthy();
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

  it('updates width when width input changes', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    const widthInput = screen.getByTestId('new-image-width-input') as HTMLInputElement;
    fireEvent.change(widthInput, { target: { value: '1024' } });

    expect(widthInput.value).toBe('1024');
  });

  it('updates height when height input changes', () => {
    const onClose = vi.fn();
    const onCreate = vi.fn();
    render(<NewImageDialog onClose={onClose} onCreate={onCreate} />);

    const heightInput = screen.getByTestId('new-image-height-input') as HTMLInputElement;
    fireEvent.change(heightInput, { target: { value: '768' } });

    expect(heightInput.value).toBe('768');
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
