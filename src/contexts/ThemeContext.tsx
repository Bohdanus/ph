import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * What a first-time visitor gets, with no saved preference and no media query.
 *
 * DARK is the default because this is a photo editor: the canvas is the only thing
 * that carries luminance, and a light chrome around it puts a bright border on every
 * judgement of an image — it makes the surrounding UI look brighter than a correctly
 * exposed photograph, and it shifts perceived midtones on the document's own edges.
 * Photoshop's own UI is dark for the same reason.
 *
 * The `prefers-color-scheme` fallback this replaced made the default an accident of
 * the operating system, which is a worse answer than either value: the same app
 * rendered two different ways on two machines, with nothing in the repo recording
 * which one a screenshot was taken under. A stored preference still wins (below), so
 * a visitor who toggles to light keeps it.
 *
 * TEST OVERRIDE: `import.meta.env.VITE_TEST_THEME` can be set to 'light' or 'dark'
 * to force a specific theme in tests without mocking localStorage. This is only
 * respected when no saved preference exists.
 */
const DEFAULT_THEME: Theme = 'dark';

function getTestOverride(): Theme | null {
  const env = import.meta.env?.VITE_TEST_THEME;
  return env === 'light' || env === 'dark' ? env : null;
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const testOverride = getTestOverride();
    if (testOverride) return testOverride;

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;

    // TEST OVERRIDE: VITE_TEST_THEME can force a theme when no stored preference exists.
    const testOverride = getTestOverride();
    if (testOverride) return testOverride;

    return DEFAULT_THEME;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
