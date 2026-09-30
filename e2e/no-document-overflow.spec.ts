import { expect, test, type Page } from '@playwright/test';

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
 * THIS USED TO PUBLISH THE WINDOW HEIGHTS AT WHICH THE RAIL OVERFLOWED, derived from a
 * `viewportHeight - 137` figure and a pair of content heights that were both wrong (1014px
 * and 612px against a grid that has never been either). No test asserted them, so they sat
 * here being plausible. The fit owns that question now: it collapses tiles into the
 * three-dots entry and asserts the rendered grid stays inside the budget at every height it
 * sweeps, and the window height at which even that is impossible is DISCOVERED TO THE PIXEL,
 * not named — by descending and bisecting in the last test in this file. So the numbers here
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
    // band search below runs at, where the same 822px grid is 294px TALLER than the 528px slot.
    // The 80%-of-available budget the fit actually honours is `e2e/toolbar-fit.spec.ts`'s
    // contract, swept across twelve heights, and is not restated here.
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
    // `scrollbar-none` went with it. It only overflows in the degenerate band — a window so
    // short that the budget cannot hold even the three-dots tile's row — so that is where the
    // suppression is exercised. The previous version of this test asserted suppression on an
    // element that can no longer overflow, which is asserting nothing.
    const slot = page.getByTestId('left-toolbar-slot');

    // THE BAND IS DISCOVERED, NOT NAMED — AND RESOLVED TO THE PIXEL, because a search is the
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
    // bisect to close, and land on the TALLEST height that degenerates — the most informative
    // point of the band, because it is the one with the most room left in it.
    const KNOWN_FIT = 1400;
    const SEARCH_FLOOR = 200;
    const DESCENT_FACTOR = 0.75;

    /**
     * One rung: resize, confirm the page really is at that height, and report whether the
     * slot's content no longer fits it.
     *
     * `inner` is read FROM THE PAGE on purpose. `page.viewportSize()` returns the value
     * `setViewportSize` stored on the object, so asserting against it compares the request
     * with itself and cannot observe a resize that did not apply, which is the one thing a rung
     * is for.
     */
    const degenerates = async (height: number) => {
      await open(page, 1280, height);
      const state = await slot.evaluate((el) => ({
        inner: window.innerHeight,
        over: el.scrollHeight - el.clientHeight,
      }));
      expect(
        state.inner,
        `the ${height}px rung must actually be the viewport, or nothing below measures what it claims`
      ).toBe(height);
      return state.over > 0;
    };

    // Phase 1, bracketing. Geometric rather than a fixed step, because a fixed step is either
    // coarse near the answer — which is the defect above — or a long walk down from the tall
    // end: ×0.75 puts the answer inside a 4/3 bracket in seven probes, where the 40px linear
    // step that reached the band at 320 took 28.
    const descent: number[] = [];
    let highestFit: number | null = null;
    let firstDegenerate: number | null = null;
    for (let height = KNOWN_FIT; height >= SEARCH_FLOOR; height = Math.floor(height * DESCENT_FACTOR)) {
      descent.push(height);
      if (await degenerates(height)) {
        firstDegenerate = height;
        break;
      }
      highestFit = height;
    }

    // Two states, two messages. `firstDegenerate` null after the whole descent means the rail no
    // longer degenerates ANYWHERE down to the floor — the search ran out, which is this test's
    // premise failing and not a product defect. It is not evidence that the rail cannot
    // degenerate, so it must not be reported as though it were. `highestFit` null means the tall
    // end itself degenerates, so there was never a bracket to close.
    expect(
      firstDegenerate,
      `the slot must still degenerate at some window height between ${SEARCH_FLOOR} and ${KNOWN_FIT}px — either the rail can no longer degenerate at any height (lower SEARCH_FLOOR) or it is broken, and those are not the same defect`
    ).not.toBeNull();
    expect(
      highestFit,
      `the slot must fit at ${KNOWN_FIT}px, or the descent has no bracket to bisect: a rail that degenerates at every height has no band to discover`
    ).not.toBeNull();

    // Phase 2, bisecting. Degeneration is monotone in height — measured: the slot's overflow is
    // 0 at every height from 1200 down to 329, 1 at 328, and 2 at 327 and at every height
    // sampled below it to 100, flat because the slot has stopped shrinking — so halving
    // [degenerate, fits] closes to the exact tallest height that degenerates.
    let degenerateHeight = firstDegenerate!;
    let stillFits = highestFit!;
    const bisected: number[] = [];
    while (stillFits - degenerateHeight > 1) {
      const mid = Math.floor((degenerateHeight + stillFits) / 2);
      bisected.push(mid);
      if (await degenerates(mid)) degenerateHeight = mid;
      else stillFits = mid;
    }

    // Printed, for the same reason `e2e/toolbar-fit.spec.ts` prints its sweep: the figure is
    // a result, not an input, so nobody should have to re-derive it to check this file's header
    // or to notice it moved. The degenerate band is every window height at or below the
    // boundary, and the tallest height that still fits is one pixel above it.
    console.log(
      `DEGENERATE BAND (1280 wide) descent=[${descent.join(',')}] bisect=[${bisected.join(',')}] ` +
        `boundary=${degenerateHeight} lastFit=${stillFits}`
    );

    // The bisection closes on a ONE-PIXEL bracket, so its last probe is whichever side of that
    // bracket it visited last rather than necessarily the height it settled on — measured, one
    // pixel above it. Entered explicitly, and re-checked on the way in: everything below
    // asserts the degenerate state, and running it a pixel above the band would be exactly the
    // vacuous assertion this whole block replaced.
    expect(
      await degenerates(degenerateHeight),
      'the height the search settled on must itself degenerate, or the assertions below are running above the band'
    ).toBe(true);

    expect(
      await slot.evaluate((el) => getComputedStyle(el).scrollbarWidth),
      `and at the discovered boundary (${degenerateHeight}px) the slot must suppress the scrollbar itself, not merely stop overflowing`
    ).toBe('none');

    // The thing suppression is allowed to cost: reachability. A scrollable slot with hidden
    // content would satisfy everything above, so the tile is scrolled into the slot's own
    // scrollport and its rect is checked against the SLOT's client box.
    //
    // `scrollIntoViewIfNeeded` IS THE STIMULUS, NOT THE EVIDENCE. It resolves only once the
    // element is in the viewport, and `boundingBox()` is viewport-relative, so the previous
    // version's "and it ends up inside the window" was a restatement of the call — it read back
    // the hundred-odd pixels of slack the call had just produced, on a rail that behaves
    // identically with or without the line. What is independent of the call is that the SLOT
    // scrolled, and that the tile's rect lands inside the slot's client box: the real claim is
    // reachable INSIDE the scrolling slot, not merely somewhere on screen, which is all
    // `toBeVisible` carries.
    const overflowTile = page.getByTestId('tool-overflow-tile');
    await expect(overflowTile, 'the one reachable tile is still reachable inside the scrolling slot').toBeVisible();

    const tileInSlot = () =>
      slot.evaluate((el) => {
        const tile = el.querySelector('[data-testid="tool-overflow-tile"]');
        if (!tile) return null;
        const slotBox = el.getBoundingClientRect();
        const tileBox = tile.getBoundingClientRect();
        // The CLIENT box, not the border box: `clientTop`/`clientHeight` exclude borders and
        // any scrollbar gutter, so this stays the right comparison on a runner that draws
        // classic scrollbars — which is the runner this file exists for.
        const top = slotBox.top + el.clientTop;
        const left = slotBox.left + el.clientLeft;
        return {
          scrollTop: el.scrollTop,
          insideVertically: tileBox.top >= top && tileBox.bottom <= top + el.clientHeight,
          insideHorizontally: tileBox.left >= left && tileBox.right <= left + el.clientWidth,
        };
      });

    // Non-vacuity for the containment check, and the reason the containment check is worth
    // anything at all: unclipped, the tile's bottom is BELOW the slot's client bottom — measured
    // one pixel below it at the boundary, two at 300px — which is the overflow this band exists
    // for. Asserting containment where the tile already fitted would be true before anything
    // scrolled.
    const unclipped = await tileInSlot();
    expect(unclipped, 'the three-dots tile must be a child of the slot to be measured at all').not.toBeNull();
    expect(
      unclipped!.insideVertically,
      `at ${degenerateHeight}px the tile must genuinely hang below the slot before anything scrolls, or the containment check below is already true and proves nothing`
    ).toBe(false);

    await overflowTile.scrollIntoViewIfNeeded();
    const reached = await tileInSlot();
    expect(reached, 'the three-dots tile must still be in the slot after scrolling it').not.toBeNull();
    expect(
      reached!.scrollTop,
      'and the SLOT must be what moved it, or the tile only came into view because the call put it there'
    ).toBeGreaterThan(unclipped!.scrollTop);
    expect(
      reached!.insideVertically,
      'the one reachable tile must land inside the slot own vertical scrollport, not merely on screen somewhere'
    ).toBe(true);
    expect(reached!.insideHorizontally, 'and inside it across, or the rail is clipping sideways too').toBe(true);
  });
});
