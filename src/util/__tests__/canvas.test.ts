import { describe, expect, it, vi } from 'vitest';
import { resetOverlayAlpha, resizeCanvas } from '../canvas.ts';
import type { Ctx2D } from '../../contexts/general-types.ts';

/**
 * Assigning `width`/`height` on a real canvas resets its drawing state, so the
 * conditional writes in `resizeCanvas` are the behaviour worth pinning. The spy
 * canvas records every write so the test can prove untouched dimensions are not
 * reassigned.
 */
function createSpyCanvas(width: number, height: number) {
  const size = { width, height };
  const widthWrites: number[] = [];
  const heightWrites: number[] = [];
  const attributes = new Map<string, string>();

  // Mock transform state
  let currentTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

  const mockContext = {
    getTransform: vi.fn(() => currentTransform),
    setTransform: vi.fn((a, b, c, d, e, f) => {
      currentTransform = { a, b, c, d, e, f };
    }),
    scale: vi.fn((x, y) => {
      currentTransform = { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
    }),
  };

  const canvas = {
    get width() {
      return size.width;
    },
    set width(value: number) {
      widthWrites.push(value);
      size.width = value;
    },
    get height() {
      return size.height;
    },
    set height(value: number) {
      heightWrites.push(value);
      size.height = value;
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    getContext: vi.fn(() => mockContext),
  } as unknown as HTMLCanvasElement;

  return { canvas, widthWrites, heightWrites, mockContext, getTransform: () => currentTransform };
}

describe('resizeCanvas', () => {
  it('applies both dimensions when both differ', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 200, 80);

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(80);
    expect(widthWrites).toEqual([200]);
    expect(heightWrites).toEqual([80]);
  });

  it('leaves an already matching dimension untouched', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 100, 50);

    expect(widthWrites).toEqual([]);
    expect(heightWrites).toEqual([]);
    expect(canvas.width).toBe(100);
    expect(canvas.height).toBe(50);
  });

  it('only writes the dimension that changed', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 100, 300);

    expect(widthWrites).toEqual([]);
    expect(heightWrites).toEqual([300]);
  });

  it('works on a real HTMLCanvasElement', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 20;

    resizeCanvas(canvas, 300, 400);

    expect(canvas.width).toBe(300);
    expect(canvas.height).toBe(400);
  });

  it('applies a zero or negative target size instead of ignoring it', () => {
    const { canvas, widthWrites } = createSpyCanvas(100, 50);

    resizeCanvas(canvas, 0, -5);

    expect(widthWrites).toEqual([0]);
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(-5);
  });

  it('writes each dimension at most once per call', () => {
    const { canvas, widthWrites, heightWrites } = createSpyCanvas(1, 1);
    const spy = vi.spyOn(canvas, 'width', 'set');

    resizeCanvas(canvas, 2, 2);

    expect(widthWrites).toEqual([2]);
    expect(heightWrites).toEqual([2]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('replaces a skewed or translated transform with the requested scale', () => {
    const { canvas, mockContext, getTransform } = createSpyCanvas(200, 100);
    getTransform().b = 1;
    getTransform().e = 4;

    resizeCanvas(canvas, 100, 50, 2);

    expect(mockContext.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(getTransform()).toEqual({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 });
  });
});

function createAlphaCtx(globalAlpha: number) {
  return { globalAlpha, setLineDash: vi.fn() } as unknown as Ctx2D;
}

describe('resetOverlayAlpha', () => {
  it('restores full opacity on a context a previous tool left at its own alpha', () => {
    const ctx = createAlphaCtx(0.2);

    resetOverlayAlpha(ctx);

    expect(ctx.globalAlpha).toBe(1);
  });

  it('leaves an already clean context at full opacity', () => {
    const ctx = createAlphaCtx(1);

    resetOverlayAlpha(ctx);

    expect(ctx.globalAlpha).toBe(1);
  });

  it('resets on every call, so a paint can never inherit the previous one', () => {
    const ctx = createAlphaCtx(0.5);

    resetOverlayAlpha(ctx);
    ctx.globalAlpha = 0.9;
    resetOverlayAlpha(ctx);

    expect(ctx.globalAlpha).toBe(1);
  });

  it('leaves the line dash alone, which the painters that use one own themselves', () => {
    const ctx = createAlphaCtx(0.2);

    resetOverlayAlpha(ctx);

    expect(ctx.setLineDash).not.toHaveBeenCalled();
  });

  it('corrects the paint inside a bracket but cannot heal the context after it', () => {
    // `useAnts.animate` calls the reset between its own `save()` and `restore()`, so the `restore()`
    // puts the leaked alpha straight back and the next painter still inherits it. That is why the
    // reset is a per-paint discipline for the painter that runs it and not a property of the
    // context — and why bracketing the WRITERS is the only thing that stops the leak at the source.
    // A `vi.fn()` context cannot show this, so the stack is modelled.
    let state = { globalAlpha: 0.2 };
    const stack: { globalAlpha: number }[] = [];
    const ctx = {
      get globalAlpha() {
        return state.globalAlpha;
      },
      set globalAlpha(value: number) {
        state.globalAlpha = value;
      },
      save: () => {
        stack.push({ ...state });
      },
      restore: () => {
        const popped = stack.pop();
        if (popped) state = { ...popped };
      },
      setLineDash: vi.fn(),
    } as unknown as Ctx2D;

    ctx.save();
    resetOverlayAlpha(ctx);
    // The paint inside the bracket is correct.
    expect(ctx.globalAlpha).toBe(1);

    ctx.restore();
    // And the context is exactly as dirty as it was before.
    expect(ctx.globalAlpha).toBe(0.2);
  });
});
