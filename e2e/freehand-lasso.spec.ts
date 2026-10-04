import { expect, type Page, test } from './fixtures/extended-test';
import { type BoundingBox, getSelectionBounds, getWorkspaceCanvas } from './helpers/canvas-helpers';
import { committedAntsOutline, hasNoCommittedAnts, waitForCommittedAnts } from './helpers/selection-ants';
import { clickToolButton, verifyPrimaryTool } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Freehand Lasso is the one tool in `e2e/` that no test ever drives.
 *
 * The audit behind this file found the tool referenced four times in `e2e/` and never ACTIVE in
 * any of them: `keyboard-shortcuts.spec.ts:286` asserts the options-bar hint `l` produces,
 * `sidebar-keyboard.spec.ts` and `sidebar-flyout.spec.ts` use `freehand-lasso` as the flyout's
 * anchor tile, and `selection-gestures.spec.ts:446` plus `selection-marching-ants.spec.ts:139`
 * open that same anchor purely to reach the polygonal lasso. `grep -rn "clickToolButton(page,
 * 'freehand-lasso')" e2e/` returns nothing. What coverage exists is jsdom against a mocked store
 * (`src/components/Main/__tests__/LassoToolArea.test.tsx:209` asserts the committed selection's
 * normalised `points` and `pos`), which cannot say whether the commit reaches a real canvas.
 *
 * ## What is observable, and why it is the ants
 *
 * A freehand selection has no blue outline of its own anywhere. `drawSelectionAnchors` and
 * `findSelectionAnchorAtPoint` both skip `sourceTool` 'freehand-lasso' and 'magic-wand'
 * (`src/util/selection.ts`), so the tool overlay never carries the selection border
 * and `getSelectionBounds` cannot see it. The committed selection is the animated black/white ants
 * on `[data-testid="selection-ants-canvas"]`, and nothing else.
 *
 * That is also why `e2e/helpers/selection-ants.ts` exists as a shared module: the ants read was a
 * ~50-line local closure in `selection-gestures.spec.ts`, and a second copy of it here would have
 * been the duplicate this repo's one-fact-one-home rule exists to prevent.
 *
 * ## What is deliberately NOT asserted
 *
 * An earlier attempt at this file also claimed that switching to the Move tool relocates the
 * committed selection. That is false against this app, and asserting it would have been a test
 * that fails on correct code:
 *
 *   - `MoveToolArea.handlePointerDown` (`src/components/Main/MoveToolArea.tsx:168-229`) resolves a
 *     LAYER under the pointer and its only selection call is `clearSelection()` on a bedrock press
 *     (`:200`). It never reads or writes document selections.
 *   - `useApp` (`:169-192`) clears the active selection on EVERY tool switch, so by the time Move
 *     is selected the selection is already gone.
 *
 * Draggable selections live in `PolygonClickToolArea.tsx:695-705`, and only while a lasso tool is
 * still active. So the claim that could be true is the one asserted here instead: the selection
 * exists, it sits where the gesture put it, and it can be taken away again.
 */

/**
 * The dragged region, as fractions of the canvas box.
 *
 * Fractions rather than pixel offsets because `OPEN_PROBLEMS.md` §P1 (`:561`) records that the
 * suite's `box.x + 180` offsets are window-relative: a layout change moves the point under the
 * mouse rather than failing the test. `viewport-drawing.spec.ts:26-27` is the pattern being copied.
 */
const DRAG = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };

/** Interpolated moves per drag edge. A jump rather than a drag would not exercise the path. */
const DRAG_STEPS = 12;

/**
 * How far the ants may sit from the dragged rectangle, in CSS pixels.
 *
 * The gesture is a rounded path and the outline follows the ROUNDED path, not the rectangle the
 * test described — `freehand` closes automatically and the committed points are what the pointer
 * traced. Slack is what makes the assertion about *where the selection is* rather than about the
 * exact shape of a freehand curve, which is not what this test is for.
 */
const OUTLINE_SLACK_PX = 40;

/**
 * The measured canvas box, or a throw.
 *
 * Read on demand rather than cached in `beforeEach`: `OPEN_PROBLEMS.md` §P2 (`:391`) records a
 * measured 20 CSS px drift between two tools' options bars, and every point here is box-relative.
 */
const canvasBox = async (page: Page): Promise<BoundingBox> => {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Workspace canvas has no bounding box');
  return box;
};

/** The dragged rectangle in PAGE coordinates, which is the space the ants read reports in. */
const draggedRegion = (box: BoundingBox) => ({
  x: box.x + Math.round(box.width * DRAG.x),
  y: box.y + Math.round(box.height * DRAG.y),
  width: Math.round(box.width * DRAG.width),
  height: Math.round(box.height * DRAG.height),
});

