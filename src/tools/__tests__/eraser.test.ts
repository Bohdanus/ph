import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEraseArgs, eraser, type EraserToolArgs } from '../eraser.ts';
import { setupDrawCtx } from '../draw.ts';
import { defaultSettings } from '../settings.ts';
import { toolProcessors } from '../toolProcessors.ts';
import { drawLine } from '../../util/draw.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';
import { createPixelCanvasContext } from '../../test/setup.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';
import type { Ctx2D, Point } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & {
  getImageData: ReturnType<typeof vi.fn>;
  putImageData: ReturnType<typeof vi.fn>;
};

class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    // Pixel-capable: the global stub in src/test/setup.ts deliberately has no `getImageData`.
    this.ctx = createPixelCanvasContext(this) as unknown as MockCtx;
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }
}

const stroke: Point[] = [
  { x: 2, y: 3 },
  { x: 9, y: 11 },
  { x: 14, y: 6 },
];

const eraserArgs = (overrides: Partial<EraserToolArgs> = {}): ToolArgs =>
  ({ ...defaultSettings.eraser, toolName: 'eraser', points: stroke, ...overrides }) as unknown as ToolArgs;

/** The committed canvas, recording its context so the raster ops are observable. */
const renderCommit = (args: ToolArgs, size = { width: 24, height: 18 }): MockCtx => {
  RecordingOffscreenCanvas.instances = [];
  eraser({ size })(args);
  return RecordingOffscreenCanvas.instances.at(-1)!.ctx;
};

/** Exactly what `DrawToolArea` does for the live preview: setup on the overlay, then paint. */
const renderPreview = (args: ToolArgs): MockCtx => {
  const ctx = createMockCanvasContext() as unknown as Ctx2D;
  const previewArgs = buildEraseArgs(args);
  setupDrawCtx(ctx, previewArgs);
  drawLine({ args: previewArgs, ctx });
  return ctx as unknown as MockCtx;
};

beforeEach(() => {
  RecordingOffscreenCanvas.instances = [];
  vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildEraseArgs', () => {
  it('always subtracts alpha, and never carries a dash', () => {
    const args = buildEraseArgs(eraserArgs({ mode: 'pencil', lineWidth: 12, alpha: 0.4, color: '#ff0000' }));

    expect(args.composite).toBe('destination-out');
    expect(args.penType).toBe('pen');
    expect(args.lineWidth).toBe(12);
    expect(args.alpha).toBe(0.4);
    expect(args.color).toBe('#ff0000');
    expect(args.lineDash).toBeUndefined();
    expect(args.blockStamp).toBe(false);
  });

  it('requests the block stamp for block mode and not for pencil', () => {
    expect(buildEraseArgs(eraserArgs({ mode: 'block' })).blockStamp).toBe(true);
    expect(buildEraseArgs(eraserArgs({ mode: 'pencil' })).blockStamp).toBe(false);
  });
});

