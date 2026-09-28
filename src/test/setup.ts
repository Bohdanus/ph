import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const testGlobal = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserver;
  Path2D?: typeof Path2D;
  matchMedia?: typeof window.matchMedia;
};

if (!testGlobal.requestAnimationFrame) {
  testGlobal.requestAnimationFrame = (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16) as unknown as number;
}

if (!testGlobal.cancelAnimationFrame) {
  testGlobal.cancelAnimationFrame = (id: number) => {
    clearTimeout(id);
  };
}

if (!testGlobal.ResizeObserver) {
  testGlobal.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom implements neither `window.matchMedia` nor media query evaluation.
//
// `useMediaQuery` treats an absent `matchMedia` as "no match", which is the desktop
// layout — the correct safe direction for a desktop-first app, since a missing primitive
// must never silently select the mobile shell. But it would also leave every responsive
// branch permanently unreachable from a test, and would hide a hook bug behind a stub
// that always answers false. Install an evaluator for the width forms this repo uses,
// driven by the live `window.innerWidth`.
const LENGTH_PATTERN = /^(-?[\d.]+)(px|rem|em)?$/;

function toPixels(value: string): number {
  const parsed = LENGTH_PATTERN.exec(value.trim());
  if (!parsed) return Number.NaN;
  const amount = Number(parsed[1]);
  if (!Number.isFinite(amount)) return Number.NaN;
  // jsdom has no user-configurable default font size, so a rem media feature is pinned to
  // the CSS initial value. Production pins these boundaries to px in `src/index.scss`
  // precisely so this approximation is never load-bearing.
  return parsed[2] === 'rem' || parsed[2] === 'em' ? amount * 16 : amount;
}

function termMatches(term: string, width: number): boolean {
  const range = /\(\s*(min-width|max-width|width|height)\s*(<=|>=|<|>|=)\s*([^)]+?)\s*\)/.exec(term);
  if (range) {
    const [, feature, operator, rawValue] = range;
    const target = toPixels(rawValue);
    if (!Number.isFinite(target)) return false;
    // jsdom's viewport is not resized by the suite, so a height feature always matches;
    // asserting on it would pin the stub rather than the code.
    if (feature === 'height') return true;
    switch (operator) {
      case '<':
        return width < target;
      case '<=':
        return width <= target;
      case '>':
        return width > target;
      case '>=':
        return width >= target;
      default:
        return width === target;
    }
  }

  const legacy = /\(\s*(min-width|max-width)\s*:\s*([^)]+?)\s*\)/.exec(term);
  if (legacy) {
    const [, kind, rawValue] = legacy;
    const target = toPixels(rawValue);
    if (!Number.isFinite(target)) return false;
    return kind === 'min-width' ? width >= target : width <= target;
  }

  return false;
}

function evaluateQuery(query: string, width: number): boolean {
  const trimmed = query.trim();
  if (/^not\s+/i.test(trimmed)) return !evaluateQuery(trimmed.replace(/^not\s+/i, ''), width);
  return trimmed
    .split(/\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => termMatches(part, width));
}

/**
 * A listener as the DOM types it (`EventListenerOrEventListenerObject`) and as this module
 * calls it (a function taking the event). `never` is the only parameter type both accept,
 * because `MediaQueryListEvent` is assignable to `Event` but not the reverse.
 */
type AnyListener = (event: never) => void;

interface TrackedQuery {
  media: string;
  listeners: Set<AnyListener>;
  last: boolean;
}

const trackedQueries: TrackedQuery[] = [];

if (!testGlobal.matchMedia) {
  testGlobal.matchMedia = (query: string): MediaQueryList => {
    // Seed `last` with the query's actual value. Starting it at `false` swallows the first
    // notification for any list created while the query already matches: a `useMediaQuery`
    // that mounted inside the tablet band would never be told it had left it.
    const entry: TrackedQuery = {
      media: query,
      listeners: new Set(),
      last: evaluateQuery(query, window.innerWidth),
    };
    trackedQueries.push(entry);

    const list = {
      get matches() {
        return evaluateQuery(query, window.innerWidth);
      },
      media: query,
      onchange: null,
      addEventListener: ((_type: string, listener: AnyListener) => {
        entry.listeners.add(listener);
      }) as MediaQueryList['addEventListener'],
      removeEventListener: ((_type: string, listener: AnyListener) => {
        entry.listeners.delete(listener);
      }) as MediaQueryList['removeEventListener'],
      addListener: ((listener: AnyListener) => {
        entry.listeners.add(listener);
      }) as MediaQueryList['addListener'],
      removeListener: ((listener: AnyListener) => {
        entry.listeners.delete(listener);
      }) as MediaQueryList['removeListener'],
      dispatchEvent: () => true,
    };

    return list as unknown as MediaQueryList;
  };
}

/**
 * Resize the simulated viewport and deliver the `change` event every live
 * `MediaQueryList` owes its listeners.
 *
 * A test that only assigns `window.innerWidth` leaves every already-subscribed
 * `useMediaQuery` holding its previous answer, so the hook never re-renders and the test
 * asserts nothing. This is the one place that resolves the whole "set the width, then
 * flush" sequence, so individual tests do not each reinvent it.
 */
