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
 * is the one `src/components/SidebarLeft/use-toolbar-overflow.ts` already uses — `toolbar-fit-store.ts`
 * only describes the API in prose — so a second reader of this pattern will recognise it.
 *
 * **Scope of the value.** It outlives the tool area's mount, because Adobe's own sentence is
 * "If your document has an existing measuring line, selecting the Ruler tool causes it to be
 * displayed" — a line that vanished on every tool switch could never satisfy that. It is dropped
 * when the DOCUMENT changes instead, and a crop is covered for the same reason: a line measured
 * against an origin that has moved is worse than no line.
 *
 * The key is `documentId` AND the frame size together, and it has to be both. Size alone was the
 * first version and it was wrong in a way no test caught: two documents of the same size — the
 * common case, since the app's own default is 800×600 and its Blank seed is a fixed size — produced
 * an equal key, so opening the second one left the first one's line standing, painted over it, with
 * the options bar reporting authoritative-looking X/Y/W/H/D1 for a line that does not exist in this
 * document. `documentId` is minted per open in `useApp` and is already in the store, so the
 * identity was available the whole time; the size is kept beside it because a CROP keeps the
 * document and changes the frame, and a line across the old frame is stale for the same reason.
 */
const NO_MEASUREMENT: RulerMeasurement | null = null;

let current: RulerMeasurement | null = NO_MEASUREMENT;
let frameKey = '';
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
 * Drops a line that belongs to a document or a frame this key cannot be describing.
 *
 * Called from the tool area with the current document and frame on every paint. An unchanged key is
 * the overwhelmingly common case, so the comparison is a string compare and the subscribers are not
 * woken.
 *
 * The FIRST sync only establishes the key, and that is a deliberate asymmetry rather than an
 * oversight. There is no previous document for a line to be stale against, so treating the blank
 * key as "a different document" would drop a line published before the tool area ever mounted —
 * which is reachable from a test that seeds the store, and is a footgun in the API even where the
 * app's own ordering happens to avoid it. A real key is never blank, so the sentinel is safe.
 */
export const syncRulerFrame = (documentId: string, size: Size): void => {
  const key = `${documentId}@${size.width}x${size.height}`;
  if (key === frameKey) return;
  const isFirstSync = frameKey === '';
  frameKey = key;
  if (isFirstSync || current === NO_MEASUREMENT) return;
  current = NO_MEASUREMENT;
  emit();
};

/**
 * Test seam: the whole module state, so a test can start from a known line.
 *
 * `listeners = []` is safe ONLY because every caller runs this before a component mounts. Called
 * with a subscriber live, its unsubscribe would filter an already-empty array, match nothing, and
 * leave that subscriber holding a snapshot no `emit` can ever reach — so it is named `ForTest` and
 * the tests that call it own a `beforeEach`, not a running tree.
 */
export const resetRulerMeasurementForTest = (): void => {
  current = NO_MEASUREMENT;
  frameKey = '';
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
