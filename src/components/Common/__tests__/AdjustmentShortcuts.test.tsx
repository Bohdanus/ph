import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdjustmentShortcuts } from '../AdjustmentShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';
import { claimDocumentGesture, releaseDocumentGesture } from '../../../hooks/document-gesture.ts';

/** The real `KeyboardEventsProvider`, so the guards under test are production's. */

const invertActiveLayer = vi.hoisted(() => vi.fn(async () => undefined));
const storeState = vi.hoisted(() => ({ hasImage: true }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../hooks/useInvertLayer.ts', () => ({
  useInvertLayer: () => ({ invertActiveLayer }),
}));

function press(key: string, init: Partial<KeyboardEventInit> = {}, target: Element | Document = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return !fireEvent(target, event);
}

function renderShortcuts() {
  return render(
    <KeyboardEventsProvider>
      <AdjustmentShortcuts />
    </KeyboardEventsProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState.hasImage = true;
});

afterEach(() => {
  releaseDocumentGesture('rectangular-selection', 1);
});

describe('AdjustmentShortcuts', () => {
  it.each([
    ['i', { ctrlKey: true }],
    ['i', { metaKey: true }],
    ['I', { ctrlKey: true }],
  ] as const)('inverts for %s with %o and claims the key', (key, modifiers) => {
    renderShortcuts();

    expect(press(key, modifiers)).toBe(true);
    expect(invertActiveLayer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['i', {}],
    ['I', { ctrlKey: true, shiftKey: true }],
    ['i', { metaKey: true, altKey: true }],
  ] as const)('leaves %s with %o to other handlers', (key, modifiers) => {
    renderShortcuts();

    expect(press(key, modifiers)).toBe(false);
    expect(invertActiveLayer).not.toHaveBeenCalled();
  });

  it('leaves the browser default alone with no document loaded', () => {
    storeState.hasImage = false;
    renderShortcuts();

    expect(press('i', { ctrlKey: true })).toBe(false);
    expect(invertActiveLayer).not.toHaveBeenCalled();
  });

  it('lets mod+I reach a focused text field', () => {
    renderShortcuts();
    const input = document.createElement('input');
    document.body.append(input);

    try {
      expect(press('i', { ctrlKey: true }, input)).toBe(false);
      expect(invertActiveLayer).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('refuses while a document gesture is open', () => {
    renderShortcuts();
    claimDocumentGesture('rectangular-selection', 1);

    press('i', { ctrlKey: true });

    expect(invertActiveLayer).not.toHaveBeenCalled();
  });

  it('inverts once for a held key, so auto-repeat cannot toggle the layer back and forth', () => {
    renderShortcuts();

    press('i', { ctrlKey: true });
    press('i', { ctrlKey: true, repeat: true });

    expect(invertActiveLayer).toHaveBeenCalledTimes(1);
  });
});
