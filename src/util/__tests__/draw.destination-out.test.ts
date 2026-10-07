import { describe, expect, it, vi } from 'vitest';

import { draw, setupDrawCtx, type DrawToolArgs } from '../../tools/draw.ts';
import { drawLine, drawPen } from '../draw.ts';
import { createMockCanvasContext } from '../../__tests__/fixtures/canvas.ts';
import type { Ctx2D } from '../../contexts/general-types.ts';

type MockCtx = ReturnType<typeof createMockCanvasContext>;

/**
 * The `composite` / `blockStamp` flags are the only additions this tranche makes to
 * `DrawToolArgs`. `e2e/export/visual-regression.spec.ts` records its baselines through the legacy
 * `draw` tool, so an absent flag must render the stroke it always rendered — byte for byte, and
 * without allocating a property the context did not previously have written.
 */

/** The legacy args object, exactly as it existed before the flags: no `composite`, no `blockStamp`. */
const legacyArgs = (overrides: Partial<DrawToolArgs> = {}): DrawToolArgs => ({
  toolName: 'draw',
  penType: 'pen',
  alpha: 0.6,
  color: '#ff0000',
  lineWidth: 12,
  points: [
    { x: 2, y: 2 },
    { x: 8, y: 9 },
    { x: 14, y: 5 },
  ],
  ...overrides,
});

const withFlags = (args: DrawToolArgs, extra: Partial<DrawToolArgs>): DrawToolArgs => ({ ...args, ...extra });

