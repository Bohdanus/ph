import React, { createContext, useContext, useEffect, useState } from 'react';

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
 */
const DEFAULT_THEME: Theme = 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : DEFAULT_THEME;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
