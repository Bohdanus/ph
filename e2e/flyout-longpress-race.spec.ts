/**
 * Pins the long-press flyout gesture against the race it used to lose.
 *
 * `SidebarLeft` arms a 300ms timer on pointerdown and opens the flyout when it fires, while
 * its pointerup handler calls `clearLongPressFlyout()` UNCONDITIONALLY. A pointerup that
 * arrives before the timer fires therefore does not merely close nothing — it cancels the
 * pending open, and the flyout never appears. `openToolFlyout` used to dispatch pointerdown,
 * sleep a fixed 350ms, then lift, so it won only if the timer beat a 50ms margin. Under load
 * the renderer's main thread delivers that timer late, the helper's lift cancels the open, and
 * the failure surfaces as an unexplained `toBeVisible()` timeout — because the 2000ms it then
 * waited for was waiting for state that had already been destroyed.
 *
 * Reproducing the flake by loading the machine is not something a test can do reliably: 40 CPU
 * burners on 11 cores (under a load average already at 30) did not produce a single failure.
 * So these tests inject the CONDITION instead — the same 300ms timer, delivered late — which
 * is deterministic, takes milliseconds, and fails the old helper every time.
 *
 * The injection is safe to scope: the `setTimeout(..., 300)` in `scheduleFlyoutOpen`
 * (`SidebarLeft.tsx:116`) is the only 300ms timer anywhere under `src/` - the next closest
 * is 250ms, `ToolTooltip.tsx`. Named as well as numbered, so a line shift under us points a
 * reader at the function rather than at whatever slid into that line.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getPageScroll } from './helpers/canvas-helpers';
import { openToolFlyout } from './helpers/toolbar-helpers';

/** The app's long-press delay, read from `SidebarLeft.scheduleFlyoutOpen`. */
const APP_LONG_PRESS_MS = 300;

/**
 * The tiles on the rail that own a flyout, read off the DOM at run time.
 *
 * This list used to be typed in — `['brush', 'shape', 'pen', 'freehand-lasso', 'color']` — and
 * that is a list of TOOLS, not of tiles, so it went stale the moment the rail learned to
 * collapse. At the suite's 1280x720 the rail shows five tiles and a three-dots tile, and every
 * tool in that list except `freehand-lasso` has been REMOVED from it: `openToolFlyout` then took
 * its collapse branch, opened the three-dots flyout instead of the requested tile's, and the
 * test passed while exercising the wrong menu. Reading the tiles back is the fix: the subject is
 * "every flyout tile on the rail", and the DOM is the only thing that knows which tiles there
 * are at this viewport.
 *
 * `aria-haspopup="menu"` is the app's own statement that a tile HAS a flyout
 * (`SidebarLeft.tsx:447`), so it is the filter rather than a name list — a tile with no group
 * behind it carries no such attribute and is not a subject here.
 */
const flyoutTiles = async (page: Page): Promise<string[]> =>
  page
    .locator('[data-toolbar-tile][aria-haspopup="menu"]')
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-testid') ?? ''));

/**
 * The name of the flyout a tile opens, derived from that tile's own label.
 *
 * The app names a group menu `${primaryTool.label} tools` (`SidebarLeft.tsx:548`), and the tile
 * carries that same label as its `aria-label` (`:448`), so the two are one string apart. The
 * three-dots tile is the exception the app itself spells out (`:544`): it is not a tool, so its
 * menu is the literal `More tools` and no label can derive it. That is why this reads the tile's
 * label rather than carrying a table of menu names — a table is another list to go stale, and
 * this one cannot disagree with the app without the test failing.
 */
const flyoutMenuName = async (page: Page, tileTestId: string): Promise<string> => {
  if (tileTestId === 'tool-overflow-tile') return 'More tools';
  const label = await page.getByTestId(tileTestId).getAttribute('aria-label');
  if (!label) throw new Error(`${tileTestId} carries no aria-label to derive its flyout's name from`);
  return `${label} tools`;
};

