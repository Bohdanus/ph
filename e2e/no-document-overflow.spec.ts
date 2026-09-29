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
 * The left tool rail's geometry, measured in this browser at `deviceScaleFactor: 1` with a
 * 16px default font in en-US: **16** tool groups in **5** sections, **40** tool entries;
 * content **612px** tall in the two-column layout and **1014px** in one column, against an
 * available height of `viewportHeight - 137` — the shell's three `auto` grid rows. It
 * therefore overflows below a **749px** window in two columns and **1151px** in one, and two
 * columns overflows at *more* viewport heights than one column does.
 *
 * These are **font-metric dependent** and are asserted by no test, because CI runs
 * `ubuntu-latest` with Linux Chrome's fonts and none of them will hold there. This header
 * is the canonical copy; `AGENTS.md`, `SidebarLeft.tsx`, `responsive-shell.spec.ts` and
 * `SidebarLeft.tablet.test.tsx` each carry a short summary and point back here rather than
 * a second full set, because a number written in four places is a number that is wrong in
 * four places. The previous generation of those comments was wrong in exactly that way —
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

  test('the left tool rail stays scrollable to its last control with no scrollbar shown', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    // iPad 10.2" portrait, the viewport this one overflows at most in the matrix. The rail's
    // content is 1014px there against 943px of rail, so it genuinely overflows, which is why
    // this test exists rather than the previous one alone. A shorter desktop window overflows
    // by more. Hiding the scrollbar is only acceptable because the content stays reachable.
    const viewport = VIEWPORTS.find((v) => v.name.startsWith('iPad 10.2'))!;
    await open(page, viewport.width, viewport.height);

    const rail = page.getByTestId('left-sidebar');
    const overflow = await rail.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(
      overflow,
      'the rail is expected to overflow at this size; if it no longer does, update this test'
    ).toBeGreaterThan(0);

    const swatch = page.getByTestId('foreground-color-swatch');
    await swatch.scrollIntoViewIfNeeded();
    await expect(swatch, 'the bottom of the rail must still be reachable by scrolling').toBeVisible();
    const box = await swatch.boundingBox();
    expect(box!.y + box!.height, 'the swatch must end up inside the window').toBeLessThanOrEqual(viewport.height);
  });
});
