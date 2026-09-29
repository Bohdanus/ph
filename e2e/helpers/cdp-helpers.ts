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
  // numbers. Measured: this app is 1177px tall in a 720px window, `clickToolButton`
  // scrolls it 440px, and the canvas box moves from y=100 to y=-340; captured
  // untranslated, the region came back 440px away from the one measured, which reads as
  // a wrong answer rather than an error. The offset is read here, per capture, because
  // the window scrolls between captures. `viewportRectToPageRect` carries the detail.
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

  try {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...captureClip, scale: 1 },
    });
    const screenshot = Buffer.from(data, 'base64');
    await fs.writeFile(screenshotPath, screenshot);
    await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
    return screenshot;
  } finally {
    await cdp.detach();
  }
}
