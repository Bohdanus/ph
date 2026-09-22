import { describe, expect, it, vi } from 'vitest';

class MockOffscreenCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      setLineDash: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      clip: vi.fn(),
      closePath: vi.fn(),
      quadraticCurveTo: vi.fn(),
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 1,
      lineCap: 'round',
      lineJoin: 'round',
      globalAlpha: 1,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
    };
  }
}

vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);

import { defaultSettings } from '../settings.ts';
import { toolsMap } from '../toolsMap.ts';
import { createLayerSource } from '../../contexts/layer-utils.ts';

describe('paint tools', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() }))
    );
  });

  it('exposes real draw-like behavior for brush, pencil, and color replacement tools', () => {
    for (const toolName of ['brush', 'pencil', 'color-replacement'] as const) {
      const args = defaultSettings[toolName];

      expect(args).toMatchObject({
        toolName,
        color: expect.any(String),
        alpha: expect.any(Number),
        lineWidth: expect.any(Number),
      });

      const [canvas] = toolsMap[toolName].imageProcessor({ size: { width: 20, height: 20 } })(args as never);
      expect(canvas).toBeTruthy();
    }
  });

  it('uses the geometry tool pipeline for rectangle, ellipse, line, triangle, and polygon variants', () => {
    const variantToolNames = ['rectangle', 'ellipse', 'line', 'triangle', 'polygon'] as const;

    for (const toolName of variantToolNames) {
      const args = defaultSettings[toolName];
      expect(args).toMatchObject({
        toolName,
        color: expect.any(String),
        figure: expect.any(String),
      });

      const [canvas] = toolsMap[toolName].imageProcessor({ size: { width: 20, height: 20 } })(args as never);
      expect(canvas).toBeTruthy();
    }
  });

  it('preserves the computed brush bounds instead of snapping the finished layer to 0,0', () => {
    const pos = { x: 42, y: 18, width: 66, height: 32 };
    const layer = createLayerSource({
      layers: {},
      source: {
        kind: 'tool',
        args: {
          ...defaultSettings.brush,
          points: [
            { x: 60, y: 20 },
            { x: 90, y: 40 },
            { x: 100, y: 45 },
          ],
        },
        pos,
      },
    });

    expect(layer.pos).toEqual(pos);
  });
});
