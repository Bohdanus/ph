import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusable = (panel: HTMLElement) =>
  Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true'
  );

/**
 * The behaviour both mobile drawers declared with `aria-modal="true"` and never
 * implemented: move focus into the panel on open, close on Escape, keep Tab
 * inside the panel, and put focus back on whatever opened it.
 *
 * `aria-modal="true"` is a promise to assistive technology that the rest of the
 * page is inert while the drawer is open. Without this hook that promise is
 * false — a keyboard user tabs straight out of the open drawer into the canvas
 * toolbar behind it, and Escape does nothing.
 *
 * `onClose` is read through a ref rather than listed as an effect dependency:
 * every caller passes an inline arrow (`() => setIsMenuOpen(false)`), so a
 * dependency on its identity would re-run the effect on every render, re-steal
 * focus into the panel and re-fire the restore. The effect must run exactly
 * when `isOpen` flips, and `panelRef` is stable for the component's lifetime.
 */
export function useModalA11y(isOpen: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;

    const panel = panelRef.current;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab' || !panel) return;

      const focusable = getFocusable(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || active === panel || !panel.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || active === panel || !panel.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const restoreTo = restoreFocusRef.current;
      restoreFocusRef.current = null;
      restoreTo?.focus();
    };
  }, [isOpen, panelRef]);
}
