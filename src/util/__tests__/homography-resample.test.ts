import { describe, expect, it } from 'vitest';

import type { Point } from '../../contexts/general-types.ts';
import { invertHomography, solveHomography, type Homography } from '../homography.ts';
import {
  MAX_HOMOGRAPHY_SUBSAMPLES,
  resampleThroughHomography,
  resampleThroughHomographyRowByRow,
  type RasterRowTarget,
} from '../homography-resample.ts';

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

type Recording = { stripHeights: number[] };

function resample(source: ImageData, width: number, height: number, inverse: Homography): ImageData {
  const destination = makeImage(width, height, () => undefined);
  resampleThroughHomography(source, destination, inverse);
  return destination;
}

function resampleRowByRow(
  source: ImageData,
  width: number,
  height: number,
  inverse: Homography,
  recording?: Recording
): ImageData {
  const destination = makeImage(width, height, () => undefined);
  const target: RasterRowTarget = {
    createImageData: (targetWidth, targetHeight) => {
      recording?.stripHeights.push(targetHeight);
      return makeImage(targetWidth, targetHeight, () => undefined);
    },
    putImageData: (strip, x, y) => {
      const length = Math.min(strip.width, width - x) * 4;
      destination.data.set(strip.data.subarray(0, length), (y * width + x) * 4);
    },
  };
  resampleThroughHomographyRowByRow(source, target, width, height, inverse);
  return destination;
}

