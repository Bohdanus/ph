import { expect, type Page, test } from './fixtures/extended-test';
import {
  DEFAULT_DOCUMENT_SIZE,
  documentToCanvasOffset,
  drawLine,
  getWorkspaceCanvas,
  type BoundingBox,
} from './helpers/canvas-helpers';
import { clickToolButton, openToolFlyout, selectFromFlyout } from './helpers/toolbar-helpers';
import { setForegroundColor } from './helpers/color-helpers';
import { PAINT_TOOLS_TEST_TIMEOUT_MS } from './helpers/timeouts';

type Point = { x: number; y: number };
type Pixel = { x: number; y: number; red: number; green: number; blue: number; alpha: number };

const BLACK = '#000000';
const ONE_PIXEL = '1';
const integerLine = { from: { x: 100, y: 120 }, to: { x: 400, y: 120 } };
const halfIntegerLine = { from: { x: 100, y: 160.5 }, to: { x: 400, y: 160.5 } };
const diagonalLine = { from: { x: 150, y: 220 }, to: { x: 350, y: 320 } };

async function canvasBox(page: Page): Promise<BoundingBox> {
  const box = await getWorkspaceCanvas(page).boundingBox();
  if (!box) throw new Error('The workspace canvas has no box');
  return box;
}

async function drawDocumentLine(page: Page, box: BoundingBox, from: Point, to: Point): Promise<void> {
  const start = documentToCanvasOffset(box, from.x, from.y);
  const end = documentToCanvasOffset(box, to.x, to.y);
  await drawLine(page, box, start.x, start.y, end.x, end.y);
}

async function readWorkspaceBlock(page: Page, center: Point): Promise<Pixel[]> {
  // The tests pin a 1x backing store, so these DOCUMENT coordinates are also canvas pixel indices.
  return getWorkspaceCanvas(page).evaluate((canvas, point) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('The workspace locator did not resolve to a canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The workspace canvas has no 2D context');

    const width = 5;
    const left = Math.floor(point.x) - Math.floor(width / 2);
    const top = Math.floor(point.y) - Math.floor(width / 2);
    if (left < 0 || top < 0 || left + width > canvas.width || top + width > canvas.height) {
      throw new Error(`Sample block at ${point.x},${point.y} is outside ${canvas.width}x${canvas.height}`);
    }

    const image = context.getImageData(left, top, width, width);
    const pixels: Pixel[] = [];
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        pixels.push({
          x: left + x,
          y: top + y,
          red: image.data[index]!,
          green: image.data[index + 1]!,
          blue: image.data[index + 2]!,
          alpha: image.data[index + 3]!,
        });
      }
    }
    return pixels;
  }, center);
}

function compositedLuma(pixel: Pixel): number {
  const alpha = pixel.alpha / 255;
  return (0.299 * pixel.red + 0.587 * pixel.green + 0.114 * pixel.blue) * alpha + 255 * (1 - alpha);
}

function describeLumaGrid(pixels: Pixel[]): string {
  const rows = [...new Set(pixels.map((pixel) => pixel.y))].sort((a, b) => a - b);
  return rows
    .map((y) => {
      const row = pixels
        .filter((pixel) => pixel.y === y)
        .map((pixel) => `${pixel.x}:${compositedLuma(pixel).toFixed(1)}`)
        .join(' ');
      return `${y}: ${row}`;
    })
    .join('\n');
}

const hasInk = (pixel: Pixel): boolean => compositedLuma(pixel) < 245;
const hasPartialCoverage = (pixel: Pixel): boolean => {
  const luma = compositedLuma(pixel);
  return luma > 20 && luma < 245;
};
const isWhite = (pixel: Pixel): boolean => compositedLuma(pixel) > 245;

async function drawAndRead(page: Page, from: Point, to: Point, label: string, sample: Point): Promise<Pixel[]> {
  const box = await canvasBox(page);
  const beforePixels = await readWorkspaceBlock(page, sample);
  expect(beforePixels.every(isWhite), `${label} sample region starts clear`).toBe(true);

  const history = page.getByTitle('Click to go back to this state');
  const before = await history.count();
  await drawDocumentLine(page, box, from, to);
  await expect(history, `${label} commits one history entry`).toHaveCount(before + 1);

  let pixels: Pixel[] = [];
  await expect
    .poll(
      async () => {
        pixels = await readWorkspaceBlock(page, sample);
        return pixels.some(hasInk);
      },
      { message: `${label} appears in the workspace backing pixels`, timeout: 10_000 }
    )
    .toBe(true);
  return pixels;
}

