import { useSyncExternalStore } from 'react';

import { getSnapshot, subscribeView } from './document-view.ts';

/**
 * The zoom level, for components that must RENDER it.
 *
 * A thin `useSyncExternalStore` binding over the view store, and nothing more. The reason it
 * can be this thin is that `getSnapshot` returns a cached object whose identity changes only
 * when the zoom level or the fit does — see the note on `getSnapshot` in `document-view.ts`.
 * That is what stops this hook from re-rendering its subscriber once per pointermove during a
 * pan: `useSyncExternalStore` compares snapshots by identity and skips the render when they
 * match.
 *
 * Anything that needs `dx`/`dy`, or needs them SYNCHRONOUSLY on the pointer path, must not
 * come through here. Read `getView()` directly instead.
 */
export function useDocumentView() {
  return useSyncExternalStore(subscribeView, getSnapshot, getSnapshot);
}
