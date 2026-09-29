import { expect, test, type TestInfo } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compareScreenshots } from '../helpers/image-comparison';
import { containFit, DEFAULT_DOCUMENT_SIZE, getWorkspaceCanvas } from '../helpers/canvas-helpers';
import { clickToolButton } from '../helpers/toolbar-helpers';
import {
  assertExportGeometry,
  exportAndVerify,
  exportFormats,
  exportIcoAndVerify,
  INTEGRATION_TEST_TIMEOUT_MS,
  mimeType,
  setupExportTest,
  setupIcoTest,
} from './helpers';

const formats = exportFormats.filter((f) => f.comparePixels);

/** Sub-directory of the committed snapshot directory that holds the baseline PNGs. */
const BASELINE_DIR = 'export-baselines';

/**
 * Absolute path of a committed baseline PNG.
 *
 * `testInfo.snapshotDir` is Playwright's own per-file snapshot directory and already
 * resolves to `tests/export/visual-regression.spec.ts-snapshots`, which is where the
 * baselines are committed. `testInfo.snapshotPath` is deliberately not used: its default
 * template appends `-<projectName>-<platform>` to the stem, so it resolves to
 * `drawing.png-Google-Chrome-darwin.png` — a file that is not committed, and one that
 * would differ per operating system, leaving a baseline committed on one OS to read as
 * "missing" on every other one.
 */
function baselineFile(testInfo: TestInfo, fileName: string): string {
  return path.join(testInfo.snapshotDir, BASELINE_DIR, fileName);
}

