import { expect, test, type TestInfo } from '../fixtures/extended-test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { compareScreenshots } from '../helpers/image-comparison';
import { containFit, DEFAULT_DOCUMENT_SIZE, getWorkspaceCanvas } from '../helpers/canvas-helpers';
import { clickToolButton } from '../helpers/toolbar-helpers';
import {
  assertExportGeometry,
  browserVerifiedFormats,
  exportAndVerify,
  exportIcoAndVerify,
  fillSaveDialog,
  INTEGRATION_TEST_TIMEOUT_MS,
  mimeType,
  prepareExportDownloadDirectory,
  openSaveDialog,
  setupExportTest,
  setupIcoTest,
  submitSaveDialogForDownload,
  type ExportFormat,
} from './helpers';

const formats = browserVerifiedFormats;

/**
 * The shell's `lg` breakpoint, 1024px. `src/index.scss:38` pins it in px deliberately:
 * Tailwind emitted `max-lg:` as `48rem`, a media feature that resolves against the user's
 * default font size, so at a 20px default the stylesheet hid the desktop regions at 960px
 * while the JS still read 768.
 */
const LG_BREAKPOINT_PX = 1024;

/**
 * Viewport widths the layout-independence test sweeps, and why each one is here.
 *
 * A width is here because it either sits on a side of `lg` or is a width the rest of the suite
 * depends on. 1023 and 1024 are adjacent on purpose: one pixel apart, and the canvas box jumps
 * from 967px to 718px across them because the right panel appears at `250px`.
 */
const LAYOUT_WIDTHS = [900, 1023, 1024, 1280, 1600] as const;

/** PNG, the lossless format with no third-party encoder in the path. See the test's docblock. */
const layoutInvarianceFormat: ExportFormat = { label: 'PNG', extension: '.png', verification: 'browser-pixels' };

/** Sub-directory of the committed snapshot directory that holds the baseline PNGs. */
const BASELINE_DIR = 'export-baselines';

/**
 * The one `updateSnapshots` value that re-records a baseline.
 *
 * Playwright declares `--update-snapshots [mode]` with `choices: ['all', 'changed',
 * 'missing', 'none']` and `preset: 'changed'`
 * (`node_modules/playwright/lib/program.js:225`), so the BARE flag resolves to
 * `'changed'`, not `'all'`, and `'changed'` is inert here anyway: this spec reads its
 * baseline with `readFile` and compares with `compareScreenshots`, so there is no
 * Playwright snapshot state for it to rewrite. `npm run test:e2e:update-baselines`
 * therefore has to pass `--update-snapshots=all` explicitly, and the
 * `the re-record command passes the snapshot mode the record branch requires` test
 * below is what keeps the two spellings from drifting apart again.
 */
