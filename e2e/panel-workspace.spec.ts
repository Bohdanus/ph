import { expect, test, type Locator, type Page } from './fixtures/extended-test';
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
 * Whether `locator` is PAINTED at its own centre: the element under that point, once the
 * element has been made hit-testable, is the element itself or something inside it.
 *
 * `toBeVisible()` is `boundingBox() !== null && visibility !== hidden`, so an element that
 * occupies exactly the right box and paints nothing satisfies it. `bg-blue-500` swapped for
 * `bg-transparent` is the shape of that: a 2px line that is still 2px tall, still `inset-x-0`
 * of the dock, still at the same edge, and still commits the same reorder — with no highlight
 * for the user to release into. Both indicators below are named by what a user SEES
 * ("Release the tab when a blue highlight appears"; "a drop zone appears"), so the paint is
 * the claim and a box is not evidence for it. The element's own geometry is still asserted
 * separately by each caller, because hit testing says nothing about where it is.
 *
 * The pointer-events swap is what makes the probe say anything at all:
 * `document.elementFromPoint` ignores elements with `pointer-events: none`, and every drop
 * indicator in this app is `pointer-events: none` BY DESIGN so the gesture underneath keeps
 * receiving the pointer. Unswapped, the probe would always report whatever lies beneath and
 * read "not painted" for a correct product exactly as happily as for a broken one. The
 * previous value is written back inside the same call, because these probes run mid-gesture
 * with the pointer still down and the page must be left exactly as it was found.
 */