describe('eraser processor', () => {
  it('subtracts alpha on the committed canvas, through the shared stroke painter', () => {
    // `mode` is named rather than inherited: the seeded default is `brush`, which does not reach
    // the shared painter at all. These are the two hard modes' contract, so they say which one
    // they are about.
    const ctx = renderCommit(eraserArgs({ mode: 'pencil', lineWidth: 7 }));

    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.lineWidth).toBe(7);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('subtracts alpha on the live preview overlay too, so the preview matches the commit', () => {
    const committed = renderCommit(eraserArgs({ mode: 'pencil', lineWidth: 7 }));
    const preview = renderPreview(eraserArgs({ mode: 'pencil', lineWidth: 7 }));

    // The whole reason the flag lives on `DrawToolArgs` and is read by `setupDrawCtx`: the overlay
    // and the commit are configured by that one function, so neither can drift from the other.
    expect(preview.globalCompositeOperation).toBe(committed.globalCompositeOperation);
    expect(preview.globalCompositeOperation).toBe('destination-out');
    expect(preview.stroke).toHaveBeenCalledTimes(committed.stroke.mock.calls.length);
    expect(preview.lineWidth).toBe(committed.lineWidth);
  });

  it('stamps hard squares and strokes nothing in block mode', () => {
    const ctx = renderCommit(eraserArgs({ mode: 'block', lineWidth: 8, alpha: 0.25 }));

    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.beginPath).not.toHaveBeenCalled();
    // One stamp for the first point plus one per `lineWidth` of travel along each segment.
    expect(ctx.fillRect.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('stamps an opaque block even when the Opacity slider was left at a low value', () => {
    // Adobe gives Block mode no Opacity control, and the options bar hides the slider for it, so a
    // low `alpha` left over from Pencil mode must not fade the block.
    const ctx = renderCommit(eraserArgs({ mode: 'block', alpha: 0.1 }));

    // Two brackets, both balanced: `drawBlockStamps` brackets its own stamps
    // (`src/util/draw.ts`), and the eraser brackets `setupDrawCtx` plus the paint
    // so its `destination-out` and its alpha cannot outlive the commit on the
    // caller's context.
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
    expect(ctx.globalAlpha).toBe(1);
  });

  it('draws the source bitmap back in, because a raster commit replaces the layer', () => {
    const bitmap = createMockImageBitmap(24, 18);

    eraser({ size: { width: 24, height: 18 }, bitmap })(eraserArgs());

    expect(recordCommitCtx().drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 24, 18);
  });

  it('omits the source on the creator path, so a new layer is punched rather than blanked', () => {
    eraser({ size: { width: 12, height: 9 } })(eraserArgs());

    expect(recordCommitCtx().drawImage).not.toHaveBeenCalled();
  });

  it('returns a canvas of the requested size and strokes nothing for an empty point list', () => {
    const [canvas] = eraser({ size: { width: 30, height: 20 } })(eraserArgs({ points: [] }));
    const ctx = recordCommitCtx();

    expect(canvas).toBe(RecordingOffscreenCanvas.instances.at(-1));
    expect((canvas as unknown as RecordingOffscreenCanvas).width).toBe(30);
    expect((canvas as unknown as RecordingOffscreenCanvas).height).toBe(20);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

function recordCommitCtx(): MockCtx {
  return RecordingOffscreenCanvas.instances.at(-1)!.ctx;
}

/**
 * The registry's own delegation, observed through it.
 *
 * The `eraser` entry is an inline `(params) => (args) => eraser(params)(args)` adapter rather
 * than a reference to the module export, so it is absent from the direct-processor-source list
 * in `tool-processors.test.ts`, and the shared-processor-identity test cannot see it either:
 * `eraser`, `magic-eraser` and `paint-bucket` are three distinct closures, so a swap between
 * any two of them satisfies every identity assertion in the suite. `this` file calls the
 * module directly, so without going through the registry nothing here observes the wiring.
 */
describe('eraser registry delegation', () => {
  it('routes the eraser to the alpha-subtracting stroke, through the registry', () => {
    RecordingOffscreenCanvas.instances = [];

    toolProcessors.eraser.imageProcessor({ size: { width: 24, height: 18 } })(eraserArgs({ lineWidth: 7 }));

    const ctx = recordCommitCtx();

    // The two halves of the difference, and they are the whole difference. An eraser asks
    // the canvas for `destination-out` and never reads or writes a pixel buffer; the magic
    // eraser does exactly the opposite — it reads the layer, zeroes alpha in the buffer and
    // `putImageData`s it back — and sets no composite operation at all. A misrouted magic
    // eraser therefore fails both of these, and a misrouted eraser under a fill's name fails
    // `fill.test.ts`'s registry pair.
    expect(ctx.globalCompositeOperation).toBe('destination-out');
    expect(ctx.putImageData).not.toHaveBeenCalled();
  });
});
