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

/**
 * Popup options live in a list portalled to `document.body`, so they are addressed by that
 * list's own id rather than as siblings of the trigger. The list is `position: fixed` and
 * rendered outside the toolbar precisely so the toolbar's `overflow` cannot clip it.
 */
const popupList = () => document.getElementById('font-family-list');

const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('#font-family-list > button'));

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

  // This was an `it.fails` tripwire. The pin is removed in the same change that adds the
  // attribute, rather than left to fail loudly at some later, unrelated edit.
  it('reports the open/closed state through aria-expanded', () => {
    renderFontSelect('Arial');

    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger()).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', 'font-family-list');
  });

  it.fails('exposes the popup as a listbox (FontSelect.tsx, the portalled popup)', () => {
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

  it.fails('marks the active font with aria-selected (the portalled popup options)', () => {
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
  it('does not move the selection with arrow keys (no roving focus in the portalled popup)', () => {
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

  it.fails('closes the popup and commits the highlighted font on Enter (the portalled popup)', () => {
    const { onChange } = renderFontSelect('Arial');
    fireEvent.click(trigger());
    fireEvent.mouseEnter(option('Tahoma'));
    onChange.mockClear();

    press('Enter');

    expect(onChange).not.toHaveBeenCalled();
    expect(hasOption('Tahoma')).toBe(false);
  });
});

describe('FontSelect popup portal', () => {
  /** jsdom reports a zero rect for everything, so the trigger's geometry is stubbed. */
  function stubTriggerRect(rect: Partial<DOMRect>) {
    const full = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect } as DOMRect;
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(full);
    return full;
  }

  it('renders the popup outside the toolbar so no ancestor can clip it', () => {
    renderFontSelect('Arial');
    fireEvent.click(trigger());

    const list = popupList();
    expect(list).not.toBeNull();
    // The list is a child of <body>, not a descendant of the trigger's wrapper. A popup
    // anchored `absolute` inside the toolbar renders as an 8px sliver the moment the
    // toolbar becomes a scroll container, which is what the tablet band does.
    expect(list?.parentElement).toBe(document.body);
    expect(trigger().contains(list as Node)).toBe(false);
  });

  it('anchors the popup just below the trigger, matching its width', () => {
    stubTriggerRect({ top: 120, left: 300, bottom: 156, width: 220 });
    renderFontSelect('Arial');
    fireEvent.click(trigger());

    const list = popupList() as HTMLElement;
    // `fixed` is a Tailwind class, so jsdom has no computed style for it; only the
    // coordinates are inline, and those are what the anchor is actually made of.
    expect(list).toHaveClass('fixed');
    expect(list.style.left).toBe('300px');
    expect(list.style.width).toBe('220px');
    expect(list.style.top).toBe('160px');
    expect(list.style.bottom).toBe('');
  });

  it('flips above the trigger when the list would not fit below it', () => {
    // A trigger near the bottom of a short window: 700px tall, trigger bottom at 680.
    // The list wants 240px, so it opens upward instead of off-screen.
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true, writable: true });
    stubTriggerRect({ top: 644, left: 40, bottom: 680, width: 200 });

    try {
      renderFontSelect('Arial');
      fireEvent.click(trigger());

      const list = popupList() as HTMLElement;
      // The list's bottom edge sits one gutter (4px) above the trigger's TOP edge
      // (700 - 644 + 4), not above its bottom edge.
      expect(list.style.bottom).toBe('60px');
      expect(list.style.top).toBe('');
    } finally {
      Object.defineProperty(window, 'innerHeight', {
        value: originalInnerHeight,
        configurable: true,
        writable: true,
      });
    }
  });

  it('keeps the popup inside the right edge on a narrow window', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 300, configurable: true, writable: true });
    // A trigger that would place the list 20px from a 300px-wide window.
    stubTriggerRect({ top: 40, left: 200, bottom: 76, width: 180 });

    try {
      renderFontSelect('Arial');
      fireEvent.click(trigger());

      const list = popupList() as HTMLElement;
      const left = Number.parseFloat(list.style.left);
      expect(left + 180).toBeLessThanOrEqual(300);
    } finally {
      Object.defineProperty(window, 'innerWidth', {
        value: originalInnerWidth,
        configurable: true,
        writable: true,
      });
    }
  });

  it('repositions on window resize while open, and stops once closed', () => {
    stubTriggerRect({ top: 100, left: 50, bottom: 136, width: 200 });
    renderFontSelect('Arial');
    fireEvent.click(trigger());
    expect((popupList() as HTMLElement).style.top).toBe('140px');

    // Move the trigger, then resize: the portal must follow its anchor.
    stubTriggerRect({ top: 300, left: 50, bottom: 336, width: 200 });
    fireEvent(window, new Event('resize'));
    expect((popupList() as HTMLElement).style.top).toBe('340px');

    fireEvent.click(trigger());
    stubTriggerRect({ top: 500, left: 50, bottom: 536, width: 200 });
    fireEvent(window, new Event('resize'));
    expect(popupList()).toBeNull();
  });

  it('removes its resize and scroll listeners on close', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    renderFontSelect('Arial');
    fireEvent.click(trigger());

    fireEvent.click(trigger());

    const removed = removeEventListener.mock.calls.map((call) => call[0]);
    expect(removed).toContain('resize');
    expect(removed).toContain('scroll');
  });
});

