import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider } from '../../../../hooks/useKeyboardEvents.tsx';
import FontSelect from '../FontSelect.tsx';

const FONTS = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Georgia',
  'Palatino',
  'Garamond',
  'Comic Sans MS',
  'Roboto',
  'Impact',
  'Trebuchet MS',
  'Tahoma',
  'Brush Script MT',
];

afterEach(cleanup);

function ControlledFontSelect({ initial, onChange }: { initial: string; onChange: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <KeyboardEventsProvider>
      <FontSelect
        value={value}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    </KeyboardEventsProvider>
  );
}

function renderFontSelect(initial: string, onChange = vi.fn()) {
  const view = render(<ControlledFontSelect initial={initial} onChange={onChange} />);
  return { onChange, view };
}

/** The trigger is identified by its production `id`, never by accessible name. */
const trigger = () => document.getElementById('font-family-select') as HTMLButtonElement;

/** Popup options are siblings of the trigger, so they are scoped to the popup list. */
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#font-family-select ~ div > button'));

const hasOption = (font: string) => options().some((el) => el.textContent === font);

const option = (font: string) => {
  const found = options().find((el) => el.textContent === font);
  if (!found) throw new Error(`no popup option rendered for ${font}`);
  return found;
};

const triggerText = () => trigger().textContent ?? '';

function press(key: string) {
  fireEvent.keyDown(document, { key, bubbles: true, cancelable: true });
}

