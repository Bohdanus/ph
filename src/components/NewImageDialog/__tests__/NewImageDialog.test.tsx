import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider, useKeyDownShortcut } from '../../../hooks/useKeyboardEvents.tsx';
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

const FOCUSABLE = 'select, input, textarea, button, [tabindex]:not([tabindex="-1"])';

function dialogFocusables() {
  return Array.from(screen.getByTestId('new-image-dialog').querySelectorAll<HTMLElement>(FOCUSABLE));
}

const UndoProbe = ({ onKeyDown }: { onKeyDown: () => void }) => {
  useKeyDownShortcut({ key: 'z', mod: true, preventDefault: true, onKeyDown });
  return null;
};

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" data-testid="file-new-trigger" onClick={() => setOpen(true)}>
        New
      </button>
      {open && <NewImageDialog onClose={() => setOpen(false)} onCreate={vi.fn()} />}
    </>
  );
}

describe('NewImageDialog focus ownership', () => {
  it('focuses the preset select on mount, because a button would leave the shortcut layer live', () => {
    renderDialog();

    expect(document.activeElement).toBe(presetSelect());
  });

  it('wraps Tab from the last control back to the first', () => {
    renderDialog();
    const focusables = dialogFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    expect(first).toBe(screen.getByTestId('new-image-dialog-close-button'));
    expect(last).toBe(screen.getByTestId('new-image-dialog-submit-button'));

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first control to the last', () => {
    renderDialog();
    const focusables = dialogFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it('leaves a Tab in the middle of the order to the browser', () => {
    renderDialog();
    const focusables = dialogFocusables();
    const middle = focusables[1];

    middle.focus();
    fireEvent.keyDown(middle, { key: 'Tab' });

    expect(document.activeElement).toBe(middle);
  });

  it('closes on Escape without letting the keydown reach document', () => {
    const { onClose } = renderDialog();
    const documentListener = vi.fn();
    document.addEventListener('keydown', documentListener);

    try {
      fireEvent.keyDown(presetSelect(), { key: 'Escape' });
    } finally {
      document.removeEventListener('keydown', documentListener);
    }

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(documentListener).not.toHaveBeenCalled();
  });

  it('does not preventDefault Escape, so nothing else is starved of the key', () => {
    renderDialog();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

    presetSelect().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('closes on a <body>-targeted Escape, which the panel handler never sees', () => {
    const { onClose } = renderDialog();

    // A re-render can unmount the focused control, which drops focus on <body> without
    // dispatching focusout or focusin, so no containment arm sees it, and a keydown on
    // <body> never reaches the panel's React onKeyDown at all. The document capture-phase
    // arm is therefore the only listener that ever sees this key, and it has to dispatch
    // the close itself: a listener that merely swallowed the key left a dialog that could
    // not be closed by keyboard at all, which is a trap.
    (document.activeElement as HTMLElement).remove();
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never mounts focus on the header close button, which is first in document order', () => {
    renderDialog();

    // The first focusable in document order is the header close button, so a mount that
    // focused "the first control" would autofocus a button, which is not text-like and so
    // re-opens the shortcut hole the focus move is there to close. SaveDialog pins this
    // for the same reason; both dialogs now take it from one hook, so both hold it.
    expect(dialogFocusables()[0]).toBe(screen.getByTestId('new-image-dialog-close-button'));
    expect(document.activeElement).toBe(presetSelect());
    expect(document.activeElement).not.toBe(dialogFocusables()[0]);
  });

  it('restores focus to the element that opened it once it closes', () => {
    render(<DialogHarness />);
    const trigger = screen.getByTestId('file-new-trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(document.activeElement).toBe(presetSelect());

    fireEvent.click(screen.getByTestId('new-image-dialog-cancel-button'));

    expect(document.activeElement).toBe(trigger);
  });

  it('never lets the app shortcut layer fire from a text-like control inside the dialog', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <NewImageDialog onClose={vi.fn()} onCreate={vi.fn()} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(presetSelect(), { key: 'z', metaKey: true });
    fireEvent.keyDown(widthInput(), { key: 'z', metaKey: true });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('never lets the app shortcut layer fire from a button inside the dialog either', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <NewImageDialog onClose={vi.fn()} onCreate={vi.fn()} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(screen.getByTestId('new-image-dialog-cancel-button'), { key: 'z', metaKey: true });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('still delivers the app shortcut layer from outside the dialog, so the probe is not vacuous', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <UndoProbe onKeyDown={onKeyDown} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(screen.getByTestId('outside-control'), { key: 'z', metaKey: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('recovers the focus a click on its own non-interactive text drops on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('new-image-dialog');
    const width = widthInput();
    width.focus();
    expect(document.activeElement).toBe(width);

    // Clicking the "New Image" title or the "Opacity:" label focuses nothing, so the
    // browser blurs the control and leaves focus on <body> without firing focusin.
    (document.activeElement as HTMLElement).blur();

    expect(document.activeElement).not.toBe(document.body);
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(width);
  });

  it('recovers the mount focus rather than the first control when focus is dropped on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('new-image-dialog');
    expect(document.activeElement).toBe(presetSelect());

    (document.activeElement as HTMLElement).blur();

    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(presetSelect());
  });

  it('keeps Tab and the app shortcut layer inside the panel after focus is driven outside it', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <UndoProbe onKeyDown={onKeyDown} />
        <NewImageDialog onClose={vi.fn()} onCreate={vi.fn()} />
      </KeyboardEventsProvider>
    );
    const panel = screen.getByTestId('new-image-dialog');

    (document.activeElement as HTMLElement).blur();
    expect(panel.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Tab' });

    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('refuses the tab and the shortcut layer when the focused control is removed and no focus event fires', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <UndoProbe onKeyDown={onKeyDown} />
        <NewImageDialog onClose={vi.fn()} onCreate={vi.fn()} />
      </KeyboardEventsProvider>
    );
    const panel = screen.getByTestId('new-image-dialog');

    // A re-render can unmount the focused control, which drops focus on <body> without
    // dispatching focusout or focusin, so no containment guard can see it coming.
    (document.activeElement as HTMLElement).remove();
    expect(document.activeElement).toBe(document.body);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    document.body.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('brings focus back when a tab arrives at the panel itself while focus is on <body>', () => {
    renderDialog();
    const panel = screen.getByTestId('new-image-dialog');

    (document.activeElement as HTMLElement).remove();
    expect(document.activeElement).toBe(document.body);

    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(tab);

    expect(tab.defaultPrevented).toBe(true);
    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('takes focus back when something outside the dialog focuses itself', () => {
    render(
      <>
        <button type="button" data-testid="outside-control">
          outside
        </button>
        <NewImageDialog onClose={vi.fn()} onCreate={vi.fn()} />
      </>
    );
    const panel = screen.getByTestId('new-image-dialog');

    screen.getByTestId('outside-control').focus();

    expect(panel.contains(document.activeElement)).toBe(true);
  });

  it('is announced as a modal dialog labelled by its title', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('New Image');
  });
});
