import { useEffect } from 'react';
import Menu from './components/Menu/Menu';
import Footer from './components/Footer/Footer';
import SidebarLeft from './components/SidebarLeft/SidebarLeft';
import SidebarRight from './components/SidebarRight/SidebarRight';
import Main from './components/Main/Main.tsx';

import { ThemeProvider } from './contexts/ThemeContext';
import { StoreProvider, useStore } from './contexts/StoreContext.tsx';
import { CurrentToolProvider } from './contexts/useCurrentTool.tsx';
import { FileProvider } from './contexts/useFile.tsx';
import { KeyboardEventsProvider } from './hooks/useKeyboardEvents.tsx';
import { AppKeyboardShortcuts } from './components/Common/AppKeyboardShortcuts.tsx';
import { useApp } from './hooks/useApp.ts';

const DEFAULT_BLANK_IMAGE = {
  color: '#ffffff',
  opacity: 1,
  size: { width: 800, height: 600 },
  isBedrock: true,
} as const;

function BlankImageStarter() {
  const [{ hasImage }] = useStore();
  const { setBlankImage } = useApp();

  useEffect(() => {
    if (!hasImage) {
      setBlankImage(DEFAULT_BLANK_IMAGE);
    }
  }, [hasImage, setBlankImage]);

  return null;
}

function AppContainer() {
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto] grid-cols-[auto_1fr_250px] [grid-template-areas:'header_header_header''toolbar_toolbar_toolbar''left_main_right''footer_footer_footer'] max-md:grid-cols-1 max-md:grid-rows-[50px_1fr] max-md:[grid-template-areas:'header''main'] dark:bg-gray-900">
      <AppKeyboardShortcuts />
      <BlankImageStarter />
      <Menu />
      <SidebarLeft />

      <Main />

      <SidebarRight />
      <Footer />
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
              <AppContainer />
            </CurrentToolProvider>
          </KeyboardEventsProvider>
        </StoreProvider>
      </ThemeProvider>
    </FileProvider>
  );
}

export default App;
