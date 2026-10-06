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

describe('type guard predicates', () => {
  it.each([
    ['text', isTextToolArgs],
    ['draw', isDrawToolArgs],
    ['shape', isShapeToolArgs],
    ['crop', isCropToolArgs],
    ['transform', isTransformToolArgs],
    ['color', isColorsToolArgs],
    ['blur', isBlurToolArgs],
    ['levels', isLevelsToolArgs],
    ['reposition', isRepositionToolArgs],
  ] as const)('returns true when toolName matches %s', (toolName, guard) => {
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
    [{ toolName: 'text', text: 'Draft', rect: { x: 0, y: 0, width: 10, height: 10 } }, true],
    [{ toolName: 'text', text: '', rect: { x: 0, y: 0, width: 10, height: 10 } }, false],
    [{ toolName: 'text', text: 'Draft', rect: null }, false],
    [{ toolName: 'draw' }, false],
  ] as const)('detects pending text content', (args, expected) => {
    expect(hasPendingText(args as unknown as ToolArgs)).toBe(expected);
  });
});
