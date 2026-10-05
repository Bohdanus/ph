import { expect, type Page, type TestInfo, test } from './fixtures/extended-test';
import {
  NON_TEXT_FLOOR,
  type Rgb,
  contrastRatioOver,
  contrastRatioUnderFilter,
  formatRatio,
  parseColor,
  parseFilter,
  textContrastFloor,
} from './helpers/contrast';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The two toolbars' contrast, MEASURED in a browser, in the dark theme.
 *
 * ## Why this exists when `e2e/accessibility.spec.ts` already runs axe
 *
 * That file is the a11y audit, and it says plainly that it pins the LIGHT theme and that a green run
 * on it says nothing about dark mode. It also audits only what axe judges, which is text nodes. So
 * there were two classes of defect it structurally could not catch here, and both were live:
 *
 * - **A control whose text colour is set nowhere.** The Ruler's `Clear` button carried no
 *   text-colour utility and no ancestor in the chain set one either, so it inherited the user agent's
 *   `canvastext` — `#000000` — and was drawn black on a `#1f2937` options bar: **1.43:1**. It is
 *   perfectly readable in light (10.31:1), and light is the pinned theme, so nothing ever saw it.
 *   axe did not report it either, because it declines to judge text over a surface it has to
 *   composite and a `button` with no declared colour is one of the shapes it marks `incomplete`.
 * - **A boundary rather than a pair of text colours.** The seven readout boxes were
 *   `dark:bg-gray-800` on a `dark:bg-gray-800` bar — 1.00:1, the fill being the bar's own colour, so
 *   the box existed only as a `dark:border-gray-600` edge at 1.94:1. There is no text pair here at
 *   all, so no text-contrast rule applies and axe has nothing to say.
 *
 * Both were reported from a SCREENSHOT rather than from a linter, which is the whole argument for
 * this file: a human looked at the dark options bar and saw an invisible button.
 *
 * ## What it asserts, and how the floors are chosen
 *
 * A floor is derived per element from WCAG's own definition — `textContrastFloor` returns 4.5 for
 * ordinary text and 3.0 for large text — rather than being written next to each case, so a class
 * change that resizes a label moves its floor with it instead of silently keeping the old one.
 * `NON_TEXT_FLOOR` applies to a component's boundary, which is WCAG 1.4.11.
 *
 * The ratios are computed by `e2e/helpers/contrast.ts`, which has its own unit tests in
 * `e2e/helpers/__tests__/contrast.unit.test.ts`; this file resolves WHAT is painted over, which needs
 * a DOM, and delegates the arithmetic.
 *
 * ## What a green run does NOT prove
 *
 * It measures the elements listed below, in the dark theme, at one viewport, with one tool selected.
 * It does not cover the flyouts' hover states, the tooltips, the right dock, the mobile drawers, the
 * light theme's boundaries, or any element not named here. The dimmed unimplemented tools are covered
 * because they are seven of the rail's tiles and the one treatment the operator asked for; the light
 * theme's residual shortfall is stated in `SidebarLeft.scss` rather than gated here, because this
 * file's subject is the theme the operator reported.
 */

type Reading = {
  /** Every `background-color` from the element upward, nearest first. */
  backgrounds: string[];
  /**
   * The same walk starting at the element's PARENT.
   *
   * A component's boundary is judged against the surface its outer edge abuts, which is never the
   * element's own fill. Slicing `backgrounds` to drop it is wrong whenever the fill is opaque, because
   * the walk stops there and the slice is empty; this is collected in the same pass instead.
   */
  outsideBackgrounds: string[];
  color: string;
  borderColor: string;
  borderWidth: string;
  fontSize: string;
  fontWeight: string;
  /** The element's own computed `filter`, which is where a dim lives. */
  filter: string;
};

/**
 * Reads one element's painted state, including its whole background chain.
 *
 * The chain is what makes a translucent surface measurable: the rail tile's fill is
 * `color-mix(in oklab, … 60%, transparent)`, so its contrast is only defined against what is behind
 * it, and stopping at the element would report a ratio against a colour the user cannot see.
 */
