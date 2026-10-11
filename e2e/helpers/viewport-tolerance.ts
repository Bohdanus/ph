import { type BoundingBox, DEFAULT_DOCUMENT_SIZE, containFit } from './canvas-helpers';

/**
 * Half of the Draw tool's default `lineWidth`, which is 10 DOCUMENT pixels
 * (`src/tools/settings.ts:38`, `pen: { alpha: 0.9, lineWidth: 10 }`, spread into the `draw`
 * args at `:68-74`). A stroke's painted extent therefore runs half a stroke WIDER than the
 * point that was asked for on each side, and `getDarkPixelBounds` reports the whole painted
 * extent rather than its centre line. That is the entire legitimate reason a stroke's edge
 * is not at the cursor, and it is why the bound below is a function of the fit scale rather
 * than a constant: the same 10 document pixels are 12.7 CSS px in the `wide` window and 9.4
 * in `narrow`, so any single constant is either loose at one window or tight at another.
 */
export const DRAW_HALF_WIDTH_DOC_PX = 5;

/**
 * What is left after the geometric half-width: the faint antialiased fringe of the round
 * cap, and the one-image-pixel convention of `imageBoundsToCss`, which maps an inclusive
 * pixel index to the CENTRE of that pixel (see its JSDoc, `screenshot-scale.ts:153-176`) and
 * so under-reports a covered span by half a CSS pixel on a 1:1 capture. `getDarkPixelBounds`
 * also applies a DARK THRESHOLD, so it discards the faintest fringe pixels entirely, which
 * is why the measured deviation lands a little UNDER `DRAW_HALF_WIDTH_DOC_PX * scale` rather
 * than on it. 2px covers both; the measured slack over it is 2.9-3.7px at the three
 * windows below, so this is a margin and not a fit.
 */
export const ANTIALIASED_FLANGE_CSS_PX = 2;

/**
 * The fixed constant this test used before, kept ONLY as a ceiling the derived tolerance is
 * asserted against. It is not the tolerance; see `expect(toleranceFor(...)).toBeLessThan`
 * below. It is here so that a future edit which replaces the derived bound with a literal
 * fails loudly instead of quietly re-widening the gate.
 */
export const LEGACY_FIXED_SLACK_CSS_PX = 25;

/**
 * How far the canvas box may drift between the gesture and the capture that photographs it.
 * Nothing: the two have to describe the same rectangle, and layout here is pixel-quantised,
 * so anything above sub-pixel noise means the page was re-laid-out in between.
 */
export const MAX_BOX_DRIFT_CSS_PX = 0.5;

/**
 * The deliberate-overflow displacement used by the non-vacuity control in
 * `viewport-drawing.spec.ts`, exposed as a named constant so the control and its unit
 * companion agree on the same number and a future edit cannot loosen both sides at once.
 *
 * The control proves the comparison CAN detect a displacement that is 5x the widest
 * derived tolerance across the three viewports — well past any plausible fit failure — so
 * that a bound which silently admits a mapping error stays green on empty evidence is
 * caught before it can pass.
 */
export const DELIBERATE_OVERFLOW_CSS_PX = 40;

/**
 * How far the stroke's painted edge may sit from the cursor point that asked for it: the
 * brush's own half-width converted to CSS by the app's contain fit, plus the fringe above.
 *
 * Derived from `containFit`, which is the suite's single implementation of the app's fit and
 * is asserted equal to the app's own published `data-fit-*` at more than one rect size by
 * `e2e/export/visual-regression.spec.ts`. So the bound moves WITH the window instead of
 * being a constant that happened to hold.
 *
 * What it does NOT absorb is any mapping error, and that is the load-bearing property. The
 * `drawLine` P2 (`e2e/OPEN_PROBLEMS.md`, "drawLine applies no contain scale") is a mismatch
 * worth TENS of CSS pixels: at the `wide` window below, the difference between painting the
 * document stretched across the box and painting it contained is 88px in x (379.5 against
 * 291.5 for the start point). A bound of 8.36px still catches that with an order of
 * magnitude to spare, so this number can absorb the stroke's own width and nothing else.
 *
 * Pure and browser-free by design: it is the rule the skipped assertion below is built on,
 * so it must be checkable without a capture whose stability is the open question
 * (`docs/E2E-HARDENING-PLAN.md`, row 12).
 */
export function toleranceFor(box: BoundingBox): number {
  return DRAW_HALF_WIDTH_DOC_PX * containFit(box, DEFAULT_DOCUMENT_SIZE).scale + ANTIALIASED_FLANGE_CSS_PX;
}
