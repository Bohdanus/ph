import { describe, expect, it } from 'vitest';
import { charLength, deleteLastChar, deleteCharAt, ellipsify } from '../string.ts';

/**
 * `String.prototype.isWellFormed` is ES2024 and this project compiles against the ES2022
 * lib, so the pairing check is spelled out. A well-formed surrogate pair is two code
 * units in the D800-DFFF range, so counting those units proves nothing on its own.
 */
const hasUnpairedSurrogate = (str: string): boolean => {
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0xd800 || code > 0xdfff) continue;
    if (code >= 0xdc00) return true;
    const next = str.charCodeAt(i + 1);
    if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
    i++;
  }
  return false;
};

describe('charLength', () => {
  it('returns the grapheme cluster count for ASCII text', () => {
    expect(charLength('hello')).toBe(5);
  });

  it('returns 0 for an empty string', () => {
    expect(charLength('')).toBe(0);
  });

  it('counts grapheme clusters instead of UTF-16 code units', () => {
    // Family emoji is a single grapheme cluster but multiple code points
    expect(charLength('👨‍👩‍👧‍👦')).toBe(1);
    // Combined flag emoji is a single grapheme cluster
    expect(charLength('🇺🇸')).toBe(1);
    expect(charLength('🇺🇸🇦🇪')).toBe(2);
  });
});

describe('deleteLastChar', () => {
  it('removes the last grapheme cluster and reports its starting index', () => {
    const [result, removedWidth] = deleteLastChar('hello');
    expect(result).toBe('hell');
    expect(removedWidth).toBe(3);
  });

  it('removes only one grapheme cluster even for multi-code-point characters', () => {
    const [result, removedWidth] = deleteLastChar('👨‍👩‍👧‍👦');
    expect(result).toBe('');
    expect(removedWidth).toBe(-1);
  });

  it('leaves the string unchanged when there is nothing to delete', () => {
    const [result, removedWidth] = deleteLastChar('');
    expect(result).toBe('');
    expect(removedWidth).toBe(-1);
  });
});

describe('deleteCharAt', () => {
  it('removes the grapheme cluster at the given index', () => {
    expect(deleteCharAt('hello', 1)).toBe('hllo');
  });

  it('removes the first grapheme cluster when index is 0', () => {
    expect(deleteCharAt('hello', 0)).toBe('ello');
  });

  it('removes the last grapheme cluster when index is the last', () => {
    expect(deleteCharAt('hello', 4)).toBe('hell');
  });

  it('removes a multi-code-point grapheme cluster correctly', () => {
    // 👨‍👩‍👧‍👦 is at index 0, a is at index 1
    expect(deleteCharAt('👨‍👩‍👧‍👨a', 0)).toBe('a');
  });

  it('returns the string unchanged when the index is out of range', () => {
    expect(deleteCharAt('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when the index is negative', () => {
    expect(deleteCharAt('hello', -1)).toBe('hello');
  });
});

describe('ellipsify', () => {
  it('returns the string unchanged when it fits within maxLength', () => {
    expect(ellipsify('hello', 10)).toBe('hello');
  });

  it('returns the string unchanged when it exactly fits', () => {
    expect(ellipsify('hello', 5)).toBe('hello');
  });

  it('truncates and appends an ellipsis when too long', () => {
    expect(ellipsify('hello world', 8)).toBe('hello...');
  });

  it('uses default maxLength of 20', () => {
    const long = 'a'.repeat(25);
    const result = ellipsify(long);
    expect(result).toHaveLength(20);
    expect(result.endsWith('...')).toBe(true);
  });

  it('uses default empty string when none is provided', () => {
    expect(ellipsify(undefined, 10)).toBe('');
  });

  it('truncates an emoji-only string without leaving a lone surrogate', () => {
    // A 👍🏽 cluster is 4 code units, so a 5-unit budget ends mid-surrogate
    const result = ellipsify('👍🏽👍🏽👍🏽👍🏽', 8);
    expect(result).toBe('👍🏽...');
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('truncates a mixed emoji and ASCII string without leaving a lone surrogate', () => {
    const result = ellipsify('layer 👍🏽 name', 10);
    expect(result).toBe('layer ...');
    expect(result.length).toBeLessThanOrEqual(10);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('keeps the cluster that ends exactly on the budget boundary', () => {
    const result = ellipsify('👍🏽👍🏽👍🏽', 7);
    expect(result).toBe('👍🏽...');
    expect(result).toHaveLength(7);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('never exceeds maxLength for a range of budgets and emoji inputs', () => {
    const inputs = ['👍🏽👍🏽👍🏽👍🏽', 'layer 👍🏽 name', 'ab👨‍👩‍👧‍👦cd', '👍👍👍👍', 'hello world'];

    for (const input of inputs) {
      for (let maxLength = 0; maxLength <= 12; maxLength++) {
        const result = ellipsify(input, maxLength);
        expect(result.length).toBeLessThanOrEqual(Math.max(maxLength, 0));
        expect(hasUnpairedSurrogate(result)).toBe(false);
      }
    }
  });
});