describe('FontSelect closed state', () => {
  it('renders the current value and no font list', () => {
    renderFontSelect('Georgia');

    expect(triggerText()).toBe('Georgia');
    expect(options()).toHaveLength(0);
    for (const font of FONTS) {
      expect(hasOption(font)).toBe(false);
    }
  });

  it('exposes the trigger as a plain button with no popup or list semantics', () => {
    renderFontSelect('Arial');

    expect(trigger().tagName).toBe('BUTTON');
    expect(screen.getByRole('button', { name: 'Arial' })).toBe(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('styles the trigger with the selected font family', () => {
    renderFontSelect('Impact');

    expect(trigger()).toHaveStyle({ fontFamily: 'Impact' });
  });

  it.fails('reports the open/closed state through aria-expanded (FontSelect.tsx:76-92)', () => {
    renderFontSelect('Arial');

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it.fails('exposes the popup as a listbox (FontSelect.tsx:94-113)', () => {
    renderFontSelect('Arial');
    fireEvent.click(trigger());

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('FontSelect popup rendering', () => {
  it('renders the full font list on the first open', () => {
    renderFontSelect('Arial');

    fireEvent.click(trigger());

    expect(options().map((el) => el.textContent)).toEqual(FONTS);
  });

  it('highlights the active font with a selected background class', () => {
    renderFontSelect('Georgia');

    fireEvent.click(trigger());

    expect(option('Georgia')).toHaveClass('bg-blue-600');
    expect(option('Arial')).not.toHaveClass('bg-blue-600');
  });

  it('styles every option with its own font family', () => {
    renderFontSelect('Arial');

    fireEvent.click(trigger());

    expect(option('Impact')).toHaveStyle({ fontFamily: 'Impact' });
    expect(option('Courier New')).toHaveStyle({ fontFamily: 'Courier New' });
  });

  it('rotates the chevron while the popup is open', () => {
    renderFontSelect('Arial');
    expect(trigger().querySelector('svg')).not.toHaveClass('rotate-180');

    fireEvent.click(trigger());

    expect(trigger().querySelector('svg')).toHaveClass('rotate-180');
  });

  it.fails('marks the active font with aria-selected (FontSelect.tsx:100-104)', () => {
    renderFontSelect('Georgia');
    fireEvent.click(trigger());

    expect(option('Georgia')).toHaveAttribute('aria-selected', 'true');
    expect(option('Arial')).toHaveAttribute('aria-selected', 'false');
  });
});

describe('FontSelect open/close toggling', () => {
  it('opens and closes on repeated trigger clicks without calling onChange', () => {
    const { onChange } = renderFontSelect('Arial');

    fireEvent.click(trigger());
    expect(hasOption('Impact')).toBe(true);

    fireEvent.click(trigger());
    expect(hasOption('Impact')).toBe(false);

    fireEvent.click(trigger());
    expect(hasOption('Impact')).toBe(true);

    expect(onChange).not.toHaveBeenCalled();
    expect(triggerText()).toBe('Arial');
  });

  it('re-opens without re-emitting the current font', () => {
    const { onChange } = renderFontSelect('Arial');

    fireEvent.click(trigger());
    fireEvent.click(trigger());
    fireEvent.click(trigger());

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FontSelect selection', () => {
  it('commits the clicked font, updates the trigger and closes the popup', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());

    fireEvent.click(option('Impact'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Impact');
    expect(hasOption('Impact')).toBe(false);
    expect(triggerText()).toBe('Impact');
  });

  it('commits the hovered font on mouse enter without closing the popup', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());

    fireEvent.mouseEnter(option('Garamond'));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Garamond');
    expect(triggerText()).toBe('Garamond');
    expect(hasOption('Garamond')).toBe(true);
  });

  it('emits one onChange per hovered font in order', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());

    fireEvent.mouseEnter(option('Verdana'));
    fireEvent.mouseEnter(option('Tahoma'));

    expect(onChange.mock.calls).toEqual([['Verdana'], ['Tahoma']]);
  });

  it('moves the highlight to the newly committed font on the next open', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.click(option('Palatino'));

    fireEvent.click(trigger());

    expect(option('Palatino')).toHaveClass('bg-blue-600');
    expect(option('Arial')).not.toHaveClass('bg-blue-600');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('Palatino');
  });
});

describe('FontSelect dismissals', () => {
  it('restores the font that was active when the popup opened on Escape', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.mouseEnter(option('Impact'));
    onChange.mockClear();

    press('Escape');

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Arial');
    expect(hasOption('Impact')).toBe(false);
    expect(triggerText()).toBe('Arial');
  });

  it('reverts to the committed font, not the value at open time, on Escape', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.click(option('Impact'));
    onChange.mockClear();

    fireEvent.click(trigger());
    fireEvent.mouseEnter(option('Roboto'));
    onChange.mockClear();
    press('Escape');

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Impact');
    expect(triggerText()).toBe('Impact');
  });

  it('ignores Escape while the popup is closed', () => {
    const { onChange } = renderFontSelect('Arial');

    press('Escape');

    expect(onChange).not.toHaveBeenCalled();
    expect(triggerText()).toBe('Arial');
  });

  it('restores the open-time font and closes on a mousedown outside the dropdown', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.mouseEnter(option('Comic Sans MS'));
    onChange.mockClear();

    fireEvent.mouseDown(document.body);

    expect(onChange).toHaveBeenCalledExactlyOnceWith('Arial');
    expect(hasOption('Comic Sans MS')).toBe(false);
  });

  it('ignores a mousedown inside the dropdown', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    onChange.mockClear();

    fireEvent.mouseDown(trigger());
    fireEvent.mouseDown(option('Roboto'));

    expect(onChange).not.toHaveBeenCalled();
    expect(hasOption('Roboto')).toBe(true);
  });

  it('ignores a mousedown outside the dropdown while the popup is already closed', () => {
    const { onChange } = renderFontSelect('Arial');

    fireEvent.mouseDown(document.body);

    expect(onChange).not.toHaveBeenCalled();
    expect(options()).toHaveLength(0);
  });

  it('does not fire the outside-mousedown handler after unmount', () => {
    const onChange = vi.fn();
    const { view } = renderFontSelect('Arial', onChange);
    fireEvent.click(trigger());
    onChange.mockClear();

    view.unmount();
    fireEvent.mouseDown(document.body);

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('FontSelect keyboard interaction', () => {
  it('does not move the selection with arrow keys (no roving focus in FontSelect.tsx:94-113)', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());

    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    press('ArrowDown');

    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the popup open for unrelated keys', () => {
    renderFontSelect('Arial');
    fireEvent.click(trigger());

    press('a');

    expect(hasOption('Impact')).toBe(true);
  });

  it('opens the popup from the keyboard through native button activation', () => {
    renderFontSelect('Arial');

    fireEvent.click(trigger(), { detail: 0 });

    expect(hasOption('Impact')).toBe(true);
  });

  it.fails('closes the popup and commits the highlighted font on Enter (FontSelect.tsx:94-113)', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.mouseEnter(option('Tahoma'));
    onChange.mockClear();

    press('Enter');

    expect(onChange).not.toHaveBeenCalled();
    expect(hasOption('Tahoma')).toBe(false);
  });
});
