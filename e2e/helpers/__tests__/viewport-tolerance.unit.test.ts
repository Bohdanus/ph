import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { containFit, DEFAULT_DOCUMENT_SIZE } from '../canvas-helpers';
import {
  ANTIALIASED_FLANGE_CSS_PX,
  DELIBERATE_OVERFLOW_CSS_PX,
  DRAW_HALF_WIDTH_DOC_PX,
  LEGACY_FIXED_SLACK_CSS_PX,
  MAX_BOX_DRIFT_CSS_PX,
  toleranceFor,
} from '../viewport-tolerance';
import type { BoundingBox } from '../canvas-helpers';

/**
 * Representative canvas box sizes for the three viewport scenarios in
 * `viewport-drawing.spec.ts`, reduced by the app's chrome (left sidebar + top toolbar).
 *
 * These are NOT the runtime measurements the spec takes in the browser — that is the
 * non-vacuity control the spec keeps for itself. These are GEOMETRY fixtures that stand in
 * for the three windows so the derived-tolerance properties can be checked without a capture
 * whose stability is the open question (`docs/E2E-HARDENING-PLAN.md`, row 12). The only
 * property they must carry, and the only one asserted, is that they produce DISTINCT
 * contain-fit scales — which is what makes "the bound moves with the window" a real claim
 * rather than a rhetorical one.
 */
const VIEWPORT_BOXES = [
  { name: 'normal', box: { x: 56, y: 100, width: 974, height: 583 } },
  { name: 'wide', box: { x: 56, y: 100, width: 1160, height: 620 } },
  { name: 'narrow', box: { x: 56, y: 100, width: 680, height: 583 } },
] as const;

/** The three boxes produce three different contain-fit scales. */
const SCALES = VIEWPORT_BOXES.map(({ box }) => containFit(box, DEFAULT_DOCUMENT_SIZE).scale);

describe('toleranceFor derives from geometry, not a constant', () => {
  it('equals DRAW_HALF_WIDTH_DOC_PX * contain-fit scale + ANTIALIASED_FLANGE_CSS_PX', () => {
    for (const { box } of VIEWPORT_BOXES) {
      const { scale } = containFit(box, DEFAULT_DOCUMENT_SIZE);
      const expected = DRAW_HALF_WIDTH_DOC_PX * scale + ANTIALIASED_FLANGE_CSS_PX;
      expect(toleranceFor(box)).toBeCloseTo(expected, 10);
    }
  });

  it('produces distinct tolerances for the three viewport boxes', () => {
    // If two boxes produced the same scale, the non-vacuity control would be vacuous: three
    // assertions that all compared against the same number and could all pass on the same
    // wrong geometry. The scales must differ, which is the property that makes "per window"
    // meaningful at all.
    expect(new Set(SCALES.map((s) => s.toFixed(6))).size).toBe(3);

    const tolerances = VIEWPORT_BOXES.map(({ box }) => toleranceFor(box));
    expect(new Set(tolerances.map((t) => t.toFixed(6))).size).toBe(3);
  });
});

describe('the derived tolerance is a ceiling-beating bound', () => {
  it('is strictly below LEGACY_FIXED_SLACK_CSS_PX for every viewport box', () => {
    // The widest tolerance is the one most likely to breach the ceiling, so checking it
    // is the strongest single claim: if the largest derived value still clears the old
    // constant, so does every smaller one.
    const widestTolerance = Math.max(...VIEWPORT_BOXES.map(({ box }) => toleranceFor(box)));

    expect(
      widestTolerance,
      `the derived tolerance (${widestTolerance.toFixed(2)}px) is not tighter than the fixed ` +
        `${LEGACY_FIXED_SLACK_CSS_PX}px this test used to absorb a mapping error with`
    ).toBeLessThan(LEGACY_FIXED_SLACK_CSS_PX);
  });

  it('is strictly below the legacy constant even at the widest viewport box', () => {
    // Per-window check, in addition to the max: a single assertion over `widestTolerance`
    // could mask a regression where one window's box was dropped from the list and only
    // two are compared, so each window is also judged on its own number.
    for (const { name, box } of VIEWPORT_BOXES) {
      const tolerance = toleranceFor(box);
      expect(
        tolerance,
        `${name}: tolerance ${tolerance.toFixed(2)}px is not below ${LEGACY_FIXED_SLACK_CSS_PX}px`
      ).toBeLessThan(LEGACY_FIXED_SLACK_CSS_PX);
    }
  });
});

describe('the deliberate-overflow control detects a displacement', () => {
  it('DELIBERATE_OVERFLOW_CSS_PX exceeds the tolerance at every viewport', () => {
    // The control proves the comparison CAN detect a displacement that is 5x the widest
    // derived tolerance — well past any plausible fit failure — so that a bound which
    // silently admits a mapping error stays green on empty evidence is caught.
    for (const { name, box } of VIEWPORT_BOXES) {
      const tolerance = toleranceFor(box);
      expect(
        Math.abs(DELIBERATE_OVERFLOW_CSS_PX) > tolerance,
        `${name}: the comparison cannot detect a ${DELIBERATE_OVERFLOW_CSS_PX}px displacement (tolerance ${tolerance.toFixed(2)}px)`
      ).toBe(true);
    }
  });

  it('DELIBERATE_OVERFLOW_CSS_PX is at least 5x the widest derived tolerance', () => {
    // 5x is the ratio the spec states ("5x the widest tolerance above"). Pinning the ratio
    // rather than the absolute keeps the control meaningful if a future edit changes the
    // constant: the displacement must still be far outside the bound for every window.
    const widestTolerance = Math.max(...VIEWPORT_BOXES.map(({ box }) => toleranceFor(box)));
    expect(DELIBERATE_OVERFLOW_CSS_PX).toBeGreaterThanOrEqual(5 * widestTolerance);
  });
});

