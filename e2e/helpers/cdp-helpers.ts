import { type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { type ClipOptions, type CssBox as BoundingBox } from './screenshot-scale';

/** Captures a visible viewport-relative canvas clip through Playwright. */
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
  // `\\` is rejected on every host even though it is a legal character in a POSIX filename:
  // the artifact path has to mean one thing everywhere, or a name that is a filename on
  // Linux is a path on Windows. `.` and `..` are directory references rather than filenames
  // even though the appended `.png` would have made them ordinary-looking ones, and an
  // EMPTY name is deliberately still allowed -- it writes `outputDir/.png`, which is inside
  // the directory. Guarded BEFORE any filesystem write, so a rejected name creates nothing.
  if (name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw new Error(
      `captureCanvasScreenshot: the artifact name must be a single path component inside testInfo.outputDir, but got ${JSON.stringify(name)}`
    );
  }

  const screenshotPath = path.join(outputDir, `${name}.png`);
  const readPageState = () =>
    page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    }));
  const pageStateBefore = await readPageState();
  const captureClip = {
    x: clip?.x ?? box.x,
    y: clip?.y ?? box.y,
    width: clip?.width ?? box.width,
    height: clip?.height ?? box.height,
  };

  const clipRight = captureClip.x + captureClip.width;
  const clipBottom = captureClip.y + captureClip.height;
  if (
    captureClip.x < 0 ||
    captureClip.y < 0 ||
    clipRight > pageStateBefore.innerWidth ||
    clipBottom > pageStateBefore.innerHeight
  ) {
    throw new Error(
      `captureCanvasScreenshot: requested viewport clip (${captureClip.x},${captureClip.y},${captureClip.width},${captureClip.height}) extends outside the current viewport (${pageStateBefore.innerWidth}x${pageStateBefore.innerHeight}); refusing to capture a partial region`
    );
  }

  // `box` and `clip` are viewport-relative CSS geometry. Playwright's screenshot API
  // accepts that same coordinate space and applies the page scroll itself. The guard above
  // prevents its viewport crop from silently truncating a requested canvas region. Keep the
  // device scale explicit so HiDPI and emulated-DPR captures retain their pixel detail.
  const screenshot = await page.screenshot({ clip: captureClip, scale: 'device', type: 'png' });
  if (screenshot.length === 0) {
    throw new Error(
      'captureCanvasScreenshot: Playwright returned an empty screenshot, so no file was written or attached'
    );
  }

  // The page may resize or scroll while the screenshot is in flight. Refuse to write
  // pixels whose viewport or clip origin cannot be tied to the caller's measurement.
  const pageStateAfter = await readPageState();
  if (
    pageStateBefore.innerWidth !== pageStateAfter.innerWidth ||
    pageStateBefore.innerHeight !== pageStateAfter.innerHeight ||
    pageStateBefore.scrollX !== pageStateAfter.scrollX ||
    pageStateBefore.scrollY !== pageStateAfter.scrollY
  ) {
    throw new Error(
      `captureCanvasScreenshot: page geometry changed during Playwright screenshot (${pageStateBefore.innerWidth}x${pageStateBefore.innerHeight} at ${pageStateBefore.scrollX},${pageStateBefore.scrollY} -> ${pageStateAfter.innerWidth}x${pageStateAfter.innerHeight} at ${pageStateAfter.scrollX},${pageStateAfter.scrollY}); refusing to write or attach an unverified screenshot`
    );
  }

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(screenshotPath, screenshot);
  await testInfo.attach(name, { path: screenshotPath, contentType: 'image/png' });
  return screenshot;
}
