import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The left toolbar has drifted between legacy role-based labels and the newer
 * data-testid based layout. Prefer the stable test ids when available and fall
 * back to the old button labels for backwards compatibility.
 */

// Map display names to internal testid names.
// Both maps are null-prototype so a lookup can never resolve to an inherited
// Object.prototype member ("constructor", "toString", …) instead of a string.
export const TOOL_NAME_MAP: Record<string, string> = Object.assign(Object.create(null), {
  'Select & Move': 'reposition',
});

// Reverse map: internal name → display label, derived from TOOL_NAME_MAP
export const TOOL_DISPLAY_LABEL_MAP: Record<string, string> = Object.assign(
  Object.create(null),
  Object.fromEntries(
    Object.entries(TOOL_NAME_MAP).map(([display, internal]) => [internal, display] as [string, string])
  )
);

export function normalizeToolName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/[^a-z0-9]+/g, '-');
}

export function resolveToolName(toolName: string): string {
  return normalizeToolName(TOOL_NAME_MAP[toolName] ?? toolName);
}

export function generateSlug(label: string): string {
  return label
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .replace(/[^a-z0-9]+/g, '-');
}

export async function clickToolButton(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const testIdTool = page.getByTestId(`tool-button-${normalizedName}`);
  if (await testIdTool.count()) {
    await testIdTool.first().click();
    return;
  }

  const fallbackNames: string[] = [];
  if (toolName !== normalizedName) {
    fallbackNames.push(toolName);
  }
  const displayLabel = TOOL_DISPLAY_LABEL_MAP[normalizedName];
  if (displayLabel && !fallbackNames.includes(displayLabel)) {
    fallbackNames.push(displayLabel);
  }
  if (!fallbackNames.includes(normalizedName)) {
    fallbackNames.push(normalizedName);
  }

  const attempted: string[] = [];
  for (const name of fallbackNames) {
    const roleTool = page.getByRole('button', { name: new RegExp(name.replace(/&/g, 'and'), 'i') });
    if (await roleTool.count()) {
      await roleTool.first().click();
      return;
    }
    attempted.push(name);
  }

  throw new Error(
    `clickToolButton: no clickable button found for tool "${toolName}". ` +
      `Tried [data-testid="tool-button-${normalizedName}"] then role=button with accessible names: ` +
      `${attempted.map((name) => `"${name}"`).join(', ')}.`
  );
}

/**
 * Opens a tool flyout via long-press (300ms) for grouped tools.
 * Use this instead of clickToolButton when you need to select a non-primary
 * tool from a flyout group (e.g., Lasso, Colors, Brush, Pen, Shape).
 */
export async function openToolFlyout(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  await expect(button).toBeVisible();

  // Long-press: dispatch pointerdown on the button element, wait 350ms, then pointerup
  // This matches SidebarLeft.tsx's onPointerDown/onPointerUp handlers (lines 222-241)
  await button.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(350); // 300ms long-press delay + buffer
  await button.dispatchEvent('pointerup', { button: 0 });

  // Wait for flyout to appear (all flyouts have role="menu")
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 2000 });
}

/**
 * Waits for a flyout menu to become visible after long-press, right-click, or keyboard.
 * All flyouts have role="menu" (SidebarLeft.tsx line 285).
 */
export async function waitForFlyout(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toBeVisible({ timeout: 2000 });
}

export interface FlyoutItem {
  toolName: string; // internal name (e.g., 'levels')
  label: string; // display label (e.g., 'Levels')
}

/**
 * Selects a tool from an open flyout by its data-testid.
 * @param page - Playwright page
 * @param item - Flyout item with toolName (internal) and label (display)
 */
export async function selectFromFlyout(page: Page, item: FlyoutItem): Promise<void> {
  const slug = generateSlug(item.label);
  const flyoutItem = page.getByTestId(`tool-flyout-item-${item.toolName}-${slug}`);
  await expect(flyoutItem).toBeVisible();
  await flyoutItem.click();

  // Wait for flyout to close
  await expect(page.getByRole('menu')).toBeHidden({ timeout: 1000 });
}

/**
 * Gets the tool button locator by testid.
 */
export function getToolButton(page: Page, toolName: string): Locator {
  const normalizedName = resolveToolName(toolName);
  return page.getByTestId(`tool-button-${normalizedName}`);
}

/**
 * Toggles the toolbar layout between one-column and two-column.
 */
export async function toggleToolbarLayout(page: Page): Promise<void> {
  const toggle = page.getByTestId('toolbar-layout-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
}

/**
 * Verifies the primary tool shown on a grouped button matches the expected label.
 */
export async function verifyPrimaryTool(page: Page, toolName: string, expectedLabel: string): Promise<void> {
  const button = getToolButton(page, toolName);
  await expect(button).toContainText(expectedLabel);
}

/**
 * Opens a tool flyout via right-click (context menu) for grouped tools.
 */
export async function openToolFlyoutViaRightClick(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  await expect(button).toBeVisible();

  await button.click({ button: 'right' });
  await waitForFlyout(page);
}

/**
 * Verifies that hover does NOT open a flyout (Photoshop-style behavior).
 * Hover the grouped tool button and confirm no flyout appears.
 */
export async function verifyHoverDoesNotOpenFlyout(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  await expect(button).toBeVisible();

  await button.hover();
  await page.waitForTimeout(400); // Longer than long-press delay

  // Flyout should not be visible
  await expect(page.getByRole('menu')).toBeHidden();
}

/**
 * Opens a tool flyout via keyboard (ArrowDown/Enter/Space) for grouped tools.
 */
export async function openToolFlyoutViaKeyboard(
  page: Page,
  toolName: string,
  key: 'ArrowDown' | 'ArrowUp' | 'Enter' | ' ' = 'ArrowDown'
): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  await expect(button).toBeVisible();

  await button.focus();
  await button.press(key);
  await waitForFlyout(page);
}

/**
 * Navigates within an open flyout using arrow keys and selects with Enter.
 */
export async function navigateAndSelectInFlyout(
  page: Page,
  itemToolName: string,
  itemLabel: string,
  direction: 'down' | 'up' = 'down'
): Promise<void> {
  const slug = generateSlug(itemLabel);
  const flyout = page.getByRole('menu');
  await expect(flyout).toBeVisible();

  const items = flyout.getByRole('menuitemradio');
  const count = await items.count();

  // Find the target item index
  let targetIndex = -1;
  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const testId = await item.getAttribute('data-testid');
    if (testId === `tool-flyout-item-${itemToolName}-${slug}`) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex === -1) {
    throw new Error(`Flyout item not found: ${itemToolName}-${slug}`);
  }

  // Focus first item, then navigate
  await items.first().focus();

  if (direction === 'down') {
    for (let i = 0; i < targetIndex; i++) {
      await page.keyboard.press('ArrowDown');
    }
  } else {
    // Wrap from first to last, then go up
    await page.keyboard.press('ArrowUp');
    for (let i = count - 1; i > targetIndex; i--) {
      await page.keyboard.press('ArrowUp');
    }
  }

  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeHidden({ timeout: 1000 });
}
