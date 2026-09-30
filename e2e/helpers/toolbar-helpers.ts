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
 * This was written for a rail that did NOT fit: the toolbar was 1177px tall inside
 * Playwright's 720px window, so every click on a tool near the bottom of it dragged the
 * page 440px down. That scroll is invisible to the caller and fatal to the specs — a
 * canvas box measured after the click reported `y: -340` where it reported `y: 100`, so
 * the stroke was drawn and read 440px away from where the geometry says, and 19 specs
 * that passed on the parent commit failed for that one reason.
 *
 * The rail no longer outgrows the viewport: the column is `h-full` and the tiles
 * COLLAPSE into the three-dots tile instead of pushing the page taller, so a tool click
 * is now expected to scroll nothing. 440 is therefore a GUARD, not a derivation — it is
 * the size of the mistake this undoes, measured against the 1177px rail that no longer
 * exists, and nothing recomputes it. Do not re-derive it from the current layout, and do
 * not delete this function because the scroll stopped happening: the rail keeps
 * `overflow-y-auto` as a backstop on purpose, and any future layout that does grow the
 * page reintroduces the failure above silently and across the whole suite, which is the
 * worst way for it to come back.
 *
 * It is deliberately not "scroll to the top": a caller that has scrolled for its own
 * reasons must get its own position back, not a hardcoded one. The restore is
 * unconditional, so it also undoes a scroll the APP caused by selecting the tool — not
 * only the one Playwright caused to reach the button — and `window.scrollTo` to the
 * position the window is already at fires no scroll event, so the expected
 * no-scroll case costs one read and one no-op write.
 */
async function preservingScroll(page: Page, action: () => Promise<void>): Promise<void> {
  const before = await getPageScroll(page);
  await action();
  await page.evaluate(({ x, y }) => window.scrollTo(x, y), before);
}

/**
 * The three-dots tile's test id, which is deliberately NOT `tool-button-<name>`.
 *
 * A tool tile's id names the tool, so minting one for a tile that stands for no tool would
 * make `getByTestId('tool-button-…')` match a control that selects something else. That
 * decision is also what makes the collapse below cheap to detect: "this tool has no tile"
 * and "the three-dots tile is not on the rail" are two separate questions, and both have
 * to be asked. A tall viewport has no three-dots tile and therefore no collapsed tool, so
 * asking about the tile first is what keeps a genuinely missing tool a fast, accurate
 * failure instead of a timeout on a flyout that was never going to open.
 */
const OVERFLOW_TILE_TESTID = 'tool-overflow-tile';

/**
 * Opens a flyout from a tile by right-click, and waits for that flyout to be on screen.
 *
 * Right-click rather than the long press `openToolFlyout` uses, because it needs no timer:
 * `onContextMenu` calls the same `openFlyout(groupIndex)` the long press reaches, and a
 * right-click cannot be cancelled by a `pointerup` arriving before the long-press timer fires —
 * which is the whole defect `openToolFlyout` documents. The three-dots tile is rendered by
 * the same `renderToolGroup` as every other tile, so it answers to the same gesture.
 */
async function openFlyoutFromTile(page: Page, tileTestId: string): Promise<void> {
  const tile = page.getByTestId(tileTestId);
  await expect(tile).toBeVisible();
  await preservingScroll(page, () => tile.click({ button: 'right' }));
  await waitForFlyout(page);
}

