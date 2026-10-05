import { mkdir } from 'node:fs/promises';

import { expect, type Locator, type Page, type TestInfo, test } from './fixtures/extended-test';
import { clickToolButton } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/** Where the pictures land, so a reader can open them without unpacking a report. */
const PICTURE_DIR = 'test-results/ruler-visual';

/**
 * PICTURES of the measuring line, for a person to look at.
 *
 * This file asserts nothing about pixels and exists only to produce images an operator can compare
 * against Photoshop's own Ruler. Every other guard on this tool measures something numeric — the
 * geometry in `e2e/ruler.spec.ts`, the bar's contrast in `e2e/toolbar-contrast.spec.ts` — and no
 * number says whether the line LOOKS like the one in Photoshop, because "looks like" is a judgement
 * about shape and weight that only a pair of images supports.
 *
 * The images are ATTACHED to the run, not committed as a baseline. A committed PNG of a ruler is an
 * oracle that fails on a font metric or an antialiasing change on another machine and then has to be
 * re-recorded by hand, which is how baselines rot. An attached image costs nothing and is looked at
 * deliberately.
 *
 * Each case is drawn over BOTH a light and a dark region of the document, because the whole reason
 * Photoshop's rule is drawn the way it is — a light core inside a dark casing, or the reverse — is
 * that one flat colour cannot stay visible across a photograph. A screenshot taken over a blank white
 * page cannot tell whether that works.
 */

type Fit = {
  scale: number;
  offsetX: number;
  offsetY: number;
  documentWidth: number;
  documentHeight: number;
  rectX: number;
  rectY: number;
};

const readFit = async (page: Page): Promise<Fit> => {
  const container = page.getByTestId('workspace-container');
  await expect(container).toHaveAttribute('data-fit-scale', /.+/);
  return await container.evaluate((node) => {
    const read = (name: string) => Number(node.getAttribute(name));
    return {
      scale: read('data-fit-scale'),
      offsetX: read('data-fit-offset-x'),
      offsetY: read('data-fit-offset-y'),
      documentWidth: read('data-fit-document-width'),
      documentHeight: read('data-fit-document-height'),
      rectX: read('data-fit-rect-x'),
      rectY: read('data-fit-rect-y'),
    };
  });
};

const docAt = async (page: Page, fx: number, fy: number) => {
  const fit = await readFit(page);
  return {
    x: fit.rectX + fit.offsetX + fit.documentWidth * fx * fit.scale,
    y: fit.rectY + fit.offsetY + fit.documentHeight * fy * fit.scale,
  };
};

const dragAcross = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
};

/**
 * Selects the Ruler by the I tile's keyboard route.
 *
 * Not by clicking the tile, because the app PERSISTS the selected tool and the rail's roster depends
 * on how much room the selected tool's options bar leaves — so whether `tool-button-eyedropper` is
 * rendered at all varies with whatever the previous test left selected.
 *
 * It also cannot be a fixed `I` then `Shift+I`. `I` selects the tile's CURRENT tool when it is
 * already on that tile and its first entry otherwise, so the pair only reaches the Ruler from the
 * Eyedropper: when the Ruler was already selected, `I` leaves it there and `Shift+I` cycles on to
 * whatever is next. So the cycle is walked until the bar appears, which is the only formulation that
 * does not depend on what the last test did.
 */
const selectRuler = async (page: Page) => {
  const bar = page.getByTestId('ruler-d1');
  await page.keyboard.press('i');
  for (let press = 0; press < 5 && !(await bar.isVisible()); press += 1) {
    await page.keyboard.press('Shift+I');
  }
  await expect(bar, 'the Ruler bar is the active tool').toBeVisible();
};

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  if ((await page.evaluate(() => localStorage.getItem('theme'))) !== theme) {
    await page.getByTestId('theme-toggle-button').click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
};

/**
 * Paints a black band across the middle of the document with the Draw tool.
 *
 * The band is what makes the screenshot worth looking at: it gives the rule a dark region to cross,
 * and a one-pixel line that vanishes over black is the failure this file exists to make visible. The
 * Draw tool is used because it is the only one that CREATES a layer, so nothing already in the
 * document has to be undone afterwards.
 */
