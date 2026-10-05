import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearRulerMeasurement,
  resetRulerMeasurementForTest,
  setRulerMeasurement,
  syncRulerFrame,
  useRulerMeasurement,
} from '../ruler-measurement-store.ts';

const DOC_A = 'doc-a';
const DOC_B = 'doc-b';
const SIZE = { width: 800, height: 600 };
const LINE = { start: { x: 10, y: 10 }, end: { x: 110, y: 10 } };

/**
 * The store read through its own hook, so every assertion is about the snapshot a subscriber
 * actually receives rather than about a private getter. It also counts renders, because a store
 * whose comparison always reports a change re-renders the options bar on every pointer move.
 */
const readStore = () => {
  const renders = vi.fn();
  const view = renderHook(() => {
    renders();
    return useRulerMeasurement();
  });
  return { ...view, renders, current: () => view.result.current };
};

describe('the ruler measurement store', () => {
  beforeEach(() => {
    resetRulerMeasurementForTest();
  });

  it('publishes a line and reads it back through the hook', () => {
    const store = readStore();
    expect(store.current()).toBeNull();

    act(() => setRulerMeasurement(LINE));

    expect(store.current()).toEqual(LINE);
  });

  it('KEEPS the line when only the frame size is unchanged, so a tool switch does not lose it', () => {
    const store = readStore();
    act(() => setRulerMeasurement(LINE));

    // Adobe: "If your document has an existing measuring line, selecting the Ruler tool causes it
    // to be displayed" — a line that vanished on every switch could never satisfy that.
    act(() => syncRulerFrame(DOC_A, SIZE));

    expect(store.current()).toEqual(LINE);
  });

  it('DROPS the line when the DOCUMENT changes, at an identical frame size', () => {
    const store = readStore();
    act(() => {
      setRulerMeasurement(LINE);
      syncRulerFrame(DOC_A, SIZE);
    });
    expect(store.current()).toEqual(LINE);

    // The defect this pins. The key was the frame size alone, and the app's own Blank seed is a
    // fixed 800x600, so measuring on one image and opening another of the same size left the first
    // line standing over the second — with the bar reporting X/Y/W/H/D1 for a line that does not
    // exist in this document. A size cannot tell two documents apart; `documentId` can, and it was
    // already in `StoreContext` the whole time.
    act(() => syncRulerFrame(DOC_B, SIZE));

    expect(store.current()).toBeNull();
  });

  it('DROPS the line on a CROP of the same document, because the frame origin has moved', () => {
    const store = readStore();
    act(() => {
      setRulerMeasurement(LINE);
      syncRulerFrame(DOC_A, SIZE);
    });

    act(() => syncRulerFrame(DOC_A, { width: 400, height: 300 }));

    expect(store.current()).toBeNull();
  });

  it('does not wake its subscribers for a sync that changes nothing', () => {
    const store = readStore();
    act(() => {
      setRulerMeasurement(LINE);
      syncRulerFrame(DOC_A, SIZE);
    });
    const before = store.renders.mock.calls.length;

    act(() => syncRulerFrame(DOC_A, SIZE));

    // A sync runs on every paint of the tool area, so waking the options bar each time would
    // re-render the seven readouts on every pointer move for a document that did not change.
    expect(store.renders.mock.calls.length).toBe(before);
  });

  it('clears on Clear, and a second Clear is a no-op rather than an error', () => {
    const store = readStore();
    act(() => {
      setRulerMeasurement(LINE);
      syncRulerFrame(DOC_A, SIZE);
    });

    act(() => clearRulerMeasurement());
    expect(store.current()).toBeNull();

    act(() => clearRulerMeasurement());
    expect(store.current()).toBeNull();
  });

  it('publishes a NEW object even when the geometry is identical, because a drag republishes it', () => {
    const store = readStore();
    act(() => syncRulerFrame(DOC_A, SIZE));

    // The store's own doc says the value is held by reference and that a drag publishes a fresh
    // object per move. A store that deduplicated by geometry would freeze the last move of a drag.
    const first = { start: { x: 0, y: 0 }, end: { x: 10, y: 0 } };
    act(() => setRulerMeasurement(first));
    const afterFirst = store.current();

    act(() => setRulerMeasurement({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }));

    expect(store.current()).toEqual(afterFirst);
    expect(store.current()).not.toBe(afterFirst);
  });
});
