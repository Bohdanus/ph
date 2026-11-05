import { useStore } from '../../contexts/StoreContext.tsx';
import { useScreenMode } from '../../contexts/ScreenMode.tsx';
import { useIsMobileViewport } from '../../hooks/useMediaQuery.ts';
import { useKeyDownShortcut } from '../../hooks/useKeyboardEvents.tsx';

const INTERACTIVE_CONTROL = 'button, a[href], input, select, textarea, summary, [contenteditable="true"]';

/**
 * `Tab` belongs to keyboard navigation everywhere except where there is nothing to navigate: no
 * focus at all, or focus on the canvas surface itself. A focused control keeps its `Tab`, so focus
 * traps (`useDialogFocusContainment`, the rail flyouts, the first-use tour) and plain tabbing
 * through the shell are untouched.
 */
export function isPanelToggleTarget(target: EventTarget | null): boolean {
  if (target === null || target === document.body || target === document.documentElement) return true;
  if (!(target instanceof Element)) return false;

  return target.closest('[data-testid="workspace-container"]') !== null && !target.matches(INTERACTIVE_CONTROL);
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
  const [{ hasImage }] = useStore();
  const isMobile = useIsMobileViewport();
  const { screenMode, cycleScreenMode, exitFullScreen, togglePanels } = useScreenMode();
  const enabled = hasImage && !isMobile;

  // No `preventDefault` on the registration: the handler claims the key only when it acts, so a
  // `Tab` it declines still moves focus.
  useKeyDownShortcut({
    key: 'Tab',
    mod: false,
    shift: false,
    alt: false,
    enabled: enabled && screenMode !== 'full',
    onKeyDown: (event) => {
      if (!isPanelToggleTarget(event.target)) return;
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
  useKeyDownShortcut({
    key: 'Escape',
    mod: false,
    preventDefault: true,
    enabled: enabled && screenMode === 'full',
    onKeyDown: exitFullScreen,
  });

  return null;
};
