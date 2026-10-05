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

  /**
   * `hasPendingText` is `Boolean(text && rect)`, so a missing field and an empty one are the
   * same answer and only `undefined`/`null` differ from a falsy string. Nothing above
   * distinguishes `text: undefined` from `text: ''`, which is what a `!!args.text` rewrite
   * that tested for presence rather than truth would get wrong.
   */
  it.each([
    [{ toolName: 'text', rect: { x: 0, y: 0, width: 10, height: 10 } }, false],
    [{ toolName: 'text', text: undefined, rect: { x: 0, y: 0, width: 10, height: 10 } }, false],
    [{ toolName: 'text', text: 'Draft' }, false],
    [{ toolName: 'text', text: 0, rect: { x: 0, y: 0, width: 10, height: 10 } }, false],
    [{ toolName: 'text', text: 'Draft', rect: undefined }, false],
  ] as const)('reports no pending text for the falsy half of %j', (args, expected) => {
    expect(hasPendingText(args as unknown as ToolArgs)).toBe(expected);
  });

  it('reports no pending text for a null or undefined args', () => {
    expect(hasPendingText(null)).toBe(false);
    expect(hasPendingText(undefined)).toBe(false);
  });

  /**
   * Every guard against every other tool name, as one exact matrix rather than a sample.
   *
   * The per-guard "returns true" case already pins each guard's own name, and the sampled
   * negatives pin each guard's `=== 'x'` comparison. What neither pins is that no two
   * guards were wired to the SAME name: swapping the string inside `isLevelsToolArgs` for
   * `'color'` keeps every existing assertion in this file green, because no sampled negative
   * pairs `isLevelsToolArgs` with `'color'`. This matrix does.
   */
  it('accepts exactly one tool name each, and nothing else', () => {
    const names = ['text', 'draw', 'shape', 'crop', 'transform', 'color', 'blur', 'levels', 'reposition'] as const;
    const guards = [
      isTextToolArgs,
      isDrawToolArgs,
      isShapeToolArgs,
      isCropToolArgs,
      isTransformToolArgs,
      isColorsToolArgs,
      isBlurToolArgs,
      isLevelsToolArgs,
      isRepositionToolArgs,
    ] as const;

    // One pass over the names, not a nested pass: the outer `name` never reached an
    // assertion, so the nested form ran this same inner loop once per name and asserted
    // the identical matrix 9 times over. The cross-wiring the doc comment describes is
    // carried entirely by `guardIndex === otherIndex`, which needs each name once.
    for (const [otherIndex, otherName] of names.entries()) {
      const args = { toolName: otherName } as unknown as ToolArgs;
      for (const [guardIndex, guard] of guards.entries()) {
        expect(guard(args), `${names[guardIndex]} with toolName '${otherName}'`).toBe(guardIndex === otherIndex);
      }
    }
  });

  /**
   * `typeof args === 'object'` is load-bearing for a primitive, because the next clause is
   * `'toolName' in args`, and `in` throws on a primitive. `!!args` alone would let the
   * string `'text'` reach it.
   */
  it('returns false for a primitive rather than throwing on the `in` check', () => {
    const primitives = ['text', 0, 1, true, false, '', Symbol('text'), 10n];
    for (const primitive of primitives) {
      expect(isTextToolArgs(primitive as unknown as ToolArgs), String(primitive)).toBe(false);
      expect(isDrawToolArgs(primitive as unknown as ToolArgs), String(primitive)).toBe(false);
      expect(hasPendingText(primitive as unknown as ToolArgs), String(primitive)).toBe(false);
    }
  });

  it('returns false for an object with no toolName key at all', () => {
    expect(isTextToolArgs({} as ToolArgs)).toBe(false);
    expect(isRepositionToolArgs({ text: 'Draft' } as unknown as ToolArgs)).toBe(false);
    // Inherited rather than own: `in` walks the prototype chain, so this is true.
    expect(isTextToolArgs(Object.create({ toolName: 'text' }) as ToolArgs)).toBe(true);
  });

  it('returns false for a non-object args, including null and undefined', () => {
    expect(isTextToolArgs(null)).toBe(false);
    expect(isTextToolArgs(undefined)).toBe(false);
    expect(isDrawToolArgs(undefined)).toBe(false);
    expect(isLevelsToolArgs(null)).toBe(false);
    expect(isRepositionToolArgs(undefined)).toBe(false);
  });
});
