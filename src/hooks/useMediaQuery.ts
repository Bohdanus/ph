import { useCallback, useSyncExternalStore } from 'react';

/**
 * The mobile boundary, expressed as the SAME media query the stylesheet compiles.
 *
 * Tailwind v4 emits `max-md:` as `@media (width < 48rem)` by default. A `rem` length in a
 * media query resolves against the *user's* default font size, so at a 20px default that
 * boundary moves to 960px while a JS check against the literal 768 does not. The two then
 * disagree across a 192px band in which the stylesheet has hidden every desktop region but
 * the JS still mounted the desktop tree, leaving a bare canvas and no way back. Pinning
 * `--breakpoint-md`/`--breakpoint-lg` to px in `src/index.scss` makes Tailwind emit
 * `(width < 768px)`, which is character-for-character the query below.
 */
export const MOBILE_MEDIA_QUERY = '(width < 768px)';

/** The tablet band: the complement of `MOBILE_MEDIA_QUERY` below the `lg` boundary. */
export const TABLET_MEDIA_QUERY = '(width >= 768px) and (width < 1024px)';

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(query).matches;
}

/**
 * Subscribe to a media query and re-render only when its boolean result flips.
 *
 * `window.matchMedia` is used rather than a `resize` listener over `window.innerWidth`
 * because `change` fires only when the answer actually changes. A raw `resize` handler
 * fires on every frame of a window drag, so a width-based hook re-renders the whole app
 * tree dozens of times per drag to feed it a value nothing reads. A media query reduces
 * that to one render per boundary crossed: four for a full-width drag across both bands,
 * none for a drag that stays inside one.
 *
 * `useSyncExternalStore` is the primitive for exactly this shape, and it is not incidental:
 * the browser is an external store, and React's own guidance for reading one is this hook.
 * It re-reads the snapshot when it subscribes, so a crossing between the first render and
 * the subscription is caught without a `setState` in an effect body, which would cascade an
 * extra render on every mount and is rejected by `react-hooks/set-state-in-effect`.
 *
 * `matchMedia` is absent in jsdom, and absent is treated as "no match", which is the
 * desktop layout. That is the safe direction for a desktop-first app: a missing primitive
 * must never silently select the mobile shell. `src/test/setup.ts` installs an evaluator so
 * the responsive branches are reachable from tests.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};

      const list = window.matchMedia(query);

      if (typeof list.addEventListener === 'function') {
        list.addEventListener('change', onStoreChange);
        return () => list.removeEventListener('change', onStoreChange);
      }

      // Safari < 14, and any host without EventTarget on MediaQueryList.
      list.addListener(onStoreChange);
      return () => list.removeListener(onStoreChange);
    },
    [query]
  );

  const getSnapshot = useCallback(() => matches(query), [query]);

  // This app mounts with `createRoot`, so there is no hydration step. The third argument is
  // still supplied so the hook stays correct under SSR: the server would render the desktop
  // shell, which is the same answer a host with no `matchMedia` gives, rather than a
  // different one that would fail hydration.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** True below the mobile boundary, where the mobile shell replaces the desktop chrome. */
export function useIsMobileViewport(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}

/** True in the tablet band: the desktop shell, restyled to give the canvas more room. */
export function useIsTabletViewport(): boolean {
  return useMediaQuery(TABLET_MEDIA_QUERY);
}
