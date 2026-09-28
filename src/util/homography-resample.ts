import { differentiateHomography, projectiveRowScale, type Homography } from './homography.ts';

export const MAX_HOMOGRAPHY_SUBSAMPLES = 4;

export type RasterRowTarget = {
  createImageData: (width: number, height: number) => ImageData;
  putImageData: (imageData: ImageData, x: number, y: number) => void;
};

function clampToTexelCenters(coordinate: number, extent: number): number {
  return Math.min(Math.max(coordinate, 0.5), extent - 0.5);
}

function clearPixel(target: Uint8ClampedArray, offset: number): void {
  target[offset] = 0;
  target[offset + 1] = 0;
  target[offset + 2] = 0;
  target[offset + 3] = 0;
}

function resampleRow(
  source: ImageData,
  destination: ImageData,
  writeRow: number,
  sampleRow: number,
  inverse: Homography
): void {
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const targetWidth = destination.width;
  const sourceData = source.data;
  const targetData = destination.data;
  const lastSourceX = sourceWidth - 1;
  const lastSourceY = sourceHeight - 1;
  const rowScale = projectiveRowScale(inverse);

  for (let x = 0; x < targetWidth; x++) {
    const offset = (writeRow * targetWidth + x) * 4;
    const center = differentiateHomography(inverse, { x: x + 0.5, y: sampleRow + 0.5 });
    if (!center) {
      clearPixel(targetData, offset);
      continue;
    }

    const footprint = Math.max(
      Math.abs(center.duDx) + Math.abs(center.duDy),
      Math.abs(center.dvDx) + Math.abs(center.dvDy)
    );
    const subsamples = Math.min(MAX_HOMOGRAPHY_SUBSAMPLES, Math.max(1, Math.ceil(footprint)));
    const sampleCount = subsamples * subsamples;

    let alpha = 0;
    let red = 0;
    let green = 0;
    let blue = 0;

    for (let subY = 0; subY < subsamples; subY++) {
      const sampleRowY = sampleRow + (subY + 0.5) / subsamples;
      for (let subX = 0; subX < subsamples; subX++) {
        const sampleX = x + (subX + 0.5) / subsamples;
        const denominator = inverse.g * sampleX + inverse.h * sampleRowY + inverse.i;
        if (!(Math.abs(denominator) > rowScale * Math.max(1, sampleX, sampleRowY))) continue;
        const u = (inverse.a * sampleX + inverse.b * sampleRowY + inverse.c) / denominator;
        const v = (inverse.d * sampleX + inverse.e * sampleRowY + inverse.f) / denominator;
        if (!(u >= 0 && u <= sourceWidth && v >= 0 && v <= sourceHeight)) continue;

        const clampedU = clampToTexelCenters(u, sourceWidth);
        const clampedV = clampToTexelCenters(v, sourceHeight);
        const left = Math.min(Math.floor(clampedU - 0.5), lastSourceX);
        const top = Math.min(Math.floor(clampedV - 0.5), lastSourceY);
        const right = Math.min(left + 1, lastSourceX);
        const bottom = Math.min(top + 1, lastSourceY);
        const weightRight = clampedU - 0.5 - left;
        const weightBottom = clampedV - 0.5 - top;
        const weightLeft = 1 - weightRight;
        const weightTop = 1 - weightBottom;
        const topLeft = (top * sourceWidth + left) * 4;
        const topRight = (top * sourceWidth + right) * 4;
        const bottomLeft = (bottom * sourceWidth + left) * 4;
        const bottomRight = (bottom * sourceWidth + right) * 4;
        const cornerTopLeft = weightLeft * weightTop;
        const cornerTopRight = weightRight * weightTop;
        const cornerBottomLeft = weightLeft * weightBottom;
        const cornerBottomRight = weightRight * weightBottom;

        const premultipliedTopLeft = sourceData[topLeft + 3] * cornerTopLeft;
        const premultipliedTopRight = sourceData[topRight + 3] * cornerTopRight;
        const premultipliedBottomLeft = sourceData[bottomLeft + 3] * cornerBottomLeft;
        const premultipliedBottomRight = sourceData[bottomRight + 3] * cornerBottomRight;

        alpha += premultipliedTopLeft + premultipliedTopRight + premultipliedBottomLeft + premultipliedBottomRight;
        red +=
          sourceData[topLeft] * premultipliedTopLeft +
          sourceData[topRight] * premultipliedTopRight +
          sourceData[bottomLeft] * premultipliedBottomLeft +
          sourceData[bottomRight] * premultipliedBottomRight;
        green +=
          sourceData[topLeft + 1] * premultipliedTopLeft +
          sourceData[topRight + 1] * premultipliedTopRight +
          sourceData[bottomLeft + 1] * premultipliedBottomLeft +
          sourceData[bottomRight + 1] * premultipliedBottomRight;
        blue +=
          sourceData[topLeft + 2] * premultipliedTopLeft +
          sourceData[topRight + 2] * premultipliedTopRight +
          sourceData[bottomLeft + 2] * premultipliedBottomLeft +
          sourceData[bottomRight + 2] * premultipliedBottomRight;
      }
    }

    if (alpha <= 0) {
      clearPixel(targetData, offset);
      continue;
    }

    targetData[offset] = red / alpha;
    targetData[offset + 1] = green / alpha;
    targetData[offset + 2] = blue / alpha;
    targetData[offset + 3] = alpha / sampleCount;
  }
}

export function resampleThroughHomography(source: ImageData, destination: ImageData, inverse: Homography): void {
  if (source.width < 1 || source.height < 1) return;
  if (destination.width < 1 || destination.height < 1) return;
  for (let row = 0; row < destination.height; row++) resampleRow(source, destination, row, row, inverse);
}

export function resampleThroughHomographyRowByRow(
  source: ImageData,
  target: RasterRowTarget,
  width: number,
  height: number,
  inverse: Homography
): void {
  if (source.width < 1 || source.height < 1 || width < 1 || height < 1) return;
  const strip = target.createImageData(width, 1);
  for (let row = 0; row < height; row++) {
    resampleRow(source, strip, 0, row, inverse);
    target.putImageData(strip, 0, row);
  }
}
