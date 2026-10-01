import { expect, test, type Page } from './fixtures/extended-test';
import { getWorkspaceCanvas } from './helpers/canvas-helpers';
import { toolbarMap } from '../toolbar-mapping.ts';

/**
 * What this file pins, and what it deliberately does not.
 *
 * It used to assert the rail's Tailwind width CLASSES — `w-14` and `w-[6.75rem]` — through
 * `toHaveClass` against anchored regular expressions, because an unanchored `/w-14/` is
 * satisfied by `w-140` and `min-w-14` too. The anchoring was worth getting right and the
 * question behind it was not: a width class is a NAME IN THE STYLESHEET, and a stylesheet
 * edit can rename it with the layout behaving identically, at which point the assertion is
 * noise. So nothing here reads a class, and nothing reads an absolute pixel width either.
 *
 * The rail's width is asserted as a RELATION between two measurements this file takes
 * itself — one column against two — which is the claim the toggle exists to make, and which
 * survives the width moving to any number a redesign likes. Everything else is structural:
 * the toggle's own state, the number of `<ul>`s the rail renders, the left edges the tiles
 * land on, and the order the tiles appear in.
 *
 * This is the e2e half of the same claim `SidebarLeft.layout.test.tsx` makes in jsdom, and it
 * reads the same signals for the same reasons: the jsdom file cannot measure a width (every
 * rect is zeroed there), so it compares the DECLARED one, and this file measures.
 */

const toolsBox = (page: Page) => page.getByTestId('left-toolbar-tools');
const layoutToggle = (page: Page) => page.getByTestId('toolbar-layout-toggle');

const railWidth = async (page: Page) =>
  await page.getByTestId('left-sidebar').evaluate((el) => el.getBoundingClientRect().width);

/**
 * The tool names on the rail's tiles, in DOM order.
 *
 * The name is the tail of `tool-button-<name>`, so the three-dots tile is deliberately absent:
 * it is named `tool-overflow-tile` rather than `tool-button-<name>` precisely because it stands
 * for no single tool, and the prefix is therefore also what separates a tile from it.
 */
const tileToolNames = async (page: Page): Promise<string[]> =>
  await toolsBox(page)
    .locator('[data-testid^="tool-button-"]')
    .evaluateAll((tiles) =>
      tiles.map((tile) => (tile as HTMLElement).dataset.testid?.replace('tool-button-', '') ?? '')
    );

/**
 * The distinct left edges the tiles occupy, which is how a browser says "one column" or
 * "two". A `grid-cols-1` and a `grid-cols-2` are two class names; one x value and two are a
 * measurement, and the measurement is what the user sees.
 */
const tileColumns = async (page: Page): Promise<number[]> => {
  const lefts = await toolsBox(page)
    .locator('[data-toolbar-tile]')
    .evaluateAll((tiles) => tiles.map((tile) => Math.round(tile.getBoundingClientRect().x)));
  return [...new Set(lefts)];
};

/**
 * The section lists the rail renders.
 *
 * The two layouts are DIFFERENT MARKUP, not one tree restyled: one column renders one `<ul>`
 * per entry of `toolbarMap`, and two columns interleave the sections into a single two-column
 * `<ul>` with no separators between them. The count is therefore a layout claim that no width
 * can stand in for, and it is readable in the tablet band too, where the toggle that would
 * otherwise report the state is not rendered at all.
 */
const sectionListCount = async (page: Page) => await page.locator('[data-testid="left-toolbar-tools"] > ul').count();

/**
 * The tile order `toolbarMap` defines, walked out of the map rather than copied.
 *
 * A hand-copied list of tool names is the most expensive kind of test data in this repo
 * (`AGENTS.md`, "What this costs"): it goes stale silently, and a stale one makes an order
 * assertion pass without checking anything.
 */
const CANONICAL_TILE_ORDER: readonly string[] = toolbarMap.flatMap((section) => section.map((group) => group[0].name));

/**
 * Drive the rail into the two-column desktop preference, whichever way the default points.
 *
 * `aria-pressed` is `isSingleColumn`, so two columns is `aria-pressed="false"`. Reading it and
 * clicking only when it is needed is what keeps these tests honest: an unconditional "click
 * once" silently became a request for ONE column the moment the default changed to two
 * columns, and the test that followed then measured the layout it was trying to leave.
 * `SidebarLeft.tablet.test.tsx` does the same thing in jsdom, for the same reason.
 *
 * Duplicated rather than shared: the helper module under `e2e/helpers/` belongs to another
 * agent in this change. It belongs there, and should move there once that file is free.
 */