/**
 * A collapsed tool's entry in an OPEN three-dots flyout, addressed by test id PREFIX.
 *
 * The app mints `tool-flyout-item-${tool.name}-${slugifyToolLabel(tool.label)}`, so the
 * obvious selector is that whole string, and this deliberately does not mint it. The slug
 * half needs the APP's display label, and the only label data this file holds is not the
 * app's: `TOOL_DISPLAY_LABEL_MAP['reposition']` is `Select & Move`, a legacy accessible
 * name, while the app labels that tool `Move Tool` (`toolbar-mapping.ts`). Minting from
 * local data would address `tool-flyout-item-reposition-select-move`, an id that exists
 * nowhere, and the selector would miss silently. `generateSlug` above is the one label rule
 * this file is allowed to copy, because a label can be handed to it; here there is no label
 * to hand it.
 *
 * The prefix is safe because the trailing `-` is the app's own name/slug delimiter, so it
 * cannot match a name that merely starts with the same letters — `tool-flyout-item-pencil-…`
 * is not a `pen` item, nor `item-rectangle-` a `rectangular-selection` one. What it CAN match
 * is a longer name that begins `name-`, and the map holds exactly one such pair, `color` and
 * `color-replacement`; the map order puts `color` first, and `.first()` is that order, so the
 * pair resolves correctly. The one name with several ids in a single menu is `shape` — its
 * five figures share it — and `.first()` is the correct answer there too rather than an
 * approximation: the app's rule is that a tile's click selects the FIRST entry of its group,
 * `overflowTools` pushes `...group` in map order, and collapse is per group, so the figure a
 * shape tile would have selected is the first `shape` item in the overflow menu.
 */
function overflowFlyoutItem(page: Page, toolName: string): Locator {
  return page.getByTestId(new RegExp(`^tool-flyout-item-${escapeRegExp(toolName)}-`));
}