export function setViewportWidth(width: number, height = window.innerHeight): void {
  window.innerWidth = width;
  window.innerHeight = height;

  for (const entry of trackedQueries) {
    const next = evaluateQuery(entry.media, window.innerWidth);
    if (next === entry.last) continue;
    entry.last = next;
    const event = { matches: next, media: entry.media } as MediaQueryListEvent;
    for (const listener of entry.listeners) {
      (listener as (value: MediaQueryListEvent) => void)(event);
    }
  }
}

if (!testGlobal.Path2D) {
  testGlobal.Path2D = vi.fn().mockImplementation(function MockPath2D() {
    return {
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      arc: vi.fn(),
      arcTo: vi.fn(),
      ellipse: vi.fn(),
      rect: vi.fn(),
      roundRect: vi.fn(),
      addPath: vi.fn(),
    };
  }) as unknown as typeof Path2D;
}

if (!testGlobal.OffscreenCanvas) {
  testGlobal.OffscreenCanvas = class MockOffscreenCanvas {
    width = 0;
    height = 0;
    private context: OffscreenCanvasRenderingContext2D | null = null;
    constructor(width: number, height: number) {
      this.width = Math.max(1, Math.ceil(width));
      this.height = Math.max(1, Math.ceil(height));
    }
    getContext() {
      if (!this.context) {
        this.context = createMockCanvasContext(this) as unknown as OffscreenCanvasRenderingContext2D;
      }
      return this.context;
    }
    resize(width: number, height: number) {
      this.width = Math.max(1, Math.ceil(width));
      this.height = Math.max(1, Math.ceil(height));
    }
    convertToBlob() {
      return Promise.resolve(new Blob([]));
    }
    transferToImageBitmap() {
      return {
        width: this.width,
        height: this.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
  } as unknown as typeof OffscreenCanvas;
}

if (!testGlobal.createImageBitmap) {
  testGlobal.createImageBitmap = vi.fn(async (source: CanvasImageSource) => {
    if (source instanceof OffscreenCanvas) {
      return {
        width: source.width,
        height: source.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
    if (source instanceof HTMLCanvasElement) {
      return {
        width: source.width,
        height: source.height,
        close: vi.fn(),
      } as unknown as ImageBitmap;
    }
    return {
      width: 100,
      height: 100,
      close: vi.fn(),
    } as unknown as ImageBitmap;
  }) as typeof createImageBitmap;
}

if (!testGlobal.URL.createObjectURL) {
  const originalURL = globalThis.URL;
  testGlobal.URL = Object.assign(class extends originalURL {}, {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(() => {}),
  }) as typeof URL;
}

export function createMockCanvasContext(canvas?: { width: number; height: number }): CanvasRenderingContext2D {
  return {
    canvas: canvas ?? { width: 0, height: 0 },
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    rect: vi.fn(),
    roundRect: vi.fn(),
    arcTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    arc: vi.fn(),
    ellipse: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    reset: vi.fn(),
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => [] as number[]),
    drawImage: vi.fn(),
    clip: vi.fn(),
    isPointInPath: vi.fn(() => false),
    isPointInStroke: vi.fn(() => false),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createConicGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createPattern: vi.fn(() => null),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    transform: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 10,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    direction: 'inherit',
    imageSmoothingEnabled: true,
    shadowBlur: 0,
    shadowColor: 'rgba(0, 0, 0, 0)',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    // A real data property, not a getter that always returns ''. A getter makes
    // `ctx.filter = 'blur(4px)'` unobservable, so every assertion about filter
    // application through this mock was asserting nothing.
    filter: '',
  } as unknown as CanvasRenderingContext2D;
}

/**
 * Opt-in pixel-capable context.
 *
 * The globally installed context deliberately has NO `getImageData`/`putImageData`,
 * because production code guards on `typeof ctx.getImageData === 'function'` to detect
 * a reduced canvas environment. Adding read-back to the global mock would silently
 * flip every rasterization test onto the other branch. Tests that need real read-back
 * must opt in here (or use `makeMockCtx` from `@/__tests__/canvas-mock`).
 */
export function createPixelCanvasContext(canvas?: { width: number; height: number }): CanvasRenderingContext2D {
  const base = createMockCanvasContext(canvas) as unknown as Record<string, unknown>;
  return {
    ...base,
    getImageData: vi.fn((_x: number, _y: number, width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
    putImageData: vi.fn(),
    createImageData: vi.fn((width: number, height: number) => ({
      data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
      width,
      height,
      colorSpace: 'srgb',
    })),
  } as unknown as CanvasRenderingContext2D;
}

const installCanvasContextStub = () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
    return createMockCanvasContext(this) as unknown as CanvasRenderingContext2D;
  });
};

installCanvasContextStub();

beforeEach(() => {
  installCanvasContextStub();
});
