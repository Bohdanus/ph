import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogFocusContainment } from '../useDialogFocusContainment.ts';

/**
 * Focus-trap coverage for `useDialogFocusContainment`.
 *
 * The hook is the single focus implementation behind `NewImageDialog` and `SaveDialog`,
 * both of which attach `panelRef` and `handleKeyDown` to the SAME `role="dialog"`
 * element — so every test here mounts a real panel with both, and dispatches through
 * the rendered tree. A detached node or a bare `renderHook` cannot exercise either arm:
 * the React handler only fires for events that bubble from inside the panel, and the
 * document capture arm only fires for events that never reach it.
 *
 * The hook imports nothing but React, so no store mock is needed.
 */

type PanelSpec = {
  /** The header close button, in DOM order BEFORE the controls — the autofocus trap. */
  closeButton?: boolean;
  controls?: React.ReactNode;
};

/**
 * Renders a panel wired exactly as the two production consumers wire it, and returns
 * the panel element so a keydown can be dispatched through the real tree.
 */
function renderPanel({ closeButton = true, controls }: PanelSpec = {}) {
  const onEscape = vi.fn();

  function Harness() {
    const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape });
    return (
      <div ref={panelRef} onKeyDown={handleKeyDown} role="dialog" aria-label="test dialog">
        {closeButton && <button type="button">Close</button>}
        {controls}
      </div>
    );
  }

  const { container, ...utils } = render(<Harness />);
  // The rendered panel — the same element the hook measured and attached to, so a
  // keydown dispatched here bubbles through the real React tree.
  return { ...utils, onEscape, panel: container.querySelector<HTMLElement>('[role="dialog"]')! };
}

/** Dispatches a real bubbling keydown from inside the panel, as a keystroke would. */
function keyDownFrom(panel: HTMLElement, init: { key: string; shiftKey?: boolean }) {
  panel.dispatchEvent(new KeyboardEvent('keydown', { key: init.key, shiftKey: init.shiftKey, bubbles: true }));
}

afterEach(() => {
  // The hook's unmount restores focus to whatever was focused before it mounted, so a
  // leftover focused control would leak into the next test's mount assertion.
  document.body.focus?.();
  document.body.innerHTML = '';
});

describe('useDialogFocusContainment', () => {
  describe('mount focus', () => {
    it('moves focus to the first text-like control, never the header close button', () => {
      // The close button is first in DOM order, so a plain "first focusable" autofocus
      // would land on it — and a close button is not text-like, so the app's document
      // shortcut suppression would let a keystroke straight through, re-opening the hole
      // the focus move exists to close.
      const { panel } = renderPanel({
        controls: (
          <>
            <input type="text" aria-label="name" />
            <button type="button">Save</button>
          </>
        ),
      });

      const close = panel.querySelector('button')!;
      const text = panel.querySelector('input')!;

      expect(document.activeElement).toBe(text);
      expect(document.activeElement).not.toBe(close);
    });

    it('falls back to the first focusable when the panel has no text-like control', () => {
      const { panel } = renderPanel({
        closeButton: false,
        controls: <button type="button">Save</button>,
      });

      expect(document.activeElement).toBe(panel.querySelector('button'));
    });
  });

  describe('escape from outside the panel', () => {
    it('reaches onEscape from a body-targeted escape through the document capture arm', () => {
      // A React onKeyDown on the panel can never see this event: its target is <body>,
      // which is not a descendant of the panel. A dialog that cannot be closed by
      // keyboard is a trap, so the document capture arm dispatches it itself.
      const { onEscape } = renderPanel({ controls: <input type="text" aria-label="name" /> });

      expect(onEscape).not.toHaveBeenCalled();

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('cancels default actions for suppressed keys that start outside the panel', () => {
      const { panel } = renderPanel({ controls: <input type="text" aria-label="name" /> });
      const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true });

      document.body.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(panel.contains(document.activeElement)).toBe(true);
    });

    it('reaches onEscape from an escape raised inside the panel', () => {
      const { onEscape, panel } = renderPanel({ controls: <input type="text" aria-label="name" /> });

      keyDownFrom(panel, { key: 'Escape' });

      expect(onEscape).toHaveBeenCalledTimes(1);
    });

    it('uses the latest onEscape rather than the one captured at mount', () => {
      // The mount effect runs once, so it cannot close over a live `onEscape` without
      // pinning the first one the parent passed. Re-rendering the SAME hook instance with
      // a different callback identity is what says it did not: a caller that swaps the
      // callback must not keep dispatching the old one.
      const first = vi.fn();
      const second = vi.fn();

      function Swapping({ onEscape: cb }: { onEscape: () => void }) {
        const { panelRef, handleKeyDown } = useDialogFocusContainment({ onEscape: cb });
        return (
          <div ref={panelRef} onKeyDown={handleKeyDown} role="dialog">
            <input type="text" aria-label="name" />
          </div>
        );
      }

      const { rerender } = render(<Swapping onEscape={first} />);
      rerender(<Swapping onEscape={second} />);

      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('tab wrap', () => {
    it('wraps Tab from the last control back to the first', () => {
      const { panel } = renderPanel({
        closeButton: false,
        controls: (
          <>
            <input type="text" aria-label="first" />
            <input type="text" aria-label="second" />
          </>
        ),
      });
      const [first, second] = [...panel.querySelectorAll('input')];
      second.focus();
      expect(document.activeElement).toBe(second);

      keyDownFrom(panel, { key: 'Tab' });

      expect(document.activeElement).toBe(first);
    });

    it('wraps Shift+Tab from the first control to the last', () => {
      const { panel } = renderPanel({
        closeButton: false,
        controls: (
          <>
            <input type="text" aria-label="first" />
            <input type="text" aria-label="second" />
          </>
        ),
      });
      const [first, second] = [...panel.querySelectorAll('input')];
      first.focus();
      expect(document.activeElement).toBe(first);

      keyDownFrom(panel, { key: 'Tab', shiftKey: true });

      expect(document.activeElement).toBe(second);
    });

    it('skips a disabled control at the wrap endpoint rather than stranding focus', () => {
      // focus() on a disabled control is a no-op, so wrapping to one would eat the
      // keystroke AND leave focus where it was — no forward or backward route to any
      // of the controls in between.
      const { panel } = renderPanel({
        closeButton: false,
        controls: (
          <>
            <input type="text" aria-label="first" />
            <input type="text" aria-label="middle" />
            <input type="text" aria-label="disabled-last" disabled />
          </>
        ),
      });
      const [first, middle, disabled] = [...panel.querySelectorAll('input')];
      middle.focus();
      expect(document.activeElement).toBe(middle);

      keyDownFrom(panel, { key: 'Tab' });

      // The enabled last control is `middle`, so the wrap target is `first` and the
      // disabled trailing control is never focused.
      expect(document.activeElement).toBe(first);
      expect(document.activeElement).not.toBe(disabled);
    });
  });

  describe('unmount', () => {
    it('restores focus to the element that was focused before it mounted', () => {
      const opener = document.createElement('button');
      opener.type = 'button';
      document.body.appendChild(opener);
      opener.focus();
      expect(document.activeElement).toBe(opener);

      const { unmount } = renderPanel({ controls: <input type="text" aria-label="name" /> });
      expect(document.activeElement).not.toBe(opener);

      unmount();

      expect(document.activeElement).toBe(opener);
    });
  });
});
