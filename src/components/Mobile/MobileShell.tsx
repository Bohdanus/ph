import React, { useCallback, useState } from 'react';

import { MobileHeader } from './MobileHeader.tsx';
import { MobileToolSheet } from './MobileToolSheet.tsx';
import { MobileBottomBar } from './MobileBottomBar.tsx';
import { MobileLayersDrawer } from './MobileLayersDrawer.tsx';
import { MobileMenuDrawer } from './MobileMenuDrawer.tsx';
import { useIsMobileViewport } from '../../hooks/useMediaQuery.ts';

export interface MobileShellProps {
  /**
   * Whether the tool-options sheet is open. Optional, and defaulted to `false`
   * here: the shell is the component that owns the mobile surface, and a missing
   * value must read as "closed" rather than as an uncontrolled truthy. The old
   * default of `true` put a 300px panel over the canvas on first paint, before
   * any user action.
   */
  isToolSheetOpen?: boolean;
  onToggleToolSheet: () => void;
  isLayersOpen?: boolean;
  onToggleLayers: () => void;
}

/**
 * The single mobile root. Returns a Fragment so it adds no box of its own to the
 * `AppContainer` grid — the header and bottom bar occupy the `header` and
 * `bottom` areas, the two drawers and the sheet are `position: fixed`, and `Main`
 * (rendered by `App.tsx`, not here) fills the `main` area. This component must
 * therefore never render a canvas or a `main` region.
 *
 * DOM order is load-bearing, not incidental: the navigation drawer is last so it
 * paints over the layers drawer, which paints over the tool sheet and the bar.
 */
export const MobileShell: React.FC<MobileShellProps> = ({
  isToolSheetOpen = false,
  onToggleToolSheet,
  isLayersOpen = false,
  onToggleLayers,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Close the menu on leaving the mobile band.
  //
  // The shell is mounted at every width and hidden with `md:hidden`, and `display: none`
  // hides without unmounting. So a surface left open on a phone stays *rendered* after the
  // window widens, and `MobileToolSheet` renders a second live instance of the active tool's
  // options panel alongside the one `ToolbarHorizontal` already owns — two
  // `id="font-size-input"`, two `id="font-family-select"`, and two `window`-level Escape
  // listeners. Duplicate ids break `getElementById`, `<label for>` and Playwright strict
  // mode, none of it on the path that a CSS-only crossing is supposed to leave untouched.
  //
  // Resetting state is the fix, not unmounting: unmounting is what the always-mounted design
  // exists to avoid, because it would tear down the canvas's siblings on a crossing.
  //
  // Adjusted during render rather than in an effect, which is React's documented pattern for
  // resetting state on an external change and avoids the extra render pass a setState in an
  // effect body costs. `isMenuOpen` is this component's own state, so the comparison against
  // the previous band is legal here. The two flags the shell does not own are reset by
  // `App.tsx`, which owns them.
  const isMobile = useIsMobileViewport();
  const [wasMobile, setWasMobile] = useState(isMobile);
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (!isMobile) setIsMenuOpen(false);
  }

  // `App.tsx` owns one callback for the layers surface, and it toggles. Passing it
  // straight through as `onClose` would make a backdrop click *reopen* the drawer
  // the user just dismissed, so the toggle is translated into a close that only
  // fires when there is something to close.
  const closeLayers = useCallback(() => {
    if (isLayersOpen) onToggleLayers();
  }, [isLayersOpen, onToggleLayers]);

  return (
    <>
      <MobileHeader
        onToggleLayers={onToggleLayers}
        isLayersOpen={isLayersOpen}
        onOpenMenu={() => setIsMenuOpen(true)}
        isMenuOpen={isMenuOpen}
      />
      <MobileToolSheet isOpen={isToolSheetOpen} onToggle={onToggleToolSheet} />
      <MobileBottomBar
        isToolSheetOpen={isToolSheetOpen}
        onToggleToolSheet={onToggleToolSheet}
        onOpenLayers={onToggleLayers}
      />
      <MobileLayersDrawer isOpen={isLayersOpen} onClose={closeLayers} />
      <MobileMenuDrawer isOpen={isMenuOpen} onClose={() => setIsMenuOpen(false)} />
    </>
  );
};
