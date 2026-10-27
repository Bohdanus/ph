import { vi, type Mock } from 'vitest';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Locator, Mouse, Page, TestInfo } from '@playwright/test';
import { loadImageData, type CaptureRegion, type ClipOptions, type ImageDataResult } from '../canvas-helpers';

export interface Color {
  red: number;
  green: number;
  blue: number;
}

export const RED: Color = { red: 255, green: 0, blue: 0 };
export const GREEN: Color = { red: 0, green: 255, blue: 0 };
export const BLUE: Color = { red: 0, green: 0, blue: 255 };
export const BLACK: Color = { red: 0, green: 0, blue: 0 };
export const WHITE: Color = { red: 255, green: 255, blue: 255 };
export const DARK_GRAY: Color = { red: 10, green: 10, blue: 10 };
export const CYAN: Color = { red: 0, green: 255, blue: 255 };
export const SPRAY_GRAY: Color = { red: 210, green: 210, blue: 210 };

export const OPAQUE = 255;
export const TRANSPARENT = 0;

/** Single-flat-colour PNG; the only place sharp image creation happens in these tests. */
export async function createTestImage(color: Color, width = 50, height = 50, alpha = 1): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: color.red, g: color.green, b: color.blue, alpha },
    },
  })
    .png()
    .toBuffer();
}

export async function createTestImageData(color: Color, width = 50, height = 50, alpha = 1): Promise<ImageDataResult> {
  return loadImageData(await createTestImage(color, width, height, alpha));
}

/** Fully transparent RGBA buffer: every channel zero, which the helpers read as "no pixel". */
export function createImageData(width: number, height: number): ImageDataResult {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

export function setPixel(image: ImageDataResult, x: number, y: number, color: Color, alpha = OPAQUE): void {
  const index = (y * image.width + x) * 4;
  image.data[index] = color.red;
  image.data[index + 1] = color.green;
  image.data[index + 2] = color.blue;
  image.data[index + 3] = alpha;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function fillRect(image: ImageDataResult, rect: Rect, color: Color, alpha = OPAQUE): void {
  for (let y = rect.top; y <= rect.bottom; y++) {
    for (let x = rect.left; x <= rect.right; x++) {
      setPixel(image, x, y, color, alpha);
    }
  }
}

export function fillAll(image: ImageDataResult, color: Color, alpha = OPAQUE): void {
  fillRect(image, { left: 0, top: 0, right: image.width - 1, bottom: image.height - 1 }, color, alpha);
}

/**
 * The region a capture of `image` at CSS scale was taken over: one CSS pixel per image
 * pixel, so the capture scale every helper derives from it is exactly 1.
 */
export function captureRegionOf(image: ImageDataResult): CaptureRegion {
  return { width: image.width, height: image.height };
}

/**
 * The same physical pixels as a capture of the region `captureRegionOf` would name, at
 * `scale` device pixels per CSS pixel.
 *
 * An integral-scale capture replicates every source pixel into a `scale x scale` block and
 * invents no colours, which is what doubling the pixel density of a stroke actually looks
 * like to a classifier. What it does reproduce is the defect this models: every gap and
 * every spread in the result is now `scale` times larger in capture pixels while the CSS
 * geometry underneath is unchanged, so a classifier that compares the two without scaling
 * reaches a different verdict at 2x than at 1x.
 */
export function captureAtScale(image: ImageDataResult, scale: number): ImageDataResult {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error(`captureAtScale: the scale has to be a positive integer, got ${scale}`);
  }
  const scaled: ImageDataResult = {
    width: image.width * scale,
    height: image.height * scale,
    data: new Uint8ClampedArray(image.width * image.height * scale * scale * 4),
  };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const from = (y * image.width + x) * 4;
          const to = ((y * scale + dy) * scaled.width + x * scale + dx) * 4;
          scaled.data[to] = image.data[from];
          scaled.data[to + 1] = image.data[from + 1];
          scaled.data[to + 2] = image.data[from + 2];
          scaled.data[to + 3] = image.data[from + 3];
        }
      }
    }
  }
  return scaled;
}

export type MoveSpy = Mock<(x: number, y: number, options?: { steps?: number }) => Promise<void>>;
export type ButtonSpy = Mock<() => Promise<void>>;

export interface MouseMock {
  mouse: Mouse;
  move: MoveSpy;
  down: ButtonSpy;
  up: ButtonSpy;
}

