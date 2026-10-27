import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardEventsProvider, useKeyDownShortcut, type KeyboardShortcut } from '../useKeyboardEvents';
import {
  claimDocumentGesture,
  isDocumentGestureOpen,
  releaseDocumentGesture,
  resetDocumentGestures,
} from '../document-gesture';

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

  /**
   * §47: a gesture that commits on release holds the document, and a
   * document-mutating shortcut pressed in that window corrupts it — undo/redo
   * replaces `selections` from the SAME `history` array, so `history.length`
   * never moves and the pending commit's truncate then destroys the redo tail
   * with no other symptom. The gate is the input layer, so the refusal is
   * observable here as the handler never running.
   */
  describe('document gesture gate', () => {
    // The gesture slot is module-level and outlives every mount, so a case that
    // leaks a claim would refuse every later keystroke in this file — and a
    // failure in one case would read as a failure in all of them. Torn down
    // after every case, deliberately.
    afterEach(() => {
      resetDocumentGestures();
    });

    it('refuses a document-mutating shortcut while a gesture is open', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'z', mod: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      claimDocumentGesture('rectangular-selection', 1);
      fireEvent.keyDown(document, { key: 'z', metaKey: true });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('runs the same shortcut again once the gesture is released', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'z', mod: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      claimDocumentGesture('rectangular-selection', 1);
      fireEvent.keyDown(document, { key: 'z', metaKey: true });
      releaseDocumentGesture('rectangular-selection', 1);
      fireEvent.keyDown(document, { key: 'z', metaKey: true });

      // The gate is a window, not a one-way switch: with no gesture open the
      // shortcut is the ordinary registration again.
      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('refuses a registration that never mentions mutatesDocument, because the default is safe', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'v', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      claimDocumentGesture('polygon-selection', 4);
      fireEvent.keyDown(document, { key: 'v' });

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('runs a registration that opted out, so a gesture can still be ended by the keyboard', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'Escape', allowInInput: true, mutatesDocument: false, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      // The exemption is what keeps the gate from bricking a gesture: `Escape` is
      // the designed way out of the draft the gesture is drawing, and `Enter` is
      // its end. Refusing either would leave the user holding a pointer they
      // cannot finish.
      claimDocumentGesture('polygon-selection', 4);
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('leaves the browser default alone and falls through to a lower-priority match, exactly like a disabled shortcut', () => {
      const refused = vi.fn();
      const lowerPriority = vi.fn();

      render(
        <KeyboardEventsProvider>
          {/* Registered first, so the refused one is the later match. The
              fall-through is only observable for a registration that is not
              itself gated, which is the real shape: a component's own `Escape`
              (exempt) loses the key to a refused document-mutating match and
              then gets it back. */}
          <ShortcutProbe shortcut={{ key: 'k', mutatesDocument: false, onKeyDown: lowerPriority }} />
          <ShortcutProbe shortcut={{ key: 'k', preventDefault: true, onKeyDown: refused }} />
        </KeyboardEventsProvider>
      );

      claimDocumentGesture('layer-transform', 2);
      const keyDownEvent = new KeyboardEvent('keydown', { key: 'k', cancelable: true, bubbles: true });
      document.dispatchEvent(keyDownEvent);

      expect(refused).not.toHaveBeenCalled();
      // The gate sits NEXT TO `enabled`, not after `preventDefault`, so a refusal
      // never hands the browser a default it has not had — the app has to keep
      // cancelling it for the lifetime of a press it might legitimately claim
      // later, and `preventDefault` here would be exactly that claim.
      expect(keyDownEvent.defaultPrevented).toBe(false);
      // And it is a `continue`, not a `break`: the loop keeps looking, so a
      // registration the gesture does not gate is still reachable.
      expect(lowerPriority).toHaveBeenCalledTimes(1);
    });

    it('starts with no gesture open, so a claim leaked by a previous mount cannot gate this one', () => {
      const onKeyDown = vi.fn();

      // Leaked from a mount that is already gone — the hazard a module-level slot
      // creates, and the reason the provider clears it on mount.
      claimDocumentGesture('brush-stroke', 3);

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'v', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      fireEvent.keyDown(document, { key: 'v' });

      expect(isDocumentGestureOpen()).toBe(false);
      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('drops the claim when the provider unmounts, so a dead mount cannot leave the keyboard dead', () => {
      const onKeyDown = vi.fn();

      const { unmount } = render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'v', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      claimDocumentGesture('shape-draw', 6);
      unmount();

      expect(isDocumentGestureOpen()).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('matches mod:true when only ctrlKey is pressed (cross-platform modifier)', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'b', mod: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, metaKey: false, bubbles: true }));

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it('does not match when shift:false is explicit and shiftKey is pressed', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'a', shift: false, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', shiftKey: true, bubbles: true }));

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('requires alt:true specifically — ctrl alone does not satisfy it', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'a', alt: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, altKey: false, bubbles: true }));

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('does not re-fire on auto-repeat keys for non-repeat shortcuts', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'a', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true, bubbles: true }));

      expect(onKeyDown).not.toHaveBeenCalled();
    });

    it('fires safely on a non-Element target (document / null target path)', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'z', onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }));

      expect(onKeyDown).toHaveBeenCalledTimes(1);
    });

    it.fails('does not call preventDefault on auto-repeat for shortcuts that opt out of repeat', () => {
      const onKeyDown = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'a', preventDefault: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      const repeatEvent = new KeyboardEvent('keydown', {
        key: 'a',
        repeat: true,
        cancelable: true,
        bubbles: true,
      });

      document.dispatchEvent(repeatEvent);

      expect(repeatEvent.defaultPrevented).toBe(false);
    });

    it.fails('stopPropagation prevents other document-level keydown listeners from firing', () => {
      const onKeyDown = vi.fn();
      const spy = vi.fn();

      render(
        <KeyboardEventsProvider>
          <ShortcutProbe shortcut={{ key: 'a', stopPropagation: true, onKeyDown }} />
        </KeyboardEventsProvider>
      );

      document.addEventListener('keydown', spy);

      try {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

        expect(spy).not.toHaveBeenCalled();
      } finally {
        document.removeEventListener('keydown', spy);
      }
    });
  });
});
