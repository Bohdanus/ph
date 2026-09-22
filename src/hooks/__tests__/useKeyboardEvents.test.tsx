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

  it('does not trigger shortcuts in text inputs by default', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input type="text" data-testid="input" />
        <ShortcutProbe shortcut={{ key: 'v', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const input = screen.getByTestId('input');
    input.focus();
    fireEvent.keyDown(input, { key: 'v' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('triggers shortcuts in range inputs even without allowInInput', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input type="range" data-testid="slider" />
        <ShortcutProbe shortcut={{ key: 'Escape', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const slider = screen.getByTestId('slider');
    slider.focus();
    fireEvent.keyDown(slider, { key: 'Escape' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('triggers shortcuts in checkbox inputs even without allowInInput', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input type="checkbox" data-testid="checkbox" />
        <ShortcutProbe shortcut={{ key: 'Enter', onKeyDown }} />
      </KeyboardEventsProvider>
    );

    const checkbox = screen.getByTestId('checkbox');
    checkbox.focus();
    fireEvent.keyDown(checkbox, { key: 'Enter' });

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('can trigger shortcuts in text inputs when explicitly enabled', () => {
    const onKeyDown = vi.fn();

    render(
      <KeyboardEventsProvider>
        <input type="text" data-testid="input" />
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

  describe('input type handling', () => {
    it('blocks shortcuts in text inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="text" data-testid="input" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const input = screen.getByTestId('input');
      input.focus();
      fireEvent.keyDown(input, { key: 'a' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('blocks shortcuts in password inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="password" data-testid="password" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const password = screen.getByTestId('password');
      password.focus();
      fireEvent.keyDown(password, { key: 'a' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('blocks shortcuts in email inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="email" data-testid="email" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const email = screen.getByTestId('email');
      email.focus();
      fireEvent.keyDown(email, { key: 'a' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('allows shortcuts in range inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="range" data-testid="range" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const range = screen.getByTestId('range');
      range.focus();
      fireEvent.keyDown(range, { key: 'a' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('allows shortcuts in radio inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="radio" data-testid="radio" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const radio = screen.getByTestId('radio');
      radio.focus();
      fireEvent.keyDown(radio, { key: 'a' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('allows shortcuts in checkbox inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="checkbox" data-testid="checkbox" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const checkbox = screen.getByTestId('checkbox');
      checkbox.focus();
      fireEvent.keyDown(checkbox, { key: 'a' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('allows shortcuts in color inputs', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="color" data-testid="color" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const color = screen.getByTestId('color');
      color.focus();
      fireEvent.keyDown(color, { key: 'a' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('blocks shortcuts in textarea', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <textarea data-testid="textarea" />
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const textarea = screen.getByTestId('textarea');
      textarea.focus();
      fireEvent.keyDown(textarea, { key: 'a' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('blocks shortcuts in select elements', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <select data-testid="select">
            <option>Option 1</option>
          </select>
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const select = screen.getByTestId('select');
      select.focus();
      fireEvent.keyDown(select, { key: 'a' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });
  });

  describe('lasso tool shortcuts', () => {
    it('fires Escape shortcut in range input with allowInInput', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="range" data-testid="slider" />
          <ShortcutProbe shortcut={{ key: 'Escape', allowInInput: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const slider = screen.getByTestId('slider');
      slider.focus();
      fireEvent.keyDown(slider, { key: 'Escape' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('fires Backspace shortcut in range input with allowInInput', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="range" data-testid="slider" />
          <ShortcutProbe shortcut={{ key: 'Backspace', allowInInput: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const slider = screen.getByTestId('slider');
      slider.focus();
      fireEvent.keyDown(slider, { key: 'Backspace' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('fires Enter shortcut in range input with allowInInput', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="range" data-testid="slider" />
          <ShortcutProbe shortcut={{ key: 'Enter', allowInInput: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const slider = screen.getByTestId('slider');
      slider.focus();
      fireEvent.keyDown(slider, { key: 'Enter' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('fires Delete shortcut in range input with allowInInput', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <input type="range" data-testid="slider" />
          <ShortcutProbe shortcut={{ key: 'Delete', allowInInput: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const slider = screen.getByTestId('slider');
      slider.focus();
      fireEvent.keyDown(slider, { key: 'Delete' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });
  });
});
