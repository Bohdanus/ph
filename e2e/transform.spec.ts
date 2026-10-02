import { expect, test } from './fixtures/extended-test';
import {
  drawLine,
  getDarkPixelBounds,
  LINE_END_X,
  LINE_START_X,
  takeLineScreenshot,
  waitForCanvasRedraw,
  type BoundingBox,
  type ClipOptions,
} from './helpers/canvas-helpers';
import { clickToolButton } from './helpers/toolbar-helpers';

/**
 * Browser coverage for the transform tool, and specifically for the geometry the
 * transform rewrite owns: the raster CTM order, and the trapezoid path that warps a
 * layer through a homography instead of an affine approximation.
 *
 * Both are invisible to the app's unit tests in a way that matters here. The unit
 * tests assert the maths - `solveHomography` maps four corners, `getTrapezoidQuad`
 * places them - and a homography can satisfy every one of those while the browser
 * draws the wrong thing, because the raster step in between is a `setTransform` plus
 * a `drawImage` on an `OffscreenCanvas` and nothing in the app's test setup runs a
 * real 2D context. Only a browser composes the two halves into pixels.
 *
 * The assertions are geometric and scale-free: bounding boxes compared to each other,
 * never to absolute pixel counts, because the same suite has to pass on a 1x and a 2x
 * display and the CDP helper in this file's sibling spec documents that the capture
 * multiplier is not even a function of the emulated devicePixelRatio.
 */

/** Two horizontal bars of equal length, one high up the layer and one low down it. */
const BAR_START_X = LINE_START_X;
const BAR_END_X = LINE_END_X;
/**
 * Box-relative fractions of the canvas height for the two bars.
 *
 * They have to be far apart, because a taper is invisible on a band that spans a small
 * part of the layer: the row scale varies linearly with depth, so two bars 5% apart
 * differ by a couple of percent and read as a uniform squash. 0.25 and 0.8 put the row
 * scales at 0.79 and 0.32 of the original width, which no squash can produce.
 */
const TOP_BAR_Y_RATIO = 0.25;
const BOTTOM_BAR_Y_RATIO = 0.8;
/** A 0.5px brush antialiases to mid-grey everywhere; a 24px one has an opaque interior for the dark-pixel predicates to find. */
const BRUSH_SIZE = 24;

/** Taper applied by the specs, the slider's maximum: the bottom row keeps 15% of the top row's width. */
const TAPER = 85;

interface Bands {
  readonly top: Required<ClipOptions>;
  readonly bottom: Required<ClipOptions>;
}

type DarkBounds = NonNullable<Awaited<ReturnType<typeof getDarkPixelBounds>>>;

/** Horizontal centre of a dark-pixel box as a fraction of the capture, so it is scale-free. */
const centreX = (bounds: DarkBounds): number => (bounds.left + bounds.right) / 2 / bounds.imageWidth;
/** Vertical centre of a dark-pixel box as a fraction of the capture. */
const centreY = (bounds: DarkBounds): number => (bounds.top + bounds.bottom) / 2 / bounds.imageHeight;

/**
 * Clip bands around the two bars, in PAGE coordinates.
 *
 * Absolute, not box-relative: `buildClip` REPLACES the default clip with whatever the
 * caller passes rather than offsetting it, so a box-relative band silently samples the
 * wrong rectangle. `takeLineScreenshot` is the only reason the box argument exists - it
 * builds the default clip from it.
 *
 * The two bars have to be measured separately: a bounding box over the whole canvas
 * cannot tell a taper from a uniform squash, because both narrow the silhouette and
 * only the per-band widths differ. A square shape would too, but it would be measuring
 * a drawn rectangle rather than the transform.
 */
function bands(box: BoundingBox): Bands {
  const band = (yRatio: number): Required<ClipOptions> => ({
    x: box.x + 100,
    y: box.y + Math.round(box.height * yRatio) - 45,
    width: 300,
    height: 90,
  });
  return { top: band(TOP_BAR_Y_RATIO), bottom: band(BOTTOM_BAR_Y_RATIO) };
}

