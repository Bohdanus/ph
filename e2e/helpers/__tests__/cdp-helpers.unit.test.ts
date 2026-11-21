import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { captureCanvasScreenshot } from '../cdp-helpers';
import {
  cleanupTempDirs,
  createPageMock,
  createTestInfoMock,
  makeOutputDir,
  type AttachOptions,
} from './canvas-helpers.fixtures';

const BOX = { x: 40, y: 60, width: 240, height: 160 };
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f]);

interface PageState {
  innerWidth: number;
  innerHeight: number;
  scrollX: number;
  scrollY: number;
}

interface ScreenshotOptions {
  clip: { x: number; y: number; width: number; height: number };
  scale: 'device';
  type: 'png';
}

type ScreenshotSpy = Mock<(options: ScreenshotOptions) => Promise<Buffer>>;

interface HarnessOptions {
  result?: Buffer;
  screenshotError?: Error;
  scroll?: { x: number; y: number };
  viewport?: { width: number; height: number };
  pageStateAfterCapture?: Partial<PageState>;
}

interface ScreenshotHarness {
  page: Page;
  screenshot: ScreenshotSpy;
  evaluate: Mock<Page['evaluate']>;
}

function createScreenshotHarness(options: HarnessOptions = {}): ScreenshotHarness {
  const pageState: PageState = {
    innerWidth: options.viewport?.width ?? 1280,
    innerHeight: options.viewport?.height ?? 720,
    scrollX: options.scroll?.x ?? 0,
    scrollY: options.scroll?.y ?? 0,
  };
  const screenshot = vi.fn<(parameters: ScreenshotOptions) => Promise<Buffer>>().mockImplementation(async () => {
    if (options.screenshotError) throw options.screenshotError;
    Object.assign(pageState, options.pageStateAfterCapture);
    return options.result ?? PNG_BYTES;
  });
  const evaluate = vi.fn(async (pageFunction: () => unknown) => pageFunction()) as unknown as Mock<Page['evaluate']>;
  vi.stubGlobal('window', pageState);

  return {
    page: createPageMock({ evaluate, screenshot: screenshot as unknown as Page['screenshot'] }),
    screenshot,
    evaluate,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  const reason: unknown = await promise.then(
    () => {
      throw new Error('expected the promise to reject, but it resolved');
    },
    (caught: unknown) => caught
  );
  expect(reason).toBeInstanceOf(Error);
  return reason as Error;
}

describe('Canvas screenshot helper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('module surface', () => {
    it('exports only captureCanvasScreenshot', async () => {
      const exported = await import('../cdp-helpers');
      expect(Object.keys(exported).sort()).toEqual(['captureCanvasScreenshot']);
    });
  });

  describe('captureCanvasScreenshot', () => {
    afterEach(cleanupTempDirs);

    it('rejects a missing output directory before inspecting the page', async () => {
      const { page, screenshot, evaluate } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock();
      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'missing-output'));

      expect(error.message).toContain('captureCanvasScreenshot');
      expect(error.message).toContain('outputDir');
      expect(error.message).toContain('required');
      expect(evaluate).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
    });

    it('rejects an empty output directory before inspecting the page', async () => {
      const { page, screenshot, evaluate } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock('');
      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'empty-output'));

      expect(error.message).toContain('captureCanvasScreenshot');
      expect(error.message).toContain('outputDir');
      expect(error.message).toContain('required');
      expect(evaluate).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
    });

    it('passes the viewport clip to Playwright at device scale as PNG', async () => {
      const outputDir = await makeOutputDir('exact-options');
      const { page, screenshot } = createScreenshotHarness();
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'exact');

      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(screenshot).toHaveBeenCalledWith({ clip: BOX, scale: 'device', type: 'png' });
    });

    it.each([
      ['partial clip', { x: 10 }, { x: 10, y: BOX.y, width: BOX.width, height: BOX.height }],
      ['zero values', { x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 }],
    ] as const)('forwards %s without changing the requested clip', async (_label, clip, expectedClip) => {
      const outputDir = await makeOutputDir('clip-options');
      const { page, screenshot } = createScreenshotHarness();
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'clip', clip);

      expect(screenshot).toHaveBeenCalledWith({ clip: expectedClip, scale: 'device', type: 'png' });
    });

    it.each([
      ['negative origin', { x: -20, y: 10, width: 30, height: 40 }],
      ['right edge', { x: 1270, y: 10, width: 30, height: 40 }],
      ['bottom edge', { x: 10, y: 700, width: 30, height: 40 }],
      ['wider than the viewport at its origin', { x: 0, y: 10, width: 1281, height: 40 }],
      ['taller than the viewport at its origin', { x: 10, y: 0, width: 30, height: 721 }],
    ] as const)('rejects a clip that crosses the viewport %s before taking a screenshot', async (_label, clip) => {
      const outputDir = await makeOutputDir('offscreen-clip');
      const { page, screenshot } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'offscreen', clip)).rejects.toThrow(
        'extends outside the current viewport'
      );

      expect(screenshot).not.toHaveBeenCalled();
      expect(existsSync(path.join(outputDir, 'offscreen.png'))).toBe(false);
      expect(attach).not.toHaveBeenCalled();
    });

    it('preserves fractional clip coordinates for Playwright to rasterize', async () => {
      const outputDir = await makeOutputDir('fractional-clip');
      const { page, screenshot } = createScreenshotHarness();
      const { testInfo } = createTestInfoMock(outputDir);
      const clip = { x: 40.25, y: 60.5, width: 119.75, height: 79.5 };

      await captureCanvasScreenshot(page, BOX, testInfo, 'fractional', clip);

      expect(screenshot).toHaveBeenCalledWith({ clip, scale: 'device', type: 'png' });
    });

    it('keeps viewport-relative clip coordinates unchanged when the page is scrolled', async () => {
      const outputDir = await makeOutputDir('scroll-coordinates');
      const { page, screenshot } = createScreenshotHarness({ scroll: { x: 30, y: 440 } });
      const { testInfo } = createTestInfoMock(outputDir);
      const clip = { x: 56, y: 40, width: 100, height: 60 };

      await captureCanvasScreenshot(page, BOX, testInfo, 'scrolled', clip);

      expect(screenshot).toHaveBeenCalledWith({ clip, scale: 'device', type: 'png' });
    });

    it('reads page geometry around the screenshot and rejects any viewport or scroll drift', async () => {
      const cases = [
        [{ innerHeight: 633 }, '1280x720 at 0,0 -> 1280x633 at 0,0'],
        [{ innerWidth: 1193 }, '1280x720 at 0,0 -> 1193x720 at 0,0'],
        [{ scrollX: 87 }, '1280x720 at 0,0 -> 1280x720 at 87,0'],
        [{ scrollY: 87 }, '1280x720 at 0,0 -> 1280x720 at 0,87'],
      ] as const;

      for (const [pageStateAfterCapture, geometry] of cases) {
        const outputDir = await makeOutputDir(`geometry-${geometry.replaceAll(/[^a-z0-9]/gi, '-')}`);
        const { page, screenshot, evaluate } = createScreenshotHarness({ pageStateAfterCapture });
        const { testInfo, attach } = createTestInfoMock(outputDir);
        const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'drift'));

        expect(error.message).toContain('page geometry changed during Playwright screenshot');
        expect(error.message).toContain(geometry);
        expect(screenshot).toHaveBeenCalledTimes(1);
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(evaluate.mock.invocationCallOrder[0]).toBeLessThan(screenshot.mock.invocationCallOrder[0]);
        expect(screenshot.mock.invocationCallOrder[0]).toBeLessThan(evaluate.mock.invocationCallOrder[1]);
        expect(existsSync(path.join(outputDir, 'drift.png'))).toBe(false);
        expect(attach).not.toHaveBeenCalled();
      }
    });

    it('returns and writes the screenshot bytes unchanged', async () => {
      const outputDir = await makeOutputDir('bytes');
      const { page } = createScreenshotHarness();
      const { testInfo } = createTestInfoMock(outputDir);

      const result = await captureCanvasScreenshot(page, BOX, testInfo, 'bytes');

      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(PNG_BYTES);
      expect(await fs.readFile(path.join(outputDir, 'bytes.png'))).toEqual(PNG_BYTES);
    });

    it('waits for the screenshot before validating geometry or writing the artifact', async () => {
      const outputDir = await makeOutputDir('screenshot-gate');
      const { page, screenshot, evaluate } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);
      let finishScreenshot: (buffer: Buffer) => void = () => {};
      screenshot.mockReturnValue(
        new Promise<Buffer>((resolve) => {
          finishScreenshot = resolve;
        })
      );
      let settled = false;
      const capture = captureCanvasScreenshot(page, BOX, testInfo, 'gated').then((result) => {
        settled = true;
        return result;
      });

      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(settled).toBe(false);
      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(existsSync(outputDir)).toBe(false);
      expect(attach).not.toHaveBeenCalled();

      finishScreenshot(PNG_BYTES);
      await expect(capture).resolves.toEqual(PNG_BYTES);
      expect(evaluate).toHaveBeenCalledTimes(2);
      expect(existsSync(path.join(outputDir, 'gated.png'))).toBe(true);
      expect(attach).toHaveBeenCalledTimes(1);
    });

    it('creates nested output directories and reuses existing ones', async () => {
      const nestedOutputDir = await makeOutputDir(path.join('nested', 'deep', 'playwright'));
      await expect(fs.stat(nestedOutputDir)).rejects.toThrow();
      const first = createScreenshotHarness();
      const firstTestInfo = createTestInfoMock(nestedOutputDir).testInfo;

      await captureCanvasScreenshot(first.page, BOX, firstTestInfo, 'nested');

      expect((await fs.stat(nestedOutputDir)).isDirectory()).toBe(true);
      expect(existsSync(path.join(nestedOutputDir, 'nested.png'))).toBe(true);

      const second = createScreenshotHarness();
      const secondTestInfo = createTestInfoMock(nestedOutputDir).testInfo;
      await expect(captureCanvasScreenshot(second.page, BOX, secondTestInfo, 'reused')).resolves.toEqual(PNG_BYTES);
      expect(existsSync(path.join(nestedOutputDir, 'reused.png'))).toBe(true);
    });

    it('attaches the written file once under its name and as image/png', async () => {
      const outputDir = await makeOutputDir('attachment');
      const { page } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);
      const fileExistedAtAttach: boolean[] = [];
      attach.mockImplementation(async (_name: string, options: AttachOptions) => {
        fileExistedAtAttach.push(existsSync(String(options.path)));
      });

      await captureCanvasScreenshot(page, BOX, testInfo, 'attached');

      expect(attach).toHaveBeenCalledTimes(1);
      expect(attach.mock.calls[0]).toEqual([
        'attached',
        { path: path.join(outputDir, 'attached.png'), contentType: 'image/png' },
      ]);
      expect(fileExistedAtAttach).toEqual([true]);
    });

    it('rejects an empty screenshot before writing or attaching it', async () => {
      const outputDir = await makeOutputDir('empty-screenshot');
      const { page, screenshot } = createScreenshotHarness({ result: Buffer.alloc(0) });
      const { testInfo, attach } = createTestInfoMock(outputDir);
      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'empty'));

      expect(error.message).toContain('Playwright returned an empty screenshot');
      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(existsSync(path.join(outputDir, 'empty.png'))).toBe(false);
      expect(attach).not.toHaveBeenCalled();
    });

    it('propagates a screenshot failure without writing or attaching an artifact', async () => {
      const outputDir = await makeOutputDir('screenshot-failure');
      const screenshotError = new Error('page closed');
      const { page, screenshot } = createScreenshotHarness({ screenshotError });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'failed'));

      expect(error).toBe(screenshotError);
      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(existsSync(path.join(outputDir, 'failed.png'))).toBe(false);
      expect(attach).not.toHaveBeenCalled();
    });

    it('propagates an attachment failure while keeping the written screenshot', async () => {
      const outputDir = await makeOutputDir('attachment-failure');
      const { page } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);
      const attachError = new Error('reporter offline');
      attach.mockRejectedValue(attachError);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'offline'));

      expect(error).toBe(attachError);
      expect(existsSync(path.join(outputDir, 'offline.png'))).toBe(true);
      expect(attach).toHaveBeenCalledTimes(1);
    });

    it('allows an empty artifact name as a file inside outputDir', async () => {
      const outputDir = await makeOutputDir('empty-name');
      const { page } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, '');

      expect(existsSync(path.join(outputDir, '.png'))).toBe(true);
      expect(attach.mock.calls[0][0]).toBe('');
    });

    it('rejects POSIX and Windows separators before inspecting the page or writing files', async () => {
      const outputDir = await makeOutputDir('separators');
      await fs.mkdir(outputDir, { recursive: true });
      const { page, screenshot, evaluate } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);

      for (const name of ['nested/thing', 'nested\\thing']) {
        const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, name));
        expect(error.message).toContain('captureCanvasScreenshot');
        expect(error.message).toContain(JSON.stringify(name));
      }

      expect(evaluate).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
      expect(await fs.readdir(outputDir)).toEqual([]);
    });

    it('rejects traversal and directory references before any screenshot work', async () => {
      const outputDir = await makeOutputDir('traversal');
      await fs.mkdir(outputDir, { recursive: true });
      const { page, screenshot, evaluate } = createScreenshotHarness();
      const { testInfo, attach } = createTestInfoMock(outputDir);

      for (const name of ['../escaped', '.', '..']) {
        const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, name));
        expect(error.message).toContain('captureCanvasScreenshot');
        expect(error.message).toContain(JSON.stringify(name));
      }

      expect(existsSync(path.join(path.dirname(outputDir), 'escaped.png'))).toBe(false);
      expect(await fs.readdir(outputDir)).toEqual([]);
      expect(evaluate).not.toHaveBeenCalled();
      expect(screenshot).not.toHaveBeenCalled();
      expect(attach).not.toHaveBeenCalled();
    });
  });
});
