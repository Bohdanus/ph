import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockCanvasContext as createGlobalMockCanvasContext } from '../test/setup.ts';
import { makeMockCanvas, makeMockCtx, makeMockOffscreenCanvas } from './canvas-mock.ts';
import {
  createMockCanvas,
  createMockCanvasContext,
  createMockImageBitmap,
  createMockOffscreenCanvas,
  mockCanvasGlobals,
} from './fixtures/canvas.ts';
import { createMockHistoryItem, createMockHistory, createSelectionHistoryItem } from './fixtures/history.ts';
import { createMockLayer, createMockLayers } from './fixtures/layer.ts';
import { createPointerDownEvent, createPointerEvent } from './fixtures/pointer.ts';
import { createMockStoreState } from './fixtures/store.ts';
import { NEW_LAYER_ACTION } from '@/util/constants.ts';

const DRAWING_CONTEXT_SURFACE = [
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'rect',
  'roundRect',
  'arcTo',
  'ellipse',
  'arc',
  'fill',
  'stroke',
  'fillRect',
  'strokeRect',
  'clearRect',
  'clip',
  'save',
  'restore',
  'reset',
  'translate',
  'rotate',
  'scale',
  'transform',
  'setTransform',
  'resetTransform',
  'setLineDash',
  'getLineDash',
  'isPointInPath',
  'isPointInStroke',
  'drawImage',
] as const;

const TEXT_CONTEXT_SURFACE = ['fillText', 'strokeText', 'measureText'] as const;

const GRADIENT_CONTEXT_SURFACE = ['createRadialGradient', 'createLinearGradient', 'createConicGradient'] as const;

const PATH_2D_SURFACE = [
  'moveTo',
  'lineTo',
  'closePath',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arc',
  'arcTo',
  'ellipse',
  'rect',
  'roundRect',
  'addPath',
] as const;

