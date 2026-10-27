import { describe, expect, it } from 'vitest';
import { edgePlacement } from '../edge-placement.ts';
import type { PanelSide } from '../../contexts/PanelLayout.tsx';

describe('edgePlacement', () => {
  describe('left column', () => {
    it('places a full-height left occupant on grid-column-start:1, grid-row:3/5', () => {
      const result = edgePlacement('left', 'full');

      expect(result).toBe('[grid-column-start:1] [grid-row:3/5]');
    });

    it('places a top left occupant on grid-column-start:1, grid-row:3/4', () => {
      const result = edgePlacement('left', 'top');

      expect(result).toBe('[grid-column-start:1] [grid-row:3/4]');
    });

    it('places a bottom left occupant on grid-column-start:1, grid-row:4/5', () => {
      const result = edgePlacement('left', 'bottom');

      expect(result).toBe('[grid-column-start:1] [grid-row:4/5]');
    });
  });

  describe('right column', () => {
    it('places a full-height right occupant on grid-column-start:3, grid-row:3/5', () => {
      const result = edgePlacement('right', 'full');

      expect(result).toBe('[grid-column-start:3] [grid-row:3/5]');
    });

    it('places a top right occupant on grid-column-start:3, grid-row:3/4', () => {
      const result = edgePlacement('right', 'top');

      expect(result).toBe('[grid-column-start:3] [grid-row:3/4]');
    });

    it('places a bottom right occupant on grid-column-start:3, grid-row:4/5', () => {
      const result = edgePlacement('right', 'bottom');

      expect(result).toBe('[grid-column-start:3] [grid-row:4/5]');
    });
  });

  describe('return value invariants', () => {
    it('always returns a string containing grid-column-start', () => {
      for (const side of ['left', 'right'] as PanelSide[]) {
        for (const half of ['full', 'top', 'bottom'] as const) {
          const result = edgePlacement(side, half);
          expect(result).toContain('grid-column-start');
        }
      }
    });

    it('always returns a string containing grid-row', () => {
      for (const side of ['left', 'right'] as PanelSide[]) {
        for (const half of ['full', 'top', 'bottom'] as const) {
          const result = edgePlacement(side, half);
          expect(result).toContain('grid-row');
        }
      }
    });

    it('returns distinct values for each side', () => {
      const leftFull = edgePlacement('left', 'full');
      const rightFull = edgePlacement('right', 'full');

      expect(leftFull).not.toBe(rightFull);
    });

    it('returns distinct values for each half within a side', () => {
      const full = edgePlacement('left', 'full');
      const top = edgePlacement('left', 'top');
      const bottom = edgePlacement('left', 'bottom');

      expect(new Set([full, top, bottom]).size).toBe(3);
    });

    it('produces class strings with no newlines or tabs (Tailwind extraction safe)', () => {
      for (const side of ['left', 'right'] as PanelSide[]) {
        for (const half of ['full', 'top', 'bottom'] as const) {
          const result = edgePlacement(side, half);
          expect(result, `${side}/${half}`).not.toMatch(/[\n\r\t]/);
          // Two class tokens separated by a single space, no leading/trailing whitespace,
          // no double spaces — safe for interpolation into a className attribute.
          expect(result, `${side}/${half}`).toBe(result.trim());
          expect(result, `${side}/${half}`).not.toMatch(/\s\s/);
        }
      }
    });

    it('left column always starts at grid-column-start:1', () => {
      for (const half of ['full', 'top', 'bottom'] as const) {
        expect(edgePlacement('left', half)).toContain('[grid-column-start:1]');
      }
    });

    it('right column always starts at grid-column-start:3', () => {
      for (const half of ['full', 'top', 'bottom'] as const) {
        expect(edgePlacement('right', half)).toContain('[grid-column-start:3]');
      }
    });
  });

  describe('half → row mapping', () => {
    it('full spans rows 3/5 (the entire band)', () => {
      expect(edgePlacement('left', 'full')).toContain('[grid-row:3/5]');
      expect(edgePlacement('right', 'full')).toContain('[grid-row:3/5]');
    });

    it('top spans rows 3/4 (the upper half of the band)', () => {
      expect(edgePlacement('left', 'top')).toContain('[grid-row:3/4]');
      expect(edgePlacement('right', 'top')).toContain('[grid-row:3/4]');
    });

    it('bottom spans rows 4/5 (the lower half of the band)', () => {
      expect(edgePlacement('left', 'bottom')).toContain('[grid-row:4/5]');
      expect(edgePlacement('right', 'bottom')).toContain('[grid-row:4/5]');
    });
  });
});
