import { type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getPageScroll } from './canvas-helpers';
import { type ClipOptions, type CssBox as BoundingBox, viewportRectToPageRect } from './screenshot-scale';

/** Captures a canvas region through CDP to avoid headed screenshot hangs. */
export async function captureCanvasScreenshot(
  page: Page,
  box: BoundingBox,
  testInfo: TestInfo,
  name: string,
  clip?: ClipOptions
): Promise<Buffer> {
  const outputDir = testInfo.outputDir;
  if (typeof outputDir !== 'string' || outputDir === '') {
    throw new Error('captureCanvasScreenshot: testInfo.outputDir is required to capture and attach a screenshot');
  }
  // `name` is caller data interpolated into a path, so `path.join` alone decided where the
  // artifact landed, and neither answer was a file in the directory Playwright owns:
  //
  //   - a name with a SEPARATOR (`nested/thing`) reached the filesystem as a path and
  //     failed with `ENOENT` on a parent directory nothing had created, naming a file
  //     the caller never asked for;
  //   - a name that TRAVERSES (`../escaped`) resolved one level ABOVE `outputDir`, and
  //     that path was written and then ATTACHED, so the artifact the report carried was
  //     outside the directory any cleanup of the output dir would reach.
  //
  // So `name` has to be a single path component, and this is a REJECTION rather than a
  // rewrite for the reason the `outputDir` guard above throws: the caller passed
  // something impossible, and silently rewriting it would attach the report under a name
  // the test never asked for. Sanitising would also let two distinct names collide into
  // one artifact, so the second write would overwrite the first without a word.
  //
  // `\` is rejected on every host even though it is a legal character in a POSIX filename:
  // the artifact path has to mean one thing everywhere, or a name that is a filename on
  // Linux is a path on Windows. `.` and `..` are directory references rather than filenames
  // even though the appended `.png` would have made them ordinary-looking ones, and an
  // EMPTY name is deliberately still allowed -- it writes `outputDir/.png`, which is inside
  // the directory. Guarded BEFORE the `mkdir` and before the CDP session is opened, so a
  // rejected name creates nothing and leaves no session behind to detach.
  if (name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(
      `captureCanvasScreenshot: the artifact name must be a single path component inside testInfo.outputDir, but got ${JSON.stringify(name)}`
    );
  }
  const screenshotPath = path.join(outputDir, `${name}.png`);
  await fs.mkdir(outputDir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  // CDP clip coordinates are CSS pixels. The decoded image, however, is NOT at the clip
  // extent times the clip scale times the emulated ratio, and it is NOT equivalent to
  // `page.screenshot()`: this comment used to assert both, and the sibling spec measured
  // both false.
  //
  // `Page.captureScreenshot` bypasses Playwright's device emulation entirely and captures at
  // Chrome's own surface scale. The emulated `deviceScaleFactor` does not change it:
  // measured there, a 240x160 CSS clip decoded to 480x320 while `window.devicePixelRatio`
  // reported 1, and sweeping `deviceScaleFactor` over 1, 2 and 3 produced the same 480.
  // `page.screenshot({ clip })` is the opposite -- Playwright applies the emulated ratio
  // itself -- which is why the two cannot be compared on size here.
  //
  // So the `clip.scale: 1` below pins only "no extra scaling of my own"; it promises
  // nothing about the output resolution, and CDP has no equivalent of Playwright's
  // `scale: 'css'`. Do not assume CSS resolution, do not assume the emulated ratio, and do
  // not divide by devicePixelRatio: downstream code derives the scale from the decoded
  // image dimensions instead, so it stays correct at any capture resolution --
  // screenshotBoundsToCss (canvas-helpers.ts) maps image pixels onto the element's CSS box
  // proportionally, and screenshot-scale.ts is the single implementation both
  // select-move.spec.ts and viewport-drawing.spec.ts use. `cdp-helpers.spec.ts` pins the
  // part that does hold in every mode: the capture is exactly the requested rect, at one
  // integral scale shared by both axes.
  //
  // `box` and `clip` arrive viewport-relative (that is what `boundingBox()` returns),
  // but this helper talks to CDP directly and so bypasses the translation Playwright
  // would otherwise apply: `Page.captureScreenshot` reads its clip against the DOCUMENT
  // origin. That asymmetry is the whole reason the conversion is here and not in the
  // callers -- `page.screenshot` and this function want opposite spaces for the same
  // numbers. The offset is read here, per capture, because the window scrolls between
  // captures. `viewportRectToPageRect` carries the detail.
  //
  // The `1177px`/`440px` worked example that used to sit here — "this app is 1177px tall in a
  // 720px window, `clickToolButton` scrolls it 440px" — was true when the rail's default was
  // two columns and is FALSE now. The rail fits the window by design: its tiles are fitted to
  // the space they have and the rest move into the three-dots tile, so the page does not
  // outgrow the viewport at any width. The conversion is still correct and still needed, and
  // this is a much better example for it: `preservingScroll` in `toolbar-helpers.ts` scrolls
  // before an interaction, so a page CAN scroll under a test that never intended to scroll it.
  const scroll = await getPageScroll(page);
  const captureClip = viewportRectToPageRect(
    {
      x: clip?.x ?? box.x,
      y: clip?.y ?? box.y,
      width: clip?.width ?? box.width,
      height: clip?.height ?? box.height,
    },
    scroll
  );

  // Held rather than returned from the `try`, so the detach below can be told whether the
  // capture is already failing. `finally { await cdp.detach() }` could not, which is the
  // whole of defect 3: a rejecting detach became the rejection the caller saw.
  let capture: { readonly screenshot: Buffer } | { readonly error: unknown };
  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...captureClip, scale: 1 },
      // FALSE, explicitly, and it is here as the DOCUMENTED scope rather than as a fix.
      //
      // Left unset, `Page.captureScreenshot` captures beyond the viewport. With it unset this
      // helper has been observed returning a plausible screenshot of a page that is not the
      // one the caller measured: `viewport-drawing.spec.ts`'s guard caught `window.innerHeight`
      // reporting 700 before a capture in a 700px window and 613 after, and 900 before and 813
      // after in a 900px one — the same 87px both times, with this call the only thing between
      // the two readings. The caller then maps a stroke it measured under the OLD layout
      // through the NEW one, and the mismatch reads as a geometry bug in the app: it produced
      // a 32.5px error on a page whose coordinate mapping is self-consistent and exact.
      //
      // **This flag did not eliminate it.** Across 50 controlled captures at a fixed viewport
      // the drift did not reproduce with it set, which is consistent with a race rather than
      // with a scope problem, and `e2e/OPEN_PROBLEMS.md` carries the open problem with the
      // signature. What the flag does buy is that the scope is stated rather than inherited
      // from whatever Chrome's default happens to be, and nothing is lost by stating it: the
      // clip is inside the viewport by construction, so there is nothing beyond it to capture.
      captureBeyondViewport: false,
    });
    // ONE guard for the two ways a `Page.captureScreenshot` response can carry no image,
    // because they arrive on the same two lines and a second guard there would only
    // restate the first. The decode used to be a bare `Buffer.from(data, 'base64')` with
    // no validation of any kind, and the two ways it went wrong point in opposite
    // directions, which is why one condition is not enough and one message is not either:
    //
    //   - `data` absent, so the decode threw Node's `The first argument must be of type
    //     string or an instance of Buffer, ...` — naming neither CDP, nor this helper, nor
    //     the test, so the reader had to find the call site to learn what failed;
    //   - `data` present and non-empty as a string but decoding to zero bytes, which was
    //     written, attached and RETURNED as a successful capture. Nothing here noticed,
    //     so the fault surfaced at the far end of the pipeline instead, in `loadImageData`
    //     (`canvas-helpers.ts:541`), which raised a decode error about the FILE and named
    //     the consumer rather than the capture that had produced nothing.
    //
    // The condition tests the DECODED length, not `typeof data`, because the second case
    // is a present, correctly-typed response: `{ data: '' }` passes a typeof guard and
    // still decodes to nothing. Decoding first (when the field is a string at all) is what
    // makes one condition able to answer both questions.
    const screenshot = typeof data === 'string' ? Buffer.from(data, 'base64') : null;
    if (screenshot === null || screenshot.length === 0) {
      throw new Error(
        screenshot === null
          ? `captureCanvasScreenshot: the Page.captureScreenshot response carried no base64 \`data\` to decode (received ${typeof data}), so no screenshot was written or attached`
          : 'captureCanvasScreenshot: the Page.captureScreenshot response decoded to 0 bytes, so no screenshot was written or attached'
      );
    }
    await fs.writeFile(screenshotPath, screenshot);
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
    capture = { screenshot };
  } catch (error) {
    capture = { error };
  }

  // The detach runs on both paths, and it is awaited on both, because a CDP session that
  // outlives this call is the leak the helper exists to prevent.
  //
  // What it must not do is REPLACE an in-flight capture failure. The pairing that used to
  // lose the cause is the likely one rather than a corner: a capture fails most often when
  // the page or the target is already gone, which is exactly when the detach fails too, so
  // the caller was told the session could not be closed and never learned the capture
  // failed. So the capture's error is what is thrown, and the detach's is recorded as its
  // `cause` — neither is lost, and the message still names the fault.
  //
  // With no capture failure there is nothing to preserve, so a rejecting detach is the
  // rejection and is NOT swallowed: an unclosed session is the leak above.
  let detachFailure: { readonly error: unknown } | undefined;
  try {
    await cdp.detach();
  } catch (error) {
    detachFailure = { error };
  }

  if ('error' in capture) {
    if (detachFailure !== undefined && capture.error instanceof Error) {
      // `cause` is a writable own property of `Error` (ES2022), so the capture error keeps
      // its identity, its message and its stack and only gains the detach underneath. A
      // thrown non-Error is rethrown untouched: nothing here throws one.
      (capture.error as { cause?: unknown }).cause = detachFailure.error;
    }
    // The capture error, always — this is the line the defect lived on. A conditional here
    // (`detachFailure === undefined ? capture.error : detachFailure.error`) reads like the
    // symmetry it appears to be and reinstates the exact masking being fixed: the caller
    // gets the detach's message and the capture's cause, now carrying a `cause` nobody
    // ever sees, becomes unreachable. The `cause` above is what makes the detach's failure
    // reachable WITHOUT giving it the rejection.
    throw capture.error;
  }
  if (detachFailure !== undefined) throw detachFailure.error;
  return capture.screenshot;
}
