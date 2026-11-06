import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chromeVisibility,
  nextScreenMode,
  ScreenModeProvider,
  useScreenMode,
  type ChromeVisibility,
  type ScreenMode,
} from '../ScreenMode.tsx';

const ALL_SHOWN: ChromeVisibility = { header: true, options: true, tools: true, panels: true, footer: true };
const NONE_SHOWN: ChromeVisibility = { header: false, options: false, tools: false, panels: false, footer: false };

describe('chromeVisibility', () => {
  it.each<[ScreenMode, boolean, ChromeVisibility]>([
    ['standard', false, ALL_SHOWN],
    ['standard', true, { header: true, options: false, tools: false, panels: false, footer: true }],
    ['full-with-menu', false, { ...ALL_SHOWN, footer: false }],
    ['full-with-menu', true, { header: true, options: false, tools: false, panels: false, footer: false }],
    ['full', false, NONE_SHOWN],
    ['full', true, NONE_SHOWN],
  ])('%s with panels hidden=%s', (mode, panelsHidden, expected) => {
    expect(chromeVisibility(mode, panelsHidden)).toEqual(expected);
  });
});

describe('nextScreenMode', () => {
  it.each<[ScreenMode, 1 | -1, ScreenMode]>([
    ['standard', 1, 'full-with-menu'],
    ['full-with-menu', 1, 'full'],
    ['full', 1, 'standard'],
    ['standard', -1, 'full'],
    ['full', -1, 'full-with-menu'],
    ['full-with-menu', -1, 'standard'],
  ])('steps %s by %i to %s', (mode, direction, expected) => {
    expect(nextScreenMode(mode, direction)).toBe(expected);
  });
});

describe('ScreenModeProvider', () => {
  const wrapper = ({ children }: { children: ReactNode }) => <ScreenModeProvider>{children}</ScreenModeProvider>;
  let fullscreenElement: Element | null;
  const requestFullscreen = vi.fn<() => Promise<void>>();
  const exitFullscreen = vi.fn<() => Promise<void>>();

  const enterBrowserFullscreen = () => {
    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  };

  const leaveBrowserFullscreen = () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
  };

  beforeEach(() => {
    fullscreenElement = null;
    requestFullscreen.mockReset().mockImplementation(enterBrowserFullscreen);
    exitFullscreen.mockReset().mockImplementation(async () => leaveBrowserFullscreen());
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitFullscreen });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'exitFullscreen');
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  });

  it('starts in standard mode with every region shown', () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    expect(result.current.screenMode).toBe('standard');
    expect(result.current.visibility).toEqual(ALL_SHOWN);
  });

  it('cycles forward through all three modes, asking the browser for fullscreen only for full', async () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    act(() => result.current.cycleScreenMode(1));
    expect(result.current.screenMode).toBe('full-with-menu');
    expect(requestFullscreen).not.toHaveBeenCalled();

    await act(async () => result.current.cycleScreenMode(1));
    expect(result.current.screenMode).toBe('full');
    expect(requestFullscreen).toHaveBeenCalledTimes(1);

    await act(async () => result.current.cycleScreenMode(1));
    expect(result.current.screenMode).toBe('standard');
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('cycles backward from standard straight to full', async () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    await act(async () => result.current.cycleScreenMode(-1));

    expect(result.current.screenMode).toBe('full');
  });

  it('returns to standard when the browser leaves fullscreen on its own (its Esc, its exit bar)', async () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });
    await act(async () => result.current.cycleScreenMode(-1));

    act(() => leaveBrowserFullscreen());

    expect(result.current.screenMode).toBe('standard');
  });

  it('keeps the in-window full mode when the browser refuses fullscreen', async () => {
    requestFullscreen.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    await act(async () => result.current.cycleScreenMode(-1));

    expect(result.current.screenMode).toBe('full');
    expect(result.current.visibility).toEqual(NONE_SHOWN);
  });

  it('keeps the in-window full mode with no Fullscreen API at all, and leaves it on exit', async () => {
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    await act(async () => result.current.cycleScreenMode(-1));
    expect(result.current.screenMode).toBe('full');

    act(() => result.current.exitFullScreen());
    expect(result.current.screenMode).toBe('standard');
    expect(exitFullscreen).not.toHaveBeenCalled();
  });

  it('ignores a fullscreen change it did not start', () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });
    act(() => result.current.cycleScreenMode(1));

    act(() => leaveBrowserFullscreen());

    expect(result.current.screenMode).toBe('full-with-menu');
  });

  it('leaves a fullscreen grant that lands after the user has already left full mode', async () => {
    let grant: () => void = () => undefined;
    requestFullscreen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          grant = () => {
            fullscreenElement = document.documentElement;
            resolve();
          };
        })
    );
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    act(() => result.current.cycleScreenMode(-1));
    act(() => result.current.exitFullScreen());
    await act(async () => grant());

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(result.current.screenMode).toBe('standard');
  });

  it('toggles the panels without changing the screen mode', () => {
    const { result } = renderHook(() => useScreenMode(), { wrapper });

    act(() => result.current.togglePanels());
    expect(result.current.panelsHidden).toBe(true);
    expect(result.current.visibility).toEqual({ ...ALL_SHOWN, options: false, tools: false, panels: false });

    act(() => result.current.togglePanels());
    expect(result.current.visibility).toEqual(ALL_SHOWN);
    expect(result.current.screenMode).toBe('standard');
  });

  it('refuses to be read outside its provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => renderHook(() => useScreenMode())).toThrow(/ScreenModeProvider/);
    consoleError.mockRestore();
  });
});
