import { describe, expect, it } from 'vitest';
import { isLightColor, normalizeHex } from '../color.ts';

describe('normalizeHex', () => {
  it('expands 3-digit shorthand to its 6-digit form', () => {
    expect(normalizeHex('#fff')).toBe('ffffff');
    expect(normalizeHex('#000')).toBe('000000');
    expect(normalizeHex('#abc')).toBe('aabbcc');
  });

  it('leaves a 6-digit value untouched with or without the leading hash', () => {
    expect(normalizeHex('#ff0000')).toBe('ff0000');
    expect(normalizeHex('ff0000')).toBe('ff0000');
  });

  it('returns an empty string for empty or hash-only input', () => {
    expect(normalizeHex('')).toBe('');
    expect(normalizeHex('#')).toBe('');
  });

  it('expands non-hex segments of length 3 instead of validating them', () => {
    expect(normalizeHex('#ggg')).toBe('gggggg');
    expect(normalizeHex('zzz')).toBe('zzzzzz');
  });

  it('leaves longer invalid strings untouched', () => {
    expect(normalizeHex('#zzzz')).toBe('zzzz');
    expect(normalizeHex('####')).toBe('######');
  });

  it('throws on null and undefined instead of coercing', () => {
    expect(() => normalizeHex(null as unknown as string)).toThrow();
    expect(() => normalizeHex(undefined as unknown as string)).toThrow();
  });
});

describe('isLightColor', () => {
  it('returns true for an empty string', () => {
    expect(isLightColor('')).toBe(true);
  });

  it('returns true for a white-ish color', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(isLightColor('#f0f0f0')).toBe(true);
  });

  it('returns false for a black-ish color', () => {
    expect(isLightColor('#000000')).toBe(false);
    expect(isLightColor('#101010')).toBe(false);
  });

  it('uses relative luminance to classify mid-range colors', () => {
    // Pure green has the highest luminance coefficient (0.587)
    expect(isLightColor('#00ff00')).toBe(true);
    // Pure blue has the lowest luminance coefficient (0.114)
    expect(isLightColor('#0000ff')).toBe(false);
    // Pure red has luminance ~76 (below the 128 threshold)
    expect(isLightColor('#ff0000')).toBe(false);
    // A bright yellow (both R and G high) exceeds the threshold
    expect(isLightColor('#ffff00')).toBe(true);
  });

  it('returns true for a hex color without the leading hash', () => {
    expect(isLightColor('ffffff')).toBe(true);
    expect(isLightColor('000000')).toBe(false);
  });

  it('classifies 3-digit hex as light instead of falling through to NaN luminance', () => {
    expect(isLightColor('#fff')).toBe(true);
    expect(isLightColor('#abc')).toBe(true);
    expect(isLightColor('#000')).toBe(false);
  });

  it('classifies 3-digit hex identically to its 6-digit equivalent', () => {
    expect(isLightColor('#f00')).toBe(isLightColor('#ff0000'));
    expect(isLightColor('#fff')).toBe(isLightColor('#ffffff'));
  });

  it('returns false for invalid hex containing non-hex characters', () => {
    expect(isLightColor('#ggg')).toBe(false);
    expect(isLightColor('#zzz')).toBe(false);
    expect(isLightColor('#zzzz')).toBe(false);
    expect(isLightColor('#')).toBe(false);
    expect(isLightColor('   ')).toBe(false);
    expect(isLightColor('not-a-color')).toBe(false);
  });

  it('returns true for null and undefined through the falsy guard', () => {
    expect(isLightColor(null as unknown as string)).toBe(true);
    expect(isLightColor(undefined as unknown as string)).toBe(true);
  });
});

describe('tripwires: invalid input is not yet rejected', () => {
  it.fails('throws when given a hex with non-hex characters (isLightColor)', () => {
    expect(() => isLightColor('#ggg')).toThrow();
  });

  it.fails('throws when given a hex with non-hex characters (normalizeHex)', () => {
    expect(() => normalizeHex('#zzz')).toThrow();
  });

  it.fails('throws when given a non-hex word (isLightColor)', () => {
    expect(() => isLightColor('not-a-color')).toThrow();
  });
});
