import { expect, test, type Page } from './fixtures/extended-test';
import { clickToolButton } from './helpers/toolbar-helpers';

type SliderMetrics = {
  readonly height: number;
  readonly width: number;
  readonly contentHeight: number;
  readonly backgroundClip: string;
};

async function readSliderMetrics(selector: string, page: Page): Promise<SliderMetrics> {
  const slider = page.locator(selector);
  await expect(slider, `${selector} should be visible`).toBeVisible();

  return slider.evaluate((element: HTMLInputElement): SliderMetrics => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      height: box.height,
      width: box.width,
      contentHeight: box.height - Number.parseFloat(style.paddingTop) - Number.parseFloat(style.paddingBottom),
      backgroundClip: style.backgroundClip,
    };
  });
}

async function expectTouchTarget(selector: string, trackHeight: number, page: Page): Promise<void> {
  const metrics = await readSliderMetrics(selector, page);
  expect(metrics.height, `${selector} touch target should be 44 CSS px high at any DPR`).toBe(44);
  expect(metrics.width, `${selector} should remain wider than its target height`).toBeGreaterThanOrEqual(44);
  expect(metrics.contentHeight, `${selector} visual track should stay ${trackHeight}px high`).toBe(trackHeight);
  expect(metrics.backgroundClip).toBe('content-box');
}

async function openLevels(page: Page): Promise<void> {
  await page.getByTestId('header-image-menu-button').click();
  await page.getByTestId('image-menu-adjustments-button').click();
  await page.getByTestId('image-menu-adjustments-brightness-contrast-button').click();
}

async function openTransform(page: Page): Promise<void> {
  await page.getByTestId('header-edit-menu-button').click();
  await page.getByTestId('edit-menu-free-transform-button').click();
}

test.describe('tool option slider touch targets', () => {
  test.describe('coarse pointer on a tablet', () => {
    test.use({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, isMobile: false });

    test('expands every documented slider hit box and preserves its visual track', async ({ page }) => {
      await page.goto('/');
      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse) and (min-width: 768px)').matches)).toBe(true);

      await clickToolButton(page, 'draw');
      await expectTouchTarget('#size-slider', 6, page);
      await expectTouchTarget('#alpha-slider', 6, page);

      const sizeSlider = page.locator('#size-slider');
      const beforeTouch = await sizeSlider.inputValue();
      const sizeBox = await sizeSlider.boundingBox();
      expect(sizeBox, 'size slider should have touch-target bounds').not.toBeNull();
      // Tap in the expanded padding, above the visible track, to prove the enlarged
      // input box participates in range hit testing rather than only measuring taller.
      await page.touchscreen.tap(sizeBox!.x + sizeBox!.width * 0.9, sizeBox!.y + 2);
      await expect(sizeSlider).not.toHaveValue(beforeTouch);

      await page.locator('#pen-type').selectOption('pen-dashed');
      await expectTouchTarget('#dash-size', 6, page);
      await expectTouchTarget('#gap-size', 6, page);
      await page.locator('#pen-type').selectOption('spray');
      await expectTouchTarget('#flow-slider', 6, page);

      await openLevels(page);
      await expectTouchTarget('#brightness-slider', 6, page);
      await expectTouchTarget('#contrast-slider', 6, page);

      await clickToolButton(page, 'smudge');
      await expectTouchTarget('#smudge-size', 6, page);
      await expectTouchTarget('#smudge-hardness', 6, page);
      await expectTouchTarget('#smudge-strength', 6, page);

      await openTransform(page);
      const transformToolbar = page.getByRole('region', { name: 'transform tool options' });
      const toolbarBox = await transformToolbar.boundingBox();
      expect(toolbarBox, 'coarse-pointer toolbar should have measured bounds').not.toBeNull();

      for (const selector of [
        '#rotate-slider',
        '#skew-x-slider',
        '#skew-y-slider',
        '#trapezoid-slider',
        '#resize-x-slider',
        '#resize-y-slider',
      ]) {
        await expectTouchTarget(selector, 4, page);
        const box = await page.locator(selector).boundingBox();
        expect(box, `${selector} should have measured bounds`).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(toolbarBox!.y);
        expect(box!.y + box!.height).toBeLessThanOrEqual(toolbarBox!.y + toolbarBox!.height);
      }

      expect(toolbarBox!.height).toBeGreaterThan(50);
      expect(toolbarBox!.y + toolbarBox!.height).toBeLessThan(768);
    });
  });

  test.describe('fine pointer on desktop', () => {
    test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false });

    test('keeps the existing compact track dimensions', async ({ page }) => {
      await page.goto('/');
      expect(await page.evaluate(() => matchMedia('(any-pointer: coarse) and (min-width: 768px)').matches)).toBe(false);

      await clickToolButton(page, 'draw');
      expect(await readSliderMetrics('#size-slider', page)).toMatchObject({ height: 6, contentHeight: 6 });

      await clickToolButton(page, 'smudge');
      const smudgeMetrics = await readSliderMetrics('#smudge-size', page);
      expect(smudgeMetrics.height).toBe(6);

      await openTransform(page);
      const transformToolbar = page.getByRole('region', { name: 'transform tool options' });
      expect(await readSliderMetrics('#rotate-slider', page)).toMatchObject({ height: 4, contentHeight: 4 });
      expect((await transformToolbar.boundingBox())?.height).toBe(50);
    });
  });
});
