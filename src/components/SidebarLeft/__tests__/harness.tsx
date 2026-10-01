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
 *
 * The long-press threshold is read from the component rather than restated here, so this file
 * now imports `../SidebarLeft.tsx` as well. That is not a cycle and it does not defeat the
 * mocks: vitest hoists THIS file's `vi.mock` calls above its own imports, so the component is
 * evaluated after the factories below are registered — the same ordering the suites depend on
 * when they import this harness first.
 */
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, vi, type Mock } from 'vitest';
import { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

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
      'single-row-marquee': Icon,
      'single-column-marquee': Icon,
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
      sponge: Icon,
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
      'magic-eraser': Icon,
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
 * Advances past the long-press threshold by one frame's worth, so "the flyout never opened"
 * assertions are not decided by an arbitrary settle window.
 *
 * The extra frame is tolerance, not a requirement: nothing on the long-press path schedules
 * one. A long press is a pointerdown, a timer and `openFlyout` — the only
 * `requestAnimationFrame` in the rail belongs to the tile's own `onKeyDown` focus deferral
 * (`SidebarLeft.tsx`), which is a keyboard path.
 */
export const advanceThroughLongPress = (): void => {
  act(() => {
    vi.advanceTimersByTime(FLYOUT_LONG_PRESS_MS + RAF_FRAME_MS);
  });
};

/**
 * Presses a tool tile long enough to open its flyout, then releases and clicks so the
 * trailing click is delivered too.
 *
 * The advance stops at exactly {@link FLYOUT_LONG_PRESS_MS} — the instant the app's own
 * timer fires — rather than past it, and no animation frame is drained, because the
 * long-press path schedules none. The frame that IS load-bearing is the tile's keyboard
 * focus deferral, and `SidebarLeft.keyboard.test.tsx` asserts it by capturing the
 * callback: a key pressed AFTER this helper returns is what registers that frame, so
 * nothing this helper does with the clock can hide it.
 */
export const longPress = (button: HTMLElement): void => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(FLYOUT_LONG_PRESS_MS);
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
