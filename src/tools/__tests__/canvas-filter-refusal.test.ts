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

  constructor(width: number, height: number) {
    this.width = Math.max(1, Math.ceil(width));
    this.height = Math.max(1, Math.ceil(height));
    this.ctx = createMockCanvasContext({ canvas: this, ellipse: vi.fn(), filter: '' }) as MockCtx;
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
};

const FILTER_TOOLS: readonly FilterToolCase[] = [
  { toolName: 'blur', run: () => blur(params)({ radius: 5, toolName: 'blur' }) },
  {
    toolName: 'color',
    run: () => colors(params)({ grayscale: 50, sepia: 0, saturation: 0, toolName: 'color' }),
  },
  {
    toolName: 'levels',
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
    expect(canvas!.ctx.filter).not.toBe('');
    expect(result).toBe(canvas as unknown as OffscreenCanvas);
  });
});