/**
 * Asserts the committed border lies inside the dragged rectangle, within slack.
 *
 * All four edges are checked and each failure names which one drifted, because "the outline is in
 * the wrong place" without an edge is a report a reader cannot act on. The containment direction is
 * deliberate: a freehand path traced around the region bows OUTWARD at the corners, so the ants are
 * expected to be within a rectangle AROUND the drag, not strictly inside it.
 */
const expectAntsAroundDrag = async (page: Page, box: BoundingBox) => {
  const region = draggedRegion(box);
  const outline = await committedAntsOutline(page);
  expect(
    outline,
    `no committed selection border after the drag (expected around ${JSON.stringify(region)})`
  ).not.toBeNull();
  const found = outline!;

  const report = { expected: region, found };
  expect(found.left, `outline left of the dragged region (${JSON.stringify(report)})`).toBeGreaterThanOrEqual(
    region.x - OUTLINE_SLACK_PX
  );
  expect(found.top, `outline above the dragged region (${JSON.stringify(report)})`).toBeGreaterThanOrEqual(
    region.y - OUTLINE_SLACK_PX
  );
  expect(found.right, `outline right of the dragged region (${JSON.stringify(report)})`).toBeLessThanOrEqual(
    region.x + region.width + OUTLINE_SLACK_PX
  );
  expect(found.bottom, `outline below the dragged region (${JSON.stringify(report)})`).toBeLessThanOrEqual(
    region.y + region.height + OUTLINE_SLACK_PX
  );
};

