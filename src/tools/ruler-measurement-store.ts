import { useSyncExternalStore } from 'react';

import type { Point, Size } from '../contexts/general-types.ts';
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
 * The key is `documentId`, the frame ORIGIN and the frame SIZE together, and it has to be all
 * three. Each one was a version that was wrong in a way no test caught.
 *
 * `documentId` alone was wrong because two documents of the same size — the common case, since the
 * app's own default is 800×600 and its Blank seed is a fixed size — produced an equal key, so
 * opening the second one left the first one's line standing, painted over it, with the options bar
 * reporting authoritative-looking X/Y/W/H/D1 for a line that does not exist in this document.
 * `documentId` is minted per open in `useApp` and is already in the store, so the identity was
 * available the whole time.
 *
 * Size joined it because a CROP keeps the document and changes the frame. Size alone as the
 * remaining half was still wrong, and it is the case this module now has a test for: the line is
 * stored in FRAME coordinates — `RulerToolArea` measures in overlay-canvas pixels and its own
 * `isInsideFrame` refuses to subtract `documentFrame.x` — so a crop that keeps the size and moves
 * the origin re-anchors every pixel the line names to different DOCUMENT coordinates, and a 400×300
 * crop at one origin and a 400×300 crop at another produced one key. Cropping a band out of the top
 * and then a band of the same size out of the left is two ordinary gestures, and the second left the
 * first crop's line standing over the new frame with the bar reporting X/Y against coordinates that
 * were cropped away.
 *
 * So the origin is part of the key, and it is passed rather than derived: `totalSize` is
 * `documentFrameSize(frame)` and carries no `x`/`y`, so the store cannot recover the origin from
 * what it was already given. `Main` reads both out of `StoreContext` and hands them over together.
 *
 * **WHO ADVANCES THE KEY.** `syncRulerFrame` has exactly one caller in the application, and it is
 * `Main.tsx` rather than `RulerToolArea.tsx`, which is where it started. A module value that
 * outlives its mounts needs an owner that is mounted when the value's WORLD changes, and the tool
 * area is not: it is one of the registry's tools and is absent whenever another is selected, so a
 * line measured and then left behind survived the document open that should have discarded it.
 * `Main` is mounted whatever the active tool is. This is the same shape as
 * `resetDocumentGestures` in `src/hooks/document-gesture.ts`, which `useKeyboardEvents` calls from
 * its own mount and cleanup for the same reason — module state outliving a mount is bounded by
 * resetting it from above the mount, not from inside it.
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
 * Called from `Main` in a layout effect, with the current document and frame. An unchanged key is
 * the overwhelmingly common case, so the comparison is a string compare and the subscribers are not
 * woken.
 *
 * `origin` is `documentFrame.x`/`.y`, and it is an ARGUMENT rather than something read from `size`
 * because `size` is `totalSize` — `documentFrameSize(frame)`, which is width and height and no
 * position. A measurement is in FRAME coordinates, so the origin is the half of the frame that says
 * which document pixels those frame coordinates name, and without it two equal-sized frames are one
 * key. `documentFrameEquals` is the same four-field comparison the crop commit already makes, so
 * there is one definition of "the frame changed" in the app rather than two.
 *
 * The FIRST sync only establishes the key, and that is a deliberate asymmetry rather than an
 * oversight. There is no previous document for a line to be stale against, so treating the blank
 * key as "a different document" would drop a line published before the tool area ever mounted —
 * which is reachable from a test that seeds the store, and is a footgun in the API even where the
 * app's own ordering happens to avoid it. A real key is never blank, so the sentinel is safe.
 */
export const syncRulerFrame = (documentId: string, size: Size, origin: Point): void => {
  const key = `${documentId}@${origin.x},${origin.y}+${size.width}x${size.height}`;
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
