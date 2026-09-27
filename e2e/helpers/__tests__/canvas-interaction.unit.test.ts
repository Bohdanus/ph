import { afterEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_LINE_CLIP,
  drawLine,
  getWorkspaceCanvas,
  takeLineScreenshot,
  type BoundingBox,
  type ClipOptions,
} from '../canvas-helpers';
import {
  canvasElement,
  cleanupTempDirs,
  createMouseMock,
  createPageMock,
  createScreenshotSpy,
  createTestInfoMock,
  createFakePage,
  makeOutputDir,
  resolveFakeLocator,
} from './canvas-helpers.fixtures';

const BOX: BoundingBox = { x: 100, y: 100, width: 200, height: 200 };

describe('getWorkspaceCanvas', () => {
  it('resolves the canvas carrying the workspace test id', () => {
    const dom = [canvasElement('color-picker'), canvasElement('workspace-canvas'), canvasElement()];
    expect(resolveFakeLocator(getWorkspaceCanvas(createFakePage(dom)))).toBe(dom[1]);
  });

  it('falls back to the second canvas when nothing carries the test id', () => {
    const dom = [canvasElement(), canvasElement(), canvasElement()];
    expect(resolveFakeLocator(getWorkspaceCanvas(createFakePage(dom)))).toBe(dom[1]);
  });

  it('prefers the test-id canvas over the positional fallback', () => {
    const dom = [canvasElement(), canvasElement(), canvasElement('workspace-canvas')];
    expect(resolveFakeLocator(getWorkspaceCanvas(createFakePage(dom)))).toBe(dom[2]);
  });

  it('uses the fallback when the test-id canvas is the first of several', () => {
    const dom = [canvasElement('workspace-canvas'), canvasElement(), canvasElement()];
    expect(resolveFakeLocator(getWorkspaceCanvas(createFakePage(dom)))).toBe(dom[0]);
  });

  it('resolves to nothing when neither selector matches', () => {
    const dom = [{ selector: 'div' }];
    expect(resolveFakeLocator(getWorkspaceCanvas(createFakePage(dom)))).toBeUndefined();
  });
});

