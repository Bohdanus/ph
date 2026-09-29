import { expect, test, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { compareScreenshots } from '../helpers/image-comparison';
import {
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
