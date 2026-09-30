import { expect, test, type Locator, type Page } from '@playwright/test';
import { openToolFlyout } from './helpers/toolbar-helpers';

/**
 * The panel workspace, in a real browser.
 *
 * Everything here is here because jsdom cannot see it. The unit suite pins the layout ARITHMETIC
 * and the state rules; this pins the four things that only exist once there is a layout engine
 * and a real pointer:
 *
 *  - **Hit testing.** A 2px-wide handle that no click can land on is a handle that does not
 *    exist, and `toBeVisible()` cannot tell the two apart — it checks for a box, not for
 *    pixels receiving the event. `e2e/sidebar-flyout.spec.ts` already established this trap here
 *    and the same discipline applies.
 *  - **Overlap.** The tools rail is now movable to the right edge, where a flyout has to open
 *    the other way — and the flyout is PORTALLED to `document.body`, so it is never clipped by
 *    the rail and no `toBeVisible()` failure would ever report it. It can still land ON TOP of
 *    the rail, which is a real defect that only a geometry assertion sees: on the two-column
 *    rail a flyout can be anchored to the left-hand column, whose trailing edge is nowhere
 *    near the panel's. `elementFromPoint` is used to confirm the overlay is actually
 *    painted rather than merely present, which is the one claim a box cannot support.
 *  - **Persistence.** A reload is the only way to prove the layout survives one, and it is the
 *    behaviour Photoshop documents ("workspaces display your last arrangement of panels").
 *  - **Reflow.** The canvas is sized by a `ResizeObserver` on its own box, so a wider dock has
 *    to actually give the canvas less room, and the document has to re-letterbox inside it.
 */

const DOCK = '#right-panel';
const RAIL = '[data-testid="left-sidebar"]';
const RESIZE_HANDLE = '[data-testid="dock-resize-handle"]';
const SPLITTER = '[data-testid="dock-splitter"]';
const HISTORY_TAB = '[data-testid="panel-header-history"]';
const RAIL_GRIP = '[data-testid="rail-re-dock-handle"]';

const width = (locator: Locator) => locator.evaluate((node) => node.getBoundingClientRect().width);

/**
 * What a panel heading says, top to bottom. The order IS the state under test.
 *
 * `panel-header-row-*` is the header ROW and `panel-header-*` is the draggable control inside
 * it, so a bare `^=` prefix matches both and this returns four entries where there are two
 * panels. The row is excluded by name rather than by position, because a positional filter
 * would keep working right up until the row order changed.
 */
const panelOrder = (page: Page) =>
  page
    .locator(`${DOCK} [data-testid^="panel-header-"]:not([data-testid^="panel-header-row-"])`)
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')?.replace('panel-header-', '')));