test.describe('Freehand Lasso', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page), 'the canvas renders once the store has an image').toBeVisible();
    // The tile, not the flyout: `toolbar-mapping.ts:57` makes the freehand lasso the first entry
    // of the shared lasso group, so it is that group's identity and owns `tool-button-freehand-lasso`.
    await clickToolButton(page, 'freehand-lasso');
    await verifyPrimaryTool(page, 'freehand-lasso', 'Lasso Tool');
  });

  /**
   * The tool's whole contract: drag around something, release, and it is selected.
   *
   * Asserted in that order and no other way round, because each step is a separate claim: the drag
   * produced a DRAFT (proved by the absence of any border beforehand), the release COMMITTED it
   * (proved by the ants appearing), and it committed WHERE the gesture was (proved by the geometry).
   * A test that only checked the last would pass on a tool that always selected the whole canvas.
   *
   * `waitForCommittedAnts` rather than `waitForCanvasPixels`, because this read has to come off the
   * ants canvas's own context — see the header for why a screenshot is the wrong instrument.
   */
  test('a drag around a region commits a selection there', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await canvasBox(page);
    const region = draggedRegion(box);

    // The premise: nothing is selected, so the border observed later cannot have pre-existed.
    expect(await hasNoCommittedAnts(page), 'no selection exists before the drag').toBe(true);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();

    // A closed loop around the region. The four edges are traced with interpolated moves, because
    // `PolygonClickToolArea` samples the pointer path — a single jump per edge would commit a
    // quadrilateral the tool never had the chance to smooth.
    const corner = (dx: number, dy: number) => ({ x: region.x + dx, y: region.y + dy });
    const path = [
      corner(0, 0),
      corner(region.width, 0),
      corner(region.width, region.height),
      corner(0, region.height),
      corner(0, 0),
    ];

    await page.mouse.move(path[0].x, path[0].y);
    await page.mouse.down();
    for (const point of path.slice(1)) {
      const previous = path[path.indexOf(point) - 1];
      const steps = DRAG_STEPS;
      for (let step = 1; step <= steps; step += 1) {
        await page.mouse.move(
          previous.x + ((point.x - previous.x) * step) / steps,
          previous.y + ((point.y - previous.y) * step) / steps
        );
      }
    }
    await page.mouse.up();

    await waitForCommittedAnts(page, 'the committed selection border after a freehand drag');
    await expectAntsAroundDrag(page, box);

    // Copy is gated on `hasActivePolygonSelection` (`FreehandLasso.tsx:66`), so this is a second,
    // independent reading of the commit that no border geometry can satisfy on its own.
    await expect(
      page.getByRole('button', { name: 'Copy', exact: true }),
      'a committed selection enables Copy'
    ).toBeEnabled();
  });

  /**
   * The selection's lifetime, in the two directions that matter.
   *
   * Escape mid-drag cancels the DRAFT and must leave nothing committed
   * (`PolygonClickToolArea.cancelSelectionDraft:880-888`, and unlike `removeLastAnchor` it carries
   * no `isFreehand` guard). A committed selection then goes away through `Clear`, which is gated on
   * the same predicate as Copy — so pairing the two buttons with the border is what makes "the
   * selection went away" a claim about the canvas rather than about a button's disabled attribute.
   *
   * `hasNoCommittedAnts` reads ABSENCE rather than looking for the border somewhere else, which is
   * the difference between "the selection was cleared" and "the selection is somewhere I did not
   * look".
   */
  test('Escape cancels an in-progress drag and Clear removes a committed one', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await canvasBox(page);
    const region = draggedRegion(box);

    // --- Escape mid-drag. The pointer is still down, which is the state that distinguishes a
    // cancelled DRAFT from a cancelled committed selection.
    await page.mouse.move(region.x, region.y);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width, region.y + region.height, { steps: DRAG_STEPS });
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await hasNoCommittedAnts(page), 'Escape mid-drag must leave no committed selection').toBe(true);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();

    // --- The same drag, released rather than cancelled, so the Clear step has something to remove.
    await page.mouse.move(region.x, region.y);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width, region.y + region.height, { steps: DRAG_STEPS });
    await page.mouse.move(region.x, region.y, { steps: DRAG_STEPS });
    await page.mouse.up();

    await waitForCommittedAnts(page, 'the committed selection border before Clear');
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeEnabled();

    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    await expect
      .poll(() => hasNoCommittedAnts(page), { message: 'Clear must take the border off the canvas' })
      .toBe(true);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  });

  /**
   * The freehand bar's one control, which has no counterpart on the polygonal lasso's bar.
   *
   * `PolygonalLasso.tsx` renders a Mode toggle and two hints and NOTHING else — no Copy, no Clear.
   * `FreehandLasso.tsx` adds Copy/Paste/Clear because a freehand selection is commit-on-release
   * with no explicit finish step, so the bar is where its lifetime is controlled. Asserting the
   * toggle's own label text is the check: it reads `isFill ? 'Fill' : 'Outline'`
   * (`FreehandLasso.tsx:59`), so the label states the mode and the assertion is a round trip
   * through `args.fill` rather than a re-read of the click.
   */
  test('the bar toggles between Outline and Fill', async ({ page }) => {
    const mode = page.getByRole('button', { name: /^(Outline|Fill)$/ });
    await expect(mode, 'the freehand bar exposes a Mode toggle seeded on Outline').toHaveAccessibleName('Outline');

    await mode.click();
    await expect(mode, 'clicking it must switch the label to Fill').toHaveAccessibleName('Fill');
    await mode.click();
    await expect(mode, 'clicking it again must switch back to Outline').toHaveAccessibleName('Outline');

    // And the two sibling controls exist only here, which is what distinguishes this bar from the
    // polygonal one the eye is really being compared against.
    await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Paste', exact: true })).toBeVisible();
  });

  /**
   * `Backspace`/`Delete` are registered by `PolygonClickToolArea` for BOTH lasso tools, but
   * `removeLastAnchor` returns immediately when `isFreehand` (`:891`). So on this tool they are
   * deliberately inert, and this pins that: a build that dropped the guard would let Backspace
   * silently pop anchors off a gesture the user expects to be whole.
   *
   * Asserted on the committed selection rather than on a draft, because there is no draft left to
   * read by this point and the claim is about the gesture surviving.
   */
  test('Backspace is inert on a committed freehand selection', async ({ page }) => {
    test.setTimeout(DEFAULT_TEST_TIMEOUT_MS);

    const box = await canvasBox(page);
    const region = draggedRegion(box);

    await page.mouse.move(region.x, region.y);
    await page.mouse.down();
    await page.mouse.move(region.x + region.width, region.y + region.height, { steps: DRAG_STEPS });
    await page.mouse.move(region.x, region.y, { steps: DRAG_STEPS });
    await page.mouse.up();
    await waitForCommittedAnts(page, 'the committed selection border');

    await page.keyboard.press('Backspace');
    // The selection must be exactly where it was: not removed, not shrunk. An empty outline here
    // would mean the guard was dropped and the whole draft was cancelled.
    await expectAntsAroundDrag(page, box);
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();

    // `getSelectionBounds` must report NO blue for this tool, and that is the premise of the whole
    // file: it is why the ants are the only instrument available here. If this ever starts
    // reporting an outline, the file's approach needs revisiting rather than adding to it.
    const clip = { x: box.x, y: box.y, width: box.width, height: box.height };
    expect(
      await getSelectionBounds(await page.screenshot({ clip })),
      'a freehand selection must not paint a blue outline of its own'
    ).toBeNull();
  });
});