describe('FontSelect viewport fit', () => {
  /** jsdom reports a zero rect for everything, so the trigger's geometry is stubbed. */
  function stubTriggerRect(rect: Partial<DOMRect>) {
    const full = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect } as DOMRect;
    vi.spyOn(HTMLButtonElement.prototype, 'getBoundingClientRect').mockReturnValue(full);
  }

  const withInnerHeight = (height: number, run: () => void) => {
    const original = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
    try {
      run();
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: original, configurable: true, writable: true });
    }
  };

  it('caps the list to the room below when neither side fits', () => {
    // A 300px window with the trigger at y=100 leaves 200px below and 100px above — neither
    // is the 240px the list wants. The old rule opened downward at a fixed `top` and let the
    // tail run below the fold, unreachable.
    withInnerHeight(300, () => {
      stubTriggerRect({ top: 100, left: 40, bottom: 136, width: 200 });
      renderFontSelect('Arial');
      fireEvent.click(trigger());

      const list = popupList() as HTMLElement;
      const maxHeight = Number.parseFloat(list.style.maxHeight);
      // Room below is innerHeight - bottom - GUTTER = 300 - 136 - 4 = 160; room above is
      // top - GUTTER - margin = 100 - 4 - 8 = 88. The side with more room wins.
      expect(maxHeight).toBe(160);
      expect(maxHeight, 'the list must fit the space it opens into').toBeLessThanOrEqual(160);
    });
  });

  it('flips upward and caps to the room above when the room above is larger', () => {
    // Trigger near the bottom: 80px below, 300px above. Flipped, and the 240px cap applies.
    withInnerHeight(400, () => {
      stubTriggerRect({ top: 300, left: 40, bottom: 320, width: 200 });
      renderFontSelect('Arial');
      fireEvent.click(trigger());

      const list = popupList() as HTMLElement;
      expect(list.style.bottom).not.toBe('');
      expect(list.style.top).toBe('');
      expect(Number.parseFloat(list.style.maxHeight)).toBe(240);
    });
  });

  it('never positions the list further from an edge than the room available', () => {
    // The general property, as an EXACT value per case rather than a range. `FontSelect.tsx:74-92`
    // is `min(240, max(0, openUpwards ? top - 4 - 8 : innerHeight - bottom - 4))` where
    // `openUpwards` is `top - 12 > innerHeight - bottom - 4`. Every term in that expression is
    // observable here, and the previous form (`toBeGreaterThan(0)` plus `<= 240` plus a
    // re-derived `<= room`) left the arithmetic unpinned: any value between 1 and the cap passed,
    // and the two cases that open upward both saturate at the cap, so the `top - 4 - 8` branch was
    // never load-bearing at all. A regression that dropped `VIEWPORT_MARGIN` from `spaceAbove`, or
    // turned the `>` into a `>=`, kept every assertion green.
    //
    // `maxHeight` is spelled out per row rather than recomputed from the formula, so this cannot
    // pass by agreeing with a wrong implementation of that same formula.
    const cases = [
      // [innerHeight, top, bottom, openUpwards, expected maxHeight]
      [300, 100, 136, false, 160], // below wins: 300 - 136 - 4
      [400, 300, 320, true, 240], // above wins by more than the cap: 300 - 4 - 8 = 288
      [800, 700, 716, true, 240], // above wins by far more than the cap: 700 - 4 - 8 = 688
      [200, 20, 60, false, 136], // below wins in a short window: 200 - 60 - 4
      // Above wins by less than the cap, so `top - 4 - 8` — and only that — decides the height.
      [400, 200, 216, true, 188], // 200 - 4 - 8 = 188 against 400 - 216 - 4 = 180 below
      // An exact tie: 140px of room on each side. `openUpwards` is a strict `>`
      // (FontSelect.tsx:86), so the below side is taken. Widening it to `>=` leaves the HEIGHT at
      // 140 either way, which is why the side is asserted before the height here.
      [300, 152, 156, false, 140], // below 300 - 156 - 4 = 140, above 152 - 4 - 8 = 140
    ] as const;

    for (const [height, top, bottom, openedUp, expected] of cases) {
      withInnerHeight(height, () => {
        vi.restoreAllMocks();
        stubTriggerRect({ top, left: 40, bottom, width: 200 });
        renderFontSelect('Arial');
        fireEvent.click(trigger());

        const list = popupList() as HTMLElement;
        const maxHeight = Number.parseFloat(list.style.maxHeight);
        const didOpenUp = list.style.top === '';

        // The side it actually opened into, pinned before the height: a flipped popup carrying the
        // below-side height is the failure mode, and checking the height first would hide it.
        expect(didOpenUp, `height ${height}, trigger at ${top}: which side`).toBe(openedUp);
        expect(list.style.bottom === '').toBe(!openedUp);
        expect(maxHeight, `height ${height}, trigger at ${top}`).toBe(expected);
        // Each case renders into the same document, so the next iteration would find this list.
        cleanup();
      });
    }
  });
});