describe('takeLineScreenshot', () => {
  afterEach(cleanupTempDirs);

  it('captures the documented default clip and hands the buffer back', async () => {
    const outputDir = await makeOutputDir('default-clip');
    const screenshot = Buffer.from('fake-png-data');
    const capture = createScreenshotSpy(screenshot);
    const { testInfo } = createTestInfoMock(outputDir);

    const result = await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect(result).toBe(screenshot);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0].clip).toEqual({ x: 220, y: 220, width: 260, height: 80 });
  });

  it('moves the default clip with the canvas box origin', async () => {
    const outputDir = await makeOutputDir('box-origin');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), { ...BOX, x: 40, y: 15 }, 'shifted', testInfo);

    expect(capture.mock.calls[0][0].clip).toEqual({
      x: 40 + DEFAULT_LINE_CLIP.x,
      y: 15 + DEFAULT_LINE_CLIP.y,
      width: DEFAULT_LINE_CLIP.width,
      height: DEFAULT_LINE_CLIP.height,
    });
  });

  it('uses a custom clip verbatim instead of the box-relative default', async () => {
    const outputDir = await makeOutputDir('custom-clip');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);
    const custom: ClipOptions = { x: 10, y: 20, width: 30, height: 40 };

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'custom', testInfo, custom);

    expect(capture.mock.calls[0][0].clip).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });

  it('keeps the box-relative default for the fields a custom clip leaves out', async () => {
    const outputDir = await makeOutputDir('partial-clip');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'partial', testInfo, { x: 10 });

    expect(capture.mock.calls[0][0].clip).toEqual({
      x: 10,
      y: BOX.y + DEFAULT_LINE_CLIP.y,
      width: DEFAULT_LINE_CLIP.width,
      height: DEFAULT_LINE_CLIP.height,
    });
  });

  it('creates a missing output directory and attaches the file it captured', async () => {
    const outputDir = await makeOutputDir(path.join('nested', 'deep', 'line'));
    await expect(fs.stat(outputDir)).rejects.toThrow();

    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect((await fs.stat(outputDir)).isDirectory()).toBe(true);
    expect(attach).toHaveBeenCalledTimes(1);

    const capturedPath = capture.mock.calls[0][0].path;
    const [attachName, attachOptions] = attach.mock.calls[0];
    expect(attachName).toBe('line-test');
    expect(attachOptions.contentType).toBe('image/png');
    expect(attachOptions.path).toBe(capturedPath);
    expect(path.dirname(capturedPath)).toBe(outputDir);
    expect(path.basename(capturedPath)).toBe('line-test.png');
  });

  // PIN: a missing `testInfo.outputDir` reaches `path.join` unchecked, so it surfaces as
  // a raw V8 ERR_INVALID_ARG_TYPE about the "path" argument rather than a message naming
  // the problem. Asserting that exact message (not just `TypeError`) is what keeps the pin
  // honest: fixing the source to `throw new TypeError('testInfo.outputDir is required')`,
  // or to default the path, breaks this test instead of silently passing it.
  it('rejects without capturing anything when testInfo has no output directory', async () => {
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock();
    const page = createPageMock({ screenshot: capture });

    await expect(takeLineScreenshot(page, BOX, 'line-test', testInfo)).rejects.toThrow(/path.*must be of type string/);
    expect(capture).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('propagates a screenshot failure and skips the attachment', async () => {
    const outputDir = await makeOutputDir('capture-failure');
    const capture = vi.fn().mockRejectedValue(new Error('capture failed'));
    const { testInfo, attach } = createTestInfoMock(outputDir);
    const page = createPageMock({ screenshot: capture });

    await expect(takeLineScreenshot(page, BOX, 'line-test', testInfo)).rejects.toThrow('capture failed');
    expect(attach).not.toHaveBeenCalled();
  });

  it('propagates an attachment failure', async () => {
    const outputDir = await makeOutputDir('attach-failure');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock(outputDir);
    attach.mockRejectedValue(new Error('reporter offline'));

    await expect(
      takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo)
    ).rejects.toThrow('reporter offline');
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe('drawLine', () => {
  it('presses, drags between the box-relative endpoints and releases', async () => {
    const input = createMouseMock();
    const page = createPageMock({ mouse: input.mouse });
    const box: BoundingBox = { x: 100, y: 200, width: 50, height: 50 };

    await expect(drawLine(page, box, 10, 20, 30, 40)).resolves.toBeUndefined();

    expect(input.move.mock.calls).toEqual([
      [110, 220],
      [130, 240],
    ]);
    expect(input.down).toHaveBeenCalledTimes(1);
    expect(input.up).toHaveBeenCalledTimes(1);
    expect(input.down.mock.invocationCallOrder[0]).toBeGreaterThan(input.move.mock.invocationCallOrder[0]);
    expect(input.down.mock.invocationCallOrder[0]).toBeLessThan(input.move.mock.invocationCallOrder[1]);
    expect(input.up.mock.invocationCallOrder[0]).toBeGreaterThan(input.down.mock.invocationCallOrder[0]);
  });

  it('interpolates the drag when steps are requested', async () => {
    const input = createMouseMock();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: 5 });

    expect(input.move).toHaveBeenCalledTimes(2);
    expect(input.move.mock.calls[0]).toEqual([BOX.x, BOX.y]);
    expect(input.move.mock.calls[1]).toEqual([BOX.x + 100, BOX.y + 100, { steps: 5 }]);
  });

  // PIN: the guard is a truthy check, so an explicit `steps: 0` is silently dropped
  // instead of being forwarded, where Playwright would read 0 as "do not interpolate".
  // A fix that switches the guard to `!== undefined` breaks this expectation.
  it('silently drops a steps value of zero instead of forwarding it', async () => {
    const input = createMouseMock();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: 0 });

    expect(input.move.mock.calls).toEqual([
      [BOX.x, BOX.y],
      [BOX.x + 100, BOX.y + 100],
    ]);
  });

  it('passes negative box-relative coordinates through untouched', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: -50, y: -20, width: 100, height: 100 };

    await expect(drawLine(createPageMock({ mouse: input.mouse }), box, -5, -5, 5, 5)).resolves.toBeUndefined();
    expect(input.move.mock.calls).toEqual([
      [-55, -25],
      [-45, -15],
    ]);
  });

  it('still performs the gesture for a zero-size box', async () => {
    const input = createMouseMock();
    const box: BoundingBox = { x: 0, y: 0, width: 0, height: 0 };

    await expect(drawLine(createPageMock({ mouse: input.mouse }), box, 10, 20, 30, 40)).resolves.toBeUndefined();
    expect(input.move.mock.calls).toEqual([
      [10, 20],
      [30, 40],
    ]);
    expect(input.down).toHaveBeenCalledTimes(1);
    expect(input.up).toHaveBeenCalledTimes(1);
  });

  it('propagates a mouse failure instead of releasing the button', async () => {
    const input = createMouseMock();
    input.move.mockRejectedValueOnce(new Error('mouse lost'));
    const page = createPageMock({ mouse: input.mouse });

    await expect(drawLine(page, BOX, 0, 0, 10, 10)).rejects.toThrow('mouse lost');
    expect(input.up).not.toHaveBeenCalled();
  });
});
