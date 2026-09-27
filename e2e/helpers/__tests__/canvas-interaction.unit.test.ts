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
  resolveFakeMatches,
} from './canvas-helpers.fixtures';

const BOX: BoundingBox = { x: 100, y: 100, width: 200, height: 200 };

describe('getWorkspaceCanvas', () => {
  it('resolves to the single canvas carrying the workspace test id', () => {
    // The Draw toolbar mounts a 96x48 preview canvas ahead of the workspace, so the
    // test id has to carry the resolution - a document index would land on the preview.
    const dom = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([dom[1]]);
  });

  it('resolves to nothing when the app does not publish the test id', () => {
    // The app contract is a hard dependency now: no fallback, so an unpublished test
    // id has to fail here rather than silently resolve to some other canvas.
    const dom = [canvasElement(), canvasElement(), canvasElement()];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([]);
  });

  it('matches one element, so strict mode cannot fire', () => {
    // The regression that made the earlier `testId.or(nth(1))` attempt fail: once the
    // test id existed, the union matched the workspace canvas AND the fallback, and
    // every boundingBox() raised "resolved to 2 elements". A single-selector locator
    // cannot produce that.
    const dom = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    const matches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)));
    expect(matches).toHaveLength(1);
  });

  it('is unaffected by canvases appearing or disappearing elsewhere in the document', () => {
    // Opening a different tool unmounts the Draw preview canvas, which is what shifted
    // the old positional fallback onto a hidden overlay. Reference identity, not
    // toEqual: the positional implementation also returned elements of the same shape,
    // so a structural comparison would have passed it and pinned nothing.
    const before = [canvasElement(), canvasElement('workspace-canvas'), canvasElement()];
    const after = [canvasElement('workspace-canvas'), canvasElement(), canvasElement()];

    const beforeMatches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(before)));
    const afterMatches = resolveFakeMatches(getWorkspaceCanvas(createFakePage(after)));

    expect(beforeMatches).toHaveLength(1);
    expect(afterMatches).toHaveLength(1);
    expect(beforeMatches[0]).toBe(before[1]);
    expect(afterMatches[0]).toBe(after[0]);
  });

  it('ignores a non-canvas element in the document', () => {
    // The locator keys off the test id, not the tag, so a sibling without the id is
    // not a candidate. A non-canvas element that *did* publish the id would be a
    // second match and trip strict mode - that is the app's contract to keep.
    const dom = [{ selector: 'div' }, canvasElement('workspace-canvas')];
    expect(resolveFakeMatches(getWorkspaceCanvas(createFakePage(dom)))).toEqual([dom[1]]);
  });
});

describe('Locator.or', () => {
  it('returns the union of both sides, not a priority', () => {
    // Pinned so the reason `getWorkspaceCanvas` cannot use `.or()` stays executable.
    // A reader that takes the first match would hide this and make a union look like
    // a preference, which is the mistake the helper already made once.
    //
    // Membership, not order: the double concatenates the two sides, whereas real
    // Playwright returns the union in document order. Asserting the order here would
    // pin the double's behaviour and call it Playwright's.
    const dom = [canvasElement(), canvasElement(), canvasElement('workspace-canvas')];
    const page = createFakePage(dom);
    const union = page.getByTestId('workspace-canvas').or(page.locator('canvas').nth(1));
    const matches = resolveFakeMatches(union);
    expect(matches).toHaveLength(2);
    expect(matches).toEqual(expect.arrayContaining([dom[1], dom[2]]));
  });
});

describe('takeLineScreenshot', () => {
  afterEach(async () => {
    await cleanupTempDirs();
    vi.restoreAllMocks();
  });

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

  it('creates the output directory through the spied fs surface, not a private namespace', async () => {
    // The helper used to `await import('node:fs/promises')` per call. That binds an ESM
    // namespace whose `mkdir` is a copy taken at load time, so a `vi.spyOn(fs, 'mkdir')`
    // replaced a property on a different object and recorded zero calls while `mkdir`
    // certainly ran — the spy proves the import is now a top-level one. mkdir/attach
    // ordering is covered by the test above; this covers the fs surface itself.
    const outputDir = await makeOutputDir('spied-mkdir');
    const mkdir = vi.spyOn(fs, 'mkdir');
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo } = createTestInfoMock(outputDir);

    await takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo);

    expect(mkdir).toHaveBeenCalledWith(outputDir, { recursive: true });
  });

  it('names the helper and the missing field when testInfo has no output directory', async () => {
    // `path.join` used to run unguarded, so a TestInfo without an `outputDir` failed with
    // V8's `The "path" argument must be of type string` — naming neither the helper nor
    // the field. The guard runs before anything is captured or attached.
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock();
    const page = createPageMock({ screenshot: capture });

    await expect(takeLineScreenshot(page, BOX, 'line-test', testInfo)).rejects.toThrow(
      new Error('takeLineScreenshot: testInfo.outputDir is required to capture and attach a screenshot')
    );
    expect(capture).not.toHaveBeenCalled();
    expect(attach).not.toHaveBeenCalled();
  });

  it('rejects an empty output directory as readily as a missing one', async () => {
    const capture = createScreenshotSpy(Buffer.from('png'));
    const { testInfo, attach } = createTestInfoMock('');

    await expect(
      takeLineScreenshot(createPageMock({ screenshot: capture }), BOX, 'line-test', testInfo)
    ).rejects.toThrow(/testInfo\.outputDir is required/);
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

  it('forwards an explicit steps of zero rather than dropping the options object', async () => {
    // `if (options.steps)` used to be a truthy check, so `steps: 0` took the no-options
    // branch and Playwright never saw it. `0` is a real instruction — do not interpolate —
    // so the presence of the field is what decides, not its value.
    const input = createMouseMock();

    await drawLine(createPageMock({ mouse: input.mouse }), BOX, 0, 0, 100, 100, { steps: 0 });

    expect(input.move).toHaveBeenCalledTimes(2);
    expect(input.move.mock.calls[0]).toEqual([BOX.x, BOX.y]);
    expect(input.move.mock.calls[1]).toEqual([BOX.x + 100, BOX.y + 100, { steps: 0 }]);
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
