import { expect, test, type TestInfo } from './fixtures/extended-test';
import {
  type BoundingBox,
  type CssBounds,
  DEFAULT_DOCUMENT_SIZE,
  containFit,
  drawLine,
  getDarkPixelBounds,
  getWorkspaceCanvas,
  waitForCanvasRedraw,
} from './helpers/canvas-helpers';
import { captureCanvasScreenshot } from './helpers/cdp-helpers';
import { imageBoundsToCss } from './helpers/screenshot-scale';
import { clickToolButton } from './helpers/toolbar-helpers';

import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';
import {
  DELIBERATE_OVERFLOW_CSS_PX,
  LEGACY_FIXED_SLACK_CSS_PX,
  MAX_BOX_DRIFT_CSS_PX,
  toleranceFor,
} from './helpers/viewport-tolerance';

const VIEWPORTS = [
  { name: 'normal', width: 1280, height: 720 },
  { name: 'wide', width: 1600, height: 900 },
  { name: 'narrow', width: 900, height: 700 },
] as const;

interface ViewportMeasurement {
  name: string;
  box: BoundingBox;
  start: { x: number; y: number };
  end: { x: number; y: number };
  line: CssBounds;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Draws the line at one window and reports where the stroke actually landed.
 *
 * The box is measured AFTER `clickToolButton`, not before it, and the order is kept because a
 * fresh read is the box the finished layout produced and it costs one `boundingBox()`. It is
 * not kept because a tool switch can move the box: it cannot. The tool's options mount in the
 * TOOLBAR row — `ToolbarHorizontal` renders `<ToolComponent key={toolName} />` inside
 * `TOOLBAR_BASE_CLASS`, a fixed `h-[50px]` strip — while the canvas sits in the main area,
 * which `App.tsx` declares as a different row, so no tool choice resizes the box. A panel
 * column taller than 50px paints over the workspace instead of reflowing it, and painting is
 * not layout.
 *
 * So the two boxes coincide on this layout, and measuring per tool changes no number today.
 * What it removes is the dependence on them continuing to: a layout that did let a tool resize
 * the workspace would have the box read here already correct, and every coordinate below it is
 * box-relative, so a stale one would aim the stroke and photograph the capture at a different
 * pixel rather than fail loudly.
 */
async function measureAtViewport(
  page: Parameters<typeof clickToolButton>[0],
  testInfo: TestInfo,
  viewport: { name: string; width: number; height: number }
): Promise<ViewportMeasurement> {
  const { name } = viewport;
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const canvas = getWorkspaceCanvas(page);
  await expect(canvas).toBeVisible();
  await clickToolButton(page, 'draw');

  const box = await canvas.boundingBox();
  if (!box) throw new Error(`${name}: canvas not found`);

  // Fractions of the box, so the gesture tracks the window the way a user would aim it.
  const start = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.35 };
  const end = { x: box.x + box.width * 0.65, y: start.y };

  await drawLine(page, box, start.x - box.x, start.y - box.y, end.x - box.x, end.y - box.y, { steps: 20 });
  // Sample a band around the stroke: this line sits outside the shared redraw clip.
  await waitForCanvasRedraw(page, box, {
    clip: { x: start.x - 20, y: start.y - 20, width: end.x - start.x + 40, height: 40 },
  });

  // Mark endpoints visibly (browser doesn't include system cursor in screenshots)
  await page.evaluate(
    ({ start: from, end: to }) => {
      for (const point of [from, to]) {
        const marker = document.createElement('div');
        marker.dataset.testid = 'cursor-marker';
        marker.style.cssText = [
          'position: fixed',
          `left: ${point.x - 9}px`,
          `top: ${point.y - 9}px`,
          'width: 18px',
          'height: 18px',
          'border: 3px solid #ef4444',
          'border-radius: 50%',
          'box-sizing: border-box',
          'pointer-events: none',
          'z-index: 2147483647',
        ].join(';');
        document.body.append(marker);
      }
    },
    { start, end }
  );

