import { useSyncExternalStore } from 'react';

import type { Size } from '../contexts/general-types.ts';
import type { RulerMeasurement } from './ruler.ts';

/**
 * The measuring line, shared between the canvas gesture and the options bar.
 *
 * The Ruler is the first tool in this app whose *options bar* is a function of a *gesture in
 * progress* rather than of a setting: Adobe puts X, Y, W, H, A, D1 and D2 in the bar, so
 * `RulerToolArea` produces numbers and `Ruler` displays them, and they are not in a parent-child
 * relationship. `RulerToolArea` lives under the canvas and `Ruler` under the options strip.
 *
 * It is a module store rather than app-store state on purpose, and the reason is the same one
 * `PIXEL_FREE_TOOLS` gives for the tool having no processor: a measurement is not part of the
 * document. Nothing here is history, nothing here is durable, nothing here can be exported, and a
 * measurement that reached `StoreContext` would be a field that undo has no opinion about and that
 * the document-replacement paths would each have to decide about. The `useSyncExternalStore` shape
 * is the one `src/components/SidebarLeft/toolbar-fit-store.ts` already uses, so a second reader of
 * this pattern will recognise it.
 *
 * **Scope of the value.** It outlives the tool area's mount, because Adobe's own sentence is
 * "If your document has an existing measuring line, selecting the Ruler tool causes it to be
 * displayed" — a line that vanished on every tool switch could never satisfy that. It is dropped
 * when the document's frame SIZE changes instead, which is the cheapest signal available for "this
 * is a different document" and also covers a crop, whose line would otherwise be measured against
 * an origin that has moved.
 */
const NO_MEASUREMENT: RulerMeasurement | null = null;

let current: RulerMeasurement | null = NO_MEASUREMENT;
let frameSize = '';
let listeners: readonly (() => void)[] = [];

const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * Publishes the line. The object is stored by reference, so a caller that mutates the measurement
 * it just published would mutate the snapshot every subscriber is holding; nothing here mutates,
 * and `measureRuler` only reads.
 */
export const setRulerMeasurement = (measurement: RulerMeasurement | null): void => {
  if (current === measurement) return;
  current = measurement;
  emit();
};

/** Adobe's `Clear` in the tool options bar: "To remove the line", click Clear. */
export const clearRulerMeasurement = (): void => setRulerMeasurement(null);

/**
 * Drops a line that belongs to a document this size cannot be showing.
 *
 * Called from the tool area with the current frame size on every paint. A size that has not
 * changed is the overwhelmingly common case, so the comparison is a string compare and the
 * subscribers are not woken.
 */
export const syncRulerFrameSize = (size: Size): void => {
  const key = `${size.width}x${size.height}`;
  if (key === frameSize) return;
  frameSize = key;
  if (current === NO_MEASUREMENT) return;
  current = NO_MEASUREMENT;
  emit();
};

/** Test seam: the whole module state, so a test can start from a known line. */
export const resetRulerMeasurementForTest = (): void => {
  current = NO_MEASUREMENT;
  frameSize = '';
  listeners = [];
};

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners = [...listeners, onStoreChange];
  return () => {
    listeners = listeners.filter((listener) => listener !== onStoreChange);
  };
};

const getSnapshot = (): RulerMeasurement | null => current;

export const useRulerMeasurement = (): RulerMeasurement | null =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