const readPainted = (page: Page, selector: string): Promise<Reading> =>
  page.evaluate((target) => {
    /**
     * The alpha inside a computed colour, WITHOUT converting it.
     *
     * Declared INSIDE this callback on purpose: `page.evaluate` serialises the function and runs it in
     * the page, so it cannot see anything from this module — an outer helper of the same name is a
     * `ReferenceError` at runtime, not a type error. That is also why `e2e/helpers/contrast.ts` stays
     * the one place that knows how to CONVERT a colour: this only decides where to stop walking.
     */
    const alphaOf = (value: string): number => {
      if (value.toLowerCase() === 'transparent') return 0;
      // The slash form carries the alpha in EVERY colour function Chrome emits here, so it is read
      // first and independently of the function's name.
      const slash = value.split('/');
      if (slash.length === 2) {
        const alpha = Number.parseFloat(slash[1].replace(/[)\s]/g, ''));
        if (!Number.isNaN(alpha)) return alpha;
      }
      const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/i);
      // A form with no alpha component at all is opaque, and the walk stops on it — which is right,
      // since an opaque fill hides everything behind it.
      if (!rgbMatch) return 1;
      const parts = rgbMatch[1].split(/[,/\s]+/).filter((part) => part.length > 0);
      if (parts.length < 4) return 1;
      const alpha = Number.parseFloat(parts[3]);
      return Number.isNaN(alpha) ? 1 : alpha;
    };

    const node = document.querySelector(target);
    if (!node) throw new Error(`no element matches ${target}`);
    const style = window.getComputedStyle(node);
    /**
     * Walks up from `start`, and stops at the first OPAQUE background because nothing behind it can
     * reach the screen.
     *
     * Reading the alpha out of `oklab(L a b / 0.2)` matters more than it looks: `dark:bg-blue-500/20`
     * comes back in that form, and treating it as opaque ends the walk one element early. The chain is
     * then one entry long, `parseColor` reads the same alpha correctly, and the ratio is computed
     * against the white default — 1.02:1 for a tile that is really 9.13:1, on a live selector, in the
     * one theme this file exists to gate.
     */
    const walkUp = (start: Element | null): string[] => {
      const chain: string[] = [];
      let cursor = start;
      while (cursor) {
        const background = window.getComputedStyle(cursor).backgroundColor;
        chain.push(background);
        if (alphaOf(background) === 1) break;
        cursor = cursor.parentElement;
      }
      return chain;
    };

    // The element's own fill, then whatever shows through it.
    const own = window.getComputedStyle(node).backgroundColor;
    const backgrounds = alphaOf(own) === 1 ? [own] : [own, ...walkUp(node.parentElement)];
    // The surface the element's BORDER abuts, which is behind its own fill and so needs its own walk:
    // both boundary subjects here have an OPAQUE fill, so a walk that stopped at the element would
    // find nothing outside it at all.
    const outsideBackgrounds = walkUp(node.parentElement);
    return {
      backgrounds,
      outsideBackgrounds,
      color: style.color,
      borderColor: style.borderTopColor,
      borderWidth: style.borderTopWidth,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      filter: style.filter,
    };
  }, selector);

/** The opaque colour actually behind `reading`, from its background chain. */
const backdropOf = (reading: Reading) => reading.backgrounds.map(parseColor);

/** Throws when the outside chain found no opaque surface, rather than measuring against white. */
const outsideChainOf = (reading: Reading): Rgb[] => {
  if (reading.outsideBackgrounds.length === 0) {
    throw new Error(
      `no surface outside this element to measure its boundary against, for ${JSON.stringify(reading.outsideBackgrounds)}`
    );
  }
  return reading.outsideBackgrounds.map(parseColor);
};

/** A failed floor, carrying both numbers so a reader does not have to go and measure them again. */
type Failure = { label: string; got: string; floor: string };

const expectTextFloor = async (page: Page, label: string, selector: string): Promise<Failure | null> => {
  const reading = await readPainted(page, selector);
  const ratio = contrastRatioOver(parseColor(reading.color), backdropOf(reading));
  const floor = textContrastFloor(Number.parseFloat(reading.fontSize), Number.parseInt(reading.fontWeight, 10));
  if (ratio >= floor) return null;
  return {
    label,
    got: `${formatRatio(ratio)} (${reading.color} on ${reading.backgrounds[0]})`,
    floor: `${floor}:1`,
  };
};

