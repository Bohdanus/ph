import { useState, useEffect } from 'react';
import Menu from './components/Menu/Menu';
import Footer from './components/Footer/Footer';
import SidebarLeft from './components/SidebarLeft/SidebarLeft';
import SidebarRight from './components/SidebarRight/SidebarRight';
import Main from './components/Main/Main.tsx';

import { ThemeProvider } from './contexts/ThemeContext';
import { StoreProvider } from './contexts/StoreContext.tsx';
import { CurrentToolProvider } from './contexts/useCurrentTool.tsx';
import { FileProvider } from './contexts/useFile.tsx';
import { LandingPage } from './components/LandingPage/LandingPage';

const LANDING_PAGE_VIEWED_KEY = 'lightshopy_landing_viewed';

function AppContainer() {
  return (
    <div className="grid h-full grid-rows-[auto_auto_1fr_auto] grid-cols-[250px_1fr_250px] [grid-template-areas:'header_header_header''toolbar_toolbar_toolbar''left_main_right''footer_footer_footer'] max-md:grid-cols-1 max-md:grid-rows-[50px_1fr] max-md:[grid-template-areas:'header''main'] dark:bg-gray-900">
      <Menu />
      <SidebarLeft />

      <Main />

      <SidebarRight />
      <Footer />
    </div>
  );
}

function App() {
  const [showApp, setShowApp] = useState<boolean | null>(null);

  useEffect(() => {
    // Check if landing page has been viewed
    const hasViewedLanding = localStorage.getItem(LANDING_PAGE_VIEWED_KEY);
    setShowApp(!!hasViewedLanding);
  }, []);

  const handleStartClick = () => {
    // Mark landing page as viewed in localStorage
    localStorage.setItem(LANDING_PAGE_VIEWED_KEY, 'true');
    setShowApp(true);
  };

  // Show loading state while checking localStorage
  if (showApp === null) {
    return null;
  }

  return (
    <FileProvider>
      <ThemeProvider>
        <StoreProvider>
          <CurrentToolProvider>
            {showApp ? <AppContainer /> : <LandingPage onStart={handleStartClick} />}
          </CurrentToolProvider>
        </StoreProvider>
      </ThemeProvider>
    </FileProvider>
  );
}

export default App;
