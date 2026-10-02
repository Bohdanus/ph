import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi, type Mock, type MockInstance } from 'vitest';
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
    // replaces could not fail. What only the unmount can get wrong is UNSUBSCRIBING, and a
    // subscriber that survives is only observable as a listener that still ANSWERS.
    //
    // Counting `addEventListener` calls is not that observation, and cannot be: a stranded
    // handler never re-subscribes, so the totals are identical whether it was removed or
    // leaked. So every handler is registered through a spy that delegates to the real one,
    // which makes two things checkable that were not — that a live handler really does get
    // invoked (the control below), and that after the unmount it does not.
    const originalWindowAdd = window.addEventListener.bind(window);
    const originalWindowRemove = window.removeEventListener.bind(window);
    const originalDocumentAdd = document.addEventListener.bind(document);
    const originalDocumentRemove = document.removeEventListener.bind(document);
    const windowHandlers: { type: string; spy: Mock }[] = [];
    const documentHandlers: { type: string; spy: Mock }[] = [];
    // `findLast` is ES2023 and this project's lib target predates it, so the scan is
    // written out. Same for the raw-reference lookups below.
    const lastSpyFor = (sink: { type: string; spy: Mock }[], type: string): Mock | undefined => {
      for (let index = sink.length - 1; index >= 0; index -= 1) {
        if (sink[index]?.type === type) return sink[index].spy;
      }
      return undefined;
    };
    const lastRawFor = (calls: unknown[][], wanted: string): EventListenerOrEventListenerObject => {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        const call = calls[index];
        if (call && call[0] === wanted) return call[1] as EventListenerOrEventListenerObject;
      }
      throw new Error(`no listener registered for ${wanted}`);
    };
    // The spy is what reaches the DOM, on BOTH sides. Wrapping only `add` would register the
    // spy while the component unsubscribed its raw closure; the DOM would find no match, the
    // listener would survive, and the post-unmount dispatch would call a spy the component
    // believes it removed — a leak manufactured by the harness. So the raw handler is mapped
    // to its spy on the way in and back on the way out.
    const wrap = (
      spyOn: MockInstance,
      addDelegate: typeof window.addEventListener,
      sink: { type: string; spy: Mock }[]
    ) => {
      const byRaw = new Map<EventListenerOrEventListenerObject, Mock>();
      spyOn.mockImplementation(((type: string, handler: EventListenerOrEventListenerObject, options?: never) => {
        const spy = vi.fn(handler as () => void);
        byRaw.set(handler, spy);
        sink.push({ type, spy });
        return addDelegate(type, spy as unknown as EventListener, options);
      }) as unknown as typeof window.addEventListener);
      return (raw: EventListenerOrEventListenerObject): EventListenerOrEventListenerObject => byRaw.get(raw) ?? raw;
    };

    const windowAdd = vi.spyOn(window, 'addEventListener');
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');
    const unwrapWindow = wrap(windowAdd, originalWindowAdd, windowHandlers);
    const unwrapDocument = wrap(documentAdd, originalDocumentAdd, documentHandlers);
    windowRemove.mockImplementation(((type: string, handler: EventListenerOrEventListenerObject, options?: never) =>
      originalWindowRemove(type, unwrapWindow(handler), options)) as unknown as typeof window.removeEventListener);
    documentRemove.mockImplementation(((type: string, handler: EventListenerOrEventListenerObject, options?: never) =>
      originalDocumentRemove(
        type,
        unwrapDocument(handler),
        options
      )) as unknown as typeof document.removeEventListener);

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
    // same two events close the flyout AND reach the handlers. Without it, a component that
    // never listened at all would leave no menu either, and the post-unmount dispatch would
    // prove nothing — including the "not called" assertions, which a handler that was never
    // wired up would satisfy trivially.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
    const controlEscape = lastSpyFor(windowHandlers, 'keydown') as Mock;
    expect(controlEscape).toHaveBeenCalledTimes(1);

    // The same control for the outside click, on a tree that is live again.
    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => {
      fireEvent.click(document.body);
    });
    expect(screen.queryByRole('menu')).toBeNull();
    // `longPress` ends in a click of its own, so this only has to show the handler is
    // reached at all — how many times is not the claim.
    expect(lastSpyFor(documentHandlers, 'click')).toHaveBeenCalled();

    longPress(toolbarButtonByName('brush'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // The handlers of the flyout that is OPEN NOW — the last subscription, not one the two
    // controls above already retired. These are the handlers `unmount` has to unsubscribe and
    // the ones the post-unmount dispatch must fail to reach.
    const liveEscapeSpy = lastSpyFor(windowHandlers, 'keydown') as Mock;
    const liveClickSpy = lastSpyFor(documentHandlers, 'click') as Mock;
    const liveEscape = lastRawFor(windowAdd.mock.calls, 'keydown');
    const liveClick = lastRawFor(documentAdd.mock.calls, 'click');
    expect(liveEscapeSpy).not.toBe(controlEscape);

    // Every count so far belongs to the controls. Cleared here so that "not called" below is
    // a statement about the window AFTER the unmount and not a sum over the whole test.
    for (const spy of [...windowHandlers, ...documentHandlers]) spy.spy.mockClear();

    unmount();

    expect(screen.queryByRole('menu')).toBeNull();
    // Removal by the SAME function reference is the only form the DOM API accepts: a fresh
    // closure per render would unsubscribe a listener nobody registered and leave the live one
    // on `window` for the rest of the session. The component only ever holds its own closure,
    // so the reference it hands `removeEventListener` is compared here, and the wrapper it was
    // registered behind is what the DOM actually saw and dropped.
    expect(windowRemove).toHaveBeenCalledWith('keydown', liveEscape);
    expect(documentRemove).toHaveBeenCalledWith('click', liveClick);

    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_DELAY);
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    act(() => {
      fireEvent.click(document.body);
    });

    // The teardown, observed as behaviour rather than as bookkeeping: the two handlers the
    // controls above proved answer these very events are not called by them now.
    expect(liveEscapeSpy).not.toHaveBeenCalled();
    expect(liveClickSpy).not.toHaveBeenCalled();
    // And nothing re-enters the DOM: a subscriber that survived the unmount would resurrect
    // the flyout on the click above.
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
