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

/**
 * Looks a label up in `TOOL_NAME_MAP` regardless of how the caller cased it.
 *
 * The exact-key lookup runs first, then an own-key scan. A scan is used instead of
 * a lowercased index because the maps are rebuilt by tests, and a second index would
 * go stale the moment an entry is added; the scan is over `Object.keys`, so it can
 * only ever see own entries and can never answer with an `Object.prototype` member.
 */
function lookupMappedToolName(toolName: string): string | undefined {
  const exact = TOOL_NAME_MAP[toolName];
  if (typeof exact === 'string') return exact;

  const wanted = toolName.toLowerCase();
  const display = Object.keys(TOOL_NAME_MAP).find((key) => key.toLowerCase() === wanted);
  if (display === undefined) return undefined;

  const internal = TOOL_NAME_MAP[display];
  return typeof internal === 'string' ? internal : undefined;
}

export function resolveToolName(toolName: string): string {
  return normalizeToolName(lookupMappedToolName(toolName) ?? toolName);
}

/**
 * The label half of the `tool-flyout-item-${tool.name}-${slug}` test id.
 *
 * The application mints that id in `SidebarLeft.tsx:303` with its own `slugify`
 * (`SidebarLeft.tsx:18`), so anything that shifts the output here moves the helper off
 * the element it asserts on. `normalizeToolName` is the one normalization both halves
 * of this module use, and for every label the suite passes it is byte-identical to that
 * `slugify` — the unit test pins that for `Levels`, `Pencil Tool` and `Ellipse Tool`, so
 * a future divergence fails there instead of silently re-targeting a flyout item.
 *
 * Known residual, unreachable with the current toolbar: the app's `slugify` collapses
 * `&` into the surrounding separator run, and the `&`-to-`and` expansion here does not.
 * For a label like `Color & Tone` the two agree, because the ampersand is surrounded by
 * spaces; for `R&B` they do not (`r-b` versus `randb`). No label in `toolbar-mapping.ts`
 * contains an ampersand, and the app is the authority on its own test ids, so the helper
 * follows the module's normalization rather than forking a second one.
 */
export function generateSlug(label: string): string {
  return normalizeToolName(label);
}

/**
 * Escapes a tool's accessible name for use inside a `RegExp`.
 *
 * The role fallback below matches by name, and a name is data, not a pattern: an
 * unescaped one makes `Brush (B)` fail to match itself, `Levels[beta]` match a
 * different tool, and `C:\Tool` throw on construction. The repository has no shared
 * `escapeRegExp`, and this module is the only place that builds a regex out of a tool
 * name, so the helper stays local rather than introducing a shared util for one caller.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    // `&` expands to "and" because the legacy labels spell the word out while the
    // map keys do not; the expansion is part of the data, so it is escaped too.
    const roleTool = page.getByRole('button', { name: new RegExp(escapeRegExp(name.replace(/&/g, 'and')), 'i') });
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
 * Waits until an open flyout has actually taken keyboard focus, and that it is the
 * item the app promises for `key`.
 *
 * The app focuses a flyout item from a `requestAnimationFrame` callback in the tool
 * button's keydown handler (`SidebarLeft.tsx`), not in the React commit that mounts
 * the menu. So "the menu is visible" and "an item is focused" are two different
 * moments, one animation frame apart, and waiting on visibility alone returns early.
 *
 * That gap is a real race for a caller. With focus still on the tool button, the next
 * ArrowDown or Enter is handled by the *tool button* handler again, which re-opens the
 * flyout instead of navigating or activating it - so Enter leaves the flyout open. The
 * only right-click path never focuses an item at all, which is why this is not folded
 * into `waitForFlyout`.
 *
 * Which item is expected follows the app's own rule rather than an assumption:
 * `ArrowUp` focuses the **last** item and every other opener key focuses the first
 * (`SidebarLeft.tsx`: `event.key === 'ArrowUp' ? items.length - 1 : ...`). Asserting
 * the specific item keeps this a real readiness signal instead of a "something is
 * focused" smoke test, and pins ArrowUp-wraps-to-last in passing.
 */
export async function waitForFlyoutFocus(
  page: Page,
  key: 'ArrowDown' | 'ArrowUp' | 'Enter' | ' ' = 'ArrowDown'
): Promise<void> {
  const items = page.getByRole('menuitemradio');
  await expect(key === 'ArrowUp' ? items.last() : items.first()).toBeFocused({ timeout: 2000 });
}

/**
 * Opens a tool flyout via keyboard (ArrowDown/Enter/Space) for grouped tools.
 *
 * Returns only once the promised item holds focus, so a caller can navigate or
 * activate immediately without racing the app's rAF focus callback.
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
  await waitForFlyoutFocus(page, key);
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
