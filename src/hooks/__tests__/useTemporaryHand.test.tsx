import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSpaceHeld, useRegisterTemporaryHand, resetTemporaryHand, useSpaceHeld } from '../useTemporaryHand.ts';
import { claimKeyCapture, releaseKeyCapture, resetKeyCaptures } from '../input-capture.ts';
import { claimDocumentGesture, resetDocumentGestures } from '../document-gesture.ts';
import { KeyboardEventsProvider } from '../useKeyboardEvents.tsx';

/**
 * The spring-loaded Hand, driven through the REAL keyboard channel.
 *
 * Not a mock of it. The behaviour under test is the interaction between three things the
 * registrations declare — `enabled` as a getter, the default `mutatesDocument: true` on the
 * press, and the explicit `mutatesDocument: false` on the release — and a mocked channel would
 * assert the test's own copy of those rules rather than the ones `useKeyboardEvents` enforces.
 * Every case here is the question "what does the shared channel do with this registration".
 */
const Probe = () => {
  useRegisterTemporaryHand();
  const held = useSpaceHeld();
  return <span data-testid="held">{String(held)}</span>;
};

const renderProbe = () =>
  render(
    <KeyboardEventsProvider>
      <Probe />
    </KeyboardEventsProvider>
  );

const press = (key = ' ') => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

const release = (key = ' ') => {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
  });
};

const armed = () => isSpaceHeld();

beforeEach(() => {
  resetDocumentGestures();
  resetKeyCaptures();
  resetTemporaryHand();
});

afterEach(() => {
  resetDocumentGestures();
  resetKeyCaptures();
  resetTemporaryHand();
});

describe('the spring-loaded Hand', () => {
  it('arms on the press and disarms on the release', () => {
    renderProbe();

    expect(armed()).toBe(false);

    press();
    expect(armed()).toBe(true);

    release();
    expect(armed()).toBe(false);
  });

  it('publishes the armed state so the cursor can follow it', () => {
    const { getByTestId } = renderProbe();

    expect(getByTestId('held').textContent).toBe('false');

    press();
    expect(getByTestId('held').textContent).toBe('true');

    release();
    expect(getByTestId('held').textContent).toBe('false');
  });

  it('cancels the browser default, so the page cannot scroll under a pan', () => {
    renderProbe();

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => {
      document.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores auto-repeat, so one press is one intent', () => {
    renderProbe();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true, cancelable: true }));
    });

    expect(armed()).toBe(false);
  });

  it('does not arm from an editable target', () => {
    renderProbe();

    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    });

    expect(armed()).toBe(false);
    input.remove();
  });
});

describe('the press is refused while a document gesture is open', () => {
  it('arms with no gesture in flight', () => {
    renderProbe();

    press();

    expect(armed()).toBe(true);
  });

  it('refuses to arm while a committing gesture is open', () => {
    renderProbe();
    claimDocumentGesture('brush-stroke', 1);

    press();

    // Not a preference: arming swaps the mounted tool area, and every tool area releases its
    // gesture claim on unmount, so arming mid-stroke would abort the stroke in flight.
    expect(armed()).toBe(false);
  });

  it('still disarms after such a refusal, because a release is never refusable', () => {
    renderProbe();
    press();
    expect(armed()).toBe(true);

    // A gesture opening while Space is held is exactly the case the asymmetry exists for: the
    // release has to get through, or the modifier sticks.
    claimDocumentGesture('brush-stroke', 1);
    release();

    expect(armed()).toBe(false);
  });
});

describe('the press is refused while a surface owns the keyboard', () => {
  const owner = Symbol('test-owner');

  it('arms when nothing has claimed the capture', () => {
    renderProbe();

    press();

    expect(armed()).toBe(true);
  });

  it('refuses while another surface holds the capture', () => {
    renderProbe();
    claimKeyCapture(owner);

    press();

    expect(armed()).toBe(false);
  });

  it('arms again once that surface releases it', () => {
    renderProbe();
    claimKeyCapture(owner);
    press();
    expect(armed()).toBe(false);

    releaseKeyCapture(owner);
    press();

    expect(armed()).toBe(true);
  });

  it('reads the capture at event time rather than at the last render', () => {
    // A flyout can open between two presses with no re-render in between, so a boolean captured
    // at the previous render would arm a shortcut that was supposed to be refused.
    renderProbe();

    press();
    expect(armed()).toBe(true);
    release();

    claimKeyCapture(owner);
    press();

    expect(armed()).toBe(false);
  });
});

describe('a release the page never sees', () => {
  it('disarms when the window loses focus mid-press', () => {
    renderProbe();
    press();
    expect(armed()).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('blur'));
    });

    // A keyup goes to the focused document, so releasing Space while another window has focus
    // delivers nothing. Without this the flag stays armed with no key down.
    expect(armed()).toBe(false);
  });

  it('disarms when the tab is hidden mid-press', () => {
    renderProbe();
    press();

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(armed()).toBe(false);
  });
});

describe('leaks are bounded', () => {
  it('disarms on unmount, so the module-level flag cannot outlive the mount', () => {
    const { unmount } = renderProbe();
    press();
    expect(armed()).toBe(true);

    unmount();

    expect(armed()).toBe(false);
  });

  it('leaves no listener behind that a later press could reach', () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');

    const { unmount } = renderProbe();
    unmount();

    expect(removeWindow).toHaveBeenCalledWith('blur', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    removeWindow.mockRestore();
    removeDocument.mockRestore();
  });
});
