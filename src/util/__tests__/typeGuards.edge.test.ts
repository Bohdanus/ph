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
  hasPendingText,
} from '../typeGuards.ts';
import type { ToolArgs } from '../../contexts/tool-types.ts';

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
  ])('%s', (_name, guard, baseArgs) => {
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

    it('returns false when toolName does not match', () => {
      const wrong = { ...baseArgs, toolName: 'wrong-tool-name' } as unknown;
      expect(guard(wrong as ToolArgs)).toBe(false);
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

    it('returns false for non-text tool args', () => {
      expect(hasPendingText(shapeBase as unknown as ToolArgs)).toBe(false);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
    ])('returns false for %s', (_label, args) => {
      expect(hasPendingText(args as unknown as ToolArgs)).toBe(false);
    });
  });
});
