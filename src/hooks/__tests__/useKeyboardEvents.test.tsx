import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider, useKeyDownShortcut, type KeyboardShortcut } from '../useKeyboardEvents';

const ShortcutProbe = ({ shortcut }: { shortcut: KeyboardShortcut }) => {
  useKeyDownShortcut(shortcut);
  return null;
};

describe('useKeyboardEvents', () => {
  it('handles mod shortcuts and supports preventDefault', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'z', mod: true, preventDefault: true, onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const keyDownEvent = new KeyboardEvent('keydown', {
      key: 'z',
      metaKey: true,
      cancelable: true,
      bubbles: true,
    });

    document.dispatchEvent(keyDownEvent);

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(keyDownEvent.defaultPrevented).toBe(true);
  });

  it('does not trigger shortcuts in editable inputs by default', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input data-testid="input" />
        <ShortcutProbe shortcut={{ key: 'v', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const input = screen.getByTestId('input');
    input.focus();
    fireEvent.keyDown(input, { key: 'v' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('can trigger shortcuts in editable inputs when explicitly enabled', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input data-testid="input" />
        <ShortcutProbe shortcut={{ key: 'Escape', allowInInput: true, onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const input = screen.getByTestId('input');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('respects explicit no-modifier shortcuts', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <ShortcutProbe shortcut={{ key: 'v', mod: false, onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const pasteLikeKeyDown = new KeyboardEvent('keydown', {
      key: 'v',
      metaKey: true,
      bubbles: true,
    });

    document.dispatchEvent(pasteLikeKeyDown);

    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
