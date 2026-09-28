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
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();
  });

  test('opens the flyout when the long-press timer fires late', async ({ page }) => {
    // The timer now arrives at 1000ms. The old helper lifted at 350ms, which cancelled it.
    await delayLongPressTimer(page, 700);

    await openToolFlyout(page, 'brush');

    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeVisible();
  });

  test('the late timer is what the old lift cancelled, not a timeout that was too short', async ({ page }) => {
    // The differential proof, and it does not use the helper at all: press, never lift, and
    // the same stretched timer opens the flyout on its own. So the app is healthy and the
    // 2000ms budget is ample — 1000ms is well inside it. What destroyed the open in the
    // flake was the helper's own pointerup arriving before the timer fired.
    await delayLongPressTimer(page, 700);

    const openedAt = await page.evaluate(async (delay) => {
      const started = performance.now();
      document
        .querySelector('[data-testid="tool-button-brush"]')
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
    }, APP_LONG_PRESS_MS + 700);

    // It opened, and it opened LATE — after the 350ms the old helper lifted at.
    expect(openedAt).not.toBeNull();
    expect(openedAt as number).toBeGreaterThan(350);
    // And it really is the flyout, not some other menu in the shell.
    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeVisible();
  });

  test('lifting after the flyout is open does not close it', async ({ page }) => {
    // `openToolFlyout` presses, waits, then lifts. That is only safe because the app's
    // pointerup handler touches refs and never clears `openGroup` — asserted here against the
    // real app rather than inferred from the source, so a change to that handler is caught.
    await openToolFlyout(page, 'brush');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.getByTestId('tool-button-brush').dispatchEvent('pointerup', { button: 0 });

    await expect(page.getByRole('menu', { name: 'Brush Tool tools' })).toBeVisible();
  });

  test('a long press does not move the window, so it needs no scroll restore', async ({ page }) => {
    // `clickToolButton` wraps its click in `preservingScroll` because Playwright scrolls a
    // target into view first. `openToolFlyout` dispatches events directly and performs no
    // actionability scroll, so there is nothing to restore — pinned here because adding that
    // wrapper on the assumption that "every toolbar helper scrolls" would be a silent no-op
    // at best.
    const before = await getPageScroll(page);

    await openToolFlyout(page, 'brush');

    expect(await getPageScroll(page)).toEqual(before);
  });

  test('opens every grouped tile, repeatedly', async ({ page }) => {
    // The helper is called once per test by the suite, so a helper that only works the first
    // time in a page — because of state it left behind — passes every existing spec.
    const tiles = ['brush', 'shape', 'pen', 'freehand-lasso', 'color'];
    for (let round = 0; round < 3; round++) {
      for (const tile of tiles) {
        await openToolFlyout(page, tile);
        await expect(page.getByRole('menu')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('menu')).toBeHidden();
      }
    }
  });
});
