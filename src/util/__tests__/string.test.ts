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

  /**
   * The reported width is `lastIndex - 1`, i.e. the UTF-16 offset of the START of the
   * removed cluster minus one, and on a multi-unit string that offset is not the number of
   * clusters before it. '👍🏽' is 4 code units, so the trailing 'a' starts at index 4 and the
   * report is 3 — a mutant that counted clusters (1), or that reported the string length
   * minus one (4), fails here and passes every ASCII case in this file.
   */
  it('reports a code-unit offset, not a cluster count, for a multi-unit tail', () => {
    const [result, removedWidth] = deleteLastChar('👍🏽a');
    expect(result).toBe('👍🏽');
    expect(removedWidth).toBe(3);
  });

  it('removes a trailing cluster that is itself multi-code-point', () => {
    // Two flags: each is a regional-indicator PAIR, so the clusters are at 0 and 4 and the
    // trailing one is 4 code units wide. A code-unit-wise delete would split the pair.
    const [result, removedWidth] = deleteLastChar('🇺🇸🇦🇪');
    expect(result).toBe('🇺🇸');
    expect(removedWidth).toBe(3);
    expect(charLength(result)).toBe(1);
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

  it('returns the string unchanged when there are no clusters at all', () => {
    // `start` stays -1 because the loop body never runs, which is the same early return the
    // out-of-range case takes — a mutant that initialised `end` to 0 would instead drop the
    // whole string here.
    expect(deleteCharAt('', 0)).toBe('');
    expect(deleteCharAt('', 5)).toBe('');
  });

  it('removes a cluster in the middle of a multi-code-point string without splitting it', () => {
    // 'a' at 0, the flag's regional-indicator pair at 1-2, 'b' at 3. Index 1 must remove
    // exactly the pair, and index 2 must remove the 'b' rather than a half flag.
    expect(deleteCharAt('a🇺🇸b', 1)).toBe('ab');
    expect(deleteCharAt('a🇺🇸b', 0)).toBe('🇺🇸b');
    expect(deleteCharAt('a🇺🇸b', 2)).toBe('a🇺🇸');
  });

  it('deletes the last cluster by reaching past the final segment to the string length', () => {
    // The `end === -1` arm substitutes `str.length`; with a multi-unit final cluster the
    // resulting slice is still the whole tail, so the result is the prefix alone.
    expect(deleteCharAt('a👍🏽', 1)).toBe('a');
    expect(deleteCharAt('a👍🏽', 0)).toBe('👍🏽');
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

  /**
   * `maxLength < 3` is a separate arm that returns the ellipsis itself, clipped to the
   * budget, and NO existing case in this file lands in it — the range loop below only
   * asserts `result.length <= maxLength`, which `'...'` would satisfy at every budget
   * below 3. These are the exact values, which is what pins `'...'.slice(0, n)`: a
   * rewrite that returned `''` below 3, or `'...'`, would satisfy the loop and fail here.
   *
   * At exactly 3 the third arm takes over: the budget is 0, the first cluster's `next` is
   * already past it, so nothing is kept and the result is the bare ellipsis.
   */
  it('returns the ellipsis clipped to a budget too small to hold one', () => {
    expect(ellipsify('hello', 3)).toBe('...');
    expect(ellipsify('hello', 2)).toBe('..');
    expect(ellipsify('hello', 1)).toBe('.');
    expect(ellipsify('hello', 0)).toBe('');
  });

  it('returns the ellipsis clipped to zero for a NEGATIVE budget rather than slicing from the end', () => {
    // `'...'.slice(0, -1)` is `'..'`, so a `Math.max(0, maxLength)` removed from the
    // bound would silently return two dots for a nonsense budget.
    expect(ellipsify('hello', -1)).toBe('');
    expect(ellipsify('hello', -100)).toBe('');
  });

  it('truncates to the budget for a multi-byte string whose length already fits', () => {
    // `str.length` is UTF-16 code units, so a cluster-aware guard would behave
    // differently here: '👍🏽' is 4 code units, so 4 fits and is returned untouched.
    expect(ellipsify('👍🏽', 4)).toBe('👍🏽');
    expect(ellipsify('👍🏽', 3)).toBe('...');
    expect(ellipsify('👍🏽', 2)).toBe('..');
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
