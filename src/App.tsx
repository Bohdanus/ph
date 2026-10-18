import { useEffect, useRef, useState } from 'react';
import Menu from './components/Menu/Menu';
import Footer from './components/Footer/Footer';
import SidebarLeft from './components/SidebarLeft/SidebarLeft';
import SidebarRight from './components/SidebarRight/SidebarRight';
import Main from './components/Main/Main.tsx';
import { MobileShell } from './components/Mobile/MobileShell.tsx';

import { ThemeProvider } from './contexts/ThemeContext';
import { StoreProvider, useStore } from './contexts/StoreContext.tsx';
import { UnsavedChangesProvider } from './contexts/UnsavedChangesContext.tsx';
import { CurrentToolProvider } from './contexts/useCurrentTool.tsx';
import { FileProvider } from './contexts/useFile.tsx';
import { KeyboardEventsProvider } from './hooks/useKeyboardEvents.tsx';
import { AppKeyboardShortcuts } from './components/Common/AppKeyboardShortcuts.tsx';
import { ErrorBoundary } from './components/Common/ErrorBoundary.tsx';
import { FirstUseProvider } from './contexts/FirstUseContext.tsx';
import { FirstUseTour, hasSeenFirstUseTour } from './components/Common/FirstUseTour.tsx';
import { useApp } from './hooks/useApp.ts';
import { useIsMobileViewport } from './hooks/useMediaQuery.ts';
import { RightPanelVisibilityProvider, useRightPanelVisibility } from './contexts/RightPanelVisibility.tsx';
import { PanelLayoutProvider, usePanelLayout } from './contexts/PanelLayout.tsx';
import { edgePlacement } from './util/edge-placement.ts';

const DEFAULT_BLANK_IMAGE = {
  color: '#ffffff',
  opacity: 1,
  size: { width: 800, height: 600 },
  isBedrock: true,
} as const;

function BlankImageStarter() {
  const [{ hasImage }] = useStore();
  const { setBlankImage } = useApp();
  const startedRef = useRef(false);

  useEffect(() => {
    if (hasImage || startedRef.current) return;

    startedRef.current = true;
    setBlankImage(DEFAULT_BLANK_IMAGE);
  }, [hasImage, setBlankImage]);

  return null;
}

