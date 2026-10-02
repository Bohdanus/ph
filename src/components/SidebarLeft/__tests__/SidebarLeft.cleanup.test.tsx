import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import SidebarLeft, { FLYOUT_LONG_PRESS_MS } from '../SidebarLeft.tsx';

const goToTool = vi.fn();
const patchToolArgsMock = vi.fn();

const storeStateRef = vi.hoisted(() => ({
  toolName: 'draw',
  color: '#000000',
  backgroundColor: '#ffffff',
  hasImage: true,
  dispatch: vi.fn(),
}));

const toolArgsRef = vi.hoisted(() => ({
  toolName: 'draw' as string,
  figure: undefined as string | undefined,
}));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeStateRef, storeStateRef.dispatch],
}));

vi.mock('../../../hooks/useApp.ts', () => ({
  useApp: () => ({ goToTool }),
}));

vi.mock('../../../contexts/useCurrentTool.tsx', () => ({
  useCurrentTool: () => ({
    toolArgs: toolArgsRef,
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

const LONG_PRESS_DELAY = FLYOUT_LONG_PRESS_MS;

const longPress = (button: HTMLElement) => {
  fireEvent.pointerDown(button, { button: 0 });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_DELAY);
  });
  fireEvent.pointerUp(button, { button: 0 });
  fireEvent.click(button);
};

const toolbarButtonByName = (name: string) => screen.getByTestId(`tool-button-${name}`);

const resetMocks = () => {
  goToTool.mockReset();
  Object.assign(toolArgsRef, { toolName: 'draw', figure: undefined });
  Object.assign(storeStateRef, {
    hasImage: true,
    toolName: 'draw',
    color: '#000000',
    backgroundColor: '#ffffff',
  });
  storeStateRef.dispatch.mockClear();
  patchToolArgsMock.mockClear();
};

const cleanupTimers = () => {
  vi.clearAllTimers();
  vi.useRealTimers();
};

describe('SidebarLeft cleanup', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    cleanupTimers();
  });

  it('clears the long-press timeout on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0 });
    });

    unmount();

    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('cancels a pending long-press on pointercancel', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    const brushButton = toolbarButtonByName('brush');
    act(() => {
      fireEvent.pointerDown(brushButton, { button: 0 });
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY - 1);
    });
    act(() => {
      fireEvent.pointerCancel(brushButton);
    });

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('leaves no pending long-press timer behind once the flyout is open', () => {
    vi.useFakeTimers();
    render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tears down the open flyout and its listeners on unmount', () => {
    vi.useFakeTimers();
    // `screen` reads the whole document, and the unmount takes the whole tree with it, so
    // "no `role="menu"` left" is true of a flyout that was torn down and of one that was never
    // torn down but is gone anyway — which is why the two byte-identical assertions this
    // replaces could not fail. What only the unmount can get wrong is UNSUBSCRIBING, and the
    // subscribers an open flyout owns are observable on `window` and `document` themselves.
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');

    const { unmount } = render(<SidebarLeft />);

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // The two subscribers an open flyout installs: Escape (SidebarLeft.tsx:563) and the
    // outside click (SidebarLeft.tsx:585).
    const escapeHandler = windowAdd.mock.calls.find(([type]) => type === 'keydown')?.[1];
    const outsideClickHandler = documentAdd.mock.calls.find(([type]) => type === 'click')?.[1];
    expect(escapeHandler).toEqual(expect.any(Function));
    expect(outsideClickHandler).toEqual(expect.any(Function));

    // The control that makes the identical dispatches below mean something: on a LIVE tree the
    // same two events close the flyout. Without it, a component that never listened at all
    // would leave no menu either, and the late dispatch would prove nothing.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    unmount();

    expect(screen.queryByRole('menu')).toBeNull();
    // Removal by the SAME function reference is the only form the DOM API accepts: a fresh
    // closure per render would unsubscribe a listener nobody registered and leave the live one
    // on `window` for the rest of the session.
    expect(windowRemove).toHaveBeenCalledWith('keydown', escapeHandler);
    expect(documentRemove).toHaveBeenCalledWith('click', outsideClickHandler);
    const subscribedAfterUnmount = windowAdd.mock.calls.length + documentAdd.mock.calls.length;
    const unsubscribedAfterUnmount = windowRemove.mock.calls.length + documentRemove.mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    act(() => {
      fireEvent.click(document.body);
    });

    // What is left to say that the assertions above do not: the two events the live tree
    // answered to a moment ago now reach no subscriber at all, and reaching none is
    // observable — they neither resurrect the flyout nor re-enter the subscription bookkeeping.
    expect(screen.queryByRole('menu')).toBeNull();
    expect(windowAdd.mock.calls.length + documentAdd.mock.calls.length).toBe(subscribedAfterUnmount);
    expect(windowRemove.mock.calls.length + documentRemove.mock.calls.length).toBe(unsubscribedAfterUnmount);
  });
});
