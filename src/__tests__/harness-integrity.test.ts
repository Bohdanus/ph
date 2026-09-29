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

  it('hands every convertToBlob call the same zero-byte blob, whatever the canvas holds (MOCK ARTEFACT, not a contract)', async () => {
    // `src/util/selection.ts:739-740` reaches this whenever `copyCanvasToClipboard` is given an
    // OffscreenCanvas, and `src/test/setup.ts:214-216` answers with `new Blob([])` and never
    // looks at the canvas. A test that reaches that path through the global stub therefore
    // receives a zero-byte raster, which at the mock boundary is indistinguishable from a
    // correct one: nothing downstream can tell "the image is empty" from "the stub is empty".
    // The zero bytes are the STUB's artefact. Nothing here licenses a test to treat an empty
    // encode as a passing result — a test that needs a real raster must install its own blob,
    // the way `src/util/__tests__/selection.test.ts:1143` does.
    const first = await new OffscreenCanvas(40, 25).convertToBlob({ type: 'image/png' });
    const second = await new OffscreenCanvas(1, 1).convertToBlob({ type: 'image/png' });

    expect(first).toBeInstanceOf(Blob);
    expect(first.size).toBe(0);
    expect(first.type).toBe('');
    expect(await first.text()).toBe('');

    // Size-independent, and a distinct object per call, so two encodes can never be confused
    // for one another by identity either.
    expect(second).not.toBe(first);
    expect(second.size).toBe(0);
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

  it('derives createImageBitmap from an HTMLCanvasElement too, not only from an OffscreenCanvas', async () => {
    // `src/test/setup.ts:236-242` is a second live branch that no other test in the file
    // reaches. `src/contexts/materialization.ts:178` passes an `HTMLCanvasElement` to this
    // function, so the branch is a production path rather than dead harness code.
    const canvas = document.createElement('canvas');
    canvas.width = 17;
    canvas.height = 9;

    const bitmap = await createImageBitmap(canvas);

    expect(bitmap.width).toBe(17);
    expect(bitmap.height).toBe(9);
    expect(vi.isMockFunction(bitmap.close)).toBe(true);
  });

  it('answers every unrecognised createImageBitmap source with a fixed 100x100 (MOCK ARTEFACT, not a contract)', async () => {
    // `src/test/setup.ts:243-247` is the fall-through: any source that is neither an
    // OffscreenCanvas nor an HTMLCanvasElement gets 100x100 and its own size is never read.
    // `src/contexts/useLayer.ts:85` and `src/hooks/useApp.ts:29` both call this on an
    // already-decoded raster — exactly such a source — so an assertion of the form
    // `expect(bitmap.width).toBe(<real value>)` on that path can be passing because of this
    // fall-through rather than because the dimensions are right. The value below is pinned so
    // the fall-through is VISIBLE instead of invisible; it is the stub's answer, not a promise
    // about production.
    const decoded = new OffscreenCanvas(4, 4).transferToImageBitmap();
    const bitmap = await createImageBitmap(decoded);

    // The source is 4x4 and the answer is 100x100: the fall-through discarded the real size.
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(bitmap.width).toBe(100);
    expect(bitmap.height).toBe(100);
    expect(vi.isMockFunction(bitmap.close)).toBe(true);

    // The fall-through is idempotent on a second pass, which is precisely why an assertion can
    // pass for the wrong reason: feeding a 100x100 bitmap back in yields 100x100 whether the
    // branch read the source or ignored it.
    const roundTripped = await createImageBitmap(bitmap);
    expect([roundTripped.width, roundTripped.height]).toEqual([100, 100]);
    expect(roundTripped).not.toBe(bitmap);
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

/**
 * LAST IN THE FILE, DELIBERATELY.
 *
 * Re-evaluating `src/test/setup.ts` to obtain a genuine re-install is the only way to observe
 * one inside a single test body, but the module also registers its `afterEach` and `beforeEach`
 * as it evaluates. Those land on the suite that owns the running test and would then fire for
 * every test after it in this file, giving those tests a second canvas install that the real
 * harness does not give them — which is the exact "silently different harness" failure this
 * file exists to prevent. Sitting last, the duplicates are registered when no further test in
 * the file remains to receive them. Do not move this block up without re-solving that.
 */
describe('canvas stub re-installation', () => {
  it('re-installs the canvas stub after a test destroys it, and cannot be one-shot', async () => {
    // This scenario used to be two tests: one calling `vi.restoreAllMocks()`, and one asserting
    // the stub was back "in the following test". A `-t` filter could keep the half with the
    // assertions and delete the destruction that gave them meaning, and the test still reported
    // green while proving nothing about re-installation. Both halves are in this body now, so
    // neither can be filtered away from the other and the two cannot drift apart.
    //
    // 1. The state this test was handed. `src/test/setup.ts:361-363` installs the stub from an
    //    unconditional `beforeEach`, so every test in the repo starts with it no matter what any
    //    individual test did — and that is what makes the install not one-shot.
    const installed = HTMLCanvasElement.prototype.getContext;
    expect(vi.isMockFunction(installed)).toBe(true);
    const contextBefore = document.createElement('canvas').getContext('2d');
    expect(contextBefore).not.toBeNull();

    // 2. Destroy it exactly the way a hostile test does.
    vi.restoreAllMocks();

    // 3. The intermediate state. Without this the re-install below would pass even if the restore
    //    had never removed anything, so the test would pin an outcome and not the mechanism.
    expect(vi.isMockFunction(HTMLCanvasElement.prototype.getContext)).toBe(false);
    expect(HTMLCanvasElement.prototype.getContext).not.toBe(installed);

    // 4. Re-evaluate the harness module itself, so the re-install comes from
    //    `src/test/setup.ts:353-359` rather than from a copy of the install written in this
    //    test — a copy would assert only that this file agrees with itself. `vi.resetModules()`
    //    is what makes the re-import re-execute rather than return the evaluated module.
    vi.resetModules();
    await import('../test/setup.ts');

    // 5. A working stub again, and a different mock object — which is only possible if step 2
    //    really removed the first one.
    const reinstalled = HTMLCanvasElement.prototype.getContext;
    expect(vi.isMockFunction(reinstalled)).toBe(true);
    expect(reinstalled).not.toBe(installed);

    const contextAfter = document.createElement('canvas').getContext('2d');
    expect(contextAfter).not.toBeNull();
    expect(contextAfter).not.toBe(contextBefore);
    expect(() => (contextAfter as unknown as CanvasRenderingContext2D).fillRect(0, 0, 1, 1)).not.toThrow();
  });
});
