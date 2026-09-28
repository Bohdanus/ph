import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useIsTabletViewport } from '../hooks/useMediaQuery.ts';

export interface RightPanelVisibility {
  /** True only in the tablet band. Desktop has no toggle: the panel is simply always shown. */
  isCollapsible: boolean;
  /** Whether the Layers/History panel should occupy grid space right now. */
  isOpen: boolean;
  toggle: () => void;
}

const RightPanelVisibilityContext = createContext<RightPanelVisibility>({
  isCollapsible: false,
  isOpen: true,
  toggle: () => {},
});

/**
 * Collapses the Layers/History panel in the tablet band only.
 *
 * The tablet's problem is horizontal, not vertical: at 768px the desktop shell spends
 * 250px of 768 on the right panel, leaving the canvas 462px once the tool rail is taken
 * out. The panel is the one region that can be reclaimed without losing a feature, because
 * the layers it holds are still reachable — the tablet is not a separate code path, it is
 * this same tree with one column collapsed.
 *
 * Desktop is deliberately untouched. `isCollapsible` is false there, so `isOpen` is
 * unconditionally true, the panel renders exactly as it always has, and the toggle button
 * is hidden by `lg:hidden`. Widening the window to desktop therefore restores the panel
 * regardless of what the toggle was left at, which is what stops a tablet collapse from
 * becoming a desktop defect.
 */
export function RightPanelVisibilityProvider({ children }: { children: ReactNode }) {
  const isTablet = useIsTabletViewport();
  const [isToggledOpen, setIsToggledOpen] = useState(false);

  const value = useMemo<RightPanelVisibility>(
    () => ({
      isCollapsible: isTablet,
      // Collapsed by default in the tablet band, so the canvas gets the 250px back without
      // the user asking for it. Ignored on desktop, where the panel is always present.
      isOpen: !isTablet || isToggledOpen,
      toggle: () => setIsToggledOpen((open) => !open),
    }),
    [isTablet, isToggledOpen]
  );

  return <RightPanelVisibilityContext.Provider value={value}>{children}</RightPanelVisibilityContext.Provider>;
}

export function useRightPanelVisibility(): RightPanelVisibility {
  return useContext(RightPanelVisibilityContext);
}
