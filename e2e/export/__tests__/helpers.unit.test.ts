import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Page, TestInfo } from '@playwright/test';
import path from 'node:path';
import sharp from 'sharp';
import { mkdir, readFile, rm } from 'node:fs/promises';
import {
  CHANGED_CHANNEL_THRESHOLD_GENERAL,
  CHANGED_CHANNEL_THRESHOLD_ICO,
  CHANNEL_DELTA_TOLERANCE,
  DOWNLOAD_TIMEOUT_MS,
  INTEGRATION_TEST_TIMEOUT_MS,
  exportFormats,
  icoFormat,
  ICON_STROKE,
  mimeType,
  exportAndVerify,
  exportIcoAndVerify,
  setupExportTest,
  setupIcoTest,
  verifyPsdInPhotopea,
  type ExportFormat,
} from '../helpers';
import {
  CANVAS_REDRAW_CLIP,
  CANVAS_REDRAW_POLL_INTERVAL_MS,
  LINE_END_X,
  LINE_END_Y,
  LINE_START_X,
  LINE_START_Y,
} from '../../helpers/canvas-helpers';

const mocks = vi.hoisted(() => {
  const context: { received: unknown; message: string | undefined } = {
    received: undefined,
    message: undefined,
  };

  const show = (value: unknown): string => (typeof value === 'string' ? JSON.stringify(value) : String(value));

  const fail: (matcher: string, detail: string) => never = (matcher, detail) => {
    throw new Error(`${context.message ? `${context.message}: ` : ''}${matcher} ${detail}`);
  };

  const probeOf = (value: unknown): Probe | undefined => {
    const isProbe =
      typeof value === 'object' &&
      value !== null &&
      typeof Reflect.get(value, 'count') === 'function' &&
      typeof Reflect.get(value, 'isVisible') === 'function' &&
      typeof Reflect.get(value, 'textContent') === 'function';
    return isProbe ? (value as Probe) : undefined;
  };

  interface Probe {
    count(): Promise<number>;
    isVisible(): Promise<boolean>;
    textContent(): Promise<string | null>;
  }

  const matchers = {
    toBeVisible: vi.fn(async () => {
      const probe = probeOf(context.received);
      if (!probe) fail('toBeVisible', `expected a locator, received ${show(context.received)}`);
      if (!(await probe.isVisible())) fail('toBeVisible', 'expected the element to be visible');
    }),
    toHaveCount: vi.fn(async (expected: number) => {
      const probe = probeOf(context.received);
      if (!probe) fail('toHaveCount', `expected a locator, received ${show(context.received)}`);
      const count = await probe.count();
      if (count !== expected) fail('toHaveCount', `expected count ${expected}, received ${count}`);
    }),
    toContainText: vi.fn(async (expected: string, _options?: { timeout?: number }) => {
      const probe = probeOf(context.received);
      if (!probe) fail('toContainText', `expected a locator, received ${show(context.received)}`);
      const text = (await probe.textContent()) ?? '';
      if (!text.includes(expected)) {
        fail('toContainText', `expected text containing ${show(expected)}, received ${show(text)}`);
      }
    }),
    toBeNull: vi.fn(() => {
      if (context.received !== null) fail('toBeNull', `expected null, received ${show(context.received)}`);
    }),
    toBe: vi.fn((expected: unknown) => {
      if (!Object.is(context.received, expected)) {
        fail('toBe', `expected ${show(expected)}, received ${show(context.received)}`);
      }
    }),
    toBeGreaterThan: vi.fn((expected: number) => {
      const received = context.received;
      if (typeof received !== 'number' || !(received > expected)) {
        fail('toBeGreaterThan', `expected a number greater than ${expected}, received ${show(received)}`);
      }
    }),
  };

  return {
    mockExpect: vi.fn((received: unknown, message?: string) => {
      context.received = received;
      context.message = message;
      return matchers;
    }),
    matchers,
    exportedFile: Buffer.alloc(512),
  };
});

// The Playwright expect is replaced by a recording validator so that assertions
// made inside the helpers really fail the test instead of always passing.
vi.mock('@playwright/test', () => ({
  expect: mocks.mockExpect,
}));

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(async () => mocks.exportedFile),
}));

const OCTET_STREAM_MIME = 'application/octet-stream';
const SOURCE_DATA_URL = 'data:image/png;base64,c291cmNlLWNhbnZhcw==';
const EXPORT_FILENAME = 'drawing';
const ICON_EXPORT_FILENAME = 'drawing-icon';
const OUTPUT_DIR = '/tmp/export-unit/output';
const DOWNLOAD_DIRECTORY = path.join(OUTPUT_DIR, 'exports');
const PSD_PATH = '/tmp/export-unit/drawing.psd';
const ICON_CANVAS_SIZE = 256;
const PHOTOPEA_URL = 'https://www.photopea.com/';
const PHOTOPEA_BODY_WITH_EXPORT = 'drawing.png 512 x 512';
const PHOTOPEA_BODY_WITHOUT_EXPORT = 'Untitled-1';

// Literal pins for the budgets helpers.ts hard-codes: Playwright defaults to
// 30s and a 1ms budget passes any upper-bound-only assertion, so the intended
// values are spelled out here instead of being read back from the source.
const CANVAS_READY_TIMEOUT_MS = 60_000;
const PHOTOPEA_API_TIMEOUT_MS = 10_000;
const PHOTOPEA_NAVIGATION_TIMEOUT_MS = 30_000;
const PHOTOPEA_EXPORT_VISIBLE_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS_LITERAL = 30_000;
const MIN_EXPORT_BYTES = 100;

const COMPARE_IMAGE_SIZE = 256;
const EXPORTED_BASE64 = mocks.exportedFile.toString('base64');
const EXPORTED_PNG_DATA_URL = `data:image/png;base64,${EXPORTED_BASE64}`;
const EXPORTED_ICO_DATA_URL = `data:image/x-icon;base64,${EXPORTED_BASE64}`;