const BASELINE_RECORD_MODE = 'all';

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
    test(`exports to ${format.label} (${format.extension}) matches visual baseline`, async ({
      page,
      browser,
    }, testInfo) => {
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

      // A bare truthiness check on `updateSnapshots` was the first defect here: the
      // option is a string union whose default ('missing') is truthy, so every run
      // rewrote the committed baseline and returned before comparing, and the
      // comparison below it was unreachable. The check is now an exact match against
      // BASELINE_RECORD_MODE, and `npm run test:e2e:update-baselines` is pinned to
      // pass the same value, because the two are one mechanism seen from two places.
      if (testInfo.config.updateSnapshots === BASELINE_RECORD_MODE) {
        await mkdir(path.dirname(baselineFilePath), { recursive: true });
        await writeFile(baselineFilePath, exportedBuffer);
        testInfo.annotations.push({ type: 'baseline-recorded', description: baselineFilePath });
        return;
      }

      const baseline = await readFile(baselineFilePath).catch(() => null);
      if (!baseline) {
        await testInfo.attach(`${format.label}-baseline-missing`, { body: exportedBuffer, contentType: 'image/png' });
        // The command is named by its npm script, not by its raw flag: the bare
        // `--update-snapshots` this used to print resolves to 'changed' and cannot
        // reach this branch, so telling a reader to run it named a dead end.
        throw new Error(
          `Baseline missing for ${format.label}. Record it with \`npm run test:e2e:update-baselines\`, ` +
            `which runs \`playwright test e2e/export/visual-regression.spec.ts --update-snapshots=${BASELINE_RECORD_MODE}\`. ` +
            'Re-recording replaces a committed oracle, so it is an operator decision - review the diff it produces.'
        );
      }

      /**
       * An 800x600 baseline is 480,000 pixels, so 100 differing pixels is 0.021% of
       * the picture. That is a TRIPWIRE, not a tolerance, and the distinction is the
       * contract rather than a detail of the number:
       *
       * - Four of the seven compared formats are lossy — JPEG, WebP, GIF and AVIF —
       *         and the encoder inside the browser decides their last digits. The budget
       *         covers that encoder's bounded non-determinism. It does not cover a CHANGE
       *         in it. (PNG, BMP and SVG are lossless, and PNG is the one a logic change
       *         in the export path would break first.)
       * - A Chrome, libjpeg or libavif upgrade moves those digits by more than 100
       *         pixels, and that is a hard red on a blocking gate. Raising either number is
       *         the wrong repair: at `maxDiffPixels: 4800` this suite would pass a visibly
       *         different picture, so the raise does not make the gate tolerant, it makes it
       *         blind. A red here is fixed by fixing the export path or by re-recording
       *         deliberately, and never by widening the budget.
       * - The browser version is printed in the failure message for that triage
       *         specifically. The first question about a red here is "did the encoder
       *         change", and it is now answerable from the run output rather than guessed.
       *
       * WHY THE CHROME VERSION IS NOT PINNED IN CI, which is the other half of this
       * finding and a deliberate non-action. `playwright.config.ts` uses
       * `channel: 'chrome'` - the system browser - and the `e2e` job installs it with
       * `npx playwright install --with-deps chrome`, which resolves to whatever
       * `google-chrome-stable` currently is. Pinning a version in the workflow would
       * be a guess, not a fix: nothing in this repository records which Chrome produced
       * the committed baselines, so a pin that does not match the recording version
       * turns a green gate red for a reason no one can diagnose from the tree, and a
       * pin that does match it asserts a reproducibility this repository cannot
       * demonstrate. Establishing that record means re-recording the baselines under a
       * known version, which is an operator decision and out of scope here. Reporting
       * the version is the half of reproducibility that is available without it.
       */

      const result = await compareScreenshots(exportedBuffer, baseline, {
        threshold: 0.01,
        maxDiffPixels: 100,
      });
      expect(
        result.matches,
        `Visual mismatch for ${format.label}: ${result.diffPixels} diff pixels ` +
          `(ratio: ${result.diffRatio.toFixed(4)}), encoded by ${browser.version()}. ` +
          'Do not widen the budget - see the argument above this call.'
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
   * every layout the shell can produce.
   *
   * WHY WIDTHS, AND WHY THIS PARTICULAR SET. The shell's structural boundary is `lg` at
   * 1024px (`src/index.scss:38`, pinned in px rather than the `rem` Tailwind would have
   * emitted), and crossing it is not a resize — it is a different shell. Measured at
   * height 720: below 1024 the right panel is `display: none` and the canvas is 844px wide
   * at a 900px viewport and 967px at 1023px; at 1024 the panel appears at `250px` and the
   * canvas drops to 718px. One pixel of viewport width therefore moves the canvas by 249,
   * which no fixed geometry survives. A HEIGHT sweep cannot see any of this: the right
   * panel's width, and therefore the canvas box, is a function of width alone, so at a
   * fixed width of 1280 every height agreed and the height-only version of this test was
   * green while the property it names was unprotected. 1280 is kept because it is the width
   * the committed baselines were recorded at, so a regression that broke the baselines would
   * fail both this test and the seven above it.
   *
   * WHY ONLY THE SIDEBAR STATE ABOVE 1024. `toolbar-layout-toggle` is rendered behind
   * `!isTablet` in `SidebarLeft`, so below `lg` there is no second left-rail layout to enter
   * and the test asserts that absence rather than skipping past it — see below.
   *
   * WHY THE EXPORTED BYTES AND NOT THE CANVAS. `sourceDataUrl` is `canvas.toDataURL()` of the
   * workspace canvas, which is the drawing, not the file. The property is about the export:
   * `src/contexts/useFile.tsx` resolves the format, lazily `import()`s an encoder
   * (`src/contexts/image-load-save-utils.ts:145-178`) and downloads the result. PNG is the
   * format asserted on because it is the only lossless one that never leaves the browser —
   * `imageFormat.encoding === 'canvas'` takes a plain `canvas.toBlob(blob, 'image/png')` with
   * no dynamic import — where TIFF, GIF and AVIF pull in `utif`, `gifenc` and
   * `@jsquash/avif`. A byte comparison against a third-party codec would be a test of the
   * codec, not of the geometry. The canvas comparison is kept as well, because it is already
   * computed and it localises a failure to the drawing rather than the encoder.
   */
  test('the export is independent of the shell layout', async ({ page }, testInfo) => {
    test.setTimeout(INTEGRATION_TEST_TIMEOUT_MS);

    const configurations: { label: string; width: number; height: number; toolbarLayout: 'default' | 'toggled' }[] = [];
    for (const height of [720, 560]) {
      for (const width of LAYOUT_WIDTHS) {
        // The toggle does not exist below `lg`, so the second rail layout is only entered where
        // the control is rendered — and the reason is asserted at the end of this test rather
        // than assumed, so the matrix cannot quietly stop covering a rail layout.
        for (const toolbarLayout of width >= LG_BREAKPOINT_PX
          ? (['default', 'toggled'] as const)
          : (['default'] as const)) {
          configurations.push({ label: `${width}x${height}/${toolbarLayout}`, width, height, toolbarLayout });
        }
      }
    }

    const exports: {
      label: string;
      sourceDataUrl: string;
      bytes: Buffer;
      canvas: { width: number; height: number };
    }[] = [];

    for (const { label, width, height, toolbarLayout } of configurations) {
      await page.setViewportSize({ width, height });
      const { sourceDataUrl, downloadDirectory } = await setupExportTest(page, testInfo, { toolbarLayout });

      // The encoded file, through the same dialog a user drives. PNG: `exportFormats` already
      // offers it as a lossless format, and reading its bytes back off disk is the only way to
      // assert on the export rather than on the drawing.
      await openSaveDialog(page);
      await fillSaveDialog(page, 'layout-invariance', 'PNG');
      const download = await submitSaveDialogForDownload(page, layoutInvarianceFormat);
      const target = path.join(downloadDirectory, path.basename(download.suggestedFilename()));
      await download.saveAs(target);
      await expect(page.getByRole('heading', { name: 'Save File As...' })).toHaveCount(0);

      const bytes = await readFile(target);
      expect(bytes.byteLength, `${label}: the exported file should not be empty`).toBeGreaterThan(100);
      const canvas = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="workspace-canvas"]') as HTMLCanvasElement;
        return { width: c.width, height: c.height };
      });
      exports.push({ label, sourceDataUrl, bytes, canvas });
    }

    // The backing store is the document size at any viewport, so a difference below is geometry
    // and not a differently-sized document being encoded.
    for (const { label, canvas } of exports) {
      expect(canvas, `${label}: the backing store is the document size at any viewport`).toEqual({
        width: 800,
        height: 600,
      });
    }

    // The property, on the export.
    const [reference, ...rest] = exports;
    for (const { label, bytes } of rest) {
      expect(
        bytes.equals(reference.bytes),
        `${label}: the exported PNG must be byte-identical to ${reference.label}. A difference here is ` +
          `layout-dependent geometry: the line is specified in document space, so the document point it marks ` +
          `cannot depend on the canvas box. If the constants are on the pixel grid the exported anti-aliasing ` +
          `in the round caps splits with viewport width, and a height-only sweep cannot see it.`
      ).toBe(true);
    }

    // And, free, on the drawing: localises the same failure to before the encoder.
    for (const { label, sourceDataUrl } of rest) {
      expect(sourceDataUrl, `${label}: the same document line must render identically on the canvas`).toBe(
        reference.sourceDataUrl
      );
    }

    // Why only one sidebar state below `lg`. If the toggle were ever rendered in the tablet band
    // the matrix above would silently stop covering a rail layout it claims to, and the reason
    // it is covered above `lg` would stop being true.
    await page.setViewportSize({ width: LAYOUT_WIDTHS[0], height: 720 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeHidden();
    await expect(page.locator('#right-panel')).toBeHidden();
    await page.setViewportSize({ width: LAYOUT_WIDTHS[LAYOUT_WIDTHS.length - 1], height: 720 });
    await expect(page.getByTestId('toolbar-layout-toggle')).toBeVisible();
    await expect(page.locator('#right-panel')).toBeVisible();
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
    const downloadDirectory = await prepareExportDownloadDirectory(testInfo);

    await exportIcoAndVerify(page, sourceDataUrl, downloadDirectory, testInfo);
  });
});

