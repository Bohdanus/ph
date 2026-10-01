import { expect, test, type Page } from './fixtures/extended-test';

import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The app must not show a scrollbar anywhere on its outer chrome.
 *
 * ## Why this asserts on CONTENT overflow and not on a painted scrollbar
 *
 * The obvious test — "is a scrollbar gutter taking layout space?" — is **vacuous in this
 * environment, and was measured to be so before this file was written.** On this machine,
 * in the headless Chrome Playwright launches:
 *
 *   - an element forced to `overflow: scroll` with content larger than itself reports
 *     `offsetWidth - clientWidth === 0` and `offsetHeight - clientHeight === 0`, and
 *   - injecting `::-webkit-scrollbar { width: 15px; height: 15px; background: #00ff00 }`
 *     into the page changes that to nothing, and paints nothing that a screenshot of the
 *     element's right and bottom edges can find.
 *
 * That is overlay, zero-width scrollbar behaviour, and the macOS "Always show scroll bars"
 * system setting is not reflected here — it is a window-server/AppKit preference and
 * headless Chrome does not take it. The UA is also spoofed to a Windows string, so Chrome's
 * platform-derived scrollbar styling is not the host's either.
 *
 * So a gutter assertion, or a "screenshot the right edge and look for a thumb" assertion,
 * passes forever no matter what the app does. It would be a test that cannot fail.
 *
 * What *is* sound, and what this file asserts, is the **sufficient** condition: if a box
 * contains no content that overflows it, then no scrollbar is required, so none is painted —
 * in overlay mode, in classic mode, on macOS, on Windows, on Linux, in CI. The scrollbar
 * rendering mode is an OS/browser preference and cannot change that implication. Asserting
 * "no overflowing content" is therefore strictly stronger than asserting "no painted
 * scrollbar", and it is the only one of the two that this environment can actually see.
 *
 * The first test below is the non-vacuity control that a gutter assertion would have
 * needed. It deliberately overflows the document and proves this file's own detector
 * reports it, so "no overflow found" can never be confused with "nothing was measured".
 *
 * ## The one place the numbers live
 *
 * The left tool rail's tool grid, measured in this browser at `deviceScaleFactor: 1` with a
 * 16px default font in en-US: **16** tool groups in **5** sections, **40** tool entries.
 * The rendered grid is **822px** tall in one column — 16 rows of a 44px tile at a 6px row gap
 * with 4 section rules, which is what `e2e/toolbar-fit.spec.ts` prints at its tallest height
 * and what its `tile`/`gap`/`sep` non-vacuity assertions pin between them. Two columns is
 * 8 rows with no section rules, so **394px** by that same arithmetic; nothing prints or
 * asserts that one, because `toolbar-fit.spec.ts` only measures the one-column layout.
 *
 * 822px IS THE WHOLE-SLOT FIT'S FIRST FULL RAIL, and saying so is the point. The budget is
 * the entire tools slot, floored to a whole pixel (`TOOLBAR_HEIGHT_BUDGET` in
 * `src/components/SidebarLeft/toolbar-overflow.ts`, which is where that constant lives and
 * why it is not restated here), so a slot of 822 is exactly what all sixteen rows need: at
 * 1280 wide the slot is the window height less 272px of fixed chrome — the offset is the shell's
 * other rows, and it is 26px shorter at 810 wide, which is why the iPad 10.2" portrait slot
 * below is 834px rather than 808px — so **1094px is the tallest window that shows sixteen tiles
 * and no three-dots tile**, and at 1093 the rail is already down to fourteen tiles plus the
 * tile. Fifteen tiles is unreachable and always was — fifteen rows plus the three-dots row IS
 * the 822px grid, so the tile and the fifteenth tile are the same 50px either way.
 *
 * THIS USED TO PUBLISH THE WINDOW HEIGHTS AT WHICH THE RAIL OVERFLOWED, derived from a
 * `viewportHeight - 137` figure and a pair of content heights that were both wrong (1014px
 * and 612px against a grid that has never been either). No test asserted them, so they sat
 * here being plausible. The fit owns that question now: it collapses tiles into the
 * three-dots entry and asserts the rendered grid stays inside the budget at every height it
 * sweeps, and the window heights at which the fit itself runs out are DISCOVERED TO THE PIXEL
 * rather than named — by descending and bisecting in the last test in this file, which finds
 * TWO of them, because the fit's own edge and the slot's are 37px apart and the previous
 * version of that test reported only the lower one under the wrong name. So the numbers here
 * are either measured by something or derived from what something measures.
 *
 * The content heights are **font-metric dependent**. This header is the canonical copy;
 * `AGENTS.md`, `SidebarLeft.tsx`, `responsive-shell.spec.ts`
 * and `SidebarLeft.tablet.test.tsx` each carry a short summary and point back here rather
 * than a second full set, because a number written in four places is a number that is wrong
 * in four places. The previous generation of those comments was wrong in exactly that way —
 * `"12 tool groups"`, `"~840px"` and `"177–377px"`, all three describing a layout that no
 * longer exists.
 */

