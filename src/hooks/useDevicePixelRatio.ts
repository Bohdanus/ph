import { useEffect, useState } from 'react';

/**
 * `window.devicePixelRatio`, guarded, and re-read when the window moves to a display with a
 * different one.
 *
 * The value is read from `window.devicePixelRatio` rather than derived from a media query because
 * that is the number the compositor actually uses, and it is the one a test can stub. The
 * `matchMedia` listener exists only as a change NOTIFICATION: a `(resolution: Ndppx)` query stops
 * matching the moment the ratio moves, so listening to the one captured at mount would fire at most
 * once and never again. The handler therefore re-subscribes against the new value.
 */
export function currentDevicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;

  const ratio = window.devicePixelRatio;
  // A zero or non-finite ratio would make every backing-store size derived from it zero, and a
  // canvas with a zero dimension is 300x150 again by the spec — so the fallback is 1, the value
  // that reproduces a 1:1 canvas.
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(currentDevicePixelRatio);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    let query: MediaQueryList | null = null;

    const onChange = () => {
      setRatio(currentDevicePixelRatio());
      query?.removeEventListener('change', onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', onChange);
    };

    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener('change', onChange);

    return () => query?.removeEventListener('change', onChange);
  }, []);

  return ratio;
}
