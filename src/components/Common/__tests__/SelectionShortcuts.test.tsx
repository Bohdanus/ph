import { fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionShortcuts } from '../SelectionShortcuts.tsx';
import { KeyboardEventsProvider } from '../../../hooks/useKeyboardEvents.tsx';
import { claimDocumentGesture, releaseDocumentGesture } from '../../../hooks/document-gesture.ts';

/** The real `KeyboardEventsProvider`, so the guards under test are production's. */

const selectAll = vi.hoisted(() => vi.fn());
const clearSelections = vi.hoisted(() => vi.fn());
const storeState = vi.hoisted(() => ({ hasImage: true }));

vi.mock('../../../contexts/StoreContext.tsx', () => ({
  useStore: () => [storeState, vi.fn()],
}));

vi.mock('../../../contexts/useSelectionHistory.ts', () => ({
  useSelectionHistory: () => ({ selectAll, clearSelections }),
}));

function press(key: string, init: Partial<KeyboardEventInit> = {}, target: Element | Document = document) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  return !fireEvent(target, event);
}

function renderShortcuts() {
  return render(
    <KeyboardEventsProvider>
      <SelectionShortcuts />
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

describe('SelectionShortcuts', () => {
  it.each([
    ['a', { ctrlKey: true }, selectAll],
    ['a', { metaKey: true }, selectAll],
    ['A', { metaKey: true }, selectAll],
    ['d', { ctrlKey: true }, clearSelections],
    ['d', { metaKey: true }, clearSelections],
  ] as const)('runs the command for %s with %o and claims the key', (key, modifiers, command) => {
    renderShortcuts();

    expect(press(key, modifiers)).toBe(true);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a', {}],
    ['d', {}],
    ['a', { ctrlKey: true, shiftKey: true }],
    ['d', { metaKey: true, shiftKey: true }],
    ['d', { ctrlKey: true, altKey: true }],
  ] as const)('ignores %s with %o', (key, modifiers) => {
    renderShortcuts();

    expect(press(key, modifiers)).toBe(false);
    expect(selectAll).not.toHaveBeenCalled();
    expect(clearSelections).not.toHaveBeenCalled();
  });

  it('leaves the browser default alone with no document loaded', () => {
    storeState.hasImage = false;
    renderShortcuts();

    expect(press('a', { ctrlKey: true })).toBe(false);
    expect(press('d', { ctrlKey: true })).toBe(false);
    expect(selectAll).not.toHaveBeenCalled();
    expect(clearSelections).not.toHaveBeenCalled();
  });

  it('lets mod+A select the text of a focused text field', () => {
    renderShortcuts();
    const input = document.createElement('input');
    document.body.append(input);

    try {
      expect(press('a', { ctrlKey: true }, input)).toBe(false);
      expect(selectAll).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it('refuses both commands while a document gesture is open', () => {
    renderShortcuts();
    claimDocumentGesture('rectangular-selection', 1);

    press('a', { ctrlKey: true });
    press('d', { ctrlKey: true });

    expect(selectAll).not.toHaveBeenCalled();
    expect(clearSelections).not.toHaveBeenCalled();
  });

  it('runs once for a held key', () => {
    renderShortcuts();

    press('d', { ctrlKey: true });
    press('d', { ctrlKey: true, repeat: true });

    expect(clearSelections).toHaveBeenCalledTimes(1);
  });
});