export function createMouseMock(): MouseMock {
  const move: MoveSpy = vi.fn().mockResolvedValue(undefined);
  const down: ButtonSpy = vi.fn().mockResolvedValue(undefined);
  const up: ButtonSpy = vi.fn().mockResolvedValue(undefined);
  // The `Partial<T>` annotation is the real type check here (it rejects keys the real
  // interface does not have); the `as T` cast below it is unchecked, so keep both.
  const double: Partial<Mouse> = { move, down, up };
  return { mouse: double as Mouse, move, down, up };
}

export function createPageMock(overrides: Partial<Page> = {}): Page {
  const double: Partial<Page> = { ...overrides };
  // The helpers read the window before they read the canvas, so a double without
  // `evaluate` is not a Page they can run against. The default answers from a window that
  // holds its whole page at scroll 0, which is the geometry every pre-existing capture test
  // assumes; a test that cares about scrolling passes its own.
  double.evaluate ??= createScrollModel().evaluate;
  return double as Page;
}

export type ScreenshotOptions = { path: string; clip: { x: number; y: number; width: number; height: number } };
export type ScreenshotSpy = Mock<(options: ScreenshotOptions) => Promise<Buffer>>;

export function createScreenshotSpy(result: Buffer): ScreenshotSpy {
  return vi.fn<(options: ScreenshotOptions) => Promise<Buffer>>().mockResolvedValue(result);
}

export interface ScrollGeometry {
  /** `window.innerHeight` / `window.innerWidth`. */
  viewportHeight?: number;
  viewportWidth?: number;
  /** `document.documentElement.scrollHeight` — the page's full height. */
  documentHeight?: number;
  initialScrollX?: number;
  initialScrollY?: number;
}

export interface ScrollModel {
  evaluate: Mock<Page['evaluate']>;
  scrollX: () => number;
  scrollY: () => number;
  /** Every `window.scrollTo` the code under test asked for, in order. */
  scrollRequests: () => Array<{ x: number; y: number }>;
}

/**
 * A `page.evaluate` that runs the helper's OWN page function against a stubbed window, so
 * the assertions are made on the callback rather than on a value the double chose to hand
 * back — the same idiom as `createRunningEvaluate` in cdp-helpers.unit.test.ts. The window
 * reports its scroll through getters, so a `scrollTo` issued by one call is visible to the
 * next, and the globals are stubbed for the duration of the call only, so a test that sets
 * up its own never sees them leak into the next.
 */
export function createScrollModel(geometry: ScrollGeometry = {}): ScrollModel {
  const viewportHeight = geometry.viewportHeight ?? 1080;
  const viewportWidth = geometry.viewportWidth ?? 1280;
  const documentHeight = geometry.documentHeight ?? viewportHeight;
  const scroll = { x: geometry.initialScrollX ?? 0, y: geometry.initialScrollY ?? 0 };
  const requests: Array<{ x: number; y: number }> = [];

  const evaluate = vi.fn(async (pageFunction: (arg?: unknown) => unknown, arg?: unknown) => {
    vi.stubGlobal('window', {
      innerWidth: viewportWidth,
      innerHeight: viewportHeight,
      get scrollX(): number {
        return scroll.x;
      },
      get scrollY(): number {
        return scroll.y;
      },
      scrollTo: (x: number, y: number): void => {
        scroll.x = x;
        scroll.y = y;
        requests.push({ x, y });
      },
    });
    vi.stubGlobal('document', { documentElement: { scrollHeight: documentHeight } });
    try {
      return pageFunction(arg);
    } finally {
      vi.unstubAllGlobals();
    }
  }) as unknown as Mock<Page['evaluate']>;

  return {
    evaluate,
    scrollX: () => scroll.x,
    scrollY: () => scroll.y,
    scrollRequests: () => requests,
  };
}

export interface ScrollablePage {
  page: Page;
  screenshot: ScreenshotSpy;
  scroll: ScrollModel;
  /** Clips handed to `page.screenshot`, in call order. */
  clips: () => Required<ClipOptions>[];
}

/**
 * A page whose window scrolls. The default geometry is a window tall enough to hold its
 * whole page at scroll 0, so a clip is already on screen unless a test says otherwise —
 * that is the case every pre-existing capture test is written against, and it is what
 * keeps them reading the clip they passed in.
 */