describe('the constants match their documented values', () => {
  // These are the one-place declarations of numbers the spec's JSDoc and
  // TEST-FLAKES.md cite by name. Pinning them here means a typo — `ANTIALIASED_FLANGE_CSS_PX = 12`
  // instead of 2, say — turns a "tighter" tolerance into a green pass instead of a loud stop,
  // and the test that should have caught the mapping error instead hides it.
  it('DRAW_HALF_WIDTH_DOC_PX is 5 (half of the 10px draw-lineWidth)', () => {
    expect(DRAW_HALF_WIDTH_DOC_PX).toBe(5);
  });

  it('ANTIALIASED_FLANGE_CSS_PX is 2 (the fringe + pixel-centre slack)', () => {
    expect(ANTIALIASED_FLANGE_CSS_PX).toBe(2);
  });

  it('LEGACY_FIXED_SLACK_CSS_PX is 25 (the pre-derived ceiling)', () => {
    expect(LEGACY_FIXED_SLACK_CSS_PX).toBe(25);
  });

  it('MAX_BOX_DRIFT_CSS_PX is 0.5 (sub-pixel layout noise)', () => {
    expect(MAX_BOX_DRIFT_CSS_PX).toBe(0.5);
  });

  it('DELIBERATE_OVERFLOW_CSS_PX is 40 (5x the widest derived tolerance)', () => {
    expect(DELIBERATE_OVERFLOW_CSS_PX).toBe(40);
  });
});

describe('toleranceFor on degenerate boxes', () => {
  it('returns a finite number for a zero-area box instead of throwing', () => {
    // A zero-sized canvas is what a closed or not-yet-laid-out tab produces. The function
    // must stay total, because a NaN here would propagate into a comparison that silently
    // always passed or always failed.
    const result = toleranceFor({ x: 0, y: 0, width: 0, height: 0 });
    expect(Number.isFinite(result)).toBe(true);
  });

  it('returns the antialias fringe alone when the document fills the box exactly', () => {
    // When box == document size the contain-fit scale is exactly 1, so the tolerance is
    // exactly DRAW_HALF_WIDTH_DOC_PX + ANTIALIASED_FLANGE_CSS_PX. This pins the additive
    // constant against the document dimensions rather than against some other box.
    const box: BoundingBox = { x: 0, y: 0, width: 800, height: 600 };
    const result = toleranceFor(box);
    expect(result).toBe(DRAW_HALF_WIDTH_DOC_PX + ANTIALIASED_FLANGE_CSS_PX);
  });
});

/**
 * The `toleranceFor` export is the single source the skipped spec imports.
 *
 * A duplicate declaration in the spec would silently stop tracking one edit: the guard
 * below pins that the spec reads the function and its constants from `./viewport-tolerance`
 * rather than re-declaring them. This is the relocated-control property — the spec's skip
 * stays in the spec, the derivation lives in the helper.
 */
describe('viewport-drawing.spec.ts imports the relocated derivation', () => {
  const SPEC_SOURCE = readFileSync(new URL('../../viewport-drawing.spec.ts', import.meta.url), 'utf8');

  it('imports toleranceFor from the viewport-tolerance module', () => {
    expect(SPEC_SOURCE).toMatch(
      /import\s*\{[^}]*\btoleranceFor\b[^}]*\}\s*from\s*['"]\.\/helpers\/viewport-tolerance['"]/
    );
  });

  it('does not re-declare toleranceFor, the constants, or the function locally', () => {
    expect(SPEC_SOURCE).not.toMatch(/function\s+toleranceFor\b/);
    expect(SPEC_SOURCE).not.toMatch(/const\s+DRAW_HALF_WIDTH_DOC_PX\s*=/);
    expect(SPEC_SOURCE).not.toMatch(/const\s+ANTIALIASED_FLANGE_CSS_PX\s*=/);
    expect(SPEC_SOURCE).not.toMatch(/const\s+LEGACY_FIXED_SLACK_CSS_PX\s*=/);
    expect(SPEC_SOURCE).not.toMatch(/const\s+MAX_BOX_DRIFT_CSS_PX\s*=/);
  });
});

describe('check-dpr.spec.ts imports the relocated derivation', () => {
  const SPEC_SOURCE = readFileSync(new URL('../../check-dpr.spec.ts', import.meta.url), 'utf8');

  it('imports toleranceFor from the viewport-tolerance module', () => {
    expect(SPEC_SOURCE).toMatch(
      /import\s*\{[^}]*\btoleranceFor\b[^}]*\}\s*from\s*['"]\.\/helpers\/viewport-tolerance['"]/
    );
  });

  it('does not re-declare CSS_POSITION_TOLERANCE as a constant', () => {
    expect(SPEC_SOURCE).not.toMatch(/const\s+CSS_POSITION_TOLERANCE\s*=/);
  });
});