/**
 * The outermost wrappers, outermost first. `#root > div` is the app's own grid shell
 * (`src/App.tsx`), which is a real element and is the last box before the panes begin.
 */
const OUTER_SHELL = ['html', 'body', '#root', '#root > div'] as const;

/**
 * Containers that are *supposed* to scroll — and therefore are permitted to overflow —
 * but must not paint a scrollbar to advertise it. Each is checked at a viewport where it
 * is actually laid out, because a check at a viewport where the element is `display: none`
 * asserts nothing at all.
 *
 * `axis` is the axis each one scrolls on, and it is named rather than inferred. CSS
 * computes a `visible` counterpart to a non-`visible` one as `auto`, so the rail's
 * `overflow-x` reads `auto` purely because its `overflow-y` is — which means an
 * `overflow-y: hidden` (exactly the regression that stranded the colour swatches) would
 * satisfy any assertion of the form "this element is a scroll container somewhere".
 */
const SILENT_SCROLLERS = [
  {
    selector: '[data-testid="left-sidebar"]',
    openWith: undefined,
    label: 'the left tool rail',
    axis: 'overflowY',
    viewport: { width: 1280, height: 800 },
  },
  {
    selector: '[data-testid="mobile-bottom-bar"]',
    openWith: undefined,
    label: 'the mobile bottom tool bar',
    axis: 'overflowX',
    viewport: { width: 390, height: 844 },
  },
  // The options sheet only exists once it is open, and it is selected by id rather than by
  // testid, which is why this list carries a `selector` and not a test id. Measured to
  // overflow its own width by 309px at 390×844 with the sheet up, which is a painted
  // horizontal scrollbar inside a full-width fixed overlay on a phone — and the document does
  // not overflow while it is open, so the outer-shell matrix cannot see it from outside.
  {
    selector: '#mobile-tool-options',
    label: 'the mobile tool options sheet',
    axis: 'overflowX',
    viewport: { width: 390, height: 844 },
    openWith: '[data-testid="mobile-tool-options-toggle"]',
  },
] as const;

/**
 * Typical macOS desktop windows and iPad viewports, in CSS pixels.
 *
 * The iPad entries are real device logical sizes, not invented ones, and the set is chosen
 * to hit both sides of the app's two breakpoints: `width < 768` (mobile), `768 <= width <
 * 1024` (tablet, one-column rail) and `width >= 1024` (desktop, two-column rail). 1024 is
 * included and matters: `max-lg:` emits `width < 1024`, so **exactly** 1024 takes the
 * desktop rules, which is the iPad Pro 12.9" portrait width and the one case where a
 * desktop-band rule meets an iPad.
 */
const VIEWPORTS = [
  { name: 'MacBook 14" at native resolution', width: 1512, height: 982 },
  { name: 'MacBook 16" at native resolution', width: 1728, height: 1117 },
  { name: 'MacBook 14" at the default scaled resolution', width: 1440, height: 900 },
  { name: '13" MacBook, or Full HD at 125%', width: 1280, height: 800 },
  { name: 'Full HD external display', width: 1920, height: 1080 },
  { name: 'iPad mini, portrait', width: 744, height: 1133 },
  { name: 'iPad mini, landscape', width: 1133, height: 744 },
  { name: 'iPad 10.2", portrait', width: 810, height: 1080 },
  { name: 'iPad Air 11", portrait', width: 820, height: 1180 },
  { name: 'iPad Pro 11", portrait', width: 834, height: 1194 },
  { name: 'iPad Pro 11", landscape', width: 1194, height: 834 },
  { name: 'iPad Pro 12.9", portrait — exactly on the desktop breakpoint', width: 1024, height: 1366 },
  { name: 'iPad Pro 12.9", landscape', width: 1366, height: 1024 },
] as const;