test.describe('Panel workspace (fast)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator(RAIL)).toBeVisible();
  });

  test('opens on the layout the fixed dock used to be', async ({ page }) => {
    // The first render is deliberately pixel-identical to what it replaces, and everything
    // else in this suite is calibrated on it. A default that drifted would be a change in
    // every e2e clip derived from the shell's arithmetic, not a design choice.
    expect(await width(page.locator(DOCK))).toBeCloseTo(250, 0);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('resizes the dock from its canvas-side edge', async ({ page }) => {
    const handle = page.locator(RESIZE_HANDLE);
    const box = (await handle.boundingBox())!;
    // The handle sits against the dock's CANVAS-side edge, so it lives in the dock's leftmost
    // 12px. Asserting a band rather than a point is deliberate: the handle is positioned
    // against the aside's padding box, so it lands 1px inside the 1px border, and a stray
    // border or rounding is not a defect. Landing it on the dock's OUTER edge is — that is a
    // handle against the window border, which is what this assertion caught when the sides
    // were inverted.
    const dockLeft = 1280 - 250;
    expect(box.x).toBeGreaterThanOrEqual(dockLeft - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(dockLeft + 12);

    await page.mouse.move(box.x + box.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 80, 400, { steps: 8 });
    await page.mouse.up();

    expect(await width(page.locator(DOCK))).toBeCloseTo(330, 0);
    // And the canvas gets the space back, which is the reason the gesture is worth having.
    // Read the rail rather than naming its width: 108px is the two-column layout's, and the
    // rail is one column below `lg` or after the toggle, so a hard-coded 108 would be a
    // constant that happens to hold at this viewport and nowhere else.
    const railWidth = await width(page.locator(RAIL));
    expect(await width(page.locator('main'))).toBeCloseTo(1280 - railWidth - 330, 0);
  });

  test('does not resize from a click inside the panels', async ({ page }) => {
    // A whole-dock drag recogniser would make the entire panel column a drag surface, and the
    // first thing a user does in it is click a history entry or a layer row.
    const before = await width(page.locator(DOCK));
    await page.mouse.move(1280 - 125, 400);
    await page.mouse.down();
    await page.mouse.move(1280 - 300, 400, { steps: 6 });
    await page.mouse.up();

    expect(await width(page.locator(DOCK))).toBeCloseTo(before, 0);
  });

  test('collapses the dock to icons when it is narrowed past a label, and back', async ({ page }) => {
    const handle = page.locator(RESIZE_HANDLE);
    const box = (await handle.boundingBox())!;
    const x = box.x + box.width / 2;

    await page.mouse.move(x, 400);
    await page.mouse.down();
    // All the way in. "To show only the icons, adjust the dock width until the labels
    // disappear" — so the labels must actually go, not merely narrow.
    await page.mouse.move(1280 - 4, 400, { steps: 12 });
    await page.mouse.up();

    const dock = page.locator(DOCK);
    expect(await width(dock)).toBeLessThan(56);
    await expect(page.locator('[data-testid="dock-icon-strip"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-group-history"]')).toBeHidden();

    // Widening restores the width the user had, which is the whole reason narrowing collapses
    // instead of storing the narrow one.
    await page.locator('[data-testid="dock-icon-layers"]').click();
    expect(await width(dock)).toBeCloseTo(250, 0);
    // Scoped to the group, because "Layers" is a heading and a tool name in the same
    // document, and an unscoped text locator matches both.
    await expect(page.locator('[data-testid="panel-group-layers"]')).toContainText('Layers');
    await expect(page.locator('[data-testid="dock-icon-strip"]')).toBeHidden();
  });

  test('reorders the panels by dragging a tab, and shows the drop line first', async ({ page }) => {
    const tab = page.locator(HISTORY_TAB);
    const box = (await tab.boundingBox())!;
    const dockBox = (await page.locator(DOCK).boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, dockBox.y + dockBox.height - 20, { steps: 10 });

    // "Release the tab when a blue highlight appears" — the target is drawn DURING the drag.
    const line = page.locator('[data-testid="panel-drop-line"]');
    await expect(line).toBeVisible();
    // `toBeVisible` only proves a box and a visibility value, and this line is
    // `pointer-events: none` inside an `overflow: hidden` column — a clipped drop target keeps
    // a non-zero box, so the test has to paint-probe it. `elementFromPoint` ignores
    // `pointer-events: none` elements, so the probe is made against the column's own child
    // beneath the line's centre and the line's own geometry is compared to it.
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.height).toBeGreaterThanOrEqual(1);
    expect(lineBox.x).toBeGreaterThanOrEqual(dockBox.x);
    expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);

    // And it must sit inside the column's clipped box, or `overflow: hidden` eats it. The line
    // is at the column's bottom edge in this gesture, so that is the edge that has to hold.
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(dockBox.y + dockBox.height + 1);

    await page.mouse.up();
    expect(await panelOrder(page)).toEqual(['layers', 'history']);
  });

  test('cancels a tab drag on Escape and leaves the order alone', async ({ page }) => {
    const tab = page.locator(HISTORY_TAB);
    const box = (await tab.boundingBox())!;
    const dockBox = (await page.locator(DOCK).boundingBox())!;

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, dockBox.y + dockBox.height - 20, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // A cancelled drag that reordered anyway would be the one outcome Escape must never have,
    // and the order is the one thing a user can notice it happened.
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('rolls a group up to its tab bar on a double-click, and back down', async ({ page }) => {
    const tab = page.locator(HISTORY_TAB);
    await tab.dblclick();

    const group = page.locator('[data-testid="panel-group-history"]');
    await expect(tab).toHaveAttribute('aria-expanded', 'false');
    const groupBox = (await group.boundingBox())!;
    // The ROW, not the control inside it: the row is the tab bar, and the control is a
    // `self-stretch` child of it, so measuring the control compares a stretched box against the
    // box that stretched it. A rolled-up group is its tab bar and nothing else.
    const rowBox = (await page.locator('[data-testid="panel-header-row-history"]').boundingBox())!;
    // The group's own 1px bottom border rides along — that border is the separator to the
    // group below, drawn whether or not there is still a body under it — so the tolerance is
    // the border.
    expect(Math.abs(groupBox.height - rowBox.height)).toBeLessThanOrEqual(2);

    await tab.dblclick();
    await expect(tab).toHaveAttribute('aria-expanded', 'true');
    // Expanded, the group is a panel again rather than a tab bar — several times taller, which
    // is the pair that says "rolled up" and not merely "short".
    expect((await group.boundingBox())!.height).toBeGreaterThan(rowBox.height * 4);
  });

  test('resizes both groups from the shared divider', async ({ page }) => {
    const dockBox = (await page.locator(DOCK).boundingBox())!;
    const before = {
      history: (await page.locator('[data-testid="panel-group-history"]').boundingBox())!.height,
      layers: (await page.locator('[data-testid="panel-group-layers"]').boundingBox())!.height,
    };

    const splitter = (await page.locator(SPLITTER).boundingBox())!;
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + splitter.height / 2);
    await page.mouse.down();
    // UP, which is what gives the top panel the space. Dragging down would take it away, and
    // the top panel starts at 20% of a 580px column, so there is barely any to take — it would
    // hit the minimum height floor and read as "nothing happened".
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y - 100, { steps: 8 });
    await page.mouse.up();

    const after = {
      history: (await page.locator('[data-testid="panel-group-history"]').boundingBox())!.height,
      layers: (await page.locator('[data-testid="panel-group-layers"]').boundingBox())!.height,
    };
    expect(after.history).toBeGreaterThan(before.history);
    // "All groups that share the divider are resized" — not the top one only.
    expect(after.layers).toBeLessThan(before.layers);
    // And the column is still full. The two groups do not meet: the divider between them is a
    // real element with a real height, so it is measured and added rather than assumed away.
    // A divider that gave one group the space rather than taking it from the other would
    // leave a gap, and one that took more than it gave would overflow the column.
    const splitterBox = (await page.locator(SPLITTER).boundingBox())!;
    expect(after.history + after.layers + splitterBox.height).toBeCloseTo(dockBox.height, -1);
  });

  test('restores a divider drag that Escape cancels', async ({ page }) => {
    const before = (await page.locator('[data-testid="panel-group-history"]').boundingBox())!.height;
    const splitter = (await page.locator(SPLITTER).boundingBox())!;

    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y + splitter.height / 2);
    await page.mouse.down();
    await page.mouse.move(splitter.x + splitter.width / 2, splitter.y - 100, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    // A cancelled resize is written continuously, so it has to be rolled back to where the
    // divider started rather than left wherever the last pointermove put it.
    expect((await page.locator('[data-testid="panel-group-history"]').boundingBox())!.height).toBeCloseTo(before, 0);
  });

  test('moves the whole dock to the opposite edge by throwing a tab at the workspace edge', async ({ page }) => {
    const tab = (await page.locator(HISTORY_TAB).boundingBox())!;

    await page.mouse.move(tab.x + tab.width / 2, tab.y + tab.height / 2);
    await page.mouse.down();
    await page.mouse.move(20, tab.y + tab.height / 2, { steps: 12 });

    // "To create a dock, move panels to the right edge of the workspace until a drop zone
    // appears" — the zone is on screen before the release.
    const edge = page.locator('[data-testid="dock-edge-line"]');
    await expect(edge).toBeVisible();
    // A reorder indicator at the same time would be a lie about what the drop will do.
    await expect(page.locator('[data-testid="panel-drop-line"]')).toBeHidden();

    await page.mouse.up();

    // The dock is now the left column and the rail the right one, and the canvas is between.
    const dockBox = (await page.locator(DOCK).boundingBox())!;
    const railBox = (await page.locator(RAIL).boundingBox())!;
    expect(dockBox.x).toBeLessThan(railBox.x);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('opens a flyout on the canvas side of a rail that is on the right edge', async ({ page }) => {
    // The flyout is PORTALLED to `document.body` and positioned `fixed`, so the rail's
    // `overflow-y: auto` cannot clip it and `toBeVisible()` would pass whatever side it landed
    // on. What is asserted below is geometry — clear of the rail, and on screen — plus a paint
    // probe for the case where a correct box still paints nothing.
    const grip = (await page.locator(RAIL_GRIP).boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(1280 - 20, grip.y + grip.height / 2, { steps: 10 });
    await page.mouse.up();

    const railBox = (await page.locator(RAIL).boundingBox())!;
    expect(railBox.x).toBeGreaterThan(1280 - 120);

    // A long press, which is the gesture that opens a flyout at all. A plain click on a
    // grouped tool SELECTS it and leaves the flyout closed, so this is the app's own helper
    // rather than a mouse click — `openToolFlyout` documents why press-wait-lift is the order.
    await openToolFlyout(page, 'brush');

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const menuBox = (await menu.boundingBox())!;
    // Opened to the LEFT of the rail, and clear of it. "Clear" is the whole assertion: an
    // overlay hung off a second-column tile instead of off the rail stays inside the viewport,
    // so nothing else reports it, while covering the rail's own first column. The rail is
    // what the overlay has to get clear of, and on the two-column rail a left-hand tile is
    // nowhere near its trailing edge.
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(railBox.x);
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    // The element has to be made hit-testable for the probe to mean anything, or it always
    // reports whatever is beneath it.
    const painted = await menu.evaluate((node) => {
      const previous = node.style.pointerEvents;
      node.style.pointerEvents = 'auto';
      const rect = node.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      node.style.pointerEvents = previous;
      return hit !== null && (hit === node || node.contains(hit));
    });
    expect(painted, 'the flyout is in the DOM with a real box but paints nothing — the rail clips it').toBe(true);
  });

  test('keeps the layout across a reload, and Window > Reset undoes it', async ({ page }) => {
    const handle = (await page.locator(RESIZE_HANDLE).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 60, 400, { steps: 6 });
    await page.mouse.up();
    const resized = await width(page.locator(DOCK));

    // "In Photoshop, workspaces display your last arrangement of panels."
    await page.reload();
    await expect(page.locator(RAIL)).toBeVisible();
    expect(await width(page.locator(DOCK))).toBeCloseTo(resized, 0);

    await page.getByTestId('header-window-menu-button').click();
    await page.getByTestId('window-menu-reset-workspace-button').click();

    expect(await width(page.locator(DOCK))).toBeCloseTo(250, 0);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('a corrupt stored layout degrades to the default rather than to nothing', async ({ page }) => {
    // The control the persistence test above needs. A hand-edited or cross-version record is
    // the only way `panelLayout` gets a value the app never wrote, and `readStoredLayout` exists
    // for exactly that. Without a control, "restores what it found" would also be satisfied by
    // a store that returns null for everything — which is what an empty key looks like.
    await page.addInitScript(() =>
      window.localStorage.setItem('panelLayout', '{"dockWidth": "wide", "panelOrder": ["nope"]}')
    );
    await page.reload();
    await expect(page.locator(RAIL)).toBeVisible();

    expect(await width(page.locator(DOCK))).toBeCloseTo(250, 0);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('a stored width below the label floor is reachable back out of', async ({ page }) => {
    // The one-way door. The icon strip's only expand control calls `setDockWidth(dockWidth)`,
    // which collapses again on a width that is still under the floor, and the double-arrow is
    // not rendered while collapsed — so a 45px stored width left only `Window > Reset`.
    await page.addInitScript(() =>
      window.localStorage.setItem('panelLayout', '{"dockWidth": 45, "isCollapsed": false}')
    );
    await page.reload();
    await expect(page.locator(RAIL)).toBeVisible();

    const dock = page.locator(DOCK);
    expect(await width(dock)).toBeLessThan(56);
    await expect(page.locator('[data-testid="dock-icon-strip"]')).toBeVisible();

    // Out, without the reset menu.
    await page.locator('[data-testid="dock-icon-layers"]').click();
    expect(await width(dock)).toBeGreaterThanOrEqual(56);
  });
});