function rowsAt(pixels: Pixel[], ...rows: number[]): Pixel[] {
  return pixels.filter((pixel) => rows.includes(pixel.y));
}

function expectIntegerCoverage(pixels: Pixel[], y: number, label: string): void {
  const pathRows = rowsAt(pixels, y - 1, y);
  const outsideRows = pixels.filter((pixel) => pixel.y !== y - 1 && pixel.y !== y);
  expect(pathRows.some(hasInk), `${label} covers a path row`).toBe(true);
  expect(pathRows.some(hasPartialCoverage), `${label} records partial coverage at an integer coordinate`).toBe(true);
  expect(pathRows.every(hasPartialCoverage), `${label} partially covers both rows at an integer coordinate`).toBe(true);
  expect(outsideRows.every(isWhite), `${label} leaves rows outside the centered 1px stroke white`).toBe(true);
}

function expectHalfIntegerCoverage(pixels: Pixel[], y: number, label: string): void {
  const coreRow = Math.floor(y);
  const corePixel = pixels.find((pixel) => pixel.x === 250 && pixel.y === coreRow);
  expect(corePixel, `${label} includes its center pixel`).toBeDefined();
  expect(compositedLuma(corePixel!), `${label} has a covered core pixel`).toBeLessThan(80);

  const outsidePixels = pixels.filter((pixel) => pixel.y !== coreRow);
  expect(
    outsidePixels.every((pixel) => compositedLuma(pixel) > 200),
    `${label} leaves neighboring rows near-white outside its covered core`
  ).toBe(true);
  expect(outsidePixels.every(isWhite), `${label} leaves pixels outside its fully covered core row white`).toBe(true);
}

function expectDiagonalCoverage(pixels: Pixel[], center: Point, label: string): void {
  // The outer ring is sampling margin; assert ink only near the known path center.
  // Track the diagonal's footprint and nearby clear cells without pinning platform-dependent
  // antialiasing intensity to one absolute luma value.
  const lumaGrid = describeLumaGrid(pixels);
  const atPathCenter = pixels.filter((pixel) => Math.abs(pixel.x - center.x) <= 1 && Math.abs(pixel.y - center.y) <= 1);
  expect(atPathCenter.some(hasInk), `${label} leaves ink near the diagonal's center point\n${lumaGrid}`).toBe(true);
  expect(
    atPathCenter.some(hasPartialCoverage),
    `${label} has antialiased edge coverage near its center\n${lumaGrid}`
  ).toBe(true);

  const pixelAt = (x: number, y: number): Pixel | undefined => pixels.find((pixel) => pixel.x === x && pixel.y === y);
  const upperLeft = pixelAt(center.x - 2, center.y - 1);
  const lowerRight = pixelAt(center.x + 2, center.y + 1);
  const upperRight = pixelAt(center.x + 2, center.y - 1);
  const lowerLeft = pixelAt(center.x - 2, center.y + 1);
  const upperLeftOutside = pixelAt(center.x - 2, center.y);
  const lowerRightOutside = pixelAt(center.x + 2, center.y + 2);

  expect(upperLeft, `${label} samples the upper-left side of the diagonal\n${lumaGrid}`).toBeDefined();
  expect(hasInk(upperLeft!), `${label} has visible coverage on its upper-left path sample\n${lumaGrid}`).toBe(true);
  expect(lowerRight, `${label} samples the lower-right side of the diagonal\n${lumaGrid}`).toBeDefined();
  expect(hasInk(lowerRight!), `${label} has visible coverage on its lower-right path sample\n${lumaGrid}`).toBe(true);
  expect(upperRight, `${label} samples the mirrored upper-right pixel\n${lumaGrid}`).toBeDefined();
  expect(upperRight && isWhite(upperRight), `${label} leaves the mirrored upper-right pixel clear\n${lumaGrid}`).toBe(
    true
  );
  expect(lowerLeft, `${label} samples the mirrored lower-left pixel\n${lumaGrid}`).toBeDefined();
  expect(lowerLeft && isWhite(lowerLeft), `${label} leaves the mirrored lower-left pixel clear\n${lumaGrid}`).toBe(
    true
  );
  expect(upperLeftOutside, `${label} samples beside the upper-left path pixel\n${lumaGrid}`).toBeDefined();
  expect(
    upperLeftOutside && isWhite(upperLeftOutside),
    `${label} keeps the adjacent pixel outside the upper-left path clear\n${lumaGrid}`
  ).toBe(true);
  expect(lowerRightOutside, `${label} samples beside the lower-right path pixel\n${lumaGrid}`).toBeDefined();
  expect(
    lowerRightOutside && isWhite(lowerRightOutside),
    `${label} keeps the adjacent pixel outside the lower-right path clear\n${lumaGrid}`
  ).toBe(true);
}

