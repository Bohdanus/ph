import type { Pos } from '../contexts/general-types.ts';

function clientViewportSize(clientSize: number, rectSize: number, offsetSize: number): number {
  if (!Number.isFinite(clientSize) || !Number.isFinite(offsetSize)) return rectSize;
  const roundedBorderSize = offsetSize > 0 ? offsetSize : Math.round(rectSize);
  return Math.max(0, clientSize + rectSize - roundedBorderSize);
}

/** Measures the padding-box viewport used by the workspace canvas and its overlays. */
export function readClientViewportRect(element: HTMLElement): Pos {
  const rect = element.getBoundingClientRect();
  const clientLeft = Number.isFinite(element.clientLeft) ? element.clientLeft : 0;
  const clientTop = Number.isFinite(element.clientTop) ? element.clientTop : 0;

  return {
    x: rect.left + clientLeft,
    y: rect.top + clientTop,
    width: clientViewportSize(element.clientWidth, rect.width, element.offsetWidth),
    height: clientViewportSize(element.clientHeight, rect.height, element.offsetHeight),
  };
}
