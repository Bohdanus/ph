import { useSyncExternalStore } from 'react';

import type { Point, Size } from '../contexts/general-types.ts';
import {
  COLOR_SAMPLER_MAX_SAMPLES,
  type ColorSampler,
  type SamplerCapResult,
  samplerAt,
  samplerCapReached,
} from './colorSampler.ts';

/**
 * The samplers, shared between the canvas gesture, the canvas overlay and the options bar.
 *
 * The Ruler's line and the samplers are the same shape of problem, and the reason they are module
 * state rather than app-store state is the same one in both cases: **neither is part of the
 * document.** Nothing here is history, nothing here is durable, nothing here can be exported, and a
 * sampler that reached `StoreContext` would be a field undo has no opinion about and that every
 * document-replacement path would each have to decide about. The `useSyncExternalStore` shape is the
 * one `src/tools/ruler-measurement-store.ts` and `src/components/SidebarLeft/toolbar-fit-store.ts`
 * already use.
 *
 * **Scope of the value.** Samplers outlive the tool area's mount, which is the Ruler's rule and here
 * it is not only a convenience: Adobe's samplers are document data — "These samplers are saved in
 * the image, so you can refer to them repeatedly as you work" — so they must at least survive a tool
 * switch, and the app's own marker drawing needs them to survive it too. They are dropped when the
 * document's frame SIZE changes, which is the cheapest available signal for "this is a different
 * document" and also covers a crop, whose sampler would otherwise sit against an origin that moved.
 * **That is weaker than Adobe's rule and the divergence is recorded in the tool's description**:
 * Photoshop's survive closing and reopening the image, and the app's do not, because the app has
 * nowhere to put them that a document does not own.
 */
let current: readonly ColorSampler[] = [];
let frameSize = '';
let listeners: readonly (() => void)[] = [];

const emit = () => {
  for (const listener of listeners) listener();
};

/**
 * Publishes the sampler list.
 *
 * The array is stored BY REFERENCE and every mutation here produces a new array, so a subscriber
 * holding a snapshot sees a stable value — which `useSyncExternalStore` requires, since a snapshot
 * that changed identity on every render would loop. The store returns the same array when a call
 * changes nothing, so a refused click does not wake subscribers at all.
 */
const publish = (samplers: readonly ColorSampler[]): void => {
  if (samplers === current) return;
  current = samplers;
  emit();
};

/**
 * Places a sampler, or refuses to.
 *
 * The refusal carries a reason rather than replacing or deleting anything, because no source
 * describes Photoshop doing either of those: the cap is a cap, and the one observation of it being
 * reached is a message. A refused placement returns `{ ok: false }` and changes nothing.
 *
 * The `id` is assigned here rather than by the caller and is 1-based, because it is the label
 * Photoshop prints beside the marker and it must count placement order — including after a deletion,
 * where the remaining samplers keep the numbers they were given rather than being renumbered. That
 * matches Photoshop's `#1`, `#2`, … labelling, and it is why `id` is stored on the sampler instead
 * of being its index: renumbering on delete would make a user's reference to "sampler 2" mean two
 * different points over the course of a session.
 */
export const addColorSampler = (
  point: Point,
  color: string
): SamplerCapResult & { samplers: readonly ColorSampler[] } => {
  const cap = samplerCapReached(current.length);
  if (!cap.ok) return { ...cap, samplers: current };

  const id = current.reduce((highest, sampler) => Math.max(highest, sampler.id), 0) + 1;
  const samplers = [...current, { id, point, color }];
  publish(samplers);
  return { ok: true, samplers };
};

/** Moves a sampler to a new point, keeping its id and its colour. */
export const moveColorSampler = (id: number, point: Point): readonly ColorSampler[] => {
  const samplers = current.map((sampler) => (sampler.id === id ? { ...sampler, point } : sampler));
  publish(samplers);
  return samplers;
};

/**
 * Deletes one sampler.
 *
 * Adobe gives three ways: drag it out of the document window, Alt/Option-click it with the scissors
 * cursor, and Clear for all of them. All three land here.
 */
export const removeColorSampler = (id: number): readonly ColorSampler[] => {
  const samplers = current.filter((sampler) => sampler.id !== id);
  publish(samplers);
  return samplers;
};

/** Adobe's `Clear`: "To delete all color samplers, click Clear in the options bar." */
export const clearColorSamplers = (): void => {
  // Guarded rather than `publish([])`: an unconditional fresh array would NOT be caught by
  // `publish`'s identity check, because a new `[]` is never the current one. That would re-render
  // every reader for a Clear that removed nothing, which is exactly what the identity check exists
  // to prevent — and the button is greyed while the list is empty, so this path is nearly
  // unreachable from the bar and reachable only from a test or a future caller.
  if (current.length === 0) return;
  publish([]);
};

/**
 * The sampler under the pointer, or `null`.
 *
 * Exported so the tool area and the Eyedropper's Shift-click share ONE hit test rather than two that
 * can disagree about which sampler a press at a point means.
 */
export const colorSamplerAt = (point: Point): ColorSampler | null => samplerAt(current, point);

/**
 * Drops samplers that belong to a document this size cannot be showing.
 *
 * A size that has not changed is the overwhelmingly common case, so the comparison is a string
 * compare and the subscribers are not woken. Called from the tool area with the current frame size
 * on every paint.
 */
export const syncColorSamplerFrameSize = (size: Size): void => {
  const key = `${size.width}x${size.height}`;
  if (key === frameSize) return;
  // The FIRST registration is not a size change, and treating it as one dropped every sampler that
  // was placed while another tool held the tile — the Eyedropper's Shift-click path, which is how
  // Adobe says a sampler is added from another tool. An empty `frameSize` means "nothing has been
  // observed yet", which is not the same statement as "the document changed", and conflating them
  // loses the samplers the moment this tool is first selected.
  if (frameSize === '') {
    frameSize = key;
    return;
  }
  frameSize = key;
  if (current.length === 0) return;
  publish([]);
};

/** Test seam: the whole module state, so a test can start from a known list. */
export const resetColorSamplersForTest = (): void => {
  current = [];
  frameSize = '';
  listeners = [];
};

const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners = [...listeners, onStoreChange];
  return () => {
    listeners = listeners.filter((listener) => listener !== onStoreChange);
  };
};

const getSnapshot = (): readonly ColorSampler[] => current;

export const useColorSamplers = (): readonly ColorSampler[] =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

export { COLOR_SAMPLER_MAX_SAMPLES };