/**
 * One real tool tile to press, as the tool name `openToolFlyout` addresses it by.
 *
 * `tool-button-<name>` is the app's own minting rule (`SidebarLeft.tsx:524`), so the name is
 * the test id with that prefix removed — read back rather than listed, for the same reason the
 * tile list is: any tool this file names may be collapsed out of the rail at this viewport, and
 * a collapsed tool sends `openToolFlyout` down the three-dots branch and tests a different menu
 * than the one the assertion below is about.
 */
const aFlyoutTool = async (page: Page): Promise<{ name: string; tile: string }> => {
  const tile = (await flyoutTiles(page)).find((id) => id.startsWith('tool-button-'));
  if (!tile) throw new Error('no tool tile with a flyout is on the rail at this viewport');
  return { name: tile.slice('tool-button-'.length), tile };
};

/**
 * Press, wait for THIS tile's own flyout, then lift — addressed by TILE rather than by tool
 * name, because the three-dots tile stands for no tool and `openToolFlyout` has no name for it.
 *
 * `aria-expanded` is set from `openGroup === groupIndex` on the pressed tile, so waiting on it
 * is what makes "this tile's flyout opened" true rather than "a menu exists"; a bare
 * `role="menu"` assertion would also pass on a menu some other tile left open.
 */
const longPressTile = async (page: Page, tileTestId: string): Promise<void> => {
  const tile = page.getByTestId(tileTestId);
  await tile.dispatchEvent('pointerdown', { button: 0 });
  await expect(tile).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
  await tile.dispatchEvent('pointerup', { button: 0 });
  await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tileTestId) })).toBeVisible({
    timeout: 2000,
  });
};

/**
 * Delay the app's 300ms flyout timer to `APP_LONG_PRESS_MS + extra`, which is what a busy
 * renderer main thread does to it: the timer is still correct, it is just delivered late.
 *
 * Only the 300ms timer is touched, and only its delay — the callback and the rest of the page
 * are untouched, so the app is still the thing deciding when the flyout opens.
 */
async function delayLongPressTimer(page: Page, extra: number): Promise<void> {
  await page.evaluate(
    ([appDelay, extraMs]) => {
      const real = window.setTimeout.bind(window);
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) =>
        real(
          handler as () => void,
          delay === appDelay ? appDelay + extraMs : delay,
          ...args
        )) as typeof window.setTimeout;
    },
    [APP_LONG_PRESS_MS, extra] as const
  );
}