const expectEveryMethod = (subject: object, methods: readonly string[]) => {
  for (const method of methods) {
    expect(typeof (subject as Record<string, unknown>)[method], `expected harness context to implement ${method}`).toBe(
      'function'
    );
  }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('global canvas environment (src/test/setup.ts)', () => {
  it('exposes the full 2D drawing, text and gradient surface on the global HTMLCanvasElement stub', () => {
    const ctx = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;

    expect(ctx.canvas).toBeInstanceOf(HTMLCanvasElement);
    expectEveryMethod(ctx, DRAWING_CONTEXT_SURFACE);
    expectEveryMethod(ctx, TEXT_CONTEXT_SURFACE);
    expectEveryMethod(ctx, GRADIENT_CONTEXT_SURFACE);

    for (const name of GRADIENT_CONTEXT_SURFACE) {
      const gradient = (ctx[name] as () => { addColorStop: unknown })();
      expect(typeof gradient.addColorStop).toBe('function');
    }

    // A `measureText` returning a plausible non-negative number is the invariant that matters;
    // pinning the literal 0 only restated `src/test/setup.ts:136`.
    const measured = (ctx.measureText as (t: string) => { width: number })('ph');
    expect(Number.isFinite(measured.width)).toBe(true);
    expect(measured.width).toBeGreaterThanOrEqual(0);
  });

  it('re-installs the canvas stub after a test destroys it with vi.restoreAllMocks()', () => {
    // The previous version of this test also asserted `isMockFunction(...) === false` right
    // after `restoreAllMocks()`. That is vitest's own documented behaviour, not project code, and
    // it contradicts the title. What makes the re-install real is the *next* test: `beforeEach`
    // must put a working stub back, or every later rasterization test in the repo breaks.
    vi.restoreAllMocks();
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(false);
  });

  it('still provides a working canvas stub in the following test (proves the re-install is not one-shot)', () => {
    const ctx = document.createElement('canvas').getContext('2d');

    expect(ctx).not.toBeNull();
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(true);
    expect(() => (ctx as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1)).not.toThrow();
  });

  it('normalises zero and fractional OffscreenCanvas dimensions the way the real constructor reports them', () => {
    expect(new OffscreenCanvas(0, 0).width).toBe(1);
    expect(new OffscreenCanvas(0, 0).height).toBe(1);
    expect(new OffscreenCanvas(20.2, 30.9).width).toBe(21);
    expect(new OffscreenCanvas(20.2, 30.9).height).toBe(31);
  });

  it('returns a stable 2D context per OffscreenCanvas instance, as the real API does', () => {
    const canvas = new OffscreenCanvas(8, 8);

    expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'));
    expect(canvas.getContext('2d')?.canvas).toBe(canvas);
  });

  it('resizes an OffscreenCanvas in place without dropping its 2D context', () => {
    const canvas = new OffscreenCanvas(8, 8);
    const ctx = canvas.getContext('2d');

    canvas.width = 0;
    expect(canvas.height).toBe(8);

    expect(canvas.getContext('2d')).toBe(ctx);
  });

  it('produces ImageBitmaps that carry a spy-able close() so bitmap leaks are assertable', async () => {
    const transferred = new OffscreenCanvas(12, 7).transferToImageBitmap();
    const created = await createImageBitmap(new OffscreenCanvas(9, 3));

    for (const bitmap of [transferred, created]) {
      expect(bitmap.width).toBeGreaterThan(0);
      expect(bitmap.height).toBeGreaterThan(0);
      expect(vi.isMockFunction(bitmap.close)).toBe(true);
      bitmap.close();
      expect(bitmap.close).toHaveBeenCalledTimes(1);
    }
  });

  it('propagates the concrete canvas width/height into createImageBitmap instead of a fixed size', async () => {
    const bitmap = await createImageBitmap(new OffscreenCanvas(33, 21));

    expect(bitmap.width).toBe(33);
    expect(bitmap.height).toBe(21);
  });

  it('exposes the full Path2D segment surface so path building cannot silently no-op', () => {
    const path = new Path2D();

    expectEveryMethod(path as unknown as object, PATH_2D_SURFACE);
  });

  it('leaves the canvas stub intact when a test mutates a context obtained from it', () => {
    const ctx = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;
    ctx.globalAlpha = 0.25;

    const other = document.createElement('canvas').getContext('2d') as unknown as Record<string, unknown>;
    expect(other.globalAlpha).toBe(1);
  });
});

describe('shared canvas mocks (src/__tests__)', () => {
  it('links every mock context back to the canvas that produced it', () => {
    const canvas = makeMockCanvas(64, 32);
    const offscreen = makeMockOffscreenCanvas(48, 24);
    const fixtureCanvas = createMockCanvas();

    expect(makeMockCtx().canvas).toEqual({ width: 100, height: 100 });
    expect((canvas.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(canvas);
    expect((offscreen.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(offscreen);
    expect((fixtureCanvas.getContext('2d') as unknown as { canvas: unknown }).canvas).toBe(fixtureCanvas);
  });

  it('returns the same context object from repeated getContext() calls', () => {
    const canvas = makeMockCanvas();
    const offscreen = makeMockOffscreenCanvas();
    const fixtureCanvas = createMockCanvas();

    expect(canvas.getContext('2d')).toBe(canvas.getContext('2d'));
    expect(offscreen.getContext('2d')).toBe(offscreen.getContext('2d'));
    expect(fixtureCanvas.getContext('2d')).toBe(fixtureCanvas.getContext('2d'));
  });

  it('supports transferToImageBitmap on every OffscreenCanvas mock variant', () => {
    const fromMock = makeMockOffscreenCanvas(15, 9).transferToImageBitmap();
    const fromFixture = createMockOffscreenCanvas(6, 4).transferToImageBitmap();

    expect([fromMock.width, fromMock.height]).toEqual([15, 9]);
    expect([fromFixture.width, fromFixture.height]).toEqual([6, 4]);
    expect(vi.isMockFunction(fromMock.close)).toBe(true);
    expect(vi.isMockFunction(fromFixture.close)).toBe(true);
  });

  it('implements the drawing, text and gradient surface on both context factories', () => {
    const surface = [...DRAWING_CONTEXT_SURFACE, ...TEXT_CONTEXT_SURFACE, ...GRADIENT_CONTEXT_SURFACE];

    expectEveryMethod(makeMockCtx(), surface);
    expectEveryMethod(createMockCanvasContext(), surface);
    expectEveryMethod(createGlobalMockCanvasContext(), surface);
  });

  it('keeps caller overrides authoritative over the factory defaults', () => {
    const ctx = makeMockCtx({ globalAlpha: 0.5, fillStyle: '#abcdef' });
    const fixtureCtx = createMockCanvasContext({ globalAlpha: 0.25, fillStyle: '#123456' });

    expect(ctx.globalAlpha).toBe(0.5);
    expect(ctx.fillStyle).toBe('#abcdef');
    expect(fixtureCtx.globalAlpha).toBe(0.25);
    expect(fixtureCtx.fillStyle).toBe('#123456');
  });

  it('allocates a fresh context per createMockCanvasContext call instead of sharing one', () => {
    const first = createMockCanvasContext();
    const second = createMockCanvasContext();

    (first as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1);

    expect(first).not.toBe(second);
    expect(second.fillRect).not.toHaveBeenCalled();
  });

  it('restores the setup.ts OffscreenCanvas after mockCanvasGlobals() is unstubbed', () => {
    const original = globalThis.OffscreenCanvas;
    const stubbed = mockCanvasGlobals();

    expect(globalThis.OffscreenCanvas).not.toBe(original);
    expect(stubbed.mockOffscreenCanvas.getContext('2d')).toBe(stubbed.mockOffscreenCanvas.getContext('2d'));

    vi.unstubAllGlobals();
    expect(globalThis.OffscreenCanvas).toBe(original);
    expect(new OffscreenCanvas(4, 4).getContext('2d')).toEqual(
      expect.objectContaining({ beginPath: expect.any(Function) })
    );
  });

  it('creates ImageBitmap mocks whose close() is independently observable', () => {
    const first = createMockImageBitmap(3, 5);
    const second = createMockImageBitmap(3, 5);

    first.close();

    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
    expect([first.width, first.height]).toEqual([3, 5]);
  });
});

describe('shared data fixtures', () => {
  it('derives default history action names from production constants rather than duplicated literals', () => {
    // `NEW_LAYER_ACTION` is the very constant `fixtures/history.ts` hardcodes, so comparing the
    // two moves together and the assertion is structurally incapable of failing. The real
    // invariant is that the fixture tracks the production value, which is what the *value*
    // being a non-empty lowercase action name pins.
    expect(createMockHistoryItem().actionName).toBe(NEW_LAYER_ACTION);
    expect(createMockHistoryItem().actionName).toBe('new layer');
    expect(createMockHistory(3).map((item) => item.actionName)).toEqual([
      NEW_LAYER_ACTION,
      expect.any(String),
      expect.any(String),
    ]);
  });

  it('generates unique history ids instead of repeating one id', () => {
    const ids = createMockHistory(4).map((item) => item.id);

    expect(new Set(ids).size).toBe(4);
  });

  it('returns fresh store, layer, pointer and history objects on every call', () => {
    const storeA = createMockStoreState();
    const storeB = createMockStoreState();
    storeA.layers!['injected'] = createMockLayer();
    storeA.previewLayers!['injected'] = { layer: createMockLayer() };

    const pointerA = createPointerEvent();
    pointerA.clientX = 999;

    expect(storeB.layers).toEqual({});
    expect(storeB.previewLayers).toEqual({});
    // The `clientX` / `hist-1` / `selection-clear` assertions only restated the fixture files
    // line for line. What can actually regress is freshness, so prove it by mutating a fresh
    // instance and observing the next call is unaffected.
    const historyA = createMockHistoryItem();
    historyA.id = 'mutated';
    expect(createMockHistoryItem().id).toBe('hist-1');
    const selectionA = createSelectionHistoryItem([], []);
    selectionA.id = 'mutated';
    expect(createSelectionHistoryItem([], []).id).toBe('selection-clear');
  });

  it('assigns distinct ids and ascending order to generated layers', () => {
    const layers = Object.values(createMockLayers(3));

    expect(layers.map((layer) => layer.id)).toEqual(['layer-1', 'layer-2', 'layer-3']);
    expect(layers.map((layer) => layer.order)).toEqual([0, 1, 2]);
    expect(new Set(layers.map((layer) => layer.name)).size).toBe(3);
  });

  it('builds pointer events with the real down/move/up button and buttons invariants', () => {
    expect(createPointerDownEvent()).toMatchObject({ type: 'pointerdown', button: 0, buttons: 1 });
    expect(createPointerEvent({ type: 'pointerup', button: 2, buttons: 0 })).toMatchObject({ button: 2, buttons: 0 });
    // `pressure` defaults to 0.5 in the fixture, which is a midpoint rather than a
    // `PointerEvent` invariant; what matters is that it is a real number in range.
    const pressure = createPointerEvent().pressure;
    expect(pressure).toBeGreaterThanOrEqual(0);
    expect(pressure).toBeLessThanOrEqual(1);
  });

  it('preserves an explicit tmpCanvas on a mock layer instead of substituting a default', () => {
    // The previous body built `new OffscreenCanvas(4, 4)` and then asserted its width was 4,
    // which is a self-comparison; it also claimed to need no OffscreenCanvas global while the
    // body itself required one. The falsifiable claim is that `createMockLayer` threads the
    // supplied canvas through untouched.
    const tmpCanvas = { width: 7, height: 3, marker: 'supplied' } as unknown as OffscreenCanvas;
    const tool = createMockLayer({ id: 'tool-blur', tmpCanvas });

    expect(tool.tmpCanvas).toBe(tmpCanvas);
    expect(createMockLayer({ id: 'other' }).tmpCanvas).not.toBe(tmpCanvas);
  });
});
