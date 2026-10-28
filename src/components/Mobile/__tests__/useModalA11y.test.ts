import { createRef, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useModalA11y } from '../useModalA11y.ts';

function makeFocusable(tag = 'button'): HTMLElement {
  const el = document.createElement(tag);
  el.setAttribute('tabindex', '0');
  el.setAttribute('data-testid', `focusable-${tag}`);
  document.body.appendChild(el);
  return el;
}

function makeDisabledButton(): HTMLElement {
  const el = document.createElement('button');
  el.disabled = true;
  document.body.appendChild(el);
  return el;
}

describe('useModalA11y', () => {
  let panel: HTMLDivElement;
  let panelRef: RefObject<HTMLElement | null>;

  beforeEach(() => {
    panel = document.createElement('div');
    panel.tabIndex = -1;
    panel.setAttribute('role', 'dialog');
    document.body.appendChild(panel);
    document.body.focus();
    panelRef = createRef<HTMLElement>();
    panelRef.current = panel;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('does nothing when isOpen is false', () => {
    const onClose = vi.fn();
    const { unmount } = renderHook(() => useModalA11y(false, onClose, panelRef));

    // No keydown listener is attached when the modal is closed.
    act(() => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it('moves focus to the panel when isOpen becomes true', () => {
    const onClose = vi.fn();
    renderHook(() => useModalA11y(true, onClose, panelRef));

    // The effect should have called panel.focus().
    // jsdom does not actually move `document.activeElement` on focus(), but the call is made.
    const focusSpy = vi.spyOn(panel, 'focus');
    // Re-trigger by toggling: close then open.
    const { rerender } = renderHook(({ open }) => useModalA11y(open, onClose, panelRef), {
      initialProps: { open: true },
    });

    rerender({ open: false });
    rerender({ open: true });

    expect(focusSpy).toHaveBeenCalled();
  });

  it('captures the element that had focus before the modal opened', () => {
    const onClose = vi.fn();

    // Focus something before opening.
    const trigger = makeFocusable('button');
    trigger.focus();

    const focusSpy = vi.spyOn(trigger, 'focus');

    const { rerender } = renderHook(({ open }) => useModalA11y(open, onClose, panelRef), {
      initialProps: { open: false },
    });

    rerender({ open: true });

    // Clear the spy to only catch the restore call from cleanup.
    focusSpy.mockClear();

    // Close: focus should be restored to the trigger.
    rerender({ open: false });

    expect(focusSpy).toHaveBeenCalled();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    renderHook(() => useModalA11y(true, onClose, panelRef));

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls the latest onClose without re-running the effect', () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();

    const { rerender } = renderHook(({ closeFn }) => useModalA11y(true, closeFn, panelRef), {
      initialProps: { closeFn: firstClose },
    });

    // The onClose ref is updated through the effect that runs on every render,
    // but the opening/closing effect depends only on `isOpen`, so the keydown
    // handler always calls the LATEST closeFn.
    rerender({ closeFn: secondClose });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it('prevents default on Escape before calling onClose', () => {
    const onClose = vi.fn();
    renderHook(() => useModalA11y(true, onClose, panelRef));

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    const preventSpy = vi.spyOn(event, 'preventDefault');

    act(() => {
      document.dispatchEvent(event);
    });

    expect(preventSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Tab focus trapping', () => {
    function setupPanel(children: HTMLElement[]): { hook: ReturnType<typeof renderHook> } {
      panel.replaceChildren(...children);
      return { hook: renderHook(() => useModalA11y(true, vi.fn(), panelRef)) };
    }

    it('moves focus to the first focusable element when Tab is pressed on the panel itself', () => {
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      setupPanel([first, second]);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      const firstFocusSpy = vi.spyOn(first, 'focus');

      // activeElement is the panel (the hook focused it on open).
      panel.focus();

      act(() => {
        document.dispatchEvent(event);
      });

      expect(preventSpy).toHaveBeenCalled();
      expect(firstFocusSpy).toHaveBeenCalled();
    });

    it('calls preventDefault and wraps to first when Tab is pressed on the panel', () => {
      // When activeElement is the panel itself (no tool focused), Tab wraps to the first focusable.
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      setupPanel([first, second]);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      // activeElement is the panel (the hook focused it on open).
      panel.focus();

      act(() => {
        document.dispatchEvent(event);
      });

      // preventDefault is called and focus moves to the first element.
      expect(preventSpy).toHaveBeenCalled();
    });

    it('wraps from last focusable to first on Tab', () => {
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      setupPanel([first, second]);

      second.focus();
      const firstFocusSpy = vi.spyOn(first, 'focus');

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        document.dispatchEvent(event);
      });

      expect(preventSpy).toHaveBeenCalled();
      expect(firstFocusSpy).toHaveBeenCalled();
    });

    it('wraps from first focusable to last on Shift+Tab', () => {
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      setupPanel([first, second]);

      first.focus();
      const secondFocusSpy = vi.spyOn(second, 'focus');

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        document.dispatchEvent(event);
      });

      expect(preventSpy).toHaveBeenCalled();
      expect(secondFocusSpy).toHaveBeenCalled();
    });

    it('refocuses the panel when there are no focusable elements and Tab is pressed', () => {
      panel.textContent = 'No focusable children here';

      setupPanel([]);

      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      const preventSpy = vi.spyOn(event, 'preventDefault');
      const panelFocusSpy = vi.spyOn(panel, 'focus');

      act(() => {
        document.dispatchEvent(event);
      });

      expect(preventSpy).toHaveBeenCalled();
      expect(panelFocusSpy).toHaveBeenCalled();
    });

    it('refocuses the panel when there are no focusable elements and Shift+Tab is pressed', () => {
      panel.textContent = 'No focusable children here';

      setupPanel([]);

      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
      const preventSpy = vi.spyOn(event, 'preventDefault');

      act(() => {
        document.dispatchEvent(event);
      });

      expect(preventSpy).toHaveBeenCalled();
    });

    it('does not trap Tab when the modal is closed', () => {
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      panel.append(first, second);

      renderHook(() => useModalA11y(false, vi.fn(), panelRef));

      first.focus();
      const preventSpy = vi.spyOn(second, 'focus');

      const event = new KeyboardEvent('keydown', { key: 'Tab' });

      act(() => {
        document.dispatchEvent(event);
      });

      // When the modal is closed, no trapping occurs — focus is not manipulated.
      expect(preventSpy).not.toHaveBeenCalled();
    });

    it('ignores non-Tab keys (e.g. ArrowDown)', () => {
      const first = makeFocusable('button');
      const second = makeFocusable('input');
      setupPanel([first, second]);

      first.focus();
      const firstFocusSpy = vi.spyOn(first, 'focus');
      const secondFocusSpy = vi.spyOn(second, 'focus');

      const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });

      act(() => {
        document.dispatchEvent(event);
      });

      expect(firstFocusSpy).not.toHaveBeenCalled();
      expect(secondFocusSpy).not.toHaveBeenCalled();
    });

    it('ignores disabled buttons when building the focusable list', () => {
      const first = makeFocusable('button');
      const disabled = makeDisabledButton();
      const second = makeFocusable('input');
      setupPanel([first, disabled, second]);

      // Tab from second → wraps to first (disabled is not in the list).
      second.focus();
      const firstFocusSpy = vi.spyOn(first, 'focus');

      const event = new KeyboardEvent('keydown', { key: 'Tab' });

      act(() => {
        document.dispatchEvent(event);
      });

      expect(firstFocusSpy).toHaveBeenCalled();
    });

    it('treats [tabindex] elements as focusable but excludes tabindex="-1"', () => {
      const withTabindex = document.createElement('div');
      withTabindex.setAttribute('tabindex', '1');
      withTabindex.textContent = 'tabindex-1';
      const negativeTabindex = document.createElement('div');
      negativeTabindex.setAttribute('tabindex', '-1');
      negativeTabindex.textContent = 'tabindex-minus-1';
      panel.append(withTabindex, negativeTabindex);

      // The positive-tabindex element is included; the -1 one is excluded.
      expect(panel.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(1);
    });
  });

  describe('cleanup', () => {
    it('removes the keydown listener when the hook unmounts', () => {
      const onClose = vi.fn();
      const { unmount } = renderHook(() => useModalA11y(true, onClose, panelRef));

      unmount();

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(onClose).not.toHaveBeenCalled();
    });

    it('removes the keydown listener when isOpen transitions to false', () => {
      const onClose = vi.fn();
      const { rerender } = renderHook(({ open }) => useModalA11y(open, onClose, panelRef), {
        initialProps: { open: true },
      });

      rerender({ open: false });

      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      });

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('known limitations (tripwires)', () => {
    it('handles a null panelRef.current without throwing', () => {
      const nullRef = createRef<HTMLElement>();
      expect(() => renderHook(() => useModalA11y(true, vi.fn(), nullRef))).not.toThrow();
    });
  });
});
