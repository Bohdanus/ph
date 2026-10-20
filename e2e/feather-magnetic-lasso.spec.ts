import { expect, type Page, test } from './fixtures/extended-test';
import {
  type BoundingBox,
  type ClipOptions,
  getSelectionBounds,
  getWorkspaceCanvas,
  hasMagnetSnapPixels,
  hasManualSnapPixels,
} from './helpers/canvas-helpers';
import { waitForCanvasPixels } from './helpers/canvas-redraw';
import { setForegroundColor } from './helpers/color-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout, verifyPrimaryTool } from './helpers/toolbar-helpers';
import { DEFAULT_TEST_TIMEOUT_MS } from './helpers/timeouts';

/**
 * The Magnetic Lasso is the only tool in the lasso family with NO end-to-end coverage.
 * `selection-gestures.spec.ts` covers the marquee, the magic wand and the polygonal lasso;
 * `selection-marching-ants.spec.ts` moves a committed polygon. Nothing anywhere drives
 * `feather-magnetic-lasso`, so its entire option surface and its three keyboard gestures were
 * reachable only through the component tests in `src/`, which run against a mocked store.
 *
 * ## What makes this tool's behaviour observable at all
 *
 * The magnetic lasso has no committed selection until it finishes, so everything worth
 * asserting is on the DRAFT overlay, and the draft's own colour is the signal.
 * `FeatherMagneticLassoToolArea.tsx:106`-`:113` strokes the draft path one of two ways:
 *
 *   usedMagnetic true   -> rgba(0, 170, 90, 0.95)   green
 *   usedMagnetic false  -> rgba(230, 130, 0, 0.95)  orange
 *
 * `usedMagnetic` is the edge detector's own verdict, and `:458`/`:510`/`:522` set it from
 * `!event.altKey`. So the SAME gesture at the SAME coordinate is green or orange purely as a
 * function of whether Alt is held - which is precisely the claim "Alt disables the magnet".
 *
 * ## Why this file is built on colour predicates and not on outline geometry
 *
 * An outline assertion passes on both branches, so it could not tell the magnet working from
 * the magnet disabled. The two are told apart by two different colours instead.
 *
 * ## The trap this file is arranged around: ORANGE IS NOT EVIDENCE OF ALT
 *
 * `usedMagnetic` is false in two unrelated cases - Alt held, and no edge found - so a naive
 * "hold Alt, see orange" passes whether or not Alt does anything. `findStrongestGradientPoint`
 * (`src/util/magneticLasso.ts:277`-`:279`) returns `usedMagnetic: false` whenever the best
 * gradient inside `searchRadius` is under the contrast threshold, and `searchRadius` is
 * `args.magneticWidth` (`:191`-`:198`), 18px at the seeded default. A cursor in the middle of
 * a flat filled shape is therefore ~100px from the nearest edge, finds nothing, and paints
 * ORANGE with Alt up.
 *
 * So every hover below stays ON the disc's outline, where an edge is always within reach, and
 * the Alt test walks a fixed four-point route around that outline. The two middle legs differ
 * in exactly one thing - whether Alt is down - so the colour change between them can only be
 * Alt. The outer legs exist to prove the route's own points are magnetic, which is what makes
 * the middle pair a measurement rather than an assumption.
 */

/**
 * The viewport, pinned for the reason `selection-gestures.spec.ts` pins its own: the shell's
 * fit scale differs between 720 and 1000 rows, so every coordinate below is a FRACTION of the
 * measured canvas box and the box is the only fixed reference.
 */
const VIEWPORT = { width: 1280, height: 1000 };

/** A hard-edged black disc, so the edge detector has a real high-contrast boundary to follow. */
const DISC_CENTRE = { x: 0.5, y: 0.5 };
/** Fraction of the canvas box's SHORT side, so the disc is round at any viewport. */
const DISC_RADIUS_FRACTION = 0.18;

/**
 * The hovers, in degrees around the disc, and what each is for.
 *
 * All four sit within 20 degrees of the one anchor, which is the constraint that matters: the
 * draft preview is thrown away the moment an AUTO-ANCHOR commits (`:329` clears
 * `previewRef`, and the overlay repaints with the committed blue path alone), and
 * `maybeCommitAutoAnchor` fires once the preview path reaches
 * `magneticLassoAnchorSpan(args.frequency)` - 75px at the seeded Frequency of 40. Past that
 * length the green frame lives for a single rAF, which a 100ms poll misses. Staying short of
 * it is what lets this file assert a colour at all.
 */