const prefersTwoColumns = async (page: Page) => {
  const toggle = layoutToggle(page);
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'false') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
};

/** The mirror of {@link prefersTwoColumns}, for the trip back. */
const prefersOneColumn = async (page: Page) => {
  const toggle = layoutToggle(page);
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
};

/**
 * A tile that HAS a flyout, resolved by test id.
 *
 * The Marquee group, because it is the first row of the rail with more than one tool, and
 * because the collapse is a SUFFIX: the rows that do not fit are the bottom ones, so a top
 * row is the last thing to go. If even that row is folded — a window too short for the first
 * two rows, which no desktop viewport is — the three-dots tile is on the rail instead and
 * carries every collapsed tool, so the flyout under test is still reachable.
 *
 * A tile reached by grid-coordinate index, which is what this replaced, broke the moment a
 * tile went missing: the index silently named a different tool, or named nothing.
 */
const aTileWithAFlyout = async (page: Page) => {
  const marquee = page.getByTestId('tool-button-rectangular-selection');
  return (await marquee.count()) ? marquee : page.getByTestId('tool-overflow-tile');
};

test.describe('SidebarLeft - Layout Toggle (fast)', () => {
  // The 720px viewport the fit test below names, declared on the describe rather than set
  // inside the test. `devices['Desktop Chrome']` is 1280x720 today, so a `setViewportSize`
  // to that same size is a no-op against this config that still fires a real resize at a
  // mounted app — and none of the file's other four tests do that. A `test.use` here makes
  // the size true by construction and fires nothing.
  test.use({ viewport: { width: 1280, height: 720 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Navigation, not the app: `body` is visible on a blank document and on a Vite error
    // overlay too. The guard that needs a mounted app is each test's own locator.
    await expect(page.locator('body')).toBeVisible();
  });

  // ONE COLUMN IS THE DEFAULT, which REVERSES main's two-column default and the operator's
  // standing instruction: "left toolbar must start with one column by default". The chevron
  // exists to switch to two columns to save vertical room, which only means anything if one
  // column is where you start — and Adobe says the same ("Tools by default are in a single
  // column").
  //
  // Main's reason for two columns is answered rather than overruled, because it was a real
  // observation at the time: a one-column rail is taller, so it needed a taller window before
  // it stopped SCROLLING. The rail no longer scrolls — the tiles are fitted to the space they
  // have and the rest move into the three-dots tile — so the axis main was trading along is
  // gone. The measured heights and thresholds live once, in `e2e/toolbar-fit.spec.ts`, which
  // prints them on every run; they are font-metric dependent and a second copy is a second
  // thing to rot.
  test('starts in one column, and the toggle offers the two-column rail', async ({ page }) => {
    const toggle = layoutToggle(page);

    // The toggle is the control that reports the layout, and it names the layout it would
    // switch TO, so `aria-label` and `aria-pressed` are read together: pressed is
    // `isSingleColumn`, and the label is its negation.
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAttribute('aria-label', 'Use two-column toolbar');

    expect(
      await sectionListCount(page),
      'one <ul> per toolbar section is the one-column rail; two columns renders a single list'
    ).toBe(toolbarMap.length);
    expect(await tileColumns(page), 'one column means every tile shares one left edge').toHaveLength(1);
  });

  test('the default toolbar does not make the page outgrow the viewport', async ({ page }) => {
    // Playwright's own default viewport is 1280x720, so this runs at the height the
    // regression was reported at. It was P1 in e2e/OPEN_PROBLEMS.md: a toolbar taller than the
    // window has a min-content height, a `1fr` grid track is `minmax(auto, 1fr)`, and the
    // rail therefore became the row's floor and dragged the `h-full` canvas up.
    //
    // Two things hold this now and either could stop holding it: `min-h-0 overflow-y-auto` on
    // the aside, so the rail cannot floor the row, and the fit, which gives the tiles a budget
    // of the slot instead of letting them claim it. It matters MORE under the one-column
    // default, because a one-column rail is the taller of the two, and before the fit a
    // 1280x720 window was not tall enough for it — so this is the assertion that has to keep
    // holding for the default layout to be the right one. The metrics below are page-level, so
    // a blank page would satisfy them without a toolbar having been laid out at all, hence the
    // canvas guard.
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    const { height: pageHeight, scrollHeight } = await page.evaluate(() => ({
      height: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }));

    expect(scrollHeight, 'the shell must be exactly viewport-tall, so the page never scrolls').toBeLessThanOrEqual(
      pageHeight
    );
  });

  // Replaces two tests that read `w-14` and `w-[6.75rem]` off the class list. What they were
  // really asking — "does the toggle reach the other layout, and is two columns the wider
  // one" — is now one test that measures both states and compares them.
  test('the toggle is what changes the layout, and two columns is the wider one', async ({ page }) => {
    const oneColumnWidth = await railWidth(page);
    expect(await tileColumns(page), 'the rail starts in one column').toHaveLength(1);

    await prefersTwoColumns(page);

    expect(await layoutToggle(page)).toHaveAttribute('aria-label', 'Use one-column toolbar');
    expect(await sectionListCount(page), 'the two-column rail interleaves the sections into a single list').toBe(1);
    expect(await tileColumns(page), 'two columns means the tiles land on two left edges').toHaveLength(2);

    // The relation, not either value. Both numbers were measured here, so the assertion is
    // true at any pair of widths a redesign chooses — and the old `toBeCloseTo(108)` was a
    // design number (`6.75rem`, derived from the tile size) wearing a behaviour's clothes.
    expect(await railWidth(page), 'two columns is wider than one, not narrower').toBeGreaterThan(oneColumnWidth);
  });

  test('toggling back restores the one-column rail', async ({ page }) => {
    await prefersTwoColumns(page);
    const twoColumnWidth = await railWidth(page);

    await prefersOneColumn(page);

    // Driven by state rather than by a second bare click, and asserted through the same
    // structure the default is: a second `<ul>` per section is what "back" means here, and a
    // width class is not.
    expect(await sectionListCount(page)).toBe(toolbarMap.length);
    expect(await tileColumns(page)).toHaveLength(1);
    expect(await railWidth(page), 'one column is the narrower of the two').toBeLessThan(twoColumnWidth);
  });

  test('the tool order is the toolbar map order in both layouts', async ({ page }) => {
    // A PREFIX comparison against `toolbarMap`, not an equality between the two states. The
    // fit takes a SUFFIX of the list, so the two layouts show DIFFERENT numbers of tiles at
    // one viewport, and comparing the two lists to each other would assert that coincidence of
    // this viewport rather than the order, and would start failing the day a row changed height.
    //
    // The counts move with the budget and are not pinned here — seven tool tiles in one column
    // at 1280x720, and all fifteen in two columns, where the whole map fits above 666px and no
    // three-dots tile is rendered at all. `e2e/toolbar-fit.spec.ts` owns the heights and prints
    // them on every run; they are font-metric dependent and a second copy is a second thing to
    // rot. What is true at every one of them, and what this asserts, is that each layout shows
    // a LEADING run of the map.
    const oneColumnTiles = await tileToolNames(page);
    expect(oneColumnTiles, 'at least the first tool must have a tile at this height').not.toHaveLength(0);
    expect(oneColumnTiles, 'one column keeps the leading tools in the map order').toEqual(
      CANONICAL_TILE_ORDER.slice(0, oneColumnTiles.length)
    );

    await prefersTwoColumns(page);

    const twoColumnTiles = await tileToolNames(page);
    expect(twoColumnTiles, 'at least the first tool must have a tile in two columns either').not.toHaveLength(0);
    expect(twoColumnTiles, 'two columns keeps the same order, and only fits more of it').toEqual(
      CANONICAL_TILE_ORDER.slice(0, twoColumnTiles.length)
    );
  });

  test('closes open flyout on layout toggle', async ({ page }) => {
    const toggle = layoutToggle(page);
    const tile = await aTileWithAFlyout(page);

    // Open flyout via right-click (faster than long-press)
    await tile.click({ button: 'right' });
    await expect(page.getByRole('menu')).toBeVisible();

    await toggle.click();

    await expect(page.getByRole('menu')).toBeHidden();
  });
});
