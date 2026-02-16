import { useState, useEffect } from 'react';
import Menu from './components/Menu/Menu';
import Footer from './components/Footer/Footer';
import SidebarLeft from './components/SidebarLeft/SidebarLeft';
import SidebarRight from './components/SidebarRight/SidebarRight';
import BottomToolbar from './components/BottomToolbar/BottomToolbar';
import Main from './components/Main/Main.tsx';
import { ImageProvider } from './contexts/ImageProvider';
import { ThemeProvider } from './contexts/ThemeContext';
import { LandingPage } from './components/LandingPage/LandingPage';

const LANDING_PAGE_VIEWED_KEY = 'lightshopy_landing_viewed';

function AppContent() {
  return (
    <div className="grid h-full grid-rows-[auto_1fr_auto] grid-cols-[250px_1fr_250px] [grid-template-areas:'header_header_header''left_main_right''footer_footer_footer'] max-md:grid-cols-1 max-md:grid-rows-[50px_1fr] max-md:[grid-template-areas:'header''main'] dark:bg-gray-900">
      <Menu />
      <SidebarLeft />

      <Main />

      <SidebarRight />
      <Footer />
      <BottomToolbar />
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
    <ThemeProvider>
      <ImageProvider>
        {showApp ? (
          <AppContent />
        ) : (
          <LandingPage onStart={handleStartClick} />
        )}
      </ImageProvider>
    </ThemeProvider>
  );
}

export default App;