test.describe('Export visual regression', () => {
  for (const format of formats) {
    test(`exports to ${format.label} (${format.extension}) matches visual baseline`, async ({ page }, testInfo) => {
      test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

      const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo);
      const artifactPath = await exportAndVerify(page, format, sourceDataUrl, downloadDirectory, testInfo);

      const file = await readFile(artifactPath);
      const exportedScreenshot = await page.evaluate(
        async ({ data, mime }) => {
          const loadImage = (src: string) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(new Error('Failed to load image'));
              image.src = src;
            });
          const exportedImage = await loadImage(`data:${mime};base64,${data}`);
          const canvas = document.createElement('canvas');
          canvas.width = exportedImage.width;
          canvas.height = exportedImage.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(exportedImage, 0, 0);
          return canvas.toDataURL('image/png').split(',')[1];
        },
        { data: file.toString('base64'), mime: mimeType(format.extension) }
      );

      const exportedBuffer = Buffer.from(exportedScreenshot, 'base64');
      const baselineFilePath = baselineFile(testInfo, `drawing${format.extension}.png`);

      // `updateSnapshots` is a string union ('all' | 'changed' | 'missing' | 'none')
      // whose DEFAULT is 'missing', which is truthy. A bare truthiness check therefore
      // always took this branch: every run rewrote the committed baseline and returned
      // before comparing, so `compareScreenshots` and the assertion below it were
      // unreachable and the committed oracle was disposable. Only an explicit
      // --update-snapshots ('all') may re-record a baseline.
      if (testInfo.config.updateSnapshots === 'all') {
        await mkdir(path.dirname(baselineFilePath), { recursive: true });
        await writeFile(baselineFilePath, exportedBuffer);
        testInfo.annotations.push({ type: 'baseline-recorded', description: baselineFilePath });
        return;
      }

      const baseline = await readFile(baselineFilePath).catch(() => null);
      if (!baseline) {
        await testInfo.attach(`${format.label}-baseline-missing`, { body: exportedBuffer, contentType: 'image/png' });
        throw new Error(`Baseline missing for ${format.label}. Run with --update-snapshots to create.`);
      }

      const result = await compareScreenshots(exportedBuffer, baseline, {
        threshold: 0.01,
        maxDiffPixels: 100,
      });
      expect(
        result.matches,
        `Visual mismatch for ${format.label}: ${result.diffPixels} diff pixels (ratio: ${result.diffRatio.toFixed(4)})`
      ).toBe(true);

      // The pixel diff above is the oracle that has always been there, and it is
      // asymmetric: the test line is 174x11 and horizontal, so a vertical move relights
      // every column of the band while a horizontal move relights only the two round caps.
      // Measured against the committed `drawing.png.png` with this exact configuration, a
      // 0.0154-document-pixel VERTICAL shift fails (330 diff pixels) while a
      // 1.0-document-pixel HORIZONTAL shift produces 88 and passes, and 1.25 is the first
      // horizontal failure. So the axis a sidebar width change, a DPR change or a rounding
      // difference moves was the one the oracle barely saw.
      //
      // The geometric assertion closes that axis, on both, by measuring the mark rather than
      // counting disturbed pixels. It needs no re-recorded baseline and it does not relax
      // anything: the pixel diff still runs first and still has to pass.
      await assertExportGeometry(exportedBuffer, baseline, format.label);
    });
  }

  /**
   * The export must be a function of the document, not of the window.
   *
   * This is the pin for the decoupling, and it is stated as a property rather than as a
   * baseline because a baseline cannot express it: the original failure was that fixing a
   * desktop overflow changed the canvas from 974x890 to 974x583, which moved a
   * canvas-relative test line and failed seven pixel comparisons with no change in the
   * export path. The same line, specified in document space, must render identically at
   * both canvas heights.
   *
   * 890 and 583 are the two measured canvas heights for a 1280x720 window, before and after
   * the grid-overflow fix. Any future change to the shell's layout is therefore covered: if
   * it moves the canvas, this test still passes, and so do the seven baseline comparisons
   * above.
   */
  test('the export is independent of the canvas height', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const dataUrlAtHeight = async (height: number) => {
      await page.setViewportSize({ width: 1280, height });
      const { sourceDataUrl } = await setupExportTest(page, testInfo);
      return sourceDataUrl;
    };

    const tall = await dataUrlAtHeight(720);
    const short = await dataUrlAtHeight(560);

    // A different canvas height really is in play, or this proves nothing.
    const canvases = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="workspace-canvas"]') as HTMLCanvasElement;
      return { w: c.width, h: c.height };
    });
    expect(canvases, 'the backing store is the document size at any viewport').toEqual({
      w: 800,
      h: 600,
    });

    expect(short, 'the same document line must export identically at a different canvas height').toBe(tall);
  });

  /**
   * The same property along the axis nothing had ever varied: WIDTH.
   *
   * The height test above was the fix for the 974x890 -> 974x583 regression, and the width
   * axis was left entirely unexercised: the box there is `974x840`, whose `offsetX` is
   * exactly 0 because the width is the binding constraint, so no unit test's box, and no
   * spec's viewport, ever moved `offsetX` on its own. A sidebar-width change is the
   * operator's named case, and at a box that is width-limited it moves `scale` — which
   * moves the canvas position of a document point by a different amount on every axis.
   *
   * One pixel is the whole claim. A 1280-wide window and a 1281-wide window differ in the
   * sidebar's share of nothing at all; if the export changes across that, the export is a
   * function of the frame.
   */
  test('the export is independent of the canvas width', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const dataUrlAtWidth = async (width: number) => {
      await page.setViewportSize({ width, height: 720 });
      const { sourceDataUrl, box, documentSize } = await setupExportTest(page, testInfo);
      return { sourceDataUrl, canvasWidth: box.width, documentSize };
    };

    const narrow = await dataUrlAtWidth(1280);
    const wide = await dataUrlAtWidth(1281);

    // A different canvas width really is in play, or this proves nothing.
    expect(wide.canvasWidth, 'the canvas really did get a pixel wider').toBe(narrow.canvasWidth + 1);
    expect(wide.documentSize, 'a wider frame does not resize the document').toEqual(narrow.documentSize);
    expect(narrow.documentSize, 'the document is the seeded 800x600').toEqual(DEFAULT_DOCUMENT_SIZE);

    expect(wide.sourceDataUrl, 'a 1px wider frame must not move the document by a single pixel').toBe(
      narrow.sourceDataUrl
    );
  });

  /**
   * The e2e suite's `documentToCanvasOffset` re-implements the app's contain fit, and until
   * now NOTHING compared the two. The unit round-trip that claimed to was comparing the
   * helper against its own algebraic inverse, so it could not fail and never asked the app
   * anything — and the helper is the function that decides which document pixel the export
   * baseline is comparing. If it drifted, every document-space spec would be measuring a
   * pixel the app never drew, and would say so with a baseline comparison rather than an
   * error.
   *
   * `usePointerPosition` publishes the fit it actually computed on the container as
   * `data-fit-*`, and this is that comparison. It runs at two widths as well as two heights,
   * because at a width-limited box `offsetX` is 0 exactly and a width-only change is the one
   * that would expose an asymmetry in the rule.
   */
  test('the document mapping agrees with the fit the app itself computed', async ({ page }) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const agreementAt = async (width: number, height: number) => {
      await page.setViewportSize({ width, height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const container = page.getByTestId('workspace-container');
      // The test id is on `<main>`, which is mounted for every tool, so this asserts the
      // element exists and is laid out before any tool is chosen. Only the `data-fit-*`
      // VALUES need a tool that calls `usePointerPosition`.
      await expect(container).toBeVisible();
      // The fit is published by the tool areas, so a tool that mounts one has to be active
      // for the attributes to exist at all. `DummyToolArea` uses no `usePointerPosition`.
      await clickToolButton(page, 'draw');

      // The app publishes the nine attributes in one synchronous block from the tool area's
      // mount effect, which React schedules rather than runs inside the click, so reading them
      // once straight after the click is a race with the scheduler. Waiting for one of them
      // removes the race without adding a sleep: all nine are set together, so the first to
      // exist implies the rest do, and the `read` below still throws naming any that is
      // missing or non-numeric.
      await expect(container).toHaveAttribute('data-fit-scale', /.+/);

      const canvas = getWorkspaceCanvas(page);
      const canvasBox = await canvas.boundingBox();
      if (!canvasBox) throw new Error('Canvas not found');

      const published = await container.evaluate((node) => {
        const read = (name: string) => {
          const raw = node.getAttribute(name);
          if (raw === null) throw new Error(`the app published no ${name}`);
          const value = Number(raw);
          if (!Number.isFinite(value)) throw new Error(`${name} is not a number: ${raw}`);
          return value;
        };
        return {
          scale: read('data-fit-scale'),
          offsetX: read('data-fit-offset-x'),
          offsetY: read('data-fit-offset-y'),
          outerWidth: read('data-fit-outer-width'),
          outerHeight: read('data-fit-outer-height'),
          documentWidth: read('data-fit-document-width'),
          documentHeight: read('data-fit-document-height'),
          rectX: read('data-fit-rect-x'),
          rectY: read('data-fit-rect-y'),
        };
      });

      // The container rect is the rect the fit was computed from, so it is the rect the
      // helper must be given. Pinned here because nothing stated it before: `<main>` carries
      // no padding or border and the canvas is `h-full w-full` of it, which is WHY the two
      // agree. A future border on `<main>` would break the export silently.
      expect(
        { x: published.rectX, y: published.rectY, width: published.outerWidth, height: published.outerHeight },
        "the app's container rect is the canvas rect, and the fit was computed from it"
      ).toEqual(canvasBox);

      expect(
        { width: published.documentWidth, height: published.documentHeight },
        'the app fitted the seeded 800x600 document'
      ).toEqual(DEFAULT_DOCUMENT_SIZE);

      const documentSize = { width: published.documentWidth, height: published.documentHeight };
      const helperFit = containFit(canvasBox, documentSize);
      expect(helperFit.scale, 'the helper and the app agree on the contain scale').toBe(published.scale);
      expect(helperFit.offsetX, 'the helper and the app agree on the horizontal letterbox').toBe(published.offsetX);
      expect(helperFit.offsetY, 'the helper and the app agree on the vertical letterbox').toBe(published.offsetY);

      // ------------------------------------------------------------------------------------
      // WHAT IS AND IS NOT PROVEN HERE, because a review found this leg cannot fail and the
      // commit that added it claimed otherwise.
      //
      // The three `toBe` assertions above are the load-bearing ones. They put the app's
      // PUBLISHED numbers on one side and the helper's independently computed `containFit`
      // on the other, so a drift between the two is a failure. Setting `offsetX` to 0 in
      // `containFit` — ignoring the horizontal letterbox — turns them red.
      //
      // The round trip below is an IDENTITY and cannot fail. It builds a client coordinate
      // from the app's own scale and offsets and then inverts that same arithmetic, so
      // loosening its precision from 9 digits to 0 leaves it green. It is kept because it
      // documents the mapping and would catch a sign error or a swapped axis, but it is NOT
      // evidence that the helper agrees with the app, and nothing else here should be
      // described that way. The agreement is the `toBe` trio; this is arithmetic.
      // ------------------------------------------------------------------------------------
      // The round trip that used to be tautological, now with the app's own numbers on
      // one side: a document point goes out as a client coordinate and the app's `scale` and
      // `offsetX`/`offsetY` bring it back to the document point it started as.
      //
      // `toBeCloseTo(…, 9)` and NOT `toBe`, because this round trip cannot be exact and never
      // was: the leg is `x -> (box.x + offsetX + x*scale) -> (that - offsetX - box.x)/scale`,
      // and both the multiply and the cancelling subtractions are floating point. At the
      // 6-decimal document point this file was already pinned to, `123.203285` is not a
      // representable double, so the trip back lands on `123.20328499999997` - about 2 ULP,
      // and a difference `toBe` reports as a failure of the app's mapping when nothing moved.
      // `9` digits is ~5e-10 document pixels: four orders of magnitude above the rounding this
      // leg actually produces, and seven orders below the tightest threshold the export oracle
      // itself resolves (a 0.01-document-pixel vertical shift already passes pixelmatch), so a
      // real drift in the fit - which would be O(1) document pixels - still fails loudly. It
      // is the same tolerance `screenshot-scale.unit.test.ts:272-280` uses for its round trip.
      for (const point of [
        { x: 0, y: 0 },
        { x: 123.203285, y: 78.234086 },
        { x: 800, y: 600 },
        { x: 400, y: 300 },
      ]) {
        const clientX = canvasBox.x + published.offsetX + point.x * published.scale;
        const clientY = canvasBox.y + published.offsetY + point.y * published.scale;
        expect(
          (clientX - published.offsetX - canvasBox.x) / published.scale,
          'document x survives the round trip'
        ).toBeCloseTo(point.x, 9);
        expect(
          (clientY - published.offsetY - canvasBox.y) / published.scale,
          'document y survives the round trip'
        ).toBeCloseTo(point.y, 9);
      }

      return { canvasBox, published };
    };

    const wide = await agreementAt(1280, 720);
    const narrow = await agreementAt(1279, 720);

    // A width-only change moves the fit, and the fit is what must NOT move the document. If
    // the fit came out identical, this pair would prove nothing - so the difference is
    // asserted rather than assumed. Which TERM moves depends on which axis is binding: a
    // width-limited fit changes `scale`, a height-limited one leaves it alone and spends the
    // extra pixel on `offsetX` instead. The whole fit is compared so the check holds either
    // way, and the message names the numbers so a reader can see which term moved.
    expect(narrow.canvasBox.width, 'the canvas really did lose a pixel').toBe(wide.canvasBox.width - 1);
    const fitOf = (fit: { scale: number; offsetX: number; offsetY: number }) => ({
      scale: fit.scale,
      offsetX: fit.offsetX,
      offsetY: fit.offsetY,
    });
    expect(
      fitOf(narrow.published),
      `the app's fit must really have changed across a 1px width change (wide was ${JSON.stringify(fitOf(wide.published))})`
    ).not.toEqual(fitOf(wide.published));
  });

  test('ICO export matches the source canvas', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const sourceDataUrl = await setupIcoTest(page);
    // The ICO flow never uses the workspace export fixture, so prepare its download
    // directory the same way `setupExportTest` does.
    const downloadDirectory = path.join(testInfo.outputDir, 'exports');
    await mkdir(downloadDirectory, { recursive: true });

    await exportIcoAndVerify(page, sourceDataUrl, downloadDirectory);
  });
});