interface StubImage {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

interface DecodedImage {
  width: number;
  height: number;
  pixels?: Uint8ClampedArray;
  onload?: () => void;
  onerror?: () => void;
}

/** A left/right split image, so `compareImage(0, 255)` and `compareImage(255, 0)` are the same image translated by half its width. */
function compareImage(left: number, right: number, alpha = 255): StubImage {
  const pixels = new Uint8ClampedArray(COMPARE_IMAGE_SIZE * COMPARE_IMAGE_SIZE * 4);
  for (let row = 0; row < COMPARE_IMAGE_SIZE; row += 1) {
    for (let column = 0; column < COMPARE_IMAGE_SIZE; column += 1) {
      const value = column < COMPARE_IMAGE_SIZE / 2 ? left : right;
      const index = (row * COMPARE_IMAGE_SIZE + column) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = alpha;
    }
  }
  return { width: COMPARE_IMAGE_SIZE, height: COMPARE_IMAGE_SIZE, pixels };
}

const IDENTICAL_EXPORT = compareImage(0, 255);
const SHIFTED_EXPORT = compareImage(255, 0);
const WITHIN_TOLERANCE_EXPORT = compareImage(40, 255);
const ALPHA_ONLY_EXPORT = compareImage(0, 255, 0);

/**
 * Stubs the browser surface the `page.evaluate` pixel comparators close over,
 * returning the array every decoded image source is recorded in.
 */
function stubCompareEnvironment(
  images: Record<string, StubImage>,
  { contextAvailable = true }: { contextAvailable?: boolean } = {}
): string[] {
  const requestedSources: string[] = [];
  vi.stubGlobal(
    'Image',
    class {
      width = 0;
      height = 0;
      pixels: Uint8ClampedArray | undefined = undefined;
      onload?: () => void;
      onerror?: () => void;
      set src(value: string) {
        requestedSources.push(value);
        const image = images[value];
        if (!image) {
          queueMicrotask(() => this.onerror?.());
          return;
        }
        this.width = image.width;
        this.height = image.height;
        this.pixels = image.pixels;
        queueMicrotask(() => this.onload?.());
      }
    }
  );
  vi.stubGlobal('document', {
    createElement: () => {
      let drawn: DecodedImage | undefined;
      return {
        width: 0,
        height: 0,
        getContext: () =>
          contextAvailable
            ? {
                drawImage: (image: DecodedImage) => {
                  drawn = image;
                },
                getImageData: () => ({ data: drawn?.pixels ?? new Uint8ClampedArray(0) }),
              }
            : null,
      };
    },
  });
  return requestedSources;
}

function formatByLabel(label: string): ExportFormat {
  const format = exportFormats.find((candidate) => candidate.label === label);
  if (!format) throw new Error(`Unknown export format: ${label}`);
  return format;
}

const PNG_FORMAT = formatByLabel('PNG');
const TIFF_FORMAT = formatByLabel('TIFF');

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PixelPayload {
  source: string;
  exported: string;
  mime?: string;
  threshold: number;
  tolerance: number;
}

interface LocatorSurface {
  click: Mock<() => Promise<void>>;
  fill: Mock<(value: string) => Promise<void>>;
  selectOption: Mock<(option: { label: string }) => Promise<string[]>>;
  first: Mock<() => LocatorSurface>;
  count: Mock<() => Promise<number>>;
  isVisible: Mock<() => Promise<boolean>>;
  textContent: Mock<() => Promise<string | null>>;
  boundingBox: Mock<() => Promise<Box | null>>;
  evaluate: Mock<(readPixels: (element: unknown) => string) => Promise<string>>;
  setInputFiles: Mock<(file: string) => Promise<void>>;
  or: Mock<(locator: LocatorSurface) => LocatorSurface>;
  nth: Mock<(index: number) => LocatorSurface>;
}

interface MouseSurface {
  move: Mock<(x: number, y: number, options?: { steps?: number }) => Promise<void>>;
  down: Mock<() => Promise<void>>;
  up: Mock<() => Promise<void>>;
}

interface DownloadSurface {
  failure: Mock<() => Promise<string | null>>;
  suggestedFilename: Mock<() => string>;
  saveAs: Mock<(target: string) => Promise<void>>;
}

interface PageSurface {
  goto: Mock<(url: string, options?: { waitUntil?: string; timeout?: number }) => Promise<null>>;
  getByTestId: Mock<(testId: string) => LocatorSurface>;
  getByRole: Mock<(role: string, options?: { name?: string | RegExp }) => LocatorSurface>;
  locator: Mock<(selector: string) => LocatorSurface>;
  waitForEvent: Mock<(event: string, options?: { timeout?: number }) => Promise<DownloadSurface>>;
  waitForFunction: Mock<
    (pageFunction: () => boolean, arg?: unknown, options?: { timeout?: number }) => Promise<unknown>
  >;
  evaluate: Mock<(compare: (payload: PixelPayload) => Promise<boolean>, payload: PixelPayload) => Promise<boolean>>;
  screenshot: Mock<(options?: { clip?: Box }) => Promise<Buffer>>;
  waitForTimeout: Mock<(timeout: number) => Promise<void>>;
  mouse: MouseSurface;
}

function asPlaywright<T extends object>(surface: object): T {
  return new Proxy({} as T, { get: (_target, property) => Reflect.get(surface, property) });
}

function createLocatorMock(overrides: Partial<LocatorSurface> = {}): LocatorSurface {
  const surface: LocatorSurface = {
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    first: vi.fn(),
    count: vi.fn().mockResolvedValue(1),
    isVisible: vi.fn().mockResolvedValue(true),
    textContent: vi.fn().mockResolvedValue(''),
    boundingBox: vi.fn().mockResolvedValue(null),
    evaluate: vi.fn().mockResolvedValue(SOURCE_DATA_URL),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
    or: vi.fn(),
    nth: vi.fn(),
    ...overrides,
  };
  surface.first.mockReturnValue(surface);
  surface.or.mockReturnValue(surface);
  surface.nth.mockReturnValue(surface);
  return surface;
}

function byKey(
  locators: Readonly<Record<string, LocatorSurface>>,
  fallback: LocatorSurface
): Mock<(key: string) => LocatorSurface> {
  return vi.fn((key: string) => locators[key] ?? fallback);
}

function byRole(
  locators: Readonly<Record<string, LocatorSurface>>,
  fallback: LocatorSurface
): Mock<(role: string, options?: { name?: string | RegExp }) => LocatorSurface> {
  return vi.fn(
    (role: string, options?: { name?: string | RegExp }) =>
      locators[`${role}:${String(options?.name ?? '')}`] ?? fallback
  );
}

async function strokePng(drawn: boolean): Promise<Buffer> {
  return sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: drawn ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();
}

function createPageMock(overrides: Partial<PageSurface> = {}): {
  surface: PageSurface;
  page: Page;
} {
  const fallback = createLocatorMock();
  const surface: PageSurface = {
    goto: vi.fn().mockResolvedValue(null),
    getByTestId: byKey({}, fallback),
    getByRole: byRole({}, fallback),
    locator: byKey({}, fallback),
    waitForEvent: vi.fn().mockRejectedValue(new Error('waitForEvent was not configured for this test')),
    waitForFunction: vi.fn().mockResolvedValue(true),
    evaluate: vi.fn().mockResolvedValue(true),
    screenshot: vi.fn(async () => strokePng(true)),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    mouse: {
      move: vi.fn().mockResolvedValue(undefined),
      down: vi.fn().mockResolvedValue(undefined),
      up: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
  return { surface, page: asPlaywright<Page>(surface) };
}

function createTestInfoMock(outputDir: string = OUTPUT_DIR): TestInfo {
  return asPlaywright<TestInfo>({ outputDir });
}

function createDownloadMock(suggestedFilename: string, failure: string | null = null): DownloadSurface {
  return {
    failure: vi.fn().mockResolvedValue(failure),
    suggestedFilename: vi.fn().mockReturnValue(suggestedFilename),
    saveAs: vi.fn().mockResolvedValue(undefined),
  };
}

function redrawClip(box: Box): Box {
  return {
    x: box.x + CANVAS_REDRAW_CLIP.x,
    y: box.y + CANVAS_REDRAW_CLIP.y,
    width: CANVAS_REDRAW_CLIP.width,
    height: CANVAS_REDRAW_CLIP.height,
  };
}

function pixelPayload(format: ExportFormat): PixelPayload {
  return {
    source: SOURCE_DATA_URL,
    exported: mocks.exportedFile.toString('base64'),
    mime: mimeType(format.extension),
    threshold: CHANGED_CHANNEL_THRESHOLD_GENERAL,
    tolerance: CHANNEL_DELTA_TOLERANCE,
  };
}

function isValidExportFormat(value: unknown): value is ExportFormat {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ExportFormat>;
  return (
    typeof candidate.label === 'string' &&
    candidate.label.length > 0 &&
    typeof candidate.extension === 'string' &&
    /^\.[a-z0-9]+$/i.test(candidate.extension) &&
    typeof candidate.comparePixels === 'boolean'
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Export Helpers', () => {
  const DECLARED_FORMATS: Array<[string, ExportFormat]> = [
    ['PNG', { label: 'PNG', extension: '.png', comparePixels: true }],
    ['JPEG', { label: 'JPEG', extension: '.jpeg', comparePixels: true }],
    ['WebP', { label: 'WebP', extension: '.webp', comparePixels: true }],
    ['TIFF', { label: 'TIFF', extension: '.tiff', comparePixels: false }],
    ['BMP', { label: 'BMP', extension: '.bmp', comparePixels: true }],
    ['GIF (static)', { label: 'GIF (static)', extension: '.gif', comparePixels: true }],
    ['AVIF', { label: 'AVIF', extension: '.avif', comparePixels: true }],
    ['SVG (flattened)', { label: 'SVG (flattened)', extension: '.svg', comparePixels: true }],
    ['Photoshop PSD (layers)', { label: 'Photoshop PSD (layers)', extension: '.psd', comparePixels: false }],
  ];

  const DECLARED_MIME_TYPES: Array<[string, string]> = [
    ['.png', 'image/png'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.avif', 'image/avif'],
    ['.ico', 'image/x-icon'],
    ['.svg', 'image/svg+xml'],
  ];

  describe('export constants', () => {
    // Literal pins: these numbers are the export contract, so drifting any of
    // them has to be a deliberate edit here as well as in helpers.ts.
    const CONSTANT_PINS: Array<[string, number, number]> = [
      ['CHANGED_CHANNEL_THRESHOLD_GENERAL', CHANGED_CHANNEL_THRESHOLD_GENERAL, 50_000],
      ['CHANGED_CHANNEL_THRESHOLD_ICO', CHANGED_CHANNEL_THRESHOLD_ICO, 20_000],
      ['CHANNEL_DELTA_TOLERANCE', CHANNEL_DELTA_TOLERANCE, 40],
      ['DOWNLOAD_TIMEOUT_MS', DOWNLOAD_TIMEOUT_MS, 30_000],
      ['INTEGRATION_TEST_TIMEOUT_MS', INTEGRATION_TEST_TIMEOUT_MS, 60_000],
    ];

    it.each(CONSTANT_PINS)('pins %s', (_name, value, pinned) => {
      expect(value).toBe(pinned);
    });

    it('pins the canvas redraw clip offsets', () => {
      expect(CANVAS_REDRAW_CLIP).toEqual({ x: 100, y: 100, width: 300, height: 100 });
    });

    it('pins the icon stroke offsets', () => {
      expect(ICON_STROKE).toEqual({ startX: 60, centerY: 128, endX: 196, steps: 10 });
    });
  });

  describe('exportFormats', () => {
    it.each(DECLARED_FORMATS)('declares %s with its extension and comparePixels flag', (_label, format) => {
      expect(exportFormats.find((candidate) => candidate.label === format.label)).toEqual(format);
    });

    it('declares label, extension and comparePixels on every format', () => {
      for (const format of exportFormats) {
        expect(format).toHaveProperty('label');
        expect(format).toHaveProperty('extension');
        expect(format).toHaveProperty('comparePixels');
        expect(typeof format.comparePixels).toBe('boolean');
      }
    });

    it('starts every extension with a dot', () => {
      for (const format of exportFormats) {
        expect(format.extension.startsWith('.')).toBe(true);
      }
    });

    it('exposes unique labels and extensions, with ICO kept out of the export list', () => {
      const labels = exportFormats.map((format) => format.label);
      const extensions = exportFormats.map((format) => format.extension);
      expect(new Set(labels).size).toBe(labels.length);
      expect(new Set(extensions).size).toBe(extensions.length);
      expect(new Set([...extensions, icoFormat.extension]).size).toBe(extensions.length + 1);
      expect(labels).not.toContain(icoFormat.label);
    });

    it('enables pixel comparison for exactly the formats the browser can decode', () => {
      const all = [...exportFormats, icoFormat];
      const decodable = all
        .filter((format) => mimeType(format.extension) !== OCTET_STREAM_MIME)
        .map((format) => format.label);
      const compared = all.filter((format) => format.comparePixels).map((format) => format.label);
      const skipped = all.filter((format) => !format.comparePixels).map((format) => format.label);
      expect(compared).toEqual(decodable);
      expect(skipped).toEqual(all.map((format) => format.label).filter((label) => !decodable.includes(label)));
      expect(decodable.length).toBeGreaterThan(0);
      expect(skipped.length).toBeGreaterThan(0);
    });

    it('every declared format satisfies the shape contract', () => {
      expect([...exportFormats, icoFormat].filter((format) => !isValidExportFormat(format))).toEqual([]);
    });
  });

  describe('icoFormat', () => {
    it('declares the ICO contract', () => {
      expect(icoFormat).toEqual({ label: 'ICO', extension: '.ico', comparePixels: true });
    });
  });

  describe('mimeType', () => {
    it.each(DECLARED_MIME_TYPES)('maps %s to %s', (extension, mime) => {
      expect(mimeType(extension)).toBe(mime);
    });

    it('resolves a well-formed image mime for every declared format the browser can decode', () => {
      for (const format of [...exportFormats, icoFormat]) {
        const mime = mimeType(format.extension);
        if (mime === OCTET_STREAM_MIME) continue;
        expect(mime).toMatch(/^image\/[a-z0-9.+-]+$/i);
      }
    });

    it('falls back to application/octet-stream for unknown extensions', () => {
      expect(mimeType('.unknown')).toBe('application/octet-stream');
      expect(mimeType('.xyz')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for an empty extension', () => {
      expect(mimeType('')).toBe('application/octet-stream');
    });

    it('ignores extension casing', () => {
      expect(mimeType('.PNG')).toBe('image/png');
      expect(mimeType('.JPEG')).toBe('image/jpeg');
      expect(mimeType('.Svg')).toBe('image/svg+xml');
      expect(mimeType('.ICO')).toBe('image/x-icon');
    });

    it('falls back to application/octet-stream without a leading dot', () => {
      expect(mimeType('png')).toBe('application/octet-stream');
      expect(mimeType('svg')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for tiff and psd', () => {
      expect(mimeType('.tiff')).toBe('application/octet-stream');
      expect(mimeType('.psd')).toBe('application/octet-stream');
    });

    it('falls back to application/octet-stream for absent input', () => {
      expect(mimeType(null)).toBe(OCTET_STREAM_MIME);
      expect(mimeType(undefined)).toBe(OCTET_STREAM_MIME);
    });

    it('falls back to application/octet-stream for a non-string at runtime', () => {
      expect(mimeType(123 as never)).toBe(OCTET_STREAM_MIME);
    });
  });

  describe('setupExportTest', () => {
    it('prepares the download directory, strokes the canvas and returns the source data url', async () => {
      const box: Box = { x: 64, y: 48, width: 512, height: 384 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
      });

      const result = await setupExportTest(page, createTestInfoMock());

      expect(surface.goto).toHaveBeenCalledWith('/', { waitUntil: 'domcontentloaded' });
      expect(vi.mocked(rm)).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true, force: true });
      expect(vi.mocked(mkdir)).toHaveBeenCalledWith(DOWNLOAD_DIRECTORY, { recursive: true });
      // The workspace canvas is found by test id only. A positional fallback would put
      // this locator on the Draw preview canvas or a hidden overlay depending on which
      // tool is active, so there is deliberately no `locator('canvas')` call here.
      expect(surface.getByTestId).toHaveBeenCalledWith('workspace-canvas');
      expect(surface.locator).not.toHaveBeenCalled();
      expect(mocks.mockExpect).toHaveBeenCalledWith(canvas);
      expect(drawTool.click).toHaveBeenCalled();
      expect(surface.mouse.move.mock.calls).toEqual([
        [box.x + LINE_START_X, box.y + LINE_START_Y],
        [box.x + LINE_END_X, box.y + LINE_END_Y],
      ]);
      expect(surface.mouse.down).toHaveBeenCalled();
      expect(surface.mouse.up).toHaveBeenCalled();
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
      expect(canvas.evaluate).toHaveBeenCalled();
      expect(result).toEqual({
        box,
        sourceDataUrl: SOURCE_DATA_URL,
        downloadDirectory: DOWNLOAD_DIRECTORY,
      });
    });

    it('offsets the stroke by the canvas box origin instead of fixed viewport coordinates', async () => {
      const box: Box = { x: 311, y: 197, width: 640, height: 480 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await setupExportTest(page, createTestInfoMock());

      const [start, end] = surface.mouse.move.mock.calls;
      expect(start).toEqual([box.x + LINE_START_X, box.y + LINE_START_Y]);
      expect(end).toEqual([box.x + LINE_END_X, box.y + LINE_END_Y]);
      // Literal pins: box-relative offsets of 150/150 -> 350/150, so hard-coding
      // viewport coordinates in the helper cannot satisfy this expectation.
      expect(start).toEqual([461, 347]);
      expect(end).toEqual([661, 347]);
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
    });

    it('polls the box-relative redraw region until the stroke reaches the backing store', async () => {
      const box: Box = { x: 12, y: 8, width: 500, height: 500 };
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
        screenshot: vi
          .fn()
          .mockResolvedValueOnce(await strokePng(false))
          .mockResolvedValue(await strokePng(true)),
      });

      await setupExportTest(page, createTestInfoMock());

      expect(surface.screenshot).toHaveBeenCalledTimes(2);
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
      // Literal pin: the polled region is the box-relative 100,100 300x100 clip.
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: { x: 112, y: 108, width: 300, height: 100 } });
      expect(surface.waitForTimeout).toHaveBeenCalledWith(CANVAS_REDRAW_POLL_INTERVAL_MS);
    });

    it('throws when the canvas has no bounding box', async () => {
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(null) });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await expect(setupExportTest(page, createTestInfoMock())).rejects.toThrow('Canvas not found');
      expect(surface.mouse.down).not.toHaveBeenCalled();
    });

    it('rejects without drawing when the workspace canvas is not visible', async () => {
      const box: Box = { x: 0, y: 0, width: 500, height: 500 };
      const canvas = createLocatorMock({
        boundingBox: vi.fn().mockResolvedValue(box),
        isVisible: vi.fn().mockResolvedValue(false),
      });
      const drawTool = createLocatorMock();
      const { surface, page } = createPageMock({
        getByTestId: byKey({ 'workspace-canvas': canvas, 'tool-button-draw': drawTool }, canvas),
        locator: byKey({ canvas }, canvas),
      });

      await expect(setupExportTest(page, createTestInfoMock())).rejects.toThrow(/visible/);
      expect(drawTool.click).not.toHaveBeenCalled();
      expect(surface.mouse.move).not.toHaveBeenCalled();
    });
  });

  describe('exportAndVerify', () => {
    function createSaveDialogPage(
      options: {
        download?: DownloadSurface;
        headingCount?: number;
        evaluate?: PageSurface['evaluate'];
      } = {}
    ): { surface: PageSurface; page: Page; dialog: Record<string, LocatorSurface>; download: DownloadSurface } {
      const fileMenuButton = createLocatorMock();
      const saveMenuButton = createLocatorMock();
      const filenameInput = createLocatorMock();
      const formatSelect = createLocatorMock();
      const submitButton = createLocatorMock();
      const heading = createLocatorMock({ count: vi.fn().mockResolvedValue(options.headingCount ?? 0) });
      const download = options.download ?? createDownloadMock(`${EXPORT_FILENAME}${PNG_FORMAT.extension}`);
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-save-button': saveMenuButton,
            'save-dialog-filename-input': filenameInput,
            'save-dialog-format-select': formatSelect,
            'save-dialog-submit-button': submitButton,
          },
          fileMenuButton
        ),
        getByRole: byRole({ 'heading:Save File As...': heading }, heading),
        waitForEvent: vi.fn().mockResolvedValue(download),
        ...(options.evaluate ? { evaluate: options.evaluate } : {}),
      });
      return {
        surface,
        page,
        dialog: { fileMenuButton, saveMenuButton, filenameInput, formatSelect, submitButton, heading },
        download,
      };
    }

    it('saves the export, confirms the dialog closed and compares the pixels', async () => {
      const { surface, page, dialog, download } = createSaveDialogPage();
      const target = path.join(DOWNLOAD_DIRECTORY, `${EXPORT_FILENAME}${PNG_FORMAT.extension}`);

      const result = await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());

      expect(dialog.fileMenuButton.click).toHaveBeenCalled();
      expect(dialog.saveMenuButton.click).toHaveBeenCalled();
      expect(dialog.filenameInput.fill).toHaveBeenCalledWith(EXPORT_FILENAME);
      expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: PNG_FORMAT.label });
      expect(dialog.submitButton.click).toHaveBeenCalled();
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS_LITERAL });
      expect(mocks.matchers.toBeNull).toHaveBeenCalled();
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(PNG_FORMAT.extension);
      expect(download.saveAs).toHaveBeenCalledWith(target);
      expect(mocks.mockExpect).toHaveBeenCalledWith(dialog.heading);
      expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(0);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
      expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
      expect(surface.evaluate).toHaveBeenCalledTimes(1);
      const [compare, payload] = surface.evaluate.mock.calls[0];
      expect(typeof compare).toBe('function');
      expect(payload).toEqual(pixelPayload(PNG_FORMAT));
      expect(payload.mime).toBe('image/png');
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(true);
      expect(result).toBe(target);
    });

    it.each([
      ['accepts an identical export', IDENTICAL_EXPORT, true],
      ['rejects an export shifted by half its width', SHIFTED_EXPORT, false],
      ['accepts an export differing by exactly the per-channel tolerance', WITHIN_TOLERANCE_EXPORT, true],
      ['accepts an export differing only in the alpha channel', ALPHA_ONLY_EXPORT, true],
    ])('pixel comparator %s', async (_label, exported, expected) => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_PNG_DATA_URL]: exported,
      });

      await expect(compare(payload)).resolves.toBe(expected);
    });

    it('pixel comparator decodes the export with the format mime type', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      const requestedSources = stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_PNG_DATA_URL]: IDENTICAL_EXPORT,
      });

      await expect(compare(payload)).resolves.toBe(true);
      expect(requestedSources).toEqual([SOURCE_DATA_URL, EXPORTED_PNG_DATA_URL]);
    });

    it('pixel comparator reports a mismatch when the canvas context is unavailable', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment(
        { [SOURCE_DATA_URL]: IDENTICAL_EXPORT, [EXPORTED_PNG_DATA_URL]: IDENTICAL_EXPORT },
        { contextAvailable: false }
      );

      await expect(compare(payload)).resolves.toBe(false);
    });

    it('pixel comparator rejects when the export cannot be decoded', async () => {
      const { surface, page } = createSaveDialogPage();
      await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());
      const [compare, payload] = surface.evaluate.mock.calls[0];

      stubCompareEnvironment({ [SOURCE_DATA_URL]: IDENTICAL_EXPORT });

      await expect(compare(payload)).rejects.toThrow('Browser cannot decode exported image');
    });

    it('accepts a download whose suggested file name uses upper-case extension characters', async () => {
      const upperCaseName = `${EXPORT_FILENAME}.PNG`;
      const { page } = createSaveDialogPage({ download: createDownloadMock(upperCaseName) });

      const result = await exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock());

      expect(mocks.matchers.toBe).toHaveBeenCalledWith(PNG_FORMAT.extension);
      expect(result).toBe(path.join(DOWNLOAD_DIRECTORY, upperCaseName));
    });

    it('skips the browser pixel comparison for formats that are not re-encoded', async () => {
      const download = createDownloadMock(`${EXPORT_FILENAME}${TIFF_FORMAT.extension}`);
      const { surface, page, dialog } = createSaveDialogPage({ download });
      const target = path.join(DOWNLOAD_DIRECTORY, `${EXPORT_FILENAME}${TIFF_FORMAT.extension}`);

      const result = await exportAndVerify(
        page,
        TIFF_FORMAT,
        SOURCE_DATA_URL,
        DOWNLOAD_DIRECTORY,
        createTestInfoMock()
      );

      expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: TIFF_FORMAT.label });
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(TIFF_FORMAT.extension);
      expect(download.saveAs).toHaveBeenCalledWith(target);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
      expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
      expect(surface.evaluate).not.toHaveBeenCalled();
      expect(result).toBe(target);
    });

    it('rejects when the save dialog is still open after submitting', async () => {
      const { page, download } = createSaveDialogPage({ headingCount: 1 });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('expected count 0, received 1');

      expect(download.saveAs).toHaveBeenCalled();
    });

    it('rejects without touching the filesystem when the download never arrives', async () => {
      const { surface, page, dialog, download } = createSaveDialogPage();
      surface.waitForEvent.mockRejectedValue(new Error('download event timed out'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('download event timed out');

      expect(dialog.submitButton.click).toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects without saving when the browser reports a download failure', async () => {
      const { page, download } = createSaveDialogPage({
        download: createDownloadMock(`${EXPORT_FILENAME}${PNG_FORMAT.extension}`, 'canceled'),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: download failed`);

      expect(download.saveAs).not.toHaveBeenCalled();
      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects when the downloaded file does not carry the format extension', async () => {
      const { page, download } = createSaveDialogPage({
        download: createDownloadMock(`${EXPORT_FILENAME}.jpg`),
      });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`expected ${JSON.stringify(PNG_FORMAT.extension)}`);

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the browser reports no filename for the download', async () => {
      const { page, download } = createSaveDialogPage({ download: createDownloadMock('') });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`expected ${JSON.stringify(PNG_FORMAT.extension)}, received ""`);

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the save dialog exposes no filename field', async () => {
      const { page, dialog, download } = createSaveDialogPage();
      dialog.filenameInput.fill.mockRejectedValue(new Error('filename input is missing'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('filename input is missing');

      expect(dialog.submitButton.click).not.toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects before downloading when the format argument is missing', async () => {
      const { surface, page, download } = createSaveDialogPage();
      const missingFormat: ExportFormat | undefined = undefined;

      await expect(
        exportAndVerify(page, missingFormat!, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(TypeError);

      expect(surface.waitForEvent).not.toHaveBeenCalled();
      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects without reading the file when saving the download fails', async () => {
      const { page, download } = createSaveDialogPage();
      download.saveAs.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow('EACCES: permission denied');

      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects when the exported file is empty', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.alloc(0));
      const { page, download } = createSaveDialogPage();

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label} file should not be empty`);

      expect(download.saveAs).toHaveBeenCalled();
    });

    it('rejects when the exported pixels differ from the source', async () => {
      const { page } = createSaveDialogPage({ evaluate: vi.fn().mockResolvedValue(false) });

      await expect(
        exportAndVerify(page, PNG_FORMAT, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY, createTestInfoMock())
      ).rejects.toThrow(`${PNG_FORMAT.label}: pixels differ too much from source`);
    });
  });

  describe('setupIcoTest', () => {
    function createIcoPage(box: Box | null): {
      surface: PageSurface;
      page: Page;
      newImage: Record<string, LocatorSurface>;
      canvas: LocatorSurface;
    } {
      const fileMenuButton = createLocatorMock();
      const newImageButton = createLocatorMock();
      const widthInput = createLocatorMock();
      const heightInput = createLocatorMock();
      const newImageSubmit = createLocatorMock();
      const drawTool = createLocatorMock();
      const canvas = createLocatorMock({ boundingBox: vi.fn().mockResolvedValue(box) });
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-new-button': newImageButton,
            'new-image-width-input': widthInput,
            'new-image-height-input': heightInput,
            'new-image-dialog-submit-button': newImageSubmit,
            'workspace-canvas': canvas,
            'tool-button-draw': drawTool,
          },
          canvas
        ),
        locator: byKey({ canvas }, canvas),
      });
      return {
        surface,
        page,
        newImage: { fileMenuButton, newImageButton, widthInput, heightInput, newImageSubmit },
        canvas,
      };
    }

    it('creates a 256px icon canvas, strokes it with the icon stroke offsets and returns the data url', async () => {
      const box: Box = { x: 24, y: 36, width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const { surface, page, newImage, canvas } = createIcoPage(box);

      const result = await setupIcoTest(page);

      expect(surface.goto).toHaveBeenCalledWith('/', { waitUntil: 'domcontentloaded' });
      expect(newImage.fileMenuButton.click).toHaveBeenCalled();
      expect(newImage.newImageButton.click).toHaveBeenCalled();
      expect(newImage.widthInput.fill).toHaveBeenCalledWith(String(ICON_CANVAS_SIZE));
      expect(newImage.heightInput.fill).toHaveBeenCalledWith(String(ICON_CANVAS_SIZE));
      expect(newImage.newImageSubmit.click).toHaveBeenCalled();
      expect(mocks.mockExpect).toHaveBeenCalledWith(canvas);
      expect(surface.mouse.move.mock.calls).toEqual([
        [box.x + ICON_STROKE.startX, box.y + ICON_STROKE.centerY],
        [box.x + ICON_STROKE.endX, box.y + ICON_STROKE.centerY, { steps: ICON_STROKE.steps }],
      ]);
      expect(surface.mouse.down).toHaveBeenCalled();
      expect(surface.mouse.up).toHaveBeenCalled();
      expect(surface.screenshot).toHaveBeenCalledWith({ clip: redrawClip(box) });
      expect(canvas.evaluate).toHaveBeenCalled();
      expect(result).toBe(SOURCE_DATA_URL);
    });

    it('strokes at the icon stroke offsets rather than the canvas box centre', async () => {
      const box: Box = { x: 10, y: 20, width: 512, height: 400 };
      const { surface, page } = createIcoPage(box);

      await setupIcoTest(page);

      expect(surface.mouse.move.mock.calls).toEqual([
        [box.x + ICON_STROKE.startX, box.y + ICON_STROKE.centerY],
        [box.x + ICON_STROKE.endX, box.y + ICON_STROKE.centerY, { steps: ICON_STROKE.steps }],
      ]);
      expect(surface.mouse.move.mock.calls[0][1]).not.toBe(box.y + box.height / 2);
      expect(surface.mouse.move.mock.calls[1][1]).not.toBe(box.y + box.height / 2);
    });

    it('throws when the icon canvas has no bounding box', async () => {
      const { surface, page } = createIcoPage(null);

      await expect(setupIcoTest(page)).rejects.toThrow('ICO canvas not found');
      expect(surface.mouse.down).not.toHaveBeenCalled();
    });

    it('rejects without drawing when the icon canvas is not visible', async () => {
      const box: Box = { x: 0, y: 0, width: ICON_CANVAS_SIZE, height: ICON_CANVAS_SIZE };
      const { surface, page, canvas } = createIcoPage(box);
      canvas.isVisible.mockResolvedValue(false);

      await expect(setupIcoTest(page)).rejects.toThrow(/visible/);
      expect(surface.mouse.move).not.toHaveBeenCalled();
    });
  });

  describe('exportIcoAndVerify', () => {
    function createIcoExportPage(
      options: {
        failure?: string | null;
        evaluate?: PageSurface['evaluate'];
      } = {}
    ): { surface: PageSurface; page: Page; dialog: Record<string, LocatorSurface>; download: DownloadSurface } {
      const fileMenuButton = createLocatorMock();
      const saveMenuButton = createLocatorMock();
      const filenameInput = createLocatorMock();
      const formatSelect = createLocatorMock();
      const submitButton = createLocatorMock();
      const download = createDownloadMock(`${ICON_EXPORT_FILENAME}${icoFormat.extension}`, options.failure ?? null);
      const { surface, page } = createPageMock({
        getByTestId: byKey(
          {
            'header-file-menu-button': fileMenuButton,
            'header-file-save-button': saveMenuButton,
            'save-dialog-filename-input': filenameInput,
            'save-dialog-format-select': formatSelect,
            'save-dialog-submit-button': submitButton,
          },
          fileMenuButton
        ),
        waitForEvent: vi.fn().mockResolvedValue(download),
        ...(options.evaluate ? { evaluate: options.evaluate } : {}),
      });
      return {
        surface,
        page,
        dialog: { fileMenuButton, saveMenuButton, filenameInput, formatSelect, submitButton },
        download,
      };
    }

    it('saves the ICO export and compares it with the ICO pixel threshold', async () => {
      const { surface, page, dialog, download } = createIcoExportPage();
      const target = path.join(DOWNLOAD_DIRECTORY, `${ICON_EXPORT_FILENAME}${icoFormat.extension}`);

      const result = await exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY);

      expect(dialog.fileMenuButton.click).toHaveBeenCalled();
      expect(dialog.saveMenuButton.click).toHaveBeenCalled();
      expect(dialog.filenameInput.fill).toHaveBeenCalledWith(ICON_EXPORT_FILENAME);
      expect(dialog.formatSelect.selectOption).toHaveBeenCalledWith({ label: icoFormat.label });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS });
      expect(surface.waitForEvent).toHaveBeenCalledWith('download', { timeout: DOWNLOAD_TIMEOUT_MS_LITERAL });
      expect(mocks.matchers.toBe).toHaveBeenCalledWith(icoFormat.extension);
      expect(download.saveAs).toHaveBeenCalledWith(target);
      expect(vi.mocked(readFile)).toHaveBeenCalledWith(target);
      expect(mocks.matchers.toBeGreaterThan).toHaveBeenCalledWith(MIN_EXPORT_BYTES);
      expect(surface.evaluate).toHaveBeenCalledTimes(1);
      const [compare, payload] = surface.evaluate.mock.calls[0];
      expect(typeof compare).toBe('function');
      expect(payload).toEqual({
        source: SOURCE_DATA_URL,
        exported: EXPORTED_BASE64,
        threshold: CHANGED_CHANNEL_THRESHOLD_ICO,
        tolerance: CHANNEL_DELTA_TOLERANCE,
      });
      expect(result).toBe(target);
    });

    it.each([
      ['accepts an identical icon', IDENTICAL_EXPORT, true],
      ['rejects an icon shifted by half its width', SHIFTED_EXPORT, false],
    ])('ICO pixel comparator %s', async (_label, exported, expected) => {
      const { surface, page } = createIcoExportPage();
      await exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY);
      const [compare, payload] = surface.evaluate.mock.calls[0];

      const requestedSources = stubCompareEnvironment({
        [SOURCE_DATA_URL]: IDENTICAL_EXPORT,
        [EXPORTED_ICO_DATA_URL]: exported,
      });

      await expect(compare(payload)).resolves.toBe(expected);
      expect(requestedSources).toEqual([SOURCE_DATA_URL, EXPORTED_ICO_DATA_URL]);
    });

    it('rejects without saving when the ICO download failed', async () => {
      const { page, download } = createIcoExportPage({ failure: 'canceled' });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY)).rejects.toThrow(
        `${icoFormat.label}: download failed`
      );

      expect(download.saveAs).not.toHaveBeenCalled();
    });

    it('rejects when the saved ICO file is empty', async () => {
      vi.mocked(readFile).mockResolvedValueOnce(Buffer.alloc(0));
      const { page } = createIcoExportPage();

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY)).rejects.toThrow(
        'ICO file should not be empty'
      );
    });

    it('rejects without reading the file when saving the ICO download fails', async () => {
      const { page, download } = createIcoExportPage();
      download.saveAs.mockRejectedValue(new Error('ENOSPC: no space left on device'));

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY)).rejects.toThrow(
        'ENOSPC: no space left on device'
      );

      expect(vi.mocked(readFile)).not.toHaveBeenCalled();
    });

    it('rejects when the ICO pixels differ from the source', async () => {
      const { page } = createIcoExportPage({ evaluate: vi.fn().mockResolvedValue(false) });

      await expect(exportIcoAndVerify(page, SOURCE_DATA_URL, DOWNLOAD_DIRECTORY)).rejects.toThrow(
        'ICO: pixels differ too much from source'
      );
    });
  });

  describe('verifyPsdInPhotopea', () => {
    function createPhotopeaPage(options: { bodyText?: string } = {}): {
      surface: PageSurface;
      page: Page;
      startButton: LocatorSurface;
      fileInput: LocatorSurface;
      body: LocatorSurface;
    } {
      const startButton = createLocatorMock();
      const fileInput = createLocatorMock();
      const body = createLocatorMock({
        textContent: vi.fn().mockResolvedValue(options.bodyText ?? PHOTOPEA_BODY_WITH_EXPORT),
      });
      const { surface, page } = createPageMock({
        getByRole: byRole({ 'button:Start using Photopea': startButton }, startButton),
        locator: byKey({ 'input[type="file"]': fileInput, body }, fileInput),
      });
      return { surface, page, startButton, fileInput, body };
    }

    it('opens Photopea, starts the editor, uploads the PSD and verifies the file name', async () => {
      const { surface, page, startButton, fileInput, body } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.goto).toHaveBeenCalledWith(PHOTOPEA_URL, {
        waitUntil: 'domcontentloaded',
        timeout: PHOTOPEA_NAVIGATION_TIMEOUT_MS,
      });
      expect(startButton.click).toHaveBeenCalled();
      expect(surface.waitForFunction).toHaveBeenCalled();
      expect(surface.locator).toHaveBeenCalledWith('input[type="file"]');
      expect(mocks.mockExpect).toHaveBeenCalledWith(fileInput);
      expect(mocks.matchers.toHaveCount).toHaveBeenCalledWith(1);
      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
      expect(mocks.mockExpect).toHaveBeenCalledWith(body);
      expect(mocks.matchers.toContainText).toHaveBeenCalledWith(EXPORT_FILENAME, {
        timeout: PHOTOPEA_EXPORT_VISIBLE_TIMEOUT_MS,
      });
      expect(body.textContent).toHaveBeenCalled();
    });

    it('passes the readiness budgets as waitForFunction options, not as the evaluation argument', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.waitForFunction).toHaveBeenCalledTimes(2);
      const [[, readyArg, readyOptions], [, apiArg, apiOptions]] = surface.waitForFunction.mock.calls;
      expect(readyArg).toBeUndefined();
      expect(readyOptions).toEqual({ timeout: CANVAS_READY_TIMEOUT_MS });
      expect(apiArg).toBeUndefined();
      expect(apiOptions).toEqual({ timeout: PHOTOPEA_API_TIMEOUT_MS });
    });

    it('accepts an editor canvas above the minimum size and rejects anything smaller', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      const [readyWhenCanvasIsLarge] = surface.waitForFunction.mock.calls[0];
      vi.stubGlobal('document', { querySelectorAll: () => [{ width: 512, height: 512 }] });
      expect(readyWhenCanvasIsLarge()).toBe(true);
      vi.stubGlobal('document', { querySelectorAll: () => [{ width: 512, height: 64 }] });
      expect(readyWhenCanvasIsLarge()).toBe(false);
      vi.stubGlobal('document', { querySelectorAll: () => [] });
      expect(readyWhenCanvasIsLarge()).toBe(false);
    });

    it('accepts the internal api from either the pea global or the app marker element', async () => {
      const { surface, page } = createPhotopeaPage();

      await verifyPsdInPhotopea(page, PSD_PATH);

      const [readyWhenApiIsExposed] = surface.waitForFunction.mock.calls[1];
      vi.stubGlobal('window', { pea: {} });
      vi.stubGlobal('document', { querySelector: () => null });
      expect(readyWhenApiIsExposed()).toBe(true);
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { querySelector: () => ({}) });
      expect(readyWhenApiIsExposed()).toBe(true);
      vi.stubGlobal('window', {});
      vi.stubGlobal('document', { querySelector: () => null });
      expect(readyWhenApiIsExposed()).toBe(false);
    });

    it('tolerates a Photopea build that never exposes its internal api', async () => {
      const { surface, page, fileInput, body } = createPhotopeaPage();
      surface.waitForFunction
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error('waitForFunction: Timeout 10000ms exceeded'));

      await verifyPsdInPhotopea(page, PSD_PATH);

      expect(surface.waitForFunction).toHaveBeenCalledTimes(2);
      expect(fileInput.setInputFiles).toHaveBeenCalledWith(PSD_PATH);
      expect(body.textContent).toHaveBeenCalled();
    });

    it('rejects without starting the editor when the Photopea page fails to load', async () => {
      const { surface, page, startButton, fileInput } = createPhotopeaPage();
      surface.goto.mockRejectedValue(new Error('net::ERR_CONNECTION_REFUSED'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('net::ERR_CONNECTION_REFUSED');

      expect(startButton.click).not.toHaveBeenCalled();
      expect(fileInput.setInputFiles).not.toHaveBeenCalled();
    });

    it('rejects without uploading when the editor canvas never appears', async () => {
      const { surface, page, fileInput } = createPhotopeaPage();
      surface.waitForFunction.mockRejectedValueOnce(new Error('waitForFunction: Timeout 60000ms exceeded'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('waitForFunction: Timeout 60000ms exceeded');

      expect(fileInput.setInputFiles).not.toHaveBeenCalled();
    });

    it('rejects when the PSD upload fails', async () => {
      const { page, fileInput, body } = createPhotopeaPage();
      fileInput.setInputFiles.mockRejectedValue(new Error('ENOENT: no such file or directory'));

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow('ENOENT: no such file or directory');

      expect(body.textContent).not.toHaveBeenCalled();
    });

    it('rejects when the loaded document does not show the exported file name', async () => {
      const { page } = createPhotopeaPage({ bodyText: PHOTOPEA_BODY_WITHOUT_EXPORT });

      await expect(verifyPsdInPhotopea(page, PSD_PATH)).rejects.toThrow(/toContainText/);
    });
  });
});
