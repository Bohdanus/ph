/**
 * Pins the long-press flyout gesture against the race it used to lose.
 *
 * `SidebarLeft` arms a long-press timer on pointerdown and opens the flyout when it fires, while
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
 * So these tests inject the CONDITION instead — the same timer, delivered late — which
 * is deterministic, takes milliseconds, and fails the old helper every time.
 *
 * That injection is the whole reason this file needs the app's threshold, and it is exactly
 * what a threshold move breaks. It matched `delay === 300` while the app armed
 * `FLYOUT_LONG_PRESS_MS` (250 since the threshold moved), so the patch stretched NOTHING and
 * these tests passed against a condition that was never applied — a dead match is invisible,
 * because the app is perfectly healthy when no delay is injected and every assertion here
 * still holds. So `delayLongPressTimer` now reports what it actually matched, and each test
 * asserts on that report before it asserts on the app. A silently-empty patch fails; it does
 * not pass.
 *
 * The anchor is `FLYOUT_LONG_PRESS_MS` in `scheduleFlyoutOpen`, reached here through the
 * helper's mirror `LONG_PRESS_DELAY_MS`. A static import of the app's own export is NOT
 * available from a spec: `tsconfig.e2e.json` does not set `jsx`, so `tsc -b` rejects the
 * edge outright with
 * `TS6142: Module '../src/components/SidebarLeft/SidebarLeft' was resolved to ... but '--jsx'
 * is not set` — verified, not assumed. Playwright's own transform is separate from that
 * project and does load the file, which is precisely why the import has to be ruled out by
 * the gate that actually gates. The constant is named rather than numbered throughout, so a
 * line shift under us points a reader at the function instead of at whatever slid into it.
 */
import { expect, test } from './fixtures/extended-test';
import type { Page } from '@playwright/test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { getPageScroll } from './helpers/canvas-helpers';
// `LONG_PRESS_DELAY_MS` is the app's long-press threshold. NOT typed here: it is the
// repository's designated mirror of `SidebarLeft`'s exported `FLYOUT_LONG_PRESS_MS`, and
// `e2e/helpers/__tests__/toolbar-helpers.unit.test.ts` already asserts that mirror against the
// app's value. A literal written in this file would be a THIRD copy of one number — the same
// duplication that let a stale `300` sit here beside a `350` that was only ever compatible
// because `300 + 50 === 350`.
import { LONG_PRESS_DELAY_MS, openToolFlyout } from './helpers/toolbar-helpers';

/**
 * How much later than the app's own threshold the flyout timer is delivered.
 *
 * Not a wall-clock pin on the app: this is how much lateness the test INJECTS, and it is
 * added to `LONG_PRESS_DELAY_MS` everywhere it is used. The value is unchanged from when the
 * threshold was 300, so the stretched timer arrives at 950ms — still far past the 350ms the
 * retired fixed sleep lifted at, which is the margin that matters for the claim below.
 */
const LATE_TIMER_EXTRA_MS = 700;

/**
 * How often the poll samples for the menu, in milliseconds.
 *
 * This is the measurement resolution of {@link LATE_TIMER_EXTRA_MS}'s assertion: the poll can
 * only observe the open LATE, never early, so this is subtracted as tolerance rather than
 * added as expectation.
 */
const POLL_INTERVAL_MS = 25;

/** How long past the stretched timer's due time the poll keeps looking before reporting "never opened". */
const POLL_BUDGET_AFTER_DUE_MS = 1500;

/**
 * The tiles on the rail that own a flyout, read off the DOM at run time.
 *
 * This list used to be typed in — `['brush', 'shape', 'pen', 'freehand-lasso', 'color']` — and
 * that is a list of TOOLS, not of tiles, so it went stale the moment the rail learned to
 * collapse. At the suite's 1280x720 the rail shows seven of its fifteen groups plus a three-dots
 * tile, and the Clone Stamp, the Blur group, Gradient, Dodge, Draw, Pen, Type and Shape are
 * all inside that tile: `openToolFlyout` for any of them takes its collapse branch, opens the
 * three-dots flyout instead of the requested tile's, and the test passes while exercising the
 * wrong menu. Reading the tiles back is the fix: the subject is "every flyout tile on the rail",
 * and the DOM is the only thing that knows which tiles there are at this viewport.
 *
 * The COUNT is the second reason, and it is the one a list of tiles would not have caught either.
 * The rail showed five tiles at 1280x720 and shows seven, because the fit budgets the whole slot
 * now instead of four fifths of it. So the visible count is a step function of the window height
 * with nothing in this file's control, and a number written down beside it would be correct only
 * until the next fit change — which is exactly how the five-tile premise below went stale in the
 * first place.
 *
 * `aria-haspopup="menu"` is the app's own statement that a tile HAS a flyout
 * (`SidebarLeft.tsx:645`), so it is the filter rather than a name list — a tile with no group
 * behind it carries no such attribute and is not a subject here.
 */