/**
 * A component's boundary against the surface OUTSIDE it, which is what WCAG 1.4.11 asks.
 *
 * The element's own background is skipped deliberately. A bordered box's outer edge abuts its
 * PARENT's surface, and that is the pair a user has to see: a Clear button at `dark:bg-gray-700` on a
 * `dark:bg-gray-800` bar is 1.42:1 fill against fill, and the whole reason the box reads as a box is
 * its border at 3.04:1 against the bar. Measuring the border against the button's own fill instead
 * reports 2.13:1 — a number about a colour pair the user never sees adjacent to anything.
 *
 * A zero-width border is not a boundary at all, so there is nothing for the rule to judge.
 */
const expectNonTextFloor = async (page: Page, label: string, selector: string): Promise<Failure | null> => {
  const reading = await readPainted(page, selector);
  // A zero-width border is not a boundary at all, so there is nothing for 1.4.11 to judge.
  if (Number.parseFloat(reading.borderWidth) === 0) return null;
  // Against the surface OUTSIDE the element, which is where the collection has to come from the
  // ELEMENT'S OWN reading rather than from a slice of the chain: `slice(1)` drops the element's fill
  // on the assumption that the fill is translucent, and both callers here have an OPAQUE one, so the
  // walk had already stopped and the slice left an empty chain. That flattens to the white default,
  // which is not adjacent to anything in either theme — and it turned the exact regression this file
  // exists to catch, `dark:border-gray-500` back to `dark:border-gray-600`, from 1.94:1 to a green
  // 7.56:1 measured against white.
  const ratio = contrastRatioOver(parseColor(reading.borderColor), outsideChainOf(reading));
  if (ratio >= NON_TEXT_FLOOR) return null;
  return {
    label,
    got: `${formatRatio(ratio)} (${reading.borderColor} against the surface outside it)`,
    floor: `${NON_TEXT_FLOOR}:1`,
  };
};

/** Selects the Ruler and measures a line, so the readouts carry numbers rather than being blank. */
const selectRulerWithMeasurement = async (page: Page) => {
  await clickToolButton(page, 'eyedropper');
  await openToolFlyout(page, 'eyedropper');
  await selectFromFlyout(page, { toolName: 'ruler', label: 'Ruler Tool' });
  const box = (await page.getByTestId('workspace-canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('ruler-d1')).not.toHaveText('');
};

/**
 * The toolbar pictures.
 *
 * Attached rather than committed as a pixel baseline, and the difference is deliberate. A committed
 * PNG of a toolbar is an oracle that fails on a font-metric change on another machine and has to be
 * re-recorded by hand — the same cost this repository already pays for
 * `e2e/export/visual-regression.spec.ts`'s export baselines. A contrast assertion is the durable
 * half: it fails when a colour regresses and does not fail when a glyph is drawn one pixel
 * differently. The picture is for the person who has to LOOK, which is how this defect was found.
 */
const attachToolbars = async (page: Page, testInfo: TestInfo, theme: string) => {
  const rail = page.locator('aside').first();
  const bar = page.getByTestId('ruler-d1').locator('xpath=ancestor::div[contains(@class,"h-[50px]")]');

  for (const [name, locator] of [
    [`toolbar-rail-${theme}`, rail],
    [`toolbar-options-${theme}`, bar],
  ] as const) {
    const shot = await locator.screenshot();
    await testInfo.attach(name, { body: shot, contentType: 'image/png' });
  }
};

/**
 * Waits until the tool rail's colours have stopped moving.
 *
 * `TOOL_BUTTON_BASE_CLASS` carries `transition-colors`, and so does the rail's grip, so a theme toggle
 * animates every colour on the rail over Tailwind's default duration. Reading the computed style
 * straight after the `html.dark` class lands reads the INTERPOLATION, not the destination — and the
 * numbers are nonsense in a way that is easy to believe: a tile mid-transition reported a background
 * of `oklab(… / 0.891)`, which is neither `dark:bg-gray-900` nor the light `bg-gray-200/80` but a
 * blend of the two, and a glyph of `rgb(131, 139, 152)`, which is neither `text-gray-600` nor
 * `dark:text-gray-400`. Both were then reported as contrast failures against colours that exist for
 * about a fifth of a second.
 *
 * So the values are polled until two successive reads AGREE, rather than slept for a duration
 * hardcoded here: the duration belongs to Tailwind and to whatever `prefers-reduced-motion` does to
 * it, and neither is a fact this file should restate.
 */
const waitForColoursToSettle = async (page: Page) => {
  const sample = () =>
    page.evaluate(() => {
      const tile = document.querySelector('[data-testid="tool-button-eyedropper"]');
      const grip = document.querySelector('[data-testid="rail-re-dock-handle"]');
      const read = (node: Element | null, what: string) => {
        // A missing element is a FAILURE, not a sample value. Returning the string 'absent' made any
        // two reads equal, so a selector that matched nothing reported the colours as SETTLED — and the
        // failure then surfaced at the measurement instead, as an unrelated "no element matches".
        if (!node) throw new Error(`the rail has no ${what}, so its colours cannot settle`);
        const style = window.getComputedStyle(node);
        return `${style.color}|${style.backgroundColor}|${style.borderTopColor}`;
      };
      return `${read(tile, 'eyedropper tile')}#${read(grip, 're-dock grip')}`;
    });

  let previous = await sample();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(60);
    const current = await sample();
    if (current === previous) return;
    previous = current;
  }
  throw new Error(
    'the rail colours never stopped changing, so any contrast read from them would be a frame of an ' +
      'animation rather than a resting value'
  );
};

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  if ((await page.evaluate(() => localStorage.getItem('theme'))) !== theme) {
    await page.getByTestId('theme-toggle-button').click();
  }
  await expect(page.locator('html')).toHaveClass(new RegExp(`\\b${theme}\\b`));
  await waitForColoursToSettle(page);
};

