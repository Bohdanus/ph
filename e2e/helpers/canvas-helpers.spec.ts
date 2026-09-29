import { expect, test, type Page } from '@playwright/test';
import { getSelectionBounds, getColorAtPoint, getDarkPixelBounds, loadImageData } from './canvas-helpers';

interface DrawingShape {
  type: 'fillRect' | 'strokeRect';
  x: number;
  y: number;
  w: number;
  h: number;
}

interface DrawingSpec {
  fillStyle?: string;
  strokeStyle?: string;
  lineWidth?: number;
  globalAlpha?: number;
  shapes: DrawingShape[];
}

/**
 * The serialised argument of `page.evaluate`, named once so the callback reads its fields off
 * a single parameter. Destructuring them in the parameter list was equally correct at runtime -
 * `page.evaluate` passes exactly one argument, and destructuring that argument binds locals
 * rather than free variables - so the callback has no free names for the browser to miss. The
 * change was for the linter: `no-shadow` reported `width` / `height` / `drawSpec` as
 * redeclarations of `createTestImage`'s own parameters, three warnings. Reading the same three
 * values through `args.` removes them.
 */
interface CanvasDrawArgs {
  width: number;
  height: number;
  drawSpec: DrawingSpec;
}

const createTestImage = async (page: Page, width: number, height: number, drawSpec: DrawingSpec) => {
  const base64 = await page.evaluate(
    async (args: CanvasDrawArgs) => {
      const canvas = document.createElement('canvas');
      canvas.width = args.width;
      canvas.height = args.height;
      const ctx = canvas.getContext('2d')!;
      if (args.drawSpec.fillStyle) ctx.fillStyle = args.drawSpec.fillStyle;
      if (args.drawSpec.strokeStyle) ctx.strokeStyle = args.drawSpec.strokeStyle;
      if (args.drawSpec.lineWidth !== undefined) ctx.lineWidth = args.drawSpec.lineWidth;
      if (args.drawSpec.globalAlpha !== undefined) ctx.globalAlpha = args.drawSpec.globalAlpha;
      for (const shape of args.drawSpec.shapes) {
        if (shape.type === 'fillRect') {
          ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.type === 'strokeRect') {
          ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
        }
      }
      const dataUrl = canvas.toDataURL('image/png');
      return dataUrl.split(',')[1];
    },
    { width, height, drawSpec }
  );

  return Buffer.from(base64, 'base64');
};

