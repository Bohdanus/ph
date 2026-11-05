import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPanelToggleTarget, ScreenModeShortcuts } from '../ScreenModeShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';
import type { ScreenMode } from '../../../contexts/ScreenMode.tsx';

/** The real `KeyboardEventsProvider`, so the guards under test are production's. */

const togglePanels = vi.hoisted(() => vi.fn());
const cycleScreenMode = vi.hoisted(() => vi.fn());
const exitFullScreen = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  hasImage: true,
  isMobile: false,
  screenMode: 'standard' as ScreenMode,
  previewLayers: { current: {} as Record<string, unknown> },
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [{ hasImage: state.hasImage, previewLayers: state.previewLayers }, vi.fn()],
}));

vi.mock('../../../hooks/useMediaQuery.ts', () => ({
  useIsMobileViewport: () => state.isMobile,
}));

vi.mock('../../../contexts/ScreenMode.tsx', () => ({
  useScreenMode: () => ({ screenMode: state.screenMode, togglePanels, cycleScreenMode, exitFullScreen }),
}));

/** With nothing focused a browser targets `keydown` at the body, so that is the default here. */
function press(key: string, init: Partial<KeyboardEventInit> = {}, target: Element = document.body) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return !fireEvent(target, event);
}

function renderShortcuts() {
  return render(
    <KeyboardEventsProvider>
      <ScreenModeShortcuts />
    </KeyboardEventsProvider>
  );
}

function mountWorkspace() {
  const workspace = document.createElement('main');
  workspace.dataset.testid = 'workspace-container';
  const surface = document.createElement('canvas');
  const viewSurface = document.createElement('div');
  viewSurface.tabIndex = 0;
  const control = document.createElement('button');
  workspace.append(surface, viewSurface, control);
  document.body.append(workspace);
  return { workspace, surface, viewSurface, control };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.hasImage = true;
  state.isMobile = false;
  state.screenMode = 'standard';
  state.previewLayers.current = {};
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('isPanelToggleTarget', () => {
  it('accepts no focus, the body, and the canvas surface', () => {
    const { surface } = mountWorkspace();

    expect(isPanelToggleTarget(null, false)).toBe(true);
    expect(isPanelToggleTarget(document.body, false)).toBe(true);
    expect(isPanelToggleTarget(surface, false)).toBe(true);
  });

  it('declines the view surface when the keyboard put focus there, which Tab could otherwise never leave', () => {
    const { viewSurface } = mountWorkspace();

    expect(isPanelToggleTarget(viewSurface, false)).toBe(false);
  });

  it('accepts the view surface when a click put focus there', () => {
    const { viewSurface } = mountWorkspace();

    expect(isPanelToggleTarget(viewSurface, true)).toBe(true);
  });

  it('declines a control, inside the workspace or out', () => {
    const { control } = mountWorkspace();
    const shellButton = document.createElement('button');
    document.body.append(shellButton);

    expect(isPanelToggleTarget(control, true)).toBe(false);
    expect(isPanelToggleTarget(shellButton, true)).toBe(false);
  });
});

describe('ScreenModeShortcuts', () => {
  it('toggles the panels on Tab from the body and claims the key', () => {
    renderShortcuts();

    expect(press('Tab')).toBe(true);
    expect(togglePanels).toHaveBeenCalledTimes(1);
  });

  it('toggles the panels on Tab from the canvas surface', () => {
    renderShortcuts();
    const { surface } = mountWorkspace();

    expect(press('Tab', {}, surface)).toBe(true);
    expect(togglePanels).toHaveBeenCalledTimes(1);
  });

  it('moves focus off a view surface the keyboard reached, and toggles from one a click focused', () => {
    renderShortcuts();
    const { viewSurface } = mountWorkspace();

    fireEvent.focusIn(viewSurface);
    expect(press('Tab', {}, viewSurface)).toBe(false);

    fireEvent.pointerDown(viewSurface);
    fireEvent.focusIn(viewSurface);
    fireEvent.pointerUp(window);
    expect(press('Tab', {}, viewSurface)).toBe(true);
    expect(togglePanels).toHaveBeenCalledTimes(1);
  });

  it('toggles from a keyboard-focused view surface once it is clicked, though focus does not move', () => {
    renderShortcuts();
    const { viewSurface } = mountWorkspace();

    fireEvent.focusIn(viewSurface);
    fireEvent.pointerDown(viewSurface);
    fireEvent.pointerUp(window);

    expect(press('Tab', {}, viewSurface)).toBe(true);
  });

  it('leaves Tab on a focused control to move focus', () => {
    renderShortcuts();
    const { control } = mountWorkspace();

    expect(press('Tab', {}, control)).toBe(false);
    expect(togglePanels).not.toHaveBeenCalled();
  });

  it.each([{ shiftKey: true }, { ctrlKey: true }, { altKey: true }])('leaves Tab with %o alone', (modifiers) => {
    renderShortcuts();

    expect(press('Tab', modifiers)).toBe(false);
    expect(togglePanels).not.toHaveBeenCalled();
  });

  it('does not toggle the panels in Full Screen Mode, which shows none', () => {
    state.screenMode = 'full';
    renderShortcuts();

    expect(press('Tab')).toBe(false);
    expect(togglePanels).not.toHaveBeenCalled();
  });

  it.each([
    ['f', {}, 1],
    ['F', { shiftKey: true }, -1],
  ] as const)('cycles the screen mode on %s with %o', (key, modifiers, direction) => {
    renderShortcuts();

    press(key, modifiers);

    expect(cycleScreenMode).toHaveBeenCalledExactlyOnceWith(direction);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])('leaves F with %o alone', (modifiers) => {
    renderShortcuts();

    expect(press('f', modifiers)).toBe(false);
    expect(cycleScreenMode).not.toHaveBeenCalled();
  });

  it('leaves F to a focused text field', () => {
    renderShortcuts();
    const input = document.createElement('input');
    document.body.append(input);

    press('f', {}, input);

    expect(cycleScreenMode).not.toHaveBeenCalled();
  });

  it('cycles once for a held F', () => {
    renderShortcuts();

    press('f');
    press('f', { repeat: true });

    expect(cycleScreenMode).toHaveBeenCalledTimes(1);
  });

  it('leaves Full Screen Mode on Escape', () => {
    state.screenMode = 'full';
    renderShortcuts();

    expect(press('Escape')).toBe(true);
    expect(exitFullScreen).toHaveBeenCalledTimes(1);
  });

  it('leaves Escape to a pending preview in Full Screen Mode, so Free Transform cancels first', () => {
    state.screenMode = 'full';
    state.previewLayers.current = { 'layer-1': { toolArgs: { toolName: 'transform' } } };
    renderShortcuts();

    expect(press('Escape')).toBe(false);
    expect(exitFullScreen).not.toHaveBeenCalled();
  });

  it('leaves Escape alone outside Full Screen Mode', () => {
    state.screenMode = 'full-with-menu';
    renderShortcuts();

    expect(press('Escape')).toBe(false);
    expect(exitFullScreen).not.toHaveBeenCalled();
  });

  it.each([
    ['no document is loaded', () => (state.hasImage = false)],
    ['the viewport is in the phone band', () => (state.isMobile = true)],
  ])('does nothing when %s', (_label, arrange) => {
    arrange();
    renderShortcuts();

    expect(press('Tab')).toBe(false);
    press('f');

    expect(togglePanels).not.toHaveBeenCalled();
    expect(cycleScreenMode).not.toHaveBeenCalled();
  });
});