export async function clickToolButton(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const testIdTool = page.getByTestId(`tool-button-${normalizedName}`);
  if (await testIdTool.count()) {
    await preservingScroll(page, () => testIdTool.first().click());
    return;
  }

  // No tile, so the tool is either collapsed into the three-dots flyout or the rail is an
  // older build with no such affordance. The collapse is tried first because it is the exact
  // mechanism — the tile and its items are both addressed by test id — while the role fallback
  // below is a regex over accessible names kept only for backwards compatibility. Preferring
  // the current mechanism over the legacy one is the same order this file has always stated.
  const overflowTile = page.getByTestId(OVERFLOW_TILE_TESTID);
  if (await overflowTile.count()) {
    await openFlyoutFromTile(page, OVERFLOW_TILE_TESTID);
    const collapsedItem = overflowFlyoutItem(page, normalizedName).first();
    // Not a `try` with a fall-through: a tool that is neither on the rail nor in an open
    // three-dots menu does not exist, and searching roles for it afterwards could only
    // produce a more confusing answer than the timeout already names.
    await expect(collapsedItem).toBeVisible();
    // The item hangs off a tile at the truncation point, so it is a click that can scroll
    // exactly as a tool button click can; same reason, same treatment as `selectFromFlyout`.
    // The app closes the flyout on the pick, so this returns with the tool active and the
    // menu on its way out — the same contract the tile path above returns under.
    await preservingScroll(page, () => collapsedItem.click());
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

  // `&` is spelled both ways in the wild, so a candidate that carries one is searched as
  // it was written FIRST and only then expanded to "and". Expanding in place deleted the
  // first of the two: for `Select & Move` the caller's own label was only ever searched as
  // `Select and Move`, which cannot match a button whose accessible name is `Select & Move`
  // — one of the three attempts was dead for the case that motivated it. The expansion is
  // part of the data, so both patterns escape it.
  const patternsFor = (name: string): RegExp[] => {
    const asWritten = new RegExp(escapeRegExp(name), 'i');
    if (!name.includes('&')) return [asWritten];
    return [asWritten, new RegExp(escapeRegExp(name.replace(/&/g, 'and')), 'i')];
  };

  const attempted: string[] = [];
  for (const name of fallbackNames) {
    for (const pattern of patternsFor(name)) {
      const roleTool = page.getByRole('button', { name: pattern });
      if (await roleTool.count()) {
        await preservingScroll(page, () => roleTool.first().click());
        return;
      }
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
 * Mirrored from `scheduleFlyoutOpen` in `src/components/SidebarLeft/SidebarLeft.tsx`, which
 * opens a group's flyout from a `setTimeout(...)` on `FLYOUT_LONG_PRESS_MS`.
 *
 * A literal, and it is the LAST one: the app exports the constant now, and the suites import
 * it, but the `e2e` TypeScript project does not compile `src/` — so this is the single place
 * the value is written down twice. The defensive waits below are expressed against this
 * constant, never against a second literal, so raising the app's threshold cannot quietly
 * leave a wait behind it.
 */
export const LONG_PRESS_DELAY_MS = 250;

/**
 * Slack for the settle wait in {@link verifyHoverDoesNotOpenFlyout}, whose assertion is
 * NEGATIVE. Hover dispatches no `pointerdown`, so nothing ever schedules a flyout and the
 * wait can only be defensive; it is still expressed against the app's delay rather than as a
 * bare number, because that is what makes the number's provenance readable.
 */
const HOVER_SETTLE_BUFFER_MS = 100;

/**
 * How long to wait for a flyout to be open.
 *
 * This is a budget for a CONDITION wait, not a deadline the app has to beat: the
 * long-press timer in `SidebarLeft` fires `LONG_PRESS_DELAY_MS` after pointerdown, and the rest of
 * this budget absorbs scheduler jitter on a loaded machine. It is deliberately much
 * larger than the threshold it is waiting on — the old helper instead raced a hard 350ms
 * sleep against the then-300ms timer, leaving 50ms of margin, which is the defect
 * `openToolFlyout` documents.
 *
 * Exported so the unit test pins this number instead of restating it: two literals
 * for one timeout is how `LONG_PRESS_DELAY_MS` came to sit beside a 350 that was only ever
 * compatible because `300 + 50 === 350`.
 */
export const FLYOUT_VISIBLE_TIMEOUT_MS = 2000;

/**
 * Opens a tool flyout via long-press for grouped tools.
 * Use this instead of clickToolButton when you need to select a non-primary
 * tool from a flyout group (e.g., Lasso, Colors, Brush, Pen, Shape).
 *
 * A tool that has collapsed into the three-dots tile is the one case where this is not a
 * long press, and the branch says why in place rather than up here.
 *
 * The gesture is press, wait for the menu, lift — in that order, because that is what
 * the app's own handler requires. `SidebarLeft` arms a `LONG_PRESS_DELAY_MS` timer on pointerdown and
 * opens the flyout when it fires, while its pointerup handler calls
 * `clearLongPressFlyout()` unconditionally. So a pointerup that arrives before the timer
 * fires CANCELS the pending open: the menu is not merely late, it never appears, and no
 * amount of waiting afterwards can recover it.
 *
 * The previous version therefore had to win a race — sleep a fixed 350ms, then lift, so
 * that the then-300ms timer had 50ms of margin — and it lost whenever the renderer's main
 * thread was busy enough to deliver that timer late. Because the losing path destroys the
 * state the following assertion was waiting for, the failure surfaced as an unexplained
 * `toBeVisible()` timeout rather than as a missed press. Waiting for the menu instead of
 * sleeping removes the margin entirely: the timer may fire early, late, or on time.
 *
 * Lifting afterwards is faithful to the gesture and safe: `onPointerUp` only touches refs
 * (`suppressLongPressRef`, `longPressOpenedRef`, `ignoreNextClickRef`) and never clears
 * `openGroup`, so it cannot close a flyout that is already open. The one ref it does set,
 * `ignoreNextClickRef`, is cleared again by the next pointerdown on that button, so a
 * later `clickToolButton` on the same tile is not swallowed.
 */
export async function openToolFlyout(page: Page, toolName: string): Promise<void> {
  const normalizedName = resolveToolName(toolName);

  const button = page.getByTestId(`tool-button-${normalizedName}`);
  if (!(await button.count())) {
    // Absent, not merely hidden: the tool collapsed, and the gesture below is a long press
    // ON the tile, so there is nothing to dispatch it at. The three-dots tile opens the same
    // `openFlyout` from a right-click and its menu carries the tool, which leaves the caller's
    // own `selectFromFlyout` to pick out of it exactly as it did for a tile's own flyout.
    // Guarded on the tile existing so the "there is no such tool" case below still fails on
    // the button it is about, and not on a three-dots tile that was never going to appear.
    const overflowTile = page.getByTestId(OVERFLOW_TILE_TESTID);
    if (await overflowTile.count()) {
      await openFlyoutFromTile(page, OVERFLOW_TILE_TESTID);
      return;
    }
  }
  await expect(button).toBeVisible();

  // Press.
  await button.dispatchEvent('pointerdown', { button: 0 });

  // Wait for THIS tile's flyout to be open before lifting.
  //
  // `aria-expanded` is set from `openGroup === groupIndex` on the pressed tile, so it
  // is true only once this group is the open one. Waiting on a bare `role="menu"` — what
  // `waitForFlyout` does — is NOT interchangeable here: callers legitimately long-press a
  // second tile while the first flyout is still open (see the "switches flyout" spec), and
  // a generic menu assertion would be satisfied instantly by the still-open first menu.
  // The helper would then lift while that timer was still pending, cancelling the second
  // open, and return with the wrong flyout on screen. Sharing one helper between the two
  // would reintroduce exactly that.
  await expect(button).toHaveAttribute('aria-expanded', 'true', { timeout: FLYOUT_VISIBLE_TIMEOUT_MS });

  // Lift. The flyout stays open; see the note on `onPointerUp` above.
  await button.dispatchEvent('pointerup', { button: 0 });

  // `aria-expanded` and the portal are not set in the same commit: the overlay is gated on the
  // ref callback having published the anchor, so the attribute is true one commit before the
  // menu exists. Asserting the menu is still what makes "returned" mean "usable", and it costs
  // nothing on the path that just opened it.
  await expect(page.getByRole('menu')).toBeVisible({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
}

/**
 * Waits for a flyout menu to become visible after long-press, right-click, or keyboard.
 * All flyouts have role="menu" — the `<ul>` inside `renderToolGroup` in
 * `src/components/SidebarLeft/SidebarLeft.tsx`. The function name is the anchor rather than a
 * line number, because every bare number in this comment has already rotted: the base said 285,
 * the campaign branch said 335, and in the merged tree the attribute is at `SidebarLeft.tsx:400`
 * with `renderToolGroup` at `:229`. Re-derive with
 * `grep -n 'role="menu"' src/components/SidebarLeft/SidebarLeft.tsx`.
 *
 * Unlike `openToolFlyout` this accepts ANY open flyout, which is correct for its callers:
 * they open exactly one flyout by right-click or keyboard, so there is never an earlier
 * one for the assertion to latch onto.
 */
export async function waitForFlyout(page: Page): Promise<void> {
  await expect(page.getByRole('menu')).toBeVisible({ timeout: FLYOUT_VISIBLE_TIMEOUT_MS });
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
 *
 * This is the tool's OWN tile and nothing else, which is the right answer when a test is
 * asking a question about that tile specifically — "does hovering this tile open a flyout",
 * "what does this tile's label read". It is the WRONG answer for a test asking a question
 * about the TOOL, because a tool the rail could not fit has no tile of its own: it lives in
 * the three-dots flyout, and `getByTestId` reports zero elements rather than failing, so the
 * failure arrives at the next assertion as "element(s) not found" against a test id that is
 * correct and simply absent. Use {@link resolveToolTile} for that question.
 */
export function getToolButton(page: Page, toolName: string): Locator {
  const normalizedName = resolveToolName(toolName);
  return page.getByTestId(`tool-button-${normalizedName}`);
}

/**
 * Whether the rail still shows this tool on a tile of its own.
 *
 * The two questions are separate on purpose, and conflating them is how a spec ends up
 * asserting against a tile the rail legitimately folded away. "Is there a tile for it" is a
 * layout claim that changes with the window; "which tile represents it" is the reachability
 * claim, and it has an answer at every window.
 */
export async function hasOwnToolTile(page: Page, toolName: string): Promise<boolean> {
  return (await getToolButton(page, toolName).count()) > 0;
}

/**
 * The tile that currently REPRESENTS a tool: its own if the rail still shows it, and the
 * three-dots tile if the rail folded it away.
 *
 * This is the selector for any question about a TOOL rather than about a tile — "is this tool
 * the selected one", "what does the user see when they look at it". It works because the app
 * already computes the same thing: the three-dots tile's `aria-pressed` is true when ANY tool
 * of the collapsed set is the current one, and its `aria-label` is the tile's own rather than a
 * tool's, so a caller reading `aria-pressed` off the resolved tile reads the truth either way.
 *
 * Async because the question is: a locator has to exist before anything is known about it, and
 * a tool's tile may or may not be on the rail depending on the window. Returning a Locator
 * synchronously would mean an OR of two selectors, where the absent half silently contributes
 * nothing and the caller cannot tell which tile it got — and "which tile it got" is the whole
 * point. Callers that need to know ask {@link hasOwnToolTile}.
 */
export async function resolveToolTile(page: Page, toolName: string): Promise<Locator> {
  const ownTile = getToolButton(page, toolName);
  if (await ownTile.count()) return ownTile.first();
  const overflow = page.getByTestId(OVERFLOW_TILE_TESTID);
  if (await overflow.count()) return overflow;
  // Neither. Returning the tool's own id is the useful failure: the caller's assertion then
  // names a test id that exists nowhere, which says which tool was being looked for.
  return ownTile;
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
 * Verifies the tile standing for a tool presents that tool's label.
 *
 * Asserts the ACCESSIBLE NAME, not the text content, and that is not a stylistic preference.
 * A tool tile's label is an `aria-label` — the tile draws an icon, so there is no text in it to
 * match — and the three-dots tile is the same shape: its label lives in `aria-label="More
 * Tools"` and the element contains only an SVG. A `toContainText` against either can never
 * pass, and against the three-dots tile it fails with `Received string: ""`, which reads as an
 * empty button rather than as "this tool has no tile of its own".
 *
 * So a tool the rail folded away is reported as what it is. The two questions are separate and
 * the caller usually wants the second: `resolveToolTile` answers "which tile represents the
 * tool" and this one answers "is that tile the tool".
 */
export async function verifyPrimaryTool(page: Page, toolName: string, expectedLabel: string): Promise<void> {
  const ownTile = getToolButton(page, toolName);
  if ((await ownTile.count()) === 0) {
    // Naming the cause beats asserting on a tile that will never carry the label. A caller
    // whose subject is a TOOL wants a reachability assertion instead; one whose subject is the
    // tile wants the window grown, and this message says which.
    const standing = await resolveToolTile(page, toolName);
    throw new Error(
      `verifyPrimaryTool: "${toolName}" has no tile of its own at this window — the rail folded it into ` +
        `the three-dots tile, whose label is "More Tools" and never "${expectedLabel}". ` +
        `Assert on ${toolName}'s own options-bar control for reachability, or grow the window to test the tile. ` +
        `Currently represented by: ${standing.toString().slice(0, 120)}`
    );
  }
  await expect(ownTile).toHaveAccessibleName(expectedLabel);
}

/**
 * Opens a tool flyout via right-click (context menu) for grouped tools.
 *
 * Unlike `clickToolButton` and `openToolFlyout` this has no collapse fallback, on purpose:
 * it asks for ONE NAMED TILE'S flyout, and the three-dots menu is not that tile's menu. A
 * caller that means "whatever flyout has this tool in it" wants the two functions above.
 */
export async function openToolFlyoutViaRightClick(page: Page, toolName: string): Promise<void> {
  await openFlyoutFromTile(page, `tool-button-${resolveToolName(toolName)}`);
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
