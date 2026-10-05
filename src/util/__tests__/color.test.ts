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

  /**
   * Only a length of exactly 3 is expanded; every other length passes through stripped.
   *
   * The mutants these kill are the two obvious rewrites: `digits.length < 4` (which would
   * expand a 1- or 2-digit value into a doubled string) and `digits.length !== 6` (which
   * would refuse the pass-through case the function exists for).
   */
  it('expands only a 3-digit remainder and passes every other length through', () => {
    expect(normalizeHex('')).toBe('');
    expect(normalizeHex('#f')).toBe('f');
    expect(normalizeHex('#ff')).toBe('ff');
    expect(normalizeHex('#ffff')).toBe('ffff');
    expect(normalizeHex('#fffff')).toBe('fffff');
    expect(normalizeHex('#ffffffff')).toBe('ffffffff');
  });

  /**
   * `hex.replace('#', '')` removes the FIRST '#' anywhere in the string, not a leading one.
   *
   * This pins the actual call rather than the intent: if prod re-anchored it to
   * `replace(/^#/, '')` then `'a#fff'` would keep its hash, and every consumer here
   * (`isLightColor`, `hexToRgb`) would parse a leading `#` as NaN instead of silently
   * reading the same three digits.
   */
  it('strips the first hash wherever it sits, not only at position 0', () => {
    expect(normalizeHex('a#fff')).toBe('afff');
    expect(normalizeHex('#a#fff')).toBe('a#fff');
    expect(normalizeHex('##fff')).toBe('#fff');
  });

  it('expands a 3-digit remainder that had no leading hash at all', () => {
    expect(normalizeHex('fff')).toBe('ffffff');
    expect(normalizeHex('abc')).toBe('aabbcc');
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

  /**
   * The `luminance > 128` threshold, at the threshold.
   *
   * A neutral grey has luminance exactly equal to its own value, because the three
   * coefficients sum to 1, so `#7f7f7f` / `#808080` / `#818181` are the whole decision
   * boundary and nothing else in this file comes near it. `#808080` computes to
   * 127.99999999999999, which is why it is DARK: the comparison is strict, and flipping
   * it to `>=` would make mid-grey light. Both neighbouring greys are pinned so a
   * threshold moved to 127 or 129 fails too.
   */
  it('is dark at luminance 128 and light one step either side', () => {
    expect(isLightColor('#808080')).toBe(false);
    expect(isLightColor('#818181')).toBe(true);
    expect(isLightColor('#7f7f7f')).toBe(false);
  });

  /**
   * A channel that contributes to luminance but not enough on its own.
   *
   * Blue's coefficient (0.114) is the smallest of the three, so pure blue has luminance
   * 28.6 and is dark even though `255` is the maximum channel value. This is the case a
   * "is any channel bright" rewrite would get backwards, and it is not covered by the
   * pure-red case above, which is dark for the opposite reason.
   */
  it('reads luminance from all three channels rather than the brightest one', () => {
    // Luminance 0.114 * 255 = 29.07: dark despite one channel at maximum.
    expect(isLightColor('#0000ff')).toBe(false);
    // Luminance 0.299 * 255 = 76.245: still dark at red maximum.
    expect(isLightColor('#ff0000')).toBe(false);
    // Luminance 0.587 * 255 = 149.685: light, the only pure channel above the threshold.
    expect(isLightColor('#00ff00')).toBe(true);
  });

  /**
   * There is no validation in `isLightColor`: a value that is not hex parses to `NaN`
   * channels, and every comparison against `NaN` is false, so the result is DARK.
   *
   * This pins the absence of a guard rather than endorsing it. The mutant is the reverse
   * direction and is the one that matters: if a guard were added that returned `true` for
   * an unparseable colour (the "assume the background is light" reading of the empty-string
   * arm at line 11), this fails. A tool passing a `rgba()` string would then paint light
   * chrome instead of dark.
   */
  it('treats an unparseable colour as dark, because NaN luminance compares false', () => {
    expect(isLightColor('rgb(0, 0, 0)')).toBe(false);
    expect(isLightColor('transparent')).toBe(false);
    expect(isLightColor('#zzzzzz')).toBe(false);
    // A 5-digit remainder is not expanded, so its channels misalign and it reads as a
    // near-white colour rather than as a malformed one.
    expect(isLightColor('#fffff')).toBe(true);
    // A 4-digit remainder runs out of digits for blue, so blue is NaN and the whole
    // comparison collapses to dark.
    expect(isLightColor('#ffff')).toBe(false);
  });
});
