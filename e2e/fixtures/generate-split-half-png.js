/**
 * Regenerates `split-half-red-blue.png`, the committed fixture that
 * `e2e/file-roundtrip.spec.ts` opens.
 *
 * Run from the repository root:
 *
 *   node e2e/fixtures/generate-split-half-png.js
 *
 * Nothing is downloaded: the pixels are written here and encoded locally with
 * `sharp`, which the e2e helpers already depend on. The output is a 64x64 RGBA
 * image with two solid halves and no anti-aliased edge, so a spec can name
 * exact RGB values instead of sampling a colour and hoping:
 *
 *   x in [ 0, 31]  ->  r=255 g=  0 b=  0  (#ff0000)
 *   x in [32, 63]  ->  r=  0 g=  0 b=255  (#0000ff)
 *   every pixel    ->  a=255
 *
 * `png({ compressionLevel: 9, palette: false })` keeps the encoder from writing
 * a palettised or otherwise colour-managed variant: the bytes stay the same on
 * every run, which is what lets the spec assert equality rather than a range.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const FIXTURE_SIZE = 64;
export const FIXTURE_LEFT_RGB = { r: 255, g: 0, b: 0 };
export const FIXTURE_RIGHT_RGB = { r: 0, g: 0, b: 255 };

/** Half-open split: columns below this index are red, from it onwards are blue. */
export const FIXTURE_SPLIT_X = FIXTURE_SIZE / 2;

export const FIXTURE_FILE = 'split-half-red-blue.png';

/**
 * The exact RGBA bytes the encoder receives: `FIXTURE_SIZE * FIXTURE_SIZE`
 * pixels, 4 channels each, filled left to right in raster order.
 */
export function buildFixturePixels(size = FIXTURE_SIZE) {
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const { r, g, b } = x < size / 2 ? FIXTURE_LEFT_RGB : FIXTURE_RIGHT_RGB;
      const offset = (y * size + x) * 4;
      pixels[offset] = r;
      pixels[offset + 1] = g;
      pixels[offset + 2] = b;
      pixels[offset + 3] = 255;
    }
  }
  return pixels;
}

export async function renderFixture(size = FIXTURE_SIZE) {
  return sharp(buildFixturePixels(size), {
    raw: { width: size, height: size, channels: 4 },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

// Only write when executed directly, so importing the builders above is free.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = path.join(path.dirname(fileURLToPath(import.meta.url)), FIXTURE_FILE);
  const buffer = await renderFixture();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(target, buffer);
  process.stdout.write(`wrote ${target} (${buffer.byteLength} bytes, ${FIXTURE_SIZE}x${FIXTURE_SIZE} RGBA)\n`);
}