test.describe('Canvas Helpers', () => {
  test('getDarkPixelBounds detects dark pixels', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#000000',
      shapes: [{ type: 'fillRect', x: 20, y: 20, w: 60, h: 60 }],
    });

    const bounds = await getDarkPixelBounds(screenshot);
    expect(bounds).toBeTruthy();
    expect(bounds!.left).toBe(20);
    expect(bounds!.top).toBe(20);
    expect(bounds!.right).toBe(79);
    expect(bounds!.bottom).toBe(79);
    expect(bounds!.width).toBe(60);
    expect(bounds!.height).toBe(60);
  });

  test('getDarkPixelBounds returns null for all-white image', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#ffffff',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const bounds = await getDarkPixelBounds(screenshot);
    expect(bounds).toBeNull();
  });

  test('getSelectionBounds detects cyan selection outline', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      strokeStyle: '#00ffff',
      lineWidth: 3,
      shapes: [{ type: 'strokeRect', x: 10, y: 10, w: 80, h: 80 }],
    });

    // The paint is a 3px band centred on the rect's path, so it spans 8.5..91.5. A pixel
    // counts as selection cyan only at red <= 80, which needs roughly 69% of the band over
    // it, so the half-covered pixels at 8 and at 91 are rejected and the detected edges are
    // 9 and 90. One pixel of tolerance covers the only thing that can move them - which side
    // of a 0.5 boundary the rasterizer assigns the half-covered pixel - and cannot cover a
    // shifted or partial detection, which is two pixels wide or more.
    const strokeOrigin = 10;
    const strokeSize = 80;
    const lineWidth = 3;
    const tolerance = 1;
    const firstCoveredPixel = Math.ceil(strokeOrigin - lineWidth / 2);
    const lastCoveredPixel = Math.floor(strokeOrigin + strokeSize + lineWidth / 2) - 1;

    const bounds = await getSelectionBounds(screenshot, { redMax: 80, greenMin: 80, blueMin: 180 });
    expect(bounds).toBeTruthy();
    expect(bounds!.left).toBeGreaterThanOrEqual(firstCoveredPixel - tolerance);
    expect(bounds!.left).toBeLessThanOrEqual(firstCoveredPixel + tolerance);
    expect(bounds!.top).toBeGreaterThanOrEqual(firstCoveredPixel - tolerance);
    expect(bounds!.top).toBeLessThanOrEqual(firstCoveredPixel + tolerance);
    expect(bounds!.right).toBeGreaterThanOrEqual(lastCoveredPixel - tolerance);
    expect(bounds!.right).toBeLessThanOrEqual(lastCoveredPixel + tolerance);
    expect(bounds!.bottom).toBeGreaterThanOrEqual(lastCoveredPixel - tolerance);
    expect(bounds!.bottom).toBeLessThanOrEqual(lastCoveredPixel + tolerance);
  });

  test('getSelectionBounds returns null when color not found', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#ff0000',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const bounds = await getSelectionBounds(screenshot, { redMax: 80, greenMin: 80, blueMin: 180 });
    expect(bounds).toBeNull();
  });

  test('getColorAtPoint returns color at point', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#ff7f00',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, undefined);
    expect(color).toBeTruthy();
    expect(color!.red).toBeGreaterThan(200);
    expect(color!.green).toBeGreaterThan(100);
    expect(color!.green).toBeLessThan(150);
    expect(color!.blue).toBeLessThan(50);
  });

  test('getColorAtPoint returns null for out of bounds', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#ff0000',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const color = await getColorAtPoint(screenshot, -1, 50, 5, undefined);
    expect(color).toBeNull();
  });

  test('getColorAtPoint ignores near-white with option', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#ffffff',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, { ignoreNearWhite: true, nearWhiteThreshold: 250 });
    expect(color).toBeNull();
  });

  test('getColorAtPoint respects custom nearWhiteThreshold', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#dcdcdc',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const colorDefault = await getColorAtPoint(screenshot, 50, 50, 5, { ignoreNearWhite: true });
    expect(colorDefault).toBeTruthy();

    const colorCustom = await getColorAtPoint(screenshot, 50, 50, 5, {
      ignoreNearWhite: true,
      nearWhiteThreshold: 200,
    });
    expect(colorCustom).toBeNull();
  });

  test('getColorAtPoint handles anti-aliased edges', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#333333',
      strokeStyle: '#000000',
      lineWidth: 3,
      globalAlpha: 0.9,
      shapes: [
        { type: 'fillRect', x: 10, y: 10, w: 80, h: 80 },
        { type: 'strokeRect', x: 10, y: 10, w: 80, h: 80 },
      ],
    });

    const edgeColor = await getColorAtPoint(screenshot, 9, 50, 3, undefined);
    expect(edgeColor, 'Should detect dark pixels at anti-aliased edge').toBeTruthy();
    expect(edgeColor!.red).toBeLessThanOrEqual(100);
    expect(edgeColor!.green).toBeLessThanOrEqual(100);
    expect(edgeColor!.blue).toBeLessThanOrEqual(100);

    const centerColor = await getColorAtPoint(screenshot, 50, 50, 3, undefined);
    expect(centerColor, 'Should detect dark pixels at center').toBeTruthy();
    expect(centerColor!.red).toBeLessThan(100);
  });

  test('getColorAtPoint handles alpha channels (partial transparency)', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#000000',
      globalAlpha: 0.5,
      shapes: [{ type: 'fillRect', x: 20, y: 20, w: 60, h: 60 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, undefined);
    expect(color, 'Partially transparent pixels should be detected').toBeTruthy();
  });

  test('getColorAtPoint threshold boundary does not filter pixel at exact threshold', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#fafafa',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, { ignoreNearWhite: true, nearWhiteThreshold: 250 });
    expect(color, 'Pixel at exact threshold boundary should not be filtered').toBeTruthy();
    expect(color!.red).toBe(250);
    expect(color!.green).toBe(250);
    expect(color!.blue).toBe(250);
  });

  test('getColorAtPoint detects pure blue (#0000ff)', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#0000ff',
      shapes: [{ type: 'fillRect', x: 0, y: 0, w: 100, h: 100 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, undefined);
    expect(color).toBeTruthy();
    expect(color!.red).toBe(0);
    expect(color!.green).toBe(0);
    expect(color!.blue).toBe(255);
  });

  test('getColorAtPoint detects Photoshop blue (#007acc) and getSelectionBounds finds it', async ({ page }) => {
    const screenshot = await createTestImage(page, 100, 100, {
      fillStyle: '#007acc',
      shapes: [{ type: 'fillRect', x: 20, y: 20, w: 60, h: 60 }],
    });

    const color = await getColorAtPoint(screenshot, 50, 50, 5, undefined);
    expect(color).toBeTruthy();
    expect(color!.red).toBe(0);
    expect(color!.green).toBe(122);
    expect(color!.blue).toBe(204);

    const bounds = await getSelectionBounds(screenshot, { redMax: 80, greenMin: 80, blueMin: 180 });
    expect(bounds).toBeTruthy();
  });

  test('loadImageData throws on corrupt base64 data', async () => {
    const corruptBuffer = Buffer.from('this-is-not-valid-png-data', 'utf-8');
    await expect(loadImageData(corruptBuffer)).rejects.toThrow();
  });

  test('loadImageData rejects invalid image bytes, without a wall-clock bound', async () => {
    // This used to be a second, weaker copy of the corrupt-base64 case above, with a
    // `Date.now()` delta asserted under 5000 ms. The delta made the suite's result
    // depend on how fast the machine is, and the rejection it asserted was the one the
    // previous test already asserts — so a hang would have been caught as a failure
    // either way, and a slow machine produced a red that no code change could fix.
    const invalidBuffer = Buffer.from('invalid-not-an-image', 'utf-8');
    await expect(loadImageData(invalidBuffer)).rejects.toThrow();
  });
});