const ANCHOR_DEGREES = 270;
const HOVER_MAGNETIC = 280;
const HOVER_ALT = 290;

/**
 * How much shorter the committed path must be after Backspace, as a fraction of its height
 * before, for the pop to count.
 *
 * A ratio rather than a pixel count because the disc is a fraction of the canvas box and the box
 * is not pinned: the three anchors put the third segment alone below the centre line, so the
 * exact figure is about one third, and 0.6 leaves room for the magnetic path tracing the arc a
 * little differently from the straight line between anchors. It is slack for that wobble, not a
 * tolerance - a Backspace that popped nothing leaves the two heights identical, which is 1.0 and
 * fails at any value here.
 */
const SHRINK_RATIO = 0.6;

/**
 * A point ON the disc's outline, in the canvas box's own coordinates.
 *
 * This is the coordinate that matters, and getting it wrong is the difference between a test
 * that measures the magnet and one that measures nothing. The detector reports `usedMagnetic`
 * only when it actually snapped to an edge, so the gesture has to run ALONG the boundary: a
 * hover that leaves the ink finds no edge and repaints the preview orange on the first branch
 * too, which would make the Alt assertion below vacuous.
 *
 * `drawDisc` traces the same circle with the same radius, so these points sit on the ink it
 * laid down rather than near it.
 */
const onDiscEdge = (box: BoundingBox, degrees: number) => {
  const radius = Math.round(Math.min(box.width, box.height) * DISC_RADIUS_FRACTION);
  const radians = (degrees * Math.PI) / 180;
  return {
    x: Math.round(box.width * DISC_CENTRE.x) + Math.round(radius * Math.cos(radians)),
    y: Math.round(box.height * DISC_CENTRE.y) + Math.round(radius * Math.sin(radians)),
  };
};

const workspaceBox = async (page: Page): Promise<BoundingBox> => {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('Workspace canvas has no bounding box');
  return box;
};

/** The whole canvas element, intersected with the viewport so a capture is never silently truncated. */
const canvasClip = (page: Page, box: BoundingBox): Required<ClipOptions> => {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  return {
    x: box.x,
    y: box.y,
    width: Math.min(box.width, viewport.width - box.x),
    height: Math.min(box.height, viewport.height - box.y),
  };
};

/** A fraction of the canvas box, in the box's own coordinates. */
const fraction = (box: BoundingBox, point: { x: number; y: number }) => ({
  x: Math.round(box.width * point.x),
  y: Math.round(box.height * point.y),
});

/**
 * A colour this file asks about, as the shared predicate that answers it.
 *
 * These bounds used to be a local `PaintCriteria` record and a local `matchesPaint` loop sitting
 * in this file, which is the trap `select-move.spec.ts` documents at length: a per-spec copy of
 * the colour constants is a second definition, so the before and after of one gesture get read
 * under two of them and neither the thresholds nor the alpha guard is checked anywhere. They now
 * live in `canvas-helpers.ts` beside every other colour predicate, and their discrimination —
 * including the case that matters most, the tool's own blue guide drawn along the same segment —
 * is pinned in `helpers/__tests__/canvas-stroke-analysis.unit.test.ts`.
 *
 * The four bounds are identical to the ones the local loop enforced: `redMin`/`redMax`/
 * `greenMin` rejected a pixel and an unsupplied bound was unconstrained, which is exactly
 * `>=`/`<=`/`>=`/`<=` respectively.
 */
type PaintPredicate = (screenshot: Buffer) => Promise<boolean>;

/** Resolves once the predicate accepts the canvas. The suite's poll loop, not a sleep. */
const waitForPaint = (page: Page, clip: Required<ClipOptions>, accepts: PaintPredicate, description: string) =>
  waitForCanvasPixels(page, clip, accepts, { description });

/** Reads the app's own draft/selection outline, on the suite's pinned thresholds. */
const draftOutline = async (screenshot: Buffer) => getSelectionBounds(screenshot);

/** Selects the magnetic lasso out of the shared lasso flyout, then proves it is the active tool. */
const selectMagneticLasso = async (page: Page) => {
  await openToolFlyout(page, 'freehand-lasso');
  await selectFromFlyout(page, { toolName: 'feather-magnetic-lasso', label: 'Magnetic Lasso Tool' });
  await verifyPrimaryTool(page, 'feather-magnetic-lasso', 'Magnetic Lasso Tool');
};