async function open(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(getWorkspaceCanvas(page)).toBeVisible();
}

/** Every outer box's overflow, in one round trip. Takes the selectors as an argument. */
function readOuterShell(selectors: readonly string[]) {
  return selectors.map((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { selector, missing: true as const };
    return {
      selector,
      missing: false as const,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: getComputedStyle(el).overflowX,
      overflowY: getComputedStyle(el).overflowY,
    };
  });
}

/**
 * The tool grid as the user sees it: from the top of the first visible tile to the bottom of
 * the last section, so it includes every separator between them. The same measurement
 * `e2e/toolbar-fit.spec.ts` prints, read here so the control in the last test is a
 * measurement rather than this file's own 822px constant — a control that reads a constant
 * cannot notice the constant going stale.
 *
 * `collapsed` says whether anything went into the three-dots entry, which is what decides
 * whether the height returned is the WHOLE grid or a grid that has already been fitted.
 */
function measureRenderedGrid(page: Page) {
  return page.evaluate(() => {
    const tools = document.querySelector('[data-testid="left-toolbar-tools"]');
    if (!tools) return null;
    const lists = [...tools.querySelectorAll<HTMLElement>(':scope > ul')].filter((list) => list.childElementCount > 0);
    const firstTile = lists[0]?.querySelector<HTMLElement>('[data-toolbar-tile]') ?? null;
    const lastList = lists[lists.length - 1] ?? null;
    if (!firstTile || !lastList) return null;
    return {
      height: lastList.getBoundingClientRect().bottom - firstTile.getBoundingClientRect().top,
      collapsed: tools.querySelector('[data-testid="tool-overflow-tile"]') !== null,
    };
  });
}

test.describe('The shell paints no scrollbar', () => {
  test('the detector this file relies on can actually see an overflow', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, 1280, 800);

    // The shell is clean at this size, and the next test asserts exactly that. Without
    // this control, "found nothing" and "measured nothing" are the same result, and the
    // whole file could pass while broken — which is exactly what a zero-width overlay
    // scrollbar would produce.
    const before = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));
    expect(before.scrollHeight, 'the control only means something if the shell is clean first').toBeLessThanOrEqual(
      before.clientHeight
    );

    // Now overflow the document on purpose, past the viewport, and prove the same two
    // numbers notice.
    await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.cssText = 'height:4000px;width:4000px;';
      document.body.appendChild(probe);
    });
    const after = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }));

    expect(after.scrollWidth, 'a deliberately oversized element must be detected on the x axis').toBeGreaterThan(
      after.clientWidth
    );
    expect(after.scrollHeight, 'a deliberately oversized element must be detected on the y axis').toBeGreaterThan(
      after.clientHeight
    );
  });

  for (const viewport of VIEWPORTS) {
    test(`the outermost wrappers hold no overflowing content at ${viewport.name} (${viewport.width}×${viewport.height})`, async ({
      page,
    }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, viewport.width, viewport.height);

      // Non-vacuity for the matrix itself: if the resize silently did not happen, every
      // assertion below would be a duplicate of the previous viewport and this file would
      // claim coverage it does not have.
      const applied = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));
      expect(applied, 'the viewport must actually be the one this test names').toEqual({
        width: viewport.width,
        height: viewport.height,
      });

      const boxes = await page.evaluate(readOuterShell, OUTER_SHELL);
      expect(
        boxes.filter((box) => box.missing).map((box) => box.selector),
        'every outer wrapper must exist to be checked, or this viewport is untested'
      ).toEqual([]);

      for (const box of boxes) {
        if (box.missing) continue;

        // Zero, not a tolerance. `scrollWidth` and `clientHeight` are integers in Chrome, so
        // there is no sub-pixel fraction to allow for, and it was measured to be exactly 0 at
        // every viewport in the matrix above plus 360×640 and 1280×720. A scrollbar appears
        // on `scrollHeight > clientHeight` at ONE pixel, so slack here would be slack in the
        // very comparison that decides whether a scrollbar is painted.
        expect(
          box.scrollWidth - box.clientWidth,
          `${box.selector} overflows horizontally at ${viewport.width}×${viewport.height}, so it shows a scrollbar`
        ).toBe(0);
        expect(
          box.scrollHeight - box.clientHeight,
          `${box.selector} overflows vertically at ${viewport.width}×${viewport.height}, so it shows a scrollbar`
        ).toBe(0);

        // The precondition the whole file rests on. "No overflowing content ⇒ no scrollbar"
        // is only true because nothing here is `overflow: scroll`, which paints a scrollbar
        // with no overflow at all. `overflow: auto` is fine — it paints nothing when there is
        // nothing to scroll — and `visible` is fine. `scroll` is the one value that would let
        // a scrollbar onto the chrome while every assertion above still passed.
        expect(
          box.overflowX === 'scroll' || box.overflowY === 'scroll',
          `${box.selector} is overflow:scroll, which paints a scrollbar even with nothing to scroll; use auto`
        ).toBe(false);
      }
    });
  }

  test('the shell needs no scrollbar, whether or not this runner draws one', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await open(page, 1512, 982);

    // This is the one assertion in the file that is about the shell's SCROLLABILITY rather
    // than its geometry, and it is what makes the file correct on a runner that does draw
    // classic scrollbars. Where scrollbars are zero-width overlays it is trivially true;
    // where they occupy layout space — Linux and Windows CI, and a macOS host with "Always
    // show scroll bars" — it is the direct test the rest of the file stands in for.
    //
    // Note what this file deliberately does NOT assert: the value of the scrollbar gutter.
    // That is a property of the runner's platform and its scrollbar setting, not of the app,
    // and asserting it would make this spec pass on macOS with overlay scrollbars and fail
    // everywhere else. The measured environment-specific numbers are in the header.
    const { hasVerticalScrollbar, hasHorizontalScrollbar } = await page.evaluate(() => {
      const de = document.documentElement;
      return {
        hasVerticalScrollbar: de.scrollHeight > de.clientHeight,
        hasHorizontalScrollbar: de.scrollWidth > de.clientWidth,
      };
    });

    expect(hasVerticalScrollbar, 'the document must not be vertically scrollable').toBe(false);
    expect(hasHorizontalScrollbar, 'the document must not be horizontally scrollable').toBe(false);
    // These two are the same fact the matrix asserts, restricted to the part of it that
    // holds on every runner: a document is scrollable the instant it overflows by one
    // pixel. A runner that draws classic scrollbars additionally reports a non-zero
    // gutter, and that is the healthy case rather than a failure.
    expect(hasVerticalScrollbar, 'the document must not be vertically scrollable').toBe(false);
    expect(hasHorizontalScrollbar, 'the document must not be horizontally scrollable').toBe(false);
  });
});

