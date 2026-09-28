import { useEffect, useRef, useState } from 'react';
import Menu from './components/Menu/Menu';
import Footer from './components/Footer/Footer';
import SidebarLeft from './components/SidebarLeft/SidebarLeft';
import SidebarRight from './components/SidebarRight/SidebarRight';
import Main from './components/Main/Main.tsx';
import { MobileShell } from './components/Mobile/MobileShell.tsx';

import { ThemeProvider } from './contexts/ThemeContext';
import { StoreProvider, useStore } from './contexts/StoreContext.tsx';
import { CurrentToolProvider } from './contexts/useCurrentTool.tsx';
import { FileProvider } from './contexts/useFile.tsx';
import { KeyboardEventsProvider } from './hooks/useKeyboardEvents.tsx';
import { AppKeyboardShortcuts } from './components/Common/AppKeyboardShortcuts.tsx';
import { useApp } from './hooks/useApp.ts';
import { RightPanelVisibilityProvider } from './contexts/RightPanelVisibility.tsx';

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

  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto] grid-cols-[auto_1fr_250px] max-lg:grid-cols-[auto_1fr_auto] [grid-template-areas:'header_header_header''toolbar_toolbar_toolbar''left_main_right''footer_footer_footer'] max-md:grid-cols-1 max-md:grid-rows-[auto_1fr_auto] max-md:[grid-template-areas:'header''main''bottom'] dark:bg-gray-900">
      <AppKeyboardShortcuts />
      <BlankImageStarter />
      <Menu />
      <SidebarLeft />

      <Main />

      <SidebarRight />
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
    </div>
  );
}

function App() {
  return (
    <FileProvider>
      <ThemeProvider>
        <StoreProvider>
          <KeyboardEventsProvider>
            <CurrentToolProvider>
              <RightPanelVisibilityProvider>
                <AppContainer />
              </RightPanelVisibilityProvider>
            </CurrentToolProvider>
          </KeyboardEventsProvider>
        </StoreProvider>
      </ThemeProvider>
    </FileProvider>
  );
}

export default App;