/**
 * Paints the high-contrast disc the magnet follows.
 *
 * Drawn as 24 chords rather than an arc primitive: `page.mouse` has no arc, and a polygon this
 * fine is indistinguishable from a circle at this radius - the sagitta over 15 degrees is about
 * 1px, well inside the 18px search radius. The stroke is left at the brush's own default width:
 * the disc only has to be a closed black shape on white, and widening it would put a second,
 * softer edge inside the one the detector snaps to, which is a variable nothing here needs.
 */
const drawDisc = async (page: Page, box: BoundingBox) => {
  await clickToolButton(page, 'draw');
  await setForegroundColor(page, '#000000', true);
  const centre = fraction(box, DISC_CENTRE);
  const radius = Math.round(Math.min(box.width, box.height) * DISC_RADIUS_FRACTION);
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: centre.x + radius * Math.cos(radians), y: centre.y + radius * Math.sin(radians) };
  };

  await page.mouse.move(box.x + at(0).x, box.y + at(0).y);
  await page.mouse.down();
  for (let degrees = 15; degrees <= 360; degrees += 15) {
    const point = at(degrees);
    await page.mouse.move(box.x + point.x, box.y + point.y);
  }
  await page.mouse.up();
};

/**
 * The seeded values of the six controls this tool's bar renders, read off
 * `defaultSettings['feather-magnetic-lasso']` in `src/tools/settings.ts:131`-`:142`.
 *
 * Asserted before anything is changed, so each exact-name assertion below is a claim about a
 * value that MOVED rather than a claim about a value that happened to already be right.
 *
 * Snap and Smooth are here for the same reason as the other four and were the two the bar grew
 * without anyone noticing: `snapStrength` is seeded `0.85` and rendered as
 * `Math.round(snapStrength * 100)` percent, while `smoothing` is seeded `1.5` and rendered as a
 * bare px with a fractional step of 0.5 — so the two are the only controls whose readout is not
 * the value the slider carries, which is exactly what a copy of the seeded number would get
 * wrong. The units differ per control throughout (`px` on Feather and Width, `%` on Contrast and
 * Snap, none on Frequency, `px` on Smooth) and the readouts have to match them.
 */
const SEEDED_READOUTS = [
  { control: /^Feather/, seeded: 'Feather 12px', value: '4', moved: 'Feather 4px' },
  { control: /^Width/, seeded: 'Width 18px', value: '24', moved: 'Width 24px' },
  { control: /^Contrast/, seeded: 'Contrast 30%', value: '45', moved: 'Contrast 45%' },
  { control: /^Frequency/, seeded: 'Frequency 40', value: '80', moved: 'Frequency 80' },
  { control: /^Snap/, seeded: 'Snap 85%', value: '0', moved: 'Snap 0%' },
  { control: /^Smooth/, seeded: 'Smooth 1.5px', value: '0', moved: 'Smooth 0px' },
] as const;

/**
 * The bar's two checkboxes, seeded on and carrying static text.
 *
 * They are asserted by STATE rather than by readout because they have no value in their label
 * at all, and their labels are matched exactly so a rename would fail rather than silently
 * re-target a different control. Both default to true (`antiAlias`, `previewFeather` at
 * `src/tools/settings.ts:138`-`:139`), so "starts checked" is a claim about the seed.
 */
const CHECKBOXES = [
  { label: 'Anti-alias', arg: 'antiAlias' },
  { label: 'Preview feather', arg: 'previewFeather' },
] as const;

