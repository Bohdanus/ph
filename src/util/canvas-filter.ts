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

/**
 * A filter operation whose argument will not coerce to a number, so no CSS filter string
 * can be composed for it at all.
 *
 * It is a separate class from `CanvasFilterUnsupportedError` because the engine is not the
 * problem: this host implements `ctx.filter` perfectly well and the string is still invalid.
 * Both are refused BEFORE `ctx.filter` is assigned, because a browser discards an invalid
 * assignment outright rather than applying its valid part — the layer would then be drawn
 * unfiltered and nothing would say so. The render paths catch this per layer: a corrupt
 * argument is a property of the operation that carries it, and the rest of the document
 * composites exactly as `materialization.ts:322` already treats a failed layer.
 */
export class FilterArgumentUnrenderableError extends Error {
  readonly toolName: string;
  readonly field: string;

  constructor(toolName: string, field: string, received: unknown) {
    const printed = typeof received === 'string' ? JSON.stringify(received) : String(received);
    super(
      `Filter "${toolName}" has a non-numeric ${field} (${printed}). It was refused rather than ` +
        'rendered, because a browser discards an unparseable ctx.filter assignment outright and ' +
        'the layer would be drawn unfiltered with nothing to show for it.'
    );
    this.name = 'FilterArgumentUnrenderableError';
    this.toolName = toolName;
    this.field = field;
  }
}
