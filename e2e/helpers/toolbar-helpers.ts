import type { Page, Locator } from '@playwright/test';
import { expect } from '@playwright/test';
import { getPageScroll } from './canvas-helpers';

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
 * The application mints that id with `slugifyToolLabel` from `toolbar-mapping.ts`, which
 * `SidebarLeft` imports, so anything that shifts the output here moves the helper off the
 * element it asserts on. `normalizeToolName` is a *different* rule — it expands `&` to
 * `and` and trims the ends, and the application does neither — so it does not belong here:
 * for `Color & Tone` it yields `color-and-tone` where the app mints `color-tone`.
 *
 * The body below is therefore an independent copy of `slugifyToolLabel` rather than an
 * import of it. Delegating would make the two sides move together and leave nothing to
 * compare; keeping the copy means a change to either one alone is caught by
 * `e2e/helpers/__tests__/toolbar-helpers.unit.test.ts`, which asserts the two agree for
 * every label in `toolbar-mapping.ts` and for every label the suite passes. Do not trim
 * the ends here to "tidy" the output: a slug the app cannot mint is a silent miss, and
 * that test is the only thing standing between the two.
 */
export function generateSlug(label: string): string {
  return label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
}

/**
 * Escapes a tool's accessible name for use inside a `RegExp`.
 *
 * The role fallback below matches by name, and a name is data, not a pattern. Unescaped,
 * `Brush (B)` and `Levels[beta]` fail to match their own literal name because the group
 * and the class are interpreted, `Crop.v2`/`Zoom+`/`Paint|Fill` match a shorter name than
 * the caller asked for, and `C:\Tool` does not throw — the trailing `\T` is an Annex B
 * IdentityEscape, so the pattern silently matches `C:Tool` and nothing else. Only the `u`
 * flag would make that construction throw, and the only flag here is `i`.
 *
 * The repository has no shared `escapeRegExp`, and this is the only place under `e2e/`
 * that builds a regex out of a tool name, so the helper stays local rather than
 * introducing a shared util for one caller. (`src/components/SidebarLeft/__tests__/SidebarLeft.icon-state.test.tsx`
 * interpolates a tool label into a `RegExp` the same unescaped way; that is app-test scope,
 * not this helper's.)
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Runs a toolbar interaction and puts the window back where it was afterwards.
 *
 * Playwright scrolls a target into view before it clicks, and the left toolbar is 1177px
 * tall inside Playwright's 720px window, so every click on a tool near the bottom of it
 * drags the page 440px down. That scroll is invisible to the caller and fatal to the specs:
 * a canvas box measured after the click reports `y: -340` where it reported `y: 100`, so
 * the stroke is drawn and read 440px away from where the geometry says, and 19 specs that
 * passed on the parent commit fail here. Restoring the offset is what makes a tool click
 * mean "this tool is now active" and nothing else.
 *
 * It is deliberately not "scroll to the top": a caller that has scrolled for its own
 * reasons must get its own position back, not a hardcoded one. The restore is
 * unconditional, so it also undoes a scroll the APP caused by selecting the tool — not
 * only the one Playwright caused to reach the button — and `window.scrollTo` to the
 * position the window is already at fires no scroll event, so the common short-toolbar
 * case costs one read and one no-op write.
 */
async function preservingScroll(page: Page, action: () => Promise<void>): Promise<void> {
  const before = await getPageScroll(page);
  await action();
  await page.evaluate(({ x, y }) => window.scrollTo(x, y), before);
}

export async function clickToolButton(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const testIdTool = page.getByTestId(`tool-button-${normalizedName}`);
  if (await testIdTool.count()) {
    await preservingScroll(page, () => testIdTool.first().click());
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
      await preservingScroll(page, () => roleTool.first().click());
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
 * The app's long-press threshold, in milliseconds.
 *
 * Mirrored from `scheduleFlyoutOpen` in `src/components/SidebarLeft/SidebarLeft.tsx:83-90`,
 * which opens a group's flyout from `setTimeout(() => openFlyout(groupIndex), 300)`. The app
 * exports no constant for it, so 300 is duplicated here and the app is the only authority on
 * the value: every wait below is expressed against this, never against a second literal, so
 * raising the app's threshold cannot quietly leave a wait behind it.
 */
export const LONG_PRESS_DELAY_MS = 300;

/**
 * Slack added to {@link LONG_PRESS_DELAY_MS} before `pointerup`, so the release cannot land
 * in the same millisecond the app's timer fires and turn a long press into a plain click.
 */
const LONG_PRESS_BUFFER_MS = 50;

/**
 * Slack for the settle wait in {@link verifyHoverDoesNotOpenFlyout}, whose assertion is
 * negative. Hover dispatches no `pointerdown`, so nothing ever schedules a flyout and the
 * wait is defensive only; it is still expressed against the app's delay rather than as a
 * second hardcoded number.
 */
const HOVER_SETTLE_BUFFER_MS = 100;

/**
 * Opens a tool flyout via long-press (300ms) for grouped tools.
 * Use this instead of clickToolButton when you need to select a non-primary
 * tool from a flyout group (e.g., Lasso, Colors, Brush, Pen, Shape).
 */
export async function openToolFlyout(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  await expect(button).toBeVisible();

  // Long-press: dispatch pointerdown on the button element, hold past the app's delay,
  // then pointerup. This matches SidebarLeft.tsx's onPointerDown/onPointerUp handlers
  // (lines 212-231).
  await button.dispatchEvent('pointerdown', { button: 0 });
  await page.waitForTimeout(LONG_PRESS_DELAY_MS + LONG_PRESS_BUFFER_MS);
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
  // The flyout hangs off a toolbar button near the bottom of a window-height-taller
  // page, so clicking one scrolls just as a tool button click does.
  await preservingScroll(page, () => flyoutItem.click());

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
  await preservingScroll(page, () => toggle.click());
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

  await preservingScroll(page, () => button.click({ button: 'right' }));
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
  // Hover fires no `pointerdown`, so the app never calls `scheduleFlyoutOpen` and there is
  // no pending timer to race. The wait is defensive, and it outlasts the app's own delay so
  // this keeps meaning "hover did not open it" if the threshold is ever raised.
  await page.waitForTimeout(LONG_PRESS_DELAY_MS + HOVER_SETTLE_BUFFER_MS);

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
