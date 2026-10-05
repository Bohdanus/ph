import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { blur } from '../blur.ts';
import { colors } from '../colors.ts';
import { levels } from '../levels.ts';
import type { ProcessorToolParams } from '../toolProcessors.ts';
import { CanvasFilterUnsupportedError, overrideCanvasFilterSupport } from '../../util/canvas-filter.ts';
import { createMockCanvasContext, createMockImageBitmap } from '../../__tests__/fixtures/canvas.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext> & { filter: string };

/**
 * `src/test/setup.ts` installs a global `OffscreenCanvas` stub that hands back a brand new context
 * object on every `getContext()` call, so a processor's `ctx.filter` write is unobservable. This
 * subclass keeps one stable context per canvas, which is what lets the assertions below see
 * whether the write happened at all — the difference between a real edit and a silent no-op.
 */
class RecordingOffscreenCanvas {
  static instances: RecordingOffscreenCanvas[] = [];

  width: number;
  height: number;
  readonly ctx: MockCtx;
  /**
   * An ordered log of the two operations whose relative order is the whole contract: assigning
   * `ctx.filter`, and the `drawImage` that filter applies to. A plain property cannot record
   * this, so `filter` is installed as an accessor over the same value the assertions read back.
   */
  readonly events: string[] = [];

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this, ellipse: vi.fn(), filter: '' }) as MockCtx;
    let assigned = '';
    Object.defineProperty(this.ctx, 'filter', {
      get: () => assigned,
      set: (value: string) => {
        assigned = value;
        this.events.push(`filter:${value}`);
      },
    });
    this.ctx.drawImage = vi.fn(() => {
      this.events.push('drawImage');
    });
    RecordingOffscreenCanvas.instances.push(this);
  }

  getContext(): MockCtx {
    return this.ctx;
  }

  transferToImageBitmap(): ImageBitmap {
    return createMockImageBitmap(this.width, this.height);
  }
}

const size = { width: 40, height: 24 };
const bitmap = createMockImageBitmap(40, 24);
const params: ProcessorToolParams = { size, bitmap };

type FilterToolCase = {
  toolName: 'blur' | 'color' | 'levels';
  // The three processors return `OffscreenCanvas[]`, which is not the `ToolResult` tuple the
  // registry declares, so the table stays as loose as the processors really are.
  run: () => unknown[];
  /**
   * The exact CSS filter the processor must assign, written out by hand rather than obtained by
   * calling `buildColorsFilter` / `buildLevelsFilter` — an expectation produced by the same
   * function under test proves nothing about it.
   */
  filter: string;
};

const FILTER_TOOLS: readonly FilterToolCase[] = [
  { toolName: 'blur', filter: 'blur(5px)', run: () => blur(params)({ radius: 5, toolName: 'blur' }) },
  {
    toolName: 'color',
    filter: 'grayscale(50%) sepia(0%) saturate(100%)',
    run: () => colors(params)({ grayscale: 50, sepia: 0, saturation: 0, toolName: 'color' }),
  },
  {
    toolName: 'levels',
    // brightness(+10) is `proportionateFactor(10, 150)` = `1 + 10/150` =
    // 1.06666..., which `adjustmentPercent` rounds to 106.67%; contrast(0) is the
    // neutral 100%. The span is 150 because that is `-BRIGHTNESS_SLIDER_RANGE.min`:
    // Adobe's normal-mode Brightness travels -150..+150, and each slider unit is a
    // constant fraction of the neutral factor, so -150 reaches factor 0 (black) and
    // +150 reaches 2. This assertion used to pin an exponential law at 124.61%, which
    // the proportionate law replaced — the exponential zero clipped, and Adobe names
    // that clipping as the Legacy defect this travel exists to avoid.
    filter: 'brightness(106.67%) contrast(100%)',
    run: () => levels(params)({ brightness: 10, contrast: 0, toolName: 'levels' }),
  },
];

const run = (entry: FilterToolCase): unknown[] => entry.run();

afterEach(() => {
  overrideCanvasFilterSupport(null);
});

describe('a ctx.filter processor refuses rather than returning an unchanged bitmap', () => {
  beforeEach(() => {
    RecordingOffscreenCanvas.instances = [];
    vi.stubGlobal('OffscreenCanvas', RecordingOffscreenCanvas as unknown as typeof OffscreenCanvas);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(FILTER_TOOLS)('$toolName throws when the engine discards ctx.filter', (entry) => {
    overrideCanvasFilterSupport(false);

    expect(() => run(entry)).toThrow(CanvasFilterUnsupportedError);
    expect(() => run(entry)).toThrow(new RegExp(`^${entry.toolName} requires CanvasRenderingContext2D\\.filter`));
  });

  it.each(FILTER_TOOLS)('$toolName allocates nothing when it refuses', (entry) => {
    overrideCanvasFilterSupport(false);

    expect(() => run(entry)).toThrow();
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it.each(FILTER_TOOLS)('$toolName draws nothing when it refuses', (entry) => {
    overrideCanvasFilterSupport(false);

    expect(() => run(entry)).toThrow();
    // The dangerous shape is a canvas allocated and `drawImage`-ed with the filter ignored: the
    // caller receives a full-size bitmap of untouched pixels and has no way to tell it apart.
    expect(RecordingOffscreenCanvas.instances).toHaveLength(0);
  });

  it.each(FILTER_TOOLS)('$toolName still assigns its filter when support is present', (entry) => {
    overrideCanvasFilterSupport(true);

    const [result] = run(entry) as [OffscreenCanvas];

    const canvas = RecordingOffscreenCanvas.instances.at(-1);
    expect(canvas).toBeDefined();
    expect(canvas!.ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
    expect(canvas!.ctx.filter).toBe(entry.filter);
    expect(result).toBe(canvas as unknown as OffscreenCanvas);
  });

  it.each(FILTER_TOOLS)('$toolName sets the filter before it draws, so the filter reaches the draw', (entry) => {
    overrideCanvasFilterSupport(true);
    run(entry);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    // The filter is assigned BEFORE `drawImage`. Reversed, the browser applies it to nothing and
    // the caller receives a full-size copy of the untouched source — the silent no-op
    // `canvas-filter.ts` refuses to emit. `not.toBe('')` on the final value proved neither the
    // order nor the presence of the draw, so this pins the whole ordered sequence.
    expect(canvas.events).toEqual([`filter:${entry.filter}`, 'drawImage']);
  });

  it.each(FILTER_TOOLS)('$toolName draws the source bitmap at full size, not scaled', (entry) => {
    overrideCanvasFilterSupport(true);
    run(entry);

    const canvas = RecordingOffscreenCanvas.instances.at(-1)!;

    // `drawImage(bitmap, 0, 0)` with no destination size is the only form that preserves the
    // bitmap's own dimensions. Adding a size pair, or a negative origin, would resize or clip
    // every adjustment's output.
    expect(vi.mocked(canvas.ctx.drawImage)).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0);
  });
});