test.describe('the toolbars in the dark theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
    // `pinnedTheme` forces LIGHT for every spec in this suite, so dark has to be asked for. Asserted
    // on the class rather than on localStorage because the class is what the `dark:` variants read.
    await setTheme(page, 'dark');
  });

  test('the Ruler options bar passes every floor, and the picture is attached', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectRulerWithMeasurement(page);
    await attachToolbars(page, testInfo, 'dark');

    const failures = [
      await expectTextFloor(page, 'the Clear button label', '#ruler-clear'),
      await expectTextFloor(page, 'a readout value', '[data-testid="ruler-d1"]'),
      await expectTextFloor(page, 'a readout label', 'label[for="ruler-d1"]'),
      // The boundary is what makes a recessed field readable at all: the fill is deliberately a small
      // step from the bar, so the box the number sits in is carried entirely by its border.
      await expectNonTextFloor(page, "a readout value's field boundary", '[data-testid="ruler-d1"]'),
      await expectNonTextFloor(page, "the Clear button's boundary", '#ruler-clear'),
    ].filter((failure): failure is Failure => failure !== null);

    expect(
      failures,
      `dark-theme contrast below its floor:\n${failures
        .map(({ label, got, floor }) => `  - ${label}: ${got}, floor ${floor}`)
        .join('\n')}`
    ).toEqual([]);
  });

  test('a rail tile reads whether it is the selected one or not', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // Crop is on the rail with a tile of its own, so selecting it puts the ACTIVE classes on a known
    // tile; the Eyedropper is the inactive case, and is reached by its own tile rather than through a
    // flyout so the measurement is of a tile and not of a menu row.
    //
    // The two are SEQUENTIAL and not collected into one list of promises: a tool's state is decided by
    // which tile is current, so measuring both after a single selection would score the active classes
    // against a tile that no longer wears them — and would still pass, because an inactive tile is
    // easier to read. That is the direction a mistake in this file hides in.
    await clickToolButton(page, 'crop');
    // PROOF OF STATE BEFORE THE MEASUREMENT, and then the colours settled — in that order, because
    // getting it wrong is silent in exactly the direction that hides a defect.
    //
    // The poll used to sit AFTER the measurement, so the reading named "selected" was taken of a tile
    // that had not been selected yet: an instrumented run showed the two readings byte-identical, down
    // to the `oklab` fill, because both were the INACTIVE one. Moving the poll up without also
    // settling would trade that silent pass for a false red, because the click starts a
    // `transition-colors` and the reading then lands mid-interpolation — an `oklab` with a fractional
    // alpha that is neither the fill before nor the fill after.
    await expect.poll(() => page.getByTestId('tool-button-crop').getAttribute('aria-pressed')).toBe('true');
    await waitForColoursToSettle(page);
    const activeFailures = [
      // The GLYPH, not the border: a tool tile is identified by its icon, so the icon is the pair that
      // has to clear a floor. It is scored at the size the BUTTON reports, which is the inherited 16px
      // rather than the icon's own 28px box, so it is held to the ordinary 4.5 and not to 3.0.
      await expectTextFloor(page, 'the selected tile glyph', '[data-testid="tool-button-crop"]'),
    ].filter((failure): failure is Failure => failure !== null);

    await clickToolButton(page, 'eyedropper');
    await expect.poll(() => page.getByTestId('tool-button-eyedropper').getAttribute('aria-pressed')).toBe('true');
    await waitForColoursToSettle(page);
    const inactiveFailures = [
      await expectTextFloor(page, 'an inactive tile glyph', '[data-testid="tool-button-eyedropper"]'),
      // The rail's own two header controls, the re-dock grip and the one/two-column toggle. These
      // were `text-gray-500` at 4.39:1 in light — the same pair `HANDOFF.md` records for
      // `SidebarRight`'s chevrons — and are `dark:text-gray-400` here at 5.78:1.
      await expectTextFloor(page, 'the re-dock grip glyph', '[data-testid="rail-re-dock-handle"]'),
    ].filter((failure): failure is Failure => failure !== null);

    const failures = [...activeFailures, ...inactiveFailures];
    expect(
      failures,
      `dark-theme contrast below its floor:\n${failures
        .map(({ label, got, floor }) => `  - ${label}: ${got}, floor ${floor}`)
        .join('\n')}`
    ).toEqual([]);
  });

  test('a dimmed unimplemented tool stays legible, which is the whole point of dimming it', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    // The Pen family is the unimplemented set the registry derives: `commit: 'unimplemented'` in
    // `src/tools/toolProcessors.ts`. Its flyout rows are 11px TEXT, so they are owed the ordinary
    // 4.5:1 — this is the assertion that moved `SidebarLeft.scss`'s dark opacity off 0.40.
    //
    // `convert-point` is the LAST of the group's rows and so never the one wearing the selected
    // classes: a tile click selects the group's first entry, and a selected row is painted blue, which
    // is a different measurement entirely. The first version of this test measured that row and read a
    // number about a SELECTED placeholder.
    await clickToolButton(page, 'pen');
    await openToolFlyout(page, 'pen');

    const row = page.getByTestId(/^tool-flyout-item-convert-point-/);
    await expect(row, 'the Pen flyout is open and holds every Pen row').toBeVisible();

    const reading = await readPainted(page, '[data-testid^="tool-flyout-item-convert-point-"]');
    const filter = parseFilter(reading.filter);
    // Asserted, so a stylesheet edit cannot make this test pass by dimming nothing at all.
    expect(filter.grayscale, 'a dimmed row is desaturated').toBe(1);
    expect(filter.opacity, 'and faded').toBeLessThan(1);

    const ratio = contrastRatioUnderFilter(parseColor(reading.color), backdropOf(reading), filter);
    const floor = textContrastFloor(Number.parseFloat(reading.fontSize), Number.parseInt(reading.fontWeight, 10));

    // `getComputedStyle` reports the UNFILTERED colour, because a filter is applied at paint time and
    // never enters the computed style — so this ratio is the modelled result of the filter rather than
    // a reading. `contrastRatioUnderFilter` is that model, and its own tests pin it against the
    // figures `SidebarLeft.scss` quotes.
    expect(
      ratio,
      `a dimmed ${reading.fontSize} flyout row label must still clear ${floor}:1, and at ` +
        `opacity(${filter.opacity}) it is ${formatRatio(ratio)} — ${reading.color} on ${reading.backgrounds[0]}`
    ).toBeGreaterThanOrEqual(floor);
  });
});

test.describe('the toolbars in the light theme', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('workspace-canvas')).toBeVisible();
  });

  test('the Ruler options bar in light, with the picture attached for comparison', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);
    await selectRulerWithMeasurement(page);
    await attachToolbars(page, testInfo, 'light');

    // Light is already good on every TEXT pair, which is exactly why the dark Clear button survived:
    // the same class string passes here and fails there. This test is the control for that claim.
    const failures = [
      await expectTextFloor(page, 'the Clear button label', '#ruler-clear'),
      await expectTextFloor(page, 'a readout value', '[data-testid="ruler-d1"]'),
      await expectTextFloor(page, 'a readout label', 'label[for="ruler-d1"]'),
    ].filter((failure): failure is Failure => failure !== null);

    expect(
      failures,
      `light-theme contrast below its floor:\n${failures
        .map(({ label, got, floor }) => `  - ${label}: ${got}, floor ${floor}`)
        .join('\n')}`
    ).toEqual([]);
  });
});
