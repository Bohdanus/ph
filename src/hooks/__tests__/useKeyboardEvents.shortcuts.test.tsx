import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider, useKeyDownShortcut, type KeyboardShortcut } from '../useKeyboardEvents';

/**
 * Modifier/guard coverage for `useKeyboardEvents`.
 *
 * `useKeyboardEvents.test.tsx` is a Solid file that covers the input-type
 * matrix; this file covers the remaining guard branches: explicit ctrl/shift/
 * alt/meta matching, `enabled`, `stopPropagation`, contenteditable targets,
 * non-Element targets, registration order/unregistration, and the provider
 * contract.
 */

const ShortcutProbe = ({ shortcut }: { shortcut: KeyboardShortcut }) => {
  useKeyDownShortcut(shortcut);
  return null;
};

function renderWithShortcut(shortcut: KeyboardShortcut) {
  return render(
    <KeyboardEventsProvider>
      <ShortcutProbe shortcut={shortcut} />
    </KeyboardEventsProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useKeyboardEvents modifiers', () => {
  it('matches a single character key regardless of case', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'A', onKeyDown });

    fireEvent.keyDown(document, { key: 'a' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('does not match a different key', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'z', onKeyDown });

    fireEvent.keyDown(document, { key: 'y' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it.each([
    ['ctrl', { ctrl: true }, { ctrlKey: true }, { ctrlKey: false }],
    ['shift', { shift: true }, { shiftKey: true }, { shiftKey: false }],
    ['alt', { alt: true }, { altKey: true }, { altKey: false }],
    ['meta', { meta: true }, { metaKey: true }, { metaKey: false }],
  ] as const)('requires the %s modifier to be held', (_name, spec, pressed, released) => {
    const onKeyDown = vi.fn();
    const shortcut: KeyboardShortcut = { key: 'a', ...spec, onKeyDown };
    const { rerender } = render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={shortcut} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(document, { key: 'a', ...released });
    expect(onKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: 'a', ...pressed });
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    // The same test object keeps working after a re-render with a fresh object
    // identity, i.e. the getter registered once always reads the latest spec.
    rerender(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', ...spec, onKeyDown }} />
      </KeyboardEventsProvider>
    );
    fireEvent.keyDown(document, { key: 'a', ...pressed });
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it('treats ctrl and meta interchangeably for mod shortcuts', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 's', mod: true, onKeyDown });

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(document, { key: 's' });
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it('rejects a mod shortcut when meta or ctrl is held unexpectedly', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'v', mod: false, onKeyDown });

    fireEvent.keyDown(document, { key: 'v', metaKey: true });
    fireEvent.keyDown(document, { key: 'v', ctrlKey: true });

    expect(onKeyDown).not.toHaveBeenCalled();
  });
});

