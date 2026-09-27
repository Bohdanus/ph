import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JPEG_QUALITY,
  IMAGE_FORMATS,
  PSD_FORMAT,
  resolveImageFormat,
  stripOutputFileExtension,
  withFileExtension,
} from '../imageFormats.ts';

describe('IMAGE_FORMATS', () => {
  it('declares a unique value and extension per entry', () => {
    const values = IMAGE_FORMATS.map((format) => format.value);
    const extensions = IMAGE_FORMATS.map((format) => format.extension);
    expect(new Set(values).size).toBe(values.length);
    expect(new Set(extensions).size).toBe(extensions.length);
  });

  it('declares an image mime type and a non-empty label per entry', () => {
    for (const format of IMAGE_FORMATS) {
      expect(format.mimeType, format.value).toMatch(/^image\//);
      expect(format.label.length, format.value).toBeGreaterThan(0);
    }
  });

  it('marks only the lossy canvas encodings as quality-configurable', () => {
    expect(IMAGE_FORMATS.filter((format) => format.supportsQuality).map((format) => format.value)).toEqual([
      'image/jpeg',
    ]);
  });

  it('round-trips every entry through resolveImageFormat by value and by extension', () => {
    for (const format of IMAGE_FORMATS) {
      expect(resolveImageFormat(format.value)).toBe(format);
      expect(resolveImageFormat(format.extension)).toBe(format);
    }
  });

  it('exposes a PSD pseudo-format that resolveImageFormat does not claim to handle', () => {
    expect(PSD_FORMAT.value).toBe('psd');
    expect(resolveImageFormat(PSD_FORMAT.value)).not.toBe(PSD_FORMAT);
  });
});

describe('DEFAULT_JPEG_QUALITY', () => {
  it('is a valid lossy quality in the 0..1 range', () => {
    expect(DEFAULT_JPEG_QUALITY).toBeGreaterThan(0);
    expect(DEFAULT_JPEG_QUALITY).toBeLessThan(1);
  });
});

describe('resolveImageFormat', () => {
  it('matches an exact mime value', () => {
    expect(resolveImageFormat('image/png')).toBe(IMAGE_FORMATS[0]);
    expect(resolveImageFormat('image/avif')).toBe(IMAGE_FORMATS[6]);
  });

  it('trims and lowercases the input', () => {
    expect(resolveImageFormat('  IMAGE/WEBP  ')).toBe(IMAGE_FORMATS[2]);
  });

  it.each(['jpg', 'image/jpg', 'JPEG'])('resolves the JPEG alias %s', (input) => {
    expect(resolveImageFormat(input)).toBe(IMAGE_FORMATS[1]);
  });

  it.each(['tif', 'image/tif', 'image/x-tiff', 'TIFF'])('resolves the TIFF alias %s', (input) => {
    expect(resolveImageFormat(input)).toBe(IMAGE_FORMATS[3]);
  });

  it.each(['image/x-bmp', 'image/x-ms-bmp', 'BMP'])('resolves the BMP alias %s', (input) => {
    expect(resolveImageFormat(input)).toBe(IMAGE_FORMATS[4]);
  });

  it.each(['image/ico', 'image/vnd.microsoft.icon', 'icon'])('resolves the ICO alias %s', (input) => {
    expect(resolveImageFormat(input)).toBe(IMAGE_FORMATS[7]);
  });

  it('resolves the SVG aliases but not a non-image svg alias', () => {
    expect(resolveImageFormat('image/svg')).toBe(IMAGE_FORMATS[8]);
    expect(resolveImageFormat('svg+xml').encoding).toBe('canvas');
  });

  it('synthesizes a canvas fallback for an unknown mime type', () => {
    expect(resolveImageFormat('image/heic')).toEqual({
      value: 'image/heic',
      label: 'image/heic',
      extension: 'heic',
      mimeType: 'image/heic',
      encoding: 'canvas',
      supportsQuality: false,
    });
  });

  it('derives a mime type from a bare unknown token', () => {
    expect(resolveImageFormat('heif')).toMatchObject({ extension: 'heif', mimeType: 'image/heif' });
  });

  it('strips a leading dot from an unknown extension-like input', () => {
    expect(resolveImageFormat('.heif')).toMatchObject({ extension: 'heif', mimeType: 'image/heif' });
  });

  it('falls back to png for an empty string', () => {
    expect(resolveImageFormat('')).toEqual({
      value: '',
      label: '',
      extension: 'png',
      mimeType: 'image/png',
      encoding: 'canvas',
      supportsQuality: false,
    });
  });

  it('preserves the raw input in value and label for unknown formats', () => {
    const resolved = resolveImageFormat('  MyFormat  ');
    expect(resolved.value).toBe('  MyFormat  ');
    expect(resolved.label).toBe('  MyFormat  ');
    expect(resolved.extension).toBe('myformat');
  });

  it('never marks a synthesized format as quality-configurable', () => {
    expect(resolveImageFormat('image/webp').supportsQuality).toBe(false);
  });
});

describe('stripOutputFileExtension', () => {
  it('removes a known output extension', () => {
    expect(stripOutputFileExtension('photo.png')).toBe('photo');
    expect(stripOutputFileExtension('photo.psd')).toBe('photo');
    expect(stripOutputFileExtension('photo.tiff')).toBe('photo');
  });

  it('is case-insensitive', () => {
    expect(stripOutputFileExtension('photo.PNG')).toBe('photo');
    expect(stripOutputFileExtension('Photo.JpEg')).toBe('Photo');
  });

  it('only removes a trailing extension, not a dotted name', () => {
    expect(stripOutputFileExtension('my.photo.png')).toBe('my.photo');
    expect(stripOutputFileExtension('archive.tar.gz')).toBe('archive.tar.gz');
  });

  it('leaves names without a known extension untouched', () => {
    expect(stripOutputFileExtension('photo')).toBe('photo');
    expect(stripOutputFileExtension('photo.txt')).toBe('photo.txt');
    expect(stripOutputFileExtension('png')).toBe('png');
  });

  it('is idempotent', () => {
    const once = stripOutputFileExtension('photo.png');
    expect(stripOutputFileExtension(once)).toBe(once);
  });
});

describe('withFileExtension', () => {
  it('appends a bare extension', () => {
    expect(withFileExtension('photo', 'png')).toBe('photo.png');
  });

  it('replaces an existing output extension instead of appending a second one', () => {
    expect(withFileExtension('photo.png', 'jpeg')).toBe('photo.jpeg');
    expect(withFileExtension('photo.psd', 'png')).toBe('photo.png');
  });

  it('normalizes a mime-typed or dotted extension', () => {
    expect(withFileExtension('photo', 'image/png')).toBe('photo.png');
    expect(withFileExtension('photo', '.JPEG')).toBe('photo.jpeg');
  });

  it('falls back to a default name for blank input', () => {
    expect(withFileExtension('', 'png')).toBe('image.png');
    expect(withFileExtension('   ', 'png')).toBe('image.png');
  });

  it('composes with stripOutputFileExtension', () => {
    expect(stripOutputFileExtension(withFileExtension('photo.png', 'webp'))).toBe('photo');
  });
});