/**
 * The two npm scripts that operate on this oracle.
 *
 * They live here rather than in a spec of their own because there is nothing else in
 * the suite they could belong to: `package.json` is not importable from a
 * Playwright spec's type-checked project without a cast, and the only way to pin a
 * shell command is to read the command and run it. Both tests are hermetic - no
 * browser, no dev server, and the `clean` one works inside a temporary directory it
 * creates and removes itself.
 */
test.describe('Export harness commands', () => {
  /**
   * The repository root, taken from the resolved Playwright config rather than from
   * `process.cwd()`. npm scripts run with the package directory as their cwd, but a
   * direct `playwright test` from a subdirectory would not, and reading the wrong
   * `package.json` would make both tests below pass on nothing.
   */
  function repositoryRoot(testInfo: TestInfo): string {
    const configFile = testInfo.config.configFile;
    if (!configFile) {
      throw new Error('No Playwright config file was resolved, so the repository root is unknown');
    }
    return path.dirname(configFile);
  }

  async function packageScript(testInfo: TestInfo, name: string): Promise<string> {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot(testInfo), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const script = manifest.scripts?.[name];
    if (script === undefined) {
      throw new Error(`package.json has no "${name}" script`);
    }
    return script;
  }

  test('the re-record command passes the snapshot mode the record branch requires', async () => {
    // `test.info()` rather than a `testInfo` fixture argument. Playwright requires the
    // FIRST test argument to be an object destructuring pattern, and the two shapes that
    // satisfy it are `({ page }, testInfo)` -- which spins up a browser neither of these
    // hermetic tests uses -- and `({}, testInfo)`, which ESLint's `no-empty-pattern`
    // rejects. `test.info()` is the same object with no fixture declared at all, so the
    // test keeps taking no browser and neither linter objects. The previous spelling
    // (`async (_fixtures, testInfo)`) was rejected by Playwright before the first test
    // ran, which is why the whole suite failed to start.
    const testInfo = test.info();
    const script = await packageScript(testInfo, 'test:e2e:update-baselines');

    expect(
      script,
      'test:e2e:update-baselines must pass --update-snapshots=all. A bare --update-snapshots ' +
        "resolves to 'changed' (preset in playwright/lib/program.js), which never reaches the " +
        'record branch, so the script re-recorded nothing and every baseline was only ever compared.'
    ).toContain(`--update-snapshots=${BASELINE_RECORD_MODE}`);
  });

  test('the clean command removes generated run output and keeps the reporter result', async () => {
    const testInfo = test.info();
    const root = repositoryRoot(testInfo);
    const clean = await packageScript(testInfo, 'test:e2e:clean');

    // Read the JSON reporter's output path out of the config rather than repeating it
    // here, so a change to that path keeps this test pointed at the real file.
    const configSource = await readFile(path.join(root, 'playwright.config.ts'), 'utf8');
    const reporterOutput = /outputFile: '([^']+)'/.exec(configSource)?.[1];
    expect(
      reporterOutput,
      'playwright.config.ts must name a JSON reporter output file, or this test has nothing to protect'
    ).toBeTruthy();

    // The fixture mirrors the repository root, because the reporter path is relative
    // to it: the sandbox stands in for the root and `test-results` is the real
    // outputDir. The script runs with the sandbox as its cwd, so the only paths it can
    // touch are inside the fixture.
    const sandbox = await mkdtemp(path.join(tmpdir(), 'e2e-clean-'));
    try {
      const runOutput = path.join(sandbox, 'test-results');
      await mkdir(path.join(runOutput, 'exports-a-visual-regression-test'), { recursive: true });
      await writeFile(path.join(sandbox, reporterOutput!), '{"suites":[]}', 'utf8');
      await writeFile(path.join(runOutput, '.last-run.json'), '{"status":"passed"}', 'utf8');
      await writeFile(path.join(runOutput, 'exports-a-visual-regression-test', 'drawing.png'), 'x', 'utf8');

      execSync(clean, { cwd: sandbox, stdio: 'pipe' });

      expect(
        existsSync(path.join(sandbox, reporterOutput!)),
        'test:e2e:clean must not delete the machine-readable run result; the whole suite is ' +
          'readable from it without opening the HTML report'
      ).toBe(true);
      expect(
        existsSync(path.join(runOutput, 'exports-a-visual-regression-test')),
        'test:e2e:clean must delete the per-test output directories, which is what it is named for'
      ).toBe(false);
      expect(
        existsSync(path.join(runOutput, '.last-run.json')),
        'test:e2e:clean must delete the last-run marker, which describes a run whose output is gone'
      ).toBe(false);
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
