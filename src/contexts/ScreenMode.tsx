import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Photoshop's three screen modes, in the order `F` cycles them forward and `Shift+F` backward
 * (https://helpx.adobe.com/photoshop/using/default-keyboard-shortcuts.html, "View images").
 *
 *  - `standard` — every piece of shell chrome.
 *  - `full-with-menu` — "a full-screen window with a menu bar ... but no title bar or scroll bars"
 *    (https://helpx.adobe.com/photoshop/using/viewing-images.html). The toolbar, options bar and
 *    panels stay; what goes is the document window's own frame, and in this app that frame's one
 *    piece outside the canvas is the status bar (`Footer`).
 *  - `full` — "no interface elements" (same page): the canvas alone. The browser Fullscreen API is
 *    asked for the whole page, and if it refuses the shell still hides its chrome inside the window.
 */
export const SCREEN_MODES = ['standard', 'full-with-menu', 'full'] as const;
export type ScreenMode = (typeof SCREEN_MODES)[number];

/** The shell regions a screen mode or `Tab` can hide, named for their `data-chrome` attribute. */
export type ChromeRegion = 'header' | 'options' | 'tools' | 'panels' | 'footer';
export type ChromeVisibility = Readonly<Record<ChromeRegion, boolean>>;

/**
 * Which regions show for a screen mode and the `Tab` toggle.
 *
 * "Press Tab to hide all panels, including the Tools panel and Options bar"
 * (https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/hide-show-panels.html).
 * The menu bar is not a panel and stays, and so does the status bar, which belongs to the document
 * window rather than the panel set. `full` hides everything whatever the toggle says.
 */
export function chromeVisibility(mode: ScreenMode, panelsHidden: boolean): ChromeVisibility {
  if (mode === 'full') return { header: false, options: false, tools: false, panels: false, footer: false };

  return {
    header: true,
    options: !panelsHidden,
    tools: !panelsHidden,
    panels: !panelsHidden,
    footer: mode === 'standard',
  };
}

/** `F` steps forward and `Shift+F` back, wrapping at both ends as Photoshop's cycle does. */
export function nextScreenMode(mode: ScreenMode, direction: 1 | -1): ScreenMode {
  const index = SCREEN_MODES.indexOf(mode);
  return SCREEN_MODES[(index + direction + SCREEN_MODES.length) % SCREEN_MODES.length];
}

type ScreenModeContextValue = {
  screenMode: ScreenMode;
  panelsHidden: boolean;
  visibility: ChromeVisibility;
  cycleScreenMode: (direction: 1 | -1) => void;
  exitFullScreen: () => void;
  togglePanels: () => void;
};

const ScreenModeContext = createContext<ScreenModeContextValue | undefined>(undefined);

const requestPageFullscreen = (): Promise<void> => {
  const root = document.documentElement;
  if (typeof root.requestFullscreen !== 'function') return Promise.reject(new Error('Fullscreen API unavailable'));
  return root.requestFullscreen();
};

const exitPageFullscreen = () => {
  if (!document.fullscreenElement || typeof document.exitFullscreen !== 'function') return;
  // A rejection here means the page already left fullscreen, which is the state being asked for.
  document.exitFullscreen().catch(() => undefined);
};

export const ScreenModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [screenMode, setScreenMode] = useState<ScreenMode>('standard');
  const [panelsHidden, setPanelsHidden] = useState(false);
  // Set only once the browser has granted fullscreen, so a `fullscreenchange` that leaves it is
  // read as the user pressing the browser's own exit (Esc, the exit bar) and not as our request
  // being refused.
  const ownsFullscreenRef = useRef(false);
  // The grant is asynchronous, so the mode can have moved on by the time it lands.
  const requestedModeRef = useRef<ScreenMode>('standard');

  const applyScreenMode = useCallback((mode: ScreenMode) => {
    requestedModeRef.current = mode;
    setScreenMode(mode);

    if (mode === 'full') {
      requestPageFullscreen()
        .then(() => {
          if (requestedModeRef.current === 'full') ownsFullscreenRef.current = true;
          else exitPageFullscreen();
        })
        .catch(() => {
          // No permission, no user activation, or no API: the in-window hide still applies.
        });
      return;
    }

    ownsFullscreenRef.current = false;
    exitPageFullscreen();
  }, []);

  const cycleScreenMode = useCallback(
    (direction: 1 | -1) => applyScreenMode(nextScreenMode(screenMode, direction)),
    [applyScreenMode, screenMode]
  );

  const exitFullScreen = useCallback(() => applyScreenMode('standard'), [applyScreenMode]);

  const togglePanels = useCallback(() => setPanelsHidden((hidden) => !hidden), []);

  useEffect(() => {
    // The browser consumes `Esc` in fullscreen before any page `keydown`, so this is how that
    // exit reaches the shell; Photoshop's `Esc` returns to Standard Screen Mode the same way.
    const handleFullscreenChange = () => {
      if (document.fullscreenElement || !ownsFullscreenRef.current) return;
      ownsFullscreenRef.current = false;
      requestedModeRef.current = 'standard';
      setScreenMode('standard');
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const value = useMemo(
    () => ({
      screenMode,
      panelsHidden,
      visibility: chromeVisibility(screenMode, panelsHidden),
      cycleScreenMode,
      exitFullScreen,
      togglePanels,
    }),
    [cycleScreenMode, exitFullScreen, panelsHidden, screenMode, togglePanels]
  );

  return <ScreenModeContext.Provider value={value}>{children}</ScreenModeContext.Provider>;
};

export function useScreenMode(): ScreenModeContextValue {
  const context = useContext(ScreenModeContext);
  if (!context) throw new Error('useScreenMode must be used within a ScreenModeProvider');
  return context;
}