export function createScrollablePage(
  options: ScrollGeometry & {
    result?: Buffer;
    waitForTimeout?: Mock<(ms: number) => Promise<void>>;
  } = {}
): ScrollablePage {
  const screenshot = createScreenshotSpy(options.result ?? Buffer.from('fake-png-data'));
  const waitForTimeout = options.waitForTimeout ?? vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  const scroll = createScrollModel(options);
  const page = createPageMock({ screenshot, waitForTimeout, evaluate: scroll.evaluate });
  return {
    page,
    screenshot,
    scroll,
    clips: () => screenshot.mock.calls.map(([screenshotOptions]) => screenshotOptions.clip),
  };
}

export interface AttachOptions {
  path?: string;
  body?: string | Buffer;
  contentType?: string;
}
export type AttachSpy = Mock<(name: string, options: AttachOptions) => Promise<void>>;

export interface TestInfoMock {
  testInfo: TestInfo;
  attach: AttachSpy;
}

/**
 * A `TestInfo` double, with an `attach` spy that resolves.
 *
 * `outputDir` is OPTIONAL on purpose, and required would be wrong: a no-argument call is
 * the only way to build the double every `outputDir` guard is written against — a
 * `TestInfo` that carries no usable directory — and both helpers that guard it pin that
 * case this way, `takeLineScreenshot` in `canvas-interaction.unit.test.ts` and
 * `captureCanvasScreenshot` in `cdp-helpers.unit.test.ts`. Making the parameter required
 * does not make those tests stricter, it makes them unwriteable: `tsc -b` then fails on
 * the no-argument call in `canvas-interaction.unit.test.ts` with `Expected 1 arguments,
 * but got 0`, which is a fixture change reaching outside the file that made it.
 */
export function createTestInfoMock(outputDir?: string): TestInfoMock {
  const attach: AttachSpy = vi
    .fn<(name: string, options: AttachOptions) => Promise<void>>()
    .mockResolvedValue(undefined);
  const double: Partial<TestInfo> = { attach };
  if (outputDir !== undefined) double.outputDir = outputDir;
  return { testInfo: double as TestInfo, attach };
}

let tempRoot: string | undefined;

export async function makeOutputDir(name: string): Promise<string> {
  tempRoot ??= await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-helpers-'));
  return path.join(tempRoot, name);
}

export async function cleanupTempDirs(): Promise<void> {
  if (tempRoot === undefined) return;
  const root = tempRoot;
  tempRoot = undefined;
  await fs.rm(root, { recursive: true, force: true });
}

export interface FakeElement {
  selector: string;
  testId?: string;
}

export function canvasElement(testId?: string): FakeElement {
  return testId === undefined ? { selector: 'canvas' } : { selector: 'canvas', testId };
}

const locatorCandidates = new WeakMap<Locator, () => FakeElement[]>();

/**
 * Minimal locator model over a fixed element list: `getByTestId`/`locator` filter,
 * `nth` selects one candidate, `or` returns the UNION of both sides rather than a
 * priority. `or` is modelled here only so a test can pin that union; no helper
 * should reach for it to mean "prefer".
 */
function fakeLocator(candidates: () => FakeElement[]): Locator {
  const double: Partial<Locator> = {
    getByTestId: (id: string) => fakeLocator(() => candidates().filter((el) => el.testId === id)),
    locator: (selector: string) => fakeLocator(() => candidates().filter((el) => el.selector === selector)),
    nth: (index: number) => fakeLocator(() => candidates().slice(index, index + 1)),
    or: (other: Locator) => {
      const otherCandidates = locatorCandidates.get(other);
      return fakeLocator(() => [...candidates(), ...(otherCandidates ? otherCandidates() : [])]);
    },
  };
  const locator = double as Locator;
  locatorCandidates.set(locator, candidates);
  return locator;
}

export function createFakePage(dom: FakeElement[]): Page {
  return createPageMock({
    getByTestId: (id: string) => fakeLocator(() => dom.filter((el) => el.testId === id)),
    locator: (selector: string) => fakeLocator(() => dom.filter((el) => el.selector === selector)),
  });
}

/**
 * Every element the locator matches, in the double's resolution order.
 *
 * This returns the whole list on purpose. The reader that preceded it took `?.[0]`,
 * which built a correct union and then discarded every match after the first - so a
 * locator resolving to 2 elements read as a clean single-element hit and no test
 * could tell a union from a priority. Assert on the list, not on its head.
 *
 * `or` concatenates the two sides where real Playwright document-orders them, so do
 * not read an `or` result's order as Playwright's.
 */
export function resolveFakeMatches(locator: Locator): FakeElement[] {
  return locatorCandidates.get(locator)?.() ?? [];
}
