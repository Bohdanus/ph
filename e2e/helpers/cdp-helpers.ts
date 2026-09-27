import { type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClipOptions {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Gets the device pixel ratio for the page. */
export async function getDevicePixelRatio(page: Page): Promise<number> {
  return page.evaluate(() => window.devicePixelRatio || 1);
}

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
  // CDP clip coordinates are CSS pixels, and the captured image comes back at
  // `clip_size x clip.scale x deviceScaleFactor` image pixels -- native device pixels,
  // the same as `page.screenshot()`. This helper hardcodes `clip.scale: 1` and does no
  // device-pixel-ratio math of its own, so at deviceScaleFactor 2 a 120x80 CSS clip
  // decodes to 240x160. Only Playwright's own `scale: 'css'` option divides the result
  // by the device scale factor, and that option has no CDP equivalent.
  //
  // Do not assume CSS resolution and do not divide by devicePixelRatio: downstream code
  // derives the scale from the decoded image dimensions instead, so it stays correct at
  // any capture resolution -- screenshotBoundsToCss (canvas-helpers.ts) maps image pixels
  // onto the element's CSS box proportionally, and screenshot-scale.ts is the single
  // implementation both select-move.spec.ts and viewport-drawing.spec.ts use. See
  // cdp-helpers.spec.ts, which pins this behaviour at deviceScaleFactor 1 and 2.
  const captureClip = {
    x: clip?.x ?? box.x,
    y: clip?.y ?? box.y,
    width: clip?.width ?? box.width,
    height: clip?.height ?? box.height,
  };

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
