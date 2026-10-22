import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { drawLayersToCanvas } from '../layer-renderer.ts';
import { documentFrameSize, type DocumentFrame } from '../document-frame.ts';
import { MAX_AFFINE_PIXELS, type AffineTransform } from '../affine-transform.ts';
import type { BitmapSource, Pos } from '../general-types.ts';
import type { Layer, LayerOperation, ToolLayerSource } from '../layer-types.ts';
import { toolProcessors } from '../../tools/toolProcessors.ts';

const CONTEXT_METHOD_NAMES = [
  'save',
  'restore',
  'translate',
  'transform',
  'setTransform',
  'clearRect',
  'drawImage',
] as const;

function createDrawContext(canvas: HTMLCanvasElement | null = null) {
  return {
    canvas,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
    filter: 'none',
  };
}

type DrawContextMock = ReturnType<typeof createDrawContext>;

const toContext = (mock: DrawContextMock) => mock as unknown as CanvasRenderingContext2D;

function expectNoContextCalls(mock: DrawContextMock) {
  for (const name of CONTEXT_METHOD_NAMES) {
    expect(mock[name].mock.calls, `${name} must not be called`).toEqual([]);
  }
}

const createConsoleErrorSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

let contextRequests: HTMLCanvasElement[] = [];
let contextOverrides = new Map<HTMLCanvasElement, CanvasRenderingContext2D | null>();
let nullContextCallIndex: number | null = null;
let contextFactory: (() => DrawContextMock) | null = null;
let consoleError = createConsoleErrorSpy();

const getContextImplementation = function (this: HTMLCanvasElement) {
  contextRequests.push(this);
  const shouldReturnNull = nullContextCallIndex === contextRequests.length;
  if (shouldReturnNull) return null;
  if (contextOverrides.has(this)) return contextOverrides.get(this) as CanvasRenderingContext2D;
  const created = contextFactory ? contextFactory() : createDrawContext(this);
  contextOverrides.set(this, toContext(created));
  return toContext(created);
} as unknown as HTMLCanvasElement['getContext'];

function createCanvas(width = 300, height = 150) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Target canvas plus a pre-registered context, so its calls can be asserted even when it is never asked for. */
function createTargetCanvas(width = 300, height = 150) {
  const canvas = createCanvas(width, height);
  const context = createDrawContext(canvas);
  contextOverrides.set(canvas, toContext(context));
  return { canvas, context };
}

const contextMockFor = (canvas: HTMLCanvasElement) => {
  const context = contextOverrides.get(canvas);
  if (!context) throw new Error('no recording context registered for this canvas');
  return context as unknown as DrawContextMock;
};

const stagingCanvasFor = (target: HTMLCanvasElement) => {
  const staging = contextRequests.find((canvas) => canvas !== target);
  if (!staging) throw new Error('no staging canvas was created');
  return staging;
};

type ResizeRecord = ['width' | 'height', number];

/** Records every dimension write so "the canvas was never resized" is observable, not inferred. */
function trackCanvasResizes(canvas: HTMLCanvasElement) {
  const resizes: ResizeRecord[] = [];
  let { width, height } = canvas;
  Object.defineProperties(canvas, {
    width: {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        resizes.push(['width', value]);
        width = value;
      },
    },
    height: {
      configurable: true,
      get: () => height,
      set: (value: number) => {
        resizes.push(['height', value]);
        height = value;
      },
    },
  });
  return resizes;
}

/** Wraps the staging canvas the renderer allocates so its dimension writes are observable too. */
function trackStagingCanvasResizes() {
  const resizes: ResizeRecord[] = [];
  const createElementOfTag = document.createElement.bind(document);
  const createElement = vi.spyOn(document, 'createElement').mockImplementation(((
    tag: string,
    options?: ElementCreationOptions
  ) => {
    const element = createElementOfTag(tag, options);
    if (tag !== 'canvas') return element;
    return new Proxy(element, {
      get(source, property) {
        return Reflect.get(source, property);
      },
      set(source, property, value) {
        if (property === 'width' || property === 'height') resizes.push([property, value as number]);
        return Reflect.set(source, property, value);
      },
    });
  }) as typeof document.createElement);
  return { createElement, stagingResizes: resizes };
}

const createBitmap = (width = 20, height = 10) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;

