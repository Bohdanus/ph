import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { captureCanvasScreenshot, getDevicePixelRatio } from '../cdp-helpers';
import {
  cleanupTempDirs,
  createPageMock,
  createTestInfoMock,
  makeOutputDir,
  type AttachOptions,
} from './canvas-helpers.fixtures';

/**
 * CSS geometry of a canvas region. Deliberately all non-zero: a box full of zeros
 * cannot tell "used the clip" from "fell back to the box".
 */
const BOX = { x: 40, y: 60, width: 240, height: 160 };

/**
 * A real PNG signature plus bytes that are not valid UTF-8, base64-encoded. The
 * payload is deliberately not text, so a decode that forgets `'base64'` (or decodes
 * with the default utf8) produces different bytes and fails here.
 */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x7f]);
const PNG_BASE64 = PNG_BYTES.toString('base64');

interface CaptureParams {
  format: string;
  clip: { x: number; y: number; width: number; height: number; scale: number };
}

type SendSpy = Mock<(method: string, params: CaptureParams) => Promise<{ data?: string }>>;
type DetachSpy = Mock<() => Promise<void>>;
type NewSessionSpy = Mock<(page: Page) => Promise<CDPSession>>;

interface HarnessOptions {
  /** The CDP return value. `{}` models a response that omits `data`. */
  response?: { data?: string };
  sendError?: Error;
  detachError?: Error;
}

interface CdpHarness {
  page: Page;
  send: SendSpy;
  detach: DetachSpy;
  newCDPSession: NewSessionSpy;
  /**
   * Whether the output directory already existed at the moment the CDP session was
   * opened. `fs` is reached through a dynamic import inside the helper (see
   * e2e/OPEN_PROBLEMS.md, "the per-call dynamic import makes the fs surface
   * unspyable"), so ordering against `mkdir` is asserted from this side of the call
   * rather than by spying on `fs`.
   */
  outputDirExistedAtSession: () => boolean;
}

function createCdpHarness(outputDir: string, options: HarnessOptions = {}): CdpHarness {
  const send = vi.fn<(method: string, params: CaptureParams) => Promise<{ data?: string }>>();
  if (options.sendError) {
    send.mockRejectedValue(options.sendError);
  } else {
    send.mockResolvedValue(options.response ?? { data: PNG_BASE64 });
  }

  const detach = vi.fn<() => Promise<void>>();
  if (options.detachError) {
    detach.mockRejectedValue(options.detachError);
  } else {
    detach.mockResolvedValue(undefined);
  }

  let outputDirExistedAtSession = false;
  const newCDPSession = vi.fn<(page: Page) => Promise<CDPSession>>(async () => {
    outputDirExistedAtSession = existsSync(outputDir);
    return { send, detach } as unknown as CDPSession;
  });
  const context = vi.fn<() => BrowserContext>().mockReturnValue({ newCDPSession } as unknown as BrowserContext);

  return {
    page: createPageMock({ context }),
    send,
    detach,
    newCDPSession,
    outputDirExistedAtSession: () => outputDirExistedAtSession,
  };
}

/**
 * Runs the page function the helper hands to `page.evaluate`, against a stubbed
 * global `window`. The assertions below are therefore made on the helper's own
 * callback, not on a value the double chose to return — a helper that read a
 * hardcoded ratio, or a different global, fails these tests.
 */
function createRunningEvaluate(devicePixelRatio: unknown): Mock<Page['evaluate']> {
  vi.stubGlobal('window', { devicePixelRatio });
  return vi.fn(async (pageFunction: () => number) => pageFunction()) as unknown as Mock<Page['evaluate']>;
}