describe('resampleThroughHomography', () => {
  it('copies an identity map through unchanged', () => {
    const source = makeImage(2, 2, (data, offset, pixel) => {
      data[offset] = pixel * 8;
      data[offset + 1] = 255 - pixel * 8;
      data[offset + 2] = (pixel * 16) % 256;
      data[offset + 3] = 255;
    });

    const destination = resample(source, 2, 2, inverseOf(scaleHomography(1, 1)));

    expect(Array.from(destination.data)).toEqual(Array.from(source.data));
  });

  it('stays correct for a map that is only written small, which a homography may legally be', () => {
    const source = makeImage(2, 2, (data, offset, pixel) => {
      data[offset] = pixel * 8;
      data[offset + 1] = 255 - pixel * 8;
      data[offset + 2] = (pixel * 16) % 256;
      data[offset + 3] = 255;
    });
    const tinyIdentity: Homography = { a: 1e-13, b: 0, c: 0, d: 0, e: 1e-13, f: 0, g: 0, h: 0, i: 1e-13 };

    const destination = resample(source, 2, 2, tinyIdentity);

    expect(Array.from(destination.data)).toEqual(Array.from(source.data));
  });

  it('leaves a destination pixel transparent when its source footprint falls outside the source rect', () => {
    const source = solidImage(2, 2, [255, 0, 0, 255]);

    const destination = resample(source, 4, 4, inverseOf(scaleHomography(1, 1)));

    expect(pixelAt(destination, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(destination, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('averages a minified footprint with a single Jacobian-scaled filter', () => {
    const source = solidImage(2, 2, [0, 128, 255, 255]);

    const destination = resample(source, 1, 1, inverseOf(scaleHomography(0.5, 0.5)));

    expect(pixelAt(destination, 0, 0)).toEqual([0, 128, 255, 255]);
  });

  it('antialiases a sheared edge into partial coverage', () => {
    const source = solidImage(2, 2, [255, 255, 255, 255]);
    const shear: Homography = { a: 1, b: 0.5, c: 0, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

    const destination = resample(source, 3, 2, inverseOf(shear));

    const covered = pixelAt(destination, 0, 0)[3];
    expect(covered).toBe(Math.round((3 / 4) * 255));
    expect(pixelAt(destination, 1, 0)[3]).toBe(255);
    expect(pixelAt(destination, 0, 0)).toEqual([255, 255, 255, covered]);
  });

  it('unpremultiplies colour accumulated from partially transparent texels', () => {
    const source = solidImage(1, 1, [200, 100, 50, 128]);

    const destination = resample(source, 1, 1, inverseOf(scaleHomography(1, 1)));

    expect(pixelAt(destination, 0, 0)).toEqual([200, 100, 50, 128]);
  });

  it('clamps a sub-half-texel sample to the edge texel instead of extrapolating a negative weight', () => {
    const source = makeImage(2, 1, (data, offset, pixel) => {
      const colour = pixel === 0 ? [0, 0, 0, 20] : [255, 0, 0, 255];
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = colour[channel];
    });

    const destination = resample(source, 1, 1, scaleHomography(0.2, 1));

    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 0, 20]);
  });

  it('clamps a sub-half-texel sample to the last texel on the trailing edge', () => {
    const source = makeImage(2, 1, (data, offset, pixel) => {
      const colour = pixel === 0 ? [255, 0, 0, 255] : [0, 255, 0, 20];
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = colour[channel];
    });
    const trailingOffset: Homography = { a: 0.2, b: 0, c: 1.9, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

    const destination = resample(source, 1, 1, trailingOffset);

    expect(pixelAt(destination, 0, 0)).toEqual([0, 255, 0, 20]);
  });

  it('reports the edge coverage a high-contrast border really has', () => {
    const source = makeImage(2, 1, (data, offset, pixel) => {
      const colour = pixel === 0 ? [255, 0, 0, 255] : [0, 0, 255, 0];
      for (let channel = 0; channel < 4; channel++) data[offset + channel] = colour[channel];
    });
    const minifyingOffset: Homography = { a: 1.2, b: 0, c: -0.55, d: 0, e: 1, f: 0, g: 0, h: 0, i: 1 };

    const destination = resample(source, 1, 1, minifyingOffset);

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

    const destination = resample(source, 4, 4, inverseOf(scaleHomography(1, 1)));

    expect(Array.from(destination.data)).toEqual(Array.from(source.data));
    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 30, 255]);
    expect(pixelAt(destination, 1, 0)).toEqual([60, 0, 30, 128]);
    expect(pixelAt(destination, 3, 3)).toEqual([180, 180, 30, 255]);
  });

  it('integrates a minification through several samples per axis rather than one fetch', () => {
    const source = makeImage(8, 8, (data, offset, pixel) => {
      const lit = ((pixel % 8) + Math.floor(pixel / 8)) % 2 === 0;
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = lit ? 255 : 0;
      data[offset + 3] = 255;
    });

    const destination = resample(source, 2, 2, inverseOf(scaleHomography(0.25, 0.25)));

    expect(pixelAt(destination, 0, 0)).toEqual([128, 128, 128, 255]);
    expect(pixelAt(destination, 1, 1)).toEqual([128, 128, 128, 255]);
  });

  it('keeps the subsample count bounded under extreme minification', () => {
    const source = solidImage(512, 512, [0, 0, 0, 0]);

    const destination = resample(source, 2, 2, inverseOf(scaleHomography(0.001, 0.001)));

    expect(pixelAt(destination, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(MAX_HOMOGRAPHY_SUBSAMPLES).toBeGreaterThanOrEqual(1);
    expect(MAX_HOMOGRAPHY_SUBSAMPLES).toBeLessThanOrEqual(8);
  });

  it('ignores degenerate source and destination dimensions', () => {
    const identity = inverseOf(scaleHomography(1, 1));

    expect(() =>
      resample(
        makeImage(0, 0, () => undefined),
        2,
        2,
        identity
      )
    ).not.toThrow();
    expect(() => resample(solidImage(1, 1, [1, 2, 3, 4]), 0, 2, identity)).not.toThrow();
    expect(() => resample(solidImage(1, 1, [1, 2, 3, 4]), 2, 0, identity)).not.toThrow();
  });

  it('fills a trapezoid quad and leaves the corners outside that quad transparent', () => {
    const width = 64;
    const height = 32;
    const source = solidImage(width, height, [10, 20, 30, 255]);
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

    const destination = resample(source, width, height, inverseOf(forward));

    const middle = Math.floor(width / 2);
    expect(pixelAt(destination, 0, 0)[3]).toBe(Math.round((3 / 4) * 255));
    expect(pixelAt(destination, middle, 0)).toEqual([10, 20, 30, 255]);
    expect(pixelAt(destination, 0, height - 1)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(destination, width - 1, height - 1)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(destination, middle, height - 1)).toEqual([10, 20, 30, 255]);
  });
});

describe('resampleThroughHomographyRowByRow', () => {
  it('resamples the same pixels as the pure function it shares a kernel with, so the horizon guard can stay hoisted out of the subsample loop where a call per subsample costs about half the throughput', () => {
    const source = makeImage(6, 5, (data, offset, pixel) => {
      data[offset] = pixel * 7;
      data[offset + 1] = (pixel * 13) % 256;
      data[offset + 2] = 90;
      data[offset + 3] = pixel % 3 === 0 ? 255 : 128;
    });
    const inverse = inverseOf(scaleHomography(1.5, 1.5));

    const pure = resample(source, 6, 5, inverse);
    const strip = resampleRowByRow(source, 6, 5, inverse);

    expect(Array.from(strip.data)).toEqual(Array.from(pure.data));
  });

  it('reuses one single-row strip instead of allocating a full-height destination', () => {
    const source = solidImage(4, 4, [10, 20, 30, 255]);
    const recording: Recording = { stripHeights: [] };

    resampleRowByRow(source, 4, 8, inverseOf(scaleHomography(1, 1)), recording);

    expect(recording.stripHeights).toEqual([1]);
  });

  it('ignores degenerate source and destination dimensions without allocating', () => {
    const identity = inverseOf(scaleHomography(1, 1));
    const recording: Recording = { stripHeights: [] };

    expect(() =>
      resampleRowByRow(
        makeImage(0, 0, () => undefined),
        2,
        2,
        identity,
        recording
      )
    ).not.toThrow();
    expect(() => resampleRowByRow(solidImage(1, 1, [1, 2, 3, 4]), 0, 2, identity, recording)).not.toThrow();
    expect(() => resampleRowByRow(solidImage(1, 1, [1, 2, 3, 4]), 2, 0, identity, recording)).not.toThrow();

    expect(recording.stripHeights).toEqual([]);
  });
});