const paintsAtItsCentre = (locator: Locator): Promise<boolean> =>
  locator.evaluate((node) => {
    const previous = node.style.pointerEvents;
    node.style.pointerEvents = 'auto';
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    node.style.pointerEvents = previous;
    return hit !== null && (hit === node || node.contains(hit));
  });

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
    //
    // NAMED CONSTANT, NOT A RELATION, and deliberately left that way: this is the one test
    // whose subject IS the default. There is no other measurement to read it against — every
    // other width in this file is derived from the width this one states — so the 250 is the
    // claim rather than a stand-in for one.
    expect(await width(page.locator(DOCK))).toBeCloseTo(250, 0);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('resizes the dock from its canvas-side edge', async ({ page }) => {
    const handle = page.locator(RESIZE_HANDLE);
    // The dock's own width, and the window's own width, read rather than named. The default
    // the panel opens at (`DEFAULT_DOCK_WIDTH`, `src/contexts/PanelLayout.tsx:114`) is a
    // layout decision, and a spec that writes it down dies on a one-pixel change to it — at
    // `:75` here, before it has even reached the assertion about the drag. Everything below
    // is a relation between two measured boxes, so it moves with the default instead of
    // against it.
    const before = await width(page.locator(DOCK));
    const viewportWidth = (await page.viewportSize())!.width;
    const box = (await handle.boundingBox())!;
    // The handle sits against the dock's CANVAS-side edge, so it lives in the dock's leftmost
    // 12px. Asserting a band rather than a point is deliberate: the handle is positioned
    // against the aside's padding box, so it lands 1px inside the 1px border, and a stray
    // border or rounding is not a defect. Landing it on the dock's OUTER edge is — that is a
    // handle against the window border, which is what this assertion caught when the sides
    // were inverted. The dock is flush to the right edge of the window, so that is where its
    // canvas-side edge is.
    const dockLeft = viewportWidth - before;
    expect(box.x).toBeGreaterThanOrEqual(dockLeft - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(dockLeft + 12);

    // The distance the pointer travels, which is a choice about this gesture rather than a
    // property of the app: 80px in, and the dock must be 80px wider.
    const drag = 80;
    await page.mouse.move(box.x + box.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - drag, 400, { steps: 8 });
    await page.mouse.up();

    const widened = before + drag;
    expect(await width(page.locator(DOCK))).toBeCloseTo(widened, 0);
    // And the canvas gets the space back, which is the reason the gesture is worth having.
    // Read the rail rather than naming its width: 108px is the two-column layout's, and the
    // rail is one column below `lg` or after the toggle, so a hard-coded 108 would be a
    // constant that happens to hold at this viewport and nowhere else. The same argument
    // applies to the two dock widths on either side of it, which is why both are read.
    const railWidth = await width(page.locator(RAIL));
    expect(await width(page.locator('main'))).toBeCloseTo(viewportWidth - railWidth - widened, 0);
  });

  test('does not resize from a click inside the panels', async ({ page }) => {
    // A whole-dock drag recogniser would make the entire panel column a drag surface, and the
    // first thing a user does in it is click a history entry or a layer row.
    const dock = page.locator(DOCK);
    const before = await width(dock);
    // The press goes at the dock's own centre, which is `viewportWidth - before / 2` written
    // out as a literal in every other shape — `1280 - 125` happens to be the centre of the
    // 250px this dock opens at, and it is nowhere else once the default moves, at which point
    // the press lands off the dock and the test quietly stops testing anything.
    const dockBox = (await dock.boundingBox())!;
    const viewportWidth = (await page.viewportSize())!.width;
    await page.mouse.move(dockBox.x + before / 2, 400);
    await page.mouse.down();
    // And the release well outside the column, off the handle's side of it.
    await page.mouse.move(viewportWidth - 300, 400, { steps: 6 });
    await page.mouse.up();

    expect(await width(dock)).toBeCloseTo(before, 0);
  });

  test('collapses the dock to icons when it is narrowed past a label, and back', async ({ page }) => {
    // The width the user had before the drag, which is what widening has to restore. Read
    // rather than named: the default the dock opens at is a layout decision
    // (`src/contexts/PanelLayout.tsx:114`), and this test is about restoring what the user
    // HAD, which is not the same thing as restoring the default.
    const openedAt = await width(page.locator(DOCK));
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
    // instead of storing the narrow one. So it is the width from the top of this test, not a
    // constant — see above.
    await page.locator('[data-testid="dock-icon-layers"]').click();
    expect(await width(dock)).toBeCloseTo(openedAt, 0);
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
    const lineBox = (await line.boundingBox())!;
    expect(lineBox.height).toBeGreaterThanOrEqual(1);
    expect(lineBox.x).toBeGreaterThanOrEqual(dockBox.x);
    expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(dockBox.x + dockBox.width + 1);

    // And it must sit inside the column's clipped box, or `overflow: hidden` eats it. The line
    // is at the column's bottom edge in this gesture, so that is the edge that has to hold.
    expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(dockBox.y + dockBox.height + 1);
    // AT that edge, which is a different and stronger claim than being somewhere inside the
    // column. This gesture takes the History tab — index 0 — to the BOTTOM of the column, and
    // `SidebarRight.tsx:478` picks the edge from `insertionIndex === 0`, so a product that
    // drew the line at the top while committing to the bottom keeps every box above exact and
    // still shows the user the wrong half of the column to release into. Two pixels of
    // tolerance, for the same sub-pixel rounding the group's bottom-border tolerance above
    // allows; the measured offset on a correct build is zero.
    expect(
      Math.abs(lineBox.y + lineBox.height - (dockBox.y + dockBox.height)),
      'the drop line is not at the edge the drop will insert at'
    ).toBeLessThanOrEqual(2);
    // And that it is PAINTED, which none of the geometry above can see: this line is
    // `pointer-events: none` inside an `overflow: hidden` column, so a transparent one keeps a
    // non-null box, keeps the geometry above, and commits the same reorder. This is the probe
    // `paintsAtItsCentre` exists for, and it is the one this test was always claiming to make.
    expect(await paintsAtItsCentre(line), 'the drop line has a real box but paints nothing').toBe(true);

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
    // PAINTED, on the same grounds as the reorder line and through the same helper: this is a
    // `pointer-events: none` `fixed w-1` overlay, so a transparent one is a 4px box at the
    // window edge that satisfies every geometry assertion and still drops the dock exactly the
    // same — with no drop zone for the user to have seen appear.
    expect(await paintsAtItsCentre(edge), 'the edge drop zone has a real box but paints nothing').toBe(true);
    // A reorder indicator at the same time would be a lie about what the drop will do.
    await expect(page.locator('[data-testid="panel-drop-line"]')).toBeHidden();

    await page.mouse.up();

    // The dock and rail now share the left column, with the rail above the dock. Docking is
    // additive: moving the dock does not force the independent Tools rail to the opposite edge.
    const dockBox = (await page.locator(DOCK).boundingBox())!;
    const railBox = (await page.locator(RAIL).boundingBox())!;
    expect(Math.abs(dockBox.x - railBox.x)).toBeLessThanOrEqual(1);
    expect(railBox.y + railBox.height).toBeLessThanOrEqual(dockBox.y + 1);
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
    // reports whatever is beneath it — which is what `paintsAtItsCentre` does for the two
    // drop indicators as well, which is why the probe lives in one place in this file.
    expect(
      await paintsAtItsCentre(menu),
      'the flyout is in the DOM with a real box but paints nothing — the rail clips it'
    ).toBe(true);
  });

  test('keeps the layout across a reload, and Window > Reset undoes it', async ({ page }) => {
    const dock = page.locator(DOCK);
    // The default, read off the panel as it opened. Not a constant, and not merely a
    // readability choice: the point of the drag below is that it MOVED the width, and
    // "the reload restored what was stored" is satisfied by the default alone when the drag
    // changed nothing — `resized` would then equal the default, the reload would restore the
    // default, and `toBeCloseTo(resized, 0)` at the bottom would pass on a column drag that
    // is entirely neutered. Read rather than named for the reason every width in this file is
    // read: `DEFAULT_DOCK_WIDTH` is a layout decision (`src/contexts/PanelLayout.tsx:114`).
    const openedAt = await width(dock);
    const handle = (await page.locator(RESIZE_HANDLE).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, 400);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 60, 400, { steps: 6 });
    await page.mouse.up();
    const resized = await width(dock);
    // The precondition of everything below, asserted rather than assumed: the drag has to
    // have changed the value under test, or "the reload restored it" is a claim about the
    // default and not about persistence.
    expect(resized, 'the drag did not move the dock, so the reload assertion below cannot fail').not.toBe(openedAt);

    // "In Photoshop, workspaces display your last arrangement of panels."
    await page.reload();
    await expect(page.locator(RAIL)).toBeVisible();
    expect(await width(dock)).toBeCloseTo(resized, 0);

    await page.getByTestId('header-window-menu-button').click();
    await page.getByTestId('window-menu-reset-workspace-button').click();

    // Back to where it opened, which is the same measurement as above rather than a literal.
    expect(await width(dock)).toBeCloseTo(openedAt, 0);
    expect(await panelOrder(page)).toEqual(['history', 'layers']);
  });

  test('a corrupt stored layout degrades to the default rather than to nothing', async ({ page }) => {
    // The control the persistence test above needs. A hand-edited or cross-version record is
    // the only way `panelLayout` gets a value the app never wrote, and `readStoredLayout` exists
    // for exactly that. Without a control, "restores what it found" would also be satisfied by
    // a store that returns null for everything — which is what an empty key looks like.
    //
    // The default this test degrades TO is measured here, on the pristine page the shared
    // `beforeEach` left behind, rather than written down: `addInitScript` only reaches
    // navigations that follow it, so this measurement is taken before it is installed.
    const openedAt = await width(page.locator(DOCK));
    await page.addInitScript(() =>
      window.localStorage.setItem('panelLayout', '{"dockWidth": "wide", "panelOrder": ["nope"]}')
    );
    await page.reload();
    await expect(page.locator(RAIL)).toBeVisible();

    expect(await width(page.locator(DOCK))).toBeCloseTo(openedAt, 0);
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
