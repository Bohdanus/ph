import { afterEach, describe, it, expect, vi, type Mock } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { captureCanvasScreenshot } from '../cdp-helpers';
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
  /**
   * The capture scope, declared explicitly. Present here because the helper now sends it and
   * the payload assertions pin it, not because it was ever optional on the helper's part —
   * CDP's own default is to capture beyond the viewport.
   */
  captureBeyondViewport: boolean;
}

type SendSpy = Mock<(method: string, params: CaptureParams) => Promise<{ data?: string }>>;
type DetachSpy = Mock<() => Promise<void>>;
type NewSessionSpy = Mock<(page: Page) => Promise<CDPSession>>;

interface HarnessOptions {
  /** The CDP return value. `{}` models a response that omits `data`. */
  response?: { data?: string };
  sendError?: Error;
  detachError?: Error;
  /** The window offset `captureCanvasScreenshot` reads before it builds its clip. */
  scroll?: { x: number; y: number };
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
  const scroll = options.scroll ?? { x: 0, y: 0 };
  const evaluate = vi.fn(async (pageFunction: () => unknown) => pageFunction()) as unknown as Mock<Page['evaluate']>;
  vi.stubGlobal('window', { scrollX: scroll.x, scrollY: scroll.y });

  return {
    page: createPageMock({ context, evaluate }),
    send,
    detach,
    newCDPSession,
    outputDirExistedAtSession: () => outputDirExistedAtSession,
  };
}

/**
 * The reason a promise rejected, as an `Error`.
 *
 * `expect(p).rejects.toThrow(...)` matches a message and cannot reach an identity, and
 * two of the cases below are about WHICH error the caller is handed and what is attached
 * underneath it. A resolution is a failure of the case, not a `undefined` reason to assert
 * on: the old `toolbar-helpers.unit.test.ts` idiom rejects with a message naming both.
 */
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

