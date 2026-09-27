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

const createTestImage = async (page: Page, width: number, height: number, drawSpec: DrawingSpec) => {
  const base64 = await page.evaluate(
    async ({ width, height, drawSpec }: { width: number; height: number; drawSpec: DrawingSpec }) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      if (drawSpec.fillStyle) ctx.fillStyle = drawSpec.fillStyle;
      if (drawSpec.strokeStyle) ctx.strokeStyle = drawSpec.strokeStyle;
      if (drawSpec.lineWidth !== undefined) ctx.lineWidth = drawSpec.lineWidth;
      if (drawSpec.globalAlpha !== undefined) ctx.globalAlpha = drawSpec.globalAlpha;
      for (const shape of drawSpec.shapes) {
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

    const bounds = await getSelectionBounds(screenshot, { redMax: 80, greenMin: 80, blueMin: 180 });
    expect(bounds).toBeTruthy();
    expect(bounds!.left).toBeLessThanOrEqual(13);
    expect(bounds!.top).toBeLessThanOrEqual(13);
    expect(bounds!.right).toBeGreaterThanOrEqual(87);
    expect(bounds!.bottom).toBeGreaterThanOrEqual(87);
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

  test('loadImageData rejects quickly on invalid input (no hang)', async () => {
    const invalidBuffer = Buffer.from('invalid-not-an-image', 'utf-8');
    const startTime = Date.now();
    await expect(loadImageData(invalidBuffer)).rejects.toThrow();
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(5000);
  });
});