function createImageLayer(id: string, pos: Pos, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    name: id,
    isBedrock: false,
    bitmap: createBitmap(pos.width, pos.height),
    tmpCanvas: null,
    visible: true,
    opacity: 1,
    locked: false,
    blendMode: 'source-over',
    order: 0,
    pos,
    presentationBounds: null,
    operations: [],
    ...overrides,
  };
}

function createVectorLayer(id: string, pos: Pos): Layer {
  const source: ToolLayerSource = {
    kind: 'tool',
    pos,
    args: {
      toolName: 'shape',
      figure: 'rectangle',
      alpha: 1,
      color: '#000000',
      backgroundColor: null,
      lineWidth: 2,
      start: { x: 0, y: 0 },
      end: { x: pos.width, y: pos.height },
    },
  };
  return createImageLayer(id, pos, { bitmap: null, source });
}

const affineOperation = (transform: AffineTransform): LayerOperation => ({
  id: 'affine-1',
  kind: 'affine-transform',
  transform,
  enabled: true,
});

const frame = (x: number, y: number, width: number, height: number): DocumentFrame => ({ x, y, width, height });

const throwing = (failure: Error) =>
  vi.fn((): never => {
    throw failure;
  });

describe('drawLayersToCanvas', () => {
  beforeEach(() => {
    contextRequests = [];
    contextOverrides = new Map();
    nullContextCallIndex = null;
    contextFactory = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContextImplementation);
    consoleError = createConsoleErrorSpy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // setup.ts installs a global getContext mock; restore an equivalent baseline so the
    // restored original (unimplemented in jsdom) never leaks into the next test.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      return toContext(createDrawContext(this));
    } as unknown as HTMLCanvasElement['getContext']);
  });

  it('publishes the staged presentation onto the visible canvas', () => {
    const target = createTargetCanvas();
    const bitmap = createBitmap(20, 10);
    const layer = createImageLayer('layer-1', { x: 4, y: 6, width: 20, height: 10 }, { bitmap });
    const documentFrame = frame(0, 0, 640, 480);

    expect(drawLayersToCanvas(target.canvas, [layer], documentFrame)).toBe(true);

    expect(target.canvas.width).toBe(640);
    expect(target.canvas.height).toBe(480);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);

    const stagingCanvas = stagingCanvasFor(target.canvas);
    expect(stagingCanvas).not.toBe(target.canvas);
    expect(stagingCanvas.width).toBe(640);
    expect(stagingCanvas.height).toBe(480);

    expect(target.context.drawImage).toHaveBeenCalledTimes(1);
    expect(target.context.drawImage).toHaveBeenCalledWith(stagingCanvas, 0, 0);
    // Layers never reach the visible canvas directly.
    expect(target.context.drawImage).not.toHaveBeenCalledWith(bitmap, 4, 6, 20, 10);

    const staging = contextMockFor(stagingCanvas);
    expect(staging.drawImage).toHaveBeenCalledWith(bitmap, 4, 6, 20, 10);
    expect(staging.clearRect).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('sizes both canvases from documentFrameSize instead of the raw frame', () => {
    const target = createTargetCanvas();
    const documentFrame = frame(0, 0, 200.2, 0.4);

    expect(documentFrameSize(documentFrame)).toEqual({ width: 201, height: 1 });
    expect(drawLayersToCanvas(target.canvas, [], documentFrame)).toBe(true);

    expect(target.canvas.width).toBe(201);
    expect(target.canvas.height).toBe(1);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 201, 1);
  });

  it('draws visible layers in array order and never touches a hidden layer', () => {
    const target = createTargetCanvas();
    const first = createImageLayer('first', { x: 0, y: 0, width: 20, height: 10 });
    const hidden = createImageLayer('hidden', { x: 5, y: 5, width: 20, height: 10 }, { visible: false, bitmap: null });
    const last = createImageLayer('last', { x: 10, y: 10, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [first, hidden, last], frame(0, 0, 100, 100))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([first.bitmap, last.bitmap]);
    // A hidden layer is skipped before any source work, so only the two visible layers
    // contribute their save/restore pairs (drawLayer plus drawLayerSource each).
    expect(staging.save).toHaveBeenCalledTimes(4);
    expect(staging.restore).toHaveBeenCalledTimes(4);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('draws in array order even when the layer order fields disagree', () => {
    const target = createTargetCanvas();
    const top = createImageLayer('top', { x: 0, y: 0, width: 20, height: 10 }, { order: 5 });
    const bottom = createImageLayer('bottom', { x: 0, y: 0, width: 20, height: 10 }, { order: 0 });

    expect(drawLayersToCanvas(target.canvas, [top, bottom], frame(0, 0, 100, 100))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([top.bitmap, bottom.bitmap]);
  });

  it('keeps composing when a layer has no bitmap and still publishes the remaining layers', () => {
    const target = createTargetCanvas();
    const before = createImageLayer('before', { x: 0, y: 0, width: 20, height: 10 });
    const blank = createImageLayer('blank', { x: 1, y: 1, width: 20, height: 10 }, { bitmap: null });
    const after = createImageLayer('after', { x: 2, y: 2, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [before, blank, after], frame(0, 0, 100, 100))).toBe(true);

    const stagingCanvas = stagingCanvasFor(target.canvas);
    const staging = contextMockFor(stagingCanvas);
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([before.bitmap, after.bitmap]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('skipped layer without bitmap', 'blank');
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 100, 100);
    expect(target.context.drawImage).toHaveBeenCalledWith(stagingCanvas, 0, 0);
  });

  it('refuses strict navigation when a visible layer has no bitmap', () => {
    const target = createTargetCanvas();
    const healthy = createImageLayer('healthy', { x: 0, y: 0, width: 20, height: 10 });
    const missing = createImageLayer('missing', { x: 1, y: 1, width: 20, height: 10 }, { bitmap: null });

    expect(drawLayersToCanvas(target.canvas, [healthy, missing], frame(0, 0, 100, 100), undefined, 1, true)).toBe(
      false
    );
    expect(target.context.clearRect).not.toHaveBeenCalled();
    expect(target.context.drawImage).not.toHaveBeenCalled();
  });

  it('treats a zero-sized bitmap as a skippable layer rather than a failure', () => {
    const target = createTargetCanvas();
    const collapsed = createImageLayer('collapsed', { x: 0, y: 0, width: 0, height: 0 });
    const healthy = createImageLayer('healthy', { x: 0, y: 0, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [collapsed, healthy], frame(0, 0, 100, 100))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([healthy.bitmap]);
    expect(consoleError).toHaveBeenCalledWith('skipped layer without bitmap', 'collapsed');
  });

  it('leaves the visible canvas untouched when a layer source throws while composing', () => {
    const target = createTargetCanvas();
    const failure = new Error('bitmap decode failed');
    vi.spyOn(toolProcessors.shape, 'imageProcessor').mockImplementation(throwing(failure));
    const drawn = createImageLayer('drawn', { x: 0, y: 0, width: 20, height: 10 });
    const broken = createVectorLayer('broken', { x: 4, y: 6, width: 20, height: 10 });
    const never = createImageLayer('never', { x: 8, y: 9, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [drawn, broken, never], frame(0, 0, 640, 480))).toBe(false);

    expect(consoleError).toHaveBeenCalledWith('Unable to compose runtime layer presentation', failure);
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    expect(contextRequests).not.toContain(target.canvas);
    expectNoContextCalls(target.context);

    const stagingCanvas = contextRequests[0];
    expect(stagingCanvas.width).toBe(640);
    const staging = contextMockFor(stagingCanvas);
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([drawn.bitmap]);
  });

  it('leaves the visible canvas untouched when the staging context throws', () => {
    const target = createTargetCanvas();
    const failure = new Error('staging context lost');
    const staging = createDrawContext();
    staging.drawImage.mockImplementation(throwing(failure));
    contextFactory = () => staging;

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 4, y: 6, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(staging.drawImage).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to compose runtime layer presentation', failure);
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    expect(contextRequests).not.toContain(target.canvas);
    expectNoContextCalls(target.context);
    // drawLayerSource and drawLayer both balance their save/restore pair while unwinding.
    expect(staging.restore).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the visible canvas has no 2d context', () => {
    const target = createTargetCanvas();
    nullContextCallIndex = 2;

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 0, y: 0, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(consoleError).not.toHaveBeenCalled();
    expectNoContextCalls(target.context);
    // Context validation happens before the visible canvas is resized, so a missing
    // destination leaves both the pixels and dimensions untouched.
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
  });

  it('reports a publish failure when clearing the visible canvas throws', () => {
    const target = createTargetCanvas();
    const failure = new Error('clear failed');
    target.context.clearRect.mockImplementation(throwing(failure));

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 0, y: 0, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to publish runtime layer presentation', failure);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
    expect(target.context.drawImage).toHaveBeenCalledTimes(1);
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
  });

  it('reports a publish failure when blitting the staging canvas throws', () => {
    const target = createTargetCanvas();
    const failure = new Error('blit failed');
    target.context.drawImage.mockImplementation(throwing(failure));

    expect(drawLayersToCanvas(target.canvas, [], frame(0, 0, 640, 480))).toBe(false);

    expect(consoleError).toHaveBeenNthCalledWith(1, 'Unable to restore runtime layer presentation', failure);
    expect(consoleError).toHaveBeenNthCalledWith(2, 'Unable to publish runtime layer presentation', failure);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 640, 480);
  });

  it('restores the visible canvas when resizing fails after changing one dimension', () => {
    const target = createTargetCanvas();
    const failure = new Error('resize failed');
    let width = 300;
    let height = 150;
    const resizeWrites: ResizeRecord[] = [];
    Object.defineProperties(target.canvas, {
      width: {
        configurable: true,
        get: () => width,
        set: (value: number) => {
          resizeWrites.push(['width', value]);
          width = value;
        },
      },
      height: {
        configurable: true,
        get: () => height,
        set: (value: number) => {
          resizeWrites.push(['height', value]);
          if (value === 480) throw failure;
          height = value;
        },
      },
    });

    expect(drawLayersToCanvas(target.canvas, [], frame(0, 0, 640, 480))).toBe(false);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to publish runtime layer presentation', failure);
    expect(resizeWrites).toEqual([
      ['width', 640],
      ['height', 480],
      ['width', 300],
      ['height', 150],
    ]);
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    expect(target.context.clearRect).not.toHaveBeenCalled();
    expect(target.context.drawImage).toHaveBeenCalledTimes(1);
  });

  it('fails closed without touching the visible canvas when the staging context is unavailable', () => {
    const target = createTargetCanvas();
    nullContextCallIndex = 1;

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 0, y: 0, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(consoleError).not.toHaveBeenCalled();
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    // Staging canvas context is requested first and returns null; target is never touched
    expect(contextRequests).toHaveLength(1);
    expect(contextRequests[0]).not.toBe(target.canvas);
    expectNoContextCalls(target.context);
  });

  it('propagates a staging allocation failure because staging setup is outside the guarded section', () => {
    const target = createTargetCanvas();
    const failure = new Error('canvas allocation failed');
    const createElement = vi.spyOn(document, 'createElement').mockImplementation(throwing(failure));

    expect(() => drawLayersToCanvas(target.canvas, [], frame(0, 0, 640, 480))).toThrow(failure);

    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    expect(contextRequests).toEqual([]);
    expectNoContextCalls(target.context);
  });

  it('never reaches its non-DOM guard, because the document global cannot be removed in this environment', () => {
    // The `typeof document === 'undefined'` early return only fires in a non-DOM realm.
    // Under this vitest config (jsdom + pool: 'vmThreads') `document` is a getter-only,
    // non-configurable global, so neither assignment, deletion nor defineProperty can
    // undefine it. This pins that limitation instead of pretending the branch is covered.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');

    expect(descriptor?.get).toBeTypeOf('function');
    expect(descriptor?.set).toBeUndefined();
    expect(descriptor?.configurable).toBe(false);
    expect(Reflect.set(globalThis, 'document', undefined)).toBe(false);
    expect(Reflect.deleteProperty(globalThis, 'document')).toBe(false);
    expect(typeof document).toBe('object');
  });

  it('reads the document global at call time instead of capturing it at import time', () => {
    const target = createTargetCanvas();
    const createElement = vi.spyOn(document, 'createElement');
    const layer = createImageLayer('layer-1', { x: 4, y: 6, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [layer], frame(0, 0, 640, 480))).toBe(true);

    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(stagingCanvasFor(target.canvas).width).toBe(640);
    expect(target.context.drawImage).toHaveBeenCalledWith(stagingCanvasFor(target.canvas), 0, 0);
  });

  it('maps layer positions through a non-zero document frame origin', () => {
    const target = createTargetCanvas();
    const bitmap = createBitmap(20, 10);
    const layer = createImageLayer('layer-1', { x: 45, y: 38, width: 20, height: 10 }, { bitmap });

    expect(drawLayersToCanvas(target.canvas, [layer], frame(40, 30, 80, 60))).toBe(true);

    expect(target.canvas.width).toBe(80);
    expect(target.canvas.height).toBe(60);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 80, 60);
    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage).toHaveBeenCalledWith(bitmap, 5, 8, 20, 10);
  });

  it('translates affine layers by the same frame-relative origin', () => {
    const target = createTargetCanvas();
    const transform: AffineTransform = { a: 2, b: 0, c: 0, d: 2, e: 3, f: 4 };
    const layer = createImageLayer(
      'layer-1',
      { x: 45, y: 38, width: 20, height: 10 },
      {
        operations: [affineOperation(transform)],
      }
    );

    expect(drawLayersToCanvas(target.canvas, [layer], frame(40, 30, 80, 60))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.translate).toHaveBeenCalledWith(5, 8);
    expect(staging.transform).toHaveBeenCalledWith(2, 0, 0, 2, 3, 4);
    expect(staging.drawImage).toHaveBeenCalledWith(layer.bitmap, 0, 0, 20, 10);
  });

  it('publishes an empty layer list as a cleared canvas of the frame size', () => {
    const target = createTargetCanvas();

    expect(drawLayersToCanvas(target.canvas, [], frame(12, 34, 128, 64))).toBe(true);

    expect(target.canvas.width).toBe(128);
    expect(target.canvas.height).toBe(64);
    expect(target.context.clearRect).toHaveBeenCalledWith(0, 0, 128, 64);
    const stagingCanvas = stagingCanvasFor(target.canvas);
    expect(stagingCanvas.width).toBe(128);
    expect(stagingCanvas.height).toBe(64);
    expect(target.context.drawImage).toHaveBeenCalledWith(stagingCanvas, 0, 0);
    expectNoContextCalls(contextMockFor(stagingCanvas));
  });

  it('reads the caller document frame in place once per size and once per drawn layer', () => {
    const target = createTargetCanvas();
    const reads: string[] = [];
    const backing = Object.freeze({ x: 40, y: 30, width: 80, height: 60 });
    const documentFrame = new Proxy(backing, {
      get(source, property, receiver) {
        if (typeof property === 'string') reads.push(property);
        return Reflect.get(source, property, receiver);
      },
    }) as DocumentFrame;
    const layers = [
      createImageLayer('first', { x: 45, y: 38, width: 20, height: 10 }),
      createImageLayer('second', { x: 50, y: 40, width: 20, height: 10 }),
    ];

    expect(drawLayersToCanvas(target.canvas, layers, documentFrame)).toBe(true);

    const readCount = (property: string) => reads.filter((entry) => entry === property).length;
    // documentFrameSize is the only reader of the size, so a single read of each proves the
    // frame is never copied or re-derived on its way into drawLayer.
    expect(readCount('width')).toBe(1);
    expect(readCount('height')).toBe(1);
    // That same frame instance is consulted exactly once per drawn layer.
    expect(readCount('x')).toBe(2);
    expect(readCount('y')).toBe(2);
    expect(backing).toEqual({ x: 40, y: 30, width: 80, height: 60 });

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage.mock.calls.map(([, x, y]) => [x, y])).toEqual([
      [5, 8],
      [10, 10],
    ]);
  });

  it('prefers the layer tmpCanvas over the layer bitmap when staging', () => {
    const target = createTargetCanvas();
    const tmpCanvas = createBitmap(20, 10) as BitmapSource;
    const layer = createImageLayer('layer-1', { x: 4, y: 6, width: 20, height: 10 }, { tmpCanvas });

    expect(drawLayersToCanvas(target.canvas, [layer], frame(0, 0, 640, 480))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage).toHaveBeenCalledWith(tmpCanvas, 4, 6, 20, 10);
    expect(staging.drawImage).not.toHaveBeenCalledWith(layer.bitmap, 4, 6, 20, 10);
  });

  it('applies layer opacity and blend mode to the staging context only', () => {
    const target = createTargetCanvas();
    const layer = createImageLayer(
      'layer-1',
      { x: 0, y: 0, width: 20, height: 10 },
      {
        opacity: 0.25,
        blendMode: 'multiply',
      }
    );

    expect(drawLayersToCanvas(target.canvas, [layer], frame(0, 0, 640, 480))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.globalAlpha).toBe(0.25);
    expect(staging.globalCompositeOperation).toBe('multiply');
    expect(target.context.globalAlpha).toBe(1);
    expect(target.context.globalCompositeOperation).toBe('source-over');
  });

  it('applies the enabled layer filter stack to the staging context only', () => {
    const target = createTargetCanvas();
    const layer = createImageLayer(
      'layer-1',
      { x: 0, y: 0, width: 20, height: 10 },
      {
        operations: [
          { id: 'blur-1', args: { toolName: 'blur', radius: 3 }, enabled: true },
          { id: 'levels-1', args: { toolName: 'levels', brightness: 10, contrast: -5 }, enabled: false },
        ],
      }
    );

    expect(drawLayersToCanvas(target.canvas, [layer], frame(0, 0, 640, 480))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.filter).toBe('blur(3px)');
    expect(target.context.filter).toBe('none');
  });

  it('leaves the visible canvas intact when the publish blit throws with no resize to undo', () => {
    // The steady state: the target already carries the frame's dimensions, so `resizeCanvas`
    // writes nothing and there is no resize for the restore to reverse. `clearRect` had
    // already emptied this canvas by the time the blit threw, and nothing was put back, so the
    // document went blank while the caller was told only that publishing failed. The previous
    // pixels must reach the target even when the dimensions never changed.
    const target = createTargetCanvas(640, 480);
    const failure = new Error('blit failed');
    target.context.drawImage.mockImplementationOnce(throwing(failure));

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 4, y: 6, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith('Unable to publish runtime layer presentation', failure);
    // The wipe did happen, and the restore undid it: the second draw is the snapshot, not the
    // staging canvas, so the frame that was on screen is back.
    const stagingCanvas = stagingCanvasFor(target.canvas);
    const [blit, restore] = target.context.drawImage.mock.calls as Array<[unknown, number, number]>;
    expect(blit[0]).toBe(stagingCanvas);
    expect(restore[0]).not.toBe(stagingCanvas);
    expect((restore[0] as HTMLCanvasElement).width).toBe(640);
    expect((restore[0] as HTMLCanvasElement).height).toBe(480);
    expect(target.canvas.width).toBe(640);
    expect(target.canvas.height).toBe(480);
  });

  it('publishes a document whose layer is larger than the affine pixel cap', () => {
    // 81 Mpx. `useApp.ts:159` caps nothing when a non-PSD image is opened, and this path sizes
    // no surface from the layer extent, so such a layer used to abort the WHOLE publish: its
    // own bounds exceeded MAX_AFFINE_PIXELS, and one refused layer took the document with it.
    const target = createTargetCanvas();
    const size = { x: 0, y: 0, width: 9000, height: 9000 };
    const bitmap = createBitmap(9000, 9000);
    const layer = createImageLayer('large', size, { bitmap });

    expect(size.width * size.height).toBeGreaterThan(MAX_AFFINE_PIXELS);
    expect(drawLayersToCanvas(target.canvas, [layer], frame(0, 0, 9000, 9000))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    expect(staging.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 9000, 9000);
    // Published rather than skipped: a refusal would have logged a skip for this layer.
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('drops only the layer whose filter argument cannot be rendered, and publishes the rest', () => {
    const target = createTargetCanvas();
    // A JSON round trip is allowed to turn `radius` into a string; it is not allowed to turn it
    // into a CSS keyword, and `LayerOperationArgs` says as much.
    const corrupt = createImageLayer(
      'corrupt',
      { x: 0, y: 0, width: 20, height: 10 },
      {
        operations: [
          { id: 'blur-1', args: { toolName: 'blur', radius: 'wide' }, enabled: true } as unknown as LayerOperation,
        ],
      }
    );
    const healthy = createImageLayer('healthy', { x: 4, y: 6, width: 20, height: 10 });

    expect(drawLayersToCanvas(target.canvas, [corrupt, healthy], frame(0, 0, 100, 100))).toBe(true);

    const staging = contextMockFor(stagingCanvasFor(target.canvas));
    // The corrupt layer is refused rather than drawn unfiltered: a browser discards an
    // unparseable `ctx.filter` outright, which would present it with no blur at all.
    expect(staging.drawImage.mock.calls.map(([bitmap]) => bitmap)).toEqual([healthy.bitmap]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toBe('skipped layer whose filter arguments cannot be rendered');
    expect(consoleError.mock.calls[0][1]).toBe('corrupt');
  });

  it('resizes the staging canvas and then the visible canvas on successful publication', () => {
    const target = createTargetCanvas();
    const { createElement, stagingResizes } = trackStagingCanvasResizes();
    const targetResizes = trackCanvasResizes(target.canvas);

    expect(drawLayersToCanvas(target.canvas, [], frame(0, 0, 640, 480))).toBe(true);

    expect(createElement).toHaveBeenCalledWith('canvas');
    expect(stagingResizes).toEqual([
      ['width', 640],
      ['height', 480],
    ]);
    expect(targetResizes).toEqual([
      ['width', 640],
      ['height', 480],
    ]);
  });

  it('keeps HiDPI backing dimensions stable across repeated publication', () => {
    const target = createTargetCanvas();
    const targetResizes = trackCanvasResizes(target.canvas);
    const documentFrame = frame(0, 0, 640, 480);

    expect(drawLayersToCanvas(target.canvas, [], documentFrame, undefined, 2)).toBe(true);
    expect(target.canvas.width).toBe(1280);
    expect(target.canvas.height).toBe(960);
    expect(target.canvas.getAttribute('data-hidpi-ratio')).toBe('2');
    const firstPublicationResizes = [...targetResizes];

    expect(drawLayersToCanvas(target.canvas, [], documentFrame, undefined, 2)).toBe(true);
    expect(targetResizes).toEqual(firstPublicationResizes);
    expect(target.canvas.width).toBe(1280);
    expect(target.canvas.height).toBe(960);
    expect(target.canvas.getAttribute('data-hidpi-ratio')).toBe('2');
  });

  it.each([
    { backingScale: 2, backingWidth: 1280, backingHeight: 960 },
    { backingScale: 0.5, backingWidth: 320, backingHeight: 240 },
  ])(
    'restores the existing $backingWidth×$backingHeight backing pixels after a $backingScale× publish blit fails',
    ({ backingScale, backingWidth, backingHeight }) => {
      const target = createTargetCanvas(backingWidth, backingHeight);
      target.canvas.setAttribute('data-hidpi-ratio', String(backingScale));
      const targetResizes = trackCanvasResizes(target.canvas);
      const failure = new Error('blit failed');
      target.context.drawImage.mockImplementationOnce(throwing(failure));

      expect(drawLayersToCanvas(target.canvas, [], frame(0, 0, 640, 480), undefined, backingScale)).toBe(false);

      expect(target.canvas.width).toBe(backingWidth);
      expect(target.canvas.height).toBe(backingHeight);
      expect(target.canvas.getAttribute('data-hidpi-ratio')).toBe(String(backingScale));
      expect(targetResizes).toEqual([
        ['width', backingWidth],
        ['height', backingHeight],
      ]);
      expect(target.context.drawImage).toHaveBeenCalledTimes(2);
      const snapshot = target.context.drawImage.mock.calls[1][0] as HTMLCanvasElement;
      expect(snapshot.width).toBe(backingWidth);
      expect(snapshot.height).toBe(backingHeight);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError).toHaveBeenCalledWith('Unable to publish runtime layer presentation', failure);
    }
  );

  it('resizes only the staging canvas when composition fails', () => {
    const target = createTargetCanvas();
    const { stagingResizes } = trackStagingCanvasResizes();
    const targetResizes = trackCanvasResizes(target.canvas);
    const failure = new Error('staging context lost');
    const staging = createDrawContext();
    staging.drawImage.mockImplementation(throwing(failure));
    contextFactory = () => staging;

    expect(
      drawLayersToCanvas(
        target.canvas,
        [createImageLayer('layer-1', { x: 0, y: 0, width: 20, height: 10 })],
        frame(0, 0, 640, 480)
      )
    ).toBe(false);

    expect(consoleError).toHaveBeenCalledWith('Unable to compose runtime layer presentation', failure);
    expect(stagingResizes).toEqual([
      ['width', 640],
      ['height', 480],
    ]);
    expect(targetResizes).toEqual([]);
    expect(target.canvas.width).toBe(300);
    expect(target.canvas.height).toBe(150);
    expectNoContextCalls(target.context);
  });
});