const paintBand = async (page: Page) => {
  await clickToolButton(page, 'draw');
  const geometry = await page.getByTestId('workspace-canvas').boundingBox();
  expect(geometry).not.toBeNull();
  const box = geometry!;
  // Several parallel strokes rather than one, because the Draw tool's size is set by a slider this
  // repository keeps spec-local and a band one brush wide is too short to judge a crossing on. The
  // strokes are the same colour at the same opacity, so they composite into one flat black band.
  for (const offset of [-0.045, -0.0225, 0, 0.0225, 0.045]) {
    const y = box.y + box.height * (0.5 + offset);
    await page.mouse.move(box.x + box.width * 0.06, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.94, y, { steps: 12 });
    await page.mouse.up();
  }
};

/**
 * Saves a picture AND attaches it to the run.
 *
 * Both, and the file is the one that matters. `testInfo.attach` with a `body` is embedded in the
 * report, and this repository's reporter does not keep reports — a spec that only attaches leaves
 * nothing on disk for the person the pictures are FOR. So the bytes go to a stable, gitignored path
 * under `test-results/`, which is also where `probe:console --out` writes.
 */
const save = async (locator: Locator, name: string, testInfo: TestInfo) => {
  await mkdir(PICTURE_DIR, { recursive: true });
  const shot = await locator.screenshot({ path: `${PICTURE_DIR}/${name}.png` });
  await testInfo.attach(name, { body: shot, contentType: 'image/png' });
  console.log(`[picture] ${PICTURE_DIR}/${name}.png`);
};

test.describe('the measuring line, as pictures', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    await paintBand(page);
    await selectRuler(page);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`a straight line crossing a black band, in the ${theme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await setTheme(page, theme);

      // A long shallow diagonal, because that is the shape whose two ends AND whose crossing of a dark
      // band are both in frame at once.
      await dragAcross(page, await docAt(page, 0.12, 0.28), await docAt(page, 0.88, 0.68));
      // The gesture HAPPENED, asserted rather than assumed. Four of these pictures were pure cost with
      // no oracle: deleting the drag entirely left them green and wrote a BLANK CANVAS to a file named
      // `line-over-band-dark.png`, which is worse than no picture because it is invited as evidence.
      await expect(page.getByTestId('ruler-d1'), 'the line was drawn').not.toHaveText('');

      await save(page.locator('[data-testid="workspace-container"]'), `line-over-band-${theme}`, testInfo);
    });

    test(`a protractor leg pulled from the near end, in the ${theme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await setTheme(page, theme);

      await dragAcross(page, await docAt(page, 0.2, 0.62), await docAt(page, 0.8, 0.62));
      // Alt-drag from the line's OWN START, which is the case that used to swap X and Y.
      await page.keyboard.down('Alt');
      await dragAcross(page, await docAt(page, 0.2, 0.62), await docAt(page, 0.2, 0.2));
      await page.keyboard.up('Alt');
      await expect(page.getByTestId('ruler-d2')).not.toHaveText('');

      await save(page.locator('[data-testid="workspace-container"]'), `protractor-${theme}`, testInfo);
    });

    test(`the line dragged mid-gesture, in the ${theme} theme`, async ({ page }, testInfo) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await setTheme(page, theme);

      // Held down, not released: this is the state a user actually watches while choosing a point, and
      // it is the one a finished screenshot never shows.
      const from = await docAt(page, 0.12, 0.28);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move((await docAt(page, 0.88, 0.68)).x, (await docAt(page, 0.88, 0.68)).y, { steps: 8 });
      await expect(page.getByTestId('ruler-d1'), 'the line is being drawn').not.toHaveText('');
      await save(page.locator('[data-testid="workspace-container"]'), `mid-drag-${theme}`, testInfo);
      await page.mouse.up();
    });
  }

  /**
   * The readout bar with every readout populated, in both themes.
   *
   * It lives in the SAME describe as the canvas pictures rather than in one of its own, because it
   * needs the same starting state: `paintBand` clicks the rail, and that click is what leaves the
   * document with keyboard focus. An options-bar test that reaches for the keyboard shortcut without
   * it presses a key nobody is listening for, which fails as "the Ruler bar is not the active tool"
   * and says nothing about the bar.
   */
  test('the readout bar with every readout populated, in both themes', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectRuler(page);
    await dragAcross(page, await docAt(page, 0.2, 0.3), await docAt(page, 0.75, 0.66));
    await page.keyboard.down('Alt');
    await dragAcross(page, await docAt(page, 0.75, 0.66), await docAt(page, 0.95, 0.34));
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('ruler-d2')).not.toHaveText('');

    const bar = page.getByTestId('ruler-d1').locator('xpath=ancestor::div[contains(@class,"h-[50px]")]');
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme);
      await save(bar, `bar-${theme}`, testInfo);
    }
  });
});
