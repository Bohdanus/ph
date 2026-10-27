import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyboardEventsProvider, useKeyDownShortcut, useKeyUpShortcut } from '../useKeyboardEvents.tsx';
import { claimDocumentGesture, releaseDocumentGesture, resetDocumentGestures } from '../document-gesture.ts';

/**
 * The keyup channel on the shared keyboard primitive.
 *
 * Every existing shortcut omits `onKeyUp`, so the load-bearing assertion in the first case is that
 * adding the field changed nothing about the press path — this file is the guard on a shared
 * primitive that every shortcut in the app resolves through.
 *
 * The probe declares BOTH registrations unconditionally and each no-ops when its callback is
 * absent, rather than registering the release conditionally. A conditional hook is the Rules of
 * Hooks violation this repo's own lint rejects, and a probe that broke the rule to test the
 * primitive would be testing it from the wrong side.
 */

const Probe = ({ onKeyDown, onKeyUp }: { onKeyDown?: () => void; onKeyUp?: () => void }) => {
  useKeyDownShortcut({
    key: 'k',
    onKeyDown: () => onKeyDown?.(),
  });

  useKeyUpShortcut({ key: 'k', onKeyUp: () => onKeyUp?.(), mutatesDocument: false });

  return null;
};

const renderProbe = (props: Parameters<typeof Probe>[0]) =>
  render(
    <KeyboardEventsProvider>
      <Probe {...props} />
    </KeyboardEventsProvider>
  );

const down = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }));
  });

const up = () =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'k', bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  resetDocumentGestures();
});

afterEach(() => {
  resetDocumentGestures();
});

describe('a registration that declares no release', () => {
  it('behaves exactly as it did before the field existed', () => {
    const onKeyDown = vi.fn();
    renderProbe({ onKeyDown });

    down();

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('is not dispatched on the release, so a press is never counted twice', () => {
    const onKeyDown = vi.fn();
    renderProbe({ onKeyDown });

    up();

    expect(onKeyDown).not.toHaveBeenCalled();
  });
});

describe('a registration that declares a release', () => {
  it('fires on the release', () => {
    const onKeyUp = vi.fn();
    renderProbe({ onKeyUp });

    up();

    expect(onKeyUp).toHaveBeenCalledTimes(1);
  });

  it('fires the release once however many presses came first', () => {
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();
    renderProbe({ onKeyDown, onKeyUp });

    down();
    down();
    up();

    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(onKeyUp).toHaveBeenCalledTimes(1);
  });

  it('unregisters on unmount, so a stale release cannot outlive its component', () => {
    const onKeyUp = vi.fn();
    const { unmount } = renderProbe({ onKeyUp });

    unmount();
    up();

    expect(onKeyUp).not.toHaveBeenCalled();
  });
});

describe('the two halves resolve independently', () => {
  it('refuses the press while a document gesture is open and still delivers the release', () => {
    const onKeyDown = vi.fn();
    const onKeyUp = vi.fn();
    renderProbe({ onKeyDown, onKeyUp });

    claimDocumentGesture('brush-stroke', 1);
    down();
    up();

    // The asymmetry the spring-loaded Hand depends on: a press may be refused, a release may not.
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onKeyUp).toHaveBeenCalledTimes(1);
  });

  it('resumes the press once the gesture closes', () => {
    const onKeyDown = vi.fn();
    renderProbe({ onKeyDown });

    claimDocumentGesture('brush-stroke', 1);
    down();
    expect(onKeyDown).not.toHaveBeenCalled();

    releaseDocumentGesture('brush-stroke', 1);
    down();

    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe('enabled as a getter', () => {
  it('is read per event, so a gate over mutable module state is never stale', () => {
    let open = false;
    const onKeyDown = vi.fn();

    const Dynamic = () => {
      useKeyDownShortcut({ key: 'j', onKeyDown, enabled: () => !open });
      return null;
    };

    render(
      <KeyboardEventsProvider>
        <Dynamic />
      </KeyboardEventsProvider>
    );

    const pressJ = () =>
      act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
      });

    pressJ();
    expect(onKeyDown).toHaveBeenCalledTimes(1);

    // Nothing re-renders between the two presses — `open` is a closure variable and the
    // component never re-renders — so a boolean captured at the last render would still read
    // `true` and the second press would dispatch.
    open = true;
    pressJ();

    expect(onKeyDown).toHaveBeenCalledTimes(1);

    open = false;
    pressJ();

    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it('treats a plain boolean exactly as it did before the union', () => {
    const onKeyDown = vi.fn();

    const Switched = () => {
      useKeyDownShortcut({ key: 'j', onKeyDown, enabled: false });
      return null;
    };

    render(
      <KeyboardEventsProvider>
        <Switched />
      </KeyboardEventsProvider>
    );

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
    });

    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