test.describe('Containers that scroll do so without a scrollbar', () => {
  for (const { selector, label, axis, viewport, openWith } of SILENT_SCROLLERS) {
    test(`${label} hides its scrollbar chrome`, async ({ page }) => {
      test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
      await open(page, viewport.width, viewport.height);

      if (openWith) {
        await page.locator(openWith).click();
      }

      const element = page.locator(selector);
      // No `isVisible()` early-return branch. An earlier version had one that called
      // `toBeHidden()` — a real assertion, but an assertion about the element being absent,
      // not about its scrollbar — and the mobile bar ran at a desktop viewport, so it took
      // that branch every single time and its scrollbar was never once checked. Each
      // container is measured at a viewport where it is laid out, so it must be present.
      await expect(element, `${label} must be laid out at ${viewport.width}×${viewport.height}`).toBeVisible();

      // The container still scrolls — this is the load-bearing half. `overflow: hidden`
      // would also remove a scrollbar, and it is documented in `src/index.scss` as the
      // mistake that stranded the colour swatches with no way to reach them.
      const state = await element.evaluate((el) => {
        const styles = getComputedStyle(el);
        return {
          overflowY: styles.overflowY,
          overflowX: styles.overflowX,
          scrollbarWidth: styles.scrollbarWidth,
        };
      });

      // The scrolling axis, and only that one. See `SILENT_SCROLLERS` on why this cannot
      // be an "either axis" check.
      expect(
        state[axis],
        `${label} must stay scrollable on its ${axis}, or content below the fold is unreachable`
      ).toBe('auto');
      expect(state.scrollbarWidth, `${label} must suppress the scrollbar itself, not merely stop overflowing`).toBe(
        'none'
      );
    });
  }

  test('the tool rail FITS rather than overflowing, and the band that must scroll does so with no scrollbar', async ({
    page,
  }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // This test used to assert that the rail OVERFLOWS at iPad 10.2 portrait and that scrolling
    // it keeps the last control reachable, and it even carried the message "if it no longer
    // does, update this test". It no longer does, and that is the point of the change rather
    // than a regression: the rail's grid does not fit, and instead of demanding the difference
    // the tiles are fitted to the space they have and the rows that do not fit move into the
    // three-dots tile. The premise, not the claim, went stale — so both halves are now stated
    // against what is actually true, and the suppression is asserted where it can now be
    // exercised.
    //
    // AND THE FIT MUST BE LOAD-BEARING AT THIS HEIGHT FOR ANY OF THAT TO MEAN ANYTHING. It is
    // load-bearing only where the whole one-column grid cannot fit the slot unshrunk, and at
    // iPad 10.2" portrait — where this test used to run, and where the earlier version of it
    // measured — the slot is 834px against a grid of 822px. The whole grid FITS: the rail does
    // not overflow, and the assertion below passes with the collapse fit deleted from the app
    // entirely. That is a test that cannot fail, and no amount of wording makes it otherwise.
    //
    // So the viewport is 1280×800, one of this file's own matrix viewports and the width the
    // band search below runs at, where the same 822px grid is 294px TALLER than the 528px slot
    // and the fit keeps nine tool rows plus the tile. The budget it honours is the WHOLE slot,
    // floored — `e2e/toolbar-fit.spec.ts` is that rule's contract and sweeps it across its own
    // height list, and the constant itself lives in
    // `src/components/SidebarLeft/toolbar-overflow.ts`, so it is not restated here.
    await open(page, 1280, 1400);
    const wholeGrid = await measureRenderedGrid(page);
    expect(wholeGrid, 'the untruncated grid must be measurable, or the control below measured nothing').not.toBeNull();
    expect(
      wholeGrid!.collapsed,
      'nothing may collapse at the height the whole grid is measured at, or "the whole grid" is the collapsed grid and the control is vacuous'
    ).toBe(false);

    await open(page, 1280, 800);
    const slotHeight = await page
      .getByTestId('left-toolbar-slot')
      .evaluate((el) => Math.round(el.getBoundingClientRect().height));
    expect(
      wholeGrid!.height,
      `the whole one-column grid must NOT fit the ${slotHeight}px slot at 1280×800, or the collapse assertions here prove nothing`
    ).toBeGreaterThan(slotHeight);

    const rail = page.getByTestId('left-sidebar');
    const overflow = await rail.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, 'the rail fits its row: the tiles collapse rather than push the page taller').toBe(0);

    // And what replaced the overflow is the tile, not a gap: the tools that no longer fit are
    // reachable, so "the rail does not overflow" is not "the rail lost tools".
    await expect(
      page.getByTestId('tool-overflow-tile'),
      'the tiles that do not fit have somewhere to go'
    ).toBeVisible();
    const swatch = page.getByTestId('foreground-color-swatch');
    await expect(swatch, 'and the last control is where it always was, unpainted-over by nothing').toBeVisible();

    // The scroll container MOVED: it is the tools slot now, not the aside, and the
    // `scrollbar-none` went with it. It only overflows at the very bottom of the fit's range —
    // a window so short that the slot cannot hold even the lone three-dots row — so that is
    // where the suppression is exercised. The previous version of this test asserted suppression
    // on an element that can no longer overflow, which is asserting nothing.
    const slot = page.getByTestId('left-toolbar-slot');

    // TWO BANDS, AND CALLING THEM ONE IS WHAT WENT WRONG IN THE PREVIOUS VERSION.
    //
    // The fit gives up on TOOL ROWS where the budget can no longer hold a row, its gap and the
    // three-dots tile's own row — no tool tile at all, only the tile. That is a statement about
    // the FIT, and its top edge moved with the budget: under the old 0.8 factor the same three
    // rows needed a 118px slot, a 390px window; filling the whole slot they need 94px, and the
    // top of the band is now a 365px window against a 93px slot.
    //
    // THE SLOT'S OWN EDGE NO LONGER EXISTS, and that is the whole of what the second search used
    // to find. It used to be a DIFFERENT, LOWER height — 37px below this one, measured — and the
    // edge was a property of the slot's own clamp rather than of the fit's arithmetic: the slot
    // stopped shrinking at 55px (a 327px window) and 55 could not hold the lone three-dots row,
    // which rendered at **57px** because the tile was being placed in the LAST section and that
    // section's `<ul>` carries `mt-1.5 border-t pt-1.5`. Thirteen pixels of separator chrome for a
    // separator with nothing above it, in the one state where the slot has no pixels to spare.
    // The tile now goes in section 0, the lone row is 44px, and 44 fits 55. **The old detection
    // watched that second edge and printed it as "THE DEGENERATE BAND"**, which made the test
    // state a falsehood about 37px of real band: at a 340px window the fit has already given up
    // on every tool row, and the test called 329 — a height that fits a tool row — "the tallest
    // height that still fits".
    //
    // So the first band is found STRUCTURALLY, from what the rail is: no tool tile, three-dots
    // tile present. The arithmetic that produced 94 is the app's rule copied into a test, where
    // a change to a tile or a gap moves it silently — which is exactly what a budget change
    // does, and exactly the kind of number a search is here instead to avoid.

    /**
     * One rung of the first search: resize, confirm the page really is at that height, and
     * report what the rail is showing.
     *
     * `inner` is read FROM THE PAGE on purpose. `page.viewportSize()` returns the value
     * `setViewportSize` stored on the object, so asserting against it compares the request
     * with itself and cannot observe a resize that did not apply, which is the one thing a rung
     * is for. The second search's rung asserts it independently, rather than trusting this one
     * to have left the page in a state worth measuring.
     */
    const fitGaveUp = async (height: number) => {
      await open(page, 1280, height);
      const state = await page.evaluate(() => {
        const tiles = [
          ...document.querySelectorAll<HTMLElement>('[data-testid="left-toolbar-tools"] [data-toolbar-tile]'),
        ];
        const railEl = document.querySelector('[data-testid="left-sidebar"]');
        return {
          inner: window.innerHeight,
          toolTiles: tiles.filter((tile) => tile.dataset.testid !== 'tool-overflow-tile').length,
          threeDots: tiles.some((tile) => tile.dataset.testid === 'tool-overflow-tile'),
          railOver: railEl ? railEl.scrollHeight - railEl.clientHeight : Number.NaN,
        };
      });
      expect(
        state.inner,
        `the ${height}px rung must actually be the viewport, or nothing below measures what it claims`
      ).toBe(height);
      return state;
    };

    // THE BANDS ARE DISCOVERED, NOT NAMED — AND RESOLVED TO THE PIXEL, because a search is the
    // only resolution that does not put the magic height back. It used to be reached at a
    // hardcoded 380px, and that number is a property of the rail's chrome — its padding, its
    // rules, the height of its colour cluster — rather than of the behaviour under test.
    // Flattening the rail took 69px of fixed chrome out of the column (`py-4`→`py-2` 16,
    // `mb-2`→`mb-1` 4, `my-3`→`my-2` 8, the dead `<hr>` 25, `mt-4` 16) and 14px more out of the
    // tools box, the hardcoded 380 was wrong afterwards, and the assertion failed on a rail
    // that was behaving correctly. A test that names a magic height is a test that the next
    // spacing change fails.
    //
    // THE BOUNDARY IS NOT A LINEAR TERM IN THAT CHROME, which is why it cannot be re-tuned by
    // adding back what was removed, and why the 52px the hardcoded 380 gave was never going to
    // be the 83px that came out of the column. Measured at 1280 wide: the slot's height is
    // `window.innerHeight - 272` at every height from 331 to 1200 — one constant offset set by
    // the shell's other rows, not by the rail's own padding — and from 327 down the slot stops
    // shrinking altogether and clamps at 55px. The band is a clamp meeting an offset, not a sum,
    // so the removed padding was never its top edge.
    //
    // IT WAS A FIXED LADDER, [380, 300, 240, 190, 150, 120], AND THE LADDER WAS COARSER THAN
    // THE CHANGE IT EXISTS TO ABSORB: an 80px top step against 83px of chrome, so it reported
    // 300 — 28px BELOW the boundary it was supposed to discover — and would have reported
    // something else again for every rung it stepped over. A ladder degrades the moment the
    // boundary moves further than its coarsest step, and rungs chosen to bracket the answer
    // would be the same defect with the answer typed into the array. So: descend to bracket,
    // bisect to close, and land on the TALLEST height in the band — the most informative point
    // of it, because it is the one with the most room left in it.
    const KNOWN_FIT = 1400;
    const SEARCH_FLOOR = 200;
    const DESCENT_FACTOR = 0.75;
    /**
     * Where the slot sweep drops to one pixel.
     *
     * The slot stops shrinking below a 327px window, so the only heights at which its content can
     * possibly fail to fit are at and below it — and a seven-pixel band there is invisible to a
     * 50px step, which is the defect class this file exists for. 400 is above that clamp with room
     * to spare (the slot is 128px there against a 44px tile) and above the fit's give-up edge at
     * 365, so everything below it is the region where "the slot must fit" is the only claim that
     * could be false.
     */
    const CLAMP_PROBE_TOP = 400;

    /**
     * Descend to bracket, then bisect to a one-pixel bracket, for a band named by a predicate.
     *
     * `from` is a height at which the band is known NOT to hold, so it doubles as the upper end
     * of the bracket; that is what lets the second search start where the first one finished
     * instead of paying for a second descent from 1400.
     */
    const findBand = async (label: string, holds: (height: number) => Promise<boolean>, from: number) => {
      const descent: number[] = [];
      let lastFit: number | null = null;
      let firstInBand: number | null = null;
      for (let height = from; height >= SEARCH_FLOOR; height = Math.floor(height * DESCENT_FACTOR)) {
        descent.push(height);
        if (await holds(height)) {
          firstInBand = height;
          break;
        }
        lastFit = height;
      }

      // Two states, two messages. `firstInBand` null after the whole descent means the band no
      // longer exists ANYWHERE down to the floor — the search ran out, which is this test's
      // premise failing and not a product defect. It is not evidence that the band cannot
      // happen, so it must not be reported as though it were. `lastFit` null means the tall end
      // itself is in the band, so there was never a bracket to close.
      expect(
        firstInBand,
        `${label} must hold at some window height between ${SEARCH_FLOOR} and ${from}px — either it no longer happens at any height (lower SEARCH_FLOOR) or it is broken, and those are not the same defect`
      ).not.toBeNull();
      expect(
        lastFit,
        `${label} must NOT hold at ${from}px, or the descent has no bracket to bisect: a state that holds at every height has no band to discover`
      ).not.toBeNull();

      // Phase 2, bisecting. Both bands are monotone in height — measured for the slot's, and
      // a step function of a height that only shrinks for the fit's — so halving
      // [in band, out of band] closes on the exact tallest height in the band.
      const bisected: number[] = [];
      let inBand = firstInBand!;
      let fits = lastFit!;
      while (fits - inBand > 1) {
        const mid = Math.floor((inBand + fits) / 2);
        bisected.push(mid);
        if (await holds(mid)) inBand = mid;
        else fits = mid;
      }
      return { descent, bisected, boundary: inBand, lastFit: fits };
    };

    // Band one, the fit's own: every tool row has gone and only the three-dots tile is left.
    const fitBand = await findBand(
      'the fit must still give up on every tool row',
      async (height) => {
        const state = await fitGaveUp(height);
        return state.toolTiles === 0 && state.threeDots;
      },
      KNOWN_FIT
    );

    // The two bands, both asserted to be bands rather than one height. The first is the top of
    // the fit's give-up range: no tool tile at all, only the three-dots tile, and — the half
    // that is easy to leave out — the rail still fits its row, because giving up on the tool
    // rows is the fit working, not the document overflowing. That is this file's central claim
    // stated at the one height where the fit has nothing left to fold.
    const gaveUp = await fitGaveUp(fitBand.boundary);
    expect(
      gaveUp.toolTiles,
      `at ${fitBand.boundary}px the fit must have given up on every tool row, or the search found the wrong state`
    ).toBe(0);
    expect(gaveUp.threeDots, 'and the three-dots tile must still be there to hold the sixteen groups').toBe(true);
    expect(
      gaveUp.railOver,
      `the rail must still fit its row at ${fitBand.boundary}px with no tool tile at all, or "the fit gave up" is the document growing a scrollbar`
    ).toBe(0);

    // AND ONE PIXEL TALLER A TOOL ROW FITS AGAIN, which is what makes this the top edge of a
    // band rather than an arbitrary pixel the search happened to stop on. A count of exactly one
    // is deliberately NOT asserted: a shorter tile or a narrower gap would move the edge and
    // raise the count, which is a correct rail and not a failure.
    const oneTaller = await fitGaveUp(fitBand.boundary + 1);
    expect(
      oneTaller.toolTiles,
      `at ${fitBand.boundary + 1}px at least one tool row must fit again — that is what makes ${fitBand.boundary}px the top of the band and not an arbitrary probe`
    ).toBeGreaterThan(0);
    expect(oneTaller.threeDots, 'and the tile must still be there, because fifteen of sixteen is still a fold').toBe(
      true
    );

    // AND THE SLOT NEVER SCROLLS ANYWHERE, which is the second half of this file's claim and was
    // a separate search until the lone tile's 13px went away.
    //
    // There used to be a SECOND BAND, 37px below the fit's, where the slot itself was forced to
    // scroll: at the bottom of the range the fit keeps only the three-dots tile, and it used to
    // put that tile in the LAST section, whose `<ul>` carries `mt-1.5 border-t pt-1.5` — 13px of
    // separator chrome for a separator with nothing above it. The planner charges a lone tile
    // `tileHeight` and nothing more, so the model said 44px and the screen showed 57px, and a
    // slot clamped at 55px could not hold it. The fit now puts the lone tile in section 0,
    // which carries none of that, and 44px fits 55px. **The band does not exist.**
    //
    // Which is a stronger claim than the one it replaces, so it is asserted as one: a sweep over
    // the whole range rather than a search for an edge. The slot's `overflow-y-auto` and its
    // `scrollbar-none` remain as a backstop — a rail that could hide a tool would be worse than
    // one that scrolls — but nothing in the rail's own geometry reaches them any more, and a
    // backstop nothing can reach is a backstop nobody has evidence works.
    const slotOverAt = async (height: number): Promise<{ inner: number; over: number }> => {
      await open(page, 1280, height);
      const state = await slot.evaluate((el) => ({
        inner: window.innerHeight,
        over: el.scrollHeight - el.clientHeight,
      }));
      expect(
        state.inner,
        `the ${height}px rung must actually be the viewport, or nothing below measures what it claims`
      ).toBe(height);
      return state;
    };

    const slotOverHeights: string[] = [];
    for (let height = KNOWN_FIT; height >= SEARCH_FLOOR; height -= 50) {
      const state = await slotOverAt(height);
      if (state.over > 0) slotOverHeights.push(`H=${height} by ${state.over}px`);
    }
    expect(
      slotOverHeights,
      'the slot must not need its own scrollport at any window height, or the fit is charging a row it is not rendering'
    ).toEqual([]);

    // Printed, for the same reason `e2e/toolbar-fit.spec.ts` prints its sweep: the figures are
    // results, not inputs, so nobody should have to re-derive them to check this file's header or
    // to notice they moved. The band is every window height at or below its boundary, and the
    // tallest height outside it is one pixel above.
    console.log(
      `FIT BAND (1280 wide) descent=[${fitBand.descent.join(',')}] bisect=[${fitBand.bisected.join(',')}] ` +
        `boundary=${fitBand.boundary} lastFit=${fitBand.lastFit}`
    );
    console.log(
      `SLOT SWEEP (1280 wide) heights=${SEARCH_FLOOR}..${KNOWN_FIT} step=50 above ${CLAMP_PROBE_TOP}, ` +
        `step=1 below it overflowing=${slotOverHeights.length}`
    );

    // The backstop is still there and still suppressed, so that IF the arithmetic is ever wrong
    // the tools it misjudged are reachable rather than clipped out of existence. Asserted at the
    // bottom of the range, where the tile is the only thing the rail has left.
    expect(
      await slot.evaluate((el) => getComputedStyle(el).scrollbarWidth),
      'the slot must suppress the scrollbar itself, not merely stop overflowing'
    ).toBe('none');

    // Which leaves the one thing that matters at the bottom of the range: the tile is there, and
    // it is inside the slot's own CLIENT box — the box that excludes borders and any scrollbar
    // gutter, so this is the right comparison on a runner that draws classic scrollbars.
    const overflowTile = page.getByTestId('tool-overflow-tile');
    await expect(overflowTile, 'the one reachable tile is still there at the bottom of the range').toBeVisible();
    await expect
      .poll(async () =>
        slot.evaluate((el) => {
          const tile = el.querySelector('[data-testid="tool-overflow-tile"]');
          if (!tile) return false;
          const slotBox = el.getBoundingClientRect();
          const tileBox = tile.getBoundingClientRect();
          const top = slotBox.top + el.clientTop;
          const left = slotBox.left + el.clientLeft;
          return (
            tileBox.top >= top &&
            tileBox.bottom <= top + el.clientHeight &&
            tileBox.left >= left &&
            tileBox.right <= left + el.clientWidth
          );
        })
      )
      .toBe(true);
  });
});
