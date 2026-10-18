import { describe, expect, it } from 'vitest';
import { charLength, deleteLastChar, deleteCharAt, ellipsify, graphemes } from '../string.ts';

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

  it('counts non-ASCII scripts as individual graphemes', () => {
    expect(charLength('日本語')).toBe(3);
    expect(charLength('안녕하세요')).toBe(5);
    expect(charLength('Γειά')).toBe(4);
  });

  it('counts precomposed and decomposed accented characters as one grapheme', () => {
    expect(charLength('café')).toBe(4);
    expect(charLength('cafe\u0301')).toBe(4);
    expect(charLength('o\u0308')).toBe(1);
    expect(charLength('a\u0300\u0301')).toBe(1);
  });

  it('counts non-printable characters as individual graphemes', () => {
    expect(charLength('\0')).toBe(1);
    expect(charLength('\0\0\0')).toBe(3);
    expect(charLength('\t\n\r')).toBe(3);
    expect(charLength('\x00\x01\x02\x03\x04\x05')).toBe(6);
    expect(charLength('\x1b')).toBe(1);
    expect(charLength('\x7f')).toBe(1);
  });

  it('handles very long ASCII strings', () => {
    const long = 'a'.repeat(100000);
    expect(charLength(long)).toBe(100000);
  });

  it('handles very long emoji strings', () => {
    const emojiLong = '👍'.repeat(1000);
    expect(charLength(emojiLong)).toBe(1000);
  });
});

describe('graphemes', () => {
  it('splits ASCII text into individual characters', () => {
    expect(graphemes('hello')).toEqual(['h', 'e', 'l', 'l', 'o']);
  });

  it('returns an empty array for an empty string', () => {
    expect(graphemes('')).toEqual([]);
  });

  it('keeps combining marks attached to their base character', () => {
    expect(graphemes('e\u0301')).toEqual(['e\u0301']);
    expect(graphemes('cafe\u0301')).toEqual(['c', 'a', 'f', 'e\u0301']);
    expect(graphemes('a\u0300\u0301')).toEqual(['a\u0300\u0301']);
  });

  it('treats multi-code-point emoji as a single cluster', () => {
    expect(graphemes('👨‍👩‍👧‍👦')).toEqual(['👨‍👩‍👧‍👦']);
    expect(graphemes('🇺🇸')).toEqual(['🇺🇸']);
    expect(graphemes('🇺🇸🇦🇦🇨🇦')).toEqual(['🇺🇸', '🇦🇦', '🇨🇦']);
  });

  it('splits CJK characters correctly', () => {
    expect(graphemes('日本語')).toEqual(['日', '本', '語']);
  });

  it('handles non-printable characters', () => {
    expect(graphemes('\0\0\0')).toEqual(['\0', '\0', '\0']);
    expect(graphemes('\t\n\r')).toEqual(['\t', '\n', '\r']);
  });

  it('handles very long strings', () => {
    const long = 'a'.repeat(10000);
    const result = graphemes(long);
    expect(result).toHaveLength(10000);
    expect(result[0]).toBe('a');
    expect(result[result.length - 1]).toBe('a');
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

  it('throws a TypeError when null is passed instead of a string', () => {
    expect(() => deleteLastChar(null as unknown as string)).toThrow(TypeError);
  });

  it('throws a TypeError when undefined is passed instead of a string', () => {
    expect(() => deleteLastChar(undefined as unknown as string)).toThrow(TypeError);
  });

  it('removes a CJK character as the last cluster', () => {
    const [result] = deleteLastChar('hello 世界');
    expect(result).toBe('hello 世');
  });

  it('removes a combining-character cluster as the last cluster', () => {
    const [result] = deleteLastChar('cafe\u0301');
    expect(result).toBe('caf');
  });

  it('removes a non-printable character as the last cluster', () => {
    const [result] = deleteLastChar('hello\0');
    expect(result).toBe('hello');
  });

  it('handles very long strings', () => {
    const long = 'a'.repeat(100000);
    const [result] = deleteLastChar(long);
    expect(result).toHaveLength(99999);
    expect(result).toBe(long.slice(0, -1));
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

  it('throws a TypeError when null is passed instead of a string', () => {
    expect(() => deleteCharAt(null as unknown as string, 0)).toThrow(TypeError);
  });

  it('throws a TypeError when undefined is passed instead of a string', () => {
    expect(() => deleteCharAt(undefined as unknown as string, 0)).toThrow(TypeError);
  });

  it('returns the string unchanged for an empty string', () => {
    expect(deleteCharAt('', 0)).toBe('');
    expect(deleteCharAt('', 5)).toBe('');
  });

  it('removes a middle CJK grapheme cluster', () => {
    expect(deleteCharAt('日本語', 1)).toBe('日語');
  });

  it('removes a combining-character cluster correctly', () => {
    expect(deleteCharAt('cafe\u0301', 3)).toBe('caf');
  });

  it('removes a non-printable character', () => {
    expect(deleteCharAt('\0\0\0', 1)).toBe('\0\0');
    expect(deleteCharAt('\tabc', 0)).toBe('abc');
  });

  it('handles very long strings', () => {
    const long = 'b'.repeat(50000);
    const result = deleteCharAt(long, 25000);
    expect(result).toHaveLength(49999);
    expect(result).toBe(long.slice(0, 25000) + long.slice(25001));
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

  it('returns only the ellipsis when maxLength is exactly 3', () => {
    expect(ellipsify('hello world', 3)).toBe('...');
  });

  it('returns a truncated ellipsis when maxLength is less than 3', () => {
    expect(ellipsify('hello world', 2)).toBe('..');
    expect(ellipsify('hello world', 1)).toBe('.');
  });

  it('returns an empty string when maxLength is 0 or negative', () => {
    expect(ellipsify('hello world', 0)).toBe('');
    expect(ellipsify('hello world', -1)).toBe('');
  });

  it('handles non-printable characters', () => {
    expect(ellipsify('\0\0\0\0\0\0', 4)).toBe('\0...');
    expect(ellipsify('\t\n\r\t\n\r', 4)).toBe('\t...');
  });

  it('preserves CJK text within the budget without splitting clusters', () => {
    const result = ellipsify('日本語はテストです', 6);
    expect(result.length).toBeLessThanOrEqual(6);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('preserves combining-character clusters within the budget', () => {
    const result = ellipsify('café au lait', 7);
    expect(result.length).toBeLessThanOrEqual(7);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('handles very long ASCII strings', () => {
    const long = 'a'.repeat(100000);
    const result = ellipsify(long, 20);
    expect(result).toHaveLength(20);
    expect(result.endsWith('...')).toBe(true);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });

  it('handles very long emoji strings without leaving lone surrogates', () => {
    const long = '👍'.repeat(1000);
    const result = ellipsify(long, 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(hasUnpairedSurrogate(result)).toBe(false);
  });
});

describe('known limitations (it.fails tripwires)', () => {
  it.fails('throws a TypeError for null input on charLength instead of silently coercing to "null"', () => {
    expect(() => charLength(null as unknown as string)).toThrow(TypeError);
  });

  it.fails('throws a TypeError for null input on graphemes instead of silently coercing to "null"', () => {
    expect(() => graphemes(null as unknown as string)).toThrow(TypeError);
  });

  it.fails('returns an empty string for null input on ellipsify instead of throwing', () => {
    expect(ellipsify(null as unknown as string, 10)).toBe('');
  });
});