describe('setupDrawCtx, legacy identity', () => {
  it('does not even define composite on an args object that never had the flag', () => {
    const args = legacyArgs();

    expect(Object.hasOwn(args, 'composite')).toBe(false);
    expect(Object.hasOwn(args, 'blockStamp')).toBe(false);
    expect(args.composite).toBeUndefined();
    expect(args.blockStamp).toBeUndefined();
  });

  it('writes source-over for an absent flag, which is the canvas default', () => {
    const ctx = createMockCanvasContext() as unknown as Ctx2D;

    setupDrawCtx(ctx, legacyArgs());

    // Not merely the same *value*: the write is what stops an eraser from leaving
    // `destination-out` behind on the shared overlay for the next tool's stroke.
    expect(ctx.globalCompositeOperation).toBe('source-over');
  });

  it('writes the same value the mock already held, so the property never moved', () => {
    const untouched = createMockCanvasContext();
    const configured = createMockCanvasContext() as unknown as Ctx2D;

    setupDrawCtx(configured, legacyArgs());

    // `toBe` on identity of the string primitive, plus the pre-existing value comparison, is the
    // strongest form available for a string: there is no second `'source-over'` to confuse it with.
    expect(configured.globalCompositeOperation).toBe(untouched.globalCompositeOperation);
    expect(untouched.globalCompositeOperation).toBe('source-over');
  });

  it('changes only the pre-existing pen properties, because the flag write is a no-op', () => {
    const before = createMockCanvasContext();
    const after = createMockCanvasContext() as unknown as Ctx2D;

    setupDrawCtx(after, legacyArgs());

    // Only the value properties: each mock owns its own `vi.fn()` instances, which can never
    // compare equal, and `canvas` is a distinct object per mock by construction.
    const values = (ctx: Ctx2D) =>
      Object.fromEntries(
        Object.entries(ctx as unknown as Record<string, unknown>).filter(
          ([, value]) => value === null || (typeof value !== 'object' && typeof value !== 'function')
        )
      ) as Record<string, unknown>;

    const beforeValues = values(before as unknown as Ctx2D);
    const afterValues = values(after as unknown as Ctx2D);
    const changed = Object.keys(afterValues).filter((key) => beforeValues[key] !== afterValues[key]);

    // `globalCompositeOperation` is deliberately NOT in this list: for a legacy stroke the new
    // write resolves to `source-over`, which is the value the context already held, so not one
    // rendered property moves. Everything that does move is a pre-existing pen property, and the
    // eraser shares all of them unchanged.
    expect(changed.sort()).toEqual(['globalAlpha', 'lineCap', 'lineJoin', 'lineWidth', 'strokeStyle'].sort());
    expect(changed).not.toContain('globalCompositeOperation');
    expect(after.globalCompositeOperation).toBe(before.globalCompositeOperation);
  });

  it('restores source-over on a context an eraser already touched', () => {
    // The overlay context is shared between strokes and between tools
    // (src/components/Main/DrawToolArea.tsx:51, once per pointer-down, on a ref the component
    // keeps for its whole life). If setupDrawCtx only wrote the composite while erasing, the
    // eraser would leave `destination-out` behind and the NEXT tool's stroke on that same overlay
    // would silently erase instead of painting. Nothing else resets it.
    const overlay = createMockCanvasContext() as unknown as Ctx2D;

    setupDrawCtx(overlay, withFlags(legacyArgs(), { composite: 'destination-out' }));
    expect(overlay.globalCompositeOperation).toBe('destination-out');

    setupDrawCtx(overlay, legacyArgs());
    expect(overlay.globalCompositeOperation).toBe('source-over');

    drawLine({ args: legacyArgs(), ctx: overlay });
    expect(overlay.globalCompositeOperation).toBe('source-over');
    expect(overlay.stroke).toHaveBeenCalledTimes(1);
  });

  it('differs from a painting stroke in exactly one property, the composite operation', () => {
    const pencil = createMockCanvasContext() as unknown as Ctx2D;
    const eraserCtx = createMockCanvasContext() as unknown as Ctx2D;

    setupDrawCtx(pencil, legacyArgs());
    setupDrawCtx(eraserCtx, withFlags(legacyArgs(), { composite: 'destination-out' }));

    const primitive = (ctx: Ctx2D) =>
      Object.fromEntries(
        Object.entries(ctx as unknown as Record<string, unknown>).filter(
          ([, value]) => value === null || (typeof value !== 'object' && typeof value !== 'function')
        )
      ) as Record<string, unknown>;

    const pencilValues = primitive(pencil);
    const eraserValues = primitive(eraserCtx);
    const differing = Object.keys(pencilValues).filter((key) => pencilValues[key] !== eraserValues[key]);

    // One property separates a painting stroke from an erasing stroke. Everything else — the tip
    // geometry, the caps, the alpha — is identical, which is what makes the eraser faithful.
    expect(differing).toEqual(['globalCompositeOperation']);
    expect(eraserCtx.globalCompositeOperation).toBe('destination-out');
  });

  it('issues exactly the same path calls as a pre-flag stroke', () => {
    const ctx = createMockCanvasContext() as unknown as Ctx2D;
    const calls: string[] = [];
    for (const name of ['beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'stroke', 'setLineDash', 'save', 'restore']) {
      vi.mocked((ctx as unknown as Record<string, ReturnType<typeof vi.fn>>)[name]).mockImplementation(() => {
        calls.push(name);
        return undefined;
      });
    }

    setupDrawCtx(ctx, legacyArgs());
    drawLine({ args: legacyArgs(), ctx });

    // `setLineDash([])` is the pre-existing null-dash reset at src/tools/draw.ts:37-39, and it
    // runs before the path, exactly as it did before the flags existed.
    expect(calls).toEqual(['setLineDash', 'beginPath', 'moveTo', 'bezierCurveTo', 'stroke']);
  });
});

describe('drawPen, legacy identity', () => {
  it('takes the stroked path when blockStamp is absent', () => {
    const ctx = createMockCanvasContext() as unknown as Ctx2D;

    drawPen({ args: legacyArgs(), ctx });

    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('takes the stamped path only when blockStamp is set', () => {
    const ctx = createMockCanvasContext() as unknown as Ctx2D;

    drawPen({ args: withFlags(legacyArgs(), { blockStamp: true }), ctx });

    expect(ctx.stroke).not.toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
  });

  it('returns the same untouched context state for the absent-flag path', () => {
    const baseline = createMockCanvasContext();
    const drawn = createMockCanvasContext() as unknown as Ctx2D;

    drawPen({ args: legacyArgs(), ctx: drawn });

    // `fillStyle`/`globalAlpha` are the two properties the block path would have written, and the
    // two `save`/`restore` calls the block path would have issued. None of them may appear.
    expect(drawn.fillStyle).toBe(baseline.fillStyle);
    expect(drawn.globalAlpha).toBe(baseline.globalAlpha);
    expect(drawn.save).not.toHaveBeenCalled();
    expect(drawn.restore).not.toHaveBeenCalled();
  });
});

describe('draw, legacy identity', () => {
  it('commits a layer-sized canvas and strokes, with no extra raster work', () => {
    const created: { width: number; height: number; ctx: MockCtx }[] = [];

    class Canvas {
      width: number;
      height: number;
      ctx: MockCtx;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.ctx = createMockCanvasContext({ canvas: this } as unknown as Record<string, unknown>);
        created.push(this);
      }
      getContext() {
        return this.ctx;
      }
    }
    vi.stubGlobal('OffscreenCanvas', Canvas);

    const [canvas] = draw({ size: { width: 60, height: 40 } } as never)(legacyArgs());

    expect(created).toHaveLength(1);
    expect(canvas).toBe(created[0] as unknown as never);
    expect(created[0].ctx.globalCompositeOperation).toBe('source-over');
    expect(created[0].ctx.stroke).toHaveBeenCalledTimes(1);
    expect(created[0].ctx.fillRect).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