describe('CDP Helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('getDevicePixelRatio', () => {
    it('returns the ratio the page reports, read from window inside a page function', async () => {
      const evaluate = createRunningEvaluate(2);

      await expect(getDevicePixelRatio(createPageMock({ evaluate }))).resolves.toBe(2);

      expect(evaluate).toHaveBeenCalledTimes(1);
      expect(evaluate.mock.calls[0][0]).toBeTypeOf('function');
    });

    it('falls back to 1 when the page reports no devicePixelRatio at all', async () => {
      // The missing-field case: the page function runs for real, so the `|| 1`
      // fallback is exercised rather than a hardcoded 1 in the double.
      const evaluate = createRunningEvaluate(undefined);

      await expect(getDevicePixelRatio(createPageMock({ evaluate }))).resolves.toBe(1);
    });

    it('treats a falsy ratio as missing, so 0 and NaN both become 1', async () => {
      // PIN: the fallback is `||`, not `??`, so a reported 0 reads as "no ratio" and
      // is reported as 1. Real browsers never report 0, so this is harmless — but a
      // fix that switches the guard to `??` breaks this test, which is the point.
      await expect(getDevicePixelRatio(createPageMock({ evaluate: createRunningEvaluate(0) }))).resolves.toBe(1);
      await expect(getDevicePixelRatio(createPageMock({ evaluate: createRunningEvaluate(Number.NaN) }))).resolves.toBe(
        1
      );
    });

    it('returns a fractional ratio verbatim, without rounding or truncating it', async () => {
      // A DPR of 1.5 or 2.75 is legal. Rounding it here would corrupt every
      // pixel-to-CSS conversion downstream.
      await expect(getDevicePixelRatio(createPageMock({ evaluate: createRunningEvaluate(1.5) }))).resolves.toBe(1.5);
      await expect(getDevicePixelRatio(createPageMock({ evaluate: createRunningEvaluate(2.75) }))).resolves.toBe(2.75);
    });

    it('returns a negative ratio verbatim instead of clamping it to the 1 fallback', async () => {
      // The `|| 1` fallback is a floor for a *missing* value only. A helper that
      // clamped to `Math.max(1, ratio)` would hide a nonsense ratio behind a
      // plausible one, and every caller would treat it as real.
      await expect(getDevicePixelRatio(createPageMock({ evaluate: createRunningEvaluate(-2) }))).resolves.toBe(-2);
    });

    it('propagates an evaluate failure instead of reporting the 1 fallback', async () => {
      // The fallback belongs to a page that answered `undefined`. A failed evaluate
      // means the page is gone or the context destroyed, and reporting 1 there would
      // turn a hard error into a plausible-looking number.
      const evaluate = vi.fn<Page['evaluate']>().mockRejectedValue(new Error('Execution context was destroyed'));
      const page = createPageMock({ evaluate });

      await expect(getDevicePixelRatio(page)).rejects.toThrow('Execution context was destroyed');
      expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('propagates a non-Error rejection from evaluate unchanged', async () => {
      const rejection = { reason: 'cdp target gone' };
      const evaluate = vi.fn<Page['evaluate']>().mockRejectedValue(rejection);

      await expect(getDevicePixelRatio(createPageMock({ evaluate }))).rejects.toBe(rejection);
    });
  });

  describe('captureCanvasScreenshot', () => {
    afterEach(cleanupTempDirs);

    it('sends Page.captureScreenshot with the box as the clip, at scale 1 and png format', async () => {
      const outputDir = await makeOutputDir('exact-params');
      const { page, send, newCDPSession } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'exact');

      // The session is opened on the page that was passed in, once.
      expect(newCDPSession).toHaveBeenCalledTimes(1);
      expect(newCDPSession.mock.calls[0][0]).toBe(page);
      // Exact parameters, so a `format: 'jpeg'`, a dropped `scale`, a
      // `scale: devicePixelRatio` variant, or DPR math layered on top of the clip all
      // fail here. The helper's own comment states it does no DPR conversion; this is
      // what makes that statement executable without a browser.
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        clip: { ...BOX, scale: 1 },
      });
    });

    it('decodes the base64 payload, returns those bytes, and writes them to outputDir/<name>.png', async () => {
      const outputDir = await makeOutputDir('payload');
      const { page } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      const result = await captureCanvasScreenshot(page, BOX, testInfo, 'payload');

      const expectedPath = path.join(outputDir, 'payload.png');
      expect(result).toBeInstanceOf(Buffer);
      expect(result).toEqual(PNG_BYTES);
      expect(path.dirname(expectedPath)).toBe(outputDir);
      expect(path.basename(expectedPath)).toBe('payload.png');
      expect(await fs.readFile(expectedPath)).toEqual(PNG_BYTES);
    });

    it('attaches the file it wrote, under the given name and as image/png, once the file exists', async () => {
      const outputDir = await makeOutputDir('attach');
      const { page } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);
      const fileExistedAtAttach: boolean[] = [];
      attach.mockImplementation(async (_name: string, options: AttachOptions) => {
        fileExistedAtAttach.push(existsSync(String(options.path)));
      });

      await captureCanvasScreenshot(page, BOX, testInfo, 'attached');

      expect(attach).toHaveBeenCalledTimes(1);
      expect(attach.mock.calls[0][0]).toBe('attached');
      // Exactly these two options: an extra `body` alongside `path` would attach the
      // bytes twice, and a missing `contentType` renders as a binary blob.
      expect(attach.mock.calls[0][1]).toEqual({
        path: path.join(outputDir, 'attached.png'),
        contentType: 'image/png',
      });
      // Attachment cannot precede the write: a reporter handed a path that does not
      // exist yet records a broken link and no screenshot.
      expect(fileExistedAtAttach).toEqual([true]);
    });

    it('keeps the box value for every field a partial clip leaves out', async () => {
      const outputDir = await makeOutputDir('partial-clip');
      const { page, send } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'partial', { x: 10 });

      // The four `??` defaults are per field. An all-or-nothing merge
      // (`clip ? { ...clip, scale: 1 } : { ...box, scale: 1 }`) would send a clip with
      // no width or height, which CDP rejects — and the browser specs, which always
      // pass a complete clip, would not notice.
      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 10, y: BOX.y, width: BOX.width, height: BOX.height, scale: 1 },
      });
    });

    it('keeps zeros in the clip instead of substituting the box value for them', async () => {
      // PIN: the merge is `clip?.x ?? box.x`, so a zero is a value, not an absence.
      // Rewriting it as `||` sends the box and captures the whole canvas region while
      // the caller asked for a zero-sized one; this fails the moment that happens.
      const outputDir = await makeOutputDir('zero-clip');
      const { page, send } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'zero', { x: 0, y: 0, width: 0, height: 0 });

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width: 0, height: 0, scale: 1 },
      });
    });

    it('forwards a negative clip origin to CDP unchanged instead of clamping it', async () => {
      // A canvas scrolled partly out of the viewport has a negative origin. Clamping
      // it to 0 would capture a different region than the caller measured.
      const outputDir = await makeOutputDir('negative-clip');
      const { page, send } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'negative', { x: -20, y: -10, width: 30, height: 40 });

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        clip: { x: -20, y: -10, width: 30, height: 40, scale: 1 },
      });
    });

    it('creates the whole output directory path before the CDP session is opened', async () => {
      const outputDir = await makeOutputDir(path.join('nested', 'deep', 'cdp'));
      await expect(fs.stat(outputDir)).rejects.toThrow();
      const { page, outputDirExistedAtSession } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'nested');

      // Playwright guarantees `testInfo.outputDir` exists in a real run, so the
      // browser specs never exercise this. Asserting it from the CDP side catches a
      // `mkdir` that moved after the capture, or lost its `recursive`.
      expect(outputDirExistedAtSession()).toBe(true);
      expect((await fs.stat(outputDir)).isDirectory()).toBe(true);
      expect(existsSync(path.join(outputDir, 'nested.png'))).toBe(true);
    });

    it('reuses an output directory that already exists instead of failing on it', async () => {
      const outputDir = await makeOutputDir('existing');
      await fs.mkdir(outputDir, { recursive: true });
      const { page } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'existing')).resolves.toEqual(PNG_BYTES);

      expect(existsSync(path.join(outputDir, 'existing.png'))).toBe(true);
    });

    it('propagates a capture failure, writes no file, attaches nothing, and still detaches', async () => {
      const outputDir = await makeOutputDir('capture-failure');
      const { page, send, detach } = createCdpHarness(outputDir, { sendError: new Error('Target closed') });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'failed')).rejects.toThrow('Target closed');

      expect(send).toHaveBeenCalledTimes(1);
      expect(attach).not.toHaveBeenCalled();
      expect(existsSync(path.join(outputDir, 'failed.png'))).toBe(false);
      // The `finally` is what keeps a dead page from leaking CDP sessions, which is the
      // failure mode the helper exists to avoid in the first place.
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('rejects with a raw TypeError when the CDP response omits data, and detaches', async () => {
      // FINDING, pinned: `Buffer.from(undefined, 'base64')` throws a bare Node
      // TypeError naming neither CDP nor the test, so a truncated response is reported
      // as "The first argument must be of type string...". Pinning the message means a
      // fix that validates `data` up front breaks this test instead of passing quietly.
      const outputDir = await makeOutputDir('missing-data');
      const { page, detach } = createCdpHarness(outputDir, { response: {} });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'missing')).rejects.toThrow(
        /first argument must be of type string/
      );

      expect(attach).not.toHaveBeenCalled();
      expect(existsSync(path.join(outputDir, 'missing.png'))).toBe(false);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('reports success for an empty capture, writing and attaching a zero-byte file', async () => {
      // FINDING, pinned: nothing checks that the decoded capture is non-empty, so a
      // failed or empty CDP capture is reported as a success with a 0-byte PNG
      // attached. Downstream, `loadImageData` then fails on a file this helper
      // claimed to have written. Callers that check `length > 0` catch it; the helper
      // itself does not.
      const outputDir = await makeOutputDir('empty-data');
      const { page, detach } = createCdpHarness(outputDir, { response: { data: '' } });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const result = await captureCanvasScreenshot(page, BOX, testInfo, 'empty');

      expect(result).toHaveLength(0);
      expect((await fs.stat(path.join(outputDir, 'empty.png'))).size).toBe(0);
      expect(attach).toHaveBeenCalledTimes(1);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('propagates an attachment failure after the file is written, and still detaches', async () => {
      const outputDir = await makeOutputDir('attach-failure');
      const { page, detach } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);
      attach.mockRejectedValue(new Error('reporter offline'));

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'offline')).rejects.toThrow('reporter offline');

      // The artifact survives on disk, so a reporter that recovers still finds it.
      expect(existsSync(path.join(outputDir, 'offline.png'))).toBe(true);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('reports a detach failure in place of the capture failure when both fail', async () => {
      // PIN: `finally { await cdp.detach() }` means a rejecting detach *replaces* the
      // in-flight error, so the caller is told the session could not be closed and
      // never learns the capture failed. Asserting on the detach message pins the
      // masking; swallowing the detach error instead would break this test.
      const outputDir = await makeOutputDir('detach-failure');
      const { page, detach } = createCdpHarness(outputDir, {
        sendError: new Error('capture exploded'),
        detachError: new Error('detach exploded'),
      });
      const { testInfo } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'both')).rejects.toThrow('detach exploded');

      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('waits for the session to detach before it resolves', async () => {
      // `cdp.detach()` unawaited inside the `finally` would let the helper resolve
      // while the session was still open — the helper's whole reason for existing is
      // that this capture path hangs a headed browser, and a session that outlives the
      // call is the leak. Gated on the attach first, so the helper is provably already
      // inside its `finally` when the assertion runs.
      const outputDir = await makeOutputDir('detach-gate');
      const { page, detach } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);
      let signalAttached: () => void = () => {};
      const attached = new Promise<void>((resolve) => {
        signalAttached = resolve;
      });
      attach.mockImplementation(async () => {
        signalAttached();
      });
      let releaseDetach: () => void = () => {};
      const detached = new Promise<void>((resolve) => {
        releaseDetach = resolve;
      });
      detach.mockImplementation(() => detached);

      let settled = false;
      const capture = captureCanvasScreenshot(page, BOX, testInfo, 'gated').then((result) => {
        settled = true;
        return result;
      });

      await attached;
      // Drain every pending microtask, so a helper that does not await the detach has
      // had its chance to resolve before the assertion reads the flag.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      expect(settled).toBe(false);

      releaseDetach();
      await expect(capture).resolves.toEqual(PNG_BYTES);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('detaches the session once, after the attachment', async () => {
      const outputDir = await makeOutputDir('detach-order');
      const { page, detach } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'order');

      expect(detach).toHaveBeenCalledTimes(1);
      // Detaching before the attachment reads the path off a session-less page, and
      // detaching twice throws on the second call.
      expect(attach.mock.invocationCallOrder[0]).toBeLessThan(detach.mock.invocationCallOrder[0]);
    });

    it('uses an empty name verbatim, writing a hidden .png file', async () => {
      const outputDir = await makeOutputDir('empty-name');
      const { page } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const result = await captureCanvasScreenshot(page, BOX, testInfo, '');

      expect(result).toEqual(PNG_BYTES);
      expect(existsSync(path.join(outputDir, '.png'))).toBe(true);
      expect(attach.mock.calls[0][0]).toBe('');
    });

    it('treats a name containing a path separator as a path, not a filename', async () => {
      // Only `outputDir` is created, so a name with a separator names a parent
      // directory that does not exist. Documented constraint: `name` has to be a bare
      // filename. A fix that sanitised the name breaks this test.
      const outputDir = await makeOutputDir('name-with-separator');
      const { page, detach } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await expect(captureCanvasScreenshot(page, BOX, testInfo, 'nested/thing')).rejects.toThrow(/ENOENT/);

      expect(attach).not.toHaveBeenCalled();
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('writes outside the output directory when the name traverses out of it', async () => {
      // The name is interpolated into a path with no sanitisation, so `..` segments
      // resolve. Low severity in a throwaway test directory, but it means the written
      // path and the attached path are not confined to `testInfo.outputDir` — a caller
      // that assumes they are, or that later cleans up by output dir, is wrong.
      const outputDir = await makeOutputDir('name-traversal');
      const { page } = createCdpHarness(outputDir);
      const { testInfo, attach } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, '../escaped');

      const escapedPath = path.join(path.dirname(outputDir), 'escaped.png');
      expect(existsSync(escapedPath)).toBe(true);
      expect(existsSync(path.join(outputDir, 'escaped.png'))).toBe(false);
      expect(attach.mock.calls[0][1].path).toBe(escapedPath);
    });
  });
});
