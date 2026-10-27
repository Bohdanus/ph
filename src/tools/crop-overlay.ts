import type { Pos, Size } from '../contexts/general-types.ts';
import type { CropOverlayOrientation, CropOverlayType } from './crop.ts';

export type CropOverlayGeometry = Readonly<{ path: string; transform?: string }>;

/** SVG geometry for crop guides, in crop-local pixels, so unrotated guides can stay vector sharp. */
export function getCropOverlayGeometry(
  width: number,
  height: number,
  overlayType: CropOverlayType,
  orientation: CropOverlayOrientation = 'normal',
  gridDivisions = 10
): CropOverlayGeometry {
  const vertical = (ratio: number) => width * ratio;
  const horizontal = (ratio: number) => height * ratio;
  const lines: string[] = [];
  const addLine = (x1: number, y1: number, x2: number, y2: number) => {
    lines.push(`M ${x1} ${y1} L ${x2} ${y2}`);
  };

  switch (overlayType) {
    case 'ruleOfThirds':
      addLine(vertical(1 / 3), 0, vertical(1 / 3), height);
      addLine(vertical(2 / 3), 0, vertical(2 / 3), height);
      addLine(0, horizontal(1 / 3), width, horizontal(1 / 3));
      addLine(0, horizontal(2 / 3), width, horizontal(2 / 3));
      break;
    case 'grid': {
      const divisions = Math.max(2, Math.min(100, gridDivisions));
      for (let index = 1; index < divisions; index += 1) {
        const ratio = index / divisions;
        addLine(vertical(ratio), 0, vertical(ratio), height);
        addLine(0, horizontal(ratio), width, horizontal(ratio));
      }
      break;
    }
    case 'diagonal':
      addLine(0, 0, width, height);
      addLine(width, 0, 0, height);
      break;
    case 'triangle': {
      const currentOrientation =
        (typeof orientation === 'number' ? orientation : orientation === 'flipped' ? 1 : 0) % 4;
      const flip = currentOrientation === 1 || currentOrientation === 3;
      const diagonalStart = flip ? { x: width, y: 0 } : { x: 0, y: 0 };
      const diagonalEnd = flip ? { x: 0, y: height } : { x: width, y: height };
      const anchor = flip ? { x: width * 0.382, y: height * 0.618 } : { x: width * 0.618, y: height * 0.618 };
      if (currentOrientation >= 2) {
        anchor.x = width - anchor.x;
        anchor.y = height - anchor.y;
      }
      addLine(diagonalStart.x, diagonalStart.y, diagonalEnd.x, diagonalEnd.y);
      addLine(flip ? 0 : width, 0, anchor.x, anchor.y);
      addLine(flip ? width : 0, height, anchor.x, anchor.y);
      break;
    }
    case 'goldenRatio':
      addLine(vertical(0.382), 0, vertical(0.382), height);
      addLine(vertical(0.618), 0, vertical(0.618), height);
      addLine(0, horizontal(0.382), width, horizontal(0.382));
      addLine(0, horizontal(0.618), width, horizontal(0.618));
      break;
    case 'goldenSpiral': {
      const currentOrientation =
        (typeof orientation === 'number' ? orientation : orientation === 'flipped' ? 4 : 0) % 8;
      const flip = currentOrientation >= 4;
      const rotation = (currentOrientation % 4) * 90;
      const radius = Math.min(width, height) / 2;
      const small = radius * 0.618;
      const smallest = radius * 0.382;
      const centerX = width / 2;
      const centerY = height / 2;
      const path = [
        `M ${centerX + radius} ${centerY}`,
        `A ${radius} ${radius} 0 1 1 ${centerX} ${centerY - radius}`,
        `L ${centerX} ${centerY - small}`,
        `A ${small} ${small} 0 0 1 ${centerX + small} ${centerY}`,
        `L ${centerX + smallest} ${centerY}`,
        `A ${smallest} ${smallest} 0 0 1 ${centerX} ${centerY + smallest}`,
      ].join(' ');
      return {
        path,
        transform: `translate(${centerX} ${centerY}) rotate(${rotation}) ${flip ? 'scale(-1 1) ' : ''}translate(${-centerX} ${-centerY})`,
      };
    }
  }

  return { path: lines.join(' ') };
}

export type CropGuideSample = Readonly<{
  data: Uint8ClampedArray;
  width: number;
  height: number;
}>;

/** Invert five crop-local sample pixels from a small cached canvas snapshot, without per-frame readbacks. */
export function sampleCropGuideColor(sample: CropGuideSample | null, rect: Pos, imageSize: Size): string {
  if (!sample || !sample.width || !sample.height || !imageSize.width || !imageSize.height)
    return 'rgba(255, 255, 255, 0.8)';

  const points = [
    { x: rect.x + rect.width / 3, y: rect.y + rect.height / 3 },
    { x: rect.x + (2 * rect.width) / 3, y: rect.y + rect.height / 3 },
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 3, y: rect.y + (2 * rect.height) / 3 },
    { x: rect.x + (2 * rect.width) / 3, y: rect.y + (2 * rect.height) / 3 },
  ];
  const scaleX = sample.width / imageSize.width;
  const scaleY = sample.height / imageSize.height;
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;

  for (const point of points) {
    const x = Math.round(point.x * scaleX);
    const y = Math.round(point.y * scaleY);
    if (x < 0 || y < 0 || x >= sample.width || y >= sample.height) continue;
    const index = (y * sample.width + x) * 4;
    red += sample.data[index];
    green += sample.data[index + 1];
    blue += sample.data[index + 2];
    count += 1;
  }

  if (!count) return 'rgba(255, 255, 255, 0.8)';
  return `rgba(${255 - Math.round(red / count)}, ${255 - Math.round(green / count)}, ${255 - Math.round(blue / count)}, 0.8)`;
}