  const boxBeforeCapture = await canvas.boundingBox();
  const screenshot = await captureCanvasScreenshot(page, box, testInfo, `viewport-${name}`);
  const boxAfterCapture = await canvas.boundingBox();
  await page
    .locator('[data-testid="cursor-marker"]')
    .evaluateAll((markers) => markers.forEach((marker) => marker.remove()));

  /**
   * The capture must not have moved the page, and this is checked BEFORE the stroke is
   * measured, because a capture that moves the page invalidates every number below it.
   *
   * MEASURED, and it is the cause of this test's historical flakiness rather than a
   * hypothesis: `captureCanvasScreenshot` (`e2e/helpers/cdp-helpers.ts:8`) intermittently
   * leaves the page's emulated viewport 87 CSS px SHORTER than it was — `window.innerHeight`
   * 700 -> 613 at the `narrow` window and 900 -> 813 at `wide`, the same 87 both times, with
   * nothing but that call between the two readings. `#root` and the shell grid shrink by the
   * same 87, the canvas box goes 563 -> 476, and the app's contain fit re-projects from
   * 0.9383 to 0.7933. The stroke was committed under the OLD fit, so the captured frame shows
   * it at the OLD document point drawn through the NEW fit: 30px in x and 31.05px in y at
   * `narrow`, 32.5px and 31.05px at `wide`. Those are the numbers this test used to report as
   * a stroke that missed the cursor, and they are a capture of the wrong page.
   *
   * So the check is a guard, not a tolerance: it turns "the line is 32px from the cursor"
   * into a statement of what is actually true, and it keeps the per-window tolerances below
   * honest for as long as the helper behaves. The FIX belongs in the helper — see
   * `e2e/OPEN_PROBLEMS.md` — and this spec deliberately does not paper over it, because a
   * spec that re-took the shot until the numbers looked right would be asserting nothing.
   */
  expect(
    boxBeforeCapture && boxAfterCapture
      ? Math.max(
          ...['x', 'y', 'width', 'height'].map((k) =>
            Math.abs(
              (boxBeforeCapture as unknown as Record<string, number>)[k] -
                (boxAfterCapture as unknown as Record<string, number>)[k]
            )
          )
        )
      : Number.POSITIVE_INFINITY,
    `${name}: the page moved across captureCanvasScreenshot — the capture is of a DIFFERENT ` +
      `page than the one that was measured, so every offset below is meaningless. ` +
      `box before ${JSON.stringify(boxBeforeCapture)}, after ${JSON.stringify(boxAfterCapture)}`
  ).toBeLessThanOrEqual(MAX_BOX_DRIFT_CSS_PX);

  const bounds = await getDarkPixelBounds(screenshot);
  if (!bounds) throw new Error(`${name}: line not found on screenshot`);

  const fit = containFit(box, DEFAULT_DOCUMENT_SIZE);
  return {
    name,
    box,
    start,
    end,
    line: imageBoundsToCss({ width: bounds.imageWidth, height: bounds.imageHeight }, box, bounds),
    scale: fit.scale,
    offsetX: fit.offsetX,
    offsetY: fit.offsetY,
  };
}

