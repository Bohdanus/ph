import { describe, expect, it } from 'vitest';
import {
  isTextToolArgs,
  isDrawToolArgs,
  isShapeToolArgs,
  isCropToolArgs,
  isTransformToolArgs,
  isColorsToolArgs,
  isBlurToolArgs,
  isLevelsToolArgs,
  isRepositionToolArgs,
  isRasterStrokeArgs,
  hasPendingText,
} from '../typeGuards.ts';
import type { ToolArgs, ToolName } from '../../contexts/tool-types.ts';

const ALL_TOOL_NAMES: ToolName[] = [
  'text',
  'draw',
  'shape',
  'crop',
  'transform',
  'color',
  'blur',
  'levels',
  'reposition',
  'sharpen',
  'smudge',
  'polygonal-lasso',
  'freehand-lasso',
  'feather-magnetic-lasso',
  'magic-wand',
  'rectangular-selection',
  'single-row-marquee',
  'single-column-marquee',
  'elliptical-selection',
  'quick-selection',
  'gradient',
  'dodge',
  'burn',
  'sponge',
  'clone-stamp',
  'red-eye',
  'spot-healing',
  'healing-brush',
  'patch',
  'brush',
  'pencil',
  'color-replacement',
  'eraser',
  'magic-eraser',
  'paint-bucket',
  'eyedropper',
  'color-sampler',
  'ruler',
  'hand',
  'zoom',
  'rotate-view',
  'pen',
  'freeform-pen',
  'curvature-pen',
  'add-anchor-point',
  'delete-anchor-point',
  'convert-point',
  'rectangle',
  'ellipse',
  'triangle',
  'polygon',
  'line',
  'custom-shape',
];

const FOCUS_TOOL_NAMES = ['blur', 'sharpen', 'smudge'] as const;
const VALID_POINTS = [
  { x: 10, y: 20 },
  { x: 30, y: 40 },
];
const VALID_BOUNDS = { x: 0, y: 0, width: 100, height: 100 };
const VALID_STROKE = {
  toolName: 'blur' as const,
  points: VALID_POINTS,
  rasterBounds: VALID_BOUNDS,
};

const textBase = { toolName: 'text' as const, text: 'hello', rect: { x1: 0, y1: 0, x2: 10, y2: 10 } };
const shapeBase = { toolName: 'shape' as const, figure: 'rectangle' as const, alpha: 1, color: '#000000' };
const drawBase = {
  toolName: 'draw' as const,
  penType: 'brush' as const,
  points: [],
  size: 4,
  alpha: 1,
  color: '#000000',
};