test.describe('SidebarLeft - long-press flyout is not a timing race', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
  });
  test('control: opens the flyout when the timer is on time', async ({ page }) => {
    const { name } = await aFlyoutTool(page);
    await openToolFlyout(page, name);
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('opens the flyout when the long-press timer fires late', async ({ page }) => {
    // The timer now arrives at 1000ms. The old helper lifted at 350ms, which cancelled it.
    await delayLongPressTimer(page, 700);

    const { name, tile } = await aFlyoutTool(page);
    await openToolFlyout(page, name);

    await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tile) })).toBeVisible();
  });

  test('the late timer is what the old lift cancelled, not a timeout that was too short', async ({ page }) => {
    // The differential proof, and it does not use the helper at all: press, never lift, and
    // the same stretched timer opens the flyout on its own. So the app is healthy and the
    // 2000ms budget is ample — 1000ms is well inside it. What destroyed the open in the
    // flake was the helper's own pointerup arriving before the timer fired.
    await delayLongPressTimer(page, 700);

    // The tile is read out of the DOM and interpolated in, because this dispatches the press
    // inside the page where a hard-coded selector for one tool's tile would be a claim that
    // tool is still on the rail — and at this viewport most are not.
    const { tile } = await aFlyoutTool(page);
    const openedAt = await page.evaluate(
      async ([delay, tileTestId]) => {
        const started = performance.now();
        document
          .querySelector(`[data-testid="${tileTestId}"]`)
          ?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
        // Re-queried every pass: the menu does not exist yet when the press starts, so
        // resolving it once would pin null and report "never opened" no matter what happened.
        while (performance.now() - started < delay + 1500) {
          if (document.querySelector('[role="menu"]')) return performance.now() - started;
          await new Promise((resolve) => {
            window.setTimeout(resolve, 25);
          });
        }
        return null;
      },
      [APP_LONG_PRESS_MS + 700, tile] as const
    );

    // It opened, and it opened LATE — after the 350ms the old helper lifted at.
    expect(openedAt).not.toBeNull();
    expect(openedAt as number).toBeGreaterThan(350);
    // And it really is the flyout, not some other menu in the shell.
    await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tile) })).toBeVisible();
  });

  test('lifting after the flyout is open does not close it', async ({ page }) => {
    // `openToolFlyout` presses, waits, then lifts. That is only safe because the app's
    // pointerup handler touches refs and never clears `openGroup` — asserted here against the
    // real app rather than inferred from the source, so a change to that handler is caught.
    const { name, tile } = await aFlyoutTool(page);
    await openToolFlyout(page, name);
    await expect(page.getByRole('menu')).toBeVisible();

    await page.getByTestId(tile).dispatchEvent('pointerup', { button: 0 });

    await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tile) })).toBeVisible();
  });

  test('a long press does not move the window, so it needs no scroll restore', async ({ page }) => {
    // `clickToolButton` wraps its click in `preservingScroll` because Playwright scrolls a
    // target into view first. `openToolFlyout` dispatches events directly and performs no
    // actionability scroll, so there is nothing to restore — pinned here because adding that
    // wrapper on the assumption that "every toolbar helper scrolls" would be a silent no-op
    // at best.
    //
    // The page is made scrollable FIRST, and that is load-bearing. The rail no longer outgrows
    // the viewport, so the shell is exactly viewport-tall and `documentElement.scrollHeight`
    // equals `clientHeight` at every desktop size: the window has no range to move in, and
    // comparing a scroll offset before and after would be true of any behaviour at all,
    // including one that scrolled. The assertion below is only about the helper not scrolling,
    // so the test has to put the possibility back before it can mean anything. This is the
    // one place in the suite that manufactures a scroll range, and it does so by setting a
    // style on the body rather than by resizing: the rail is a scroll container of its own, so
    // making the DOCUMENT taller is what exercises a window scroll.
    await page.evaluate(() => {
      document.body.style.minHeight = '300vh';
    });
    // The non-vacuity control, and it is the whole reason the assertion below means anything.
    // "Found nothing to scroll" and "scrolled nothing" are the same result on a page that cannot
    // scroll, so the control is written first: if the manufactured range is ever not there, this
    // fails and says so, rather than the comparison passing for a reason that has nothing to do
    // with the helper.
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight),
      'the manufactured document must actually be scrollable, or the scroll comparison below is true of any behaviour'
    ).toBe(true);
    const before = await getPageScroll(page);

    const { name } = await aFlyoutTool(page);
    await openToolFlyout(page, name);

    expect(await getPageScroll(page)).toEqual(before);
  });

  test('opens every grouped tile, repeatedly', async ({ page }) => {
    // The helper is called once per test by the suite, so a helper that only works the first
    // time in a page — because of state it left behind — passes every existing spec.
    //
    // The tile list is read from the DOM, so this covers whatever flyout tiles the rail
    // actually has at this viewport, the three-dots tile included. It used to be a typed list
    // of five tool names, of which four had been collapsed out of the rail: each of those took
    // the three-dots branch and reopened the SAME menu, so the test exercised one tile five
    // times and reported it as five.
    const tiles = await flyoutTiles(page);
    expect(tiles.length, 'the rail must have flyout tiles for this to test anything').toBeGreaterThan(0);

    for (let round = 0; round < 3; round++) {
      for (const tile of tiles) {
        // Assert THIS tile's menu, by the name derived from the tile — a bare
        // `getByRole('menu')` would be satisfied by whichever menu was left open, which is the
        // whole class of bug this test exists to catch.
        await longPressTile(page, tile);
        await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tile) })).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
      }
    }
  });
});