const flyoutTiles = async (page: Page): Promise<string[]> =>
  page
    .locator('[data-toolbar-tile][aria-haspopup="menu"]')
    .evaluateAll((tiles) => tiles.map((tile) => tile.getAttribute('data-testid') ?? ''));

/**
 * The name of the flyout a tile opens, derived from that tile's own label.
 *
 * The app names a group menu `${primaryTool.label} tools` (`SidebarLeft.tsx:803`), and the tile
 * carries that same label as its `aria-label` (`:645`), so the two are one string apart. The
 * three-dots tile is the exception the app itself spells out (`:800`): it is not a tool, so its
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
 * `tool-button-<name>` is the app's own minting rule (`SidebarLeft.tsx:773`), so the name is
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

/** What the patched `setTimeout` actually saw, read back out of the page after the press. */
type LateTimerReading = {
  /** How many registrations the stretched branch took. Zero means the patch matched nothing. */
  stretched: number;
  /** Every distinct delay the app registered through the patched `setTimeout`, ascending. */
  delays: number[];
};

/** Reads the probe installed by {@link delayLongPressTimer}; zeroed if it was never installed. */
const readLateTimer = (page: Page): Promise<LateTimerReading> =>
  page.evaluate(() => {
    const probe = (window as unknown as { __lateFlyoutTimer?: { stretched: () => number; delays: () => number[] } })
      .__lateFlyoutTimer;
    return { stretched: probe ? probe.stretched() : 0, delays: probe ? probe.delays() : [] };
  });

/**
 * Delay the app's long-press timer by `extra`, which is what a busy renderer main thread does
 * to it: the timer is still correct, it is just delivered late.
 *
 * Only the delay is changed, and only for timers registered at `LONG_PRESS_DELAY_MS` — the
 * callback and the rest of the page are untouched, so the app is still the thing deciding when
 * the flyout opens.
 *
 * The patch also RECORDS what it saw, and that is not instrumentation for its own sake. A
 * `delay === N` match is a silent no-op the moment the app stops registering `N`, and nothing
 * downstream can detect it: the app is healthy when no delay is injected, so every assertion
 * in this file still holds against a condition that was never applied. The recorded count and
 * the set of delays actually seen are what turn that from a green lie into a named failure,
 * and they are asserted through the returned reader.
 *
 * Scoping honestly: the old claim "the only 300ms timer anywhere under src/" was true of 300 and
 * is FALSE of 250. `ToolTooltip.showTooltip` arms `window.setTimeout(..., 250)` for the same
 * number, so whenever a tooltip timer is armed this patch stretches that one too. It is not
 * armed by the bare pointerdown these tests dispatch — measured, the page registers `[250]` and
 * nothing else — but nothing here depends on tooltip timing either way, which is why the count
 * is asserted `toBeGreaterThan(0)` and not `toBe(1)`.
 */
async function delayLongPressTimer(page: Page, extra: number): Promise<{ read: () => Promise<LateTimerReading> }> {
  await page.evaluate(
    ([appDelay, extraMs]) => {
      const real = window.setTimeout.bind(window);
      const stretched = { count: 0 };
      const delays = new Set<number>();
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        const asNumber = typeof delay === 'number' ? delay : 0;
        delays.add(asNumber);
        const matches = asNumber === appDelay;
        if (matches) stretched.count += 1;
        return real(handler as () => void, matches ? appDelay + extraMs : delay, ...args);
      }) as typeof window.setTimeout;
      Object.assign(window, {
        __lateFlyoutTimer: {
          stretched: () => stretched.count,
          delays: () => [...delays].sort((a, b) => a - b),
        },
      });
    },
    [LONG_PRESS_DELAY_MS, extra] as const
  );
  return { read: () => readLateTimer(page) };
}