/**
 * Selects the transform tool through `Edit ▸ Free Transform`.
 *
 * Two clicks, and both are necessary: the `Edit` host is a button that opens a menu, and
 * `Free Transform` is the only item inside it. `transform` has no rail tile and no
 * `tools-menu-transform-button` — Photoshop has no such tool, and this app's Tools rail and
 * Tools menu now agree with it — so the header menu is the only surface that selects it.
 */
async function openTransformTool(page: Parameters<typeof clickToolButton>[0]): Promise<void> {
  await page.getByTestId('header-edit-menu-button').click();
  await page.getByTestId('edit-menu-free-transform-button').click();
  // The toolbox swaps in with the tool; its sliders are what the specs drive next.
  await expect(page.locator('#trapezoid-slider')).toBeVisible();
  await expect(page.locator('#rotate-slider')).toBeVisible();
}

async function applyTransform(page: Parameters<typeof clickToolButton>[0]): Promise<void> {
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test.describe('Transform tool', () => {
  // The canvas is laid out to a fixed aspect ratio and overflows the default 1280x720
  // viewport: the workspace canvas box is 974x840 starting at y=100, so its bottom 220
  // pixels sit below the fold. A bar drawn low on the layer would then be outside every
  // screenshot clip in this file, and the assertions below would report "no ink" for a
  // transform that worked. A viewport tall enough to hold the whole canvas removes the
  // ambiguity instead of leaving it to be rediscovered as a flaky failure.
  test.use({ viewport: { width: 1600, height: 1200 } });

  test('rotates a drawn layer 90 degrees and keeps the rotation after Apply', async ({ page }, testInfo) => {
    await page.goto('/');
    const canvasBox = (await page.getByTestId('workspace-canvas').boundingBox()) ?? null;
    expect(canvasBox, 'workspace canvas should have visible coordinates').not.toBeNull();
    const box = canvasBox!;
    // Full canvas clip: a 90 degree rotation moves the bar to a different band, so
    // measuring a fixed band would read the rotation as "the ink disappeared".
    const wholeCanvas: Required<ClipOptions> = {
      x: box.x,
      y: box.y,
      width: Math.floor(box.width),
      height: Math.floor(box.height),
    };

    await clickToolButton(page, 'draw');
    await page.locator('#size-slider').fill(String(BRUSH_SIZE));
    await drawLine(page, box, BAR_START_X, Math.round(box.height * 0.5), BAR_END_X, Math.round(box.height * 0.5));
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });

    const before = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'rotate-before', testInfo, wholeCanvas)
    );
    expect(before, 'the drawn bar should be dark enough for the dark-pixel bounds').not.toBeNull();
    expect(before!.width / before!.height, 'a horizontal bar is wider than it is tall').toBeGreaterThan(3);

    await openTransformTool(page);
    // `title` rather than the accessible name: the button's text content is "+90°", and
    // content outranks `title` for the accessible name, so a role+name lookup for
    // "Rotate 90° Right" times out on a selector that reads like it should work.
    await page.getByTitle('Rotate 90° Right').click();
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });

    const rotated = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'rotate-preview', testInfo, wholeCanvas)
    );
    expect(rotated, 'the rotated bar should still be dark').not.toBeNull();
    expect(
      rotated!.height / rotated!.width,
      'a 90 degree rotation makes the bar taller than it is wide'
    ).toBeGreaterThan(3);
    // Dimension swap, not merely a change of orientation: a rotation preserves the
    // silhouette, so the long axis keeps its length. Catches a transform that scales
    // or clips on the way through the CTM.
    expect(rotated!.height / before!.width).toBeGreaterThan(0.8);
    expect(rotated!.height / before!.width).toBeLessThan(1.25);

    // And it must not move: a rotation is about the layer, so the ink's bounding-box
    // centre is invariant. The raster step is where this is easiest to get wrong - the
    // draw matrix carries its own translation, and a layer whose bounds are recomputed
    // from the same transform can end up shifted by one of the two. Expressed as a
    // fraction of the image so it survives a 2x display.
    expect(Math.abs(centreX(rotated!) - centreX(before!)), 'a rotation must not move the layer sideways').toBeLessThan(
      0.03
    );
    expect(
      Math.abs(centreY(rotated!) - centreY(before!)),
      'a rotation must not move the layer vertically'
    ).toBeLessThan(0.03);

    await applyTransform(page);
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });
    const committed = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'rotate-applied', testInfo, wholeCanvas)
    );
    expect(committed, 'the committed layer should still be dark').not.toBeNull();
    expect(committed!.height / committed!.width, 'Apply must not drop the rotation').toBeGreaterThan(3);
  });

  /**
   * The history half, which the two geometry tests above deliberately never touched.
   *
   * `transform` declares `commit: 'affine-operation'` and `crop` declares
   * `commit: 'document-operation'`, and they are the only two commit kinds in the registry that
   * are not a raster. A raster commit is a whole-canvas operation whose undo is obvious; an
   * affine commit rewrites the layer's transform, so its undo has to put the ORIGINAL transform
   * back rather than merely drop a delta — and nothing in this file asserted that it did.
   *
   * The assertion is the bar's ASPECT, not its position, and that is the load-bearing choice. A
   * 90 degree rotation is a whole-number change of orientation, so the same stroke reads as a
   * horizontal bar before and after the undo and as a vertical bar in between. A replay that
   * dropped the entry, replayed to the wrong index, or left the affine operation applied with a
   * negated scale all of them show up as a bar that is not the shape it was, and a position-only
   * assertion would pass on some of them.
   */
  test('a rotate is one history entry that one undo returns to the original pixels', async ({ page }, testInfo) => {
    await page.goto('/');
    const canvasBox = (await page.getByTestId('workspace-canvas').boundingBox()) ?? null;
    expect(canvasBox, 'workspace canvas should have visible coordinates').not.toBeNull();
    const box = canvasBox!;
    // Full canvas clip for every read, for the reason the first test gives: a 90 degree rotation
    // moves the bar into a different band, so a fixed band would read a correct rotation as "the
    // ink disappeared".
    const wholeCanvas: Required<ClipOptions> = {
      x: box.x,
      y: box.y,
      width: Math.floor(box.width),
      height: Math.floor(box.height),
    };

    await clickToolButton(page, 'draw');
    await page.locator('#size-slider').fill(String(BRUSH_SIZE));
    await drawLine(page, box, BAR_START_X, Math.round(box.height * 0.5), BAR_END_X, Math.round(box.height * 0.5));
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });

    const before = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'undo-rotate-before', testInfo, wholeCanvas)
    );
    expect(before, 'the drawn bar should be dark enough for the dark-pixel bounds').not.toBeNull();
    expect(before!.width / before!.height, 'a horizontal bar is wider than it is tall').toBeGreaterThan(3);

    await openTransformTool(page);
    await page.getByTitle('Rotate 90° Right').click();
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });
    await applyTransform(page);
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });

    const committed = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'undo-rotate-applied', testInfo, wholeCanvas)
    );
    expect(committed, 'the committed layer should still be dark').not.toBeNull();
    expect(
      committed!.height / committed!.width,
      'the committed layer is the rotated bar, so the rotation is on the timeline'
    ).toBeGreaterThan(3);
    await expect(page.getByTestId('undo-button'), 'Apply committed a history entry').toBeEnabled();

    // ONE UNDO, and the bar is the horizontal one again — the original pixels, not merely
    // something dark.
    await page.getByTestId('undo-button').click();
    await waitForCanvasRedraw(page, box, { clip: wholeCanvas });
    const afterUndo = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'undo-rotate-undone', testInfo, wholeCanvas)
    );
    expect(afterUndo, 'the undone layer should still be dark').not.toBeNull();
    expect(
      afterUndo!.width / afterUndo!.height,
      'one undo must restore the original horizontal bar, so the affine operation is off the layer'
    ).toBeGreaterThan(3);
    // Dimension-for-dimension against the pre-transform bar, so "restored" means this stroke at
    // this size rather than some other horizontal bar. A rotate-then-restore path that rebuilt
    // the layer through a raster round trip loses a pixel row per hop and still passes the aspect
    // ratio; a tolerance is what separates that from a replay.
    expect(
      Math.abs(afterUndo!.width - before!.width) / before!.width,
      'the restored bar is the same length as the one that was drawn'
    ).toBeLessThan(0.05);
    expect(
      Math.abs(afterUndo!.height - before!.height) / before!.height,
      'the restored bar is the same thickness as the one that was drawn'
    ).toBeLessThan(0.15);
  });

  test('tapers a layer so the bottom narrows and the top does not, and keeps it after Apply', async ({
    page,
  }, testInfo) => {
    await page.goto('/');
    const canvasBox = (await page.getByTestId('workspace-canvas').boundingBox()) ?? null;
    expect(canvasBox, 'workspace canvas should have visible coordinates').not.toBeNull();
    const box = canvasBox!;
    const clip = bands(box);

    await clickToolButton(page, 'draw');
    await page.locator('#size-slider').fill(String(BRUSH_SIZE));
    for (const yRatio of [TOP_BAR_Y_RATIO, BOTTOM_BAR_Y_RATIO]) {
      await drawLine(
        page,
        box,
        BAR_START_X,
        Math.round(box.height * yRatio),
        BAR_END_X,
        Math.round(box.height * yRatio)
      );
    }
    // The default redraw clip is a band around the middle of the canvas, which holds
    // neither bar here, so the wait has to name the bands the assertions read.
    await waitForCanvasRedraw(page, box, { clip: clip.top });
    await waitForCanvasRedraw(page, box, { clip: clip.bottom });

    const topBefore = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'taper-top-before', testInfo, clip.top)
    );
    const bottomBefore = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'taper-bottom-before', testInfo, clip.bottom)
    );
    expect(topBefore, 'the top bar should be dark').not.toBeNull();
    expect(bottomBefore, 'the bottom bar should be dark').not.toBeNull();
    // Two bars of the same length, so any difference after the transform is the
    // transform's doing rather than the drawing's.
    expect(Math.abs(topBefore!.width - bottomBefore!.width) / topBefore!.width).toBeLessThan(0.15);

    await openTransformTool(page);
    await page.locator('#trapezoid-slider').fill(String(TAPER));
    // Same reasoning as the wait after drawing: the default clip is the middle band,
    // which is empty in this fixture, so waiting on it would time out on a transform
    // that rendered perfectly.
    await waitForCanvasRedraw(page, box, { clip: clip.top });
    await waitForCanvasRedraw(page, box, { clip: clip.bottom });

    const topAfter = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'taper-top-after', testInfo, clip.top)
    );
    const bottomAfter = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'taper-bottom-after', testInfo, clip.bottom)
    );
    expect(topAfter, 'the top bar should still be dark').not.toBeNull();
    expect(bottomAfter, 'the bottom bar should still be dark').not.toBeNull();

    // The signature of a taper, as opposed to a horizontal squash: the rows scale by
    // how far down the layer they are, so the top row keeps most of its width and the
    // bottom row keeps 1 - TAPER/100 of what the same row had before.
    expect(topAfter!.width / topBefore!.width, 'the upper part of the layer keeps most of its width').toBeGreaterThan(
      0.65
    );
    expect(bottomAfter!.width / bottomBefore!.width, 'the lower part of the layer narrows hard').toBeLessThan(0.5);
    expect(bottomAfter!.width / bottomBefore!.width, 'the narrowed bar still has ink').toBeGreaterThan(0.05);

    // Each row is scaled about the layer's horizontal centre, so the surviving bottom
    // bar is centred in the band rather than pinned to one edge. A wrong translation in
    // the CTM, or a homography solved from the corners in the wrong order, shows up
    // here as an off-centre bar.
    const bottomCentre = (bottomAfter!.left + bottomAfter!.right) / 2;
    const imageWidth = bottomAfter!.imageWidth;
    expect(Math.abs(bottomCentre - imageWidth / 2) / imageWidth, 'the narrowed bar stays centred').toBeLessThan(0.1);

    await applyTransform(page);
    await waitForCanvasRedraw(page, box, { clip: clip.bottom });
    const committedBottom = await getDarkPixelBounds(
      await takeLineScreenshot(page, box, 'taper-bottom-applied', testInfo, clip.bottom)
    );
    expect(committedBottom, 'the committed layer should still be dark').not.toBeNull();
    expect(committedBottom!.width / bottomBefore!.width, 'Apply must not drop the taper').toBeLessThan(0.5);
  });
});
