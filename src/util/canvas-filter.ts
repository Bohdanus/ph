const PROBE_FILTER = 'grayscale(100%)';

export const supportsCanvasFilter = (ctx: OffscreenCanvasRenderingContext2D): boolean => {
  const probe = ctx.filter;
  ctx.filter = PROBE_FILTER;
  const ok = ctx.filter !== 'none';
  ctx.filter = probe;
  return ok;
};

const detectCanvasFilterSupport = (): boolean => {
  try {
    if (typeof OffscreenCanvas === 'undefined') return false;
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    return supportsCanvasFilter(ctx as OffscreenCanvasRenderingContext2D);
  } catch {
    return false;
  }
};

let canvasFilterSupported: boolean = detectCanvasFilterSupport();

export const isCanvasFilterSupported = (): boolean => canvasFilterSupported;

export const overrideCanvasFilterSupport = (supported: boolean | null): void => {
  canvasFilterSupported = supported === null ? detectCanvasFilterSupport() : supported;
};

export class CanvasFilterUnsupportedError extends Error {
  readonly label: string;

  constructor(label: string) {
    super(
      `${label} requires CanvasRenderingContext2D.filter, which this browser does not implement. ` +
        'It was refused rather than applied as a no-op, because a silent no-op would present and record ' +
        'pixels that no replay can reproduce.'
    );
    this.name = 'CanvasFilterUnsupportedError';
    this.label = label;
  }
}

export const requireCanvasFilter = (label: string): void => {
  if (canvasFilterSupported) return;
  throw new CanvasFilterUnsupportedError(label);
};