test.describe('Viewport Drawing', () => {
  /**
   * SKIPPED BY DECISION, not because the assertion is wrong.
   *
   * This test is intermittently red (TEST-FLAKES.md §12), and the failing window
   * MOVES between `wide` and `narrow` across the runs that have been captured. A
   * deterministic defect does not move between cases, so whatever is wrong is in the
   * test's own measurement chain rather than in the app's viewport mapping.
   *
   * ## What is already known, and what is not
   *
   * KNOWN, and measured in this file 40 lines above: `captureCanvasScreenshot`
   * intermittently returns a page that is 87 CSS px SHORTER than the one measured, and
   * that drift is a filed defect (`e2e/OPEN_PROBLEMS.md`, the CDP-capture P2). The
   * `expect` before the stroke assertion exists to catch it and it is a HARD
   * assertion, so a drift failure names itself and prints both bounding boxes.
   *
   * NOT known: whether the remaining red runs are all that same drift, or a second
   * cause. The chain from screenshot to verdict is `waitForCanvasRedraw` (polls a
   * CDP screenshot for ink) then `getDarkPixelBounds` (thresholds that screenshot)
   * then this file's derived `toleranceFor(box)` — 6.7-8.4px across the three
   * windows, NOT the 25px `LEGACY_FIXED_SLACK_CSS_PX`, which is a ceiling the
   * derived bound is asserted *against* and is never applied to anything. Nothing in
   * the chain records which step gave, so a red run does not yet say.
   *
   * Why skipping beats shipping it:
   *
   * - The suite's contract is that a default headless run has ZERO failures. A test
   *   that is red in some runs makes unrelated merges look broken, and the response
   *   it trains is to ignore the gate — which costs far more than the coverage this
   *   single test buys.
   * - A flaky assertion is worse than no assertion, not better: it cannot justify a
   *   change either, because a green result from it carries no information.
   *
   * This is NOT a "known failure" in the sense of a defect that is accepted. Nothing
   * here is waived; the work is un-done and filed. It is also NOT the fix — do not
   * widen `ANTIALIASED_FLANGE_CSS_PX`, loosen the bound, raise the drift guard, or
   * add retries to make it green. Every one of those treats a symptom whose second
   * cause is still unknown, and raising the drift guard would remove the only check
   * that names the known one.
   *
   * Exact remaining verification, and the one-line un-skip (delete the statement
   * below): capture a failing run with
   * `npm run test:e2e -- e2e/viewport-drawing.spec.ts --retries=1`, which yields a
   * `trace: 'on-first-retry'` trace plus the failure PNG under
   * `test-results/runs/<run-id>/`. The drift guard's own message distinguishes the two
   * causes: it fires with "the page moved across captureCanvasScreenshot" for the
   * known one, and a red run WITHOUT that message is evidence of a second cause. Do
   * not close this by re-running until green.
   *
   * Operator decision, 2026-09-29, after the skip was requested and the suite
   * reported this test green locally.
   */
  test.skip(
    true,
    'Intermittent: the failing window moves between cases, known CDP capture drift is one cause — TEST-FLAKES.md §12'
  );

  /**
   * ONE test over all three windows, where this was three tests in a `for` loop. The reason
   * is a property the loop cannot express: "these are three different windows" is a claim
   * about the SET. In a per-viewport loop each test is blind to the other two, so a
   * `setViewportSize` that silently did nothing would leave three green tests that had all
   * measured the same rectangle — the resize claim, which is this test's entire subject,
   * reduced to nothing while still reporting green. That is the non-vacuity control below,
   * and it is unexpressible in the old shape.
   *
   * The second reason is reporting: with `expect.soft`, one run now reports all three
   * windows' deviations together, instead of the reader discovering them one run at a time.
   *
   * A third change rides along and is the point of the exercise. The old bound was a fixed
   * 25 CSS px, and 25 is not a property of anything: the honest slack at these windows is
   * 6.7-8.4px (the brush's own half-width at that window's scale, plus the antialias
   * fringe), and the measured deviations are 3.0-5.5px. So the fixed 25 was absorbing about
   * 17px of nothing, and a real mapping error of the size the filed P2 describes would have
   * been partly inside it. The bound is now derived per window, and asserted to be strictly
   * below the old constant.
   */
  test('line stays under cursor after window resize (normal, wide and narrow)', async ({ page }, testInfo) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS * VIEWPORTS.length);

    const measurements: ViewportMeasurement[] = [];
    for (const viewport of VIEWPORTS) {
      measurements.push(await measureAtViewport(page, testInfo, viewport));
    }

    // ---- NON-VACUITY CONTROL, first and hard. ----
    // Everything below is a per-window comparison against that window's OWN geometry, which
    // is precisely what makes it blind to the windows collapsing into one another. If the
    // three windows stopped producing different geometry, all three comparisons would still
    // pass while proving nothing about resize. So the control runs first, as a hard assert:
    // if it fails, the measurements it guards are meaningless and failing immediately is
    // the honest outcome.
    //
    // Width AND scale, and both are load-bearing. Width is the axis the tools rail
    // collapsed by 52px (108 -> 56), so it is the one a rail change moves. Scale is the
    // quantity every tolerance below is derived from, so three windows sharing a scale
    // would mean three identical tolerances. The three heights also differ as measured,
    // but height is deliberately NOT asserted: it is the axis `containFit` collapses
    // whenever the box is wider than 0.75 of its ratio, so pinning it would fail on a
    // legitimate layout change rather than on a defect.
    expect(
      new Set(measurements.map((m) => m.box.width)).size,
      `the three windows produced the same canvas width — the resize claim is vacuous: ${measurements
        .map((m) => `${m.name}=${m.box.width}x${m.box.height}`)
        .join(', ')}`
    ).toBe(VIEWPORTS.length);
    expect(
      new Set(measurements.map((m) => m.scale.toFixed(6))).size,
      `the three windows produced the same contain scale — the resize claim is vacuous: ${measurements
        .map((m) => `${m.name}=${m.scale.toFixed(6)}`)
        .join(', ')}`
    ).toBe(VIEWPORTS.length);

    // ---- THE TOLERANCE IS A DERIVED NUMBER, NOT A CONSTANT. ----
    // Asserted against the largest of the three so the claim is about the whole set: if a
    // future edit replaced `toleranceFor` with a literal, this fires instead of the gate
    // quietly re-widening to 25 and going back to absorbing mapping errors.
    const widestTolerance = Math.max(...measurements.map((m) => toleranceFor(m.box)));
    expect(
      widestTolerance,
      `the derived tolerance (${widestTolerance.toFixed(2)}px) is not tighter than the fixed ` +
        `${LEGACY_FIXED_SLACK_CSS_PX}px this test used to absorb a mapping error with`
    ).toBeLessThan(LEGACY_FIXED_SLACK_CSS_PX);

    // ---- NON-VACUITY CONTROL for the COMPARISON ITSELF. ----
    // A derived bound can be wrong in the direction that matters: too large, or computed
    // from a term that evaluates to zero. So the exact expression each assertion below uses
    // is run against a stroke displaced by `DELIBERATE_OVERFLOW_CSS_PX` — 5x the widest
    // tolerance above, and well past any plausible fit failure — and must reject it. This is the same shape as
    // the deliberate-overflow control in `e2e/no-document-overflow.spec.ts`: prove the
    // numbers notice, because "found nothing" and "measured nothing" are otherwise the
    // same result.
    for (const measurement of measurements) {
      const tolerance = toleranceFor(measurement.box);
      expect(
        Math.abs(DELIBERATE_OVERFLOW_CSS_PX) > tolerance,
        `${measurement.name}: the comparison cannot detect a ${DELIBERATE_OVERFLOW_CSS_PX}px displacement (tolerance ${tolerance.toFixed(2)}px)`
      ).toBe(true);
    }

    // ---- THE CLAIM. ----
    for (const { name, box, start, end, line } of measurements) {
      const tolerance = toleranceFor(box);
      expect.soft(Math.abs(line.left - start.x), `${name}: line start far from cursor`).toBeLessThanOrEqual(tolerance);
      expect.soft(Math.abs(line.right - end.x), `${name}: line end far from cursor`).toBeLessThanOrEqual(tolerance);
      expect
        .soft(Math.abs((line.top + line.bottom) / 2 - start.y), `${name}: line shifted in Y`)
        .toBeLessThanOrEqual(tolerance);
    }
  });
});