test.describe('1px stroke pixel coverage', () => {
  test.describe.configure({ timeout: PAINT_TOOLS_TEST_TIMEOUT_MS });
  test.use({ deviceScaleFactor: 1 });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(getWorkspaceCanvas(page)).toBeVisible();
    const size = await getWorkspaceCanvas(page).evaluate((element) => {
      if (!(element instanceof HTMLCanvasElement)) throw new Error('The workspace locator did not resolve to a canvas');
      return { width: element.width, height: element.height };
    });
    expect(size).toEqual(DEFAULT_DOCUMENT_SIZE);
  });

  test('Draw Pen records integer, half-integer, and diagonal coverage', async ({ page }) => {
    await clickToolButton(page, 'draw');
    await setForegroundColor(page, BLACK, true);
    const size = page.locator('#size-slider');
    await size.fill(ONE_PIXEL);
    await expect(size).toHaveValue(ONE_PIXEL);

    const integerPixels = await drawAndRead(page, integerLine.from, integerLine.to, 'integer-y Draw Pen', {
      x: 250,
      y: integerLine.from.y,
    });
    expectIntegerCoverage(integerPixels, integerLine.from.y, 'integer-y Draw Pen');

    const halfPixels = await drawAndRead(page, halfIntegerLine.from, halfIntegerLine.to, 'half-integer-y Draw Pen', {
      x: 250,
      y: halfIntegerLine.from.y,
    });
    expectHalfIntegerCoverage(halfPixels, halfIntegerLine.from.y, 'half-integer-y Draw Pen');

    const diagonalCenter = { x: 250, y: 270 };
    const diagonalPixels = await drawAndRead(
      page,
      diagonalLine.from,
      diagonalLine.to,
      'diagonal Draw Pen',
      diagonalCenter
    );
    expectDiagonalCoverage(diagonalPixels, diagonalCenter, 'diagonal Draw Pen');
  });

  test('Shape Line records integer, half-integer, and diagonal coverage', async ({ page }) => {
    await openToolFlyout(page, 'shape');
    await selectFromFlyout(page, { toolName: 'shape', label: 'Line Tool' });
    await setForegroundColor(page, BLACK, true);
    const thickness = page.locator('#thickness-slider');
    await thickness.fill(ONE_PIXEL);
    await expect(thickness).toHaveValue(ONE_PIXEL);

    const integerY = 360;
    const integerFrom = { x: 100, y: integerY };
    const integerTo = { x: 400, y: integerY };
    const integerPixels = await drawAndRead(page, integerFrom, integerTo, 'integer-y Shape Line', {
      x: 250,
      y: integerY,
    });
    expectIntegerCoverage(integerPixels, integerY, 'integer-y Shape Line');

    const halfY = 400.5;
    const halfFrom = { x: 100, y: halfY };
    const halfTo = { x: 400, y: halfY };
    const halfPixels = await drawAndRead(page, halfFrom, halfTo, 'half-integer-y Shape Line', {
      x: 250,
      y: halfY,
    });
    expectHalfIntegerCoverage(halfPixels, halfY, 'half-integer-y Shape Line');

    const diagonalFrom = { x: 150, y: 440 };
    const diagonalTo = { x: 350, y: 540 };
    const diagonalPixels = await drawAndRead(page, diagonalFrom, diagonalTo, 'diagonal Shape Line', {
      x: 250,
      y: 490,
    });
    expectDiagonalCoverage(diagonalPixels, { x: 250, y: 490 }, 'diagonal Shape Line');
  });
});