describe('CDP Helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * PINS for the module's own contract. Two of the three transferred findings in this
   * file group are a comment and a deletion, so neither is visible to any assertion made
   * *through* the helper: a wrong comment and a re-added export both pass the whole
   * `captureCanvasScreenshot` suite. These read the module the way the next agent will —
   * its text and its exported surface — so a regression fails as a named test instead of
   * as a silently wrong file.
   */
  describe('the capture scale contract as written down', () => {
    const SOURCE = readFileSync(new URL('../cdp-helpers.ts', import.meta.url), 'utf8');
    const COMMENTS = SOURCE.split('\n')
      .filter((line) => /^\s*\/\//.test(line))
      .join('\n');

    it('does not restate the deviceScaleFactor multiplication the sibling spec disproved', () => {
      // FINDING, pinned: the comment used to assert that a capture comes back at the clip
      // extent x clip scale x deviceScaleFactor, that this is "the same as
      // `page.screenshot()`", and that a 120x80 CSS clip decodes to 240x160 at
      // deviceScaleFactor 2. `cdp-helpers.spec.ts` measured all three false: CDP captures
      // at Chrome's surface scale, which the emulated ratio does not change, while
      // `page.screenshot({clip})` does scale with it. None of the three is reproduced in
      // the corrected comment even in order to refute it, so a re-introduction cannot hide
      // inside its own negation.
      expect(SOURCE).not.toMatch(/clip[ _]size\s*[x×]\s*clip\.scale\s*[x×]\s*deviceScaleFactor/i);
      expect(SOURCE).not.toMatch(/same as\s+`?page\.screenshot\(\)`?/i);
      expect(SOURCE).not.toMatch(/120x80[\s\S]{0,120}240x160/);
    });

    it('states the mechanism the sibling spec measured instead', () => {
      // The replacement has to be assertable too, or the test above only forbids the old
      // wording and says nothing about the new. `surface scale` is Chrome's own capture
      // scale; the second assertion is the part a reword is most likely to drop — that the
      // emulated ratio is not what determines the capture.
      expect(COMMENTS).toMatch(/surface scale/i);
      expect(COMMENTS).toMatch(/deviceScaleFactor` does not change it/i);
    });

    it('does not export getDevicePixelRatio', async () => {
      // FINDING, pinned: the export had no caller outside this file and its spec, and
      // existed only to keep "divide by devicePixelRatio" one import away — the strategy
      // `screenshot-scale.ts` rejects by design. Asserted on the runtime surface rather
      // than on the text, so a re-export under any spelling of the source fails.
      const exported = await import('../cdp-helpers');
      expect(Object.keys(exported).sort()).toEqual(['captureCanvasScreenshot']);
      expect(exported).not.toHaveProperty('getDevicePixelRatio');
    });

    it('does not name getDevicePixelRatio in the helper or its spec', () => {
      // Complements the surface check, and catches the other half of a re-invitation:
      // re-declaring the identifier in the helper (unexported, or exported by re-export),
      // or importing it into the spec again. Deliberately scoped to the two files this
      // finding names — `canvas-helpers.ts` and `.skills/photoshop-tool-creation.md` also
      // mention the identifier in prose under other owners, and widening the scope would
      // make this test permanently red for something it cannot fix.
      for (const file of ['../cdp-helpers.ts', '../cdp-helpers.spec.ts']) {
        expect(readFileSync(new URL(file, import.meta.url), 'utf8'), file).not.toMatch(/getDevicePixelRatio/);
      }
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
        captureBeyondViewport: false,
        clip: { ...BOX, scale: 1 },
      });
    });

    it('declares the capture scope explicitly, rather than inheriting Chrome’s default', async () => {
      const outputDir = await makeOutputDir('capture-scope');
      const { page, send } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'scope');

      // The seven payload assertions above already carry it, so this is not a new claim —
      // it is a claim that the flag is a DECISION rather than a field that happens to be in
      // the object, and the difference matters because the drift this addresses is still
      // open (`e2e/OPEN_PROBLEMS.md`, the 87px capture). A later edit that drops the flag to
      // "tidy up" passes every other test here, because `toHaveBeenCalledWith` with an exact
      // object would fail loudly — so this one exists to say the flag is load-bearing even
      // though the failure it was added for is not fixed.
      const [, params] = send.mock.calls[0];
      expect(params).toMatchObject({ captureBeyondViewport: false });
      // Not merely present: `true` is the value that captures beyond the viewport, and a
      // future reader who reads it as "capture more" would be right about the API and wrong
      // about the intent.
      expect(params.captureBeyondViewport).toBe(false);
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
        captureBeyondViewport: false,
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
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 0, height: 0, scale: 1 },
      });
    });

    it('forwards a negative clip origin to CDP unchanged instead of clamping it', async () => {
      // A canvas scrolled partly out of the viewport has a negative origin. Clamping
      // it to 0 would capture a different region than the caller measured. At scroll 0
      // a negative origin is already a document origin, so the translation below is the
      // identity and this still holds.
      const outputDir = await makeOutputDir('negative-clip');
      const { page, send } = createCdpHarness(outputDir);
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'negative', { x: -20, y: -10, width: 30, height: 40 });

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: -20, y: -10, width: 30, height: 40, scale: 1 },
      });
    });

    // The regression this translation exists for. `Page.captureScreenshot` is called
    // directly here, so Playwright never gets to apply the window offset that
    // `page.screenshot({ clip })` applies on the caller's behalf: measured on a marker at
    // document y=600 with the window scrolled to 440, a viewport-relative clip captures
    // nothing and the page-relative one captures the marker. Sending `box`/`clip` raw
    // therefore put every CDP read 440px from the region the caller measured, which reads
    // as a wrong answer rather than an error.
    it('translates a viewport-relative clip into the page coordinates CDP wants', async () => {
      const outputDir = await makeOutputDir('scrolled-clip');
      const { page, send } = createCdpHarness(outputDir, { scroll: { x: 0, y: 440 } });
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, { ...BOX, y: -340 }, testInfo, 'scrolled');

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: BOX.x, y: 100, width: BOX.width, height: BOX.height, scale: 1 },
      });
    });

    it('translates an explicit clip, not just the fallback box', async () => {
      const outputDir = await makeOutputDir('scrolled-explicit-clip');
      const { page, send } = createCdpHarness(outputDir, { scroll: { x: 30, y: 440 } });
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'scrolled-clip', {
        x: BOX.x + 20,
        y: -190,
        width: 100,
        height: 60,
      });

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: BOX.x + 50, y: 250, width: 100, height: 60, scale: 1 },
      });
    });

    it('reads the window offset once per capture, not once per module', async () => {
      // The offset is read at the call site on purpose: `clickToolButton` scrolls the
      // window, so an offset cached at import time is a different number before and after
      // any tool click.
      const outputDir = await makeOutputDir('scroll-read-per-capture');
      const { page, send } = createCdpHarness(outputDir, { scroll: { x: 0, y: 440 } });
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'first');
      await captureCanvasScreenshot(page, BOX, testInfo, 'second');

      expect((page.evaluate as unknown as Mock).mock.calls.length).toBe(2);
      for (const call of send.mock.calls) {
        expect(call[1].clip.y).toBe(BOX.y + 440);
      }
    });

    it('sends the untranslated clip at scroll 0, so nothing moves when the page does not', async () => {
      const outputDir = await makeOutputDir('unscrolled-clip');
      const { page, send } = createCdpHarness(outputDir, { scroll: { x: 0, y: 0 } });
      const { testInfo } = createTestInfoMock(outputDir);

      await captureCanvasScreenshot(page, BOX, testInfo, 'unscrolled', { x: 10, y: 20, width: 30, height: 40 });

      expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        clip: { x: 10, y: 20, width: 30, height: 40, scale: 1 },
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

    it('names the helper and the CDP request when the response carries no data, and detaches', async () => {
      // The fix this replaced: `Buffer.from(undefined, 'base64')` answered with Node's
      // `The first argument must be of type string or an instance of Buffer, ...`, which
      // names neither CDP nor this helper nor the test. So the MESSAGE is the fix, not
      // the error class: naming the helper and the request that produced the response is
      // what lets a reader act on the failure without first finding the call site, and an
      // assertion of the form `rejects.toThrow(Error)` would pass a fix that replaced the
      // TypeError with an equally opaque message.
      const outputDir = await makeOutputDir('missing-data');
      const { page, send, detach } = createCdpHarness(outputDir, { response: {} });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'missing'));

      expect(error.message).toContain('captureCanvasScreenshot');
      expect(error.message).toContain('Page.captureScreenshot');
      // Absent and empty are different faults with the same call site, so the message has
      // to tell them apart — and neither may be the raw Node text any more.
      expect(error.message).toMatch(/no base64 `data` to decode \(received undefined\)/);
      expect(error.message).not.toMatch(/first argument must be of type string/);
      // A malformed response costs the capture, never the cleanup: the write and the
      // attach are both still ahead of the failure, and the session is still detached.
      expect(send).toHaveBeenCalledTimes(1);
      expect(attach).not.toHaveBeenCalled();
      expect(existsSync(path.join(outputDir, 'missing.png'))).toBe(false);
      expect(detach).toHaveBeenCalledTimes(1);
    });

    it('rejects a capture that decodes to no bytes, instead of reporting success, and detaches', async () => {
      // `{ data: '' }` is a PRESENT, correctly-typed response, which is exactly why a
      // `typeof data === 'string'` guard alone is not the fix: it lets this through, and
      // the helper then wrote, attached and RETURNED a 0-byte PNG as a successful capture.
      // The subject asserted here is therefore the DECODED LENGTH, so this case fails
      // against a type-only guard and against one that checks the string's length rather
      // than the payload's. The fault it used to produce surfaced far from its cause, in
      // `loadImageData` (canvas-helpers.ts:541), naming the consumer instead.
      const outputDir = await makeOutputDir('empty-data');
      const { page, detach } = createCdpHarness(outputDir, { response: { data: '' } });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'empty'));

      expect(error.message).toContain('captureCanvasScreenshot');
      expect(error.message).toContain('Page.captureScreenshot');
      expect(error.message).toMatch(/decoded to 0 bytes/);
      // Before the write and before the attach, which were the two observable halves of
      // the old success: a 0-byte file in outputDir, and a non-image attached to the report.
      expect(existsSync(path.join(outputDir, 'empty.png'))).toBe(false);
      expect(attach).not.toHaveBeenCalled();
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

    it('reports the capture failure when the detach also fails, hanging the detach off it as cause', async () => {
      // The fix this replaced: `finally { await cdp.detach() }` means a rejecting detach
      // REPLACES the in-flight error, so the caller was handed the detach's message and
      // never learned the capture had failed at all. This is the likely pairing rather
      // than a corner — a capture fails most often when the page or the target is already
      // gone, which is precisely when the detach fails too. So the capture's error is the
      // rejection, by identity and by message, and the detach's is REACHABLE underneath
      // it rather than discarded: replacing the one with the other loses the cause, and
      // swallowing the detach loses the session.
      const outputDir = await makeOutputDir('both-fail');
      const captureError = new Error('capture exploded');
      const detachError = new Error('detach exploded');
      const { page, detach } = createCdpHarness(outputDir, { sendError: captureError, detachError });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'both'));

      expect(error).toBe(captureError);
      expect(error.message).toBe('capture exploded');
      expect(error.cause).toBe(detachError);
      // The detach is still ATTEMPTED on this path: once, not twice, and not zero.
      expect(detach).toHaveBeenCalledTimes(1);
      expect(attach).not.toHaveBeenCalled();
      expect(existsSync(path.join(outputDir, 'both.png'))).toBe(false);
    });

    it('reports a detach failure on its own when the capture succeeded, rather than swallowing it', async () => {
      // The other half of the fix, and the half a "just log the detach error" patch drops:
      // with nothing already failing there is no cause to preserve, and a session that
      // cannot be closed is the leak this helper exists to prevent — see 'waits for the
      // session to detach before it resolves'. So the detach's error is the rejection here,
      // unchanged, and a fix that made the detach quiet unconditionally fails this case.
      const outputDir = await makeOutputDir('detach-only-failure');
      const detachError = new Error('detach exploded');
      const { page, detach } = createCdpHarness(outputDir, { detachError });
      const { testInfo, attach } = createTestInfoMock(outputDir);

      const error = await rejectionOf(captureCanvasScreenshot(page, BOX, testInfo, 'detach-only'));

      expect(error).toBe(detachError);
      expect(error.message).toBe('detach exploded');
      // No capture failure to point at, so nothing is attached to the detach's error —
      // the success path does not invent a cause.
      expect(error.cause).toBeUndefined();
      // The capture itself succeeded, and it ran before the detach, so its artifact is on
      // disk and attached: the detach failure does not retroactively unwrite it.
      expect(existsSync(path.join(outputDir, 'detach-only.png'))).toBe(true);
      expect(attach).toHaveBeenCalledTimes(1);
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
