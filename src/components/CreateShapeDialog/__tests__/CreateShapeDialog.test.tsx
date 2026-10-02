import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CreateShapeDialog, { type CreateShapeParams } from '../CreateShapeDialog.tsx';

/**
 * Unit coverage for the dialog in isolation, so the field contract is pinned by the component
 * that owns it rather than only through `ShapeToolArea`'s gesture tests.
 *
 * `useDialogFocusContainment` is NOT mocked: it is the reason a dialog owns its keyboard in
 * this app, and a suite that stubbed it would pass whatever the component forgot to wire.
 * jsdom gives the hook a real document to own.
 */

const renderDialog = (props: Partial<React.ComponentProps<typeof CreateShapeDialog>> = {}) => {
  const onClose = vi.fn();
  const onCreate = vi.fn<(params: CreateShapeParams) => void>();
  const view = render(<CreateShapeDialog figure="rectangle" onClose={onClose} onCreate={onCreate} {...props} />);
  return { view, onClose, onCreate };
};

/** Replaces a number input's value the way a user typing into it would. */
const setNumber = (testId: string, value: string) => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

const submit = () => {
  act(() => {
    fireEvent.click(screen.getByTestId('create-shape-dialog-submit-button'));
  });
};

describe('CreateShapeDialog', () => {
  describe('titles', () => {
    it.each([
      ['rectangle', 'Create Rectangle'],
      ['oval', 'Create Ellipse'],
      ['triangle', 'Create Triangle'],
      ['polygon', 'Create Polygon'],
    ] as const)('names the %s figure', (figure, title) => {
      renderDialog({ figure });
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    });
  });

  describe('fields', () => {
    it('offers Width, Height and From Center to every figure', () => {
      renderDialog({ figure: 'triangle' });
      expect(screen.getByTestId('create-shape-width-input')).toBeInTheDocument();
      expect(screen.getByTestId('create-shape-height-input')).toBeInTheDocument();
      expect(screen.getByTestId('create-shape-from-center')).toBeInTheDocument();
    });

    // `drawShape` reads `cornerRadius` in its rectangle branch only (`src/tools/shape.ts:240`),
    // so a radius on any other figure is a control that accepts a value and drops it.
    it('offers Corner Radius to the rectangle, whose renderer honours it', () => {
      renderDialog({ figure: 'rectangle' });
      expect(screen.getByTestId('create-shape-radius-input')).toBeInTheDocument();
    });

    it.each(['oval', 'triangle', 'polygon'] as const)('withholds Corner Radius from %s', (figure) => {
      renderDialog({ figure });
      expect(screen.queryByTestId('create-shape-radius-input')).not.toBeInTheDocument();
    });

    it('seeds the radius from the bar so the dialog opens on what the bar shows', () => {
      renderDialog({ figure: 'rectangle', cornerRadius: 9 });
      expect(screen.getByTestId('create-shape-radius-input')).toHaveValue(9);
    });

    it('defaults a rectangle with no radius from the bar to a square corner', () => {
      renderDialog({ figure: 'rectangle' });
      expect(screen.getByTestId('create-shape-radius-input')).toHaveValue(0);
    });
  });

  describe('the size it reports', () => {
    it('seeds 100 x 100, continuing the prompt default this dialog replaced', () => {
      renderDialog();
      expect(screen.getByTestId('create-shape-width-input')).toHaveValue(100);
      expect(screen.getByTestId('create-shape-height-input')).toHaveValue(100);
    });

    it('reports the typed size and closes', () => {
      const { onClose, onCreate } = renderDialog();

      setNumber('create-shape-width-input', '240');
      setNumber('create-shape-height-input', '160');
      submit();

      expect(onCreate).toHaveBeenCalledWith({ width: 240, height: 160, fromCenter: false, cornerRadius: 0 });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('reports From Center when it is checked', () => {
      const { onCreate } = renderDialog();

      fireEvent.click(screen.getByTestId('create-shape-from-center'));
      submit();

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ fromCenter: true }));
    });

    it('seeds From Center from the Alt held at the press, and lets the user clear it', () => {
      const { onCreate } = renderDialog({ initialFromCenter: true });
      expect(screen.getByTestId('create-shape-from-center')).toBeChecked();

      fireEvent.click(screen.getByTestId('create-shape-from-center'));
      submit();

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ fromCenter: false }));
    });

    it('reports a typed radius for a rectangle', () => {
      const { onCreate } = renderDialog({ figure: 'rectangle' });

      setNumber('create-shape-radius-input', '14');
      submit();

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cornerRadius: 14 }));
    });

    it('omits cornerRadius entirely for a figure that has no radius field', () => {
      const { onCreate } = renderDialog({ figure: 'polygon' });

      submit();

      // The key is absent rather than zero: a figure whose renderer has no radius branch must
      // not be handed a radius of 0 that reads as a deliberate value.
      expect(onCreate.mock.calls[0][0]).not.toHaveProperty('cornerRadius');
    });

    it('clamps a negative radius to zero', () => {
      const { onCreate } = renderDialog({ figure: 'rectangle' });

      setNumber('create-shape-radius-input', '-5');
      submit();

      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ cornerRadius: 0 }));
    });
  });

  describe('a size that cannot be drawn', () => {
    it.each([
      ['zero width', 'create-shape-width-input', '0', '100'],
      ['zero height', 'create-shape-height-input', '100', '0'],
      ['a negative width', 'create-shape-width-input', '-40', '100'],
    ])('refuses to submit on %s', (_label, widthId, width, height) => {
      const { onCreate } = renderDialog();

      setNumber(widthId, width);
      setNumber('create-shape-height-input', height);

      expect(screen.getByTestId('create-shape-dialog-submit-button')).toBeDisabled();
      fireEvent.submit(screen.getByTestId('create-shape-dialog-form'));
      expect(onCreate).not.toHaveBeenCalled();
    });

    // An emptied `<input type="number">` reports NaN through React, not 0, which is why
    // `Number.isFinite` is in the guard alongside the range test.
    it('refuses to submit on an emptied field', () => {
      const { onCreate } = renderDialog();

      setNumber('create-shape-width-input', '');

      expect(screen.getByTestId('create-shape-dialog-submit-button')).toBeDisabled();
      fireEvent.submit(screen.getByTestId('create-shape-dialog-form'));
      expect(onCreate).not.toHaveBeenCalled();
    });

    it('re-enables OK once the size is drawable again', () => {
      renderDialog();

      setNumber('create-shape-width-input', '0');
      expect(screen.getByTestId('create-shape-dialog-submit-button')).toBeDisabled();

      setNumber('create-shape-width-input', '10');
      expect(screen.getByTestId('create-shape-dialog-submit-button')).toBeEnabled();
    });
  });

  describe('close routes', () => {
    it('closes on Cancel without creating anything', () => {
      const { onClose, onCreate } = renderDialog();

      fireEvent.click(screen.getByTestId('create-shape-dialog-cancel-button'));

      expect(onCreate).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on the backdrop click', () => {
      const { onClose, onCreate } = renderDialog();

      fireEvent.click(screen.getByTestId('create-shape-dialog-backdrop'));

      expect(onCreate).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on the header close button', () => {
      const { onClose, onCreate } = renderDialog();

      fireEvent.click(screen.getByTestId('create-shape-dialog-close-button'));

      expect(onCreate).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes on Escape, from inside the panel', () => {
      const { onClose, onCreate } = renderDialog();

      fireEvent.keyDown(screen.getByTestId('create-shape-dialog'), { key: 'Escape' });

      expect(onCreate).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('stops the keys it eats from reaching the app shortcuts', () => {
      const { onClose, onCreate } = renderDialog();

      // The whole reason `useDialogFocusContainment` exists: the app's shortcut layer is one
      // document-level keydown whose only suppression test is whether the target is editable,
      // so an un-swallowed Cmd+Z here would undo whatever the user did before opening a dialog.
      fireEvent.keyDown(screen.getByTestId('create-shape-width-input'), { key: 'z', metaKey: true });

      expect(onCreate).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('accessibility wiring', () => {
    it('is a modal dialog labelled by its own heading', () => {
      renderDialog();

      const dialog = screen.getByTestId('create-shape-dialog');
      expect(dialog).toHaveAttribute('role', 'dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      const labelledBy = dialog.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(document.getElementById(labelledBy!)?.tagName).toBe('H2');
    });

    it('labels every field through a real label', () => {
      renderDialog({ figure: 'rectangle' });

      expect(screen.getByLabelText('Width (px)')).toBe(screen.getByTestId('create-shape-width-input'));
      expect(screen.getByLabelText('Height (px)')).toBe(screen.getByTestId('create-shape-height-input'));
      expect(screen.getByLabelText('Corner Radius (px)')).toBe(screen.getByTestId('create-shape-radius-input'));
      expect(screen.getByLabelText('From Center')).toBe(screen.getByTestId('create-shape-from-center'));
    });

    // `useDialogFocusContainment` opens focus on the first `input[type="number"]`, which is the
    // dialog's only job. A focus that started anywhere else means a keystroke would be lost.
    it('opens focus on the Width field', () => {
      renderDialog();
      expect(screen.getByTestId('create-shape-width-input')).toHaveFocus();
    });
  });

  describe('lifecycle', () => {
    // The caller is a tool area whose mount is not the dialog's, so an unmount-close here
    // would fire `onClose` a second time after the OK path already fired it.
    it('does not close itself on unmount', () => {
      const { view, onClose } = renderDialog();

      view.unmount();

      expect(onClose).not.toHaveBeenCalled();
    });
  });
});