/**
 * Fail unless the injection above actually stretched something.
 *
 * The message names the delays the page really registered, because "the patch matched nothing"
 * is only actionable next to what it failed to match — that is the whole diagnosis, and it is
 * what a future threshold move needs in order to be a five-second fix rather than a hunt.
 */
const expectInjectionToHaveBit = async (probe: { read: () => Promise<LateTimerReading> }): Promise<void> => {
  const { stretched, delays } = await probe.read();
  expect(
    stretched,
    `the setTimeout patch stretched nothing, so this test is asserting against a condition that was ` +
      `never applied: it looks for ${LONG_PRESS_DELAY_MS}ms and the page registered ` +
      `[${delays.join(', ')}]ms. If the app's threshold moved, LONG_PRESS_DELAY_MS in ` +
      `e2e/helpers/toolbar-helpers.ts must move with it.`
  ).toBeGreaterThan(0);
};

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
    // The timer now arrives at 250 + 700 = 950ms, far past the 350ms the old helper lifted at.
    const probe = await delayLongPressTimer(page, LATE_TIMER_EXTRA_MS);

    const { name, tile } = await aFlyoutTool(page);
    await openToolFlyout(page, name);

    // Before reading anything about the app: did the condition under test actually exist? This
    // is what the test lost when the threshold moved out from under the patch's `delay === 300`.
    await expectInjectionToHaveBit(probe);

    await expect(page.getByRole('menu', { name: await flyoutMenuName(page, tile) })).toBeVisible();
  });

  test('the late timer is what the old lift cancelled, not a timeout that was too short', async ({ page }) => {
    // The differential proof, and it does not use the helper at all: press, never lift, and
    // the same stretched timer opens the flyout on its own. So the app is healthy and the
    // 2000ms budget is ample — 950ms is well inside it. What destroyed the open in the
    // flake was the helper's own pointerup arriving before the timer fired.
    const probe = await delayLongPressTimer(page, LATE_TIMER_EXTRA_MS);

    // The tile is read out of the DOM and interpolated in, because this dispatches the press
    // inside the page where a hard-coded selector for one tool's tile would be a claim that
    // tool is still on the rail — and at this viewport most are not.
    const { tile } = await aFlyoutTool(page);
    const openedAt = await page.evaluate(
      async ([dueAt, tileTestId, interval, budget]) => {
        const started = performance.now();
        document
          .querySelector(`[data-testid="${tileTestId}"]`)
          ?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
        // Re-queried every pass: the menu does not exist yet when the press starts, so
        // resolving it once would pin null and report "never opened" no matter what happened.
        while (performance.now() - started < dueAt + budget) {
          if (document.querySelector('[role="menu"]')) return performance.now() - started;
          await new Promise((resolve) => {
            window.setTimeout(resolve, interval);
          });
        }
        return null;
      },
      [LONG_PRESS_DELAY_MS + LATE_TIMER_EXTRA_MS, tile, POLL_INTERVAL_MS, POLL_BUDGET_AFTER_DUE_MS] as const
    );

    // Again, before anything about the app: the condition has to exist for the bound below to
    // be about lateness rather than about a flyout that simply opened on time.
    await expectInjectionToHaveBit(probe);

    // It opened, and it opened LATE. The bound is the stretched timer's DUE time, not a wall-clock
    // number of its own, for two reasons. The flyout cannot open before a timer that is due at
    // 950ms fires, so this is a floor the app itself guarantees — and it is a bound that a
    // DEAD injection cannot satisfy: with the patch matching nothing the menu appears at ~250ms
    // and this fails by ~650ms. Retiring the old `> 350` here would have done the opposite,
    // passing on a 360ms open and proving only that the app is not broken.
    expect(openedAt).not.toBeNull();
    expect(openedAt as number).toBeGreaterThanOrEqual(LONG_PRESS_DELAY_MS + LATE_TIMER_EXTRA_MS - POLL_INTERVAL_MS);
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
    // of five tool names, of which four were folded out of the rail at the time — three still are,
    // now that the fit takes the whole slot. Each of those took the three-dots branch and
    // reopened the SAME menu, so the test exercised one tile five times and reported it as five.
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
