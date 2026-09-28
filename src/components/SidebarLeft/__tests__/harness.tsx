/**
 * Shared render harness for the `SidebarLeft` component suites.
 *
 * This file deliberately contains no `describe`/`it` — it is a harness, not a suite.
 *
 * Import order matters: `vi.mock` registrations are hoisted inside this module, so a
 * test file must import this harness *before* it imports `../SidebarLeft.tsx` for the
 * mocks below to apply. Vitest resolves mock paths relative to the file that calls
 * `vi.mock`; this file sits in the same directory as the suites, so the relative
 * specifiers match the ones the suites used before the extraction.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi, type Mock } from 'vitest';

type StoreStateFixture = {
  toolName: string;
  color: string;
  backgroundColor: string;
  hasImage: boolean;
  dispatch: Mock;
};

type ToolArgsFixture = {
  toolName: string;
  figure: string | undefined;
};

/** Long-press threshold for opening a tool flyout, in `src/components/SidebarLeft/SidebarLeft.tsx`. */
export const LONG_PRESS_DELAY_MS = 300;

/**
 * `requestAnimationFrame` in jsdom is polyfilled by `src/test/setup.ts` as
 * `setTimeout(callback, 16)`, so one animation frame is worth exactly 16 fake
 * milliseconds. Use {@link advanceOneFrame} or {@link advanceThroughLongPress} instead
 * of guessing an arbitrary settle window.
 */
export const RAF_FRAME_MS = 16;

const goToToolMock = vi.hoisted(() => vi.fn());
const patchToolArgsMock = vi.hoisted(() => vi.fn());

// `vi.hoisted` initialisers cannot be declared inside an `export` clause (vitest hoists
// them above the module body), so each fixture is declared and exported separately.
const storeState = vi.hoisted<StoreStateFixture>(() => ({
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  hasImage: true,
  dispatch: vi.fn(),
}));

const toolArgs = vi.hoisted<ToolArgsFixture>(() => ({
  toolName: 'draw',
  figure: undefined,
}));

export { storeState, toolArgs };

/** The `useApp().goToTool` spy. */
export const goToTool: Mock = goToToolMock;
/** The `useCurrentTool().patchToolArgs` spy. */
export const patchToolArgs: Mock = patchToolArgsMock;

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, storeState.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool: goToToolMock }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs,
    patchToolArgs: patchToolArgsMock,
  }),
}));

vi.mock('../toolIcons.tsx', () => {
  const Icon = ({ title }: { title: string }) => <svg aria-hidden="true">{title}</svg>;

  return {
    toolIcons: {
      reposition: Icon,
      'rectangular-selection': Icon,
      'elliptical-selection': Icon,
      'freehand-lasso': Icon,
      'polygonal-lasso': Icon,
      'feather-magnetic-lasso': Icon,
      'magic-wand': Icon,
      'quick-selection': Icon,
      eyedropper: Icon,
      eraser: Icon,
      'clone-stamp': Icon,
      'paint-bucket': Icon,
      gradient: Icon,
      sharpen: Icon,
      smudge: Icon,
      dodge: Icon,
      burn: Icon,
      crop: Icon,
      draw: Icon,
      shape: Icon,
      text: Icon,
      color: Icon,
      blur: Icon,
      levels: Icon,
      transform: Icon,
      brush: Icon,
      pencil: Icon,
      'color-replacement': Icon,
      pen: Icon,
      'freeform-pen': Icon,
      'curvature-pen': Icon,
      'add-anchor-point': Icon,
      'delete-anchor-point': Icon,
      'convert-point': Icon,
      rectangle: Icon,
      ellipse: Icon,
      triangle: Icon,
      polygon: Icon,
      line: Icon,
      'custom-shape': Icon,
    },
  };
});

/** The tool tile for a toolbar tool name, e.g. `brush` -> `tool-button-brush`. */
export const toolbarButtonByName = (name: string): HTMLElement => screen.getByTestId(`tool-button-${name}`);

/** Drains exactly the 16 ms `requestAnimationFrame` polyfill frame from `src/test/setup.ts`. */
export const advanceOneFrame = (): void => {
  act(() => {
    vi.advanceTimersByTime(RAF_FRAME_MS);
  });
};

/**
 * Advances past the long-press threshold and drains the animation frame the flyout
 * schedules, so "the flyout never opened" assertions are not decided by an arbitrary
 * settle window.
 */
export const advanceThroughLongPress = (): void => {
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS + RAF_FRAME_MS);
  });
};

/**
 * Presses a tool tile long enough to open its flyout, then releases and clicks so the
 * trailing click is delivered too.
 *
 * The advance stops at exactly {@link LONG_PRESS_DELAY_MS} and deliberately does *not*
 * drain the animation frame: the "focus moves to the first flyout item on the next
 * frame" behaviour is asserted separately, and draining here would hide it.
 */
export const longPress = (button: HTMLElement): void => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

/** Restores every mutable fixture to its declared default. Run before each test. */
export const resetMocks = (): void => {
  goToToolMock.mockReset();
  patchToolArgsMock.mockClear();
  storeState.dispatch.mockClear();
  Object.assign(storeState, {
    hasImage: true,
    toolName: 'draw',
    color: '#000000',
    backgroundColor: '#ffffff',
  });
  Object.assign(toolArgs, { toolName: 'draw', figure: undefined });
};

/** Drains and restores real timers. Run after each test. */
export const cleanupTimers = (): void => {
  vi.clearAllTimers();
  vi.useRealTimers();
};

/**
 * Registers the harness lifecycle for the calling suite: fixtures are reset before
 * every test and fake timers are always restored after it, so `vi.useFakeTimers()` in
 * one test can never leak into the next.
 */
export const useSidebarLeftHarness = (): void => {
  beforeEach(resetMocks);
  afterEach(cleanupTimers);
};
