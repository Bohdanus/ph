import React, { useCallback, useState } from 'react';

import { MobileHeader } from './MobileHeader.tsx';
import { MobileToolSheet } from './MobileToolSheet.tsx';
import { MobileBottomBar } from './MobileBottomBar.tsx';
import { MobileLayersDrawer } from './MobileLayersDrawer.tsx';
import { MobileMenuDrawer } from './MobileMenuDrawer.tsx';

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