describe('useKeyboardEvents guards', () => {
  it('skips a disabled shortcut and runs it again once re-enabled', () => {
    const onKeyDown = vi.fn();
    const { rerender } = render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', enabled: false, onKeyDown }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(document, { key: 'a' });
    expect(onKeyDown).not.toHaveBeenCalled();

    rerender(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', enabled: true, onKeyDown }} />
      </KeyboardEventsProvider>
    );
    fireEvent.keyDown(document, { key: 'a' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('stops the event before it leaves the document when stopPropagation is set', () => {
    const onKeyDown = vi.fn();
    const above = vi.fn();
    window.addEventListener('keydown', above);

    renderWithShortcut({ key: 'a', stopPropagation: true, onKeyDown });
    fireEvent.keyDown(document.body, { key: 'a', bubbles: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    // `stopPropagation` cannot unregister sibling listeners on `document`
    // itself, but it does stop the event from reaching `window`.
    expect(above).not.toHaveBeenCalled();
    window.removeEventListener('keydown', above);
  });

  it('lets the event propagate to window by default and leaves the default action alone', () => {
    const onKeyDown = vi.fn();
    const outer = vi.fn();
    const above = vi.fn();
    document.addEventListener('keydown', outer);
    window.addEventListener('keydown', above);

    renderWithShortcut({ key: 'a', onKeyDown });
    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true, bubbles: true });
    document.body.dispatchEvent(event);

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(above).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
    document.removeEventListener('keydown', outer);
    window.removeEventListener('keydown', above);
  });

  it('blocks shortcuts inside a contenteditable element and its descendants', () => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <div contentEditable data-testid="editable">
          <span data-testid="child">edit me</span>
        </div>
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(screen.getByTestId('editable'), { key: 'a' });
    expect(onKeyDown).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('child'), { key: 'a' });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('allows shortcuts when the event target is not an element', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'a', onKeyDown });

    fireEvent.keyDown(document, { key: 'a' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it.each(['text', 'password', 'search', 'email', 'url', 'tel', 'number'])('blocks shortcuts in %s inputs', (type) => {
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <input type={type} data-testid="field" />
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(screen.getByTestId('field'), { key: 'a' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it.each(['range', 'radio', 'checkbox', 'color', 'file', 'date', 'button', 'submit'])(
    'allows shortcuts in %s inputs',
    (type) => {
      const onKeyDown = vi.fn();
      render(
        <KeyboardEventsProvider>
          <input type={type} data-testid="field" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      fireEvent.keyDown(screen.getByTestId('field'), { key: 'a' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    }
  );
});

describe('useKeyboardEvents auto-repeat', () => {
  it('fires a repeat:true registration on an auto-repeated keydown', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: '=', repeat: true, onKeyDown });

    fireEvent.keyDown(document, { key: '=', repeat: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('fires a repeat:true registration on the initial press as well', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: '=', repeat: true, onKeyDown });

    fireEvent.keyDown(document, { key: '=', repeat: false });
    fireEvent.keyDown(document, { key: '=', repeat: true });
    fireEvent.keyDown(document, { key: '=', repeat: true });

    expect(onKeyDown).toHaveBeenCalledTimes(3);
  });

  it('runs a default registration exactly once across a held key', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'Backspace', onKeyDown });

    fireEvent.keyDown(document, { key: 'Backspace', repeat: false });
    fireEvent.keyDown(document, { key: 'Backspace', repeat: true });
    fireEvent.keyDown(document, { key: 'Backspace', repeat: true });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('keeps the app claim on a suppressed auto-repeat: no re-fire, default still prevented', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'Backspace', preventDefault: true, onKeyDown });

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      repeat: true,
      cancelable: true,
      bubbles: true,
    });
    document.body.dispatchEvent(event);

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps preventing the default for a held key that allowInInput runs inside a contenteditable field', () => {
    // The layer-rename field in LayersTab is a contenteditable span whose local
    // onKeyDown does not stopPropagation, so a Backspace aimed at it reaches the
    // document listener while a lasso/polygon draft is active. Suppressing the
    // repeat must not hand the browser a held-Backspace default it has never had,
    // or the field mungs its own text for as long as the key is held.
    const onKeyDown = vi.fn();
    render(
      <KeyboardEventsProvider>
        <div contentEditable data-testid="rename-field" />
        <ShortcutProbe shortcut={{ key: 'Backspace', preventDefault: true, allowInInput: true, onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      repeat: true,
      cancelable: true,
      bubbles: true,
    });
    screen.getByTestId('rename-field').dispatchEvent(event);

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('still prevents the default for a repeat:true registration', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'Backspace', preventDefault: true, repeat: true, onKeyDown });

    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      repeat: true,
      cancelable: true,
      bubbles: true,
    });
    document.body.dispatchEvent(event);

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('never reaches a disabled shortcut, even one that opted into repeat', () => {
    const onKeyDown = vi.fn();
    renderWithShortcut({ key: 'a', enabled: false, repeat: true, onKeyDown });

    fireEvent.keyDown(document, { key: 'a', repeat: true });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('suppresses every default registration that matches a held key', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'Backspace', onKeyDown: first }} />
        <ShortcutProbe shortcut={{ key: 'Backspace', onKeyDown: second }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(document, { key: 'Backspace', repeat: true });

    expect(second).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it('keeps looking for a lower-priority match after a repeat is suppressed, like the enabled guard', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', repeat: true, onKeyDown: first }} />
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown: second }} />
      </KeyboardEventsProvider>
    );

    // The last registration wins on a normal press and suppresses the repeat.
    fireEvent.keyDown(document, { key: 'a', repeat: false });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    // The repeat gate is a guard, not a `break`: the loop continues, so an earlier
    // registration that opted into repeat still sees the event.
    fireEvent.keyDown(document, { key: 'a', repeat: true });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('useKeyboardEvents registration', () => {
  it('runs only the last registered matching shortcut', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown: first }} />
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown: second }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(document, { key: 'a' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('falls back to an earlier shortcut when the last one does not match', () => {
    const first = vi.fn();
    const second = vi.fn();
    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown: first }} />
        <ShortcutProbe shortcut={{ key: 'b', onKeyDown: second }} />
      </KeyboardEventsProvider>
    );

    fireEvent.keyDown(document, { key: 'a' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('unregisters a shortcut when its component unmounts', () => {
    const onKeyDown = vi.fn();
    const { unmount } = render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    unmount();
    fireEvent.keyDown(document, { key: 'a' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('removes the document listener when the provider unmounts', () => {
    const onKeyDown = vi.fn();
    const { unmount } = render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    unmount();
    fireEvent.keyDown(document, { key: 'a' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('throws when a shortcut is registered outside the provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => renderHook(() => useKeyDownShortcut({ key: 'a', onKeyDown: vi.fn() }))).toThrow(
      'useKeyboardEvents must be used within a KeyboardEventsProvider'
    );

    consoleError.mockRestore();
  });
});