test.describe('Magnetic Lasso', () => {
  // The routine budget rather than the 30s default: `beforeEach` builds a 24-stroke fixture and
  // opens a flyout, and each test then chains up to three `waitForCanvasPixels` polls whose own
  // ceiling is 10s each. A named budget is also what `__tests__/timeouts.unit.test.ts` requires -
  // a bare literal here fails that test.
  test.describe.configure({ timeout: DEFAULT_TEST_TIMEOUT_MS });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    await expect(getWorkspaceCanvas(page), 'the paint bar renders once the store has an image').toBeVisible();
    await drawDisc(page, await workspaceBox(page));
    await selectMagneticLasso(page);
  });

  /**
   * The tool's defining interaction, and the reason the whole file is colour-driven.
   *
   * Four hovers around one arc of the disc's outline, and the middle pair is the measurement:
   * `HOVER_ALT` is visited twice, once with Alt up and once with Alt down. Everything else about
   * those two legs is identical, so green-then-orange there can only be Alt. The outer legs are
   * what make that reading sound rather than lucky - they establish that both points on the
   * route are magnetic, so orange at `HOVER_ALT` is not just "somewhere the detector gave up".
   *
   * Each hover is preceded by a move to the OTHER point, because `page.mouse.move` to the pixel
   * the cursor already occupies is not a gesture and would leave the previous frame on screen.
   * That does not weaken the comparison: the preview is rebuilt from the anchor on every frame
   * (`makeSegment` reads `anchorsRef[n-1]`, never the previous preview), so the path that reaches
   * the overlay at `HOVER_ALT` is the same path either way and `magneticEnabled` is the only
   * input that differs.
   */
  test('Alt suppresses the magnet, and releasing it restores it', async ({ page }) => {
    // This test measures the modifier, not automatic fastening. Keep the active
    // segment below the longest documented fastening span; the control test below
    // still pins the seeded Frequency 40 default.
    const frequency = page.getByRole('slider', { name: /^Frequency/ });
    await frequency.fill('0');
    await expect(frequency).toHaveAccessibleName('Frequency 0');

    const box = await workspaceBox(page);
    const clip = canvasClip(page, box);

    /** Hovers a point on the outline. Both halves matter: the click has to be on ink for the
     * detector to have anything to snap to, and the hovers have to stay on the ink for the
     * snap to succeed. */
    const anchor = onDiscEdge(box, ANCHOR_DEGREES);
    const hover = async (degrees: number) => {
      const at = onDiscEdge(box, degrees);
      await page.mouse.move(box.x + at.x, box.y + at.y);
    };

    await page.mouse.click(box.x + anchor.x, box.y + anchor.y);

    // Leg 1 - magnetic at the inner hover.
    await hover(HOVER_MAGNETIC);
    await waitForPaint(page, clip, hasMagnetSnapPixels, 'the magnet-snapped draft path in green');

    // Leg 2 - the SAME point as leg 3, with Alt up. This is the control for leg 3: it proves
    // the coordinate is one the magnet holds, so the orange that follows is not the detector
    // failing to find an edge somewhere the magnet was never going to.
    await hover(HOVER_ALT);
    await waitForPaint(page, clip, hasMagnetSnapPixels, 'the outer hover to be magnetic too, before Alt is involved');

    // Leg 3 - Alt down, and the cursor walked back to the inner hover first so the move out to
    // `HOVER_ALT` is a real gesture. A move under Alt rebuilds the segment with
    // `magneticEnabled: false` (`FeatherMagneticLassoToolArea.tsx:522`), and
    // `createMagneticSegment` (`:424`) then skips the detector outright and reports
    // `usedMagnetic: false` - so the path repaints orange with the geometry unchanged. The
    // auto-anchor cannot rescue it into green either: `processPointerMovePreview` (`:274`)
    // only auto-commits when `magneticEnabled` is true.
    await page.keyboard.down('Alt');
    await hover(HOVER_MAGNETIC);
    await hover(HOVER_ALT);
    await waitForPaint(page, clip, hasManualSnapPixels, 'the Alt-suppressed draft path in orange');
    await page.keyboard.up('Alt');

    // Leg 4 - back to a magnetic hover: green must return. Without this the test would also pass
    // on a build whose magnet latched off permanently after the first Alt press.
    await hover(HOVER_ALT);
    await hover(HOVER_MAGNETIC);
    await waitForPaint(page, clip, hasMagnetSnapPixels, 'the magnet to re-engage once Alt is released');
  });

  /**
   * A committed selection, which is the tool's output.
   *
   * Double-click is `:505`'s `isDoubleClick` branch calling `finishSelection` on `:506`. The
   * assertion is that the selection SURVIVED the commit - `getSelectionBounds` reads the app's
   * own `#007bff` outline - and the default thresholds are used deliberately:
   * `select-move.spec.ts:181` documents why a local copy of the colour constants is a trap,
   * since the two would then read the before and after of one gesture under two definitions.
   *
   * `page.mouse.dblclick` sends two full click sequences at one coordinate, and the branch
   * needs the second of them: `isDoubleClick` (`:437`-`:445`) compares against the PREVIOUS
   * click within 12px and 300ms, so the click before the double-click is what makes the pair a
   * pair. The four anchors are spaced so the committed path is a recognisable shape rather than
   * a degenerate loop, and the closing click is far enough from the first anchor to clear
   * `CLOSE_START_THRESHOLD` of 10px - otherwise the selection would close on the start-anchor
   * branch at `:498`-`:503` and the double-click would never be the thing under test.
   */
  test('a double-click closes the path and leaves a committed selection', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = canvasClip(page, box);

    for (const degrees of [270, 340, 50, 160]) {
      const at = onDiscEdge(box, degrees);
      await page.mouse.click(box.x + at.x, box.y + at.y);
    }
    const close = onDiscEdge(box, 200);
    await page.mouse.dblclick(box.x + close.x, box.y + close.y);

    await waitForCanvasPixels(page, clip, async (screenshot) => (await draftOutline(screenshot)) !== null, {
      description: 'the committed selection outline',
    });
    // Copy is gated on a live selection, so its enabled state is a second, non-pixel reading of
    // the same fact - and it cannot be satisfied by the draft overlay, which never enables it.
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeEnabled();
  });

  /**
   * Escape and Backspace are the tool's other two documented gestures
   * (`FeatherMagneticLassoToolArea.tsx:544`, `:566`), and they are opposites: Escape throws the
   * draft away, Backspace pops one anchor off and leaves the path standing.
   *
   * ## Why this test clicks three times and not two
   *
   * `removeLastAnchor` (`:345`-`:348`) does not pop an anchor from an empty segment list - it
   * CANCELS the whole draft. So the number of committed segments decides which gesture the test
   * is looking at: one click commits no segment, the second commits one, and popping that one
   * leaves none, which is Escape's behaviour wearing Backspace's key. Three clicks commit two
   * segments, so Backspace pops one and leaves a path - deterministically, with no reliance on
   * the auto-anchor side effect a hover would bring with it.
   *
   * ## What proves the anchor went, as opposed to the draft merely staying open
   *
   * Two claims, and only the first is free. "The blue path survives" separates Backspace from
   * Escape, and a Backspace wired to the Escape handler fails it. "The path got SHORTER" is what
   * separates a real pop from a Backspace that does nothing at all, which the survival check
   * alone would accept. The three anchors run down the disc's right side, so the popped segment
   * is the only part of the path below the centre line and removing it must shrink the bounds.
   */
  test('Escape closes the draft and Backspace drops only its last anchor', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = canvasClip(page, box);
    const readDraft = async () => draftOutline(await page.screenshot({ clip }));

    // Two committed segments, laid out so the third is the only one reaching below the centre.
    for (const degrees of [ANCHOR_DEGREES, 330, 30]) {
      const at = onDiscEdge(box, degrees);
      await page.mouse.click(box.x + at.x, box.y + at.y);
    }

    const before = await readDraft();
    expect(before, 'the three anchors leave a committed path behind them').not.toBeNull();

    await page.keyboard.press('Backspace');
    // The blue path must SURVIVE. This is the Escape-versus-Backspace claim.
    const after = await readDraft();
    expect(after, 'Backspace must leave the draft open').not.toBeNull();
    // And it must be SHORTER, which is the anchor-actually-went claim. `getSelectionBounds`
    // reports edges rather than a size, so the height is the difference of two of them.
    const pathHeight = (bounds: { top: number; bottom: number }) => bounds.bottom - bounds.top;
    expect(
      pathHeight(after!),
      'popping the last anchor must shorten the committed path, not leave it as it was'
    ).toBeLessThan(pathHeight(before!) * SHRINK_RATIO);

    // No selection was ever committed, so nothing downstream of one is enabled.
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();

    // --- Escape, from that same live draft, takes the path away.
    await page.keyboard.press('Escape');
    await waitForCanvasPixels(page, clip, async (screenshot) => (await draftOutline(screenshot)) === null, {
      description: 'the draft path to be gone after Escape',
    });
    // Escape left nothing behind, so Copy is still off.
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
  });

  /**
   * The option surface, which the component tests cannot reach: every control the bar renders
   * is asserted to move its own readout, and each is moved OFF its seeded value first so the
   * assertion is about a write rather than about a coincidence.
   *
   * `FeatherMagneticLasso.tsx:272`-`:311` documents Feather, Width, Contrast and Frequency. Each
   * renders its live value INSIDE its own `<label>`, so the accessible name IS the readout -
   * which is why these are exact-name assertions. Matching on the label word alone would be
   * circular: the locator already selects by `/Width/`, so a `/Width/` matcher would still pass
   * on a `fill` that wrote nothing at all. `paint-options.spec.ts:180` relies on the same pairing
   * for the brush controls, and states it as an exact string for the same reason.
   *
   * Note the units differ per control and the readouts must match them: `px` on Feather and
   * Width, `%` on Contrast, and nothing at all on Frequency (`:311` renders the bare number).
   */
  test('every control on the bar is reachable and reports its own value', async ({ page }) => {
    for (const { control, seeded, value, moved } of SEEDED_READOUTS) {
      const slider = page.getByRole('slider', { name: control });
      await expect(slider, `${control} must be on the magnetic lasso bar`).toBeVisible();
      await expect(slider, `${control} must start on its seeded value`).toHaveAccessibleName(seeded);

      await slider.fill(value);
      await expect(slider, `${control} must report the value it was set to`).toHaveAccessibleName(moved);
    }

    // Both checkboxes, which carry static text and therefore NO value in their label — so they
    // are asserted by state, and their labels are asserted as resolvable so a rename would fail.
    for (const { label, arg } of CHECKBOXES) {
      const box = page.getByRole('checkbox', { name: label });
      await expect(box, `${label} (${arg}) must be on the magnetic lasso bar`).toBeVisible();
      await expect(box, `${label} (${arg}) is seeded on`).toBeChecked();

      await box.uncheck();
      await expect(box, `${label} (${arg}) must take the uncheck`).not.toBeChecked();
      // Put it back, so a control later in the loop is asserted against the seed rather than
      // against whatever the previous iteration left behind.
      await box.check();
      await expect(box, `${label} (${arg}) must take the re-check`).toBeChecked();
    }
  });

  /**
   * The two remaining ways a draft can end, neither of which the Alt test above reaches.
   *
   * `finishSelection` (`:377`) is reachable three ways that are not Enter, and the component's own
   * comment enumerates them: "the close-anchor click and the double-click in
   * `handlePointerDown`, `handleContextMenu`, and the Enter shortcut" (`:423`-`:425`).
   * `handleContextMenu` (`:528`) calls it at `:530` behind a `preventDefault`, so it is the route a
   * test can drive without depending on the double click's own 12px/300ms timing thresholds —
   * which is why it is the one exercised here. Right-click is also the only one of the three a
   * keyboard-free test can reach at all.
   *
   * Both halves are asserted through the committed outline, because both are claims about
   * COMMITTING, and a draft that merely drew more blue would satisfy a weaker reading. Copy is
   * asserted alongside as the non-pixel reading: it is gated on `hasActiveSelection`
   * (`:145`, used at `:361`), which is false for a draft.
   *
   * Escape first, on an empty draft, because `cancelSelectionDraft` (`:303`) early-returns on
   * `anchorsRef.current.length === 0`. Asserted as a negative — Copy still off — which is the
   * only reading that distinguishes "correctly did nothing" from "cancelled something that was
   * never there": neither can be told apart from the absence of a selection alone, but only one
   * leaves Copy disabled for the rest of the gesture.
   */
  test('a right-click also finishes the path, and Escape before any anchor does nothing', async ({ page }) => {
    const box = await workspaceBox(page);
    const clip = canvasClip(page, box);
    const copy = page.getByRole('button', { name: 'Copy', exact: true });
    const hasCommittedOutline = async (screenshot: Buffer) => (await getSelectionBounds(screenshot)) !== null;

    await page.keyboard.press('Escape');
    await expect(copy, 'Escape on an empty draft must leave nothing committed').toBeDisabled();

    // Four anchors around the outline, so the committed path is a recognisable shape rather than a
    // degenerate loop, then a right-click to finish.
    for (const degrees of [270, 340, 50, 160]) {
      const at = onDiscEdge(box, degrees);
      await page.mouse.click(box.x + at.x, box.y + at.y);
    }
    const closeAt = onDiscEdge(box, 200);
    await page.mouse.click(box.x + closeAt.x, box.y + closeAt.y, { button: 'right' });

    await waitForCanvasPixels(page, clip, hasCommittedOutline, {
      description: 'the committed selection outline after a right-click finish',
    });
    await expect(copy, 'a right-click finish is a commit, so Copy is enabled').toBeEnabled();
  });
});