describe('type guard edge cases', () => {
  describe.each([
    ['isTextToolArgs', isTextToolArgs, textBase],
    ['isDrawToolArgs', isDrawToolArgs, drawBase],
    ['isShapeToolArgs', isShapeToolArgs, shapeBase],
    ['isCropToolArgs', isCropToolArgs, { toolName: 'crop' as const }],
    ['isTransformToolArgs', isTransformToolArgs, { toolName: 'transform' as const }],
    ['isColorsToolArgs', isColorsToolArgs, { toolName: 'color' as const }],
    ['isBlurToolArgs', isBlurToolArgs, { toolName: 'blur' as const }],
    ['isLevelsToolArgs', isLevelsToolArgs, { toolName: 'levels' as const }],
    ['isRepositionToolArgs', isRepositionToolArgs, { toolName: 'reposition' as const }],
  ] as const)('%s', (_name, guard, baseArgs) => {
    it('returns true for matching toolName', () => {
      expect(guard(baseArgs as unknown as ToolArgs)).toBe(true);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['an empty object', {}],
    ])('returns false for %s', (_label, args) => {
      expect(guard(args as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when toolName is NaN', () => {
      const args = { ...baseArgs, toolName: NaN } as unknown;
      expect(guard(args as ToolArgs)).toBe(false);
    });

    it('returns false when toolName is Infinity', () => {
      const args = { ...baseArgs, toolName: Infinity } as unknown;
      expect(guard(args as ToolArgs)).toBe(false);
    });

    it('returns false when toolName is -Infinity', () => {
      const args = { ...baseArgs, toolName: -Infinity } as unknown;
      expect(guard(args as ToolArgs)).toBe(false);
    });

    it('returns false when toolName is a number', () => {
      const args = { ...baseArgs, toolName: 0 } as unknown;
      expect(guard(args as ToolArgs)).toBe(false);
    });

    it('returns false when toolName is a boolean', () => {
      const args = { ...baseArgs, toolName: false } as unknown;
      expect(guard(args as ToolArgs)).toBe(false);
    });

    it('returns false when toolName does not match', () => {
      const wrong = { ...baseArgs, toolName: 'wrong-tool-name' } as unknown;
      expect(guard(wrong as ToolArgs)).toBe(false);
    });
  });

  describe('isRasterStrokeArgs', () => {
    const validStroke = (toolName: ToolName) => ({ ...VALID_STROKE, toolName }) as unknown as ToolArgs;

    it.each(FOCUS_TOOL_NAMES)('returns true for a valid %s stroke', (toolName) => {
      expect(isRasterStrokeArgs(validStroke(toolName))).toBe(true);
    });

    it('returns false for null', () => {
      expect(isRasterStrokeArgs(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isRasterStrokeArgs(undefined)).toBe(false);
    });

    it('returns false for a number', () => {
      expect(isRasterStrokeArgs(42 as unknown as ToolArgs)).toBe(false);
    });

    it('returns false for an empty object', () => {
      expect(isRasterStrokeArgs({} as unknown as ToolArgs)).toBe(false);
    });

    const nonFocusToolNames = ALL_TOOL_NAMES.filter(
      (n) => !FOCUS_TOOL_NAMES.includes(n as (typeof FOCUS_TOOL_NAMES)[number])
    );

    it.each(nonFocusToolNames)(
      'returns false for non-focus toolName %s even with valid points and bounds',
      (toolName) => {
        expect(isRasterStrokeArgs(validStroke(toolName))).toBe(false);
      }
    );

    describe('points validation', () => {
      it('returns false for an empty points array', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when points is not an array', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: 42 } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when points is undefined', () => {
        expect(isRasterStrokeArgs({ toolName: 'blur', rasterBounds: VALID_BOUNDS } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when points is null', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: null } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when a point is null', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [null] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when a point is a number', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [42] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when a point is a string', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: ['foo'] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when a point is missing x', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [{ y: 20 }] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when a point is missing y', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [{ x: 10 }] } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['NaN', { x: NaN, y: 20 }],
        ['Infinity', { x: Infinity, y: 20 }],
        ['-Infinity', { x: -Infinity, y: 20 }],
      ] as const)('returns false when a point has %s for x', (_label, point) => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [point] } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['NaN', { x: 10, y: NaN }],
        ['Infinity', { x: 10, y: Infinity }],
        ['-Infinity', { x: 10, y: -Infinity }],
      ] as const)('returns false when a point has %s for y', (_label, point) => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, points: [point] } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when any point in a multi-point stroke has non-finite coords', () => {
        expect(
          isRasterStrokeArgs({
            toolName: 'blur',
            points: [
              { x: 10, y: 20 },
              { x: NaN, y: 30 },
            ],
            rasterBounds: VALID_BOUNDS,
          } as unknown as ToolArgs)
        ).toBe(false);
      });
    });

    describe('rasterBounds validation', () => {
      it('returns false when rasterBounds is missing', () => {
        expect(isRasterStrokeArgs({ toolName: 'blur', points: VALID_POINTS } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when rasterBounds is null', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds: null } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when rasterBounds is undefined', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds: undefined } as unknown as ToolArgs)).toBe(false);
      });

      it('returns false when rasterBounds is a number', () => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds: 42 } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['x', { y: 0, width: 100, height: 100 }],
        ['y', { x: 0, width: 100, height: 100 }],
        ['width', { x: 0, y: 0, height: 100 }],
        ['height', { x: 0, y: 0, width: 100 }],
      ] as const)('returns false when rasterBounds is missing %s', (_label, partialBounds) => {
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds: partialBounds } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['x', NaN],
        ['y', NaN],
        ['width', NaN],
        ['height', NaN],
      ] as const)('returns false when rasterBounds.%s is NaN', (_label, value) => {
        const rasterBounds = { ...VALID_BOUNDS, [_label]: value };
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['x', Infinity],
        ['y', Infinity],
        ['width', Infinity],
        ['height', Infinity],
        ['x', -Infinity],
        ['y', -Infinity],
        ['width', -Infinity],
        ['height', -Infinity],
      ] as const)('returns false when rasterBounds.%s is %s', (_field, value) => {
        const rasterBounds = { ...VALID_BOUNDS, [_field]: value };
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds } as unknown as ToolArgs)).toBe(false);
      });

      it.each([
        ['width', 0],
        ['height', 0],
        ['width', -1],
        ['height', -1],
        ['width', 100, 'height', 0],
        ['width', 0, 'height', 100],
      ] as const)('returns false when rasterBounds dimensions are zero or negative', (...args) => {
        const rasterBounds: Record<string, unknown> = { ...VALID_BOUNDS };
        for (let i = 0; i < args.length; i += 2) {
          rasterBounds[args[i] as string] = args[i + 1];
        }
        expect(isRasterStrokeArgs({ ...VALID_STROKE, rasterBounds } as unknown as ToolArgs)).toBe(false);
      });
    });

    describe('non-finite toolName', () => {
      it.each([
        ['NaN', NaN],
        ['Infinity', Infinity],
        ['-Infinity', -Infinity],
      ] as const)('returns false when toolName is %s', (_label, toolName) => {
        expect(
          isRasterStrokeArgs({ toolName, points: VALID_POINTS, rasterBounds: VALID_BOUNDS } as unknown as ToolArgs)
        ).toBe(false);
      });
    });
  });

  describe('hasPendingText', () => {
    it('returns true when text and rect are both present', () => {
      expect(hasPendingText(textBase as unknown as ToolArgs)).toBe(true);
    });

    it('returns false when text args lack a rect', () => {
      const noRect = { toolName: 'text' as const, text: 'hello' };
      expect(hasPendingText(noRect as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when rect is null', () => {
      const nullRect = { toolName: 'text' as const, text: 'hi', rect: null };
      expect(hasPendingText(nullRect as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when rect is undefined', () => {
      const undefinedRect = { toolName: 'text' as const, text: 'hi', rect: undefined };
      expect(hasPendingText(undefinedRect as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when text is undefined', () => {
      const noText = { toolName: 'text' as const, rect: { x1: 0, y1: 0, x2: 10, y2: 10 } };
      expect(hasPendingText(noText as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when text is an empty string', () => {
      const emptyText = { toolName: 'text' as const, text: '', rect: { x1: 0, y1: 0, x2: 10, y2: 10 } };
      expect(hasPendingText(emptyText as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when text is NaN', () => {
      const nanText = { toolName: 'text' as const, text: NaN, rect: { x1: 0, y1: 0, x2: 10, y2: 10 } };
      expect(hasPendingText(nanText as unknown as ToolArgs)).toBe(false);
    });

    it('returns true when text is Infinity (truthy non-string, rect present)', () => {
      const infText = { toolName: 'text' as const, text: Infinity, rect: { x1: 0, y1: 0, x2: 10, y2: 10 } };
      expect(hasPendingText(infText as unknown as ToolArgs)).toBe(true);
    });

    it('returns false for non-text tool args', () => {
      expect(hasPendingText(shapeBase as unknown as ToolArgs)).toBe(false);
    });

    it('returns false for non-text tool args that happen to have text and rect', () => {
      expect(
        hasPendingText({
          toolName: 'draw',
          text: 'hello',
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ] as const)('returns false for %s', (_label, args) => {
      expect(hasPendingText(args as unknown as ToolArgs)).toBe(false);
    });
  });

  describe('isRasterStrokeArgs tripwires', () => {
    it.fails('does NOT return true for null', () => {
      expect(isRasterStrokeArgs(null)).toBe(true);
    });

    it.fails('does NOT return true for undefined', () => {
      expect(isRasterStrokeArgs(undefined)).toBe(true);
    });

    it.fails('does NOT return true for a non-focus toolName with valid points and bounds', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'draw',
          points: VALID_POINTS,
          rasterBounds: VALID_BOUNDS,
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return true for empty points', () => {
      expect(
        isRasterStrokeArgs({ toolName: 'blur', points: [], rasterBounds: VALID_BOUNDS } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return true for zero-width rasterBounds', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'blur',
          points: VALID_POINTS,
          rasterBounds: { x: 0, y: 0, width: 0, height: 100 },
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return true for zero-height rasterBounds', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'blur',
          points: VALID_POINTS,
          rasterBounds: { x: 0, y: 0, width: 100, height: 0 },
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return true for NaN point coordinates', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'blur',
          points: [{ x: NaN, y: 20 }],
          rasterBounds: VALID_BOUNDS,
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return true for Infinity in rasterBounds width', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'blur',
          points: VALID_POINTS,
          rasterBounds: { x: 0, y: 0, width: Infinity, height: 100 },
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it.fails('does NOT return false for a valid stroke', () => {
      expect(isRasterStrokeArgs(VALID_STROKE as unknown as ToolArgs)).toBe(false);
    });
  });
});
