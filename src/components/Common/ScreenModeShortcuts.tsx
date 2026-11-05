import { useEffect, useRef } from 'react';
import { useStore } from '../../contexts/StoreContext.tsx';
import { useScreenMode } from '../../contexts/ScreenMode.tsx';
import { useIsMobileViewport } from '../../hooks/useMediaQuery.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';

const INTERACTIVE_CONTROL = 'button, a[href], input, select, textarea, summary, [contenteditable="true"]';

/**
 * `Tab` belongs to keyboard navigation everywhere except where there is nothing to navigate: no
 * focus at all, or the canvas surface. A control keeps its `Tab`, and so does the canvas surface
 * when the keyboard put focus there — the view tools' `tabIndex={0}` surface would otherwise be a
 * trap Tab could reach and never leave. Clicked into, it toggles as Photoshop does.
 * `focusedByPointer` is the caller's record of how focus last arrived. Focus traps
 * (`useDialogFocusContainment`, the rail flyouts, the first-use tour) and plain tabbing through
 * the shell are untouched.
 */
export function isPanelToggleTarget(target: EventTarget | null, focusedByPointer: boolean): boolean {
  if (target === null || target === document.body || target === document.documentElement) return true;
  if (!(target instanceof Element)) return false;
  if (target.matches(INTERACTIVE_CONTROL)) return false;
  if (target.closest('[data-testid="workspace-container"]') === null) return false;

  return !target.hasAttribute('tabindex') || focusedByPointer;
}

/**
 * Whether the user last reached the focused element with a pointer — a click, or a `focus()` from a
 * pointer-down handler — rather than with the keyboard. A press counts even when focus does not
 * move, since clicking the element that already has focus fires no `focusin`.
 */
function useFocusedByPointer() {
  const focusedByPointerRef = useRef(false);

  useEffect(() => {
    let pointerDown = false;
    const press = () => {
      pointerDown = true;
      focusedByPointerRef.current = true;
    };
    const release = () => (pointerDown = false);
    const focusIn = () => (focusedByPointerRef.current = pointerDown);

    document.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    document.addEventListener('focusin', focusIn, true);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      document.removeEventListener('focusin', focusIn, true);
    };
  }, []);

  return focusedByPointerRef;
}

/**
 * Photoshop's screen keys: `Tab` hides or shows the toolbar, options bar and panels; `F` and
 * `Shift+F` cycle the three screen modes forward and back; `Esc` leaves Full Screen Mode.
 *
 * Desktop and tablet only — the phone shell has none of these regions and no screen modes.
 * `Shift+Tab` (panels only) is not modelled, and neither is `Tab` inside Full Screen Mode, where
 * Photoshop shows the panels over the canvas; here `full` hides every region.
 */
export const ScreenModeShortcuts = () => {
  const [{ hasImage, previewLayers }] = useStore();
  const isMobile = useIsMobileViewport();
  const { screenMode, cycleScreenMode, exitFullScreen, togglePanels } = useScreenMode();
  const enabled = hasImage && !isMobile;
  const focusedByPointerRef = useFocusedByPointer();

  // No `preventDefault` on the registration: the handler claims the key only when it acts, so a
  // `Tab` it declines still moves focus.
  useKeyDownShortcut({
    key: 'Tab',
    mod: false,
    shift: false,
    alt: false,
    enabled: enabled && screenMode !== 'full',
    onKeyDown: (event) => {
      if (!isPanelToggleTarget(event.target, focusedByPointerRef.current)) return;
      event.preventDefault();
      togglePanels();
    },
  });

  useKeyDownShortcut({
    key: 'f',
    mod: false,
    alt: false,
    enabled,
    onKeyDown: (event) => cycleScreenMode(event.shiftKey ? -1 : 1),
  });

  // The browser takes `Esc` itself while it is fullscreen and reports it as `fullscreenchange`,
  // which the provider handles. This registration is the exit for the in-window fallback.
  // Photoshop cancels a pending operation before it leaves the screen mode, so `Esc` is declined
  // while any layer holds an uncommitted preview: Free Transform's own window listener then cancels
  // it, and the next press leaves Full Screen. Tool areas' own `Escape` registrations come later
  // and win outright; the lasso areas and Crop claim `Esc` even with no draft, so with those tools
  // the fallback is left with `F`.
  useKeyDownShortcut({
    key: 'Escape',
    mod: false,
    enabled: enabled && screenMode === 'full',
    onKeyDown: (event) => {
      if (Object.keys(previewLayers.current).length > 0) return;
      event.preventDefault();
      exitFullScreen();
    },
  });

  return null;
};