function AppContainer() {
  const [isLayersDrawerOpen, setIsLayersDrawerOpen] = useState(false);
  const [isToolSheetOpen, setIsToolSheetOpen] = useState(false);
  const [{ hasImage, toolName }] = useStore();
  const layout = usePanelLayout();
  const isMobile = useIsMobileViewport();

  // The first-use tour appears on initial load, before any image exists. Once
  // the user dismisses it (or finishes it) the flag is persisted to localStorage.
  const [showFirstUseTour, setShowFirstUseTour] = useState(() => {
    if (hasImage || isMobile) return false;
    return !hasSeenFirstUseTour();
  });
  const { isOpen: isRightPanelOpen } = useRightPanelVisibility();
  const rightPanelPlacement = edgePlacement(
    layout.dockSide,
    !toolName || !hasImage || layout.dockSide !== layout.toolsSide ? 'full' : 'bottom'
  );

  // Close both mobile surfaces on leaving the mobile band.
  //
  // The mobile shell is mounted at every width and hidden with `md:hidden`, and
  // `display: none` hides without unmounting — so a surface left open on a phone stays
  // rendered on desktop, and `MobileToolSheet` holds a second live instance of the active
  // tool's options panel next to the one `ToolbarHorizontal` owns: duplicate
  // `id="font-size-input"`, duplicate `id="font-family-select"`, duplicate window Escape
  // listeners. Resetting the flags here, where they live, is the fix; unmounting the shell
  // is not, because the always-mounted design is what keeps the canvas alive across a
  // crossing.
  //
  // Adjusted during render rather than in an effect — React's documented pattern for
  // resetting state on an external change, and it avoids the extra render pass a setState
  // in an effect body costs.
  const [wasMobile, setWasMobile] = useState(isMobile);
  if (wasMobile !== isMobile) {
    setWasMobile(isMobile);
    if (!isMobile) {
      setIsToolSheetOpen(false);
      setIsLayersDrawerOpen(false);
    }
  }

  return (
    // The two side tracks are `auto`, not a fixed `250px`, because the dock's width is now the
    // user's to choose and the tablet collapse still has to work. `SidebarRight` collapses by
    // rendering `display: none`, and a `display: none` item contributes nothing to an `auto`
    // track but 250px of nothing to a fixed one — so the width has to live on the element
    // (`SidebarRight.tsx`) and the track has to stay content-sized. The `max-lg:` override that
    // used to give the tablet band the same width is gone for that reason: the element now
    // carries the width at every width.
    //
    // The `left` and `right` area NAMES are unchanged, and so is the DOM order of the children.
    // Re-docking swaps which component claims which area, which is a grid placement and not a
    // reorder, so the focus order the shell has always had is intact.
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto] grid-cols-[auto_1fr_auto] [grid-template-areas:'header_header_header''toolbar_toolbar_toolbar''left_main_right''footer_footer_footer'] max-md:grid-cols-1 max-md:grid-rows-[auto_1fr_auto] max-md:[grid-template-areas:'header''main''bottom'] dark:bg-gray-900">
      <AppKeyboardShortcuts />
      <BlankImageStarter />
      <Menu />
      <SidebarLeft />

      {/* The canvas and the tool sidebar are the two regions that own user work.
          Each is contained on its own so a throw in one still leaves the other,
          the menu and the footer usable. */}
      <ErrorBoundary
        label="Canvas"
        fallbackClassName="relative overflow-y-auto mobile-safe-bottom"
        fallbackStyle={{ gridArea: 'main' }}
      >
        <Main />
      </ErrorBoundary>

      <ErrorBoundary
        label="Right sidebar"
        fallbackClassName={`relative flex min-h-0 flex-col overflow-y-auto bg-gray-100 dark:bg-gray-800 dark:border-gray-700 max-md:hidden ${
          layout.dockSide === 'left' ? 'border-r border-gray-300' : 'border-l border-gray-300'
        } ${isRightPanelOpen ? rightPanelPlacement : 'hidden'}`}
        fallbackStyle={{ width: layout.effectiveDockWidth }}
      >
        <SidebarRight />
      </ErrorBoundary>
      <Footer />

      {/* Mounted unconditionally and hidden with `md:hidden`, rather than swapped in by a
          `isMobile` ternary.

          A ternary makes crossing 768px an unmount: the two branches are both Fragments, so
          React reconciles them positionally, and every index holds a different element
          type. `<Main>` is at index 4 on desktop and would sit elsewhere on mobile, so the
          canvas — every canvas, every overlay, every in-flight gesture — is destroyed and
          rebuilt. Drag a window under 768px and back, and a desktop user loses a half-drawn
          stroke. The regions already carry `max-md:hidden` precisely so this crossing is a
          pure `display` flip; keeping the mobile shell mounted restores that, and it also
          means the desktop DOM order is unchanged and the mobile shell cannot be blamed
          for a desktop regression.

          Both trees are mounted below and above the boundary, so the mobile shell's store
          subscriptions stay live on desktop. That is a deliberate trade: the store only
          dispatches on discrete events, not per pointer-move, so a handful of extra
          subscribers costs nothing per frame — while a remount costs the user's work. */}
      <MobileShell
        isToolSheetOpen={isToolSheetOpen}
        onToggleToolSheet={() => setIsToolSheetOpen((open) => !open)}
        isLayersOpen={isLayersDrawerOpen}
        onToggleLayers={() => setIsLayersDrawerOpen((open) => !open)}
      />
      {showFirstUseTour && <FirstUseTour onComplete={() => setShowFirstUseTour(false)} />}
    </div>
  );
}

function App() {
  return (
    <FileProvider>
      <ThemeProvider>
        <StoreProvider>
          {/* Directly inside the store, because it reads `hasUnsavedChanges`,
              `currentArgs` and `previewLayers` from it. Above every component that can
              replace the document — the desktop header, the mobile drawer, `Main`'s drop
              handler — and below nothing that needs it. */}
          <UnsavedChangesProvider>
            <KeyboardEventsProvider>
              <CurrentToolProvider>
                {/* Above `RightPanelVisibilityProvider` and beside it: both are shell state, and
                    neither reads the store. Order between them does not matter. */}
                <PanelLayoutProvider>
                  <RightPanelVisibilityProvider>
                    <FirstUseProvider>
                      <AppContainer />
                    </FirstUseProvider>
                  </RightPanelVisibilityProvider>
                </PanelLayoutProvider>
              </CurrentToolProvider>
            </KeyboardEventsProvider>
          </UnsavedChangesProvider>
        </StoreProvider>
      </ThemeProvider>
    </FileProvider>
  );
}

export default App;
