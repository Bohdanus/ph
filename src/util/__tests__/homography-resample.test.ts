import { describe, expect, it } from 'vitest';

import type { Point } from '../../contexts/general-types.ts';
import { invertHomography, solveHomography, type Homography } from '../homography.ts';
import { MAX_HOMOGRAPHY_SUBSAMPLES, resampleThroughHomography } from '../homography-resample.ts';

function makeImage(
  width: number,
  height: number,
  fill: (data: Uint8ClampedArray, offset: number, pixel: number) => void
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) fill(data, pixel * 4, pixel);
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function solidImage(width: number, height: number, color: [number, number, number, number]): ImageData {
  return makeImage(width, height, (data, offset) => {
    for (let channel = 0; channel < 4; channel++) data[offset + channel] = color[channel];
  });
}

function scaleHomography(scaleX: number, scaleY: number): Homography {
  return { a: scaleX, b: 0, c: 0, d: 0, e: scaleY, f: 0, g: 0, h: 0, i: 1 };
}

function inverseOf(matrix: Homography): Homography {
  const inverse = invertHomography(matrix);
  if (!inverse) throw new Error('matrix is not invertible');
  return inverse;
}

function pixelAt(image: ImageData, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [image.data[offset], image.data[offset + 1], image.data[offset + 2], image.data[offset + 3]];
}

describe('resampleThroughHomography', () => {
  it('copies an identity map through unchanged', () => {
    const source = makeImage(2, 2, (data, offset, pixel) => {
      data[offset] = pixel * 8;
      data[offset + 1] = 255 - pixel * 8;
      data[offset + 2] = (pixel * 16) % 256;
      data[offset + 3] = 255;
    });
    const destination = makeImage(2, 2, () => undefined);

    resampleThroughHomography(source, destination, inverseOf(scaleHomography(1, 1)));

    expect(Array.from(destination.data)).toEqual(Array.from(source.data));
  });

  it('leaves a destination pixel transparent when its source footprint falls outside the source rect', () => {
    const source = solidImage(2, 2, [255, 0, 0, 255]);
    const destination = makeImage(4, 4, () => undefined);

    resampleThroughHomography(source, destination, inverseOf(scaleHomography(1, 1)));

    expect(pixelAt(destination, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(destination, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('averages a minified footprint with a single Jacobian-scaled filter', () => {
    const source = solidImage(2, 2, [0, 128, 255, 255]);
    const destination = makeImage(1, 1, () => undefined);

    resampleThroughHomography(source, destination, inverseOf(scaleHomography(0.5, 0.5)));

    expect(pixelAt(destination, 0, 0)).toEqual([0, 128, 255, 255]);
  });

  it('antialiases a sheared edge into partial coverage', () => {
    const source = solidImage(2, 2, [255, 255, 255, 255]);
    const destination = makeImage(3, 2, () => undefined);
    const shear: Homography = { a: 1, b: 0.5, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

    resampleThroughHomography(source, destination, inverseOf(shear));

    const covered = pixelAt(destination, 0, 0)[3];
    expect(covered).toBe(Math.round((3 / 4) * 255));
    expect(pixelAt(destination, 1, 0)[3]).toBe(255);
    expect(pixelAt(destination, 0, 0)).toEqual([255, 255, 255, covered]);
  });

  it('unpremultiplies colour accumulated from partially transparent texels', () => {
    const source = solidImage(1, 1, [200, 100, 50, 128]);
    const destination = makeImage(1, 1, () => undefined);

    resampleThroughHomography(source, destination, inverseOf(scaleHomography(1, 1)));

    expect(pixelAt(destination, 0, 0)).toEqual([200, 100, 50, 128]);
  });

  it('clamps a sub-half-texel sample to the edge texel instead of extrapolating a negative weight', () => {
    const source = makeImage(2, 1, (data, offset, pixel) => {
      const colour = pixel === 0 ? [0, 0, 0, 20] : [255, 0, 0, 255];
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = colour[channel];
    });
    const destination = makeImage(1, 1, () => undefined);

    resampleThroughHomography(source, destination, scaleHomography(0.2, 1));

    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 0, 20]);
  });

  it('reports the edge coverage a high-contrast border really has', () => {
    const source = makeImage(2, 1, (data, offset, pixel) => {
      const colour = pixel === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0];
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = colour[channel];
    });
    const destination = makeImage(1, 1, () => undefined);
    const minifyingOffset: Homography = { a: 1.2, b: 0, c: -0.55, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

    resampleThroughHomography(source, destination, minifyingOffset);

    expect(pixelAt(destination, 0, 0)).toEqual([255, 0, 0, Math.round((1 / 2) * 255)]);
  });

  it('keeps a structured partially transparent source intact across a warp', () => {
    const source = makeImage(4, 4, (data, offset, pixel) => {
      const column = pixel % 4;
      const row = Math.floor(pixel / 4);
      data[offset] = column * 60;
      data[offset + 1] = row * 60;
      data[offset + 2] = 30;
      data[offset + 3] = column === 0 || column === 3 ? 255 : 128;
    });
    const destination = makeImage(4, 4, () => undefined);

    resampleThroughHomography(source, destination, inverseOf(scaleHomography(1, 1)));

    expect(Array.from(destination.data)).toEqual(Array.from(source.data));
    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 30, 255]);
    expect(pixelAt(destination, 1, 0)).toEqual([60, 0, 30, 128]);
    expect(pixelAt(destination, 3, 3)).toEqual([180, 180, 30, 255]);
  });

  it('keeps the subsample count bounded under extreme minification', () => {
    const source = solidImage(512, 512, [0, 0, 0, 0]);
    const destination = makeImage(2, 2, () => undefined);

    expect(() =>
      resampleThroughHomography(source, destination, inverseOf(scaleHomography(0.001, 0.001)))
    ).not.toThrow();
    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(MAX_HOMOGRAPHY_SUBSAMPLES).toBe(4);
  });

  it('ignores empty source and destination buffers', () => {
    const source = solidImage(1, 1, [1, 2, 3, 4]);
    const destination = makeImage(0, 0, () => undefined);

    expect(() => resampleThroughHomography(source, destination, inverseOf(scaleHomography(1, 1)))).not.toThrow();
  });

  it('fills a trapezoid quad and leaves the corners outside that quad transparent', () => {
    const width = 64;
    const height = 32;
    const source = solidImage(width, height, [10, 20, 30, 255]);
    const destination = makeImage(width, height, () => undefined);
    const corners: Point[] = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
    const quad: Point[] = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width * 0.75, y: height },
      { x: width * 0.25, y: height },
    ];
    const forward = solveHomography(corners, quad);
    if (!forward) throw new Error('quad is not solvable');

    resampleThroughHomography(source, destination, inverseOf(forward));

    const middle = Math.floor(width / 2);
    expect(pixelAt(destination, 0, 0)[3]).toBe(Math.round((3 / 4) * 255));
    expect(pixelAt(destination, middle, 0)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(destination, 0, height - 1)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(destination, width - 1, height - 1)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(destination, middle, height - 1)).toEqual([10, 20, 30, 255]);
  });
});
