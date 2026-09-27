import { expect, test } from '@playwright/test';
import { drawLine, getDarkPixelBounds, getWorkspaceCanvas, waitForCanvasRedraw } from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

test.describe('Viewport Drawing', () => {
  const viewports = [
    { name: 'normal', width: 1280, height: 720 },
    { name: 'wide', width: 1600, height: 900 },
    { name: 'narrow', width: 900, height: 700 },
  ];

  for (const viewport of viewports) {
    // линия остаётся под курсором после изменения размера окна
    test(`line stays under cursor after window resize (${viewport.name})`, async ({ page }, testInfo) => {
      test.setTimeout(60_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/', { waitUntil: 'domcontentloaded' });

      const canvas = getWorkspaceCanvas(page);
      await expect(canvas).toBeVisible();
      const box = await canvas.boundingBox();
      if (!box) throw new Error(`${viewport.name}: canvas not found`);

      const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.35 };
      const end = { x: box.x + box.width * 0.65, y: start.y };

      // Draw line
      await clickToolButton(page, 'draw');
      await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 20 });
      // Sample a band around the stroke: this line sits outside the shared redraw clip.
      await waitForCanvasRedraw(page, box, {
        clip: { x: start.x - 20, y: start.y - 20, width: end.x - start.x + 40, height: 40 },
      });

      // Mark endpoints visibly (browser doesn't include system cursor in screenshots)
      await page.evaluate(
        ({ start, end }) => {
          for (const point of [start, end]) {
            const marker = document.createElement('div');
            marker.dataset.testid = 'cursor-marker';
            marker.style.cssText = [
              'position: fixed',
              `left: ${point.x - 9}px`,
              `top: ${point.y - 9}px`,
              'width: 18px',
              'height: 18px',
              'border: 3px solid #ef4444',
              'border-radius: 50%',
              'box-sizing: border-box',
              'pointer-events: none',
              'z-index: 2147483647',
            ].join(';');
            document.body.append(marker);
          }
        },
        { start, end }
      );

      const screenshot = await captureCanvasScreenshot(page, box, testInfo, `viewport-${viewport.name}`);
      await page
        .locator('[data-testid="cursor-marker"]')
        .evaluateAll((markers) => markers.forEach((marker) => marker.remove()));

      const bounds = await getDarkPixelBounds(screenshot);
      if (!bounds) throw new Error(`${viewport.name}: line not found on screenshot`);

      const line = imageBoundsToCss({ width: bounds.imageWidth, height: bounds.imageHeight }, box, bounds);

      expect.soft(Math.abs(line.left - start.x), `${viewport.name}: line start far from cursor`).toBeLessThan(25);
      expect.soft(Math.abs(line.right - end.x), `${viewport.name}: line end far from cursor`).toBeLessThan(25);
      expect
        .soft(Math.abs((line.top + line.bottom) / 2 - start.y), `${viewport.name}: line shifted in Y`)
        .toBeLessThan(25);
    });
  }
});
