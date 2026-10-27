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

const SIMPLE_GUARDS: ReadonlyArray<{
  name: string;
  expected: ToolName;
  guard: (args: ToolArgs | null | undefined) => boolean;
}> = [
  { name: 'isTextToolArgs', expected: 'text', guard: isTextToolArgs },
  { name: 'isDrawToolArgs', expected: 'draw', guard: isDrawToolArgs },
  { name: 'isShapeToolArgs', expected: 'shape', guard: isShapeToolArgs },
  { name: 'isCropToolArgs', expected: 'crop', guard: isCropToolArgs },
  { name: 'isTransformToolArgs', expected: 'transform', guard: isTransformToolArgs },
  { name: 'isColorsToolArgs', expected: 'color', guard: isColorsToolArgs },
  { name: 'isBlurToolArgs', expected: 'blur', guard: isBlurToolArgs },
  { name: 'isLevelsToolArgs', expected: 'levels', guard: isLevelsToolArgs },
  { name: 'isRepositionToolArgs', expected: 'reposition', guard: isRepositionToolArgs },
];

describe('type guard predicates', () => {
  describe('simple guards — exhaustive cross-product against ALL toolName values', () => {
    for (const { name, expected, guard } of SIMPLE_GUARDS) {
      it(`${name} returns true only for '${expected}' and false for every other toolName`, () => {
        for (const candidate of ALL_TOOL_NAMES) {
          const args = { toolName: candidate } as ToolArgs;
          if (candidate === expected) {
            expect(guard(args)).toBe(true);
          } else {
            expect(guard(args)).toBe(false);
          }
        }
      });
    }
  });

  it.each(SIMPLE_GUARDS)('returns true when toolName matches %s', ({ expected: toolName, guard }) => {
    const args = { toolName } as ToolArgs;
    expect(guard(args)).toBe(true);
  });

  it.each([
    ['draw', isTextToolArgs],
    ['text', isDrawToolArgs],
    ['shape', isTextToolArgs],
    ['blur', isCropToolArgs],
    ['levels', isTransformToolArgs],
    ['color', isBlurToolArgs],
    ['reposition', isColorsToolArgs],
  ] as const)('returns false when toolName does not match %s', (toolName, guard) => {
    const args = { toolName } as ToolArgs;
    expect(guard(args)).toBe(false);
  });

  it('returns false for objects whose toolName does not match', () => {
    const args = { toolName: 'draw' } as ToolArgs;
    expect(isTextToolArgs(args)).toBe(false);
    expect(isShapeToolArgs(args)).toBe(false);
    expect(isCropToolArgs(args)).toBe(false);
  });

  it('returns false for a null toolName', () => {
    const args = { toolName: null } as unknown as ToolArgs;
    expect(isTextToolArgs(args)).toBe(false);
    expect(isDrawToolArgs(args)).toBe(false);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
  ] as const)('simple guards return false for %s', (_label, input) => {
    for (const { guard } of SIMPLE_GUARDS) {
      expect(guard(input as unknown as ToolArgs)).toBe(false);
    }
  });

  describe('isRasterStrokeArgs', () => {
    const validStroke = (toolName: ToolName) =>
      ({ toolName, points: VALID_POINTS, rasterBounds: VALID_BOUNDS }) as unknown as ToolArgs;

    it.each(FOCUS_TOOL_NAMES)('returns true for a valid %s stroke', (toolName) => {
      expect(isRasterStrokeArgs(validStroke(toolName))).toBe(true);
    });

    it('returns true for a single-point stroke', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'blur',
          points: [{ x: 5, y: 5 }],
          rasterBounds: VALID_BOUNDS,
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it('returns true for a multi-point stroke', () => {
      expect(
        isRasterStrokeArgs({
          toolName: 'sharpen',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
          rasterBounds: { x: 0, y: 0, width: 10, height: 10 },
        } as unknown as ToolArgs)
      ).toBe(true);
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
  });

  describe('hasPendingText', () => {
    const textRect = { x1: 0, y1: 0, x2: 10, y2: 10 };

    it.each([
      [{ toolName: 'text', text: 'Draft', rect: textRect }, true],
      [{ toolName: 'text', text: '', rect: textRect }, false],
      [{ toolName: 'text', text: 'Draft', rect: null }, false],
      [{ toolName: 'draw' }, false],
    ] as const)('detects pending text content', (args, expected) => {
      expect(hasPendingText(args as unknown as ToolArgs)).toBe(expected);
    });

    it('returns true when text and rect are both present', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          text: 'hello',
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(true);
    });

    it('returns false when text is missing but rect is present', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it('returns false when rect is missing but text is present', () => {
      expect(hasPendingText({ toolName: 'text', text: 'hello' } as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when both text and rect are missing', () => {
      expect(hasPendingText({ toolName: 'text' } as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when text is undefined', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          text: undefined,
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it('returns false when rect is undefined', () => {
      expect(hasPendingText({ toolName: 'text', text: 'hello', rect: undefined } as unknown as ToolArgs)).toBe(false);
    });

    it('returns false when text is an empty string', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          text: '',
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it('returns false when text is NaN (non-finite)', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          text: NaN,
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it('returns false when text is the number 0 (falsy non-string)', () => {
      expect(
        hasPendingText({
          toolName: 'text',
          text: 0,
          rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
        } as unknown as ToolArgs)
      ).toBe(false);
    });

    it('returns false for non-text tool args even with text and rect', () => {
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

  describe('tripwires — guards must not be degenerate', () => {
    for (const { name, expected, guard } of SIMPLE_GUARDS) {
      describe(name, () => {
        it.fails(`does NOT return true for null`, () => {
          expect(guard(null)).toBe(true);
        });

        it.fails(`does NOT return true for undefined`, () => {
          expect(guard(undefined)).toBe(true);
        });

        it.fails(`does NOT return true for a number`, () => {
          expect(guard(42 as unknown as ToolArgs)).toBe(true);
        });

        it.fails(`does NOT return true for non-finite toolName (NaN)`, () => {
          expect(guard({ toolName: NaN } as unknown as ToolArgs)).toBe(true);
        });

        it.fails(`does NOT return true for a non-matching toolName`, () => {
          const nonMatching = ALL_TOOL_NAMES.find((n) => n !== expected)!;
          expect(guard({ toolName: nonMatching } as ToolArgs)).toBe(true);
        });

        it.fails(`does NOT return false for its own toolName`, () => {
          expect(guard({ toolName: expected } as ToolArgs)).toBe(false);
        });
      });
    }

    describe('hasPendingText', () => {
      it.fails('does NOT return true for null', () => {
        expect(hasPendingText(null)).toBe(true);
      });

      it.fails('does NOT return true for undefined', () => {
        expect(hasPendingText(undefined)).toBe(true);
      });

      it.fails('does NOT return true for non-text args', () => {
        expect(hasPendingText({ toolName: 'draw' } as ToolArgs)).toBe(true);
      });

      it.fails('does NOT return false when text and rect are present', () => {
        expect(
          hasPendingText({
            toolName: 'text',
            text: 'hello',
            rect: { x1: 0, y1: 0, x2: 10, y2: 10 },
          } as unknown as ToolArgs)
        ).toBe(false);
      });
    });
  });
});
