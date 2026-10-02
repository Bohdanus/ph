import { test, expect } from '../fixtures/extended-test';
import type { Page } from '@playwright/test';
import { clickToolButton, getToolButton, toggleToolbarLayout, verifyPrimaryTool } from './toolbar-helpers';

/**
 * The fixtures below set `window.__clicked` from an inline `onclick`, so the flag is
 * read back through a typed window rather than an `any` cast.
 */
const readClickedFlag = (page: Page): Promise<boolean | undefined> =>
  page.evaluate(() => (window as Window & { __clicked?: boolean }).__clicked);

test.describe('Toolbar Helpers - Integration', () => {
  test('getToolButton returns locator with correct testid', async ({ page }) => {
    await page.setContent('<button data-testid="tool-button-brush">Brush</button>');
    const button = getToolButton(page, 'brush');
    await expect(button).toHaveAttribute('data-testid', 'tool-button-brush');
  });

  test('getToolButton normalizes tool name correctly', async ({ page }) => {
    await page.setContent('<button data-testid="tool-button-select-and-move">Select & Move</button>');
    const button = getToolButton(page, 'select-and-move');
    await expect(button).toHaveAttribute('data-testid', 'tool-button-select-and-move');
  });

  test('clickToolButton clicks testid button when available', async ({ page }) => {
    await page.setContent('<button data-testid="tool-button-brush" onclick="window.__clicked=true">Brush</button>');
    await clickToolButton(page, 'brush');
    expect(await readClickedFlag(page)).toBe(true);
  });

  test('clickToolButton falls back to role button when testid not found', async ({ page }) => {
    await page.setContent('<button role="button" onclick="window.__clicked=true">Eraser</button>');
    await clickToolButton(page, 'eraser');
    expect(await readClickedFlag(page)).toBe(true);
  });

  test('verifyPrimaryTool checks button text', async ({ page }) => {
    await page.setContent('<button data-testid="tool-button-brush">Brush Tool</button>');
    await verifyPrimaryTool(page, 'brush', 'Brush Tool');
  });

  test('toggleToolbarLayout clicks toggle button', async ({ page }) => {
    await page.setContent(
      '<button data-testid="toolbar-layout-toggle" onclick="window.__clicked=true">Toggle</button>'
    );
    await toggleToolbarLayout(page);
    expect(await readClickedFlag(page)).toBe(true);
  });
});
